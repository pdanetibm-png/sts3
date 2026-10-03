import * as THREE from "three";
import { frameSeconds, radarRangeFor } from "../../sim/sensorPhysics";
import { REFERENCE_CROSS_SECTION_M2 } from "../../sim/signature";
import type { RigidBody } from "../../sim/rigidBody";
import type { SensorMode } from "../../sim/types";
import type { SimulationWorld } from "../../sim/world";
import { renderContactSheet, TrackListView } from "./contactSheet";
import { el } from "../dom";
import { ScanConeVisual } from "../render/scanCone";
import { ShipVisual } from "../render/shipMesh";
import { FriendlyVisuals } from "../render/friendlyVisuals";
import { friendlyContacts, SphereScope, trackContacts } from "../render/sphereScope";
import { TrackVisual } from "../render/trackVisual";
import { deckField, deckGroup, hwKey, hwToggle, lamp, lcdInput, screen, setLamp, stationShell } from "../station/stationKit";
import type { ConsolePanel } from "./consoleTypes";
import { commandsLocked, refuseIfLocked } from "../commandGuard";
import { sensorUnpowered } from "../../sim/power";
import type { TrackSelection } from "../trackSelection";

const WIDE_SCAN_HALF_ANGLE_RAD = THREE.MathUtils.degToRad(80);

const MODE_LABELS: Record<SensorMode, string> = {
  ir_passive: "IR passif",
  radar_passive: "Écoute radar passive",
  radar_active: "Radar actif",
};

/** Poste Détection (section 8.3) : IR/écoute passive/radar actif, pistes, fiche partagée. */
export class DetectionConsole implements ConsolePanel {
  readonly element: HTMLElement;

  private readonly world: SimulationWorld;
  private readonly body: RigidBody;
  private readonly scope: SphereScope;
  private readonly ownShipVisual: ShipVisual;
  private readonly friendlyVisuals: FriendlyVisuals;
  private readonly trackVisuals = new Map<string, TrackVisual>();

  private readonly sensorRows = new Map<string, { checkbox: HTMLInputElement; modeLabel: HTMLElement; cycleReadout: HTMLElement }>();
  private readonly radarLamp: HTMLElement;
  private readonly contactLamp: HTMLElement;
  private readonly lostLamp: HTMLElement;
  private readonly scanCone: ScanConeVisual;
  private readonly radarWideBtn: HTMLButtonElement;
  private readonly radarSectorBtn: HTMLButtonElement;
  private readonly radarHeadingInput: HTMLInputElement;
  private readonly radarPitchInput: HTMLInputElement;
  private readonly radarWidthInput: HTMLInputElement;
  private readonly followToggle: HTMLInputElement;
  private readonly radarSectorRow: HTMLElement;

  private readonly trackListView: TrackListView;
  private readonly contactSheetSlot: HTMLElement;

  /** Piste commune à tous les postes (affichage et fiche). */
  private readonly selection: TrackSelection;
  /**
   * Piste que le Suivi doit tenir : celle choisie dans CE poste, ou la sélection commune au moment
   * où l'on enclenche le Suivi. Choisir une piste dans un autre poste ne redirige jamais le radar.
   */
  private followTargetId: string | null = null;
  private radarSectorMode = false;

  constructor(world: SimulationWorld, playerBodyId: string, selection: TrackSelection) {
    this.world = world;
    const body = world.getBody(playerBodyId);
    if (!body) throw new Error(`Corps introuvable : ${playerBodyId}`);
    this.body = body;
    this.selection = selection;

    const shell = stationShell("02", "Détection", "Capteurs · pistes · contacts", "detection-station");
    this.element = shell.root;
    this.radarLamp = lamp("Radar émet", "warning");
    this.contactLamp = lamp("Contact", "info");
    this.lostLamp = lamp("Contact perdu", "warning");
    shell.lamps.append(this.radarLamp, this.contactLamp, this.lostLamp);

    const scopeScreen = screen("Scope — zone d'engagement (portée radar)", "screen-main");
    shell.main.appendChild(scopeScreen.frame);
    this.scope = new SphereScope((id) => this.selectTrack(id));
    scopeScreen.glass.appendChild(this.scope.element);

    const radarSensor = body.sensors.find((s) => s.mode === "radar_active");
    // Zone d'engagement : portée du radar en balayage large contre une cible de référence.
    this.scope.setRadius(radarSensor ? radarRangeFor(radarSensor, REFERENCE_CROSS_SECTION_M2, Math.PI) : 10000);
    this.ownShipVisual = new ShipVisual(0x4fd67a);
    this.ownShipVisual.addTo(this.scope.scene);
    this.friendlyVisuals = new FriendlyVisuals(this.scope.scene);
    this.scanCone = new ScanConeVisual();
    this.scanCone.addTo(this.scope.scene);

    const tracksScreen = screen("Pistes");
    this.trackListView = new TrackListView((id) => this.selectTrack(id));
    tracksScreen.glass.appendChild(this.trackListView.element);
    const contactScreen = screen("Fiche de contact", "screen-grow");
    this.contactSheetSlot = el("div");
    contactScreen.glass.appendChild(this.contactSheetSlot);
    shell.side.append(tracksScreen.frame, contactScreen.frame);

    const sensorGroup = deckGroup("Capteurs");
    const sensorRow = el("div", "deck-row deck-row-top");
    for (const sensor of body.sensors) {
      const toggle = hwToggle(MODE_LABELS[sensor.mode]);
      const checkbox = toggle.input;
      checkbox.addEventListener("change", () => {
        const state = body.sensorStates.get(sensor.id);
        if (state && !refuseIfLocked(this.world)) state.enabled = checkbox.checked;
        this.updateSensorAvailability();
      });
      const cycleReadout = el("div", "deck-readout", "arrêt");
      const cell = el("div", "deck-stack");
      cell.append(toggle.wrapper, cycleReadout);
      sensorRow.appendChild(cell);
      this.sensorRows.set(sensor.id, { checkbox, modeLabel: toggle.wrapper, cycleReadout });
    }
    sensorGroup.appendChild(sensorRow);
    shell.deck.appendChild(sensorGroup);

    const radarGroup = deckGroup("Radar actif — balayage");
    this.radarWideBtn = hwKey("Large");
    this.radarWideBtn.classList.add("is-active");
    this.radarSectorBtn = hwKey("Secteur");
    this.radarWideBtn.addEventListener("click", () => this.setRadarSectorMode(false));
    this.radarSectorBtn.addEventListener("click", () => this.setRadarSectorMode(true));
    const modeRow = el("div", "deck-row");
    modeRow.append(this.radarWideBtn, this.radarSectorBtn);

    this.radarHeadingInput = lcdInput("0");
    this.radarPitchInput = lcdInput("0");
    this.radarWidthInput = lcdInput("15");
    this.radarWidthInput.min = "1";
    this.radarWidthInput.max = "90";
    this.radarSectorRow = el("div", "deck-row");
    this.radarSectorRow.append(
      deckField("Cap °", this.radarHeadingInput),
      deckField("Incl. °", this.radarPitchInput),
      deckField("½ larg. °", this.radarWidthInput),
    );
    const applyBtn = hwKey("Appliquer", "accent");
    applyBtn.addEventListener("click", () => this.applyRadarSector());
    this.radarSectorRow.appendChild(applyBtn);
    radarGroup.append(modeRow, this.radarSectorRow);
    shell.deck.appendChild(radarGroup);

    const followGroup = deckGroup("Suivi");
    const follow = hwToggle("Suivi piste");
    this.followToggle = follow.input;
    // Consigne persistante côté simulation (sim/detection.ts) — continue même en quittant ce poste.
    this.followToggle.addEventListener("change", () => {
      if (refuseIfLocked(this.world)) {
        this.followToggle.checked = !this.followToggle.checked;
        return;
      }
      if (this.followToggle.checked) this.followTargetId = this.selection.current;
      this.syncFollowedTrack();
    });
    followGroup.append(follow.wrapper, el("p", "deck-note", "Recentre le radar sur la piste choisie à l'écran, secteur ajusté à son incertitude."));
    shell.deck.appendChild(followGroup);

    // Les champs du secteur n'ont de sens qu'en mode Secteur : masqués en balayage large.
    this.radarSectorRow.classList.add("hidden");
    this.updateSensorAvailability();
  }

  private setRadarSectorMode(sector: boolean): void {
    if (refuseIfLocked(this.world)) return;
    this.radarSectorMode = sector;
    this.radarWideBtn.classList.toggle("is-active", !sector);
    this.radarSectorBtn.classList.toggle("is-active", sector);
    this.radarSectorRow.classList.toggle("hidden", !sector);
    this.applyRadarSector();
  }

  private applyRadarSector(): void {
    if (refuseIfLocked(this.world)) return;
    const radarSensor = this.body.sensors.find((s) => s.mode === "radar_active");
    if (!radarSensor) return;
    const state = this.body.sensorStates.get(radarSensor.id);
    if (!state) return;

    if (!this.radarSectorMode) {
      state.scanHalfAngleRad = Math.PI;
      return;
    }
    const headingDeg = Number(this.radarHeadingInput.value) || 0;
    const pitchDeg = Math.max(-90, Math.min(90, Number(this.radarPitchInput.value) || 0));
    const widthDeg = Math.max(1, Math.min(90, Number(this.radarWidthInput.value) || 15));
    const heading = THREE.MathUtils.degToRad(headingDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    state.scanDirectionWorld = new THREE.Vector3(Math.cos(pitch) * Math.sin(heading), Math.sin(pitch), Math.cos(pitch) * Math.cos(heading));
    state.scanHalfAngleRad = THREE.MathUtils.degToRad(widthDeg);
  }

  private updateSensorAvailability(): void {
    for (const sensor of this.body.sensors) {
      const state = this.body.sensorStates.get(sensor.id);
      const row = this.sensorRows.get(sensor.id);
      if (state && row) row.checkbox.checked = state.enabled;
    }
  }

  private selectTrack(localId: string): void {
    this.selection.set(localId);
    this.followTargetId = localId;
    this.syncFollowedTrack();
  }

  /** Écrit la consigne de suivi dans l'état persistant du capteur (lu par sim/detection.ts). */
  private syncFollowedTrack(): void {
    const radarSensor = this.body.sensors.find((s) => s.mode === "radar_active");
    const radarState = radarSensor ? this.body.sensorStates.get(radarSensor.id) : undefined;
    if (!radarState) return;
    // En pause, sélectionner une piste reste une inspection : la consigne de suivi ne change pas.
    if (commandsLocked(this.world)) return;
    radarState.followedTrackId = this.followToggle.checked ? this.followTargetId : null;
    if (!this.followToggle.checked) this.applyRadarSector();
  }

  update(_realDeltaSeconds: number): void {
    const body = this.body;

    const radarSensor = body.sensors.find((s) => s.mode === "radar_active");
    const radarState = radarSensor ? body.sensorStates.get(radarSensor.id) : undefined;

    // Le suivi lui-même tourne dans sim/detection.ts (persistant entre changements de poste) —
    // cette console ne fait que garder la consigne synchronisée sur la piste sélectionnée.
    if (this.followToggle.checked) this.syncFollowedTrack();
    this.radarWidthInput.disabled = this.followToggle.checked;

    this.ownShipVisual.update(body.position, body.attitude, body.velocity);
    this.ownShipVisual.setTrail(body.trail);
    this.ownShipVisual.setScale(this.scope.cameraDistance / 400);

    const radarOn = !!(radarSensor && radarState?.enabled);
    const wideScan = radarOn && radarState!.scanHalfAngleRad > WIDE_SCAN_HALF_ANGLE_RAD;
    if (radarOn && !wideScan) {
      this.scanCone.update(body.position, radarState!.scanDirectionWorld, radarState!.scanHalfAngleRad, radarRangeFor(radarSensor!, REFERENCE_CROSS_SECTION_M2, radarState!.scanHalfAngleRad));
    } else {
      this.scanCone.hide();
    }
    this.scope.setShellEmitting(wideScan);

    for (const sensor of body.sensors) {
      const rowEntry = this.sensorRows.get(sensor.id);
      const state = body.sensorStates.get(sensor.id);
      if (!rowEntry || !state) continue;
      rowEntry.checkbox.checked = state.enabled;
      if (!state.enabled) {
        rowEntry.cycleReadout.textContent = "arrêt";
        continue;
      }
      if (sensorUnpowered(body, sensor.id)) {
        rowEntry.cycleReadout.textContent = "puissance insuffisante";
        continue;
      }
      const cycleDuration = frameSeconds(sensor, state.scanHalfAngleRad);
      const remaining = Math.max(0, cycleDuration - state.cycleElapsedSeconds);
      rowEntry.cycleReadout.textContent = `mesure dans ${remaining.toFixed(1)} s`;
    }

    const seenIds = new Set<string>();
    for (const track of body.knowledge.tracks) {
      seenIds.add(track.localId);
      let visual = this.trackVisuals.get(track.localId);
      if (!visual) {
        visual = new TrackVisual();
        visual.addTo(this.scope.scene);
        this.trackVisuals.set(track.localId, visual);
      }
      visual.update(track, body.position, this.scope.radius);
    }
    for (const [id, visual] of this.trackVisuals) {
      if (!seenIds.has(id)) {
        visual.dispose();
        this.trackVisuals.delete(id);
      }
    }

    const selectedTrackId = this.selection.current;
    this.scope.setSelected(selectedTrackId);
    this.friendlyVisuals.update(body.knowledge.friendlies, this.scope.cameraDistance / 400);
    this.scope.render(body.position, [
      ...friendlyContacts(body.knowledge.friendlies, body.position),
      ...trackContacts(body.knowledge.tracks, body.position, this.scope.radius),
    ]);

    this.trackListView.update(body.knowledge.tracks, selectedTrackId, this.world.simTimeSeconds);

    const selected = selectedTrackId ? body.knowledge.getTrack(selectedTrackId) : undefined;
    this.contactSheetSlot.replaceChildren(
      selected ? renderContactSheet(selected, this.world.simTimeSeconds, body) : el("p", "screen-line screen-line-dim", "Sélectionnez une piste."),
    );

    const tracks = body.knowledge.tracks;
    setLamp(this.radarLamp, !!radarState?.enabled);
    setLamp(this.contactLamp, tracks.some((t) => t.state !== "lost"));
    setLamp(this.lostLamp, tracks.some((t) => t.state === "lost"));
  }

  resize(): void {
    this.scope.resize();
  }

  dispose(): void {
    this.scope.dispose();
    this.element.remove();
  }
}
