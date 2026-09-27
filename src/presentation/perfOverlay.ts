import { el } from "./dom";

const SAMPLE_WINDOW_SIZE = 90;

/**
 * Outil de vérification PERF-01 — FPS médian glissant, exploitable par les outils navigateur
 * (lecture DOM) plutôt qu'un chronométrage manuel. N'affecte jamais la simulation elle-même
 * (rendu seulement), discret en coin d'écran.
 */
export class PerfOverlay {
  readonly element: HTMLElement;
  private readonly frameTimesMs: number[] = [];
  private lastTimestamp: number | null = null;

  constructor() {
    this.element = el("div", "perf-overlay", "FPS : —");
  }

  /** À appeler une fois par frame de rendu (`requestAnimationFrame`), avec le timestamp brut. */
  sample(timestamp: number): void {
    if (this.lastTimestamp !== null) {
      this.frameTimesMs.push(timestamp - this.lastTimestamp);
      if (this.frameTimesMs.length > SAMPLE_WINDOW_SIZE) this.frameTimesMs.shift();
    }
    this.lastTimestamp = timestamp;

    if (this.frameTimesMs.length < 5) return;
    const sorted = [...this.frameTimesMs].sort((a, b) => a - b);
    const medianMs = sorted[Math.floor(sorted.length / 2)];
    const medianFps = medianMs > 0 ? 1000 / medianMs : 0;
    this.element.textContent = `FPS médian (${this.frameTimesMs.length} éch.) : ${medianFps.toFixed(1)}`;
  }
}
