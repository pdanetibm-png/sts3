import { Vector3 } from "three";
import type { RigidBody, ThrusterAllocationResult } from "./rigidBody";
import type { ThrusterDef } from "./types";

export const STANDARD_GRAVITY = 9.80665;

// Gains exprimés en accélération angulaire (rad/s² par rad d'erreur / par rad/s de vitesse),
// puis convertis en couple désiré via l'inertie du corps pour rester indépendants de son échelle.
// La limite réelle du couple applicable vient désormais des propulseurs RCS placés (PHY-03),
// pas d'une constante fictive : ce contrôleur ne fait qu'exprimer un objectif.
const ATTITUDE_HOLD_KP_ACCEL = 0.6;
const ATTITUDE_HOLD_KD_ACCEL = 1.4;
/** Temps d'établissement du maintien d'attitude (≈ 4/(ζω) = 8/Kd) : ordre de grandeur d'un retournement. */
export const ATTITUDE_SETTLE_SECONDS = 8 / ATTITUDE_HOLD_KD_ACCEL;

/** Force locale (repère corps) + couple = Σ throttle·maxThrust·axis et Σ r×F — fonction pure, testée pour PHY-03. */
export function sumThrusterWrench(
  thrusters: ThrusterDef[],
  throttles: number[],
): { forceLocal: Vector3; torqueBody: Vector3 } {
  const forceLocal = new Vector3();
  const torqueBody = new Vector3();
  for (let i = 0; i < thrusters.length; i++) {
    const throttle = throttles[i];
    if (!throttle || throttle <= 0) continue;
    const thruster = thrusters[i];
    const axis = new Vector3(...thruster.localAxis).normalize();
    const force = axis.multiplyScalar(throttle * thruster.maxThrustNewtons);
    forceLocal.add(force);
    const position = new Vector3(...thruster.localPosition);
    torqueBody.add(new Vector3().crossVectors(position, force));
  }
  return { forceLocal, torqueBody };
}

function computeDesiredAttitudeTorque(body: RigidBody): Vector3 {
  if (!body.command.attitudeHoldEngaged) return new Vector3();

  const target = body.command.targetAttitude.clone();
  if (target.w < 0) target.set(-target.x, -target.y, -target.z, -target.w);

  const currentInverse = body.attitude.clone().invert();
  const error = currentInverse.multiply(target);
  const w = Math.min(1, Math.max(-1, error.w));
  const angle = 2 * Math.acos(w);
  const sinHalfAngle = Math.sqrt(1 - w * w);

  const desiredAccel =
    sinHalfAngle > 1e-6
      ? new Vector3(error.x, error.y, error.z).divideScalar(sinHalfAngle).multiplyScalar(angle * ATTITUDE_HOLD_KP_ACCEL)
      : new Vector3();
  desiredAccel.addScaledVector(body.angularVelocity, -ATTITUDE_HOLD_KD_ACCEL);

  const inertia = body.currentMomentOfInertia();
  return new Vector3(desiredAccel.x * inertia.x, desiredAccel.y * inertia.y, desiredAccel.z * inertia.z);
}

/**
 * Répartiteur générique : les propulseurs `principal` suivent la consigne de poussée du
 * joueur ; les `rcs` ne s'allument, si le maintien d'attitude est actif, que si leur
 * contribution va dans le sens du couple désiré — jamais de poussée négative. Fonctionne
 * pour toute géométrie de propulseurs, pas seulement des paires axées.
 */
export function allocateThrusters(body: RigidBody): ThrusterAllocationResult {
  const desiredTorqueBody = computeDesiredAttitudeTorque(body);
  const thrusters = body.thrusters;

  const throttles = thrusters.map((thruster) => {
    if (thruster.kind === "principal") return body.command.throttle;
    if (!body.command.attitudeHoldEngaged) return 0;

    const position = new Vector3(...thruster.localPosition);
    const axis = new Vector3(...thruster.localAxis).normalize();
    const maxTorque = new Vector3().crossVectors(position, axis).multiplyScalar(thruster.maxThrustNewtons);
    const maxTorqueMagnitudeSquared = maxTorque.lengthSq();
    // Bras de levier nul (propulseur passant par le centre de masse) : aucune utilité pour l'attitude.
    if (maxTorqueMagnitudeSquared < 1e-9) return 0;

    const alignment = desiredTorqueBody.dot(maxTorque) / maxTorqueMagnitudeSquared;
    return Math.max(0, Math.min(1, alignment));
  });

  const { forceLocal, torqueBody } = sumThrusterWrench(thrusters, throttles);
  const forceWorld = forceLocal.applyQuaternion(body.attitude);

  let fuelFlowKgPerSecond = 0;
  for (let i = 0; i < thrusters.length; i++) {
    const throttle = throttles[i];
    if (throttle <= 0) continue;
    const thruster = thrusters[i];
    fuelFlowKgPerSecond += (throttle * thruster.maxThrustNewtons) / (thruster.specificImpulseSeconds * STANDARD_GRAVITY);
  }

  return { forceWorld, torqueBody, fuelFlowKgPerSecond, perThrusterThrottle: throttles };
}

/**
 * Si le débit demandé viderait la réserve pendant ce pas, met à l'échelle toutes les
 * poussées actives du même facteur (épuisement simultané et cohérent) et fixe la réserve
 * exactement à 0 — PHY-05 : jamais de valeur négative, aucune poussée après épuisement.
 */
export function applyPropellantConsumption(
  body: RigidBody,
  allocation: ThrusterAllocationResult,
  dt: number,
): ThrusterAllocationResult {
  const requestedKg = allocation.fuelFlowKgPerSecond * dt;
  if (requestedKg <= 0) return allocation;

  if (requestedKg <= body.reservoir.quantityKg) {
    body.reservoir.quantityKg -= requestedKg;
    return allocation;
  }

  const scale = body.reservoir.quantityKg / requestedKg;
  body.reservoir.quantityKg = 0;
  return {
    forceWorld: allocation.forceWorld.clone().multiplyScalar(scale),
    torqueBody: allocation.torqueBody.clone().multiplyScalar(scale),
    fuelFlowKgPerSecond: allocation.fuelFlowKgPerSecond * scale,
    perThrusterThrottle: allocation.perThrusterThrottle.map((v) => v * scale),
  };
}
