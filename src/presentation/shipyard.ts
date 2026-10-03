import type { CatalogDocument, ShipClass } from "../sim/catalog";
import {
  defaultLoadout,
  formatCredits,
  loadoutPrice,
  loadoutProblems,
  parseLoadout,
  previewShip,
  SENSOR_ROLE_LABELS,
  SENSOR_ROLES,
  shipStats,
  type SensorRole,
  type ShipLoadout,
  type ShipStats,
} from "../sim/shipyard";
import { STANDARD_GRAVITY } from "../sim/thrusters";
import type { ShipInitialState } from "../sim/types";
import { el } from "./dom";

/**
 * Magasin de vaisseau (CONCEPTION_MAGASIN.md), ouvert depuis le briefing : choix de la classe,
 * des modules et des munitions, dans la limite du budget du scénario. Les caractéristiques sont
 * recalculées à chaque choix avec les lois de la simulation, et comparées à la configuration
 * d'entrée.
 */

const LOADOUT_STORAGE_KEY = "scs-ship-loadout";

/** Configuration retenue par le joueur, si elle est lisible et encore valide pour ce catalogue et ce budget. */
export function readStoredLoadout(catalog: CatalogDocument, budgetCredits: number): ShipLoadout | null {
  try {
    const raw = window.localStorage.getItem(LOADOUT_STORAGE_KEY);
    const loadout = raw ? parseLoadout(JSON.parse(raw)) : null;
    return loadout && loadoutProblems(catalog, loadout, budgetCredits).length === 0 ? loadout : null;
  } catch {
    // Stockage indisponible ou contenu illisible : on repart du vaisseau du scénario.
    return null;
  }
}

export function storeLoadout(loadout: ShipLoadout | null): void {
  try {
    if (loadout) window.localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(loadout));
    else window.localStorage.removeItem(LOADOUT_STORAGE_KEY);
  } catch {
    // Confort seulement : la partie se lance quand même avec la configuration en mémoire.
  }
}

export interface ShipyardOptions {
  catalog: CatalogDocument;
  budgetCredits: number;
  /** Vaisseau contre lequel se mesurent portées et discrétion (l'adversaire du scénario). */
  reference: ShipInitialState;
  initial: ShipLoadout;
  onConfirm(loadout: ShipLoadout): void;
  onCancel(): void;
}

// --- Mise en forme -----------------------------------------------------------------------------

const fr = (value: number, digits = 0) => value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function formatDistance(meters: number): string {
  const km = meters / 1000;
  if (km >= 100) return `${fr(km)} km`;
  if (km >= 1) return `${fr(km, 1)} km`;
  return `${fr(meters)} m`;
}

const formatMass = (kg: number) => (kg >= 10000 ? `${fr(kg / 1000)} t` : kg >= 1000 ? `${fr(kg / 1000, 1)} t` : `${fr(kg)} kg`);
const formatPower = (watts: number) => (watts >= 1e6 ? `${fr(watts / 1e6, 2)} MW` : `${fr(watts / 1000)} kW`);
const formatThrust = (newtons: number) => (newtons >= 1e6 ? `${fr(newtons / 1e6, 1)} MN` : `${fr(newtons / 1000)} kN`);
const formatSpeed = (mps: number) => `${fr(mps / 1000, mps >= 100000 ? 0 : 1)} km/s`;
const formatDuration = (seconds: number) => (seconds >= 7200 ? `${fr(seconds / 3600)} h` : seconds >= 120 ? `${fr(seconds / 60)} min` : `${fr(seconds)} s`);

// --- Caractéristiques affichées ----------------------------------------------------------------

interface StatRow {
  label: string;
  value(stats: ShipStats): number | null;
  format(value: number, stats: ShipStats): string;
  /** +1 : plus c'est grand, mieux c'est ; −1 : l'inverse ; 0 : ni l'un ni l'autre. */
  better: 1 | -1 | 0;
  hint?: string;
}

const STAT_GROUPS: { title: string; note?: string; rows: StatRow[] }[] = [
  {
    title: "Propulsion",
    rows: [
      { label: "Masse, plein fait", value: (s) => s.fullMassKg, format: formatMass, better: 0 },
      { label: "Poussée", value: (s) => s.thrustNewtons, format: (v, s) => `${formatThrust(v)} · Isp ${fr(s.specificImpulseSeconds)} s`, better: 1 },
      {
        label: "Accélération, plein fait",
        value: (s) => s.accelerationFullG,
        format: (v, s) => `${fr(v, 2)} G${v > s.crewLimitG ? ` (équipage : ${fr(s.crewLimitG)} G)` : ""}`,
        better: 1,
      },
      { label: "Accélération, réservoir vide", value: (s) => s.accelerationDryG, format: (v, s) => `${fr(v, 2)} G${v > s.crewLimitG ? ` (équipage : ${fr(s.crewLimitG)} G)` : ""}`, better: 1 },
      { label: "Delta-v", value: (s) => s.deltaVMps, format: formatSpeed, better: 1 },
      { label: "Poussée continue", value: (s) => s.burnSeconds, format: formatDuration, better: 1, hint: "à pleine puissance, réservoir plein" },
    ],
  },
  {
    title: "Énergie",
    rows: [
      { label: "Réacteur", value: (s) => s.reactorWatts, format: formatPower, better: 1 },
      { label: "Demande, tout allumé", value: (s) => s.demandWatts, format: formatPower, better: -1 },
      { label: "Marge", value: (s) => s.reactorWatts - s.demandWatts, format: (v) => (v < 0 ? `déficit ${formatPower(-v)}` : formatPower(v)), better: 1 },
    ],
  },
  {
    title: "Détection",
    note: "Portées à 50 % de détection contre le vaisseau adverse du scénario.",
    rows: [
      { label: "Radar en secteur, vaisseau de face", value: (s) => s.radarShipSectorMeters, format: formatDistance, better: 1 },
      { label: "Radar, ciel entier", value: (s) => s.radarShipFullSkyMeters, format: formatDistance, better: 1 },
      { label: "Radar en secteur, missile de face", value: (s) => s.radarMissileSectorMeters, format: formatDistance, better: 1 },
      { label: "IR, vaisseau moteurs coupés", value: (s) => s.infraredShipMeters, format: formatDistance, better: 1 },
      { label: "Écoute du radar adverse", value: (s) => s.listenMainBeamMeters, format: formatDistance, better: 1, hint: "dans son faisceau" },
    ],
  },
  {
    title: "Discrétion",
    note: "Distance à laquelle les capteurs adverses vous voient : plus c'est court, mieux c'est.",
    rows: [
      { label: "IR, moteurs coupés", value: (s) => s.seenInfraredColdMeters, format: formatDistance, better: -1 },
      { label: "IR, en poussée, vu de l'arrière", value: (s) => s.seenInfraredThrustingMeters, format: formatDistance, better: -1 },
      { label: "Radar en secteur, de face", value: (s) => s.seenRadarFrontMeters, format: formatDistance, better: -1 },
    ],
  },
  {
    title: "Armement",
    rows: [
      { label: "Missiles", value: (s) => s.missileCount, format: (v, s) => (v > 0 ? `${v} × ${s.missileName}` : "aucun"), better: 1 },
      { label: "Delta-v d'un missile", value: (s) => (s.missileCount > 0 ? s.missileDeltaVMps : null), format: formatSpeed, better: 1 },
      { label: "Portée d'engagement", value: (s) => (s.missileCount > 0 ? s.missileReachMeters : null), format: formatDistance, better: 1, hint: "distance couverte dans le temps de vol accepté par la doctrine" },
      { label: "Leurres", value: (s) => s.decoyCount, format: (v, s) => (v > 0 ? `${v} × ${s.decoyName}` : "aucun"), better: 1 },
      { label: "Tourelles PDC", value: (s) => s.pdcCount, format: (v, s) => (v > 0 ? `${v} · ${fr(s.pdcRounds)} coups` : "aucune"), better: 1 },
      { label: "Portée des tourelles", value: (s) => (s.pdcCount > 0 ? s.pdcMaxRangeMeters : null), format: formatDistance, better: 1 },
    ],
  },
];

function deltaBadge(row: StatRow, now: number | null, before: number | null): HTMLElement | null {
  if (now === null && before === null) return null;
  if (now === null || before === null) return el("span", "shipyard-delta shipyard-delta-change", now === null ? "retiré" : "nouveau");
  const diff = now - before;
  if (Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(before))) return null;
  const relative = before !== 0 ? diff / Math.abs(before) : 0;
  if (before !== 0 && Math.abs(relative) < 0.005) return null;
  const tone = row.better === 0 ? "shipyard-delta-change" : Math.sign(diff) === row.better ? "shipyard-delta-good" : "shipyard-delta-bad";
  // Au-delà du double, un facteur se lit mieux qu'un pourcentage (un moteur Epstein multiplie le delta-v par mille).
  const ratio = before !== 0 ? now / before : 0;
  const text = before === 0 ? (diff > 0 ? "▲" : "▼") : ratio >= 2 ? `×${fr(ratio, ratio < 10 ? 1 : 0)}` : `${diff > 0 ? "+" : "−"}${fr(Math.abs(relative) * 100)} %`;
  return el("span", `shipyard-delta ${tone}`, text);
}

// --- Écran ------------------------------------------------------------------------------------

export function renderShipyard(options: ShipyardOptions): HTMLElement {
  const { catalog, budgetCredits, reference } = options;
  const c = catalog.components;
  const classes = catalog.shipClasses ?? [];
  let loadout: ShipLoadout = JSON.parse(JSON.stringify(options.initial));
  const initialStats = shipStats(previewShip(catalog, options.initial), reference);

  const root = el("div", "shipyard-screen");
  const header = el("header", "shipyard-header");
  const title = el("div", "shipyard-title");
  title.append(el("h1", undefined, "Magasin"), el("p", "shipyard-subtitle", "Choisissez une classe de vaisseau, puis ses modules. Les écarts sont donnés par rapport à la configuration d'entrée."));
  const budgetBox = el("div", "shipyard-budget");
  header.append(title, budgetBox);

  const body = el("div", "shipyard-body");
  const classColumn = el("section", "shipyard-column shipyard-classes");
  const moduleColumn = el("section", "shipyard-column shipyard-modules");
  const statsColumn = el("section", "shipyard-column shipyard-stats");
  body.append(classColumn, moduleColumn, statsColumn);

  const footer = el("footer", "shipyard-footer");
  const problemsBox = el("ul", "shipyard-problems");
  problemsBox.setAttribute("role", "status");
  const actions = el("div", "shipyard-actions");
  const resetButton = el("button", "btn", "Configuration d'origine");
  const cancelButton = el("button", "btn", "Annuler");
  const confirmButton = el("button", "btn btn-active", "Valider");
  actions.append(resetButton, cancelButton, confirmButton);
  footer.append(problemsBox, actions);
  root.append(header, body, footer);

  const currentClass = (): ShipClass => classes.find((k) => k.id === loadout.classId)!;
  resetButton.addEventListener("click", () => {
    loadout = defaultLoadout(catalog, currentClass());
    render();
  });
  cancelButton.addEventListener("click", () => options.onCancel());
  confirmButton.addEventListener("click", () => {
    if (loadoutProblems(catalog, loadout, budgetCredits).length === 0) options.onConfirm(loadout);
  });

  function update(change: Partial<ShipLoadout>): void {
    loadout = { ...loadout, ...change };
    render();
  }

  function renderClasses(): void {
    classColumn.replaceChildren(el("h2", "shipyard-heading", "Classe"));
    for (const shipClass of classes) {
      const base = defaultLoadout(catalog, shipClass);
      const stats = shipStats(previewShip(catalog, base), reference);
      const card = el("button", `shipyard-class${shipClass.id === loadout.classId ? " shipyard-class-selected" : ""}`);
      card.setAttribute("aria-pressed", String(shipClass.id === loadout.classId));
      card.append(
        el("span", "shipyard-class-name", shipClass.name),
        el("span", "shipyard-class-price", `à partir de ${formatCredits(loadoutPrice(catalog, base).total)}`),
        el("span", "shipyard-class-desc", shipClass.description ?? ""),
        el(
          "span",
          "shipyard-class-facts",
          `${formatMass(stats.fullMassKg)} · ${fr(stats.accelerationFullG, 2)} G · ${shipClass.limits.missiles} missiles · ${shipClass.limits.pdcMounts} tourelle${shipClass.limits.pdcMounts > 1 ? "s" : ""}`,
        ),
      );
      card.addEventListener("click", () => {
        if (shipClass.id === loadout.classId) return;
        loadout = defaultLoadout(catalog, shipClass);
        render();
      });
      classColumn.appendChild(card);
    }
  }

  /** Une ligne de module : intitulé, liste de choix, caractéristiques du choix. */
  function slot<T extends { id: string; name: string; price?: number }>(
    label: string,
    entries: T[],
    selected: string | null,
    onChange: (id: string | null) => void,
    describe: (entry: T) => string,
    config: { allowNone?: string; unavailable?: (entry: T) => string | null; quantity?: HTMLElement } = {},
  ): HTMLElement {
    const row = el("div", "shipyard-slot");
    const id = `shipyard-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const labelEl = el("label", "shipyard-slot-label", label);
    labelEl.htmlFor = id;
    const select = el("select", "shipyard-select");
    select.id = id;
    if (config.allowNone) {
      const none = el("option", undefined, config.allowNone);
      none.value = "";
      select.appendChild(none);
    }
    for (const entry of entries.filter((e) => e.price !== undefined || e.id === selected)) {
      const reason = config.unavailable?.(entry) ?? null;
      const option = el("option", undefined, `${entry.name} — ${entry.price !== undefined ? formatCredits(entry.price) : "pas en vente"}${reason ? ` (${reason})` : ""}`);
      option.value = entry.id;
      option.disabled = !!reason && entry.id !== selected;
      select.appendChild(option);
    }
    select.value = selected ?? "";
    select.addEventListener("change", () => onChange(select.value || null));
    const chosen = entries.find((e) => e.id === selected);
    const detail = el("div", "shipyard-slot-detail", chosen ? describe(chosen) : "—");
    const control = el("div", "shipyard-slot-control");
    control.appendChild(select);
    if (config.quantity) control.appendChild(config.quantity);
    row.append(labelEl, control, detail);
    return row;
  }

  function quantity(label: string, value: number, max: number, onChange: (value: number) => void): HTMLElement {
    const box = el("div", "shipyard-quantity");
    const minus = el("button", "btn btn-small", "−");
    const plus = el("button", "btn btn-small", "+");
    minus.setAttribute("aria-label", `${label} : un de moins`);
    plus.setAttribute("aria-label", `${label} : un de plus`);
    minus.disabled = value <= 0;
    plus.disabled = value >= max;
    minus.addEventListener("click", () => onChange(value - 1));
    plus.addEventListener("click", () => onChange(value + 1));
    box.append(minus, el("span", "shipyard-quantity-value", `${value} / ${max}`), plus);
    return box;
  }

  function renderModules(): void {
    const limits = currentClass().limits;
    moduleColumn.replaceChildren(el("h2", "shipyard-heading", "Modules"));

    const propulsion = el("div", "shipyard-group");
    propulsion.appendChild(el("h3", "shipyard-group-title", "Propulsion et énergie"));
    propulsion.append(
      slot("Moteur principal", c.engines.filter((e) => e.kind === "principal"), loadout.engine, (id) => id && update({ engine: id }), (e) => `${formatThrust(e.maxThrustNewtons)} · Isp ${fr(e.specificImpulseSeconds)} s · ${formatMass(e.massKg ?? 0)}`),
      slot("Réservoir", c.tanks, loadout.tank, (id) => id && update({ tank: id }), (t) => `${formatMass(t.capacityKg)} de propergol · ${formatMass(t.massKg ?? 0)} à vide`, {
        unavailable: (t) => (t.capacityKg > limits.maxTankCapacityKg ? "trop grand pour la coque" : null),
      }),
      slot("Réacteur", c.reactors, loadout.reactor, (id) => id && update({ reactor: id }), (r) => `${formatPower(r.maxPowerWatts)} électriques · ${formatMass(r.massKg ?? 0)}`),
    );
    moduleColumn.appendChild(propulsion);

    const sensors = el("div", "shipyard-group");
    sensors.appendChild(el("h3", "shipyard-group-title", "Capteurs"));
    for (const role of SENSOR_ROLES) {
      sensors.appendChild(
        slot(
          SENSOR_ROLE_LABELS[role],
          c.sensors.filter((s) => s.mode === role),
          loadout.sensors[role] ?? null,
          (id) => update({ sensors: { ...loadout.sensors, [role]: id ?? undefined } as Partial<Record<SensorRole, string>> }),
          (s) =>
            s.mode === "radar_active"
              ? `${formatPower(s.powerWatts)} émis, antenne ${fr(s.antennaAreaM2!, 1)} m² · consomme ${formatPower(s.electricalPowerWatts ?? s.powerWatts)} · ${formatMass(s.massKg ?? 0)}`
              : s.mode === "ir_passive"
                ? `Pixel ${fr(s.pixelAngleRad! * 1e6)} µrad · ${formatMass(s.massKg ?? 0)}`
                : `Précision ${fr(s.bearingAccuracyRad! * 1000, 1)} mrad · ${formatMass(s.massKg ?? 0)}`,
          { allowNone: "— aucun —" },
        ),
      );
    }
    moduleColumn.appendChild(sensors);

    const weapons = el("div", "shipyard-group");
    weapons.appendChild(el("h3", "shipyard-group-title", "Armement et défense"));
    weapons.appendChild(
      slot(
        "Missiles",
        c.missiles,
        loadout.missile,
        (id) => id && update({ missile: id }),
        (m) =>
          `Delta-v ${formatSpeed(m.specificImpulseSeconds * STANDARD_GRAVITY * Math.log((m.structureMassKg + m.reservoir.quantityKg) / m.structureMassKg))} · ${fr(m.maxThrustNewtons / (m.structureMassKg + m.reservoir.quantityKg) / STANDARD_GRAVITY)} G au départ · ${formatMass(m.structureMassKg + m.reservoir.quantityKg)} pièce`,
        { quantity: quantity("Missiles", loadout.missileCount, limits.missiles, (n) => update({ missileCount: n })) },
      ),
    );
    weapons.appendChild(
      slot(
        "Leurres",
        c.decoys ?? [],
        loadout.decoy,
        (id) => update({ decoy: id, decoyCount: id ? Math.max(loadout.decoyCount, 1) : 0 }),
        (d) => `${d.irEmitter ? "Générateur IR · " : ""}écho ${fr(d.signature.radar.crossSectionFrontM2, 1)} à ${fr(d.signature.radar.crossSectionSideM2, 1)} m² · ${formatMass(d.structureMassKg + d.reservoir.quantityKg + (d.irEmitter?.chargeKg ?? 0))} pièce`,
        {
          allowNone: "— aucun —",
          quantity: loadout.decoy ? quantity("Leurres", loadout.decoyCount, limits.decoys, (n) => update({ decoyCount: n })) : undefined,
        },
      ),
    );
    loadout.pdcs.forEach((mounted, i) => {
      weapons.appendChild(
        slot(
          `Tourelle ${i + 1}`,
          c.pdcs ?? [],
          mounted,
          (id) => update({ pdcs: loadout.pdcs.map((p, j) => (j === i ? id : p)) }),
          (p) => `${fr(p.muzzleVelocityMps)} m/s · ${fr(p.rateOfFireRoundsPerSecond)} coups/s · ${fr(p.magazineRounds)} coups · portée ${formatDistance(p.maxRangeMeters)} · ${formatMass(p.massKg ?? 0)}`,
          { allowNone: "— emplacement vide —" },
        ),
      );
    });
    moduleColumn.appendChild(weapons);
  }

  function renderStats(): void {
    const stats = shipStats(previewShip(catalog, loadout), reference);
    statsColumn.replaceChildren(el("h2", "shipyard-heading", "Caractéristiques"));
    for (const group of STAT_GROUPS) {
      const box = el("div", "shipyard-group");
      box.appendChild(el("h3", "shipyard-group-title", group.title));
      if (group.note) box.appendChild(el("p", "shipyard-note", group.note));
      for (const row of group.rows) {
        const now = row.value(stats);
        const before = row.value(initialStats);
        const line = el("div", "shipyard-stat");
        const label = el("span", "shipyard-stat-label", row.label);
        if (row.hint) label.title = row.hint;
        const value = el("span", "shipyard-stat-value", now === null ? "—" : row.format(now, stats));
        const badge = deltaBadge(row, now, before);
        if (badge) value.appendChild(badge);
        line.append(label, value);
        box.appendChild(line);
      }
      statsColumn.appendChild(box);
    }

    const { lines, total } = loadoutPrice(catalog, loadout);
    const bill = el("div", "shipyard-group");
    bill.appendChild(el("h3", "shipyard-group-title", "Facture"));
    for (const line of lines) {
      const row = el("div", "shipyard-stat");
      row.append(
        el("span", "shipyard-stat-label", `${line.label}${line.quantity > 1 ? ` × ${line.quantity}` : ""}`),
        el("span", "shipyard-stat-value", formatCredits(line.quantity * line.unitPrice)),
      );
      row.title = line.item;
      bill.appendChild(row);
    }
    const totalRow = el("div", "shipyard-stat shipyard-total");
    totalRow.append(el("span", "shipyard-stat-label", "Total"), el("span", "shipyard-stat-value", formatCredits(total)));
    bill.appendChild(totalRow);
    statsColumn.appendChild(bill);
  }

  function renderBudget(): void {
    const { total } = loadoutPrice(catalog, loadout);
    const remaining = budgetCredits - total;
    budgetBox.replaceChildren();
    const figures = el("div", "shipyard-budget-figures");
    const item = (label: string, value: string, tone = "") => {
      const box = el("div", `shipyard-budget-item ${tone}`);
      box.append(el("span", "shipyard-budget-label", label), el("span", "shipyard-budget-value", value));
      return box;
    };
    figures.append(item("Budget", formatCredits(budgetCredits)), item("Coût", formatCredits(total)), item(remaining < 0 ? "Dépassement" : "Reste", formatCredits(Math.abs(remaining)), remaining < 0 ? "shipyard-over" : "shipyard-left"));
    const meter = el("div", "shipyard-meter");
    const fill = el("div", `shipyard-meter-fill${remaining < 0 ? " shipyard-meter-over" : ""}`);
    fill.style.width = `${Math.min(100, (total / budgetCredits) * 100)}%`;
    meter.appendChild(fill);
    meter.setAttribute("role", "meter");
    meter.setAttribute("aria-label", "Part du budget engagée");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", String(budgetCredits));
    meter.setAttribute("aria-valuenow", String(Math.min(total, budgetCredits)));
    budgetBox.append(figures, meter);
  }

  function render(): void {
    renderBudget();
    renderClasses();
    renderModules();
    renderStats();
    const problems = loadoutProblems(catalog, loadout, budgetCredits);
    problemsBox.replaceChildren(...problems.map((p) => el("li", undefined, p)));
    confirmButton.disabled = problems.length > 0;
  }

  render();
  return root;
}
