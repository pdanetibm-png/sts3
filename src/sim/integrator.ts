import { Quaternion, Vector3 } from "three";
import type { RigidBody } from "./rigidBody";
import { allocateThrusters, applyPropellantConsumption } from "./thrusters";
import { stepPower } from "./power";

export const FIXED_DT_SECONDS = 1 / 60;

/** Intégration linéaire pure — testée isolément pour PHY-01 (inertie sans force). */
export function integrateLinear(
  position: Vector3,
  velocity: Vector3,
  forceWorld: Vector3,
  massKg: number,
  dt: number,
): void {
  const acceleration = forceWorld.clone().divideScalar(massKg);
  velocity.addScaledVector(acceleration, dt);
  position.addScaledVector(velocity, dt);
}

/** Intégration angulaire pure, indépendante de la vitesse linéaire — testée pour PHY-02. */
export function integrateAngular(
  attitude: Quaternion,
  angularVelocity: Vector3,
  torqueBody: Vector3,
  inertiaKgM2: Vector3,
  dt: number,
): void {
  const angularAcceleration = new Vector3(
    torqueBody.x / inertiaKgM2.x,
    torqueBody.y / inertiaKgM2.y,
    torqueBody.z / inertiaKgM2.z,
  );
  angularVelocity.addScaledVector(angularAcceleration, dt);

  const omega = new Quaternion(
    angularVelocity.x,
    angularVelocity.y,
    angularVelocity.z,
    0,
  );
  const qDot = attitude.clone().multiply(omega);
  attitude.set(
    attitude.x + qDot.x * 0.5 * dt,
    attitude.y + qDot.y * 0.5 * dt,
    attitude.z + qDot.z * 0.5 * dt,
    attitude.w + qDot.w * 0.5 * dt,
  );
  attitude.normalize();
}

/**
 * Orchestre un pas complet : répartition des propulseurs → clamp propergol (PHY-05) →
 * intégration linéaire/angulaire avec masse/inertie à jour → bilan énergie (RES-01).
 */
export function integrateBody(body: RigidBody, dt: number): void {
  const rawAllocation = allocateThrusters(body);
  const allocation = applyPropellantConsumption(body, rawAllocation, dt);
  body.lastAllocation = allocation;

  integrateLinear(body.position, body.velocity, allocation.forceWorld, body.massKg, dt);
  integrateAngular(body.attitude, body.angularVelocity, allocation.torqueBody, body.currentMomentOfInertia(), dt);

  body.lastPowerStep = stepPower(body, dt);
}
