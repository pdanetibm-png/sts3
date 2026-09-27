import type { RigidBody } from "./rigidBody";

/**
 * Décompte l'autonomie de secours du support vie (section 8.6, RES-02) — uniquement pendant
 * un délestage effectif du groupe de consommateurs "vie" (branché sur le signal de
 * délestage déjà produit par sim/power.ts, pas un nouveau détecteur de perte d'alimentation).
 * Gelé (ni décompté ni rechargé) hors délestage — une restauration d'alimentation ARRÊTE le
 * décompte, elle ne le recharge jamais à sa valeur initiale (section 8.6 : « restauration
 * l'arrête »).
 */
export function stepLifeSupport(body: RigidBody, dt: number): void {
  if (body.lifeSupportFailed) return;

  const shedIds = body.lastPowerStep?.shedConsumerIds ?? [];
  const lifeSupportShed = shedIds.some((id) => body.consumers.find((c) => c.id === id)?.priorityGroup === "vie");
  if (!lifeSupportShed) return;

  body.lifeSupportRemainingAutonomySeconds = Math.max(0, body.lifeSupportRemainingAutonomySeconds - dt);
  if (body.lifeSupportRemainingAutonomySeconds <= 0) body.lifeSupportFailed = true;
}
