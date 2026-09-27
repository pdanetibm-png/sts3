import { Vector3 } from "three";
import type { ScenarioDefinition, ShipInitialState } from "./types";

export const MAX_ALLIES = 3;
export const MIN_ENEMIES = 1;
export const MAX_ENEMIES = 4;

const ALLY_SPACING_METERS = 1500;
const ENEMY_SPACING_METERS = 2000;
const ALLY_NAMES = ["SCS Hawk", "SCS Osprey", "SCS Merlin"];
/** Rang de chaque vaisseau supplémentaire dans la formation : alternance de part et d'autre. */
const FORMATION_SLOTS = [1, -1, 2, -2];

export interface FleetComposition {
  allies: number;
  enemies: number;
}

function clampComposition(composition: FleetComposition): FleetComposition {
  return {
    allies: Math.max(0, Math.min(MAX_ALLIES, Math.round(composition.allies))),
    enemies: Math.max(MIN_ENEMIES, Math.min(MAX_ENEMIES, Math.round(composition.enemies))),
  };
}

function cloneShip(ship: ShipInitialState): ShipInitialState {
  return JSON.parse(JSON.stringify(ship)) as ShipInitialState;
}

function offsetPosition(position: [number, number, number], offset: Vector3): [number, number, number] {
  return [position[0] + offset.x, position[1] + offset.y, position[2] + offset.z];
}

/**
 * Scénario de combat N contre M dérivé d'un scénario de duel : les alliés sont des copies du
 * vaisseau joueur, les ennemis des copies du modèle adverse (symétrie d'équipement conservée),
 * disposés en ligne perpendiculaire à l'axe qui sépare les deux camps. Avec 0 allié et 1
 * ennemi, le scénario de base est renvoyé tel quel (duel du cahier des charges, §9.1).
 */
export function buildFleetScenario(base: ScenarioDefinition, requested: FleetComposition): ScenarioDefinition {
  const { allies, enemies } = clampComposition(requested);
  const player = base.ships.find((s) => s.affiliation === "joueur");
  const enemyTemplate = base.ships.find((s) => s.affiliation === "adversaire");
  if (!player || !enemyTemplate) throw new Error("Le scénario de base doit contenir un vaisseau joueur et un adversaire.");
  if (allies === 0 && enemies === 1) return base;

  const axis = new Vector3(...enemyTemplate.position).sub(new Vector3(...player.position)).normalize();
  let lateral = new Vector3().crossVectors(axis, new Vector3(0, 1, 0));
  if (lateral.lengthSq() < 1e-6) lateral = new Vector3(1, 0, 0);
  lateral.normalize();

  const usedIds = new Set(base.ships.map((s) => s.id));
  const uniqueId = (prefix: string, start: number) => {
    let n = start;
    while (usedIds.has(`${prefix}-${n}`)) n++;
    const id = `${prefix}-${n}`;
    usedIds.add(id);
    return id;
  };

  const ships: ShipInitialState[] = base.ships.filter((s) => s.affiliation !== "adversaire" || s === enemyTemplate);

  for (let i = 0; i < allies; i++) {
    const ally = cloneShip(player);
    ally.id = uniqueId("allie", i + 1);
    ally.name = ALLY_NAMES[i] ?? `SCS Allié ${i + 1}`;
    ally.affiliation = "allie";
    ally.position = offsetPosition(player.position, lateral.clone().multiplyScalar(FORMATION_SLOTS[i] * ALLY_SPACING_METERS));
    ships.push(ally);
  }

  for (let i = 1; i < enemies; i++) {
    const enemy = cloneShip(enemyTemplate);
    enemy.id = uniqueId("adversaire", i + 1);
    enemy.name = `${enemyTemplate.name} ${i + 1}`;
    const slot = FORMATION_SLOTS[i - 1];
    const offset = lateral.clone().multiplyScalar(slot * ENEMY_SPACING_METERS).add(new Vector3(0, slot * 300, 0));
    enemy.position = offsetPosition(enemyTemplate.position, offset);
    ships.push(enemy);
  }

  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
  const support = allies > 0 ? ` avec l'appui de ${plural(allies, "allié")}` : "";
  return {
    ...base,
    objective: `Neutraliser ${plural(enemies, "contact")} hostile${enemies > 1 ? "s" : ""} signalé${enemies > 1 ? "s" : ""}${support}.`,
    ships,
  };
}
