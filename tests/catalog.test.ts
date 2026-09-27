import { describe, expect, it } from "vitest";
import catalogJson from "../public/catalog/catalogue.json";
import scenarioJson from "../public/scenarios/demo-duel.json";
import { CatalogError, resolveScenario, validateCatalog, type ScenarioFile } from "../src/sim/catalog";
import { validateScenario } from "../src/sim/scenario";

const catalog = () => validateCatalog(JSON.parse(JSON.stringify(catalogJson)));
const scenarioFile = () => JSON.parse(JSON.stringify(scenarioJson)) as ScenarioFile;

describe("Catalogue de matériel", () => {
  it("le scénario de démo se résout depuis le catalogue en un scénario physiquement valide", () => {
    const resolved = validateScenario(resolveScenario(scenarioFile(), catalog()));
    const player = resolved.ships.find((s) => s.affiliation === "joueur")!;
    expect(player.designName).toContain("classique");
    expect(player.thrusters.find((t) => t.kind === "principal")!.specificImpulseSeconds).toBe(900);
    expect(player.sensors.map((s) => s.id)).toEqual(["ir-1", "listen-1", "radar-1"]);
    expect(player.crew.gThreshold).toBe(5);
    expect(player.doctrine.maxMissileFlightSeconds).toBeGreaterThan(0);
    expect(player.missile.name).toContain("Missile");
    expect(resolved.deadlineSeconds).toBe(7200);
    expect(resolved.assumptions?.trackLostSeconds).toBe(600);
  });

  it("toutes les familles du catalogue se résolvent et passent la validation", () => {
    const cat = catalog();
    for (const assembly of cat.assemblies) {
      const file = scenarioFile();
      for (const ship of file.ships) ship.assembly = assembly.id;
      expect(() => validateScenario(resolveScenario(file, cat))).not.toThrow();
    }
  });

  it("deux vaisseaux du même assemblage ne partagent jamais d'objet (pas d'effet de bord entre eux)", () => {
    const resolved = resolveScenario(scenarioFile(), catalog());
    expect(resolved.ships[0].reservoir).not.toBe(resolved.ships[1].reservoir);
    expect(resolved.ships[0].thrusters).not.toBe(resolved.ships[1].thrusters);
  });

  it("une référence inconnue est refusée avec un message explicite", () => {
    const broken = JSON.parse(JSON.stringify(catalogJson));
    broken.assemblies[0].reactor = "reacteur-inexistant";
    expect(() => validateCatalog(broken)).toThrowError(CatalogError);
    try {
      validateCatalog(broken);
    } catch (error) {
      expect((error as CatalogError).reasons.join(" ")).toContain("reacteur-inexistant");
    }
  });

  it("un vaisseau de scénario qui cite un assemblage absent est refusé", () => {
    const file = scenarioFile();
    file.ships[0].assembly = "croiseur-fantome";
    expect(() => resolveScenario(file, catalog())).toThrowError(/croiseur-fantome/);
  });

  it("un identifiant de composant dupliqué est refusé", () => {
    const broken = JSON.parse(JSON.stringify(catalogJson));
    broken.components.tanks.push({ ...broken.components.tanks[0] });
    expect(() => validateCatalog(broken)).toThrowError(/dupliqué/);
  });
});
