import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import catalogJson from "../public/catalog/catalogue.json";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import { missileReachMeters, type Missile } from "../src/sim/missile";
import { launchMissile, stepMissiles } from "../src/sim/missileSystem";
import type { MissileDef } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

const ADVANCED = (catalogJson.components.missiles as unknown as (MissileDef & { id: string })[]).find((m) => m.id === "missile-chimique-avance")!;

/**
 * Tir à 200 km sur une cible qui se met à esquiver de côté (0,5 G) une fois la poussée initiale
 * finie. Piste parfaite (la vérité recopiée chaque pas), pour n'éprouver que le programme de
 * poussée. Renvoie la distance de passage et les phases traversées.
 */
function dodgeShot(reserveFraction: number): { missDistance: number; phases: Set<string>; missile: Missile } {
  const def: MissileDef = { ...ADVANCED, reservoir: { ...ADVANCED.reservoir }, terminalReserveFraction: reserveFraction };
  const world = new SimulationWorld({
    version: "test",
    seed: 1,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", missile: def, missileCount: 1 }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [200e3, 0, 0], missileCount: 0 }),
    ],
  });
  const shooter = world.getBody("joueur-1")!;
  const target = world.getBody("adversaire-1")!;
  const track = shooter.knowledge.ingest(
    { simTime: 0, sourceSensorId: "radar-1", mode: "radar_active", bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: 1e-3, rangeMeters: 200e3, rangeUncertaintyMeters: 10 },
    shooter.position,
  );
  const missile = launchMissile(world, shooter, track.localId, 200e3)!;
  const phases = new Set<string>();
  let missDistance = Number.POSITIVE_INFINITY;
  for (let step = 0; step < 60 * 120 && missile.isActive; step++) {
    const t = step * FIXED_DT_SECONDS;
    if (t > 15) target.velocity.y += 0.5 * 9.80665 * FIXED_DT_SECONDS;
    target.position.addScaledVector(target.velocity, FIXED_DT_SECONDS);
    track.positionEstimateWorld = target.position.clone();
    track.velocityEstimateWorld = target.velocity.clone();
    track.positionUncertaintyMeters = 10;
    stepMissiles(world, FIXED_DT_SECONDS);
    if (missile.state === "poussee") phases.add(missile.phase);
    missDistance = Math.min(missDistance, missile.position.distanceTo(target.position));
  }
  return { missDistance, phases, missile };
}

describe("Missiles à poussée gérée (réserve terminale)", () => {
  it("accélération, croisière moteur coupé, puis rallumage terminal", () => {
    const { phases } = dodgeShot(0.3);
    expect([...phases]).toEqual(["acceleration", "croisiere", "terminale"]);
  });

  it("une esquive après la poussée initiale : la réserve corrige, la poussée continue rate", () => {
    const withReserve = dodgeShot(0.3);
    const without = dodgeShot(0);
    // Mesuré : environ 40 m avec réserve contre environ 1,8 km sans.
    expect(withReserve.missDistance).toBeLessThan(100);
    expect(without.missDistance).toBeGreaterThan(1000);
    expect(withReserve.missDistance).toBeLessThan(without.missDistance / 10);
  });

  it("en croisière, le missile ne pousse pas : aucun jet à voir en IR", () => {
    const def: MissileDef = { ...ADVANCED, reservoir: { ...ADVANCED.reservoir }, terminalReserveFraction: 0.3 };
    const world = new SimulationWorld({
      version: "test",
      seed: 1,
      objective: "test",
      ships: [
        buildShipInit({ id: "joueur-1", affiliation: "joueur", missile: def, missileCount: 1 }),
        buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [400e3, 0, 0], missileCount: 0 }),
      ],
    });
    const shooter = world.getBody("joueur-1")!;
    const track = shooter.knowledge.ingest(
      { simTime: 0, sourceSensorId: "radar-1", mode: "radar_active", bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: 1e-3, rangeMeters: 400e3, rangeUncertaintyMeters: 10 },
      shooter.position,
    );
    const missile = launchMissile(world, shooter, track.localId, 400e3)!;
    for (let step = 0; step < 60 * 30; step++) stepMissiles(world, FIXED_DT_SECONDS);
    expect(missile.phase).toBe("croisiere");
    expect(missile.signatureSource().plumePeakWattsPerSr).toBe(0);
    expect(missile.reservoir.quantityKg).toBeCloseTo(0.3 * ADVANCED.reservoir.quantityKg, 3);
  });

  it("l'enveloppe de tir tient compte de la réserve brûlée en fin de vol", () => {
    const withReserve = missileReachMeters({ ...ADVANCED, terminalReserveFraction: 0.3 }, 60);
    const without = missileReachMeters({ ...ADVANCED, terminalReserveFraction: 0 }, 60);
    expect(withReserve).toBeLessThan(without);
    expect(withReserve).toBeGreaterThan(0.6 * without);
  });
});
