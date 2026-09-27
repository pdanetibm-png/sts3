import * as THREE from "three";

/**
 * Cône de balayage du radar actif — apex au vaisseau, axe le long de `scanDirectionWorld`,
 * ouverture `scanHalfAngleRad`. Rend visible ce que le joueur vise (section 8.3 : « couverture »).
 */
export class ScanConeVisual {
  readonly mesh: THREE.Mesh;
  private readonly baseGeometry: THREE.ConeGeometry;

  constructor(color = 0xff5c5c) {
    // Cône unitaire (hauteur 1, rayon 1) translaté pour que l'apex soit à l'origine locale,
    // pointant vers -Y — orienté/mis à l'échelle chaque frame dans update().
    this.baseGeometry = new THREE.ConeGeometry(1, 1, 24, 1, true);
    this.baseGeometry.translate(0, -0.5, 0);
    this.mesh = new THREE.Mesh(
      this.baseGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.mesh);
  }

  update(apexWorld: THREE.Vector3, directionWorld: THREE.Vector3, halfAngleRad: number, lengthMeters: number): void {
    this.mesh.visible = true;
    this.mesh.position.copy(apexWorld);
    const direction = directionWorld.lengthSq() > 1e-9 ? directionWorld.clone().normalize() : new THREE.Vector3(1, 0, 0);
    this.mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction));
    const radius = lengthMeters * Math.tan(Math.min(Math.PI / 2 - 0.01, halfAngleRad));
    this.mesh.scale.set(radius, lengthMeters, radius);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
  }
}
