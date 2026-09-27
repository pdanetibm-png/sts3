import { describe, expect, it } from "vitest";
import { LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS, RigidBody } from "../src/sim/rigidBody";
import { stepLifeSupport } from "../src/sim/lifeSupport";
import { buildShipInit } from "./fixtures";

function withPowerStep(body: RigidBody, shedConsumerIds: string[]): void {
  body.lastPowerStep = {
    generatorOutputWatts: 0,
    batteryFlowWatts: 0,
    batteryStateOfChargeFraction: 0,
    demandWatts: 0,
    suppliedWatts: 0,
    shedConsumerIds,
    generatorFuelLimited: false,
    batteryEmpty: false,
  };
}

describe("RES-02 — autonomie de secours du support vie", () => {
  it("alimenté normalement (rien délesté), le décompte reste gelé à sa valeur initiale", () => {
    const body = new RigidBody(buildShipInit());
    withPowerStep(body, []);
    stepLifeSupport(body, 50);
    expect(body.lifeSupportRemainingAutonomySeconds).toBe(LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS);
    expect(body.lifeSupportFailed).toBe(false);
  });

  it("le délestage du groupe « vie » déclenche le décompte", () => {
    const body = new RigidBody(buildShipInit());
    withPowerStep(body, ["vie"]);
    stepLifeSupport(body, 30);
    expect(body.lifeSupportRemainingAutonomySeconds).toBe(LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS - 30);
    expect(body.lifeSupportFailed).toBe(false);
  });

  it("le délestage d'un autre groupe (ex. capteurs) ne décompte rien", () => {
    const body = new RigidBody(buildShipInit());
    withPowerStep(body, ["capteurs"]);
    stepLifeSupport(body, 30);
    expect(body.lifeSupportRemainingAutonomySeconds).toBe(LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS);
  });

  it("la restauration d'alimentation ARRÊTE le décompte — elle ne le recharge jamais", () => {
    const body = new RigidBody(buildShipInit());
    withPowerStep(body, ["vie"]);
    stepLifeSupport(body, 60);
    const remainingAfterOutage = body.lifeSupportRemainingAutonomySeconds;
    expect(remainingAfterOutage).toBeLessThan(LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS);

    withPowerStep(body, []); // alimentation restaurée
    stepLifeSupport(body, 1000);
    expect(body.lifeSupportRemainingAutonomySeconds).toBe(remainingAfterOutage);
  });

  it("épuisement à zéro : une seule fin d'échec, irréversible", () => {
    const body = new RigidBody(buildShipInit());
    withPowerStep(body, ["vie"]);
    stepLifeSupport(body, LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS + 10);
    expect(body.lifeSupportRemainingAutonomySeconds).toBe(0);
    expect(body.lifeSupportFailed).toBe(true);

    // Une fois en échec, plus aucun effet, même si l'alimentation revient.
    withPowerStep(body, []);
    stepLifeSupport(body, 1000);
    expect(body.lifeSupportFailed).toBe(true);
    expect(body.lifeSupportRemainingAutonomySeconds).toBe(0);
  });

  it("consommation courte sans épuisement : pas d'incapacité", () => {
    const body = new RigidBody(buildShipInit());
    withPowerStep(body, ["vie"]);
    stepLifeSupport(body, 5);
    expect(body.lifeSupportFailed).toBe(false);
    expect(body.lifeSupportRemainingAutonomySeconds).toBeGreaterThan(0);
  });
});
