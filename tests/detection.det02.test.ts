import { describe, expect, it } from "vitest";
import { RigidBody } from "../src/sim/rigidBody";
import { createSeededRng } from "../src/sim/rng";
import { evaluateSensor } from "../src/sim/sensors";
import { asTarget, buildShipInit } from "./fixtures";

// DET-02 : deux mondes aux mouvements cachés différents mais aux observations identiques
// (même position, même signature au moment de la mesure) doivent produire la même piste —
// preuve que le modèle de capteur ne lit jamais la vitesse cachée de la cible.
describe("DET-02 — extrapolation sans fuite de vérité", () => {
  it("deux cibles à la même position mais avec des vitesses cachées différentes produisent une observation identique", () => {
    const observer = new RigidBody(buildShipInit({ id: "observer", position: [0, 0, 0] }));
    observer.sensorStates.get("radar-1")!.enabled = true;
    const sensor = observer.sensors.find((s) => s.mode === "radar_active")!;

    const targetWorldA = new RigidBody(buildShipInit({ id: "target", position: [5000, 0, 0], velocity: [10, 0, 0] }));
    const targetWorldB = new RigidBody(buildShipInit({ id: "target", position: [5000, 0, 0], velocity: [-300, 120, -45] }));

    const observationA = evaluateSensor(observer, asTarget(targetWorldA), sensor, 0, createSeededRng(42));
    const observationB = evaluateSensor(observer, asTarget(targetWorldB), sensor, 0, createSeededRng(42));

    expect(observationA).not.toBeNull();
    expect(observationB).not.toBeNull();
    expect(observationA!.bearingWorld.toArray()).toEqual(observationB!.bearingWorld.toArray());
    expect(observationA!.rangeMeters).toBeCloseTo(observationB!.rangeMeters!, 9);
    expect(observationA!.bearingUncertaintyRad).toBe(observationB!.bearingUncertaintyRad);
  });

  it("le résultat de detection ne dépend jamais de la vitesse de l'observateur ou de la cible", () => {
    const observer = new RigidBody(buildShipInit({ id: "observer", position: [0, 0, 0], velocity: [0, 0, 0] }));
    observer.sensorStates.get("ir-1")!.enabled = true;
    const sensor = observer.sensors.find((s) => s.mode === "ir_passive")!;

    const targetSlow = new RigidBody(buildShipInit({ id: "target", position: [2000, 0, 0], velocity: [1, 0, 0] }));
    const targetFast = new RigidBody(buildShipInit({ id: "target", position: [2000, 0, 0], velocity: [4000, -2000, 1000] }));
    targetSlow.hullTemperatureK = 320;
    targetFast.hullTemperatureK = 320;

    const resultSlow = evaluateSensor(observer, asTarget(targetSlow), sensor, 0, createSeededRng(7));
    const resultFast = evaluateSensor(observer, asTarget(targetFast), sensor, 0, createSeededRng(7));

    expect(resultSlow).not.toBeNull();
    expect(resultFast).not.toBeNull();
    expect(resultSlow!.bearingWorld.toArray()).toEqual(resultFast!.bearingWorld.toArray());
  });
});
