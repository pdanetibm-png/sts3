import { Vector3 } from "three";
import { campOf, sameCamp } from "./camps";
import { crossedSphereBoundaryOutward, sweptSegmentHitsMovingSphere } from "./collision";
import { integrateLinear } from "./integrator";
import { guidanceThrustDirection, Missile, resolveGuidanceTarget, TERMINAL_IGNITION_FACTOR } from "./missile";
import type { RigidBody } from "./rigidBody";
import { STANDARD_GRAVITY } from "./thrusters";
import type { SimulationWorld } from "./world";

/**
 * Lancement explicite (ARM-01) : consomme une unité de stock, le missile reprend le socle
 * dynamique du porteur (masse/propergol/poussée propres). Vitesse initiale = celle du point
 * de lancement ; séparation abstraite déclarée négligée (section 4.1), aucune impulsion fictive.
 */
export function launchMissile(
  world: SimulationWorld,
  owner: RigidBody,
  trackId: string,
  hypotheticalDistanceMeters: number,
): Missile | null {
  if (owner.missileCount <= 0) return null;
  const track = owner.knowledge.getTrack(trackId);
  if (!track) return null;

  const hypotheticalTargetWorld = track.positionEstimateWorld
    ? null
    : owner.position.clone().addScaledVector(track.bearingEstimateWorld, hypotheticalDistanceMeters);

  owner.missileCount -= 1;
  const missile = new Missile({
    id: `missile-${world.nextMissileNumber++}`,
    ownerId: owner.id,
    affiliation: owner.affiliation,
    position: owner.position.clone(),
    velocity: owner.velocity.clone(),
    def: owner.missile,
    assignedTrackId: trackId,
    hypotheticalTargetWorld,
    simTime: world.simTimeSeconds,
    initialTemperatureK: owner.hullTemperatureK,
  });
  world.missiles.push(missile);
  world.trackAttribution.recordMissileLaunch(missile.id, owner.id, trackId, world.simTimeSeconds);
  // Seuls les tirs du camp bleu sont connus du joueur (liaison de données) — MIS-05.
  if (campOf(owner.affiliation) === "bleu") world.addEvent("lancement", `${missile.id} lancé par ${owner.name} sur ${trackId}`);
  return missile;
}

/** Guidage + intégration + frontière + collision de tous les missiles actifs, pour un pas. */
export function stepMissiles(world: SimulationWorld, dt: number): void {
  for (const missile of world.missiles) {
    if (missile.state !== "poussee" && missile.state !== "derive") continue;

    const owner = world.getBody(missile.ownerId);
    const p0 = missile.position.clone();

    if (missile.state === "poussee") {
      updateThrustPhase(missile, owner);
      const direction = owner && missile.phase !== "croisiere" ? guidanceThrustDirection(missile, owner) : null;
      const forceWorld = direction ? direction.multiplyScalar(missile.maxThrustNewtons) : new Vector3();
      let fuelFlow = forceWorld.lengthSq() > 0 ? missile.maxThrustNewtons / (missile.specificImpulseSeconds * STANDARD_GRAVITY) : 0;
      const requestedKg = fuelFlow * dt;
      // En accélération, on ne touche jamais à la réserve terminale.
      const availableKg = missile.phase === "acceleration" ? Math.max(0, missile.reservoir.quantityKg - missile.reserveKg) : missile.reservoir.quantityKg;
      if (requestedKg > 0) {
        if (requestedKg <= availableKg) {
          missile.reservoir.quantityKg -= requestedKg;
        } else {
          const scale = availableKg / requestedKg;
          forceWorld.multiplyScalar(scale);
          fuelFlow *= scale;
          missile.reservoir.quantityKg -= availableKg;
          if (missile.reservoir.quantityKg <= 1e-9) {
            missile.reservoir.quantityKg = 0;
            missile.state = "derive";
          } else {
            missile.phase = "croisiere";
          }
        }
      }
      missile.lastFuelFlowKgPerSecond = fuelFlow;
      if (forceWorld.lengthSq() > 0) missile.axisWorld.copy(forceWorld).normalize();
      integrateLinear(missile.position, missile.velocity, forceWorld, missile.massKg, dt);
    } else {
      missile.lastFuelFlowKgPerSecond = 0;
      if (missile.velocity.lengthSq() > 1e-6) missile.axisWorld.copy(missile.velocity).normalize();
      integrateLinear(missile.position, missile.velocity, new Vector3(), missile.massKg, dt);
    }
    missile.stepThermal(dt);

    missile.trail.push(missile.position.clone());
    if (missile.trail.length > 300) missile.trail.shift();

    const blueMissile = campOf(missile.affiliation) === "bleu";
    if (crossedSphereBoundaryOutward(p0, missile.position, world.theatre.centerWorld, world.theatre.radiusMeters)) {
      missile.state = "perdu_theatre";
      if (blueMissile) world.addEvent("perte_missile", `${missile.id} perdu — limite du théâtre`);
      continue;
    }

    // Pas de tir fratricide : seuls les vaisseaux du camp opposé, encore en état, sont touchables.
    let hitShip = false;
    for (const ship of world.bodies) {
      if (ship.neutralized || sameCamp(ship.affiliation, missile.affiliation)) continue;
      const result = sweptSegmentHitsMovingSphere(p0, missile.position, ship.position, ship.velocity, dt, ship.structure.collisionRadiusMeters);
      if (!result.hit) continue;
      missile.state = "detruit";
      ship.neutralize();
      if (campOf(ship.affiliation) === "bleu") {
        world.addEvent("impact_missile", `${missile.id} a touché ${ship.name} — neutralisé`);
      } else if (blueMissile) {
        world.addEvent("impact_missile", `${missile.id} a atteint sa cible (${missile.assignedTrackId ?? "sans piste"})`);
      }
      // TIM-03 : un impact connu du camp bleu est un événement critique ⇒ retour à ×1.
      if (campOf(ship.affiliation) === "bleu" || blueMissile) world.speedMultiplier = 1;
      hitShip = true;
      break;
    }
    if (!hitShip) collideWithDecoys(world, missile, p0, dt);
  }
}

/**
 * Programme de poussée (MissileDef.terminalReserveFraction) : la croisière commence quand il ne
 * reste que la réserve ; la phase terminale quand le temps avant impact estimé (d'après la piste
 * du porteur, jamais la vérité) tombe sous quelques durées de combustion de la réserve — ou dès
 * que le missile ne se rapproche plus du point visé.
 */
function updateThrustPhase(missile: Missile, owner: RigidBody | undefined): void {
  if (missile.reserveKg <= 0) return;
  if (missile.phase === "acceleration" && missile.reservoir.quantityKg <= missile.reserveKg + 1e-9) missile.phase = "croisiere";
  if (missile.phase !== "croisiere" || !owner) return;
  const target = resolveGuidanceTarget(missile, owner);
  if (!target) return;
  const offset = target.clone().sub(missile.position);
  const distance = offset.length();
  if (distance < 1) {
    missile.phase = "terminale";
    return;
  }
  const track = missile.assignedTrackId ? owner.knowledge.getTrack(missile.assignedTrackId) : undefined;
  const relativeVelocity = missile.velocity.clone().sub(track?.velocityEstimateWorld ?? new Vector3());
  const closing = relativeVelocity.dot(offset.divideScalar(distance));
  const massFlow = missile.maxThrustNewtons / (missile.specificImpulseSeconds * STANDARD_GRAVITY);
  const burnSeconds = missile.reservoir.quantityKg / massFlow;
  if (closing <= 0 || distance / closing <= TERMINAL_IGNITION_FACTOR * burnSeconds) missile.phase = "terminale";
}

/**
 * Un missile peut percuter un leurre du camp adverse (CONCEPTION_LEURRES.md §5) : même collision
 * continue que pour les vaisseaux, destruction des deux. Pour le tireur, c'est un impact comme un
 * autre — il ne sait pas ce qu'il a touché ; la partie continue faute de neutralisation.
 */
function collideWithDecoys(world: SimulationWorld, missile: Missile, p0: Vector3, dt: number): void {
  for (const decoy of world.decoys) {
    if (!decoy.isActive || sameCamp(decoy.affiliation, missile.affiliation)) continue;
    if (!sweptSegmentHitsMovingSphere(p0, missile.position, decoy.position, decoy.velocity, dt, decoy.def.collisionRadiusMeters).hit) continue;
    missile.state = "detruit";
    decoy.state = "detruit";
    decoy.endedSimTime = world.simTimeSeconds;
    decoy.destroyedByMissileId = missile.id;
    const blueMissile = campOf(missile.affiliation) === "bleu";
    if (blueMissile) world.addEvent("impact_missile", `${missile.id} a atteint sa cible (${missile.assignedTrackId ?? "sans piste"})`);
    if (campOf(decoy.affiliation) === "bleu") world.addEvent("leurre", `${decoy.id} : liaison perdue (impact probable)`);
    if (blueMissile) world.speedMultiplier = 1;
    return;
  }
}
