import { describe, expect, it } from "vitest";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

function buildFleetWorld() {
  return new SimulationWorld({
    version: "test",
    seed: 3,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [0, 0, 0] }),
      buildShipInit({ id: "allie-1", affiliation: "allie", position: [0, 0, 1500], velocity: [5, 0, 0] }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [6000, 0, 0], velocity: [0, 0, 0] }),
      buildShipInit({ id: "adversaire-2", affiliation: "adversaire", position: [6000, 0, 2000], velocity: [0, 0, 0] }),
    ],
  });
}

describe("Liaison de données et IFF", () => {
  it("chaque vaisseau connaît en permanence les vaisseaux de son camp, jamais lui-même ni l'autre camp", () => {
    const world = buildFleetWorld();
    const player = world.getBody("joueur-1")!;
    const enemy = world.getBody("adversaire-1")!;
    expect(player.knowledge.friendlies.map((f) => f.id)).toEqual(["allie-1"]);
    expect(enemy.knowledge.friendlies.map((f) => f.id)).toEqual(["adversaire-2"]);

    world.advance(2);
    const ally = world.getBody("allie-1")!;
    const known = player.knowledge.friendlies[0];
    expect(known.positionWorld.distanceTo(ally.position)).toBeLessThan(1e-9);
    expect(known.velocityWorld.distanceTo(ally.velocity)).toBeLessThan(1e-9);
  });

  it("aucune piste n'est jamais ouverte sur un vaisseau du même camp", () => {
    const world = buildFleetWorld();
    for (const body of world.bodies) {
      for (const sensor of body.sensors) body.sensorStates.get(sensor.id)!.enabled = true;
    }
    world.advance(20);

    const player = world.getBody("joueur-1")!;
    const ally = world.getBody("allie-1")!;
    // Seuls les deux ennemis peuvent être pistés : les pistes du joueur visent toutes l'est (x > 0).
    expect(player.knowledge.tracks.length).toBeGreaterThan(0);
    for (const track of player.knowledge.tracks) {
      const towardAlly = ally.position.clone().sub(player.position).normalize();
      expect(track.bearingEstimateWorld.dot(towardAlly)).toBeLessThan(0.9);
    }
    // Côté rouge : un ennemi ne piste pas l'autre (à 2 km, plein travers, il serait détecté sans IFF).
    const enemy = world.getBody("adversaire-1")!;
    const other = world.getBody("adversaire-2")!;
    const towardOther = other.position.clone().sub(enemy.position).normalize();
    for (const track of enemy.knowledge.tracks) {
      expect(track.bearingEstimateWorld.dot(towardOther)).toBeLessThan(0.9);
    }
  });
});
