import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { stepCombatAI, type CombatAIContext } from "../src/sim/combatAI";
import { RigidBody } from "../src/sim/rigidBody";
import { buildShipInit } from "./fixtures";

/** Une IA face à un contact à 4 km (dans son enveloppe de tir), mesuré deux fois au radar. */
function aiFacing(crossSectionM2: number): { launches: string[] } {
  const body = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire" }));
  for (const simTime of [0, 0.5]) {
    body.knowledge.ingest(
      {
        simTime,
        sourceSensorId: "radar-1",
        mode: "radar_active",
        bearingWorld: new Vector3(1, 0, 0),
        bearingUncertaintyRad: 0.001,
        rangeMeters: 4000,
        rangeUncertaintyMeters: 5,
        crossSectionEstimateM2: crossSectionM2,
      },
      body.position,
    );
  }
  const launches: string[] = [];
  const context: CombatAIContext = {
    launchMissile: (_owner, trackId) => {
      launches.push(trackId);
      return null;
    },
    launchDecoy: () => null,
  };
  stepCombatAI(body, 1 / 60, context);
  return { launches };
}

describe("IA — règle de tir", () => {
  it("tire sur un contact classé « vaisseau probable »", () => {
    expect(aiFacing(300).launches).toHaveLength(1);
  });

  it("ne tire jamais sur un contact non classé : ce peut être un missile", () => {
    expect(aiFacing(10).launches).toHaveLength(0);
  });
});
