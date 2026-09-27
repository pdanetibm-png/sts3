import * as THREE from "three";
import type { RigidBody } from "../../sim/rigidBody";
import type { SimulationWorld } from "../../sim/world";
import type { ReplayRecorder } from "../../sim/replay";
import { downloadReplayExport } from "../diagnosticExport";
import { el } from "../dom";
import { MultiViewRenderer, centerOrthoCamera, centerPerspectiveCamera, type ViewportDef } from "../render/scene";
import { buildReferenceGrid, ShipVisual } from "../render/shipMesh";
import type { ConsolePanel } from "./consoleTypes";

const AFFILIATION_COLOR: Record<RigidBody["affiliation"], number> = {
  joueur: 0x4fd67a,
  allie: 0x9be66b,
  adversaire: 0xff5c5c,
};

const DECOY_COLOR: Record<RigidBody["affiliation"], number> = {
  joueur: 0xc792ff,
  allie: 0xc792ff,
  adversaire: 0xffa3c8,
};

/**
 * Carte maître (section 11, DBG-01) : lit directement la couche vérité et affiche tous
 * les corps réels, y compris non détectés. Disponible uniquement en mode test.
 */
export class MasterMapConsole implements ConsolePanel {
  readonly element: HTMLElement;

  private readonly world: SimulationWorld;
  private readonly renderer: MultiViewRenderer;
  private readonly viewportContainer: HTMLElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly topCamera: THREE.OrthographicCamera;
  private readonly visuals = new Map<string, ShipVisual>();
  private readonly decoyVisuals = new Map<string, ShipVisual>();
  private readonly table: HTMLElement;
  private readonly diagStatus: HTMLElement;
  private halfExtentMeters = 15000;

  constructor(world: SimulationWorld, recorder: ReplayRecorder) {
    this.world = world;
    this.element = el("div", "console master-map-console");

    const banner = el("div", "test-mode-banner", "MODE TEST — carte maître : vérité simulation complète, non disponible en partie réaliste");
    this.element.appendChild(banner);

    const body = el("div", "master-map-body");
    this.element.appendChild(body);

    this.viewportContainer = el("div", "viewport-grid viewport-grid-2");
    body.appendChild(this.viewportContainer);
    this.viewportContainer.appendChild(el("div", "viewport-label viewport-label-top", "Dessus"));
    this.viewportContainer.appendChild(el("div", "viewport-label viewport-label-free", "Vue 3D"));

    this.renderer = new MultiViewRenderer(this.viewportContainer);
    this.renderer.scene.add(buildReferenceGrid());

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000000);
    this.topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000000);
    const viewports: ViewportDef[] = [
      { id: "top", label: "Dessus", camera: this.topCamera, rect: { x: 0, y: 0, w: 0.5, h: 1 } },
      { id: "free", label: "Vue 3D", camera: this.camera, rect: { x: 0.5, y: 0, w: 0.5, h: 1 } },
    ];
    this.renderer.setViewports(viewports);

    const sidebar = el("div", "master-map-sidebar");
    body.appendChild(sidebar);
    sidebar.appendChild(el("h2", "panel-title", "Corps réels (vérité simulation)"));

    const diagBlock = el("div", "control-block");
    diagBlock.appendChild(el("h3", "block-title", "Déroulement de partie"));
    this.diagStatus = el("div", "readout-line", "Aucun export effectué.");
    const diagButton = el("button", "btn btn-small", "Télécharger le déroulement (.json)");
    diagButton.addEventListener("click", () => downloadReplayExport(recorder, this.diagStatus));
    diagBlock.append(diagButton, this.diagStatus);
    diagBlock.appendChild(
      el("p", "help-text", "Entrées joueur depuis le début, instantanés complets toutes les 30 s et vérité des deux camps chaque seconde — rejouable exactement pour investigation."),
    );
    sidebar.appendChild(diagBlock);

    this.table = el("div", "master-map-table");
    sidebar.appendChild(this.table);

    for (const b of world.bodies) {
      const visual = new ShipVisual(AFFILIATION_COLOR[b.affiliation]);
      visual.addTo(this.renderer.scene);
      this.visuals.set(b.id, visual);
    }
  }

  update(): void {
    const center = this.world.bodies[0]?.position ?? new THREE.Vector3();

    for (const body of this.world.bodies) {
      const visual = this.visuals.get(body.id);
      if (!visual) continue;
      visual.update(body.position, body.attitude, body.velocity);
      visual.setTrail(body.trail);
      visual.setScale(this.halfExtentMeters / 120);
    }

    // Leurres des deux camps (vérité) : teinte du camp éclaircie, pour les distinguer des vaisseaux.
    const activeDecoys = this.world.decoys.filter((d) => d.isActive);
    for (const decoy of activeDecoys) {
      let visual = this.decoyVisuals.get(decoy.id);
      if (!visual) {
        visual = new ShipVisual(DECOY_COLOR[decoy.affiliation]);
        visual.addTo(this.renderer.scene);
        this.decoyVisuals.set(decoy.id, visual);
      }
      visual.update(decoy.position, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), decoy.thrustDirectionWorld), decoy.velocity);
      visual.setTrail(decoy.trail);
      visual.setScale(this.halfExtentMeters / 240);
    }
    for (const [id, visual] of this.decoyVisuals) {
      if (!activeDecoys.some((d) => d.id === id)) {
        visual.dispose();
        this.decoyVisuals.delete(id);
      }
    }

    centerPerspectiveCamera(this.camera, center, new THREE.Vector3(this.halfExtentMeters, this.halfExtentMeters * 0.8, this.halfExtentMeters), new THREE.Vector3(0, 1, 0));
    centerOrthoCamera(this.topCamera, center, new THREE.Vector3(0, this.halfExtentMeters * 2, 0.0001), new THREE.Vector3(0, 0, -1), this.halfExtentMeters);
    this.renderer.render();

    this.table.replaceChildren(
      ...this.world.bodies.map((body) => {
        const row = el("div", "master-map-row");
        row.style.borderLeftColor = `#${AFFILIATION_COLOR[body.affiliation].toString(16).padStart(6, "0")}`;
        row.append(
          el("strong", undefined, `${body.name} (${body.affiliation})`),
          el("span", "mono", `pos ${fmtVec(body.position)} m`),
          el("span", "mono", `vit ${fmtVec(body.velocity)} m/s`),
        );
        return row;
      }),
      ...activeDecoys.map((decoy) => {
        const row = el("div", "master-map-row");
        row.style.borderLeftColor = `#${DECOY_COLOR[decoy.affiliation].toString(16).padStart(6, "0")}`;
        row.append(
          el("strong", undefined, `${decoy.id} — leurre de ${decoy.ownerId} (${decoy.state})`),
          el("span", "mono", `pos ${fmtVec(decoy.position)} m`),
          el("span", "mono", `vit ${fmtVec(decoy.velocity)} m/s`),
        );
        return row;
      }),
    );
  }

  resize(): void {
    this.renderer.resize(this.viewportContainer);
  }

  dispose(): void {
    this.element.remove();
  }
}

function fmtVec(v: THREE.Vector3): string {
  return `[${v.x.toFixed(0)}, ${v.y.toFixed(0)}, ${v.z.toFixed(0)}]`;
}
