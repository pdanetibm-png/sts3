import * as THREE from "three";
import type { Track, TrackState } from "../../knowledge/types";

/** Toute piste est un contact présumé hostile (les alliés sont connus par liaison de données) : rouge. */
const STATE_COLOR: Record<TrackState, number> = {
  recent: 0xff4d4d,
  extrapolated: 0xff9a5c,
  lost: 0x666a75,
};

const DEFAULT_BEARING_LINE_DISTANCE_METERS = 6000;
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Représentation visuelle d'une piste (section 5.3/5.4) : si la position est connue (radar, ou
 * distance passive), un marqueur + un ellipsoïde d'incertitude allongé dans l'axe de visée (la
 * distance est souvent bien moins sûre que la direction) + une flèche vitesse ; sinon un rayon en
 * pointillés le long du seul gisement connu — jamais un point 3D arbitraire.
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

  /** `bearingLineMeters` : longueur du rayon d'une piste au gisement seul (le rayon de la vue). */
  update(track: Track, ownPositionWorld: THREE.Vector3, bearingLineMeters = DEFAULT_BEARING_LINE_DISTANCE_METERS): void {
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
      const lateral = Math.max(20, Math.min(radius, track.crossRangeUncertaintyMeters ?? radius));
      const lineOfSight = track.positionEstimateWorld.clone().sub(ownPositionWorld);
      if (lineOfSight.lengthSq() > 1) this.uncertaintySphere.quaternion.setFromUnitVectors(X_AXIS, lineOfSight.normalize());
      this.uncertaintySphere.scale.set(radius, lateral, lateral);
      this.positionMarker.scale.setScalar(Math.max(5, lateral * 0.2, radius * 0.02));

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
      const end = ownPositionWorld.clone().addScaledVector(track.bearingEstimateWorld, bearingLineMeters);
      attribute.setXYZ(1, end.x, end.y, end.z);
      attribute.needsUpdate = true;
      this.bearingLine.computeLineDistances();
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
  }
}
