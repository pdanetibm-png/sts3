import type { ReplayRecorder } from "../sim/replay";

/**
 * Télécharge le déroulement complet de la partie (.json) — partagé entre la carte maître,
 * l'overlay d'erreur (section 10 : « export de diagnostic proposé ») et le débrief.
 */
export function downloadReplayExport(recorder: ReplayRecorder, statusEl: HTMLElement | null): void {
  try {
    const exported = recorder.buildExport();
    const json = JSON.stringify(exported);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const link = document.createElement("a");
    link.href = url;
    link.download = `scs-deroulement-${exported.seed}-t${Math.round(exported.finalSimTime)}s-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    if (statusEl) {
      const sizeKb = Math.round(json.length / 1024);
      statusEl.textContent = `Fichier téléchargé (${sizeKb} Ko, ${exported.inputs.length} entrées, ${exported.keyframes.length} instantanés).`;
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = `Échec de l'export : ${String(error)}`;
  }
}
