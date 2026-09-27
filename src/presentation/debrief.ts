import { buildDecoyReport } from "../sim/decoyReport";
import { pdcEngagementVerdict } from "../sim/pdcLog";
import type { MissionOutcome } from "../sim/mission";
import type { ReplayRecorder } from "../sim/replay";
import type { SimulationWorld } from "../sim/world";
import { downloadReplayExport } from "./diagnosticExport";
import { el, formatSeconds } from "./dom";

const OUTCOME_TITLES: Record<Exclude<MissionOutcome, "en_cours">, string> = {
  victoire: "Victoire",
  defaite: "Défaite",
  neutralisation_mutuelle: "Neutralisation mutuelle",
  victoire_desarmement: "Victoire — adversaire désarmé",
  defaite_desarmement: "Défaite — votre camp est désarmé",
  match_nul: "Match nul — les deux camps désarmés",
  echeance: "Échéance atteinte — issue indécise",
  abandon: "Mission abandonnée",
};

/**
 * Débrief (MIS-01, section 9.4) : motif, chronologie CONNUE du joueur (pas omnisciente, sauf
 * le verdict lui-même — exception explicite de fin de partie), ressources consommées.
 * `recorder` n'est fourni qu'en mode test : l'export contient la vérité des deux camps.
 */
export function renderDebrief(world: SimulationWorld, playerBodyId: string, recorder: ReplayRecorder | null): HTMLElement {
  const overlay = el("div", "debrief-overlay");
  const root = el("div", "debrief-screen");
  overlay.appendChild(root);

  const outcome = world.missionOutcome === "en_cours" ? undefined : world.missionOutcome;
  root.appendChild(el("h1", "briefing-title", outcome ? OUTCOME_TITLES[outcome] : "Mission terminée"));
  root.appendChild(el("p", "briefing-objective", `Temps mission à la fin : ${formatSeconds(world.simTimeSeconds)}`));

  const player = world.getBody(playerBodyId);
  if (player) {
    const summary = el("div", "briefing-ships");
    const card = el("div", "briefing-ship-card");
    card.appendChild(el("h3", undefined, "Ressources consommées"));
    card.appendChild(row("Propergol restant", `${player.reservoir.quantityKg.toFixed(0)} / ${player.reservoir.capacityKg.toFixed(0)} kg`));
    const launched = world.missiles.filter((m) => m.ownerId === playerBodyId).length;
    card.appendChild(row("Missiles tirés", `${launched}`));
    card.appendChild(row("Missiles restants", `${player.missileCount}`));
    if (player.decoy) {
      card.appendChild(row("Leurres largués", `${world.decoys.filter((d) => d.ownerId === playerBodyId).length}`));
      card.appendChild(row("Leurres restants", `${player.decoyCount}`));
    }
    if (player.pdcMounts.length > 0) {
      const left = player.pdcMounts.reduce((sum, m) => sum + m.roundsRemaining, 0);
      const full = player.pdcMounts.reduce((sum, m) => sum + m.def.magazineRounds, 0);
      card.appendChild(row("Obus de PDC tirés", `${full - left} / ${full}`));
    }
    summary.appendChild(card);

    // Bilan de flotte : le verdict de fin est la seule exception d'omniscience (section 9.4).
    const allies = world.bodies.filter((b) => b.affiliation === "allie");
    const enemies = world.bodies.filter((b) => b.affiliation === "adversaire");
    const fleet = el("div", "briefing-ship-card");
    fleet.appendChild(el("h3", undefined, "Bilan de flotte"));
    fleet.appendChild(row("Alliés opérationnels", allies.length > 0 ? `${allies.filter((b) => !b.neutralized).length} / ${allies.length}` : "aucun allié"));
    for (const ally of allies) fleet.appendChild(row(ally.name, ally.neutralized ? "hors de combat" : "opérationnel"));
    fleet.appendChild(row("Ennemis neutralisés", `${enemies.filter((b) => b.neutralized).length} / ${enemies.length}`));
    summary.appendChild(fleet);
    root.appendChild(summary);
  }

  const eventsBlock = el("div", "contact-history");
  eventsBlock.appendChild(el("h4", "block-title", "Chronologie connue"));
  if (world.events.length === 0) {
    eventsBlock.appendChild(el("p", "help-text", "Aucun événement connu."));
  }
  for (const event of world.events) {
    eventsBlock.appendChild(el("div", "contact-history-row", `t=${event.simTime.toFixed(1)}s · ${event.message}`));
  }
  root.appendChild(eventsBlock);

  // Analyse des leurres : vérité interne (qui a suivi quoi), donc seulement en mode test.
  if (recorder && world.decoys.length > 0) {
    const decoyBlock = el("div", "contact-history");
    decoyBlock.appendChild(el("h4", "block-title", "Leurres — analyse (mode test, vérité simulation)"));
    for (const entry of buildDecoyReport(world)) {
      decoyBlock.appendChild(el("div", "contact-history-row", `${entry.decoyId} (${entry.ownerName}, t=${entry.launchedSimTime.toFixed(0)} s) : ${entry.verdict}`));
    }
    root.appendChild(decoyBlock);
  }

  // Analyse des engagements PDC : vérité interne, seulement en mode test.
  const pdcEngagements = world.pdcLog.engagements;
  if (recorder && pdcEngagements.length > 0) {
    const pdcBlock = el("div", "contact-history");
    pdcBlock.appendChild(el("h4", "block-title", "PDC — analyse (mode test, vérité simulation)"));
    for (const engagement of pdcEngagements) pdcBlock.appendChild(el("div", "contact-history-row", pdcEngagementVerdict(engagement)));
    root.appendChild(pdcBlock);
  }

  const buttonRow = el("div", "control-row");
  const replayButton = el("button", "btn btn-danger", "Rejouer (même graine)");
  replayButton.addEventListener("click", () => location.reload());
  const briefingButton = el("button", "btn", "Retour au briefing");
  briefingButton.addEventListener("click", () => location.reload());
  buttonRow.append(replayButton, briefingButton);
  root.appendChild(buttonRow);

  if (recorder) {
    const exportRow = el("div", "control-row");
    const exportStatus = el("span", "readout-line");
    const exportButton = el("button", "btn", "Télécharger le déroulement (.json)");
    exportButton.addEventListener("click", () => downloadReplayExport(recorder, exportStatus));
    exportRow.append(exportButton, exportStatus);
    root.appendChild(exportRow);
  }

  return overlay;
}

function row(label: string, value: string): HTMLElement {
  const line = el("div", "contact-row");
  line.append(el("span", "contact-row-label", label), el("span", "contact-row-value", value));
  return line;
}
