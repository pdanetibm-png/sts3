import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
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

function ingestBearingOnlyTrack(world: SimulationWorld, ownerId: string, bearingWorld: Vector3): string {
  const owner = world.getBody(ownerId)!;
  const track = owner.knowledge.ingest(
    { simTime: world.simTimeSeconds, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: bearingWorld.clone().normalize(), bearingUncertaintyRad: 0.05 },
    owner.position,
  );
  return track.localId;
}

function ingestPositionedTrack(world: SimulationWorld, ownerId: string, targetPositionWorld: Vector3): string {
  const owner = world.getBody(ownerId)!;
  const bearing = targetPositionWorld.clone().sub(owner.position).normalize();
  const range = targetPositionWorld.distanceTo(owner.position);
  const track = owner.knowledge.ingest(
    { simTime: world.simTimeSeconds, sourceSensorId: "radar-1", mode: "radar_active", bearingWorld: bearing, bearingUncertaintyRad: 0.02, rangeMeters: range, rangeUncertaintyMeters: 10 },
    owner.position,
  );
  return track.localId;
}

describe("ARM-01 — stock et physique missile", () => {
  it("chaque lancement consomme une unité de stock", () => {
    const world = buildDuelWorld();
    const owner = world.getBody("joueur-1")!;
    const trackId = ingestBearingOnlyTrack(world, "joueur-1", new Vector3(1, 0, 0));

    expect(owner.missileCount).toBe(4);
    const missile = launchMissile(world, owner, trackId, 5000);
    expect(missile).not.toBeNull();
    expect(owner.missileCount).toBe(3);
    expect(world.missiles).toHaveLength(1);
  });

  it("aucun lancement sans stock restant", () => {
    const world = buildDuelWorld();
    const owner = world.getBody("joueur-1")!;
    owner.missileCount = 0;
    const trackId = ingestBearingOnlyTrack(world, "joueur-1", new Vector3(1, 0, 0));

    expect(launchMissile(world, owner, trackId, 5000)).toBeNull();
    expect(world.missiles).toHaveLength(0);
  });

  it("chaque missile réutilise le modèle propulsion/réservoir du porteur avec sa PROPRE réserve indépendante", () => {
    const world = buildDuelWorld();
    const owner = world.getBody("joueur-1")!;
    const trackId = ingestBearingOnlyTrack(world, "joueur-1", new Vector3(1, 0, 0));

    const missileA = launchMissile(world, owner, trackId, 5000)!;
    const missileB = launchMissile(world, owner, trackId, 5000)!;
    expect(missileA.reservoir).not.toBe(missileB.reservoir);
    expect(missileA.reservoir).not.toBe(owner.missile.reservoir);

    missileA.reservoir.quantityKg = 0;
    expect(missileB.reservoir.quantityKg).toBe(owner.missile.reservoir.quantityKg);
  });
});

describe("ARM-02 — absence d'autodirecteur", () => {
  it("le missile se dirige vers l'estimation de piste du porteur, jamais vers une position réelle cachée différente", () => {
    const world = buildDuelWorld();
    const owner = world.getBody("joueur-1")!;
    const realAdversary = world.getBody("adversaire-1")!;
    // L'estimation de piste pointe délibérément ailleurs que la vraie position adverse.
    const estimatedPosition = new Vector3(1000, 2000, 0);
    expect(estimatedPosition.distanceTo(realAdversary.position)).toBeGreaterThan(1000);
    const trackId = ingestPositionedTrack(world, "joueur-1", estimatedPosition);

    const missile = launchMissile(world, owner, trackId, 5000)!;
    for (let i = 0; i < 60; i++) stepMissiles(world, FIXED_DT_SECONDS);

    const towardEstimate = estimatedPosition.clone().sub(missile.position).normalize();
    const towardRealTarget = realAdversary.position.clone().sub(missile.position).normalize();
    expect(missile.velocity.clone().normalize().dot(towardEstimate)).toBeGreaterThan(0.99);
    expect(missile.velocity.clone().normalize().dot(towardRealTarget)).toBeLessThan(0.99);
  });

  it("sans nouvelle estimation, le missile garde l'hypothèse figée au lancement (pas de correction magique)", () => {
    const world = buildDuelWorld();
    const owner = world.getBody("joueur-1")!;
    const trackId = ingestBearingOnlyTrack(world, "joueur-1", new Vector3(1, 0, 0));
    const missile = launchMissile(world, owner, trackId, 4000)!;
    const initialHypothesis = missile.hypotheticalTargetWorld!.clone();

    for (let i = 0; i < 120; i++) stepMissiles(world, FIXED_DT_SECONDS);

    expect(missile.hypotheticalTargetWorld!.toArray()).toEqual(initialHypothesis.toArray());
  });
});

describe("ARM-03 — perte et épuisement", () => {
  it("réserve épuisée ⇒ dérive, le missile ne s'immobilise jamais", () => {
    const world = buildDuelWorld();
    const owner = world.getBody("joueur-1")!;
    const trackId = ingestBearingOnlyTrack(world, "joueur-1", new Vector3(1, 0, 0));
    const missile = launchMissile(world, owner, trackId, 4000)!;
    missile.reservoir.quantityKg = 0.05; // presque vide

    let becameDerive = false;
    for (let i = 0; i < 600; i++) {
      stepMissiles(world, FIXED_DT_SECONDS);
      expect(missile.reservoir.quantityKg).toBeGreaterThanOrEqual(0);
      if (missile.state === "derive") becameDerive = true;
    }

    expect(becameDerive).toBe(true);
    expect(missile.velocity.length()).toBeGreaterThan(0);
  });

  it("une piste perdue continue d'être suivie via sa dernière estimation extrapolée", () => {
    const world = buildDuelWorld();
    const owner = world.getBody("joueur-1")!;
    const trackId = ingestPositionedTrack(world, "joueur-1", new Vector3(3000, 0, 0));
    const missile = launchMissile(world, owner, trackId, 5000)!;

    // Fait vieillir la piste jusqu'à "lost" sans nouvelle observation.
    owner.knowledge.extrapolateAll(200, 200);
    const track = owner.knowledge.getTrack(trackId)!;
    expect(track.state).toBe("lost");
    expect(track.positionEstimateWorld).toBeDefined();

    for (let i = 0; i < 10; i++) stepMissiles(world, FIXED_DT_SECONDS);
    expect(missile.state === "poussee" || missile.state === "derive").toBe(true);
  });
});
