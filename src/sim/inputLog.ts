import { quatToTuple, tupleToQuat, tupleToVec3, vecToTuple } from "../shared/vecSerialization";
import type { NavMode } from "./navigation";
import type { PdcMode } from "./pdc";
import type { RigidBody } from "./rigidBody";

/** Valeur JSON d'une commande joueur aplatie (nombre, booléen, identifiant, vecteur/quaternion). */
export type ControlValue = number | boolean | string | null | number[];

/**
 * Entrée joueur enregistrée entre deux pas de simulation (`step` = nombre de pas déjà
 * exécutés au moment de l'action). Au rejeu, elle s'applique juste avant le pas `step + 1`.
 */
export type RecordedInput =
  | { step: number; kind: "controls"; set: Record<string, ControlValue> }
  | { step: number; kind: "launch"; ownerId: string; trackId: string; hypotheticalDistanceMeters: number }
  | { step: number; kind: "decoy"; ownerId: string };

export interface InputLogSaveState {
  inputs: RecordedInput[];
}

interface MissileLike {
  id: string;
  ownerId: string;
  assignedTrackId: string | null;
}

/**
 * Photographie aplatie de tout ce que le joueur peut modifier depuis une console. Les consoles
 * mutent directement ces champs ; on les compare donc d'un pas à l'autre plutôt que
 * d'instrumenter chaque bouton.
 */
export function captureControls(body: RigidBody, missiles: readonly MissileLike[]): Record<string, ControlValue> {
  const controls: Record<string, ControlValue> = {
    "command.throttle": body.command.throttle,
    "command.attitudeHoldEngaged": body.command.attitudeHoldEngaged,
    "command.targetAttitude": quatToTuple(body.command.targetAttitude),
    "command.navMode": body.command.navMode,
    "command.navTrackId": body.command.navTrackId,
    "pdc.mode": body.pdcCommand.mode,
    "pdc.manualTrackId": body.pdcCommand.manualTrackId,
  };
  for (const [sensorId, state] of body.sensorStates) {
    controls[`sensor.${sensorId}.enabled`] = state.enabled;
    controls[`sensor.${sensorId}.scanDirectionWorld`] = vecToTuple(state.scanDirectionWorld);
    controls[`sensor.${sensorId}.scanHalfAngleRad`] = state.scanHalfAngleRad;
    controls[`sensor.${sensorId}.followedTrackId`] = state.followedTrackId;
  }
  for (const missile of missiles) {
    if (missile.ownerId !== body.id) continue;
    controls[`missile.${missile.id}.assignedTrackId`] = missile.assignedTrackId;
  }
  return controls;
}

export function applyControls(body: RigidBody, missiles: readonly MissileLike[], set: Record<string, ControlValue>): void {
  for (const [key, value] of Object.entries(set)) {
    const parts = key.split(".");
    if (parts[0] === "command") {
      switch (parts[1]) {
        case "throttle":
          body.command.throttle = value as number;
          break;
        case "attitudeHoldEngaged":
          body.command.attitudeHoldEngaged = value as boolean;
          break;
        case "targetAttitude":
          body.command.targetAttitude.copy(tupleToQuat(value as [number, number, number, number]));
          break;
        case "navMode":
          body.command.navMode = value as NavMode;
          break;
        case "navTrackId":
          body.command.navTrackId = value as string | null;
          break;
      }
    } else if (parts[0] === "pdc") {
      if (parts[1] === "mode") body.pdcCommand.mode = value as PdcMode;
      else if (parts[1] === "manualTrackId") body.pdcCommand.manualTrackId = value as string | null;
    } else if (parts[0] === "sensor") {
      const field = parts[parts.length - 1];
      const sensorId = parts.slice(1, -1).join(".");
      const state = body.sensorStates.get(sensorId);
      if (!state) continue;
      switch (field) {
        case "enabled":
          state.enabled = value as boolean;
          break;
        case "scanDirectionWorld":
          state.scanDirectionWorld.copy(tupleToVec3(value as [number, number, number]));
          break;
        case "scanHalfAngleRad":
          state.scanHalfAngleRad = value as number;
          break;
        case "followedTrackId":
          state.followedTrackId = value as string | null;
          break;
      }
    } else if (parts[0] === "missile") {
      const missileId = parts.slice(1, -1).join(".");
      const missile = missiles.find((m) => m.id === missileId);
      if (missile) missile.assignedTrackId = value as string | null;
    }
  }
}

function diffControls(before: Record<string, ControlValue>, after: Record<string, ControlValue>): Record<string, ControlValue> | null {
  let changed: Record<string, ControlValue> | null = null;
  for (const [key, value] of Object.entries(after)) {
    const previous = before[key];
    const same = Array.isArray(value) && Array.isArray(previous) ? value.every((v, i) => v === previous[i]) : value === previous;
    if (!same) {
      changed ??= {};
      changed[key] = value;
    }
  }
  return changed;
}

/**
 * Journal des entrées du joueur depuis le début de la mission. Avec le scénario (graine
 * incluse), il suffit à rejouer exactement toute la partie — voir sim/replay.ts.
 */
export class InputLog {
  readonly inputs: RecordedInput[] = [];
  private baseline: Record<string, ControlValue> | null = null;

  /** Référence de comparaison, prise à la fin de chaque pas : les modifications faites par la
   * simulation elle-même (suivi radar, mode interception) ne sont donc jamais prises pour des
   * entrées joueur. */
  setBaseline(body: RigidBody, missiles: readonly MissileLike[]): void {
    this.baseline = captureControls(body, missiles);
  }

  recordControlChanges(step: number, body: RigidBody, missiles: readonly MissileLike[]): void {
    const current = captureControls(body, missiles);
    const changed = this.baseline ? diffControls(this.baseline, current) : current;
    if (changed) this.inputs.push({ step, kind: "controls", set: changed });
  }

  recordLaunch(step: number, ownerId: string, trackId: string, hypotheticalDistanceMeters: number): void {
    this.inputs.push({ step, kind: "launch", ownerId, trackId, hypotheticalDistanceMeters });
  }

  recordDecoy(step: number, ownerId: string): void {
    this.inputs.push({ step, kind: "decoy", ownerId });
  }

  load(saved: InputLogSaveState): void {
    this.inputs.length = 0;
    this.inputs.push(...saved.inputs);
  }

  toSaveState(): InputLogSaveState {
    return { inputs: this.inputs };
  }
}
