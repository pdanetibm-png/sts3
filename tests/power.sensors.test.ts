import { describe, expect, it } from "vitest";
import { stepDetection } from "../src/sim/detection";
import { FIXED_DT_SECONDS, integrateBody } from "../src/sim/integrator";
import { sensorElectricalWatts, sensorLoadId, sensorUnpowered, stepPower } from "../src/sim/power";
import { RigidBody } from "../src/sim/rigidBody";
import { createSeededRng } from "../src/sim/rng";
import { listenToEmitters } from "../src/sim/sensors";
import { buildShipInit, TEST_SENSORS } from "./fixtures";

const radarDef = TEST_SENSORS.find((s) => s.mode === "radar_active")!;
const irDef = TEST_SENSORS.find((s) => s.mode === "ir_passive")!;
// Comme au catalogue : plus de consommateur fixe « Capteurs », chaque capteur est sa propre charge.
const consumers = buildShipInit().consumers.filter((c) => c.id !== "capteurs");
const fixedDemand = consumers.reduce((sum, c) => sum + c.nominalPowerWatts, 0);

function ship(overrides: Parameters<typeof buildShipInit>[0] = {}) {
  return new RigidBody(buildShipInit({ id: "joueur-1", affiliation: "joueur", consumers, ...overrides }));
}

function enable(body: RigidBody, mode: string, on = true) {
  const sensor = body.sensors.find((s) => s.mode === mode)!;
  body.sensorStates.get(sensor.id)!.enabled = on;
  return sensor;
}

/** Plus de propergol et une batterie qui ne peut plus fournir que `watts` : il faudra délester. */
function starve(body: RigidBody, watts: number) {
  body.reservoir.quantityKg = 0;
  body.battery.maxDischargeRateWatts = watts;
}

// Section 4.3 : les capteurs sont des charges du réseau de bord, délestables par priorité.
describe("Capteurs et réseau électrique (section 4.3)", () => {
  it("un capteur ne consomme qu'en marche, selon sa fiche", () => {
    const body = ship();
    expect(stepPower(body, FIXED_DT_SECONDS).demandWatts).toBeCloseTo(fixedDemand, 6);
    enable(body, "radar_active");
    expect(stepPower(body, FIXED_DT_SECONDS).demandWatts).toBeCloseTo(fixedDemand + sensorElectricalWatts(radarDef), 6);
  });

  it("un radar allumé fait tourner le générateur plus fort, donc chauffe davantage la coque", () => {
    const off = ship();
    const on = ship();
    enable(on, "radar_active");
    integrateBody(off, FIXED_DT_SECONDS);
    integrateBody(on, FIXED_DT_SECONDS);
    expect(on.lastPowerStep!.generatorOutputWatts).toBeGreaterThan(off.lastPowerStep!.generatorOutputWatts);
    expect(on.heatInputWatts()).toBeGreaterThan(off.heatInputWatts());
  });

  it("en pénurie, les capteurs sont délestés avant la propulsion auxiliaire et la vie, le plus gourmand d'abord", () => {
    const body = ship();
    enable(body, "radar_active");
    enable(body, "ir_passive");
    // Assez pour tout sauf le radar et les services (10 kW).
    starve(body, fixedDemand - 10000 + sensorElectricalWatts(irDef));
    body.battery.currentChargeWattSeconds = 1e6;
    const power = stepPower(body, FIXED_DT_SECONDS);
    expect(power.shedConsumerIds).toContain("services");
    expect(power.shedConsumerIds).toContain(sensorLoadId("radar-1"));
    expect(power.shedConsumerIds).not.toContain(sensorLoadId("ir-1"));
    expect(power.shedConsumerIds).not.toContain("vie");
  });

  it("un capteur délesté ne mesure rien et son cycle en cours est interrompu", () => {
    const observer = ship();
    const target = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [3000, 0, 0], consumers }));
    const radar = enable(observer, "radar_active");
    starve(observer, 0);
    observer.battery.currentChargeWattSeconds = 0;
    const rng = createSeededRng(3);
    for (let i = 0; i < Math.round(10 / FIXED_DT_SECONDS); i++) {
      integrateBody(observer, FIXED_DT_SECONDS);
      stepDetection([observer, target], [], (i + 1) * FIXED_DT_SECONDS, FIXED_DT_SECONDS, rng);
    }
    expect(sensorUnpowered(observer, radar.id)).toBe(true);
    expect(observer.sensorStates.get(radar.id)!.cycleElapsedSeconds).toBe(0);
    expect(observer.knowledge.tracks.filter((t) => t.lastObservation.mode === "radar_active")).toHaveLength(0);
  });

  it("un radar délesté n'émet plus : l'écoute adverse ne l'entend pas", () => {
    const emitter = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [5000, 0, 0], consumers }));
    const listener = ship();
    const listen = enable(listener, "radar_passive");
    enable(emitter, "radar_active");
    integrateBody(emitter, FIXED_DT_SECONDS);
    expect(listenToEmitters(listener, [listener, emitter], listen, 0, () => 0)).toHaveLength(1);

    starve(emitter, 0);
    emitter.battery.currentChargeWattSeconds = 0;
    integrateBody(emitter, FIXED_DT_SECONDS);
    expect(sensorUnpowered(emitter, "radar-1")).toBe(true);
    expect(listenToEmitters(listener, [listener, emitter], listen, 0, () => 0)).toHaveLength(0);
  });
});
