import type { Vector3 } from "three";
import type { EstimationAssumptions } from "../sim/types";
import { createTrackFromObservation, DEFAULT_ESTIMATION_ASSUMPTIONS, extrapolateTrack, findCompatibleTrack, fuseObservationIntoTrack } from "./fusion";
import type { FriendlyContact, Observation, Track } from "./types";

/**
 * Connaissance à bord d'un observateur (section 3.1) — une instance par vaisseau, jamais
 * partagée entre camps. Les pistes ne sont alimentées que par `ingest()` (capteurs) ; les
 * vaisseaux amis le sont par la liaison de données (`setFriendlies`), jamais par un accès
 * direct à la vérité d'un vaisseau adverse.
 */
export class KnowledgeBase {
  private readonly tracksById = new Map<string, Track>();
  private nextTrackNumber = 1;
  private friendlyContacts: FriendlyContact[] = [];
  /** Hypothèses publiques d'estimation, fournies par le scénario. */
  assumptions: EstimationAssumptions = DEFAULT_ESTIMATION_ASSUMPTIONS;

  get friendlies(): readonly FriendlyContact[] {
    return this.friendlyContacts;
  }

  setFriendlies(contacts: FriendlyContact[]): void {
    this.friendlyContacts = contacts;
  }

  get tracks(): Track[] {
    return Array.from(this.tracksById.values());
  }

  getTrack(localId: string): Track | undefined {
    return this.tracksById.get(localId);
  }

  /** Fait vieillir toutes les pistes d'un pas de temps — à appeler chaque tick, avec ou sans nouvelle mesure. */
  extrapolateAll(simTime: number, dt: number, observerPositionWorld?: Vector3): void {
    for (const track of this.tracksById.values()) {
      extrapolateTrack(track, simTime, dt, this.assumptions, observerPositionWorld);
    }
  }

  /** Intègre une mesure de capteur : fusion avec une piste compatible, sinon nouvelle piste candidate. */
  ingest(observation: Observation, observerPositionWorld: Vector3): Track {
    const { track, ambiguous } = findCompatibleTrack(this.tracks, observation, observerPositionWorld, this.assumptions);
    if (track) {
      fuseObservationIntoTrack(track, observation, observerPositionWorld, this.assumptions);
      track.ambiguous = ambiguous;
      return track;
    }
    const newTrack = createTrackFromObservation(`piste-${this.nextTrackNumber++}`, observation, observerPositionWorld, this.assumptions);
    this.tracksById.set(newTrack.localId, newTrack);
    return newTrack;
  }

  /** Restaure les pistes depuis une sauvegarde (section 10) — remplace tout contenu existant.
   * `nextTrackNumber` doit être restauré avec les pistes pour que les futurs IDs générés
   * (`piste-N`) ne collisionnent jamais avec ceux déjà connus. */
  loadTracks(tracks: Track[], nextTrackNumber: number): void {
    this.tracksById.clear();
    for (const track of tracks) this.tracksById.set(track.localId, track);
    this.nextTrackNumber = nextTrackNumber;
  }

  /** Prochain suffixe numérique qui sera utilisé pour un nouvel ID de piste — à sauvegarder
   * avec les pistes elles-mêmes (voir `loadTracks`). */
  get nextTrackNumberForSave(): number {
    return this.nextTrackNumber;
  }
}
