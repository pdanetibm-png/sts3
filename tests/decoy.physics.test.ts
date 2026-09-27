import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { launchDecoy } from "../src/sim/decoySystem";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import { infraredIntensityToward, plumePeakIntensity } from "../src/sim/signature";
import { STANDARD_GRAVITY } from "../src/sim/thrusters";
import type { DecoyDef } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit, TEST_DECOY, TEST_DECOY_LIGHT } from "./fixtures";

// Adversaire lointain, désarmé : hors de portée des capteurs, il ne perturbe rien.
function buildWorld(decoy: DecoyDef = TEST_DECOY) {
  return new SimulationWorld({
    version: "test",
    seed: 11,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [100, 0, 0], decoy, decoyCount: 3 }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 200000, 0], missileCount: 0 }),
    ],
  });
}

/** Le joueur pousse à `throttle` le long de +y pendant un pas, pour que sa poussée soit réelle au largage. */
function thrustAlongY(world: SimulationWorld, throttle: number) {
  const player = world.playerBody!;
  player.attitude.copy(new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), new Vector3(0, 1, 0)));
  player.command.throttle = throttle;
  world.stepOnce();
  return player;
}

describe("Leurres — largage (ATTENDU_LEURRES.md)", () => {
  it("consomme un leurre et part de la position et de la vitesse du vaisseau, avec son vecteur de poussée", () => {
    const world = buildWorld();
    const player = thrustAlongY(world, 0.3);
    const expectedAcceleration = (0.3 * player.principalThruster.maxThrustNewtons) / player.massKg;

    const decoy = launchDecoy(world, player)!;

    expect(decoy).not.toBeNull();
    expect(player.decoyCount).toBe(2);
    expect(world.decoys).toHaveLength(1);
    expect(decoy.position.distanceTo(player.position)).toBe(0);
    expect(decoy.velocity.distanceTo(player.velocity)).toBe(0);
    expect(decoy.thrustDirectionWorld.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9);
    expect(decoy.imitatedAccelerationMps2).toBeCloseTo(expectedAcceleration, 9);
  });

  it("aucun largage sans stock, ni depuis un vaisseau neutralisé", () => {
    const world = buildWorld();
    const player = world.playerBody!;
    player.decoyCount = 0;
    expect(launchDecoy(world, player)).toBeNull();
    player.decoyCount = 2;
    player.neutralize();
    expect(launchDecoy(world, player)).toBeNull();
    expect(world.decoys).toHaveLength(0);
  });

  it("un vaisseau sans leurre au catalogue ne peut rien larguer", () => {
    const world = new SimulationWorld({
      version: "test",
      seed: 1,
      objective: "test",
      ships: [buildShipInit({ id: "joueur-1", affiliation: "joueur", decoyCount: 3 }), buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [50000, 0, 0] })],
    });
    expect(world.playerBody!.decoyCount).toBe(0);
    expect(world.launchPlayerDecoy()).toBeNull();
  });

  it("le largage du joueur est un événement connu ; celui de l'adversaire ne l'est pas", () => {
    const world = new SimulationWorld({
      version: "test",
      seed: 11,
      objective: "test",
      ships: [
        buildShipInit({ id: "joueur-1", affiliation: "joueur", decoy: TEST_DECOY, decoyCount: 3 }),
        buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 200000, 0], missileCount: 0, decoy: TEST_DECOY, decoyCount: 1 }),
      ],
    });
    thrustAlongY(world, 0.3);
    world.launchPlayerDecoy();
    launchDecoy(world, world.getBody("adversaire-1")!);
    expect(world.decoys).toHaveLength(2);
    const decoyEvents = world.events.filter((e) => e.category === "leurre");
    expect(decoyEvents).toHaveLength(1);
    expect(decoyEvents[0].message).toContain("leurre-1");
  });
});

describe("Leurres — poussée imitée", () => {
  it("tient l'accélération du vaisseau au largage, le long de son axe figé", () => {
    const world = buildWorld();
    const player = thrustAlongY(world, 0.3);
    const decoy = launchDecoy(world, player)!;
    player.command.throttle = 0;
    const v0 = decoy.velocity.clone();

    const seconds = 10;
    for (let i = 0; i < seconds / FIXED_DT_SECONDS; i++) world.stepOnce();

    const gained = decoy.velocity.clone().sub(v0);
    expect(gained.y / seconds).toBeCloseTo(decoy.imitatedAccelerationMps2, 2);
    expect(Math.abs(gained.x) + Math.abs(gained.z)).toBeLessThan(1e-9);
    expect(decoy.state).toBe("poussee");
  });

  it("consomme F / (Isp · g₀) par seconde", () => {
    const world = buildWorld();
    const player = thrustAlongY(world, 0.3);
    const decoy = launchDecoy(world, player)!;
    const before = decoy.reservoir.quantityKg;
    world.stepOnce();
    const expectedKg = (decoy.lastThrustNewtons / (TEST_DECOY.specificImpulseSeconds * STANDARD_GRAVITY)) * FIXED_DT_SECONDS;
    expect(before - decoy.reservoir.quantityKg).toBeCloseTo(expectedKg, 12);
  });

  it("une accélération hors de portée de sa fiche est bornée par sa poussée maximale", () => {
    const world = buildWorld();
    const player = thrustAlongY(world, 1);
    const decoy = launchDecoy(world, player)!;
    world.stepOnce();
    expect(decoy.massKg * decoy.imitatedAccelerationMps2).toBeGreaterThan(TEST_DECOY.maxThrustNewtons);
    expect(decoy.lastThrustNewtons).toBe(TEST_DECOY.maxThrustNewtons);
  });

  it("à l'épuisement : réserve exactement nulle, puis dérive à vitesse conservée", () => {
    const world = buildWorld();
    const player = thrustAlongY(world, 0.3);
    const decoy = launchDecoy(world, player)!;
    decoy.reservoir.quantityKg = 0.05;

    for (let i = 0; i < 120; i++) world.stepOnce();
    expect(decoy.state).toBe("derive");
    expect(decoy.reservoir.quantityKg).toBe(0);
    expect(decoy.thrustEndedSimTime).not.toBeNull();

    const drifting = decoy.velocity.clone();
    for (let i = 0; i < 120; i++) world.stepOnce();
    expect(decoy.velocity.distanceTo(drifting)).toBe(0);
    expect(world.events.some((e) => e.message.includes("propergol épuisé"))).toBe(true);
  });

  it("largué sans poussée, il dérive avec le vaisseau", () => {
    const world = buildWorld();
    const player = world.playerBody!;
    world.stepOnce();
    const decoy = launchDecoy(world, player)!;
    expect(decoy.imitatedAccelerationMps2).toBe(0);

    for (let i = 0; i < 20 / FIXED_DT_SECONDS; i++) world.stepOnce();
    expect(decoy.state).toBe("derive");
    expect(decoy.position.distanceTo(player.position)).toBeLessThan(1e-6);
    expect(world.events.some((e) => e.message.includes("propergol épuisé"))).toBe(false);
  });
});

describe("Leurres — signature infrarouge", () => {
  it("vu de l'arrière, jet + générateur égalent le jet du vaisseau à la même poussée", () => {
    const world = buildWorld();
    const player = thrustAlongY(world, 0.2);
    const shipPlume = player.signatureSource().plumePeakWattsPerSr;
    const decoy = launchDecoy(world, player)!;
    player.command.throttle = 0;
    world.stepOnce();

    expect(decoy.lastEmitterWattsPerSr).toBeGreaterThan(0);
    expect(decoy.motorPlumeWattsPerSr + decoy.lastEmitterWattsPerSr).toBeCloseTo(shipPlume, 6);
    // Observateur dans l'axe arrière : coque + jet total (directivité 1).
    const behind = decoy.position.clone().addScaledVector(decoy.thrustDirectionWorld, -10000);
    const hullOnly = infraredIntensityToward({ ...decoy.signatureSource(), plumePeakWattsPerSr: 0 }, behind, 0.3);
    expect(infraredIntensityToward(decoy.signatureSource(), behind, 0.3) - hullOnly).toBeCloseTo(shipPlume, 6);
  });

  it("le générateur est borné par sa puissance, et sa charge baisse de P·dt / E", () => {
    const world = buildWorld();
    const player = thrustAlongY(world, 0.3);
    const decoy = launchDecoy(world, player)!;
    const emitter = TEST_DECOY.irEmitter!;
    const before = decoy.emitterChargeKg;
    world.stepOnce();

    expect(decoy.imitatedPlumeWattsPerSr - decoy.motorPlumeWattsPerSr).toBeGreaterThan(emitter.maxRadiantPowerWatts / (2 * Math.PI));
    expect(decoy.lastEmitterWattsPerSr).toBeCloseTo(emitter.maxRadiantPowerWatts / (2 * Math.PI), 6);
    expect(before - decoy.emitterChargeKg).toBeCloseTo((emitter.maxRadiantPowerWatts * FIXED_DT_SECONDS) / emitter.radiantEnergyJoulesPerKg, 12);
  });

  it("charge épuisée : il ne reste que le jet propre du leurre", () => {
    const world = buildWorld();
    const player = thrustAlongY(world, 0.2);
    const decoy = launchDecoy(world, player)!;
    decoy.emitterChargeKg = 0;
    world.stepOnce();
    expect(decoy.lastEmitterWattsPerSr).toBe(0);
    expect(decoy.signatureSource().plumePeakWattsPerSr).toBeCloseTo(plumePeakIntensity(decoy.lastThrustNewtons, TEST_DECOY.specificImpulseSeconds, TEST_DECOY.plumeRadiantFraction), 9);
  });

  it("un leurre léger, sans générateur, brille bien moins que le jet qu'il prétend imiter", () => {
    const world = buildWorld(TEST_DECOY_LIGHT);
    const player = thrustAlongY(world, 0.2);
    const decoy = launchDecoy(world, player)!;
    world.stepOnce();
    expect(decoy.signatureSource().plumePeakWattsPerSr).toBeLessThan(decoy.imitatedPlumeWattsPerSr / 100);
  });
});

describe("Leurres — frontière du théâtre", () => {
  it("retiré une seule fois au franchissement, sans retour", () => {
    const world = buildWorld();
    const player = world.playerBody!;
    world.stepOnce();
    const decoy = launchDecoy(world, player)!;
    const outward = new Vector3(1, 0, 0);
    decoy.position.copy(world.theatre.centerWorld).addScaledVector(outward, world.theatre.radiusMeters - 1);
    decoy.velocity.copy(outward.multiplyScalar(600));

    for (let i = 0; i < 60; i++) world.stepOnce();
    expect(decoy.state).toBe("perdu_theatre");
    expect(world.events.filter((e) => e.message.includes("limite du théâtre"))).toHaveLength(1);
    const frozen = decoy.position.clone();
    world.stepOnce();
    expect(decoy.position.distanceTo(frozen)).toBe(0);
  });
});
