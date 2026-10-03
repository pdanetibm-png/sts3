import * as THREE from "three";
import type { Track } from "../knowledge/types";
import type { Decoy } from "./decoy";
import { sectorHalfAngleFor } from "./detection";
import { frameSeconds, radarRangeFor } from "./sensorPhysics";
import { REFERENCE_CROSS_SECTION_M2 } from "./signature";
import type { SensorDef } from "./types";
import { estimateEngagementQuality, missileReachMeters } from "./missile";
import type { Missile } from "./missile";
import type { RigidBody } from "./rigidBody";
import { STANDARD_GRAVITY } from "./thrusters";

/**
 * Seule façade que l'IA reçoit pour agir sur le monde — délibérément dépourvue de tout accès
 * aux autres corps : elle ne peut structurellement pas lire une position réelle cachée (DBG-02).
 */
export interface CombatAIContext {
  launchMissile(owner: RigidBody, trackId: string, hypotheticalDistanceMeters: number): Missile | null;
  launchDecoy(owner: RigidBody): Decoy | null;
}

function enableSensor(body: RigidBody, sensorId: string | undefined): void {
  if (!sensorId) return;
  const state = body.sensorStates.get(sensorId);
  if (state) state.enabled = true;
}

/**
 * Priorité : la piste de position connue (non perdue) la plus proche — la plus menaçante et la
 * plus facile à atteindre —, sinon la piste active la plus récente (gisement seul). Les pistes
 * classées « missile probable » ne sont jamais des cibles.
 */
function pickBestTrack(allTracks: Track[], ownPositionWorld: THREE.Vector3): Track | undefined {
  const tracks = allTracks.filter((t) => t.classification !== "missile probable");
  const withPosition = tracks.filter((t) => t.positionEstimateWorld && t.state !== "lost");
  if (withPosition.length > 0) {
    const distance = (t: Track) => t.positionEstimateWorld!.distanceTo(ownPositionWorld);
    return withPosition.sort((a, b) => distance(a) - distance(b))[0];
  }
  return tracks.filter((t) => t.state !== "lost").sort((a, b) => b.lastObservationSimTime - a.lastObservationSimTime)[0];
}

/**
 * Comportement de combat minimal (section 9.3), commun aux adversaires et aux alliés — il ne
 * lit que la connaissance du vaisseau, donc jamais le camp réel d'un contact : recherche passive permanente, radar actif
 * déclenché après un délai sans piste, concentration du secteur sur une estimation connue,
 * rapprochement modéré, engagement selon sa propre estimation de réussite. Sur menace observée,
 * tactique de leurre si la doctrine la prévoit (`stepDecoyTactic`). Aucune stratégie optimale requise.
 */
export function stepCombatAI(body: RigidBody, dt: number, context: CombatAIContext): void {
  const state = body.aiState;
  const doctrine = body.doctrine;
  // Portée d'engagement : distance que le missile embarqué couvre dans le temps de vol accepté.
  const engagementRange = missileReachMeters(body.missile, doctrine.maxMissileFlightSeconds);

  const ir = body.sensors.find((s) => s.mode === "ir_passive");
  const listen = body.sensors.find((s) => s.mode === "radar_passive");
  const radar = body.sensors.find((s) => s.mode === "radar_active");
  enableSensor(body, ir?.id);
  enableSensor(body, listen?.id);

  const bestTrack = pickBestTrack(body.knowledge.tracks, body.position);
  const hasUsableTrack = !!bestTrack && bestTrack.state !== "lost";
  const hasKnownPosition = hasUsableTrack && !!bestTrack?.positionEstimateWorld;
  // Le radar n'apporte une position que lui-même : le délai de recherche porte sur l'ABSENCE
  // de position connue, pas sur l'absence de toute piste (une piste au gisement seul, via IR,
  // ne doit pas empêcher indéfiniment le passage en radar actif).
  state.timeWithoutUsableTrackSeconds = hasKnownPosition ? 0 : state.timeWithoutUsableTrackSeconds + dt;
  state.timeSinceLastShotSeconds += dt;
  state.timeSinceRadarBurstSeconds += dt;

  // La tactique de leurre, une fois engagée, prime sur l'approche : elle tient la poussée
  // (vecteur) ou la coupe (dérive, radar éteint).
  const decoyTacticActive = stepDecoyTactic(body, dt, context);

  // Défense terminale : un missile qui arrive bientôt doit être tenu par le radar, sans quoi la PDC
  // n'a rien à viser. Se taire n'a plus d'intérêt quand l'impact est imminent.
  const terminalThreat = doctrine.terminalDefenseSeconds !== undefined ? findThreat(body, doctrine.terminalDefenseSeconds, true) : null;

  if (radar) {
    const radarState = body.sensorStates.get(radar.id);
    if (radarState) {
      // Suivi : la détection recentre le secteur sur la menace à chaque pas, à la mesure de son
      // incertitude (une piste extrapolée longtemps donne un secteur large, donc une portée courte).
      radarState.followedTrackId = terminalThreat?.track.localId ?? null;
      if (terminalThreat) {
        radarState.enabled = true;
      } else if (state.decoyPhase === "derive") {
        // Se taire : un radar qui émet trahirait le vaisseau à l'écoute ennemie.
        radarState.enabled = false;
      } else if (hasUsableTrack) {
        // Radar concentré sur la piste : sa position si elle est connue, sinon le gisement IR
        // ou d'écoute qui l'a signalée (désignation par un capteur passif).
        radarState.scanDirectionWorld = hasKnownPosition
          ? bestTrack!.positionEstimateWorld!.clone().sub(body.position).normalize()
          : bestTrack!.bearingEstimateWorld.clone();
        // Secteur de doctrine au minimum, élargi à l'incertitude latérale de la piste (A2) : sinon
        // un radar pointé sur une estimation dérivée balaie à côté de la cible sans jamais la revoir.
        radarState.scanHalfAngleRad = sectorHalfAngleFor(bestTrack!, body.position, doctrine.sectorHalfAngleRad);
        radarState.enabled = radarWorthEmitting(body, radar, radarState.scanHalfAngleRad, hasKnownPosition ? bestTrack! : null, dt);
      } else if (state.timeWithoutUsableTrackSeconds >= doctrine.searchDelaySeconds) {
        radarState.scanHalfAngleRad = Math.PI;
        radarState.enabled = radarWorthEmitting(body, radar, Math.PI, null, dt);
      } else {
        radarState.enabled = false;
      }
    }
  }

  if (!decoyTacticActive) steerTowardTrack(body, bestTrack, hasUsableTrack, hasKnownPosition, engagementRange);

  const inRange = hasKnownPosition && bestTrack!.positionEstimateWorld!.distanceTo(body.position) <= engagementRange;
  if (inRange && body.missileCount > 0 && state.timeSinceLastShotSeconds >= doctrine.fireCooldownSeconds) {
    const quality = estimateEngagementQuality(bestTrack, body.position);
    if (quality === "moyenne" || quality === "élevée") {
      const missile = context.launchMissile(body, bestTrack!.localId, engagementRange);
      if (missile) state.timeSinceLastShotSeconds = 0;
    }
  }
}

/**
 * Discipline d'émission (doctrine `radarBurstIntervalSeconds`). Sans elle : toujours. Avec elle :
 * piste à distance connue → seulement si elle est à portée (sinon émettre ne sert qu'à se
 * trahir) ; distance inconnue → une impulsion d'un balayage, espacée de l'intervalle.
 */
function radarWorthEmitting(body: RigidBody, radar: SensorDef, halfAngleRad: number, positionedTrack: Track | null, dt: number): boolean {
  const interval = body.doctrine.radarBurstIntervalSeconds;
  if (interval === undefined) return true;
  if (positionedTrack?.positionEstimateWorld) {
    const nearest = positionedTrack.positionEstimateWorld.distanceTo(body.position) - (positionedTrack.positionUncertaintyMeters ?? 0);
    return nearest <= radarRangeFor(radar, positionedTrack.crossSectionEstimateM2 ?? REFERENCE_CROSS_SECTION_M2, halfAngleRad);
  }
  const state = body.aiState;
  if (state.timeSinceRadarBurstSeconds >= interval) state.timeSinceRadarBurstSeconds = 0;
  // Un balayage complet (la mesure n'arrive qu'à sa fin), plus une marge d'un pas.
  return state.timeSinceRadarBurstSeconds < frameSeconds(radar, halfAngleRad) + 2 * dt;
}

interface Threat {
  track: Track;
  lineOfSight: THREE.Vector3;
  relativeVelocity: THREE.Vector3;
}

/**
 * Menace (CONCEPTION_LEURRES.md §7) : une piste « missile probable » de sa propre connaissance,
 * avec position et vitesse estimées, qui se rapproche et arrive avant `threatSeconds`. Renvoie la
 * plus pressante. Aucune donnée cachée : seule la connaissance du vaisseau est lue (DBG-02).
 * `includeLost` : une piste perdue faute de mesures garde sa position extrapolée, qui dit au moins
 * où chercher (un missile en dérive va tout droit) — c'est ce qu'il faut pour rallumer le radar.
 */
function findThreat(body: RigidBody, threatSeconds: number, includeLost = false): Threat | null {
  let best: Threat | null = null;
  let bestTimeToGo = Number.POSITIVE_INFINITY;
  for (const track of body.knowledge.tracks) {
    if (track.classification !== "missile probable" || (track.state === "lost" && !includeLost) || !track.positionEstimateWorld || !track.velocityEstimateWorld) continue;
    const offset = track.positionEstimateWorld.clone().sub(body.position);
    const distance = offset.length();
    if (distance < 1) continue;
    const lineOfSight = offset.divideScalar(distance);
    const relativeVelocity = track.velocityEstimateWorld.clone().sub(body.velocity);
    const closing = -relativeVelocity.dot(lineOfSight);
    if (closing <= 0) continue;
    const timeToGo = distance / closing;
    if (timeToGo <= threatSeconds && timeToGo < bestTimeToGo) {
      best = { track, lineOfSight, relativeVelocity };
      bestTimeToGo = timeToGo;
    }
  }
  return best;
}

/** Direction perpendiculaire à la ligne de visée d'une menace et à sa route relative : l'écart latéral maximal. */
function perpendicularTo(lineOfSight: THREE.Vector3, relativeVelocity: THREE.Vector3): THREE.Vector3 {
  let lateral = new THREE.Vector3().crossVectors(lineOfSight, relativeVelocity);
  if (lateral.lengthSq() < 1e-9) lateral = new THREE.Vector3().crossVectors(lineOfSight, Math.abs(lineOfSight.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  return lateral.normalize();
}

/**
 * Tient le cap demandé ; ne pousse qu'une fois à peu près aligné (même règle que l'approche). La
 * manœuvre d'évasion pousse à fond, sans dépasser le seuil de tolérance de l'équipage.
 */
function holdVector(body: RigidBody): void {
  const localAxis = new THREE.Vector3(...body.principalThruster.localAxis).normalize();
  const forward = localAxis.clone().applyQuaternion(body.attitude);
  const wanted = localAxis.clone().applyQuaternion(body.command.targetAttitude);
  const crewLimitedThrottle = (body.crew.gThreshold * STANDARD_GRAVITY * body.massKg) / body.principalThruster.maxThrustNewtons;
  body.command.attitudeHoldEngaged = true;
  body.command.throttle = forward.dot(wanted) > 0.95 ? Math.min(1, crewLimitedThrottle) : 0;
}

function dropAndDrift(body: RigidBody, context: CombatAIContext): boolean {
  const state = body.aiState;
  const decoy = context.launchDecoy(body);
  if (!decoy) {
    state.decoyPhase = "aucune";
    return false;
  }
  state.timeSinceLastDecoySeconds = 0;
  state.decoyPhase = "derive";
  state.decoyPhaseRemainingSeconds = body.doctrine.decoyDriftSeconds ?? 0;
  body.command.throttle = 0;
  return true;
}

/**
 * Tactique de leurre de l'IA (CONCEPTION_LEURRES.md §7), la même pour les deux camps : sur menace,
 * larguer si l'on pousse ; sinon prendre d'abord un vecteur perpendiculaire à la menace
 * (`decoyVectorSeconds`, retournement compris), puis larguer ; enfin dériver moteurs coupés et
 * radar éteint (`decoyDriftSeconds`). Renvoie `true` tant qu'elle tient les commandes.
 */
function stepDecoyTactic(body: RigidBody, dt: number, context: CombatAIContext): boolean {
  const doctrine = body.doctrine;
  const state = body.aiState;
  state.timeSinceLastDecoySeconds += dt;
  if (doctrine.decoyThreatSeconds === undefined) return false;

  if (state.decoyPhase === "derive") {
    state.decoyPhaseRemainingSeconds -= dt;
    if (state.decoyPhaseRemainingSeconds > 0) {
      body.command.throttle = 0;
      return true;
    }
    state.decoyPhase = "aucune";
    return false;
  }

  if (state.decoyPhase === "vecteur") {
    state.decoyPhaseRemainingSeconds -= dt;
    const vectorSeconds = doctrine.decoyVectorSeconds ?? 0;
    // Plus de propergol, ou jamais parvenu à pousser : la manœuvre est abandonnée.
    if (body.reservoir.quantityKg <= 0 || state.decoyPhaseRemainingSeconds < -Math.max(vectorSeconds, 1)) {
      state.decoyPhase = "aucune";
      body.command.throttle = 0;
      return false;
    }
    if (state.decoyPhaseRemainingSeconds <= 0 && body.principalThrottle > 0) return dropAndDrift(body, context);
    holdVector(body);
    return true;
  }

  if (body.decoyCount <= 0 || state.timeSinceLastDecoySeconds < (doctrine.decoyCooldownSeconds ?? 0)) return false;
  const threat = findThreat(body, doctrine.decoyThreatSeconds);
  if (!threat) return false;
  if (body.principalThrottle > 0) return dropAndDrift(body, context);
  if (body.reservoir.quantityKg <= 0) return false;

  const localAxis = new THREE.Vector3(...body.principalThruster.localAxis).normalize();
  body.command.targetAttitude.copy(new THREE.Quaternion().setFromUnitVectors(localAxis, perpendicularTo(threat.lineOfSight, threat.relativeVelocity)));
  state.decoyPhase = "vecteur";
  state.decoyPhaseRemainingSeconds = doctrine.decoyVectorSeconds ?? 0;
  holdVector(body);
  return true;
}

const STANDOFF_FRACTION_OF_ENGAGEMENT_RANGE = 0.8;

/**
 * Manœuvre d'approche. Avec une position : « vitesse à gagner » vers une vitesse relative visée
 * le long de la ligne de visée — la dérive latérale est donc corrigée, sans quoi on croiserait
 * la cible au large. Le rapprochement visé suit un profil « freinable » (√(2·a·d) jusqu'à la
 * distance de maintien) ; la vitesse de croisière limite l'accélération mais n'impose jamais de
 * freinage : si la cible fonce sur nous sans dépasser le profil, on la laisse venir. Avec un
 * gisement seul, approche le long du gisement à vitesse de croisière. Jamais en dessous de la
 * réserve de propergol ; un ailier ne devance pas son chef de formation de plus que la doctrine
 * ne le permet. Zone morte à la mesure de l'incertitude sur la vitesse de la cible : on ne brûle
 * pas de propergol pour poursuivre du bruit d'estimation.
 */
function steerTowardTrack(body: RigidBody, track: Track | undefined, hasUsableTrack: boolean, hasKnownPosition: boolean, engagementRange: number): void {
  const doctrine = body.doctrine;
  if (!hasUsableTrack || !track || body.reservoir.quantityKg <= doctrine.propellantReserveFraction * body.reservoir.capacityKg) {
    body.command.throttle = 0;
    return;
  }
  let thrustDirection: THREE.Vector3 | null = null;
  if (hasKnownPosition) {
    const toTarget = track.positionEstimateWorld!.clone().sub(body.position);
    const distance = toTarget.length();
    if (distance < 1) {
      body.command.throttle = 0;
      return;
    }
    const lineOfSight = toTarget.divideScalar(distance);
    const relativeVelocity = body.velocity.clone().sub(track.velocityEstimateWorld ?? new THREE.Vector3());
    const closing = relativeVelocity.dot(lineOfSight);
    const braking = (doctrine.approachThrottle * body.principalThruster.maxThrustNewtons) / body.massKg;
    const standoff = STANDOFF_FRACTION_OF_ENGAGEMENT_RANGE * engagementRange;
    const brakeProfile = Math.sqrt(2 * braking * Math.max(0, distance - standoff));
    let desiredClosing = Math.min(doctrine.cruiseSpeedMps, brakeProfile);
    if (closing > desiredClosing && closing <= brakeProfile) desiredClosing = closing;
    const formation = wingmanFormation(body, lineOfSight, distance, track);
    if (formation?.position === "devant") desiredClosing = Math.min(desiredClosing, formation.leaderClosing);
    if (formation?.position === "derriere") {
      const catchUp = Math.min(doctrine.cruiseSpeedMps, Math.sqrt(2 * braking * formation.gapMeters));
      desiredClosing = Math.max(desiredClosing, Math.min(brakeProfile, formation.leaderClosing + catchUp));
    }
    // On peut renoncer à sa propre vitesse d'approche, jamais reculer pour tenir la distance :
    // une cible qui fonce sur nous, on la laisse venir plutôt que de brûler du propergol à fuir.
    const targetApproach = -(track.velocityEstimateWorld?.dot(lineOfSight) ?? 0);
    desiredClosing = Math.max(desiredClosing, targetApproach);
    // Correction latérale seulement si la dérive dépasse ce que l'incertitude sur la vitesse de
    // la cible explique ; le rapprochement, lui, suit le profil quelle que soit la distance.
    const lateral = relativeVelocity.clone().addScaledVector(lineOfSight, -closing).negate();
    if (lateral.length() < Math.max(doctrine.brakeClosingSpeedMps, 2 * (track.velocityUncertaintyMps ?? 0))) lateral.set(0, 0, 0);
    const velocityToGain = lineOfSight.clone().multiplyScalar(desiredClosing - closing).add(lateral);
    if (velocityToGain.length() > doctrine.brakeClosingSpeedMps) thrustDirection = velocityToGain.normalize();
  } else {
    const bearing = track.bearingEstimateWorld.clone();
    const closing = body.velocity.dot(bearing);
    if (closing < doctrine.cruiseSpeedMps - doctrine.brakeClosingSpeedMps && wingmanFormation(body, bearing, null, track)?.position !== "devant") thrustDirection = bearing;
  }

  if (!thrustDirection) {
    body.command.throttle = 0;
    return;
  }
  const localAxis = new THREE.Vector3(...body.principalThruster.localAxis).normalize();
  body.command.targetAttitude.copy(new THREE.Quaternion().setFromUnitVectors(localAxis, thrustDirection));
  body.command.attitudeHoldEngaged = true;
  // Ne pousse qu'une fois à peu près aligné : sinon la poussée partirait de travers.
  const forward = localAxis.applyQuaternion(body.attitude);
  body.command.throttle = forward.dot(thrustDirection) > 0.95 ? doctrine.approachThrottle : 0;
}

/**
 * Un allié se règle sur le vaisseau du joueur, connu par liaison de données : trop en avance vers
 * la cible, il cale son rapprochement sur celui de son chef au lieu de partir seul devant ; trop
 * en retard, il le rattrape. `null` : pas de contrainte de formation (dans la tolérance, ou pas
 * d'ailier).
 */
function wingmanFormation(
  body: RigidBody,
  direction: THREE.Vector3,
  distanceToTarget: number | null,
  track: Track,
): { position: "devant" | "derriere"; leaderClosing: number; gapMeters: number } | null {
  if (body.affiliation !== "allie") return null;
  const leader = body.knowledge.friendlies.find((f) => f.affiliation === "joueur" && !f.neutralized);
  if (!leader) return null;
  const lead =
    distanceToTarget !== null && track.positionEstimateWorld
      ? leader.positionWorld.distanceTo(track.positionEstimateWorld) - distanceToTarget
      : body.position.clone().sub(leader.positionWorld).dot(direction);
  const tolerance = body.doctrine.wingmanMaxLeadMeters;
  if (Math.abs(lead) <= tolerance) return null;
  const leaderClosing = leader.velocityWorld.clone().sub(track.velocityEstimateWorld ?? new THREE.Vector3()).dot(direction);
  return { position: lead > 0 ? "devant" : "derriere", leaderClosing, gapMeters: Math.abs(lead) - tolerance };
}
