import * as THREE from "three";

export interface ViewportDef {
  id: string;
  label: string;
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  /** Rectangle normalisé (0..1) dans le canvas ; y mesuré depuis le bas (convention WebGL). */
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * Un seul WebGLRenderer partagé, rendu en 4 zones (viewport/scissor) par frame — plus
 * économe que 4 renderers séparés pour les 3 projections 2D + la vue 3D (section 8.2).
 */
export class MultiViewRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly canvas: HTMLCanvasElement;
  private viewports: ViewportDef[] = [];
  // setViewport/setScissor attendent des pixels CSS (three.js applique lui-même le devicePixelRatio) —
  // distinct de canvas.width/height qui sont en pixels physiques.
  private logicalWidth = 1;
  private logicalHeight = 1;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "multiview-canvas";
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060a);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
    this.resize(container);
  }

  setViewports(viewports: ViewportDef[]): void {
    this.viewports = viewports;
  }

  resize(container: HTMLElement): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.renderer.setSize(width, height, false);
  }

  /**
   * Convertit un point en pixels CSS relatifs au canvas (origine haut-gauche, comme un
   * événement DOM) en point monde sur le plan visible de la vue orthographique cliquée.
   * Retourne `null` en dehors de toute vue, ou sur la vue 3D (perspective, pas de plan unique).
   */
  pickOrthoWorldPoint(canvasRelativeX: number, canvasRelativeY: number): { viewportId: string; worldPoint: THREE.Vector3 } | null {
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    const yFromBottom = height - canvasRelativeY;

    for (const vp of this.viewports) {
      const x0 = vp.rect.x * width;
      const y0 = vp.rect.y * height;
      const w = vp.rect.w * width;
      const h = vp.rect.h * height;
      if (canvasRelativeX < x0 || canvasRelativeX > x0 + w) continue;
      if (yFromBottom < y0 || yFromBottom > y0 + h) continue;
      if (!(vp.camera instanceof THREE.OrthographicCamera)) return null;

      const ndcX = ((canvasRelativeX - x0) / w) * 2 - 1;
      const ndcY = ((yFromBottom - y0) / h) * 2 - 1;
      const worldPoint = new THREE.Vector3(ndcX, ndcY, 0).unproject(vp.camera);
      return { viewportId: vp.id, worldPoint };
    }
    return null;
  }

  render(): void {
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    this.renderer.setScissorTest(true);
    for (const vp of this.viewports) {
      const x = Math.round(vp.rect.x * width);
      const y = Math.round(vp.rect.y * height);
      const w = Math.round(vp.rect.w * width);
      const h = Math.round(vp.rect.h * height);
      if (w <= 0 || h <= 0) continue;
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      updateCameraAspect(vp.camera, w / h);
      this.renderer.render(this.scene, vp.camera);
    }
  }
}

function updateCameraAspect(camera: THREE.OrthographicCamera | THREE.PerspectiveCamera, aspect: number): void {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return;
  }
  const verticalExtent = (camera.top - camera.bottom) / 2;
  const centerY = (camera.top + camera.bottom) / 2;
  const horizontalExtent = verticalExtent * aspect;
  const centerX = (camera.left + camera.right) / 2;
  camera.left = centerX - horizontalExtent;
  camera.right = centerX + horizontalExtent;
  camera.top = centerY + verticalExtent;
  camera.bottom = centerY - verticalExtent;
  camera.updateProjectionMatrix();
}

/** Recentre une caméra orthographique sur `target`, en conservant son demi-axe visible. */
export function centerOrthoCamera(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  offset: THREE.Vector3,
  up: THREE.Vector3,
  halfExtentMeters: number,
): void {
  camera.position.copy(target).add(offset);
  camera.up.copy(up);
  camera.lookAt(target);
  camera.top = halfExtentMeters;
  camera.bottom = -halfExtentMeters;
  camera.left = -halfExtentMeters;
  camera.right = halfExtentMeters;
  camera.near = 0.1;
  camera.far = offset.length() * 4 + halfExtentMeters * 4;
  camera.updateProjectionMatrix();
}

export function centerPerspectiveCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  offset: THREE.Vector3,
  up: THREE.Vector3,
): void {
  camera.position.copy(target).add(offset);
  camera.up.copy(up);
  camera.lookAt(target);
  camera.near = 0.1;
  camera.far = offset.length() * 6;
  camera.updateProjectionMatrix();
}
