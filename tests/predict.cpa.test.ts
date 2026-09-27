import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { closestApproach, predictTrajectory, type PredictedPoint } from "../src/sim/predict";
import { RigidBody } from "../src/sim/rigidBody";
import { buildShipInit } from "./fixtures";

const straight = (velocity: Vector3, horizon: number, samples = 10): PredictedPoint[] =>
  Array.from({ length: samples + 1 }, (_, i) => {
    const t = (horizon * i) / samples;
    return { t, position: velocity.clone().multiplyScalar(t) };
  });

describe("Point d'approche au plus près (affichage pilotage)", () => {
  it("croisement à angle droit : distance minimale et instant exacts entre deux échantillons", () => {
    // Moi : +x à 100 m/s depuis l'origine. Lui : part de (1000, -1050, 0) vers +y à 100 m/s.
    const cpa = closestApproach(straight(new Vector3(100, 0, 0), 30, 7), new Vector3(1000, -1050, 0), new Vector3(0, 100, 0))!;
    // Relatif : (100t − 1000, 1050 − 100t) ⇒ minimum à t = 10,25 s, distance 50/√2 ≈ 35,4 m.
    expect(cpa.t).toBeCloseTo(10.25, 6);
    expect(cpa.distanceMeters).toBeCloseTo(50 / Math.SQRT2, 6);
    expect(cpa.beyondHorizon).toBe(false);
  });

  it("contact qui s'éloigne : le plus près, c'est maintenant", () => {
    const cpa = closestApproach(straight(new Vector3(0, 0, 0), 60), new Vector3(5000, 0, 0), new Vector3(100, 0, 0))!;
    expect(cpa.t).toBe(0);
    expect(cpa.distanceMeters).toBeCloseTo(5000, 6);
  });

  it("rapprochement qui dure au-delà de l'horizon : signalé comme tel", () => {
    const cpa = closestApproach(straight(new Vector3(100, 0, 0), 60), new Vector3(100000, 0, 0), new Vector3())!;
    expect(cpa.beyondHorizon).toBe(true);
    expect(cpa.distanceMeters).toBeCloseTo(94000, 6);
  });

  it("s'applique à la trajectoire prédite du vaisseau (poussée comprise)", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0], velocity: [0, 0, 0] }));
    body.command.throttle = 0.5;
    const points = predictTrajectory(body, 120);
    const cpa = closestApproach(points, points[points.length - 1].position.clone(), new Vector3())!;
    expect(cpa.distanceMeters).toBeLessThan(1e-6);
    expect(cpa.t).toBeCloseTo(120, 6);
  });
});
