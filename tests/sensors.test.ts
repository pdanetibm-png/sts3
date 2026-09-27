import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { stepDetection } from "../src/sim/detection";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import { Missile } from "../src/sim/missile";
import { RigidBody } from "../src/sim/rigidBody";
import { createSeededRng } from "../src/sim/rng";
import {
  detectionProbability,
  frameSeconds,
  infraredRangeFor,
  listenRangeFor,
  radarRangeFor,
} from "../src/sim/sensorPhysics";
import { evaluateRadarPassiveListen, evaluateSensor } from "../src/sim/sensors";
import { infraredIntensityToward, REFERENCE_CROSS_SECTION_M2 } from "../src/sim/signature";
import { asTarget, buildShipInit, TEST_MISSILE } from "./fixtures";

const rng = () => createSeededRng(1);

function makeBody(id: string, position: [number, number, number], overrides: Parameters<typeof buildShipInit>[0] = {}) {
  return new RigidBody(buildShipInit({ id, position, ...overrides }));
}

function enable(body: RigidBody, sensorId: string): void {
  const state = body.sensorStates.get(sensorId);
  if (state) state.enabled = true;
}

const sensorOf = (body: RigidBody, mode: string) => body.sensors.find((s) => s.mode === mode)!;

describe("DET-01 — connaissance imparfaite (IR passif)", () => {
  it("une observation IR ne porte structurellement ni distance ni vitesse vraies", () => {
    const observer = makeBody("observer", [0, 0, 0]);
    const target = makeBody("target", [1000, 0, 0], { affiliation: "adversaire" });
    enable(observer, "ir-1");
    const result = evaluateSensor(observer, asTarget(target), sensorOf(observer, "ir_passive"), 0, rng());
    expect(result).not.toBeNull();
    expect(result!.rangeMeters).toBeUndefined();
    expect(Object.keys(result!)).not.toContain("velocityWorld");
  });

  it("silence : une coque froide bien au-delà de la portée ne produit aucune observation inventée", () => {
    const observer = makeBody("observer", [0, 0, 0]);
    const target = makeBody("target", [500000, 0, 0], { affiliation: "adversaire" });
    enable(observer, "ir-1");
    expect(evaluateSensor(observer, asTarget(target), sensorOf(observer, "ir_passive"), 0, rng())).toBeNull();
  });

  it("un capteur non activé ne produit jamais d'observation", () => {
    const observer = makeBody("observer", [0, 0, 0]);
    const target = makeBody("target", [500, 0, 0], { affiliation: "adversaire" });
    expect(evaluateSensor(observer, asTarget(target), sensorOf(observer, "ir_passive"), 0, rng())).toBeNull();
  });
});

describe("Lois physiques des capteurs (CONCEPTION_DETECTION.md)", () => {
  const body = makeBody("b", [0, 0, 0]);
  const ir = sensorOf(body, "ir_passive");
  const radar = sensorOf(body, "radar_active");
  const listen = sensorOf(body, "radar_passive");

  it("IR : la portée varie comme la racine carrée de l'intensité (flux en 1/d²)", () => {
    expect(infraredRangeFor(ir, 4000, Math.PI) / infraredRangeFor(ir, 1000, Math.PI)).toBeCloseTo(2, 6);
  });

  it("radar : la portée varie comme la racine quatrième de la surface radar (écho en 1/d⁴)", () => {
    expect(radarRangeFor(radar, 1600, Math.PI) / radarRangeFor(radar, 100, Math.PI)).toBeCloseTo(2, 6);
  });

  it("un secteur étroit, une fois la revisite minimale atteinte, gagne de la portée (intégration plus longue)", () => {
    const narrow = (1 * Math.PI) / 180;
    expect(frameSeconds(radar, narrow)).toBeCloseTo(radar.minFrameSeconds, 9);
    expect(radarRangeFor(radar, REFERENCE_CROSS_SECTION_M2, narrow)).toBeGreaterThan(3 * radarRangeFor(radar, REFERENCE_CROSS_SECTION_M2, Math.PI));
  });

  it("écoute : un radar s'entend bien plus loin dans son faisceau que par ses lobes secondaires", () => {
    const ratio = listenRangeFor(listen, radar, true) / listenRangeFor(listen, radar, false);
    expect(ratio).toBeCloseTo(Math.sqrt(1 / radar.sideLobeLevel!), 6);
  });

  it("probabilité de détection : 50 % au seuil, ~94 % au double, ~6 % à la moitié", () => {
    expect(detectionProbability(1)).toBeCloseTo(0.5, 9);
    expect(detectionProbability(2)).toBeCloseTo(16 / 17, 6);
    expect(detectionProbability(0.5)).toBeCloseTo(1 / 17, 6);
  });

  it("le jet d'un vaisseau qui pousse est bien plus visible de dos que de face", () => {
    const ship = makeBody("s", [0, 0, 0]);
    ship.command.throttle = 1;
    ship.lastAllocation = { forceWorld: new Vector3(3e6, 0, 0), torqueBody: new Vector3(), fuelFlowKgPerSecond: 0, perThrusterThrottle: [1, ...Array(12).fill(0)] };
    const source = ship.signatureSource();
    const behind = infraredIntensityToward(source, new Vector3(-10000, 0, 0), 0.3);
    const ahead = infraredIntensityToward(source, new Vector3(10000, 0, 0), 0.3);
    const side = infraredIntensityToward(source, new Vector3(0, 10000, 0), 0.3);
    expect(behind).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(ahead);
    expect(behind / ahead).toBeGreaterThan(10);
  });

  it("la précision de mesure s'améliore quand le signal est fort (cible proche)", () => {
    const observer = makeBody("o", [0, 0, 0]);
    enable(observer, "radar-1");
    const near = evaluateSensor(observer, asTarget(makeBody("n", [2000, 0, 0], { affiliation: "adversaire" })), radar, 0, rng());
    const far = evaluateSensor(observer, asTarget(makeBody("f", [9000, 0, 0], { affiliation: "adversaire" })), radar, 0, rng());
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.bearingUncertaintyRad).toBeLessThan(far!.bearingUncertaintyRad);
    expect(near!.rangeUncertaintyMeters!).toBeLessThan(far!.rangeUncertaintyMeters!);
  });

  it("DET-05 : la coque chauffe quand le moteur pousse et refroidit lentement après coupure", () => {
    const ship = makeBody("s", [0, 0, 0]);
    const cruising = ship.hullTemperatureK;
    ship.lastAllocation = { forceWorld: new Vector3(3e6, 0, 0), torqueBody: new Vector3(), fuelFlowKgPerSecond: 0, perThrusterThrottle: [1, ...Array(12).fill(0)] };
    for (let i = 0; i < 600; i++) ship.stepThermal(1);
    const hot = ship.hullTemperatureK;
    expect(hot).toBeGreaterThan(cruising + 5);
    ship.lastAllocation = { ...ship.lastAllocation, perThrusterThrottle: Array(13).fill(0) };
    ship.stepThermal(10);
    expect(ship.hullTemperatureK).toBeGreaterThan(cruising);
    expect(ship.hullTemperatureK).toBeLessThan(hot);
  });
});

describe("DET-07 — écoute passive", () => {
  it("détecte l'émission d'un radar actif adverse en balayage, sans révéler sa position", () => {
    const observer = makeBody("observer", [0, 0, 0]);
    const emitter = makeBody("emitter", [3000, 0, 0], { affiliation: "adversaire" });
    enable(observer, "listen-1");
    enable(emitter, "radar-1");
    const results = evaluateRadarPassiveListen(observer, [observer, emitter], sensorOf(observer, "radar_passive"), 0, rng());
    expect(results).toHaveLength(1);
    expect(results[0].rangeMeters).toBeUndefined();
    expect(results[0].bearingWorld.dot(new Vector3(1, 0, 0))).toBeCloseTo(1, 1);
  });

  it("silence adverse (radar éteint) ⇒ aucune émission inventée", () => {
    const observer = makeBody("observer", [0, 0, 0]);
    const emitter = makeBody("emitter", [3000, 0, 0], { affiliation: "adversaire" });
    enable(observer, "listen-1");
    expect(evaluateRadarPassiveListen(observer, [observer, emitter], sensorOf(observer, "radar_passive"), 0, rng())).toHaveLength(0);
  });

  it("un radar en secteur tourné ailleurs ne s'entend qu'à courte distance (lobes secondaires)", () => {
    const observer = makeBody("observer", [0, 0, 0]);
    const emitter = makeBody("emitter", [20000, 0, 0], { affiliation: "adversaire" });
    enable(observer, "listen-1");
    enable(emitter, "radar-1");
    const listen = sensorOf(observer, "radar_passive");
    expect(evaluateRadarPassiveListen(observer, [observer, emitter], listen, 0, rng())).toHaveLength(1);
    const state = emitter.sensorStates.get("radar-1")!;
    state.scanDirectionWorld = new Vector3(1, 0, 0);
    state.scanHalfAngleRad = 0.1;
    expect(evaluateRadarPassiveListen(observer, [observer, emitter], listen, 0, rng())).toHaveLength(0);
  });
});

describe("Missiles détectables, classification et séparation des contacts", () => {
  function hostileMissileAt(position: Vector3): Missile {
    return new Missile({
      id: "m-1",
      ownerId: "adversaire-1",
      affiliation: "adversaire",
      position,
      velocity: new Vector3(-100, 0, 0),
      def: TEST_MISSILE,
      assignedTrackId: null,
      hypotheticalTargetWorld: null,
      simTime: 0,
      initialTemperatureK: 250,
    });
  }

  function run(bodies: RigidBody[], missiles: Missile[], seconds: number): void {
    const random = createSeededRng(9);
    for (let i = 0; i < Math.round(seconds / FIXED_DT_SECONDS); i++) stepDetection(bodies, missiles, (i + 1) * FIXED_DT_SECONDS, FIXED_DT_SECONDS, random);
  }

  it("un missile adverse est détecté au radar et classé « missile probable »", () => {
    const observer = makeBody("joueur-1", [0, 0, 0]);
    enable(observer, "radar-1");
    run([observer], [hostileMissileAt(new Vector3(800, 0, 0))], 20);
    expect(observer.knowledge.tracks.length).toBeGreaterThan(0);
    expect(observer.knowledge.tracks[0].classification).toBe("missile probable");
  });

  it("un vaisseau adverse est classé « vaisseau probable »", () => {
    const observer = makeBody("joueur-1", [0, 0, 0]);
    const enemy = makeBody("adversaire-1", [6000, 0, 0], { affiliation: "adversaire" });
    enable(observer, "radar-1");
    run([observer, enemy], [], 20);
    expect(observer.knowledge.tracks[0].classification).toBe("vaisseau probable");
  });

  it("un missile de son propre camp n'ouvre jamais de piste (liaison de données)", () => {
    const observer = makeBody("joueur-1", [0, 0, 0]);
    enable(observer, "radar-1");
    const friendly = hostileMissileAt(new Vector3(1500, 0, 0));
    Object.assign(friendly, { affiliation: "joueur" });
    run([observer], [friendly], 20);
    expect(observer.knowledge.tracks).toHaveLength(0);
  });

  it("trois vaisseaux proches en gisement mais séparés en distance donnent trois pistes au radar", () => {
    const observer = makeBody("joueur-1", [0, 0, 0]);
    const a = makeBody("adversaire-1", [4000, 0, 0], { affiliation: "adversaire" });
    const b = makeBody("adversaire-2", [6000, 30, 0], { affiliation: "adversaire" });
    const c = makeBody("adversaire-3", [8000, -30, 0], { affiliation: "adversaire" });
    enable(observer, "radar-1");
    run([observer, a, b, c], [], 30);
    const withPosition = observer.knowledge.tracks.filter((t) => t.positionEstimateWorld);
    expect(withPosition).toHaveLength(3);
    const ranges = withPosition.map((t) => t.positionEstimateWorld!.length()).sort((x, y) => x - y);
    expect(ranges[0]).toBeCloseTo(4000, -2);
    expect(ranges[1]).toBeCloseTo(6000, -2);
    expect(ranges[2]).toBeCloseTo(8000, -2);
  });

  it("l'attitude compte : un vaisseau de profil renvoie plus au radar que de face", () => {
    const observer = makeBody("o", [0, 0, 0]);
    const radar = sensorOf(observer, "radar_active");
    const face = makeBody("t", [10000, 0, 0], { affiliation: "adversaire", signature: { ...buildShipInit().signature, radar: { crossSectionFrontM2: 10, crossSectionSideM2: 400 } } });
    const side = makeBody("t", [10000, 0, 0], { affiliation: "adversaire", signature: { ...buildShipInit().signature, radar: { crossSectionFrontM2: 10, crossSectionSideM2: 400 } } });
    side.attitude.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
    enable(observer, "radar-1");
    const snrFace = evaluateSensor(observer, asTarget(face), radar, 0, () => 0)!.snr!;
    const snrSide = evaluateSensor(observer, asTarget(side), radar, 0, () => 0)!.snr!;
    expect(snrSide / snrFace).toBeCloseTo(40, 0);
  });
});
