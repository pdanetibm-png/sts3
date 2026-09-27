import { describe, expect, it } from "vitest";
import { checkWorldInvariants } from "../src/sim/invariants";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

function buildDuelWorld() {
  return new SimulationWorld({
    version: "test",
    seed: 1,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [0, 0, 0] }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [5000, 0, 0], velocity: [0, 0, 0] }),
    ],
  });
}

describe("section 10 — détection d'un état non fini", () => {
  it("un état sain ne déclenche aucune violation", () => {
    const world = buildDuelWorld();
    world.advance(1);
    expect(checkWorldInvariants(world)).toBeNull();
  });

  it("une position non finie est détectée", () => {
    const world = buildDuelWorld();
    world.bodies[0].position.x = Number.NaN;
    const violation = checkWorldInvariants(world);
    expect(violation).not.toBeNull();
    expect(violation?.message).toContain("joueur-1");
  });

  it("une vitesse infinie est détectée", () => {
    const world = buildDuelWorld();
    world.bodies[1].velocity.set(Number.POSITIVE_INFINITY, 0, 0);
    expect(checkWorldInvariants(world)).not.toBeNull();
  });

  it("un réservoir négatif est détecté", () => {
    const world = buildDuelWorld();
    world.bodies[0].reservoir.quantityKg = -1;
    expect(checkWorldInvariants(world)).not.toBeNull();
  });

  it("le pas de simulation se met en pause et conserve le message dès qu'une violation apparaît", () => {
    const world = buildDuelWorld();
    world.bodies[0].position.x = Number.NaN;
    world.advance(1 / 60);
    expect(world.paused).toBe(true);
    expect(world.invariantViolation).not.toBeNull();
  });
});
