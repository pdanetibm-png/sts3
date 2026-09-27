import { Vector3 } from "three";
import { campOf } from "./camps";
import { crossedSphereBoundaryOutward } from "./collision";
import { Decoy } from "./decoy";
import { integrateLinear } from "./integrator";
import type { RigidBody } from "./rigidBody";
import { plumePeakIntensity } from "./signature";
import { STANDARD_GRAVITY } from "./thrusters";
import type { SimulationWorld } from "./world";

/** Une trace par seconde simulée (60 pas) : assez pour lire la trajectoire, sans alourdir la sauvegarde. */
const TRAIL_SAMPLE_STEPS = 60;
const MAX_TRAIL_POINTS = 600;

/**
 * Largage (CONCEPTION_LEURRES.md §2) : un leurre en moins en soute ; il part de la position et de
 * la vitesse du vaisseau et reprend son vecteur de poussée — axe du moteur principal et
 * accélération réelle à cet instant. Aucune impulsion de séparation (même convention que les
 * missiles). Sans poussée au largage, il dérivera avec le vaisseau.
 */
export function launchDecoy(world: SimulationWorld, owner: RigidBody): Decoy | null {
  if (owner.neutralized || owner.decoyCount <= 0 || !owner.decoy) return null;

  const principal = owner.principalThruster;
  const thrustNewtons = principal.maxThrustNewtons * owner.principalThrottle;
  // Accélération du vaisseau juste avant le largage, leurre encore en soute (PHY-06).
  const imitatedAccelerationMps2 = thrustNewtons / owner.massKg;
  owner.decoyCount -= 1;
  const decoy = new Decoy({
    id: `leurre-${world.nextDecoyNumber++}`,
    ownerId: owner.id,
    affiliation: owner.affiliation,
    position: owner.position,
    velocity: owner.velocity,
    def: owner.decoy,
    thrustDirectionWorld: owner.forwardAxisWorld,
    imitatedAccelerationMps2,
    imitatedPlumeWattsPerSr: plumePeakIntensity(thrustNewtons, principal.specificImpulseSeconds, principal.plumeRadiantFraction ?? 0),
    simTime: world.simTimeSeconds,
    initialTemperatureK: owner.hullTemperatureK,
  });
  world.decoys.push(decoy);
  // Seuls les largages du camp bleu sont connus du joueur (liaison de données).
  if (campOf(owner.affiliation) === "bleu") {
    const imitated = decoy.imitatedAccelerationMps2 > 0 ? `imite ${(decoy.imitatedAccelerationMps2 / STANDARD_GRAVITY).toFixed(2)} G` : "sans poussée à imiter, dérive avec le vaisseau";
    world.addEvent("leurre", `${decoy.id} largué par ${owner.name} (${imitated})`);
  }
  return decoy;
}

/**
 * Poussée d'un pas : tenir l'accélération imitée (poussée = masse × accélération, bornée par la
 * fiche), débit F/(Isp·g₀), arrêt exact à l'épuisement. Renvoie la fraction du pas effectivement
 * poussée (1, ou moins au pas d'épuisement).
 */
function pushDecoy(decoy: Decoy, dt: number): { forceWorld: Vector3; pushedFraction: number } {
  const requestedThrust = Math.min(decoy.def.maxThrustNewtons, decoy.massKg * decoy.imitatedAccelerationMps2);
  if (!(requestedThrust > 0) || decoy.reservoir.quantityKg <= 0) return { forceWorld: new Vector3(), pushedFraction: 0 };

  const requestedKg = (requestedThrust / (decoy.def.specificImpulseSeconds * STANDARD_GRAVITY)) * dt;
  let fraction = 1;
  if (requestedKg <= decoy.reservoir.quantityKg) {
    decoy.reservoir.quantityKg -= requestedKg;
  } else {
    fraction = decoy.reservoir.quantityKg / requestedKg;
    decoy.reservoir.quantityKg = 0;
  }
  decoy.lastThrustNewtons = requestedThrust * fraction;
  return { forceWorld: decoy.thrustDirectionWorld.clone().multiplyScalar(decoy.lastThrustNewtons), pushedFraction: fraction };
}

/**
 * Générateur de panache IR : complète le jet propre du leurre jusqu'à l'intensité du jet du
 * vaisseau au largage, dans la limite de sa puissance et de sa charge. Ne fonctionne qu'en poussée.
 */
function runIrEmitter(decoy: Decoy, pushedFraction: number, dt: number): void {
  const emitter = decoy.def.irEmitter;
  if (!emitter || decoy.emitterChargeKg <= 0 || pushedFraction <= 0) return;
  const wanted = Math.max(0, decoy.imitatedPlumeWattsPerSr * pushedFraction - decoy.motorPlumeWattsPerSr);
  let intensity = Math.min(wanted, emitter.maxRadiantPowerWatts / (2 * Math.PI));
  if (intensity <= 0) return;
  const neededKg = (intensity * 2 * Math.PI * dt) / emitter.radiantEnergyJoulesPerKg;
  if (neededKg <= decoy.emitterChargeKg) {
    decoy.emitterChargeKg -= neededKg;
  } else {
    intensity *= decoy.emitterChargeKg / neededKg;
    decoy.emitterChargeKg = 0;
  }
  decoy.lastEmitterWattsPerSr = intensity;
}

/** Poussée + générateur + intégration + frontière de tous les leurres actifs, pour un pas. */
export function stepDecoys(world: SimulationWorld, dt: number): void {
  for (const decoy of world.decoys) {
    if (!decoy.isActive) continue;
    const p0 = decoy.position.clone();
    decoy.lastThrustNewtons = 0;
    decoy.lastEmitterWattsPerSr = 0;

    let forceWorld = new Vector3();
    if (decoy.state === "poussee") {
      const push = pushDecoy(decoy, dt);
      forceWorld = push.forceWorld;
      runIrEmitter(decoy, push.pushedFraction, dt);
      if (push.pushedFraction < 1) {
        decoy.state = "derive";
        decoy.thrustEndedSimTime = world.simTimeSeconds;
        if (campOf(decoy.affiliation) === "bleu" && decoy.imitatedAccelerationMps2 > 0) {
          world.addEvent("leurre", `${decoy.id} : propergol épuisé, en dérive`);
        }
      }
    }
    integrateLinear(decoy.position, decoy.velocity, forceWorld, decoy.massKg, dt);
    decoy.stepThermal(dt);

    if (world.stepIndex % TRAIL_SAMPLE_STEPS === 0) {
      decoy.trail.push(decoy.position.clone());
      if (decoy.trail.length > MAX_TRAIL_POINTS) decoy.trail.shift();
    }

    if (crossedSphereBoundaryOutward(p0, decoy.position, world.theatre.centerWorld, world.theatre.radiusMeters)) {
      decoy.state = "perdu_theatre";
      decoy.endedSimTime = world.simTimeSeconds;
      if (campOf(decoy.affiliation) === "bleu") world.addEvent("leurre", `${decoy.id} perdu — limite du théâtre`);
    }
  }
}
