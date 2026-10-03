import { buildFleetScenario, MAX_ALLIES, MAX_ENEMIES, MIN_ENEMIES, type FleetComposition } from "../sim/fleet";
import type { ScenarioDefinition, ShipInitialState } from "../sim/types";
import { el } from "./dom";

const COMPOSITION_STORAGE_KEY = "scs-fleet-composition";

function readStoredComposition(): FleetComposition {
  try {
    const raw = window.localStorage.getItem(COMPOSITION_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<FleetComposition>) : null;
    if (parsed && typeof parsed.allies === "number" && typeof parsed.enemies === "number") {
      return { allies: parsed.allies, enemies: parsed.enemies };
    }
  } catch {
    // Stockage indisponible (navigation privée…) : on repart du duel par défaut.
  }
  return { allies: 0, enemies: 1 };
}

function storeComposition(composition: FleetComposition): void {
  try {
    window.localStorage.setItem(COMPOSITION_STORAGE_KEY, JSON.stringify(composition));
  } catch {
    // Confort seulement : l'échec d'écriture ne bloque jamais le lancement.
  }
}

/** Accès au magasin depuis le briefing (CONCEPTION_MAGASIN.md). */
export interface BriefingShop {
  /** Coût du vaisseau du joueur rapporté au budget, déjà mis en forme. */
  costLabel: string;
  open(): void;
}

/**
 * Écran de briefing (MIS-01) : objectif, composition de la flotte (alliés / ennemis), vaisseau du
 * joueur et réserves initiales. Les alliés reprennent le vaisseau du joueur, les ennemis celui du
 * scénario. Avec un magasin, le vaisseau du joueur s'y modifie.
 */
export function renderBriefing(base: ScenarioDefinition, onStart: (scenario: ScenarioDefinition) => void, shop?: BriefingShop): HTMLElement {
  const composition = readStoredComposition();
  const root = el("div", "briefing-screen");
  root.appendChild(el("h1", "briefing-title", "Briefing de mission"));
  const objective = el("p", "briefing-objective");
  root.appendChild(objective);

  const config = el("div", "fleet-config");
  config.appendChild(el("h3", "fleet-config-title", "Composition de la flotte"));
  const alliesStepper = stepper("Alliés", "fleet-ally", 0, MAX_ALLIES, composition.allies, (value) => update({ ...composition, allies: value }));
  const enemiesStepper = stepper("Ennemis", "fleet-enemy", MIN_ENEMIES, MAX_ENEMIES, composition.enemies, (value) => update({ ...composition, enemies: value }));
  config.append(alliesStepper.element, enemiesStepper.element);
  root.appendChild(config);

  const cards = el("div", "briefing-ships");
  root.appendChild(cards);

  root.appendChild(
    el(
      "p",
      "help-text",
      "Aucune connaissance omnisciente n'est disponible en jeu réaliste. Les contacts se construisent par l'observation ; seuls les alliés sont connus en permanence, par liaison de données.",
    ),
  );

  const startButton = el("button", "btn btn-danger briefing-start", "Commencer");
  startButton.addEventListener("click", () => {
    storeComposition(composition);
    onStart(buildFleetScenario(base, composition));
  });
  root.appendChild(startButton);

  function update(next: FleetComposition): void {
    composition.allies = next.allies;
    composition.enemies = next.enemies;
    render();
  }

  function render(): void {
    const scenario = buildFleetScenario(base, composition);
    objective.textContent = scenario.objective;
    alliesStepper.set(composition.allies);
    enemiesStepper.set(composition.enemies);

    const player = scenario.ships.find((s) => s.affiliation === "joueur");
    const allies = scenario.ships.filter((s) => s.affiliation === "allie");
    const enemies = scenario.ships.filter((s) => s.affiliation === "adversaire");
    cards.replaceChildren();
    if (player) {
      const card = renderShipCard(player, "Votre vaisseau", "briefing-card-own");
      if (shop) {
        card.appendChild(row("Coût", shop.costLabel));
        const shopButton = el("button", "btn briefing-shop", "Magasin : changer de vaisseau…");
        shopButton.addEventListener("click", () => shop.open());
        card.appendChild(shopButton);
      }
      cards.appendChild(card);
    }

    const alliesCard = el("div", "briefing-ship-card briefing-card-ally");
    alliesCard.appendChild(el("h3", undefined, `Alliés : ${allies.length}`));
    alliesCard.appendChild(
      el(
        "p",
        "help-text",
        allies.length > 0
          ? `${allies.map((a) => a.name).join(", ")} — même équipement que vous. Positions connues en permanence (liaison de données), en vert.`
          : "Aucun allié : vous êtes seul.",
      ),
    );
    cards.appendChild(alliesCard);

    const enemiesCard = el("div", "briefing-ship-card briefing-card-enemy");
    enemiesCard.appendChild(el("h3", undefined, `Ennemis : ${enemies.length}`));
    enemiesCard.appendChild(
      el(
        "p",
        "help-text",
        `${enemies[0]?.designName ? `Matériel : ${enemies[0].designName}. ` : ""}Positions inconnues : chaque contact détecté s'affiche en rouge.`,
      ),
    );
    cards.appendChild(enemiesCard);
  }

  render();
  return root;
}

function stepper(
  label: string,
  toneClass: string,
  min: number,
  max: number,
  initial: number,
  onChange: (value: number) => void,
): { element: HTMLElement; set(value: number): void } {
  const element = el("div", `fleet-stepper ${toneClass}`);
  const minus = el("button", "btn btn-small", "−");
  const value = el("span", "fleet-stepper-value", String(initial));
  const plus = el("button", "btn btn-small", "+");
  minus.setAttribute("aria-label", `${label} : moins`);
  plus.setAttribute("aria-label", `${label} : plus`);
  let current = initial;
  minus.addEventListener("click", () => current > min && onChange(current - 1));
  plus.addEventListener("click", () => current < max && onChange(current + 1));
  element.append(el("span", "fleet-stepper-label", label), minus, value, plus);
  return {
    element,
    set(next: number) {
      current = next;
      value.textContent = String(next);
      minus.disabled = next <= min;
      plus.disabled = next >= max;
    },
  };
}

function renderShipCard(ship: ShipInitialState, label: string, extraClass: string): HTMLElement {
  const card = el("div", `briefing-ship-card ${extraClass}`);
  card.appendChild(el("h3", undefined, ship.name));
  card.appendChild(el("p", "help-text", label));
  if (ship.designName) card.appendChild(row("Matériel", ship.designName));
  card.appendChild(row("Seuil équipage", `${ship.crew.gThreshold} G`));
  card.appendChild(row("Propergol", `${ship.reservoir.quantityKg.toFixed(0)} / ${ship.reservoir.capacityKg.toFixed(0)} kg`));
  card.appendChild(row("Missiles", `${ship.missileCount}`));
  if (ship.decoy && ship.decoyCount) card.appendChild(row("Leurres", `${ship.decoyCount} · ${ship.decoy.name ?? "leurre"}`));
  if (ship.pdcs?.length) card.appendChild(row("PDC", `${ship.pdcs.length} × ${ship.pdcs[0].pdc.name ?? "tourelle"}`));
  card.appendChild(row("Capteurs", ship.sensors.map((s) => s.mode).join(", ")));
  return card;
}

function row(label: string, value: string): HTMLElement {
  const line = el("div", "contact-row");
  line.append(el("span", "contact-row-label", label), el("span", "contact-row-value", value));
  return line;
}
