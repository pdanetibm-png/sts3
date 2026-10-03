import { Quaternion, Vector3 } from "three";
import type { Track } from "../../knowledge/types";
import { NAV_MODE_LABELS } from "../../sim/navigation";
import type { PdcMode } from "../../sim/pdc";
import { sensorUnpowered } from "../../sim/power";
import type { RigidBody } from "../../sim/rigidBody";
import type { SimulationWorld } from "../../sim/world";
import type { ConsoleId } from "../appState";
import { el } from "../dom";
import { AXIS_Y, buildCutawaySvg, isPost, type CutawaySpec, type EngineKind, type PostId, type RoomId } from "./cutawayArt";
import type { ConsolePanel } from "./consoleTypes";

type RoomStatus = "ok" | "info" | "warn" | "alert" | "idle";

const G0 = 9.80665;
/** Au-delà, le moteur principal est dessiné comme une propulsion à fusion (affichage seulement). */
const FUSION_ISP_SECONDS = 5000;
const PDC_MODE_LABELS: Record<PdcMode, string> = { arret: "ARRÊT", auto: "AUTO", manuel: "MANUEL" };
const SERVICE_ROOMS: RoomId[] = ["sas", "quartiers", "carre", "infirmerie"];
const BEAM_RADIUS = 150;
/** Demi-angle au-delà duquel le balayage est montré comme une antenne tournante. */
const OMNI_SCAN_DEG = 150;
const OMNI_ROTATION_DEG_PER_S = 90;
const OMNI_BEAM_HALF_DEG = 16;

interface PdcGun {
  turret: SVGGElement;
  gun: SVGGElement;
  cx: number;
  cy: number;
  side: 1 | -1;
  angle: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Rapproche linéairement, sans passer par l'autre demi-plan (tourelles). */
function approachLinear(current: number, target: number, maxStep: number): number {
  return current + clamp(target - current, -maxStep, maxStep);
}

/** Rapproche par le plus court chemin angulaire (antenne radar). */
function approachShortest(current: number, target: number, maxStep: number): number {
  const diff = ((((target - current) % 360) + 540) % 360) - 180;
  return current + clamp(diff, -maxStep, maxStep);
}

/** Direction estimée d'une piste depuis le vaisseau : position si connue, sinon gisement. */
function trackDirection(track: Track, body: RigidBody): Vector3 {
  return track.positionEstimateWorld ? track.positionEstimateWorld.clone().sub(body.position) : track.bearingEstimateWorld.clone();
}

/**
 * Vue vaisseau (section 8.1) : coupe longitudinale, un compartiment cliquable par poste, plus les
 * espaces du bord. Les éléments animés ne reflètent que l'état propre du vaisseau joueur et sa
 * connaissance (pistes, cibles des tourelles), jamais la vérité sur les autres objets.
 */
export class CrossSectionConsole implements ConsolePanel {
  readonly element: HTMLElement;
  private readonly world: SimulationWorld;
  private readonly body: RigidBody | undefined;
  private readonly svg: SVGSVGElement;
  private readonly rooms = new Map<RoomId, { group: SVGGElement; status: SVGTextElement | null }>();
  private readonly equipment = new Map<string, { group: SVGGElement; status: SVGTextElement }>();
  private readonly plume: SVGGElement | null;
  private readonly plumeX: number;
  private readonly engineCore: SVGElement | null;
  private readonly bellHeat: SVGElement[];
  private readonly hullHeat: SVGElement | null;
  private readonly reactorCore: SVGElement | null;
  private readonly batteryCells: SVGRectElement[];
  private readonly propFill: SVGRectElement | null;
  private readonly propSurface: SVGGElement | null;
  private readonly missiles: SVGGElement[];
  private readonly tacLamps: SVGElement[];
  private readonly decoys: SVGGElement[];
  private readonly missileHatch: SVGGElement | null;
  private readonly decoyHatch: SVGGElement | null;
  private readonly pdcGuns: PdcGun[];
  private readonly pdcAmmo: SVGRectElement[];
  private readonly radarAntenna: SVGGElement | null;
  private readonly radarBeam: SVGGElement | null;
  private readonly beamWedge: SVGPathElement | null;
  private readonly beamPulses: SVGPathElement[];
  private readonly radarPivot: [number, number];
  private readonly irGroup: SVGGElement | null;
  private readonly esmGroup: SVGGElement | null;
  private readonly rcsPuffs: { el: SVGElement; cluster: string; kind: string }[];
  private readonly scopeSweep: SVGGElement | null;
  private readonly scope: { cx: number; cy: number; r: number };
  private readonly blips: SVGCircleElement[];
  private readonly footLines: SVGTextElement[];
  private readonly missileCapacity: number;
  private readonly decoyCapacity: number;
  private readonly engineKind: EngineKind;
  private readonly rcsTorqueScale: number;
  private readonly invAttitude = new Quaternion();
  private readonly scratch = new Vector3();
  private radarAngle = -90;
  private shownThrottle = 0;
  private bellHeatLevel = 0;
  private scopeAngle = 0;
  private lastMissileCount: number;
  private lastDecoyCount: number;
  private missileHatchUntil = 0;
  private decoyHatchUntil = 0;
  private lastUpdateNow = 0;

  constructor(world: SimulationWorld, playerBodyId: string, onOpenConsole: (id: ConsoleId) => void) {
    this.world = world;
    const body = world.getBody(playerBodyId);
    this.body = body;
    const shipDef = world.scenario.ships.find((s) => s.id === playerBodyId);
    this.missileCapacity = Math.max(body?.missileCount ?? 0, shipDef?.missileCount ?? 0);
    this.decoyCapacity = Math.max(body?.decoyCount ?? 0, shipDef?.decoyCount ?? 0);
    this.lastMissileCount = body?.missileCount ?? 0;
    this.lastDecoyCount = body?.decoyCount ?? 0;
    const principal = body?.thrusters.find((t) => t.kind === "principal");
    this.engineKind = principal && principal.specificImpulseSeconds >= FUSION_ISP_SECONDS ? "fusion" : "thermique";
    const rcs = body?.thrusters.filter((t) => t.kind === "rcs") ?? [];
    this.rcsTorqueScale = Math.max(1, rcs.reduce((sum, t) => sum + t.maxThrustNewtons * Math.hypot(...t.localPosition), 0) / 4);

    const spec: CutawaySpec = {
      shipName: body?.name ?? "Vaisseau",
      designName: body?.designName,
      engineKind: this.engineKind,
      missileSlots: this.missileCapacity,
      decoySlots: this.decoyCapacity,
      pdcMountCount: body?.pdcMounts.length ?? 0,
      hasRadar: !!body?.sensors.some((s) => s.mode === "radar_active"),
      hasIr: !!body?.sensors.some((s) => s.mode === "ir_passive"),
      hasEsm: !!body?.sensors.some((s) => s.mode === "radar_passive"),
    };

    this.element = el("div", "console cross-section-console");
    const stage = el("div", "cutaway-stage");
    stage.innerHTML = buildCutawaySvg(spec);
    this.element.appendChild(stage);
    const svg = stage.querySelector("svg")!;
    this.svg = svg;

    for (const group of svg.querySelectorAll<SVGGElement>(".room")) {
      const id = group.dataset.room as RoomId;
      this.rooms.set(id, { group, status: group.querySelector(".room-status") });
      if (!isPost(id)) continue;
      group.addEventListener("click", () => onOpenConsole(id));
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenConsole(id);
        }
      });
    }
    for (const group of svg.querySelectorAll<SVGGElement>(".eqlabel")) {
      this.equipment.set(group.dataset.eq!, { group, status: group.querySelector(".eq-status")! });
    }

    this.plume = svg.querySelector(".lv-plume");
    this.plumeX = Number(this.plume?.dataset.x ?? 0);
    this.engineCore = svg.querySelector(".lv-engine-core");
    this.bellHeat = [...svg.querySelectorAll<SVGElement>(".lv-bell-heat")];
    this.hullHeat = svg.querySelector(".lv-hull-heat");
    this.reactorCore = svg.querySelector(".lv-reactor-core");
    this.batteryCells = [...svg.querySelectorAll<SVGRectElement>(".lv-battery-cell")];
    this.propFill = svg.querySelector(".lv-prop-fill");
    this.propSurface = svg.querySelector(".lv-prop-surface");
    this.missiles = [...svg.querySelectorAll<SVGGElement>(".lv-missile")];
    this.tacLamps = [...svg.querySelectorAll<SVGElement>(".lv-tac-lamp")];
    this.decoys = [...svg.querySelectorAll<SVGGElement>(".lv-decoy")];
    this.missileHatch = svg.querySelector(".lv-missile-hatch");
    this.decoyHatch = svg.querySelector(".lv-decoy-hatch");
    this.pdcGuns = [...svg.querySelectorAll<SVGGElement>(".pdc")].map((turret) => {
      const gun = turret.querySelector<SVGGElement>(".lv-pdc-gun")!;
      const side: 1 | -1 = turret.dataset.mount === "0" ? 1 : -1;
      return { turret, gun, cx: Number(gun.dataset.cx), cy: Number(gun.dataset.cy), side, angle: side > 0 ? -145 : 145 };
    });
    this.pdcAmmo = [...svg.querySelectorAll<SVGRectElement>(".lv-pdc-ammo")];
    this.radarAntenna = svg.querySelector(".lv-radar-antenna");
    this.radarPivot = [Number(this.radarAntenna?.dataset.cx ?? 0), Number(this.radarAntenna?.dataset.cy ?? 0)];
    this.radarBeam = svg.querySelector(".lv-radar-beam");
    this.beamWedge = svg.querySelector(".beam-wedge");
    this.beamPulses = [...svg.querySelectorAll<SVGPathElement>(".beam-pulse")];
    this.irGroup = svg.querySelector(".lv-ir");
    this.esmGroup = svg.querySelector(".lv-esm");
    this.rcsPuffs = [...svg.querySelectorAll<SVGElement>(".lv-rcs")].map((puff) => ({ el: puff, cluster: puff.dataset.cluster!, kind: puff.dataset.kind! }));
    this.scopeSweep = svg.querySelector(".lv-scope-sweep");
    const scope = svg.querySelector<SVGGElement>(".scope");
    this.scope = { cx: Number(scope?.dataset.cx ?? 0), cy: Number(scope?.dataset.cy ?? 0), r: Number(scope?.dataset.r ?? 1) };
    this.blips = [...svg.querySelectorAll<SVGCircleElement>(".blip")];
    this.footLines = [...svg.querySelectorAll<SVGTextElement>(".lv-foot")];
  }

  update(realDeltaSeconds: number): void {
    const body = this.body;
    if (!body) return;
    const now = performance.now() / 1000;
    this.invAttitude.copy(body.attitude).invert();
    const shed = body.lastPowerStep?.shedConsumerIds ?? [];

    this.updatePropulsion(body, realDeltaSeconds);
    this.updatePower(body, now);
    this.updateStores(body, now);
    this.updatePdc(body, realDeltaSeconds);
    this.updateSensors(body, realDeltaSeconds, now);
    this.updateRcs(body);

    const lifeShed = shed.some((id) => body.consumers.find((c) => c.id === id)?.priorityGroup === "vie");
    const servicesShed = shed.some((id) => body.consumers.find((c) => c.id === id)?.priorityGroup === "services");
    this.svg.dataset.secours = lifeShed || body.lifeSupportFailed ? "1" : "0";
    this.svg.dataset.vie = !lifeShed && !body.lifeSupportFailed ? "on" : "off";
    this.svg.dataset.crew = body.crewExposureIncapacitated ? "ko" : "ok";
    this.svg.dataset.battle = body.knowledge.tracks.some((t) => t.state !== "lost" && t.classification === "missile probable") ? "1" : "0";

    for (const [id, room] of this.rooms) {
      const { status, text } = isPost(id) ? this.postStatus(id, body) : this.secondaryStatus(id, body);
      room.group.dataset.status = status;
      room.group.dataset.power = servicesShed && SERVICE_ROOMS.includes(id) ? "off" : "on";
      if (room.status) room.status.textContent = text;
    }
    this.updateFooter(body);
  }

  private updatePropulsion(body: RigidBody, dt: number): void {
    const principalIndex = body.thrusters.findIndex((t) => t.kind === "principal");
    const throttle = principalIndex >= 0 ? (body.lastAllocation?.perThrusterThrottle[principalIndex] ?? 0) : 0;
    this.shownThrottle += (throttle - this.shownThrottle) * Math.min(1, dt * 6);
    const t = this.shownThrottle;
    if (this.plume) {
      this.plume.setAttribute("opacity", t > 0.005 ? (0.35 + 0.65 * t).toFixed(3) : "0");
      this.plume.setAttribute("transform", `translate(${this.plumeX},${AXIS_Y}) scale(${(0.3 + 0.7 * t).toFixed(3)},${(0.5 + 0.5 * t).toFixed(3)})`);
    }
    this.engineCore?.setAttribute("opacity", (0.12 + 0.88 * t).toFixed(3));
    this.bellHeatLevel += (t - this.bellHeatLevel) * Math.min(1, dt * 0.8);
    for (const heat of this.bellHeat) heat.setAttribute("opacity", (0.85 * this.bellHeatLevel).toFixed(3));
    this.svg.dataset.thrust = t > 0.01 ? "1" : "0";
    // La coque rayonne sa chaleur : teinte visible au-delà de ~330 K.
    this.hullHeat?.setAttribute("opacity", clamp((body.hullTemperatureK - 330) / 450, 0, 0.55).toFixed(3));
  }

  private updatePower(body: RigidBody, now: number): void {
    const power = body.lastPowerStep;
    const generatorFraction = power && body.generator.maxPowerWatts > 0 ? power.generatorOutputWatts / body.generator.maxPowerWatts : 0;
    const flicker = 0.92 + Math.sin(now * 5.5) * 0.08;
    this.reactorCore?.setAttribute("opacity", ((0.35 + 0.65 * generatorFraction) * flicker).toFixed(3));

    const batteryFraction = body.battery.capacityWattSeconds > 0 ? body.battery.currentChargeWattSeconds / body.battery.capacityWattSeconds : 0;
    const cells = this.batteryCells.length;
    this.batteryCells.forEach((cell, i) => {
      // Les modules du haut se vident les premiers.
      const fill = clamp(batteryFraction * cells - (cells - 1 - i), 0, 1);
      cell.setAttribute("width", (Number(cell.dataset.w) * fill).toFixed(1));
      cell.dataset.low = batteryFraction < 0.2 ? "1" : "0";
    });

    const propFraction = body.reservoir.capacityKg > 0 ? body.reservoir.quantityKg / body.reservoir.capacityKg : 0;
    if (this.propFill) {
      // Le propergol se tasse côté poupe, vers la sortie du réservoir.
      const x0 = Number(this.propFill.dataset.x0);
      const w = Number(this.propFill.dataset.w);
      const x = x0 + w * (1 - propFraction);
      this.propFill.setAttribute("x", x.toFixed(1));
      this.propFill.setAttribute("width", (w * propFraction).toFixed(1));
      this.propFill.dataset.low = propFraction < 0.2 ? "1" : "0";
      this.propSurface?.setAttribute("transform", `translate(${x.toFixed(1)},0)`);
      this.propSurface?.setAttribute("opacity", propFraction > 0.002 && propFraction < 0.998 ? "1" : "0");
    }
  }

  private updateStores(body: RigidBody, now: number): void {
    // Un tir survenu pendant qu'un autre poste était affiché n'est pas rejoué au retour.
    const watching = now - this.lastUpdateNow < 0.5;
    this.lastUpdateNow = now;
    if (watching && body.missileCount < this.lastMissileCount) this.missileHatchUntil = now + 1.6;
    if (watching && body.decoyCount < this.lastDecoyCount) this.decoyHatchUntil = now + 1.6;
    this.lastMissileCount = body.missileCount;
    this.lastDecoyCount = body.decoyCount;
    this.missileHatch?.classList.toggle("open", now < this.missileHatchUntil);
    this.decoyHatch?.classList.toggle("open", now < this.decoyHatchUntil);
    this.missiles.forEach((m, i) => m.classList.toggle("empty", i >= body.missileCount));
    this.tacLamps.forEach((lamp, i) => lamp.classList.toggle("on", i < body.missileCount));
    this.decoys.forEach((d, i) => d.classList.toggle("empty", i >= body.decoyCount));
  }

  private updatePdc(body: RigidBody, dt: number): void {
    const mode = body.pdcCommand.mode;
    body.pdcMounts.forEach((mount, i) => {
      const gun = this.pdcGuns[i];
      if (!gun) return;
      const track = mount.targetTrackId ? body.knowledge.tracks.find((t) => t.localId === mount.targetTrackId) : undefined;
      // En veille, les tourelles regardent vers l'avant ; à l'arrêt, elles sont rangées vers la poupe.
      let target = gun.side > 0 ? -145 : 145;
      if (mode === "arret") target = 0;
      else if (track) target = this.halfPlane(this.sideAngle(trackDirection(track, body)).angle, gun.side);
      gun.angle = approachLinear(gun.angle, target, 240 * dt);
      gun.gun.setAttribute("transform", `translate(${gun.cx},${gun.cy}) rotate(${gun.angle.toFixed(1)})`);
      gun.turret.dataset.firing = mount.firing ? "1" : "0";

      const ammo = this.pdcAmmo.find((a) => a.dataset.mount === String(i));
      const fraction = mount.def.magazineRounds > 0 ? mount.roundsRemaining / mount.def.magazineRounds : 0;
      if (ammo) {
        const y0 = Number(ammo.dataset.y0);
        const h = Number(ammo.dataset.h);
        ammo.setAttribute("y", (y0 + h * (1 - fraction)).toFixed(1));
        ammo.setAttribute("height", (h * fraction).toFixed(1));
        ammo.dataset.low = fraction < 0.2 ? "1" : "0";
      }

      const label = this.equipment.get(`pdc-${i}`);
      if (!label) return;
      let state = "on";
      let detail = track ? `cible ${track.localId}` : "veille";
      if (mode === "arret") {
        state = "off";
        detail = "rangée";
      } else if (mount.roundsRemaining <= 0) {
        state = "alert";
        detail = "VIDE";
      } else if (mount.firing) {
        state = "fire";
        detail = `FEU sur ${track?.localId ?? "piste"}`;
      } else if (mount.targetTrackId && mount.retargetRemainingSeconds > 0) {
        detail = `pointage ${mount.retargetRemainingSeconds.toFixed(1)} s`;
      }
      label.group.dataset.state = state;
      label.status.textContent = `${PDC_MODE_LABELS[mode]} · ${mount.roundsRemaining} coups · ${detail}`;
    });
  }

  private updateSensors(body: RigidBody, dt: number, now: number): void {
    const radar = body.sensors.find((s) => s.mode === "radar_active");
    const radarState = radar ? body.sensorStates.get(radar.id) : undefined;
    const radarPowered = !!radar && !sensorUnpowered(body, radar.id);
    const radarOn = !!radarState?.enabled && radarPowered;
    if (radar && radarState && this.radarAntenna) {
      const halfDeg = (radarState.scanHalfAngleRad * 180) / Math.PI;
      // Balayage quasi omnidirectionnel : l'antenne tourne ; secteur ou suivi : elle vise la direction commandée.
      const omni = halfDeg >= OMNI_SCAN_DEG;
      let planar = 1;
      if (radarOn && omni) {
        this.radarAngle = (this.radarAngle + OMNI_ROTATION_DEG_PER_S * dt) % 360;
      } else {
        let targetAngle = -90;
        if (radarOn && radarState.scanDirectionWorld.lengthSq() > 0) {
          const projected = this.sideAngle(radarState.scanDirectionWorld);
          targetAngle = projected.angle;
          planar = projected.planar;
        }
        this.radarAngle = approachShortest(this.radarAngle, targetAngle, 200 * dt);
      }
      const [px, py] = this.radarPivot;
      this.radarAntenna.setAttribute("transform", `translate(${px},${py}) rotate(${this.radarAngle.toFixed(1)})`);
      this.radarBeam?.setAttribute("opacity", radarOn ? (0.35 + 0.65 * planar).toFixed(3) : "0");
      this.radarBeam?.setAttribute("transform", `translate(${px},${py}) rotate(${this.radarAngle.toFixed(1)})`);
      const half = ((omni ? OMNI_BEAM_HALF_DEG : clamp(halfDeg, 3, 75)) * Math.PI) / 180;
      this.beamWedge?.setAttribute("d", arcPath(BEAM_RADIUS, half, true));
      this.beamPulses.forEach((pulse, k) => {
        const r = (now * 140 + (k * BEAM_RADIUS) / this.beamPulses.length) % BEAM_RADIUS;
        pulse.setAttribute("d", arcPath(Math.max(1, r), half, false));
        pulse.setAttribute("opacity", (1 - r / BEAM_RADIUS).toFixed(3));
      });
      const label = this.equipment.get("radar");
      if (label) {
        const sector = omni ? "balayage 360°" : `secteur ±${Math.round(halfDeg)}°`;
        label.group.dataset.state = !radarState.enabled ? "off" : !radarPowered ? "alert" : "on";
        label.status.textContent = !radarState.enabled ? "arrêt" : !radarPowered ? "DÉLESTÉ" : radarState.followedTrackId ? `suivi ${radarState.followedTrackId} · ±${Math.round(halfDeg)}°` : sector;
      }
    }

    const ir = body.sensors.find((s) => s.mode === "ir_passive");
    if (ir && this.irGroup) {
      const enabled = !!body.sensorStates.get(ir.id)?.enabled;
      const powered = !sensorUnpowered(body, ir.id);
      this.irGroup.dataset.on = enabled && powered ? "1" : "0";
      const label = this.equipment.get("ir");
      if (label) {
        label.group.dataset.state = !enabled ? "off" : !powered ? "alert" : "on";
        label.status.textContent = !enabled ? "arrêt" : !powered ? "DÉLESTÉ" : "veille";
      }
    }
    const esm = body.sensors.find((s) => s.mode === "radar_passive");
    if (esm && this.esmGroup) this.esmGroup.dataset.on = body.sensorStates.get(esm.id)?.enabled && !sensorUnpowered(body, esm.id) ? "1" : "0";

    // Écran radar de la salle de détection : pistes connues, projetées dans le plan de coupe.
    if (this.scopeSweep) {
      this.scopeAngle = (this.scopeAngle + dt * 200) % 360;
      this.scopeSweep.setAttribute("transform", `translate(${this.scope.cx},${this.scope.cy}) rotate(${this.scopeAngle.toFixed(1)})`);
      this.scopeSweep.setAttribute("opacity", radarOn ? "1" : "0");
    }
    const tracks = body.knowledge.tracks.filter((t) => t.state !== "lost");
    this.blips.forEach((blip, i) => {
      const track = tracks[i];
      if (!track) {
        blip.setAttribute("visibility", "hidden");
        return;
      }
      const direction = trackDirection(track, body);
      const angle = (this.sideAngle(direction).angle * Math.PI) / 180;
      const { cx, cy, r: radius } = this.scope;
      const r = track.positionEstimateWorld ? radius * clamp(0.15 + (0.8 * Math.log10(Math.max(1, direction.length() / 1000))) / 3, 0.15, 0.95) : radius * 0.97;
      blip.setAttribute("cx", (cx + r * Math.cos(angle)).toFixed(1));
      blip.setAttribute("cy", (cy + r * Math.sin(angle)).toFixed(1));
      blip.setAttribute("visibility", "visible");
      blip.dataset.kind = track.classification === "missile probable" ? "missile" : track.classification === "vaisseau probable" ? "vaisseau" : "inconnu";
    });
  }

  private updateRcs(body: RigidBody): void {
    const torque = body.lastAllocation?.torqueBody;
    const level = (v: number): number => (torque ? Math.min(1, Math.abs(v) / this.rcsTorqueScale) : 0);
    const pitch = torque ? level(torque.y) : 0;
    const lateral = torque ? Math.max(level(torque.x), level(torque.z)) : 0;
    const pitchSign = torque ? Math.sign(torque.y) : 0;
    for (const puff of this.rcsPuffs) {
      let intensity = 0;
      if (puff.kind === "out") {
        // Couple de tangage négatif : nez vers le haut (poussée vers le haut à la proue, vers le bas à la poupe).
        const firing = pitchSign < 0 ? puff.cluster === "bow-bottom" || puff.cluster === "stern-top" : pitchSign > 0 ? puff.cluster === "bow-top" || puff.cluster === "stern-bottom" : false;
        if (firing) intensity = pitch;
      } else {
        intensity = lateral;
      }
      puff.el.setAttribute("opacity", intensity > 0.02 ? (Math.max(0.35, intensity) * (0.65 + 0.35 * Math.random())).toFixed(2) : "0");
    }
  }

  private updateFooter(body: RigidBody): void {
    const propFraction = body.reservoir.capacityKg > 0 ? body.reservoir.quantityKg / body.reservoir.capacityKg : 0;
    const batteryFraction = body.battery.capacityWattSeconds > 0 ? body.battery.currentChargeWattSeconds / body.battery.capacityWattSeconds : 0;
    const accelerationG = (body.lastAllocation?.forceWorld.length() ?? 0) / body.massKg / G0;
    const [line1, line2, line3] = this.footLines;
    line1.textContent = `VITESSE ${body.velocity.length().toFixed(0)} m/s · ACCÉLÉRATION ${accelerationG.toFixed(2)} G · POUSSÉE ${Math.round(body.command.throttle * 100)} % · COQUE ${body.hullTemperatureK.toFixed(0)} K`;
    line2.textContent = `PROPERGOL ${(propFraction * 100).toFixed(0)} % · BATTERIE ${(batteryFraction * 100).toFixed(0)} % · MISSILES ${body.missileCount}/${this.missileCapacity} · LEURRES ${body.decoyCount}/${this.decoyCapacity}`;
    const friendlies = body.knowledge.friendlies;
    line3.textContent = friendlies.length > 0 ? `FLOTTE · ALLIÉS EN LIAISON ${friendlies.filter((f) => !f.neutralized).length}/${friendlies.length}` : "";
  }

  /** Angle à l'écran (degrés, sens horaire depuis la poupe) d'une direction du monde projetée dans le plan de coupe. */
  private sideAngle(worldVector: Vector3): { angle: number; planar: number } {
    const v = this.scratch.copy(worldVector).applyQuaternion(this.invAttitude);
    // Repère corps : +X vers la proue (gauche de l'écran), +Z vers le dos (haut de l'écran).
    const dx = -v.x;
    const dy = -v.z;
    const length = v.length();
    return { angle: (Math.atan2(dy, dx) * 180) / Math.PI, planar: length > 0 ? Math.hypot(dx, dy) / length : 0 };
  }

  /** Une tourelle dorsale ne tire que vers le haut, une ventrale vers le bas (la coque masque le reste). */
  private halfPlane(angle: number, side: 1 | -1): number {
    if (side > 0) return angle <= 0 ? angle : angle < 90 ? 0 : -180;
    if (angle >= 0) return angle;
    return angle > -90 ? 0 : 180;
  }

  private postStatus(id: PostId, body: RigidBody): { status: RoomStatus; text: string } {
    const shed = body.lastPowerStep?.shedConsumerIds ?? [];
    switch (id) {
      case "pilotage": {
        if (body.crewExposureIncapacitated) return { status: "alert", text: "ÉQUIPAGE INCAPACITÉ" };
        if (body.crewExposureFraction > 0.5) return { status: "alert", text: `Exposition G ${(body.crewExposureFraction * 100).toFixed(0)} %` };
        if (body.command.navMode !== "manuel" && body.command.navTrackId) return { status: "info", text: `${NAV_MODE_LABELS[body.command.navMode]} ${body.command.navTrackId} · ${Math.round(body.command.throttle * 100)} %` };
        if (body.command.throttle > 0) return { status: "info", text: `Poussée ${Math.round(body.command.throttle * 100)} %` };
        return { status: "ok", text: "Moteurs coupés" };
      }
      case "detection": {
        const active = body.knowledge.tracks.filter((t) => t.state !== "lost").length;
        if (active > 0) return { status: "info", text: `${active} piste${active > 1 ? "s" : ""} active${active > 1 ? "s" : ""}` };
        const anySensor = [...body.sensorStates.values()].some((s) => s.enabled);
        return { status: "ok", text: anySensor ? "Veille · aucun contact" : "Capteurs à l'arrêt" };
      }
      case "tactique": {
        const inFlight = this.world.missiles.filter((m) => m.ownerId === body.id && (m.state === "poussee" || m.state === "derive")).length;
        if (inFlight > 0) return { status: "info", text: `${inFlight} missile${inFlight > 1 ? "s" : ""} en vol · ${body.missileCount} en soute` };
        return { status: body.missileCount === 0 ? "warn" : "ok", text: `${body.missileCount} missile${body.missileCount > 1 ? "s" : ""} en soute` };
      }
      case "ingenierie": {
        const batteryFraction = body.battery.currentChargeWattSeconds / body.battery.capacityWattSeconds;
        if (shed.length > 0) return { status: "alert", text: `Délestage : ${shed.length} consommateur${shed.length > 1 ? "s" : ""}` };
        if (batteryFraction < 0.2) return { status: "warn", text: `Batterie ${(batteryFraction * 100).toFixed(0)} %` };
        return { status: "ok", text: "Alimentation nominale" };
      }
    }
  }

  private secondaryStatus(id: RoomId, body: RigidBody): { status: RoomStatus; text: string } {
    const exposure = body.crewExposureFraction;
    switch (id) {
      case "quartiers":
        if (body.crewExposureIncapacitated) return { status: "alert", text: "Équipage inconscient" };
        return { status: "idle", text: "Équipage aux postes" };
      case "carre":
      case "infirmerie":
        return { status: exposure > 0.5 ? "warn" : "idle", text: `Charge G équipage ${(exposure * 100).toFixed(0)} %` };
      case "sas":
        return { status: "idle", text: "Portes verrouillées" };
      case "vie": {
        if (body.lifeSupportFailed) return { status: "alert", text: "SUPPORT VIE HORS SERVICE" };
        const shed = body.lastPowerStep?.shedConsumerIds ?? [];
        const lifeShed = shed.some((cid) => body.consumers.find((c) => c.id === cid)?.priorityGroup === "vie");
        if (lifeShed) return { status: "alert", text: `Sur secours · ${body.lifeSupportRemainingAutonomySeconds.toFixed(0)} s` };
        return { status: "ok", text: "Atmosphère nominale" };
      }
      case "missiles": {
        if (body.missileCount === 0) return { status: "warn", text: "Soute vide" };
        return { status: "ok", text: `${body.missileCount}/${this.missileCapacity} en soute · parés` };
      }
      case "leurres": {
        if (this.decoyCapacity === 0) return { status: "idle", text: "Aucun leurre embarqué" };
        if (body.decoyCount === 0) return { status: "warn", text: "Soute vide" };
        return { status: "ok", text: `${body.decoyCount}/${this.decoyCapacity} en soute · parés` };
      }
      case "propergol": {
        const fraction = body.reservoir.capacityKg > 0 ? body.reservoir.quantityKg / body.reservoir.capacityKg : 0;
        return { status: fraction < 0.2 ? "warn" : "ok", text: `${(fraction * 100).toFixed(0)} % · ${(body.reservoir.quantityKg / 1000).toFixed(1)} t` };
      }
      case "moteur": {
        const principal = body.thrusters.find((t) => t.kind === "principal");
        const meganewtons = principal ? (principal.maxThrustNewtons / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "?";
        if (this.shownThrottle > 0.01) return { status: "info", text: `Poussée ${Math.round(body.command.throttle * 100)} % · ${meganewtons} MN max` };
        return { status: "ok", text: `Coupé · ${meganewtons} MN max` };
      }
      default:
        return { status: "idle", text: "" };
    }
  }

  resize(): void {}

  dispose(): void {
    this.element.remove();
  }
}

/** Secteur (ou arc seul) centré sur +x, de demi-angle `half`, dans le repère du faisceau. */
function arcPath(radius: number, half: number, closed: boolean): string {
  const x = (radius * Math.cos(half)).toFixed(1);
  const y = (radius * Math.sin(half)).toFixed(1);
  const large = half * 2 > Math.PI ? 1 : 0;
  const arc = `A${radius.toFixed(1)},${radius.toFixed(1)} 0 ${large} 0 ${x},-${y}`;
  return closed ? `M0,0 L${x},${y} ${arc} Z` : `M${x},${y} ${arc}`;
}
