import { Vector3 } from "three";
import type { CrewExposureAxis, RigidBody } from "./rigidBody";
import { STANDARD_GRAVITY } from "./thrusters";

// Seuil et vitesses d'accumulation/récupération : caractéristiques de l'équipage et de ses
// sièges, lues dans le catalogue de matériel (body.crew), jamais des constantes du moteur.
// En dessous de ce ratio, aucun axe n'est annoncé "dominant" (bruit de calcul au repos).
const DOMINANT_AXIS_DISPLAY_THRESHOLD = 0.01;

/**
 * Fait évoluer la charge d'exposition G cumulée d'un corps habité (section 4.4, PHY-08) —
 * jamais appelée pour un missile (pas d'équipage). Utilise le maximum des ratios directionnels
 * comme simplification initiale proposée par la spec elle-même. Verrou irréversible à 100 % :
 * une fois incapacité, un corps le reste pour le restant de la mission.
 */
export function stepCrewExposure(body: RigidBody, dt: number): void {
  if (body.crewExposureIncapacitated) return;

  const forceWorld = body.lastAllocation?.forceWorld ?? new Vector3();
  const forceBody = forceWorld.clone().applyQuaternion(body.attitude.clone().invert());
  const gBody = forceBody.divideScalar(Math.max(body.massKg, 1e-6) * STANDARD_GRAVITY);

  const threshold = body.crew.gThreshold;
  const ratios: Record<CrewExposureAxis, number> = {
    x: Math.abs(gBody.x) / threshold,
    y: Math.abs(gBody.y) / threshold,
    z: Math.abs(gBody.z) / threshold,
  };
  let dominantAxis: CrewExposureAxis = "x";
  let maxRatio = ratios.x;
  if (ratios.y > maxRatio) {
    dominantAxis = "y";
    maxRatio = ratios.y;
  }
  if (ratios.z > maxRatio) {
    dominantAxis = "z";
    maxRatio = ratios.z;
  }

  const before = body.crewExposureFraction;
  if (maxRatio > 1) {
    body.crewExposureFraction = Math.min(1, before + body.crew.exposureAccumulationPerSecond * (maxRatio - 1) * dt);
    body.crewExposureDominantAxis = dominantAxis;
  } else {
    body.crewExposureFraction = Math.max(0, before - body.crew.exposureRecoveryPerSecond * dt);
    body.crewExposureDominantAxis = maxRatio > DOMINANT_AXIS_DISPLAY_THRESHOLD ? dominantAxis : null;
  }
  body.crewExposureTrendPerSecond = dt > 1e-9 ? (body.crewExposureFraction - before) / dt : 0;
  if (body.crewExposureFraction >= 1) body.crewExposureIncapacitated = true;
}
