import type { Track } from "../knowledge/types";
import { sameCamp } from "./camps";
import type { RigidBody, SensorState } from "./rigidBody";
import { sensorUnpowered } from "./power";
import { frameSeconds } from "./sensorPhysics";
import { evaluateSensor, listenToEmitters, type SensorTarget } from "./sensors";
import type { SignatureSource } from "./signature";
import type { Affiliation } from "./types";

/** Objet détectable autre qu'un vaisseau : missile ou leurre. */
export interface DetectableObject {
  id: string;
  affiliation: Affiliation;
  isActive: boolean;
  signatureSource(): SignatureSource;
}

/**
 * Appelé après chaque mesure intégrée, avec l'identité réelle de l'objet mesuré — pour le journal
 * d'attribution uniquement (vérité interne), jamais transmis à la connaissance.
 */
export type IngestObserver = (observer: RigidBody, track: Track, sourceId: string) => void;

// Marge appliquée à l'incertitude de piste pour la largeur du secteur en mode Suivi —
// « balayer dans le cône de détection d'une piste » plutôt qu'une largeur tapée à la main.
const FOLLOW_UNCERTAINTY_MARGIN = 1.5;
const FOLLOW_MIN_HALF_ANGLE_RAD = Math.PI / 180;
const FOLLOW_MAX_HALF_ANGLE_RAD = (80 * Math.PI) / 180;

/**
 * Recentre le secteur d'un capteur sur sa piste suivie (« Suivi », section 5.2), à même la
 * simulation — doit tourner chaque pas quel que soit le poste affiché (UX-02), pas seulement
 * pendant que Détection est ouverte. Largeur dérivée de l'incertitude ACTUELLE de la piste.
 */
function updateFollowedSector(observer: RigidBody, state: SensorState): void {
  if (!state.followedTrackId) return;
  const track = observer.knowledge.getTrack(state.followedTrackId);
  if (!track) return;

  let angularUncertainty = track.bearingUncertaintyRad;
  if (track.positionEstimateWorld) {
    const toTrack = track.positionEstimateWorld.clone().sub(observer.position);
    const range = toTrack.length();
    state.scanDirectionWorld = toTrack.normalize();
    // Viser une position incertaine exige un secteur à sa mesure, sinon le radar la manque.
    if (range > 1) angularUncertainty = Math.max(angularUncertainty, Math.atan2(track.positionUncertaintyMeters ?? 0, range));
  } else {
    state.scanDirectionWorld = track.bearingEstimateWorld.clone();
  }
  state.scanHalfAngleRad = Math.max(
    FOLLOW_MIN_HALF_ANGLE_RAD,
    Math.min(FOLLOW_MAX_HALF_ANGLE_RAD, angularUncertainty * FOLLOW_UNCERTAINTY_MARGIN),
  );
}

/**
 * Avance la détection d'un pas de simulation : fait vieillir les pistes de chaque
 * observateur, puis déclenche les capteurs dont le balayage est achevé. Cibles : vaisseaux,
 * missiles et leurres actifs du camp opposé (IFF : les amis sont connus par la liaison de données).
 */
export function stepDetection(
  bodies: RigidBody[],
  objects: readonly DetectableObject[],
  simTime: number,
  dt: number,
  rng: () => number,
  onIngest?: IngestObserver,
): void {
  for (const observer of bodies) {
    observer.knowledge.extrapolateAll(simTime, dt, observer.position);
  }

  const targets: SensorTarget[] = [
    ...bodies.filter((b) => !b.neutralized).map((b) => ({ id: b.id, affiliation: b.affiliation, source: b.signatureSource() })),
    ...objects.filter((o) => o.isActive).map((o) => ({ id: o.id, affiliation: o.affiliation, source: o.signatureSource() })),
  ];

  for (const observer of bodies) {
    if (observer.neutralized) continue;
    for (const sensor of observer.sensors) {
      const state = observer.sensorStates.get(sensor.id);
      if (!state?.enabled) continue;
      // Délesté (section 4.3) : pas de cycle sans budget, et une coupure interrompt le cycle en
      // cours sans observation.
      if (sensorUnpowered(observer, sensor.id)) {
        state.cycleElapsedSeconds = 0;
        continue;
      }

      updateFollowedSector(observer, state);

      const frame = frameSeconds(sensor, state.scanHalfAngleRad);
      state.cycleElapsedSeconds += dt;
      if (state.cycleElapsedSeconds < frame) continue;
      state.cycleElapsedSeconds -= frame;

      if (sensor.mode === "radar_passive") {
        for (const { observation, emitterId } of listenToEmitters(observer, bodies, sensor, simTime, rng)) {
          const track = observer.knowledge.ingest(observation, observer.position);
          onIngest?.(observer, track, emitterId);
        }
        continue;
      }

      for (const target of targets) {
        if (sameCamp(target.affiliation, observer.affiliation)) continue;
        const observation = evaluateSensor(observer, target, sensor, simTime, rng);
        if (!observation) continue;
        const track = observer.knowledge.ingest(observation, observer.position);
        onIngest?.(observer, track, target.id);
      }
    }
  }
}
