import { describe, expect, it } from "vitest";
import { ScenarioValidationError, validateScenario } from "../src/sim/scenario";
import { TEST_DOCTRINE, TEST_MISSILE, TEST_SENSORS, TEST_SIGNATURE } from "./fixtures";

function baseShip(overrides: Record<string, unknown> = {}) {
  return {
    id: "joueur-1",
    name: "SCS Kestrel",
    affiliation: "joueur",
    crew: { gThreshold: 5, exposureAccumulationPerSecond: 0.1, exposureRecoveryPerSecond: 0.05 },
    structure: { dryMassKg: 150000, momentOfInertiaKgM2: [4e6, 5e6, 4.5e6], collisionRadiusMeters: 25 },
    thrusters: [
      { id: "principal", kind: "principal", localPosition: [0, 0, 0], localAxis: [1, 0, 0], maxThrustNewtons: 3e6, specificImpulseSeconds: 4000 },
      { id: "rcs-a", kind: "rcs", localPosition: [0, 8, 0], localAxis: [0, 0, 1], maxThrustNewtons: 5000, specificImpulseSeconds: 300 },
    ],
    reservoir: { capacityKg: 50000, quantityKg: 50000 },
    generator: { maxPowerWatts: 500000, fuelConsumptionKgPerSecondAtMaxPower: 0.05, efficiency: 0.3 },
    battery: { capacityWattSeconds: 3.6e6, maxChargeRateWatts: 100000, maxDischargeRateWatts: 200000, currentChargeWattSeconds: 3.6e6 },
    consumers: [{ id: "vie", label: "Support vie", nominalPowerWatts: 15000, priorityGroup: "vie" }],
    sensors: [TEST_SENSORS[0]],
    signature: TEST_SIGNATURE,
    missileCount: 4,
    missile: TEST_MISSILE,
    doctrine: TEST_DOCTRINE,
    position: [0, 0, 0],
    velocity: [50, 0, 0],
    attitude: [0, 0, 0, 1],
    angularVelocity: [0, 0, 0],
    ...overrides,
  };
}

function baseScenario(shipOverrides: Record<string, unknown>[] = [baseShip()]) {
  return {
    version: "0.1.0",
    seed: 42,
    objective: "Test",
    ships: shipOverrides,
  };
}

describe("validateScenario", () => {
  it("accepte un scénario conforme", () => {
    expect(() => validateScenario(baseScenario())).not.toThrow();
  });

  it("rejette une masse non positive", () => {
    const scenario = baseScenario([baseShip({ structure: { dryMassKg: 0, momentOfInertiaKgM2: [1, 1, 1] } })]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette une inertie non finie", () => {
    const scenario = baseScenario([
      baseShip({ structure: { dryMassKg: 1000, momentOfInertiaKgM2: [1, Number.NaN, 1] } }),
    ]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette une liste de vaisseaux vide", () => {
    expect(() => validateScenario(baseScenario([]))).toThrow(ScenarioValidationError);
  });

  it("rejette des identifiants de vaisseau dupliqués", () => {
    const scenario = baseScenario([baseShip(), baseShip({ affiliation: "adversaire" })]);
    expect(() => validateScenario(scenario)).toThrow(/dupliqué/);
  });

  it("rejette un document non-objet", () => {
    expect(() => validateScenario(null)).toThrow(ScenarioValidationError);
    expect(() => validateScenario("scenario")).toThrow(ScenarioValidationError);
  });

  it("rejette une affiliation invalide", () => {
    const scenario = baseScenario([baseShip({ affiliation: "civil" })]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette une liste de propulseurs vide", () => {
    const scenario = baseScenario([baseShip({ thrusters: [] })]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette l'absence de propulseur principal", () => {
    const scenario = baseScenario([
      baseShip({
        thrusters: [{ id: "rcs-a", kind: "rcs", localPosition: [0, 8, 0], localAxis: [0, 0, 1], maxThrustNewtons: 5000, specificImpulseSeconds: 300 }],
      }),
    ]);
    expect(() => validateScenario(scenario)).toThrow(/principal/);
  });

  it("rejette une réserve dont la quantité dépasse la capacité", () => {
    const scenario = baseScenario([baseShip({ reservoir: { capacityKg: 1000, quantityKg: 2000 } })]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette un générateur sans puissance positive", () => {
    const scenario = baseScenario([baseShip({ generator: { maxPowerWatts: 0, fuelConsumptionKgPerSecondAtMaxPower: 0.05 } })]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette un groupe de priorité de consommateur invalide", () => {
    const scenario = baseScenario([
      baseShip({ consumers: [{ id: "x", label: "X", nominalPowerWatts: 1000, priorityGroup: "inconnu" }] }),
    ]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette une liste de consommateurs vide", () => {
    const scenario = baseScenario([baseShip({ consumers: [] })]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette une liste de capteurs vide", () => {
    const scenario = baseScenario([baseShip({ sensors: [] })]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette un mode de capteur invalide", () => {
    const scenario = baseScenario([
      baseShip({
        sensors: [{ id: "x", mode: "sonar", cycleSeconds: 1, minFrameSeconds: 1, powerWatts: 10 }],
      }),
    ]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette une signature avec une capacité thermique non positive", () => {
    const scenario = baseScenario([
      baseShip({ signature: { ...TEST_SIGNATURE, thermal: { ...TEST_SIGNATURE.thermal, heatCapacityJoulesPerKelvin: 0 } } }),
    ]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette un rayon de collision non positif", () => {
    const scenario = baseScenario([
      baseShip({ structure: { dryMassKg: 150000, momentOfInertiaKgM2: [4e6, 5e6, 4.5e6], collisionRadiusMeters: 0 } }),
    ]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette un missileCount non entier ou négatif", () => {
    expect(() => validateScenario(baseScenario([baseShip({ missileCount: 2.5 })]))).toThrow(ScenarioValidationError);
    expect(() => validateScenario(baseScenario([baseShip({ missileCount: -1 })]))).toThrow(ScenarioValidationError);
  });

  it("rejette une définition de missile invalide", () => {
    const scenario = baseScenario([
      baseShip({ missile: { ...TEST_MISSILE, structureMassKg: 0 } }),
    ]);
    expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError);
  });

  it("rejette une distance initiale nulle entre le joueur et l'adversaire (ARM-06)", () => {
    const player = baseShip({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0] });
    const adversary = baseShip({ id: "adversaire-1", affiliation: "adversaire", position: [0, 0, 0] });
    expect(() => validateScenario(baseScenario([player, adversary]))).toThrow(/distance initiale/);
  });

  it("accepte une distance initiale non nulle entre le joueur et l'adversaire", () => {
    const player = baseShip({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0] });
    const adversary = baseShip({ id: "adversaire-1", affiliation: "adversaire", position: [1000, 0, 0] });
    expect(() => validateScenario(baseScenario([player, adversary]))).not.toThrow();
  });

  it("rejette un radar sans ses caractéristiques d'antenne, en nommant le champ manquant", () => {
    const radarWithoutAntenna = { ...TEST_SENSORS[2], antennaAreaM2: undefined };
    expect(() => validateScenario(baseScenario([baseShip({ sensors: [radarWithoutAntenna] })]))).toThrow(/antennaAreaM2/);
  });
});
