import { describe, expect, it } from "vitest";
import catalogJson from "../public/catalog/catalogue.json";
import scenarioJson from "../public/scenarios/demo-duel.json";
import { CatalogError, resolveScenario, validateCatalog, type CatalogDocument, type ScenarioFile } from "../src/sim/catalog";
import { buildSaveDocument, restoreWorldFromSave } from "../src/sim/save";
import { validateScenario } from "../src/sim/scenario";
import {
  applyLoadout,
  classForAssembly,
  defaultLoadout,
  loadoutPrice,
  loadoutProblems,
  parseLoadout,
  previewShip,
  shipStats,
  type ShipLoadout,
} from "../src/sim/shipyard";
import { SimulationWorld } from "../src/sim/world";

const catalog = (): CatalogDocument => validateCatalog(JSON.parse(JSON.stringify(catalogJson)));
const scenarioFile = () => JSON.parse(JSON.stringify(scenarioJson)) as ScenarioFile;
const budget = (scenarioJson as { budgetCredits: number }).budgetCredits;
const shipClass = (cat: CatalogDocument, id: string) => cat.shipClasses!.find((c) => c.id === id)!;
const corvette = (cat: CatalogDocument) => defaultLoadout(cat, shipClass(cat, "classe-corvette"));
const enemyOf = (cat: CatalogDocument) => resolveScenario(scenarioFile(), cat).ships.find((s) => s.affiliation === "adversaire")!;

describe("Magasin — classes et configurations d'origine", () => {
  it("chaque classe, telle que livrée, est valide, dans le budget de la démo, et donne un scénario physiquement valide", () => {
    const cat = catalog();
    expect(cat.shipClasses!.map((c) => c.id)).toEqual(["classe-intercepteur", "classe-corvette", "classe-fregate"]);
    for (const shipClass of cat.shipClasses!) {
      const loadout = defaultLoadout(cat, shipClass);
      expect(loadoutProblems(cat, loadout, budget)).toEqual([]);
      expect(() => validateScenario(applyLoadout(cat, scenarioFile(), loadout))).not.toThrow();
    }
  });

  it("la corvette d'origine est exactement le vaisseau du scénario de démo (150 t, même matériel)", () => {
    const cat = catalog();
    expect(classForAssembly(cat, "corvette-classique")!.id).toBe("classe-corvette");
    const fromShop = applyLoadout(cat, scenarioFile(), corvette(cat));
    expect(fromShop).toEqual(resolveScenario(scenarioFile(), cat));
    expect(fromShop.ships[0].structure.dryMassKg).toBe(150000);
  });

  it("masse : la coque plus ses modules ; changer de moteur change la masse de la différence", () => {
    const cat = catalog();
    const base = previewShip(cat, corvette(cat));
    const heavy = previewShip(cat, { ...corvette(cat), engine: "moteur-ntr-6mn" });
    expect(heavy.structure.dryMassKg - base.structure.dryMassKg).toBe(22000 - 12000);
    const classes = Object.fromEntries(cat.shipClasses!.map((c) => [c.id, previewShip(cat, defaultLoadout(cat, c)).structure.dryMassKg]));
    expect(classes["classe-intercepteur"]).toBe(60000);
    expect(classes["classe-fregate"]).toBe(400000);
  });
});

describe("Magasin — prix, budget et limites", () => {
  it("prix : coque, modules, munitions à l'unité", () => {
    const cat = catalog();
    const { lines, total } = loadoutPrice(cat, corvette(cat));
    expect(lines.find((l) => l.label === "Missiles")).toMatchObject({ quantity: 4, unitPrice: 3000 });
    expect(total).toBe(103600);
    expect(loadoutPrice(cat, { ...corvette(cat), missileCount: 5 }).total).toBe(106600);
  });

  it("budget dépassé : refusé, avec le dépassement chiffré", () => {
    const cat = catalog();
    const epstein = { ...corvette(cat), engine: "moteur-epstein-9mn" };
    expect(loadoutProblems(cat, epstein)).toEqual([]);
    expect(loadoutProblems(cat, epstein, budget).join()).toMatch(/Budget dépassé de .*Cr/);
  });

  it("limites de la classe : soute, emplacements de tourelle, réservoir, type de capteur", () => {
    const cat = catalog();
    const base = corvette(cat);
    const broken: ShipLoadout[] = [
      { ...base, missileCount: 7 },
      { ...base, decoyCount: 5 },
      { ...base, decoy: null, decoyCount: 1 },
      { ...base, pdcs: ["pdc-25mm", "pdc-25mm", "pdc-25mm"] },
      { ...base, tank: "reservoir-300t" },
      { ...base, sensors: { ...base.sensors, radar_active: "telescope-ir-30cm" } },
      { ...base, engine: "propulseur-rcs-60kn" },
      { ...base, reactor: "inconnu" },
    ];
    for (const loadout of broken) expect(loadoutProblems(cat, loadout)).not.toEqual([]);
  });

  it("un module sans prix n'est pas en vente", () => {
    const cat = catalog();
    delete cat.components.reactors.find((r) => r.id === "reacteur-1mw")!.price;
    expect(loadoutProblems(cat, { ...corvette(cat), reactor: "reacteur-1mw" }).join()).toMatch(/pas en vente/);
  });

  it("une configuration stockée illisible est écartée", () => {
    expect(parseLoadout(null)).toBeNull();
    expect(parseLoadout({ classId: "classe-corvette" })).toBeNull();
    expect(parseLoadout(JSON.parse(JSON.stringify(corvette(catalog()))))).not.toBeNull();
  });
});

describe("Magasin — caractéristiques", () => {
  it("plus de propergol : plus de delta-v, moins d'accélération ; sans radar, pas de portée radar", () => {
    const cat = catalog();
    const enemy = enemyOf(cat);
    const small = shipStats(previewShip(cat, { ...corvette(cat), tank: "reservoir-60t" }), enemy);
    const big = shipStats(previewShip(cat, corvette(cat)), enemy);
    expect(big.deltaVMps).toBeGreaterThan(small.deltaVMps);
    expect(big.accelerationFullG).toBeLessThan(small.accelerationFullG);
    const deaf = shipStats(previewShip(cat, { ...corvette(cat), sensors: { ...corvette(cat).sensors, radar_active: undefined } }), enemy);
    expect(deaf.radarShipSectorMeters).toBeNull();
    expect(deaf.demandWatts).toBeLessThan(big.demandWatts);
  });

  it("la corvette d'origine : environ 1 G, 6 km/s de delta-v, missile de face vu au radar en secteur à quelques centaines de km", () => {
    const cat = catalog();
    const stats = shipStats(previewShip(cat, corvette(cat)), enemyOf(cat));
    expect(stats.accelerationFullG).toBeGreaterThan(0.9);
    expect(stats.accelerationFullG).toBeLessThan(1.1);
    expect(stats.deltaVMps).toBeGreaterThan(5500);
    expect(stats.radarMissileSectorMeters!).toBeGreaterThan(200000);
    // Un plus gros radar porte plus loin ; une frégate se voit de plus loin qu'un intercepteur.
    const bigRadar = shipStats(previewShip(cat, { ...corvette(cat), sensors: { ...corvette(cat).sensors, radar_active: "radar-x-60kw" } }), enemyOf(cat));
    expect(bigRadar.radarShipSectorMeters!).toBeGreaterThan(stats.radarShipSectorMeters!);
    const seen = (id: string) => shipStats(previewShip(cat, defaultLoadout(cat, shipClass(cat, id))), enemyOf(cat)).seenRadarFrontMeters!;
    expect(seen("classe-fregate")).toBeGreaterThan(seen("classe-intercepteur"));
  });
});

describe("Magasin — partie, sauvegarde", () => {
  it("un vaisseau sur mesure part en mission, et la sauvegarde le restitue à l'identique", () => {
    const cat = catalog();
    const loadout: ShipLoadout = { ...defaultLoadout(cat, shipClass(cat, "classe-intercepteur")), missile: "missile-chimique-leger" };
    const scenario = validateScenario(applyLoadout(cat, scenarioFile(), loadout));
    const player = scenario.ships.find((s) => s.affiliation === "joueur")!;
    expect(player.designName).toBe("Intercepteur sur mesure");
    const world = new SimulationWorld(scenario);
    for (let i = 0; i < 120; i++) world.stepOnce();
    const restored = restoreWorldFromSave(JSON.parse(JSON.stringify(buildSaveDocument(world, scenario, "joueur-1", true))));
    expect(restored.playerBody!.massKg).toBe(world.playerBody!.massKg);
    expect(restored.playerBody!.missile.name).toBe("Missile chimique léger (4 km/s)");
  });

  it("catalogue : une classe dont l'assemblage de base est inconnu est refusée", () => {
    const broken = JSON.parse(JSON.stringify(catalogJson));
    broken.shipClasses[0].baseAssembly = "fantome";
    expect(() => validateCatalog(broken)).toThrow(CatalogError);
  });
});
