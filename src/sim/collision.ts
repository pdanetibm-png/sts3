import { Vector3 } from "three";

/**
 * Test de collision continu segment p0→p1 vs sphère — ARM-04/TIM-02 : un grand déplacement
 * en un pas (temps accéléré) ne doit jamais traverser artificiellement la cible.
 */
export function sweptSegmentHitsSphere(p0: Vector3, p1: Vector3, center: Vector3, radius: number): { hit: boolean; t: number } {
  const f = p0.clone().sub(center);
  if (f.lengthSq() <= radius * radius) {
    return { hit: true, t: 0 };
  }

  const d = p1.clone().sub(p0);
  const a = d.dot(d);
  if (a < 1e-12) {
    return { hit: false, t: 1 };
  }
  const b = 2 * f.dot(d);
  const c = f.dot(f) - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return { hit: false, t: 1 };

  const sqrtDiscriminant = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDiscriminant) / (2 * a);
  const t2 = (-b + sqrtDiscriminant) / (2 * a);

  if (t1 >= 0 && t1 <= 1) return { hit: true, t: t1 };
  if (t2 >= 0 && t2 <= 1) return { hit: true, t: t2 };
  return { hit: false, t: 1 };
}

/**
 * Même test, contre une cible qui a elle aussi bougé pendant le pas (vitesse constante sur le pas,
 * comme l'intégration : fin = début + v·dt). Le segment est pris dans le repère de la cible : sans
 * cela, une cible rapide est testée à sa position de fin de pas, ce qui décale la collision d'autant
 * que son déplacement (25 m par pas à 1,5 km/s, l'ordre du rayon d'un vaisseau).
 */
export function sweptSegmentHitsMovingSphere(
  p0: Vector3,
  p1: Vector3,
  targetEnd: Vector3,
  targetVelocity: Vector3,
  dt: number,
  radius: number,
): { hit: boolean; t: number } {
  const targetStart = targetEnd.clone().addScaledVector(targetVelocity, -dt);
  return sweptSegmentHitsSphere(p0.clone().sub(targetStart), p1.clone().sub(targetEnd), new Vector3(), radius);
}

/** Franchissement de la frontière du théâtre (ARM-06) — sphère fixe calculée une fois à l'init. */
export function crossedSphereBoundaryOutward(p0: Vector3, p1: Vector3, center: Vector3, radius: number): boolean {
  return p0.distanceTo(center) <= radius && p1.distanceTo(center) > radius;
}
