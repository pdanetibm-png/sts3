import type { SimulationWorld } from "../sim/world";

/** Événement émis quand un ordre est refusé — l'interface commune l'affiche une fois (ui.ts). */
export const COMMAND_REFUSED_EVENT = "scs:ordre-refuse";

/**
 * TIM-05 : pendant la pause (ou une fois la mission terminée), aucun ordre n'est accepté ni mis
 * en file. L'inspection (sélection de piste, vues, aide) reste libre.
 */
export function commandsLocked(world: SimulationWorld): boolean {
  return world.paused || world.missionOutcome !== "en_cours";
}

/** Refuse l'ordre si la simulation est suspendue, en le signalant ; `true` = refusé. */
export function refuseIfLocked(world: SimulationWorld): boolean {
  if (!commandsLocked(world)) return false;
  window.dispatchEvent(new CustomEvent(COMMAND_REFUSED_EVENT));
  return true;
}
