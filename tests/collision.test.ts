import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { crossedSphereBoundaryOutward, sweptSegmentHitsMovingSphere, sweptSegmentHitsSphere } from "../src/sim/collision";

// ARM-04 : tester le déplacement entre deux pas pour éviter une traversée artificielle,
// surtout en temps accéléré (TIM-02).
describe("ARM-04/TIM-02 — collision continue", () => {
  it("détecte un impact direct au centre de la cible", () => {
    const result = sweptSegmentHitsSphere(new Vector3(-100, 0, 0), new Vector3(100, 0, 0), new Vector3(0, 0, 0), 25);
    expect(result.hit).toBe(true);
    expect(result.t).toBeGreaterThanOrEqual(0);
    expect(result.t).toBeLessThanOrEqual(1);
  });

  it("un passage voisin sans contact ne cause aucun dégât", () => {
    const result = sweptSegmentHitsSphere(new Vector3(-100, 100, 0), new Vector3(100, 100, 0), new Vector3(0, 0, 0), 25);
    expect(result.hit).toBe(false);
  });

  it("détecte un impact même sur un très grand pas (équivalent ×10) qui traverserait la cible entre deux échantillons", () => {
    // Un point de départ et d'arrivée tous deux loin de la sphère, de part et d'autre —
    // un test ponctuel aux deux extrémités seul manquerait cet impact.
    const result = sweptSegmentHitsSphere(new Vector3(-1_000_000, 0, 0), new Vector3(1_000_000, 0, 0), new Vector3(0, 0, 0), 25);
    expect(result.hit).toBe(true);
  });

  it("un point de départ déjà à l'intérieur de la cible est un impact immédiat (t=0)", () => {
    const result = sweptSegmentHitsSphere(new Vector3(5, 0, 0), new Vector3(50, 0, 0), new Vector3(0, 0, 0), 25);
    expect(result.hit).toBe(true);
    expect(result.t).toBe(0);
  });

  it("aucune résolution en double : un point immobile hors cible ne produit pas d'impact", () => {
    const p = new Vector3(1000, 0, 0);
    const result = sweptSegmentHitsSphere(p, p.clone(), new Vector3(0, 0, 0), 25);
    expect(result.hit).toBe(false);
  });
});

describe("TIM-02 — collision avec une cible qui bouge pendant le pas", () => {
  // Missile à 6 km/s vers +x, vaisseau (rayon 25 m) à 1,5 km/s vers +y : 100 m et 25 m par pas.
  const dt = 1 / 60;
  const shipVelocity = new Vector3(0, 1500, 0);
  const shipEnd = new Vector3(0, 25, 0);
  const missileSegment = (y: number) => [new Vector3(-50, y, 0), new Vector3(50, y, 0)] as const;

  it("touche une cible que le test à position de fin de pas manquait", () => {
    // En mouvement relatif, le missile passe à 22 m du centre ; la cible figée en fin de pas est à 35 m.
    const [p0, p1] = missileSegment(-10);
    expect(sweptSegmentHitsSphere(p0, p1, shipEnd, 25).hit).toBe(false);
    expect(sweptSegmentHitsMovingSphere(p0, p1, shipEnd, shipVelocity, dt, 25).hit).toBe(true);
  });

  it("ne touche plus une cible que le test à position de fin de pas touchait à tort", () => {
    // Figée en fin de pas, la cible est à 20 m du segment ; en mouvement relatif, le missile passe à 31 m.
    const [p0, p1] = missileSegment(45);
    expect(sweptSegmentHitsSphere(p0, p1, shipEnd, 25).hit).toBe(true);
    expect(sweptSegmentHitsMovingSphere(p0, p1, shipEnd, shipVelocity, dt, 25).hit).toBe(false);
  });

  it("une cible immobile donne le même résultat que le test historique", () => {
    const [p0, p1] = missileSegment(10);
    expect(sweptSegmentHitsMovingSphere(p0, p1, new Vector3(), new Vector3(), dt, 25)).toEqual(sweptSegmentHitsSphere(p0, p1, new Vector3(), 25));
  });
});

describe("ARM-06 — franchissement de la frontière du théâtre", () => {
  const center = new Vector3(0, 0, 0);
  const radius = 1000;

  it("détecte une sortie (intérieur → extérieur)", () => {
    expect(crossedSphereBoundaryOutward(new Vector3(900, 0, 0), new Vector3(1100, 0, 0), center, radius)).toBe(true);
  });

  it("ne détecte rien si le corps reste à l'intérieur", () => {
    expect(crossedSphereBoundaryOutward(new Vector3(100, 0, 0), new Vector3(200, 0, 0), center, radius)).toBe(false);
  });

  it("ne détecte rien si le corps était déjà à l'extérieur (déjà retiré, pas de double résolution)", () => {
    expect(crossedSphereBoundaryOutward(new Vector3(1100, 0, 0), new Vector3(1200, 0, 0), center, radius)).toBe(false);
  });
});
