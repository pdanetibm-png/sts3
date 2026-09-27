import { Vector3 } from "three";
import type { RigidBody } from "./rigidBody";
import { ATTITUDE_SETTLE_SECONDS } from "./thrusters";

/** Modes de pilotage assisté (section 8.2) : le pilote garde la main sur la poussée. */
export type NavMode = "manuel" | "interception" | "evasion" | "perpendiculaire" | "egaliser";

export const NAV_MODE_LABELS: Record<NavMode, string> = {
  manuel: "Manuel",
  interception: "Interception",
  evasion: "Évasion",
  perpendiculaire: "Perpendiculaire",
  egaliser: "Égaliser vitesse",
};

// En deçà de cet écart de vitesse, la consigne n'est plus recalculée (évite l'agitation du cap).
const SETTLED_SPEED_MPS = 1;
// Accélération de référence minimale pour le profil d'interception, en fraction de la poussée max.
const MIN_REFERENCE_THROTTLE = 0.25;
// Part de l'accélération disponible réellement comptée pour freiner : le reste absorbe les
// erreurs d'estimation et la poussée perdue pendant le retournement.
const BRAKING_MARGIN = 0.8;

/**
 * Oriente le vaisseau selon le mode choisi, sur la piste désignée — consigne persistante
 * recalculée à chaque pas (UX-02), à partir de la seule connaissance du vaisseau (jamais une
 * position réelle cachée). Une piste au gisement seul suffit pour l'évasion et la manœuvre
 * perpendiculaire ; l'interception et l'égalisation demandent une position, et une vitesse
 * estimée pour l'égalisation.
 */
export function updateNavigation(body: RigidBody): void {
  const mode = body.command.navMode;
  const trackId = body.command.navTrackId;
  if (mode === "manuel" || !trackId) return;
  const track = body.knowledge.getTrack(trackId);
  if (!track) return;

  const lineOfSight = track.positionEstimateWorld ? track.positionEstimateWorld.clone().sub(body.position) : track.bearingEstimateWorld.clone();
  const distance = lineOfSight.length();
  if (distance < 1e-3) return;
  lineOfSight.divideScalar(distance);
  const relativeVelocity = body.velocity.clone().sub(track.velocityEstimateWorld ?? new Vector3());

  let direction: Vector3 | null = null;
  switch (mode) {
    case "interception": {
      if (!track.positionEstimateWorld) {
        direction = lineOfSight;
        break;
      }
      // Profil de rendez-vous : vitesse de rapprochement √(2·a·d), que la poussée peut encore
      // annuler à l'arrivée, en réservant la distance parcourue pendant le retournement (moteur
      // principal unique). La « vitesse à gagner » corrige aussi la dérive latérale ; après un
      // croisement, elle ramène naturellement vers la cible.
      const maxAcceleration = body.principalThruster.maxThrustNewtons / body.massKg;
      const reference = BRAKING_MARGIN * maxAcceleration * Math.max(body.command.throttle, MIN_REFERENCE_THROTTLE);
      const closingSpeed = Math.max(0, relativeVelocity.dot(lineOfSight));
      const brakingDistance = Math.max(0, distance - closingSpeed * ATTITUDE_SETTLE_SECONDS);
      const velocityToGain = lineOfSight.clone().multiplyScalar(Math.sqrt(2 * reference * brakingDistance)).sub(relativeVelocity);
      if (velocityToGain.length() > SETTLED_SPEED_MPS) direction = velocityToGain.normalize();
      break;
    }
    case "evasion":
      direction = lineOfSight.clone().negate();
      break;
    case "perpendiculaire": {
      // Écart latéral maximal par rapport à la route de la menace : perpendiculaire à la fois à
      // la ligne de visée et à la vitesse relative.
      let lateral = new Vector3().crossVectors(lineOfSight, relativeVelocity);
      if (lateral.lengthSq() < 1e-6) lateral = new Vector3().crossVectors(lineOfSight, Math.abs(lineOfSight.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
      direction = lateral.normalize();
      break;
    }
    case "egaliser": {
      if (!track.velocityEstimateWorld) break;
      const velocityToGain = relativeVelocity.clone().negate();
      if (velocityToGain.length() > SETTLED_SPEED_MPS) direction = velocityToGain.normalize();
      break;
    }
  }
  if (!direction) return;

  const localAxis = new Vector3(...body.principalThruster.localAxis).normalize();
  body.command.targetAttitude.setFromUnitVectors(localAxis, direction);
  body.command.attitudeHoldEngaged = true;
}
