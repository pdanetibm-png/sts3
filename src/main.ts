import { installBackgroundGuard } from "./presentation/backgroundGuard";
import { renderBriefing } from "./presentation/briefing";
import { renderDebrief } from "./presentation/debrief";
import { el } from "./presentation/dom";
import { LocalSaveStore } from "./presentation/persistence/localSaveStore";
import { SaveController } from "./presentation/persistence/saveController";
import { PerfOverlay } from "./presentation/perfOverlay";
import { renderResumePrompt } from "./presentation/resumePrompt";
import { Ui } from "./presentation/ui";
import { ReplayRecorder } from "./sim/replay";
import { restoreWorldFromSave, type SaveDocument } from "./sim/save";
import { loadScenario, ScenarioValidationError, validateScenario } from "./sim/scenario";
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
// Reflète honnêtement l'état actuel du build : pas encore de séparation "partie réaliste /
// test" au lancement (section 11) — la carte maître reste toujours accessible, donc toute
// sauvegarde de cette version est marquée test.
const TEST_MODE = true;

const localSaveStore = new LocalSaveStore(window.localStorage);

async function main(): Promise<void> {
  const appRoot = document.getElementById("app");
  if (!appRoot) throw new Error("Élément #app introuvable");

  let scenario: ScenarioDefinition;
  try {
    scenario = await loadScenario("/scenarios/demo-duel.json");
  } catch (error) {
    renderFatalError(appRoot, error);
    return;
  }

  const resumable = localSaveStore.readLatestValid();
  if (resumable && resumable.doc.world.missionOutcome === "en_cours") {
    showResumePrompt(appRoot, scenario, resumable.doc);
    return;
  }

  showBriefing(appRoot, scenario);
}

/** Section 10, SAV-01 : sauvegarde valide d'une mission en cours trouvée au démarrage. */
function showResumePrompt(appRoot: HTMLElement, freshScenario: ScenarioDefinition, doc: SaveDocument): void {
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
        showBriefing(appRoot, freshScenario);
      },
    ),
  );
}

/** Briefing → partie → débrief → redémarrage, sans rechargement manuel de l'utilisateur (MIS-01). */
function showBriefing(appRoot: HTMLElement, scenario: ScenarioDefinition): void {
  appRoot.replaceChildren(renderBriefing(scenario, (fleetScenario) => startMission(appRoot, fleetScenario)));
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
  const ui = new Ui(appRoot, world, playerBodyId, saveController, recorder);
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
