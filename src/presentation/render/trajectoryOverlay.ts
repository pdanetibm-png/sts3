import * as THREE from "three";
import type { ClosestApproach, PredictedPoint } from "../../sim/predict";

const MAX_POINTS = 512;

function makeLine(material: THREE.LineBasicMaterial | THREE.LineDashedMaterial): { line: THREE.Line; geometry: THREE.BufferGeometry } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
  geometry.setDrawRange(0, 0);
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  return { line, geometry };
}

function setPoints(line: THREE.Line, geometry: THREE.BufferGeometry, points: readonly THREE.Vector3[]): void {
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  let count = 0;
  for (let i = 0; i < points.length && count < MAX_POINTS; i += step) {
    attribute.setXYZ(count++, points[i].x, points[i].y, points[i].z);
  }
  // Toujours finir exactement sur le dernier point, même en sous-échantillonnant.
  if (count > 0 && count < MAX_POINTS && (points.length - 1) % step !== 0) {
    const last = points[points.length - 1];
    attribute.setXYZ(count++, last.x, last.y, last.z);
  }
  geometry.setDrawRange(0, count);
  attribute.needsUpdate = true;
  geometry.computeBoundingSphere();
  if (line.material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
}

function makeArrow(color: number, opacity: number): THREE.ArrowHelper {
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, color);
  for (const part of [arrow.line, arrow.cone]) {
    const material = part.material as THREE.Material;
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.depthTest = false;
  }
  arrow.renderOrder = 2;
  return arrow;
}

export interface TrajectoryFrame {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Axe de la poussée principale, repère monde. */
  thrustAxis: THREE.Vector3;
  throttle: number;
  /** Axe visé par le maintien d'attitude, s'il est engagé. */
  targetAxis: THREE.Vector3 | null;
  /** Distance caméra–centre : échelle des flèches et des pointillés. */
  scaleMeters: number;
}

/**
 * Tracés du poste de pilotage dans la sphère : trajectoire prévue (consigne actuelle maintenue),
 * route estimée de la piste choisie, liaison au point d'approche au plus près, flèches de
 * vitesse, de poussée et d'attitude visée. La trajectoire passée reste celle de `ShipVisual`.
 */
export class TrajectoryOverlay {
  private readonly predicted = makeLine(
    new THREE.LineDashedMaterial({ color: 0x9fd8a8, dashSize: 1, gapSize: 1, transparent: true, opacity: 0.9 }),
  );
  private readonly trackPath = makeLine(
    new THREE.LineDashedMaterial({ color: 0xff6b5c, dashSize: 1, gapSize: 1, transparent: true, opacity: 0.8 }),
  );
  private readonly cpaLink = makeLine(new THREE.LineBasicMaterial({ color: 0xffd24d, transparent: true, opacity: 0.9 }));
  private readonly velocityArrow = makeArrow(0x37d4ff, 1);
  private readonly thrustArrow = makeArrow(0xff9a3c, 1);
  private readonly targetArrow = makeArrow(0xff9a3c, 0.35);

  constructor(scene: THREE.Scene) {
    scene.add(this.predicted.line, this.trackPath.line, this.cpaLink.line, this.velocityArrow, this.thrustArrow, this.targetArrow);
  }

  setPrediction(points: readonly PredictedPoint[]): void {
    setPoints(this.predicted.line, this.predicted.geometry, points.map((p) => p.position));
  }

  setTrackPath(points: readonly THREE.Vector3[] | null): void {
    setPoints(this.trackPath.line, this.trackPath.geometry, points ?? []);
  }

  setClosestApproach(cpa: ClosestApproach | null): void {
    setPoints(this.cpaLink.line, this.cpaLink.geometry, cpa ? [cpa.ownPosition, cpa.otherPosition] : []);
  }

  update(frame: TrajectoryFrame): void {
    const scale = frame.scaleMeters;
    for (const { line } of [this.predicted, this.trackPath]) {
      const material = line.material as THREE.LineDashedMaterial;
      material.dashSize = scale / 60;
      material.gapSize = scale / 110;
    }

    const speed = frame.velocity.length();
    this.velocityArrow.visible = speed > 1e-3;
    if (this.velocityArrow.visible) {
      this.velocityArrow.position.copy(frame.position);
      this.velocityArrow.setDirection(frame.velocity.clone().normalize());
      this.velocityArrow.setLength(scale * 0.16, scale * 0.03, scale * 0.015);
    }

    // Poussée : pleine intensité moteur allumé, courte et pâle moteur coupé (simple repère d'axe).
    this.thrustArrow.position.copy(frame.position);
    this.thrustArrow.setDirection(frame.thrustAxis);
    const thrustLength = scale * (frame.throttle > 0 ? 0.08 + 0.08 * frame.throttle : 0.06);
    this.thrustArrow.setLength(thrustLength, scale * 0.025, scale * 0.013);
    for (const part of [this.thrustArrow.line, this.thrustArrow.cone]) {
      const material = part.material as THREE.Material;
      material.transparent = true;
      material.opacity = frame.throttle > 0 ? 1 : 0.45;
    }

    const showTarget = !!frame.targetAxis && frame.targetAxis.dot(frame.thrustAxis) < 0.999;
    this.targetArrow.visible = showTarget;
    if (showTarget) {
      this.targetArrow.position.copy(frame.position);
      this.targetArrow.setDirection(frame.targetAxis!);
      this.targetArrow.setLength(scale * 0.12, scale * 0.025, scale * 0.013);
    }
  }
}
