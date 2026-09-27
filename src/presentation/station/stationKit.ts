import { el } from "../dom";

/**
 * Éléments « matériels » communs aux postes : coque de console, écrans encastrés, touches,
 * interrupteurs, levier. Purement présentationnel — chaque poste garde sa logique.
 */

export interface StationShell {
  root: HTMLElement;
  /** Zone principale (écran large), à gauche. */
  main: HTMLElement;
  /** Colonne d'écrans secondaires, à droite. */
  side: HTMLElement;
  /** Pupitre de commandes, en bas. */
  deck: HTMLElement;
  /** Voyants d'état dans l'en-tête. */
  lamps: HTMLElement;
}

export function stationShell(number: string, title: string, subtitle: string, onBack: () => void, extraClass = ""): StationShell {
  const root = el("div", `console station ${extraClass}`.trim());

  const header = el("div", "station-header");
  const plate = el("div", "station-plate");
  plate.append(el("span", "station-number", number), el("span", "station-title", title.toUpperCase()), el("span", "station-subtitle", subtitle));
  const lamps = el("div", "station-lamps");
  const back = hwKey("◀ Coupe", "neutral");
  back.title = "Retour à la vue vaisseau (Échap)";
  back.addEventListener("click", onBack);
  header.append(screw(), plate, lamps, back, screw());
  root.appendChild(header);

  const main = el("div", "station-main");
  const side = el("div", "station-side");
  const deck = el("div", "station-deck");
  root.append(main, side, deck);
  return { root, main, side, deck, lamps };
}

function screw(): HTMLElement {
  return el("span", "screw");
}

export interface Screen {
  frame: HTMLElement;
  glass: HTMLElement;
}

/** Écran encastré dans un cadre métallique, avec plaque de titre gravée. */
export function screen(title: string, extraClass = ""): Screen {
  const frame = el("div", `screen ${extraClass}`.trim());
  frame.appendChild(el("div", "screen-title", title));
  const glass = el("div", "screen-glass");
  frame.appendChild(glass);
  return { frame, glass };
}

export type KeyVariant = "neutral" | "accent" | "danger" | "warning";

export function hwKey(label: string, variant: KeyVariant = "neutral"): HTMLButtonElement {
  const key = el("button", `hw-key hw-key-${variant}`);
  key.type = "button";
  key.appendChild(el("span", "hw-key-cap", label));
  return key;
}

/** Interrupteur à bascule avec voyant — un `<input type=checkbox>` stylé, donc accessible. */
export function hwToggle(label: string): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = el("label", "hw-toggle");
  const input = el("input");
  input.type = "checkbox";
  wrapper.append(input, el("span", "hw-toggle-body"), el("span", "hw-toggle-label", label));
  return { wrapper, input };
}

/** Groupe de commandes du pupitre, avec intitulé gravé. */
export function deckGroup(title: string, extraClass = ""): HTMLElement {
  const group = el("div", `deck-group ${extraClass}`.trim());
  group.appendChild(el("div", "deck-group-title", title));
  return group;
}

/** Voyant d'alarme de l'en-tête : allumé = état signalé. */
export function lamp(label: string, tone: "ok" | "info" | "warning" | "danger"): HTMLElement {
  const node = el("div", `hw-lamp hw-lamp-${tone}`);
  node.append(el("span", "hw-lamp-bulb"), el("span", "hw-lamp-label", label));
  return node;
}

export function setLamp(node: HTMLElement, lit: boolean): void {
  node.classList.toggle("hw-lamp-lit", lit);
}

/** Ligne d'instrument « libellé · jauge · valeur » d'un écran. */
export function meterRow(label: string, bar: HTMLElement, value: HTMLElement): HTMLElement {
  const row = el("div", "screen-meter");
  value.classList.add("screen-meter-value");
  row.append(el("span", "screen-label", label), bar, value);
  return row;
}

export function lcdInput(value: string): HTMLInputElement {
  const input = el("input", "lcd lcd-input");
  input.type = "number";
  input.value = value;
  return input;
}

export function deckField(label: string, control: HTMLElement): HTMLLabelElement {
  const field = el("label", "deck-field");
  field.append(el("span", "deck-label", label), control);
  return field;
}
