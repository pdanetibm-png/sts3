import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Decoy } from "../src/sim/decoy";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import { Missile } from "../src/sim/missile";
import { firingSolution, presentedArea, salvoKillProbability } from "../src/sim/pdc";
import { replayInputs } from "../src/sim/replay";
import { buildSaveDocument, restoreWorldFromSave } from "../src/sim/save";
import { createSeededRng } from "../src/sim/rng";
import type { ScenarioDefinition } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit, TEST_DECOY_LIGHT, TEST_PDC } from "./fixtures";

// --- Lois ---------------------------------------------------------------------------------------

describe("PDC — lois (CONCEPTION_PDC.md)", () => {
  it("solution de tir : cible immobile visée droit, cible en travers visée en avance, cible trop rapide hors d'atteinte", () => {
    const origin = new Vector3();
    const still = firingSolution(origin, origin, new Vector3(3000, 0, 0), new Vector3(), 1500)!;
    expect(still.timeSeconds).toBeCloseTo(2, 9);
    expect(still.aimDirectionWorld.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-9);

    const crossing = firingSolution(origin, origin, new Vector3(3000, 0, 0), new Vector3(0, 500, 0), 1500)!;
    // L'obus et la cible arrivent au même point au même instant.
    const targetThere = new Vector3(3000, 500 * crossing.timeSeconds, 0);
    const shellThere = crossing.aimDirectionWorld.clone().multiplyScalar(1500 * crossing.timeSeconds);
    expect(shellThere.distanceTo(targetThere)).toBeLessThan(1e-6);
    expect(crossing.aimDirectionWorld.y).toBeGreaterThan(0);

    expect(firingSolution(origin, origin, new Vector3(3000, 0, 0), new Vector3(2000, 0, 0), 1500)).toBeNull();
  });

  it("probabilité d'une rafale : baisse avec la distance de passage, monte avec le nombre d'obus, nulle sans surface", () => {
    const p = (rounds: number, miss: number) => salvoKillProbability(rounds, 0.13, 2, miss);
    expect(p(1, 0)).toBeGreaterThan(p(1, 2));
    expect(p(1, 2)).toBeGreaterThan(p(1, 6));
    expect(p(10, 2)).toBeGreaterThan(p(1, 2));
    expect(p(1000, 0)).toBeLessThanOrEqual(1);
    expect(salvoKillProbability(10, 0, 2, 0)).toBe(0);
    // Densité gaussienne intégrée sur une petite cible au centre : A/(2πσ²).
    expect(p(1, 0)).toBeCloseTo(1 - Math.exp(-0.13 / (2 * Math.PI * 4)), 12);
  });

  it("surface présentée : faible de face, forte de profil", () => {
    const axis = new Vector3(1, 0, 0);
    expect(presentedArea(0.13, 1.6, axis, new Vector3(-1, 0, 0))).toBeCloseTo(0.13, 12);
    expect(presentedArea(0.13, 1.6, axis, new Vector3(0, 1, 0))).toBeCloseTo(1.6, 12);
    expect(presentedArea(undefined, undefined, axis, new Vector3(0, 1, 0))).toBe(0);
  });
});

// --- Banc d'engagement --------------------------------------------------------------------------

interface BenchOptions {
  seed: number;
  speedMps: number;
  /** Bruit des mesures radar synthétiques (m) : c'est lui qui fait la qualité de la piste. */
  trackNoiseMeters: number;
  count?: number;
  mounts?: number;
}

function benchScenario(options: BenchOptions): ScenarioDefinition {
  return {
    version: "test",
    seed: options.seed,
    objective: "test",
    ships: [
      buildShipInit({
        id: "joueur-1",
        affiliation: "joueur",
        pdcs: Array.from({ length: options.mounts ?? 2 }, (_, i) => ({ id: `pdc-${i + 1}`, pdc: TEST_PDC })),
      }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 900000, 0], missileCount: 0 }),
    ],
  };
}

/**
 * Mesures radar synthétiques des objets désignés, toutes les 0,1 s, dans la connaissance du joueur
 * (ses capteurs restent éteints). Le bruit ne dépend que de la graine, du pas et de l'objet : le
 * même banc rattaché à un monde repris d'une sauvegarde produit exactement les mêmes mesures.
 */
function feedFor(world: SimulationWorld, options: BenchOptions, targetIds: readonly string[], crossSectionM2 = 0.1): () => void {
  return () => {
    if (world.stepIndex % 6 !== 0) return;
    const player = world.playerBody!;
    targetIds.forEach((id, index) => {
      const target = world.missiles.find((m) => m.id === id) ?? world.decoys.find((d) => d.id === id);
      if (!target?.isActive) return;
      const noise = createSeededRng(options.seed * 1_000_003 + world.stepIndex * 17 + index);
      const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, noise()))) * Math.cos(2 * Math.PI * noise());
      const offset = target.position.clone().sub(player.position);
      const range = offset.length();
      const measured = offset.clone().add(new Vector3(0, gaussian(), gaussian()).multiplyScalar(options.trackNoiseMeters / Math.SQRT2));
      player.knowledge.ingest(
        {
          simTime: world.simTimeSeconds,
          sourceSensorId: "radar-1",
          mode: "radar_active",
          bearingWorld: measured.clone().normalize(),
          bearingUncertaintyRad: options.trackNoiseMeters / range,
          rangeMeters: range + gaussian() * options.trackNoiseMeters,
          rangeUncertaintyMeters: options.trackNoiseMeters,
          crossSectionEstimateM2: crossSectionM2,
          crossSectionLogUncertainty: 0.4,
        },
        player.position,
      );
    });
  };
}

/**
 * Le joueur (tourelles TEST_PDC) face à `count` missiles ennemis en dérive qui foncent sur lui
 * depuis 8 km, arrivées simultanées, écartés latéralement pour rester des pistes distinctes.
 */
function buildBench(options: BenchOptions): { world: SimulationWorld; missileIds: string[] } {
  const world = new SimulationWorld(benchScenario(options));
  const enemy = world.getBody("adversaire-1")!;
  const count = options.count ?? 1;
  const missileIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Vector3(8000, (i - (count - 1) / 2) * 400, 0);
    const missile = new Missile({
      id: `missile-${100 + i}`,
      ownerId: enemy.id,
      affiliation: "adversaire",
      position: start,
      velocity: start.clone().normalize().multiplyScalar(-options.speedMps),
      def: enemy.missile,
      assignedTrackId: null,
      hypotheticalTargetWorld: null,
      simTime: 0,
      initialTemperatureK: 250,
    });
    missile.reservoir.quantityKg = 0;
    missile.state = "derive";
    world.missiles.push(missile);
    missileIds.push(missile.id);
  }
  return { world, missileIds };
}

/** Avance jusqu'à `toStep` (ou la fin de tous les objets suivis), mesures comprises. */
function advance(world: SimulationWorld, feed: () => void, toStep: number, targetIds: readonly string[]): void {
  const active = () => targetIds.some((id) => (world.missiles.find((m) => m.id === id) ?? world.decoys.find((d) => d.id === id))?.isActive);
  while (world.stepIndex < toStep && active()) {
    feed();
    world.stepOnce();
  }
}

function runEngagement(options: BenchOptions): { world: SimulationWorld; missileIds: string[] } {
  const bench = buildBench(options);
  advance(bench.world, feedFor(bench.world, options, bench.missileIds), Math.round((8000 / options.speedMps + 3) / FIXED_DT_SECONDS), bench.missileIds);
  return bench;
}

/** Part des missiles abattus sur `runs` engagements indépendants (graines 1..runs). */
function killRate(runs: number, options: Omit<BenchOptions, "seed">): number {
  let killed = 0;
  let total = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const { world, missileIds } = runEngagement({ seed, ...options });
    killed += world.missiles.filter((m) => missileIds.includes(m.id) && m.state === "abattu").length;
    total += missileIds.length;
  }
  return killed / total;
}

// --- Conduite de tir ----------------------------------------------------------------------------

describe("PDC — conduite de tir", () => {
  it("en Auto, prend à partie un missile qui arrive et décompte ses munitions", () => {
    const { world } = runEngagement({ seed: 1, speedMps: 500, trackNoiseMeters: 1 });
    const engagements = world.pdcLog.engagements;
    expect(engagements.length).toBeGreaterThan(0);
    for (const mount of world.playerBody!.pdcMounts) {
      const fired = engagements.filter((e) => e.mountId === mount.id).reduce((s, e) => s + e.roundsFired, 0);
      expect(mount.roundsRemaining).toBe(TEST_PDC.magazineRounds - fired);
    }
    expect(world.events.some((e) => e.category === "pdc" && e.message.includes("feu sur"))).toBe(true);
  });

  it("pas d'obus avant la fin du pointage de la tourelle", () => {
    const options = { seed: 1, speedMps: 500, trackNoiseMeters: 1, mounts: 1 };
    const { world, missileIds } = buildBench(options);
    const feed = feedFor(world, options, missileIds);
    const mount = world.playerBody!.pdcMounts[0];
    let acquiredAt: number | null = null;
    while (world.stepIndex < Math.round(20 / FIXED_DT_SECONDS) && world.pdcLog.engagements.length === 0) {
      feed();
      world.stepOnce();
      if (acquiredAt === null && mount.targetTrackId) acquiredAt = world.simTimeSeconds;
    }
    expect(acquiredAt).not.toBeNull();
    expect(world.pdcLog.engagements[0].firstShotSimTime - acquiredAt!).toBeGreaterThanOrEqual(TEST_PDC.retargetSeconds - 2 * FIXED_DT_SECONDS);
  });

  it("en Arrêt, aucun tir ; en Manuel, seule la piste désignée est prise à partie", () => {
    const off = buildBench({ seed: 2, speedMps: 500, trackNoiseMeters: 1 });
    off.world.playerBody!.pdcCommand.mode = "arret";
    advance(off.world, feedFor(off.world, { seed: 2, speedMps: 500, trackNoiseMeters: 1 }, off.missileIds), 1200, off.missileIds);
    expect(off.world.pdcLog.engagements).toHaveLength(0);

    const options = { seed: 2, speedMps: 500, trackNoiseMeters: 1, count: 2 };
    const manual = buildBench(options);
    const feed = feedFor(manual.world, options, manual.missileIds);
    const player = manual.world.playerBody!;
    feed();
    const designated = player.knowledge.tracks[1].localId;
    player.pdcCommand.mode = "manuel";
    player.pdcCommand.manualTrackId = designated;
    advance(manual.world, feed, 1200, manual.missileIds);
    expect(new Set(manual.world.pdcLog.engagements.map((e) => e.trackId))).toEqual(new Set([designated]));
  });

  it("n'engage pas une piste de vaisseau en Auto", () => {
    const world = new SimulationWorld(benchScenario({ seed: 3, speedMps: 500, trackNoiseMeters: 1 }));
    const player = world.playerBody!;
    // Un « vaisseau probable » qui fonce sur nous : pas une cible de la défense rapprochée en Auto.
    for (let k = 0; k < 30; k++) {
      player.knowledge.ingest(
        { simTime: k * 0.1, sourceSensorId: "radar-1", mode: "radar_active", bearingWorld: new Vector3(0, 0, 1), bearingUncertaintyRad: 1e-4, rangeMeters: 4000 - 50 * k, rangeUncertaintyMeters: 1, crossSectionEstimateM2: 300 },
        player.position,
      );
    }
    for (let i = 0; i < 180; i++) world.stepOnce();
    expect(world.pdcLog.engagements).toHaveLength(0);
  });

  it("vise la piste, jamais la vérité : une piste décalée de 60 m fait passer toutes les rafales à côté", () => {
    const options = { seed: 4, speedMps: 500, trackNoiseMeters: 0.2 };
    const { world, missileIds } = buildBench(options);
    const honest = feedFor(world, options, missileIds);
    const player = world.playerBody!;
    // Mesures fidèles, mais la connaissance croit le missile 60 m plus haut qu'il n'est.
    const biased = () => {
      honest();
      for (const track of player.knowledge.tracks) track.positionEstimateWorld?.add(new Vector3(0, 60, 0));
    };
    advance(world, biased, Math.round(20 / FIXED_DT_SECONDS), missileIds);
    const engagement = world.pdcLog.engagements[0];
    expect(engagement.roundsFired).toBeGreaterThan(100);
    expect(engagement.closestPass!.missDistanceMeters).toBeGreaterThan(40);
    expect(world.missiles.find((m) => m.id === missileIds[0])!.state).not.toBe("abattu");
  });

  it("deux tourelles face à deux missiles simultanés se répartissent les cibles", () => {
    const { world } = runEngagement({ seed: 5, speedMps: 500, trackNoiseMeters: 1, count: 2 });
    const firstTargets = new Map<string, string>();
    for (const e of world.pdcLog.engagements.sort((a, b) => a.firstShotSimTime - b.firstShotSimTime)) {
      if (!firstTargets.has(e.mountId)) firstTargets.set(e.mountId, e.trackId);
    }
    expect(new Set(firstTargets.values()).size).toBe(2);
  });

  it("magasin vide : plus aucun tir, et l'épuisement est annoncé", () => {
    const options = { seed: 6, speedMps: 500, trackNoiseMeters: 1, mounts: 1 };
    const { world, missileIds } = buildBench(options);
    world.playerBody!.pdcMounts[0].roundsRemaining = 30;
    advance(world, feedFor(world, options, missileIds), Math.round(20 / FIXED_DT_SECONDS), missileIds);
    expect(world.playerBody!.pdcMounts[0].roundsRemaining).toBe(0);
    expect(world.pdcLog.engagements.reduce((s, e) => s + e.roundsFired, 0)).toBe(30);
    expect(world.events.some((e) => e.message.includes("munitions épuisées"))).toBe(true);
  });
});

// --- Probabilité d'interception (ATTENDU_PDC.md) ------------------------------------------------

describe("PDC — la probabilité d'interception dépend de la physique et de la connaissance", () => {
  it("baisse quand la vitesse d'arrivée du missile augmente", () => {
    const slow = killRate(16, { speedMps: 500, trackNoiseMeters: 1 });
    const fast = killRate(16, { speedMps: 3000, trackNoiseMeters: 1 });
    expect(slow).toBeGreaterThan(0.5);
    expect(fast).toBeLessThan(slow - 0.2);
  });

  it("baisse quand la piste est moins précise", () => {
    const precise = killRate(16, { speedMps: 800, trackNoiseMeters: 0.5 });
    const coarse = killRate(16, { speedMps: 800, trackNoiseMeters: 15 });
    expect(precise).toBeGreaterThan(0.5);
    expect(coarse).toBeLessThan(precise - 0.2);
  });

  it("baisse quand les missiles sont plus nombreux (saturation)", () => {
    const alone = killRate(12, { speedMps: 800, trackNoiseMeters: 1, count: 1 });
    const salvo = killRate(12, { speedMps: 800, trackNoiseMeters: 1, count: 4 });
    expect(alone).toBeGreaterThan(salvo + 0.15);
  });
});

// --- Effets, sauvegarde, rejeu ------------------------------------------------------------------

describe("PDC — effets, sauvegarde et rejeu", () => {
  it("un leurre léger, classé « missile probable », attire les obus", () => {
    const options = { seed: 7, speedMps: 500, trackNoiseMeters: 1 };
    const world = new SimulationWorld(benchScenario(options));
    const start = new Vector3(8000, 0, 0);
    const decoy = new Decoy({
      id: "leurre-9",
      ownerId: "adversaire-1",
      affiliation: "adversaire",
      position: start,
      velocity: new Vector3(-500, 0, 0),
      def: TEST_DECOY_LIGHT,
      thrustDirectionWorld: new Vector3(-1, 0, 0),
      imitatedAccelerationMps2: 0,
      imitatedPlumeWattsPerSr: 0,
      simTime: 0,
      initialTemperatureK: 250,
    });
    world.decoys.push(decoy);
    advance(world, feedFor(world, options, [decoy.id], 1), Math.round(20 / FIXED_DT_SECONDS), [decoy.id]);
    const engagements = world.pdcLog.engagements;
    expect(engagements.reduce((s, e) => s + e.roundsFired, 0)).toBeGreaterThan(0);
    // Toutes tourelles confondues : 1 − Π(1 − P) sur leurs engagements.
    const survival = engagements.reduce((s, e) => s * (1 - (e.cumulativeKillProbability["leurre-9"] ?? 0)), 1);
    expect(1 - survival).toBeGreaterThan(0.2);
  });

  it("sauvegarder avec des rafales en vol puis reprendre donne exactement l'exécution continue", () => {
    const options = { seed: 8, speedMps: 500, trackNoiseMeters: 1 };
    const continuous = buildBench(options);
    const saveStep = Math.round(12.5 / FIXED_DT_SECONDS);
    const endStep = Math.round(18 / FIXED_DT_SECONDS);
    advance(continuous.world, feedFor(continuous.world, options, continuous.missileIds), saveStep, continuous.missileIds);
    expect(continuous.world.pdcSalvos.length).toBeGreaterThan(0);
    const doc = JSON.parse(JSON.stringify(buildSaveDocument(continuous.world, continuous.world.scenario, "joueur-1", true)));

    advance(continuous.world, feedFor(continuous.world, options, continuous.missileIds), endStep, continuous.missileIds);
    const resumed = restoreWorldFromSave(doc);
    advance(resumed, feedFor(resumed, options, continuous.missileIds), endStep, continuous.missileIds);

    const fingerprint = (w: SimulationWorld) => {
      const state = buildSaveDocument(w, w.scenario, "joueur-1", true).world;
      for (const entry of state.bodies) entry.body.trail = [];
      for (const missile of state.missiles) missile.trail = [];
      return JSON.stringify({ ...state, inputLog: undefined, paused: undefined, speedMultiplier: undefined });
    };
    expect(resumed.stepIndex).toBe(continuous.world.stepIndex);
    expect(fingerprint(resumed)).toBe(fingerprint(continuous.world));
  });

  it("le mode des tourelles est une consigne enregistrée et rejouée", () => {
    const scenario = benchScenario({ seed: 9, speedMps: 500, trackNoiseMeters: 1, mounts: 1 });
    const original = new SimulationWorld(scenario);
    for (let i = 0; i < 120; i++) {
      if (i === 30) original.playerBody!.pdcCommand.mode = "arret";
      if (i === 90) original.playerBody!.pdcCommand.mode = "auto";
      original.stepOnce();
    }
    const modes = original.inputLog.inputs.flatMap((input) => (input.kind === "controls" && "pdc.mode" in input.set ? [input.set["pdc.mode"]] : []));
    expect(modes).toEqual(["arret", "auto"]);
    const replayed = replayInputs(new SimulationWorld(scenario), original.inputLog.inputs, { untilStep: 60 });
    expect(replayed.playerBody!.pdcCommand.mode).toBe("arret");
  });
});
