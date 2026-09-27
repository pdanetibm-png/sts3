import type { Affiliation } from "../sim/types";
import type { Quaternion, Vector3 } from "three";
import type { SensorMode } from "../sim/types";

/**
 * Une mesure de capteur. Structurellement, ce type ne peut jamais porter de vitesse ou de
 * distance vraie — seul un gisement (toujours) et une distance mesurée (radar actif
 * uniquement) peuvent exister. C'est ce qui garantit DET-01 : l'estimateur ne peut pas
 * recevoir plus que ce qu'un capteur physique mesure réellement.
 */
export interface Observation {
  simTime: number;
  sourceSensorId: string;
  mode: SensorMode;
  /** Direction unitaire vers la cible (ou l'émetteur, en écoute passive), repère monde. */
  bearingWorld: Vector3;
  bearingUncertaintyRad: number;
  /** Radar actif uniquement — mesure directe, bruitée. */
  rangeMeters?: number;
  rangeUncertaintyMeters?: number;
  /** Qualité de la mesure (rapport signal/bruit normalisé : 1 = limite de détection). */
  snr?: number;
  /** Radar actif : surface radar apparente déduite de l'écho, estimation grossière. */
  crossSectionEstimateM2?: number;
  /** Écart-type (en logarithme népérien) de cette estimation — propriété connue du capteur. */
  crossSectionLogUncertainty?: number;
}

export interface RangeFix {
  simTime: number;
  positionWorld: Vector3;
  uncertaintyMeters: number;
}

/** Gisement mesuré, daté — base de l'estimation de la vitesse angulaire d'une piste. */
export interface BearingFix {
  simTime: number;
  bearingWorld: Vector3;
  uncertaintyRad: number;
}

/**
 * Vaisseau du même camp, connu par la liaison de données tactique : sa position est connue en
 * permanence (jamais une piste de capteur, jamais une supposition).
 */
export interface FriendlyContact {
  id: string;
  name: string;
  /** « joueur » = chef de formation que les ailiers ne devancent pas. */
  affiliation: Affiliation;
  positionWorld: Vector3;
  velocityWorld: Vector3;
  attitudeWorld: Quaternion;
  neutralized: boolean;
}

export type TrackState = "recent" | "extrapolated" | "lost";
export type TrackClassification = "inconnu" | "vaisseau probable" | "missile probable";

export interface Track {
  localId: string;
  createdSimTime: number;
  lastObservationSimTime: number;
  lastObservation: Observation;
  state: TrackState;

  bearingEstimateWorld: Vector3;
  bearingUncertaintyRad: number;
  /** Gisements mesurés récents (fenêtre bornée) : la rotation de la ligne de visée s'en déduit. */
  bearingFixes: BearingFix[];
  /**
   * Vitesse angulaire estimée de la ligne de visée (rad/s, vecteur ω : d(gisement)/dt = ω × gisement).
   * Non définie tant que deux gisements datés ne la contraignent pas. Extrapole le gisement d'une
   * piste sans distance — sans elle, une cible qui défile quitte sa piste à chaque mesure.
   */
  bearingRateWorld?: Vector3;
  bearingRateUncertaintyRadPerSecond?: number;

  /** Non défini tant qu'aucune mesure de distance (radar actif) n'a été reçue. Extrapolée en continu entre mesures. */
  positionEstimateWorld?: Vector3;
  positionUncertaintyMeters?: number;
  /**
   * Positions BRUTES (non extrapolées) des dernières mesures de distance, sur une fenêtre de
   * temps bornée — la vitesse en est déduite par régression, jamais par différence de deux
   * mesures isolées (le bruit latéral à grande distance la rendrait aberrante).
   */
  rangeFixes: RangeFix[];

  /** Non défini tant que les mesures de distance ne couvrent pas une durée suffisante. */
  velocityEstimateWorld?: Vector3;
  velocityUncertaintyMps?: number;
  /** Accélération significative détectée sur les dernières mesures (la cible pousse). */
  maneuvering?: boolean;

  classification: TrackClassification;
  classificationConfidence: number;
  /** Surface radar apparente moyenne (géométrique) des échos reçus — base de la classification. */
  crossSectionEstimateM2?: number;
  crossSectionSamples?: number;
  crossSectionLogSum?: number;

  /** Réacquisition ambiguë (plusieurs pistes compatibles) — doute affiché, jamais résolu par ID réel (DET-06). */
  ambiguous: boolean;

  /** Historique borné des mesures ayant mis à jour cette piste. */
  history: Observation[];
}
