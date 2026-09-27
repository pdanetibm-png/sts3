import { Vector3 } from "three";
import type { Track } from "../knowledge/types";
import { tupleToVec3, vecToTuple, type Vec3Tuple } from "../shared/vecSerialization";
import { campOf, sameCamp } from "./camps";
import { estimatedTimeToGo, firingSolution, hasFiringData, presentedArea, salvoKillProbability, type FiringSolution, type PdcMountState } from "./pdc";
import type { RigidBody } from "./rigidBody";
import type { Affiliation } from "./types";
import type { SimulationWorld } from "./world";

/**
 * Rafale en vol : paquet d'obus tirés au même pas par une tourelle. Elle ne vise rien d'elle-même ;
 * elle vole en ligne droite vers le point prévu par la piste du bord au moment du tir.
 */
export interface PdcSalvo {
  id: string;
  ownerId: string;
  mountId: string;
  affiliation: Affiliation;
  /** Piste visée (analyse et affichage). */
  trackId: string;
  position: Vector3;
  velocity: Vector3;
  rounds: number;
  muzzleVelocityMps: number;
  dispersionRad: number;
  maxRangeMeters: number;
  ageSeconds: number;
  /** Objets dont le passage au plus près a déjà été résolu pour cette rafale. */
  resolvedIds: string[];
}

export interface PdcSalvoSaveState extends Omit<PdcSalvo, "position" | "velocity"> {
  position: Vec3Tuple;
  velocity: Vec3Tuple;
}

export function salvoToSaveState(salvo: PdcSalvo): PdcSalvoSaveState {
  return { ...salvo, position: vecToTuple(salvo.position), velocity: vecToTuple(salvo.velocity), resolvedIds: [...salvo.resolvedIds] };
}

export function salvoFromSaveState(saved: PdcSalvoSaveState): PdcSalvo {
  return { ...saved, position: tupleToVec3(saved.position), velocity: tupleToVec3(saved.velocity), resolvedIds: [...saved.resolvedIds] };
}

interface Candidate {
  track: Track;
  timeToGo: number;
}

/**
 * Pistes que la conduite de tir peut prendre à partie, de la plus pressante à la moins pressante —
 * connaissance seule. Auto : « missile probable » non perdues qui se rapprochent. Manuel : la piste
 * désignée, quelle que soit sa classification (la qualité de piste informe sans bloquer).
 */
function candidates(body: RigidBody): Candidate[] {
  const command = body.pdcCommand;
  const list: Candidate[] = [];
  for (const track of body.knowledge.tracks) {
    if (!hasFiringData(track)) continue;
    if (command.mode === "manuel") {
      if (track.localId !== command.manualTrackId) continue;
    } else if (track.classification !== "missile probable" || track.state === "lost") {
      continue;
    }
    const timeToGo = estimatedTimeToGo(track, body.position, body.velocity);
    if (command.mode === "auto" && !Number.isFinite(timeToGo)) continue;
    list.push({ track, timeToGo });
  }
  return list.sort((a, b) => a.timeToGo - b.timeToGo);
}

function solutionFor(body: RigidBody, mount: PdcMountState, track: Track): FiringSolution | null {
  if (!hasFiringData(track)) return null;
  const solution = firingSolution(body.position, body.velocity, track.positionEstimateWorld, track.velocityEstimateWorld, mount.def.muzzleVelocityMps);
  return solution && solution.interceptRangeMeters <= mount.def.maxRangeMeters ? solution : null;
}

function setTarget(mount: PdcMountState, trackId: string | null): void {
  if (mount.targetTrackId === trackId) return;
  mount.targetTrackId = trackId;
  mount.retargetRemainingSeconds = trackId ? mount.def.retargetSeconds : 0;
  mount.roundAccumulator = 0;
  mount.engagementAnnounced = false;
}

/** Objet réel suivi par une piste (analyse seulement) : missile, leurre ou vaisseau. */
function truePositionOf(world: SimulationWorld, objectId: string | null): Vector3 | null {
  if (!objectId) return null;
  return world.missiles.find((m) => m.id === objectId)?.position ?? world.decoys.find((d) => d.id === objectId)?.position ?? world.getBody(objectId)?.position ?? null;
}

/**
 * Conduite de tir de toutes les tourelles, pour un pas (CONCEPTION_PDC.md §2) : choix des cibles,
 * pointage, cadence, munitions. Ne lit que la connaissance du vaisseau ; seul le journal d'analyse
 * consulte la vérité.
 */
export function stepPdcFireControl(world: SimulationWorld, dt: number): void {
  for (const body of world.bodies) {
    if (body.pdcMounts.length === 0) continue;
    for (const mount of body.pdcMounts) mount.firing = false;
    if (body.neutralized || body.pdcCommand.mode === "arret") {
      for (const mount of body.pdcMounts) setTarget(mount, null);
      continue;
    }

    const list = candidates(body);
    const taken = new Set<string>();
    const blue = campOf(body.affiliation) === "bleu";
    for (const mount of body.pdcMounts) {
      if (mount.roundsRemaining <= 0) {
        setTarget(mount, null);
        continue;
      }
      // Garder sa cible tant qu'elle reste valable et qu'aucune autre tourelle ne la traite déjà ;
      // sinon la plus pressante libre, ou à défaut la plus pressante.
      const reachable = list.filter((c) => solutionFor(body, mount, c.track));
      const current = mount.targetTrackId ? reachable.find((c) => c.track.localId === mount.targetTrackId) : undefined;
      const free = reachable.find((c) => !taken.has(c.track.localId));
      let chosen = current && (!taken.has(current.track.localId) || !free) ? current : undefined;
      if (!chosen) chosen = free ?? reachable[0];
      setTarget(mount, chosen?.track.localId ?? null);
      if (!chosen) continue;
      taken.add(chosen.track.localId);

      if (mount.retargetRemainingSeconds > 0) {
        mount.retargetRemainingSeconds = Math.max(0, mount.retargetRemainingSeconds - dt);
        if (mount.retargetRemainingSeconds > 0) continue;
      }
      mount.roundAccumulator += mount.def.rateOfFireRoundsPerSecond * dt;
      const rounds = Math.min(Math.floor(mount.roundAccumulator), mount.roundsRemaining);
      if (rounds <= 0) continue;
      mount.roundAccumulator -= rounds;
      mount.roundsRemaining -= rounds;
      if (mount.roundsRemaining === 0) mount.roundAccumulator = 0;
      mount.firing = true;

      const solution = solutionFor(body, mount, chosen.track)!;
      world.pdcSalvos.push({
        id: `salve-${world.nextSalvoNumber++}`,
        ownerId: body.id,
        mountId: mount.id,
        affiliation: body.affiliation,
        trackId: chosen.track.localId,
        position: body.position.clone(),
        velocity: body.velocity.clone().addScaledVector(solution.aimDirectionWorld, mount.def.muzzleVelocityMps),
        rounds,
        muzzleVelocityMps: mount.def.muzzleVelocityMps,
        dispersionRad: mount.def.dispersionRad,
        maxRangeMeters: mount.def.maxRangeMeters,
        ageSeconds: 0,
        resolvedIds: [],
      });

      const trueSource = world.trackAttribution.currentSource(body.id, chosen.track.localId);
      const truePosition = truePositionOf(world, trueSource);
      world.pdcLog.recordSalvo(
        body.id,
        mount.id,
        chosen.track.localId,
        rounds,
        world.simTimeSeconds,
        trueSource,
        truePosition && chosen.track.positionEstimateWorld ? truePosition.distanceTo(chosen.track.positionEstimateWorld) : null,
      );
      if (blue && !mount.engagementAnnounced) {
        mount.engagementAnnounced = true;
        world.addEvent("pdc", `${mount.id} (${body.name}) : feu sur ${chosen.track.localId}`);
      }
      if (blue && mount.roundsRemaining === 0) world.addEvent("pdc", `${mount.id} (${body.name}) : munitions épuisées`);
    }
  }
}

interface SmallTarget {
  id: string;
  affiliation: Affiliation;
  position: Vector3;
  velocity: Vector3;
  axisWorld: Vector3;
  areaFront: number | undefined;
  areaSide: number | undefined;
  /** Détruit plus tôt dans ce pas : plus touchable par les rafales suivantes. */
  alive: boolean;
  destroy: () => void;
}

/** Missiles et leurres actifs : les seuls objets qu'une rafale peut toucher. */
function smallTargets(world: SimulationWorld): SmallTarget[] {
  const list: SmallTarget[] = [];
  for (const missile of world.missiles) {
    if (!missile.isActive) continue;
    list.push({
      id: missile.id,
      affiliation: missile.affiliation,
      position: missile.position,
      velocity: missile.velocity,
      axisWorld: missile.axisWorld,
      areaFront: missile.def.presentedAreaFrontM2,
      areaSide: missile.def.presentedAreaSideM2,
      alive: true,
      destroy: () => {
        missile.state = "abattu";
        if (campOf(missile.affiliation) === "bleu") world.addEvent("perte_missile", `${missile.id} : liaison perdue`);
      },
    });
  }
  for (const decoy of world.decoys) {
    if (!decoy.isActive) continue;
    list.push({
      id: decoy.id,
      affiliation: decoy.affiliation,
      position: decoy.position,
      velocity: decoy.velocity,
      axisWorld: decoy.thrustDirectionWorld,
      areaFront: decoy.def.presentedAreaFrontM2,
      areaSide: decoy.def.presentedAreaSideM2,
      alive: true,
      destroy: () => {
        decoy.state = "detruit";
        decoy.endedSimTime = world.simTimeSeconds;
        if (campOf(decoy.affiliation) === "bleu") world.addEvent("leurre", `${decoy.id} : liaison perdue (impact probable)`);
      },
    });
  }
  return list;
}

/**
 * Vol des rafales et interception, pour un pas (CONCEPTION_PDC.md §3). À appeler après le
 * déplacement des missiles et des leurres : leur mouvement sur le pas se déduit de leur vitesse
 * (intégration p += v·dt). Chaque passage au plus près est résolu une seule fois par rafale.
 */
export function stepPdcSalvos(world: SimulationWorld, dt: number): void {
  if (world.pdcSalvos.length === 0) return;
  const targets = smallTargets(world);
  const survivors: PdcSalvo[] = [];
  for (const salvo of world.pdcSalvos) {
    const p0 = salvo.position.clone();
    const p1 = p0.clone().addScaledVector(salvo.velocity, dt);
    for (const target of targets) {
      if (!target.alive || sameCamp(target.affiliation, salvo.affiliation) || salvo.resolvedIds.includes(target.id)) continue;
      const q1 = target.position;
      const q0 = q1.clone().addScaledVector(target.velocity, -dt);
      const r0 = p0.clone().sub(q0);
      const dr = p1.clone().sub(q1).sub(r0);
      const lengthSq = dr.lengthSq();
      const u = lengthSq < 1e-12 ? 0 : Math.min(1, Math.max(0, -r0.dot(dr) / lengthSq));
      if (u >= 1) continue; // toujours en rapprochement : le passage viendra plus tard
      salvo.resolvedIds.push(target.id);
      const missDistance = r0.clone().addScaledVector(dr, u).length();
      const sigma = salvo.dispersionRad * salvo.muzzleVelocityMps * (salvo.ageSeconds + u * dt);
      const area = presentedArea(target.areaFront, target.areaSide, target.axisWorld, dr);
      const probability = salvoKillProbability(salvo.rounds, area, sigma, missDistance);
      const killed = probability > 0 && world.rng() < probability;
      world.pdcLog.recordPass(salvo.ownerId, salvo.mountId, salvo.trackId, {
        salvoId: salvo.id,
        objectId: target.id,
        simTime: world.simTimeSeconds - dt + u * dt,
        missDistanceMeters: missDistance,
        sigmaMeters: sigma,
        killProbability: probability,
        killed,
      });
      if (killed) {
        target.alive = false;
        target.destroy();
      }
    }
    salvo.position.copy(p1);
    salvo.ageSeconds += dt;
    if (salvo.muzzleVelocityMps * salvo.ageSeconds < salvo.maxRangeMeters) survivors.push(salvo);
  }
  world.pdcSalvos.length = 0;
  world.pdcSalvos.push(...survivors);
}
