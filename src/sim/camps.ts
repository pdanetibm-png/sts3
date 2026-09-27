import type { Affiliation } from "./types";

/** Camp bleu = joueur + alliés ; camp rouge = adversaires. */
export type Camp = "bleu" | "rouge";

export function campOf(affiliation: Affiliation): Camp {
  return affiliation === "adversaire" ? "rouge" : "bleu";
}

export function sameCamp(a: Affiliation, b: Affiliation): boolean {
  return campOf(a) === campOf(b);
}
