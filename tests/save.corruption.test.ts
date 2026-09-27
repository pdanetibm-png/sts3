import { describe, expect, it } from "vitest";
import { LocalSaveStore, type StorageLike } from "../src/presentation/persistence/localSaveStore";
import { buildSaveDocument, SAVE_SCHEMA_VERSION } from "../src/sim/save";
import type { ScenarioDefinition } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  quotaExceededOnKeys = new Set<string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.quotaExceededOnKeys.has(key)) {
      const error = new Error("quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  raw(key: string): string | undefined {
    return this.data.get(key);
  }
}

function buildScenario(): ScenarioDefinition {
  return {
    version: "test",
    seed: 1,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur" }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [5000, 0, 0] }),
    ],
  };
}

function buildDoc() {
  const scenario = buildScenario();
  const world = new SimulationWorld(scenario);
  return buildSaveDocument(world, scenario, "joueur-1", false);
}

describe("SAV-02 — sauvegarde locale : corruption, version inconnue, quota plein", () => {
  it("aucune sauvegarde : readLatestValid renvoie null sans erreur", () => {
    const store = new LocalSaveStore(new FakeStorage());
    expect(store.readLatestValid()).toBeNull();
  });

  it("écrit puis relit un document valide", () => {
    const storage = new FakeStorage();
    const store = new LocalSaveStore(storage);
    const doc = buildDoc();
    expect(store.writeManual(doc)).toEqual({ ok: true });
    const result = store.readLatestValid();
    expect(result).not.toBeNull();
    expect(result?.slot).toBe("manuel");
    expect(result?.doc.scenario.seed).toBe(doc.scenario.seed);
  });

  it("un JSON corrompu dans un emplacement est ignoré, pas rejeté globalement", () => {
    const storage = new FakeStorage();
    storage.setItem("scs-save-manual", "{ceci n'est pas du JSON valide");
    const store = new LocalSaveStore(storage);
    expect(store.readLatestValid()).toBeNull();
  });

  it("une version de schéma inconnue est ignorée, pas acceptée telle quelle", () => {
    const storage = new FakeStorage();
    const doc = buildDoc();
    storage.setItem("scs-save-manual", JSON.stringify({ ...doc, schemaVersion: "999" }));
    const store = new LocalSaveStore(storage);
    expect(store.readLatestValid()).toBeNull();
    expect(SAVE_SCHEMA_VERSION).not.toBe("999");
  });

  it("un scénario embarqué invalide (échoue validateScenario) est ignoré", () => {
    const storage = new FakeStorage();
    const doc = buildDoc();
    const corrupted = { ...doc, scenario: { ...doc.scenario, ships: [] } };
    storage.setItem("scs-save-manual", JSON.stringify(corrupted));
    const store = new LocalSaveStore(storage);
    expect(store.readLatestValid()).toBeNull();
  });

  it("quota plein sur un emplacement : le résultat le signale sans effacer le contenu précédent de cet emplacement", () => {
    const storage = new FakeStorage();
    const store = new LocalSaveStore(storage);
    const doc = buildDoc();
    expect(store.writeManual(doc)).toEqual({ ok: true });

    storage.quotaExceededOnKeys.add("scs-save-manual");
    const secondDoc = { ...doc, savedAtIso: new Date(Date.now() + 1000).toISOString() };
    const result = store.writeManual(secondDoc);
    expect(result).toEqual({ ok: false, reason: "quota" });

    // Le contenu précédent (valide) est toujours là, intact.
    expect(JSON.parse(storage.raw("scs-save-manual")!).savedAtIso).toBe(doc.savedAtIso);
  });

  it("writeAuto alterne : la deuxième écriture ne détruit pas la première tant qu'un troisième créneau existe", () => {
    const storage = new FakeStorage();
    const store = new LocalSaveStore(storage);
    const doc1 = buildDoc();
    store.writeAuto(doc1); // -> auto-a (vide)
    const doc2 = { ...doc1, savedAtIso: new Date(Date.now() + 1000).toISOString() };
    store.writeAuto(doc2); // -> auto-b (l'autre créneau vide)

    expect(storage.raw("scs-save-auto-a")).toBeDefined();
    expect(storage.raw("scs-save-auto-b")).toBeDefined();

    const latest = store.readLatestValid();
    expect(latest?.doc.savedAtIso).toBe(doc2.savedAtIso);
  });

  it("clearAll supprime tous les emplacements — plus rien à reprendre ensuite", () => {
    const storage = new FakeStorage();
    const store = new LocalSaveStore(storage);
    store.writeManual(buildDoc());
    store.writeAuto(buildDoc());
    store.clearAll();
    expect(store.readLatestValid()).toBeNull();
  });
});
