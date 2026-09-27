import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { stepCombatAI } from "../src/sim/combatAI";
import { missileReachMeters } from "../src/sim/missile";
import { RigidBody } from "../src/sim/rigidBody";
import { SimulationWorld } from "../src/sim/world";
import { buildShipInit } from "./fixtures";

function buildDuelWorld(playerPosition: [number, number, number], playerVelocity: [number, number, number]) {
  return new SimulationWorld({
    version: "test",
    seed: 7,
    objective: "test",
    ships: [
      buildShipInit({ id: "joueur-1", affiliation: "joueur", position: playerPosition, velocity: playerVelocity }),
      buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 0, 0], velocity: [0, 0, 0] }),
    ],
  });
}

function snapshotAdversaryDecisions(world: SimulationWorld) {
  const adversary = world.getBody("adversaire-1")!;
  return {
    throttle: adversary.command.throttle,
    attitudeHoldEngaged: adversary.command.attitudeHoldEngaged,
    sensorsEnabled: adversary.sensors.map((s) => adversary.sensorStates.get(s.id)!.enabled),
    missileCount: adversary.missileCount,
    missilesLaunched: world.missiles.length,
  };
}

// DBG-02 (étendu à l'IA) : ses décisions (capteurs, cap, tir) ne dépendent que de sa propre
// `KnowledgeBase`, jamais d'un état cocher du joueur qu'elle n'a pas détecté.
describe("DBG-02 — l'IA adverse ne réagit jamais à un état caché non détecté", () => {
  it("hors de portée de tout capteur, les décisions de l'IA sont identiques quelle que soit la manœuvre cachée du joueur", () => {
    const worldA = buildDuelWorld([80000, 0, 0], [50, 0, 0]);
    const worldB = buildDuelWorld([80000, 0, 0], [-4000, 1800, -900]);

    worldA.advance(10);
    worldB.advance(10);

    expect(snapshotAdversaryDecisions(worldA)).toEqual(snapshotAdversaryDecisions(worldB));
    expect(worldA.getBody("adversaire-1")!.knowledge.tracks).toHaveLength(0);
  });
});

// MIS-04 : sur une configuration de recette, l'IA finit par rechercher, détecter et engager
// selon sa propre connaissance — jamais une donnée cible cachée ne pilote sa décision de tir.
describe("MIS-04 — adversaire actif", () => {
  it("détecte, se rapproche puis finit par tirer sur une cible à portée, sans jamais recevoir sa position réelle", () => {
    const world = buildDuelWorld([3000, 400, -200], [0, 0, 0]);

    world.advance(90);

    const adversary = world.getBody("adversaire-1")!;
    expect(adversary.knowledge.tracks.length).toBeGreaterThan(0);
    expect(world.missiles.length).toBeGreaterThan(0);
    expect(adversary.missileCount).toBeLessThan(4);
  });
});

// Portée d'engagement (section 9.3 : « rapprochement modéré », pas une poursuite sans fin) :
// sans plafond, une approche à poussée constante jamais freinée fait grimper la vitesse de
// rapprochement indéfiniment tant que la cible reste hors d'atteinte, rendant toute
// confrontation impossible (signalé en jeu : l'adversaire finit hors de portée de tout).
describe("IA adverse — cesse d'accélérer une fois à portée d'engagement", () => {
  it("loin de sa cible (mais à portée radar), accélère (poussée modérée)", () => {
    const world = buildDuelWorld([9500, 0, 0], [0, 0, 0]);
    // Délai de recherche (20 s) puis quelques balayages radar : à cette distance, proche de la
    // limite de portée, la détection est probable mais pas garantie à chaque balayage.
    world.advance(45);

    const adversary = world.getBody("adversaire-1")!;
    expect(adversary.knowledge.tracks.some((t) => t.positionEstimateWorld)).toBe(true);
    // A pris de la vitesse vers sa cible (il pousse une fois orienté).
    expect(adversary.velocity.dot(new Vector3(1, 0, 0))).toBeGreaterThan(1);
  });

  it("une fois à portée d'engagement, cesse de pousser plutôt que de foncer indéfiniment", () => {
    const world = buildDuelWorld([3000, 0, 0], [0, 0, 0]);
    world.advance(25);

    const adversary = world.getBody("adversaire-1")!;
    expect(adversary.knowledge.tracks.some((t) => t.positionEstimateWorld)).toBe(true);
    expect(adversary.command.throttle).toBe(0);
  });

  it("la vitesse reste bornée sur une poursuite longue plutôt que de croître sans fin", () => {
    // Cible hors de portée d'engagement, jamais approchée par le joueur (immobile) : sur une
    // poursuite prolongée, l'adversaire doit se stabiliser près de la portée d'engagement —
    // accélérant, freinant ou dérivant tour à tour — plutôt que d'accélérer indéfiniment.
    // Avant correctif (freinage), la vitesse mesurée dans ce scénario dépassait 900 m/s au bout
    // de quelques minutes ; on vérifie ici qu'elle reste dans un ordre de grandeur raisonnable.
    const world = buildDuelWorld([9500, 0, 0], [0, 0, 0]);

    world.advance(600);
    const adversary = world.getBody("adversaire-1")!;
    expect(adversary.velocity.length()).toBeLessThan(200);
  });

  it("freine à l'approche plutôt que de traverser la portée d'engagement de part en part", () => {
    // Régression : couper les gaz seul ne suffit pas quand l'élan accumulé est important —
    // l'adversaire traversait la portée d'engagement, ressortait à ~9500 m de l'autre côté,
    // puis revenait, en boucle perpétuelle (repéré en jeu : « il m'évite à pleine puissance »).
    // Avec freinage actif, une fois entré dans la portée d'engagement il ne doit plus en
    // ressortir largement.
    const world = buildDuelWorld([9500, 0, 0], [0, 0, 0]);
    const adversary = world.getBody("adversaire-1")!;

    world.advance(60); // détection + approche initiale, doit atteindre la portée d'engagement
    expect(adversary.position.distanceTo(new Vector3(9500, 0, 0))).toBeLessThan(8000);

    let maxDistanceAfterSettling = 0;
    for (let i = 0; i < 240; i++) {
      world.advance(1);
      maxDistanceAfterSettling = Math.max(maxDistanceAfterSettling, adversary.position.distanceTo(new Vector3(9500, 0, 0)));
    }
    // Avant correctif, cette valeur dépassait 9000 m (sortie complète après traversée). Une
    // dérive résiduelle modérée reste attendue (pas de maintien de position parfait), mais plus
    // de survol complet suivi d'un aller-retour à pleine distance.
    expect(maxDistanceAfterSettling).toBeLessThan(9000);
  });
});

describe("IA de combat commune — alliés", () => {
  it("un allié piloté par l'IA cherche, piste et finit par engager un ennemi", () => {
    const world = new SimulationWorld({
      version: "test",
      seed: 21,
      objective: "test",
      ships: [
        buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, -30000], velocity: [0, 0, 0] }),
        buildShipInit({ id: "allie-1", affiliation: "allie", position: [0, 0, 0], velocity: [0, 0, 0] }),
        buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [7000, 0, 0], velocity: [0, 0, 0] }),
      ],
    });
    for (let second = 0; second < 180 && world.missionOutcome === "en_cours"; second++) {
      world.advance(1);
      if (world.missiles.some((m) => m.ownerId === "allie-1")) break;
    }
    const ally = world.getBody("allie-1")!;
    expect(ally.knowledge.tracks.length).toBeGreaterThan(0);
    expect(world.missiles.some((m) => m.ownerId === "allie-1")).toBe(true);
    // Tir allié connu du joueur par la liaison de données.
    expect(world.events.some((e) => e.category === "lancement" && e.message.includes(ally.name))).toBe(true);
  });
});


describe("IA — cible, réserve de propergol, formation", () => {
  const noLaunch = { launchMissile: () => null, launchDecoy: () => null };

  function ingestShipTrack(body: RigidBody, position: Vector3, simTime: number): string {
    const offset = position.clone().sub(body.position);
    return body.knowledge.ingest(
      {
        simTime,
        sourceSensorId: "radar-1",
        mode: "radar_active",
        bearingWorld: offset.clone().normalize(),
        bearingUncertaintyRad: 1e-4,
        rangeMeters: offset.length(),
        rangeUncertaintyMeters: 10,
        crossSectionEstimateM2: 150,
        crossSectionLogUncertainty: 0.4,
      },
      body.position,
    ).localId;
  }

  it("tire sur la piste la plus proche, pas sur la plus récemment mise à jour", () => {
    const body = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 0, 0] }));
    const reach = missileReachMeters(body.missile, body.doctrine.maxMissileFlightSeconds);
    const near = ingestShipTrack(body, new Vector3(0.4 * reach, 0, 0), 0);
    ingestShipTrack(body, new Vector3(0, 0.9 * reach, 0), 1);
    const targets: string[] = [];
    stepCombatAI(body, 1 / 60, { launchMissile: (_owner, trackId) => (targets.push(trackId), null), launchDecoy: () => null });
    expect(targets).toEqual([near]);
  });

  it("ne pousse plus pour se positionner une fois la réserve de propergol atteinte", () => {
    const body = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [0, 0, 0] }));
    ingestShipTrack(body, new Vector3(5e6, 0, 0), 0);
    body.reservoir.quantityKg = body.doctrine.propellantReserveFraction * body.reservoir.capacityKg;
    stepCombatAI(body, 1 / 60, noLaunch);
    expect(body.command.throttle).toBe(0);
  });

  it("un ailier trop en avance sur le joueur ne fonce pas seul vers la cible", () => {
    const setup = (leaderX: number) => {
      const body = new RigidBody(buildShipInit({ id: "allie-1", affiliation: "allie", position: [0, 0, 0] }));
      body.knowledge.setFriendlies([
        {
          id: "joueur-1",
          name: "Chef",
          affiliation: "joueur",
          positionWorld: new Vector3(leaderX, 0, 0),
          velocityWorld: new Vector3(),
          attitudeWorld: new Quaternion(),
          neutralized: false,
        },
      ]);
      ingestShipTrack(body, new Vector3(2e6, 0, 0), 0);
      const forward = () => new Vector3(...body.principalThruster.localAxis).normalize().applyQuaternion(body.command.targetAttitude);
      stepCombatAI(body, 1 / 60, noLaunch);
      return { body, forward: forward() };
    };
    // Chef à côté : l'ailier s'oriente vers la cible pour approcher.
    expect(setup(0).forward.x).toBeGreaterThan(0.99);
    // Chef 100 km en arrière : l'ailier ne pousse pas vers la cible.
    const ahead = setup(-100000);
    expect(ahead.body.command.throttle === 0 || ahead.forward.x < 0.5).toBe(true);
  });
});
