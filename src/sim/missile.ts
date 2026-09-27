import { Vector3 } from "three";
import type { Track } from "../knowledge/types";
import { tupleToVec3, vecToTuple, type Vec3Tuple } from "../shared/vecSerialization";
import type { RigidBody } from "./rigidBody";
import { jetPowerWatts, plumePeakIntensity, stepHullTemperature, type SignatureSource } from "./signature";
import { STANDARD_GRAVITY } from "./thrusters";
import type { Affiliation, MissileDef, ReservoirDef } from "./types";

/** « abattu » : détruit par les obus d'une PDC ; « detruit » : a percuté sa cible. */
export type MissileState = "poussee" | "derive" | "perdu_theatre" | "detruit" | "abattu";

export interface MissileLaunchParams {
  id: string;
  ownerId: string;
  affiliation: Affiliation;
  position: Vector3;
  velocity: Vector3;
  def: MissileDef;
  assignedTrackId: string | null;
  /** Fixée au lancement si la piste n'a pas de position connue — jamais mise à jour ensuite (ARM-02). */
  hypotheticalTargetWorld: Vector3 | null;
  simTime: number;
  /** Température de la cellule au lancement : celle de la coque du porteur. */
  initialTemperatureK: number;
}

/** État runtime complet d'un `Missile`, JSON-safe (section 10). La définition (`MissileDef`)
 * n'est pas incluse : elle vient du vaisseau propriétaire dans le scénario, pas d'un missile
 * individuel — voir sim/save.ts pour la reconstruction (« construire puis corriger », même
 * schéma que RigidBody.applySaveState). */
export interface MissileSaveState {
  id: string;
  ownerId: string;
  affiliation: Affiliation;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
  assignedTrackId: string | null;
  hypotheticalTargetWorld: Vec3Tuple | null;
  state: MissileState;
  createdSimTime: number;
  trail: Vec3Tuple[];
  lastFuelFlowKgPerSecond: number;
  reservoirQuantityKg: number;
  hullTemperatureK: number;
  axisWorld: Vec3Tuple;
}

/**
 * Corps guidé léger (section 6 : « même socle dynamique que les vaisseaux », sans attitude/RCS/
 * énergie — un missile ne fait que pointer sa poussée vers une estimation).
 */
export class Missile {
  readonly id: string;
  readonly ownerId: string;
  readonly affiliation: Affiliation;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly structureMassKg: number;
  readonly reservoir: ReservoirDef;
  readonly maxThrustNewtons: number;
  readonly specificImpulseSeconds: number;
  readonly def: MissileDef;
  assignedTrackId: string | null;
  hypotheticalTargetWorld: Vector3 | null;
  state: MissileState = "poussee";
  readonly createdSimTime: number;
  readonly trail: Vector3[] = [];
  lastFuelFlowKgPerSecond = 0;
  hullTemperatureK: number;
  /** Axe du corps : sens de la poussée pendant la propulsion, sinon celui de la vitesse. */
  readonly axisWorld: Vector3;

  constructor(params: MissileLaunchParams) {
    this.id = params.id;
    this.ownerId = params.ownerId;
    this.affiliation = params.affiliation;
    this.position = params.position.clone();
    this.velocity = params.velocity.clone();
    this.structureMassKg = params.def.structureMassKg;
    this.reservoir = { ...params.def.reservoir };
    this.maxThrustNewtons = params.def.maxThrustNewtons;
    this.specificImpulseSeconds = params.def.specificImpulseSeconds;
    this.def = params.def;
    this.hullTemperatureK = params.initialTemperatureK;
    this.axisWorld = params.velocity.lengthSq() > 1e-6 ? params.velocity.clone().normalize() : new Vector3(1, 0, 0);
    this.assignedTrackId = params.assignedTrackId;
    this.hypotheticalTargetWorld = params.hypotheticalTargetWorld;
    this.createdSimTime = params.simTime;
  }

  get massKg(): number {
    return this.structureMassKg + this.reservoir.quantityKg;
  }

  /** Poussée du dernier pas, déduite du débit (0 en dérive). */
  get currentThrustNewtons(): number {
    return this.lastFuelFlowKgPerSecond * this.specificImpulseSeconds * STANDARD_GRAVITY;
  }

  get isActive(): boolean {
    return this.state === "poussee" || this.state === "derive";
  }

  stepThermal(dt: number): void {
    const heat = this.def.signature.thermal.baselineHeatWatts + jetPowerWatts(this.currentThrustNewtons, this.specificImpulseSeconds) * this.def.wasteHeatFraction;
    this.hullTemperatureK = stepHullTemperature(this.hullTemperatureK, this.def.signature.thermal, heat, dt);
  }

  signatureSource(): SignatureSource {
    return {
      position: this.position,
      signature: this.def.signature,
      hullTemperatureK: this.hullTemperatureK,
      plumePeakWattsPerSr: plumePeakIntensity(this.currentThrustNewtons, this.specificImpulseSeconds, this.def.plumeRadiantFraction),
      forwardAxisWorld: this.axisWorld,
    };
  }

  toSaveState(): MissileSaveState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      affiliation: this.affiliation,
      position: vecToTuple(this.position),
      velocity: vecToTuple(this.velocity),
      assignedTrackId: this.assignedTrackId,
      hypotheticalTargetWorld: this.hypotheticalTargetWorld ? vecToTuple(this.hypotheticalTargetWorld) : null,
      state: this.state,
      createdSimTime: this.createdSimTime,
      trail: this.trail.map(vecToTuple),
      lastFuelFlowKgPerSecond: this.lastFuelFlowKgPerSecond,
      reservoirQuantityKg: this.reservoir.quantityKg,
      hullTemperatureK: this.hullTemperatureK,
      axisWorld: vecToTuple(this.axisWorld),
    };
  }

  /** Reconstruit un missile depuis un état sauvegardé — `def` vient du vaisseau propriétaire
   * dans le scénario restauré, jamais stockée sur le missile lui-même. */
  static fromSaveState(saved: MissileSaveState, def: MissileDef): Missile {
    const missile = new Missile({
      id: saved.id,
      ownerId: saved.ownerId,
      affiliation: saved.affiliation,
      position: tupleToVec3(saved.position),
      velocity: tupleToVec3(saved.velocity),
      def,
      assignedTrackId: saved.assignedTrackId,
      hypotheticalTargetWorld: saved.hypotheticalTargetWorld ? tupleToVec3(saved.hypotheticalTargetWorld) : null,
      simTime: saved.createdSimTime,
      initialTemperatureK: saved.hullTemperatureK,
    });
    missile.axisWorld.copy(tupleToVec3(saved.axisWorld));
    missile.state = saved.state;
    missile.trail.push(...saved.trail.map(tupleToVec3));
    missile.lastFuelFlowKgPerSecond = saved.lastFuelFlowKgPerSecond;
    missile.reservoir.quantityKg = saved.reservoirQuantityKg;
    return missile;
  }
}

/**
 * Distance que couvre un missile tiré depuis l'arrêt relatif en `flightSeconds` : poussée
 * jusqu'à épuisement (masse décroissante), puis dérive. Enveloppe simple, en ligne droite —
 * sert à la doctrine de tir et à l'affichage, jamais à la résolution d'un impact.
 */
export function missileReachMeters(def: MissileDef, flightSeconds: number): number {
  const steps = 400;
  const dt = flightSeconds / steps;
  const massFlow = def.maxThrustNewtons / (def.specificImpulseSeconds * STANDARD_GRAVITY);
  let propellant = def.reservoir.quantityKg;
  let speed = 0;
  let distance = 0;
  for (let i = 0; i < steps; i++) {
    const burn = Math.min(propellant, massFlow * dt);
    const thrustFraction = massFlow * dt > 0 ? burn / (massFlow * dt) : 0;
    const acceleration = (def.maxThrustNewtons * thrustFraction) / (def.structureMassKg + propellant);
    propellant -= burn;
    speed += acceleration * dt;
    distance += speed * dt;
  }
  return distance;
}

/**
 * Estimation grossière du temps avant interception, pour anticiper la position d'une piste
 * (voir `resolveGuidanceTarget` et, côté pilotage, `sim/navigation.ts`). Utilise la vitesse
 * actuelle du mobile si déjà significative, sinon une estimation cinématique (vitesse atteinte
 * en accélérant depuis l'arrêt sur la distance restante) — évite une division par une vitesse
 * quasi nulle juste après un lancement ou à l'arrêt.
 */
export function estimateInterceptSeconds(currentSpeed: number, maxAcceleration: number, distanceMeters: number): number {
  const kinematicEstimate = Math.sqrt(2 * Math.max(maxAcceleration, 1e-3) * distanceMeters);
  const speedEstimate = Math.max(currentSpeed, kinematicEstimate, 1);
  return distanceMeters / speedEstimate;
}

/**
 * Point visé courant (ARM-02, pas d'autodirecteur) : l'estimation de piste du porteur si
 * elle a une position connue (déjà extrapolée en continu par la connaissance à bord),
 * sinon l'hypothèse figée au lancement. Ne lit jamais un corps réel.
 *
 * Si une vitesse estimée est disponible, anticipe la position (« lead ») au lieu de viser
 * le point instantané — une poursuite pure gaspille beaucoup d'énergie à courber sans
 * jamais rattraper une cible qui se déplace en travers de la trajectoire. Reste fondé
 * uniquement sur l'estimation transmise par le porteur, jamais sur une vitesse réelle cachée.
 */
export function resolveGuidanceTarget(missile: Missile, owner: RigidBody): Vector3 | null {
  if (missile.assignedTrackId) {
    const track = owner.knowledge.getTrack(missile.assignedTrackId);
    if (track?.positionEstimateWorld) {
      if (track.velocityEstimateWorld) {
        const distance = track.positionEstimateWorld.distanceTo(missile.position);
        const maxAcceleration = missile.maxThrustNewtons / missile.massKg;
        const leadSeconds = estimateInterceptSeconds(missile.velocity.length(), maxAcceleration, distance);
        return track.positionEstimateWorld.clone().addScaledVector(track.velocityEstimateWorld, leadSeconds);
      }
      return track.positionEstimateWorld;
    }
  }
  return missile.hypotheticalTargetWorld;
}

export type EngagementQuality = "indéterminée" | "faible" | "moyenne" | "élevée";

/**
 * Estimation qualitative de réussite (section 6, ARM-05) — jamais une garantie, fondée
 * uniquement sur la connaissance disponible. Partagée entre la console Tactique et l'IA
 * adverse. Seuils provisoires, à ajuster aux essais (section 15).
 */
export function estimateEngagementQuality(track: Track | undefined, shooterPositionWorld: Vector3, reachMeters = Number.POSITIVE_INFINITY): EngagementQuality {
  if (!track?.positionEstimateWorld || track.positionUncertaintyMeters === undefined) return "indéterminée";
  const distance = track.positionEstimateWorld.distanceTo(shooterPositionWorld);
  if (distance < 1e-3) return "indéterminée";
  // Au-delà de la portée efficace, le missile vole longtemps sans propergol pour corriger.
  if (track.state === "lost" || distance > reachMeters) return "faible";
  const relativeUncertainty = track.positionUncertaintyMeters / distance;
  if (relativeUncertainty < 0.05 && track.state === "recent") return "élevée";
  if (relativeUncertainty < 0.2) return "moyenne";
  return "faible";
}

/**
 * Direction de poussée par « vitesse à gagner » (ARM-02, sans autodirecteur) : à partir de
 * l'estimation transmise par le porteur (position et, si connue, vitesse de la piste), le
 * missile annule sa vitesse latérale par rapport à la ligne de visée tout en consacrant le
 * reste de son delta-v au rapprochement — il se place ainsi sur une route de collision. Une
 * fois le propergol épuisé, plus aucune correction n'est possible.
 */
export function guidanceThrustDirection(missile: Missile, owner: RigidBody): Vector3 | null {
  let targetPosition: Vector3 | null = null;
  let targetVelocity = new Vector3();
  const track = missile.assignedTrackId ? owner.knowledge.getTrack(missile.assignedTrackId) : undefined;
  if (track?.positionEstimateWorld) {
    targetPosition = track.positionEstimateWorld;
    if (track.velocityEstimateWorld) targetVelocity = track.velocityEstimateWorld;
  } else {
    targetPosition = missile.hypotheticalTargetWorld;
  }
  if (!targetPosition) return null;

  const lineOfSight = targetPosition.clone().sub(missile.position);
  const distance = lineOfSight.length();
  if (distance < 1e-3) return null;
  lineOfSight.divideScalar(distance);

  const relativeVelocity = missile.velocity.clone().sub(targetVelocity);
  const closing = relativeVelocity.dot(lineOfSight);
  const lateral = relativeVelocity.clone().addScaledVector(lineOfSight, -closing);
  const remainingDeltaV = missile.specificImpulseSeconds * STANDARD_GRAVITY * Math.log(missile.massKg / missile.structureMassKg);
  const velocityToGain = lineOfSight.multiplyScalar(Math.max(remainingDeltaV, 1)).sub(lateral);
  return velocityToGain.lengthSq() > 1e-9 ? velocityToGain.normalize() : null;
}
