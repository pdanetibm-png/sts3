import { SAVE_SCHEMA_VERSION, type SaveDocument } from "../../sim/save";
import { validateScenario } from "../../sim/scenario";

/** Sous-ensemble de l'API Web Storage effectivement utilisé — permet un stockage injecté
 * (test) plutôt qu'une dépendance directe à `window.localStorage`. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveWriteResult = { ok: true } | { ok: false; reason: "quota" | "error" };

export interface SaveSlotResult {
  slot: "manuel" | "auto-a" | "auto-b";
  doc: SaveDocument;
}

const KEY_MANUAL = "scs-save-manual";
const KEY_AUTO_A = "scs-save-auto-a";
const KEY_AUTO_B = "scs-save-auto-b";

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof Error && (error.name === "QuotaExceededError" || (error as { code?: number }).code === 22);
}

/**
 * Persistance locale (section 10) : un emplacement manuel + deux emplacements automatiques
 * alternés. `writeAuto` écrase toujours le plus ancien des deux, jamais les deux à la fois —
 * si une écriture échoue, l'autre reste valide. `readLatestValid` ignore silencieusement tout
 * contenu corrompu, de version différente, ou dont le scénario embarqué ne passe pas la
 * validation habituelle (`validateScenario`) : jamais de throw, jamais d'effacement silencieux,
 * juste ignoré au profit d'un autre emplacement valide.
 */
export class LocalSaveStore {
  constructor(private readonly storage: StorageLike) {}

  writeManual(doc: SaveDocument): SaveWriteResult {
    return this.writeToKey(KEY_MANUAL, doc);
  }

  writeAuto(doc: SaveDocument): SaveWriteResult {
    const a = this.tryParse(this.storage.getItem(KEY_AUTO_A));
    const b = this.tryParse(this.storage.getItem(KEY_AUTO_B));
    const targetKey = !a ? KEY_AUTO_A : !b ? KEY_AUTO_B : a.savedAtIso <= b.savedAtIso ? KEY_AUTO_A : KEY_AUTO_B;
    return this.writeToKey(targetKey, doc);
  }

  readLatestValid(): SaveSlotResult | null {
    const candidates: SaveSlotResult[] = (
      [
        { slot: "manuel", doc: this.tryParse(this.storage.getItem(KEY_MANUAL)) },
        { slot: "auto-a", doc: this.tryParse(this.storage.getItem(KEY_AUTO_A)) },
        { slot: "auto-b", doc: this.tryParse(this.storage.getItem(KEY_AUTO_B)) },
      ] as { slot: SaveSlotResult["slot"]; doc: SaveDocument | null }[]
    ).filter((c): c is SaveSlotResult => c.doc !== null);

    if (candidates.length === 0) return null;
    candidates.sort((x, y) => y.doc.savedAtIso.localeCompare(x.doc.savedAtIso));
    return candidates[0];
  }

  clearAll(): void {
    for (const key of [KEY_MANUAL, KEY_AUTO_A, KEY_AUTO_B]) {
      try {
        this.storage.removeItem(key);
      } catch {
        // Best effort — l'absence de suppression ne doit jamais bloquer une nouvelle mission.
      }
    }
  }

  private writeToKey(key: string, doc: SaveDocument): SaveWriteResult {
    try {
      this.storage.setItem(key, JSON.stringify(doc));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: isQuotaExceeded(error) ? "quota" : "error" };
    }
  }

  /** Jamais de throw : un emplacement invalide est simplement traité comme absent. */
  private tryParse(raw: string | null): SaveDocument | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as SaveDocument;
      if (parsed.schemaVersion !== SAVE_SCHEMA_VERSION) return null;
      validateScenario(parsed.scenario);
      return parsed;
    } catch {
      return null;
    }
  }
}
