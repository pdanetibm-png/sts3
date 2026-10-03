import { quatToTuple, vecToTuple } from "../shared/vecSerialization";
import type { SimulationWorld } from "./world";

const SAMPLE_INTERVAL_SECONDS = 1;
// 1h de mission à 1 échantillon/s — largement au-delà de l'échéance publique (1800 s,
// section 9.4) : jamais atteint en pratique, sert uniquement de garde-fou mémoire.
const MAX_SAMPLES = 3600;

interface TrackSnapshot {
  localId: string;
  state: string;
  ageSeconds: number;
  positionEstimateWorld: [number, number, number] | null;
  positionUncertaintyMeters: number | null;
  velocityEstimateWorld: [number, number, number] | null;
  velocityUncertaintyMps: number | null;
}

interface BodySnapshot {
  id: string;
  affiliation: string;
  position: [number, number, number];
  velocity: [number, number, number];
  throttle: number;
  attitudeHoldEngaged: boolean;
  navMode: string;
  navTrackId: string | null;
  missileCount: number;
  decoyCount: number;
  pdc: { mode: string; mounts: { id: string; roundsRemaining: number; targetTrackId: string | null; firing: boolean }[] };
  propellantKg: number;
  massKg: number;
  attitude: [number, number, number, number];
  angularVelocity: [number, number, number];
  targetAttitude: [number, number, number, number];
  /** Force totale appliquée par les propulseurs au dernier pas (repère monde), en N. */
  thrustForceWorld: [number, number, number] | null;
  perThrusterThrottle: number[] | null;
  hullTemperatureK: number;
  batteryFraction: number;
  generatorOutputWatts: number | null;
  shedConsumerIds: string[];
  sensors: { id: string; enabled: boolean; scanDirectionWorld: [number, number, number]; scanHalfAngleRad: number; followedTrackId: string | null }[];
  crewExposureFraction: number;
  crewExposureIncapacitated: boolean;
  lifeSupportRemainingAutonomySeconds: number;
  lifeSupportFailed: boolean;
  neutralized: boolean;
  /** Connaissance PROPRE de ce corps (ses pistes à lui) — jamais celle de l'autre camp. */
  tracks: TrackSnapshot[];
}

interface MissileSnapshot {
  id: string;
  ownerId: string;
  state: string;
  position: [number, number, number];
  velocity: [number, number, number];
  reservoirKg: number;
  assignedTrackId: string | null;
  hypotheticalTargetWorld: [number, number, number] | null;
}

interface DecoySnapshot {
  id: string;
  ownerId: string;
  state: string;
  position: [number, number, number];
  velocity: [number, number, number];
  reservoirKg: number;
  emitterChargeKg: number;
  thrustNewtons: number;
  emitterWattsPerSr: number;
}

export interface DiagnosticSample {
  simTime: number;
  step: number;
  bodies: BodySnapshot[];
  missiles: MissileSnapshot[];
  decoys: DecoySnapshot[];
}

function buildSample(world: SimulationWorld): DiagnosticSample {
  return {
    simTime: world.simTimeSeconds,
    step: world.stepIndex,
    bodies: world.bodies.map((body) => ({
      id: body.id,
      affiliation: body.affiliation,
      position: vecToTuple(body.position),
      velocity: vecToTuple(body.velocity),
      throttle: body.command.throttle,
      attitudeHoldEngaged: body.command.attitudeHoldEngaged,
      navMode: body.command.navMode,
      navTrackId: body.command.navTrackId,
      missileCount: body.missileCount,
      decoyCount: body.decoyCount,
      pdc: {
        mode: body.pdcCommand.mode,
        mounts: body.pdcMounts.map((m) => ({ id: m.id, roundsRemaining: m.roundsRemaining, targetTrackId: m.targetTrackId, firing: m.firing })),
      },
      propellantKg: body.reservoir.quantityKg,
      massKg: body.massKg,
      attitude: quatToTuple(body.attitude),
      angularVelocity: vecToTuple(body.angularVelocity),
      targetAttitude: quatToTuple(body.command.targetAttitude),
      thrustForceWorld: body.lastAllocation ? vecToTuple(body.lastAllocation.forceWorld) : null,
      perThrusterThrottle: body.lastAllocation ? [...body.lastAllocation.perThrusterThrottle] : null,
      hullTemperatureK: body.hullTemperatureK,
      batteryFraction: body.battery.capacityWattSeconds > 0 ? body.battery.currentChargeWattSeconds / body.battery.capacityWattSeconds : 0,
      generatorOutputWatts: body.lastPowerStep?.generatorOutputWatts ?? null,
      shedConsumerIds: body.lastPowerStep ? [...body.lastPowerStep.shedConsumerIds] : [],
      sensors: Array.from(body.sensorStates.entries()).map(([id, state]) => ({
        id,
        enabled: state.enabled,
        scanDirectionWorld: vecToTuple(state.scanDirectionWorld),
        scanHalfAngleRad: state.scanHalfAngleRad,
        followedTrackId: state.followedTrackId,
      })),
      crewExposureFraction: body.crewExposureFraction,
      crewExposureIncapacitated: body.crewExposureIncapacitated,
      lifeSupportRemainingAutonomySeconds: body.lifeSupportRemainingAutonomySeconds,
      lifeSupportFailed: body.lifeSupportFailed,
      neutralized: body.neutralized,
      tracks: body.knowledge.allTracks.map((track) => ({
        localId: track.localId,
        state: track.state,
        ageSeconds: world.simTimeSeconds - track.lastObservationSimTime,
        positionEstimateWorld: track.positionEstimateWorld ? vecToTuple(track.positionEstimateWorld) : null,
        positionUncertaintyMeters: track.positionUncertaintyMeters ?? null,
        velocityEstimateWorld: track.velocityEstimateWorld ? vecToTuple(track.velocityEstimateWorld) : null,
        velocityUncertaintyMps: track.velocityUncertaintyMps ?? null,
      })),
    })),
    missiles: world.missiles.map((missile) => ({
      id: missile.id,
      ownerId: missile.ownerId,
      state: missile.state,
      position: vecToTuple(missile.position),
      velocity: vecToTuple(missile.velocity),
      reservoirKg: missile.reservoir.quantityKg,
      assignedTrackId: missile.assignedTrackId,
      hypotheticalTargetWorld: missile.hypotheticalTargetWorld ? vecToTuple(missile.hypotheticalTargetWorld) : null,
    })),
    decoys: world.decoys.map((decoy) => ({
      id: decoy.id,
      ownerId: decoy.ownerId,
      state: decoy.state,
      position: vecToTuple(decoy.position),
      velocity: vecToTuple(decoy.velocity),
      reservoirKg: decoy.reservoir.quantityKg,
      emitterChargeKg: decoy.emitterChargeKg,
      thrustNewtons: decoy.lastThrustNewtons,
      emitterWattsPerSr: decoy.lastEmitterWattsPerSr,
    })),
  };
}

/**
 * Journal de diagnostic (section 11, DBG-01) : échantillonne périodiquement la vérité
 * simulation complète (les deux camps, jamais un seul) pour permettre d'exporter et de
 * rejouer une séquence exacte hors-ligne. Distinct de `world.events` (connaissance du joueur
 * uniquement, section 9.4) — ce journal est un outil de mise au point, jamais montré en
 * partie réaliste (même restriction que la carte maître).
 */
export class DiagnosticLog {
  private readonly samples: DiagnosticSample[] = [];
  private lastSampleSimTime = Number.NEGATIVE_INFINITY;

  maybeSample(world: SimulationWorld): void {
    if (world.simTimeSeconds - this.lastSampleSimTime < SAMPLE_INTERVAL_SECONDS) return;
    this.lastSampleSimTime = world.simTimeSeconds;
    this.samples.push(buildSample(world));
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  get samplesForExport(): DiagnosticSample[] {
    return this.samples;
  }
}
