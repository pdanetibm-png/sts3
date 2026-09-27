import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Decoy } from "../src/sim/decoy";
import { stepDetection } from "../src/sim/detection";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import { launchMissile } from "../src/sim/missileSystem";
import { RigidBody } from "../src/sim/rigidBody";
import { createSeededRng } from "../src/sim/rng";
import type { Affiliation, DecoyDef } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit, TEST_DECOY, TEST_DECOY_LIGHT } from "./fixtures";

function makeDecoy(id: string, ownerId: string, affiliation: Affiliation, position: [number, number, number], def: DecoyDef = TEST_DECOY): Decoy {
  return new Decoy({
    id,
    ownerId,
    affiliation,
    position: new Vector3(...position),
    velocity: new Vector3(),
    def,
    thrustDirectionWorld: new Vector3(0, 1, 0),
    imitatedAccelerationMps2: 0,
    imitatedPlumeWattsPerSr: 0,
    simTime: 0,
    initialTemperatureK: 250,
  });
}

function enableSensors(body: RigidBody, modes: string[]) {
  for (const sensor of body.sensors) body.sensorStates.get(sensor.id)!.enabled = modes.includes(sensor.mode);
}

/** L'ennemi balaie au radar (large) pendant `seconds` ; renvoie les sources réelles de chacune de ses pistes. */
function radarSweep(observer: RigidBody, bodies: RigidBody[], decoys: Decoy[], seconds: number) {
  const sources = new Map<string, Set<string>>();
  const rng = createSeededRng(99);
  for (let i = 0; i < Math.round(seconds / FIXED_DT_SECONDS); i++) {
    stepDetection(bodies, decoys, (i + 1) * FIXED_DT_SECONDS, FIXED_DT_SECONDS, rng, (who, track, sourceId) => {
      if (who !== observer) return;
      if (!sources.has(track.localId)) sources.set(track.localId, new Set());
      sources.get(track.localId)!.add(sourceId);
    });
  }
  return sources;
}

describe("Leurres — vus par les capteurs ennemis", () => {
  it("un leurre à réflecteurs donne une piste « vaisseau probable »", () => {
    const enemy = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 0, 0] }));
    const player = new RigidBody(buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 100000, 0] }));
    enableSensors(enemy, ["radar_active"]);
    const decoy = makeDecoy("leurre-1", "joueur-1", "joueur", [3000, 0, 0]);

    const sources = radarSweep(enemy, [enemy, player], [decoy], 12);

    expect(enemy.knowledge.tracks).toHaveLength(1);
    const track = enemy.knowledge.tracks[0];
    expect([...sources.get(track.localId)!]).toEqual(["leurre-1"]);
    expect(track.classification).toBe("vaisseau probable");
  });

  it("un leurre léger, à petit écho, est classé « missile probable »", () => {
    const enemy = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 0, 0] }));
    const player = new RigidBody(buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 100000, 0] }));
    enableSensors(enemy, ["radar_active"]);
    const decoy = makeDecoy("leurre-1", "joueur-1", "joueur", [1500, 0, 0], TEST_DECOY_LIGHT);

    radarSweep(enemy, [enemy, player], [decoy], 12);

    expect(enemy.knowledge.tracks).toHaveLength(1);
    expect(enemy.knowledge.tracks[0].classification).toBe("missile probable");
  });

  it("mes leurres et ceux de mes alliés ne deviennent jamais une piste chez moi ; l'ennemi les voit", () => {
    const player = new RigidBody(buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0] }));
    const ally = new RigidBody(buildShipInit({ id: "allie-1", affiliation: "allie", position: [0, 90000, 0] }));
    const enemy = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [4000, 0, 0] }));
    enableSensors(player, ["ir_passive", "radar_passive", "radar_active"]);
    enableSensors(enemy, ["radar_active"]);
    // L'ennemi, lui, est loin du joueur mais proche des leurres.
    enemy.position.set(4000, 2000, 0);
    const ownDecoy = makeDecoy("leurre-1", "joueur-1", "joueur", [1000, 0, 0]);
    const allyDecoy = makeDecoy("leurre-2", "allie-1", "allie", [0, 1000, 0]);

    const sources = radarSweep(player, [player, ally, enemy], [ownDecoy, allyDecoy], 12);

    const playerSources = new Set([...sources.values()].flatMap((s) => [...s]));
    expect(playerSources.has("leurre-1")).toBe(false);
    expect(playerSources.has("leurre-2")).toBe(false);
    expect(enemy.knowledge.tracks.length).toBeGreaterThan(0);
  });
});

describe("Leurres — collision avec les missiles", () => {
  function buildWorld() {
    return new SimulationWorld({
      version: "test",
      seed: 3,
      objective: "test",
      ships: [
        buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0] }),
        buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [20000, 0, 0], missileCount: 0, decoy: TEST_DECOY, decoyCount: 1 }),
      ],
    });
  }

  function positionedTrack(world: SimulationWorld, target: Vector3): string {
    const owner = world.playerBody!;
    return owner.knowledge.ingest(
      {
        simTime: world.simTimeSeconds,
        sourceSensorId: "radar-1",
        mode: "radar_active",
        bearingWorld: target.clone().sub(owner.position).normalize(),
        bearingUncertaintyRad: 1e-4,
        rangeMeters: target.distanceTo(owner.position),
        rangeUncertaintyMeters: 1,
      },
      owner.position,
    ).localId;
  }

  it("un missile qui percute un leurre adverse le détruit, et se détruit, une seule fois", () => {
    const world = buildWorld();
    const decoy = makeDecoy("leurre-9", "adversaire-1", "adversaire", [2000, 0, 0]);
    world.decoys.push(decoy);
    const missile = launchMissile(world, world.playerBody!, positionedTrack(world, decoy.position), 5000)!;

    for (let i = 0; i < 30 / FIXED_DT_SECONDS && missile.isActive; i++) world.stepOnce();

    expect(missile.state).toBe("detruit");
    expect(decoy.state).toBe("detruit");
    expect(decoy.destroyedByMissileId).toBe(missile.id);
    expect(world.getBody("adversaire-1")!.neutralized).toBe(false);
    expect(world.missionOutcome).toBe("en_cours");
    // Pour le tireur, un impact comme un autre : il ne sait pas ce qu'il a touché.
    expect(world.events.filter((e) => e.category === "impact_missile")).toHaveLength(1);
  });

  it("pas de tir fratricide : un missile traverse le leurre de son propre camp", () => {
    const world = buildWorld();
    const ownDecoy = makeDecoy("leurre-8", "joueur-1", "joueur", [2000, 0, 0]);
    world.decoys.push(ownDecoy);
    const missile = launchMissile(world, world.playerBody!, positionedTrack(world, new Vector3(4000, 0, 0)), 5000)!;

    for (let i = 0; i < 10 / FIXED_DT_SECONDS; i++) world.stepOnce();

    expect(missile.position.x).toBeGreaterThan(2000);
    expect(ownDecoy.isActive).toBe(true);
    expect(missile.isActive).toBe(true);
  });
});
