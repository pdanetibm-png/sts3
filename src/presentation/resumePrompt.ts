import type { SaveDocument } from "../sim/save";
import { el, formatSeconds } from "./dom";

/**
 * Écran de reprise (section 10, SAV-01) — affiché avant le briefing si une sauvegarde valide
 * d'une mission en cours existe. « Reprendre » restaure exactement l'état sauvegardé (figé en
 * pause à ×1, jamais de rattrapage) ; « Nouvelle partie » abandonne cette sauvegarde et
 * démarre normalement.
 */
export function renderResumePrompt(doc: SaveDocument, onResume: () => void, onDiscard: () => void): HTMLElement {
  const screen = el("div", "briefing-screen");
  screen.appendChild(el("h1", "briefing-title", "Reprendre la mission en cours ?"));

  const savedDate = new Date(doc.savedAtIso).toLocaleString();
  screen.appendChild(
    el("p", "briefing-objective", `Sauvegardée le ${savedDate} — temps mission ${formatSeconds(doc.world.simTimeSeconds)}.`),
  );
  screen.appendChild(el("p", "briefing-objective", `Objectif : ${doc.scenario.objective}`));
  if (doc.testMode) {
    screen.appendChild(el("p", "help-text", "Cette sauvegarde a été marquée « mode test » — elle le reste."));
  }

  const row = el("div", "briefing-ships");
  const resumeButton = el("button", "btn briefing-start", "Reprendre");
  resumeButton.addEventListener("click", onResume);
  row.appendChild(resumeButton);
  const discardButton = el("button", "btn btn-danger", "Nouvelle partie");
  discardButton.title = "Abandonne cette sauvegarde et démarre une nouvelle mission.";
  discardButton.addEventListener("click", onDiscard);
  row.appendChild(discardButton);
  screen.appendChild(row);

  return screen;
}
