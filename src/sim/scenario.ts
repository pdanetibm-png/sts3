import { CatalogError, isScenarioFile, resolveScenario, validateCatalog } from "./catalog";
import type {
  ConsumerDef,
  ConsumerPriorityGroup,
  DecoyDef,
  MissileDef,
  PdcMountDef,
  ScenarioDefinition,
  SensorDef,
  SensorMode,
  ShipInitialState,
  SignatureDef,
  ThrusterDef,
  Vec3Tuple,
} from "./types";

const PRIORITY_GROUPS: ConsumerPriorityGroup[] = ["vie", "propulsion_auxiliaire", "capteurs", "services"];
const SENSOR_MODES: SensorMode[] = ["ir_passive", "radar_passive", "radar_active"];

export class ScenarioValidationError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Scénario invalide :\n- ${reasons.join("\n- ")}`);
    this.name = "ScenarioValidationError";
  }
}

function isFiniteVec3(v: unknown): v is Vec3Tuple {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function isFiniteQuat(v: unknown): v is [number, number, number, number] {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function validateThrusters(thrusters: unknown, reasons: string[], tag: string): void {
  if (!Array.isArray(thrusters) || thrusters.length === 0) {
    reasons.push(`${tag}.thrusters doit contenir au moins un propulseur`);
    return;
  }
  let hasPrincipal = false;
  thrusters.forEach((thruster: Partial<ThrusterDef>, i: number) => {
    const t = `${tag}.thrusters[${i}]`;
    if (typeof thruster.id !== "string" || thruster.id.length === 0) reasons.push(`${t}.id manquant`);
    if (thruster.kind !== "principal" && thruster.kind !== "rcs") reasons.push(`${t}.kind doit être "principal" ou "rcs"`);
    if (thruster.kind === "principal") hasPrincipal = true;
    if (!isFiniteVec3(thruster.localPosition)) reasons.push(`${t}.localPosition doit être un vecteur 3D fini`);
    if (!isFiniteVec3(thruster.localAxis)) reasons.push(`${t}.localAxis doit être un vecteur 3D fini`);
    if (typeof thruster.maxThrustNewtons !== "number" || !(thruster.maxThrustNewtons > 0)) {
      reasons.push(`${t}.maxThrustNewtons doit être strictement positif`);
    }
    if (typeof thruster.specificImpulseSeconds !== "number" || !(thruster.specificImpulseSeconds > 0)) {
      reasons.push(`${t}.specificImpulseSeconds doit être strictement positif`);
    }
  });
  if (!hasPrincipal) reasons.push(`${tag}.thrusters doit contenir au moins un propulseur "principal"`);
}

function validateReservoir(reservoir: unknown, reasons: string[], tag: string): void {
  const r = reservoir as { capacityKg?: unknown; quantityKg?: unknown } | undefined;
  if (!r || typeof r.capacityKg !== "number" || !(r.capacityKg > 0)) {
    reasons.push(`${tag}.reservoir.capacityKg doit être strictement positif`);
  }
  if (!r || typeof r.quantityKg !== "number" || r.quantityKg < 0 || (r.capacityKg !== undefined && r.quantityKg > (r.capacityKg as number))) {
    reasons.push(`${tag}.reservoir.quantityKg doit être compris entre 0 et la capacité`);
  }
}

function validateGenerator(generator: unknown, reasons: string[], tag: string): void {
  const g = generator as { maxPowerWatts?: unknown; fuelConsumptionKgPerSecondAtMaxPower?: unknown } | undefined;
  if (!g || typeof g.maxPowerWatts !== "number" || !(g.maxPowerWatts > 0)) {
    reasons.push(`${tag}.generator.maxPowerWatts doit être strictement positif`);
  }
  if (!g || typeof g.fuelConsumptionKgPerSecondAtMaxPower !== "number" || !(g.fuelConsumptionKgPerSecondAtMaxPower > 0)) {
    reasons.push(`${tag}.generator.fuelConsumptionKgPerSecondAtMaxPower doit être strictement positif`);
  }
  const efficiency = (generator as { efficiency?: unknown } | undefined)?.efficiency;
  if (typeof efficiency !== "number" || !(efficiency > 0 && efficiency <= 1)) {
    reasons.push(`${tag}.generator.efficiency doit être compris entre 0 (exclu) et 1`);
  }
}

function validateBattery(battery: unknown, reasons: string[], tag: string): void {
  const b = battery as
    | { capacityWattSeconds?: unknown; maxChargeRateWatts?: unknown; maxDischargeRateWatts?: unknown; currentChargeWattSeconds?: unknown }
    | undefined;
  if (!b || typeof b.capacityWattSeconds !== "number" || !(b.capacityWattSeconds > 0)) {
    reasons.push(`${tag}.battery.capacityWattSeconds doit être strictement positif`);
  }
  if (!b || typeof b.maxChargeRateWatts !== "number" || !(b.maxChargeRateWatts > 0)) {
    reasons.push(`${tag}.battery.maxChargeRateWatts doit être strictement positif`);
  }
  if (!b || typeof b.maxDischargeRateWatts !== "number" || !(b.maxDischargeRateWatts > 0)) {
    reasons.push(`${tag}.battery.maxDischargeRateWatts doit être strictement positif`);
  }
  if (
    !b ||
    typeof b.currentChargeWattSeconds !== "number" ||
    b.currentChargeWattSeconds < 0 ||
    (b.capacityWattSeconds !== undefined && b.currentChargeWattSeconds > (b.capacityWattSeconds as number))
  ) {
    reasons.push(`${tag}.battery.currentChargeWattSeconds doit être compris entre 0 et la capacité`);
  }
}

function validateConsumers(consumers: unknown, reasons: string[], tag: string): void {
  if (!Array.isArray(consumers) || consumers.length === 0) {
    reasons.push(`${tag}.consumers doit contenir au moins un consommateur`);
    return;
  }
  consumers.forEach((consumer: Partial<ConsumerDef>, i: number) => {
    const c = `${tag}.consumers[${i}]`;
    if (typeof consumer.id !== "string" || consumer.id.length === 0) reasons.push(`${c}.id manquant`);
    if (typeof consumer.label !== "string" || consumer.label.length === 0) reasons.push(`${c}.label manquant`);
    if (typeof consumer.nominalPowerWatts !== "number" || !(consumer.nominalPowerWatts > 0)) {
      reasons.push(`${c}.nominalPowerWatts doit être strictement positif`);
    }
    if (!consumer.priorityGroup || !PRIORITY_GROUPS.includes(consumer.priorityGroup)) {
      reasons.push(`${c}.priorityGroup doit être l'un de : ${PRIORITY_GROUPS.join(", ")}`);
    }
  });
}

function isPositive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function requireFields(obj: Record<string, unknown> | undefined, fields: string[], check: (v: unknown) => boolean, reasons: string[], tag: string, rule: string): void {
  for (const field of fields) {
    if (!obj || !check(obj[field])) reasons.push(`${tag}.${field} doit être ${rule}`);
  }
}

const SENSOR_FIELDS_BY_MODE: Record<SensorMode, string[]> = {
  ir_passive: ["noiseEquivalentIrradianceWm2", "fieldOfViewSr", "pixelAngleRad", "bandFraction"],
  radar_active: ["antennaAreaM2", "wavelengthMeters", "noiseTemperatureKelvin", "lossFactor", "requiredSnr", "rangeResolutionMeters", "sideLobeLevel"],
  radar_passive: ["sensitivityWm2", "bearingAccuracyRad"],
};

function validateSensors(sensors: unknown, reasons: string[], tag: string): void {
  if (!Array.isArray(sensors) || sensors.length === 0) {
    reasons.push(`${tag}.sensors doit contenir au moins un capteur`);
    return;
  }
  sensors.forEach((sensor: Partial<SensorDef>, i: number) => {
    const t = `${tag}.sensors[${i}]`;
    if (typeof sensor.id !== "string" || sensor.id.length === 0) reasons.push(`${t}.id manquant`);
    if (!sensor.mode || !SENSOR_MODES.includes(sensor.mode)) {
      reasons.push(`${t}.mode doit être l'un de : ${SENSOR_MODES.join(", ")}`);
      return;
    }
    const record = sensor as Record<string, unknown>;
    requireFields(record, ["powerWatts", "cycleSeconds", "minFrameSeconds"], isPositive, reasons, t, "strictement positif");
    if (record.electricalPowerWatts !== undefined) requireFields(record, ["electricalPowerWatts"], isPositive, reasons, t, "strictement positif");
    requireFields(record, SENSOR_FIELDS_BY_MODE[sensor.mode], isPositive, reasons, t, `strictement positif (${sensor.mode})`);
  });
}

function validateSignature(signature: unknown, reasons: string[], tag: string): void {
  const s = signature as Partial<SignatureDef> | undefined;
  const thermal = s?.thermal as Record<string, unknown> | undefined;
  requireFields(thermal, ["surfaceAreaM2", "emissivity", "heatCapacityJoulesPerKelvin"], isPositive, reasons, `${tag}.signature.thermal`, "strictement positif");
  requireFields(thermal, ["baselineHeatWatts"], isNonNegative, reasons, `${tag}.signature.thermal`, "positif ou nul");
  requireFields(s?.radar as Record<string, unknown> | undefined, ["crossSectionFrontM2", "crossSectionSideM2"], isPositive, reasons, `${tag}.signature.radar`, "strictement positif");
}

/** Surface physique présentée (cible des PDC) : optionnelle, mais strictement positive si donnée. */
function validatePresentedArea(obj: Record<string, unknown> | undefined, reasons: string[], tag: string): void {
  const present = ["presentedAreaFrontM2", "presentedAreaSideM2"].filter((f) => obj?.[f] !== undefined);
  requireFields(obj, present, isPositive, reasons, tag, "strictement positif");
}

function validatePdcs(pdcs: unknown, reasons: string[], tag: string): void {
  if (pdcs === undefined) return;
  if (!Array.isArray(pdcs)) {
    reasons.push(`${tag}.pdcs doit être une liste`);
    return;
  }
  const ids = new Set<string>();
  pdcs.forEach((mount: Partial<PdcMountDef>, i: number) => {
    const t = `${tag}.pdcs[${i}]`;
    if (typeof mount?.id !== "string" || mount.id.length === 0) reasons.push(`${t}.id manquant`);
    else if (ids.has(mount.id)) reasons.push(`${t}.id dupliqué « ${mount.id} »`);
    else ids.add(mount.id);
    const pdc = mount?.pdc as Record<string, unknown> | undefined;
    requireFields(pdc, ["muzzleVelocityMps", "rateOfFireRoundsPerSecond", "dispersionRad", "maxRangeMeters"], isPositive, reasons, `${t}.pdc`, "strictement positif");
    requireFields(pdc, ["retargetSeconds"], isNonNegative, reasons, `${t}.pdc`, "positif ou nul");
    if (!pdc || !(typeof pdc.magazineRounds === "number" && Number.isInteger(pdc.magazineRounds) && pdc.magazineRounds >= 0)) {
      reasons.push(`${t}.pdc.magazineRounds doit être un entier positif ou nul`);
    }
  });
}

function validateMissile(missile: unknown, reasons: string[], tag: string): void {
  const m = missile as (Partial<MissileDef> & Record<string, unknown>) | undefined;
  requireFields(m, ["structureMassKg", "maxThrustNewtons", "specificImpulseSeconds"], isPositive, reasons, `${tag}.missile`, "strictement positif");
  requireFields(m, ["plumeRadiantFraction", "wasteHeatFraction"], isNonNegative, reasons, `${tag}.missile`, "positif ou nul");
  validateReservoir(m?.reservoir, reasons, `${tag}.missile`);
  validateSignature(m?.signature, reasons, `${tag}.missile`);
  validatePresentedArea(m, reasons, `${tag}.missile`);
}

function validateDecoy(decoy: unknown, reasons: string[], tag: string): void {
  const d = decoy as (Partial<DecoyDef> & Record<string, unknown>) | undefined;
  if (!d || typeof d !== "object") {
    reasons.push(`${tag}.decoy est requis quand decoyCount > 0`);
    return;
  }
  requireFields(d, ["structureMassKg", "maxThrustNewtons", "specificImpulseSeconds", "collisionRadiusMeters"], isPositive, reasons, `${tag}.decoy`, "strictement positif");
  requireFields(d, ["plumeRadiantFraction", "wasteHeatFraction"], isNonNegative, reasons, `${tag}.decoy`, "positif ou nul");
  validateReservoir(d.reservoir, reasons, `${tag}.decoy`);
  validateSignature(d.signature, reasons, `${tag}.decoy`);
  validatePresentedArea(d, reasons, `${tag}.decoy`);
  if (d.irEmitter !== undefined) {
    const e = d.irEmitter as unknown as Record<string, unknown>;
    requireFields(e, ["maxRadiantPowerWatts", "radiantEnergyJoulesPerKg"], isPositive, reasons, `${tag}.decoy.irEmitter`, "strictement positif");
    requireFields(e, ["chargeKg"], isNonNegative, reasons, `${tag}.decoy.irEmitter`, "positif ou nul");
  }
}

function validateDoctrine(doctrine: unknown, reasons: string[], tag: string): void {
  const d = doctrine as Record<string, unknown> | undefined;
  requireFields(d, ["searchDelaySeconds", "fireCooldownSeconds", "sectorHalfAngleRad", "maxMissileFlightSeconds", "cruiseSpeedMps"], isPositive, reasons, `${tag}.doctrine`, "strictement positif");
  requireFields(d, ["approachThrottle", "brakeClosingSpeedMps", "wingmanMaxLeadMeters"], isNonNegative, reasons, `${tag}.doctrine`, "positif ou nul");
  // Tactique de leurre : champs optionnels, mais valides s'ils sont donnés.
  const presentDecoyFields = (fields: string[]) => fields.filter((f) => d?.[f] !== undefined);
  requireFields(d, presentDecoyFields(["decoyThreatSeconds", "decoyDriftSeconds", "terminalDefenseSeconds"]), isPositive, reasons, `${tag}.doctrine`, "strictement positif");
  requireFields(d, presentDecoyFields(["decoyVectorSeconds", "decoyCooldownSeconds"]), isNonNegative, reasons, `${tag}.doctrine`, "positif ou nul");
  if (d && !(typeof d.propellantReserveFraction === "number" && d.propellantReserveFraction >= 0 && d.propellantReserveFraction < 1)) {
    reasons.push(`${tag}.doctrine.propellantReserveFraction doit être dans [0, 1[`);
  }
}

function validateShip(ship: unknown, reasons: string[], index: number): void {
  const tag = `vaisseau[${index}]`;
  if (typeof ship !== "object" || ship === null) {
    reasons.push(`${tag} : entrée invalide`);
    return;
  }
  const s = ship as Partial<ShipInitialState>;

  if (typeof s.id !== "string" || s.id.length === 0) reasons.push(`${tag}.id manquant`);
  if (typeof s.name !== "string" || s.name.length === 0) reasons.push(`${tag}.name manquant`);
  const crew = s.crew;
  if (!crew || !(crew.gThreshold > 0)) reasons.push(`${tag}.crew.gThreshold doit être strictement positif`);
  if (!crew || !(crew.exposureAccumulationPerSecond >= 0)) reasons.push(`${tag}.crew.exposureAccumulationPerSecond doit être positif ou nul`);
  if (!crew || !(crew.exposureRecoveryPerSecond >= 0)) reasons.push(`${tag}.crew.exposureRecoveryPerSecond doit être positif ou nul`);
  if (s.affiliation !== "joueur" && s.affiliation !== "allie" && s.affiliation !== "adversaire") {
    reasons.push(`${tag}.affiliation doit être "joueur", "allie" ou "adversaire"`);
  }

  if (!s.structure || typeof s.structure.dryMassKg !== "number" || !(s.structure.dryMassKg > 0)) {
    reasons.push(`${tag}.structure.dryMassKg doit être strictement positif`);
  }
  if (!s.structure || !isFiniteVec3(s.structure.momentOfInertiaKgM2) || s.structure.momentOfInertiaKgM2.some((n) => !(n > 0))) {
    reasons.push(`${tag}.structure.momentOfInertiaKgM2 doit contenir 3 valeurs strictement positives`);
  }
  if (!s.structure || typeof s.structure.collisionRadiusMeters !== "number" || !(s.structure.collisionRadiusMeters > 0)) {
    reasons.push(`${tag}.structure.collisionRadiusMeters doit être strictement positif`);
  }

  validateThrusters(s.thrusters, reasons, tag);
  validateReservoir(s.reservoir, reasons, tag);
  validateGenerator(s.generator, reasons, tag);
  validateBattery(s.battery, reasons, tag);
  validateConsumers(s.consumers, reasons, tag);
  validateSensors(s.sensors, reasons, tag);
  validateSignature(s.signature, reasons, tag);
  validateMissile(s.missile, reasons, tag);
  validateDoctrine(s.doctrine, reasons, tag);
  validatePdcs(s.pdcs, reasons, tag);
  if (typeof s.missileCount !== "number" || !Number.isInteger(s.missileCount) || s.missileCount < 0) {
    reasons.push(`${tag}.missileCount doit être un entier positif ou nul`);
  }
  if (s.decoyCount !== undefined) {
    if (typeof s.decoyCount !== "number" || !Number.isInteger(s.decoyCount) || s.decoyCount < 0) {
      reasons.push(`${tag}.decoyCount doit être un entier positif ou nul`);
    } else if (s.decoyCount > 0) {
      validateDecoy(s.decoy, reasons, tag);
    }
  }

  if (!isFiniteVec3(s.position)) reasons.push(`${tag}.position doit être un vecteur 3D fini`);
  if (!isFiniteVec3(s.velocity)) reasons.push(`${tag}.velocity doit être un vecteur 3D fini`);
  if (!isFiniteQuat(s.attitude)) reasons.push(`${tag}.attitude doit être un quaternion fini (x,y,z,w)`);
  if (!isFiniteVec3(s.angularVelocity)) reasons.push(`${tag}.angularVelocity doit être un vecteur 3D fini`);
}

/** Valide un scénario au chargement (section 10) : rejet explicite, pas d'effacement silencieux. */
export function validateScenario(candidate: unknown): ScenarioDefinition {
  const reasons: string[] = [];

  if (typeof candidate !== "object" || candidate === null) {
    throw new ScenarioValidationError(["document scénario absent ou invalide"]);
  }
  const s = candidate as Partial<ScenarioDefinition>;

  if (typeof s.version !== "string" || s.version.length === 0) reasons.push("version manquante");
  if (typeof s.seed !== "number" || !Number.isFinite(s.seed)) reasons.push("seed doit être un nombre fini");
  if (typeof s.objective !== "string" || s.objective.length === 0) reasons.push("objective manquant");
  if (!Array.isArray(s.ships) || s.ships.length === 0) {
    reasons.push("ships doit contenir au moins un vaisseau");
  } else {
    s.ships.forEach((ship, index) => validateShip(ship, reasons, index));
    const ids = new Set<string>();
    for (const ship of s.ships as ShipInitialState[]) {
      if (ship && typeof ship.id === "string") {
        if (ids.has(ship.id)) reasons.push(`id de vaisseau dupliqué : ${ship.id}`);
        ids.add(ship.id);
      }
    }

    const ships = s.ships as ShipInitialState[];
    if (ships.filter((ship) => ship?.affiliation === "joueur").length > 1) reasons.push("un seul vaisseau « joueur » est autorisé");

    // ARM-06 : la taille du théâtre dérive de la séparation des camps — une distance nulle est refusée.
    const blue = ships.filter((ship) => ship && ship.affiliation !== "adversaire" && isFiniteVec3(ship.position));
    const red = ships.filter((ship) => ship?.affiliation === "adversaire" && isFiniteVec3(ship.position));
    if (blue.length > 0 && red.length > 0) {
      const mean = (group: ShipInitialState[], axis: number) => group.reduce((sum, ship) => sum + ship.position[axis], 0) / group.length;
      const distance = Math.hypot(mean(blue, 0) - mean(red, 0), mean(blue, 1) - mean(red, 1), mean(blue, 2) - mean(red, 2));
      if (distance < 1e-6) {
        reasons.push("la distance initiale entre les deux camps ne doit pas être nulle");
      }
    }
  }

  if (reasons.length > 0) throw new ScenarioValidationError(reasons);
  return candidate as ScenarioDefinition;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ScenarioValidationError([`impossible de charger ${url} (HTTP ${response.status})`]);
  }
  return response.json();
}

/**
 * Charge un scénario. S'il fait référence à un catalogue de matériel, celui-ci est chargé et
 * les assemblages résolus ; le résultat passe ensuite la même validation physique qu'un
 * scénario autonome (celui qu'embarquent les sauvegardes).
 */
export async function loadScenario(url: string): Promise<ScenarioDefinition> {
  const json = await fetchJson(url);
  if (!isScenarioFile(json)) return validateScenario(json);
  const catalogUrl = new URL(json.catalog, new URL(url, window.location.href)).toString();
  try {
    const catalog = validateCatalog(await fetchJson(catalogUrl));
    return validateScenario(resolveScenario(json, catalog));
  } catch (error) {
    if (error instanceof CatalogError) throw new ScenarioValidationError(error.reasons);
    throw error;
  }
}
