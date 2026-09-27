/**
 * Journal des engagements PDC (CONCEPTION_PDC.md §7) — vérité interne réservée à l'analyse
 * (déroulement exporté, débrief en mode test). Jamais lu par la connaissance, les consoles
 * réalistes ni l'IA.
 */

export interface PdcPass {
  salvoId: string;
  objectId: string;
  simTime: number;
  missDistanceMeters: number;
  sigmaMeters: number;
  killProbability: number;
  killed: boolean;
}

export interface PdcEngagement {
  ownerId: string;
  mountId: string;
  trackId: string;
  firstShotSimTime: number;
  lastShotSimTime: number;
  salvos: number;
  roundsFired: number;
  /** Ce que la piste suivait réellement au premier obus (source majoritaire de ses mesures). */
  trackSourceAtFirstShot: string | null;
  /** Écart entre la position estimée de la piste et le vrai objet qu'elle suivait, au premier obus. */
  trackErrorAtFirstShotMeters: number | null;
  /** Passage le plus proche d'une cible, toutes rafales de l'engagement confondues. */
  closestPass: PdcPass | null;
  /** Par objet réel : probabilité cumulée d'avoir été abattu, 1 − Π(1 − P) sur toutes les rafales. */
  cumulativeKillProbability: Record<string, number>;
  kills: PdcPass[];
}

export interface PdcLogSaveState {
  engagements: PdcEngagement[];
}

export class PdcEngagementLog {
  private readonly byKey = new Map<string, PdcEngagement>();

  private key(ownerId: string, mountId: string, trackId: string): string {
    return `${ownerId}\u0000${mountId}\u0000${trackId}`;
  }

  recordSalvo(ownerId: string, mountId: string, trackId: string, rounds: number, simTime: number, trackSource: string | null, trackErrorMeters: number | null): void {
    const key = this.key(ownerId, mountId, trackId);
    const existing = this.byKey.get(key);
    if (existing) {
      existing.lastShotSimTime = simTime;
      existing.salvos += 1;
      existing.roundsFired += rounds;
      return;
    }
    this.byKey.set(key, {
      ownerId,
      mountId,
      trackId,
      firstShotSimTime: simTime,
      lastShotSimTime: simTime,
      salvos: 1,
      roundsFired: rounds,
      trackSourceAtFirstShot: trackSource,
      trackErrorAtFirstShotMeters: trackErrorMeters,
      closestPass: null,
      cumulativeKillProbability: {},
      kills: [],
    });
  }

  recordPass(ownerId: string, mountId: string, trackId: string, pass: PdcPass): void {
    const engagement = this.byKey.get(this.key(ownerId, mountId, trackId));
    if (!engagement) return;
    if (!engagement.closestPass || pass.missDistanceMeters < engagement.closestPass.missDistanceMeters) engagement.closestPass = { ...pass };
    const survival = 1 - (engagement.cumulativeKillProbability[pass.objectId] ?? 0);
    engagement.cumulativeKillProbability[pass.objectId] = 1 - survival * (1 - pass.killProbability);
    if (pass.killed) engagement.kills.push({ ...pass });
  }

  get engagements(): PdcEngagement[] {
    return [...this.byKey.values()].map(copyEngagement);
  }

  /** L'engagement qui a détruit cet objet, s'il y en a un. */
  killOf(objectId: string): { engagement: PdcEngagement; pass: PdcPass } | null {
    for (const engagement of this.byKey.values()) {
      const pass = engagement.kills.find((k) => k.objectId === objectId);
      if (pass) return { engagement, pass };
    }
    return null;
  }

  toSaveState(): PdcLogSaveState {
    return { engagements: this.engagements };
  }

  load(saved: PdcLogSaveState): void {
    this.byKey.clear();
    for (const e of saved.engagements) this.byKey.set(this.key(e.ownerId, e.mountId, e.trackId), copyEngagement(e));
  }
}

function copyEngagement(e: PdcEngagement): PdcEngagement {
  return { ...e, closestPass: e.closestPass ? { ...e.closestPass } : null, cumulativeKillProbability: { ...e.cumulativeKillProbability }, kills: e.kills.map((k) => ({ ...k })) };
}

/** Verdict lisible d'un engagement (analyse). */
export function pdcEngagementVerdict(e: PdcEngagement): string {
  const target = e.trackSourceAtFirstShot ? `${e.trackId} (= ${e.trackSourceAtFirstShot})` : e.trackId;
  const parts = [`${e.mountId} (${e.ownerId}) → ${target} : ${e.roundsFired} obus de t=${e.firstShotSimTime.toFixed(1)} à ${e.lastShotSimTime.toFixed(1)} s`];
  if (e.trackErrorAtFirstShotMeters !== null) parts.push(`erreur de piste au premier tir ${e.trackErrorAtFirstShotMeters.toFixed(0)} m`);
  const odds = Object.entries(e.cumulativeKillProbability)
    .filter(([, p]) => p >= 0.005)
    .map(([id, p]) => `${id} ${(p * 100).toFixed(0)} %`);
  if (odds.length > 0) parts.push(`probabilité cumulée d'interception : ${odds.join(", ")}`);
  if (e.closestPass) parts.push(`passage le plus proche ${e.closestPass.missDistanceMeters.toFixed(1)} m de ${e.closestPass.objectId} (dispersion σ ${e.closestPass.sigmaMeters.toFixed(1)} m)`);
  parts.push(e.kills.length > 0 ? `abattu : ${e.kills.map((k) => k.objectId).join(", ")}` : "aucun objet abattu");
  return parts.join(" ; ") + ".";
}
