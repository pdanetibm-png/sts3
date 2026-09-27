import type { ReplayRecorder } from "../sim/replay";
import type { SimulationWorld } from "../sim/world";
import { AppStateStore, type ConsoleId } from "./appState";
import { COMMAND_REFUSED_EVENT } from "./commandGuard";
import type { SuspendCause } from "./backgroundGuard";
import { CrossSectionConsole } from "./consoles/crossSection";
import type { ConsolePanel } from "./consoles/consoleTypes";
import { DetectionConsole } from "./consoles/detectionConsole";
import { EngineeringConsole } from "./consoles/engineeringConsole";
import { LifeSupportConsole } from "./consoles/lifeSupportConsole";
import { MasterMapConsole } from "./consoles/masterMap";
import { PilotConsole } from "./consoles/pilotConsole";
import { TacticalConsole } from "./consoles/tacticalConsole";
import { TimeBanner } from "./consoles/timeBanner";
import { el } from "./dom";
import { downloadReplayExport } from "./diagnosticExport";
import { HelpOverlay } from "./helpOverlay";
import type { SaveController } from "./persistence/saveController";

const POSTE_LABELS: Record<Exclude<ConsoleId, "coupe" | "carte-maitre">, string> = {
  pilotage: "Pilotage",
  detection: "Détection",
  tactique: "Tactique",
  ingenierie: "Ingénierie",
  vie: "Vie",
};

const SHORTCUT_ORDER: ConsoleId[] = ["pilotage", "detection", "tactique", "ingenierie", "vie"];

export class Ui {
  readonly root: HTMLElement;

  private readonly appState = new AppStateStore();
  private readonly consoleSlot: HTMLElement;
  private readonly tabButtons = new Map<ConsoleId, HTMLButtonElement>();
  private readonly panels = new Map<ConsoleId, ConsolePanel>();
  private activePanel: ConsolePanel | null = null;
  private readonly timeBanner: TimeBanner;
  private readonly alertsRow: HTMLElement;
  private readonly alertsText: HTMLElement;
  private readonly journalText: HTMLElement;
  private readonly toastStack: HTMLElement;
  private seenEventCount = 0;
  private readonly world: SimulationWorld;
  private readonly playerBodyId: string;
  private readonly helpOverlay = new HelpOverlay();
  private readonly suspendedBanner: HTMLElement;
  private readonly suspendedResumeButton: HTMLButtonElement;
  private readonly invariantOverlay: HTMLElement;
  private readonly invariantMessage: HTMLElement;
  private readonly invariantStatus: HTMLElement;
  private invariantOverlayShown = false;
  private readonly saveController: SaveController;
  private readonly recorder: ReplayRecorder;

  constructor(container: HTMLElement, world: SimulationWorld, playerBodyId: string, saveController: SaveController, recorder: ReplayRecorder) {
    this.world = world;
    this.recorder = recorder;
    this.playerBodyId = playerBodyId;
    this.saveController = saveController;

    this.root = el("div", "app-root");
    container.appendChild(this.root);

    this.timeBanner = new TimeBanner(
      world,
      saveController,
      () => this.appState.setActiveConsole("coupe"),
      () => this.appState.setActiveConsole("carte-maitre"),
      () => this.helpOverlay.toggle(),
    );
    this.root.appendChild(this.timeBanner.element);

    this.suspendedBanner = el("div", "suspended-banner hidden");
    this.suspendedResumeButton = el("button", "btn", "Reprendre (×1)");
    this.suspendedResumeButton.addEventListener("click", () => this.resumeFromSuspend());
    this.suspendedBanner.append(el("span", undefined, "Simulation suspendue."), this.suspendedResumeButton);
    this.root.appendChild(this.suspendedBanner);

    this.alertsRow = el("div", "alerts-row");
    this.alertsText = el("span", "alerts-text", "Alertes connues : aucune.");
    this.journalText = el("span", "journal-text");
    this.alertsRow.append(this.alertsText, this.journalText);
    this.root.appendChild(this.alertsRow);
    this.toastStack = el("div", "toast-stack");
    this.root.appendChild(this.toastStack);
    // Une reprise de sauvegarde ne rejoue pas les avis déjà connus.
    this.seenEventCount = world.events.length;

    const tabBar = el("div", "console-tabs");
    this.root.appendChild(tabBar);
    const coupeTab = el("button", "tab-button", "Vue vaisseau");
    coupeTab.addEventListener("click", () => this.appState.setActiveConsole("coupe"));
    this.tabButtons.set("coupe", coupeTab);
    tabBar.appendChild(coupeTab);
    for (const id of SHORTCUT_ORDER) {
      const button = el("button", "tab-button", POSTE_LABELS[id as keyof typeof POSTE_LABELS]);
      button.addEventListener("click", () => this.appState.setActiveConsole(id));
      this.tabButtons.set(id, button);
      tabBar.appendChild(button);
    }

    this.consoleSlot = el("div", "console-slot");
    this.root.appendChild(this.consoleSlot);

    this.root.appendChild(this.helpOverlay.element);

    this.invariantOverlay = el("div", "invariant-overlay hidden");
    const invariantPanel = el("div", "invariant-panel");
    invariantPanel.appendChild(el("h2", undefined, "Simulation interrompue"));
    this.invariantMessage = el("p", undefined, "");
    invariantPanel.appendChild(this.invariantMessage);
    invariantPanel.appendChild(
      el("p", "help-text", "Un état numériquement invalide a été détecté ; la simulation reste en pause pour éviter de continuer sur des positions invalides (section 10)."),
    );
    const invariantExportButton = el("button", "btn", "Télécharger le déroulement (.json)");
    this.invariantStatus = el("div", "readout-line");
    invariantExportButton.addEventListener("click", () => downloadReplayExport(this.recorder, this.invariantStatus));
    invariantPanel.append(invariantExportButton, this.invariantStatus);
    this.invariantOverlay.appendChild(invariantPanel);
    this.root.appendChild(this.invariantOverlay);

    this.appState.onChange(() => this.render());
    this.render();

    window.addEventListener("resize", () => this.activePanel?.resize());
    window.addEventListener("keydown", (event) => this.handleKeydown(event));
    window.addEventListener(COMMAND_REFUSED_EVENT, () => this.showCommandRefused());
  }

  private lastRefusalToastMs = Number.NEGATIVE_INFINITY;

  /** TIM-05 : un ordre donné pendant la pause est refusé, jamais mis en file — dit une fois, sans répétition. */
  private showCommandRefused(): void {
    const now = performance.now();
    if (now - this.lastRefusalToastMs < 2000) return;
    this.lastRefusalToastMs = now;
    const toast = el("div", "toast toast-danger");
    toast.append(el("span", "toast-title", "ORDRE REFUSÉ"), el("span", "toast-message", "Simulation suspendue : aucun ordre accepté. Reprenez la simulation pour commander."));
    this.toastStack.appendChild(toast);
    window.setTimeout(() => toast.classList.add("toast-leaving"), 3000);
    window.setTimeout(() => toast.remove(), 3600);
  }

  private resumeFromSuspend(): void {
    this.world.speedMultiplier = 1;
    this.world.paused = false;
    this.suspendedBanner.classList.add("hidden");
  }

  /** Appelé par main.ts (décrochage réel > 2 s, page visible). La mise en arrière-plan ne suspend plus. */
  setSuspended(cause: SuspendCause): void {
    if (cause === null) {
      this.suspendedBanner.classList.add("hidden");
      return;
    }
    (this.suspendedBanner.firstElementChild as HTMLElement).textContent = "Simulation suspendue (retard de traitement détecté).";
    this.suspendedBanner.classList.remove("hidden");
  }

  private handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    if (event.code === "Escape") {
      if (this.helpOverlay.isVisible) {
        this.helpOverlay.hide();
        return;
      }
      this.appState.setActiveConsole("coupe");
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      (document.querySelector(".time-banner .btn") as HTMLButtonElement | null)?.click();
      return;
    }
    const digit = Number(event.key);
    if (digit >= 1 && digit <= 5) {
      this.appState.setActiveConsole(SHORTCUT_ORDER[digit - 1]);
    }
  }

  private getOrCreatePanel(id: ConsoleId): ConsolePanel {
    const existing = this.panels.get(id);
    if (existing) return existing;

    let panel: ConsolePanel;
    switch (id) {
      case "coupe":
        panel = new CrossSectionConsole(this.world, this.playerBodyId, (target) => this.appState.setActiveConsole(target));
        break;
      case "pilotage":
        panel = new PilotConsole(this.world, this.playerBodyId, () => this.appState.setActiveConsole("coupe"));
        break;
      case "carte-maitre":
        panel = new MasterMapConsole(this.world, this.recorder);
        break;
      case "ingenierie":
        panel = new EngineeringConsole(this.world, this.playerBodyId, () => this.appState.setActiveConsole("coupe"));
        break;
      case "detection":
        panel = new DetectionConsole(this.world, this.playerBodyId, () => this.appState.setActiveConsole("coupe"));
        break;
      case "tactique":
        panel = new TacticalConsole(this.world, this.playerBodyId, () => this.appState.setActiveConsole("coupe"));
        break;
      case "vie":
        panel = new LifeSupportConsole(
          this.world,
          this.playerBodyId,
          () => this.appState.setActiveConsole("coupe"),
          () => this.appState.setActiveConsole("ingenierie"),
        );
        break;
    }
    this.panels.set(id, panel);
    return panel;
  }

  private render(): void {
    const activeId = this.appState.get().activeConsole;
    const panel = this.getOrCreatePanel(activeId);

    if (this.activePanel !== panel) {
      this.consoleSlot.replaceChildren(panel.element);
      this.activePanel = panel;
      panel.resize();
    }

    for (const [id, button] of this.tabButtons) {
      button.classList.toggle("tab-active", id === activeId);
    }
  }

  update(realDeltaSeconds: number): void {
    this.timeBanner.update();
    this.activePanel?.update(realDeltaSeconds);
    this.updateAlertsRow();
    this.updateJournal();
    this.saveController.tick(realDeltaSeconds);
    this.updateInvariantOverlay();
  }

  /** Section 10 : état non fini détecté → pause déjà appliquée côté simulation, l'overlay
   * n'a qu'à s'afficher une fois et proposer l'export de diagnostic. */
  private updateInvariantOverlay(): void {
    if (!this.world.invariantViolation || this.invariantOverlayShown) return;
    this.invariantOverlayShown = true;
    this.invariantMessage.textContent = this.world.invariantViolation.message;
    this.invariantOverlay.classList.remove("hidden");
  }

  /** Visible depuis n'importe quel poste (DET-10 : alerte passive reçue depuis un autre poste). */
  private updateAlertsRow(): void {
    const tracks = this.world.getBody(this.playerBodyId)?.knowledge.tracks ?? [];
    if (tracks.length === 0) {
      this.alertsText.textContent = "Alertes connues : aucune.";
      return;
    }
    const mostRecent = tracks.reduce((a, b) => (a.lastObservationSimTime >= b.lastObservationSimTime ? a : b));
    const age = Math.max(0, this.world.simTimeSeconds - mostRecent.lastObservationSimTime);
    this.alertsText.textContent = `Alertes connues : contact ${mostRecent.localId} (${mostRecent.state}) — dernière mesure il y a ${age.toFixed(0)} s.`;
  }

  /**
   * Journal de bord en jeu : dernier événement connu en permanence, et avis bien visible pour
   * les impacts et pertes — sans quoi un coup au but passe inaperçu hors du débrief.
   */
  private updateJournal(): void {
    const events = this.world.events;
    if (events.length === this.seenEventCount) return;
    for (const event of events.slice(this.seenEventCount)) {
      if (event.category === "impact_missile" || event.category === "neutralisation") this.showToast(event.message, toastTone(event.message));
    }
    this.seenEventCount = events.length;
    const last = events[events.length - 1];
    this.journalText.textContent = `Journal t=${last.simTime.toFixed(0)} s · ${last.message}`;
  }

  private showToast(message: string, tone: "success" | "danger"): void {
    const toast = el("div", `toast toast-${tone}`);
    toast.append(el("span", "toast-title", tone === "success" ? "IMPACT CONFIRMÉ" : "PERTE"), el("span", "toast-message", message));
    this.toastStack.appendChild(toast);
    window.setTimeout(() => toast.classList.add("toast-leaving"), 6000);
    window.setTimeout(() => toast.remove(), 6600);
  }
}

/** Un missile du camp qui « atteint sa cible » est un succès ; un vaisseau du camp touché ou hors de combat, une perte. */
function toastTone(message: string): "success" | "danger" {
  return message.includes("a atteint sa cible") ? "success" : "danger";
}
