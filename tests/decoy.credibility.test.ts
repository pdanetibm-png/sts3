import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { buildDecoyReport } from "../src/sim/decoyReport";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import type { DecoyDef } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit, TEST_DECOY, TEST_DECOY_LIGHT, TEST_DOCTRINE } from "./fixtures";

/**
 * Crédibilité (ATTENDU_LEURRES.md : « l'ennemi n'est jamais trompé par règle ») : l'adversaire
 * garde ses vrais capteurs, sa fusion de pistes et sa doctrine de tir ; il reste sur place
 * (poussée d'approche nulle) pour que seul le joueur manœuvre. Le joueur suit la tactique visée :
 * prendre un vecteur, larguer, couper ses moteurs.
 */
function playTactic(options: { seed: number; decoy: DecoyDef | null; enemyX: number; armed: boolean; thrustAxis: Vector3 }) {
  const world = new SimulationWorld({
    version: "test",
    seed: options.seed,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], ...(options.decoy ? { decoy: options.decoy, decoyCount: 2 } : {}) }),
      buildShipInit({
        id: "adversaire-1",
        affiliation: "adversaire",
        position: [options.enemyX, 0, 0],
        missileCount: options.armed ? 4 : 0,
        doctrine: { ...TEST_DOCTRINE, approachThrottle: 0 },
      }),
    ],
  });
  const player = world.playerBody!;
  player.attitude.copy(new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), options.thrustAxis));
  player.command.targetAttitude.copy(player.attitude);
  player.command.attitudeHoldEngaged = true;
  player.command.throttle = 0.3;
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / FIXED_DT_SECONDS) && world.missionOutcome === "en_cours"; i++) world.stepOnce();
  };
  run(20);
  if (options.decoy) world.launchPlayerDecoy();
  player.command.throttle = 0;
  return { world, run };
}

describe("Leurres — crédibilité face à un ennemi qui suit le vaisseau au radar", () => {
  // Vecteur pris à 30° de l'axe de la menace : le leurre s'écarte de la route du vaisseau.
  const obliqueAxis = new Vector3(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0);

  it("largué en biais vers l'ennemi, un leurre à réflecteurs reprend la piste du vaisseau et attire ses premiers tirs", () => {
    const baseline = playTactic({ seed: 5, decoy: null, enemyX: 12000, armed: true, thrustAxis: obliqueAxis });
    baseline.run(120);
    const { world, run } = playTactic({ seed: 5, decoy: TEST_DECOY, enemyX: 12000, armed: true, thrustAxis: obliqueAxis });
    run(120);

    const report = buildDecoyReport(world)[0];
    expect(report.enemyTracks.some((t) => t.tookOverFromOwner)).toBe(true);
    expect(report.verdict).toContain("a pris la place du vaisseau");
    // Les deux premiers tirs ennemis partent sur une piste qui suivait le leurre.
    expect(world.trackAttribution.launches.slice(0, 2).map((l) => l.trackSourceAtLaunch)).toEqual(["leurre-1", "leurre-1"]);
    expect(report.missilesDrawn.length).toBeGreaterThanOrEqual(2);
    // Aucun de ces tirs détournés ne touche le vaisseau : il tient plus longtemps qu'en l'absence de leurre.
    expect(baseline.world.missionOutcome).toBe("defaite");
    expect(world.missionEndedSimTime ?? Number.POSITIVE_INFINITY).toBeGreaterThan(baseline.world.missionEndedSimTime!);
  });

  it("un leurre léger, à écho de missile, ne prend pas la place du vaisseau et n'attire aucun tir", () => {
    const baseline = playTactic({ seed: 5, decoy: null, enemyX: 12000, armed: true, thrustAxis: new Vector3(1, 0, 0) });
    baseline.run(120);
    const { world, run } = playTactic({ seed: 5, decoy: TEST_DECOY_LIGHT, enemyX: 12000, armed: true, thrustAxis: new Vector3(1, 0, 0) });
    run(120);

    const report = buildDecoyReport(world)[0];
    expect(report.enemyTracks.some((t) => t.tookOverFromOwner)).toBe(false);
    expect(report.missilesDrawn).toHaveLength(0);
    // Tous les tirs ennemis visent le vaisseau, comme sans leurre.
    expect(world.trackAttribution.launches.length).toBeGreaterThan(0);
    expect(world.trackAttribution.launches.every((l) => l.trackSourceAtLaunch === "joueur-1")).toBe(true);
    expect(baseline.world.trackAttribution.launches.every((l) => l.trackSourceAtLaunch === "joueur-1")).toBe(true);
  });

  it("largué en travers, le leurre à réflecteurs reste un contact « vaisseau probable » distinct aux yeux de l'ennemi", () => {
    for (const seed of [5, 6, 7]) {
      const { world, run } = playTactic({ seed, decoy: TEST_DECOY, enemyX: 6000, armed: false, thrustAxis: new Vector3(0, 1, 0) });
      run(60);
      const enemy = world.getBody("adversaire-1")!;
      const decoyTracks = enemy.knowledge.tracks.filter((t) => world.trackAttribution.currentSource(enemy.id, t.localId) === "leurre-1");
      expect(decoyTracks.length).toBeGreaterThan(0);
      expect(decoyTracks.every((t) => t.classification === "vaisseau probable")).toBe(true);
    }
  });
});
