import { tupleToVec3, vecToTuple, type Vec3Tuple } from "../shared/vecSerialization";
import type { Observation, PositionSource, Track, TrackClassification, TrackState } from "./types";
import type { SensorMode } from "../sim/types";

export interface ObservationSaveState {
  simTime: number;
  sourceSensorId: string;
  mode: SensorMode;
  bearingWorld: Vec3Tuple;
  bearingUncertaintyRad: number;
  rangeMeters?: number;
  rangeUncertaintyMeters?: number;
  snr?: number;
  crossSectionEstimateM2?: number;
}

export interface TrackSaveState {
  localId: string;
  createdSimTime: number;
  lastObservationSimTime: number;
  lastObservation: ObservationSaveState;
  state: TrackState;
  bearingEstimateWorld: Vec3Tuple;
  bearingUncertaintyRad: number;
  /** `observer` : absent des sauvegardes antérieures à la distance passive. */
  bearingFixes: { simTime: number; bearing: Vec3Tuple; uncertaintyRad: number; observer?: Vec3Tuple }[];
  passiveFixes?: { simTime: number; bearing: Vec3Tuple; uncertaintyRad: number; observer: Vec3Tuple }[];
  remoteBearingFixes?: { simTime: number; bearing: Vec3Tuple; uncertaintyRad: number; observer: Vec3Tuple; observerId: string }[];
  bearingRateWorld: Vec3Tuple | null;
  bearingRateUncertaintyRadPerSecond: number | null;
  positionEstimateWorld: Vec3Tuple | null;
  positionUncertaintyMeters: number | null;
  crossRangeUncertaintyMeters?: number | null;
  positionSource?: PositionSource | null;
  /** Optionnel : absent des sauvegardes antérieures (repart alors d'une fenêtre vide). */
  rangeFixes?: { simTime: number; position: Vec3Tuple; uncertaintyMeters: number }[];
  velocityEstimateWorld: Vec3Tuple | null;
  velocityUncertaintyMps: number | null;
  maneuvering?: boolean;
  classification: TrackClassification;
  classificationConfidence: number;
  crossSectionEstimateM2?: number;
  crossSectionSamples?: number;
  crossSectionLogSum?: number;
  ambiguous: boolean;
  history: ObservationSaveState[];
}

function observationToSaveState(o: Observation): ObservationSaveState {
  return {
    simTime: o.simTime,
    sourceSensorId: o.sourceSensorId,
    mode: o.mode,
    bearingWorld: vecToTuple(o.bearingWorld),
    bearingUncertaintyRad: o.bearingUncertaintyRad,
    rangeMeters: o.rangeMeters,
    rangeUncertaintyMeters: o.rangeUncertaintyMeters,
    snr: o.snr,
    crossSectionEstimateM2: o.crossSectionEstimateM2,
  };
}

function observationFromSaveState(s: ObservationSaveState): Observation {
  return {
    simTime: s.simTime,
    sourceSensorId: s.sourceSensorId,
    mode: s.mode,
    bearingWorld: tupleToVec3(s.bearingWorld),
    bearingUncertaintyRad: s.bearingUncertaintyRad,
    rangeMeters: s.rangeMeters,
    rangeUncertaintyMeters: s.rangeUncertaintyMeters,
    snr: s.snr,
    crossSectionEstimateM2: s.crossSectionEstimateM2,
  };
}

export function trackToSaveState(t: Track): TrackSaveState {
  return {
    localId: t.localId,
    createdSimTime: t.createdSimTime,
    lastObservationSimTime: t.lastObservationSimTime,
    lastObservation: observationToSaveState(t.lastObservation),
    state: t.state,
    bearingEstimateWorld: vecToTuple(t.bearingEstimateWorld),
    bearingUncertaintyRad: t.bearingUncertaintyRad,
    bearingFixes: t.bearingFixes.map((f) => ({
      simTime: f.simTime,
      bearing: vecToTuple(f.bearingWorld),
      uncertaintyRad: f.uncertaintyRad,
      ...(f.observerPositionWorld ? { observer: vecToTuple(f.observerPositionWorld) } : {}),
    })),
    passiveFixes: (t.passiveFixes ?? [])
      .filter((f) => f.observerPositionWorld)
      .map((f) => ({ simTime: f.simTime, bearing: vecToTuple(f.bearingWorld), uncertaintyRad: f.uncertaintyRad, observer: vecToTuple(f.observerPositionWorld!) })),
    remoteBearingFixes: (t.remoteBearingFixes ?? []).map((f) => ({
      simTime: f.simTime,
      bearing: vecToTuple(f.bearingWorld),
      uncertaintyRad: f.uncertaintyRad,
      observer: vecToTuple(f.observerPositionWorld),
      observerId: f.observerId,
    })),
    bearingRateWorld: t.bearingRateWorld ? vecToTuple(t.bearingRateWorld) : null,
    bearingRateUncertaintyRadPerSecond: t.bearingRateUncertaintyRadPerSecond ?? null,
    positionEstimateWorld: t.positionEstimateWorld ? vecToTuple(t.positionEstimateWorld) : null,
    positionUncertaintyMeters: t.positionUncertaintyMeters ?? null,
    crossRangeUncertaintyMeters: t.crossRangeUncertaintyMeters ?? null,
    positionSource: t.positionSource ?? null,
    rangeFixes: t.rangeFixes.map((f) => ({ simTime: f.simTime, position: vecToTuple(f.positionWorld), uncertaintyMeters: f.uncertaintyMeters })),
    velocityEstimateWorld: t.velocityEstimateWorld ? vecToTuple(t.velocityEstimateWorld) : null,
    velocityUncertaintyMps: t.velocityUncertaintyMps ?? null,
    maneuvering: t.maneuvering ?? false,
    classification: t.classification,
    classificationConfidence: t.classificationConfidence,
    crossSectionEstimateM2: t.crossSectionEstimateM2,
    crossSectionSamples: t.crossSectionSamples,
    crossSectionLogSum: t.crossSectionLogSum,
    ambiguous: t.ambiguous,
    history: t.history.map(observationToSaveState),
  };
}

export function trackFromSaveState(s: TrackSaveState): Track {
  return {
    localId: s.localId,
    createdSimTime: s.createdSimTime,
    lastObservationSimTime: s.lastObservationSimTime,
    lastObservation: observationFromSaveState(s.lastObservation),
    state: s.state,
    bearingEstimateWorld: tupleToVec3(s.bearingEstimateWorld),
    bearingUncertaintyRad: s.bearingUncertaintyRad,
    bearingFixes: s.bearingFixes.map((f) => ({
      simTime: f.simTime,
      bearingWorld: tupleToVec3(f.bearing),
      uncertaintyRad: f.uncertaintyRad,
      ...(f.observer ? { observerPositionWorld: tupleToVec3(f.observer) } : {}),
    })),
    passiveFixes: (s.passiveFixes ?? []).map((f) => ({
      simTime: f.simTime,
      bearingWorld: tupleToVec3(f.bearing),
      uncertaintyRad: f.uncertaintyRad,
      observerPositionWorld: tupleToVec3(f.observer),
    })),
    remoteBearingFixes: (s.remoteBearingFixes ?? []).map((f) => ({
      simTime: f.simTime,
      bearingWorld: tupleToVec3(f.bearing),
      uncertaintyRad: f.uncertaintyRad,
      observerPositionWorld: tupleToVec3(f.observer),
      observerId: f.observerId,
    })),
    bearingRateWorld: s.bearingRateWorld ? tupleToVec3(s.bearingRateWorld) : undefined,
    bearingRateUncertaintyRadPerSecond: s.bearingRateUncertaintyRadPerSecond ?? undefined,
    positionEstimateWorld: s.positionEstimateWorld ? tupleToVec3(s.positionEstimateWorld) : undefined,
    positionUncertaintyMeters: s.positionUncertaintyMeters ?? undefined,
    crossRangeUncertaintyMeters: s.crossRangeUncertaintyMeters ?? undefined,
    positionSource: s.positionSource ?? undefined,
    rangeFixes: (s.rangeFixes ?? []).map((f) => ({ simTime: f.simTime, positionWorld: tupleToVec3(f.position), uncertaintyMeters: f.uncertaintyMeters })),
    velocityEstimateWorld: s.velocityEstimateWorld ? tupleToVec3(s.velocityEstimateWorld) : undefined,
    velocityUncertaintyMps: s.velocityUncertaintyMps ?? undefined,
    maneuvering: s.maneuvering ?? false,
    classification: s.classification,
    classificationConfidence: s.classificationConfidence,
    crossSectionEstimateM2: s.crossSectionEstimateM2,
    crossSectionSamples: s.crossSectionSamples,
    crossSectionLogSum: s.crossSectionLogSum,
    ambiguous: s.ambiguous,
    history: s.history.map(observationFromSaveState),
  };
}
