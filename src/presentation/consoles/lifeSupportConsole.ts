import { LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS, type RigidBody } from "../../sim/rigidBody";
import type { SimulationWorld } from "../../sim/world";
import { el, formatSeconds } from "../dom";
import { deckGroup, hwKey, lamp, meterRow, screen, setLamp, stationShell } from "../station/stationKit";
import type { ConsolePanel } from "./consoleTypes";

const DIAL_RADIUS = 110;
const DIAL_SWEEP_DEG = 270;

function arcPath(fraction: number): string {
  const start = 135;
  const end = start + DIAL_SWEEP_DEG * Math.max(0, Math.min(1, fraction));
  const toXY = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [150 + DIAL_RADIUS * Math.cos(rad), 150 + DIAL_RADIUS * Math.sin(rad)];
  };
  const [x0, y0] = toXY(start);
  const [x1, y1] = toXY(end);
  const large = end - start > 180 ? 1 : 0;
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${DIAL_RADIUS},${DIAL_RADIUS} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

/** Poste Vie (section 8.6, RES-02) — alimentation, autonomie d'urgence, état et cause,
 * accès à Ingénierie. Pas de tableau d'atmosphère ni de métabolisme (hors périmètre). */
export class LifeSupportConsole implements ConsolePanel {
  readonly element: HTMLElement;

  private readonly body: RigidBody;
  private readonly dialArc: SVGPathElement;
  private readonly dialValue: SVGTextElement;
  private readonly dialLabel: SVGTextElement;
  private readonly statusReadout: HTMLElement;
  private readonly autonomyReadout: HTMLElement;
  private readonly autonomyBar: HTMLElement;
  private readonly causeReadout: HTMLElement;
  private readonly powerReadout: HTMLElement;
  private readonly exposureReadout: HTMLElement;
  private readonly exposureBar: HTMLElement;
  private readonly crewStateReadout: HTMLElement;
  private readonly poweredLamp: HTMLElement;
  private readonly backupLamp: HTMLElement;
  private readonly failedLamp: HTMLElement;
  private readonly crewLamp: HTMLElement;

  constructor(world: SimulationWorld, playerBodyId: string, onBack: () => void, onGoToEngineering: () => void) {
    const body = world.getBody(playerBodyId);
    if (!body) throw new Error(`Corps introuvable : ${playerBodyId}`);
    this.body = body;

    const shell = stationShell("05", "Vie", "Support vie · équipage", onBack, "life-station");
    this.element = shell.root;
    this.poweredLamp = lamp("Alimenté", "ok");
    this.backupLamp = lamp("Sur secours", "warning");
    this.failedLamp = lamp("Épuisé", "danger");
    this.crewLamp = lamp("Charge G", "warning");
    shell.lamps.append(this.poweredLamp, this.backupLamp, this.failedLamp, this.crewLamp);

    const dialScreen = screen("Autonomie de secours du support vie", "screen-main screen-dial");
    dialScreen.glass.innerHTML = `
      <svg class="life-dial" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
        <path class="dial-track" d="${arcPath(1)}"/>
        <path class="dial-arc" d="${arcPath(1)}"/>
        ${Array.from({ length: 10 }, (_, i) => {
          const deg = 135 + (DIAL_SWEEP_DEG * i) / 9;
          const rad = (deg * Math.PI) / 180;
          const x0 = 150 + 126 * Math.cos(rad);
          const y0 = 150 + 126 * Math.sin(rad);
          const x1 = 150 + 136 * Math.cos(rad);
          const y1 = 150 + 136 * Math.sin(rad);
          return `<line class="dial-tick" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
        }).join("")}
        <text class="dial-value" x="150" y="160" text-anchor="middle">—</text>
        <text class="dial-label" x="150" y="190" text-anchor="middle">—</text>
      </svg>`;
    const svg = dialScreen.glass.querySelector("svg")!;
    this.dialArc = svg.querySelector(".dial-arc")!;
    this.dialValue = svg.querySelector(".dial-value")!;
    this.dialLabel = svg.querySelector(".dial-label")!;
    this.causeReadout = el("div", "screen-caption screen-caption-top");
    dialScreen.glass.appendChild(this.causeReadout);
    shell.main.appendChild(dialScreen.frame);

    const supply = screen("Alimentation", "screen-grow");
    this.statusReadout = el("div", "screen-line screen-line-big");
    this.powerReadout = el("div", "screen-line");
    this.autonomyReadout = el("span", "screen-meter-value");
    const autonomyTrack = el("div", "g-bar-track");
    this.autonomyBar = el("div", "g-bar-fill");
    autonomyTrack.appendChild(this.autonomyBar);
    supply.glass.append(this.statusReadout, this.powerReadout, meterRow("Autonomie", autonomyTrack, this.autonomyReadout));

    const crew = screen("Équipage");
    this.exposureReadout = el("span", "screen-meter-value");
    const exposureTrack = el("div", "g-bar-track");
    this.exposureBar = el("div", "g-bar-fill");
    exposureTrack.appendChild(this.exposureBar);
    this.crewStateReadout = el("div", "screen-line");
    crew.glass.append(meterRow("Expo. G", exposureTrack, this.exposureReadout), this.crewStateReadout);
    shell.side.append(supply.frame, crew.frame);

    const actionsGroup = deckGroup("Intervention");
    const engineeringButton = hwKey("Ingénierie ▶", "accent");
    engineeringButton.addEventListener("click", onGoToEngineering);
    actionsGroup.append(engineeringButton, el("p", "deck-note", "Une coupure d'alimentation se traite depuis Ingénierie (délestage par priorité)."));
    shell.deck.appendChild(actionsGroup);

    const rulesGroup = deckGroup("Règles de secours");
    rulesGroup.appendChild(
      el(
        "p",
        "deck-note deck-note-wide",
        `Autonomie de ${LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS} s, décomptée seulement pendant une coupure. Le rétablissement fige le compteur sans le recharger. À zéro, le support vie est perdu : fin de mission.`,
      ),
    );
    shell.deck.append(rulesGroup, el("div", "deck-vent"));
  }

  update(): void {
    const body = this.body;
    const shed = body.lastPowerStep?.shedConsumerIds ?? [];
    const lifeConsumers = body.consumers.filter((c) => c.priorityGroup === "vie");
    const lifeSupportShed = shed.some((id) => lifeConsumers.some((c) => c.id === id));
    const fraction = body.lifeSupportRemainingAutonomySeconds / LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS;

    this.statusReadout.textContent = body.lifeSupportFailed ? "HORS SERVICE" : lifeSupportShed ? "COUPÉ — SECOURS" : "Alimenté";
    const nominalKw = lifeConsumers.reduce((sum, c) => sum + c.nominalPowerWatts, 0) / 1000;
    this.powerReadout.textContent = `Demande nominale ${nominalKw.toFixed(0)} kW · ${lifeSupportShed ? "délestée" : "servie"}`;
    this.autonomyReadout.textContent = body.lifeSupportFailed ? "épuisée" : formatSeconds(body.lifeSupportRemainingAutonomySeconds);
    this.autonomyBar.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
    this.autonomyBar.classList.toggle("g-bar-over", fraction < 0.2 || body.lifeSupportFailed);

    this.dialArc.setAttribute("d", arcPath(fraction));
    this.dialArc.classList.toggle("is-critical", lifeSupportShed || body.lifeSupportFailed);
    this.dialValue.textContent = body.lifeSupportFailed ? "00:00" : formatSeconds(body.lifeSupportRemainingAutonomySeconds);
    this.dialLabel.textContent = body.lifeSupportFailed ? "SUPPORT VIE ÉPUISÉ" : lifeSupportShed ? "DÉCOMPTE EN COURS" : "EN RÉSERVE — NOMINAL";

    if (body.lifeSupportFailed) {
      this.causeReadout.textContent = "État CRITIQUE — support vie épuisé.";
    } else if (lifeSupportShed) {
      this.causeReadout.textContent = "État critique — alimentation coupée, autonomie de secours en cours de décompte.";
    } else {
      this.causeReadout.textContent = "État nominal.";
    }
    this.causeReadout.classList.toggle("is-alert", lifeSupportShed || body.lifeSupportFailed);

    const exposure = body.crewExposureFraction;
    this.exposureReadout.textContent = `${(exposure * 100).toFixed(0)} %`;
    this.exposureBar.style.width = `${Math.max(0, Math.min(100, exposure * 100))}%`;
    this.exposureBar.classList.toggle("g-bar-over", exposure > 0.5);
    this.crewStateReadout.textContent = body.crewExposureIncapacitated
      ? "ÉQUIPAGE INCAPACITÉ"
      : exposure > 0.5
        ? "Charge G dangereuse — réduire la poussée"
        : "Équipage apte";

    setLamp(this.poweredLamp, !lifeSupportShed && !body.lifeSupportFailed);
    setLamp(this.backupLamp, lifeSupportShed && !body.lifeSupportFailed);
    setLamp(this.failedLamp, body.lifeSupportFailed);
    setLamp(this.crewLamp, exposure > 0.5 || body.crewExposureIncapacitated);
  }

  resize(): void {}

  dispose(): void {
    this.element.remove();
  }
}
