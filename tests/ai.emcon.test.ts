import { describe, expect, it } from "vitest";
import catalogJson from "../public/catalog/catalogue.json";
import scenarioJson from "../public/scenarios/demo-duel.json";
import { resolveScenario, validateCatalog, type ScenarioFile } from "../src/sim/catalog";
import { ownDetectability } from "../src/sim/detectability";
import type { ScenarioDefinition } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";

function demoScenario(): ScenarioDefinition {
  const catalog = validateCatalog(JSON.parse(JSON.stringify(catalogJson)));
  return resolveScenario(JSON.parse(JSON.stringify(scenarioJson)) as ScenarioFile, catalog);
}

/** Fraction des pas où le radar de l'adversaire émet, sur `seconds` de simulation. */
function enemyRadarDuty(world: SimulationWorld, seconds: number): number {
  const enemy = world.bodies.find((b) => b.affiliation === "adversaire")!;
  const radar = enemy.sensors.find((s) => s.mode === "radar_active")!;
  let on = 0;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    world.stepOnce();
    if (enemy.sensorStates.get(radar.id)!.enabled) on++;
  }
  return on / steps;
}

describe("Discipline d'émission de l'IA (doctrine radarBurstIntervalSeconds)", () => {
  it("à 3 000 km, sur une piste IR au gisement seul, le radar n'émet que par brèves impulsions", () => {
    const world = new SimulationWorld(demoScenario());
    const duty = enemyRadarDuty(world, 300);
    expect(duty).toBeGreaterThan(0);
    expect(duty).toBeLessThan(0.05);
    // Le joueur, à l'écoute, ne l'entend donc que par intermittence.
  });

  it("sans cette doctrine, le même radar émet en continu", () => {
    const scenario = demoScenario();
    for (const ship of scenario.ships) delete ship.doctrine.radarBurstIntervalSeconds;
    expect(enemyRadarDuty(new SimulationWorld(scenario), 300)).toBeGreaterThan(0.9);
  });

  it("une cible à portée radar : une impulsion la mesure, puis le radar la tient en continu", () => {
    const scenario = demoScenario();
    const enemy = scenario.ships.find((s) => s.affiliation === "adversaire")!;
    enemy.position = [600e3, 50e3, 0];
    const world = new SimulationWorld(scenario);
    enemyRadarDuty(world, 120);
    expect(enemyRadarDuty(world, 60)).toBeGreaterThan(0.9);
  });
});

describe("Discrétion — ce que révèlent nos émissions et notre chaleur", () => {
  it("corvette de la démo : radar entendu à des centaines de milliers de km dans son faisceau, IR vu à des milliers de km", () => {
    const world = new SimulationWorld(demoScenario());
    const player = world.getBody("joueur-1")!;
    world.stepOnce();
    const idle = ownDetectability(player);
    expect(idle.radarEmitting).toBe(false);
    expect(idle.radarHeardInBeamMeters!).toBeGreaterThan(200e6);
    expect(idle.radarHeardOutOfBeamMeters!).toBeGreaterThan(5e6);
    expect(idle.radarHeardOutOfBeamMeters!).toBeLessThan(idle.radarHeardInBeamMeters!);
    expect(idle.infraredFrontMeters!).toBeGreaterThan(3e6);

    // Moteur allumé : le jet se voit de bien plus loin depuis l'arrière.
    player.command.throttle = 1;
    for (let i = 0; i < 60; i++) world.stepOnce();
    const thrusting = ownDetectability(player);
    expect(thrusting.infraredRearMeters!).toBeGreaterThan(3 * thrusting.infraredFrontMeters!);
  });
});
