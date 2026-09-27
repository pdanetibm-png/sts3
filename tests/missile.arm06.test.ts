import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { launchMissile, stepMissiles } from "../src/sim/missileSystem";
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

function launchOutwardMissile(world: SimulationWorld) {
  const owner = world.getBody("joueur-1")!;
  // Direction opposée à l'adversaire : le missile s'éloigne du théâtre sans jamais risquer
  // de le percuter, pour isoler le test de frontière du test de collision.
  const track = owner.knowledge.ingest(
    { simTime: 0, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: new Vector3(-1, 0, 0), bearingUncertaintyRad: 0.05 },
    owner.position,
  );
  return launchMissile(world, owner, track.localId, 1_000_000)!; // hypothèse très lointaine, hors théâtre
}

describe("ARM-06 — frontière des missiles", () => {
  it("la taille du théâtre est fixée à l'initialisation (5 × la séparation initiale) et reste constante", () => {
    const world = buildDuelWorld();
    const expectedRadius = 5000 * 5;
    expect(world.theatre.radiusMeters).toBeCloseTo(expectedRadius, 6);
    const centerBefore = world.theatre.centerWorld.clone();

    for (let i = 0; i < 100; i++) stepMissiles(world, 1 / 60);
    expect(world.theatre.radiusMeters).toBeCloseTo(expectedRadius, 6);
    expect(world.theatre.centerWorld.toArray()).toEqual(centerBefore.toArray());
  });

  it("un missile en dérive/poussé qui franchit la frontière est retiré une seule fois, sans dégât de zone", () => {
    const world = buildDuelWorld();
    const missile = launchOutwardMissile(world);

    let lossEvents = 0;
    for (let i = 0; i < 6000; i++) {
      stepMissiles(world, 1 / 60);
      if (missile.state === "perdu_theatre") break;
    }
    lossEvents = world.events.filter((e) => e.category === "perte_missile").length;

    expect(missile.state).toBe("perdu_theatre");
    expect(lossEvents).toBe(1);
    expect(world.missionOutcome).toBe("en_cours"); // aucun dégât de zone, aucune fin de partie provoquée

    // Poursuivre la simulation ne doit pas générer un second événement de perte pour ce missile.
    for (let i = 0; i < 60; i++) stepMissiles(world, 1 / 60);
    expect(world.events.filter((e) => e.category === "perte_missile").length).toBe(1);
  });

  it("le franchissement est détecté de façon équivalente à petit pas (≈×1) et grand pas (≈×10)", () => {
    const worldFine = buildDuelWorld();
    const missileFine = launchOutwardMissile(worldFine);
    for (let i = 0; i < 6000; i++) {
      stepMissiles(worldFine, 1 / 60);
      if (missileFine.state === "perdu_theatre") break;
    }

    const worldCoarse = buildDuelWorld();
    const missileCoarse = launchOutwardMissile(worldCoarse);
    for (let i = 0; i < 600; i++) {
      stepMissiles(worldCoarse, 10 / 60);
      if (missileCoarse.state === "perdu_theatre") break;
    }

    expect(missileFine.state).toBe("perdu_theatre");
    expect(missileCoarse.state).toBe("perdu_theatre");
  });
});
