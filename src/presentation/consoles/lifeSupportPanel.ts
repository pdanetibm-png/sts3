import { LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS, type RigidBody } from "../../sim/rigidBody";
import { el, formatSeconds } from "../dom";
import { lamp, meterRow, screen, setLamp } from "../station/stationKit";

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

/**
 * Support vie (section 8.6, RES-02), écran du poste Ingénierie : alimentation, autonomie de secours
 * et état de l'équipage. Le cadran du décompte n'apparaît que pendant une coupure ; le reste du
 * temps, une ligne suffit. Pas de tableau d'atmosphère ni de métabolisme (hors périmètre).
 */
export class LifeSupportPanel {
  readonly frame: HTMLElement;
  /** Voyant d'en-tête du poste : allumé sur secours ou support vie perdu. */
  readonly lamp: HTMLElement;

  private readonly body: RigidBody;
  private readonly statusReadout: HTMLElement;
  private readonly powerReadout: HTMLElement;
  private readonly autonomyReadout: HTMLElement;
  private readonly autonomyBar: HTMLElement;
  private readonly dial: SVGSVGElement;
  private readonly dialArc: SVGPathElement;
  private readonly dialValue: SVGTextElement;
  private readonly dialLabel: SVGTextElement;
  private readonly crewStateReadout: HTMLElement;

  constructor(body: RigidBody) {
    this.body = body;
    this.lamp = lamp("Support vie", "danger");

    const supply = screen("Support vie", "screen-life");
    this.frame = supply.frame;
    this.statusReadout = el("div", "screen-line screen-line-big");
    this.powerReadout = el("div", "screen-line");
    this.autonomyReadout = el("span", "screen-meter-value");
    const autonomyTrack = el("div", "g-bar-track");
    this.autonomyBar = el("div", "g-bar-fill");
    autonomyTrack.appendChild(this.autonomyBar);
    const autonomyRow = meterRow("Secours", autonomyTrack, this.autonomyReadout);
    autonomyRow.title = `Autonomie de ${LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS} s, décomptée seulement pendant une coupure. Le rétablissement fige le compteur sans le recharger. À zéro, le support vie est perdu : fin de mission.`;

    const dialHost = el("div", "life-dial-host");
    dialHost.innerHTML = `
      <svg class="life-dial" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
        <path class="dial-track" d="${arcPath(1)}"/>
        <path class="dial-arc is-critical" d="${arcPath(1)}"/>
        <text class="dial-value" x="150" y="160" text-anchor="middle">—</text>
        <text class="dial-label" x="150" y="190" text-anchor="middle">—</text>
      </svg>`;
    this.dial = dialHost.querySelector("svg")!;
    this.dialArc = this.dial.querySelector(".dial-arc")!;
    this.dialValue = this.dial.querySelector(".dial-value")!;
    this.dialLabel = this.dial.querySelector(".dial-label")!;

    this.crewStateReadout = el("div", "screen-line");
    supply.glass.append(this.statusReadout, this.powerReadout, autonomyRow, dialHost, this.crewStateReadout);
  }

  update(): void {
    const body = this.body;
    const shed = body.lastPowerStep?.shedConsumerIds ?? [];
    const lifeConsumers = body.consumers.filter((c) => c.priorityGroup === "vie");
    const lifeSupportShed = shed.some((id) => lifeConsumers.some((c) => c.id === id));
    const outage = lifeSupportShed || body.lifeSupportFailed;
    const fraction = body.lifeSupportRemainingAutonomySeconds / LIFE_SUPPORT_EMERGENCY_AUTONOMY_SECONDS;

    this.statusReadout.textContent = body.lifeSupportFailed ? "HORS SERVICE" : lifeSupportShed ? "COUPÉ — SUR SECOURS" : "Alimenté";
    this.statusReadout.classList.toggle("is-alert", outage);
    const nominalKw = lifeConsumers.reduce((sum, c) => sum + c.nominalPowerWatts, 0) / 1000;
    this.powerReadout.textContent = `Demande ${nominalKw.toFixed(0)} kW · ${lifeSupportShed ? "délestée — rétablir l'alimentation" : "servie"}`;
    this.autonomyReadout.textContent = body.lifeSupportFailed ? "épuisée" : formatSeconds(body.lifeSupportRemainingAutonomySeconds);
    this.autonomyBar.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
    this.autonomyBar.classList.toggle("g-bar-over", fraction < 0.2 || body.lifeSupportFailed);

    this.dial.classList.toggle("hidden", !outage);
    if (outage) {
      this.dialArc.setAttribute("d", arcPath(fraction));
      this.dialValue.textContent = body.lifeSupportFailed ? "00:00" : formatSeconds(body.lifeSupportRemainingAutonomySeconds);
      this.dialLabel.textContent = body.lifeSupportFailed ? "SUPPORT VIE ÉPUISÉ" : "DÉCOMPTE EN COURS";
    }

    this.crewStateReadout.textContent = body.crewExposureIncapacitated
      ? "ÉQUIPAGE INCAPACITÉ"
      : body.crewExposureFraction > 0.5
        ? "Charge G dangereuse — réduire la poussée"
        : "Équipage apte";
    this.crewStateReadout.classList.toggle("is-alert", body.crewExposureIncapacitated || body.crewExposureFraction > 0.5);

    setLamp(this.lamp, outage);
  }
}
