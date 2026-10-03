import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import catalogJson from "../public/catalog/catalogue.json";
import scenarioJson from "../public/scenarios/demo-duel.json";
import { DEFAULT_ESTIMATION_ASSUMPTIONS, findTwinTrack } from "../src/knowledge/fusion";
import { KnowledgeBase } from "../src/knowledge/knowledgeBase";
import type { Observation } from "../src/knowledge/types";
import { resolveScenario, validateCatalog, type ScenarioFile } from "../src/sim/catalog";
import { buildFleetScenario } from "../src/sim/fleet";
import { SimulationWorld } from "../src/sim/world";

const DEMO = { ...DEFAULT_ESTIMATION_ASSUMPTIONS, ...scenarioJson.assumptions };

function ir(simTime: number, bearing: Vector3): Observation {
  return { simTime, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: bearing.clone().normalize(), bearingUncertaintyRad: 2e-5 };
}

/** Gisement dans le plan horizontal, angle en degrés. */
const at = (degrees: number) => new Vector3(Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180), 0);

describe("Pistes candidates et confirmées (M sur N)", () => {
  it("une détection isolée reste candidate ; la deuxième mesure la confirme", () => {
    const knowledge = new KnowledgeBase();
    knowledge.assumptions = DEMO;
    knowledge.ingest(ir(0, at(0)), new Vector3());
    expect(knowledge.tracks).toHaveLength(0);
    expect(knowledge.allTracks).toHaveLength(1);
    knowledge.ingest(ir(1.5, at(0.001)), new Vector3());
    expect(knowledge.tracks).toHaveLength(1);
  });

  it("un objet proche et rapide vu en IR toutes les 10 s (rotation de 4 à 10° par image) garde une seule piste", () => {
    // Sauts mesurés sur le missile-4 de la partie du 03/10 : 5,8°, 4,3°, 5,4°, 9,7°.
    const knowledge = new KnowledgeBase();
    knowledge.assumptions = { ...DEMO, unknownBearingRateRadPerSecond: 0.012 };
    const observer = new Vector3();
    let angle = 0;
    knowledge.ingest(ir(0, at(angle)), observer);
    for (const [t, jump] of [[10, 5.8], [20, 4.3], [30, 5.4], [40, 9.7]] as const) {
      angle += jump;
      for (let s = t - 10; s < t; s += 1 / 6) knowledge.extrapolateAll(s + 1 / 6, 1 / 6, observer);
      knowledge.ingest(ir(t, at(angle)), observer);
    }
    expect(knowledge.allTracks).toHaveLength(1);
    expect(knowledge.tracks[0].history).toHaveLength(5);
  });

  it("deux contacts lointains et lents ne fusionnent pas pour autant", () => {
    const knowledge = new KnowledgeBase();
    knowledge.assumptions = DEMO;
    const observer = new Vector3();
    for (const t of [0, 10, 20]) {
      knowledge.ingestScan([ir(t, at(0.0001 * t)), ir(t, at(3 + 0.0001 * t))], observer);
      for (let s = t; s < t + 10; s += 1) knowledge.extrapolateAll(s + 1, 1, observer);
    }
    expect(knowledge.tracks).toHaveLength(2);
  });
});

describe("Dédoublement de piste (leurre ou missile qui sort du vaisseau)", () => {
  it("une piste qui apparaît dans la même direction et à la même distance qu'une autre est signalée comme jumelle", () => {
    const knowledge = new KnowledgeBase();
    const observer = new Vector3();
    const radar = (simTime: number, bearing: Vector3, range: number): Observation => ({
      simTime,
      sourceSensorId: "radar-1",
      mode: "radar_active",
      bearingWorld: bearing.clone().normalize(),
      bearingUncertaintyRad: 1e-3,
      rangeMeters: range,
      rangeUncertaintyMeters: 5,
      crossSectionEstimateM2: 300,
    });
    const ship = knowledge.ingest(radar(0, at(0), 100e3), observer);
    const twin = knowledge.ingest(radar(0.5, at(0.5), 101e3), observer);
    const far = knowledge.ingest(radar(1, at(30), 100e3), observer);
    expect(findTwinTrack(knowledge.tracks, twin, observer)).toBe(ship);
    expect(findTwinTrack(knowledge.tracks, far, observer)).toBeNull();
  });
});

describe("Ailier en retard sur son chef", () => {
  it("il pousse à pleine puissance pour le rattraper, au lieu de la poussée d'approche", () => {
    const catalog = validateCatalog(JSON.parse(JSON.stringify(catalogJson)));
    const scenario = buildFleetScenario(resolveScenario(JSON.parse(JSON.stringify(scenarioJson)) as ScenarioFile, catalog), { allies: 1, enemies: 1 });
    const world = new SimulationWorld(scenario);
    const player = world.getBody("joueur-1")!;
    const ally = world.bodies.find((b) => b.affiliation === "allie")!;
    // Le chef fonce vers l'adversaire (+X), plein gaz.
    player.command.throttle = 1;
    let maxAllyThrottle = 0;
    for (let step = 0; step < 60 * 240; step++) {
      world.stepOnce();
      maxAllyThrottle = Math.max(maxAllyThrottle, ally.command.throttle);
    }
    expect(ally.doctrine.approachThrottle).toBeLessThan(1);
    expect(maxAllyThrottle).toBe(1);
  });
});
