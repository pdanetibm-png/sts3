import type { RigidBody } from "../src/sim/rigidBody";
import type { SensorTarget } from "../src/sim/sensors";
import type { CrewDef, DecoyDef, DoctrineDef, MissileDef, PdcDef, SensorDef, ShipInitialState, SignatureDef, ThrusterDef } from "../src/sim/types";

/** Même disposition RCS que le scénario de démo (autorité 3 axes complète, vérifiée par PHY-03). */
export const TEST_RCS_THRUSTERS: ThrusterDef[] = [
  { id: "rcs-roll-pos-a", kind: "rcs", localPosition: [0, 8, 0], localAxis: [0, 0, 1], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-roll-pos-b", kind: "rcs", localPosition: [0, -8, 0], localAxis: [0, 0, -1], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-roll-neg-a", kind: "rcs", localPosition: [0, 8, 0], localAxis: [0, 0, -1], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-roll-neg-b", kind: "rcs", localPosition: [0, -8, 0], localAxis: [0, 0, 1], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-pitch-pos-a", kind: "rcs", localPosition: [0, 0, 8], localAxis: [1, 0, 0], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-pitch-pos-b", kind: "rcs", localPosition: [0, 0, -8], localAxis: [-1, 0, 0], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-pitch-neg-a", kind: "rcs", localPosition: [0, 0, 8], localAxis: [-1, 0, 0], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-pitch-neg-b", kind: "rcs", localPosition: [0, 0, -8], localAxis: [1, 0, 0], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-yaw-pos-a", kind: "rcs", localPosition: [8, 0, 0], localAxis: [0, 1, 0], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-yaw-pos-b", kind: "rcs", localPosition: [-8, 0, 0], localAxis: [0, -1, 0], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-yaw-neg-a", kind: "rcs", localPosition: [8, 0, 0], localAxis: [0, -1, 0], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
  { id: "rcs-yaw-neg-b", kind: "rcs", localPosition: [-8, 0, 0], localAxis: [0, 1, 0], maxThrustNewtons: 60000, specificImpulseSeconds: 300 },
];

export const TEST_PRINCIPAL_THRUSTER: ThrusterDef = {
  id: "principal",
  kind: "principal",
  localPosition: [0, 0, 0],
  localAxis: [1, 0, 0],
  maxThrustNewtons: 3000000,
  specificImpulseSeconds: 4000,
  plumeRadiantFraction: 0.0001,
  wasteHeatFraction: 0.0001,
};

/**
 * Capteurs à l'échelle des tests (quelques km) : mêmes lois que le catalogue, sensibilités
 * réglées pour retrouver les portées du duel du MVP — IR ≈ 8 km sur une coque moteurs coupés,
 * radar ≈ 10 km sur 200 m² en balayage large, écoute ≈ 30 km dans le faisceau.
 */
export const TEST_SENSORS: SensorDef[] = [
  {
    id: "ir-1",
    mode: "ir_passive",
    powerWatts: 200,
    cycleSeconds: 2,
    minFrameSeconds: 0.15,
    noiseEquivalentIrradianceWm2: 5.8e-7,
    fieldOfViewSr: 0.0003,
    pixelAngleRad: 0.05,
    bandFraction: 0.3,
  },
  { id: "listen-1", mode: "radar_passive", powerWatts: 150, cycleSeconds: 1.5, minFrameSeconds: 1.5, sensitivityWm2: 0.074, bearingAccuracyRad: 0.04 },
  {
    id: "radar-1",
    mode: "radar_active",
    powerWatts: 20000,
    cycleSeconds: 3,
    minFrameSeconds: 0.15,
    antennaAreaM2: 3,
    wavelengthMeters: 0.03,
    noiseTemperatureKelvin: 500,
    lossFactor: 1.66e8,
    requiredSnr: 20,
    rangeResolutionMeters: 15,
    sideLobeLevel: 0.001,
  },
];

export const TEST_SIGNATURE: SignatureDef = {
  thermal: { surfaceAreaM2: 1400, emissivity: 0.85, heatCapacityJoulesPerKelvin: 75000000, baselineHeatWatts: 50000 },
  radar: { crossSectionFrontM2: 200, crossSectionSideM2: 200 },
};

export const TEST_MISSILE: MissileDef = {
  structureMassKg: 150,
  reservoir: { capacityKg: 80, quantityKg: 80 },
  maxThrustNewtons: 15000,
  specificImpulseSeconds: 250,
  plumeRadiantFraction: 0.02,
  wasteHeatFraction: 0.001,
  signature: {
    thermal: { surfaceAreaM2: 4, emissivity: 0.8, heatCapacityJoulesPerKelvin: 180000, baselineHeatWatts: 200 },
    radar: { crossSectionFrontM2: 0.05, crossSectionSideM2: 0.4 },
  },
  presentedAreaFrontM2: 0.13,
  presentedAreaSideM2: 1.6,
};

/** Tourelle de défense rapprochée : mêmes caractéristiques que la fiche du catalogue. */
export const TEST_PDC: PdcDef = {
  name: "PDC de test",
  muzzleVelocityMps: 1500,
  rateOfFireRoundsPerSecond: 60,
  dispersionRad: 0.001,
  maxRangeMeters: 5000,
  magazineRounds: 3000,
  retargetSeconds: 1,
};

/** Doctrine à l'échelle des tests : portée d'engagement ≈ 8 km avec TEST_MISSILE. */
export const TEST_DOCTRINE: DoctrineDef = {
  searchDelaySeconds: 20,
  fireCooldownSeconds: 15,
  sectorHalfAngleRad: (10 * Math.PI) / 180,
  approachThrottle: 0.3,
  maxMissileFlightSeconds: 14,
  brakeClosingSpeedMps: 10,
  cruiseSpeedMps: 200,
  propellantReserveFraction: 0.3,
  wingmanMaxLeadMeters: 2000,
};

export const TEST_CREW: CrewDef = { gThreshold: 5, exposureAccumulationPerSecond: 0.1, exposureRecoveryPerSecond: 0.05 };

export function buildShipInit(overrides: Partial<ShipInitialState> = {}): ShipInitialState {
  return {
    id: "test",
    name: "Test",
    affiliation: "joueur",
    crew: TEST_CREW,
    doctrine: TEST_DOCTRINE,
    structure: {
      dryMassKg: 150000,
      momentOfInertiaKgM2: [4000000, 5000000, 4500000],
      collisionRadiusMeters: 25,
    },
    thrusters: [TEST_PRINCIPAL_THRUSTER, ...TEST_RCS_THRUSTERS],
    reservoir: { capacityKg: 50000, quantityKg: 50000 },
    generator: { maxPowerWatts: 500000, fuelConsumptionKgPerSecondAtMaxPower: 0.05, efficiency: 0.3 },
    battery: { capacityWattSeconds: 3600000, maxChargeRateWatts: 100000, maxDischargeRateWatts: 200000, currentChargeWattSeconds: 3600000 },
    consumers: [
      { id: "vie", label: "Support vie et commandes", nominalPowerWatts: 15000, priorityGroup: "vie" },
      { id: "rcs-aux", label: "Propulsion auxiliaire / RCS", nominalPowerWatts: 20000, priorityGroup: "propulsion_auxiliaire" },
      { id: "capteurs", label: "Capteurs", nominalPowerWatts: 30000, priorityGroup: "capteurs" },
      { id: "services", label: "Services secondaires", nominalPowerWatts: 10000, priorityGroup: "services" },
    ],
    sensors: TEST_SENSORS,
    signature: TEST_SIGNATURE,
    missileCount: 4,
    missile: TEST_MISSILE,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    attitude: [0, 0, 0, 1],
    angularVelocity: [0, 0, 0],
    ...overrides,
  };
}

/** Un vaisseau vu comme cible de capteur (sa signature au moment de l'appel). */
export function asTarget(body: RigidBody): SensorTarget {
  return { id: body.id, affiliation: body.affiliation, source: body.signatureSource() };
}

/** Leurre à réflecteurs à l'échelle des tests : écho de vaisseau (comme TEST_SIGNATURE), générateur IR. */
export const TEST_DECOY: DecoyDef = {
  name: "Leurre de test à réflecteurs",
  structureMassKg: 150,
  reservoir: { capacityKg: 200, quantityKg: 200 },
  maxThrustNewtons: 6000,
  specificImpulseSeconds: 300,
  plumeRadiantFraction: 0.02,
  wasteHeatFraction: 0.001,
  collisionRadiusMeters: 2,
  signature: {
    thermal: { surfaceAreaM2: 3, emissivity: 0.8, heatCapacityJoulesPerKelvin: 150000, baselineHeatWatts: 100 },
    radar: { crossSectionFrontM2: 150, crossSectionSideM2: 250 },
  },
  irEmitter: { maxRadiantPowerWatts: 1.5e6, chargeKg: 100, radiantEnergyJoulesPerKg: 2e6 },
  presentedAreaFrontM2: 0.8,
  presentedAreaSideM2: 1.0,
};

/** Leurre léger : écho de missile, pas de générateur. */
export const TEST_DECOY_LIGHT: DecoyDef = {
  name: "Leurre de test léger",
  structureMassKg: 40,
  reservoir: { capacityKg: 80, quantityKg: 80 },
  maxThrustNewtons: 1500,
  specificImpulseSeconds: 280,
  plumeRadiantFraction: 0.02,
  wasteHeatFraction: 0.001,
  collisionRadiusMeters: 1,
  signature: {
    thermal: { surfaceAreaM2: 1, emissivity: 0.8, heatCapacityJoulesPerKelvin: 40000, baselineHeatWatts: 30 },
    radar: { crossSectionFrontM2: 0.5, crossSectionSideM2: 1.5 },
  },
  presentedAreaFrontM2: 0.1,
  presentedAreaSideM2: 0.3,
};

/** Doctrine de test avec tactique de leurre. */
export const TEST_DECOY_DOCTRINE: DoctrineDef = {
  ...TEST_DOCTRINE,
  decoyThreatSeconds: 30,
  decoyVectorSeconds: 12,
  decoyDriftSeconds: 40,
  decoyCooldownSeconds: 60,
};
