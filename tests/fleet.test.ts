import { describe, expect, it } from "vitest";
import { buildFleetScenario } from "../src/sim/fleet";
import { validateScenario } from "../src/sim/scenario";
import type { ScenarioDefinition } from "../src/sim/types";
import { buildShipInit } from "./fixtures";

const demo: ScenarioDefinition = {
  version: "test",
  seed: 5,
  objective: "Duel",
  ships: [
    buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [50, 0, 0] }),
    buildShipInit({ id: "adversaire-1", name: "Contact", affiliation: "adversaire", position: [20000, 4000, -2000], velocity: [-10, 5, 0] }),
  ],
};

describe("Composition de flotte (combat N contre M)", () => {
  it("0 allié et 1 ennemi rend le duel du cahier des charges à l'identique", () => {
    expect(buildFleetScenario(demo, { allies: 0, enemies: 1 })).toBe(demo);
  });

  it("produit le bon nombre de vaisseaux par camp, des identifiants uniques et un scénario valide", () => {
    const fleet = buildFleetScenario(demo, { allies: 2, enemies: 3 });
    expect(fleet.ships.filter((s) => s.affiliation === "joueur")).toHaveLength(1);
    expect(fleet.ships.filter((s) => s.affiliation === "allie")).toHaveLength(2);
    expect(fleet.ships.filter((s) => s.affiliation === "adversaire")).toHaveLength(3);
    expect(new Set(fleet.ships.map((s) => s.id)).size).toBe(fleet.ships.length);
    expect(() => validateScenario(fleet)).not.toThrow();
    expect(fleet.objective).toContain("3 contacts hostiles");
  });

  it("aucun vaisseau ne démarre au même endroit qu'un autre", () => {
    const fleet = buildFleetScenario(demo, { allies: 3, enemies: 4 });
    for (let i = 0; i < fleet.ships.length; i++) {
      for (let j = i + 1; j < fleet.ships.length; j++) {
        const [a, b] = [fleet.ships[i].position, fleet.ships[j].position];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(1000);
      }
    }
  });

  it("les alliés reprennent l'équipement du joueur (symétrie conservée)", () => {
    const fleet = buildFleetScenario(demo, { allies: 1, enemies: 1 });
    const player = fleet.ships.find((s) => s.affiliation === "joueur")!;
    const ally = fleet.ships.find((s) => s.affiliation === "allie")!;
    expect(ally.sensors).toEqual(player.sensors);
    expect(ally.missileCount).toBe(player.missileCount);
    expect(ally.reservoir).toEqual(player.reservoir);
  });

  it("les bornes sont appliquées (0–3 alliés, 1–4 ennemis)", () => {
    const fleet = buildFleetScenario(demo, { allies: 9, enemies: 0 });
    expect(fleet.ships.filter((s) => s.affiliation === "allie")).toHaveLength(3);
    expect(fleet.ships.filter((s) => s.affiliation === "adversaire")).toHaveLength(1);
  });
});
