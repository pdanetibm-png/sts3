import * as THREE from "three";
import type { Decoy } from "../../sim/decoy";
import { estimateEngagementQuality, missileReachMeters, resolveGuidanceTarget, type Missile } from "../../sim/missile";
import { PDC_MODE_LABELS, type PdcMode } from "../../sim/pdc";
import type { RigidBody } from "../../sim/rigidBody";
import { STANDARD_GRAVITY } from "../../sim/thrusters";
import type { SimulationWorld } from "../../sim/world";
import { el } from "../dom";
import { radarRangeFor } from "../../sim/sensorPhysics";
import { REFERENCE_CROSS_SECTION_M2 } from "../../sim/signature";
import { ShipVisual } from "../render/shipMesh";
import { FriendlyVisuals } from "../render/friendlyVisuals";
import { friendlyContacts, SphereScope, trackContacts, type ScopeContact } from "../render/sphereScope";
import { TrackVisual } from "../render/trackVisual";
import { renderContactSheet, TrackListView } from "./contactSheet";
import { deckField, deckGroup, hwKey, hwToggle, lamp, lcdInput, screen, setLamp, stationShell } from "../station/stationKit";
import type { ConsolePanel } from "./consoleTypes";
import { commandsLocked, refuseIfLocked } from "../commandGuard";
import type { TrackSelection } from "../trackSelection";

const MISSILE_STATE_LABELS: Record<Missile["state"], string> = {
  poussee: "propulsé",
  derive: "en dérive",
  perdu_theatre: "perdu — limite du théâtre",
  detruit: "impact",
  // Abattu par une PDC ennemie : le joueur ne sait qu'une chose, la télémétrie s'est tue.
  abattu: "liaison perdue",
};

const DECOY_STATE_LABELS: Record<Decoy["state"], string> = {
  poussee: "en poussée",
  derive: "en dérive",
  perdu_theatre: "perdu — limite du théâtre",
  detruit: "liaison perdue (impact probable)",
};

/** Couleur des leurres propres, dans la sphère comme dans la liste (voir style.css, tone « decoy »). */
const DECOY_COLOR = 0xc792ff;

interface DecoyRowEntry {
  wrapper: HTMLElement;
  idEl: HTMLElement;
  stateEl: HTMLElement;
  reserveEl: HTMLElement;
  imitationEl: HTMLElement;
  emitterEl: HTMLElement;
}

/** Ligne d'état d'une tourelle, et ce que les capteurs ont montré après son dernier tir. */
interface PdcRowEntry {
  line: HTMLElement;
  lastTrackId: string | null;
  lastShotSimTime: number | null;
  link: THREE.Line;
  linkGeometry: THREE.BufferGeometry;
}

interface MissileVisualEntry {
  visual: ShipVisual;
  linkLine: THREE.Line;
  linkGeometry: THREE.BufferGeometry;
}

interface MissileRowEntry {
  wrapper: HTMLElement;
  idEl: HTMLElement;
  stateEl: HTMLElement;
  reserveEl: HTMLElement;
  speedEl: HTMLElement;
  etaEl: HTMLElement;
  abandonBtn: HTMLButtonElement;
}

/** Poste Tactique (section 8.4) : sélection de piste, lancement explicite, missiles propres. */
export class TacticalConsole implements ConsolePanel {
  readonly element: HTMLElement;

  private readonly world: SimulationWorld;
  private readonly body: RigidBody;
  private readonly scope: SphereScope;
  private readonly ownShipVisual: ShipVisual;
  private readonly friendlyVisuals: FriendlyVisuals;
  private readonly trackVisuals = new Map<string, TrackVisual>();
  private readonly missileVisuals = new Map<string, MissileVisualEntry>();


  private readonly trackListView: TrackListView;
  private readonly contactSheetSlot: HTMLElement;
  private readonly qualityReadout: HTMLElement;
  private readonly hypotheticalDistanceInput: HTMLInputElement;
  private readonly engagementGroup: HTMLElement;
  private readonly launchButton: HTMLButtonElement;
  private readonly launchFeedback: HTMLElement;
  private readonly magazineTitle: HTMLElement;
  private readonly missileListEl: HTMLElement;
  private readonly missileRows = new Map<string, MissileRowEntry>();
  private readonly missileListEmptyMessage: HTMLElement;
  private readonly missileScreenFrame: HTMLElement;

  private readonly armedLamp: HTMLElement;
  private readonly inFlightLamp: HTMLElement;
  private readonly emptyLamp: HTMLElement;
  private readonly magazineTubes: HTMLElement;
  private readonly armToggle: HTMLInputElement;

  private readonly decoyVisuals = new Map<string, ShipVisual>();
  private readonly decoyTubes: HTMLElement;
  private readonly decoyTitle: HTMLElement;
  private readonly decoyButton: HTMLButtonElement;
  private readonly decoyFeedback: HTMLElement;
  private readonly cutThrottleToggle: HTMLInputElement;
  private readonly decoyListEl: HTMLElement;
  private readonly decoyRows = new Map<string, DecoyRowEntry>();
  private readonly decoyListEmptyMessage: HTMLElement;
  private readonly decoyLamp: HTMLElement;

  private readonly pdcModeKeys = new Map<PdcMode, HTMLButtonElement>();
  private readonly pdcRows = new Map<string, PdcRowEntry>();
  private readonly pdcFeedback: HTMLElement;
  private readonly pdcLamp: HTMLElement;

  /** Piste commune à tous les postes : la cible désignée ici est aussi celle des autres postes. */
  private readonly selection: TrackSelection;
  /** Tir hors portée efficace demandé une première fois : un second appui dans le délai confirme. */
  private pendingOutOfRangeLaunch: { trackId: string; untilMs: number } | null = null;
  /** Largage sans poussée demandé une première fois (le leurre dériverait avec nous) : un second appui confirme. */
  private pendingDriftingDecoyUntilMs: number | null = null;

  constructor(world: SimulationWorld, playerBodyId: string, selection: TrackSelection) {
    this.world = world;
    const body = world.getBody(playerBodyId);
    if (!body) throw new Error(`Corps introuvable : ${playerBodyId}`);
    this.body = body;
    this.selection = selection;

    const shell = stationShell("03", "Tactique", "Armement · engagement · liaison missiles", "tactical-station");
    this.element = shell.root;
    this.armedLamp = lamp("Armé", "danger");
    this.inFlightLamp = lamp("Missile en vol", "info");
    this.emptyLamp = lamp("Magasin vide", "warning");
    this.decoyLamp = lamp("Leurre en vol", "info");
    this.pdcLamp = lamp("PDC en feu", "danger");
    shell.lamps.append(this.armedLamp, this.inFlightLamp, this.emptyLamp, this.decoyLamp, this.pdcLamp);

    const situation = screen("Situation tactique — zone d'engagement (portée radar)", "screen-main");
    shell.main.appendChild(situation.frame);
    this.scope = new SphereScope((id) => this.selectTrack(id));
    situation.glass.appendChild(this.scope.element);
    situation.glass.appendChild(el("div", "screen-caption", "La liaison transmet des estimations ; elle ne fait pas du missile un capteur"));
    const radar = body.sensors.find((s) => s.mode === "radar_active");
    this.scope.setRadius(radar ? radarRangeFor(radar, REFERENCE_CROSS_SECTION_M2, Math.PI) : 10000);
    this.ownShipVisual = new ShipVisual(0x4fd67a);
    this.ownShipVisual.addTo(this.scope.scene);
    this.friendlyVisuals = new FriendlyVisuals(this.scope.scene);

    const targetScreen = screen("Cible — pistes et fiche", "screen-grow");
    this.trackListView = new TrackListView((id) => this.selectTrack(id));
    this.contactSheetSlot = el("div");
    this.qualityReadout = el("div", "screen-line");
    targetScreen.glass.append(this.trackListView.element, this.qualityReadout, this.contactSheetSlot);
    // Missiles puis leurres dans la même liste : un troisième écran écraserait la colonne à 1280 × 720.
    const missileScreen = screen("Missiles et leurres lancés");
    // Replié tant que rien n'a été lancé : la place revient à la cible.
    this.missileScreenFrame = missileScreen.frame;
    this.missileListEl = el("div", "track-list");
    this.missileListEmptyMessage = el("p", "screen-line screen-line-dim", "Aucun missile lancé.");
    this.decoyListEl = this.missileListEl;
    this.decoyListEmptyMessage = el("p", "screen-line screen-line-dim", "Aucun leurre largué.");
    missileScreen.glass.appendChild(this.missileListEl);
    shell.side.append(targetScreen.frame, missileScreen.frame);

    // Les tubes disent l'état du magasin ; le compte figure dans l'intitulé du groupe.
    const magazineGroup = deckGroup("Magasin");
    this.magazineTitle = magazineGroup.firstElementChild as HTMLElement;
    this.magazineTubes = el("div", "magazine-rack");
    for (let i = 0; i < Math.max(body.missileCount, 1); i++) this.magazineTubes.appendChild(el("span", "magazine-tube"));
    magazineGroup.appendChild(this.magazineTubes);
    shell.deck.appendChild(magazineGroup);

    // Seulement pour une piste au gisement seul : le missile vise ce point le long du gisement.
    this.engagementGroup = deckGroup("Solution de tir");
    this.hypotheticalDistanceInput = lcdInput(String(Math.round(this.effectiveReachMeters() / 10000) * 10));
    this.hypotheticalDistanceInput.min = "1";
    this.engagementGroup.append(
      deckField("Distance supposée (km)", this.hypotheticalDistanceInput),
      el("p", "deck-note", "Piste au gisement seul : le missile vise ce point le long du gisement — jamais une mesure inventée."),
    );
    shell.deck.appendChild(this.engagementGroup);

    const fireGroup = deckGroup("Tir", "deck-group-fire");
    const arm = hwToggle("Armement");
    this.armToggle = arm.input;
    this.launchButton = hwKey("Lancer", "danger");
    this.launchButton.classList.add("hw-key-fire");
    this.launchButton.addEventListener("click", () => this.launch());
    this.launchFeedback = el("div", "deck-readout deck-readout-wrap hidden");
    const fireRow = el("div", "deck-row");
    fireRow.append(arm.wrapper, this.launchButton);
    fireGroup.append(fireRow, this.launchFeedback);
    shell.deck.appendChild(fireGroup);

    // Leurres (CONCEPTION_LEURRES.md §9) : un seul bouton ; le leurre reprend le vecteur de poussée actuel.
    const decoyGroup = deckGroup("Leurres");
    this.decoyTitle = decoyGroup.firstElementChild as HTMLElement;
    this.decoyTubes = el("div", "magazine-rack magazine-rack-decoy");
    for (let i = 0; i < Math.max(body.decoyCount, 1); i++) this.decoyTubes.appendChild(el("span", "magazine-tube"));
    const cutThrottle = hwToggle("Couper la poussée au largage");
    this.cutThrottleToggle = cutThrottle.input;
    this.cutThrottleToggle.checked = true;
    this.decoyButton = hwKey("Larguer", "accent");
    this.decoyButton.addEventListener("click", () => this.dropDecoy());
    this.decoyFeedback = el("div", "deck-readout deck-readout-wrap hidden");
    const decoyRow = el("div", "deck-row");
    decoyRow.append(cutThrottle.wrapper, this.decoyButton);
    decoyGroup.append(
      this.decoyTubes,
      decoyRow,
      el("p", "deck-note", "Le leurre reprend votre vecteur de poussée ; il n'imite rien si vous ne poussez pas."),
      this.decoyFeedback,
    );
    shell.deck.appendChild(decoyGroup);

    // Défense rapprochée (CONCEPTION_PDC.md §4) : mode, état et munitions de chaque tourelle.
    const pdcGroup = deckGroup("PDC");
    const modeRow = el("div", "deck-row pdc-mode-row");
    for (const mode of ["arret", "auto", "manuel"] as PdcMode[]) {
      const key = hwKey(PDC_MODE_LABELS[mode], mode === "arret" ? "warning" : "neutral");
      key.classList.add("hw-key-small");
      key.addEventListener("click", () => this.setPdcMode(mode));
      this.pdcModeKeys.set(mode, key);
      modeRow.appendChild(key);
    }
    pdcGroup.appendChild(modeRow);
    for (const mount of body.pdcMounts) {
      const line = el("div", "deck-readout deck-readout-wrap pdc-mount-line");
      pdcGroup.appendChild(line);
      const linkGeometry = new THREE.BufferGeometry();
      linkGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
      const link = new THREE.Line(linkGeometry, new THREE.LineDashedMaterial({ color: 0xff8a4a, dashSize: 25, gapSize: 15, transparent: true, opacity: 0.85 }));
      link.frustumCulled = false;
      link.visible = false;
      this.scope.scene.add(link);
      this.pdcRows.set(mount.id, { line, lastTrackId: null, lastShotSimTime: null, link, linkGeometry });
    }
    if (body.pdcMounts.length === 0) pdcGroup.appendChild(el("p", "deck-note", "Aucune tourelle à bord."));
    this.pdcFeedback = el("div", "deck-readout deck-readout-wrap hidden");
    pdcGroup.append(el("p", "deck-note", "Auto : missiles probables qui approchent. Manuel : la piste sélectionnée."), this.pdcFeedback);
    shell.deck.appendChild(pdcGroup);
  }

  private selectTrack(localId: string): void {
    this.selection.set(localId);
  }

  private launch(): void {
    if (refuseIfLocked(this.world)) return;
    const body = this.body;
    if (!this.armToggle.checked) {
      this.showFeedback("Armement non engagé.");
      return;
    }
    if (body.missileCount <= 0) {
      this.showFeedback("Aucun missile en réserve.");
      return;
    }
    const selectedTrackId = this.selection.current;
    if (!selectedTrackId) {
      this.showFeedback("Sélectionnez une piste avant de lancer.");
      return;
    }
    const track = body.knowledge.getTrack(selectedTrackId);
    if (track?.classification === "missile probable") {
      this.showFeedback("Piste classée « missile probable » : un missile ne peut atteindre qu'un vaisseau. Tir refusé.");
      return;
    }
    const reach = this.effectiveReachMeters();
    const distance = track?.positionEstimateWorld?.distanceTo(body.position);
    if (distance !== undefined && distance > reach) {
      const now = performance.now();
      const confirmed = this.pendingOutOfRangeLaunch?.trackId === selectedTrackId && now < this.pendingOutOfRangeLaunch.untilMs;
      if (!confirmed) {
        this.pendingOutOfRangeLaunch = { trackId: selectedTrackId, untilMs: now + 5000 };
        this.showFeedback(
          `Hors portée efficace : ${(distance / 1000).toFixed(0)} km pour ${(reach / 1000).toFixed(0)} km. Le missile volerait longtemps sans pouvoir corriger. Appuyez de nouveau sur Lancer pour confirmer.`,
        );
        return;
      }
    }
    this.pendingOutOfRangeLaunch = null;
    const hypotheticalDistance = Math.max(1, Number(this.hypotheticalDistanceInput.value) || this.effectiveReachMeters() / 1000) * 1000;
    const missile = this.world.launchPlayerMissile(selectedTrackId, hypotheticalDistance);
    if (!missile) {
      this.showFeedback("Lancement indisponible (piste introuvable).");
      return;
    }
    this.showFeedback(`${missile.id} lancé.`, false);
  }

  /** Distance que le missile embarqué couvre dans le temps de vol de référence de la doctrine du bord. */
  private effectiveReachMeters(): number {
    return missileReachMeters(this.body.missile, this.body.doctrine.maxMissileFlightSeconds);
  }

  private showFeedback(message: string, isWarning = true): void {
    this.launchFeedback.textContent = message;
    this.launchFeedback.classList.remove("hidden");
    this.launchFeedback.classList.toggle("deck-readout-alert", isWarning);
  }

  private abandonMissile(missile: Missile): void {
    if (refuseIfLocked(this.world)) return;
    missile.assignedTrackId = null;
  }

  /** Largage (ATTENDU_LEURRES.md) : refusé en pause (TIM-05) ; sans poussée, un second appui confirme. */
  private dropDecoy(): void {
    const body = this.body;
    if (commandsLocked(this.world)) {
      this.showDecoyFeedback("Simulation suspendue : aucun ordre accepté.");
      return;
    }
    if (!body.decoy || body.decoyCount <= 0) {
      this.showDecoyFeedback("Aucun leurre en réserve.");
      return;
    }
    if (body.principalThrottle <= 0) {
      const now = performance.now();
      if (this.pendingDriftingDecoyUntilMs === null || now > this.pendingDriftingDecoyUntilMs) {
        this.pendingDriftingDecoyUntilMs = now + 5000;
        this.showDecoyFeedback("Moteur principal coupé : le leurre dériverait avec vous sans rien imiter. Appuyez de nouveau sur Larguer pour confirmer.");
        return;
      }
    }
    this.pendingDriftingDecoyUntilMs = null;
    const decoy = this.world.launchPlayerDecoy();
    if (!decoy) {
      this.showDecoyFeedback("Largage indisponible.");
      return;
    }
    if (this.cutThrottleToggle.checked) body.command.throttle = 0;
    const imitation =
      decoy.imitatedAccelerationMps2 > 0 ? `imite ${(decoy.imitatedAccelerationMps2 / STANDARD_GRAVITY).toFixed(2)} G` : "en dérive avec le vaisseau";
    this.showDecoyFeedback(`${decoy.id} largué (${imitation})${this.cutThrottleToggle.checked ? " · poussée coupée" : ""}.`, false);
  }

  /** Mode des tourelles — refusé en pause (TIM-05) ; Manuel désigne la piste sélectionnée. */
  private setPdcMode(mode: PdcMode): void {
    const command = this.body.pdcCommand;
    if (commandsLocked(this.world)) {
      this.showPdcFeedback("Simulation suspendue : aucun ordre accepté.");
      return;
    }
    const selectedTrackId = this.selection.current;
    if (mode === "manuel") {
      if (!selectedTrackId) {
        this.showPdcFeedback("Sélectionnez la piste à prendre à partie.");
        return;
      }
      command.manualTrackId = selectedTrackId;
    }
    command.mode = mode;
    this.showPdcFeedback(mode === "manuel" ? `Manuel : tourelles sur ${selectedTrackId}.` : `Mode ${PDC_MODE_LABELS[mode]}.`, false);
  }

  private showPdcFeedback(message: string, isWarning = true): void {
    this.pdcFeedback.textContent = message;
    this.pdcFeedback.classList.remove("hidden");
    this.pdcFeedback.classList.toggle("deck-readout-alert", isWarning);
  }

  /**
   * État de chaque tourelle et, après un tir, ce que les capteurs en disent — jamais « abattu » :
   * une piste toujours mesurée après le tir a été manquée ; une piste qui ne l'est plus a peut-être
   * été détruite, ou simplement perdue.
   */
  private updatePdc(body: RigidBody): void {
    const now = this.world.simTimeSeconds;
    let anyFiring = false;
    for (const mount of body.pdcMounts) {
      const row = this.pdcRows.get(mount.id);
      if (!row) continue;
      if (mount.firing && mount.targetTrackId) {
        row.lastTrackId = mount.targetTrackId;
        row.lastShotSimTime = now;
      }
      anyFiring ||= mount.firing;
      const rounds = `${mount.roundsRemaining} obus`;
      let status: string;
      if (mount.roundsRemaining <= 0) status = "magasin vide";
      else if (body.pdcCommand.mode === "arret") status = "arrêt";
      else if (mount.targetTrackId && mount.retargetRemainingSeconds > 0) status = `pointage sur ${mount.targetTrackId}`;
      else if (mount.targetTrackId) status = `feu sur ${mount.targetTrackId}`;
      else status = "en veille";
      let result = "";
      if (row.lastTrackId && row.lastShotSimTime !== null && mount.targetTrackId !== row.lastTrackId) {
        const track = body.knowledge.getTrack(row.lastTrackId);
        const measuredAfter = track && track.lastObservationSimTime > row.lastShotSimTime;
        result = measuredAfter
          ? ` · ${row.lastTrackId} toujours mesurée après le tir`
          : ` · ${row.lastTrackId} plus mesurée depuis ${(now - row.lastShotSimTime).toFixed(0)} s`;
      }
      row.line.textContent = `${mount.id} · ${rounds} · ${status}${result}`;
      row.line.classList.toggle("deck-readout-alert", mount.firing);

      const track = mount.targetTrackId ? body.knowledge.getTrack(mount.targetTrackId) : undefined;
      row.link.visible = !!(mount.firing && track?.positionEstimateWorld);
      if (row.link.visible && track?.positionEstimateWorld) {
        const attribute = row.linkGeometry.getAttribute("position") as THREE.BufferAttribute;
        attribute.setXYZ(0, body.position.x, body.position.y, body.position.z);
        attribute.setXYZ(1, track.positionEstimateWorld.x, track.positionEstimateWorld.y, track.positionEstimateWorld.z);
        attribute.needsUpdate = true;
        row.link.computeLineDistances();
      }
    }
    for (const [mode, key] of this.pdcModeKeys) key.classList.toggle("is-active", body.pdcCommand.mode === mode);
    setLamp(this.pdcLamp, anyFiring);
  }

  private showDecoyFeedback(message: string, isWarning = true): void {
    this.decoyFeedback.textContent = message;
    this.decoyFeedback.classList.remove("hidden");
    this.decoyFeedback.classList.toggle("deck-readout-alert", isWarning);
  }

  private getOrCreateMissileVisual(missile: Missile): MissileVisualEntry {
    let entry = this.missileVisuals.get(missile.id);
    if (!entry) {
      const visual = new ShipVisual(0xffffff);
      visual.addTo(this.scope.scene);
      const linkGeometry = new THREE.BufferGeometry();
      linkGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
      const linkLine = new THREE.Line(
        linkGeometry,
        new THREE.LineDashedMaterial({ color: 0x55ddff, dashSize: 40, gapSize: 25, transparent: true, opacity: 0.7 }),
      );
      linkLine.frustumCulled = false;
      this.scope.scene.add(linkLine);
      entry = { visual, linkLine, linkGeometry };
      this.missileVisuals.set(missile.id, entry);
    }
    return entry;
  }

  private disposeMissileVisual(id: string): void {
    const entry = this.missileVisuals.get(id);
    if (!entry) return;
    entry.visual.dispose();
    this.scope.scene.remove(entry.linkLine);
    this.missileVisuals.delete(id);
  }

  update(_realDeltaSeconds: number): void {
    const body = this.body;

    this.ownShipVisual.update(body.position, body.attitude, body.velocity);
    this.ownShipVisual.setTrail(body.trail);
    this.ownShipVisual.setScale(this.scope.cameraDistance / 400);

    const seenTrackIds = new Set<string>();
    for (const track of body.knowledge.tracks) {
      seenTrackIds.add(track.localId);
      let visual = this.trackVisuals.get(track.localId);
      if (!visual) {
        visual = new TrackVisual();
        visual.addTo(this.scope.scene);
        this.trackVisuals.set(track.localId, visual);
      }
      visual.update(track, body.position, this.scope.radius);
    }
    for (const [id, visual] of this.trackVisuals) {
      if (!seenTrackIds.has(id)) {
        visual.dispose();
        this.trackVisuals.delete(id);
      }
    }

    const ownMissiles = this.world.missiles.filter((m) => m.ownerId === body.id && (m.state === "poussee" || m.state === "derive"));
    const seenMissileIds = new Set<string>();
    for (const missile of ownMissiles) {
      seenMissileIds.add(missile.id);
      const entry = this.getOrCreateMissileVisual(missile);
      const attitude =
        missile.velocity.lengthSq() > 1
          ? new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), missile.velocity.clone().normalize())
          : entry.visual.bodyMesh.quaternion; // quasi immobile : conserve la dernière orientation
      entry.visual.update(missile.position, attitude, missile.velocity);
      entry.visual.setTrail(missile.trail);
      entry.visual.setScale(this.scope.cameraDistance / 2000);

      const attribute = entry.linkGeometry.getAttribute("position") as THREE.BufferAttribute;
      attribute.setXYZ(0, body.position.x, body.position.y, body.position.z);
      attribute.setXYZ(1, missile.position.x, missile.position.y, missile.position.z);
      attribute.needsUpdate = true;
      entry.linkLine.computeLineDistances();
    }
    for (const [id] of this.missileVisuals) {
      if (!seenMissileIds.has(id)) this.disposeMissileVisual(id);
    }

    // Leurres propres : connus par liaison de données (télémétrie), jamais par une piste.
    const ownDecoys = this.world.decoys.filter((d) => d.ownerId === body.id && d.isActive);
    const seenDecoyIds = new Set<string>();
    for (const decoy of ownDecoys) {
      seenDecoyIds.add(decoy.id);
      let visual = this.decoyVisuals.get(decoy.id);
      if (!visual) {
        visual = new ShipVisual(DECOY_COLOR);
        visual.addTo(this.scope.scene);
        this.decoyVisuals.set(decoy.id, visual);
      }
      const attitude = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), decoy.thrustDirectionWorld);
      visual.update(decoy.position, attitude, decoy.velocity);
      visual.setTrail(decoy.trail);
      visual.setScale(this.scope.cameraDistance / 2000);
    }
    for (const [id, visual] of this.decoyVisuals) {
      if (!seenDecoyIds.has(id)) {
        visual.dispose();
        this.decoyVisuals.delete(id);
      }
    }

    this.friendlyVisuals.update(body.knowledge.friendlies, this.scope.cameraDistance / 400);
    const contacts: ScopeContact[] = [
      ...friendlyContacts(body.knowledge.friendlies, body.position),
      ...trackContacts(body.knowledge.tracks, body.position, this.scope.radius),
    ];
    for (const missile of ownMissiles) {
      contacts.push({
        id: missile.id,
        label: missile.id,
        worldPoint: missile.position.clone(),
        detail: `${(missile.position.distanceTo(body.position) / 1000).toFixed(1)} km · ${MISSILE_STATE_LABELS[missile.state]}`,
        tone: "missile",
        bearingOnly: false,
        selectable: false,
      });
    }
    for (const decoy of ownDecoys) {
      contacts.push({
        id: decoy.id,
        label: decoy.id,
        worldPoint: decoy.position.clone(),
        detail: `${(decoy.position.distanceTo(body.position) / 1000).toFixed(1)} km · leurre ${DECOY_STATE_LABELS[decoy.state]}`,
        tone: "decoy",
        bearingOnly: false,
        selectable: false,
      });
    }
    const selectedTrackId = this.selection.current;
    this.scope.setSelected(selectedTrackId);
    this.scope.render(body.position, contacts);

    this.trackListView.update(body.knowledge.tracks, selectedTrackId, this.world.simTimeSeconds);

    const selected = selectedTrackId ? body.knowledge.getTrack(selectedTrackId) : undefined;
    this.contactSheetSlot.replaceChildren(
      selected ? renderContactSheet(selected, this.world.simTimeSeconds, body, { compact: true }) : el("p", "screen-line screen-line-dim", "Sélectionnez une piste."),
    );
    this.engagementGroup.classList.toggle("hidden", !selected || !!selected.positionEstimateWorld);

    this.magazineTitle.textContent = `Magasin · ${body.missileCount}/${this.magazineTubes.children.length}`;
    [...this.magazineTubes.children].forEach((tube, i) => tube.classList.toggle("is-loaded", i < body.missileCount));
    const reachKm = this.effectiveReachMeters() / 1000;
    const selectedDistance = selected?.positionEstimateWorld?.distanceTo(body.position);
    this.qualityReadout.textContent = !selected
      ? `Portée efficace ${reachKm.toFixed(0)} km · estimation de réussite : indéterminée`
      : selected.classification === "missile probable"
        ? "Piste « missile probable » : hors des cibles d'un missile."
        : `Portée efficace ${reachKm.toFixed(0)} km${selectedDistance !== undefined ? ` · piste à ${(selectedDistance / 1000).toFixed(0)} km${selectedDistance > reachKm * 1000 ? " (hors portée)" : ""}` : ""} · réussite estimée : ${estimateEngagementQuality(selected, body.position, reachKm * 1000)} (jamais une garantie)`;
    this.launchButton.classList.toggle("is-armed", this.armToggle.checked && body.missileCount > 0 && !!selected && selected.classification !== "missile probable");
    setLamp(this.armedLamp, this.armToggle.checked);
    setLamp(this.inFlightLamp, this.world.missiles.some((m) => m.ownerId === body.id && (m.state === "poussee" || m.state === "derive")));
    setLamp(this.emptyLamp, body.missileCount === 0);

    this.decoyTitle.textContent = `Leurres · ${body.decoyCount}/${this.decoyTubes.children.length}`;
    [...this.decoyTubes.children].forEach((tube, i) => tube.classList.toggle("is-loaded", i < body.decoyCount));
    this.decoyButton.classList.toggle("is-armed", body.decoyCount > 0);
    setLamp(this.decoyLamp, ownDecoys.length > 0);

    this.updateMissileList(body);
    this.updateDecoyList(body);
    this.missileScreenFrame.classList.toggle("hidden", this.missileRows.size === 0 && this.decoyRows.size === 0);
    this.updatePdc(body);
  }

  /** Télémétrie des leurres propres — lignes créées une fois et mises à jour en place. */
  private updateDecoyList(body: RigidBody): void {
    const ownDecoysAll = this.world.decoys.filter((d) => d.ownerId === body.id);
    const seen = new Set<string>();
    for (const decoy of ownDecoysAll) {
      seen.add(decoy.id);
      let entry = this.decoyRows.get(decoy.id);
      if (!entry) {
        const row = el("div", "track-row");
        const idEl = el("span", "track-row-id");
        const stateEl = el("span", "track-row-state");
        const reserveEl = el("span", "track-row-age");
        row.append(idEl, stateEl, reserveEl);
        const imitationRow = el("div", "contact-row");
        const imitationEl = el("span", "contact-row-value");
        imitationRow.append(el("span", "contact-row-label", "Accélération imitée"), imitationEl);
        const emitterRow = el("div", "contact-row");
        const emitterEl = el("span", "contact-row-value");
        emitterRow.append(el("span", "contact-row-label", "Générateur IR"), emitterEl);
        const wrapper = el("div", "missile-card decoy-card");
        wrapper.append(row, imitationRow, emitterRow);
        entry = { wrapper, idEl, stateEl, reserveEl, imitationEl, emitterEl };
        this.decoyRows.set(decoy.id, entry);
      }
      const reservePercent = decoy.def.reservoir.capacityKg > 0 ? (decoy.reservoir.quantityKg / decoy.def.reservoir.capacityKg) * 100 : 0;
      entry.idEl.textContent = decoy.id;
      entry.stateEl.textContent = DECOY_STATE_LABELS[decoy.state];
      entry.reserveEl.textContent = `${reservePercent.toFixed(0)} %`;
      entry.imitationEl.textContent =
        decoy.imitatedAccelerationMps2 > 0 ? `${(decoy.imitatedAccelerationMps2 / STANDARD_GRAVITY).toFixed(2)} G · ${decoy.velocity.length().toFixed(0)} m/s` : "aucune (dérive)";
      const emitter = decoy.def.irEmitter;
      entry.emitterEl.textContent = !emitter
        ? "aucun"
        : `${((decoy.emitterChargeKg / Math.max(emitter.chargeKg, 1e-9)) * 100).toFixed(0)} % de charge${decoy.lastEmitterWattsPerSr > 0 ? " · actif" : ""}`;
      this.decoyListEl.appendChild(entry.wrapper);
    }
    for (const [id, entry] of this.decoyRows) {
      if (!seen.has(id)) {
        entry.wrapper.remove();
        this.decoyRows.delete(id);
      }
    }
    if (ownDecoysAll.length === 0) this.decoyListEl.appendChild(this.decoyListEmptyMessage);
    else this.decoyListEmptyMessage.remove();
  }

  /** Lignes créées une fois et mises à jour en place — même raison que TrackListView (clics fiables). */
  private updateMissileList(body: RigidBody): void {
    const ownMissilesAll = this.world.missiles.filter((m) => m.ownerId === body.id);
    const seen = new Set<string>();

    for (const missile of ownMissilesAll) {
      seen.add(missile.id);
      let entry = this.missileRows.get(missile.id);
      if (!entry) {
        const row = el("div", "track-row");
        const idEl = el("span", "track-row-id");
        const stateEl = el("span", "track-row-state");
        const reserveEl = el("span", "track-row-age");
        row.append(idEl, stateEl, reserveEl);
        const speedRow = el("div", "contact-row");
        const speedEl = el("span", "contact-row-value");
        speedRow.append(el("span", "contact-row-label", "Vitesse"), speedEl);
        const detailRow = el("div", "contact-row");
        const etaEl = el("span", "contact-row-value");
        detailRow.append(el("span", "contact-row-label", "Temps avant impact"), etaEl);
        const abandonBtn = hwKey("Abandonner", "warning");
        abandonBtn.classList.add("hw-key-small");
        abandonBtn.addEventListener("click", () => this.abandonMissile(missile));
        const wrapper = el("div", "missile-card");
        wrapper.append(row, speedRow, detailRow, abandonBtn);
        entry = { wrapper, idEl, stateEl, reserveEl, speedEl, etaEl, abandonBtn };
        this.missileRows.set(missile.id, entry);
      }

      const target = resolveGuidanceTarget(missile, body);
      const reservePercent = (missile.reservoir.quantityKg / missile.reservoir.capacityKg) * 100;
      entry.idEl.textContent = `${missile.id} → ${missile.assignedTrackId ?? "—"}`;
      entry.stateEl.textContent = MISSILE_STATE_LABELS[missile.state];
      entry.reserveEl.textContent = `${reservePercent.toFixed(0)} %`;
      entry.speedEl.textContent = `${missile.velocity.length().toFixed(0)} m/s`;
      entry.etaEl.textContent = this.estimateTimeToImpact(missile, target);
      entry.abandonBtn.disabled = missile.state !== "poussee" && missile.state !== "derive";
      this.missileListEl.appendChild(entry.wrapper);
    }

    for (const [id, entry] of this.missileRows) {
      if (!seen.has(id)) {
        entry.wrapper.remove();
        this.missileRows.delete(id);
      }
    }

    if (ownMissilesAll.length === 0) {
      this.missileListEl.appendChild(this.missileListEmptyMessage);
    } else {
      this.missileListEmptyMessage.remove();
    }
  }

  private estimateTimeToImpact(missile: Missile, target: THREE.Vector3 | null): string {
    if (!target) return "indéterminé";
    const offset = target.clone().sub(missile.position);
    const distance = offset.length();
    if (distance < 1) return "≈ 0 s";
    const closingSpeed = missile.velocity.dot(offset.normalize());
    if (closingSpeed <= 1e-3) return "indéterminé";
    return `${(distance / closingSpeed).toFixed(0)} s`;
  }

  resize(): void {
    this.scope.resize();
  }

  dispose(): void {
    this.scope.dispose();
    this.element.remove();
  }
}
