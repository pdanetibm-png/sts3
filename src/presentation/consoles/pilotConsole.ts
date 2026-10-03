import * as THREE from "three";
import type { Track } from "../../knowledge/types";
import { NAV_MODE_LABELS, type NavMode } from "../../sim/navigation";
import { closestApproach, predictTrajectory, type ClosestApproach, type PredictedPoint } from "../../sim/predict";
import type { RigidBody } from "../../sim/rigidBody";
import { radarRangeFor } from "../../sim/sensorPhysics";
import { REFERENCE_CROSS_SECTION_M2 } from "../../sim/signature";
import { STANDARD_GRAVITY } from "../../sim/thrusters";
import type { SimulationWorld } from "../../sim/world";
import { TrackListView } from "./contactSheet";
import { el, formatDistance, formatSpeed } from "../dom";
import { ShipVisual } from "../render/shipMesh";
import { FriendlyVisuals } from "../render/friendlyVisuals";
import { friendlyContacts, SphereScope, trackContacts, type ScopeContact } from "../render/sphereScope";
import { TrackVisual } from "../render/trackVisual";
import { TrajectoryOverlay } from "../render/trajectoryOverlay";
import { deckGroup, hwKey, hwToggle, lamp, meterRow, screen, setLamp, stationShell } from "../station/stationKit";
import type { ConsolePanel } from "./consoleTypes";
import { refuseIfLocked } from "../commandGuard";
import type { TrackSelection } from "../trackSelection";

const CONTRE_VITESSE_MIN_SPEED = 0.5;
/** Recalcul de la prédiction : toutes les N images (propagation de quelques centaines de points). */
const PREDICTION_REFRESH_FRAMES = 10;
const HORIZONS: readonly { label: string; seconds: number }[] = [
  { label: "1 min", seconds: 60 },
  { label: "10 min", seconds: 600 },
  { label: "1 h", seconds: 3600 },
];
const NAV_MODES: readonly NavMode[] = ["manuel", "interception", "evasion", "perpendiculaire", "egaliser"];

export class PilotConsole implements ConsolePanel {
  readonly element: HTMLElement;

  private readonly world: SimulationWorld;
  private readonly body: RigidBody;
  private readonly scope: SphereScope;
  private readonly shipVisual: ShipVisual;
  private readonly friendlyVisuals: FriendlyVisuals;
  private readonly trackVisuals = new Map<string, TrackVisual>();
  private readonly trajectory: TrajectoryOverlay;

  private readonly throttleSlider: HTMLInputElement;
  private readonly throttleReadout: HTMLElement;
  private readonly forceButton: HTMLButtonElement;
  private readonly forceWarning: HTMLElement;
  private readonly attitudeHoldToggle: HTMLInputElement;
  private readonly headingInput: HTMLInputElement;
  private readonly pitchInput: HTMLInputElement;
  private readonly speedReadout: HTMLElement;
  private readonly attitudeReadout: HTMLElement;
  private readonly gReadout: HTMLElement;
  private readonly gBar: HTMLElement;
  private readonly gWarning: HTMLElement;
  private readonly exposureReadout: HTMLElement;
  private readonly exposureBar: HTMLElement;
  private readonly exposureEtaReadout: HTMLElement;
  private readonly incapacitatedWarning: HTMLElement;
  private readonly brakingReadout: HTMLElement;
  private readonly propellantReadout: HTMLElement;
  private readonly propellantBar: HTMLElement;
  private readonly propellantAutonomyReadout: HTMLElement;
  private readonly deltaVReadout: HTMLElement;
  private readonly modeReadout: HTMLElement;
  private readonly cpaReadout: HTMLElement;
  private readonly modeFeedback: HTMLElement;
  private readonly trackListView: TrackListView;
  private readonly modeKeys = new Map<NavMode, HTMLButtonElement>();
  private readonly horizonKeys = new Map<number, HTMLButtonElement>();

  private pendingThrottle = 0;
  private forcedForThrottle: number | null = null;
  /** Dernière poussée écrite par ce poste : un écart signale un changement fait ailleurs. */
  private lastAppliedThrottle: number | null = null;
  private frameCounter = 0;
  /** Piste commune à tous les postes ; `shownTrackId` repère un changement fait ailleurs. */
  private readonly selection: TrackSelection;
  private shownTrackId: string | null = null;
  private horizonSeconds = 600;
  private prediction: PredictedPoint[] = [];
  private cpa: ClosestApproach | null = null;
  private readonly overGLamp: HTMLElement;
  private readonly exposureLamp: HTMLElement;
  private readonly autoModeLamp: HTMLElement;
  private readonly propellantLamp: HTMLElement;

  constructor(world: SimulationWorld, playerBodyId: string, selection: TrackSelection) {
    this.world = world;
    const body = world.getBody(playerBodyId);
    if (!body) throw new Error(`Corps introuvable : ${playerBodyId}`);
    this.body = body;
    this.pendingThrottle = body.command.throttle;
    this.selection = selection;
    if (!selection.current && body.command.navTrackId) selection.set(body.command.navTrackId);

    const shell = stationShell("01", "Pilotage", "Navigation · propulsion · attitude", "pilot-station");
    this.element = shell.root;
    this.overGLamp = lamp("Surcharge G", "danger");
    this.exposureLamp = lamp("Exposition", "warning");
    this.autoModeLamp = lamp("Mode auto", "info");
    this.propellantLamp = lamp("Propergol bas", "warning");
    shell.lamps.append(this.overGLamp, this.exposureLamp, this.autoModeLamp, this.propellantLamp);

    // --- Écran principal : trajectoires dans la sphère d'engagement ---
    const nav = screen("NAV — Trajectoires", "screen-main");
    shell.main.appendChild(nav.frame);
    this.scope = new SphereScope((id) => this.selectTrack(id));
    nav.glass.appendChild(this.scope.element);
    nav.glass.appendChild(
      el(
        "div",
        "screen-caption",
        "Vert : route passée / prévue · rouge : route estimée de la piste · jaune : approche au plus près · flèches : vitesse (bleu), poussée (orange)",
      ),
    );
    const radar = body.sensors.find((s) => s.mode === "radar_active");
    this.scope.setRadius(radar ? radarRangeFor(radar, REFERENCE_CROSS_SECTION_M2, Math.PI) : 10000);
    this.shipVisual = new ShipVisual(0x4fd67a);
    this.shipVisual.addTo(this.scope.scene);
    this.friendlyVisuals = new FriendlyVisuals(this.scope.scene);
    this.trajectory = new TrajectoryOverlay(this.scope.scene);

    // --- Écran : état de vol ---
    const flight = screen("État de vol", "screen-flight");
    shell.side.appendChild(flight.frame);
    this.speedReadout = el("div", "screen-line screen-line-big");
    this.attitudeReadout = el("div", "screen-line");
    this.gReadout = el("div", "screen-line");
    const gBarTrack = el("div", "g-bar-track");
    this.gBar = el("div", "g-bar-fill");
    gBarTrack.appendChild(this.gBar);
    this.gWarning = el("div", "warning-label hidden", `Dépassement du seuil équipage (${body.crew.gThreshold} G)`);
    this.exposureReadout = el("div", "screen-line");
    const exposureBarTrack = el("div", "g-bar-track");
    this.exposureBar = el("div", "g-bar-fill");
    exposureBarTrack.appendChild(this.exposureBar);
    this.exposureEtaReadout = el("div", "screen-line screen-line-dim");
    this.incapacitatedWarning = el("div", "warning-label hidden", "ÉQUIPAGE INCAPACITÉ — mission en échec.");
    this.brakingReadout = el("div", "screen-line screen-line-dim");
    this.propellantReadout = el("div", "screen-line");
    const propellantBarTrack = el("div", "g-bar-track");
    this.propellantBar = el("div", "g-bar-fill");
    propellantBarTrack.appendChild(this.propellantBar);
    this.propellantAutonomyReadout = el("div", "screen-line screen-line-dim");
    this.deltaVReadout = el("div", "screen-line");
    // La consigne (poussée, maintien, mode) se lit déjà sur le pupitre : l'écran garde l'état du vol.
    flight.glass.append(
      this.speedReadout,
      this.attitudeReadout,
      this.brakingReadout,
      meterRow("Accél.", gBarTrack, this.gReadout),
      this.gWarning,
      meterRow("Expo. G", exposureBarTrack, this.exposureReadout),
      this.exposureEtaReadout,
      this.incapacitatedWarning,
      meterRow("Propergol", propellantBarTrack, this.propellantReadout),
      this.propellantAutonomyReadout,
      this.deltaVReadout,
    );

    // --- Écran : mode de pilotage et piste ---
    const pursuit = screen("Mode de pilotage — piste");
    shell.side.appendChild(pursuit.frame);
    this.modeReadout = el("div", "screen-line");
    this.cpaReadout = el("div", "screen-line");
    this.trackListView = new TrackListView((id) => this.selectTrack(id));
    pursuit.glass.append(this.modeReadout, this.cpaReadout, this.trackListView.element);

    // --- Pupitre ---
    const throttleGroup = deckGroup("Poussée principale", "deck-group-throttle");
    this.throttleSlider = el("input", "hw-lever");
    this.throttleSlider.type = "range";
    this.throttleSlider.min = "0";
    this.throttleSlider.max = "100";
    this.throttleSlider.value = String(Math.round(this.pendingThrottle * 100));
    this.throttleSlider.setAttribute("aria-label", "Levier de poussée principale");
    const leverScale = el("div", "hw-lever-scale");
    for (const mark of ["100", "75", "50", "25", "0"]) leverScale.appendChild(el("span", undefined, mark));
    const leverHousing = el("div", "hw-lever-housing");
    leverHousing.append(leverScale, this.throttleSlider);
    this.throttleReadout = el("span", "lcd", "0 %");
    const cutBtn = hwKey("Coupure", "danger");
    cutBtn.addEventListener("click", () => this.setPendingThrottle(0));
    this.forceButton = hwKey("Forcer", "warning");
    this.forceButton.classList.add("hidden");
    this.forceWarning = el("div", "warning-label hidden", "Consigne au-delà du seuil équipage.");
    const throttleSide = el("div", "deck-stack");
    throttleSide.append(el("span", "deck-label", "Consigne"), this.throttleReadout, cutBtn, this.forceButton);
    const throttleRow = el("div", "deck-row");
    throttleRow.append(leverHousing, throttleSide);
    throttleGroup.append(throttleRow, this.forceWarning);
    shell.deck.appendChild(throttleGroup);

    this.throttleSlider.addEventListener("input", () => {
      this.setPendingThrottle(Number(this.throttleSlider.value) / 100);
    });
    this.forceButton.addEventListener("click", () => this.applyForcedThrottle());

    const modeGroup = deckGroup("Mode de pilotage");
    const modeRow = el("div", "deck-row deck-row-wrap");
    for (const mode of NAV_MODES) {
      const key = hwKey(NAV_MODE_LABELS[mode], mode === "manuel" ? "neutral" : "accent");
      key.classList.add("hw-key-small");
      key.addEventListener("click", () => this.engageMode(mode));
      this.modeKeys.set(mode, key);
      modeRow.appendChild(key);
    }
    this.modeFeedback = el("div", "deck-readout hidden");
    modeGroup.append(
      modeRow,
      this.modeFeedback,
      el("p", "deck-note", "Le mode oriente le vaisseau par rapport à la piste choisie ; la poussée reste la vôtre."),
    );
    shell.deck.appendChild(modeGroup);

    const attitudeGroup = deckGroup("Attitude");
    const hold = hwToggle("Maintien attitude");
    this.attitudeHoldToggle = hold.input;
    this.headingInput = el("input", "lcd lcd-input");
    this.headingInput.type = "number";
    this.headingInput.min = "0";
    this.headingInput.max = "359";
    this.headingInput.value = "0";
    this.pitchInput = el("input", "lcd lcd-input");
    this.pitchInput.type = "number";
    this.pitchInput.min = "-90";
    this.pitchInput.max = "90";
    this.pitchInput.value = "0";
    const headingField = el("label", "deck-field");
    headingField.append(el("span", "deck-label", "Cap °"), this.headingInput);
    const pitchField = el("label", "deck-field");
    pitchField.append(el("span", "deck-label", "Incl. °"), this.pitchInput);
    const applyAttitudeBtn = hwKey("Appliquer", "accent");
    applyAttitudeBtn.addEventListener("click", () =>
      this.setHeadingPitchTarget(Number(this.headingInput.value) || 0, Number(this.pitchInput.value) || 0),
    );
    const contreVitesseBtn = hwKey("Contre-vitesse", "accent");
    contreVitesseBtn.addEventListener("click", () => this.orientContreVitesse());
    const fieldsRow = el("div", "deck-row");
    fieldsRow.append(headingField, pitchField);
    const keysRow = el("div", "deck-row");
    keysRow.append(applyAttitudeBtn, contreVitesseBtn);
    attitudeGroup.append(hold.wrapper, fieldsRow, keysRow);
    shell.deck.appendChild(attitudeGroup);

    this.attitudeHoldToggle.addEventListener("change", () => {
      // Refusé en pause : l'interrupteur revient à l'état réel à la frame suivante (update).
      if (refuseIfLocked(this.world)) return;
      this.body.command.attitudeHoldEngaged = this.attitudeHoldToggle.checked;
    });

    const viewGroup = deckGroup("Prédiction");
    const horizonRow = el("div", "deck-row");
    for (const horizon of HORIZONS) {
      const key = hwKey(horizon.label);
      key.classList.add("hw-key-small");
      key.addEventListener("click", () => this.setHorizon(horizon.seconds));
      this.horizonKeys.set(horizon.seconds, key);
      horizonRow.appendChild(key);
    }
    viewGroup.append(
      el("span", "deck-label", "Horizon de prédiction"),
      horizonRow,
      el("p", "deck-note", "Tourner ne change pas la trajectoire ; seule une poussée change la vitesse."),
    );
    shell.deck.append(viewGroup);
    this.setHorizon(this.horizonSeconds);
  }

  private setHorizon(seconds: number): void {
    this.horizonSeconds = seconds;
    for (const [value, key] of this.horizonKeys) key.classList.toggle("is-active", value === seconds);
    this.frameCounter = 0;
  }

  private setPendingThrottle(value: number): void {
    if (refuseIfLocked(this.world)) return; // le curseur revient à la consigne en cours (update)
    this.pendingThrottle = Math.max(0, Math.min(1, value));
    this.forcedForThrottle = null;
    this.applyThrottleGate();
  }

  private applyForcedThrottle(): void {
    if (refuseIfLocked(this.world)) return;
    this.forcedForThrottle = this.pendingThrottle;
    this.applyThrottleGate();
  }

  private safeMaxThrottle(): number {
    const maxG = (this.body.principalThruster.maxThrustNewtons / this.body.massKg) / STANDARD_GRAVITY;
    if (maxG <= 0) return 0;
    return Math.max(0, Math.min(1, this.body.crew.gThreshold / maxG));
  }

  private applyThrottleGate(): void {
    // La poussée a pu être changée hors de ce poste (Tactique : « couper la poussée au largage »,
    // reprise d'une sauvegarde) : la consigne affichée la suit au lieu de la réécrire.
    if (this.lastAppliedThrottle !== null && this.body.command.throttle !== this.lastAppliedThrottle) {
      this.pendingThrottle = this.body.command.throttle;
      this.forcedForThrottle = null;
    }
    const safeMax = this.safeMaxThrottle();
    const exceedsThreshold = this.pendingThrottle > safeMax + 1e-6;
    if (!exceedsThreshold) {
      this.writeThrottle(this.pendingThrottle);
      this.forceWarning.classList.add("hidden");
      this.forceButton.classList.add("hidden");
      return;
    }
    if (this.forcedForThrottle === this.pendingThrottle) {
      this.writeThrottle(this.pendingThrottle);
      this.forceWarning.classList.remove("hidden");
      this.forceWarning.textContent = `Manœuvre forcée au-delà du seuil équipage (${this.body.crew.gThreshold} G).`;
      this.forceButton.classList.add("hidden");
    } else {
      this.writeThrottle(safeMax);
      this.forceWarning.classList.remove("hidden");
      this.forceWarning.textContent = `Consigne à ${Math.round(this.pendingThrottle * 100)} % dépasse ${this.body.crew.gThreshold} G — limitée à ${Math.round(safeMax * 100)} % sans confirmation.`;
      this.forceButton.classList.remove("hidden");
    }
  }

  /** Seul endroit où ce poste écrit la poussée ; mémorise la valeur pour repérer un changement venu d'ailleurs. */
  private writeThrottle(value: number): void {
    this.body.command.throttle = value;
    this.lastAppliedThrottle = value;
  }

  /** Orientation à la main : repasse en mode manuel (sinon le mode réécrirait l'attitude au pas suivant). */
  private takeManualAttitude(): void {
    if (this.body.command.navMode !== "manuel") {
      this.body.command.navMode = "manuel";
      this.body.command.navTrackId = null;
      this.showModeFeedback("Attitude reprise à la main : mode manuel.", false);
    }
  }

  /** Point d'entrée unique pour fixer l'attitude cible à la main — numérique ou contre-vitesse. */
  private setHeadingPitchTarget(headingDeg: number, pitchDeg: number): void {
    if (refuseIfLocked(this.world)) return;
    this.takeManualAttitude();
    const normalizedHeading = ((headingDeg % 360) + 360) % 360;
    const clampedPitch = Math.max(-90, Math.min(90, pitchDeg));
    const target = headingPitchToQuaternion(normalizedHeading, clampedPitch, this.body.principalThruster.localAxis);
    this.body.command.targetAttitude.copy(target);
    this.attitudeHoldToggle.checked = true;
    this.body.command.attitudeHoldEngaged = true;
    this.headingInput.value = normalizedHeading.toFixed(0);
    this.pitchInput.value = clampedPitch.toFixed(0);
  }

  private orientContreVitesse(): void {
    if (refuseIfLocked(this.world)) return;
    if (this.body.velocity.length() < CONTRE_VITESSE_MIN_SPEED) return;
    this.takeManualAttitude();
    const direction = this.body.velocity.clone().normalize().negate();
    const localAxis = new THREE.Vector3(...this.body.principalThruster.localAxis).normalize();
    const target = new THREE.Quaternion().setFromUnitVectors(localAxis, direction);
    this.body.command.targetAttitude.copy(target);
    this.attitudeHoldToggle.checked = true;
    this.body.command.attitudeHoldEngaged = true;
    const { headingDeg, pitchDeg } = quaternionToHeadingPitch(target, this.body.principalThruster.localAxis);
    this.headingInput.value = headingDeg.toFixed(0);
    this.pitchInput.value = pitchDeg.toFixed(0);
  }

  /** Écrit la consigne dans l'état persistant du vaisseau (lu par sim/navigation.ts à chaque pas). */
  private engageMode(mode: NavMode): void {
    if (refuseIfLocked(this.world)) return;
    if (mode === "manuel") {
      this.body.command.navMode = "manuel";
      this.body.command.navTrackId = null;
      this.showModeFeedback("Mode manuel.", false);
      return;
    }
    const track = this.selection.current ? this.body.knowledge.getTrack(this.selection.current) : undefined;
    if (!track) {
      this.showModeFeedback(`Choisissez une piste (liste ou sphère) avant « ${NAV_MODE_LABELS[mode]} ».`);
      return;
    }
    this.body.command.navMode = mode;
    this.body.command.navTrackId = track.localId;
    const limitation = modeLimitation(mode, track);
    this.showModeFeedback(limitation ?? `${NAV_MODE_LABELS[mode]} sur ${track.localId}.`, !!limitation);
  }

  private showModeFeedback(message: string, isWarning = true): void {
    this.modeFeedback.textContent = message;
    this.modeFeedback.classList.remove("hidden");
    this.modeFeedback.classList.toggle("deck-readout-alert", isWarning);
  }

  /**
   * Choisir une autre piste ICI pendant un mode actif le reporte sur elle. Une sélection faite dans
   * un autre poste ne change que la piste affichée : jamais la consigne de pilotage.
   */
  private selectTrack(localId: string): void {
    this.selection.set(localId);
    this.shownTrackId = localId;
    const mode = this.body.command.navMode;
    if (mode !== "manuel") this.engageMode(mode);
    this.frameCounter = 0;
  }

  private describeMode(track: Track | undefined): string {
    const command = this.body.command;
    if (command.navMode === "manuel") return "Mode : manuel — attitude et poussée à la main.";
    const target = command.navTrackId ? this.body.knowledge.getTrack(command.navTrackId) : undefined;
    if (!target) return `Mode : ${NAV_MODE_LABELS[command.navMode]} — piste ${command.navTrackId ?? "?"} introuvable, plus de consigne.`;
    const detail = modeLimitation(command.navMode, target) ?? MODE_DESCRIPTIONS[command.navMode];
    const other = track && track.localId !== target.localId ? ` (piste affichée : ${track.localId})` : "";
    return `Mode : ${NAV_MODE_LABELS[command.navMode]} sur ${target.localId}${other} — ${detail}`;
  }

  private describeClosestApproach(track: Track | undefined): string {
    if (!track) return "Approche au plus près : choisissez une piste.";
    if (!track.positionEstimateWorld) return `Approche au plus près : ${track.localId} au gisement seul — distance inconnue.`;
    if (!this.cpa) return "Approche au plus près : —";
    const assumption = track.velocityEstimateWorld ? "piste à vitesse constante" : "vitesse de la piste inconnue, supposée nulle";
    if (this.cpa.t <= 1e-6) return `Approche au plus près : maintenant, ${formatDistance(this.cpa.distanceMeters)} — la distance augmente (${assumption}).`;
    const when = this.cpa.beyondHorizon ? `au-delà de l'horizon (${formatDuration(this.horizonSeconds)}), encore en rapprochement` : `dans ${formatDuration(this.cpa.t)}`;
    return `Approche au plus près : ${formatDistance(this.cpa.distanceMeters)} ${when} (${assumption}, consigne actuelle maintenue).`;
  }

  /** Prédiction (consigne maintenue), route estimée de la piste choisie, approche au plus près. */
  private refreshPrediction(track: Track | undefined): void {
    this.prediction = predictTrajectory(this.body, this.horizonSeconds);
    this.trajectory.setPrediction(this.prediction);
    if (track?.positionEstimateWorld) {
      const velocity = track.velocityEstimateWorld ?? new THREE.Vector3();
      this.cpa = closestApproach(this.prediction, track.positionEstimateWorld, velocity);
      this.trajectory.setTrackPath(
        track.velocityEstimateWorld
          ? [track.positionEstimateWorld.clone(), track.positionEstimateWorld.clone().addScaledVector(velocity, this.horizonSeconds)]
          : null,
      );
    } else {
      this.cpa = null;
      this.trajectory.setTrackPath(null);
    }
    this.trajectory.setClosestApproach(this.cpa && this.cpa.t > 1e-6 ? this.cpa : null);
  }

  /** Graduations de temps le long de la route prévue et repère du point d'approche au plus près. */
  private trajectoryMarkers(): ScopeContact[] {
    const markers: ScopeContact[] = [];
    const interval = tickInterval(this.horizonSeconds);
    // Graduations trop serrées (vaisseau presque immobile à cette échelle) : illisibles, omises.
    const minSpacing = this.scope.cameraDistance * 0.04;
    let lastKept = this.body.position;
    for (let t = interval; t <= this.horizonSeconds + 1e-6; t += interval) {
      const position = positionAt(this.prediction, t);
      if (!position || position.distanceTo(lastKept) < minSpacing) continue;
      lastKept = position;
      markers.push({ id: `tick:${t}`, label: `+${formatDuration(t)}`, worldPoint: position, detail: "", tone: "tick", bearingOnly: false, selectable: false, hideWhenOffscreen: true });
    }
    if (this.cpa && this.cpa.t > 1e-6) {
      markers.push({
        id: "cpa",
        label: this.cpa.beyondHorizon ? `Distance à +${formatDuration(this.cpa.t)}` : "Approche au plus près",
        worldPoint: this.cpa.ownPosition,
        detail: `${formatDistance(this.cpa.distanceMeters)} · ${this.cpa.beyondHorizon ? "toujours en rapprochement" : `dans ${formatDuration(this.cpa.t)}`}`,
        tone: "cpa",
        bearingOnly: false,
        selectable: false,
        hideWhenOffscreen: true,
      });
    }
    return markers;
  }

  update(_realDeltaSeconds: number): void {
    const body = this.body;

    // Réévalué chaque frame (pas seulement au changement de curseur) : la masse baisse
    // avec le propergol, donc un même % de poussée produit un G croissant dans le temps.
    this.applyThrottleGate();

    const selectedTrackId = this.selection.current;
    if (selectedTrackId !== this.shownTrackId) {
      this.shownTrackId = selectedTrackId;
      this.frameCounter = 0;
    }
    const selectedTrack = selectedTrackId ? body.knowledge.getTrack(selectedTrackId) : undefined;
    if (this.frameCounter++ % PREDICTION_REFRESH_FRAMES === 0) this.refreshPrediction(selectedTrack);

    const scale = this.scope.cameraDistance;
    this.shipVisual.update(body.position, body.attitude, body.velocity);
    this.shipVisual.velocityArrow.visible = false;
    this.shipVisual.setTrail(body.trail);
    this.shipVisual.setScale(scale / 400);
    this.friendlyVisuals.update(body.knowledge.friendlies, scale / 400);

    const localAxis = new THREE.Vector3(...body.principalThruster.localAxis).normalize();
    this.trajectory.update({
      position: body.position,
      velocity: body.velocity,
      thrustAxis: localAxis.clone().applyQuaternion(body.attitude),
      throttle: body.command.throttle,
      targetAxis: body.command.attitudeHoldEngaged ? localAxis.clone().applyQuaternion(body.command.targetAttitude) : null,
      scaleMeters: scale,
    });

    const seenIds = new Set<string>();
    for (const track of body.knowledge.tracks) {
      seenIds.add(track.localId);
      let visual = this.trackVisuals.get(track.localId);
      if (!visual) {
        visual = new TrackVisual();
        visual.addTo(this.scope.scene);
        this.trackVisuals.set(track.localId, visual);
      }
      visual.update(track, body.position);
    }
    for (const [id, visual] of this.trackVisuals) {
      if (!seenIds.has(id)) {
        visual.dispose();
        this.trackVisuals.delete(id);
      }
    }

    this.scope.setSelected(selectedTrackId);
    this.scope.render(body.position, [
      ...this.trajectoryMarkers(),
      ...friendlyContacts(body.knowledge.friendlies, body.position),
      ...trackContacts(body.knowledge.tracks, body.position, this.scope.radius),
    ]);

    this.throttleReadout.textContent = `${Math.round(body.command.throttle * 100)} %`;
    if (Math.abs(Number(this.throttleSlider.value) / 100 - this.pendingThrottle) > 1e-6) {
      this.throttleSlider.value = String(Math.round(this.pendingThrottle * 100));
    }

    const speed = body.velocity.length();
    this.speedReadout.textContent = `Vitesse : ${speed.toFixed(1)} m/s`;
    const principalAxis = body.principalThruster.localAxis;
    const { headingDeg, pitchDeg } = quaternionToHeadingPitch(body.attitude, principalAxis);
    this.attitudeReadout.textContent = `Cap ${headingDeg.toFixed(0)}° · Inclinaison ${pitchDeg.toFixed(0)}°`;

    const netForceWorld = body.lastAllocation?.forceWorld ?? new THREE.Vector3();
    const accelG = netForceWorld.length() / body.massKg / STANDARD_GRAVITY;
    this.gReadout.textContent = `${accelG.toFixed(2)} G ${axisLabel(principalAxis)}`;
    this.gBar.style.width = `${Math.min(100, (accelG / (this.body.crew.gThreshold * 1.5)) * 100)}%`;
    this.gBar.classList.toggle("g-bar-over", accelG > this.body.crew.gThreshold);
    this.gWarning.classList.toggle("hidden", accelG <= this.body.crew.gThreshold);

    const exposureFraction = body.crewExposureFraction;
    this.exposureReadout.textContent = `${(exposureFraction * 100).toFixed(0)} % ${body.crewExposureTrendPerSecond >= 0 ? "+" : ""}${(body.crewExposureTrendPerSecond * 100).toFixed(1)}/s`;
    const dominantAxis = body.crewExposureDominantAxis ? ` · axe ${body.crewExposureDominantAxis.toUpperCase()}` : "";
    this.exposureBar.style.width = `${Math.max(0, Math.min(100, exposureFraction * 100))}%`;
    this.exposureBar.classList.toggle("g-bar-over", exposureFraction > 0.5);
    if (body.crewExposureIncapacitated) {
      this.exposureEtaReadout.textContent = "";
      this.incapacitatedWarning.classList.remove("hidden");
    } else {
      this.incapacitatedWarning.classList.add("hidden");
      const rising = body.crewExposureTrendPerSecond > 1e-6;
      this.exposureEtaReadout.classList.toggle("hidden", !rising);
      this.exposureEtaReadout.textContent = rising
        ? `Incapacité dans ~${((1 - exposureFraction) / body.crewExposureTrendPerSecond).toFixed(0)} s si la consigne persiste${dominantAxis}`
        : "";
    }

    this.attitudeHoldToggle.checked = body.command.attitudeHoldEngaged;

    this.trackListView.update(body.knowledge.tracks, selectedTrackId, this.world.simTimeSeconds);
    this.modeReadout.textContent = this.describeMode(selectedTrack);
    this.cpaReadout.textContent = this.describeClosestApproach(selectedTrack);
    for (const [mode, key] of this.modeKeys) key.classList.toggle("is-active", mode === body.command.navMode);

    this.brakingReadout.textContent = `Freinage estimé : ${estimateBrakingTime(body)}`;

    const fuelFlow = body.lastAllocation?.fuelFlowKgPerSecond ?? 0;
    const fraction = body.reservoir.quantityKg / body.reservoir.capacityKg;
    const autonomy = fuelFlow > 1e-6 ? `${formatDuration(body.reservoir.quantityKg / fuelFlow)} à ce débit` : "— (aucune consommation)";
    this.propellantReadout.textContent = `${(fraction * 100).toFixed(0)} %`;
    this.propellantAutonomyReadout.textContent = `${(body.reservoir.quantityKg / 1000).toFixed(1)} / ${(body.reservoir.capacityKg / 1000).toFixed(1)} t · autonomie ${autonomy}`;
    this.propellantBar.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
    this.propellantBar.classList.toggle("g-bar-over", fraction < 0.2);
    this.deltaVReadout.textContent = `Δv restant : ${formatSpeed(remainingDeltaV(body))}`;
    this.deltaVReadout.title = "Si tout le propergol restant passait par le moteur principal.";

    setLamp(this.overGLamp, accelG > this.body.crew.gThreshold);
    setLamp(this.exposureLamp, exposureFraction > 0.5 || body.crewExposureIncapacitated);
    setLamp(this.autoModeLamp, body.command.navMode !== "manuel" && !!body.command.navTrackId);
    setLamp(this.propellantLamp, fraction < 0.2);
  }

  resize(): void {
    this.scope.resize();
  }

  dispose(): void {
    this.scope.dispose();
    this.element.remove();
  }
}

const MODE_DESCRIPTIONS: Record<NavMode, string> = {
  manuel: "attitude et poussée à la main.",
  interception: "nez vers le rendez-vous, freinage anticipé (retournement compris).",
  evasion: "dos à la piste : chaque poussée augmente la distance.",
  perpendiculaire: "poussée à 90° de la ligne de visée et de la route de la menace, pour la faire rater.",
  egaliser: "poussée qui annule la vitesse relative estimée.",
};

/** Ce qu'un mode ne peut pas faire avec ce que l'on sait de la piste (null : rien à signaler). */
function modeLimitation(mode: NavMode, track: Track): string | null {
  if (mode === "interception" && !track.positionEstimateWorld) return "gisement seul : approche le long du gisement, sans profil de freinage.";
  if (mode === "egaliser" && !track.velocityEstimateWorld) return "vitesse de la piste inconnue : aucune consigne tant qu'elle n'est pas estimée.";
  if (mode === "perpendiculaire" && !track.velocityEstimateWorld) return "vitesse de la piste inconnue : perpendiculaire à la seule ligne de visée.";
  return null;
}

/** Δv disponible si tout le propergol passait par le moteur principal (Tsiolkovski). */
function remainingDeltaV(body: RigidBody): number {
  const dry = body.massKg - body.reservoir.quantityKg;
  if (dry <= 0) return 0;
  return body.principalThruster.specificImpulseSeconds * STANDARD_GRAVITY * Math.log(body.massKg / dry);
}

function positionAt(points: readonly PredictedPoint[], t: number): THREE.Vector3 | null {
  if (points.length < 2 || t > points[points.length - 1].t + 1e-6) return null;
  for (let i = 1; i < points.length; i++) {
    if (points[i].t >= t) {
      const a = points[i - 1];
      const b = points[i];
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      return a.position.clone().lerp(b.position, u);
    }
  }
  return points[points.length - 1].position.clone();
}

/** Pas de graduation « rond » donnant environ six repères sur l'horizon. */
function tickInterval(horizonSeconds: number): number {
  const candidates = [10, 30, 60, 120, 300, 600, 1200, 1800, 3600];
  return candidates.find((c) => horizonSeconds / c <= 6) ?? 3600;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)} s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds - minutes * 60);
    return rest > 0 && minutes < 10 ? `${minutes} min ${rest} s` : `${Math.round(seconds / 60)} min`;
  }
  const hours = Math.floor(seconds / 3600);
  return `${hours} h ${String(Math.round((seconds - hours * 3600) / 60)).padStart(2, "0")}`;
}

function axisLabel(axis: readonly [number, number, number]): string {
  const names = ["X", "Y", "Z"];
  const index = axis.findIndex((v) => Math.abs(v) > 0.5);
  return index >= 0 ? (axis[index] < 0 ? `-${names[index]}` : `+${names[index]}`) : "?";
}

function headingPitchToQuaternion(headingDeg: number, pitchDeg: number, localAxis: readonly [number, number, number]): THREE.Quaternion {
  const heading = THREE.MathUtils.degToRad(headingDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const direction = new THREE.Vector3(Math.cos(pitch) * Math.sin(heading), Math.sin(pitch), Math.cos(pitch) * Math.cos(heading));
  const axis = new THREE.Vector3(...localAxis).normalize();
  return new THREE.Quaternion().setFromUnitVectors(axis, direction);
}

function quaternionToHeadingPitch(quaternion: THREE.Quaternion, localAxis: readonly [number, number, number]): { headingDeg: number; pitchDeg: number } {
  const axis = new THREE.Vector3(...localAxis).normalize();
  const forward = axis.clone().applyQuaternion(quaternion);
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
  const heading = Math.atan2(forward.x, forward.z);
  return {
    headingDeg: (THREE.MathUtils.radToDeg(heading) + 360) % 360,
    pitchDeg: THREE.MathUtils.radToDeg(pitch),
  };
}

function estimateBrakingTime(body: RigidBody): string {
  const speed = body.velocity.length();
  if (speed < CONTRE_VITESSE_MIN_SPEED) return "0 s (déjà à l'arrêt relatif)";
  const forward = new THREE.Vector3(...body.principalThruster.localAxis).normalize().applyQuaternion(body.attitude);
  const antiVelocity = body.velocity.clone().normalize().negate();
  const alignment = forward.dot(antiVelocity);
  if (alignment < Math.cos(THREE.MathUtils.degToRad(15))) return "non disponible (attitude non orientée à contre-vitesse)";
  const maxAcceleration = body.principalThruster.maxThrustNewtons / body.massKg;
  return `${(speed / maxAcceleration).toFixed(0)} s à poussée maximale`;
}
