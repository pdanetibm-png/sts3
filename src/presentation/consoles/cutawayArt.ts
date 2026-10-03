import type { ConsoleId } from "../appState";

/**
 * Vue vaisseau — coupe longitudinale illustrée, proue à gauche, poupe à droite.
 *
 * Échelle : 1 m = 30 px, axe du vaisseau à y = 520 (coque de 40 m × 10 m du catalogue). Deux
 * ponts de part et d'autre d'une coursive axiale. Les sièges font face à la proue : sous poussée,
 * l'équipage est plaqué dans son siège, vers la poupe.
 *
 * Ce module ne produit que le dessin fixe ; les éléments `lv-*` sont animés par crossSection.ts
 * à partir de l'état propre du vaisseau joueur.
 */

export type PostId = Exclude<ConsoleId, "coupe" | "carte-maitre">;
// Le support vie est un compartiment, plus un poste : il se pilote depuis Ingénierie.
export type SecondaryId = "sas" | "quartiers" | "carre" | "infirmerie" | "missiles" | "leurres" | "vie" | "propergol" | "moteur";
export type RoomId = PostId | SecondaryId;
export type EngineKind = "thermique" | "fusion";
type Pt = [number, number];

export interface CutawaySpec {
  shipName: string;
  designName: string | undefined;
  engineKind: EngineKind;
  missileSlots: number;
  decoySlots: number;
  pdcMountCount: number;
  hasRadar: boolean;
  hasIr: boolean;
  hasEsm: boolean;
}

export const VIEW_W = 1800;
export const VIEW_H = 1000;
export const AXIS_Y = 520;
const BOW_X = 150;
const PX_PER_M = 30;
export const sx = (m: number): number => BOW_X + m * PX_PER_M;
export const sy = (z: number): number => AXIS_Y - z * PX_PER_M;

/** Demi-profil extérieur de la coque : (m depuis la proue, rayon en m). */
const HULL_PROFILE: Pt[] = [
  [0, 0],
  [0.4, 0.8],
  [1.2, 1.7],
  [2.5, 2.7],
  [4.5, 3.6],
  [7, 4.3],
  [9.5, 4.75],
  [11.5, 5],
  [33, 5],
  [35, 4.8],
  [37.5, 4.35],
  [40, 3.8],
];
const BREAKS = HULL_PROFILE.map(([m]) => m);
const WALL_M = 0.75;
const DECK_M = 0.55;
const SHAFT_M = 0.4;
const DEPTH_PX = 13;
const INTERIOR_START_M = 2.8;
const INTERIOR_END_M = 39.6;

export function hullR(m: number): number {
  if (m <= 0) return 0;
  for (let i = 1; i < HULL_PROFILE.length; i++) {
    const [m1, r1] = HULL_PROFILE[i];
    if (m <= m1) {
      const [m0, r0] = HULL_PROFILE[i - 1];
      return r0 + ((r1 - r0) * (m - m0)) / (m1 - m0);
    }
  }
  return HULL_PROFILE[HULL_PROFILE.length - 1][1];
}
const innerR = (m: number): number => Math.max(0, hullR(m) - WALL_M);

export const TINTS: Record<RoomId, string> = {
  pilotage: "#5aa9ff",
  tactique: "#8a94ff",
  detection: "#3ddc97",
  ingenierie: "#ffb648",
  vie: "#34d6c8",
  sas: "#ff9a3c",
  quartiers: "#ff6fae",
  carre: "#f2c14e",
  infirmerie: "#a8e6ff",
  missiles: "#ff5a4f",
  leurres: "#b07cff",
  propergol: "#8cc4ff",
  moteur: "#5f9dff",
};
const FUSION_TINT = "#b48cff";
export const EQUIPMENT_TINT = { radar: "#ffd166", ir: "#3ddc97", pdc: "#ffd166" };

interface RoomDef {
  id: RoomId;
  deck: "haut" | "bas" | "plein";
  m0: number;
  m1: number;
}

const ROOMS: RoomDef[] = [
  { id: "pilotage", deck: "haut", m0: INTERIOR_START_M, m1: 8.85 },
  { id: "tactique", deck: "haut", m0: 9.15, m1: 14.45 },
  { id: "detection", deck: "haut", m0: 14.75, m1: 20.05 },
  { id: "missiles", deck: "haut", m0: 20.35, m1: 26.05 },
  { id: "ingenierie", deck: "haut", m0: 26.35, m1: 31.25 },
  { id: "sas", deck: "bas", m0: INTERIOR_START_M, m1: 8.85 },
  { id: "quartiers", deck: "bas", m0: 9.15, m1: 14.45 },
  { id: "carre", deck: "bas", m0: 14.75, m1: 17.45 },
  { id: "infirmerie", deck: "bas", m0: 17.75, m1: 20.05 },
  { id: "leurres", deck: "bas", m0: 20.35, m1: 26.05 },
  { id: "vie", deck: "bas", m0: 26.35, m1: 31.25 },
  { id: "propergol", deck: "plein", m0: 31.55, m1: 35.55 },
  { id: "moteur", deck: "plein", m0: 35.85, m1: INTERIOR_END_M },
];

const POST_NUMBERS: Record<PostId, string> = { pilotage: "01", detection: "02", tactique: "03", ingenierie: "04" };
const POST_IDS = new Set<RoomId>(Object.keys(POST_NUMBERS) as PostId[]);
export const isPost = (id: RoomId): id is PostId => POST_IDS.has(id);

interface TagDef {
  room: RoomId;
  title: string;
  x: number;
  y: number;
  w: number;
  attachX: number;
  anchor: Pt;
}

const TOP_Y = 176;
const BOTTOM_Y = 760;
const TAG_H = 50;

function tagDefs(spec: CutawaySpec): TagDef[] {
  const engineTitle = spec.engineKind === "fusion" ? "Propulsion Epstein" : "Moteur nucl. thermique";
  return [
    { room: "pilotage", title: "Pilotage", x: 40, y: TOP_Y, w: 225, attachX: 245, anchor: [330, 462] },
    { room: "tactique", title: "Tactique", x: 300, y: TOP_Y, w: 225, attachX: 450, anchor: [450, 438] },
    { room: "detection", title: "Détection", x: 560, y: TOP_Y, w: 225, attachX: 730, anchor: [730, 452] },
    { room: "missiles", title: "Soute à missiles", x: 810, y: TOP_Y, w: 225, attachX: 830, anchor: [830, 402] },
    { room: "ingenierie", title: "Ingénierie", x: 1060, y: TOP_Y, w: 225, attachX: 1070, anchor: [1070, 420] },
    { room: "moteur", title: engineTitle, x: 1320, y: TOP_Y, w: 225, attachX: 1340, anchor: [1300, 452] },
    { room: "sas", title: "Sas & combinaisons", x: 40, y: BOTTOM_Y, w: 215, attachX: 235, anchor: [372, 600] },
    { room: "quartiers", title: "Quartiers d'équipage", x: 290, y: BOTTOM_Y, w: 215, attachX: 485, anchor: [485, 606] },
    { room: "carre", title: "Carré & infirmerie", x: 540, y: BOTTOM_Y, w: 215, attachX: 678, anchor: [678, 626] },
    { room: "leurres", title: "Soute à leurres", x: 790, y: BOTTOM_Y, w: 215, attachX: 820, anchor: [820, 640] },
    { room: "vie", title: "Support vie", x: 1040, y: BOTTOM_Y, w: 215, attachX: 1060, anchor: [1060, 626] },
    { room: "propergol", title: "Réservoir de propergol", x: 1290, y: BOTTOM_Y, w: 215, attachX: 1310, anchor: [1180, 600] },
  ];
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const pts = (p: Pt[]): string => p.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ");
const pathOf = (p: Pt[]): string => `M${p.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" L")} Z`;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// ——— Géométrie des compartiments ———————————————————————————————————————————

function roomPolygon(r: RoomDef): Pt[] {
  const ms = [r.m0, ...BREAKS.filter((m) => m > r.m0 && m < r.m1), r.m1];
  const top = ms.map((m) => [sx(m), sy(innerR(m))] as Pt);
  const bottom = [...ms].reverse().map((m) => [sx(m), sy(-innerR(m))] as Pt);
  if (r.deck === "haut") return [...top, [sx(r.m1), sy(DECK_M)], [sx(r.m0), sy(DECK_M)]];
  if (r.deck === "bas") return [[sx(r.m0), sy(-DECK_M)], [sx(r.m1), sy(-DECK_M)], ...bottom];
  return [...top, ...bottom];
}

function inset(poly: Pt[], d: number): Pt[] {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const kx = (maxX - minX - 2 * d) / (maxX - minX);
  const ky = (maxY - minY - 2 * d) / (maxY - minY);
  return poly.map(([x, y]) => [cx + (x - cx) * kx, cy + (y - cy) * ky] as Pt);
}

/** Faces en perspective entre la coupe (P) et la paroi du fond (B) : plafonds, planchers, cloisons. */
function roomFaces(p: Pt[], b: Pt[]): string {
  const faces: string[] = [];
  const lamps: string[] = [];
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const dx = p[j][0] - p[i][0];
    const dy = p[j][1] - p[i][1];
    const quad = pts([p[i], p[j], b[j], b[i]]);
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > 0) {
        faces.push(`<polygon class="face-ceiling" points="${quad}"/>`);
        if (Math.abs(dx) > 30) lamps.push(`<line class="lamp" x1="${f1(b[i][0] + 10)}" y1="${f1(b[i][1] + 2.5)}" x2="${f1(b[j][0] - 10)}" y2="${f1(b[j][1] + 2.5)}"/>`);
      } else {
        faces.push(`<polygon class="face-floor" points="${quad}"/><polygon class="face-floor-grate" points="${quad}"/><polygon class="face-floor-glow" points="${quad}"/>`);
      }
    } else {
      faces.push(`<polygon class="face-wall" points="${quad}"/>`);
    }
  }
  return faces.join("") + lamps.join("");
}

// ——— Petits éléments ————————————————————————————————————————————————————————

type ScreenKind = "lines" | "bars" | "plot" | "map" | "scope";
let screenCounter = 0;

function screen(x: number, y: number, w: number, h: number, kind: ScreenKind): string {
  const delay = ((screenCounter++ * 0.73) % 4).toFixed(2);
  const ix = x + 2.5;
  const iy = y + 2.5;
  const iw = w - 5;
  const ih = h - 5;
  let content = "";
  switch (kind) {
    case "lines":
      content = range(Math.max(2, Math.floor(ih / 4)))
        .map((i) => `<line x1="${f1(ix + 1)}" y1="${f1(iy + 2 + i * 4)}" x2="${f1(ix + 1 + iw * (0.35 + ((i * 37) % 60) / 100))}" y2="${f1(iy + 2 + i * 4)}"/>`)
        .join("");
      break;
    case "bars":
      content = range(Math.max(3, Math.floor(iw / 4)))
        .map((i) => {
          const bh = ih * (0.25 + ((i * 53) % 70) / 100);
          return `<line x1="${f1(ix + 2 + i * 4)}" y1="${f1(iy + ih)}" x2="${f1(ix + 2 + i * 4)}" y2="${f1(iy + ih - bh)}"/>`;
        })
        .join("");
      break;
    case "plot":
      content = `<polyline fill="none" points="${range(8)
        .map((i) => `${f1(ix + (i * iw) / 7)},${f1(iy + ih * (0.3 + 0.5 * Math.abs(Math.sin(i * 1.7))))}`)
        .join(" ")}"/>`;
      break;
    case "map":
      content = `<circle cx="${f1(ix + iw / 2)}" cy="${f1(iy + ih / 2)}" r="${f1(Math.min(iw, ih) / 2.4)}" fill="none"/><circle class="scr-dot" cx="${f1(ix + iw * 0.3)}" cy="${f1(iy + ih * 0.35)}" r="1.4"/><circle class="scr-dot" cx="${f1(ix + iw * 0.72)}" cy="${f1(iy + ih * 0.6)}" r="1.4"/>`;
      break;
    case "scope":
      content = `<circle cx="${f1(ix + iw / 2)}" cy="${f1(iy + ih / 2)}" r="${f1(Math.min(iw, ih) / 2.2)}" fill="none"/><line x1="${f1(ix + iw / 2)}" y1="${f1(iy)}" x2="${f1(ix + iw / 2)}" y2="${f1(iy + ih)}"/>`;
      break;
  }
  return `<g class="scr" style="animation-delay:-${delay}s"><rect class="scr-frame" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="1.5"/><rect class="scr-glass" x="${f1(ix)}" y="${f1(iy)}" width="${f1(iw)}" height="${f1(ih)}"/><g class="scr-ink">${content}</g></g>`;
}

/** Membre d'équipage assis dans un siège anti-g, face à la proue (repère local : pied du siège à l'origine). */
function crewSeat(x: number, floorY: number, scale = 0.85): string {
  return `<g class="crew" transform="translate(${f1(x)},${f1(floorY)}) scale(${scale})">
    <path class="couch" d="M-10,0 H14 V-9 H-10 Z"/>
    <path class="couch" d="M8,-9 L16,-9 L25,-46 L17,-48 Z"/>
    <rect class="couch-pad" x="16" y="-58" width="10" height="12" rx="3" transform="rotate(14 21 -52)"/>
    <path class="crew-limb" d="M6,-13 L-9,-16 L-13,-3" stroke-width="7"/>
    <g class="crew-upper">
      <path class="crew-body" d="M6,-13 L15,-38" stroke-width="10"/>
      <circle class="crew-head" cx="16" cy="-47" r="6"/>
      <path class="crew-limb" d="M13,-35 L2,-27 L-10,-31" stroke-width="4"/>
    </g>
  </g>`;
}

/** Pupitre devant un siège (vers la proue), avec écran incliné et, au besoin, écran surélevé. */
function station(x: number, floorY: number, kind: ScreenKind, raised: boolean, scale = 0.85): string {
  return `<g transform="translate(${f1(x)},${f1(floorY)}) scale(${scale})">
      <path class="desk" d="M-40,0 L-17,0 L-17,-18 L-25,-29 L-40,-29 Z"/>
      <path class="desk-edge" d="M-40,-29 L-25,-29 L-17,-18"/>
      <g transform="rotate(38 -24 -26)">${screen(-34, -30, 14, 7, "bars")}</g>
      ${raised ? `<rect class="desk" x="-32" y="-38" width="4" height="9"/>${screen(-42, -60, 26, 22, kind)}` : ""}
    </g>${crewSeat(x, floorY, scale)}`;
}

function missileShape(x: number, y: number, len: number, index: number, cradle = true): string {
  const h = 10;
  return `${cradle ? `<path class="cradle" d="M${x + 10},${y + h + 2.5} H${x + len - 12}"/><rect class="cradle-clamp" x="${x + 24}" y="${y + h}" width="4" height="4"/><rect class="cradle-clamp" x="${x + len - 30}" y="${y + h}" width="4" height="4"/>` : ""}
    <g class="lv-missile" data-index="${index}">
      <path class="msl-fin" d="M${x + len - 18},${y} L${x + len - 7},${y - 4.5} L${x + len - 1},${y - 4.5} L${x + len - 6},${y} Z"/>
      <path class="msl-fin" d="M${x + len - 18},${y + h} L${x + len - 7},${y + h + 4.5} L${x + len - 1},${y + h + 4.5} L${x + len - 6},${y + h} Z"/>
      <rect class="msl-body" x="${x + 13}" y="${y}" width="${len - 24}" height="${h}" rx="1"/>
      <path class="msl-nose" d="M${x},${y + h / 2} Q${x + 3},${y} ${x + 14},${y} V${y + h} Q${x + 3},${y + h} ${x},${y + h / 2} Z"/>
      <rect class="msl-band" x="${x + 19}" y="${y}" width="5" height="${h}"/>
      <rect class="msl-band-2" x="${x + len - 30}" y="${y}" width="3" height="${h}"/>
      <rect class="msl-nozzle" x="${x + len - 11}" y="${y + 2}" width="8" height="${h - 4}" rx="1"/>
      <line class="msl-hl" x1="${x + 14}" y1="${y + 2}" x2="${x + len - 14}" y2="${y + 2}"/>
    </g>`;
}

function decoyShape(x: number, y: number, len: number, index: number, cradle = true): string {
  const h = 13;
  return `${cradle ? `<path class="cradle" d="M${x + 6},${y + h + 2.5} H${x + len - 6}"/>` : ""}
    <g class="lv-decoy" data-index="${index}">
      <rect class="dcy-body" x="${x + 7}" y="${y}" width="${len - 14}" height="${h}" rx="3"/>
      <rect class="dcy-cap" x="${x}" y="${y + 1}" width="9" height="${h - 2}" rx="3"/>
      <rect class="dcy-cap" x="${x + len - 9}" y="${y + 1}" width="9" height="${h - 2}" rx="3"/>
      ${range(3)
        .map((i) => {
          const cx = x + 26 + i * ((len - 52) / 2);
          return `<path class="dcy-facet" d="M${cx},${y + 2} L${cx + 6},${y + h / 2} L${cx},${y + h - 2} L${cx - 6},${y + h / 2} Z"/>`;
        })
        .join("")}
      <line class="msl-hl" x1="${x + 8}" y1="${y + 2.5}" x2="${x + len - 8}" y2="${y + 2.5}"/>
    </g>`;
}

function scopeBlips(): string {
  return `<g class="lv-scope-blips">${range(16)
    .map(() => `<circle class="blip" r="2.2" cx="0" cy="0" visibility="hidden"/>`)
    .join("")}</g>`;
}

function ammoDrum(x: number, y0: number, h: number, mount: number): string {
  return `<rect class="drum" x="${x}" y="${y0}" width="14" height="${h}" rx="3"/>
    <rect class="drum-track" x="${x + 3}" y="${y0 + 4}" width="8" height="${h - 8}" rx="1.5"/>
    <rect class="lv-pdc-ammo" data-mount="${mount}" data-y0="${y0 + 4}" data-h="${h - 8}" x="${x + 3}" y="${y0 + 4}" width="8" height="${h - 8}" rx="1.5"/>
    ${range(5)
      .map((i) => `<line class="drum-tick" x1="${x + 1}" y1="${f1(y0 + 4 + ((h - 8) * i) / 4)}" x2="${x + 3}" y2="${f1(y0 + 4 + ((h - 8) * i) / 4)}"/>`)
      .join("")}`;
}

// ——— Mobilier des compartiments ——————————————————————————————————————————————

const UP_WALL_TOP = sy(innerR(20)) + DEPTH_PX;
const UP_FLOOR = sy(DECK_M) - DEPTH_PX;
const UP_STAND = sy(DECK_M) - 6;
const LO_WALL_TOP = sy(-DECK_M) + DEPTH_PX;
const LO_FLOOR = sy(-innerR(20)) - DEPTH_PX;
const LO_STAND = sy(-innerR(20)) - 6;

function furnishing(id: RoomId, spec: CutawaySpec): string {
  switch (id) {
    case "pilotage": {
      const windows = (
        [
          [3.7, 4.7],
          [4.9, 5.9],
          [6.1, 7.1],
        ] as Pt[]
      )
        .map(([a, b]) => {
          const ya = sy(innerR(a)) + 17;
          const yb = sy(innerR(b)) + 17;
          return `<polygon class="viewport" points="${pts([
            [sx(a), ya],
            [sx(b), yb],
            [sx(b), yb + 20],
            [sx(a), ya + 20],
          ])}"/><circle class="viewport-star" cx="${f1(sx(a) + 9)}" cy="${f1(ya + 11)}" r="0.9"/><circle class="viewport-star" cx="${f1(sx(a) + 21)}" cy="${f1(ya + 7)}" r="0.7"/><path class="viewport-glint" d="M${f1(sx(a) + 5)},${f1(ya + 17)} L${f1(sx(a) + 14)},${f1(ya + 6)}"/>`;
        })
        .join("");
      return `${windows}
        <path class="desk" d="M246,${UP_STAND} L246,484 L298,484 L304,${UP_STAND} Z"/>
        ${screen(252, 486, 16, 8, "map")}${screen(272, 486, 16, 8, "lines")}
        <rect class="panel" x="364" y="${UP_WALL_TOP + 2}" width="34" height="9" rx="1.5"/>
        ${range(6)
          .map((i) => `<circle class="panel-led ${i % 3 === 0 ? "blink-led" : ""}" cx="${368 + i * 5}" cy="${UP_WALL_TOP + 6.5}" r="1.2"/>`)
          .join("")}
        ${station(336, UP_STAND, "lines", false)}${station(392, UP_STAND, "plot", false)}`;
    }
    case "tactique":
      return `
        <rect class="wall-display" x="452" y="${UP_WALL_TOP + 5}" width="92" height="42" rx="2"/>
        <g class="scr-ink tac-plot">
          ${range(3)
            .map((i) => `<circle cx="498" cy="${UP_WALL_TOP + 26}" r="${6 + i * 7}" fill="none"/>`)
            .join("")}
          <path d="M462,${UP_WALL_TOP + 38} Q490,${UP_WALL_TOP + 16} 530,${UP_WALL_TOP + 12}" fill="none" class="tac-arc"/>
          <circle class="scr-dot blink-led" cx="530" cy="${UP_WALL_TOP + 12}" r="1.8"/>
          <circle class="scr-dot" cx="498" cy="${UP_WALL_TOP + 26}" r="1.6"/>
        </g>
        <rect class="panel" x="553" y="${UP_WALL_TOP + 5}" width="12" height="${f1(Math.max(4, spec.missileSlots) * 9 + 4)}" rx="1.5"/>
        ${range(Math.min(6, Math.max(1, spec.missileSlots)))
          .map((i) => `<circle class="lv-tac-lamp" data-index="${i}" cx="559" cy="${f1(UP_WALL_TOP + 11 + i * 9)}" r="2.6"/>`)
          .join("")}
        ${station(482, UP_STAND, "map", true)}${station(546, UP_STAND, "lines", true)}`;
    case "detection":
      return `
        <g class="scope" data-cx="632" data-cy="440" data-r="28">
          <circle class="scope-bezel" cx="632" cy="440" r="31"/>
          <circle class="scope-face" cx="632" cy="440" r="28"/>
          <circle class="scope-ring" cx="632" cy="440" r="18.5"/>
          <circle class="scope-ring" cx="632" cy="440" r="9"/>
          <path class="scope-ring" d="M604,440 H660 M632,412 V468"/>
          <g class="lv-scope-sweep" transform="translate(632,440)"><path class="scope-sweep" d="M0,0 L28,0 A28,28 0 0,0 24.2,-14 Z"/></g>
          ${scopeBlips()}
          <circle class="scope-own" cx="632" cy="440" r="1.8"/>
        </g>
        ${[706, 722]
          .map(
            (x) =>
              `<rect class="rack" x="${x}" y="${UP_WALL_TOP + 3}" width="14" height="${UP_FLOOR - UP_WALL_TOP - 3}" rx="1.5"/>${range(8)
                .map((r) =>
                  range(2)
                    .map((c) => `<circle class="rack-led ${(r + c + x) % 3 === 0 ? "blink-led" : ""}" style="animation-delay:-${((r * 7 + c * 3) % 10) / 10}s" cx="${x + 4.5 + c * 5}" cy="${UP_WALL_TOP + 9 + r * 9}" r="1.1"/>`)
                    .join(""),
                )
                .join("")}`,
          )
          .join("")}
        ${station(684, UP_STAND, "scope", false)}`;
    case "missiles": {
      const slots = Math.min(6, Math.max(1, spec.missileSlots));
      const step = (UP_FLOOR - UP_WALL_TOP - 14) / slots;
      return `
        <rect class="rack-post" x="781" y="${UP_WALL_TOP}" width="4" height="${UP_FLOOR - UP_WALL_TOP}"/>
        <rect class="rack-post" x="886" y="${UP_WALL_TOP}" width="4" height="${UP_FLOOR - UP_WALL_TOP}"/>
        ${range(slots)
          .map((i) => missileShape(789, UP_WALL_TOP + 7 + i * step, 94, i))
          .join("")}
        ${spec.pdcMountCount > 0 ? ammoDrum(900, UP_WALL_TOP + 3, UP_FLOOR - UP_WALL_TOP - 4, 0) : ""}
        <rect class="hazard-floor" x="776" y="${UP_FLOOR + 1}" width="140" height="10"/>`;
    }
    case "leurres": {
      const slots = Math.min(5, Math.max(1, spec.decoySlots));
      const step = (LO_FLOOR - LO_WALL_TOP - 16) / slots;
      return `
        <rect class="rack-post" x="781" y="${LO_WALL_TOP}" width="4" height="${LO_FLOOR - LO_WALL_TOP}"/>
        <rect class="rack-post" x="886" y="${LO_WALL_TOP}" width="4" height="${LO_FLOOR - LO_WALL_TOP}"/>
        ${range(slots)
          .map((i) => decoyShape(790, LO_WALL_TOP + 6 + i * step, 92, i))
          .join("")}
        ${spec.pdcMountCount > 1 ? ammoDrum(900, LO_WALL_TOP + 3, LO_FLOOR - LO_WALL_TOP - 4, 1) : ""}
        <path class="chute" d="M800,${LO_FLOOR} L800,${LO_FLOOR + 12}"/>`;
    }
    case "ingenierie":
      return `
        ${range(5)
          .map(
            (i) =>
              `<rect class="cell" x="957" y="${UP_WALL_TOP + 8 + i * 15}" width="32" height="12" rx="1.5"/><rect class="cell-track" x="960" y="${UP_WALL_TOP + 11 + i * 15}" width="26" height="6"/><rect class="lv-battery-cell" data-index="${i}" data-x0="960" data-w="26" x="960" y="${UP_WALL_TOP + 11 + i * 15}" width="26" height="6"/>`,
          )
          .join("")}
        <path class="pipe" d="M1003,${UP_WALL_TOP - 4} V${UP_WALL_TOP + 6} M1017,${UP_WALL_TOP - 4} V${UP_WALL_TOP + 6}"/>
        <rect class="reactor-shell" x="992" y="${UP_WALL_TOP + 5}" width="36" height="${UP_STAND - UP_WALL_TOP - 5}" rx="12"/>
        <rect class="reactor-band" x="992" y="${UP_WALL_TOP + 24}" width="36" height="4"/>
        <rect class="reactor-band" x="992" y="${UP_STAND - 22}" width="36" height="4"/>
        <circle class="reactor-window" cx="1010" cy="${UP_WALL_TOP + 45}" r="12"/>
        <circle class="lv-reactor-core" cx="1010" cy="${UP_WALL_TOP + 45}" r="10" fill="url(#coreGlow)"/>
        <circle class="reactor-ring" cx="1010" cy="${UP_WALL_TOP + 45}" r="12"/>
        ${station(1064, UP_STAND, "bars", true)}`;
    case "vie":
      return `
        <path class="pipe" d="M958,${LO_WALL_TOP + 4} H1072 M1046,${LO_WALL_TOP + 4} V${LO_WALL_TOP + 12}"/>
        ${[958, 980]
          .map(
            (x) =>
              `<rect class="o2-tank" x="${x}" y="${LO_WALL_TOP + 9}" width="18" height="${LO_STAND - LO_WALL_TOP - 9}" rx="9"/><text class="stencil" x="${x + 9}" y="${LO_WALL_TOP + 44}" text-anchor="middle">O₂</text>`,
          )
          .join("")}
        <rect class="water-tank" x="1003" y="${LO_WALL_TOP + 38}" width="22" height="${LO_STAND - LO_WALL_TOP - 38}" rx="4"/>
        <rect class="water-level" x="1005" y="${LO_WALL_TOP + 52}" width="18" height="${LO_STAND - LO_WALL_TOP - 54}" rx="2"/>
        ${[LO_WALL_TOP + 24, LO_WALL_TOP + 60]
          .map(
            (cy) =>
              `<circle class="fan-housing" cx="1048" cy="${cy}" r="13"/><g class="fan" style="transform-origin:1048px ${cy}px">${range(4)
                .map((k) => `<path class="fan-blade" d="M1048,${cy} L${f1(1048 + 10 * Math.cos((k * Math.PI) / 2))},${f1(cy + 10 * Math.sin((k * Math.PI) / 2))} L${f1(1048 + 8 * Math.cos((k * Math.PI) / 2 + 0.6))},${f1(cy + 8 * Math.sin((k * Math.PI) / 2 + 0.6))} Z"/>`)
                .join("")}</g><circle class="fan-hub" cx="1048" cy="${cy}" r="2.5"/>`,
          )
          .join("")}
        <rect class="panel" x="1064" y="${LO_WALL_TOP + 14}" width="8" height="30" rx="1"/>
        ${range(4)
          .map((i) => `<circle class="panel-led" cx="1068" cy="${LO_WALL_TOP + 19 + i * 7}" r="1.2"/>`)
          .join("")}`;
    case "sas":
      return `
        <rect class="locker" x="268" y="${LO_WALL_TOP + 2}" width="26" height="30" rx="1.5"/>
        <line class="locker-line" x1="281" y1="${LO_WALL_TOP + 2}" x2="281" y2="${LO_WALL_TOP + 32}"/>
        <rect class="airlock" x="302" y="${LO_WALL_TOP + 5}" width="46" height="${LO_STAND - LO_WALL_TOP - 10}" rx="6"/>
        <rect class="airlock-window" x="316" y="${LO_WALL_TOP + 16}" width="18" height="12" rx="3"/>
        <rect class="airlock-door" x="345" y="${LO_WALL_TOP + 12}" width="6" height="${LO_STAND - LO_WALL_TOP - 24}" rx="1"/>
        <path class="hazard-edge" d="M304,${LO_STAND - 6} H346"/>
        ${[362, 380, 398]
          .map(
            (x) =>
              `<g class="suit"><circle class="suit-helmet" cx="${x}" cy="${LO_WALL_TOP + 9}" r="5.5"/><rect class="suit-visor" x="${x - 3.5}" y="${LO_WALL_TOP + 6.5}" width="6" height="4" rx="1.5"/><rect class="suit-body" x="${x - 6}" y="${LO_WALL_TOP + 15}" width="12" height="24" rx="4"/><rect class="suit-stripe" x="${x - 6}" y="${LO_WALL_TOP + 25}" width="12" height="3"/><path class="suit-limb" d="M${x - 5},${LO_WALL_TOP + 18} L${x - 8},${LO_WALL_TOP + 34} M${x + 5},${LO_WALL_TOP + 18} L${x + 8},${LO_WALL_TOP + 34} M${x - 3},${LO_WALL_TOP + 39} L${x - 3},${LO_WALL_TOP + 56} M${x + 3},${LO_WALL_TOP + 39} L${x + 3},${LO_WALL_TOP + 56}"/></g>`,
          )
          .join("")}`;
    case "quartiers":
      return range(6)
        .map((i) => {
          const x = 443 + (i % 3) * 42;
          const y = LO_WALL_TOP + 5 + Math.floor(i / 3) * 38;
          return `<rect class="bunk" x="${x}" y="${y}" width="38" height="32" rx="7"/><rect class="bunk-bed" x="${x + 4}" y="${y + 18}" width="30" height="9" rx="3"/><rect class="bunk-pillow" x="${x + 25}" y="${y + 15}" width="8" height="6" rx="2"/><rect class="bunk-curtain" x="${x + 3}" y="${y + 3}" width="9" height="26" rx="2"/><circle class="bunk-lamp" cx="${x + 30}" cy="${y + 6}" r="1.5"/>`;
        })
        .join("");
    case "carre":
      return `
        ${screen(610, LO_WALL_TOP + 8, 26, 16, "lines")}
        <rect class="table" x="606" y="${LO_STAND - 26}" width="30" height="4" rx="1.5"/>
        <rect class="desk" x="619" y="${LO_STAND - 22}" width="4" height="22"/>
        <rect class="bench" x="600" y="${LO_STAND - 12}" width="10" height="4" rx="1.5"/>
        <rect class="bench" x="632" y="${LO_STAND - 12}" width="10" height="4" rx="1.5"/>
        <rect class="cup" x="612" y="${LO_STAND - 31}" width="4" height="5" rx="1"/><rect class="cup" x="626" y="${LO_STAND - 31}" width="4" height="5" rx="1"/>
        <rect class="counter" x="644" y="${LO_STAND - 34}" width="16" height="34" rx="1.5"/>
        <rect class="appliance" x="645" y="${LO_WALL_TOP + 14}" width="14" height="11" rx="1.5"/>
        <rect class="appliance-window" x="647" y="${LO_WALL_TOP + 16}" width="8" height="7" rx="1"/>`;
    case "infirmerie":
      return `
        <rect class="scr-frame" x="700" y="${LO_WALL_TOP + 8}" width="24" height="16" rx="1.5"/>
        <polyline class="ecg" points="702,${LO_WALL_TOP + 17} 707,${LO_WALL_TOP + 17} 709,${LO_WALL_TOP + 12} 711,${LO_WALL_TOP + 21} 713,${LO_WALL_TOP + 15} 715,${LO_WALL_TOP + 17} 722,${LO_WALL_TOP + 17}"/>
        <rect class="med-cabinet" x="727" y="${LO_WALL_TOP + 8}" width="10" height="16" rx="1"/>
        <path class="med-cross" d="M732,${LO_WALL_TOP + 12} V${LO_WALL_TOP + 20} M728,${LO_WALL_TOP + 16} H736"/>
        <path class="scanner" d="M716,${LO_WALL_TOP} V${LO_WALL_TOP + 34} L722,${LO_WALL_TOP + 40}"/>
        <rect class="med-bed" x="697" y="${LO_STAND - 20}" width="40" height="7" rx="2.5"/>
        <rect class="bunk-pillow" x="729" y="${LO_STAND - 24}" width="8" height="5" rx="2"/>
        <rect class="desk" x="702" y="${LO_STAND - 13}" width="4" height="13"/><rect class="desk" x="728" y="${LO_STAND - 13}" width="4" height="13"/>`;
    case "propergol": {
      const x0 = 1106;
      const x1 = 1207;
      const y0 = sy(innerR(33)) + 16;
      const y1 = sy(-innerR(33)) - 16;
      const label = spec.engineKind === "thermique" ? "H₂ LIQUIDE" : "PROPERGOL";
      return `
        <clipPath id="tankClip"><rect x="${x0 + 3}" y="${y0 + 3}" width="${x1 - x0 - 6}" height="${y1 - y0 - 6}" rx="36"/></clipPath>
        <rect class="tank-shell" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="39"/>
        <g clip-path="url(#tankClip)">
          <rect class="tank-void" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>
          <rect class="lv-prop-fill" data-x0="${x0 + 3}" data-w="${x1 - x0 - 6}" x="${x0 + 3}" y="${y0}" width="${x1 - x0 - 6}" height="${y1 - y0}" fill="url(#propellant)"/>
          <g class="lv-prop-surface" transform="translate(${x0 + 3},0)"><path class="prop-surface" d="M0,${y0} ${range(12)
            .map((i) => `Q${i % 2 === 0 ? 3 : -3},${f1(y0 + (i + 0.5) * ((y1 - y0) / 12))} 0,${f1(y0 + (i + 1) * ((y1 - y0) / 12))}`)
            .join(" ")}"/></g>
          ${range(7)
            .map((i) => `<line class="tank-rib" x1="${x0}" y1="${f1(y0 + 20 + i * 30)}" x2="${x1}" y2="${f1(y0 + 20 + i * 30)}"/>`)
            .join("")}
        </g>
        <rect class="tank-hl" x="${x0 + 8}" y="${y0 + 26}" width="5" height="${y1 - y0 - 52}" rx="2.5"/>
        <text class="stencil tank-label" x="${(x0 + x1) / 2}" y="${AXIS_Y + 4}" text-anchor="middle">${label}</text>
        ${range(5)
          .map((i) => `<line class="gauge-tick" x1="${f1(x1 - 3 - ((x1 - x0 - 6) * i) / 4)}" y1="${y0 - 5}" x2="${f1(x1 - 3 - ((x1 - x0 - 6) * i) / 4)}" y2="${y0 - 1}"/>`)
          .join("")}
        <path class="pipe pipe-feed" d="M${x1},${AXIS_Y - 50} H1222 M${x1},${AXIS_Y + 50} H1222"/>`;
    }
    case "moteur":
      return spec.engineKind === "fusion" ? fusionEngineRoom() : thermalEngineRoom();
  }
}

function thermalEngineRoom(): string {
  return `
    <rect class="shield" x="1234" y="428" width="14" height="184" rx="2"/>
    ${range(6)
      .map((i) => `<rect class="shield-layer" x="1234" y="${432 + i * 30}" width="14" height="12"/>`)
      .join("")}
    <path class="pipe pipe-feed" d="M1222,470 H1276 V446 M1222,570 H1276 V594"/>
    <circle class="turbo-housing" cx="1288" cy="442" r="12"/><g class="turbo" style="transform-origin:1288px 442px">${range(3)
      .map((k) => `<path class="turbo-blade" d="M1288,442 L${f1(1288 + 9 * Math.cos((k * 2 * Math.PI) / 3))},${f1(442 + 9 * Math.sin((k * 2 * Math.PI) / 3))}"/>`)
      .join("")}</g>
    <circle class="turbo-housing" cx="1288" cy="598" r="12"/><g class="turbo" style="transform-origin:1288px 598px">${range(3)
      .map((k) => `<path class="turbo-blade" d="M1288,598 L${f1(1288 + 9 * Math.cos((k * 2 * Math.PI) / 3))},${f1(598 + 9 * Math.sin((k * 2 * Math.PI) / 3))}"/>`)
      .join("")}</g>
    <rect class="vessel" x="1256" y="470" width="62" height="100" rx="10"/>
    <rect class="core-bay" x="1263" y="478" width="46" height="84" rx="4"/>
    <rect class="lv-engine-core" x="1263" y="478" width="46" height="84" rx="4" fill="url(#ntrCore)"/>
    ${range(8)
      .map((i) => `<line class="fuel-rod" x1="${1267 + i * 5.5}" y1="481" x2="${1267 + i * 5.5}" y2="559"/>`)
      .join("")}
    <path class="vessel" d="M1318,496 L1338,507 V533 L1318,544 Z"/>`;
}

function fusionEngineRoom(): string {
  return `
    ${[422, 588]
      .map((y) => `<rect class="capacitor" x="1236" y="${y}" width="90" height="30" rx="3"/>${range(8)
        .map((i) => `<line class="capacitor-rib" x1="${1244 + i * 10}" y1="${y + 4}" x2="${1244 + i * 10}" y2="${y + 26}"/>`)
        .join("")}`)
      .join("")}
    <ellipse class="torus-shell" cx="1282" cy="520" rx="28" ry="60"/>
    <ellipse class="lv-engine-core torus-plasma" cx="1282" cy="520" rx="28" ry="60"/>
    <ellipse class="torus-inner" cx="1282" cy="520" rx="10" ry="40"/>
    <path class="vessel" d="M1306,500 L1338,510 V530 L1306,540 Z"/>`;
}

// ——— Extérieur ——————————————————————————————————————————————————————————————

function starfield(): string {
  const rand = seeded(11);
  const stars: string[] = [];
  for (let i = 0; i < 260; i++) {
    const x = rand() * VIEW_W;
    const y = rand() * VIEW_H;
    const big = rand() < 0.06;
    stars.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${big ? 1.5 : (0.35 + rand() * 0.6).toFixed(2)}" opacity="${(0.18 + rand() * 0.55).toFixed(2)}"/>`);
  }
  return `<g class="stars">${stars.join("")}</g>`;
}

/** Plaques de blindage sur le dos et le ventre de la coque, en évitant les équipements. */
function armorBlocks(side: 1 | -1, keepOut: Pt[]): string {
  const rand = seeded(side > 0 ? 29 : 57);
  const blocks: string[] = [];
  let m = 11.8;
  while (m < 32.6) {
    const len = 0.9 + rand() * 1.3;
    const end = Math.min(32.6, m + len);
    const blocked = keepOut.some(([a, b]) => end > a && m < b);
    if (!blocked) {
      const h = 0.14 + rand() * 0.16;
      const yBase = sy(side * 5);
      const yTop = sy(side * (5 + h));
      const y = Math.min(yBase, yTop);
      blocks.push(`<rect class="armor" x="${f1(sx(m))}" y="${f1(y)}" width="${f1((end - m) * PX_PER_M - 2)}" height="${f1(Math.abs(yTop - yBase))}" rx="1"/>`);
      if (rand() < 0.35) {
        const vx = sx(m) + 6;
        blocks.push(`<g class="vent">${range(3)
          .map((k) => `<line x1="${f1(vx + k * 4)}" y1="${f1(y + 1)}" x2="${f1(vx + k * 4)}" y2="${f1(y + Math.abs(yTop - yBase) - 1)}"/>`)
          .join("")}</g>`);
      }
    }
    m = end + 0.12;
  }
  return blocks.join("");
}

function hullSeams(): string {
  const seams: string[] = [];
  for (let m = 4; m < 40; m += 1.5) {
    const r = hullR(m);
    const ri = innerR(m);
    seams.push(`<line class="seam" x1="${f1(sx(m))}" y1="${f1(sy(r))}" x2="${f1(sx(m))}" y2="${f1(sy(ri))}"/>`);
    seams.push(`<line class="seam" x1="${f1(sx(m))}" y1="${f1(sy(-r))}" x2="${f1(sx(m))}" y2="${f1(sy(-ri))}"/>`);
  }
  const rand = seeded(83);
  for (let i = 0; i < 90; i++) {
    const m = 3 + rand() * 36.5;
    const side = rand() < 0.5 ? 1 : -1;
    const z = side * (hullR(m) - 0.12 - rand() * (WALL_M - 0.25));
    seams.push(`<circle class="rivet" cx="${f1(sx(m))}" cy="${f1(sy(z))}" r="0.9"/>`);
  }
  return seams.join("");
}

function bulkheads(): string {
  const frames: Pt[] = [
    [8.85, 9.15],
    [14.45, 14.75],
    [20.05, 20.35],
    [26.05, 26.35],
    [31.25, 31.55],
    [35.55, 35.85],
  ];
  const out = frames.map(([a, b]) => {
    const m = (a + b) / 2;
    const r = innerR(m);
    const shaft = b < 31.3;
    return `<rect class="bulkhead" x="${f1(sx(a))}" y="${f1(sy(r))}" width="${f1((b - a) * PX_PER_M)}" height="${f1(2 * r * PX_PER_M)}"/>
      <line class="bulkhead-hl" x1="${f1(sx(a) + 1)}" y1="${f1(sy(r))}" x2="${f1(sx(a) + 1)}" y2="${f1(sy(-r))}"/>
      ${shaft ? `<rect class="hatch-frame" x="${f1(sx(a) - 2)}" y="${sy(SHAFT_M) - 2}" width="${f1((b - a) * PX_PER_M + 4)}" height="${2 * SHAFT_M * PX_PER_M + 4}" rx="2"/>` : ""}`;
  });
  out.push(`<rect class="bulkhead" x="${f1(sx(17.45))}" y="${sy(-DECK_M)}" width="9" height="${f1((innerR(17.6) - DECK_M) * PX_PER_M)}"/>`);
  return out.join("");
}

function corridor(): string {
  const x0 = sx(INTERIOR_START_M);
  const x1 = sx(31.25);
  const y0 = sy(SHAFT_M);
  const y1 = sy(-SHAFT_M);
  const rungs = [];
  for (let x = x0 + 8; x < x1 - 4; x += 12) rungs.push(`<line x1="${f1(x)}" y1="${y0 + 4}" x2="${f1(x)}" y2="${y1 - 4}"/>`);
  const lights = [];
  for (let x = x0 + 40; x < x1; x += 110) lights.push(`<circle class="shaft-light" cx="${f1(x)}" cy="${y0 + 2.5}" r="1.6"/>`);
  return `<g class="shaft">
    <rect class="shaft-back" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>
    <rect class="shaft-glow" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>
    <g class="shaft-rungs">${rungs.join("")}</g>
    <line class="shaft-rail" x1="${x0}" y1="${y0 + 3.5}" x2="${x1}" y2="${y0 + 3.5}"/>
    <line class="shaft-rail" x1="${x0}" y1="${y1 - 3.5}" x2="${x1}" y2="${y1 - 3.5}"/>
    ${lights.join("")}
    <rect class="deck-plate" x="${x0}" y="${sy(DECK_M)}" width="${x1 - x0}" height="${f1((DECK_M - SHAFT_M) * PX_PER_M)}"/>
    <rect class="deck-plate" x="${x0}" y="${y1}" width="${x1 - x0}" height="${f1((DECK_M - SHAFT_M) * PX_PER_M)}"/>
  </g>`;
}

function rcsQuad(x: number, m: number, side: 1 | -1, cluster: string): string {
  const y = sy(side * hullR(m)) - side * 2;
  const out = y - side * 9;
  return `<g class="rcs">
    <rect class="rcs-body" x="${x - 9}" y="${f1(y - 4)}" width="18" height="8" rx="2"/>
    <rect class="rcs-nozzle" x="${x - 2.5}" y="${f1(side > 0 ? y - 7 : y + 3)}" width="5" height="4"/>
    <rect class="rcs-nozzle" x="${x - 12}" y="${f1(y - 2)}" width="4" height="4"/>
    <rect class="rcs-nozzle" x="${x + 8}" y="${f1(y - 2)}" width="4" height="4"/>
    <ellipse class="lv-rcs" data-cluster="${cluster}" data-kind="out" cx="${x}" cy="${f1(out - side * 5)}" rx="3.5" ry="9" opacity="0"/>
    <circle class="lv-rcs" data-cluster="${cluster}" data-kind="side" cx="${x}" cy="${f1(y)}" r="7" opacity="0"/>
  </g>`;
}

function pdcTurret(mount: number, side: 1 | -1): string {
  const x = 894;
  const base = sy(side * 5);
  const pivotY = base - side * 18;
  const plate = base - side * 12;
  return `<g class="pdc" data-mount="${mount}" style="--tint:${EQUIPMENT_TINT.pdc}">
    <path class="pdc-base" d="M${x - 18},${base} L${x + 18},${base} L${x + 12},${plate} L${x - 12},${plate} Z"/>
    <g class="lv-pdc-gun" data-cx="${x}" data-cy="${pivotY}" transform="translate(${x},${pivotY}) rotate(${side > 0 ? -145 : 145})">
      <path class="pdc-tracer" d="M60,0 H520"/>
      <rect class="pdc-barrel" x="6" y="-4.5" width="46" height="3" rx="1"/>
      <rect class="pdc-barrel" x="6" y="1.5" width="46" height="3" rx="1"/>
      <rect class="pdc-shroud" x="3" y="-6.5" width="15" height="13" rx="2.5"/>
      <path class="pdc-flash" d="M52,0 L60,-7 L62,-2 L72,0 L62,2 L60,7 Z"/>
    </g>
    <circle class="pdc-housing" cx="${x}" cy="${pivotY}" r="12"/>
    <circle class="pdc-eye" cx="${x - 5}" cy="${pivotY - side * 4}" r="2.4"/>
  </g>`;
}

function exterior(spec: CutawaySpec): string {
  const parts: string[] = [];
  const topKeepOut: Pt[] = [
    [10.9, 13.3],
    [16.1, 18.8],
    [20.6, 23.0],
    [23.8, 26.0],
  ];
  const bottomKeepOut: Pt[] = [
    [14.9, 15.6],
    [20.9, 22.8],
    [23.8, 26.0],
    [28.6, 29.4],
  ];
  parts.push(armorBlocks(1, topKeepOut), armorBlocks(-1, bottomKeepOut));

  // Trappes de lancement des missiles (dos) et d'éjection des leurres (ventre).
  parts.push(`<g class="lv-missile-hatch hatch">
    <rect class="hatch-well" x="774" y="${sy(5)}" width="60" height="4"/>
    <rect class="hatch-door door-a" style="transform-origin:774px ${sy(5)}px" x="774" y="${sy(5) - 4}" width="30" height="4"/>
    <rect class="hatch-door door-b" style="transform-origin:834px ${sy(5)}px" x="804" y="${sy(5) - 4}" width="30" height="4"/>
    <ellipse class="launch-flash" cx="804" cy="${sy(5) - 26}" rx="16" ry="24"/>
  </g>`);
  parts.push(`<g class="lv-decoy-hatch hatch hatch-ventral">
    <rect class="hatch-well" x="786" y="${sy(-5) - 4}" width="36" height="4"/>
    <rect class="hatch-door" style="transform-origin:786px ${sy(-5)}px" x="786" y="${sy(-5)}" width="36" height="4"/>
    <ellipse class="launch-flash" cx="804" cy="${sy(-5) + 24}" rx="14" ry="20"/>
  </g>`);

  // Sas extérieur.
  parts.push(`<rect class="outer-hatch" x="309" y="${f1(sy(-hullR(5.8)) - 3)}" width="30" height="5" rx="1.5"/>`);

  // Télescope IR sous dôme.
  if (spec.hasIr) {
    const cx = 510;
    const cy = sy(5) - 8;
    parts.push(`<g class="lv-ir ir" style="--tint:${EQUIPMENT_TINT.ir}">
      <path class="mount" d="M486,${sy(5)} L490,${cy} L530,${cy} L534,${sy(5)} Z"/>
      <path class="dome" d="M${cx - 26},${cy} A26,26 0 0 1 ${cx + 26},${cy} Z"/>
      <circle class="ir-aperture" cx="${cx - 9}" cy="${cy - 13}" r="7"/>
      <circle class="ir-lens" cx="${cx - 9}" cy="${cy - 13}" r="4.5"/>
      <path class="ir-shutter" d="M${cx - 20},${cy - 3} A22,22 0 0 1 ${cx + 2},${cy - 22} L${cx + 2},${cy - 16} A16,16 0 0 0 ${cx - 14},${cy - 3} Z"/>
      <path class="dome-hl" d="M${cx - 21},${cy - 6} A22,22 0 0 1 ${cx - 6},${cy - 21}"/>
    </g>`);
  }

  // Mât radar.
  const mastX = 672;
  const deckY = 290;
  const pivotY = 272;
  parts.push(`<g class="mast">
    <path class="mast-body" d="M646,${sy(5)} L698,${sy(5)} L686,${deckY + 7} L658,${deckY + 7} Z"/>
    <path class="mast-lattice" d="M652,${sy(5) - 6} L684,${deckY + 14} M692,${sy(5) - 6} L660,${deckY + 14} M650,${sy(5) - 30} H694 M654,${sy(5) - 54} H690"/>
    <rect class="mast-deck" x="650" y="${deckY}" width="44" height="7" rx="1"/>
    <path class="whip" d="M691,${deckY} L695,${deckY - 44}"/>
    <circle class="nav-strobe nav-red" cx="695" cy="${deckY - 45}" r="2.6"/>
  </g>`);
  if (spec.hasRadar) {
    parts.push(`<g class="lv-radar-beam" transform="translate(${mastX},${pivotY})" opacity="0">
      <path class="beam-wedge"/>
      ${range(3)
        .map(() => `<path class="beam-pulse"/>`)
        .join("")}
    </g>
    <g class="lv-radar-antenna" data-cx="${mastX}" data-cy="${pivotY}" transform="translate(${mastX},${pivotY}) rotate(-90)">
      <rect class="antenna-back" x="-8" y="-22" width="8" height="44" rx="2"/>
      <rect class="antenna-face" x="0" y="-21" width="3" height="42"/>
      ${range(6)
        .map((i) => `<line class="antenna-el" x1="0.5" y1="${-18 + i * 7.2}" x2="2.5" y2="${-18 + i * 7.2}"/>`)
        .join("")}
    </g>
    <circle class="antenna-hub" cx="${mastX}" cy="${pivotY}" r="4.5"/>`);
  }

  // Écoute ESM : lames d'antenne.
  if (spec.hasEsm) {
    const blades: [number, 1 | -1][] = [
      [3.3, 1],
      [15.2, -1],
      [29, -1],
    ];
    parts.push(`<g class="lv-esm">${blades
      .map(([m, side]) => {
        const x = sx(m);
        const y = sy(side * hullR(m));
        const tip = y - side * 22;
        return `<path class="esm-blade" d="M${f1(x - 2)},${f1(y)} L${f1(x + 2)},${f1(y)} L${f1(x - 1)},${f1(tip)} Z"/><circle class="esm-led" cx="${f1(x - 1)}" cy="${f1(tip)}" r="1.8"/>`;
      })
      .join("")}</g>`);
  }

  // Propulseurs d'attitude.
  parts.push(rcsQuad(sx(5.5), 5.5, 1, "bow-top"), rcsQuad(sx(5.5), 5.5, -1, "bow-bottom"), rcsQuad(sx(36), 36, 1, "stern-top"), rcsQuad(sx(36), 36, -1, "stern-bottom"));

  // Tourelles PDC.
  if (spec.pdcMountCount > 0) parts.push(pdcTurret(0, 1));
  if (spec.pdcMountCount > 1) parts.push(pdcTurret(1, -1));

  // Feux de navigation.
  parts.push(`<circle class="nav-strobe" cx="${sx(0) + 3}" cy="${AXIS_Y}" r="2.4"/>
    <circle class="nav-strobe nav-late" cx="${sx(39.9)}" cy="${f1(sy(3.8) + 3)}" r="2.2"/>
    <circle class="nav-strobe nav-late" cx="${sx(39.9)}" cy="${f1(sy(-3.8) - 3)}" r="2.2"/>`);
  return parts.join("");
}

function engineExterior(kind: EngineKind): string {
  if (kind === "fusion") {
    return `<g class="mag-nozzle">
      <path class="field-line" d="M1338,512 C1380,500 1410,470 1446,452 M1338,528 C1380,540 1410,570 1446,588 M1338,516 C1390,510 1420,496 1450,486 M1338,524 C1390,530 1420,544 1450,554"/>
      ${[1352, 1378, 1404, 1430]
        .map((x, i) => `<ellipse class="coil" cx="${x}" cy="${AXIS_Y}" rx="5" ry="${24 + i * 9}"/><ellipse class="coil-hl" cx="${x - 1}" cy="${AXIS_Y}" rx="2" ry="${22 + i * 9}"/>`)
        .join("")}
      <rect class="coil-strut" x="1340" y="${AXIS_Y - 60}" width="94" height="3"/><rect class="coil-strut" x="1340" y="${AXIS_Y + 57}" width="94" height="3"/>
    </g>`;
  }
  const bell = `M1338,506 C1378,503 1428,482 1474,452 L1474,588 C1428,558 1378,537 1338,534 Z`;
  return `<g class="bell">
    <path class="bell-shell" d="${bell}"/>
    <path class="lv-bell-heat bell-heat" d="${bell}" opacity="0"/>
    ${range(9)
      .map((i) => {
        const t = (i + 1) / 10;
        const x = 1338 + 136 * t;
        return `<line class="bell-tube" x1="${f1(x)}" y1="${f1(506 - 54 * Math.pow(t, 1.7))}" x2="${f1(x)}" y2="${f1(534 + 54 * Math.pow(t, 1.7))}"/>`;
      })
      .join("")}
    <path class="bell-rim" d="M1474,452 L1474,588"/>
    <path class="bell-hl" d="M1341,508 C1380,505 1428,486 1471,458"/>
    <ellipse class="lv-bell-heat throat-glow" cx="1340" cy="${AXIS_Y}" rx="6" ry="12" opacity="0"/>
  </g>`;
}

function plume(kind: EngineKind, originOverride?: number): string {
  const originX = originOverride ?? (kind === "fusion" ? 1440 : 1474);
  const body =
    kind === "fusion"
      ? `<ellipse cx="190" cy="0" rx="200" ry="30" fill="url(#plumeFusionOuter)"/>
         <rect x="0" y="-3.5" width="360" height="7" rx="3.5" fill="url(#plumeFusionCore)"/>
         <ellipse cx="6" cy="0" rx="14" ry="9" fill="#ffffff" opacity="0.9"/>`
      : `<ellipse cx="170" cy="0" rx="185" ry="70" fill="url(#plumeOuter)"/>
         <ellipse cx="110" cy="0" rx="125" ry="38" fill="url(#plumeCore)"/>
         ${range(4)
           .map((k) => {
             const x = 44 + k * 62;
             return `<path d="M${x - 16},0 L${x},-10 L${x + 16},0 L${x},10 Z" fill="#f4fbff" opacity="${(0.75 - k * 0.16).toFixed(2)}"/>`;
           })
           .join("")}`;
  return `<g class="lv-plume" data-x="${originX}" transform="translate(${originX},${AXIS_Y}) scale(0.3,0.5)" opacity="0" filter="url(#softGlow)"><g class="plume-flicker">${body}</g></g>`;
}

// ——— Étiquettes ——————————————————————————————————————————————————————————————

function tag(def: TagDef): string {
  const post = isPost(def.room);
  const top = def.y < AXIS_Y;
  const attachY = top ? def.y + TAG_H : def.y;
  const elbowY = top ? 346 : 700;
  const [ax, ay] = def.anchor;
  const leader = def.attachX === ax ? `${def.attachX},${attachY} ${ax},${ay}` : `${def.attachX},${attachY} ${def.attachX},${elbowY} ${ax},${ay}`;
  const title = post ? `${POST_NUMBERS[def.room as PostId]} · ${def.title.toUpperCase()}` : def.title.toUpperCase();
  return `<polyline class="leader" points="${leader}"/><circle class="leader-dot" cx="${ax}" cy="${ay}" r="3.2"/>
    <g class="tag" transform="translate(${def.x},${def.y})">
      <rect class="tag-bg" width="${def.w}" height="${TAG_H}" rx="6"/>
      <rect class="tag-edge" x="0" y="8" width="3" height="${TAG_H - 16}" rx="1.5"/>
      <circle class="room-led" cx="17" cy="19" r="${post ? 5 : 4}"/>
      <text class="tag-title" x="30" y="24">${escapeXml(title)}</text>
      <text class="room-status" x="30" y="41"></text>
      ${post ? `<text class="tag-enter" x="${def.w - 12}" y="24" text-anchor="end">ENTRER ▸</text>` : ""}
    </g>`;
}

function equipmentLabel(eq: string, title: string, x: number, y: number, anchor: "start" | "middle" | "end", leader: [Pt, Pt], tint: string): string {
  return `<g class="eqlabel" data-eq="${eq}" style="--tint:${tint}">
    <polyline class="eq-leader" points="${pts(leader)}"/>
    <text class="eq-title" x="${x}" y="${y}" text-anchor="${anchor}">${title}</text>
    <text class="eq-status" x="${x}" y="${y + 15}" text-anchor="${anchor}"></text>
  </g>`;
}

function equipmentLabels(spec: CutawaySpec, painted = false): string {
  const labels: string[] = [];
  if (spec.hasRadar)
    labels.push(
      equipmentLabel(
        "radar",
        "RADAR",
        624,
        250,
        "end",
        [
          [628, 254],
          [660, 257],
        ],
        EQUIPMENT_TINT.radar,
      ),
    );
  // Illustration : le dôme peint est plus large, le libellé passe au-dessus.
  if (spec.hasIr && painted)
    labels.push(
      equipmentLabel(
        "ir",
        "TÉLESCOPE IR",
        510,
        296,
        "middle",
        [
          [510, 315],
          [510, 330],
        ],
        EQUIPMENT_TINT.ir,
      ),
    );
  else if (spec.hasIr)
    labels.push(
      equipmentLabel(
        "ir",
        "TÉLESCOPE IR",
        548,
        326,
        "start",
        [
          [545, 331],
          [528, 342],
        ],
        EQUIPMENT_TINT.ir,
      ),
    );
  if (spec.pdcMountCount > 0)
    labels.push(
      equipmentLabel(
        "pdc-0",
        "PDC DORSALE",
        936,
        318,
        "start",
        [
          [932, 322],
          [906, 344],
        ],
        EQUIPMENT_TINT.pdc,
      ),
    );
  if (spec.pdcMountCount > 1)
    labels.push(
      equipmentLabel(
        "pdc-1",
        "PDC VENTRALE",
        936,
        712,
        "start",
        [
          [932, 708],
          [906, 696],
        ],
        EQUIPMENT_TINT.pdc,
      ),
    );
  return labels.join("");
}

// ——— Mode illustré ——————————————————————————————————————————————————————————
//
// Illustration générée avec Higgsfield (Nano Banana 2, 27/09/2026) en repeignant le dessin
// vectoriel ci-dessus, rendu sans texte ni éléments animés : même cadrage, mêmes compartiments.
// Elle couvre PAINT_BOX dans le repère de la vue. Les éléments animés sont superposés aux
// positions mesurées sur l'image (râteliers, réacteur, réservoir, tuyère…).

const PAINTING_THERMIQUE = "/art/coupe-corvette-thermique.webp";
const PAINT_BOX = { x: 100, y: 104, w: 1480, h: 832.5 };

const PAINTED = {
  missileRows: [414, 434, 454, 474],
  decoyRows: [564, 586, 607.5],
  ammo: [
    { x: 903, y0: 411, h: 76 },
    { x: 903, y0: 555, h: 75 },
  ],
  battery: { x: 962, w: 23, rows: [416.5, 430.5, 444.5, 458.5, 472.5] },
  reactor: { cx: 1009, cy: 446, r: 13 },
  fans: [
    [1048, 576],
    [1048, 609],
  ] as Pt[],
  turbos: [
    [1287, 442],
    [1287, 598],
  ] as Pt[],
  tank: { x0: 1112, x1: 1198, y0: 415, y1: 621, rx: 32 },
  scope: { cx: 632, cy: 442, r: 29 },
  bell: "M1372,503 C1400,495 1440,475 1472,452 L1472,588 C1440,565 1400,545 1372,537 Z",
  plumeX: 1472,
  radar: { cx: 674, cy: 257, base: 272 },
  irLens: [501, 343] as Pt,
  esm: [
    [247, 411],
    [606, 691],
    [1019.5, 691],
  ] as Pt[],
  rcs: [
    ["bow-top", 316, 398, 1],
    ["bow-bottom", 316, 643, -1],
    ["stern-top", 1230, 374, 1],
    ["stern-bottom", 1230, 665, -1],
  ] as [string, number, number, 1 | -1][],
  strobes: [
    [151, 517, ""],
    [706.5, 230, "nav-red"],
    [1348, 410, "nav-late"],
    [1348, 630, "nav-late"],
  ] as [number, number, string][],
};

/** L'illustration ne représente qu'une configuration : sinon, on garde le dessin vectoriel. */
export function paintingFor(spec: CutawaySpec): string | undefined {
  const matches = spec.engineKind === "thermique" && spec.pdcMountCount === 2 && spec.hasRadar && spec.hasIr && spec.hasEsm && spec.missileSlots <= 4 && spec.decoySlots <= 3;
  return matches ? PAINTING_THERMIQUE : undefined;
}

function blurDisc(cls: string, [cx, cy]: Pt, r: number): string {
  return `<g class="${cls}" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#rotorBlur)"/>${range(3)
    .map((k) => `<path class="rotor-streak" d="M${cx},${cy} L${f1(cx + r * Math.cos((k * 2 * Math.PI) / 3))},${f1(cy + r * Math.sin((k * 2 * Math.PI) / 3))}"/>`)
    .join("")}</g>`;
}

function paintedLive(id: RoomId, spec: CutawaySpec): string {
  switch (id) {
    case "detection": {
      const { cx, cy, r } = PAINTED.scope;
      return `<g class="scope" data-cx="${cx}" data-cy="${cy}" data-r="${r}">
        <g class="lv-scope-sweep" transform="translate(${cx},${cy})"><path class="scope-sweep" d="M0,0 L${r},0 A${r},${r} 0 0,0 ${f1(r * Math.cos(0.52))},${f1(-r * Math.sin(0.52))} Z"/></g>
        ${scopeBlips()}
      </g>`;
    }
    case "missiles":
      return `${PAINTED.missileRows
        .slice(0, Math.max(1, spec.missileSlots))
        .map((y, i) => missileShape(789, y, 94, i, false))
        .join("")}${paintedAmmo(0)}`;
    case "leurres":
      return `${PAINTED.decoyRows
        .slice(0, Math.max(1, spec.decoySlots))
        .map((y, i) => decoyShape(790, y, 92, i, false))
        .join("")}${paintedAmmo(1)}`;
    case "ingenierie": {
      const { cx, cy, r } = PAINTED.reactor;
      const { x, w, rows } = PAINTED.battery;
      return `<circle class="lv-reactor-core glow-screen" cx="${cx}" cy="${cy}" r="${r + 6}" fill="url(#coreGlowWarm)"/>
        ${rows.map((y, i) => `<rect class="lv-battery-cell battery-led" data-index="${i}" data-x0="${x}" data-w="${w}" x="${x}" y="${f1(y - 2)}" width="${w}" height="4" rx="1"/>`).join("")}`;
    }
    case "vie":
      return PAINTED.fans.map((c) => blurDisc("fan-blur", c, 13)).join("");
    case "propergol": {
      const { x0, x1, y0, y1, rx } = PAINTED.tank;
      return `<clipPath id="tankClip"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${rx}"/></clipPath>
        <g clip-path="url(#tankClip)">
          <rect class="lv-prop-fill prop-painted" data-x0="${x0}" data-w="${x1 - x0}" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="url(#propellant)"/>
          <g class="lv-prop-surface" transform="translate(${x0},0)"><path class="prop-surface" d="M0,${y0} ${range(12)
            .map((i) => `Q${i % 2 === 0 ? 3 : -3},${f1(y0 + (i + 0.5) * ((y1 - y0) / 12))} 0,${f1(y0 + (i + 1) * ((y1 - y0) / 12))}`)
            .join(" ")}"/></g>
        </g>`;
    }
    case "moteur":
      return `<ellipse class="lv-engine-core glow-screen" cx="1289" cy="520" rx="30" ry="50" fill="url(#coreGlowHot)"/>
        ${PAINTED.turbos.map((c) => blurDisc("turbo-blur", c, 14)).join("")}`;
    default:
      return "";
  }
}

function paintedAmmo(mount: number): string {
  const { x, y0, h } = PAINTED.ammo[mount];
  return `<rect class="lv-pdc-ammo" data-mount="${mount}" data-y0="${y0}" data-h="${h}" x="${x}" y="${y0}" width="8" height="${h}" rx="1.5"/>`;
}

function paintedRoom(def: RoomDef, spec: CutawaySpec, tagDef: TagDef | undefined): string {
  const tint = TINTS[def.id];
  const p = pts(roomPolygon(def));
  const post = isPost(def.id);
  const attrs = post
    ? `class="room room-post" data-room="${def.id}" tabindex="0" role="button" aria-label="Entrer dans le poste ${tagDef?.title ?? def.id}"`
    : `class="room room-secondary" data-room="${def.id}"`;
  return `<g ${attrs} style="--tint:${tint}">
    <polygon class="room-hit" points="${p}"/>
    <polygon class="room-glow" points="${p}"/>
    <g class="room-content">${paintedLive(def.id, spec)}</g>
    <polygon class="room-dark" points="${p}"/>
    <polygon class="room-alarm" points="${p}"/>
    <polygon class="room-outline" points="${p}"/>
    ${tagDef ? tag(tagDef) : ""}
  </g>`;
}

function paintedExterior(spec: CutawaySpec): string {
  const parts: string[] = [];
  parts.push(`<path class="lv-bell-heat bell-heat glow-screen" d="${PAINTED.bell}" opacity="0"/>
    <ellipse class="lv-bell-heat throat-glow" cx="1370" cy="${AXIS_Y}" rx="5" ry="12" opacity="0"/>`);
  parts.push(`<g class="lv-missile-hatch hatch">
    <rect class="hatch-door door-a" style="transform-origin:774px ${sy(5)}px" x="774" y="${sy(5) - 4}" width="30" height="4"/>
    <rect class="hatch-door door-b" style="transform-origin:834px ${sy(5)}px" x="804" y="${sy(5) - 4}" width="30" height="4"/>
    <ellipse class="launch-flash" cx="804" cy="${sy(5) - 26}" rx="16" ry="24"/>
  </g>
  <g class="lv-decoy-hatch hatch hatch-ventral">
    <rect class="hatch-door" style="transform-origin:786px ${sy(-5)}px" x="786" y="${sy(-5)}" width="36" height="4"/>
    <ellipse class="launch-flash" cx="804" cy="${sy(-5) + 24}" rx="14" ry="20"/>
  </g>`);
  if (spec.hasIr) {
    const [x, y] = PAINTED.irLens;
    parts.push(`<g class="lv-ir ir"><circle class="ir-lens ir-lens-painted" cx="${x}" cy="${y}" r="5"/></g>`);
  }
  if (spec.hasRadar) {
    const { cx, cy, base } = PAINTED.radar;
    parts.push(`<g class="lv-radar-beam" transform="translate(${cx},${cy})" opacity="0"><path class="beam-wedge"/>${range(3)
      .map(() => `<path class="beam-pulse"/>`)
      .join("")}</g>
    <rect class="antenna-pole" x="${cx - 2}" y="${cy}" width="4" height="${base - cy}"/>
    <g class="lv-radar-antenna" data-cx="${cx}" data-cy="${cy}" transform="translate(${cx},${cy}) rotate(-90)">
      <rect class="antenna-back" x="-7" y="-17" width="7" height="34" rx="1.5"/>
      <rect class="antenna-face" x="0" y="-16" width="2.5" height="32"/>
      ${range(5)
        .map((i) => `<line class="antenna-el" x1="0.5" y1="${-13 + i * 6.5}" x2="2" y2="${-13 + i * 6.5}"/>`)
        .join("")}
    </g>
    <circle class="antenna-hub" cx="${cx}" cy="${cy}" r="3.5"/>`);
  }
  if (spec.hasEsm) parts.push(`<g class="lv-esm">${PAINTED.esm.map(([x, y]) => `<circle class="esm-led" cx="${x}" cy="${y}" r="1.8"/>`).join("")}</g>`);
  for (const [cluster, x, y, side] of PAINTED.rcs) {
    parts.push(`<ellipse class="lv-rcs" data-cluster="${cluster}" data-kind="out" cx="${x}" cy="${y - side * 14}" rx="3.5" ry="9" opacity="0"/>
      <circle class="lv-rcs" data-cluster="${cluster}" data-kind="side" cx="${x}" cy="${y}" r="7" opacity="0"/>`);
  }
  if (spec.pdcMountCount > 0) parts.push(paintedGun(0, 1));
  if (spec.pdcMountCount > 1) parts.push(paintedGun(1, -1));
  parts.push(PAINTED.strobes.map(([x, y, cls]) => `<circle class="nav-strobe ${cls}" cx="${x}" cy="${y}" r="2.2"/>`).join(""));
  return parts.join("");
}

/** Canons de la tourelle, montés sur la boule peinte. */
function paintedGun(mount: number, side: 1 | -1): string {
  const x = 894;
  const pivotY = side > 0 ? 352 : 688;
  return `<g class="pdc" data-mount="${mount}">
    <g class="lv-pdc-gun" data-cx="${x}" data-cy="${pivotY}" transform="translate(${x},${pivotY}) rotate(${side > 0 ? -145 : 145})">
      <path class="pdc-tracer" d="M60,0 H520"/>
      <rect class="pdc-barrel" x="8" y="-3.5" width="44" height="2.6" rx="1"/>
      <rect class="pdc-barrel" x="8" y="0.9" width="44" height="2.6" rx="1"/>
      <rect class="pdc-shroud" x="6" y="-5" width="13" height="10" rx="2"/>
      <path class="pdc-flash" d="M52,0 L60,-7 L62,-2 L72,0 L62,2 L60,7 Z"/>
    </g>
  </g>`;
}

// ——— Assemblage ——————————————————————————————————————————————————————————————

function room(def: RoomDef, spec: CutawaySpec, tagDef: TagDef | undefined): string {
  const tint = def.id === "moteur" && spec.engineKind === "fusion" ? FUSION_TINT : TINTS[def.id];
  const p = roomPolygon(def);
  const b = inset(p, DEPTH_PX);
  const post = isPost(def.id);
  const attrs = post
    ? `class="room room-post" data-room="${def.id}" tabindex="0" role="button" aria-label="Entrer dans le poste ${tagDef?.title ?? def.id}"`
    : `class="room room-secondary" data-room="${def.id}"`;
  return `<g ${attrs} style="--tint:${tint}">
    <linearGradient id="light-${def.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${tint}" stop-opacity="0.5"/><stop offset="0.35" stop-color="${tint}" stop-opacity="0.16"/><stop offset="1" stop-color="${tint}" stop-opacity="0.06"/>
    </linearGradient>
    <polygon class="room-back" points="${pts(b)}"/>
    <polygon class="room-light" points="${pts(b)}" fill="url(#light-${def.id})"/>
    ${roomFaces(p, b)}
    <g class="room-content">${furnishing(def.id, spec)}</g>
    <polygon class="room-dark" points="${pts(p)}"/>
    <polygon class="room-alarm" points="${pts(p)}"/>
    <polygon class="room-outline" points="${pts(p)}"/>
    ${tagDef ? tag(tagDef) : ""}
  </g>`;
}

function defs(): string {
  return `<defs>
    <linearGradient id="hullSkin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8793a1"/><stop offset="0.06" stop-color="#56616e"/><stop offset="0.2" stop-color="#3a434e"/>
      <stop offset="0.5" stop-color="#262d36"/><stop offset="0.8" stop-color="#2c343e"/><stop offset="0.94" stop-color="#3a434e"/><stop offset="1" stop-color="#1a1f26"/>
    </linearGradient>
    <linearGradient id="propellant" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#a9dcff" stop-opacity="0.75"/><stop offset="0.5" stop-color="#5fa6e8" stop-opacity="0.7"/><stop offset="1" stop-color="#2f6fb8" stop-opacity="0.75"/>
    </linearGradient>
    <linearGradient id="ntrCore" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff7a2e"/><stop offset="0.5" stop-color="#fff2c4"/><stop offset="1" stop-color="#ff7a2e"/>
    </linearGradient>
    <radialGradient id="coreGlowWarm"><stop offset="0" stop-color="#fffbe8"/><stop offset="0.35" stop-color="#ffc56b" stop-opacity="0.9"/><stop offset="1" stop-color="#ff7a2e" stop-opacity="0"/></radialGradient>
    <radialGradient id="coreGlowHot"><stop offset="0" stop-color="#fff6d8"/><stop offset="0.4" stop-color="#ff9a3c" stop-opacity="0.85"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>
    <radialGradient id="rotorBlur"><stop offset="0" stop-color="#c9d2dc" stop-opacity="0.15"/><stop offset="0.7" stop-color="#9aa6b4" stop-opacity="0.45"/><stop offset="1" stop-color="#9aa6b4" stop-opacity="0.1"/></radialGradient>
    <linearGradient id="cylBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f8fa"/><stop offset="0.3" stop-color="#d9dfe5"/><stop offset="0.75" stop-color="#8e99a6"/><stop offset="1" stop-color="#58626e"/></linearGradient>
    <linearGradient id="cylRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a8a"/><stop offset="0.4" stop-color="#e2463a"/><stop offset="1" stop-color="#7c1d16"/></linearGradient>
    <linearGradient id="cylViolet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8c2ff"/><stop offset="0.45" stop-color="#9a64f0"/><stop offset="1" stop-color="#4c2a8a"/></linearGradient>
    <linearGradient id="gunMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c4cf"/><stop offset="0.5" stop-color="#6b7683"/><stop offset="1" stop-color="#2a313a"/></linearGradient>
    <radialGradient id="coreGlow"><stop offset="0" stop-color="#f4feff"/><stop offset="0.45" stop-color="#72e6ff"/><stop offset="1" stop-color="#0c3a52" stop-opacity="0.2"/></radialGradient>
    <radialGradient id="plumeOuter" cx="0.1" cy="0.5" r="0.9"><stop offset="0" stop-color="#bfeaff" stop-opacity="0.7"/><stop offset="0.45" stop-color="#4f8dff" stop-opacity="0.28"/><stop offset="1" stop-color="#2d5bff" stop-opacity="0"/></radialGradient>
    <radialGradient id="plumeCore" cx="0.05" cy="0.5" r="0.95"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.35" stop-color="#a8e4ff" stop-opacity="0.75"/><stop offset="1" stop-color="#5a8cff" stop-opacity="0"/></radialGradient>
    <radialGradient id="plumeFusionOuter" cx="0.05" cy="0.5" r="0.95"><stop offset="0" stop-color="#e7d6ff" stop-opacity="0.75"/><stop offset="0.4" stop-color="#9b6bff" stop-opacity="0.3"/><stop offset="1" stop-color="#6b3bff" stop-opacity="0"/></radialGradient>
    <linearGradient id="plumeFusionCore" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#d9c8ff" stop-opacity="0.8"/><stop offset="1" stop-color="#9b6bff" stop-opacity="0"/></linearGradient>
    <linearGradient id="bellShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aa6b4"/><stop offset="0.35" stop-color="#6b7683"/><stop offset="1" stop-color="#2a313a"/></linearGradient>
    <linearGradient id="bellHeat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd27a"/><stop offset="0.5" stop-color="#ff7b2e"/><stop offset="1" stop-color="#c2331b" stop-opacity="0.5"/></linearGradient>
    <radialGradient id="beamFill" cx="0" cy="0.5" r="1"><stop offset="0" stop-color="#ffd166" stop-opacity="0.45"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient>
    <radialGradient id="nebulaA"><stop offset="0" stop-color="#2a3f8f" stop-opacity="0.22"/><stop offset="1" stop-color="#2a3f8f" stop-opacity="0"/></radialGradient>
    <radialGradient id="nebulaB"><stop offset="0" stop-color="#5b2a8f" stop-opacity="0.16"/><stop offset="1" stop-color="#5b2a8f" stop-opacity="0"/></radialGradient>
    <pattern id="grating" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0,3 H6 M3,0 V6" stroke="#0b0f14" stroke-width="1"/></pattern>
    <pattern id="ribs" width="30" height="12" patternUnits="userSpaceOnUse"><path d="M0,0 V12" stroke="#222a34" stroke-width="3"/><path d="M15,0 V12" stroke="#161c23" stroke-width="1"/></pattern>
    <pattern id="hazard" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="10" fill="#d9a321"/><rect x="5" width="5" height="10" fill="#15181c"/></pattern>
    <filter id="softGlow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="hullShadow" x="-10%" y="-20%" width="120%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.8"/></filter>
  </defs>`;
}

function vectorShip(spec: CutawaySpec, tags: TagDef[], hull: string, rimTop: string, rimBottom: string, interior: Pt[]): string {
  return `${plume(spec.engineKind)}
  <g filter="url(#hullShadow)">
    <path class="hull-skin" d="${hull}"/>
  </g>
  <path class="lv-hull-heat hull-heat" d="${hull}" opacity="0"/>
  <polyline class="hull-rim" points="${rimTop}"/>
  <polyline class="hull-rim hull-rim-bottom" points="${rimBottom}"/>
  <g class="seams">${hullSeams()}</g>
  <path class="nose-cap" d="M${sx(0)},${AXIS_Y} L${f1(sx(0.4))},${f1(sy(0.8))} L${f1(sx(1.2))},${f1(sy(1.7))} L${f1(sx(1.6))},${f1(sy(0))} L${f1(sx(1.2))},${f1(sy(-1.7))} L${f1(sx(0.4))},${f1(sy(-0.8))} Z"/>
  ${engineExterior(spec.engineKind)}
  ${exterior(spec)}

  <path class="structure" d="${pathOf(interior)}"/>
  <path class="structure-ribs" d="${pathOf(interior)}"/>
  ${corridor()}
  ${bulkheads()}
  <path class="cut-edge" d="${pathOf(interior)}"/>

  ${equipmentLabels(spec)}
  ${ROOMS.filter((r) => !isPost(r.id))
    .map((r) => room(r, spec, tags.find((t) => t.room === r.id)))
    .join("")}
  ${ROOMS.filter((r) => isPost(r.id))
    .map((r) => room(r, spec, tags.find((t) => t.room === r.id)))
    .join("")}`;
}

export function buildCutawaySvg(spec: CutawaySpec): string {
  screenCounter = 0;
  const tags = tagDefs(spec);
  const painting = paintingFor(spec);
  const hullTop = HULL_PROFILE.map(([m, r]) => [sx(m), sy(r)] as Pt);
  const hullBottom = [...HULL_PROFILE].reverse().map(([m, r]) => [sx(m), sy(-r)] as Pt);
  const interiorMs = [INTERIOR_START_M, ...BREAKS.filter((m) => m > INTERIOR_START_M && m < INTERIOR_END_M), INTERIOR_END_M];
  const interior = [...interiorMs.map((m) => [sx(m), sy(innerR(m))] as Pt), ...[...interiorMs].reverse().map((m) => [sx(m), sy(-innerR(m))] as Pt)];
  const rimTop = hullTop.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ");
  const rimBottom = hullBottom.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ");
  const design = spec.designName ? `${escapeXml(spec.designName.toUpperCase())} · ` : "";

  const hull = pathOf([...hullTop, ...hullBottom]);
  const ship = painting
    ? `<image class="painting" href="${painting}" x="${PAINT_BOX.x}" y="${PAINT_BOX.y}" width="${PAINT_BOX.w}" height="${PAINT_BOX.h}" preserveAspectRatio="none"/>
  ${plume(spec.engineKind, PAINTED.plumeX)}
  <path class="lv-hull-heat hull-heat" d="${hull}" opacity="0"/>
  ${paintedExterior(spec)}
  ${equipmentLabels(spec, true)}
  ${ROOMS.filter((r) => !isPost(r.id))
    .map((r) => paintedRoom(r, spec, tags.find((t) => t.room === r.id)))
    .join("")}
  ${ROOMS.filter((r) => isPost(r.id))
    .map((r) => paintedRoom(r, spec, tags.find((t) => t.room === r.id)))
    .join("")}`
    : vectorShip(spec, tags, hull, rimTop, rimBottom, interior);

  return `<svg class="cutaway-svg${painting ? " painted" : ""}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  ${defs()}
  ${
    painting
      ? `<rect class="paint-backdrop" x="-400" y="-400" width="${VIEW_W + 800}" height="${VIEW_H + 800}"/>`
      : `<ellipse cx="520" cy="300" rx="620" ry="260" fill="url(#nebulaA)"/>
  <ellipse cx="1420" cy="760" rx="520" ry="240" fill="url(#nebulaB)"/>`
  }
  ${starfield()}

  <g class="title-block" transform="translate(40,58)">
    <text class="tb-name">${escapeXml(spec.shipName.toUpperCase())}</text>
    <text class="tb-sub" y="28">${design}VUE EN COUPE LONGITUDINALE</text>
  </g>
  <g class="scale-bar" transform="translate(1460,46)">
    <text class="tb-sub" x="0" y="-8">ÉCHELLE</text>
    <rect x="0" y="0" width="150" height="5" class="sb-dark"/><rect x="150" y="0" width="150" height="5" class="sb-light"/>
    ${[0, 5, 10].map((m) => `<text class="sb-label" x="${m * PX_PER_M}" y="22" text-anchor="middle">${m}</text>`).join("")}
    <text class="sb-label" x="312" y="5" >m</text>
  </g>

  ${ship}

  <g class="footer" transform="translate(40,872)">
    <text class="ft-head">ÉTAT DU NAVIRE</text>
    <line x1="0" y1="10" x2="560" y2="10" class="ft-rule"/>
    <text class="ft-line lv-foot" y="34"></text>
    <text class="ft-line lv-foot" y="56"></text>
    <text class="ft-line ft-line-fleet lv-foot" y="78"></text>
  </g>
  <g class="hint" transform="translate(1760,906)">
    <text text-anchor="end">Cliquez un poste pour y entrer · touches 1–4 · Échap pour revenir</text>
    <text y="22" text-anchor="end">◀ PROUE   POUPE ▶ · sous poussée, l'équipage est plaqué dans son siège vers la poupe</text>
  </g>
</svg>`;
}
