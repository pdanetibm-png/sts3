/** Générateur pseudo-aléatoire, callable comme une fonction ordinaire — tous les sites
 * d'appel existants (`rng()`) restent inchangés. `getState()` porte l'état interne courant,
 * pour une sauvegarde/reprise exacte (section 10) sans rejouer la séquence depuis le début. */
export interface SeededRng {
  (): number;
  getState(): number;
}

/**
 * PRNG à graine (mulberry32) — reproductibilité section 7/10 : même graine, mêmes tirages.
 * `initialState` (distinct de `seed`) permet de reprendre une séquence en cours (sauvegarde) ;
 * omis, l'état interne part de `seed` comme avant.
 */
export function createSeededRng(seed: number, initialState?: number): SeededRng {
  let state = (initialState ?? seed) >>> 0;
  const rng = (() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRng;
  rng.getState = () => state;
  return rng;
}
