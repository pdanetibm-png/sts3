import * as THREE from "three";
import type { Track, TrackState } from "../../knowledge/types";

/** Toute piste est un contact présumé hostile (les alliés sont connus par liaison de données) : rouge. */
const STATE_COLOR: Record<TrackState, number> = {
  recent: 0xff4d4d,
  extrapolated: 0xff9a5c,
  lost: 0x666a75,
};

const BEARING_LINE_DISTANCE_METERS = 6000;

/**
 * Représentation visuelle d'une piste (section 5.3/5.4) : si la position est connue
 * (radar actif), un marqueur + une sphère d'incertitude + une flèche vitesse en pointillés
 * conceptuels ; sinon un rayon en pointillés le long du seul gisement connu — jamais un
 * point 3D arbitraire. Réutilisable (Tactique, étape 4).
 */
export class TrackVisual {
  readonly group = new THREE.Group();

  private readonly positionMarker: THREE.Mesh;
  private readonly uncertaintySphere: THREE.Mesh;
  private readonly velocityArrow: THREE.ArrowHelper;
  private readonly bearingLine: THREE.Line;
  private readonly bearingGeometry = new THREE.BufferGeometry();

  constructor() {
    this.positionMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.uncertaintySphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    this.velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x55ddff, 15, 8);

    this.bearingGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    this.bearingLine = new THREE.Line(
      this.bearingGeometry,
      new THREE.LineDashedMaterial({ color: 0xffcc55, dashSize: 60, gapSize: 30, transparent: true, opacity: 0.85 }),
    );
    this.bearingLine.frustumCulled = false;

    this.group.add(this.positionMarker, this.uncertaintySphere, this.velocityArrow, this.bearingLine);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
  }

  update(track: Track, ownPositionWorld: THREE.Vector3): void {
    const color = STATE_COLOR[track.state];
    (this.positionMarker.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.uncertaintySphere.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.bearingLine.material as THREE.LineDashedMaterial).color.setHex(color);

    if (track.positionEstimateWorld) {
      this.positionMarker.visible = true;
      this.uncertaintySphere.visible = true;
      this.bearingLine.visible = false;

      this.positionMarker.position.copy(track.positionEstimateWorld);
      this.uncertaintySphere.position.copy(track.positionEstimateWorld);
      const radius = Math.max(20, track.positionUncertaintyMeters ?? 20);
      this.uncertaintySphere.scale.setScalar(radius);
      this.positionMarker.scale.setScalar(Math.max(5, radius * 0.05));

      if (track.velocityEstimateWorld && track.velocityEstimateWorld.length() > 0.5) {
        this.velocityArrow.visible = true;
        this.velocityArrow.position.copy(track.positionEstimateWorld);
        this.velocityArrow.setDirection(track.velocityEstimateWorld.clone().normalize());
        this.velocityArrow.setLength(Math.min(3000, 100 + track.velocityEstimateWorld.length() * 5), 20, 10);
      } else {
        this.velocityArrow.visible = false;
      }
    } else {
      this.positionMarker.visible = false;
      this.uncertaintySphere.visible = false;
      this.velocityArrow.visible = false;
      this.bearingLine.visible = true;

      const attribute = this.bearingGeometry.getAttribute("position") as THREE.BufferAttribute;
      attribute.setXYZ(0, ownPositionWorld.x, ownPositionWorld.y, ownPositionWorld.z);
      const end = ownPositionWorld.clone().addScaledVector(track.bearingEstimateWorld, BEARING_LINE_DISTANCE_METERS);
      attribute.setXYZ(1, end.x, end.y, end.z);
      attribute.needsUpdate = true;
      this.bearingLine.computeLineDistances();
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
  }
}
