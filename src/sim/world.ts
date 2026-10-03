import { Vector3 } from "three";
import { campOf, type Camp } from "./camps";
import { stepCombatAI, type CombatAIContext } from "./combatAI";
import { stepCrewExposure } from "./crewExposure";
import { Decoy, type DecoySaveState } from "./decoy";
import { launchDecoy, stepDecoys } from "./decoySystem";
import { stepDetection } from "./detection";
import { SENSOR_MODE_LABELS } from "./sensors";
import { DiagnosticLog } from "./diagnosticLog";
import { FIXED_DT_SECONDS, integrateBody } from "./integrator";
import { InputLog, type InputLogSaveState } from "./inputLog";
import { checkWorldInvariants } from "./invariants";
import { stepLifeSupport } from "./lifeSupport";
import { Missile, type MissileSaveState } from "./missile";
import { launchMissile, stepMissiles } from "./missileSystem";
import { ECHEANCE_SECONDS, outcomeLabel, resolveOutcomeFromDisarmament, resolveOutcomeFromImpacts } from "./mission";
import { DEFAULT_ESTIMATION_ASSUMPTIONS } from "../knowledge/fusion";
import type { MissionEvent, MissionEventCategory, MissionOutcome } from "./mission";
import { updateNavigation } from "./navigation";
import { PdcEngagementLog, type PdcLogSaveState } from "./pdcLog";
import { salvoFromSaveState, stepPdcFireControl, stepPdcSalvos, type PdcSalvo, type PdcSalvoSaveState } from "./pdcSystem";
import { RigidBody, type RigidBodySaveState } from "./rigidBody";
import { createSeededRng, type SeededRng } from "./rng";
import { TrackAttributionLog, type TrackAttributionSaveState } from "./trackAttribution";
import type { ScenarioDefinition } from "./types";
import type { TrackSaveState } from "../knowledge/serialization";
import { trackFromSaveState } from "../knowledge/serialization";

/** Trois vitesses : normale, accélérée, très accélérée — adaptées aux distances réelles (milliers de km). */
export type TimeMultiplier = 1 | 10 | 100;

const TRAIL_SAMPLE_INTERVAL_SECONDS = 1;
// Seuils section 8.7 (propergol/batterie) pour le retour automatique à ×1 (TIM-03).
const RESOURCE_LOW_FRACTION = 0.2;
const RESOURCE_CRITICAL_FRACTION = 0.05;
// Seuil d'alerte "exposition dangereuse" (TIM-03) — distinct du verrou d'incapacité à 100 %.
const CREW_EXPOSURE_DANGER_FRACTION = 0.5;

type AlertLevel = "ok" | "bas" | "critique";

/** Sous-ensemble d'un `RigidBody` restaurable + sa connaissance (section 10). */
export interface BodyRestoreState {
  body: RigidBodySaveState;
  knowledgeTracks: TrackSaveState[];
  knowledgeNextTrackNumber: number;
}

/** État complet nécessaire pour reprendre une mission déjà commencée (section 10) — distinct
 * d'une construction fraîche depuis un scénario. Le RNG restaure son état interne exact (pas
 * une re-semence), sans quoi la reprise rejouerait le même bruit de capteur depuis le début. */
export interface WorldRestoreState {
  simTimeSeconds: number;
  speedMultiplier: TimeMultiplier;
  paused: boolean;
  missionOutcome: MissionOutcome;
  missionEndedSimTime: number | null;
  events: MissionEvent[];
  nextMissileNumber: number;
  rngState: number;
  knownPlayerTrackIds: string[];
  bodies: BodyRestoreState[];
  missiles: MissileSaveState[];
  /** Absents des sauvegardes antérieures au journal de rejeu — déduits/vides dans ce cas. */
  stepIndex?: number;
  inputLog?: InputLogSaveState;
  decoys: DecoySaveState[];
  nextDecoyNumber: number;
  trackAttribution: TrackAttributionSaveState;
  pdcSalvos: PdcSalvoSaveState[];
  nextSalvoNumber: number;
  pdcLog: PdcLogSaveState;
}

/** Couche "Vérité simulation" (section 3.1) — seule source de vérité physique. */
export class SimulationWorld {
  readonly bodies: RigidBody[] = [];
  readonly missiles: Missile[] = [];
  readonly decoys: Decoy[] = [];
  /** Rafales de PDC en vol (CONCEPTION_PDC.md). */
  readonly pdcSalvos: PdcSalvo[] = [];
  readonly scenario: ScenarioDefinition;
  readonly seed: number;
  readonly objective: string;
  readonly rng: SeededRng;
  /** Théâtre fixe (ARM-06) : sphère de rayon 5× la séparation initiale joueur↔adversaire, calculée une fois. */
  readonly theatre: { centerWorld: Vector3; radiusMeters: number };

  simTimeSeconds = 0;
  /** Nombre de pas fixes exécutés depuis le début de la mission — horloge exacte du rejeu. */
  stepIndex = 0;
  speedMultiplier: TimeMultiplier = 1;
  paused = false;
  missionOutcome: MissionOutcome = "en_cours";
  missionEndedSimTime: number | null = null;
  readonly events: MissionEvent[] = [];
  nextMissileNumber = 1;
  nextDecoyNumber = 1;
  nextSalvoNumber = 1;
  /** Outil de mise au point (DBG-01) — vérité complète des deux camps, jamais montré en partie réaliste. */
  readonly diagnosticLog = new DiagnosticLog();
  /** Source réelle des mesures de chaque piste (analyse des leurres) — vérité interne, même restriction. */
  readonly trackAttribution = new TrackAttributionLog();
  /** Engagements PDC (analyse) — vérité interne, même restriction. */
  readonly pdcLog = new PdcEngagementLog();
  /** Entrées du joueur depuis le début de la mission — rejouables exactement (sim/replay.ts). */
  readonly inputLog = new InputLog();
  /** Appelé à la fin de chaque pas, avant toute action console de l'intervalle suivant. */
  onStepCompleted: ((world: SimulationWorld) => void) | null = null;
  /** État non fini/invariant critique détecté (section 10) — la simulation se met en pause. */
  invariantViolation: { message: string } | null = null;

  private accumulator = 0;
  private lastTrailSampleSeconds = 0;
  private readonly knownPlayerTrackIds = new Set<string>();
  private readonly alertLevels = new Map<string, AlertLevel>();
  private readonly combatAIContext: CombatAIContext;

  constructor(scenario: ScenarioDefinition, restore?: WorldRestoreState) {
    this.scenario = scenario;
    this.seed = scenario.seed;
    this.objective = scenario.objective;
    this.rng = createSeededRng(scenario.seed, restore?.rngState);
    for (const ship of scenario.ships) {
      const body = new RigidBody(ship);
      body.knowledge.assumptions = { ...DEFAULT_ESTIMATION_ASSUMPTIONS, ...scenario.assumptions };
      this.bodies.push(body);
    }

    // ARM-06 : théâtre fixe centré entre les barycentres des deux camps, rayon 5× leur séparation
    // (en duel, identique à la séparation joueur↔adversaire).
    const blue = centroid(scenario.ships.filter((s) => campOf(s.affiliation) === "bleu").map((s) => s.position));
    const red = centroid(scenario.ships.filter((s) => campOf(s.affiliation) === "rouge").map((s) => s.position));
    if (blue && red) {
      this.theatre = { centerWorld: blue.clone().add(red).multiplyScalar(0.5), radiusMeters: blue.distanceTo(red) * 5 };
    } else {
      this.theatre = { centerWorld: new Vector3(), radiusMeters: Number.POSITIVE_INFINITY };
    }

    this.combatAIContext = {
      launchMissile: (owner, trackId, hypotheticalDistanceMeters) => launchMissile(this, owner, trackId, hypotheticalDistanceMeters),
      launchDecoy: (owner) => launchDecoy(this, owner),
    };

    if (restore) this.applyRestoreState(restore, scenario);
    this.updateDatalink();
    const playerBody = this.playerBody;
    if (playerBody) this.inputLog.setBaseline(playerBody, this.missiles);
  }

  get playerBody(): RigidBody | undefined {
    return this.bodies.find((b) => b.affiliation === "joueur");
  }

  /** Reprise d'une mission sauvegardée (section 10, SAV-01) — appliquée après la construction
   * "fraîche" ci-dessus, même schéma que RigidBody/Missile : construire puis corriger. */
  private applyRestoreState(restore: WorldRestoreState, scenario: ScenarioDefinition): void {
    this.simTimeSeconds = restore.simTimeSeconds;
    this.speedMultiplier = restore.speedMultiplier;
    this.paused = restore.paused;
    this.missionOutcome = restore.missionOutcome;
    this.missionEndedSimTime = restore.missionEndedSimTime;
    this.events.length = 0;
    this.events.push(...restore.events);
    this.nextMissileNumber = restore.nextMissileNumber;
    this.stepIndex = restore.stepIndex ?? Math.round(restore.simTimeSeconds / FIXED_DT_SECONDS);
    if (restore.inputLog) this.inputLog.load(restore.inputLog);
    this.knownPlayerTrackIds.clear();
    for (const id of restore.knownPlayerTrackIds) this.knownPlayerTrackIds.add(id);

    for (const entry of restore.bodies) {
      const body = this.getBody(entry.body.id);
      if (!body) continue;
      body.applySaveState(entry.body);
      body.knowledge.loadTracks(entry.knowledgeTracks.map(trackFromSaveState), entry.knowledgeNextTrackNumber);
    }

    this.missiles.length = 0;
    for (const saved of restore.missiles) {
      const ownerShip = scenario.ships.find((s) => s.id === saved.ownerId);
      if (!ownerShip) continue;
      this.missiles.push(Missile.fromSaveState(saved, ownerShip.missile));
    }

    this.nextDecoyNumber = restore.nextDecoyNumber;
    this.decoys.length = 0;
    for (const saved of restore.decoys) {
      const decoyDef = scenario.ships.find((s) => s.id === saved.ownerId)?.decoy;
      if (!decoyDef) continue;
      this.decoys.push(Decoy.fromSaveState(saved, decoyDef));
    }
    this.trackAttribution.load(restore.trackAttribution);

    this.nextSalvoNumber = restore.nextSalvoNumber;
    this.pdcSalvos.length = 0;
    this.pdcSalvos.push(...restore.pdcSalvos.map(salvoFromSaveState));
    this.pdcLog.load(restore.pdcLog);
  }

  getBody(id: string): RigidBody | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  addEvent(category: MissionEventCategory, message: string): void {
    this.events.push({ simTime: this.simTimeSeconds, category, message });
  }

  /** Avance la simulation d'un temps réel écoulé ; ne fait rien en pause (TIM-05) ni après la fin de mission (ARM-04). */
  advance(realDeltaSeconds: number): void {
    if (this.paused || this.missionOutcome !== "en_cours") return;
    this.accumulator += realDeltaSeconds * this.speedMultiplier;
    while (this.accumulator >= FIXED_DT_SECONDS) {
      this.stepOnce();
      this.accumulator -= FIXED_DT_SECONDS;
      if (this.missionOutcome !== "en_cours" || this.paused) break;
    }
  }

  /** Un pas fixe, indépendamment de la pause et du temps réel — utilisé aussi par le rejeu. */
  stepOnce(): void {
    const player = this.playerBody;
    if (player) this.inputLog.recordControlChanges(this.stepIndex, player, this.missiles);
    this.stepIndex += 1;
    this.simTimeSeconds += FIXED_DT_SECONDS;
    this.step(FIXED_DT_SECONDS);
    if (player) this.inputLog.setBaseline(player, this.missiles);
    this.onStepCompleted?.(this);
  }

  /** Tir ordonné depuis une console : passe par ici pour être enregistré et rejouable. */
  launchPlayerMissile(trackId: string, hypotheticalDistanceMeters: number): Missile | null {
    const player = this.playerBody;
    if (!player) return null;
    const missile = launchMissile(this, player, trackId, hypotheticalDistanceMeters);
    if (missile) this.inputLog.recordLaunch(this.stepIndex, player.id, trackId, hypotheticalDistanceMeters);
    return missile;
  }

  /** Largage ordonné depuis une console : enregistré et rejouable, comme un tir. */
  launchPlayerDecoy(): Decoy | null {
    const player = this.playerBody;
    if (!player) return null;
    const decoy = launchDecoy(this, player);
    if (decoy) this.inputLog.recordDecoy(this.stepIndex, player.id);
    return decoy;
  }

  private step(dt: number): void {
    for (const body of this.bodies) {
      integrateBody(body, dt);
      body.stepThermal(dt);
      if (body.neutralized) continue;
      stepCrewExposure(body, dt);
      stepLifeSupport(body, dt);
    }
    for (const body of this.bodies) {
      if (body.affiliation !== "joueur" && !body.neutralized) stepCombatAI(body, dt, this.combatAIContext);
      updateNavigation(body);
    }
    // Tous les corps bougent avant que les capteurs ne mesurent : une observation datée de ce pas
    // décrit la position de ce pas (auparavant, missiles et leurres étaient vus avec un pas de
    // retard, soit 150 m à 9 km/s). Leurres avant missiles : la collision d'un missile se teste
    // sur la position de fin de pas du leurre, comme pour les vaisseaux.
    stepDecoys(this, dt);
    stepMissiles(this, dt);
    stepDetection(this.bodies, [...this.missiles, ...this.decoys], this.simTimeSeconds, dt, this.rng, (observer, track, sourceId) =>
      this.trackAttribution.record(observer.id, track.localId, sourceId, this.simTimeSeconds),
    );
    this.logNewPlayerDetections();
    this.checkCriticalAlertsAndAutoSlow();
    // Défense rapprochée après la détection : la conduite de tir lit la connaissance de ce pas, les
    // rafales résolvent leur passage sur le mouvement de ce pas.
    stepPdcFireControl(this, dt);
    stepPdcSalvos(this, dt);
    this.neutralizeIncapacitatedShips();
    this.updateDatalink();
    this.resolveMissionOutcome();
    this.diagnosticLog.maybeSample(this);

    if (this.simTimeSeconds - this.lastTrailSampleSeconds >= TRAIL_SAMPLE_INTERVAL_SECONDS) {
      this.lastTrailSampleSeconds = this.simTimeSeconds;
      for (const body of this.bodies) {
        body.trail.push(body.position.clone());
        if (body.trail.length > 600) body.trail.shift();
      }
    }

    const violation = checkWorldInvariants(this);
    if (violation) {
      this.invariantViolation = violation;
      this.paused = true;
    }
  }

  private logNewPlayerDetections(): void {
    const player = this.bodies.find((b) => b.affiliation === "joueur");
    if (!player) return;
    for (const track of player.knowledge.tracks) {
      if (!this.knownPlayerTrackIds.has(track.localId)) {
        this.knownPlayerTrackIds.add(track.localId);
        this.addEvent("detection", `Nouvelle piste ${track.localId} détectée (${SENSOR_MODE_LABELS[track.lastObservation.mode]}).`);
        // TIM-03 : nouvelle détection connue de l'équipage ⇒ retour automatique à ×1.
        this.speedMultiplier = 1;
      }
    }
  }

  /**
   * TIM-03 : retour automatique à ×1 sur alerte critique connue de l'équipage (réserves
   * basses/critiques, exposition G dangereuse — section 8.7). Seuils du JOUEUR uniquement :
   * l'état de l'adversaire n'est jamais une connaissance du joueur (DBG-02). Ne déclenche que
   * sur une hausse de sévérité (dédupliqué) et ne relève jamais automatiquement la vitesse
   * après acquittement — le joueur doit la remonter lui-même.
   */
  private checkCriticalAlertsAndAutoSlow(): void {
    const player = this.bodies.find((b) => b.affiliation === "joueur");
    if (!player) return;
    const propellantFraction = player.reservoir.capacityKg > 0 ? player.reservoir.quantityKg / player.reservoir.capacityKg : 1;
    const batteryFraction = player.battery.capacityWattSeconds > 0 ? player.battery.currentChargeWattSeconds / player.battery.capacityWattSeconds : 1;
    this.applyAlertLevel(`${player.id}:propergol`, resourceAlertLevel(propellantFraction));
    this.applyAlertLevel(`${player.id}:batterie`, resourceAlertLevel(batteryFraction));
    this.applyAlertLevel(`${player.id}:exposition`, crewExposureAlertLevel(player.crewExposureFraction));
  }

  private applyAlertLevel(key: string, level: AlertLevel): void {
    const previous = this.alertLevels.get(key) ?? "ok";
    this.alertLevels.set(key, level);
    if (level !== "ok" && alertLevelRank(level) > alertLevelRank(previous)) this.speedMultiplier = 1;
  }

  /** Équipage incapacité (PHY-08) ou support vie épuisé (RES-02) : le vaisseau est hors de combat. */
  private neutralizeIncapacitatedShips(): void {
    for (const body of this.bodies) {
      if (body.neutralized || !(body.crewExposureIncapacitated || body.lifeSupportFailed)) continue;
      body.neutralize();
      // Seul l'état du camp bleu est connu du joueur (liaison de données).
      if (campOf(body.affiliation) === "bleu") {
        const cause = body.crewExposureIncapacitated ? "équipage incapacité" : "support vie épuisé";
        this.addEvent("neutralisation", `${body.name} hors de combat — ${cause}.`);
      }
    }
  }

  /** Liaison de données : chaque vaisseau connaît en permanence les vaisseaux de son camp. */
  private updateDatalink(): void {
    for (const observer of this.bodies) {
      observer.knowledge.setFriendlies(
        this.bodies
          .filter((b) => b !== observer && campOf(b.affiliation) === campOf(observer.affiliation))
          .map((b) => ({
            id: b.id,
            name: b.name,
            affiliation: b.affiliation,
            positionWorld: b.position.clone(),
            velocityWorld: b.velocity.clone(),
            attitudeWorld: b.attitude.clone(),
            neutralized: b.neutralized,
          })),
      );
    }
  }

  /**
   * Camp désarmé : il était armé au départ (un camp sans missile dès le scénario n'est pas
   * « désarmé », c'est une cible), n'a plus de missile en soute sur ses vaisseaux actifs, et
   * aucun de ses missiles en vol ne peut encore toucher.
   */
  private isCampDisarmed(camp: Camp): boolean {
    const initiallyArmed = this.scenario.ships.some((s) => campOf(s.affiliation) === camp && s.missileCount > 0);
    if (!initiallyArmed) return false;
    const ownShips = this.bodies.filter((b) => campOf(b.affiliation) === camp && !b.neutralized);
    if (ownShips.some((b) => b.missileCount > 0)) return false;
    const targets = this.bodies.filter((b) => campOf(b.affiliation) !== camp && !b.neutralized);
    return !this.missiles.some((m) => campOf(m.affiliation) === camp && missileStillThreatens(m, targets));
  }

  /**
   * Issue de la mission, une seule fois par pas après toutes les neutralisations (impacts et
   * causes internes) : la simultanéité exacte est donc toujours reconnue (MIS-05).
   */
  resolveMissionOutcome(): void {
    if (this.missionOutcome !== "en_cours") return;
    const enemies = this.bodies.filter((b) => b.affiliation === "adversaire");
    const playerDown = !!this.playerBody?.neutralized;
    const allEnemiesDown = enemies.length > 0 && enemies.every((b) => b.neutralized);
    const outcome =
      resolveOutcomeFromImpacts(playerDown, allEnemiesDown) ??
      resolveOutcomeFromDisarmament(this.isCampDisarmed("bleu"), this.isCampDisarmed("rouge")) ??
      (this.simTimeSeconds >= (this.scenario.deadlineSeconds ?? ECHEANCE_SECONDS) ? "echeance" : null);
    if (!outcome) return;
    this.missionOutcome = outcome;
    this.missionEndedSimTime = this.simTimeSeconds;
    this.addEvent("verdict", outcomeLabel(outcome));
  }
}

/**
 * Un missile en vol peut encore toucher tant qu'il se rapproche d'un vaisseau adverse actif,
 * ou qu'il garde du propergol et une piste pour se guider. Au-delà, il dérive en ligne droite
 * en s'éloignant de toutes ses cibles possibles : il ne menace plus personne.
 */
function missileStillThreatens(missile: Missile, targets: readonly RigidBody[]): boolean {
  if (!missile.isActive) return false;
  if (missile.state === "poussee" && missile.reservoir.quantityKg > 0 && missile.assignedTrackId !== null) return true;
  for (const ship of targets) {
    const relativePosition = ship.position.clone().sub(missile.position);
    const relativeVelocity = ship.velocity.clone().sub(missile.velocity);
    if (relativePosition.dot(relativeVelocity) < 0) return true;
  }
  return false;
}

function centroid(points: readonly [number, number, number][]): Vector3 | null {
  if (points.length === 0) return null;
  const sum = new Vector3();
  for (const p of points) sum.add(new Vector3(...p));
  return sum.divideScalar(points.length);
}

function alertLevelRank(level: AlertLevel): number {
  return level === "critique" ? 2 : level === "bas" ? 1 : 0;
}

function resourceAlertLevel(remainingFraction: number): AlertLevel {
  if (remainingFraction <= RESOURCE_CRITICAL_FRACTION) return "critique";
  if (remainingFraction <= RESOURCE_LOW_FRACTION) return "bas";
  return "ok";
}

function crewExposureAlertLevel(fraction: number): AlertLevel {
  if (fraction >= 1) return "critique";
  if (fraction >= CREW_EXPOSURE_DANGER_FRACTION) return "bas";
  return "ok";
}
