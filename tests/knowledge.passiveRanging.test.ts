import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import scenarioJson from "../public/scenarios/demo-duel.json";
import {
  associationCandidates,
  createTrackFromObservation,
  DEFAULT_ESTIMATION_ASSUMPTIONS,
  extrapolateTrack,
  fuseObservationIntoTrack,
  fuseRemoteBearing,
} from "../src/knowledge/fusion";
import { trackFromSaveState, trackToSaveState } from "../src/knowledge/serialization";
import type { Observation } from "../src/knowledge/types";
import { createSeededRng } from "../src/sim/rng";
import type { EstimationAssumptions } from "../src/sim/types";

/** Hypothèses de la démo (milliers de km) : fenêtre de 60 s, manœuvre supposée de 1 G. */
const DEMO: EstimationAssumptions = { ...DEFAULT_ESTIMATION_ASSUMPTIONS, ...(scenarioJson.assumptions as Partial<EstimationAssumptions>) };
const IR_SIGMA_RAD = 2e-5;

function observation(overrides: Partial<Observation> = {}): Observation {
  return { simTime: 0, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: IR_SIGMA_RAD, ...overrides };
}

/** Gisement bruité (deux axes indépendants) de `target` vu depuis `observer`. */
function noisyBearing(target: Vector3, observer: Vector3, sigma: number, rng: () => number): Vector3 {
  const direction = target.clone().sub(observer).normalize();
  const a = new Vector3().crossVectors(direction, new Vector3(0, 1, 0)).normalize();
  const b = new Vector3().crossVectors(direction, a).normalize();
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
  return direction.addScaledVector(a, (gauss() * sigma) / Math.SQRT2).addScaledVector(b, (gauss() * sigma) / Math.SQRT2).normalize();
}

describe("Incertitude latérale — la direction se sait mieux que la distance", () => {
  function staleRadarTrack() {
    const observer = new Vector3();
    const track = createTrackFromObservation(
      "piste-1",
      observation({ mode: "radar_active", sourceSensorId: "radar-1", bearingUncertaintyRad: 1.7e-3, rangeMeters: 300e3, rangeUncertaintyMeters: 2 }),
      observer,
      DEMO,
    );
    for (let t = 1; t <= 120; t++) extrapolateTrack(track, t, 1, DEMO, observer);
    return { observer, track };
  }

  it("un gisement IR frais réduit l'incertitude latérale à distance × précision, sans toucher à celle sur la distance", () => {
    const { observer, track } = staleRadarTrack();
    const before = track.positionUncertaintyMeters!;
    expect(before).toBeGreaterThan(30e3);
    fuseObservationIntoTrack(track, observation({ simTime: 120 }), observer, DEMO);
    expect(track.positionUncertaintyMeters).toBeCloseTo(before, 0);
    expect(track.crossRangeUncertaintyMeters!).toBeLessThan(20);
  });

  it("un missile qui part 10° à côté du vaisseau suivi n'est plus avalé par sa piste", () => {
    const { observer, track } = staleRadarTrack();
    fuseObservationIntoTrack(track, observation({ simTime: 120 }), observer, DEMO);
    const tenDegrees = (10 * Math.PI) / 180;
    const missileBearing = new Vector3(Math.cos(tenDegrees), Math.sin(tenDegrees), 0);
    expect(associationCandidates([track], observation({ simTime: 121, bearingWorld: missileBearing }), observer, DEMO)).toHaveLength(0);
    expect(associationCandidates([track], observation({ simTime: 121 }), observer, DEMO)).toHaveLength(1);
  });

  it("une position devenue sans valeur est abandonnée au premier gisement : la piste repasse au gisement seul", () => {
    const observer = new Vector3();
    const track = createTrackFromObservation(
      "piste-1",
      observation({ mode: "radar_active", sourceSensorId: "radar-1", bearingUncertaintyRad: 1.7e-3, rangeMeters: 100e3, rangeUncertaintyMeters: 2 }),
      observer,
      DEMO,
    );
    for (let t = 1; t <= 200; t++) extrapolateTrack(track, t, 1, DEMO, observer);
    expect(track.positionUncertaintyMeters!).toBeGreaterThan(50e3);
    fuseObservationIntoTrack(track, observation({ simTime: 200 }), observer, DEMO);
    expect(track.positionEstimateWorld).toBeUndefined();
    expect(track.state).toBe("recent");
    expect(track.bearingEstimateWorld.angleTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
  });
});

describe("Distance passive — triangulation avec un allié", () => {
  it("à 3 000 km, deux vaisseaux à 40 km l'un de l'autre trouvent la distance à quelques km près, sans radar", () => {
    const rng = createSeededRng(7);
    const own = new Vector3(0, 0, 0);
    const ally = new Vector3(0, 0, 40e3);
    const start = new Vector3(3000e3, 200e3, 100e3);
    const velocity = new Vector3(-150, 20, 0);
    const targetAt = (t: number) => start.clone().addScaledVector(velocity, t);

    const track = createTrackFromObservation("piste-1", observation({ bearingWorld: noisyBearing(targetAt(0), own, IR_SIGMA_RAD, rng) }), own, DEMO);
    for (let t = 5; t <= 60; t += 5) {
      if (t % 10 === 0) {
        fuseObservationIntoTrack(track, observation({ simTime: t, bearingWorld: noisyBearing(targetAt(t), own, IR_SIGMA_RAD, rng) }), own, DEMO);
      } else {
        fuseRemoteBearing(
          track,
          { observerId: "allie-1", observerPositionWorld: ally, simTime: t, bearingWorld: noisyBearing(targetAt(t), ally, IR_SIGMA_RAD, rng), bearingUncertaintyRad: IR_SIGMA_RAD },
          own,
          DEMO,
        );
      }
    }

    expect(track.positionSource).toBe("triangulation");
    const error = track.positionEstimateWorld!.distanceTo(targetAt(60));
    const range = targetAt(60).length();
    expect(track.positionUncertaintyMeters!).toBeLessThan(0.02 * range);
    expect(error).toBeLessThan(3 * track.positionUncertaintyMeters!);
    // La direction reste bien plus sûre que la distance.
    expect(track.crossRangeUncertaintyMeters!).toBeLessThan(track.positionUncertaintyMeters!);
  });

  it("les gisements d'alliés et nos propres fenêtres sont sauvegardés et restaurés", () => {
    const own = new Vector3();
    const track = createTrackFromObservation("piste-1", observation(), own, DEMO);
    fuseRemoteBearing(
      track,
      { observerId: "allie-1", observerPositionWorld: new Vector3(0, 0, 40e3), simTime: 1, bearingWorld: new Vector3(1, 0, -0.01).normalize(), bearingUncertaintyRad: IR_SIGMA_RAD },
      own,
      DEMO,
    );
    const restored = trackFromSaveState(JSON.parse(JSON.stringify(trackToSaveState(track))));
    expect(restored.remoteBearingFixes).toHaveLength(1);
    expect(restored.remoteBearingFixes![0].observerPositionWorld.z).toBe(40e3);
    expect(restored.passiveFixes).toHaveLength(1);
    expect(restored.passiveFixes![0].observerPositionWorld).toBeDefined();
  });
});

describe("Distance passive — par manœuvre (seul)", () => {
  function bearingsOnlyRun(observerAt: (t: number) => Vector3) {
    const rng = createSeededRng(11);
    const start = new Vector3(2000e3, 0, 300e3);
    const velocity = new Vector3(-200, 0, 50);
    const targetAt = (t: number) => start.clone().addScaledVector(velocity, t);
    const track = createTrackFromObservation("piste-1", observation({ bearingWorld: noisyBearing(targetAt(0), observerAt(0), IR_SIGMA_RAD, rng) }), observerAt(0), DEMO);
    for (let t = 5; t <= 60; t += 5) {
      fuseObservationIntoTrack(track, observation({ simTime: t, bearingWorld: noisyBearing(targetAt(t), observerAt(t), IR_SIGMA_RAD, rng) }), observerAt(t), DEMO);
    }
    return { track, truth: targetAt(60) };
  }

  it("en accélérant de côté, on obtient une distance sans émettre", () => {
    const g = 9.80665;
    const { track, truth } = bearingsOnlyRun((t) => new Vector3(0, 0.5 * g * t * t, 0));
    expect(track.positionSource).toBe("manoeuvre");
    expect(track.positionEstimateWorld!.distanceTo(truth)).toBeLessThan(3 * track.positionUncertaintyMeters!);
  });

  it("sans manœuvre, la distance reste inconnue (gisement seul)", () => {
    const { track } = bearingsOnlyRun(() => new Vector3());
    expect(track.positionEstimateWorld).toBeUndefined();
  });
});

describe("Distance passive — en partie, par la liaison de données", () => {
  it("deux vaisseaux du camp bleu, capteurs passifs seulement, triangulent l'adversaire à 3 000 km", async () => {
    const { default: catalogJson } = await import("../public/catalog/catalogue.json");
    const { resolveScenario, validateCatalog } = await import("../src/sim/catalog");
    const { buildFleetScenario } = await import("../src/sim/fleet");
    const { SimulationWorld } = await import("../src/sim/world");
    const catalog = validateCatalog(JSON.parse(JSON.stringify(catalogJson)));
    const scenario = buildFleetScenario(resolveScenario(JSON.parse(JSON.stringify(scenarioJson)), catalog), { allies: 1, enemies: 1 });
    // L'allié à 40 km du joueur, perpendiculairement à l'axe de l'adversaire.
    scenario.ships.find((s) => s.affiliation === "allie")!.position = [0, 0, 40e3];
    const world = new SimulationWorld(scenario);
    const player = world.getBody("joueur-1")!;
    const ally = world.bodies.find((b) => b.affiliation === "allie")!;
    for (const body of [player, ally]) {
      for (const sensor of body.sensors) body.sensorStates.get(sensor.id)!.enabled = sensor.mode === "ir_passive";
    }
    // L'IA de l'allié allumerait son radar : on la garde passive pour ne tester que la triangulation.
    for (let step = 0; step < 60 * 90; step++) {
      for (const sensor of ally.sensors) if (sensor.mode === "radar_active") ally.sensorStates.get(sensor.id)!.enabled = false;
      world.stepOnce();
    }
    const enemy = world.bodies.find((b) => b.affiliation === "adversaire")!;
    const track = player.knowledge.tracks.find((t) => t.positionSource === "triangulation");
    expect(track, "piste triangulée").toBeDefined();
    expect(track!.remoteBearingFixes!.some((f) => f.observerId === ally.id)).toBe(true);
    const error = track!.positionEstimateWorld!.distanceTo(enemy.position);
    expect(error).toBeLessThan(3 * track!.positionUncertaintyMeters!);
    expect(track!.positionUncertaintyMeters!).toBeLessThan(0.05 * enemy.position.distanceTo(player.position));
  });
});
