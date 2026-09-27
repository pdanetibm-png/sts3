import { Vector3 } from "three";
import type { RigidBody } from "./rigidBody";
import { STANDARD_GRAVITY } from "./thrusters";

const DEFAULT_SAMPLES = 360;

export interface PredictedPoint {
  /** Temps depuis maintenant (s). */
  t: number;
  position: Vector3;
}

/**
 * Prolonge la trajectoire selon la consigne actuelle maintenue (section 8.2) : poussée
 * principale dans l'axe tenu (attitude visée si le maintien est engagé, sinon l'attitude
 * actuelle), masse qui diminue avec le propergol, arrêt de la poussée à réservoir vide. Les
 * transitoires de rotation sont négligés ; aucune manœuvre future non engagée n'est supposée.
 * Affichage uniquement — n'affecte jamais la simulation.
 */
export function predictTrajectory(body: RigidBody, horizonSeconds: number, samples = DEFAULT_SAMPLES): PredictedPoint[] {
  const principal = body.principalThruster;
  const localAxis = new Vector3(...principal.localAxis).normalize();
  const orientation = body.command.attitudeHoldEngaged ? body.command.targetAttitude : body.attitude;
  const thrustDirection = localAxis.applyQuaternion(orientation);
  const thrust = principal.maxThrustNewtons * body.command.throttle;
  const massFlow = thrust / (principal.specificImpulseSeconds * STANDARD_GRAVITY);

  const position = body.position.clone();
  const velocity = body.velocity.clone();
  let propellant = body.reservoir.quantityKg;
  const dt = horizonSeconds / samples;
  const points: PredictedPoint[] = [{ t: 0, position: position.clone() }];
  for (let i = 1; i <= samples; i++) {
    const burnable = Math.min(propellant, massFlow * dt);
    const fraction = massFlow * dt > 0 ? burnable / (massFlow * dt) : 0;
    const acceleration = (thrust * fraction) / (body.structure.dryMassKg + propellant);
    propellant -= burnable;
    velocity.addScaledVector(thrustDirection, acceleration * dt);
    position.addScaledVector(velocity, dt);
    points.push({ t: i * dt, position: position.clone() });
  }
  return points;
}

export interface ClosestApproach {
  /** Temps depuis maintenant (s). */
  t: number;
  distanceMeters: number;
  ownPosition: Vector3;
  otherPosition: Vector3;
  /** Minimum atteint en fin d'horizon : la distance décroît encore au-delà. */
  beyondHorizon: boolean;
}

/**
 * Point d'approche au plus près entre la trajectoire prédite (points datés) et un contact
 * supposé à vitesse constante — exact sur chaque segment (mouvement relatif linéaire).
 * Affichage uniquement : ne repose que sur les estimations fournies.
 */
export function closestApproach(own: readonly PredictedPoint[], otherPosition: Vector3, otherVelocity: Vector3): ClosestApproach | null {
  if (own.length === 0) return null;
  const otherAt = (t: number) => otherPosition.clone().addScaledVector(otherVelocity, t);
  let best: ClosestApproach = {
    t: own[0].t,
    distanceMeters: own[0].position.distanceTo(otherAt(own[0].t)),
    ownPosition: own[0].position.clone(),
    otherPosition: otherAt(own[0].t),
    beyondHorizon: false,
  };
  for (let i = 1; i < own.length; i++) {
    const a = own[i - 1];
    const b = own[i];
    const span = b.t - a.t;
    const r0 = a.position.clone().sub(otherAt(a.t));
    const dr = b.position.clone().sub(a.position).addScaledVector(otherVelocity, -span);
    const lengthSq = dr.lengthSq();
    const u = lengthSq > 0 ? Math.min(1, Math.max(0, -r0.dot(dr) / lengthSq)) : 0;
    const distance = r0.addScaledVector(dr, u).length();
    if (distance < best.distanceMeters) {
      const t = a.t + u * span;
      best = {
        t,
        distanceMeters: distance,
        ownPosition: a.position.clone().lerp(b.position, u),
        otherPosition: otherAt(t),
        beyondHorizon: false,
      };
    }
  }
  best.beyondHorizon = own.length > 1 && best.t >= own[own.length - 1].t - 1e-9;
  return best;
}
