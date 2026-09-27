import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Missile } from "../src/sim/missile";
import { launchMissile } from "../src/sim/missileSystem";
import type { RigidBody } from "../src/sim/rigidBody";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

function buildFleetWorld() {
  return new SimulationWorld({
    version: "test",
    seed: 11,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [0, 0, 0] }),
      buildShipInit({ id: "allie-1", name: "SCS Hawk", affiliation: "allie", position: [0, 0, 1500], velocity: [0, 0, 0] }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [20000, 0, 0], velocity: [0, 0, 0] }),
      buildShipInit({ id: "adversaire-2", affiliation: "adversaire", position: [20000, 0, 2000], velocity: [0, 0, 0] }),
    ],
  });
}

/** Missile posé sur la cible : l'impact se produit au tout prochain pas. */
function placeImpactingMissile(world: SimulationWorld, owner: RigidBody, target: RigidBody): void {
  world.missiles.push(
    new Missile({
      id: `test-${owner.id}-${target.id}`,
      ownerId: owner.id,
      affiliation: owner.affiliation,
      position: target.position.clone(),
      velocity: new Vector3(),
      def: owner.missile,
      assignedTrackId: null,
      hypotheticalTargetWorld: target.position.clone(),
      simTime: world.simTimeSeconds,
      initialTemperatureK: 250,
    }),
  );
}

const oneStep = (world: SimulationWorld) => world.stepOnce();

describe("Fin de mission en combat N contre M", () => {
  it("un seul ennemi neutralisé sur deux : la mission continue, puis victoire quand le second tombe", () => {
    const world = buildFleetWorld();
    const player = world.getBody("joueur-1")!;
    placeImpactingMissile(world, player, world.getBody("adversaire-1")!);
    oneStep(world);
    expect(world.getBody("adversaire-1")!.neutralized).toBe(true);
    expect(world.missionOutcome).toBe("en_cours");

    placeImpactingMissile(world, player, world.getBody("adversaire-2")!);
    oneStep(world);
    expect(world.missionOutcome).toBe("victoire");
  });

  it("le joueur touché, c'est la défaite même si un allié reste en état", () => {
    const world = buildFleetWorld();
    placeImpactingMissile(world, world.getBody("adversaire-1")!, world.getBody("joueur-1")!);
    oneStep(world);
    expect(world.getBody("allie-1")!.neutralized).toBe(false);
    expect(world.missionOutcome).toBe("defaite");
  });

  it("le joueur et le dernier ennemi touchés au même pas : neutralisation mutuelle", () => {
    const world = buildFleetWorld();
    world.getBody("adversaire-2")!.neutralize();
    placeImpactingMissile(world, world.getBody("joueur-1")!, world.getBody("adversaire-1")!);
    placeImpactingMissile(world, world.getBody("adversaire-1")!, world.getBody("joueur-1")!);
    oneStep(world);
    expect(world.missionOutcome).toBe("neutralisation_mutuelle");
  });

  it("un allié touché est neutralisé et journalisé, sans fin de mission", () => {
    const world = buildFleetWorld();
    placeImpactingMissile(world, world.getBody("adversaire-1")!, world.getBody("allie-1")!);
    oneStep(world);
    const ally = world.getBody("allie-1")!;
    expect(ally.neutralized).toBe(true);
    expect(ally.command.throttle).toBe(0);
    expect([...ally.sensorStates.values()].every((s) => !s.enabled)).toBe(true);
    expect(world.missionOutcome).toBe("en_cours");
    expect(world.events.some((e) => e.message.includes("SCS Hawk"))).toBe(true);
  });

  it("pas de tir fratricide : un missile ne touche jamais un vaisseau de son propre camp", () => {
    const world = buildFleetWorld();
    placeImpactingMissile(world, world.getBody("joueur-1")!, world.getBody("allie-1")!);
    oneStep(world);
    expect(world.getBody("allie-1")!.neutralized).toBe(false);
    expect(world.missionOutcome).toBe("en_cours");
  });

  it("un allié dont l'équipage est incapacité est neutralisé sans terminer la mission", () => {
    const world = buildFleetWorld();
    world.getBody("allie-1")!.crewExposureIncapacitated = true;
    oneStep(world);
    expect(world.getBody("allie-1")!.neutralized).toBe(true);
    expect(world.missionOutcome).toBe("en_cours");
  });

  it("les tirs ennemis ne figurent jamais dans le journal du joueur (MIS-05)", () => {
    const world = buildFleetWorld();
    const enemy = world.getBody("adversaire-1")!;
    // Donne à l'ennemi une piste exploitable sur le joueur.
    const player = world.getBody("joueur-1")!;
    enemy.knowledge.ingest(
      { simTime: 0, sourceSensorId: "radar-1", mode: "radar_active", bearingWorld: player.position.clone().sub(enemy.position).normalize(), bearingUncertaintyRad: 0.01, rangeMeters: 20000, rangeUncertaintyMeters: 50 },
      enemy.position,
    );
    const trackId = enemy.knowledge.tracks[0].localId;
    const before = world.events.length;
    const missile = launchMissile(world, enemy, trackId, 5000);
    expect(missile).not.toBeNull();
    expect(world.events.length).toBe(before);
  });

  it("un impact connu du camp bleu ramène la vitesse à ×1 (TIM-03) et s'inscrit au journal", () => {
    const world = buildFleetWorld();
    world.speedMultiplier = 10;
    placeImpactingMissile(world, world.getBody("joueur-1")!, world.getBody("adversaire-1")!);
    oneStep(world);
    expect(world.speedMultiplier).toBe(1);
    expect(world.events.some((e) => e.category === "impact_missile" && e.message.includes("a atteint sa cible"))).toBe(true);
  });
});


describe("Hors de combat par désarmement", () => {
  const disarm = (world: SimulationWorld, ids: string[]) => {
    for (const id of ids) world.getBody(id)!.missileCount = 0;
  };

  function strayMissile(world: SimulationWorld, owner: RigidBody, position: Vector3, velocity: Vector3): Missile {
    const missile = new Missile({
      id: `test-stray-${owner.id}`,
      ownerId: owner.id,
      affiliation: owner.affiliation,
      position,
      velocity,
      def: owner.missile,
      assignedTrackId: null,
      hypotheticalTargetWorld: position.clone(),
      simTime: world.simTimeSeconds,
      initialTemperatureK: 250,
    });
    missile.reservoir.quantityKg = 0;
    missile.state = "derive";
    world.missiles.push(missile);
    return missile;
  }

  it("l'adversaire à court de missiles : victoire par désarmement", () => {
    const world = buildFleetWorld();
    disarm(world, ["adversaire-1", "adversaire-2"]);
    oneStep(world);
    expect(world.missionOutcome).toBe("victoire_desarmement");
  });

  it("votre camp à court de missiles (joueur et alliés) : défaite par désarmement", () => {
    const world = buildFleetWorld();
    disarm(world, ["joueur-1"]);
    oneStep(world);
    expect(world.missionOutcome).toBe("en_cours");
    disarm(world, ["allie-1"]);
    oneStep(world);
    expect(world.missionOutcome).toBe("defaite_desarmement");
  });

  it("les deux camps désarmés au même pas : match nul", () => {
    const world = buildFleetWorld();
    disarm(world, ["joueur-1", "allie-1", "adversaire-1", "adversaire-2"]);
    oneStep(world);
    expect(world.missionOutcome).toBe("match_nul");
  });

  it("un missile encore en approche d'une cible garde son camp dans le combat, plus une fois qu'il s'éloigne", () => {
    const world = buildFleetWorld();
    disarm(world, ["adversaire-1", "adversaire-2"]);
    const enemy = world.getBody("adversaire-1")!;
    // Dérive sans propergol, droit sur le joueur à 10 km : il peut encore toucher.
    const missile = strayMissile(world, enemy, new Vector3(10000, 0, 0), new Vector3(-5000, 0, 0));
    oneStep(world);
    expect(world.missionOutcome).toBe("en_cours");
    // Au-delà du joueur et de l'allié, il s'éloigne de tous : l'adversaire est désarmé.
    missile.position.set(-10000, 0, 0);
    oneStep(world);
    expect(world.missionOutcome).toBe("victoire_desarmement");
  });

  it("un camp sans missile dès le scénario n'est pas « désarmé » (cible d'entraînement)", () => {
    const world = new SimulationWorld({
      version: "test",
      seed: 3,
      objective: "test",
      ships: [
        buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0] }),
        buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [20000, 0, 0], missileCount: 0 }),
      ],
    });
    oneStep(world);
    expect(world.missionOutcome).toBe("en_cours");
  });
});
