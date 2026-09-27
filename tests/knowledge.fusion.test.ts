import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  LOST_AGE_SECONDS,
  RECENT_AGE_SECONDS,
  createTrackFromObservation,
  extrapolateTrack,
  findCompatibleTrack,
  fuseObservationIntoTrack,
} from "../src/knowledge/fusion";
import type { Observation, Track } from "../src/knowledge/types";
import { createSeededRng } from "../src/sim/rng";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    simTime: 0,
    sourceSensorId: "ir-1",
    mode: "ir_passive",
    bearingWorld: new Vector3(1, 0, 0),
    bearingUncertaintyRad: 0.05,
    ...overrides,
  };
}

describe("DET-03 — incertitude et recherche", () => {
  it("l'incertitude ne décroît jamais sans nouvelle observation, et croît avec le temps", () => {
    const track = createTrackFromObservation("piste-1", observation(), new Vector3());
    const initialUncertainty = track.bearingUncertaintyRad;

    extrapolateTrack(track, 10, 10);
    expect(track.bearingUncertaintyRad).toBeGreaterThan(initialUncertainty);

    const afterTenSeconds = track.bearingUncertaintyRad;
    extrapolateTrack(track, 20, 10);
    expect(track.bearingUncertaintyRad).toBeGreaterThan(afterTenSeconds);
  });

  it("une nouvelle mesure compatible réduit l'incertitude au niveau du capteur", () => {
    const track = createTrackFromObservation("piste-1", observation(), new Vector3());
    extrapolateTrack(track, 20, 20);
    const grownUncertainty = track.bearingUncertaintyRad;

    fuseObservationIntoTrack(track, observation({ simTime: 20, bearingUncertaintyRad: 0.05 }), new Vector3());
    expect(track.bearingUncertaintyRad).toBeLessThan(grownUncertainty);
    expect(track.bearingUncertaintyRad).toBeCloseTo(0.05, 6);
  });
});

describe("DET-06 — association honnête", () => {
  it("une réacquisition ambiguë entre deux pistes compatibles conserve le doute", () => {
    const trackA = createTrackFromObservation("piste-1", observation({ bearingWorld: new Vector3(1, 0, 0) }), new Vector3());
    const trackB = createTrackFromObservation("piste-2", observation({ bearingWorld: new Vector3(1, 0.01, 0).normalize() }), new Vector3());
    const tracks: Track[] = [trackA, trackB];

    const ambiguousObservation = observation({ bearingWorld: new Vector3(1, 0.005, 0).normalize(), bearingUncertaintyRad: 0.05 });
    const result = findCompatibleTrack(tracks, ambiguousObservation);

    expect(result.track).not.toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it("une seule piste compatible n'est jamais ambiguë", () => {
    const trackA = createTrackFromObservation("piste-1", observation({ bearingWorld: new Vector3(1, 0, 0) }), new Vector3());
    const trackB = createTrackFromObservation("piste-2", observation({ bearingWorld: new Vector3(-1, 0, 0) }), new Vector3());

    const result = findCompatibleTrack([trackA, trackB], observation({ bearingWorld: new Vector3(1, 0.001, 0).normalize() }));
    expect(result.track?.localId).toBe("piste-1");
    expect(result.ambiguous).toBe(false);
  });

  it("aucune piste compatible ⇒ une nouvelle piste doit être créée (pas de fusion forcée)", () => {
    const trackA = createTrackFromObservation("piste-1", observation({ bearingWorld: new Vector3(1, 0, 0) }), new Vector3());
    const result = findCompatibleTrack([trackA], observation({ bearingWorld: new Vector3(-1, 0, 0) }));
    expect(result.track).toBeNull();
  });
});

describe("Transitions d'état de piste", () => {
  it("récente puis extrapolée puis perdue selon l'ancienneté", () => {
    const track = createTrackFromObservation("piste-1", observation({ simTime: 0 }), new Vector3());

    extrapolateTrack(track, RECENT_AGE_SECONDS - 1, RECENT_AGE_SECONDS - 1);
    expect(track.state).toBe("recent");

    extrapolateTrack(track, RECENT_AGE_SECONDS + 5, 6);
    expect(track.state).toBe("extrapolated");

    extrapolateTrack(track, LOST_AGE_SECONDS + 1, LOST_AGE_SECONDS - RECENT_AGE_SECONDS - 4);
    expect(track.state).toBe("lost");
  });

  it("une piste perdue conserve son historique", () => {
    const track = createTrackFromObservation("piste-1", observation({ simTime: 0 }), new Vector3());
    extrapolateTrack(track, LOST_AGE_SECONDS + 10, LOST_AGE_SECONDS + 10);
    expect(track.state).toBe("lost");
    expect(track.history.length).toBeGreaterThan(0);
    expect(track.createdSimTime).toBe(0);
  });
});

describe("DET-08 — vitesse estimée à grande distance", () => {
  function gaussian(rng: () => number): number {
    return Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
  }

  it("à 19 km, le bruit de gisement ne produit pas de vitesse aberrante (régression, pas différence finie)", () => {
    const rng = createSeededRng(99);
    const observer = new Vector3();
    const targetStart = new Vector3(19000, 0, 0);
    const targetVelocity = new Vector3(10, 5, 0);
    const bearingNoise = 0.02;
    const rangeNoise = 50;

    let track: Track | null = null;
    for (let i = 0; i <= 100; i++) {
      const t = i * 0.15;
      const truth = targetStart.clone().addScaledVector(targetVelocity, t);
      const bearing = truth.clone().normalize();
      bearing.x += gaussian(rng) * bearingNoise * 0.1;
      bearing.y += gaussian(rng) * bearingNoise;
      bearing.z += gaussian(rng) * bearingNoise;
      bearing.normalize();
      const obs = observation({
        simTime: t,
        sourceSensorId: "radar-1",
        mode: "radar_active",
        bearingWorld: bearing,
        bearingUncertaintyRad: bearingNoise,
        rangeMeters: truth.length() + gaussian(rng) * rangeNoise,
        rangeUncertaintyMeters: rangeNoise,
      });
      if (!track) track = createTrackFromObservation("piste-1", obs, observer);
      else {
        extrapolateTrack(track, t, 0.15);
        fuseObservationIntoTrack(track, obs, observer);
      }
    }

    const finalTruth = targetStart.clone().addScaledVector(targetVelocity, 15);
    const velocityError = track!.velocityEstimateWorld!.distanceTo(targetVelocity);
    // Deux mesures isolées à 0,5 s d'écart donnaient ~1 km/s d'erreur à cette distance.
    expect(velocityError).toBeLessThan(60);
    expect(velocityError).toBeLessThan(4 * track!.velocityUncertaintyMps!);
    expect(track!.positionEstimateWorld!.distanceTo(finalTruth)).toBeLessThan(400);
  });

  it("un gisement frais qui contredit la position estimée la recale sur ce gisement et abandonne la vitesse", () => {
    const observer = new Vector3();
    const track = createTrackFromObservation(
      "piste-1",
      observation({ mode: "radar_active", sourceSensorId: "radar-1", bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: 0.02, rangeMeters: 10000, rangeUncertaintyMeters: 50 }),
      observer,
    );
    // Vitesse fausse : la position extrapolée part très loin du vrai gisement.
    track.velocityEstimateWorld = new Vector3(0, 800, 0);
    track.velocityUncertaintyMps = 5;
    extrapolateTrack(track, 10, 10);

    fuseObservationIntoTrack(track, observation({ simTime: 10, bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: 0.05 }), observer);

    const direction = track.positionEstimateWorld!.clone().normalize();
    expect(direction.angleTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
    expect(track.velocityEstimateWorld).toBeUndefined();
    expect(track.positionUncertaintyMeters!).toBeGreaterThan(1000);
  });

  it("un radar en Suivi garde le contact sur une cible lointaine qui manœuvre", () => {
    const world = new SimulationWorld({
      version: "test",
      seed: 20260923,
      objective: "test",
      ships: [
        buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [0, 0, 0] }),
        // Sans missiles : ce test porte sur la tenue de piste, pas sur l'engagement.
        buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [9000, 1500, -2000], velocity: [-10, 0, 5], missileCount: 0 }),
      ],
    });
    const player = world.getBody("joueur-1")!;
    for (const sensor of player.sensors) player.sensorStates.get(sensor.id)!.enabled = true;
    const radar = player.sensorStates.get("radar-1")!;

    for (let second = 0; second < 60 && world.missionOutcome === "en_cours"; second++) {
      const track = player.knowledge.tracks[0];
      if (track && !radar.followedTrackId) radar.followedTrackId = track.localId;
      world.advance(1);
    }

    const adversary = world.getBody("adversaire-1")!;
    const track = player.knowledge.getTrack(radar.followedTrackId!)!;
    const lastRadarFix = track.history.filter((o) => o.mode === "radar_active").at(-1)!;
    expect(world.simTimeSeconds - lastRadarFix.simTime).toBeLessThan(5);
    expect(track.positionEstimateWorld!.distanceTo(adversary.position)).toBeLessThan(1000);
  });
});

describe("Fusion honnête — aspect radar et cible qui manœuvre", () => {
  const radarObservation = (simTime: number, positionWorld: Vector3, rng: () => number, crossSection: number, rangeNoise = 20, bearingNoise = 1e-4): Observation => {
    const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
    const noisy = positionWorld.clone().add(new Vector3(gaussian(), gaussian(), gaussian()).multiplyScalar(bearingNoise * positionWorld.length()));
    return {
      simTime,
      sourceSensorId: "radar-1",
      mode: "radar_active",
      bearingWorld: noisy.clone().normalize(),
      bearingUncertaintyRad: bearingNoise,
      rangeMeters: positionWorld.length() + gaussian() * rangeNoise,
      rangeUncertaintyMeters: rangeNoise,
      crossSectionEstimateM2: crossSection * Math.exp(0.4 * gaussian()),
      crossSectionLogUncertainty: 0.4,
    };
  };

  it("un même vaisseau longtemps vu de face (60 m²) puis de flanc (400 m²) garde une seule piste", () => {
    const rng = createSeededRng(5);
    let tracks: Track[] = [];
    let next = 1;
    for (let i = 0; i < 300; i++) {
      const position = new Vector3(500000, 1000 * i, 0);
      const obs = radarObservation(i * 2, position, rng, i < 150 ? 60 : 400);
      if (i > 0) for (const track of tracks) extrapolateTrack(track, i * 2, 2, undefined, new Vector3());
      const match = findCompatibleTrack(tracks, obs, new Vector3());
      if (match.track) fuseObservationIntoTrack(match.track, obs, new Vector3());
      else tracks = [...tracks, createTrackFromObservation(`piste-${next++}`, obs, new Vector3())];
    }
    expect(tracks).toHaveLength(1);
  });

  it("un missile (0,5 m²) qui se sépare d'un vaisseau n'est pas fondu dans sa piste", () => {
    const rng = createSeededRng(6);
    const ship = createTrackFromObservation("piste-1", radarObservation(0, new Vector3(300000, 0, 0), rng, 150), new Vector3());
    for (let i = 1; i < 20; i++) fuseObservationIntoTrack(ship, radarObservation(i, new Vector3(300000, 0, 0), rng, 150), new Vector3());
    let merged = 0;
    for (let i = 0; i < 200; i++) {
      const obs = radarObservation(20, new Vector3(300000, 0, 0), rng, 0.5);
      if (findCompatibleTrack([ship], obs, new Vector3()).track) merged++;
    }
    expect(merged).toBe(0);
  });

  it("cible qui se met à pousser à 1 g : la manœuvre est détectée et l'incertitude annoncée couvre l'erreur réelle", () => {
    const rng = createSeededRng(7);
    const initial = new Vector3(300000, 0, 0);
    const velocity = new Vector3(-200, 50, 0);
    const acceleration = new Vector3(0, 9.8, 0);
    const truth = (t: number) => {
      const position = initial.clone().addScaledVector(velocity, t);
      const thrusting = Math.max(0, t - 60);
      return {
        position: position.addScaledVector(acceleration, 0.5 * thrusting * thrusting),
        velocity: velocity.clone().addScaledVector(acceleration, thrusting),
      };
    };
    const track = createTrackFromObservation("piste-1", radarObservation(0, truth(0).position, rng, 150), new Vector3());
    let worstRatio = 0;
    let sawManeuver = false;
    for (let t = 1; t <= 120; t++) {
      extrapolateTrack(track, t, 1, undefined, new Vector3());
      fuseObservationIntoTrack(track, radarObservation(t, truth(t).position, rng, 150), new Vector3());
      if (t < 5 || !track.velocityEstimateWorld) continue;
      const error = track.velocityEstimateWorld.distanceTo(truth(t).velocity);
      worstRatio = Math.max(worstRatio, error / track.velocityUncertaintyMps!);
      if (track.maneuvering) sawManeuver = true;
    }
    expect(sawManeuver).toBe(true);
    // Ancien comportement : ~150 m/s d'erreur pour ~1 m/s annoncé (rapport > 100).
    expect(worstRatio).toBeLessThan(4);
  });
});
