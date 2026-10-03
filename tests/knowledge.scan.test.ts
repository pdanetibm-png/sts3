import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { KnowledgeBase } from "../src/knowledge/knowledgeBase";
import type { Observation } from "../src/knowledge/types";
import { createSeededRng } from "../src/sim/rng";
import type { EstimationAssumptions } from "../src/sim/types";
import scenarioJson from "../public/scenarios/demo-duel.json";
import { DEFAULT_ESTIMATION_ASSUMPTIONS } from "../src/knowledge/fusion";

/** Hypothèses du scénario de démo : manœuvre missile 60 G, fenêtre de 60 s — c'est là que deux missiles voisins se confondaient. */
const DEMO_ASSUMPTIONS: EstimationAssumptions = { ...DEFAULT_ESTIMATION_ASSUMPTIONS, ...(scenarioJson.assumptions as Partial<EstimationAssumptions>) };

const observer = new Vector3();

/** Écho radar d'un missile (0,1 m²), bruit de gisement et de distance de l'ordre du radar de la démo. */
function radarEcho(simTime: number, position: Vector3, rng: () => number, bearingNoiseRad = 1.7e-3, rangeNoiseMeters = 2.4): Observation {
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
  const range = position.length();
  const lateral = new Vector3(0, gaussian(), gaussian()).multiplyScalar((bearingNoiseRad * range) / Math.SQRT2);
  return {
    simTime,
    sourceSensorId: "radar-1",
    mode: "radar_active",
    bearingWorld: position.clone().add(lateral).normalize(),
    bearingUncertaintyRad: bearingNoiseRad,
    rangeMeters: range + gaussian() * rangeNoiseMeters,
    rangeUncertaintyMeters: rangeNoiseMeters,
    crossSectionEstimateM2: 0.1 * Math.exp(0.4 * gaussian()),
    crossSectionLogUncertainty: 0.4,
  };
}

function knowledge(): KnowledgeBase {
  const kb = new KnowledgeBase();
  kb.assumptions = DEMO_ASSUMPTIONS;
  return kb;
}

describe("Association par balayage — deux missiles voisins", () => {
  it("une piste ne reçoit qu'une mesure par balayage : deux échos simultanés font deux pistes", () => {
    const kb = knowledge();
    const rng = createSeededRng(1);
    const tracks = kb.ingestScan([radarEcho(0, new Vector3(50000, 0, 0), rng), radarEcho(0, new Vector3(50000, 40, 0), rng)], observer);
    expect(tracks[0]).not.toBe(tracks[1]);
    expect(kb.tracks).toHaveLength(2);
  });

  it("deux missiles à 500 m l'un de l'autre gardent chacun leur piste jusqu'à l'arrivée", () => {
    for (const seed of [2, 3, 4, 5]) {
      const kb = knowledge();
      const rng = createSeededRng(seed);
      const start = [new Vector3(60000, -250, 0), new Vector3(60000, 250, 0)];
      const velocity = new Vector3(-3000, 0, 0);
      const owner: string[][] = [[], []];
      for (let scan = 0; scan <= 18; scan++) {
        const t = scan;
        const echoes = start.map((p) => radarEcho(t, p.clone().addScaledVector(velocity, t), rng));
        kb.extrapolateAll(t, scan === 0 ? 0 : 1, observer);
        const tracks = kb.ingestScan(echoes, observer);
        tracks.forEach((track, i) => owner[i].push(track.localId));
      }
      // Une fois les vitesses établies (3 balayages), chaque missile reste sur la même piste, distincte de l'autre.
      for (let i = 0; i < 2; i++) expect(new Set(owner[i].slice(3)).size).toBe(1);
      expect(owner[0][18]).not.toBe(owner[1][18]);
    }
  });

  it("une piste de missile bien établie refuse un écho à 5 km de sa prédiction (60 G supposés n'en permettent que 300 m), même avec une longue fenêtre de régression", () => {
    const kb = knowledge();
    const rng = createSeededRng(7);
    const velocity = new Vector3(-3000, 0, 0);
    const start = new Vector3(150000, 0, 0);
    let track = kb.ingest(radarEcho(0, start, rng), observer);
    for (let t = 1; t <= 30; t++) {
      kb.extrapolateAll(t, 1, observer);
      track = kb.ingest(radarEcho(t, start.clone().addScaledVector(velocity, t), rng), observer);
    }
    expect(kb.tracks).toHaveLength(1);
    kb.extrapolateAll(31, 1, observer);
    const offset = kb.ingest(radarEcho(31, start.clone().addScaledVector(velocity, 31).add(new Vector3(0, 5000, 0)), rng), observer);
    expect(offset).not.toBe(track);
  });
});
