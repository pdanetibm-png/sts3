import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FIXED_DT_SECONDS, integrateBody } from "../src/sim/integrator";
import { RigidBody } from "../src/sim/rigidBody";
import { buildShipInit } from "./fixtures";

// PHY-02 : rotation de 180° sans force linéaire ⇒ vecteur vitesse inchangé (tolérance PHY-01).
describe("PHY-02 — attitude séparée de la translation", () => {
  it("ne modifie pas le vecteur vitesse pendant une rotation de 180° sans poussée", () => {
    const initialVelocity: [number, number, number] = [50, -3, 12];
    const body = new RigidBody(buildShipInit({ velocity: initialVelocity }));

    body.command.throttle = 0;
    body.command.attitudeHoldEngaged = true;
    body.command.targetAttitude = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);

    const initialVelocityVec = body.velocity.clone();
    // Durée généreuse : avec des RCS réels (autorité de couple limitée), la convergence
    // vers l'attitude cible oscille avant de se stabiliser — on laisse le temps de le faire.
    const durationSeconds = 100;
    const steps = Math.round(durationSeconds / FIXED_DT_SECONDS);

    for (let i = 0; i < steps; i++) {
      integrateBody(body, FIXED_DT_SECONDS);
    }

    const velocityErrorRelative =
      body.velocity.clone().sub(initialVelocityVec).length() / Math.max(1, initialVelocityVec.length());
    expect(velocityErrorRelative).toBeLessThanOrEqual(1e-6);

    const angleFromStart = 2 * Math.acos(Math.min(1, Math.abs(body.attitude.w)));
    expect(angleFromStart).toBeGreaterThan(Math.PI / 2);
  });
});
