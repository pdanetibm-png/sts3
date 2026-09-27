import type { SimulationWorld } from "./world";

/**
 * Vérification d'invariants (section 10 : « si un état non fini ou une invariant critique
 * apparaît en cours de partie, pause technique, message lisible et export de diagnostic
 * proposé »). Volontairement minimal : détecte un état numériquement invalide plutôt que de
 * continuer à simuler dessus, sans prétendre couvrir toutes les erreurs de jeu possibles.
 */
export function checkWorldInvariants(world: SimulationWorld): { message: string } | null {
  for (const body of world.bodies) {
    if (!isFiniteVector(body.position)) return { message: `Position non finie sur ${body.id}.` };
    if (!isFiniteVector(body.velocity)) return { message: `Vitesse non finie sur ${body.id}.` };
    if (!isFiniteQuaternion(body.attitude)) return { message: `Attitude non finie sur ${body.id}.` };
    if (!isFiniteVector(body.angularVelocity)) return { message: `Vitesse angulaire non finie sur ${body.id}.` };
    if (!Number.isFinite(body.massKg) || body.massKg <= 0) return { message: `Masse invalide sur ${body.id} (${body.massKg}).` };
    if (!Number.isFinite(body.reservoir.quantityKg) || body.reservoir.quantityKg < 0) {
      return { message: `Réservoir invalide sur ${body.id} (${body.reservoir.quantityKg}).` };
    }
  }

  for (const missile of world.missiles) {
    if (!isFiniteVector(missile.position)) return { message: `Position non finie sur ${missile.id}.` };
    if (!isFiniteVector(missile.velocity)) return { message: `Vitesse non finie sur ${missile.id}.` };
    if (!Number.isFinite(missile.massKg) || missile.massKg <= 0) return { message: `Masse invalide sur ${missile.id} (${missile.massKg}).` };
  }

  for (const decoy of world.decoys) {
    if (!isFiniteVector(decoy.position)) return { message: `Position non finie sur ${decoy.id}.` };
    if (!isFiniteVector(decoy.velocity)) return { message: `Vitesse non finie sur ${decoy.id}.` };
    if (!Number.isFinite(decoy.massKg) || decoy.massKg <= 0) return { message: `Masse invalide sur ${decoy.id} (${decoy.massKg}).` };
    if (decoy.reservoir.quantityKg < 0 || decoy.emitterChargeKg < 0) return { message: `Réserve négative sur ${decoy.id}.` };
  }

  for (const salvo of world.pdcSalvos) {
    if (!isFiniteVector(salvo.position) || !isFiniteVector(salvo.velocity)) return { message: `Rafale non finie : ${salvo.id}.` };
  }

  return null;
}

function isFiniteVector(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function isFiniteQuaternion(q: { x: number; y: number; z: number; w: number }): boolean {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}
