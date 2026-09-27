import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import { Missile } from "../src/sim/missile";
import { stepMissiles } from "../src/sim/missileSystem";
import { resolveOutcomeFromImpacts } from "../src/sim/mission";
import type { RigidBody } from "../src/sim/rigidBody";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

describe("MIS-05 — issues du duel (résolution pure)", () => {
  it("victoire : seul l'adversaire est touché", () => {
    expect(resolveOutcomeFromImpacts(false, true)).toBe("victoire");
  });
  it("défaite : seul le joueur est touché", () => {
    expect(resolveOutcomeFromImpacts(true, false)).toBe("defaite");
  });
  it("neutralisation mutuelle : les deux camps touchés au même pas", () => {
    expect(resolveOutcomeFromImpacts(true, true)).toBe("neutralisation_mutuelle");
  });
  it("aucune issue si personne n'est touché", () => {
    expect(resolveOutcomeFromImpacts(false, false)).toBeNull();
  });
});

function buildDuelWorld(shipOrder: "joueur-first" | "adversaire-first") {
  const player = buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [0, 0, 0] });
  const adversary = buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [5000, 0, 0], velocity: [0, 0, 0] });
  return new SimulationWorld({
    version: "test",
    seed: 1,
    objective: "test",
    ships: shipOrder === "joueur-first" ? [player, adversary] : [adversary, player],
  });
}

function placeImpactingMissile(world: SimulationWorld, owner: RigidBody, target: RigidBody): Missile {
  const missile = new Missile({
    id: `test-missile-${owner.id}`,
    ownerId: owner.id,
    affiliation: owner.affiliation,
    position: target.position.clone(),
    velocity: new Vector3(),
    def: owner.missile,
    assignedTrackId: null,
    hypotheticalTargetWorld: target.position.clone(),
    simTime: world.simTimeSeconds,
    initialTemperatureK: 250,
  });
  world.missiles.push(missile);
  return missile;
}

describe("MIS-05 — intégration via stepMissiles puis résolution de fin de pas", () => {
  it("un impact adverse seul déclare la victoire", () => {
    const world = buildDuelWorld("joueur-first");
    const player = world.getBody("joueur-1")!;
    const adversary = world.getBody("adversaire-1")!;
    placeImpactingMissile(world, player, adversary);

    stepMissiles(world, 1 / 60);
    world.resolveMissionOutcome();
    expect(world.missionOutcome).toBe("victoire");
  });

  it("un impact du joueur seul déclare la défaite", () => {
    const world = buildDuelWorld("joueur-first");
    const player = world.getBody("joueur-1")!;
    const adversary = world.getBody("adversaire-1")!;
    placeImpactingMissile(world, adversary, player);

    stepMissiles(world, 1 / 60);
    world.resolveMissionOutcome();
    expect(world.missionOutcome).toBe("defaite");
  });

  it("deux impacts au même pas ⇒ neutralisation mutuelle, indépendamment de l'ordre des corps", () => {
    for (const order of ["joueur-first", "adversaire-first"] as const) {
      const world = buildDuelWorld(order);
      const player = world.getBody("joueur-1")!;
      const adversary = world.getBody("adversaire-1")!;
      placeImpactingMissile(world, player, adversary);
      placeImpactingMissile(world, adversary, player);

      stepMissiles(world, 1 / 60);
      world.resolveMissionOutcome();
      expect(world.missionOutcome).toBe("neutralisation_mutuelle");
    }
  });

  it("aucun événement de missile résiduel n'est résolu après la fin (ARM-04)", () => {
    const world = buildDuelWorld("joueur-first");
    const player = world.getBody("joueur-1")!;
    const adversary = world.getBody("adversaire-1")!;
    placeImpactingMissile(world, player, adversary); // touche immédiatement, termine la mission

    // Un second missile, encore loin de sa cible : n'atteindrait son impact que bien plus tard.
    const residual = new Missile({
      id: "residual",
      ownerId: player.id,
      affiliation: player.affiliation,
      position: new Vector3(2000, 0, 0),
      velocity: new Vector3(),
      def: player.missile,
      assignedTrackId: null,
      hypotheticalTargetWorld: adversary.position.clone(),
      simTime: world.simTimeSeconds,
      initialTemperatureK: 250,
    });
    world.missiles.push(residual);

    // Demande plusieurs secondes (donc de nombreux pas physiques) ; la mission doit se figer
    // au tout premier pas où l'impact est résolu, sans traiter les pas suivants.
    world.advance(2);

    expect(world.missionOutcome).toBe("victoire");
    expect(world.simTimeSeconds).toBeCloseTo(FIXED_DT_SECONDS, 9);
    expect(residual.state).not.toBe("detruit");
  });
});
