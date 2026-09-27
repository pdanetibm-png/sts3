import { Quaternion, Vector3 } from "three";
import { KnowledgeBase } from "../knowledge/knowledgeBase";
import type { NavMode } from "./navigation";
import { applyMountSaveState, createMountState, mountToSaveState, type PdcCommand, type PdcMountSaveState, type PdcMountState } from "./pdc";
import { equilibriumTemperatureK, jetPowerWatts, plumePeakIntensity, stepHullTemperature, type SignatureSource } from "./signature";
import { quatToTuple, tupleToQuat, tupleToVec3, vecToTuple, type QuatTuple, type Vec3Tuple } from "../shared/vecSerialization";
import type {
  Affiliation,
  BatteryDef,
  CrewDef,
  DecoyDef,
  DoctrineDef,
  ConsumerPriorityGroup,
  GeneratorDef,
  MissileDef,
  ReservoirDef,
  SensorDef,
  ShipInitialState,
  SignatureDef,
  StructureDef,
  ThrusterDef,
} from "./types";

/** Axe corps dominant de l'exposition G courante — section 4.4, diagnostic affiché au pilote. */
export type CrewExposureAxis = "x" | "y" | "z";

/** Autonomie d'urgence initiale du support vie (section 8.6, RES-02) — réglage de jeu, même
 * convention que ECHEANCE_SECONDS dans sim/mission.ts. */
export const LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS = 180;

/**
 * Tactique de leurre de l'IA (CONCEPTION_LEURRES.md §7) : « vecteur » = poussée avant largage,
 * « derive » = moteurs coupés et radar éteint après largage.
 */
export type DecoyTacticPhase = "aucune" | "vecteur" | "derive";

/** Mémoire de l'IA de combat (sim/combatAI.ts) — portée par le corps pour être sauvegardée. */
export interface CombatAIState {
  timeWithoutUsableTrackSeconds: number;
  timeSinceLastShotSeconds: number;
  timeSinceLastDecoySeconds: number;
  decoyPhase: DecoyTacticPhase;
  /** Temps restant de la phase en cours (en « vecteur » : durée de manœuvre restante avant largage). */
  decoyPhaseRemainingSeconds: number;
}

/** État sauvegardé d'un capteur — voir `SensorState` (mêmes champs, formes JSON-safe). */
export interface SensorStateSaveEntry {
  sensorId: string;
  enabled: boolean;
  cycleElapsedSeconds: number;
  scanDirectionWorld: Vec3Tuple;
  scanHalfAngleRad: number;
  followedTrackId: string | null;
}

/** État runtime complet d'un `RigidBody` (hors connaissance — voir knowledge/serialization.ts),
 * sérialisable en JSON pour la sauvegarde (section 10). */
export interface RigidBodySaveState {
  id: string;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
  attitude: QuatTuple;
  angularVelocity: Vec3Tuple;
  hullTemperatureK: number;
  missileCount: number;
  decoyCount: number;
  reservoirQuantityKg: number;
  batteryCurrentChargeWattSeconds: number;
  sensorStates: SensorStateSaveEntry[];
  command: {
    throttle: number;
    attitudeHoldEngaged: boolean;
    targetAttitude: QuatTuple;
    navMode?: NavMode;
    navTrackId?: string | null;
  };
  trail: Vec3Tuple[];
  crewExposureFraction: number;
  crewExposureTrendPerSecond: number;
  crewExposureDominantAxis: CrewExposureAxis | null;
  crewExposureIncapacitated: boolean;
  lifeSupportRemainingAutonomySeconds: number;
  lifeSupportFailed: boolean;
  /** Optionnel (sauvegardes antérieures) ; `null` = jamais tiré/largué (Infinity n'existe pas en JSON). */
  aiState?: {
    timeWithoutUsableTrackSeconds: number;
    timeSinceLastShotSeconds: number | null;
    timeSinceLastDecoySeconds: number | null;
    decoyPhase: DecoyTacticPhase;
    decoyPhaseRemainingSeconds: number;
  };
  /** Optionnel (sauvegardes antérieures au combat à plusieurs vaisseaux). */
  neutralized?: boolean;
  pdcMounts: PdcMountSaveState[];
  pdcCommand: PdcCommand;
}

/** État mutable d'un capteur — consigne persistante entre changements de poste (UX-02). */
export interface SensorState {
  enabled: boolean;
  cycleElapsedSeconds: number;
  /** Radar actif uniquement : direction/largeur du secteur balayé (repère monde). */
  scanDirectionWorld: Vector3;
  scanHalfAngleRad: number;
  /**
   * Piste suivie automatiquement (recentre le secteur sur elle chaque pas, section 5.2 —
   * « suivi »). Consigne persistante recalculée par la simulation elle-même (sim/detection.ts),
   * jamais par une console : elle doit continuer même quand Détection n'est plus le poste actif.
   */
  followedTrackId: string | null;
}

/** Consigne pilote courante — persiste entre changements de poste (UX-02). */
export interface PilotCommand {
  /** 0..1, fraction de la poussée principale max (propulseurs `kind: "principal"`). */
  throttle: number;
  /** Maintien d'attitude actif (section 4.2 — assistance retenue). */
  attitudeHoldEngaged: boolean;
  targetAttitude: Quaternion;
  /**
   * Mode de pilotage assisté (section 8.2) — consigne persistante recalculée par la simulation
   * elle-même (sim/navigation.ts), jamais par une console : elle continue même quand Pilotage
   * n'est plus le poste actif (UX-02).
   */
  navMode: NavMode;
  /** Piste de référence du mode (interception, évasion…). */
  navTrackId: string | null;
}

export interface ThrusterAllocationResult {
  forceWorld: Vector3;
  torqueBody: Vector3;
  fuelFlowKgPerSecond: number;
  /** Throttle effectif par propulseur, dans l'ordre de `body.thrusters` — diagnostic/affichage. */
  perThrusterThrottle: number[];
}

export interface PowerStepResult {
  generatorOutputWatts: number;
  /** Positif = charge la batterie, négatif = la décharge. */
  batteryFlowWatts: number;
  batteryStateOfChargeFraction: number;
  demandWatts: number;
  suppliedWatts: number;
  shedConsumerIds: string[];
  generatorFuelLimited: boolean;
  batteryEmpty: boolean;
}

export class RigidBody {
  readonly id: string;
  readonly name: string;
  readonly affiliation: Affiliation;
  readonly structure: StructureDef;
  readonly thrusters: ThrusterDef[];
  readonly reservoir: ReservoirDef;
  readonly generator: GeneratorDef;
  readonly battery: BatteryDef;
  readonly consumers: { id: string; label: string; nominalPowerWatts: number; priorityGroup: ConsumerPriorityGroup }[];
  readonly sensors: SensorDef[];
  readonly signature: SignatureDef;
  readonly crew: CrewDef;
  readonly doctrine: DoctrineDef;
  readonly designName: string | undefined;
  readonly sensorStates = new Map<string, SensorState>();
  /** Connaissance à bord de CE vaisseau (section 3.1) — jamais partagée entre observateurs. */
  readonly knowledge = new KnowledgeBase();
  /** Température de coque (K) — bilan thermique, voir sim/signature.ts (DET-05). */
  hullTemperatureK: number;
  readonly missile: MissileDef;
  /** Décrémenté à chaque lancement (ARM-01) — aucun réapprovisionnement automatique. */
  missileCount: number;
  /** Fiche des leurres embarqués (absente : aucun leurre). */
  readonly decoy: DecoyDef | undefined;
  /** Décrémenté à chaque largage — aucun réapprovisionnement. */
  decoyCount: number;
  /** Tourelles de défense rapprochée (CONCEPTION_PDC.md) — munitions, cible, pointage. */
  readonly pdcMounts: PdcMountState[];
  /** Consigne des tourelles, persistante entre postes (UX-02). Auto par défaut. */
  readonly pdcCommand: PdcCommand = { mode: "auto", manualTrackId: null };

  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly attitude: Quaternion;
  readonly angularVelocity: Vector3;

  readonly command: PilotCommand;

  /** Trajectoire déjà parcourue (repère monde), pour l'affichage "trait plein" section 8.2. */
  readonly trail: Vector3[] = [];

  /**
   * Exposition G cumulée de l'équipage (section 4.4, PHY-08) — 0..1, calculée par
   * sim/crewExposure.ts. S'applique aussi à l'adversaire habité (jamais aux missiles, qui
   * n'ont pas ces champs). `crewExposureIncapacitated` est un verrou irréversible pour la
   * mission (jamais remis à faux tant que le corps existe).
   */
  crewExposureFraction = 0;
  crewExposureTrendPerSecond = 0;
  crewExposureDominantAxis: CrewExposureAxis | null = null;
  crewExposureIncapacitated = false;

  /**
   * Autonomie de secours du support vie (section 8.6, RES-02) — décomptée par
   * sim/lifeSupport.ts uniquement pendant un délestage effectif du groupe "vie"
   * (jamais rechargée par une simple restauration d'alimentation, seulement figée).
   */
  lifeSupportRemainingAutonomySeconds = LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS;
  lifeSupportFailed = false;

  /**
   * Vaisseau hors de combat (impact, équipage incapacité, support vie épuisé) — irréversible.
   * Il dérive sur son élan, sans commande, capteur ni IA, et n'est plus une cible.
   */
  neutralized = false;

  readonly aiState: CombatAIState = {
    timeWithoutUsableTrackSeconds: 0,
    timeSinceLastShotSeconds: Number.POSITIVE_INFINITY,
    timeSinceLastDecoySeconds: Number.POSITIVE_INFINITY,
    decoyPhase: "aucune",
    decoyPhaseRemainingSeconds: 0,
  };

  /** Masse totale à pleine réserve — sert de référence pour l'échelle d'inertie. */
  private readonly referenceMassKg: number;

  lastAllocation: ThrusterAllocationResult | null = null;
  lastPowerStep: PowerStepResult | null = null;

  constructor(init: ShipInitialState) {
    this.id = init.id;
    this.name = init.name;
    this.affiliation = init.affiliation;
    this.structure = init.structure;
    this.thrusters = init.thrusters;
    this.reservoir = { ...init.reservoir };
    this.generator = init.generator;
    this.battery = { ...init.battery };
    this.consumers = init.consumers;
    this.sensors = init.sensors;
    this.signature = init.signature;
    this.doctrine = init.doctrine;
    this.crew = init.crew;
    this.designName = init.designName;
    // Départ à l'équilibre thermique du régime de croisière (charges électriques nominales).
    const nominalDemand = init.consumers.reduce((sum, c) => sum + c.nominalPowerWatts, 0);
    this.hullTemperatureK = equilibriumTemperatureK(init.signature.thermal, init.signature.thermal.baselineHeatWatts + generatorWasteHeat(init.generator, nominalDemand));
    this.missile = init.missile;
    this.missileCount = init.missileCount;
    this.decoy = init.decoy;
    this.decoyCount = init.decoy ? (init.decoyCount ?? 0) : 0;
    this.pdcMounts = (init.pdcs ?? []).map(createMountState);
    for (const sensor of init.sensors) {
      this.sensorStates.set(sensor.id, {
        enabled: false,
        cycleElapsedSeconds: 0,
        scanDirectionWorld: new Vector3(1, 0, 0),
        scanHalfAngleRad: Math.PI,
        followedTrackId: null,
      });
    }

    this.position = new Vector3(...init.position);
    this.velocity = new Vector3(...init.velocity);
    this.attitude = new Quaternion(...init.attitude).normalize();
    this.angularVelocity = new Vector3(...init.angularVelocity);
    this.command = {
      throttle: 0,
      attitudeHoldEngaged: false,
      targetAttitude: this.attitude.clone(),
      navMode: "manuel",
      navTrackId: null,
    };

    this.referenceMassKg = init.structure.dryMassKg + init.reservoir.capacityKg + this.storesMassKg;
  }

  /** Masse d'un missile en soute : celle qu'il emporte au lancement (PHY-06). */
  get missileUnitMassKg(): number {
    return this.missile.structureMassKg + this.missile.reservoir.quantityKg;
  }

  /** Masse d'un leurre en soute : cellule, propergol et charge IR. */
  get decoyUnitMassKg(): number {
    return this.decoy ? this.decoy.structureMassKg + this.decoy.reservoir.quantityKg + (this.decoy.irEmitter?.chargeKg ?? 0) : 0;
  }

  /** Munitions en soute (missiles et leurres) — quittent la masse du porteur à leur lancement. */
  get storesMassKg(): number {
    return this.missileCount * this.missileUnitMassKg + this.decoyCount * this.decoyUnitMassKg;
  }

  /** Masse totale courante = structure + propergol restant + munitions en soute (sections 4.1, PHY-06). */
  get massKg(): number {
    return this.structure.dryMassKg + this.reservoir.quantityKg + this.storesMassKg;
  }

  /**
   * Inertie mise à l'échelle par la fraction de masse courante par rapport à la masse
   * de référence (pleine réserve) — approximation documentée (section 4.1) qui évite de
   * modéliser une distribution de masse composite complète pour cette étape.
   */
  currentMomentOfInertia(): Vector3 {
    const scale = this.massKg / this.referenceMassKg;
    const [ix, iy, iz] = this.structure.momentOfInertiaKgM2;
    return new Vector3(ix * scale, iy * scale, iz * scale);
  }

  get principalThruster(): ThrusterDef {
    const principal = this.thrusters.find((t) => t.kind === "principal");
    if (!principal) throw new Error(`Vaisseau ${this.id} sans propulseur principal`);
    return principal;
  }

  /** Poussée effective du moteur principal au dernier pas (0..1). */
  get principalThrottle(): number {
    const index = this.thrusters.findIndex((t) => t.kind === "principal");
    return index >= 0 ? (this.lastAllocation?.perThrusterThrottle[index] ?? 0) : 0;
  }

  /** Axe avant en repère monde (sens de la poussée principale). */
  get forwardAxisWorld(): Vector3 {
    return new Vector3(...this.principalThruster.localAxis).normalize().applyQuaternion(this.attitude);
  }

  /** Chaleur dégagée ce pas-ci (W) : base, pertes du générateur, part du jet absorbée par la coque. */
  heatInputWatts(): number {
    const principal = this.principalThruster;
    const thrust = principal.maxThrustNewtons * this.principalThrottle;
    const jetHeat = jetPowerWatts(thrust, principal.specificImpulseSeconds) * (principal.wasteHeatFraction ?? 0);
    return this.signature.thermal.baselineHeatWatts + generatorWasteHeat(this.generator, this.lastPowerStep?.generatorOutputWatts ?? 0) + jetHeat;
  }

  stepThermal(dt: number): void {
    this.hullTemperatureK = stepHullTemperature(this.hullTemperatureK, this.signature.thermal, this.heatInputWatts(), dt);
  }

  signatureSource(): SignatureSource {
    const principal = this.principalThruster;
    return {
      position: this.position,
      signature: this.signature,
      hullTemperatureK: this.hullTemperatureK,
      plumePeakWattsPerSr: plumePeakIntensity(principal.maxThrustNewtons * this.principalThrottle, principal.specificImpulseSeconds, principal.plumeRadiantFraction ?? 0),
      forwardAxisWorld: this.forwardAxisWorld,
    };
  }

  neutralize(): void {
    this.neutralized = true;
    this.command.throttle = 0;
    this.command.attitudeHoldEngaged = false;
    this.command.navMode = "manuel";
    this.command.navTrackId = null;
    for (const state of this.sensorStates.values()) {
      state.enabled = false;
      state.followedTrackId = null;
    }
  }

  /** État runtime complet, JSON-safe (section 10) — la connaissance (pistes) se sauvegarde
   * séparément, voir knowledge/serialization.ts. */
  toSaveState(): RigidBodySaveState {
    return {
      id: this.id,
      position: vecToTuple(this.position),
      velocity: vecToTuple(this.velocity),
      attitude: quatToTuple(this.attitude),
      angularVelocity: vecToTuple(this.angularVelocity),
      hullTemperatureK: this.hullTemperatureK,
      missileCount: this.missileCount,
      decoyCount: this.decoyCount,
      reservoirQuantityKg: this.reservoir.quantityKg,
      batteryCurrentChargeWattSeconds: this.battery.currentChargeWattSeconds,
      sensorStates: Array.from(this.sensorStates.entries()).map(([sensorId, state]) => ({
        sensorId,
        enabled: state.enabled,
        cycleElapsedSeconds: state.cycleElapsedSeconds,
        scanDirectionWorld: vecToTuple(state.scanDirectionWorld),
        scanHalfAngleRad: state.scanHalfAngleRad,
        followedTrackId: state.followedTrackId,
      })),
      command: {
        throttle: this.command.throttle,
        attitudeHoldEngaged: this.command.attitudeHoldEngaged,
        targetAttitude: quatToTuple(this.command.targetAttitude),
        navMode: this.command.navMode,
        navTrackId: this.command.navTrackId,
      },
      trail: this.trail.map(vecToTuple),
      crewExposureFraction: this.crewExposureFraction,
      crewExposureTrendPerSecond: this.crewExposureTrendPerSecond,
      crewExposureDominantAxis: this.crewExposureDominantAxis,
      crewExposureIncapacitated: this.crewExposureIncapacitated,
      lifeSupportRemainingAutonomySeconds: this.lifeSupportRemainingAutonomySeconds,
      lifeSupportFailed: this.lifeSupportFailed,
      neutralized: this.neutralized,
      pdcMounts: this.pdcMounts.map(mountToSaveState),
      pdcCommand: { ...this.pdcCommand },
      aiState: {
        timeWithoutUsableTrackSeconds: this.aiState.timeWithoutUsableTrackSeconds,
        timeSinceLastShotSeconds: Number.isFinite(this.aiState.timeSinceLastShotSeconds) ? this.aiState.timeSinceLastShotSeconds : null,
        timeSinceLastDecoySeconds: Number.isFinite(this.aiState.timeSinceLastDecoySeconds) ? this.aiState.timeSinceLastDecoySeconds : null,
        decoyPhase: this.aiState.decoyPhase,
        decoyPhaseRemainingSeconds: this.aiState.decoyPhaseRemainingSeconds,
      },
    };
  }

  /** Applique un état sauvegardé sur un corps fraîchement construit depuis la définition de
   * scénario d'origine (même schéma que `predict.ts`'s `cloneForPrediction` : construire puis
   * corriger, la plupart des champs restant `readonly` en tant que références d'objet). */
  applySaveState(saved: RigidBodySaveState): void {
    this.position.copy(tupleToVec3(saved.position));
    this.velocity.copy(tupleToVec3(saved.velocity));
    this.attitude.copy(tupleToQuat(saved.attitude));
    this.angularVelocity.copy(tupleToVec3(saved.angularVelocity));
    this.hullTemperatureK = saved.hullTemperatureK;
    this.missileCount = saved.missileCount;
    this.decoyCount = saved.decoyCount;
    this.reservoir.quantityKg = saved.reservoirQuantityKg;
    this.battery.currentChargeWattSeconds = saved.batteryCurrentChargeWattSeconds;

    for (const entry of saved.sensorStates) {
      const state = this.sensorStates.get(entry.sensorId);
      if (!state) continue;
      state.enabled = entry.enabled;
      state.cycleElapsedSeconds = entry.cycleElapsedSeconds;
      state.scanDirectionWorld.copy(tupleToVec3(entry.scanDirectionWorld));
      state.scanHalfAngleRad = entry.scanHalfAngleRad;
      state.followedTrackId = entry.followedTrackId;
    }

    this.command.throttle = saved.command.throttle;
    this.command.attitudeHoldEngaged = saved.command.attitudeHoldEngaged;
    this.command.targetAttitude.copy(tupleToQuat(saved.command.targetAttitude));
    this.command.navMode = saved.command.navMode ?? "manuel";
    this.command.navTrackId = saved.command.navTrackId ?? null;

    this.trail.length = 0;
    for (const point of saved.trail) this.trail.push(tupleToVec3(point));

    this.crewExposureFraction = saved.crewExposureFraction;
    this.crewExposureTrendPerSecond = saved.crewExposureTrendPerSecond;
    this.crewExposureDominantAxis = saved.crewExposureDominantAxis;
    this.crewExposureIncapacitated = saved.crewExposureIncapacitated;
    this.lifeSupportRemainingAutonomySeconds = saved.lifeSupportRemainingAutonomySeconds;
    this.lifeSupportFailed = saved.lifeSupportFailed;
    this.neutralized = saved.neutralized ?? false;
    for (const entry of saved.pdcMounts) {
      const mount = this.pdcMounts.find((m) => m.id === entry.id);
      if (mount) applyMountSaveState(mount, entry);
    }
    this.pdcCommand.mode = saved.pdcCommand.mode;
    this.pdcCommand.manualTrackId = saved.pdcCommand.manualTrackId;
    if (saved.aiState) {
      this.aiState.timeWithoutUsableTrackSeconds = saved.aiState.timeWithoutUsableTrackSeconds;
      this.aiState.timeSinceLastShotSeconds = saved.aiState.timeSinceLastShotSeconds ?? Number.POSITIVE_INFINITY;
      this.aiState.timeSinceLastDecoySeconds = saved.aiState.timeSinceLastDecoySeconds ?? Number.POSITIVE_INFINITY;
      this.aiState.decoyPhase = saved.aiState.decoyPhase;
      this.aiState.decoyPhaseRemainingSeconds = saved.aiState.decoyPhaseRemainingSeconds;
    }
  }
}

/** Chaleur perdue par le générateur : ce qui n'est pas converti en électricité. */
export function generatorWasteHeat(generator: GeneratorDef, outputWatts: number): number {
  return outputWatts * (1 / Math.max(generator.efficiency, 1e-3) - 1);
}
