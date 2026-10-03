import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_ESTIMATION_ASSUMPTIONS } from "../src/knowledge/fusion";
import { KnowledgeBase } from "../src/knowledge/knowledgeBase";
import { trackFromSaveState, trackToSaveState } from "../src/knowledge/serialization";
import type { Observation } from "../src/knowledge/types";
import { createSeededRng } from "../src/sim/rng";

const observer = new Vector3();

/** Gisement dans le plan horizontal, à l'angle `azimuth` (rad). */
function bearingAt(azimuth: number): Vector3 {
  return new Vector3(Math.cos(azimuth), Math.sin(azimuth), 0);
}

/** Écoute : gisement seul, bruité d'un écart-type `noise` (rad) autour de l'azimut vrai. */
function listen(simTime: number, azimuth: number, noise: number, rng: () => number): Observation {
  const gaussian = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
  return { simTime, sourceSensorId: "listen-1", mode: "radar_passive", bearingWorld: bearingAt(azimuth + gaussian * noise), bearingUncertaintyRad: noise };
}

/** Suit une cible qui défile à `rate` rad/s, écoutée toutes les `period` s pendant `seconds`, en faisant vieillir les pistes au pas de 1/60 s. */
function followCrossingTarget(rate: number, period: number, seconds: number, noise = 5e-4): KnowledgeBase {
  const knowledge = new KnowledgeBase();
  knowledge.assumptions = { ...DEFAULT_ESTIMATION_ASSUMPTIONS, bearingDriftRadPerSecond: 0.0005, velocityWindowSeconds: 60 };
  const rng = createSeededRng(21);
  const dt = 1 / 60;
  let nextObservation = 0;
  for (let step = 1; step * dt <= seconds; step++) {
    const t = step * dt;
    knowledge.extrapolateAll(t, dt, observer);
    if (t >= nextObservation) {
      knowledge.ingest(listen(t, 0.3 + rate * t, noise, rng), observer);
      nextObservation += period;
    }
  }
  return knowledge;
}

// Constaté en 2 contre 2 : une cible qui défile à ~5 mrad/s, écoutée toutes les 1,5 s, créait une
// nouvelle piste à chaque mesure (157 pistes pour 4 objets) faute d'estimer la rotation de la ligne de visée.
describe("Pistes au gisement seul — rotation de la ligne de visée", () => {
  it("une cible qui défile reste une seule piste, dont la vitesse angulaire est estimée", () => {
    const knowledge = followCrossingTarget(0.005, 1.5, 90);
    expect(knowledge.tracks).toHaveLength(1);
    const track = knowledge.tracks[0];
    expect(track.bearingRateWorld).toBeDefined();
    expect(track.bearingRateWorld!.z).toBeCloseTo(0.005, 3);
    expect(track.state).toBe("recent");
  });

  it("sans nouvelle mesure, le gisement estimé continue de tourner à la vitesse mesurée", () => {
    const knowledge = followCrossingTarget(0.005, 1.5, 60);
    const track = knowledge.tracks[0];
    const before = Math.atan2(track.bearingEstimateWorld.y, track.bearingEstimateWorld.x);
    for (let i = 0; i < 600; i++) knowledge.extrapolateAll(60 + (i + 1) / 60, 1 / 60, observer);
    const after = Math.atan2(track.bearingEstimateWorld.y, track.bearingEstimateWorld.x);
    expect(after - before).toBeCloseTo(0.05, 3);
  });

  it("la deuxième mesure n'est rattachée que dans la limite de la vitesse angulaire supposée", () => {
    // 0,05 rad/s mesurés toutes les 1,5 s : 75 mrad d'écart, au-delà de ce que 0,01 rad/s explique.
    const knowledge = followCrossingTarget(0.05, 1.5, 3.1);
    // Pistes candidates comprises : l'association elle-même a refusé de rattacher.
    expect(knowledge.allTracks.length).toBeGreaterThan(1);
  });

  it("deux contacts distincts qui défilent restent deux pistes", () => {
    const knowledge = new KnowledgeBase();
    knowledge.assumptions = { ...DEFAULT_ESTIMATION_ASSUMPTIONS, bearingDriftRadPerSecond: 0.0005, velocityWindowSeconds: 60 };
    const rng = createSeededRng(5);
    const dt = 1 / 60;
    for (let step = 1; step * dt <= 60; step++) {
      const t = step * dt;
      knowledge.extrapolateAll(t, dt, observer);
      if (step % 90 === 0) {
        knowledge.ingest(listen(t, 0.3 + 0.004 * t, 5e-4, rng), observer);
        knowledge.ingest(listen(t, 0.5 - 0.003 * t, 5e-4, rng), observer);
      }
    }
    expect(knowledge.tracks).toHaveLength(2);
  });

  it("la vitesse angulaire estimée est sauvegardée et restaurée", () => {
    const track = followCrossingTarget(0.005, 1.5, 30).tracks[0];
    const restored = trackFromSaveState(JSON.parse(JSON.stringify(trackToSaveState(track))));
    expect(restored.bearingRateWorld!.distanceTo(track.bearingRateWorld!)).toBe(0);
    expect(restored.bearingRateUncertaintyRadPerSecond).toBe(track.bearingRateUncertaintyRadPerSecond);
    expect(restored.bearingFixes).toHaveLength(track.bearingFixes.length);
  });
});
