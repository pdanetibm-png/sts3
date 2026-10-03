import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { stepCombatAI, type CombatAIContext } from "../src/sim/combatAI";
import type { Decoy } from "../src/sim/decoy";
import { FIXED_DT_SECONDS, integrateBody } from "../src/sim/integrator";
import { RigidBody } from "../src/sim/rigidBody";
import type { DoctrineDef } from "../src/sim/types";
import { buildShipInit, TEST_DECOY, TEST_DECOY_DOCTRINE, TEST_DOCTRINE } from "./fixtures";

const dt = FIXED_DT_SECONDS;

function buildAdversary(doctrine: DoctrineDef = TEST_DECOY_DOCTRINE, decoyCount = 2): RigidBody {
  return new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 0, 0], doctrine, decoy: TEST_DECOY, decoyCount, missileCount: 0 }));
}

/**
 * Menace dans la connaissance de l'IA : écho de missile (0,1 m²) mesuré au radar pendant 3 s,
 * qui fonce sur elle à 200 m/s depuis 3 km — temps d'arrivée estimé ≈ 12 s.
 */
function ingestIncomingMissile(body: RigidBody): void {
  for (let t = 0; t <= 3 + 1e-9; t += 0.25) {
    const position = new Vector3(3000 - 200 * t, 0, 0);
    body.knowledge.ingest(
      {
        simTime: t,
        sourceSensorId: "radar-1",
        mode: "radar_active",
        bearingWorld: position.clone().normalize(),
        bearingUncertaintyRad: 1e-4,
        rangeMeters: position.length(),
        rangeUncertaintyMeters: 1,
        crossSectionEstimateM2: 0.1,
        crossSectionLogUncertainty: 0.4,
      },
      body.position,
    );
  }
}

/** Façade d'action de l'IA qui note l'instant de chaque largage (horloge du test, avancée par `run`). */
function recordingContext(): { context: CombatAIContext; drops: number[]; clock: { t: number } } {
  const drops: number[] = [];
  const clock = { t: 0 };
  const context: CombatAIContext = {
    launchMissile: () => null,
    launchDecoy: (owner) => {
      if (owner.decoyCount <= 0) return null;
      owner.decoyCount -= 1;
      drops.push(clock.t);
      return { id: `leurre-${drops.length}` } as Decoy;
    },
  };
  return { context, drops, clock };
}

/** Boucle minimale « moteur puis IA », comme SimulationWorld.step, sans autre corps. */
function run(body: RigidBody, recorder: ReturnType<typeof recordingContext>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    recorder.clock.t += dt;
    integrateBody(body, dt);
    stepCombatAI(body, dt, recorder.context);
  }
}

const radarEnabled = (body: RigidBody) => body.sensorStates.get(body.sensors.find((s) => s.mode === "radar_active")!.id)!.enabled;

describe("IA — tactique de leurre (CONCEPTION_LEURRES.md §7)", () => {
  it("menacée pendant qu'elle pousse : larguer tout de suite, puis dériver moteurs coupés et radar éteint", () => {
    const body = buildAdversary();
    ingestIncomingMissile(body);
    body.command.throttle = 0.3;
    integrateBody(body, dt);
    const recorder = recordingContext();
    const { context, drops } = recorder;

    stepCombatAI(body, dt, context);

    expect(drops).toHaveLength(1);
    expect(body.aiState.decoyPhase).toBe("derive");
    expect(body.command.throttle).toBe(0);
    expect(radarEnabled(body)).toBe(false);

    // Toute la dérive : ni poussée ni radar, et pas de second largage (délai minimal).
    run(body, recorder, TEST_DECOY_DOCTRINE.decoyDriftSeconds! - 1);
    expect(body.aiState.decoyPhase).toBe("derive");
    expect(body.principalThrottle).toBe(0);
    expect(radarEnabled(body)).toBe(false);
    expect(drops).toHaveLength(1);
  });

  it("menacée sans pousser : prendre d'abord un vecteur perpendiculaire à la menace, puis larguer en poussant", () => {
    const body = buildAdversary();
    ingestIncomingMissile(body);
    const recorder = recordingContext();
    const { context, drops } = recorder;

    stepCombatAI(body, dt, context);
    expect(drops).toHaveLength(0);
    expect(body.aiState.decoyPhase).toBe("vecteur");
    const localAxis = new Vector3(...body.principalThruster.localAxis);
    const wanted = localAxis.clone().applyQuaternion(body.command.targetAttitude);
    expect(Math.abs(wanted.dot(new Vector3(1, 0, 0)))).toBeLessThan(1e-6);

    let dropAttitudeDot = Number.NaN;
    for (let i = 0; i < 40 / dt && drops.length === 0; i++) {
      run(body, recorder, dt);
      if (drops.length > 0) dropAttitudeDot = localAxis.clone().applyQuaternion(body.attitude).dot(new Vector3(1, 0, 0));
    }
    expect(drops).toHaveLength(1);
    expect(drops[0]).toBeGreaterThanOrEqual(TEST_DECOY_DOCTRINE.decoyVectorSeconds!);
    expect(Math.abs(dropAttitudeDot)).toBeLessThan(0.35);
    expect(body.aiState.decoyPhase).toBe("derive");
  });

  it("après la dérive et le délai minimal, une menace persistante déclenche un nouveau largage", () => {
    const body = buildAdversary();
    ingestIncomingMissile(body);
    body.command.throttle = 0.3;
    integrateBody(body, dt);
    const recorder = recordingContext();
    const { context, drops } = recorder;
    stepCombatAI(body, dt, context);
    run(body, recorder, TEST_DECOY_DOCTRINE.decoyCooldownSeconds! + TEST_DECOY_DOCTRINE.decoyVectorSeconds! + 10);
    expect(drops).toHaveLength(2);
    expect(drops[1]).toBeGreaterThanOrEqual(TEST_DECOY_DOCTRINE.decoyCooldownSeconds!);
  });

  it("sans leurre en soute, ou sans doctrine de leurre, aucune tactique", () => {
    for (const body of [buildAdversary(TEST_DECOY_DOCTRINE, 0), buildAdversary(TEST_DOCTRINE, 2)]) {
      ingestIncomingMissile(body);
      const recorder = recordingContext();
      run(body, recorder, 20);
      expect(recorder.drops).toHaveLength(0);
      expect(body.aiState.decoyPhase).toBe("aucune");
    }
  });

  it("une piste de vaisseau qui se rapproche n'est pas une menace de missile", () => {
    const body = buildAdversary();
    for (let t = 0; t <= 3 + 1e-9; t += 0.25) {
      const position = new Vector3(3000 - 200 * t, 0, 0);
      body.knowledge.ingest(
        {
          simTime: t,
          sourceSensorId: "radar-1",
          mode: "radar_active",
          bearingWorld: position.clone().normalize(),
          bearingUncertaintyRad: 1e-4,
          rangeMeters: position.length(),
          rangeUncertaintyMeters: 1,
          crossSectionEstimateM2: 200,
        },
        body.position,
      );
    }
    body.command.throttle = 0.3;
    integrateBody(body, dt);
    const recorder = recordingContext();
    const { context, drops } = recorder;
    stepCombatAI(body, dt, context);
    expect(drops).toHaveLength(0);
  });
});

describe("IA — défense terminale (doctrine terminalDefenseSeconds)", () => {
  const radarState = (body: RigidBody) => body.sensorStates.get(body.sensors.find((s) => s.mode === "radar_active")!.id)!;
  const missileTrackId = (body: RigidBody) => body.knowledge.tracks.find((t) => t.classification === "missile probable")!.localId;

  it("en pleine dérive, un missile attendu avant le seuil rallume le radar, en Suivi sur lui (la PDC a besoin d'une piste fraîche)", () => {
    const body = buildAdversary({ ...TEST_DECOY_DOCTRINE, terminalDefenseSeconds: 20 });
    ingestIncomingMissile(body);
    body.command.throttle = 0.3;
    integrateBody(body, dt);
    stepCombatAI(body, dt, recordingContext().context);

    expect(body.aiState.decoyPhase).toBe("derive");
    expect(body.command.throttle).toBe(0);
    expect(radarState(body).enabled).toBe(true);
    expect(radarState(body).followedTrackId).toBe(missileTrackId(body));
  });

  it("menace encore au-delà du seuil, ou doctrine sans défense terminale : la dérive reste radar éteint", () => {
    for (const doctrine of [{ ...TEST_DECOY_DOCTRINE, terminalDefenseSeconds: 5 }, TEST_DECOY_DOCTRINE]) {
      const body = buildAdversary(doctrine);
      ingestIncomingMissile(body);
      body.command.throttle = 0.3;
      integrateBody(body, dt);
      stepCombatAI(body, dt, recordingContext().context);

      expect(body.aiState.decoyPhase).toBe("derive");
      expect(radarState(body).enabled).toBe(false);
      expect(radarState(body).followedTrackId).toBeNull();
    }
  });

  it("une piste de missile perdue faute de mesures sert encore à rallumer le radar : sa position extrapolée dit où chercher", () => {
    const body = buildAdversary({ ...TEST_DECOY_DOCTRINE, terminalDefenseSeconds: 20 });
    ingestIncomingMissile(body);
    const track = body.knowledge.getTrack(missileTrackId(body))!;
    track.state = "lost";
    stepCombatAI(body, dt, recordingContext().context);
    expect(radarState(body).enabled).toBe(true);
    expect(radarState(body).followedTrackId).toBe(track.localId);
  });
});
