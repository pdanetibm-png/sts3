import { electricalLoads, type ElectricalLoad } from "../../sim/power";
import type { RigidBody } from "../../sim/rigidBody";
import type { SimulationWorld } from "../../sim/world";
import { el } from "../dom";
import { lamp, screen, setLamp, stationShell } from "../station/stationKit";
import type { ConsolePanel } from "./consoleTypes";
import { LifeSupportPanel } from "./lifeSupportPanel";

const SVG_NS = "http://www.w3.org/2000/svg";
const CONSUMER_ROW_HEIGHT = 74;

/** Synoptique réservoir → générateur → bus → consommateurs, batterie en tampon. */
function buildSynopticSvg(consumers: readonly ElectricalLoad[]): string {
  const busTop = 60;
  const busBottom = busTop + (consumers.length - 1) * CONSUMER_ROW_HEIGHT + 40;
  const consumerBoxes = consumers
    .map((consumer, i) => {
      const y = busTop + i * CONSUMER_ROW_HEIGHT;
      return `
      <g class="syn-consumer" data-consumer="${consumer.id}">
        <path class="syn-flow" d="M540,${y + 20} H600"/>
        <rect class="syn-box" x="600" y="${y}" width="250" height="42" rx="4"/>
        <circle class="syn-led" cx="616" cy="${y + 21}" r="5"/>
        <text class="syn-text syn-text-small" x="628" y="${y + 17}">${escapeXml(consumer.label)}</text>
        <text class="syn-sub syn-consumer-state" x="628" y="${y + 33}">${(consumer.nominalPowerWatts / 1000).toFixed(0)} kW</text>
      </g>`;
    })
    .join("");

  return `
<svg class="synoptic" viewBox="0 0 870 ${Math.max(360, busBottom + 30)}" preserveAspectRatio="xMidYMid meet" xmlns="${SVG_NS}">
  <g class="syn-tank">
    <rect class="syn-box" x="20" y="40" width="120" height="200" rx="24"/>
    <rect class="syn-level" x="30" y="50" width="100" height="180" rx="16"/>
    <text class="syn-text" x="80" y="266" text-anchor="middle">PROPERGOL</text>
    <text class="syn-sub syn-tank-value" x="80" y="284" text-anchor="middle">—</text>
  </g>
  <path class="syn-flow syn-fuel-flow" d="M140,140 H230"/>
  <g class="syn-generator">
    <rect class="syn-box" x="230" y="92" width="150" height="96" rx="6"/>
    <circle cx="276" cy="140" r="28" class="syn-rotor-housing"/>
    <g class="syn-rotor"><path d="M276,114 L282,140 L276,166 L270,140 Z M250,140 L276,134 L302,140 L276,146 Z"/></g>
    <text class="syn-text" x="314" y="130">GÉNÉ.</text>
    <text class="syn-sub syn-gen-value" x="314" y="150">—</text>
  </g>
  <path class="syn-flow syn-gen-flow" d="M380,140 H500"/>
  <rect class="syn-bus" x="500" y="${busTop}" width="40" height="${busBottom - busTop}" rx="4"/>
  <text class="syn-sub" x="520" y="${busTop - 10}" text-anchor="middle">BUS</text>
  <g class="syn-battery">
    <rect class="syn-box" x="230" y="248" width="150" height="72" rx="6"/>
    <rect class="syn-cell-track" x="246" y="264" width="80" height="40" rx="3"/>
    <rect class="syn-cell" x="248" y="266" width="76" height="36" rx="2"/>
    <rect class="syn-box" x="326" y="276" width="6" height="16"/>
    <text class="syn-text" x="342" y="278">BATT.</text>
    <text class="syn-sub syn-bat-value" x="342" y="298">—</text>
  </g>
  <path class="syn-flow syn-bat-flow" d="M380,284 H460 V200 H500"/>
  ${consumerBoxes}
</svg>`;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Poste Ingénierie (sections 8.5 et 8.6) — lecture seule : synoptique énergie (réserves, générateur,
 * batterie, consommateurs), bilan de puissance et support vie. Aucune commande, donc pas de pupitre.
 */
export class EngineeringConsole implements ConsolePanel {
  readonly element: HTMLElement;

  private readonly body: RigidBody;
  private readonly svg: SVGSVGElement;
  private readonly massReadout: HTMLElement;
  private readonly missileReadout: HTMLElement;
  private readonly generatorStatusReadout: HTMLElement;
  private readonly powerBalanceReadout: HTMLElement;
  private readonly batteryModeReadout: HTMLElement;
  private readonly lifeSupport: LifeSupportPanel;
  private readonly fuelLimitedLamp: HTMLElement;
  private readonly shedLamp: HTMLElement;
  private readonly lowBatteryLamp: HTMLElement;
  private rotorAngle = 0;

  constructor(world: SimulationWorld, playerBodyId: string) {
    const body = world.getBody(playerBodyId);
    if (!body) throw new Error(`Corps introuvable : ${playerBodyId}`);
    this.body = body;

    const shell = stationShell("04", "Ingénierie", "Énergie · propergol · support vie", "engineering-station");
    this.element = shell.root;
    this.shedLamp = lamp("Délestage", "danger");
    this.lowBatteryLamp = lamp("Batterie basse", "warning");
    this.fuelLimitedLamp = lamp("Génér. limité", "warning");
    this.lifeSupport = new LifeSupportPanel(body);
    shell.lamps.append(this.shedLamp, this.lowBatteryLamp, this.fuelLimitedLamp, this.lifeSupport.lamp);

    // Le synoptique porte déjà les réserves (propergol, batterie) et l'état de chaque consommateur.
    const synoptic = screen("Synoptique énergie", "screen-main screen-synoptic");
    // Consommateurs fixes et capteurs : un radar allumé est une charge comme une autre (section 4.3).
    synoptic.glass.innerHTML = buildSynopticSvg(electricalLoads(body));
    this.svg = synoptic.glass.querySelector("svg")!;
    synoptic.glass.appendChild(el("div", "screen-caption", "Priorités électriques en lecture seule — délestage automatique du moins prioritaire"));
    shell.main.appendChild(synoptic.frame);

    const balance = screen("Bilan de puissance");
    this.generatorStatusReadout = el("div", "screen-line");
    this.powerBalanceReadout = el("div", "screen-line screen-line-big");
    this.batteryModeReadout = el("div", "screen-line screen-line-dim");
    this.massReadout = el("div", "screen-line");
    this.missileReadout = el("div", "screen-line screen-line-dim");
    balance.glass.append(
      this.powerBalanceReadout,
      this.generatorStatusReadout,
      this.batteryModeReadout,
      el("div", "screen-section", "Masse et emport"),
      this.massReadout,
      this.missileReadout,
    );
    shell.side.append(balance.frame, this.lifeSupport.frame);
    shell.deck.remove();
  }

  update(realDeltaSeconds: number): void {
    const body = this.body;
    const power = body.lastPowerStep;

    const fuelFraction = body.reservoir.quantityKg / body.reservoir.capacityKg;
    const batteryFraction = power?.batteryStateOfChargeFraction ?? body.battery.currentChargeWattSeconds / body.battery.capacityWattSeconds;

    const mode: "recharge" | "generateur" | "secours" = !power ? "generateur" : power.batteryFlowWatts > 1 ? "recharge" : power.batteryFlowWatts < -1 ? "secours" : "generateur";
    if (power) {
      const fuelNote = power.generatorFuelLimited ? " — limité par le carburant restant" : "";
      this.generatorStatusReadout.textContent = `Générateur ${(power.generatorOutputWatts / 1000).toFixed(1)} kW${fuelNote}`;
      this.powerBalanceReadout.textContent = `${(power.suppliedWatts / 1000).toFixed(1)} / ${(power.demandWatts / 1000).toFixed(1)} kW`;
      this.batteryModeReadout.textContent = `Fournis / demandés · batterie ${(power.batteryFlowWatts / 1000).toFixed(1)} kW (${mode === "secours" ? "en secours, décharge" : mode === "recharge" ? "en recharge" : "au repos"})`;
    } else {
      this.generatorStatusReadout.textContent = "Générateur : indisponible";
      this.powerBalanceReadout.textContent = "—";
      this.batteryModeReadout.textContent = "Puissance indéterminée";
    }

    this.massReadout.textContent = `Masse ${(body.massKg / 1000).toFixed(1)} t · débit ${(body.lastAllocation?.fuelFlowKgPerSecond ?? 0).toFixed(2)} kg/s`;
    const decoys = body.decoy ? ` · ${body.decoyCount} leurre${body.decoyCount > 1 ? "s" : ""}` : "";
    const pdcRounds = body.pdcMounts.reduce((sum, m) => sum + m.roundsRemaining, 0);
    const pdc = body.pdcMounts.length > 0 ? ` · PDC ${pdcRounds} obus` : "";
    this.missileReadout.textContent = `${body.missileCount} missile${body.missileCount > 1 ? "s" : ""}${decoys}${pdc} en magasin`;

    const shed = new Set(power?.shedConsumerIds ?? []);
    setLamp(this.shedLamp, shed.size > 0);
    setLamp(this.lowBatteryLamp, batteryFraction < 0.2);
    setLamp(this.fuelLimitedLamp, !!power?.generatorFuelLimited);

    this.updateSynoptic(body, fuelFraction, batteryFraction, shed, realDeltaSeconds);
    this.lifeSupport.update();
  }

  private updateSynoptic(body: RigidBody, fuelFraction: number, batteryFraction: number, shed: Set<string>, realDeltaSeconds: number): void {
    const power = body.lastPowerStep;
    const svg = this.svg;
    const level = svg.querySelector<SVGRectElement>(".syn-level")!;
    const levelHeight = 180 * Math.max(0, Math.min(1, fuelFraction));
    level.setAttribute("height", String(levelHeight));
    level.setAttribute("y", String(50 + 180 - levelHeight));
    level.classList.toggle("is-low", fuelFraction < 0.2);
    svg.querySelector(".syn-tank-value")!.textContent = `${body.reservoir.quantityKg.toFixed(0)} kg`;

    const genWatts = power?.generatorOutputWatts ?? 0;
    svg.querySelector(".syn-gen-value")!.textContent = `${(genWatts / 1000).toFixed(1)} kW`;
    const genFraction = genWatts / body.generator.maxPowerWatts;
    this.rotorAngle = (this.rotorAngle + realDeltaSeconds * 720 * genFraction) % 360;
    svg.querySelector(".syn-rotor")!.setAttribute("transform", `rotate(${this.rotorAngle} 276 140)`);
    svg.querySelector(".syn-fuel-flow")!.classList.toggle("is-flowing", genWatts > 1);
    svg.querySelector(".syn-gen-flow")!.classList.toggle("is-flowing", genWatts > 1);

    const cell = svg.querySelector<SVGRectElement>(".syn-cell")!;
    cell.setAttribute("width", String(76 * Math.max(0, Math.min(1, batteryFraction))));
    cell.classList.toggle("is-low", batteryFraction < 0.2);
    svg.querySelector(".syn-bat-value")!.textContent = `${(batteryFraction * 100).toFixed(0)} %`;
    const batFlow = svg.querySelector(".syn-bat-flow")!;
    const flowWatts = power?.batteryFlowWatts ?? 0;
    batFlow.classList.toggle("is-flowing", Math.abs(flowWatts) > 1);
    batFlow.classList.toggle("is-reverse", flowWatts > 1);

    const loads = electricalLoads(body);
    for (const group of svg.querySelectorAll<SVGGElement>(".syn-consumer")) {
      const id = group.dataset.consumer!;
      const isShed = shed.has(id);
      const load = loads.find((c) => c.id === id);
      const active = !!load?.active;
      group.classList.toggle("is-shed", isShed);
      group.querySelector(".syn-flow")!.classList.toggle("is-flowing", active && !isShed);
      const kilowatts = ((load?.nominalPowerWatts ?? 0) / 1000).toFixed(load && load.nominalPowerWatts < 1000 ? 2 : 0);
      group.querySelector(".syn-consumer-state")!.textContent = `${kilowatts} kW · ${isShed ? "DÉLESTÉ" : active ? "alimenté" : "arrêt"}`;
    }
  }

  resize(): void {}

  dispose(): void {
    this.element.remove();
  }
}
