import { campOf } from "./camps";
import type { DecoyState } from "./decoy";
import type { SimulationWorld } from "./world";

/**
 * Rapport par leurre (CONCEPTION_LEURRES.md §8) : a-t-il trompé l'ennemi ? Construit à partir du
 * journal d'attribution — vérité interne, réservée au déroulement exporté et au débrief en mode test.
 */

export interface DecoyTrackReport {
  observerId: string;
  trackId: string;
  decoyObservations: number;
  totalObservations: number;
  firstSimTime: number;
  lastSimTime: number;
  /** La source majoritaire de cette piste est passée du vaisseau lanceur au leurre. */
  tookOverFromOwner: boolean;
  takeoverSimTime: number | null;
}

export interface DecoyMissileReport {
  missileId: string;
  ownerId: string;
  trackId: string;
  simTime: number;
}

export interface DecoyReportEntry {
  decoyId: string;
  ownerId: string;
  ownerName: string;
  launchedSimTime: number;
  imitatedAccelerationMps2: number;
  thrustEndedSimTime: number | null;
  finalState: DecoyState;
  endedSimTime: number | null;
  destroyedByMissileId: string | null;
  /** Pistes du camp adverse alimentées par ce leurre. */
  enemyTracks: DecoyTrackReport[];
  /** Missiles adverses tirés sur une piste qui suivait ce leurre au moment du tir. */
  missilesDrawn: DecoyMissileReport[];
  verdict: string;
}

export function buildDecoyReport(world: SimulationWorld): DecoyReportEntry[] {
  const attribution = world.trackAttribution;
  const tracks = attribution.tracks;
  return world.decoys.map((decoy) => {
    const owner = world.getBody(decoy.ownerId);
    const enemyTracks: DecoyTrackReport[] = [];
    for (const track of tracks) {
      const observer = world.getBody(track.observerId);
      if (!observer || campOf(observer.affiliation) === campOf(decoy.affiliation)) continue;
      const own = track.sources.find((s) => s.sourceId === decoy.id);
      if (!own) continue;
      const takeover = track.transitions.find((t) => t.from === decoy.ownerId && t.to === decoy.id);
      enemyTracks.push({
        observerId: track.observerId,
        trackId: track.trackId,
        decoyObservations: own.observations,
        totalObservations: track.sources.reduce((sum, s) => sum + s.observations, 0),
        firstSimTime: own.firstSimTime,
        lastSimTime: own.lastSimTime,
        tookOverFromOwner: !!takeover,
        takeoverSimTime: takeover?.simTime ?? null,
      });
    }
    const missilesDrawn = attribution.launches
      .filter((launch) => launch.trackSourceAtLaunch === decoy.id)
      .map((launch) => ({ missileId: launch.missileId, ownerId: launch.ownerId, trackId: launch.trackId, simTime: launch.simTime }));

    return {
      decoyId: decoy.id,
      ownerId: decoy.ownerId,
      ownerName: owner?.name ?? decoy.ownerId,
      launchedSimTime: decoy.createdSimTime,
      imitatedAccelerationMps2: decoy.imitatedAccelerationMps2,
      thrustEndedSimTime: decoy.thrustEndedSimTime,
      finalState: decoy.state,
      endedSimTime: decoy.endedSimTime,
      destroyedByMissileId: decoy.destroyedByMissileId,
      enemyTracks,
      missilesDrawn,
      verdict: verdictFor(enemyTracks, missilesDrawn, decoy.destroyedByMissileId ?? pdcKiller(world, decoy.id)),
    };
  });
}

/** Tourelle qui a abattu ce leurre, le cas échéant (« pdc-1 de adversaire-1 »). */
function pdcKiller(world: SimulationWorld, decoyId: string): string | null {
  const kill = world.pdcLog.killOf(decoyId);
  return kill ? `${kill.engagement.mountId} de ${kill.engagement.ownerId}` : null;
}

function verdictFor(enemyTracks: readonly DecoyTrackReport[], missilesDrawn: readonly DecoyMissileReport[], destroyedBy: string | null): string {
  const parts: string[] = [];
  const takeovers = enemyTracks.filter((t) => t.tookOverFromOwner);
  if (takeovers.length > 0) {
    parts.push(`a pris la place du vaisseau sur ${takeovers.map((t) => `${t.trackId} (${t.observerId}, t=${t.takeoverSimTime!.toFixed(0)} s)`).join(", ")}`);
  } else if (enemyTracks.length > 0) {
    parts.push(`suivi par l'ennemi sur ${enemyTracks.map((t) => `${t.trackId} (${t.observerId})`).join(", ")}, sans reprendre la piste du vaisseau`);
  } else {
    parts.push("jamais détecté par l'ennemi");
  }
  if (missilesDrawn.length > 0) parts.push(`a attiré ${missilesDrawn.length} missile${missilesDrawn.length > 1 ? "s" : ""} (${missilesDrawn.map((m) => m.missileId).join(", ")})`);
  if (destroyedBy) parts.push(`détruit par ${destroyedBy}`);
  return parts.join(" ; ") + ".";
}
