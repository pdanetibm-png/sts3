import { describe, expect, it } from "vitest";
import catalogJson from "../public/catalog/catalogue.json";
import scenarioJson from "../public/scenarios/demo-duel.json";
import { CatalogError, resolveScenario, validateCatalog, type ScenarioFile } from "../src/sim/catalog";
import { ScenarioValidationError, validateScenario } from "../src/sim/scenario";
import type { ScenarioDefinition } from "../src/sim/types";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit, TEST_MISSILE, TEST_PDC } from "./fixtures";

const rawCatalog = () => JSON.parse(JSON.stringify(catalogJson));
const scenarioFile = () => JSON.parse(JSON.stringify(scenarioJson)) as ScenarioFile;

function reasonsOf(scenario: ScenarioDefinition): string {
  try {
    validateScenario(scenario);
    return "";
  } catch (error) {
    return (error as ScenarioValidationError).reasons.join(" | ");
  }
}

function scenarioWith(overrides: Parameters<typeof buildShipInit>[0]): ScenarioDefinition {
  return {
    version: "test",
    seed: 1,
    objective: "test",
    ships: [buildShipInit({ id: "joueur-1", affiliation: "joueur", ...overrides }), buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [9000, 0, 0] })],
  };
}

describe("PDC — catalogue", () => {
  it("les corvettes de démo montent deux tourelles, et leurs missiles ont une surface présentée", () => {
    const resolved = validateScenario(resolveScenario(scenarioFile(), validateCatalog(rawCatalog())));
    for (const ship of resolved.ships) {
      expect(ship.pdcs?.map((m) => m.id)).toEqual(["pdc-dorsale", "pdc-ventrale"]);
      expect(ship.pdcs?.[0].pdc.magazineRounds).toBeGreaterThan(0);
      expect(ship.missile.presentedAreaFrontM2).toBeGreaterThan(0);
      expect(ship.decoy?.presentedAreaFrontM2).toBeGreaterThan(0);
    }
    // Chaque tourelle a son propre magasin, en Auto au départ.
    const world = new SimulationWorld(resolved);
    const player = world.playerBody!;
    expect(player.pdcCommand.mode).toBe("auto");
    expect(player.pdcMounts.map((m) => m.roundsRemaining)).toEqual([3000, 3000]);
  });

  it("un catalogue antérieur aux PDC reste valide", () => {
    const old = rawCatalog();
    delete old.components.pdcs;
    for (const assembly of old.assemblies) delete assembly.pdcs;
    const resolved = validateScenario(resolveScenario(scenarioFile(), validateCatalog(old)));
    expect(resolved.ships[0].pdcs).toBeUndefined();
    expect(new SimulationWorld(resolved).playerBody!.pdcMounts).toHaveLength(0);
  });

  it("un assemblage qui cite une tourelle inconnue est refusé", () => {
    const broken = rawCatalog();
    broken.assemblies[0].pdcs[0].component = "pdc-inexistante";
    expect(() => validateCatalog(broken)).toThrowError(CatalogError);
  });
});

describe("PDC — validation du scénario", () => {
  it("accepte des tourelles valides, refuse des fiches physiquement invalides", () => {
    expect(reasonsOf(scenarioWith({ pdcs: [{ id: "pdc-1", pdc: TEST_PDC }] }))).toBe("");
    expect(reasonsOf(scenarioWith({ pdcs: [{ id: "pdc-1", pdc: { ...TEST_PDC, muzzleVelocityMps: 0 } }] }))).toContain("muzzleVelocityMps");
    expect(reasonsOf(scenarioWith({ pdcs: [{ id: "pdc-1", pdc: { ...TEST_PDC, magazineRounds: 2.5 } }] }))).toContain("magazineRounds");
    expect(reasonsOf(scenarioWith({ pdcs: [{ id: "pdc-1", pdc: TEST_PDC }, { id: "pdc-1", pdc: TEST_PDC }] }))).toContain("dupliqué");
    expect(reasonsOf(scenarioWith({ missile: { ...TEST_MISSILE, presentedAreaFrontM2: -1 } }))).toContain("presentedAreaFrontM2");
  });
});
