import type {
  Affiliation,
  ConsumerDef,
  CrewDef,
  DecoyDef,
  DoctrineDef,
  PdcDef,
  EstimationAssumptions,
  MissileDef,
  QuatTuple,
  ScenarioDefinition,
  SensorDef,
  ShipInitialState,
  SignatureDef,
  ThrusterDef,
  Vec3Tuple,
} from "./types";

/**
 * Catalogue de matériel (ARCHITECTURE_SIMULATION.md §3) : des composants aux caractéristiques
 * physiques, et des assemblages qui en font des vaisseaux. Les scénarios y font référence par
 * identifiant ; le moteur ne reçoit que le scénario résolu (`ScenarioDefinition`), autonome —
 * une sauvegarde reste donc valide même si le catalogue évolue ensuite.
 */

interface Named {
  id: string;
  name: string;
}

export interface HullComponent extends Named {
  dryMassKg: number;
  momentOfInertiaKgM2: Vec3Tuple;
  collisionRadiusMeters: number;
  signature: SignatureDef;
}

export interface EngineComponent extends Named {
  kind: ThrusterDef["kind"];
  maxThrustNewtons: number;
  specificImpulseSeconds: number;
  plumeRadiantFraction?: number;
  wasteHeatFraction?: number;
}

export interface TankComponent extends Named {
  capacityKg: number;
}

export interface ReactorComponent extends Named {
  maxPowerWatts: number;
  fuelConsumptionKgPerSecondAtMaxPower: number;
  efficiency: number;
}

export interface BatteryComponent extends Named {
  capacityWattSeconds: number;
  maxChargeRateWatts: number;
  maxDischargeRateWatts: number;
}

export type SensorComponent = Named & Omit<SensorDef, "id">;
export type CrewComponent = Named & CrewDef;
export type MissileComponent = Named & MissileDef;
export type DecoyComponent = Named & DecoyDef;
export type PdcComponent = Named & PdcDef;
export type DoctrineComponent = Named & DoctrineDef;

export interface ShipAssembly extends Named {
  hull: string;
  thrusters: { id: string; component: string; localPosition: Vec3Tuple; localAxis: Vec3Tuple }[];
  tank: { component: string; quantityKg: number };
  reactor: string;
  battery: { component: string; chargeWattSeconds: number };
  sensors: { id: string; component: string }[];
  electricalLoads: ConsumerDef[];
  crew: string;
  doctrine: string;
  missiles: { missile: string; count: number };
  /** Optionnel : aucun leurre si absent. */
  decoys?: { decoy: string; count: number };
  /** Optionnel : tourelles de défense rapprochée montées. */
  pdcs?: { id: string; component: string }[];
}

export interface CatalogDocument {
  catalogVersion: string;
  description?: string;
  components: {
    hulls: HullComponent[];
    engines: EngineComponent[];
    tanks: TankComponent[];
    reactors: ReactorComponent[];
    batteries: BatteryComponent[];
    sensors: SensorComponent[];
    crews: CrewComponent[];
    missiles: MissileComponent[];
    doctrines: DoctrineComponent[];
    /** Optionnel : catalogues antérieurs aux leurres. */
    decoys?: DecoyComponent[];
    /** Optionnel : catalogues antérieurs aux PDC. */
    pdcs?: PdcComponent[];
  };
  assemblies: ShipAssembly[];
}

/** Vaisseau d'un scénario : un assemblage du catalogue, placé et affecté à un camp. */
export interface ScenarioShipRef {
  id: string;
  name: string;
  affiliation: Affiliation;
  assembly: string;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
  attitude: QuatTuple;
  angularVelocity: Vec3Tuple;
}

export interface ScenarioFile {
  version: string;
  seed: number;
  objective: string;
  /** Chemin du catalogue, relatif au site. */
  catalog: string;
  deadlineSeconds?: number;
  assumptions?: EstimationAssumptions;
  ships: ScenarioShipRef[];
}

export class CatalogError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Catalogue ou scénario invalide :\n- ${reasons.join("\n- ")}`);
    this.name = "CatalogError";
  }
}

const COMPONENT_SECTIONS = ["hulls", "engines", "tanks", "reactors", "batteries", "sensors", "crews", "missiles", "doctrines"] as const;
/** Sections qu'un catalogue peut omettre (ajoutées après coup). */
const OPTIONAL_COMPONENT_SECTIONS = ["decoys", "pdcs"] as const;
type ComponentSection = (typeof COMPONENT_SECTIONS)[number] | (typeof OPTIONAL_COMPONENT_SECTIONS)[number];

/**
 * Contrôle de structure du catalogue : sections présentes, identifiants uniques, références
 * des assemblages résolues. Les valeurs physiques elles-mêmes sont validées ensuite sur le
 * scénario résolu (`validateScenario`), avec les mêmes règles que pour un scénario écrit à la main.
 */
export function validateCatalog(candidate: unknown): CatalogDocument {
  const reasons: string[] = [];
  const doc = candidate as Partial<CatalogDocument> | null;
  if (!doc || typeof doc !== "object") throw new CatalogError(["document catalogue absent ou invalide"]);
  if (typeof doc.catalogVersion !== "string") reasons.push("catalogVersion manquant");

  const components = (doc.components ?? {}) as Partial<CatalogDocument["components"]>;
  const ids = new Map<string, Set<string>>();
  for (const section of [...COMPONENT_SECTIONS, ...OPTIONAL_COMPONENT_SECTIONS]) {
    const list = components[section];
    const optional = (OPTIONAL_COMPONENT_SECTIONS as readonly string[]).includes(section);
    if (!Array.isArray(list)) {
      if (!(optional && list === undefined)) reasons.push(`components.${section} doit être une liste`);
      ids.set(section, new Set());
      continue;
    }
    const seen = new Set<string>();
    list.forEach((entry, i) => {
      const e = entry as Partial<Named>;
      if (typeof e.id !== "string" || e.id.length === 0) reasons.push(`components.${section}[${i}].id manquant`);
      else if (seen.has(e.id)) reasons.push(`components.${section} : identifiant dupliqué « ${e.id} »`);
      else seen.add(e.id);
      if (typeof e.name !== "string" || e.name.length === 0) reasons.push(`components.${section}[${i}].name manquant`);
    });
    ids.set(section, seen);
  }

  if (!Array.isArray(doc.assemblies)) {
    reasons.push("assemblies doit être une liste");
  } else {
    const seenAssemblies = new Set<string>();
    doc.assemblies.forEach((assembly, i) => {
      const tag = `assemblage « ${assembly?.id ?? i} »`;
      if (typeof assembly?.id !== "string") reasons.push(`assemblies[${i}].id manquant`);
      else if (seenAssemblies.has(assembly.id)) reasons.push(`assemblies : identifiant dupliqué « ${assembly.id} »`);
      else seenAssemblies.add(assembly.id);
      const ref = (section: ComponentSection, id: unknown, what: string) => {
        if (typeof id !== "string" || !ids.get(section)?.has(id)) reasons.push(`${tag} : ${what} inconnu « ${String(id)} » (components.${section})`);
      };
      ref("hulls", assembly?.hull, "coque");
      ref("reactors", assembly?.reactor, "réacteur");
      ref("crews", assembly?.crew, "équipage");
      ref("doctrines", assembly?.doctrine, "doctrine");
      ref("tanks", assembly?.tank?.component, "réservoir");
      ref("batteries", assembly?.battery?.component, "batterie");
      ref("missiles", assembly?.missiles?.missile, "missile");
      if (assembly?.decoys !== undefined) ref("decoys", assembly.decoys?.decoy, "leurre");
      if (assembly?.pdcs !== undefined) {
        if (!Array.isArray(assembly.pdcs)) reasons.push(`${tag} : pdcs doit être une liste`);
        else assembly.pdcs.forEach((m) => ref("pdcs", m?.component, `tourelle ${m?.id ?? "?"}`));
      }
      if (!Array.isArray(assembly?.thrusters) || assembly.thrusters.length === 0) reasons.push(`${tag} : thrusters doit contenir au moins un propulseur`);
      else assembly.thrusters.forEach((t) => ref("engines", t?.component, `propulseur ${t?.id ?? "?"}`));
      if (!Array.isArray(assembly?.sensors)) reasons.push(`${tag} : sensors doit être une liste`);
      else assembly.sensors.forEach((s) => ref("sensors", s?.component, `capteur ${s?.id ?? "?"}`));
      if (!Array.isArray(assembly?.electricalLoads)) reasons.push(`${tag} : electricalLoads doit être une liste`);
    });
  }

  if (reasons.length > 0) throw new CatalogError(reasons);
  return doc as CatalogDocument;
}

function byId<T extends Named>(list: T[], id: string): T {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new CatalogError([`référence inconnue « ${id} »`]);
  return found;
}

function withoutMeta<T extends Named>(entry: T): Omit<T, "id" | "name"> {
  const { id: _id, name: _name, ...rest } = entry;
  return rest;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Construit un vaisseau complet (vérité initiale) à partir d'un assemblage du catalogue. */
export function resolveShip(catalog: CatalogDocument, ref: ScenarioShipRef): ShipInitialState {
  const assembly = catalog.assemblies.find((a) => a.id === ref.assembly);
  if (!assembly) throw new CatalogError([`vaisseau « ${ref.id} » : assemblage inconnu « ${ref.assembly} »`]);
  const c = catalog.components;
  const hull = byId(c.hulls, assembly.hull);
  const tank = byId(c.tanks, assembly.tank.component);
  const battery = byId(c.batteries, assembly.battery.component);
  const decoy = assembly.decoys ? byId(c.decoys ?? [], assembly.decoys.decoy) : undefined;

  return clone({
    id: ref.id,
    name: ref.name,
    affiliation: ref.affiliation,
    designName: assembly.name,
    crew: withoutMeta(byId(c.crews, assembly.crew)),
    doctrine: withoutMeta(byId(c.doctrines, assembly.doctrine)),
    structure: { dryMassKg: hull.dryMassKg, momentOfInertiaKgM2: hull.momentOfInertiaKgM2, collisionRadiusMeters: hull.collisionRadiusMeters },
    thrusters: assembly.thrusters.map((mount) => {
      const engine = byId(c.engines, mount.component);
      return {
        id: mount.id,
        kind: engine.kind,
        localPosition: mount.localPosition,
        localAxis: mount.localAxis,
        maxThrustNewtons: engine.maxThrustNewtons,
        specificImpulseSeconds: engine.specificImpulseSeconds,
        plumeRadiantFraction: engine.plumeRadiantFraction,
        wasteHeatFraction: engine.wasteHeatFraction,
      };
    }),
    reservoir: { capacityKg: tank.capacityKg, quantityKg: assembly.tank.quantityKg },
    generator: withoutMeta(byId(c.reactors, assembly.reactor)),
    battery: { ...withoutMeta(battery), currentChargeWattSeconds: assembly.battery.chargeWattSeconds },
    consumers: assembly.electricalLoads,
    sensors: assembly.sensors.map((mount) => ({ id: mount.id, ...withoutMeta(byId(c.sensors, mount.component)) })),
    signature: hull.signature,
    missileCount: assembly.missiles.count,
    missile: { ...withoutMeta(byId(c.missiles, assembly.missiles.missile)), name: byId(c.missiles, assembly.missiles.missile).name },
    ...(decoy && assembly.decoys ? { decoyCount: assembly.decoys.count, decoy: { ...withoutMeta(decoy), name: decoy.name } } : {}),
    ...(assembly.pdcs
      ? {
          pdcs: assembly.pdcs.map((mount) => {
            const pdc = byId(c.pdcs ?? [], mount.component);
            return { id: mount.id, pdc: { ...withoutMeta(pdc), name: pdc.name } };
          }),
        }
      : {}),
    position: ref.position,
    velocity: ref.velocity,
    attitude: ref.attitude,
    angularVelocity: ref.angularVelocity,
  });
}

/** Scénario par références → scénario autonome, prêt pour `validateScenario` puis la simulation. */
export function resolveScenario(file: ScenarioFile, catalog: CatalogDocument): ScenarioDefinition {
  const reasons: string[] = [];
  const ships: ShipInitialState[] = [];
  for (const ref of file.ships ?? []) {
    try {
      ships.push(resolveShip(catalog, ref));
    } catch (error) {
      if (error instanceof CatalogError) reasons.push(...error.reasons);
      else throw error;
    }
  }
  if (reasons.length > 0) throw new CatalogError(reasons);
  return { version: file.version, seed: file.seed, objective: file.objective, deadlineSeconds: file.deadlineSeconds, assumptions: file.assumptions, ships };
}

export function isScenarioFile(candidate: unknown): candidate is ScenarioFile {
  const c = candidate as Partial<ScenarioFile> | null;
  return !!c && typeof c.catalog === "string" && Array.isArray(c.ships);
}
