import { Vector3 } from "three";
import { tupleToVec3, vecToTuple, type Vec3Tuple } from "../shared/vecSerialization";
import { jetPowerWatts, plumePeakIntensity, stepHullTemperature, type SignatureSource } from "./signature";
import type { Affiliation, DecoyDef, ReservoirDef } from "./types";

export type DecoyState = "poussee" | "derive" | "perdu_theatre" | "detruit";

export interface DecoyLaunchParams {
  id: string;
  ownerId: string;
  affiliation: Affiliation;
  position: Vector3;
  velocity: Vector3;
  def: DecoyDef;
  /** Axe de poussée du vaisseau au largage (unitaire, repère monde) — figé ensuite. */
  thrustDirectionWorld: Vector3;
  /** Accélération réelle du vaisseau au largage : celle que le leurre imite. */
  imitatedAccelerationMps2: number;
  /** Intensité du jet du vaisseau vue de l'arrière au largage (W/sr) : celle que le générateur imite. */
  imitatedPlumeWattsPerSr: number;
  simTime: number;
  /** Température de la cellule au largage : celle de la coque du porteur. */
  initialTemperatureK: number;
}

/** État runtime complet d'un `Decoy`, JSON-safe (section 10). La fiche vient du vaisseau propriétaire. */
export interface DecoySaveState {
  id: string;
  ownerId: string;
  affiliation: Affiliation;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
  thrustDirectionWorld: Vec3Tuple;
  imitatedAccelerationMps2: number;
  imitatedPlumeWattsPerSr: number;
  state: DecoyState;
  createdSimTime: number;
  thrustEndedSimTime: number | null;
  endedSimTime: number | null;
  destroyedByMissileId: string | null;
  reservoirQuantityKg: number;
  emitterChargeKg: number;
  hullTemperatureK: number;
  lastThrustNewtons: number;
  lastEmitterWattsPerSr: number;
  trail: Vec3Tuple[];
}

/**
 * Leurre (CONCEPTION_LEURRES.md) : corps léger sans attitude ni guidage, qui pousse le long d'une
 * direction figée en tenant l'accélération du vaisseau au largage. Vu des capteurs, c'est une
 * cible comme une autre — coque, jet, générateur de panache et écho radar de sa fiche.
 */
export class Decoy {
  readonly id: string;
  readonly ownerId: string;
  readonly affiliation: Affiliation;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly def: DecoyDef;
  readonly reservoir: ReservoirDef;
  emitterChargeKg: number;
  readonly thrustDirectionWorld: Vector3;
  readonly imitatedAccelerationMps2: number;
  readonly imitatedPlumeWattsPerSr: number;
  state: DecoyState = "poussee";
  readonly createdSimTime: number;
  /** Fin de la poussée (propergol épuisé, ou aucune poussée à imiter) — télémétrie. */
  thrustEndedSimTime: number | null = null;
  /** Fin de vie (impact, limite du théâtre). */
  endedSimTime: number | null = null;
  /** Vérité interne (analyse) : missile qui l'a percuté. */
  destroyedByMissileId: string | null = null;
  hullTemperatureK: number;
  /** Poussée et intensité du générateur au dernier pas (0 en dérive). */
  lastThrustNewtons = 0;
  lastEmitterWattsPerSr = 0;
  readonly trail: Vector3[] = [];

  constructor(params: DecoyLaunchParams) {
    this.id = params.id;
    this.ownerId = params.ownerId;
    this.affiliation = params.affiliation;
    this.position = params.position.clone();
    this.velocity = params.velocity.clone();
    this.def = params.def;
    this.reservoir = { ...params.def.reservoir };
    this.emitterChargeKg = params.def.irEmitter?.chargeKg ?? 0;
    this.thrustDirectionWorld = params.thrustDirectionWorld.clone().normalize();
    this.imitatedAccelerationMps2 = params.imitatedAccelerationMps2;
    this.imitatedPlumeWattsPerSr = params.imitatedPlumeWattsPerSr;
    this.createdSimTime = params.simTime;
    this.hullTemperatureK = params.initialTemperatureK;
  }

  get massKg(): number {
    return this.def.structureMassKg + this.reservoir.quantityKg + this.emitterChargeKg;
  }

  get isActive(): boolean {
    return this.state === "poussee" || this.state === "derive";
  }

  stepThermal(dt: number): void {
    const heat = this.def.signature.thermal.baselineHeatWatts + jetPowerWatts(this.lastThrustNewtons, this.def.specificImpulseSeconds) * this.def.wasteHeatFraction;
    this.hullTemperatureK = stepHullTemperature(this.hullTemperatureK, this.def.signature.thermal, heat, dt);
  }

  /** Jet propre du leurre au dernier pas, vu de l'arrière (W/sr). */
  get motorPlumeWattsPerSr(): number {
    return plumePeakIntensity(this.lastThrustNewtons, this.def.specificImpulseSeconds, this.def.plumeRadiantFraction);
  }

  signatureSource(): SignatureSource {
    return {
      position: this.position,
      signature: this.def.signature,
      hullTemperatureK: this.hullTemperatureK,
      plumePeakWattsPerSr: this.motorPlumeWattsPerSr + this.lastEmitterWattsPerSr,
      forwardAxisWorld: this.thrustDirectionWorld,
    };
  }

  toSaveState(): DecoySaveState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      affiliation: this.affiliation,
      position: vecToTuple(this.position),
      velocity: vecToTuple(this.velocity),
      thrustDirectionWorld: vecToTuple(this.thrustDirectionWorld),
      imitatedAccelerationMps2: this.imitatedAccelerationMps2,
      imitatedPlumeWattsPerSr: this.imitatedPlumeWattsPerSr,
      state: this.state,
      createdSimTime: this.createdSimTime,
      thrustEndedSimTime: this.thrustEndedSimTime,
      endedSimTime: this.endedSimTime,
      destroyedByMissileId: this.destroyedByMissileId,
      reservoirQuantityKg: this.reservoir.quantityKg,
      emitterChargeKg: this.emitterChargeKg,
      hullTemperatureK: this.hullTemperatureK,
      lastThrustNewtons: this.lastThrustNewtons,
      lastEmitterWattsPerSr: this.lastEmitterWattsPerSr,
      trail: this.trail.map(vecToTuple),
    };
  }

  /** Reconstruit un leurre sauvegardé — `def` vient du vaisseau propriétaire dans le scénario. */
  static fromSaveState(saved: DecoySaveState, def: DecoyDef): Decoy {
    const decoy = new Decoy({
      id: saved.id,
      ownerId: saved.ownerId,
      affiliation: saved.affiliation,
      position: tupleToVec3(saved.position),
      velocity: tupleToVec3(saved.velocity),
      def,
      thrustDirectionWorld: tupleToVec3(saved.thrustDirectionWorld),
      imitatedAccelerationMps2: saved.imitatedAccelerationMps2,
      imitatedPlumeWattsPerSr: saved.imitatedPlumeWattsPerSr,
      simTime: saved.createdSimTime,
      initialTemperatureK: saved.hullTemperatureK,
    });
    decoy.state = saved.state;
    decoy.thrustEndedSimTime = saved.thrustEndedSimTime;
    decoy.endedSimTime = saved.endedSimTime;
    decoy.destroyedByMissileId = saved.destroyedByMissileId;
    decoy.reservoir.quantityKg = saved.reservoirQuantityKg;
    decoy.emitterChargeKg = saved.emitterChargeKg;
    decoy.lastThrustNewtons = saved.lastThrustNewtons;
    decoy.lastEmitterWattsPerSr = saved.lastEmitterWattsPerSr;
    decoy.trail.push(...saved.trail.map(tupleToVec3));
    return decoy;
  }
}
