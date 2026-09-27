import { Vector3 } from "three";
import type { Track } from "../knowledge/types";
import type { PdcDef, PdcMountDef } from "./types";

/**
 * Défense rapprochée (CONCEPTION_PDC.md) — lois communes : solution de tir (connaissance seule),
 * surface présentée et probabilité d'interception d'une rafale (résolution physique).
 */

export type PdcMode = "arret" | "auto" | "manuel";

export const PDC_MODE_LABELS: Record<PdcMode, string> = {
  arret: "Arrêt",
  auto: "Auto",
  manuel: "Manuel",
};

/** Consigne du bord pour ses tourelles — persistante entre postes, enregistrée comme les autres. */
export interface PdcCommand {
  mode: PdcMode;
  /** Piste désignée en mode Manuel. */
  manualTrackId: string | null;
}

/** État d'une tourelle montée. */
export interface PdcMountState {
  readonly id: string;
  readonly def: PdcDef;
  roundsRemaining: number;
  targetTrackId: string | null;
  /** Pointage restant avant le premier obus sur la cible courante. */
  retargetRemainingSeconds: number;
  /** Fraction d'obus accumulée entre deux pas (cadence continue, rafales discrètes). */
  roundAccumulator: number;
  /** A tiré au dernier pas (affichage). */
  firing: boolean;
  /** L'ouverture du feu sur la cible courante a déjà été annoncée au journal. */
  engagementAnnounced: boolean;
}

export interface PdcMountSaveState {
  id: string;
  roundsRemaining: number;
  targetTrackId: string | null;
  retargetRemainingSeconds: number;
  roundAccumulator: number;
  firing: boolean;
  engagementAnnounced: boolean;
}

export function createMountState(mount: PdcMountDef): PdcMountState {
  return {
    id: mount.id,
    def: mount.pdc,
    roundsRemaining: mount.pdc.magazineRounds,
    targetTrackId: null,
    retargetRemainingSeconds: 0,
    roundAccumulator: 0,
    firing: false,
    engagementAnnounced: false,
  };
}

export function mountToSaveState(mount: PdcMountState): PdcMountSaveState {
  return {
    id: mount.id,
    roundsRemaining: mount.roundsRemaining,
    targetTrackId: mount.targetTrackId,
    retargetRemainingSeconds: mount.retargetRemainingSeconds,
    roundAccumulator: mount.roundAccumulator,
    firing: mount.firing,
    engagementAnnounced: mount.engagementAnnounced,
  };
}

export function applyMountSaveState(mount: PdcMountState, saved: PdcMountSaveState): void {
  mount.roundsRemaining = saved.roundsRemaining;
  mount.targetTrackId = saved.targetTrackId;
  mount.retargetRemainingSeconds = saved.retargetRemainingSeconds;
  mount.roundAccumulator = saved.roundAccumulator;
  mount.firing = saved.firing;
  mount.engagementAnnounced = saved.engagementAnnounced;
}

export interface FiringSolution {
  /** Temps de vol de l'obus jusqu'au point de rencontre. */
  timeSeconds: number;
  /** Direction de tir, repère monde (dans le repère du vaisseau, l'obus part à la vitesse de bouche). */
  aimDirectionWorld: Vector3;
  /** Point de rencontre prévu, repère monde. */
  interceptPointWorld: Vector3;
  /** Distance parcourue par l'obus depuis la bouche jusqu'au point de rencontre. */
  interceptRangeMeters: number;
}

/**
 * Point de rencontre entre un obus tiré à `muzzleVelocity` et une cible supposée en mouvement
 * uniforme (position et vitesse ESTIMÉES) : |r + v·t| = v_bouche·t, dans le repère du vaisseau.
 * `null` si la cible s'éloigne plus vite que l'obus.
 */
export function firingSolution(
  shipPositionWorld: Vector3,
  shipVelocityWorld: Vector3,
  targetPositionWorld: Vector3,
  targetVelocityWorld: Vector3,
  muzzleVelocity: number,
): FiringSolution | null {
  const r = targetPositionWorld.clone().sub(shipPositionWorld);
  const v = targetVelocityWorld.clone().sub(shipVelocityWorld);
  const a = v.dot(v) - muzzleVelocity * muzzleVelocity;
  const b = 2 * r.dot(v);
  const c = r.dot(r);
  let t: number;
  if (Math.abs(a) < 1e-9) {
    if (b >= 0) return null;
    t = -c / b;
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((x) => x > 0);
    if (candidates.length === 0) return null;
    t = Math.min(...candidates);
  }
  const relativeIntercept = r.addScaledVector(v, t);
  const range = muzzleVelocity * t;
  if (!(range > 0)) return null;
  return {
    timeSeconds: t,
    aimDirectionWorld: relativeIntercept.clone().divideScalar(relativeIntercept.length()),
    interceptPointWorld: shipPositionWorld.clone().add(relativeIntercept),
    interceptRangeMeters: range,
  };
}

/** Une piste que la conduite de tir peut prendre à partie : position et vitesse estimées. */
export function hasFiringData(track: Track): track is Track & { positionEstimateWorld: Vector3; velocityEstimateWorld: Vector3 } {
  return !!track.positionEstimateWorld && !!track.velocityEstimateWorld;
}

/** Temps d'arrivée estimé d'une piste sur le vaisseau (distance / vitesse de rapprochement) ; +∞ si elle s'éloigne. */
export function estimatedTimeToGo(track: Track, shipPositionWorld: Vector3, shipVelocityWorld: Vector3): number {
  if (!hasFiringData(track)) return Number.POSITIVE_INFINITY;
  const offset = track.positionEstimateWorld.clone().sub(shipPositionWorld);
  const distance = offset.length();
  if (distance < 1e-6) return 0;
  const closing = -track.velocityEstimateWorld.clone().sub(shipVelocityWorld).dot(offset) / distance;
  return closing > 0 ? distance / closing : Number.POSITIVE_INFINITY;
}

/** Surface présentée selon l'angle entre l'axe de l'objet et la direction de passage des obus. */
export function presentedArea(front: number | undefined, side: number | undefined, axisWorld: Vector3, relativeDirectionWorld: Vector3): number {
  if (front === undefined || side === undefined) return 0;
  const length = relativeDirectionWorld.length();
  if (length < 1e-9) return side;
  const cos = axisWorld.dot(relativeDirectionWorld) / length;
  const sin2 = Math.max(0, 1 - cos * cos);
  return front + (side - front) * sin2;
}

/**
 * Probabilité qu'une rafale de `rounds` obus, dispersés autour de son centre (écart-type `sigma`),
 * touche une cible de surface présentée `area` passant à `missDistance` du centre. Un obus :
 * p = 1 − exp(−A/(2πσ²)·exp(−d²/(2σ²))) (densité gaussienne intégrée sur la cible, bornée) ;
 * la rafale : 1 − (1 − p)ⁿ.
 */
export function salvoKillProbability(rounds: number, area: number, sigma: number, missDistance: number): number {
  if (!(rounds > 0) || !(area > 0)) return 0;
  let perRound: number;
  if (sigma < 1e-6) {
    perRound = missDistance * missDistance <= area / Math.PI ? 1 : 0;
  } else {
    const density = (area / (2 * Math.PI * sigma * sigma)) * Math.exp(-(missDistance * missDistance) / (2 * sigma * sigma));
    perRound = 1 - Math.exp(-density);
  }
  return 1 - Math.pow(1 - perRound, rounds);
}
