import { describe, expect, it } from "vitest";
import { FIXED_DT_SECONDS, integrateBody } from "../src/sim/integrator";
import { RigidBody } from "../src/sim/rigidBody";
import { STANDARD_GRAVITY } from "../src/sim/thrusters";
import { buildShipInit, TEST_PRINCIPAL_THRUSTER } from "./fixtures";

// PHY-05 : réservoir presque vide ⇒ jamais de valeur négative, et aucune poussée au-delà
// de l'instant d'épuisement (tolérance un pas de temps).
describe("PHY-05 — épuisement du propergol", () => {
  it("épuise la réserve sans jamais la faire passer sous zéro, et coupe la poussée exactement à l'épuisement", () => {
    const massFlowAtFullThrottle = TEST_PRINCIPAL_THRUSTER.maxThrustNewtons / (TEST_PRINCIPAL_THRUSTER.specificImpulseSeconds * STANDARD_GRAVITY);
    const stepsUntilExhaustion = 5;
    const initialQuantityKg = massFlowAtFullThrottle * FIXED_DT_SECONDS * stepsUntilExhaustion;

    const body = new RigidBody(
      buildShipInit({
        thrusters: [TEST_PRINCIPAL_THRUSTER],
        reservoir: { capacityKg: 50000, quantityKg: initialQuantityKg },
      }),
    );
    body.command.throttle = 1;

    let exhaustedAtStep = -1;
    for (let i = 0; i < stepsUntilExhaustion + 20; i++) {
      integrateBody(body, FIXED_DT_SECONDS);
      expect(body.reservoir.quantityKg).toBeGreaterThanOrEqual(0);
      if (exhaustedAtStep === -1 && body.reservoir.quantityKg === 0) exhaustedAtStep = i;
      if (exhaustedAtStep !== -1 && i > exhaustedAtStep) {
        // Après épuisement, plus aucune force/couple ne doit provenir du propulseur principal.
        expect(body.lastAllocation?.forceWorld.length() ?? 0).toBe(0);
      }
    }

    expect(exhaustedAtStep).toBeGreaterThanOrEqual(0);
    expect(exhaustedAtStep).toBeLessThanOrEqual(stepsUntilExhaustion);
    expect(body.reservoir.quantityKg).toBe(0);
  });
});
