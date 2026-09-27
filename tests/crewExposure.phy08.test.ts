import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { stepCrewExposure } from "../src/sim/crewExposure";
import { RigidBody } from "../src/sim/rigidBody";
import { STANDARD_GRAVITY } from "../src/sim/thrusters";
import { buildShipInit, TEST_CREW } from "./fixtures";

/** Force qui produit `gMultiple`×G sur le corps de test (masse pleine réserve, axe X monde,
 * attitude identité — repère corps = repère monde). */
function forceForG(body: RigidBody, gMultiple: number): Vector3 {
  return new Vector3(body.massKg * gMultiple * STANDARD_GRAVITY, 0, 0);
}

function applyForce(body: RigidBody, forceWorld: Vector3): void {
  body.lastAllocation = { forceWorld, torqueBody: new Vector3(), fuelFlowKgPerSecond: 0, perThrusterThrottle: [] };
}

describe("PHY-07/PHY-08 — exposition G cumulée et incapacité d'équipage", () => {
  it("sous le seuil, aucune accumulation (juste une éventuelle récupération résiduelle)", () => {
    const body = new RigidBody(buildShipInit());
    applyForce(body, forceForG(body, TEST_CREW.gThreshold * 0.5));
    stepCrewExposure(body, 10);
    expect(body.crewExposureFraction).toBe(0);
    expect(body.crewExposureIncapacitated).toBe(false);
  });

  it("un dépassement soutenu accumule la charge au fil du temps", () => {
    const body = new RigidBody(buildShipInit());
    applyForce(body, forceForG(body, TEST_CREW.gThreshold * 2));
    stepCrewExposure(body, 1);
    const afterOneSecond = body.crewExposureFraction;
    expect(afterOneSecond).toBeGreaterThan(0);
    stepCrewExposure(body, 1);
    expect(body.crewExposureFraction).toBeGreaterThan(afterOneSecond);
  });

  it("repasser sous le seuil fait récupérer la charge progressivement", () => {
    const body = new RigidBody(buildShipInit());
    applyForce(body, forceForG(body, TEST_CREW.gThreshold * 2));
    stepCrewExposure(body, 5);
    const peak = body.crewExposureFraction;
    expect(peak).toBeGreaterThan(0);

    applyForce(body, new Vector3());
    stepCrewExposure(body, 5);
    expect(body.crewExposureFraction).toBeLessThan(peak);
  });

  it("une exposition prolongée atteint 100 % et incapacite irréversiblement l'équipage", () => {
    const body = new RigidBody(buildShipInit());
    applyForce(body, forceForG(body, TEST_CREW.gThreshold * 10));
    for (let i = 0; i < 60; i++) stepCrewExposure(body, 1);
    expect(body.crewExposureFraction).toBe(1);
    expect(body.crewExposureIncapacitated).toBe(true);

    // Verrou irréversible : même sans plus aucune poussée, l'incapacité persiste.
    applyForce(body, new Vector3());
    stepCrewExposure(body, 100);
    expect(body.crewExposureIncapacitated).toBe(true);
    expect(body.crewExposureFraction).toBe(1);
  });

  it("s'applique identiquement à un corps d'affiliation adversaire (section 4.4)", () => {
    const body = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire" }));
    applyForce(body, forceForG(body, TEST_CREW.gThreshold * 10));
    for (let i = 0; i < 60; i++) stepCrewExposure(body, 1);
    expect(body.crewExposureIncapacitated).toBe(true);
  });

  it("le délai estimé avant incapacité se déduit de la tendance affichée", () => {
    const body = new RigidBody(buildShipInit());
    applyForce(body, forceForG(body, TEST_CREW.gThreshold * 2));
    stepCrewExposure(body, 1);
    expect(body.crewExposureTrendPerSecond).toBeGreaterThan(0);
    const etaSeconds = (1 - body.crewExposureFraction) / body.crewExposureTrendPerSecond;
    expect(etaSeconds).toBeGreaterThan(0);
  });
});
