import { installBackgroundGuard } from "./presentation/backgroundGuard";
import { renderBriefing, type BriefingShop } from "./presentation/briefing";
import { renderDebrief } from "./presentation/debrief";
import { el } from "./presentation/dom";
import { LocalSaveStore } from "./presentation/persistence/localSaveStore";
import { SaveController } from "./presentation/persistence/saveController";
import { PerfOverlay } from "./presentation/perfOverlay";
import { renderResumePrompt } from "./presentation/resumePrompt";
import { readStoredLoadout, renderShipyard, storeLoadout } from "./presentation/shipyard";
import { Ui } from "./presentation/ui";
import { ReplayRecorder } from "./sim/replay";
import { restoreWorldFromSave, type SaveDocument } from "./sim/save";
import type { CatalogDocument, ScenarioFile } from "./sim/catalog";
import { loadScenarioSources, ScenarioValidationError, validateScenario } from "./sim/scenario";
import { applyLoadout, classForAssembly, defaultLoadout, formatCredits, loadoutPrice, type ShipLoadout } from "./sim/shipyard";
import type { ScenarioDefinition } from "./sim/types";
import { SimulationWorld } from "./sim/world";
import "./style.css";

const MAX_REAL_DELTA_SECONDS = 0.25;
// Page masquée : la relève arrive par à-coups (250 ms, jusqu'à 1 s si le navigateur la bride).
// On l'accepte sans rattraper pour autant un gel complet de la page.
const MAX_BACKGROUND_DELTA_SECONDS = 1;
// Section 7 : "après un retard supérieur à 2 secondes réelles, suspendre avec message".
const STALL_THRESHOLD_SECONDS = 2;
// Au-delà, requestAnimationFrame ne tourne plus (page masquée ou couverte) : la relève prend la main.
const MISSING_FRAMES_SECONDS = 0.2;
// Partie réaliste ou mode test (section 11) : le mode test s'obtient en ouvrant le jeu avec `?test`
// dans l'adresse. Lui seul donne la carte maître, l'analyse du débrief (vérité des deux camps) et
// le téléchargement du déroulement ; toute sauvegarde faite en mode test est marquée comme telle.
const TEST_MODE = new URLSearchParams(window.location.search).has("test");

const localSaveStore = new LocalSaveStore(window.localStorage);

/**
 * Menu de partie : le scénario chargé et, s'il vient d'un catalogue et donne un budget, le magasin
 * où le joueur configure son vaisseau (`loadout` null : le vaisseau du scénario, tel quel).
 */
interface Menu {
  scenario: ScenarioDefinition;
  shop: { catalog: CatalogDocument; file: ScenarioFile; budgetCredits: number } | null;
  loadout: ShipLoadout | null;
}

async function main(): Promise<void> {
  const appRoot = document.getElementById("app");
  if (!appRoot) throw new Error("Élément #app introuvable");

  let menu: Menu;
  try {
    const sources = await loadScenarioSources("/scenarios/demo-duel.json");
    const budgetCredits = sources.file?.budgetCredits;
    const shop =
      sources.catalog && sources.file && budgetCredits !== undefined && sources.catalog.shipClasses?.length
        ? { catalog: sources.catalog, file: sources.file, budgetCredits }
        : null;
    menu = { scenario: sources.scenario, shop, loadout: shop ? readStoredLoadout(shop.catalog, shop.budgetCredits) : null };
  } catch (error) {
    renderFatalError(appRoot, error);
    return;
  }

  const resumable = localSaveStore.readLatestValid();
  if (resumable && resumable.doc.world.missionOutcome === "en_cours") {
    showResumePrompt(appRoot, menu, resumable.doc);
    return;
  }

  showBriefing(appRoot, menu);
}

/** Le scénario, avec le vaisseau du joueur tel que configuré au magasin. */
function menuScenario(menu: Menu): ScenarioDefinition {
  if (!menu.shop || !menu.loadout) return menu.scenario;
  return validateScenario(applyLoadout(menu.shop.catalog, menu.shop.file, menu.loadout));
}

/** Configuration courante : celle du joueur, sinon celle d'origine de la classe du vaisseau du scénario. */
function currentLoadout(menu: Menu): ShipLoadout | null {
  if (!menu.shop) return null;
  if (menu.loadout) return menu.loadout;
  const playerRef = menu.shop.file.ships.find((s) => s.affiliation === "joueur");
  const shipClass = playerRef && classForAssembly(menu.shop.catalog, playerRef.assembly);
  return shipClass ? defaultLoadout(menu.shop.catalog, shipClass) : null;
}

/** Section 10, SAV-01 : sauvegarde valide d'une mission en cours trouvée au démarrage. */
function showResumePrompt(appRoot: HTMLElement, menu: Menu, doc: SaveDocument): void {
  appRoot.replaceChildren(
    renderResumePrompt(
      doc,
      () => {
        try {
          const scenario = validateScenario(doc.scenario);
          const world = restoreWorldFromSave(doc);
          // "Reprise en pause à ×1 ; aucune compensation de durée hors ligne" (section 10) —
          // prime sur les valeurs sérialisées de ces deux champs précis.
          world.paused = true;
          world.speedMultiplier = 1;
          startMission(appRoot, scenario, world);
        } catch (error) {
          renderFatalError(appRoot, error);
        }
      },
      () => {
        localSaveStore.clearAll();
        showBriefing(appRoot, menu);
      },
    ),
  );
}

/** Briefing → partie → débrief → redémarrage, sans rechargement manuel de l'utilisateur (MIS-01). */
function showBriefing(appRoot: HTMLElement, menu: Menu): void {
  let scenario: ScenarioDefinition;
  try {
    scenario = menuScenario(menu);
  } catch (error) {
    renderFatalError(appRoot, error);
    return;
  }
  const loadout = currentLoadout(menu);
  const shop: BriefingShop | undefined =
    menu.shop && loadout
      ? {
          costLabel: `${formatCredits(loadoutPrice(menu.shop.catalog, loadout).total)} sur ${formatCredits(menu.shop.budgetCredits)}`,
          open: () => showShipyard(appRoot, menu, loadout),
        }
      : undefined;
  appRoot.replaceChildren(renderBriefing(scenario, (fleetScenario) => startMission(appRoot, fleetScenario), shop));
  window.scrollTo(0, 0);
}

/** Magasin (CONCEPTION_MAGASIN.md) : la configuration validée est retenue pour les parties suivantes. */
function showShipyard(appRoot: HTMLElement, menu: Menu, initial: ShipLoadout): void {
  const shop = menu.shop!;
  const reference = menu.scenario.ships.find((s) => s.affiliation === "adversaire") ?? menu.scenario.ships[0];
  appRoot.replaceChildren(
    renderShipyard({
      catalog: shop.catalog,
      budgetCredits: shop.budgetCredits,
      reference,
      initial,
      onConfirm: (loadout) => {
        menu.loadout = loadout;
        storeLoadout(loadout);
        showBriefing(appRoot, menu);
      },
      onCancel: () => showBriefing(appRoot, menu),
    }),
  );
  window.scrollTo(0, 0);
}

function startMission(appRoot: HTMLElement, scenario: ScenarioDefinition, restoredWorld?: SimulationWorld): void {
  const world = restoredWorld ?? new SimulationWorld(scenario);
  const playerBody = world.bodies.find((b) => b.affiliation === "joueur");
  if (!playerBody) {
    renderFatalError(appRoot, new Error("Aucun vaisseau d'affiliation « joueur » dans le scénario."));
    return;
  }

  const playerBodyId = playerBody.id;
  const saveController = new SaveController(localSaveStore, world, scenario, playerBodyId, TEST_MODE);
  const recorder = new ReplayRecorder(world, playerBodyId, TEST_MODE);

  appRoot.replaceChildren();
  const ui = new Ui(appRoot, world, playerBodyId, saveController, recorder, TEST_MODE);
  let debriefShown = false;
  let lastTickSeconds = performance.now() / 1000;
  // Vrai si la page a été masquée depuis la dernière avance : l'écart n'est alors pas un décrochage.
  let hiddenSinceLastTick = document.hidden;

  function tick(nowSeconds: number): void {
    const rawDeltaSeconds = Math.max(0, nowSeconds - lastTickSeconds);
    lastTickSeconds = nowSeconds;
    const inBackground = document.hidden || hiddenSinceLastTick;
    hiddenSinceLastTick = document.hidden;

    // Un décrochage ne se signale que sous les yeux du joueur : page masquée, le navigateur a pu
    // la geler, et l'on reprend simplement sans rattrapage.
    if (!inBackground && rawDeltaSeconds > STALL_THRESHOLD_SECONDS && world.missionOutcome === "en_cours" && !world.paused) {
      world.paused = true;
      ui.setSuspended("stall");
    }

    const realDeltaSeconds = Math.min(inBackground ? MAX_BACKGROUND_DELTA_SECONDS : MAX_REAL_DELTA_SECONDS, rawDeltaSeconds);
    world.advance(realDeltaSeconds);
    ui.update(realDeltaSeconds);

    if (!debriefShown && world.missionOutcome !== "en_cours") {
      debriefShown = true;
      removeBackgroundGuard();
      // Une mission terminée n'est jamais "reprenable" (section 10).
      localSaveStore.clearAll();
      appRoot.appendChild(renderDebrief(world, playerBodyId, TEST_MODE ? recorder : null));
    }
  }

  const removeBackgroundGuard = installBackgroundGuard(saveController, {
    onHidden: () => {
      hiddenSinceLastTick = true;
    },
    onTick: () => {
      const nowSeconds = performance.now() / 1000;
      if (nowSeconds - lastTickSeconds >= MISSING_FRAMES_SECONDS) tick(nowSeconds);
    },
  });

  const perfOverlay = new PerfOverlay();
  ui.root.appendChild(perfOverlay.element);

  function frame(timestamp: number): void {
    perfOverlay.sample(timestamp);
    tick(performance.now() / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderFatalError(appRoot: HTMLElement, error: unknown): void {
  const message = error instanceof ScenarioValidationError ? error.message : String(error);
  const box = el("div", "fatal-error");
  box.appendChild(el("h1", undefined, "Chargement du scénario impossible"));
  box.appendChild(el("pre", undefined, message));
  appRoot.replaceChildren(box);
}

main().catch((error) => {
  const appRoot = document.getElementById("app");
  if (appRoot) renderFatalError(appRoot, error);
  else throw error;
});
