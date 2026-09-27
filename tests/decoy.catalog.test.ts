import { describe, expect, it } from "vitest";
import catalogJson from "../public/catalog/catalogue.json";
import scenarioJson from "../public/scenarios/demo-duel.json";
import { CatalogError, resolveScenario, validateCatalog, type ScenarioFile } from "../src/sim/catalog";
import { ScenarioValidationError, validateScenario } from "../src/sim/scenario";
import type { ScenarioDefinition } from "../src/sim/types";
import { buildShipInit, TEST_DECOY, TEST_DOCTRINE } from "./fixtures";

const rawCatalog = () => JSON.parse(JSON.stringify(catalogJson));
const scenarioFile = () => JSON.parse(JSON.stringify(scenarioJson)) as ScenarioFile;

function scenarioWith(overrides: Parameters<typeof buildShipInit>[0]): ScenarioDefinition {
  return {
    version: "test",
    seed: 1,
    objective: "test",
    ships: [buildShipInit({ id: "joueur-1", affiliation: "joueur", ...overrides }), buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [9000, 0, 0] })],
  };
}

function reasonsOf(scenario: ScenarioDefinition): string {
  try {
    validateScenario(scenario);
    return "";
  } catch (error) {
    return (error as ScenarioValidationError).reasons.join(" | ");
  }
}

describe("Leurres — catalogue", () => {
  it("les corvettes de démo emportent 3 leurres à réflecteurs et une doctrine de leurre", () => {
    const resolved = validateScenario(resolveScenario(scenarioFile(), validateCatalog(rawCatalog())));
    for (const ship of resolved.ships) {
      expect(ship.decoyCount).toBe(3);
      expect(ship.decoy?.name).toContain("réflecteurs");
      expect(ship.decoy?.irEmitter?.chargeKg).toBeGreaterThan(0);
      expect(ship.doctrine.decoyThreatSeconds).toBeGreaterThan(0);
    }
  });

  it("un catalogue antérieur aux leurres reste valide (section et champs optionnels)", () => {
    const old = rawCatalog();
    delete old.components.decoys;
    for (const assembly of old.assemblies) delete assembly.decoys;
    const resolved = validateScenario(resolveScenario(scenarioFile(), validateCatalog(old)));
    expect(resolved.ships[0].decoyCount).toBeUndefined();
  });

  it("un assemblage qui cite un leurre inconnu est refusé", () => {
    const broken = rawCatalog();
    broken.assemblies[0].decoys.decoy = "leurre-inexistant";
    expect(() => validateCatalog(broken)).toThrowError(CatalogError);
  });
});

describe("Leurres — validation du scénario", () => {
  it("accepte un vaisseau sans leurre, ou avec une fiche valide", () => {
    expect(reasonsOf(scenarioWith({}))).toBe("");
    expect(reasonsOf(scenarioWith({ decoy: TEST_DECOY, decoyCount: 2 }))).toBe("");
  });

  it("refuse des leurres sans fiche, un stock négatif ou une fiche physiquement invalide", () => {
    expect(reasonsOf(scenarioWith({ decoyCount: 2 }))).toContain("decoy est requis");
    expect(reasonsOf(scenarioWith({ decoy: TEST_DECOY, decoyCount: -1 }))).toContain("decoyCount");
    expect(reasonsOf(scenarioWith({ decoy: { ...TEST_DECOY, maxThrustNewtons: 0 }, decoyCount: 1 }))).toContain("decoy.maxThrustNewtons");
    expect(reasonsOf(scenarioWith({ decoy: { ...TEST_DECOY, irEmitter: { ...TEST_DECOY.irEmitter!, radiantEnergyJoulesPerKg: 0 } }, decoyCount: 1 }))).toContain("irEmitter.radiantEnergyJoulesPerKg");
  });

  it("refuse une doctrine de leurre invalide", () => {
    expect(reasonsOf(scenarioWith({ doctrine: { ...TEST_DOCTRINE, decoyThreatSeconds: 0 } }))).toContain("doctrine.decoyThreatSeconds");
  });
});
