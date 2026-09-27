import { describe, expect, it } from "vitest";
import { RigidBody } from "../src/sim/rigidBody";
import { stepPower } from "../src/sim/power";
import { buildShipInit } from "./fixtures";

const DT = 1;

// RES-01 : surplus recharge la batterie dans ses limites ; déficit la décharge dans ses
// limites ; saturation déleste par priorité (jamais "vie" avant les autres groupes) ;
// batterie vide ne fournit aucune énergie négative.
describe("RES-01 — puissance et énergie", () => {
  it("un surplus de production recharge la batterie sans dépasser son débit de charge max", () => {
    const body = new RigidBody(
      buildShipInit({
        generator: { maxPowerWatts: 200000, efficiency: 0.3, fuelConsumptionKgPerSecondAtMaxPower: 0.05 },
        battery: { capacityWattSeconds: 3600000, maxChargeRateWatts: 100000, maxDischargeRateWatts: 200000, currentChargeWattSeconds: 1000000 },
      }),
    );

    const result = stepPower(body, DT);

    expect(result.shedConsumerIds).toEqual([]);
    expect(result.batteryFlowWatts).toBeCloseTo(100000, 6);
    expect(result.batteryFlowWatts).toBeLessThanOrEqual(100000 + 1e-6);
  });

  it("un déficit décharge la batterie sans dépasser son débit de décharge max, sans délestage si la capacité suffit", () => {
    const body = new RigidBody(
      buildShipInit({
        generator: { maxPowerWatts: 30000, efficiency: 0.3, fuelConsumptionKgPerSecondAtMaxPower: 0.05 },
        battery: { capacityWattSeconds: 3600000, maxChargeRateWatts: 100000, maxDischargeRateWatts: 200000, currentChargeWattSeconds: 1800000 },
      }),
    );

    const result = stepPower(body, DT);

    expect(result.shedConsumerIds).toEqual([]);
    expect(result.batteryFlowWatts).toBeCloseTo(-45000, 6);
    expect(Math.abs(result.batteryFlowWatts)).toBeLessThanOrEqual(200000);
  });

  it("délestage par priorité quand générateur + batterie sont insuffisants — jamais « vie » avant les autres groupes", () => {
    const body = new RigidBody(
      buildShipInit({
        generator: { maxPowerWatts: 10000, efficiency: 0.3, fuelConsumptionKgPerSecondAtMaxPower: 0.05 },
        battery: { capacityWattSeconds: 3600000, maxChargeRateWatts: 100000, maxDischargeRateWatts: 200000, currentChargeWattSeconds: 5000 },
      }),
    );

    const result = stepPower(body, DT);

    expect(result.shedConsumerIds).toEqual(expect.arrayContaining(["services", "capteurs", "rcs-aux"]));
    expect(result.shedConsumerIds).not.toContain("vie");
    expect(result.suppliedWatts).toBeLessThanOrEqual(result.generatorOutputWatts + 5000 + 1e-6);
  });

  it("batterie vide et générateur en panne : délestage total, aucune charge négative", () => {
    const body = new RigidBody(
      buildShipInit({
        generator: { maxPowerWatts: 1e-9, efficiency: 0.3, fuelConsumptionKgPerSecondAtMaxPower: 0.001 },
        battery: { capacityWattSeconds: 3600000, maxChargeRateWatts: 100000, maxDischargeRateWatts: 200000, currentChargeWattSeconds: 0 },
      }),
    );

    const result = stepPower(body, DT);

    expect(result.shedConsumerIds).toContain("vie");
    expect(result.suppliedWatts).toBeCloseTo(0, 3);
    expect(body.battery.currentChargeWattSeconds).toBeGreaterThanOrEqual(0);
    expect(result.batteryEmpty).toBe(true);
  });

  it("le générateur cesse de produire au-delà de ce que permet le carburant restant", () => {
    const body = new RigidBody(
      buildShipInit({
        generator: { maxPowerWatts: 500000, efficiency: 0.3, fuelConsumptionKgPerSecondAtMaxPower: 1 },
        reservoir: { capacityKg: 50000, quantityKg: 0.1 },
        battery: { capacityWattSeconds: 3600000, maxChargeRateWatts: 100000, maxDischargeRateWatts: 200000, currentChargeWattSeconds: 3600000 },
      }),
    );

    const result = stepPower(body, DT);

    expect(result.generatorFuelLimited).toBe(true);
    expect(result.generatorOutputWatts).toBeLessThanOrEqual(500000 * 0.1);
    expect(body.reservoir.quantityKg).toBeGreaterThanOrEqual(0);
  });
});
