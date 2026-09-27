import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
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

describe("TIM-03 — retour automatique à ×1 sur alerte critique connue", () => {
  it("nouvelle piste détectée par le joueur : retour automatique à ×1", () => {
    const world = buildDuelWorld();
    const player = world.getBody("joueur-1")!;
    player.knowledge.ingest(
      { simTime: 0, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: 0.05 },
      player.position,
    );
    world.speedMultiplier = 10;
    world.advance(1 / 60);
    expect(world.speedMultiplier).toBe(1);
  });

  it("propergol du joueur sous le seuil critique (5 %) : retour automatique à ×1", () => {
    const world = buildDuelWorld();
    const player = world.getBody("joueur-1")!;
    player.reservoir.quantityKg = player.reservoir.capacityKg * 0.04;
    world.speedMultiplier = 10;
    world.advance(1 / 60);
    expect(world.speedMultiplier).toBe(1);
  });

  it("batterie du joueur sous le seuil bas (20 %) : retour automatique à ×1", () => {
    const world = buildDuelWorld();
    const player = world.getBody("joueur-1")!;
    player.battery.currentChargeWattSeconds = player.battery.capacityWattSeconds * 0.15;
    world.speedMultiplier = 10;
    world.advance(1 / 60);
    expect(world.speedMultiplier).toBe(1);
  });

  it("exposition G dangereuse du joueur : retour automatique à ×1", () => {
    const world = buildDuelWorld();
    const player = world.getBody("joueur-1")!;
    player.crewExposureFraction = 0.6;
    world.speedMultiplier = 10;
    world.advance(1 / 60);
    expect(world.speedMultiplier).toBe(1);
  });

  it("ne relève jamais automatiquement la vitesse après acquittement tant que la sévérité ne progresse pas", () => {
    const world = buildDuelWorld();
    const player = world.getBody("joueur-1")!;
    player.reservoir.quantityKg = player.reservoir.capacityKg * 0.04;
    world.advance(1 / 60);
    expect(world.speedMultiplier).toBe(1);

    world.speedMultiplier = 10; // le joueur remonte manuellement la vitesse
    world.advance(1 / 60); // toujours critique, mais pas une hausse de sévérité
    expect(world.speedMultiplier).toBe(10);
  });

  it("l'état de l'adversaire ne déclenche jamais de retour auto (DBG-02 — jamais une connaissance du joueur)", () => {
    const world = buildDuelWorld();
    const adversary = world.getBody("adversaire-1")!;
    adversary.reservoir.quantityKg = 0;
    adversary.crewExposureFraction = 1;
    world.speedMultiplier = 10;
    world.advance(1 / 60);
    expect(world.speedMultiplier).toBe(10);
  });
});
