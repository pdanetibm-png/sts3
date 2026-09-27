import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Missile } from "../src/sim/missile";
import { TEST_MISSILE } from "./fixtures";

describe("Missile — sauvegarde/restauration de l'état runtime (SAV-01)", () => {
  it("toSaveState()/fromSaveState() restaure position, vitesse, état et réserve", () => {
    const original = new Missile({
      id: "missile-7",
      ownerId: "joueur-1",
      affiliation: "joueur",
      position: new Vector3(100, 0, 0),
      velocity: new Vector3(50, 0, 0),
      def: TEST_MISSILE,
      assignedTrackId: "piste-2",
      hypotheticalTargetWorld: null,
      simTime: 12,
      initialTemperatureK: 250,
    });
    original.position.set(500, 10, -20);
    original.velocity.set(300, 5, -2);
    original.state = "derive";
    original.trail.push(new Vector3(100, 0, 0), new Vector3(300, 5, -10));
    original.lastFuelFlowKgPerSecond = 6.1;
    original.reservoir.quantityKg = 12.5;

    const saved = original.toSaveState();
    const restored = Missile.fromSaveState(saved, TEST_MISSILE);

    expect(restored.id).toBe("missile-7");
    expect(restored.ownerId).toBe("joueur-1");
    expect(restored.position.equals(original.position)).toBe(true);
    expect(restored.velocity.equals(original.velocity)).toBe(true);
    expect(restored.state).toBe("derive");
    expect(restored.assignedTrackId).toBe("piste-2");
    expect(restored.trail).toHaveLength(2);
    expect(restored.trail[1].equals(original.trail[1])).toBe(true);
    expect(restored.lastFuelFlowKgPerSecond).toBe(6.1);
    expect(restored.reservoir.quantityKg).toBe(12.5);
    expect(restored.createdSimTime).toBe(12);
  });

  it("une hypothèse de cible figée survit à la restauration", () => {
    const original = new Missile({
      id: "missile-1",
      ownerId: "joueur-1",
      affiliation: "joueur",
      position: new Vector3(),
      velocity: new Vector3(),
      def: TEST_MISSILE,
      assignedTrackId: "piste-1",
      hypotheticalTargetWorld: new Vector3(1000, 0, 0),
      simTime: 0,
      initialTemperatureK: 250,
    });

    const restored = Missile.fromSaveState(original.toSaveState(), TEST_MISSILE);
    expect(restored.hypotheticalTargetWorld?.equals(new Vector3(1000, 0, 0))).toBe(true);
  });

  it("toSaveState() produit une forme JSON-safe", () => {
    const original = new Missile({
      id: "missile-1",
      ownerId: "joueur-1",
      affiliation: "joueur",
      position: new Vector3(1, 2, 3),
      velocity: new Vector3(),
      def: TEST_MISSILE,
      assignedTrackId: null,
      hypotheticalTargetWorld: null,
      simTime: 0,
      initialTemperatureK: 250,
    });
    const roundTripped = JSON.parse(JSON.stringify(original.toSaveState()));
    const restored = Missile.fromSaveState(roundTripped, TEST_MISSILE);
    expect(restored.position.x).toBe(1);
    expect(restored.position.y).toBe(2);
    expect(restored.position.z).toBe(3);
  });
});
