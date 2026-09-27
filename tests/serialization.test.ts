import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { quatToTuple, tupleToQuat, tupleToVec3, vecToTuple } from "../src/shared/vecSerialization";

describe("sérialisation vecteur/quaternion partagée", () => {
  it("Vector3 → tuple → Vector3 conserve les composantes", () => {
    const v = new Vector3(1.5, -2.25, 3.75);
    const restored = tupleToVec3(vecToTuple(v));
    expect(restored.x).toBe(v.x);
    expect(restored.y).toBe(v.y);
    expect(restored.z).toBe(v.z);
  });

  it("Quaternion → tuple → Quaternion conserve les composantes", () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.9).normalize();
    const restored = tupleToQuat(quatToTuple(q));
    expect(restored.x).toBe(q.x);
    expect(restored.y).toBe(q.y);
    expect(restored.z).toBe(q.z);
    expect(restored.w).toBe(q.w);
  });

  it("le tuple est un JSON.stringify/parse valide (forme réellement sérialisable)", () => {
    const v = new Vector3(10, 20, 30);
    const roundTripped = JSON.parse(JSON.stringify(vecToTuple(v)));
    expect(tupleToVec3(roundTripped).equals(v)).toBe(true);
  });
});
