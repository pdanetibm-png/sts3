import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { KnowledgeBase } from "../src/knowledge/knowledgeBase";
import { trackFromSaveState, trackToSaveState } from "../src/knowledge/serialization";

describe("KnowledgeBase — export/import en bloc (SAV-01)", () => {
  it("les pistes et le prochain numéro d'ID survivent à un export/import complet", () => {
    const kb = new KnowledgeBase();
    kb.ingest(
      { simTime: 0, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: 0.05 },
      new Vector3(),
    );
    kb.ingest(
      { simTime: 1, sourceSensorId: "radar-1", mode: "radar_active", bearingWorld: new Vector3(0, 1, 0), bearingUncertaintyRad: 0.02, rangeMeters: 5000, rangeUncertaintyMeters: 10 },
      new Vector3(),
    );
    expect(kb.tracks).toHaveLength(2);
    const nextIdBefore = kb.nextTrackNumberForSave;

    const saved = kb.tracks.map(trackToSaveState);
    const restored = new KnowledgeBase();
    restored.loadTracks(saved.map(trackFromSaveState), nextIdBefore);

    expect(restored.tracks).toHaveLength(2);
    expect(restored.tracks.map((t) => t.localId).sort()).toEqual(kb.tracks.map((t) => t.localId).sort());
    expect(restored.nextTrackNumberForSave).toBe(nextIdBefore);

    const restoredTrack2 = restored.getTrack("piste-2")!;
    const originalTrack2 = kb.getTrack("piste-2")!;
    expect(restoredTrack2.positionEstimateWorld?.equals(originalTrack2.positionEstimateWorld!)).toBe(true);
    expect(restoredTrack2.positionUncertaintyMeters).toBe(originalTrack2.positionUncertaintyMeters);
  });

  it("après import, un nouvel identifiant généré ne collisionne jamais avec un ID restauré", () => {
    const kb = new KnowledgeBase();
    kb.ingest(
      { simTime: 0, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: new Vector3(1, 0, 0), bearingUncertaintyRad: 0.05 },
      new Vector3(),
    );
    const saved = kb.tracks.map(trackToSaveState);
    const restored = new KnowledgeBase();
    restored.loadTracks(saved.map(trackFromSaveState), kb.nextTrackNumberForSave);

    // Un gisement incompatible (à l'opposé) crée une NOUVELLE piste plutôt que de fusionner.
    const newTrack = restored.ingest(
      { simTime: 5, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: new Vector3(-1, 0, 0), bearingUncertaintyRad: 0.05 },
      new Vector3(),
    );
    expect(newTrack.localId).not.toBe("piste-1");
    expect(restored.tracks.map((t) => t.localId)).toContain(newTrack.localId);
  });
});
