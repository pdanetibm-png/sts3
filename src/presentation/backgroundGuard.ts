import type { SaveController } from "./persistence/saveController";

export type SuspendCause = "stall" | null;

/** Cadence de relève de la boucle quand requestAnimationFrame ne tourne plus. */
export const BACKGROUND_TICK_MS = 250;

// Minuterie tenue dans un Worker : le navigateur bride les minuteries d'une page masquée
// (1 s, puis 1 min au bout de 5 min sous Chrome), pas celles d'un Worker.
const TICKER_SOURCE = `setInterval(() => postMessage(0), ${BACKGROUND_TICK_MS});`;

export interface BackgroundGuardCallbacks {
  /** La page vient d'être masquée : l'écart jusqu'à la relève suivante appartient à l'arrière-plan. */
  onHidden: () => void;
  /** Relève périodique, qu'il y ait ou non des images : à la boucle de décider s'il faut avancer. */
  onTick: () => void;
}

/**
 * Fenêtre masquée ou couverte : la simulation continue, à la demande du joueur (écart assumé au
 * cahier, TIM-04, qui prévoyait une pause automatique). Le navigateur suspend
 * requestAnimationFrame dans une page masquée ; une minuterie de Worker relève alors la boucle.
 * La mise en arrière-plan déclenche aussi une sauvegarde automatique, au cas où le navigateur
 * fermerait l'onglet.
 */
export function installBackgroundGuard(saveController: SaveController, callbacks: BackgroundGuardCallbacks): () => void {
  const handleVisibilityChange = (): void => {
    if (!document.hidden) return;
    callbacks.onHidden();
    saveController.saveOnSuspend();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  const stopTicker = startTicker(callbacks.onTick);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    stopTicker();
  };
}

function startTicker(onTick: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => onTick();
    return () => worker.terminate();
  } catch {
    // Pas de Worker disponible : minuterie de page, bridée en arrière-plan mais mieux que rien.
    const id = window.setInterval(onTick, BACKGROUND_TICK_MS);
    return () => window.clearInterval(id);
  }
}
