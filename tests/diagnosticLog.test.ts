import { describe, expect, it } from "vitest";
import { ReplayRecorder } from "../src/sim/replay";
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

describe("journal de diagnostic (DBG-01)", () => {
  it("échantillonne à intervalle régulier, pas à chaque pas physique", () => {
    const world = buildDuelWorld();
    world.advance(10); // 600 pas physiques à 1/60s, ~10 échantillons attendus à 1/s

    expect(world.diagnosticLog.sampleCount).toBeGreaterThanOrEqual(9);
    expect(world.diagnosticLog.sampleCount).toBeLessThanOrEqual(11);
  });

  it("contient la vérité des DEUX camps, jamais un seul (outil de mise au point, DBG-01)", () => {
    const world = buildDuelWorld();
    const recorder = new ReplayRecorder(world, "joueur-1", true);
    world.advance(2);

    const parsed = JSON.parse(JSON.stringify(recorder.buildExport()));
    const ids = parsed.samples[0].bodies.map((b: { id: string }) => b.id);
    expect(ids).toContain("joueur-1");
    expect(ids).toContain("adversaire-1");
  });

  it("le fichier exporté inclut la position réelle, l'attitude, le journal d'événements et l'issue de mission", () => {
    const world = buildDuelWorld();
    const recorder = new ReplayRecorder(world, "joueur-1", true);
    world.advance(2);

    const parsed = JSON.parse(JSON.stringify(recorder.buildExport()));
    expect(parsed.seed).toBe(1);
    expect(parsed.missionOutcome).toBe("en_cours");
    expect(Array.isArray(parsed.events)).toBe(true);
    const player = parsed.samples.at(-1).bodies.find((b: { id: string }) => b.id === "joueur-1");
    expect(player.position).toHaveLength(3);
    expect(player.velocity).toHaveLength(3);
    expect(player.attitude).toHaveLength(4);
    expect(player.sensors.length).toBeGreaterThan(0);
  });

  it("plafonne le nombre d'échantillons conservés (garde-fou mémoire)", () => {
    const world = buildDuelWorld();
    // Avance bien au-delà de l'échéance publique (1800s) pour vérifier le plafond, sans
    // dépendre d'une mission qui se termine avant. Manipule simTimeSeconds directement
    // (plutôt que world.advance) pour ne pas payer 4000s de pas physiques réels en test.
    for (let i = 0; i < 4000; i++) {
      world.simTimeSeconds = i + 1;
      world.diagnosticLog.maybeSample(world);
    }
    expect(world.diagnosticLog.sampleCount).toBeLessThanOrEqual(3600);
  });
});
