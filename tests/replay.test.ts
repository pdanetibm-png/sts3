import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ReplayRecorder, replayFromExport, type ReplayExport } from "../src/sim/replay";
import { buildSaveDocument, restoreWorldFromSave } from "../src/sim/save";
import type { ScenarioDefinition } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

function buildScenario(): ScenarioDefinition {
  return {
    version: "test",
    seed: 424242,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [20, 0, 0] }),
      // Adversaire désarmé : la partie scriptée doit durer plusieurs instantanés sans être abrégée par un tir de l'IA.
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [7000, 800, -300], velocity: [-15, 0, 5], missileCount: 0 }),
    ],
  };
}

/** Comparable exact de l'état du monde (hors affichage : traînées, pause, vitesse). */
function fingerprint(world: SimulationWorld): string {
  const doc = buildSaveDocument(world, world.scenario, "joueur-1", true);
  const w = doc.world;
  for (const entry of w.bodies) entry.body.trail = [];
  for (const missile of w.missiles) missile.trail = [];
  return JSON.stringify({ ...w, inputLog: undefined, paused: undefined, speedMultiplier: undefined, missionOutcome: w.missionOutcome });
}

/**
 * Joue une partie comme le ferait l'interface : mutations directes des consignes entre des
 * trames de durées irrégulières, tirs, abandon de missile, accélération temporelle.
 */
function playScriptedGame(world: SimulationWorld, fromFrame = 0, toFrame = 1400): void {
  const player = world.getBody("joueur-1")!;
  const radar = player.sensors.find((s) => s.mode === "radar_active")!;
  const radarState = player.sensorStates.get(radar.id)!;
  for (let frame = fromFrame; frame < toFrame && world.missionOutcome === "en_cours"; frame++) {
    if (frame === 5) {
      radarState.enabled = true;
      for (const sensor of player.sensors) player.sensorStates.get(sensor.id)!.enabled = true;
    }
    if (frame === 40) player.command.throttle = 0.3;
    if (frame === 90) {
      player.command.attitudeHoldEngaged = true;
      player.command.targetAttitude.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4));
    }
    if (frame === 150) {
      radarState.scanDirectionWorld = new Vector3(1, 0.1, 0).normalize();
      radarState.scanHalfAngleRad = 0.5;
    }
    if (frame === 200) world.speedMultiplier = 10;
    if (frame === 260) world.speedMultiplier = 1;
    const track = player.knowledge.tracks[0];
    if (frame === 300 && track) {
      radarState.followedTrackId = track.localId;
      player.command.navMode = "interception";
      player.command.navTrackId = track.localId;
    }
    if (frame === 420 && track) world.launchPlayerMissile(track.localId, 5000);
    if (frame === 430 && track) world.launchPlayerMissile(track.localId, 5000);
    if (frame === 600) {
      const mine = world.missiles.find((m) => m.ownerId === "joueur-1");
      if (mine) mine.assignedTrackId = null;
    }
    if (frame === 700) player.command.throttle = 0.8;
    if (frame === 900) player.command.throttle = 0;
    // Trames irrégulières (15–40 ms) comme un vrai navigateur.
    world.advance(0.015 + ((frame * 7919) % 25) / 1000);
  }
}

describe("rejeu exact d'une partie (déroulement exporté)", () => {
  it("le scénario et les entrées enregistrées reproduisent exactement l'état final", () => {
    const world = new SimulationWorld(buildScenario());
    const recorder = new ReplayRecorder(world, "joueur-1", true);
    playScriptedGame(world);

    const exported: ReplayExport = JSON.parse(JSON.stringify(recorder.buildExport()));
    expect(exported.inputs.some((i) => i.kind === "launch")).toBe(true);
    expect(exported.keyframes.length).toBeGreaterThan(1);

    const replayed = replayFromExport(exported, { untilStep: exported.finalStepIndex });
    expect(replayed.stepIndex).toBe(world.stepIndex);
    expect(fingerprint(replayed)).toBe(fingerprint(world));
  });

  it("repartir d'un instantané intermédiaire donne le même état final", () => {
    const world = new SimulationWorld(buildScenario());
    const recorder = new ReplayRecorder(world, "joueur-1", true);
    playScriptedGame(world);

    const exported: ReplayExport = JSON.parse(JSON.stringify(recorder.buildExport()));
    const middle = exported.keyframes[Math.floor(exported.keyframes.length / 2)];
    expect(middle.world.simTimeSeconds).toBeGreaterThan(0);

    const replayed = replayFromExport(exported, { fromSimTime: middle.world.simTimeSeconds, untilStep: exported.finalStepIndex });
    expect(fingerprint(replayed)).toBe(fingerprint(world));
  });

  it("le journal d'entrées survit à une sauvegarde/reprise : le rejeu depuis le début couvre toute la partie", () => {
    const scenario = buildScenario();
    const first = new SimulationWorld(scenario);
    playScriptedGame(first, 0, 500);

    const saved = JSON.parse(JSON.stringify(buildSaveDocument(first, scenario, "joueur-1", true)));
    const resumed = restoreWorldFromSave(saved);
    const recorder = new ReplayRecorder(resumed, "joueur-1", true);
    playScriptedGame(resumed, 500, 1400);

    const exported: ReplayExport = JSON.parse(JSON.stringify(recorder.buildExport()));
    const replayed = replayFromExport(exported, { untilStep: exported.finalStepIndex });
    expect(fingerprint(replayed)).toBe(fingerprint(resumed));
  });

  it("les modifications faites par la simulation elle-même ne sont pas enregistrées comme entrées", () => {
    const world = new SimulationWorld(buildScenario());
    playScriptedGame(world);
    // Suivi radar et mode interception recalculent direction et attitude à chaque pas :
    // si elles fuyaient dans le journal, on aurait une entrée par pas.
    expect(world.inputLog.inputs.length).toBeLessThan(40);
  });

  it("une partie à 1 allié contre 2 ennemis se rejoue exactement", () => {
    const base = buildScenario();
    const scenario: ScenarioDefinition = {
      ...base,
      ships: [
        ...base.ships,
        buildShipInit({ id: "allie-1", affiliation: "allie", position: [0, 0, 1500], velocity: [20, 0, 0] }),
        buildShipInit({ id: "adversaire-2", affiliation: "adversaire", position: [7000, 800, 1700], velocity: [-15, 0, 5] }),
      ],
    };
    const world = new SimulationWorld(scenario);
    const recorder = new ReplayRecorder(world, "joueur-1", true);
    playScriptedGame(world);

    const exported: ReplayExport = JSON.parse(JSON.stringify(recorder.buildExport()));
    const replayed = replayFromExport(exported, { untilStep: exported.finalStepIndex });
    expect(fingerprint(replayed)).toBe(fingerprint(world));
  });
});

