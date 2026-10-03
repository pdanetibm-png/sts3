import type { Vector3 } from "three";
import type { Observation, PositionSource, Track } from "../../knowledge/types";
import type { RigidBody } from "../../sim/rigidBody";
import { SENSOR_MODE_LABELS } from "../../sim/sensors";
import { findTwinTrack } from "../../knowledge/fusion";
import { el, formatDistance, formatSpeed } from "../dom";

export const TRACK_STATE_LABELS: Record<Track["state"], string> = {
  recent: "Récent",
  extrapolated: "Extrapolé",
  lost: "Perdu",
};

/** Gisement en cap et inclinaison (degrés), même convention que les champs Cap / Incl. des postes. */
export function bearingToHeadingPitch(direction: Vector3): { headingDeg: number; pitchDeg: number } {
  const pitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));
  const heading = Math.atan2(direction.x, direction.z);
  return { headingDeg: ((heading * 180) / Math.PI + 360) % 360, pitchDeg: (pitch * 180) / Math.PI };
}

export interface ContactSheetOptions {
  /** Tactique : seulement ce qui sert au tir (classe, distance, vitesse, dernière mesure). */
  compact?: boolean;
}

/**
 * Fiche de contact partagée (section 5.4) : mêmes informations quel que soit le poste qui
 * l'affiche — ID local, état, classe, distance et vitesse relatives estimées ou « inconnu »,
 * incertitudes, gisement, dernière mesure et capteurs qui alimentent la piste.
 */
export function renderContactSheet(track: Track, simTime: number, observer: RigidBody, options: ContactSheetOptions = {}): HTMLElement {
  const root = el("div", "contact-sheet");

  const header = el("div", "contact-sheet-header");
  header.append(
    el("span", "contact-id", track.localId),
    el("span", `contact-state contact-state-${track.state}`, TRACK_STATE_LABELS[track.state]),
  );
  if (track.ambiguous) header.appendChild(el("span", "contact-ambiguous", "association incertaine"));
  root.appendChild(header);

  root.appendChild(row("Classe", `${track.classification} (confiance ${(track.classificationConfidence * 100).toFixed(0)} %)`));
  root.appendChild(row("Distance", describeDistance(track, observer)));
  root.appendChild(row("Vitesse", describeVelocity(track, observer)));
  if (track.maneuvering) root.appendChild(row("Manœuvre", "accélération détectée — vitesse moins précise"));
  const twin = findTwinTrack(observer.knowledge.tracks, track, observer.position);
  if (twin) root.appendChild(row("Jumelle", `${twin.localId} tout près — leurre ou missile possible`, "contact-row-alert"));

  if (!options.compact) {
    const { headingDeg, pitchDeg } = bearingToHeadingPitch(track.bearingEstimateWorld);
    const uncertaintyDeg = (track.bearingUncertaintyRad * 180) / Math.PI;
    root.appendChild(row("Gisement", `cap ${headingDeg.toFixed(0).padStart(3, "0")}° · incl. ${pitchDeg.toFixed(0)}° · ±${uncertaintyDeg.toFixed(uncertaintyDeg < 1 ? 2 : 1)}°`));
  }

  const ageSeconds = Math.max(0, simTime - track.lastObservationSimTime);
  root.appendChild(row("Dernière mesure", `${SENSOR_MODE_LABELS[track.lastObservation.mode]} · il y a ${ageSeconds.toFixed(ageSeconds < 10 ? 1 : 0)} s`));
  if (!options.compact) root.appendChild(row("Capteurs", describeSensors(track)));

  return root;
}

const POSITION_SOURCE_LABELS: Record<PositionSource, string> = {
  radar: "radar",
  triangulation: "triangulation avec un allié",
  manoeuvre: "par manœuvre",
};

/** Distance et son incertitude ; l'incertitude latérale est donnée à part quand elle est bien plus petite. */
function describeDistance(track: Track, observer: RigidBody): string {
  if (!track.positionEstimateWorld) return "inconnue — gisement seul";
  const distance = track.positionEstimateWorld.distanceTo(observer.position);
  const along = track.positionUncertaintyMeters ?? 0;
  const lateral = track.crossRangeUncertaintyMeters ?? along;
  const lateralNote = lateral < 0.5 * along ? ` (latéral ±${formatDistance(lateral)})` : "";
  const source = track.positionSource ? ` · ${POSITION_SOURCE_LABELS[track.positionSource]}` : "";
  return `${formatDistance(distance)} · ±${formatDistance(along)}${lateralNote}${source}`;
}

/** Vitesse relative à notre vaisseau, et sa part le long de la ligne de visée (rapprochement ou éloignement). */
function describeVelocity(track: Track, observer: RigidBody): string {
  if (!track.velocityEstimateWorld) return "inconnue";
  const relative = track.velocityEstimateWorld.clone().sub(observer.velocity);
  const uncertainty = `±${formatSpeed(track.velocityUncertaintyMps ?? 0)}`;
  if (!track.positionEstimateWorld) return `${formatSpeed(relative.length())} relative · ${uncertainty}`;
  const lineOfSight = track.positionEstimateWorld.clone().sub(observer.position);
  if (lineOfSight.lengthSq() < 1) return `${formatSpeed(relative.length())} relative · ${uncertainty}`;
  const closing = -relative.dot(lineOfSight.normalize());
  const radial = closing >= 0 ? `rapprochement ${formatSpeed(closing)}` : `éloignement ${formatSpeed(-closing)}`;
  return `${radial} · ${uncertainty}`;
}

/** Capteurs qui ont alimenté la piste récemment, avec leur cadence moyenne. */
function describeSensors(track: Track): string {
  const byMode = new Map<Observation["mode"], number[]>();
  for (const observation of track.history) {
    const times = byMode.get(observation.mode) ?? [];
    times.push(observation.simTime);
    byMode.set(observation.mode, times);
  }
  const parts: string[] = [];
  for (const [mode, times] of byMode) {
    const cadence = times.length > 1 ? ` toutes les ${((times[times.length - 1] - times[0]) / (times.length - 1)).toFixed(1)} s` : "";
    parts.push(`${SENSOR_MODE_LABELS[mode]}${cadence}`);
  }
  return parts.join(" · ") || "—";
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
      entry.stateEl.textContent = TRACK_STATE_LABELS[track.state];
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

function row(label: string, value: string, extraClass = ""): HTMLElement {
  const line = el("div", `contact-row ${extraClass}`.trim());
  line.append(el("span", "contact-row-label", label), el("span", "contact-row-value", value));
  return line;
}

