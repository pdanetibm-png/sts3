import { buildDecoyReport, type DecoyReportEntry } from "./decoyReport";
import type { DiagnosticSample } from "./diagnosticLog";
import { applyControls, type RecordedInput } from "./inputLog";
import type { MissionEvent, MissionOutcome } from "./mission";
import { pdcEngagementVerdict, type PdcEngagement } from "./pdcLog";
import { buildSaveDocument, restoreWorldFromSave, type SaveDocument } from "./save";
import type { MissileLaunchAttribution, TrackAttribution } from "./trackAttribution";
import type { ScenarioDefinition } from "./types";
import { SimulationWorld } from "./world";

export const REPLAY_EXPORT_FORMAT = "scs-deroulement";
/** 2 : leurres, attribution des pistes, rapport par leurre. 3 : engagements PDC. */
export const REPLAY_EXPORT_VERSION = 3;
const KEYFRAME_INTERVAL_STEPS = 60 * 30;

/**
 * Fichier « déroulement de partie » : scénario + entrées joueur depuis le début suffisent à
 * rejouer exactement la mission (simulation déterministe) ; les instantanés permettent de
 * repartir de n'importe quel point sans tout rejouer, l'état final sert à vérifier que le
 * rejeu retombe bien sur ce que le joueur a vécu.
 */
export interface ReplayExport {
  format: typeof REPLAY_EXPORT_FORMAT;
  formatVersion: number;
  exportedAtIso: string;
  seed: number;
  objective: string;
  playerBodyId: string;
  missionOutcome: MissionOutcome;
  finalSimTime: number;
  finalStepIndex: number;
  scenario: ScenarioDefinition;
  inputs: RecordedInput[];
  /** Pris en mémoire depuis le lancement ou la dernière reprise de cette page (sans les traînées). */
  keyframes: SaveDocument[];
  finalState: SaveDocument;
  events: MissionEvent[];
  /** Résumé lisible 1 échantillon/s — couvre la même période que les instantanés. */
  samples: DiagnosticSample[];
  /** Source réelle des mesures de chaque piste, et de la piste visée par chaque missile au tir. */
  trackAttribution: { tracks: TrackAttribution[]; missileLaunches: MissileLaunchAttribution[] };
  /** Par leurre : pistes ennemies alimentées ou reprises, missiles attirés, verdict. */
  decoyReport: DecoyReportEntry[];
  /** Par engagement de tourelle : piste, ce qu'elle suivait vraiment, erreur de piste, obus, meilleur passage, résultat. */
  pdcReport: (PdcEngagement & { verdict: string })[];
}

/** Capture périodique d'instantanés complets pendant la partie, à la frontière exacte d'un pas. */
export class ReplayRecorder {
  readonly keyframes: SaveDocument[] = [];

  constructor(
    private readonly world: SimulationWorld,
    private readonly playerBodyId: string,
    private readonly testMode: boolean,
  ) {
    this.capture();
    world.onStepCompleted = () => {
      if (world.stepIndex % KEYFRAME_INTERVAL_STEPS === 0) this.capture();
    };
  }

  private capture(): void {
    const doc = buildSaveDocument(this.world, this.world.scenario, this.playerBodyId, this.testMode);
    for (const entry of doc.world.bodies) entry.body.trail = [];
    for (const missile of doc.world.missiles) missile.trail = [];
    for (const decoy of doc.world.decoys) decoy.trail = [];
    // Le journal d'entrées complet figure une seule fois, au niveau du fichier.
    delete doc.world.inputLog;
    this.keyframes.push(JSON.parse(JSON.stringify(doc)));
  }

  buildExport(): ReplayExport {
    const world = this.world;
    const finalState = buildSaveDocument(world, world.scenario, this.playerBodyId, this.testMode);
    delete finalState.world.inputLog;
    return {
      format: REPLAY_EXPORT_FORMAT,
      formatVersion: REPLAY_EXPORT_VERSION,
      exportedAtIso: new Date().toISOString(),
      seed: world.seed,
      objective: world.objective,
      playerBodyId: this.playerBodyId,
      missionOutcome: world.missionOutcome,
      finalSimTime: world.simTimeSeconds,
      finalStepIndex: world.stepIndex,
      scenario: world.scenario,
      inputs: world.inputLog.inputs,
      keyframes: this.keyframes,
      finalState,
      events: world.events,
      samples: world.diagnosticLog.samplesForExport,
      trackAttribution: { tracks: world.trackAttribution.tracks, missileLaunches: [...world.trackAttribution.launches] },
      decoyReport: buildDecoyReport(world),
      pdcReport: world.pdcLog.engagements.map((e) => ({ ...e, verdict: pdcEngagementVerdict(e) })),
    };
  }
}

export interface ReplayOptions {
  untilStep: number;
  /** Appelé après chaque pas ; renvoyer `false` arrête le rejeu. */
  onStep?: (world: SimulationWorld) => boolean | void;
}

/**
 * Fait avancer `world` pas à pas en réappliquant les entrées enregistrées, exactement comme
 * en partie : tirs puis consignes de l'intervalle, puis le pas suivant.
 */
export function replayInputs(world: SimulationWorld, inputs: readonly RecordedInput[], options: ReplayOptions): SimulationWorld {
  const byStep = new Map<number, RecordedInput[]>();
  for (const input of inputs) {
    if (input.step < world.stepIndex) continue;
    const list = byStep.get(input.step);
    if (list) list.push(input);
    else byStep.set(input.step, [input]);
  }

  const player = world.playerBody;
  while (world.stepIndex < options.untilStep && world.missionOutcome === "en_cours" && !world.invariantViolation) {
    const pending = byStep.get(world.stepIndex);
    if (pending && player) {
      // Tirs et largages dans l'ordre où le joueur les a donnés, puis les consignes.
      for (const input of pending) {
        if (input.kind === "launch") world.launchPlayerMissile(input.trackId, input.hypotheticalDistanceMeters);
        else if (input.kind === "decoy") world.launchPlayerDecoy();
      }
      for (const input of pending) {
        if (input.kind === "controls") applyControls(player, world.missiles, input.set);
      }
    }
    world.stepOnce();
    if (options.onStep?.(world) === false) break;
  }
  return world;
}

/**
 * Rejoue un fichier exporté depuis le dernier instantané antérieur ou égal à `fromSimTime`
 * (ou depuis le début de la mission si aucun ne convient).
 */
export function replayFromExport(exported: ReplayExport, options: ReplayOptions & { fromSimTime?: number }): SimulationWorld {
  const from = options.fromSimTime;
  const keyframe =
    from === undefined
      ? undefined
      : [...exported.keyframes].reverse().find((k) => k.world.simTimeSeconds <= from + 1e-9);
  const world = keyframe ? restoreWorldFromSave(keyframe) : new SimulationWorld(exported.scenario);
  return replayInputs(world, exported.inputs, options);
}
