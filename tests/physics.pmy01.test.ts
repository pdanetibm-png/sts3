import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FIXED_DT_SECONDS, integrateLinear } from "../src/sim/integrator";

// PHY-01 : sans force pendant 600 s, erreur relative de vitesse ≤ 1e-6 et de
// déplacement ≤ 1e-4 par rapport à la référence analytique (mouvement rectiligne uniforme).
describe("PHY-01 — inertie linéaire", () => {
  it("conserve la vitesse et suit le déplacement analytique sur 600 s sans force", () => {
    const durationSeconds = 600;
    const steps = Math.round(durationSeconds / FIXED_DT_SECONDS);
    const massKg = 200000;
    const initialVelocity = new Vector3(50, -3, 12);
    const zeroForce = new Vector3(0, 0, 0);

    const position = new Vector3(0, 0, 0);
    const velocity = initialVelocity.clone();

    for (let i = 0; i < steps; i++) {
      integrateLinear(position, velocity, zeroForce, massKg, FIXED_DT_SECONDS);
    }

    const analyticalPosition = initialVelocity.clone().multiplyScalar(durationSeconds);

    const velocityErrorRelative = velocity.clone().sub(initialVelocity).length() / Math.max(1, initialVelocity.length());
    const positionErrorRelative = position.clone().sub(analyticalPosition).length() / Math.max(1, analyticalPosition.length());

    expect(velocityErrorRelative).toBeLessThanOrEqual(1e-6);
    expect(positionErrorRelative).toBeLessThanOrEqual(1e-4);
  });

  it("reste exactement au repos sans force ni vitesse initiale", () => {
    const position = new Vector3(0, 0, 0);
    const velocity = new Vector3(0, 0, 0);
    const zeroForce = new Vector3(0, 0, 0);

    for (let i = 0; i < 60 * 600; i++) {
      integrateLinear(position, velocity, zeroForce, 200000, FIXED_DT_SECONDS);
    }

    expect(velocity.length()).toBe(0);
    expect(position.length()).toBe(0);
  });
});
