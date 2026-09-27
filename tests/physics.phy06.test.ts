import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { launchDecoy } from "../src/sim/decoySystem";
import { launchMissile } from "../src/sim/missileSystem";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit, TEST_DECOY } from "./fixtures";

function buildWorld() {
  return new SimulationWorld({
    version: "test",
    seed: 1,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", decoy: TEST_DECOY, decoyCount: 2 }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [50000, 0, 0] }),
    ],
  });
}

// PHY-06 : « masse perdue par le porteur égale à la masse initiale du missile ».
describe("PHY-06 — masse des munitions et lancement", () => {
  it("la masse du vaisseau compte les missiles et leurres en soute", () => {
    const player = buildWorld().playerBody!;
    const missile = player.missile.structureMassKg + player.missile.reservoir.quantityKg;
    const decoy = TEST_DECOY.structureMassKg + TEST_DECOY.reservoir.quantityKg + TEST_DECOY.irEmitter!.chargeKg;
    expect(player.massKg).toBeCloseTo(player.structure.dryMassKg + player.reservoir.quantityKg + 4 * missile + 2 * decoy, 9);
  });

  it("un lancement retire du porteur exactement la masse du missile lancé", () => {
    const world = buildWorld();
    const player = world.playerBody!;
    const trackId = player.knowledge.ingest(
      { simTime: 0, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: 0.01 },
      player.position,
    ).localId;
    const before = player.massKg;
    const missile = launchMissile(world, player, trackId, 5000)!;
    expect(before - player.massKg).toBeCloseTo(missile.massKg, 9);
  });

  it("un largage retire du porteur exactement la masse du leurre largué", () => {
    const world = buildWorld();
    const player = world.playerBody!;
    const before = player.massKg;
    const decoy = launchDecoy(world, player)!;
    expect(before - player.massKg).toBeCloseTo(decoy.massKg, 9);
  });
});
