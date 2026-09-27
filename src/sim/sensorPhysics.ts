import type { SensorDef } from "./types";

/**
 * Lois physiques des capteurs (CONCEPTION_DETECTION.md). Tout « snr » exporté ici est
 * normalisé : 1 correspond à 50 % de détection par balayage.
 */

const BOLTZMANN = 1.380649e-23;
const FULL_SKY_SR = 4 * Math.PI;

/** Angle solide d'un cône de demi-angle donné (π ⇒ tout le ciel). */
export function searchSolidAngle(halfAngleRad: number): number {
  return 2 * Math.PI * (1 - Math.cos(Math.min(Math.PI, Math.max(0, halfAngleRad))));
}

/** Angle solide vu instantanément : faisceau radar (λ²/A) ou champ du détecteur IR. */
export function instantaneousSolidAngle(sensor: SensorDef): number {
  if (sensor.mode === "radar_active") return (sensor.wavelengthMeters! ** 2) / sensor.antennaAreaM2!;
  if (sensor.mode === "ir_passive") return sensor.fieldOfViewSr!;
  return FULL_SKY_SR;
}

/**
 * Durée d'un balayage du secteur : proportionnelle à l'angle solide couvert, mais jamais plus
 * courte que la revisite minimale du matériel.
 */
export function frameSeconds(sensor: SensorDef, halfAngleRad: number): number {
  if (sensor.mode === "radar_passive") return sensor.cycleSeconds;
  const coverage = searchSolidAngle(halfAngleRad) / FULL_SKY_SR;
  return Math.max(sensor.minFrameSeconds, sensor.cycleSeconds * coverage);
}

/**
 * Temps passé sur chaque direction pendant un balayage. Tant que le cycle raccourcit avec le
 * secteur, ce temps reste celui du balayage complet ; une fois la revisite minimale atteinte,
 * le temps gagné sert à intégrer plus longtemps — d'où la portée accrue d'un secteur étroit.
 */
export function dwellSeconds(sensor: SensorDef, halfAngleRad: number): number {
  const beam = instantaneousSolidAngle(sensor);
  const searched = Math.max(beam, searchSolidAngle(halfAngleRad));
  return frameSeconds(sensor, halfAngleRad) * Math.min(1, beam / searched);
}

/** Radar : SNR normalisé d'un écho (équation radar, aller-retour en 1/d⁴). */
export function radarSnr(sensor: SensorDef, crossSectionM2: number, distanceMeters: number, dwell: number): number {
  const area = sensor.antennaAreaM2!;
  const lambda = sensor.wavelengthMeters!;
  const numerator = sensor.powerWatts * area * area * crossSectionM2 * dwell;
  const denominator = 4 * Math.PI * lambda * lambda * BOLTZMANN * sensor.noiseTemperatureKelvin! * sensor.lossFactor! * distanceMeters ** 4;
  return numerator / denominator / sensor.requiredSnr!;
}

/** Gain d'antenne du faisceau principal (4πA/λ²). */
export function radarMainLobeGain(sensor: SensorDef): number {
  return (4 * Math.PI * sensor.antennaAreaM2!) / sensor.wavelengthMeters! ** 2;
}

/** Largeur du faisceau radar (rad). */
export function radarBeamwidth(sensor: SensorDef): number {
  return sensor.wavelengthMeters! / Math.sqrt(sensor.antennaAreaM2!);
}

/** IR : SNR normalisé pour une intensité (W/sr) à une distance donnée. Le bruit baisse comme √t. */
export function infraredSnr(sensor: SensorDef, intensityWattsPerSr: number, distanceMeters: number, dwell: number): number {
  const irradiance = intensityWattsPerSr / (distanceMeters * distanceMeters);
  const noise = sensor.noiseEquivalentIrradianceWm2! / Math.sqrt(Math.max(dwell, 1e-12));
  return irradiance / noise;
}

/** Écoute : SNR normalisé du rayonnement d'un radar (aller simple en 1/d²). */
export function listenSnr(listener: SensorDef, emitter: SensorDef, inMainBeam: boolean, distanceMeters: number): number {
  const gain = radarMainLobeGain(emitter) * (inMainBeam ? 1 : emitter.sideLobeLevel!);
  const flux = (emitter.powerWatts * gain) / (4 * Math.PI * distanceMeters * distanceMeters);
  return flux / listener.sensitivityWm2!;
}

/** Probabilité de détection par balayage : 50 % à snr = 1, 94 % à 2, 6 % à 0,5. */
export function detectionProbability(snr: number): number {
  if (!(snr > 0)) return 0;
  const s4 = snr ** 4;
  return s4 / (1 + s4);
}

/** Facteur de dégradation de la précision : un signal faible est flou, un fort est net (borné). */
export function precisionFactor(snr: number): number {
  return Math.min(2, Math.max(0.1, 1 / Math.sqrt(Math.max(snr, 1e-9))));
}

/** Précision de gisement au seuil de détection (rad), selon le capteur. */
export function nominalBearingNoise(sensor: SensorDef): number {
  if (sensor.mode === "radar_active") return radarBeamwidth(sensor) / (1.6 * Math.sqrt(2 * sensor.requiredSnr!));
  if (sensor.mode === "ir_passive") return sensor.pixelAngleRad!;
  return sensor.bearingAccuracyRad!;
}

/** Précision de distance radar au seuil (m). */
export function nominalRangeNoise(sensor: SensorDef): number {
  return sensor.rangeResolutionMeters! / Math.sqrt(2 * sensor.requiredSnr!);
}

// --- Portées à 50 %, pour l'affichage et la doctrine (jamais pour décider d'une détection). ---

export function radarRangeFor(sensor: SensorDef, crossSectionM2: number, halfAngleRad: number): number {
  const snrAtOneMeter = radarSnr(sensor, crossSectionM2, 1, dwellSeconds(sensor, halfAngleRad));
  return Math.pow(snrAtOneMeter, 1 / 4);
}

export function infraredRangeFor(sensor: SensorDef, intensityWattsPerSr: number, halfAngleRad: number): number {
  const snrAtOneMeter = infraredSnr(sensor, intensityWattsPerSr, 1, dwellSeconds(sensor, halfAngleRad));
  return Math.sqrt(snrAtOneMeter);
}

export function listenRangeFor(listener: SensorDef, emitter: SensorDef, inMainBeam: boolean): number {
  return Math.sqrt(listenSnr(listener, emitter, inMainBeam, 1));
}
