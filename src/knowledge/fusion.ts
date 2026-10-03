import { Vector3 } from "three";
import type { EstimationAssumptions } from "../sim/types";
import { solvePassiveRange } from "./passiveRanging";
import type { BearingFix, Observation, RangeFix, SharedBearing, Track } from "./types";

const STANDARD_GRAVITY_MPS2 = 9.80665;

/**
 * Hypothèses publiques par défaut (échelle du duel du MVP). Un scénario fournit les siennes
 * (ScenarioDefinition.assumptions) ; elles ne sont jamais tirées de la vérité.
 */
export const DEFAULT_ESTIMATION_ASSUMPTIONS: EstimationAssumptions = {
  trackRecentSeconds: 5,
  trackLostSeconds: 30,
  targetManeuverG: 1,
  missileManeuverG: 15,
  unknownSpeedMps: 1000,
  velocityWindowSeconds: 12,
  bearingDriftRadPerSecond: 0.01,
  unknownBearingRateRadPerSecond: 0.01,
  aspectCrossSectionSpread: 7,
};
const DEFAULT_UNKNOWN_BEARING_RATE = DEFAULT_ESTIMATION_ASSUMPTIONS.unknownBearingRateRadPerSecond!;
export const RECENT_AGE_SECONDS = DEFAULT_ESTIMATION_ASSUMPTIONS.trackRecentSeconds;
export const LOST_AGE_SECONDS = DEFAULT_ESTIMATION_ASSUMPTIONS.trackLostSeconds;
const LOST_BEARING_UNCERTAINTY_RAD = 0.4;
/** Au-delà de cette incertitude rapportée à la distance, la position ne veut plus rien dire. */
const LOST_RELATIVE_POSITION_UNCERTAINTY = 0.5;
// Écart (en écarts-types combinés) au-delà duquel une mesure n'appartient pas à une piste.
const GATE_SIGMA = 3;
// Dispersion (log) supposée d'une estimation de surface radar quand le capteur ne la précise pas.
const DEFAULT_CROSS_SECTION_LOG_UNCERTAINTY = 0.4;
// Au-delà de ce résidu normalisé, un mouvement rectiligne uniforme n'explique plus les mesures :
// la cible manœuvre (bruit pur : ≈ 1 à 1,4).
const MANEUVER_RESIDUAL_THRESHOLD = 3;
// Facteur généreux (plutôt que 1×) sur la somme des incertitudes : une mesure bruitée doit
// rester compatible avec sa propre piste dans l'immense majorité des tirages (~3 sigma),
// sans quoi une simple fluctuation de bruit fragmente un contact unique en plusieurs pistes.
const BEARING_COMPATIBILITY_FACTOR = 3;
const BEARING_COMPATIBILITY_MARGIN_RAD = 0.002;
const MAX_HISTORY_LENGTH = 20;
const MAX_BEARING_FIXES = 40;
const MAX_PASSIVE_FIXES = 60;
// Vitesse estimée par régression linéaire sur les mesures de distance de cette fenêtre : à
// 20 km, le bruit de gisement donne ~400 m d'erreur latérale par mesure, et une différence
// entre deux mesures rapprochées produisait des vitesses de l'ordre du km/s pour une cible
// quasi immobile. La fenêtre borne aussi le retard sur une cible qui manœuvre.
const MAX_RANGE_FIXES = 80;
const MIN_VELOCITY_BASELINE_SECONDS = 2;
// Un gisement frais qui contredit la position estimée au-delà de cette marge (en multiples de
// l'incertitude) invalide cette position : elle est reprojetée sur le gisement mesuré.
const BEARING_CONTRADICTION_FACTOR = 3;

function angularDistance(a: Vector3, b: Vector3): number {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  return Math.acos(dot);
}

/** Une piste candidate pour une mesure : compatible (`score` ≤ 1), et son coût de rattachement. */
export interface AssociationCandidate {
  track: Track;
  /** Écart rapporté à la fenêtre d'association (≤ 1 : compatible). */
  score: number;
  /**
   * Coût de rattachement (vraisemblance négative) : l'écart rapporté à l'incertitude, plus la
   * taille de la fenêtre. À écart égal, la piste qui prédisait la mesure le plus précisément
   * l'emporte : une piste très incertaine ne doit pas attirer toutes les mesures de sa direction.
   */
  cost: number;
}

/** Pistes compatibles avec une mesure, de la plus vraisemblable à la moins vraisemblable. */
export function associationCandidates(
  tracks: Track[],
  observation: Observation,
  observerPositionWorld: Vector3 = new Vector3(),
  assumptions: EstimationAssumptions = DEFAULT_ESTIMATION_ASSUMPTIONS,
): AssociationCandidate[] {
  const candidates: AssociationCandidate[] = [];
  for (const track of tracks) {
    const gate = associationGate(track, observation, observerPositionWorld, assumptions);
    if (!gate) continue;
    const score = gate.distance / gate.width;
    if (score > 1) continue;
    // Fenêtre ≈ GATE_SIGMA écarts-types : coût gaussien en écarts-types, plus le volume de la fenêtre.
    const sigmas = GATE_SIGMA * score;
    candidates.push({ track, score, cost: 0.5 * sigmas * sigmas + gate.dimensions * Math.log(Math.max(gate.width, 1e-12)) });
  }
  return candidates.sort((a, b) => a.cost - b.cost);
}

/**
 * Rattache une mesure à la piste la plus compatible (DET-06). Avec une distance mesurée et une
 * position connue, la compatibilité est géométrique (distance en 3D rapportée aux
 * incertitudes) : deux contacts proches en gisement mais séparés en distance ne fusionnent
 * plus. Sans distance, on compare les directions. Plusieurs candidats ⇒ le plus vraisemblable est
 * retenu mais `ambiguous` signale le doute, jamais résolu par un identifiant réel caché.
 */
export function findCompatibleTrack(
  tracks: Track[],
  observation: Observation,
  observerPositionWorld: Vector3 = new Vector3(),
  assumptions: EstimationAssumptions = DEFAULT_ESTIMATION_ASSUMPTIONS,
): { track: Track | null; ambiguous: boolean } {
  const candidates = associationCandidates(tracks, observation, observerPositionWorld, assumptions);
  if (candidates.length === 0) return { track: null, ambiguous: false };
  return { track: candidates[0].track, ambiguous: candidates.length > 1 };
}

/** Manœuvre supposée possible pour ce contact, selon sa classe estimée (m/s²). */
function maneuverAcceleration(track: Track, assumptions: EstimationAssumptions): number {
  const g = track.classification === "missile probable" ? assumptions.missileManeuverG : assumptions.targetManeuverG;
  return g * STANDARD_GRAVITY_MPS2;
}

/**
 * Écart entre la mesure et la piste, et largeur de la fenêtre d'association, dans une même unité :
 * mètres si la mesure donne une distance, radians sinon (`dimensions` : 3 ou 2). `null` : la mesure
 * ne peut pas venir de cet objet (échos de tailles incompatibles).
 */
function associationGate(
  track: Track,
  observation: Observation,
  observerPositionWorld: Vector3,
  assumptions: EstimationAssumptions,
): { distance: number; width: number; dimensions: number } | null {
  const positionUncertainty = track.positionUncertaintyMeters ?? 0;
  // Deux échos de tailles incompatibles ne viennent pas du même objet : un missile qui se sépare
  // de son lanceur ne corrompt pas la piste du lanceur. Un même vaisseau varie pourtant beaucoup
  // selon l'angle (face/flanc) : on tolère cet étalement, plus le bruit de la mesure et de la
  // moyenne de la piste (3 sigma).
  if (track.crossSectionEstimateM2 !== undefined && observation.crossSectionEstimateM2 !== undefined) {
    const logNoise = observation.crossSectionLogUncertainty ?? DEFAULT_CROSS_SECTION_LOG_UNCERTAINTY;
    const samples = Math.max(1, track.crossSectionSamples ?? 1);
    const tolerance = Math.log(assumptions.aspectCrossSectionSpread) + GATE_SIGMA * logNoise * Math.sqrt(1 + 1 / samples);
    if (Math.abs(Math.log(observation.crossSectionEstimateM2 / track.crossSectionEstimateM2)) > tolerance) return null;
  }
  const range = observation.rangeMeters;
  if (track.positionEstimateWorld && range !== undefined) {
    const measured = observerPositionWorld.clone().addScaledVector(observation.bearingWorld, range);
    const measurementUncertainty = Math.hypot(observation.rangeUncertaintyMeters ?? 0, range * observation.bearingUncertaintyRad);
    // Une cible qui manœuvre (dans la limite supposée) s'écarte de l'estimation à vitesse constante
    // depuis la dernière mesure. Le retard de la régression sur sa fenêtre, lui, est déjà compté
    // dans l'incertitude de position, borné par ce que les mesures permettent de détecter
    // (`fitMotion`) : le recompter ici élargissait la fenêtre à des centaines de km sur une
    // longue fenêtre, et deux missiles voisins finissaient dans la même piste.
    const acceleration = maneuverAcceleration(track, assumptions);
    const sinceLast = Math.max(0, observation.simTime - track.lastObservationSimTime);
    // Sans vitesse estimée, la mesure est comparée à la dernière position : la cible a pu parcourir
    // jusqu'à la vitesse maximale supposée depuis.
    const motionAllowance = track.velocityEstimateWorld ? 0 : assumptions.unknownSpeedMps * sinceLast;
    const maneuverAllowance = 0.5 * acceleration * sinceLast * sinceLast + motionAllowance;
    const width = GATE_SIGMA * Math.hypot(positionUncertainty, measurementUncertainty) + maneuverAllowance + 1;
    return { distance: measured.distanceTo(track.positionEstimateWorld), width, dimensions: 3 };
  }
  // Comparaison des directions ; ramenée en mètres à la distance mesurée quand il y en a une.
  const scale = range !== undefined ? Math.max(range, 1) : 1;
  const dimensions = range !== undefined ? 3 : 2;
  if (track.positionEstimateWorld) {
    const toTrack = track.positionEstimateWorld.clone().sub(observerPositionWorld);
    const trackRange = toTrack.length();
    if (trackRange > 1) {
      // Un gisement ne se compare qu'à l'incertitude LATÉRALE : celle sur la distance ne change pas
      // la direction. Sinon une piste à la distance mal connue avale toutes les mesures de son côté
      // du ciel (un missile qui part du vaisseau suivi, par exemple).
      const margin =
        GATE_SIGMA * observation.bearingUncertaintyRad +
        Math.atan2(GATE_SIGMA * trackLateralUncertaintyMeters(track), trackRange) +
        BEARING_COMPATIBILITY_MARGIN_RAD;
      return { distance: angularDistance(toTrack.divideScalar(trackRange), observation.bearingWorld) * scale, width: margin * scale, dimensions };
    }
  }
  // Sans vitesse angulaire estimée (une seule mesure), la ligne de visée a pu tourner depuis, au
  // plus à la vitesse supposée ; ensuite, l'extrapolation du gisement suit la rotation mesurée.
  const sinceLast = Math.max(0, observation.simTime - track.lastObservationSimTime);
  const unknownRotation = track.bearingRateWorld ? 0 : (assumptions.unknownBearingRateRadPerSecond ?? DEFAULT_UNKNOWN_BEARING_RATE) * sinceLast;
  const margin = (track.bearingUncertaintyRad + observation.bearingUncertaintyRad) * BEARING_COMPATIBILITY_FACTOR + BEARING_COMPATIBILITY_MARGIN_RAD + unknownRotation;
  return { distance: angularDistance(track.bearingEstimateWorld, observation.bearingWorld) * scale, width: margin * scale, dimensions };
}

export function createTrackFromObservation(
  localId: string,
  observation: Observation,
  observerPositionWorld: Vector3,
  assumptions: EstimationAssumptions = DEFAULT_ESTIMATION_ASSUMPTIONS,
): Track {
  const track: Track = {
    localId,
    createdSimTime: observation.simTime,
    lastObservationSimTime: observation.simTime,
    lastObservation: observation,
    state: "recent",
    bearingEstimateWorld: observation.bearingWorld.clone(),
    bearingUncertaintyRad: observation.bearingUncertaintyRad,
    classification: "inconnu",
    classificationConfidence: 0.25,
    ambiguous: false,
    history: [observation],
    rangeFixes: [],
    bearingFixes: [
      {
        simTime: observation.simTime,
        bearingWorld: observation.bearingWorld.clone(),
        uncertaintyRad: observation.bearingUncertaintyRad,
        observerPositionWorld: observerPositionWorld.clone(),
      },
    ],
  };
  track.passiveFixes = [track.bearingFixes[0]];
  applyRangeMeasurement(track, observation, observerPositionWorld, assumptions);
  return track;
}

/**
 * Piste confirmée (logique « M sur N » des pisteurs réels) : au moins deux mesures rattachées, ou
 * une distance connue (radar, triangulation). Une détection isolée reste une piste candidate,
 * invisible des postes et de l'IA : sans cela, chaque reflet d'un objet rapide vu en IR une fois
 * toutes les 10 s s'affichait comme un nouveau contact.
 */
export function isConfirmedTrack(track: Track): boolean {
  return track.history.length >= 2 || track.rangeFixes.length > 0 || track.positionEstimateWorld !== undefined || (track.remoteBearingFixes?.length ?? 0) > 0;
}

/**
 * Rattachement de secours d'un gisement resté sans piste (≤ 1 : acceptable) : une piste au gisement
 * seul dont la ligne de visée tourne vite (objet proche et rapide, missile) peut voir sa vitesse
 * angulaire changer beaucoup d'une image à l'autre. On tolère alors un écart à la prédiction
 * allant jusqu'à la rotation prévue elle-même, plutôt que d'ouvrir une nouvelle piste. Sans effet
 * sur une piste lointaine, dont la rotation est faible.
 */
export function successionScore(track: Track, observation: Observation): number {
  if (track.positionEstimateWorld || track.state === "lost" || !track.bearingRateWorld || track.history.length < 2) return Number.POSITIVE_INFINITY;
  const sinceLast = observation.simTime - track.lastObservationSimTime;
  if (!(sinceLast > 0)) return Number.POSITIVE_INFINITY;
  const margin =
    GATE_SIGMA * (track.bearingUncertaintyRad + observation.bearingUncertaintyRad) + BEARING_COMPATIBILITY_MARGIN_RAD + track.bearingRateWorld.length() * sinceLast;
  return angularDistance(track.bearingEstimateWorld, observation.bearingWorld) / margin;
}

/** Écart angulaire en deçà duquel deux pistes de vaisseau sont « jumelles » (vues de l'observateur). */
const TWIN_MAX_ANGLE_RAD = (2 * Math.PI) / 180;
/** Écart de distance relatif toléré entre deux jumelles quand les deux distances sont connues. */
const TWIN_MAX_RELATIVE_RANGE_GAP = 0.2;

function directionFrom(track: Track, observerPositionWorld: Vector3): { direction: Vector3; range?: number } {
  if (track.positionEstimateWorld) {
    const offset = track.positionEstimateWorld.clone().sub(observerPositionWorld);
    const range = offset.length();
    if (range > 1) return { direction: offset.divideScalar(range), range };
  }
  return { direction: track.bearingEstimateWorld };
}

/**
 * Piste « jumelle » : une autre piste non perdue, pas classée missile, dans la même direction et à
 * une distance voisine. Un leurre largué, ou un missile tiré, sort du vaisseau et apparaît ainsi ;
 * c'est le moment où une piste peut changer d'objet sans que rien d'autre ne le montre.
 */
export function findTwinTrack(tracks: readonly Track[], track: Track, observerPositionWorld: Vector3): Track | null {
  if (track.classification === "missile probable") return null;
  const self = directionFrom(track, observerPositionWorld);
  let best: Track | null = null;
  let bestAngle = TWIN_MAX_ANGLE_RAD;
  for (const other of tracks) {
    if (other === track || other.state === "lost" || other.classification === "missile probable") continue;
    const candidate = directionFrom(other, observerPositionWorld);
    const angle = angularDistance(self.direction, candidate.direction);
    if (angle > bestAngle) continue;
    if (self.range !== undefined && candidate.range !== undefined) {
      if (Math.abs(self.range - candidate.range) > TWIN_MAX_RELATIVE_RANGE_GAP * Math.max(self.range, candidate.range)) continue;
    }
    best = other;
    bestAngle = angle;
  }
  return best;
}

/** Incertitude latérale de la position estimée (perpendiculaire à la ligne de visée). */
export function trackLateralUncertaintyMeters(track: Track): number {
  return Math.min(track.crossRangeUncertaintyMeters ?? Number.POSITIVE_INFINITY, track.positionUncertaintyMeters ?? 0);
}

/**
 * Incertitude angulaire d'une piste vue de l'observateur : celle du gisement, ou celle de la
 * position latérale rapportée à la distance. Sert à dimensionner un secteur radar qui la couvre.
 */
export function trackAngularUncertaintyRad(track: Track, observerPositionWorld: Vector3): number {
  let angular = track.bearingUncertaintyRad;
  if (track.positionEstimateWorld) {
    const range = track.positionEstimateWorld.distanceTo(observerPositionWorld);
    if (range > 1) angular = Math.max(angular, Math.atan2(trackLateralUncertaintyMeters(track), range));
  }
  return angular;
}

/** Position estimée sans valeur (incertitude au-delà d'une fraction de la distance). */
function positionIsMeaningless(track: Track, observerPositionWorld: Vector3): boolean {
  if (!track.positionEstimateWorld || track.positionUncertaintyMeters === undefined) return false;
  const range = track.positionEstimateWorld.distanceTo(observerPositionWorld);
  return range > 1 && track.positionUncertaintyMeters > LOST_RELATIVE_POSITION_UNCERTAINTY * range;
}

/**
 * Une position qui ne veut plus rien dire est abandonnée : la piste repasse au gisement seul
 * (direction vers l'ancienne estimation, vitesse angulaire conservée). Garder une telle position
 * élargirait sans fin la fenêtre d'association et pointerait le radar au mauvais endroit.
 */
function dropPositionEstimate(track: Track, observerPositionWorld: Vector3): void {
  if (track.positionEstimateWorld) {
    const toEstimate = track.positionEstimateWorld.clone().sub(observerPositionWorld);
    const range = toEstimate.length();
    if (range > 1) {
      track.bearingEstimateWorld = toEstimate.divideScalar(range);
      track.bearingUncertaintyRad = Math.max(track.bearingUncertaintyRad, Math.atan2(trackLateralUncertaintyMeters(track), range));
    }
  }
  track.positionEstimateWorld = undefined;
  track.positionUncertaintyMeters = undefined;
  track.crossRangeUncertaintyMeters = undefined;
  track.velocityEstimateWorld = undefined;
  track.velocityUncertaintyMps = undefined;
  track.positionSource = undefined;
  track.maneuvering = false;
  track.rangeFixes = [];
}

/** Fusionne une nouvelle mesure compatible : réduit l'incertitude au niveau du capteur (DET-03). */
export function fuseObservationIntoTrack(
  track: Track,
  observation: Observation,
  observerPositionWorld: Vector3,
  assumptions: EstimationAssumptions = DEFAULT_ESTIMATION_ASSUMPTIONS,
): void {
  track.lastObservation = observation;
  track.lastObservationSimTime = observation.simTime;
  track.history.push(observation);
  if (track.history.length > MAX_HISTORY_LENGTH) track.history.shift();

  track.bearingEstimateWorld = observation.bearingWorld.clone();
  track.bearingUncertaintyRad = observation.bearingUncertaintyRad;
  track.state = "recent";
  applyBearingMeasurement(track, observation, observerPositionWorld, assumptions);

  if (observation.rangeMeters === undefined) {
    if (positionIsMeaningless(track, observerPositionWorld)) dropPositionEstimate(track, observerPositionWorld);
    else fuseBearingIntoPosition(track, observation, observerPositionWorld);
  }
  applyRangeMeasurement(track, observation, observerPositionWorld, assumptions);
  if (observation.rangeMeters === undefined) applyPassiveRanging(track, observerPositionWorld, observation.simTime, assumptions);
}

/**
 * Distance passive (knowledge/passiveRanging.ts) : sans mesure radar récente, la position est celle
 * que donnent les gisements recoupés (alliés, manœuvre propre), si la géométrie la rend assez sûre.
 */
function applyPassiveRanging(track: Track, observerPositionWorld: Vector3, simTime: number, assumptions: EstimationAssumptions): void {
  const lastRadarFix = track.rangeFixes[track.rangeFixes.length - 1];
  if (lastRadarFix && simTime - lastRadarFix.simTime < assumptions.trackRecentSeconds) return;
  const solution = solvePassiveRange(track, observerPositionWorld, simTime, assumptions);
  if (!solution) return;
  track.positionEstimateWorld = solution.position;
  track.positionUncertaintyMeters = Math.max(solution.rangeUncertaintyMeters, solution.crossRangeUncertaintyMeters);
  track.crossRangeUncertaintyMeters = solution.crossRangeUncertaintyMeters;
  track.velocityEstimateWorld = solution.velocity;
  track.velocityUncertaintyMps = solution.velocity ? solution.velocityUncertaintyMps : undefined;
  track.positionSource = solution.method;
  track.maneuvering = false;
}

/**
 * Compatibilité d'un gisement d'allié avec une piste (≤ 1 : compatible). Avec une position estimée,
 * la direction de l'allié vers elle doit tomber dans la précision de son capteur, élargie de toute
 * l'incertitude de position (vue de côté, celle sur la distance devient latérale). Au gisement
 * seul, les deux rayons doivent se croiser devant les deux observateurs.
 */
export function remoteBearingScore(track: Track, shared: SharedBearing, ownPositionWorld: Vector3): number {
  if (track.state === "lost") return Number.POSITIVE_INFINITY;
  if (track.positionEstimateWorld) {
    const fromRemote = track.positionEstimateWorld.clone().sub(shared.observerPositionWorld);
    const distance = fromRemote.length();
    if (distance < 1) return Number.POSITIVE_INFINITY;
    const angle = angularDistance(fromRemote.divideScalar(distance), shared.bearingWorld);
    const margin =
      GATE_SIGMA * shared.bearingUncertaintyRad + Math.atan2(GATE_SIGMA * (track.positionUncertaintyMeters ?? 0), distance) + BEARING_COMPATIBILITY_MARGIN_RAD;
    return angle / margin;
  }
  // Point le plus proche entre les deux rayons : s le long du nôtre, t le long de celui de l'allié.
  const b1 = track.bearingEstimateWorld;
  const b2 = shared.bearingWorld;
  const w0 = ownPositionWorld.clone().sub(shared.observerPositionWorld);
  const a = b1.dot(b2);
  const d = b1.dot(w0);
  const e = b2.dot(w0);
  const denominator = 1 - a * a;
  if (denominator < 1e-12) return Number.POSITIVE_INFINITY;
  const s = (a * e - d) / denominator;
  const t = (e - a * d) / denominator;
  if (s <= 0 || t <= 0) return Number.POSITIVE_INFINITY;
  const miss = ownPositionWorld.clone().addScaledVector(b1, s).sub(shared.observerPositionWorld.clone().addScaledVector(b2, t)).length();
  const allowed = GATE_SIGMA * (s * track.bearingUncertaintyRad + t * shared.bearingUncertaintyRad) + 1;
  return miss / allowed;
}

/** Ajoute un gisement d'allié à la piste (fenêtre bornée) et recalcule la distance passive. */
export function fuseRemoteBearing(track: Track, shared: SharedBearing, ownPositionWorld: Vector3, assumptions: EstimationAssumptions): void {
  const fixes = (track.remoteBearingFixes ??= []);
  fixes.push({
    simTime: shared.simTime,
    bearingWorld: shared.bearingWorld.clone(),
    uncertaintyRad: shared.bearingUncertaintyRad,
    observerPositionWorld: shared.observerPositionWorld.clone(),
    observerId: shared.observerId,
  });
  const windowStart = shared.simTime - assumptions.velocityWindowSeconds;
  while (fixes.length > MAX_BEARING_FIXES || (fixes.length > 0 && fixes[0].simTime < windowStart)) fixes.shift();
  applyPassiveRanging(track, ownPositionWorld, shared.simTime, assumptions);
}

/**
 * Un gisement frais recale latéralement la position estimée, comme un filtre : poids de chaque
 * côté selon son incertitude latérale (la nôtre contre distance × précision du capteur). La
 * distance, elle, n'en apprend rien. Une contradiction franche est traitée à part.
 */
function fuseBearingIntoPosition(track: Track, observation: Observation, observerPositionWorld: Vector3): void {
  if (!track.positionEstimateWorld) return;
  const toEstimate = track.positionEstimateWorld.clone().sub(observerPositionWorld);
  const range = toEstimate.length();
  if (range < 1) return;
  const along = toEstimate.dot(observation.bearingWorld);
  const lateral = toEstimate.clone().addScaledVector(observation.bearingWorld, -along);
  const estimateSigma = trackLateralUncertaintyMeters(track);
  const measurementSigma = range * observation.bearingUncertaintyRad;
  const combined = Math.hypot(estimateSigma, measurementSigma);
  if (along <= 0 || lateral.length() > BEARING_CONTRADICTION_FACTOR * combined + range * BEARING_COMPATIBILITY_MARGIN_RAD) {
    reconcilePositionWithBearing(track, observation, observerPositionWorld);
    return;
  }
  const gain = combined > 0 ? (estimateSigma * estimateSigma) / (combined * combined) : 0;
  track.positionEstimateWorld.addScaledVector(lateral, -gain);
  track.crossRangeUncertaintyMeters = Math.max(1, combined > 0 ? (estimateSigma * measurementSigma) / combined : 0);
}

/**
 * Une mesure de gisement seul ne donne pas de distance, mais elle peut contredire la position
 * estimée (vitesse fausse, cible qui a manœuvré). Sans correction, la piste resterait
 * « récente » tout en pointant ailleurs, et un radar en Suivi viserait à côté indéfiniment.
 * On garde la distance estimée, on reprojette sur le gisement mesuré et on assume la perte de
 * précision (vitesse abandonnée, incertitude élargie).
 */
function reconcilePositionWithBearing(track: Track, observation: Observation, observerPositionWorld: Vector3): void {
  if (!track.positionEstimateWorld) return;
  const toEstimate = track.positionEstimateWorld.clone().sub(observerPositionWorld);
  const range = toEstimate.length();
  if (range < 1) return;
  const angle = angularDistance(toEstimate.divideScalar(range), observation.bearingWorld);
  const positionAngularUncertainty = Math.atan2(trackLateralUncertaintyMeters(track), range);
  const allowed = BEARING_CONTRADICTION_FACTOR * observation.bearingUncertaintyRad + positionAngularUncertainty + BEARING_COMPATIBILITY_MARGIN_RAD;
  if (angle <= allowed) return;

  track.positionEstimateWorld = observerPositionWorld.clone().addScaledVector(observation.bearingWorld, range);
  track.positionUncertaintyMeters = Math.max(track.positionUncertaintyMeters ?? 0, range * Math.sin(Math.min(angle, Math.PI / 2)), range * observation.bearingUncertaintyRad * BEARING_CONTRADICTION_FACTOR);
  // Sur le gisement mesuré, seule la distance reste douteuse.
  track.crossRangeUncertaintyMeters = Math.min(track.positionUncertaintyMeters, range * observation.bearingUncertaintyRad * BEARING_CONTRADICTION_FACTOR);
  track.velocityEstimateWorld = undefined;
  track.velocityUncertaintyMps = undefined;
  track.rangeFixes = [];
}

/**
 * Vitesse angulaire de la ligne de visée, ajustée aux moindres carrés (pondérés par la précision
 * de chaque gisement) sur la fenêtre de la piste : d(gisement)/dt ≈ constante, d'où ω = b × ḃ.
 * Si les mesures ne suivent plus une rotation uniforme (la cible a manœuvré, ou deux objets se
 * partagent la piste), les plus anciennes sont oubliées par tiers. `null` sans base de temps.
 */
function fitBearingRate(fixes: BearingFix[]): { rate: Vector3; sigma: number } | null {
  const n = fixes.length;
  if (n < 2) return null;
  let weightSum = 0;
  let meanTime = 0;
  const meanBearing = new Vector3();
  for (const fix of fixes) {
    const w = 1 / Math.max(fix.uncertaintyRad * fix.uncertaintyRad, 1e-14);
    weightSum += w;
    meanTime += w * fix.simTime;
    meanBearing.addScaledVector(fix.bearingWorld, w);
  }
  meanTime /= weightSum;
  meanBearing.divideScalar(weightSum);
  let timeSpread = 0;
  const slope = new Vector3();
  for (const fix of fixes) {
    const w = 1 / Math.max(fix.uncertaintyRad * fix.uncertaintyRad, 1e-14);
    const tau = fix.simTime - meanTime;
    timeSpread += w * tau * tau;
    slope.addScaledVector(fix.bearingWorld.clone().sub(meanBearing), w * tau);
  }
  if (!(timeSpread > 0)) return null;
  slope.divideScalar(timeSpread);
  const latest = fixes[n - 1].bearingWorld;
  return { rate: new Vector3().crossVectors(latest, slope), sigma: 1 / Math.sqrt(timeSpread) };
}

/** Écart des gisements à la rotation uniforme ajustée, rapporté à leur bruit (≈ 1 si le modèle tient). */
function bearingResidual(fixes: BearingFix[], rate: Vector3): number {
  const n = fixes.length;
  if (n < 3) return 1;
  const latest = fixes[n - 1];
  let sum = 0;
  for (const fix of fixes) {
    const predicted = latest.bearingWorld.clone().addScaledVector(new Vector3().crossVectors(rate, latest.bearingWorld), fix.simTime - latest.simTime).normalize();
    const error = angularDistance(predicted, fix.bearingWorld) / Math.max(fix.uncertaintyRad, 1e-7);
    sum += error * error;
  }
  return Math.sqrt(sum / (2 * (n - 2)));
}

/** Toute mesure donne un gisement daté : la rotation de la ligne de visée s'en déduit (DET-08). */
function applyBearingMeasurement(track: Track, observation: Observation, observerPositionWorld: Vector3, assumptions: EstimationAssumptions): void {
  const fix: BearingFix = {
    simTime: observation.simTime,
    bearingWorld: observation.bearingWorld.clone(),
    uncertaintyRad: observation.bearingUncertaintyRad,
    observerPositionWorld: observerPositionWorld.clone(),
  };
  track.bearingFixes.push(fix);
  const passive = (track.passiveFixes ??= []);
  passive.push(fix);
  while (passive.length > MAX_PASSIVE_FIXES || (passive.length > 0 && passive[0].simTime < observation.simTime - assumptions.velocityWindowSeconds)) passive.shift();
  const windowStart = observation.simTime - assumptions.velocityWindowSeconds;
  while (track.bearingFixes.length > MAX_BEARING_FIXES || (track.bearingFixes.length > 2 && track.bearingFixes[0].simTime < windowStart)) {
    track.bearingFixes.shift();
  }
  let fit = fitBearingRate(track.bearingFixes);
  while (fit && track.bearingFixes.length > 3 && bearingResidual(track.bearingFixes, fit.rate) > MANEUVER_RESIDUAL_THRESHOLD) {
    track.bearingFixes.splice(0, Math.max(1, Math.floor(track.bearingFixes.length / 3)));
    fit = fitBearingRate(track.bearingFixes);
  }
  track.bearingRateWorld = fit?.rate;
  track.bearingRateUncertaintyRadPerSecond = fit?.sigma;
}

/**
 * Traite une éventuelle mesure de distance (radar actif). Compare toujours à la dernière
 * mesure BRUTE (`lastMeasuredPositionWorld`/`lastPositionSimTime`), jamais à la position
 * déjà extrapolée en continu — sinon la différence finie de vitesse compare une mesure
 * fraîche à une estimation qui a déjà dérivé, ce qui la fausse complètement.
 */
function applyRangeMeasurement(track: Track, observation: Observation, observerPositionWorld: Vector3, assumptions: EstimationAssumptions): void {
  if (observation.rangeMeters === undefined) {
    // Gisement seul : classification prudente, jamais de point 3D inventé (section 5.3).
    track.classificationConfidence = Math.max(track.classificationConfidence, 0.25);
    return;
  }

  const measuredPosition = observerPositionWorld.clone().addScaledVector(observation.bearingWorld, observation.rangeMeters);
  const rangeUncertainty = observation.rangeUncertaintyMeters ?? observation.rangeMeters * 0.02;
  const lateralUncertainty = observation.rangeMeters * observation.bearingUncertaintyRad;
  const measurementUncertainty = Math.sqrt(rangeUncertainty ** 2 + lateralUncertainty ** 2);

  // Vitesse déduite des seules mesures de distance successives (DET-08), jamais lue sur la cible.
  track.rangeFixes.push({ simTime: observation.simTime, positionWorld: measuredPosition, uncertaintyMeters: measurementUncertainty });
  const windowStart = observation.simTime - assumptions.velocityWindowSeconds;
  while (track.rangeFixes.length > MAX_RANGE_FIXES || (track.rangeFixes.length > 0 && track.rangeFixes[0].simTime < windowStart)) {
    track.rangeFixes.shift();
  }

  const acceleration = maneuverAcceleration(track, assumptions);
  let fit = fitMotion(track.rangeFixes, observation.simTime, acceleration);
  // Changement d'allure que même le modèle accéléré n'explique pas (poussée coupée ou relancée
  // dans la fenêtre) : les mesures anciennes décrivent un mouvement révolu. On les oublie par
  // tiers jusqu'à ce que les mesures redeviennent cohérentes (ou que la base soit trop courte).
  while (fit && fit.normalizedResidual > MANEUVER_RESIDUAL_THRESHOLD && track.rangeFixes.length > 3) {
    track.rangeFixes.splice(0, Math.max(1, Math.floor(track.rangeFixes.length / 3)));
    fit = fitMotion(track.rangeFixes, observation.simTime, acceleration);
  }
  if (fit) {
    track.positionEstimateWorld = fit.position;
    track.positionUncertaintyMeters = Math.max(fit.positionUncertaintyMeters, rangeUncertainty);
    track.velocityEstimateWorld = fit.velocity;
    track.velocityUncertaintyMps = fit.velocityUncertaintyMps;
    track.maneuvering = fit.maneuvering;
  } else {
    track.positionEstimateWorld = measuredPosition.clone();
    track.positionUncertaintyMeters = measurementUncertainty;
  }
  // Radar : l'erreur latérale (distance × précision angulaire) domine ; on la prend pour les deux axes.
  track.crossRangeUncertaintyMeters = track.positionUncertaintyMeters;
  track.positionSource = "radar";
  classifyFromCrossSection(track, observation);
}

// Surface radar apparente en deçà de laquelle l'objet est trop petit pour être un vaisseau habité,
// et au-delà de laquelle il est trop grand pour être un missile (CONCEPTION_DETECTION.md §7).
const MISSILE_MAX_CROSS_SECTION_M2 = 5;
const SHIP_MIN_CROSS_SECTION_M2 = 20;

/** Classification estimée d'après la moyenne (géométrique) des surfaces radar mesurées. */
function classifyFromCrossSection(track: Track, observation: Observation): void {
  if (observation.crossSectionEstimateM2 === undefined || !(observation.crossSectionEstimateM2 > 0)) {
    // Écho sans estimation de taille : un objet physique confirmé, supposé vaisseau.
    if (track.classification === "inconnu") track.classification = "vaisseau probable";
    track.classificationConfidence = Math.min(0.95, track.classificationConfidence + 0.3);
    return;
  }
  track.crossSectionSamples = (track.crossSectionSamples ?? 0) + 1;
  track.crossSectionLogSum = (track.crossSectionLogSum ?? 0) + Math.log(observation.crossSectionEstimateM2);
  const mean = Math.exp(track.crossSectionLogSum / track.crossSectionSamples);
  track.crossSectionEstimateM2 = mean;
  track.classification = mean < MISSILE_MAX_CROSS_SECTION_M2 ? "missile probable" : mean > SHIP_MIN_CROSS_SECTION_M2 ? "vaisseau probable" : "inconnu";
  track.classificationConfidence = Math.min(0.95, 0.3 + 0.1 * track.crossSectionSamples);
}

interface MotionFit {
  position: Vector3;
  velocity: Vector3;
  positionUncertaintyMeters: number;
  velocityUncertaintyMps: number;
  /** Écart des mesures au mouvement rectiligne uniforme, rapporté à leur bruit (≈ 1 si le modèle tient). */
  normalizedResidual: number;
  /** Accélération significative détectée dans la fenêtre : l'estimation suit la vitesse actuelle. */
  maneuvering: boolean;
}

/** Inverse d'une matrice 3×3 symétrique (null si singulière). */
function invertSymmetric3(m: number[][]): number[][] | null {
  const [[a, b, c], [, d, e], [, , f]] = m;
  const A = d * f - e * e;
  const B = c * e - b * f;
  const C = b * e - c * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const D = a * f - c * c;
  const E = b * c - a * e;
  const F = a * d - b * b;
  return [
    [A / det, B / det, C / det],
    [B / det, D / det, E / det],
    [C / det, E / det, F / det],
  ];
}

const quadraticForm = (inverse: number[][], g: number[]) =>
  g.reduce((sum, gi, i) => sum + gi * g.reduce((row, gj, j) => row + inverse[i][j] * gj, 0), 0);

/**
 * Ajuste le mouvement de la cible sur les mesures de la fenêtre et l'évalue à `atTime`.
 *
 * Deux modèles aux moindres carrés : vitesse constante, et accélération constante. Si
 * l'accélération ajustée est significative (> 3 sigma), la cible manœuvre : on prend la vitesse
 * ACTUELLE du modèle accéléré (pas la moyenne de la fenêtre), avec son incertitude, plus large.
 * Sinon, le modèle rectiligne est gardé, mais son incertitude inclut le biais que laisserait une
 * accélération trop faible pour être détectée dans ce bruit (bornée par l'hypothèse publique de
 * manœuvre) — une estimation ne doit jamais se croire plus précise que ce que les mesures
 * permettent de vérifier. `null` si la fenêtre est trop courte pour qu'une vitesse ait un sens.
 */
function fitMotion(fixes: RangeFix[], atTime: number, maxAcceleration: number): MotionFit | null {
  const n = fixes.length;
  if (n < 2 || fixes[n - 1].simTime - fixes[0].simTime < MIN_VELOCITY_BASELINE_SECONDS) return null;

  let meanTime = 0;
  const meanPosition = new Vector3();
  let meanVariance = 0;
  for (const fix of fixes) {
    meanTime += fix.simTime;
    meanPosition.add(fix.positionWorld);
    meanVariance += fix.uncertaintyMeters ** 2;
  }
  meanTime /= n;
  meanPosition.divideScalar(n);
  meanVariance /= n;
  const sigma = Math.sqrt(meanVariance);
  const lever = atTime - meanTime;

  // Modèle rectiligne uniforme.
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  const slope = new Vector3();
  for (const fix of fixes) {
    const tau = fix.simTime - meanTime;
    s2 += tau * tau;
    s3 += tau * tau * tau;
    s4 += tau * tau * tau * tau;
    slope.addScaledVector(fix.positionWorld.clone().sub(meanPosition), tau);
  }
  slope.divideScalar(s2);
  let linearResidual = 0;
  for (const fix of fixes) {
    const fitted = meanPosition.clone().addScaledVector(slope, fix.simTime - meanTime);
    linearResidual += fix.positionWorld.distanceToSquared(fitted) / Math.max(fix.uncertaintyMeters ** 2, 1e-6);
  }
  const normalizedResidual = n > 2 ? Math.sqrt(linearResidual / (n - 2)) : 1;
  const consistency = Math.max(1, normalizedResidual);

  // Modèle à accélération constante (au moins 4 mesures pour garder un résidu).
  let accelerationBound = maxAcceleration;
  if (n >= 4) {
    const normal = [
      [n, 0, s2],
      [0, s2, s3],
      [s2, s3, s4],
    ];
    const inverse = invertSymmetric3(normal);
    if (inverse) {
      const b0 = new Vector3();
      const b1 = new Vector3();
      const b2 = new Vector3();
      for (const fix of fixes) {
        const tau = fix.simTime - meanTime;
        b0.add(fix.positionWorld);
        b1.addScaledVector(fix.positionWorld, tau);
        b2.addScaledVector(fix.positionWorld, tau * tau);
      }
      const coefficient = (row: number) =>
        b0.clone().multiplyScalar(inverse[row][0]).addScaledVector(b1, inverse[row][1]).addScaledVector(b2, inverse[row][2]);
      const c0 = coefficient(0);
      const c1 = coefficient(1);
      const c2 = coefficient(2);
      const accelerationSigma = 2 * sigma * Math.sqrt(Math.max(inverse[2][2], 0));
      const acceleration = c2.length() * 2;

      if (acceleration > GATE_SIGMA * accelerationSigma) {
        let quadraticResidual = 0;
        for (const fix of fixes) {
          const tau = fix.simTime - meanTime;
          const fitted = c0.clone().addScaledVector(c1, tau).addScaledVector(c2, tau * tau);
          quadraticResidual += fix.positionWorld.distanceToSquared(fitted) / Math.max(fix.uncertaintyMeters ** 2, 1e-6);
        }
        const quadraticConsistency = Math.max(1, n > 3 ? Math.sqrt(quadraticResidual / (n - 3)) : 1);
        return {
          position: c0.clone().addScaledVector(c1, lever).addScaledVector(c2, lever * lever),
          velocity: c1.clone().addScaledVector(c2, 2 * lever),
          positionUncertaintyMeters: sigma * Math.sqrt(Math.max(quadraticForm(inverse, [1, lever, lever * lever]), 0)) * quadraticConsistency,
          velocityUncertaintyMps: sigma * Math.sqrt(Math.max(quadraticForm(inverse, [0, 1, 2 * lever]), 0)) * quadraticConsistency,
          normalizedResidual,
          maneuvering: true,
        };
      }
      accelerationBound = Math.min(maxAcceleration, GATE_SIGMA * accelerationSigma);
    }
  }

  // Biais qu'une accélération non détectée laisserait sur le modèle rectiligne : la pente est la
  // vitesse au milieu de la fenêtre, pas maintenant ; l'ordonnée absorbe la courbure moyenne.
  const velocityBias = accelerationBound * Math.abs(lever);
  const positionBias = 0.5 * accelerationBound * Math.abs(lever * lever - s2 / n);
  return {
    position: meanPosition.clone().addScaledVector(slope, lever),
    velocity: slope,
    positionUncertaintyMeters: Math.hypot(sigma * Math.sqrt(1 / n + (lever * lever) / s2) * consistency, positionBias),
    velocityUncertaintyMps: Math.hypot((sigma / Math.sqrt(s2)) * consistency, velocityBias),
    normalizedResidual,
    maneuvering: false,
  };
}

/**
 * Fait vieillir une piste entre deux observations : propage position/vitesse connues,
 * incertitude croissante (jamais décroissante sans mesure, DET-03), transition d'état.
 */
export function extrapolateTrack(
  track: Track,
  simTime: number,
  dt: number,
  assumptions: EstimationAssumptions = DEFAULT_ESTIMATION_ASSUMPTIONS,
  observerPositionWorld?: Vector3,
): void {
  if (track.positionEstimateWorld && track.velocityEstimateWorld) {
    track.positionEstimateWorld.addScaledVector(track.velocityEstimateWorld, dt);
  }
  const age = simTime - track.lastObservationSimTime;
  if (track.positionUncertaintyMeters !== undefined) {
    // La cible a pu manœuvrer depuis la dernière mesure (dans la limite supposée) : sa vitesse
    // devient moins sûre, et la position en hérite.
    const acceleration = maneuverAcceleration(track, assumptions);
    // Une manœuvre possible déplace la cible dans toutes les directions : les deux axes grossissent d'autant.
    const before = track.positionUncertaintyMeters;
    if (track.velocityUncertaintyMps !== undefined) {
      track.velocityUncertaintyMps = Math.min(track.velocityUncertaintyMps + acceleration * dt, assumptions.unknownSpeedMps);
      track.positionUncertaintyMeters += track.velocityUncertaintyMps * dt;
    } else {
      track.positionUncertaintyMeters += acceleration * Math.max(0, age) * dt;
    }
    if (track.crossRangeUncertaintyMeters !== undefined) {
      track.crossRangeUncertaintyMeters = Math.min(track.positionUncertaintyMeters, track.crossRangeUncertaintyMeters + track.positionUncertaintyMeters - before);
    }
  }
  // Piste sans distance : le gisement suit la rotation mesurée de la ligne de visée ; son
  // incertitude croît de ce que cette rotation n'explique pas.
  if (!track.positionEstimateWorld && track.bearingRateWorld) {
    track.bearingEstimateWorld.addScaledVector(new Vector3().crossVectors(track.bearingRateWorld, track.bearingEstimateWorld), dt).normalize();
  }
  track.bearingUncertaintyRad += (assumptions.bearingDriftRadPerSecond + (track.bearingRateUncertaintyRadPerSecond ?? 0)) * dt;

  const range = track.positionEstimateWorld && observerPositionWorld ? track.positionEstimateWorld.distanceTo(observerPositionWorld) : undefined;
  const positionMeaningless =
    track.positionUncertaintyMeters !== undefined && range !== undefined && range > 1 && track.positionUncertaintyMeters > LOST_RELATIVE_POSITION_UNCERTAINTY * range;
  if (age < assumptions.trackRecentSeconds) {
    track.state = "recent";
  } else if (age > assumptions.trackLostSeconds || track.bearingUncertaintyRad > LOST_BEARING_UNCERTAINTY_RAD || positionMeaningless) {
    track.state = "lost";
  } else {
    track.state = "extrapolated";
  }
}
