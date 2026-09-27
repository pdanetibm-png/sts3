import { describe, expect, it } from "vitest";
import { FIXED_DT_SECONDS, integrateBody } from "../src/sim/integrator";
import { RigidBody } from "../src/sim/rigidBody";
import { STANDARD_GRAVITY } from "../src/sim/thrusters";
import { buildShipInit, TEST_PRINCIPAL_THRUSTER } from "./fixtures";

// PHY-04 : à poussée constante, le débit de propergol suit F/(Isp·g0) à 0,1 % près,
// et la masse totale reste égale à la structure + les stocks à tout instant.
describe("PHY-04 — consommation et masse", () => {
  it("consomme le propergol au débit attendu et conserve la masse structure + réserve", () => {
    const body = new RigidBody(buildShipInit({ thrusters: [TEST_PRINCIPAL_THRUSTER] }));
    body.command.throttle = 1;

    const expectedMassFlowKgPerSecond = TEST_PRINCIPAL_THRUSTER.maxThrustNewtons / (TEST_PRINCIPAL_THRUSTER.specificImpulseSeconds * STANDARD_GRAVITY);

    const durationSeconds = 60;
    const steps = Math.round(durationSeconds / FIXED_DT_SECONDS);
    const initialQuantityKg = body.reservoir.quantityKg;

    for (let i = 0; i < steps; i++) {
      integrateBody(body, FIXED_DT_SECONDS);
      expect(body.massKg).toBeCloseTo(body.structure.dryMassKg + body.reservoir.quantityKg + body.storesMassKg, 9);
    }

    const consumedKg = initialQuantityKg - body.reservoir.quantityKg;
    const expectedConsumedKg = expectedMassFlowKgPerSecond * durationSeconds;
    const relativeError = Math.abs(consumedKg - expectedConsumedKg) / expectedConsumedKg;

    expect(relativeError).toBeLessThanOrEqual(0.001);
  });

  it("sans poussée, ne consomme aucun propergol", () => {
    const body = new RigidBody(buildShipInit({ thrusters: [TEST_PRINCIPAL_THRUSTER] }));
    body.command.throttle = 0;
    const initialQuantityKg = body.reservoir.quantityKg;

    for (let i = 0; i < 600; i++) integrateBody(body, FIXED_DT_SECONDS);

    // Seul le générateur peut prélever un peu de carburant pour l'énergie (section 4.3) ;
    // aucune consommation propulsive ne doit apparaître.
    expect(body.reservoir.quantityKg).toBeLessThanOrEqual(initialQuantityKg);
    expect(body.lastAllocation?.fuelFlowKgPerSecond ?? 0).toBe(0);
  });
});
