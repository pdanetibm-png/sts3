import type { Vector3 } from "three";
import { STANDARD_GRAVITY } from "./thrusters";
import type { SignatureDef, ThermalDef } from "./types";

/**
 * Signatures (CONCEPTION_DETECTION.md) : ce qu'un vaisseau ou un missile présente aux capteurs.
 * Lu uniquement par le simulateur de capteurs, jamais par la connaissance.
 */

export const STEFAN_BOLTZMANN = 5.670374e-8;
/** Surface radar de référence pour exprimer une portée radar (m²). */
export const REFERENCE_CROSS_SECTION_M2 = 100;
const SPACE_TEMPERATURE_K = 3;
const PLUME_FRONT_VISIBILITY = 0.05;
const PLUME_DIRECTIVITY_EXPONENT = 0.75;

export interface SignatureSource {
  position: Vector3;
  signature: SignatureDef;
  hullTemperatureK: number;
  /** Intensité du jet vue de l'arrière (W/sr), déjà multipliée par la poussée du moment. */
  plumePeakWattsPerSr: number;
  /** Axe avant (sens de la poussée) ; le jet sort dans le sens opposé. */
  forwardAxisWorld: Vector3;
}

/** Puissance cinétique du jet : ½ · F · vₑ, avec vₑ = Isp · g₀. */
export function jetPowerWatts(thrustNewtons: number, specificImpulseSeconds: number): number {
  return 0.5 * thrustNewtons * specificImpulseSeconds * STANDARD_GRAVITY;
}

/** Intensité du jet vue de l'arrière : la fraction rayonnée, répartie sur le demi-espace arrière. */
export function plumePeakIntensity(thrustNewtons: number, specificImpulseSeconds: number, radiantFraction: number): number {
  return (radiantFraction * jetPowerWatts(thrustNewtons, specificImpulseSeconds)) / (2 * Math.PI);
}

/** Visibilité du jet selon l'angle : 1 vu de l'arrière, ~0,6 de profil, 0,05 de face (masqué). */
export function plumeDirectivity(cosAngleFromExhaust: number): number {
  const rear = Math.max(0, (1 + cosAngleFromExhaust) / 2);
  return PLUME_FRONT_VISIBILITY + (1 - PLUME_FRONT_VISIBILITY) * Math.pow(rear, PLUME_DIRECTIVITY_EXPONENT);
}

/** Puissance rayonnée par la coque (loi de Stefan-Boltzmann), en W. */
export function hullRadiatedWatts(thermal: ThermalDef, temperatureK: number): number {
  return thermal.emissivity * STEFAN_BOLTZMANN * thermal.surfaceAreaM2 * (temperatureK ** 4 - SPACE_TEMPERATURE_K ** 4);
}

/** Température d'équilibre pour une chaleur dégagée donnée. */
export function equilibriumTemperatureK(thermal: ThermalDef, heatWatts: number): number {
  return Math.pow(Math.max(0, heatWatts) / (thermal.emissivity * STEFAN_BOLTZMANN * thermal.surfaceAreaM2) + SPACE_TEMPERATURE_K ** 4, 0.25);
}

/** Un pas du bilan thermique : C·dT/dt = chaleur dégagée − chaleur rayonnée. */
export function stepHullTemperature(temperatureK: number, thermal: ThermalDef, heatWatts: number, dt: number): number {
  const net = heatWatts - hullRadiatedWatts(thermal, temperatureK);
  return Math.max(SPACE_TEMPERATURE_K, temperatureK + (net * dt) / thermal.heatCapacityJoulesPerKelvin);
}

function directionTo(source: SignatureSource, observerPosition: Vector3): Vector3 | null {
  const toObserver = observerPosition.clone().sub(source.position);
  const length = toObserver.length();
  return length > 1e-6 ? toObserver.divideScalar(length) : null;
}

/**
 * Intensité IR vers l'observateur, dans la bande du capteur (W/sr) : coque, qui rayonne de façon
 * égale dans toutes les directions, plus le jet, très directionnel.
 */
export function infraredIntensityToward(source: SignatureSource, observerPosition: Vector3, bandFraction: number): number {
  const hull = (bandFraction * hullRadiatedWatts(source.signature.thermal, source.hullTemperatureK)) / (4 * Math.PI);
  if (source.plumePeakWattsPerSr <= 0) return hull;
  const toObserver = directionTo(source, observerPosition);
  const cos = toObserver ? -source.forwardAxisWorld.dot(toObserver) : 1;
  return hull + source.plumePeakWattsPerSr * plumeDirectivity(cos);
}

/** Surface radar vue depuis l'observateur (m²) : faible de face ou de dos, forte de profil. */
export function radarCrossSectionToward(source: SignatureSource, observerPosition: Vector3): number {
  const radar = source.signature.radar;
  const toObserver = directionTo(source, observerPosition);
  if (!toObserver) return radar.crossSectionSideM2;
  const cos = source.forwardAxisWorld.dot(toObserver);
  const sin2 = Math.max(0, 1 - cos * cos);
  return radar.crossSectionFrontM2 + (radar.crossSectionSideM2 - radar.crossSectionFrontM2) * sin2;
}
