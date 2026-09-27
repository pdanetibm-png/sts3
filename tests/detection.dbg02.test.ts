import { describe, expect, it } from "vitest";
import { RigidBody } from "../src/sim/rigidBody";
import { createSeededRng } from "../src/sim/rng";
import { stepDetection } from "../src/sim/detection";
import { FIXED_DT_SECONDS } from "../src/sim/integrator";
import { buildShipInit } from "./fixtures";

function buildDuel(playerVelocity: [number, number, number]) {
  const player = new RigidBody(buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: playerVelocity }));
  const adversary = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [60000, 0, 0], velocity: [0, 0, 0] }));
  adversary.sensorStates.get("ir-1")!.enabled = true;
  adversary.sensorStates.get("listen-1")!.enabled = true;
  return { player, adversary };
}

function runTicks(bodies: RigidBody[], seconds: number, seed: number): void {
  const rng = createSeededRng(seed);
  const steps = Math.round(seconds / FIXED_DT_SECONDS);
  for (let i = 0; i < steps; i++) {
    stepDetection(bodies, [], (i + 1) * FIXED_DT_SECONDS, FIXED_DT_SECONDS, rng);
  }
}

// DBG-02 : un changement caché du joueur (ici sa vitesse) sans qu'aucune condition de
// détection adverse ne soit remplie ne doit produire aucune adaptation de la connaissance
// adverse — sa `KnowledgeBase` ne doit jamais recevoir plus que ce que ses propres capteurs
// mesurent réellement.
describe("DBG-02 — adversaire non omniscient", () => {
  it("la connaissance adverse reste vide quelle que soit la manœuvre cachée du joueur, hors portée de détection", () => {
    const worldA = buildDuel([50, 0, 0]);
    const worldB = buildDuel([-4000, 1800, -900]);

    runTicks([worldA.player, worldA.adversary], 5, 42);
    runTicks([worldB.player, worldB.adversary], 5, 42);

    expect(worldA.adversary.knowledge.tracks).toHaveLength(0);
    expect(worldB.adversary.knowledge.tracks).toHaveLength(0);
  });

  it("(contrôle) la même configuration à portée de détection produit bien une piste — la connaissance vide ci-dessus n'est pas un capteur cassé", () => {
    const player = new RigidBody(buildShipInit({ id: "joueur-1", affiliation: "joueur", position: [0, 0, 0], velocity: [50, 0, 0] }));
    const adversary = new RigidBody(buildShipInit({ id: "adversaire-1", affiliation: "adversaire", position: [3000, 0, 0], velocity: [0, 0, 0] }));
    adversary.sensorStates.get("ir-1")!.enabled = true;
    player.hullTemperatureK = 320;

    runTicks([player, adversary], 5, 42);

    expect(adversary.knowledge.tracks.length).toBeGreaterThan(0);
  });
});
