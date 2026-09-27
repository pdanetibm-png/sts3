import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import { replayInputs } from "../src/sim/replay";
import { buildSaveDocument, restoreWorldFromSave, SAVE_SCHEMA_VERSION } from "../src/sim/save";
import type { ScenarioDefinition } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit, TEST_DECOY, TEST_DECOY_DOCTRINE } from "./fixtures";

function buildScenario(): ScenarioDefinition {
  return {
    version: "test",
    seed: 5,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], decoy: TEST_DECOY, decoyCount: 2 }),
      // Adversaire armé, avec sa propre tactique de leurre : son état d'IA doit survivre à la reprise.
      buildShipInit({
        id: "adversaire-1",
        affiliation: "adversaire",
        position: [12000, 0, 0],
        doctrine: { ...TEST_DECOY_DOCTRINE, approachThrottle: 0 },
        decoy: TEST_DECOY,
        decoyCount: 2,
      }),
    ],
  };
}

const stepAt = (seconds: number) => Math.round(seconds / FIXED_DT_SECONDS);

/**
 * Menace injectée dans la connaissance de l'adversaire : à cette échelle, un vrai missile vu de face
 * n'est connu de lui qu'au dernier moment, sans vitesse estimée (voir CONCEPTION_LEURRES.md §10).
 * Elle déclenche sa tactique de leurre (vecteur puis largage) de part et d'autre de la sauvegarde.
 */
function injectThreat(world: SimulationWorld): void {
  const enemy = world.getBody("adversaire-1")!;
  const now = world.simTimeSeconds;
  for (let k = 0; k <= 12; k++) {
    const age = 3 - k * 0.25;
    // Menace à l'ouest de l'adversaire, qui se rapproche de lui à 200 m/s.
    const offset = new Vector3(-(3000 + 200 * age), 500, 0);
    enemy.knowledge.ingest(
      {
        simTime: now - age,
        sourceSensorId: "radar-1",
        mode: "radar_active",
        bearingWorld: offset.clone().normalize(),
        bearingUncertaintyRad: 1e-4,
        rangeMeters: offset.length(),
        rangeUncertaintyMeters: 1,
        crossSectionEstimateM2: 0.1,
      },
      enemy.position,
    );
  }
}

/** Consignes du joueur, données comme par l'interface (entre deux pas) ; renvoie quand `untilStep` est atteint. */
function play(world: SimulationWorld, untilStep: number, options: { threatAt?: number } = {}): void {
  const player = world.playerBody!;
  while (world.stepIndex < untilStep && world.missionOutcome === "en_cours") {
    const step = world.stepIndex;
    if (options.threatAt !== undefined && step === stepAt(options.threatAt)) injectThreat(world);
    if (step === 0) {
      for (const sensor of player.sensors) player.sensorStates.get(sensor.id)!.enabled = true;
      player.command.attitudeHoldEngaged = true;
      player.command.throttle = 0.3;
    }
    if (step === stepAt(20)) {
      world.launchPlayerDecoy();
      player.command.throttle = 0;
    }
    if (step === stepAt(25)) {
      const track = player.knowledge.tracks.find((t) => t.positionEstimateWorld);
      if (track) world.launchPlayerMissile(track.localId, 5000);
    }
    world.stepOnce();
  }
}

/** Comparable exact de l'état du monde (hors affichage : traînées, pause, vitesse). */
function fingerprint(world: SimulationWorld): string {
  const w = buildSaveDocument(world, world.scenario, "joueur-1", true).world;
  for (const entry of w.bodies) entry.body.trail = [];
  for (const missile of w.missiles) missile.trail = [];
  for (const decoy of w.decoys) decoy.trail = [];
  return JSON.stringify({ ...w, inputLog: undefined, paused: undefined, speedMultiplier: undefined });
}

describe("Leurres — sauvegarde, reprise et rejeu", () => {
  it("sauvegarder avec un leurre en vol et l'IA en pleine tactique, puis reprendre, donne exactement l'exécution continue", () => {
    const continuous = new SimulationWorld(buildScenario());
    play(continuous, stepAt(35), { threatAt: 30 });
    const doc = JSON.parse(JSON.stringify(buildSaveDocument(continuous, continuous.scenario, "joueur-1", true)));
    expect(doc.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(continuous.decoys[0].isActive).toBe(true);
    // L'adversaire prend son vecteur ; il larguera après la sauvegarde.
    expect(continuous.getBody("adversaire-1")!.aiState.decoyPhase).toBe("vecteur");

    play(continuous, stepAt(80));
    const resumed = restoreWorldFromSave(doc);
    play(resumed, stepAt(80));

    expect(continuous.decoys.some((d) => d.ownerId === "adversaire-1")).toBe(true);
    expect(resumed.stepIndex).toBe(continuous.stepIndex);
    expect(fingerprint(resumed)).toBe(fingerprint(continuous));
  });

  it("le largage est enregistré dans le journal et rejoué exactement depuis le début", () => {
    const original = new SimulationWorld(buildScenario());
    play(original, stepAt(80));
    expect(original.inputLog.inputs.filter((i) => i.kind === "decoy")).toEqual([{ step: stepAt(20), kind: "decoy", ownerId: "joueur-1" }]);

    const replayed = replayInputs(new SimulationWorld(buildScenario()), original.inputLog.inputs, { untilStep: original.stepIndex });

    expect(fingerprint(replayed)).toBe(fingerprint(original));
  });

  it("une sauvegarde de schéma antérieur est refusée", () => {
    const world = new SimulationWorld(buildScenario());
    const doc = buildSaveDocument(world, world.scenario, "joueur-1", true);
    expect(() => restoreWorldFromSave({ ...doc, schemaVersion: "3" })).toThrow(/incompatible/);
  });
});
