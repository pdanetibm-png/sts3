import { describe, expect, it } from "vitest";
import { buildSaveDocument, restoreWorldFromSave } from "../src/sim/save";
import type { ScenarioDefinition } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

function buildScenario(): ScenarioDefinition {
  return {
    version: "test",
    seed: 20260923,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [50, 0, 0] }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [8000, 1000, -500], velocity: [-10, 5, 0] }),
    ],
  };
}

function primeWorld(world: SimulationWorld): void {
  const player = world.getBody("joueur-1")!;
  player.command.throttle = 0.4;
  player.command.attitudeHoldEngaged = true;
  player.command.targetAttitude.set(0.1, 0, 0, 0.99).normalize();
  const radar = player.sensors.find((s) => s.mode === "radar_active")!;
  player.sensorStates.get(radar.id)!.enabled = true;
}

describe("SAV-01 — sauvegarde/reprise en milieu de mission ≡ exécution continue", () => {
  it("continuer après restauration produit le même état que continuer sans interruption", () => {
    const scenario = buildScenario();

    const continuous = new SimulationWorld(scenario);
    primeWorld(continuous);
    continuous.advance(5); // fait avancer la mission, construit des pistes, consomme du propergol

    const saveDoc = buildSaveDocument(continuous, scenario, "joueur-1", false);

    // Le monde "continu" poursuit sans interruption : référence à égaler après restauration.
    continuous.advance(5);

    const restored = restoreWorldFromSave(saveDoc);
    restored.advance(5);

    const playerContinuous = continuous.getBody("joueur-1")!;
    const playerRestored = restored.getBody("joueur-1")!;

    expect(playerRestored.position.distanceTo(playerContinuous.position)).toBeLessThan(1e-6);
    expect(playerRestored.velocity.distanceTo(playerContinuous.velocity)).toBeLessThan(1e-6);
    expect(playerRestored.reservoir.quantityKg).toBeCloseTo(playerContinuous.reservoir.quantityKg, 6);
    expect(restored.simTimeSeconds).toBeCloseTo(continuous.simTimeSeconds, 6);

    // Même bruit de capteur reproduit (RNG repris, pas re-semé) : mêmes pistes, mêmes mesures.
    const tracksContinuous = playerContinuous.knowledge.tracks.map((t) => t.localId).sort();
    const tracksRestored = playerRestored.knowledge.tracks.map((t) => t.localId).sort();
    expect(tracksRestored).toEqual(tracksContinuous);
    if (tracksContinuous.length > 0) {
      const tc = playerContinuous.knowledge.getTrack(tracksContinuous[0])!;
      const tr = playerRestored.knowledge.getTrack(tracksContinuous[0])!;
      expect(tr.bearingEstimateWorld.distanceTo(tc.bearingEstimateWorld)).toBeLessThan(1e-9);
    }
  });

  it("le journal d'événements et l'issue de mission sont préservés", () => {
    const scenario = buildScenario();
    const world = new SimulationWorld(scenario);
    primeWorld(world);
    world.advance(3);

    const saveDoc = buildSaveDocument(world, scenario, "joueur-1", false);
    expect(saveDoc.world.events.length).toBe(world.events.length);

    const restored = restoreWorldFromSave(saveDoc);
    expect(restored.events).toEqual(world.events);
    expect(restored.missionOutcome).toBe(world.missionOutcome);
  });

  it("le document sauvegardé survit à un JSON.stringify/parse complet (forme réellement persistable)", () => {
    const scenario = buildScenario();
    const world = new SimulationWorld(scenario);
    primeWorld(world);
    world.advance(2);

    const saveDoc = buildSaveDocument(world, scenario, "joueur-1", false);
    const roundTripped = JSON.parse(JSON.stringify(saveDoc));
    const restored = restoreWorldFromSave(roundTripped);

    expect(restored.getBody("joueur-1")!.position.distanceTo(world.getBody("joueur-1")!.position)).toBeLessThan(1e-9);
    expect(restored.simTimeSeconds).toBe(world.simTimeSeconds);
  });

  it("la mémoire de l'IA adverse (délai entre tirs) survit à la reprise", () => {
    const scenario = buildScenario();
    const world = new SimulationWorld(scenario);
    const adversary = world.getBody("adversaire-1")!;
    adversary.aiState.timeSinceLastShotSeconds = 3;
    adversary.aiState.timeWithoutUsableTrackSeconds = 7;

    const restored = restoreWorldFromSave(JSON.parse(JSON.stringify(buildSaveDocument(world, scenario, "joueur-1", false))));
    const restoredAdversary = restored.getBody("adversaire-1")!;
    expect(restoredAdversary.aiState.timeSinceLastShotSeconds).toBe(3);
    expect(restoredAdversary.aiState.timeWithoutUsableTrackSeconds).toBe(7);

    // « Jamais tiré » (Infinity) doit rester « jamais tiré » après un passage par JSON.
    const fresh = restoreWorldFromSave(JSON.parse(JSON.stringify(buildSaveDocument(new SimulationWorld(scenario), scenario, "joueur-1", false))));
    expect(fresh.getBody("adversaire-1")!.aiState.timeSinceLastShotSeconds).toBe(Number.POSITIVE_INFINITY);
  });

  it("une flotte avec un allié neutralisé reprend à l'identique (neutralisation, liaison de données)", () => {
    const scenario: ScenarioDefinition = {
      version: "test",
      seed: 77,
      objective: "test",
      ships: [
        buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [20, 0, 0] }),
        buildShipInit({ id: "allie-1", affiliation: "allie", position: [0, 0, 1500], velocity: [20, 0, 0] }),
        buildShipInit({ id: "allie-2", affiliation: "allie", position: [0, 0, -1500], velocity: [20, 0, 0] }),
        buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [9000, 0, 0], velocity: [-5, 0, 0] }),
        buildShipInit({ id: "adversaire-2", affiliation: "adversaire", position: [9000, 0, 2000], velocity: [-5, 0, 0] }),
      ],
    };
    const continuous = new SimulationWorld(scenario);
    continuous.advance(4);
    continuous.getBody("allie-2")!.neutralize();
    continuous.advance(2);

    const doc = JSON.parse(JSON.stringify(buildSaveDocument(continuous, scenario, "joueur-1", false)));
    const restored = restoreWorldFromSave(doc);
    expect(restored.getBody("allie-2")!.neutralized).toBe(true);
    expect(restored.getBody("joueur-1")!.knowledge.friendlies.map((f) => f.id).sort()).toEqual(["allie-1", "allie-2"]);

    continuous.advance(5);
    restored.advance(5);
    for (const body of continuous.bodies) {
      expect(restored.getBody(body.id)!.position.distanceTo(body.position)).toBeLessThan(1e-9);
    }
    expect(restored.missiles.length).toBe(continuous.missiles.length);
  });
});

