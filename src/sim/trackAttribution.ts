/**
 * Attribution des pistes (section 11 : « le journal interne peut relier ID réel et pistes ») :
 * pour chaque observateur et chaque piste, l'objet réel qui a produit chaque mesure. Vérité
 * interne réservée à l'analyse (déroulement exporté, débrief en mode test) — jamais lue par la
 * connaissance, les consoles réalistes ni l'IA.
 */

/** Nombre de mesures récentes sur lesquelles se décide la source majoritaire d'une piste. */
const RECENT_WINDOW = 10;
const MAX_TRANSITIONS_PER_TRACK = 50;

export interface TrackSourceTally {
  sourceId: string;
  observations: number;
  firstSimTime: number;
  lastSimTime: number;
}

/** Changement de la source majoritaire des dernières mesures (`from` nul : création de la piste). */
export interface SourceTransition {
  simTime: number;
  from: string | null;
  to: string;
}

export interface TrackAttribution {
  observerId: string;
  trackId: string;
  sources: TrackSourceTally[];
  transitions: SourceTransition[];
}

export interface MissileLaunchAttribution {
  missileId: string;
  ownerId: string;
  trackId: string;
  simTime: number;
  /** Source majoritaire des dernières mesures de la piste visée au moment du tir. */
  trackSourceAtLaunch: string | null;
}

export interface TrackAttributionSaveState {
  tracks: (TrackAttribution & { recent: string[]; majority: string | null })[];
  launches: MissileLaunchAttribution[];
}

interface TrackRecord {
  observerId: string;
  trackId: string;
  sources: Map<string, TrackSourceTally>;
  recent: string[];
  majority: string | null;
  transitions: SourceTransition[];
}

function majorityOf(recent: readonly string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const id of recent) {
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export class TrackAttributionLog {
  private readonly records = new Map<string, TrackRecord>();
  private readonly launchRecords: MissileLaunchAttribution[] = [];

  private key(observerId: string, trackId: string): string {
    return `${observerId}\u0000${trackId}`;
  }

  record(observerId: string, trackId: string, sourceId: string, simTime: number): void {
    const key = this.key(observerId, trackId);
    let entry = this.records.get(key);
    if (!entry) {
      entry = { observerId, trackId, sources: new Map(), recent: [], majority: null, transitions: [] };
      this.records.set(key, entry);
    }
    const tally = entry.sources.get(sourceId);
    if (tally) {
      tally.observations += 1;
      tally.lastSimTime = simTime;
    } else {
      entry.sources.set(sourceId, { sourceId, observations: 1, firstSimTime: simTime, lastSimTime: simTime });
    }
    entry.recent.push(sourceId);
    if (entry.recent.length > RECENT_WINDOW) entry.recent.shift();
    // Bascule seulement quand une autre source devient strictement majoritaire : pas de va-et-vient
    // sur une égalité pendant qu'une piste mélange deux objets.
    const candidate = majorityOf(entry.recent);
    if (candidate !== null && candidate !== entry.majority) {
      const candidateCount = entry.recent.filter((id) => id === candidate).length;
      const currentCount = entry.majority ? entry.recent.filter((id) => id === entry!.majority).length : 0;
      if (candidateCount > currentCount) {
        if (entry.transitions.length < MAX_TRANSITIONS_PER_TRACK) entry.transitions.push({ simTime, from: entry.majority, to: candidate });
        entry.majority = candidate;
      }
    }
  }

  /** Source majoritaire des dernières mesures d'une piste (nulle si la piste n'a jamais été attribuée). */
  currentSource(observerId: string, trackId: string): string | null {
    return this.records.get(this.key(observerId, trackId))?.majority ?? null;
  }

  recordMissileLaunch(missileId: string, ownerId: string, trackId: string, simTime: number): void {
    this.launchRecords.push({ missileId, ownerId, trackId, simTime, trackSourceAtLaunch: this.currentSource(ownerId, trackId) });
  }

  get tracks(): TrackAttribution[] {
    return [...this.records.values()].map((entry) => ({
      observerId: entry.observerId,
      trackId: entry.trackId,
      sources: [...entry.sources.values()].map((tally) => ({ ...tally })),
      transitions: entry.transitions.map((t) => ({ ...t })),
    }));
  }

  get launches(): readonly MissileLaunchAttribution[] {
    return this.launchRecords;
  }

  toSaveState(): TrackAttributionSaveState {
    return {
      tracks: [...this.records.values()].map((entry) => ({
        observerId: entry.observerId,
        trackId: entry.trackId,
        sources: [...entry.sources.values()].map((tally) => ({ ...tally })),
        transitions: entry.transitions.map((t) => ({ ...t })),
        recent: [...entry.recent],
        majority: entry.majority,
      })),
      launches: this.launchRecords.map((launch) => ({ ...launch })),
    };
  }

  load(saved: TrackAttributionSaveState): void {
    this.records.clear();
    for (const track of saved.tracks) {
      this.records.set(this.key(track.observerId, track.trackId), {
        observerId: track.observerId,
        trackId: track.trackId,
        sources: new Map(track.sources.map((tally) => [tally.sourceId, { ...tally }])),
        recent: [...track.recent],
        majority: track.majority,
        transitions: track.transitions.map((t) => ({ ...t })),
      });
    }
    this.launchRecords.length = 0;
    this.launchRecords.push(...saved.launches.map((launch) => ({ ...launch })));
  }
}
