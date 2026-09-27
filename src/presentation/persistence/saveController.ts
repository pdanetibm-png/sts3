import { buildSaveDocument, type SaveDocument } from "../../sim/save";
import type { ScenarioDefinition } from "../../sim/types";
import type { SimulationWorld } from "../../sim/world";
import type { LocalSaveStore } from "./localSaveStore";

// Section 10 : "automatique toutes les 30 secondes réelles pendant la partie".
const AUTO_SAVE_INTERVAL_SECONDS = 30;

export interface SaveResult {
  ok: boolean;
  reason?: "quota" | "error";
  savedAtIso?: string;
}

/** Orchestre quand/comment sauvegarder — la mécanique de stockage elle-même reste dans
 * `LocalSaveStore`. Aucun effet tant que la mission est terminée (section 10 : une mission
 * finie n'est jamais "reprenable", voir aussi debrief.ts qui appelle `clearAll`). */
export class SaveController {
  private accumulatedRealSeconds = 0;

  constructor(
    private readonly store: LocalSaveStore,
    private readonly world: SimulationWorld,
    private readonly scenario: ScenarioDefinition,
    private readonly playerBodyId: string,
    private readonly testMode: boolean,
  ) {}

  /** À appeler chaque frame avec le delta réel écoulé (pas le temps simulé) — l'auto-save
   * suit l'horloge murale, indépendamment du multiplicateur de vitesse. */
  tick(realDeltaSeconds: number): void {
    if (this.world.missionOutcome !== "en_cours") return;
    this.accumulatedRealSeconds += realDeltaSeconds;
    if (this.accumulatedRealSeconds < AUTO_SAVE_INTERVAL_SECONDS) return;
    this.accumulatedRealSeconds = 0;
    this.store.writeAuto(this.buildDoc());
  }

  manualSave(): SaveResult {
    const doc = this.buildDoc();
    const result = this.store.writeManual(doc);
    return result.ok ? { ok: true, savedAtIso: doc.savedAtIso } : { ok: false, reason: result.reason };
  }

  /** Sauvegarde immédiate à une suspension (pause manuelle, mise en arrière-plan) — toujours
   * dans un emplacement automatique, jamais dans l'emplacement manuel du joueur. */
  saveOnSuspend(): SaveResult {
    if (this.world.missionOutcome !== "en_cours") return { ok: false, reason: "error" };
    const doc = this.buildDoc();
    const result = this.store.writeAuto(doc);
    return result.ok ? { ok: true, savedAtIso: doc.savedAtIso } : { ok: false, reason: result.reason };
  }

  private buildDoc(): SaveDocument {
    return buildSaveDocument(this.world, this.scenario, this.playerBodyId, this.testMode);
  }
}
