import * as THREE from "three";

const MAX_TRAIL_POINTS = 600;
const MAX_PREDICTION_POINTS = 256;

/** Représentation visuelle d'un corps : maillage + repère local, vecteur vitesse, trajectoires. */
export class ShipVisual {
  readonly bodyMesh: THREE.Group;
  readonly velocityArrow: THREE.ArrowHelper;
  readonly trailLine: THREE.Line;
  readonly predictedLine: THREE.Line;

  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly predictedGeometry = new THREE.BufferGeometry();

  constructor(color: number) {
    this.bodyMesh = buildBodyMesh(color);

    this.velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x37d4ff, 8, 5);

    this.trailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_TRAIL_POINTS * 3), 3));
    this.trailLine = new THREE.Line(this.trailGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    this.trailLine.frustumCulled = false;

    this.predictedGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_PREDICTION_POINTS * 3), 3),
    );
    this.predictedLine = new THREE.Line(
      this.predictedGeometry,
      new THREE.LineDashedMaterial({ color: 0x9aa7b8, dashSize: 40, gapSize: 25, transparent: true, opacity: 0.85 }),
    );
    this.predictedLine.frustumCulled = false;
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.bodyMesh, this.velocityArrow, this.trailLine, this.predictedLine);
  }

  /** Retire ce visuel de la scène — pour des corps transitoires (missiles) qui disparaissent en cours de partie. */
  dispose(): void {
    this.bodyMesh.parent?.remove(this.bodyMesh);
    this.velocityArrow.parent?.remove(this.velocityArrow);
    this.trailLine.parent?.remove(this.trailLine);
    this.predictedLine.parent?.remove(this.predictedLine);
  }

  /** Échelle du maillage indépendante du zoom des vues (section 8.1 : lisibilité à toute échelle). */
  setScale(scaleFactor: number): void {
    this.bodyMesh.scale.setScalar(Math.max(0.5, scaleFactor));
  }

  update(position: THREE.Vector3, attitude: THREE.Quaternion, velocity: THREE.Vector3): void {
    this.bodyMesh.position.copy(position);
    this.bodyMesh.quaternion.copy(attitude);

    this.velocityArrow.position.copy(position);
    const speed = velocity.length();
    if (speed > 1e-3) {
      this.velocityArrow.setDirection(velocity.clone().normalize());
      this.velocityArrow.setLength(Math.min(2000, 50 + speed * 4), 8, 5);
      this.velocityArrow.visible = true;
    } else {
      this.velocityArrow.visible = false;
    }
  }

  setTrail(points: THREE.Vector3[]): void {
    setLinePoints(this.trailGeometry, points, MAX_TRAIL_POINTS);
  }

  setPrediction(points: THREE.Vector3[]): void {
    setLinePoints(this.predictedGeometry, points, MAX_PREDICTION_POINTS);
    this.predictedLine.computeLineDistances();
  }
}

function setLinePoints(geometry: THREE.BufferGeometry, points: THREE.Vector3[], maxPoints: number): void {
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  const count = Math.min(points.length, maxPoints);
  for (let i = 0; i < count; i++) {
    attribute.setXYZ(i, points[i].x, points[i].y, points[i].z);
  }
  geometry.setDrawRange(0, count);
  attribute.needsUpdate = true;
}

function buildBodyMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(6, 24, 8).rotateZ(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 }),
  );
  group.add(hull);
  group.add(new THREE.AxesHelper(18));
  return group;
}

export function buildReferenceGrid(): THREE.Object3D {
  const group = new THREE.Group();
  // GridHelper est déjà dans le plan XZ (y=0) par défaut — repère "sol" pour la vue Dessus.
  group.add(new THREE.GridHelper(20000, 20, 0x6b88a8, 0x3a4d63));
  group.add(new THREE.AxesHelper(1000));
  return group;
}
