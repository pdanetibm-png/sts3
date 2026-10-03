// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import catalogJson from "../public/catalog/catalogue.json";
import scenarioJson from "../public/scenarios/demo-duel.json";
import { LocalSaveStore, type StorageLike } from "../src/presentation/persistence/localSaveStore";
import { SaveController } from "../src/presentation/persistence/saveController";
import { Ui } from "../src/presentation/ui";
import { resolveScenario, validateCatalog, type ScenarioFile } from "../src/sim/catalog";
import { ReplayRecorder } from "../src/sim/replay";
import { SimulationWorld } from "../src/sim/world";

/**
 * Tests d'interface : chaque poste s'ouvre sur une vraie partie de démo et se met à jour sans
 * erreur, dans un DOM simulé (sans WebGL : les vues 3D affichent alors leur message de repli).
 */

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function demoWorld(): SimulationWorld {
  const catalog = validateCatalog(JSON.parse(JSON.stringify(catalogJson)));
  return new SimulationWorld(resolveScenario(JSON.parse(JSON.stringify(scenarioJson)) as ScenarioFile, catalog));
}

function mount(testMode = false): { ui: Ui; world: SimulationWorld; root: HTMLElement } {
  const world = demoWorld();
  const root = document.createElement("div");
  document.body.appendChild(root);
  const playerId = "joueur-1";
  const saveController = new SaveController(new LocalSaveStore(new MemoryStorage()), world, world.scenario, playerId, testMode);
  const ui = new Ui(root, world, playerId, saveController, new ReplayRecorder(world, playerId, testMode), testMode);
  return { ui, world, root };
}

function press(key: string, code = key): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, code }));
}

/** Avance la simulation et l'affichage ensemble, comme la boucle de main.ts. */
function run(ui: Ui, world: SimulationWorld, steps: number): void {
  for (let i = 0; i < steps; i++) {
    world.stepOnce();
    if (i % 10 === 0) ui.update(1 / 6);
  }
  ui.update(1 / 60);
}

function buttonLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Interface — postes et barre du haut", () => {
  it("quatre postes plus la vue vaisseau, sans bouton Coupe ni carte maître hors mode test", () => {
    const { root } = mount();
    const tabs = [...root.querySelectorAll(".console-tabs .tab-button")].map((b) => b.textContent);
    expect(tabs).toEqual(["Vue vaisseau", "Pilotage", "Détection", "Tactique", "Ingénierie"]);
    const labels = buttonLabels(root);
    expect(labels).not.toContain("Coupe");
    expect(labels.some((l) => l.includes("Carte maître"))).toBe(false);
  });

  it("le mode test propose la carte maître", () => {
    const { root } = mount(true);
    expect(buttonLabels(root).some((l) => l.includes("Carte maître"))).toBe(true);
  });

  it("chaque poste s'ouvre au clavier (1 à 4) et se met à jour, sans bouton de zoom", () => {
    const { ui, world, root } = mount();
    const titles: string[] = [];
    for (const key of ["1", "2", "3", "4"]) {
      press(key);
      run(ui, world, 30);
      titles.push(root.querySelector(".station-title")?.textContent ?? "");
      const labels = buttonLabels(root);
      for (const forbidden of ["−", "+", "Recentrer", "◀ Coupe"]) expect(labels).not.toContain(forbidden);
    }
    expect(titles).toEqual(["PILOTAGE", "DÉTECTION", "TACTIQUE", "INGÉNIERIE"]);
    press("5");
    expect(root.querySelector(".station-title")?.textContent).toBe("INGÉNIERIE");
    press("Escape", "Escape");
    expect(root.querySelector(".station-title")).toBeNull();
  });

  it("abandonner demande un second appui", () => {
    const { world, root } = mount();
    const abandon = [...root.querySelectorAll<HTMLButtonElement>(".time-banner button")].find((b) => b.textContent === "Abandonner")!;
    abandon.click();
    expect(world.missionOutcome).toBe("en_cours");
    abandon.click();
    expect(world.missionOutcome).toBe("abandon");
  });
});

describe("Interface — piste commune et fiche de contact", () => {
  it("une piste choisie en Détection est présélectionnée en Tactique et en Pilotage, avec une fiche lisible", () => {
    const { ui, world, root } = mount();
    const player = world.getBody("joueur-1")!;
    for (const state of player.sensorStates.values()) state.enabled = true;
    // L'adversaire allume son radar dès qu'il a une piste : l'écoute l'entend en quelques dizaines de secondes.
    for (let i = 0; i < 60 * 120 && player.knowledge.tracks.length === 0; i++) world.stepOnce();
    expect(player.knowledge.tracks.length).toBeGreaterThan(0);

    press("2");
    ui.update(1 / 60);
    root.querySelector<HTMLButtonElement>(".track-list .track-row")!.click();
    ui.update(1 / 60);
    const sheet = root.querySelector(".contact-sheet")!.textContent ?? "";
    expect(sheet).toContain("Distance");
    expect(sheet).toMatch(/cap \d{3}°/);
    expect(sheet).not.toContain("radar_passive");
    expect(sheet).not.toMatch(/\[-?\d\.\d\d, /);

    press("3");
    ui.update(1 / 60);
    expect(root.querySelector(".track-row-selected")).not.toBeNull();
    press("1");
    ui.update(1 / 60);
    expect(root.querySelector(".track-row-selected")).not.toBeNull();
    // Une sélection n'est jamais un ordre : le mode de pilotage reste manuel.
    expect(player.command.navMode).toBe("manuel");
  });

  it("Ingénierie montre le support vie, sans cadran tant que l'alimentation tient", () => {
    const { ui, world, root } = mount();
    press("4");
    run(ui, world, 30);
    expect(root.textContent).toContain("Support vie");
    expect(root.querySelector(".life-dial")?.classList.contains("hidden")).toBe(true);
    expect(root.querySelector(".station-deck")).toBeNull();
  });
});
