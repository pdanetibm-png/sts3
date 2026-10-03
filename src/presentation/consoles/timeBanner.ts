import type { SaveController } from "../persistence/saveController";
import type { SimulationWorld, TimeMultiplier } from "../../sim/world";
import { el, formatSeconds } from "../dom";

const SPEEDS: TimeMultiplier[] = [1, 10, 100];

/** Bandeau commun (section 8.1) : temps mission, pause, vitesses, objectif, sauvegarde. */
export class TimeBanner {
  readonly element: HTMLElement;

  private readonly world: SimulationWorld;
  private readonly saveController: SaveController;
  private readonly timeReadout: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly saveStatus: HTMLElement;
  private readonly speedButtons: Map<TimeMultiplier, HTMLButtonElement> = new Map();

  constructor(
    world: SimulationWorld,
    saveController: SaveController,
    /** `null` hors mode test : la carte maître (vérité des deux camps) n'est pas proposée. */
    onGoToMasterMap: (() => void) | null,
    onToggleHelp: () => void,
  ) {
    this.world = world;
    this.saveController = saveController;
    this.element = el("div", "time-banner");

    this.timeReadout = el("div", "time-readout", "00:00");
    this.element.appendChild(this.timeReadout);

    this.pauseButton = el("button", "btn", "Pause");
    this.pauseButton.addEventListener("click", () => this.togglePause());
    this.element.appendChild(this.pauseButton);

    const speedGroup = el("div", "speed-group");
    for (const speed of SPEEDS) {
      const button = el("button", "btn btn-small", `×${speed}`);
      button.addEventListener("click", () => {
        this.world.speedMultiplier = speed;
        this.refreshSpeedButtons();
      });
      this.speedButtons.set(speed, button);
      speedGroup.appendChild(button);
    }
    this.element.appendChild(speedGroup);

    this.element.appendChild(el("div", "objective-readout", `Objectif : ${world.objective}`));

    const saveButton = el("button", "btn", "Sauvegarde");
    saveButton.addEventListener("click", () => {
      this.renderSaveStatus(this.saveController.manualSave());
    });
    this.element.appendChild(saveButton);
    this.saveStatus = el("span", "save-status");
    this.element.appendChild(this.saveStatus);

    const spacer = el("div", "banner-spacer");
    this.element.appendChild(spacer);

    const helpButton = el("button", "btn", "Aide (?)");
    helpButton.addEventListener("click", onToggleHelp);
    this.element.appendChild(helpButton);

    // La vue vaisseau a son onglet (et Échap) : pas de bouton « Coupe » en double ici.
    if (onGoToMasterMap) {
      const masterMapButton = el("button", "btn btn-test", "Carte maître (test)");
      masterMapButton.title = "Mode test : vérité simulation complète, jamais disponible en partie normale.";
      masterMapButton.addEventListener("click", onGoToMasterMap);
      this.element.appendChild(masterMapButton);
    }

    // Irréversible : un premier appui arme, un second dans les 4 s confirme.
    const abandonButton = el("button", "btn btn-danger", "Abandonner");
    abandonButton.title = "Fin distincte, sans prétendre à une neutralisation physique (section 9.4).";
    let confirmTimer: number | null = null;
    abandonButton.addEventListener("click", () => {
      if (this.world.missionOutcome !== "en_cours") return;
      if (confirmTimer === null) {
        abandonButton.textContent = "Confirmer l'abandon ?";
        confirmTimer = window.setTimeout(() => {
          abandonButton.textContent = "Abandonner";
          confirmTimer = null;
        }, 4000);
        return;
      }
      window.clearTimeout(confirmTimer);
      confirmTimer = null;
      this.world.missionOutcome = "abandon";
    });
    this.element.appendChild(abandonButton);

    this.refreshSpeedButtons();
  }

  private togglePause(): void {
    this.world.paused = !this.world.paused;
    this.refreshPauseButton();
    // Une suspension volontaire vaut sauvegarde (section 10 : "lors d'une suspension lorsque possible").
    if (this.world.paused) {
      const result = this.saveController.saveOnSuspend();
      if (result.ok) this.renderSaveStatus(result);
    }
  }

  /** Synchronise l'étiquette du bouton avec l'état réel — `world.paused` peut changer sans
   * passer par ce bouton (reprise de sauvegarde, décrochage, § 7/10). */
  private refreshPauseButton(): void {
    this.pauseButton.textContent = this.world.paused ? "Reprendre" : "Pause";
    this.pauseButton.classList.toggle("btn-active", this.world.paused);
  }

  private renderSaveStatus(result: { ok: boolean; reason?: "quota" | "error"; savedAtIso?: string }): void {
    const dateLabel = new Date().toLocaleTimeString();
    if (result.ok) {
      this.saveStatus.textContent = `Sauvegardé à ${dateLabel} (mission ${formatSeconds(this.world.simTimeSeconds)}).`;
      this.saveStatus.classList.remove("save-status-error");
    } else {
      const reason = result.reason === "quota" ? "espace de stockage insuffisant" : "erreur d'écriture";
      this.saveStatus.textContent = `Échec de la sauvegarde (${reason}) à ${dateLabel}.`;
      this.saveStatus.classList.add("save-status-error");
    }
  }

  private refreshSpeedButtons(): void {
    for (const [speed, button] of this.speedButtons) {
      button.classList.toggle("btn-active", speed === this.world.speedMultiplier);
    }
  }

  update(): void {
    this.timeReadout.textContent = `Temps mission : ${formatSeconds(this.world.simTimeSeconds)}`;
    this.refreshPauseButton();
  }
}
