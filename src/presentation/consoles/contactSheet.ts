import type { Track } from "../../knowledge/types";
import { el } from "../dom";

const STATE_LABELS: Record<Track["state"], string> = {
  recent: "Récent",
  extrapolated: "Extrapolé",
  lost: "Perdu",
};

/**
 * Fiche de contact partagée (section 5.4) : mêmes champs quel que soit le poste qui
 * l'affiche — ID local, état, dernière observation + source, ancienneté, coordonnées et
 * vitesse estimées ou « inconnu », incertitudes, historique. Réutilisable (Tactique, étape 4).
 */
export function renderContactSheet(track: Track, simTime: number): HTMLElement {
  const root = el("div", "contact-sheet");

  const header = el("div", "contact-sheet-header");
  header.append(
    el("span", "contact-id", track.localId),
    el("span", `contact-state contact-state-${track.state}`, STATE_LABELS[track.state]),
  );
  if (track.ambiguous) header.appendChild(el("span", "contact-ambiguous", "association incertaine"));
  root.appendChild(header);

  const ageSeconds = Math.max(0, simTime - track.lastObservationSimTime);
  root.appendChild(
    row("Dernière observation", `${track.lastObservation.mode} · il y a ${ageSeconds.toFixed(1)} s`),
  );
  root.appendChild(row("Classification", `${track.classification} (confiance ${(track.classificationConfidence * 100).toFixed(0)} %)`));

  root.appendChild(
    row(
      "Position",
      track.positionEstimateWorld
        ? `estimation · ±${(track.positionUncertaintyMeters ?? 0).toFixed(0)} m`
        : "inconnue — gisement seul",
    ),
  );
  root.appendChild(
    row(
      "Gisement",
      `${vectorToText(track.bearingEstimateWorld)} · incertitude ±${((track.bearingUncertaintyRad * 180) / Math.PI).toFixed(1)}°`,
    ),
  );
  root.appendChild(
    row(
      "Vitesse",
      track.velocityEstimateWorld
        ? `estimation · ${track.velocityEstimateWorld.length().toFixed(1)} m/s · ±${(track.velocityUncertaintyMps ?? 0).toFixed(1)} m/s`
        : "inconnue",
    ),
  );
  if (track.maneuvering) root.appendChild(row("Manœuvre", "accélération détectée — vitesse estimée à l'instant, moins précise"));

  const history = el("div", "contact-history");
  history.appendChild(el("h4", "block-title", "Historique des mesures"));
  for (const observation of track.history.slice(-6).reverse()) {
    history.appendChild(
      el(
        "div",
        "contact-history-row",
        `t=${observation.simTime.toFixed(1)}s · ${observation.mode}${observation.rangeMeters !== undefined ? ` · ${observation.rangeMeters.toFixed(0)} m` : ""}`,
      ),
    );
  }
  root.appendChild(history);

  return root;
}

interface TrackRowEntry {
  row: HTMLButtonElement;
  idEl: HTMLElement;
  stateEl: HTMLElement;
  ageEl: HTMLElement;
}

/**
 * Liste de pistes cliquable partagée (Détection, Tactique). Les lignes sont créées une
 * seule fois et mises à jour en place — ne JAMAIS reconstruire ces boutons à chaque frame
 * (`replaceChildren` à 60 im/s) : un clic (mousedown puis mouseup) tombe alors sur deux
 * éléments DOM différents et le navigateur ne déclenche aucun événement "click", rendant
 * la sélection impossible en pratique.
 */
export class TrackListView {
  readonly element: HTMLElement;

  private readonly rows = new Map<string, TrackRowEntry>();
  private readonly emptyMessage: HTMLElement;
  private readonly onSelect: (localId: string) => void;

  constructor(onSelect: (localId: string) => void) {
    this.onSelect = onSelect;
    this.element = el("div", "track-list");
    this.emptyMessage = el("p", "help-text", "Aucun contact connu.");
  }

  update(tracks: Track[], selectedTrackId: string | null, simTime: number): void {
    const sorted = tracks.slice().sort((a, b) => a.localId.localeCompare(b.localId));
    const seen = new Set<string>();

    for (const track of sorted) {
      seen.add(track.localId);
      let entry = this.rows.get(track.localId);
      if (!entry) {
        const row = el("button", "track-row");
        const idEl = el("span", "track-row-id");
        const stateEl = el("span", "track-row-state");
        const ageEl = el("span", "track-row-age");
        row.append(idEl, stateEl, ageEl);
        row.addEventListener("click", () => this.onSelect(track.localId));
        entry = { row, idEl, stateEl, ageEl };
        this.rows.set(track.localId, entry);
      }
      entry.idEl.textContent = track.localId;
      entry.stateEl.textContent = STATE_LABELS[track.state];
      entry.stateEl.className = `track-row-state track-row-state-${track.state}`;
      entry.ageEl.textContent = `${Math.max(0, simTime - track.lastObservationSimTime).toFixed(0)} s`;
      entry.row.classList.toggle("track-row-selected", track.localId === selectedTrackId);
      // Réinsérer un nœud déjà attaché ne fait que le déplacer (ordre trié) — ne recrée rien.
      this.element.appendChild(entry.row);
    }

    for (const [id, entry] of this.rows) {
      if (!seen.has(id)) {
        entry.row.remove();
        this.rows.delete(id);
      }
    }

    if (sorted.length === 0) {
      this.element.appendChild(this.emptyMessage);
    } else {
      this.emptyMessage.remove();
    }
  }
}

function row(label: string, value: string): HTMLElement {
  const line = el("div", "contact-row");
  line.append(el("span", "contact-row-label", label), el("span", "contact-row-value", value));
  return line;
}

function vectorToText(v: { x: number; y: number; z: number }): string {
  return `[${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}]`;
}
