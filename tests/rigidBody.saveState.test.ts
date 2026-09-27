import { describe, expect, it } from "vitest";
import { RigidBody } from "../src/sim/rigidBody";
import { buildShipInit } from "./fixtures";

describe("RigidBody — sauvegarde/restauration de l'état runtime (SAV-01)", () => {
  it("toSaveState()/applySaveState() restaure position, vitesse, attitude et consigne pilote", () => {
    const original = new RigidBody(buildShipInit());
    original.position.set(100, 200, 300);
    original.velocity.set(10, -5, 2);
    original.attitude.set(0.1, 0.2, 0.3, 0.9).normalize();
    original.angularVelocity.set(0.01, 0.02, -0.01);
    original.hullTemperatureK = 123.4;
    original.missileCount = 2;
    original.reservoir.quantityKg = 42000;
    original.battery.currentChargeWattSeconds = 1_000_000;
    original.command.throttle = 0.75;
    original.command.attitudeHoldEngaged = true;
    original.command.targetAttitude.set(0.2, 0.1, 0.4, 0.8).normalize();
    original.command.navMode = "interception";
    original.command.navTrackId = "piste-3";
    original.trail.push(original.position.clone());
    original.crewExposureFraction = 0.42;
    original.crewExposureTrendPerSecond = 0.01;
    original.crewExposureDominantAxis = "y";
    original.crewExposureIncapacitated = false;
    original.lifeSupportRemainingAutonomySeconds = 55;
    original.lifeSupportFailed = false;

    const sensorId = original.sensors[0].id;
    const sensorState = original.sensorStates.get(sensorId)!;
    sensorState.enabled = true;
    sensorState.cycleElapsedSeconds = 1.5;
    sensorState.scanDirectionWorld.set(0, 0, 1);
    sensorState.scanHalfAngleRad = 0.3;
    sensorState.followedTrackId = "piste-1";

    const saved = original.toSaveState();

    const restored = new RigidBody(buildShipInit());
    restored.applySaveState(saved);

    expect(restored.position.equals(original.position)).toBe(true);
    expect(restored.velocity.equals(original.velocity)).toBe(true);
    expect(restored.attitude.equals(original.attitude)).toBe(true);
    expect(restored.angularVelocity.equals(original.angularVelocity)).toBe(true);
    expect(restored.hullTemperatureK).toBe(original.hullTemperatureK);
    expect(restored.missileCount).toBe(original.missileCount);
    expect(restored.reservoir.quantityKg).toBe(original.reservoir.quantityKg);
    expect(restored.battery.currentChargeWattSeconds).toBe(original.battery.currentChargeWattSeconds);
    expect(restored.command.throttle).toBe(0.75);
    expect(restored.command.attitudeHoldEngaged).toBe(true);
    expect(restored.command.targetAttitude.equals(original.command.targetAttitude)).toBe(true);
    expect(restored.command.navMode).toBe("interception");
    expect(restored.command.navTrackId).toBe("piste-3");
    expect(restored.trail).toHaveLength(1);
    expect(restored.trail[0].equals(original.trail[0])).toBe(true);
    expect(restored.crewExposureFraction).toBe(0.42);
    expect(restored.crewExposureDominantAxis).toBe("y");
    expect(restored.lifeSupportRemainingAutonomySeconds).toBe(55);

    const restoredSensorState = restored.sensorStates.get(sensorId)!;
    expect(restoredSensorState.enabled).toBe(true);
    expect(restoredSensorState.cycleElapsedSeconds).toBe(1.5);
    expect(restoredSensorState.scanDirectionWorld.equals(sensorState.scanDirectionWorld)).toBe(true);
    expect(restoredSensorState.followedTrackId).toBe("piste-1");
  });

  it("un verrou d'incapacité sauvegardé reste vrai après restauration", () => {
    const original = new RigidBody(buildShipInit());
    original.crewExposureFraction = 1;
    original.crewExposureIncapacitated = true;
    original.lifeSupportFailed = true;
    original.lifeSupportRemainingAutonomySeconds = 0;

    const restored = new RigidBody(buildShipInit());
    restored.applySaveState(original.toSaveState());

    expect(restored.crewExposureIncapacitated).toBe(true);
    expect(restored.lifeSupportFailed).toBe(true);
    expect(restored.lifeSupportRemainingAutonomySeconds).toBe(0);
  });

  it("toSaveState() produit une forme JSON-safe (survit à un stringify/parse)", () => {
    const original = new RigidBody(buildShipInit());
    original.position.set(1, 2, 3);
    const roundTripped = JSON.parse(JSON.stringify(original.toSaveState()));

    const restored = new RigidBody(buildShipInit());
    restored.applySaveState(roundTripped);
    expect(restored.position.x).toBe(1);
    expect(restored.position.y).toBe(2);
    expect(restored.position.z).toBe(3);
  });
});
