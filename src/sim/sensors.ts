import { Vector3 } from "three";
import { sameCamp } from "./camps";
import type { Observation } from "../knowledge/types";
import { sensorUnpowered } from "./power";
import type { RigidBody, SensorState } from "./rigidBody";
import {
  detectionProbability,
  dwellSeconds,
  infraredSnr,
  listenSnr,
  nominalBearingNoise,
  nominalRangeNoise,
  precisionFactor,
  radarSnr,
} from "./sensorPhysics";
import { infraredIntensityToward, radarCrossSectionToward, type SignatureSource } from "./signature";
import type { Affiliation, SensorDef, SensorMode } from "./types";

/** Nom d'un mode de capteur tel qu'il s'affiche (journal, fiche de contact). */
export const SENSOR_MODE_LABELS: Record<SensorMode, string> = {
  ir_passive: "IR",
  radar_passive: "écoute radar",
  radar_active: "radar",
};

function gaussianNoise(rng: () => number, stdDev: number): number {
  if (stdDev <= 0) return 0;
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * stdDev;
}

function noisyBearing(trueDirection: Vector3, stdDevRad: number, rng: () => number): Vector3 {
  const reference = Math.abs(trueDirection.x) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const perpA = new Vector3().crossVectors(trueDirection, reference).normalize();
  const perpB = new Vector3().crossVectors(trueDirection, perpA).normalize();
  // Répartie sur 2 axes indépendants : diviser par √2 par axe fait que l'erreur angulaire
  // totale (norme des deux composantes) a bien l'écart-type déclaré par le capteur.
  const perAxisStdDev = stdDevRad / Math.SQRT2;
  const errA = gaussianNoise(rng, perAxisStdDev);
  const errB = gaussianNoise(rng, perAxisStdDev);
  return trueDirection.clone().addScaledVector(perpA, errA).addScaledVector(perpB, errB).normalize();
}

/** Dispersion (log) de l'estimation de surface radar tirée d'un écho : fluctuation de la cible, calibration. */
const CROSS_SECTION_LOG_NOISE = 0.4;

/** Une cible possible pour les capteurs : vaisseau, missile ou leurre, vu à travers sa signature. */
export interface SensorTarget {
  /** Identité réelle — sert uniquement au journal d'attribution (vérité interne), jamais à l'observation. */
  id: string;
  affiliation: Affiliation;
  source: SignatureSource;
}

function withinSector(state: SensorState, direction: Vector3): boolean {
  if (state.scanHalfAngleRad >= Math.PI - 1e-9) return true;
  const angle = Math.acos(Math.min(1, Math.max(-1, direction.dot(state.scanDirectionWorld))));
  return angle <= state.scanHalfAngleRad;
}

/**
 * IR passif ou radar actif contre une cible (CONCEPTION_DETECTION.md) : signal reçu d'après la
 * signature vue sous cet angle, la distance et le temps passé sur la direction ; détection
 * tirée selon la probabilité, mesure bruitée selon le rapport signal/bruit.
 */
export function evaluateSensor(
  observer: RigidBody,
  target: SensorTarget,
  sensor: SensorDef,
  simTime: number,
  rng: () => number,
): Observation | null {
  if (sensor.mode === "radar_passive") return null;
  const sensorState = observer.sensorStates.get(sensor.id);
  if (!sensorState?.enabled) return null;

  const offset = target.source.position.clone().sub(observer.position);
  const distance = offset.length();
  if (distance < 1e-6) return null;
  const trueDirection = offset.divideScalar(distance);
  if (!withinSector(sensorState, trueDirection)) return null;

  const dwell = dwellSeconds(sensor, sensorState.scanHalfAngleRad);
  const crossSection = sensor.mode === "radar_active" ? radarCrossSectionToward(target.source, observer.position) : 0;
  const snr =
    sensor.mode === "radar_active"
      ? radarSnr(sensor, crossSection, distance, dwell)
      : infraredSnr(sensor, infraredIntensityToward(target.source, observer.position, sensor.bandFraction!), distance, dwell);
  if (rng() >= detectionProbability(snr)) return null;

  const precision = precisionFactor(snr);
  const bearingNoise = nominalBearingNoise(sensor) * precision;
  const observation: Observation = {
    simTime,
    sourceSensorId: sensor.id,
    mode: sensor.mode,
    bearingWorld: noisyBearing(trueDirection, bearingNoise, rng),
    bearingUncertaintyRad: bearingNoise,
    snr,
  };
  if (sensor.mode === "radar_active") {
    const rangeNoise = nominalRangeNoise(sensor) * precision;
    observation.rangeMeters = Math.max(0, distance + gaussianNoise(rng, rangeNoise));
    observation.rangeUncertaintyMeters = rangeNoise;
    // Surface radar apparente, déduite de l'écho et de la distance : estimation à ±50 % environ.
    observation.crossSectionEstimateM2 = crossSection * Math.exp(gaussianNoise(rng, CROSS_SECTION_LOG_NOISE));
    observation.crossSectionLogUncertainty = CROSS_SECTION_LOG_NOISE;
  }
  return observation;
}

/**
 * Écoute radar passive : capte le rayonnement des radars actifs adverses (aller simple, 1/d²),
 * fort dans leur faisceau, faible par les lobes secondaires. Donne un gisement, jamais une
 * distance ni la position de l'émetteur (section 5.1).
 */
export function evaluateRadarPassiveListen(
  observer: RigidBody,
  allBodies: RigidBody[],
  sensor: SensorDef,
  simTime: number,
  rng: () => number,
): Observation[] {
  return listenToEmitters(observer, allBodies, sensor, simTime, rng).map((heard) => heard.observation);
}

/** Même écoute, avec l'identité réelle de chaque émetteur entendu — pour le journal d'attribution seulement. */
export function listenToEmitters(
  observer: RigidBody,
  allBodies: RigidBody[],
  sensor: SensorDef,
  simTime: number,
  rng: () => number,
): { observation: Observation; emitterId: string }[] {
  const sensorState = observer.sensorStates.get(sensor.id);
  if (!sensorState?.enabled) return [];

  const heard: { observation: Observation; emitterId: string }[] = [];
  for (const emitter of allBodies) {
    // Émissions amies corrélées par la liaison de données : jamais transformées en piste.
    if (emitter === observer || emitter.neutralized || sameCamp(emitter.affiliation, observer.affiliation)) continue;
    for (const emitterSensor of emitter.sensors) {
      if (emitterSensor.mode !== "radar_active") continue;
      const emitterState = emitter.sensorStates.get(emitterSensor.id);
      // Un radar éteint ou délesté n'émet rien : rien à entendre.
      if (!emitterState?.enabled || sensorUnpowered(emitter, emitterSensor.id)) continue;

      const offset = emitter.position.clone().sub(observer.position);
      const distance = offset.length();
      if (distance < 1e-6) continue;
      const trueDirection = offset.divideScalar(distance);
      const inMainBeam = withinSector(emitterState, trueDirection.clone().negate());

      const snr = listenSnr(sensor, emitterSensor, inMainBeam, distance);
      if (rng() >= detectionProbability(snr)) continue;
      const bearingNoise = nominalBearingNoise(sensor) * precisionFactor(snr);
      heard.push({
        emitterId: emitter.id,
        observation: {
          simTime,
          sourceSensorId: sensor.id,
          mode: "radar_passive",
          bearingWorld: noisyBearing(trueDirection, bearingNoise, rng),
          bearingUncertaintyRad: bearingNoise,
          snr,
        },
      });
    }
  }
  return heard;
}
