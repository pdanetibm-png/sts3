export type MissionOutcome =
  | "en_cours"
  | "victoire"
  | "defaite"
  | "neutralisation_mutuelle"
  | "victoire_desarmement"
  | "defaite_desarmement"
  | "match_nul"
  | "echeance"
  | "abandon";

export type MissionEventCategory = "detection" | "lancement" | "perte_missile" | "impact_missile" | "leurre" | "pdc" | "neutralisation" | "verdict";

export interface MissionEvent {
  simTime: number;
  category: MissionEventCategory;
  message: string;
}

/** Section 9.4 : échéance publique — durée cible dépassée sans neutralisation ⇒ issue indécise. */
export const ECHEANCE_SECONDS = 1800;

/**
 * Décide l'issue à partir de l'état constaté en fin de pas, après toutes les neutralisations
 * de ce pas — la simultanéité exacte (MIS-05) est détectée et le résultat ne dépend pas de
 * l'ordre d'itération des corps. Le joueur perdu, c'est la défaite même si des alliés restent.
 */
export function resolveOutcomeFromImpacts(playerDown: boolean, allEnemiesDown: boolean): MissionOutcome | null {
  if (playerDown && allEnemiesDown) return "neutralisation_mutuelle";
  if (allEnemiesDown) return "victoire";
  if (playerDown) return "defaite";
  return null;
}

/**
 * Hors de combat par désarmement (après les neutralisations, qui priment) : un camp qui a
 * épuisé ses missiles — soute vide et plus aucun missile en vol capable de toucher — ne
 * peut plus menacer l'autre. Les deux au même pas : match nul.
 */
export function resolveOutcomeFromDisarmament(blueDisarmed: boolean, redDisarmed: boolean): MissionOutcome | null {
  if (blueDisarmed && redDisarmed) return "match_nul";
  if (redDisarmed) return "victoire_desarmement";
  if (blueDisarmed) return "defaite_desarmement";
  return null;
}

export function outcomeLabel(outcome: MissionOutcome): string {
  switch (outcome) {
    case "victoire":
      return "Victoire — force adverse neutralisée.";
    case "defaite":
      return "Défaite — vaisseau neutralisé.";
    case "neutralisation_mutuelle":
      return "Neutralisation mutuelle — votre vaisseau et le dernier adversaire au même instant.";
    case "victoire_desarmement":
      return "Victoire — la force adverse a épuisé ses missiles et ne peut plus vous menacer.";
    case "defaite_desarmement":
      return "Défaite — votre camp a épuisé ses missiles et ne peut plus menacer l'adversaire.";
    case "match_nul":
      return "Match nul — les deux camps ont épuisé leurs missiles.";
    case "echeance":
      return "Échéance atteinte — objectif non atteint, issue indécise.";
    default:
      return outcome;
  }
}
