import { trackToSaveState } from "../knowledge/serialization";
import type { TrackSaveState } from "../knowledge/serialization";
import type { RigidBodySaveState } from "./rigidBody";
import type { MissileSaveState } from "./missile";
import { validateScenario } from "./scenario";
import type { ScenarioDefinition } from "./types";
import { SimulationWorld, type BodyRestoreState, type TimeMultiplier, type WorldRestoreState } from "./world";
import type { MissionEvent, MissionOutcome } from "./mission";
import type { InputLogSaveState } from "./inputLog";
import type { DecoySaveState } from "./decoy";
import type { TrackAttributionSaveState } from "./trackAttribution";
import type { PdcLogSaveState } from "./pdcLog";
import { salvoToSaveState, type PdcSalvoSaveState } from "./pdcSystem";

/** Numéro de schéma de sauvegarde (section 10) — pas de migration exigée en version initiale ;
 * une version différente est simplement refusée (voir persistence/localSaveStore.ts). */
export const SAVE_SCHEMA_VERSION = "6";

export interface WorldSaveState {
  simTimeSeconds: number;
  speedMultiplier: TimeMultiplier;
  paused: boolean;
  missionOutcome: MissionOutcome;
  missionEndedSimTime: number | null;
  events: MissionEvent[];
  nextMissileNumber: number;
  rngState: number;
  knownPlayerTrackIds: string[];
  bodies: {
    body: RigidBodySaveState;
    knowledgeTracks: TrackSaveState[];
    knowledgeNextTrackNumber: number;
  }[];
  missiles: MissileSaveState[];
  /** Optionnels : absents des sauvegardes antérieures au journal de rejeu. */
  stepIndex?: number;
  inputLog?: InputLogSaveState;
  decoys: DecoySaveState[];
  nextDecoyNumber: number;
  trackAttribution: TrackAttributionSaveState;
  pdcSalvos: PdcSalvoSaveState[];
  nextSalvoNumber: number;
  pdcLog: PdcLogSaveState;
}

export interface SaveDocument {
  schemaVersion: string;
  savedAtIso: string;
  /** Marqué explicitement — section 11 : « basculer une sauvegarde vers test la marque
   * explicitement ; pas de retour prétendument réaliste après consultation ». */
  testMode: boolean;
  scenario: ScenarioDefinition;
  playerBodyId: string;
  world: WorldSaveState;
}

/** Capture l'état courant d'une mission en cours — jamais appelée sur une mission terminée
 * par l'appelant (voir persistence/saveController.ts). */
export function buildSaveDocument(world: SimulationWorld, scenario: ScenarioDefinition, playerBodyId: string, testMode: boolean): SaveDocument {
  const knownPlayerTrackIds: string[] = [];
  const player = world.bodies.find((b) => b.id === playerBodyId);
  if (player) knownPlayerTrackIds.push(...player.knowledge.tracks.map((t) => t.localId));

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAtIso: new Date().toISOString(),
    testMode,
    scenario,
    playerBodyId,
    world: {
      simTimeSeconds: world.simTimeSeconds,
      speedMultiplier: world.speedMultiplier,
      paused: world.paused,
      missionOutcome: world.missionOutcome,
      missionEndedSimTime: world.missionEndedSimTime,
      events: world.events,
      nextMissileNumber: world.nextMissileNumber,
      rngState: world.rng.getState(),
      knownPlayerTrackIds,
      bodies: world.bodies.map((body) => ({
        body: body.toSaveState(),
        knowledgeTracks: body.knowledge.allTracks.map(trackToSaveState),
        knowledgeNextTrackNumber: body.knowledge.nextTrackNumberForSave,
      })),
      missiles: world.missiles.map((missile) => missile.toSaveState()),
      stepIndex: world.stepIndex,
      inputLog: world.inputLog.toSaveState(),
      decoys: world.decoys.map((decoy) => decoy.toSaveState()),
      nextDecoyNumber: world.nextDecoyNumber,
      trackAttribution: world.trackAttribution.toSaveState(),
      pdcSalvos: world.pdcSalvos.map(salvoToSaveState),
      nextSalvoNumber: world.nextSalvoNumber,
      pdcLog: world.pdcLog.toSaveState(),
    },
  };
}

/**
 * Reconstruit une mission depuis une sauvegarde (section 10, SAV-01). Le scénario embarqué
 * passe par la même validation qu'un chargement frais (`validateScenario`) — une sauvegarde
 * corrompue ou incompatible est refusée par un throw, jamais silencieusement acceptée ; c'est
 * à l'appelant (persistence/localSaveStore.ts) de l'intercepter et de proposer un repli.
 */
export function restoreWorldFromSave(doc: SaveDocument): SimulationWorld {
  if (doc.schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new Error(`Version de sauvegarde incompatible (${doc.schemaVersion}, attendu ${SAVE_SCHEMA_VERSION}).`);
  }
  const scenario = validateScenario(doc.scenario);

  const bodies: BodyRestoreState[] = doc.world.bodies.map((entry) => ({
    body: entry.body,
    knowledgeTracks: entry.knowledgeTracks,
    knowledgeNextTrackNumber: entry.knowledgeNextTrackNumber,
  }));

  const restore: WorldRestoreState = {
    simTimeSeconds: doc.world.simTimeSeconds,
    speedMultiplier: doc.world.speedMultiplier,
    paused: doc.world.paused,
    missionOutcome: doc.world.missionOutcome,
    missionEndedSimTime: doc.world.missionEndedSimTime,
    events: doc.world.events,
    nextMissileNumber: doc.world.nextMissileNumber,
    rngState: doc.world.rngState,
    knownPlayerTrackIds: doc.world.knownPlayerTrackIds,
    bodies,
    missiles: doc.world.missiles,
    stepIndex: doc.world.stepIndex,
    inputLog: doc.world.inputLog,
    decoys: doc.world.decoys,
    nextDecoyNumber: doc.world.nextDecoyNumber,
    trackAttribution: doc.world.trackAttribution,
    pdcSalvos: doc.world.pdcSalvos,
    nextSalvoNumber: doc.world.nextSalvoNumber,
    pdcLog: doc.world.pdcLog,
  };

  return new SimulationWorld(scenario, restore);
}
