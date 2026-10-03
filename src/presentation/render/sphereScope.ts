import * as THREE from "three";
import type { FriendlyContact, Track } from "../../knowledge/types";
import { el } from "../dom";

export type ContactTone = "recent" | "extrapolated" | "lost" | "missile" | "decoy" | "ally" | "ally-down" | "cpa" | "tick";

/** Un objet à signaler dans la vue — toujours issu de la connaissance du joueur (piste) ou de ses propres missiles. */
export interface ScopeContact {
  id: string;
  label: string;
  worldPoint: THREE.Vector3;
  detail: string;
  tone: ContactTone;
  /** Gisement seul : le point n'est qu'une direction, jamais une position. */
  bearingOnly: boolean;
  selectable: boolean;
  /** Repère purement graphique (graduation, point calculé) : pas de flèche de bord hors champ. */
  hideWhenOffscreen?: boolean;
}

const EDGE_MARGIN_PX = 34;
const MIN_DISTANCE_METERS = 150;
const DEFAULT_DISTANCE_FACTOR = 2.5;
const MAX_DISTANCE_FACTOR = 8;

interface MarkerEntry {
  root: HTMLElement;
  label: HTMLElement;
  detail: HTMLElement;
}

/** Contacts issus des pistes de l'observateur — un gisement seul est placé sur la sphère, sans distance. */
export function trackContacts(tracks: readonly Track[], ownPosition: THREE.Vector3, radiusMeters: number): ScopeContact[] {
  return tracks.map((track) => {
    const bearingOnly = !track.positionEstimateWorld;
    const worldPoint = track.positionEstimateWorld
      ? track.positionEstimateWorld.clone()
      : ownPosition.clone().addScaledVector(track.bearingEstimateWorld, radiusMeters);
    const detail = track.positionEstimateWorld
      ? `${(track.positionEstimateWorld.distanceTo(ownPosition) / 1000).toFixed(1)} km`
      : "gisement seul";
    return { id: track.localId, label: track.localId, worldPoint, detail, tone: track.state, bearingOnly, selectable: true };
  });
}

/** Alliés connus par liaison de données — position exacte, jamais sélectionnables comme cible. */
export function friendlyContacts(friendlies: readonly FriendlyContact[], ownPosition: THREE.Vector3): ScopeContact[] {
  return friendlies.map((friend) => ({
    id: `ami:${friend.id}`,
    label: friend.name,
    worldPoint: friend.positionWorld.clone(),
    detail: friend.neutralized ? "hors de combat" : `${(friend.positionWorld.distanceTo(ownPosition) / 1000).toFixed(1)} km · liaison`,
    tone: friend.neutralized ? "ally-down" : "ally",
    bearingOnly: false,
    selectable: false,
  }));
}

/** Sphère filaire unité : méridiens, parallèles, équateur plus marqué. */
function buildSphereWire(): THREE.Group {
  const group = new THREE.Group();
  const segments = 96;
  const lines: number[] = [];
  const equator: number[] = [];
  for (let m = 0; m < 12; m++) {
    const lon = (m / 12) * Math.PI * 2;
    for (let i = 0; i < segments; i++) {
      const a0 = -Math.PI / 2 + (i / segments) * Math.PI;
      const a1 = -Math.PI / 2 + ((i + 1) / segments) * Math.PI;
      lines.push(Math.cos(a0) * Math.sin(lon), Math.sin(a0), Math.cos(a0) * Math.cos(lon));
      lines.push(Math.cos(a1) * Math.sin(lon), Math.sin(a1), Math.cos(a1) * Math.cos(lon));
    }
  }
  for (const latDeg of [-60, -30, 30, 60, 0]) {
    const lat = THREE.MathUtils.degToRad(latDeg);
    const target = latDeg === 0 ? equator : lines;
    for (let i = 0; i < segments; i++) {
      const b0 = (i / segments) * Math.PI * 2;
      const b1 = ((i + 1) / segments) * Math.PI * 2;
      target.push(Math.cos(lat) * Math.sin(b0), Math.sin(lat), Math.cos(lat) * Math.cos(b0));
      target.push(Math.cos(lat) * Math.sin(b1), Math.sin(lat), Math.cos(lat) * Math.cos(b1));
    }
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  group.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x2a7f96, transparent: true, opacity: 0.28 })));
  const equatorGeometry = new THREE.BufferGeometry();
  equatorGeometry.setAttribute("position", new THREE.Float32BufferAttribute(equator, 3));
  group.add(new THREE.LineSegments(equatorGeometry, new THREE.LineBasicMaterial({ color: 0x37d4ff, transparent: true, opacity: 0.6 })));
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x37d4ff, transparent: true, opacity: 0.035, side: THREE.BackSide, depthWrite: false }),
  );
  shell.name = "shell";
  group.add(shell);
  return group;
}

/**
 * Vue 3D unique centrée sur le vaisseau (Détection, Tactique, Pilotage) : sphère de la zone d'engagement
 * (portée du radar actif), caméra orbitale, étiquettes sur les contacts visibles et flèches au
 * bord de l'écran vers ceux qui sont hors champ.
 */
export class SphereScope {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 1, 1e7);
  readonly element: HTMLElement;

  /** `null` si WebGL est indisponible : la vue affiche un message, le poste reste utilisable. */
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly sphere: THREE.Group;
  private readonly bearingLabels: { el: HTMLElement; direction: THREE.Vector3 }[] = [];
  private readonly markers = new Map<string, MarkerEntry>();
  private radiusMeters = 10000;
  private yaw = THREE.MathUtils.degToRad(35);
  private pitch = THREE.MathUtils.degToRad(28);
  private distance = 25000;
  private width = 1;
  private height = 1;
  private selectedId: string | null = null;
  private radiusSet = false;

  constructor(private readonly onSelect: (id: string) => void) {
    this.element = el("div", "sphere-scope");
    this.canvas = el("canvas", "sphere-scope-canvas");
    this.overlay = el("div", "sphere-scope-overlay");
    this.element.append(this.canvas, this.overlay);
    // Les commandes de vue sont à la souris uniquement (plus de boutons − / + / Recentrer).
    this.overlay.appendChild(el("div", "scope-hint", "Glisser : tourner · molette : zoom · double-clic : recentrer · clic sur un contact : sélection"));

    this.renderer = createRenderer(this.canvas);
    if (!this.renderer) this.overlay.appendChild(el("div", "scope-unavailable", "Affichage 3D indisponible : WebGL n'est pas activé dans ce navigateur."));
    this.scene.background = new THREE.Color(0x04080c);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
    this.sphere = buildSphereWire();
    this.scene.add(this.sphere);

    for (const [label, deg] of [
      ["000", 0],
      ["090", 90],
      ["180", 180],
      ["270", 270],
    ] as const) {
      const rad = THREE.MathUtils.degToRad(deg);
      const node = el("div", "scope-bearing", label);
      this.overlay.appendChild(node);
      this.bearingLabels.push({ el: node, direction: new THREE.Vector3(Math.sin(rad), 0, Math.cos(rad)) });
    }

    this.installControls();
  }

  setRadius(meters: number): void {
    if (this.radiusSet && meters === this.radiusMeters) return;
    const firstTime = !this.radiusSet;
    this.radiusSet = true;
    this.radiusMeters = meters;
    this.sphere.scale.setScalar(meters);
    if (firstTime) this.distance = meters * DEFAULT_DISTANCE_FACTOR;
  }

  get radius(): number {
    return this.radiusMeters;
  }

  /** Distance caméra–centre : sert à dimensionner les maillages pour qu'ils restent lisibles. */
  get cameraDistance(): number {
    return this.distance;
  }

  /** Radar actif en balayage large : toute la sphère est « éclairée » (le cône n'a plus de sens). */
  setShellEmitting(emitting: boolean): void {
    const shell = this.sphere.getObjectByName("shell") as THREE.Mesh;
    const material = shell.material as THREE.MeshBasicMaterial;
    material.color.setHex(emitting ? 0xff5c5c : 0x37d4ff);
    material.opacity = emitting ? 0.06 : 0.035;
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  zoom(factor: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * factor, MIN_DISTANCE_METERS, this.radiusMeters * MAX_DISTANCE_FACTOR);
  }

  resetView(): void {
    this.yaw = THREE.MathUtils.degToRad(35);
    this.pitch = THREE.MathUtils.degToRad(28);
    this.distance = this.radiusMeters * DEFAULT_DISTANCE_FACTOR;
  }

  resize(): void {
    this.width = Math.max(1, this.element.clientWidth);
    this.height = Math.max(1, this.element.clientHeight);
    this.renderer?.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  render(center: THREE.Vector3, contacts: ScopeContact[]): void {
    if (this.width <= 1 || this.height <= 1) this.resize();
    this.sphere.position.copy(center);
    const offset = new THREE.Vector3(
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.cos(this.yaw),
    ).multiplyScalar(this.distance);
    this.camera.position.copy(center).add(offset);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.near = Math.max(1, this.distance / 1000);
    this.camera.far = this.distance + this.radiusMeters * 20;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer?.render(this.scene, this.camera);

    for (const { el: node, direction } of this.bearingLabels) {
      const screen = this.project(center.clone().addScaledVector(direction, this.radiusMeters * 1.04));
      node.style.display = screen.onScreen ? "" : "none";
      if (screen.onScreen) node.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
    }

    const seen = new Set<string>();
    for (const contact of contacts) {
      seen.add(contact.id);
      this.placeMarker(contact);
    }
    for (const [id, entry] of this.markers) {
      if (!seen.has(id)) {
        entry.root.remove();
        this.markers.delete(id);
      }
    }
  }

  private project(point: THREE.Vector3): { x: number; y: number; ndcX: number; ndcY: number; behind: boolean; onScreen: boolean } {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const behind = point.clone().sub(this.camera.position).dot(forward) <= 0;
    const ndc = point.clone().project(this.camera);
    const onScreen = !behind && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    return { x: ((ndc.x + 1) / 2) * this.width, y: ((1 - ndc.y) / 2) * this.height, ndcX: ndc.x, ndcY: ndc.y, behind, onScreen };
  }

  private placeMarker(contact: ScopeContact): void {
    let entry = this.markers.get(contact.id);
    if (!entry) {
      const root = el("div", "scope-marker");
      root.appendChild(el("span", "scope-marker-glyph"));
      const text = el("span", "scope-marker-text");
      const label = el("span", "scope-marker-label");
      const detail = el("span", "scope-marker-detail");
      text.append(label, detail);
      root.appendChild(text);
      if (contact.selectable) {
        root.classList.add("is-selectable");
        root.addEventListener("click", (event) => {
          event.stopPropagation();
          this.onSelect(contact.id);
        });
      }
      this.overlay.appendChild(root);
      entry = { root, label, detail };
      this.markers.set(contact.id, entry);
    }

    entry.label.textContent = contact.label;
    entry.detail.textContent = contact.detail;
    entry.root.dataset.tone = contact.tone;
    entry.root.classList.toggle("is-bearing-only", contact.bearingOnly);
    entry.root.classList.toggle("is-selected", contact.id === this.selectedId);

    const p = this.project(contact.worldPoint);
    entry.root.style.display = !p.onScreen && contact.hideWhenOffscreen ? "none" : "";
    if (p.onScreen) {
      entry.root.classList.remove("is-edge");
      this.placeAt(entry.root, p.x, p.y);
      entry.root.style.setProperty("--arrow-angle", "0deg");
      return;
    }

    // Hors champ : flèche sur le bord, orientée vers le contact (direction inversée s'il est derrière).
    let dx = p.ndcX * (this.width / 2);
    let dy = -p.ndcY * (this.height / 2);
    if (p.behind) {
      dx = -dx;
      dy = -dy;
    }
    if (Math.hypot(dx, dy) < 1e-6) dy = 1;
    const halfW = this.width / 2 - EDGE_MARGIN_PX;
    const halfH = this.height / 2 - EDGE_MARGIN_PX;
    const t = Math.min(halfW / Math.max(1e-6, Math.abs(dx)), halfH / Math.max(1e-6, Math.abs(dy)));
    const x = this.width / 2 + dx * t;
    const y = this.height / 2 + dy * t;
    entry.root.classList.add("is-edge");
    this.placeAt(entry.root, x, y);
    entry.root.style.setProperty("--arrow-angle", `${Math.atan2(dy, dx)}rad`);
  }

  /** Place le repère et range son étiquette du côté intérieur de l'écran. */
  private placeAt(root: HTMLElement, x: number, y: number): void {
    root.style.transform = `translate(${x}px, ${y}px)`;
    root.classList.toggle("is-text-left", x > this.width - 180);
    root.classList.toggle("is-text-up", y > this.height - 60);
  }

  private installControls(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    this.canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      this.yaw -= (event.clientX - lastX) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (event.clientY - lastY) * 0.006, -1.45, 1.45);
      lastX = event.clientX;
      lastY = event.clientY;
    });
    const stop = () => {
      dragging = false;
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoom(Math.exp(event.deltaY * 0.0012));
      },
      { passive: false },
    );
    this.canvas.addEventListener("dblclick", () => this.resetView());
  }

  dispose(): void {
    this.renderer?.dispose();
    this.element.remove();
  }
}

function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    return renderer;
  } catch {
    return null;
  }
}
