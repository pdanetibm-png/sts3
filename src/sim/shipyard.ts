import { resolveScenario, resolveShip, type CatalogDocument, type ScenarioFile, type ShipAssembly, type ShipClass } from "./catalog";
import { missileReachMeters } from "./missile";
import { sensorElectricalWatts } from "./power";
import { RigidBody } from "./rigidBody";
import { infraredRangeFor, listenRangeFor, radarRangeFor } from "./sensorPhysics";
import { hullRadiatedWatts, plumePeakIntensity } from "./signature";
import { STANDARD_GRAVITY } from "./thrusters";
import type { ScenarioDefinition, SensorDef, ShipInitialState } from "./types";

/**
 * Magasin de vaisseau (CONCEPTION_MAGASIN.md) : une classe du catalogue, et les modules que le
 * joueur y monte. Tout se ramène à un assemblage ordinaire du catalogue : le moteur reçoit un
 * vaisseau résolu comme les autres, et la sauvegarde l'embarque tel quel.
 */

export type SensorRole = SensorDef["mode"];
export const SENSOR_ROLES: readonly SensorRole[] = ["ir_passive", "radar_passive", "radar_active"];
export const SENSOR_ROLE_LABELS: Record<SensorRole, string> = {
  ir_passive: "Capteur IR",
  radar_passive: "Écoute radar",
  radar_active: "Radar",
};
/** Identifiant de montage de chaque capteur, le même que dans les assemblages du catalogue. */
const SENSOR_MOUNT_IDS: Record<SensorRole, string> = { ir_passive: "ir-1", radar_passive: "listen-1", radar_active: "radar-1" };
/** Noms des emplacements de tourelle que l'assemblage de base laisse vides. */
const PDC_MOUNT_IDS = ["pdc-dorsale", "pdc-ventrale", "pdc-babord", "pdc-tribord"];

/** Ce que le joueur a choisi. Toute référence est un identifiant du catalogue. */
export interface ShipLoadout {
  classId: string;
  /** Moteur principal. */
  engine: string;
  tank: string;
  reactor: string;
  /** Un capteur par rôle ; rôle absent : pas de capteur de ce type. */
  sensors: Partial<Record<SensorRole, string>>;
  missile: string;
  missileCount: number;
  decoy: string | null;
  decoyCount: number;
  /** Une entrée par emplacement de tourelle de la classe : la fiche montée, ou null. */
  pdcs: (string | null)[];
}

function classById(catalog: CatalogDocument, classId: string): ShipClass | undefined {
  return catalog.shipClasses?.find((c) => c.id === classId);
}

function assemblyById(catalog: CatalogDocument, id: string): ShipAssembly | undefined {
  return catalog.assemblies.find((a) => a.id === id);
}

/** Configuration d'origine d'une classe : son assemblage de base, emplacements de tourelle vides complétés. */
export function defaultLoadout(catalog: CatalogDocument, shipClass: ShipClass): ShipLoadout {
  const base = assemblyById(catalog, shipClass.baseAssembly);
  if (!base) throw new Error(`Classe « ${shipClass.id} » : assemblage de base inconnu`);
  const principal = base.thrusters.find((t) => catalog.components.engines.find((e) => e.id === t.component)?.kind === "principal");
  const sensors: Partial<Record<SensorRole, string>> = {};
  for (const mount of base.sensors) {
    const sensor = catalog.components.sensors.find((s) => s.id === mount.component);
    if (sensor && !sensors[sensor.mode]) sensors[sensor.mode] = sensor.id;
  }
  const pdcs: (string | null)[] = (base.pdcs ?? []).slice(0, shipClass.limits.pdcMounts).map((m) => m.component);
  while (pdcs.length < shipClass.limits.pdcMounts) pdcs.push(null);
  return {
    classId: shipClass.id,
    engine: principal?.component ?? "",
    tank: base.tank.component,
    reactor: base.reactor,
    sensors,
    missile: base.missiles.missile,
    missileCount: base.missiles.count,
    decoy: base.decoys?.decoy ?? null,
    decoyCount: base.decoys?.count ?? 0,
    pdcs,
  };
}

/** Classe dont l'assemblage de base est celui-ci (le vaisseau d'un scénario), sinon la première. */
export function classForAssembly(catalog: CatalogDocument, assemblyId: string): ShipClass | undefined {
  return catalog.shipClasses?.find((c) => c.baseAssembly === assemblyId) ?? catalog.shipClasses?.[0];
}

const sameLoadout = (a: ShipLoadout, b: ShipLoadout) => JSON.stringify(a) === JSON.stringify(b);

/** Assemblage du catalogue correspondant à une configuration (réservoir plein). */
export function loadoutAssembly(catalog: CatalogDocument, loadout: ShipLoadout): ShipAssembly {
  const shipClass = classById(catalog, loadout.classId);
  const base = shipClass && assemblyById(catalog, shipClass.baseAssembly);
  if (!shipClass || !base) throw new Error(`Classe de vaisseau inconnue « ${loadout.classId} »`);
  const tank = catalog.components.tanks.find((t) => t.id === loadout.tank);
  const pdcIds = (base.pdcs ?? []).map((m) => m.id);
  for (const id of PDC_MOUNT_IDS) if (!pdcIds.includes(id)) pdcIds.push(id);
  const custom = !sameLoadout(loadout, defaultLoadout(catalog, shipClass));
  return {
    ...JSON.parse(JSON.stringify(base)),
    id: `${shipClass.id}:sur-mesure`,
    name: custom ? `${shipClass.name} sur mesure` : base.name,
    thrusters: base.thrusters.map((mount) =>
      catalog.components.engines.find((e) => e.id === mount.component)?.kind === "principal" ? { ...mount, component: loadout.engine } : { ...mount },
    ),
    tank: { component: loadout.tank, quantityKg: tank?.capacityKg ?? 0 },
    reactor: loadout.reactor,
    sensors: SENSOR_ROLES.filter((role) => loadout.sensors[role]).map((role) => ({ id: SENSOR_MOUNT_IDS[role], component: loadout.sensors[role]! })),
    missiles: { missile: loadout.missile, count: loadout.missileCount },
    ...(loadout.decoy ? { decoys: { decoy: loadout.decoy, count: loadout.decoyCount } } : { decoys: undefined }),
    pdcs: loadout.pdcs.flatMap((component, i) => (component ? [{ id: pdcIds[i] ?? `pdc-${i + 1}`, component }] : [])),
  };
}

export interface PriceLine {
  label: string;
  item: string;
  quantity: number;
  unitPrice: number;
}

/** Détail du prix : coque, puis chaque module ; munitions à l'unité. Un module sans prix compte pour 0. */
export function loadoutPrice(catalog: CatalogDocument, loadout: ShipLoadout): { lines: PriceLine[]; total: number } {
  const c = catalog.components;
  const lines: PriceLine[] = [];
  const add = (label: string, entry: { name: string; price?: number } | undefined, quantity = 1) => {
    if (entry && quantity > 0) lines.push({ label, item: entry.name, quantity, unitPrice: entry.price ?? 0 });
  };
  const shipClass = classById(catalog, loadout.classId);
  const base = shipClass && assemblyById(catalog, shipClass.baseAssembly);
  add("Coque", base && c.hulls.find((h) => h.id === base.hull));
  add("Moteur", c.engines.find((e) => e.id === loadout.engine));
  add("Réservoir", c.tanks.find((t) => t.id === loadout.tank));
  add("Réacteur", c.reactors.find((r) => r.id === loadout.reactor));
  for (const role of SENSOR_ROLES) add(SENSOR_ROLE_LABELS[role], c.sensors.find((s) => s.id === loadout.sensors[role]));
  add("Missiles", c.missiles.find((m) => m.id === loadout.missile), loadout.missileCount);
  if (loadout.decoy) add("Leurres", (c.decoys ?? []).find((d) => d.id === loadout.decoy), loadout.decoyCount);
  loadout.pdcs.forEach((id, i) => id && add(`Tourelle ${i + 1}`, (c.pdcs ?? []).find((p) => p.id === id)));
  return { lines, total: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) };
}

const isCount = (n: unknown, max: number) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;

/** Ce qui empêche de valider la configuration (vide : rien). */
export function loadoutProblems(catalog: CatalogDocument, loadout: ShipLoadout, budgetCredits?: number): string[] {
  const c = catalog.components;
  const problems: string[] = [];
  const shipClass = classById(catalog, loadout.classId);
  if (!shipClass) return [`Classe de vaisseau inconnue « ${loadout.classId} ».`];
  const limits = shipClass.limits;
  const forSale = (what: string, entry: { name: string; price?: number } | undefined) => {
    if (!entry) problems.push(`${what} : module inconnu du catalogue.`);
    else if (entry.price === undefined) problems.push(`${what} : « ${entry.name} » n'est pas en vente.`);
  };

  const engine = c.engines.find((e) => e.id === loadout.engine);
  forSale("Moteur", engine);
  if (engine && engine.kind !== "principal") problems.push(`Moteur : « ${engine.name} » n'est pas un moteur principal.`);
  const tank = c.tanks.find((t) => t.id === loadout.tank);
  forSale("Réservoir", tank);
  if (tank && tank.capacityKg > limits.maxTankCapacityKg) problems.push(`Réservoir : la coque ne loge pas plus de ${Math.round(limits.maxTankCapacityKg / 1000)} t de propergol.`);
  forSale("Réacteur", c.reactors.find((r) => r.id === loadout.reactor));
  for (const role of SENSOR_ROLES) {
    const id = loadout.sensors[role];
    if (!id) continue;
    const sensor = c.sensors.find((s) => s.id === id);
    forSale(SENSOR_ROLE_LABELS[role], sensor);
    if (sensor && sensor.mode !== role) problems.push(`${SENSOR_ROLE_LABELS[role]} : « ${sensor.name} » n'est pas de ce type.`);
  }
  forSale("Missiles", c.missiles.find((m) => m.id === loadout.missile));
  if (!isCount(loadout.missileCount, limits.missiles)) problems.push(`Missiles : de 0 à ${limits.missiles} pour cette classe.`);
  if (loadout.decoy) forSale("Leurres", (c.decoys ?? []).find((d) => d.id === loadout.decoy));
  if (!isCount(loadout.decoyCount, loadout.decoy ? limits.decoys : 0)) problems.push(`Leurres : de 0 à ${limits.decoys} pour cette classe.`);
  if (!Array.isArray(loadout.pdcs) || loadout.pdcs.length !== limits.pdcMounts) problems.push(`Tourelles : ${limits.pdcMounts} emplacement(s) pour cette classe.`);
  else loadout.pdcs.forEach((id, i) => id && forSale(`Tourelle ${i + 1}`, (c.pdcs ?? []).find((p) => p.id === id)));

  if (budgetCredits !== undefined && problems.length === 0) {
    const { total } = loadoutPrice(catalog, loadout);
    if (total > budgetCredits) problems.push(`Budget dépassé de ${formatCredits(total - budgetCredits)}.`);
  }
  return problems;
}

/** Relit une configuration stockée ; `null` si elle ne ressemble pas à une configuration. */
export function parseLoadout(candidate: unknown): ShipLoadout | null {
  const l = candidate as Partial<ShipLoadout> | null;
  if (!l || typeof l !== "object") return null;
  const strings = [l.classId, l.engine, l.tank, l.reactor, l.missile];
  if (strings.some((s) => typeof s !== "string")) return null;
  if (typeof l.missileCount !== "number" || typeof l.decoyCount !== "number" || !Array.isArray(l.pdcs)) return null;
  if (!l.sensors || typeof l.sensors !== "object" || (l.decoy !== null && typeof l.decoy !== "string")) return null;
  return l as ShipLoadout;
}

/** Le scénario, avec le vaisseau du joueur construit d'après la configuration (les autres inchangés). */
export function applyLoadout(catalog: CatalogDocument, file: ScenarioFile, loadout: ShipLoadout): ScenarioDefinition {
  const assembly = loadoutAssembly(catalog, loadout);
  const augmented: CatalogDocument = { ...catalog, assemblies: [...catalog.assemblies, assembly] };
  return resolveScenario({ ...file, ships: file.ships.map((ref) => (ref.affiliation === "joueur" ? { ...ref, assembly: assembly.id } : ref)) }, augmented);
}

/** Vaisseau isolé d'après une configuration (aperçu du magasin). */
export function previewShip(catalog: CatalogDocument, loadout: ShipLoadout): ShipInitialState {
  const assembly = loadoutAssembly(catalog, loadout);
  return resolveShip(
    { ...catalog, assemblies: [...catalog.assemblies, assembly] },
    { id: "apercu", name: assembly.name, affiliation: "joueur", assembly: assembly.id, position: [0, 0, 0], velocity: [0, 0, 0], attitude: [0, 0, 0, 1], angularVelocity: [0, 0, 0] },
  );
}

// --- Caractéristiques -----------------------------------------------------------------------

export interface ShipStats {
  /** Structure, modules et munitions, réservoir vide. */
  dryMassKg: number;
  fullMassKg: number;
  thrustNewtons: number;
  specificImpulseSeconds: number;
  accelerationFullG: number;
  accelerationDryG: number;
  crewLimitG: number;
  deltaVMps: number;
  /** Durée de poussée à pleine puissance, réservoir plein. */
  burnSeconds: number;
  reactorWatts: number;
  /** Charges fixes plus tous les capteurs allumés. */
  demandWatts: number;
  /** Portées à 50 % contre le vaisseau de référence (l'adversaire du scénario) ; null sans capteur. */
  radarShipSectorMeters: number | null;
  radarShipFullSkyMeters: number | null;
  radarMissileSectorMeters: number | null;
  infraredShipMeters: number | null;
  listenMainBeamMeters: number | null;
  /** Discrétion : à quelle distance les capteurs de la référence voient ce vaisseau. */
  seenInfraredColdMeters: number | null;
  seenInfraredThrustingMeters: number | null;
  seenRadarFrontMeters: number | null;
  missileName: string;
  missileCount: number;
  missileDeltaVMps: number;
  missileReachMeters: number;
  decoyName: string | null;
  decoyCount: number;
  pdcCount: number;
  pdcRounds: number;
  pdcMaxRangeMeters: number;
}

const sensorOf = (ship: ShipInitialState, mode: SensorRole) => ship.sensors.find((s) => s.mode === mode);

/** Intensité IR d'une coque au repos (moteurs coupés, régime de croisière), dans la bande d'un capteur. */
function coldIntensity(ship: ShipInitialState, bandFraction: number): number {
  const body = new RigidBody(ship);
  return (bandFraction * hullRadiatedWatts(ship.signature.thermal, body.hullTemperatureK)) / (4 * Math.PI);
}

/**
 * Caractéristiques d'un vaisseau, calculées avec les lois de la simulation. `reference` : le
 * vaisseau contre lequel on mesure portées et discrétion (l'adversaire du scénario).
 */
export function shipStats(ship: ShipInitialState, reference: ShipInitialState): ShipStats {
  const body = new RigidBody(ship);
  const principal = ship.thrusters.find((t) => t.kind === "principal")!;
  const dryMassKg = ship.structure.dryMassKg + body.storesMassKg;
  const fullMassKg = dryMassKg + ship.reservoir.capacityKg;
  const exhaustVelocity = principal.specificImpulseSeconds * STANDARD_GRAVITY;
  const sector = ship.doctrine.sectorHalfAngleRad;

  const radar = sensorOf(ship, "radar_active");
  const ir = sensorOf(ship, "ir_passive");
  const listen = sensorOf(ship, "radar_passive");
  const enemyRadar = sensorOf(reference, "radar_active");
  const enemyIr = sensorOf(reference, "ir_passive");

  const ownColdIntensity = enemyIr ? coldIntensity(ship, enemyIr.bandFraction!) : 0;
  const ownPlumeRear = plumePeakIntensity(principal.maxThrustNewtons, principal.specificImpulseSeconds, principal.plumeRadiantFraction ?? 0);
  const pdcs = ship.pdcs ?? [];

  return {
    dryMassKg,
    fullMassKg,
    thrustNewtons: principal.maxThrustNewtons,
    specificImpulseSeconds: principal.specificImpulseSeconds,
    accelerationFullG: principal.maxThrustNewtons / fullMassKg / STANDARD_GRAVITY,
    accelerationDryG: principal.maxThrustNewtons / dryMassKg / STANDARD_GRAVITY,
    crewLimitG: ship.crew.gThreshold,
    deltaVMps: exhaustVelocity * Math.log(fullMassKg / dryMassKg),
    burnSeconds: ship.reservoir.capacityKg / (principal.maxThrustNewtons / exhaustVelocity),
    reactorWatts: ship.generator.maxPowerWatts,
    demandWatts: ship.consumers.reduce((sum, c) => sum + c.nominalPowerWatts, 0) + ship.sensors.reduce((sum, s) => sum + sensorElectricalWatts(s), 0),
    radarShipSectorMeters: radar ? radarRangeFor(radar, reference.signature.radar.crossSectionFrontM2, sector) : null,
    radarShipFullSkyMeters: radar ? radarRangeFor(radar, reference.signature.radar.crossSectionFrontM2, Math.PI) : null,
    radarMissileSectorMeters: radar ? radarRangeFor(radar, reference.missile.signature.radar.crossSectionFrontM2, sector) : null,
    infraredShipMeters: ir ? infraredRangeFor(ir, coldIntensity(reference, ir.bandFraction!), Math.PI) : null,
    listenMainBeamMeters: listen && enemyRadar ? listenRangeFor(listen, enemyRadar, true) : null,
    seenInfraredColdMeters: enemyIr ? infraredRangeFor(enemyIr, ownColdIntensity, Math.PI) : null,
    seenInfraredThrustingMeters: enemyIr ? infraredRangeFor(enemyIr, ownColdIntensity + ownPlumeRear, Math.PI) : null,
    seenRadarFrontMeters: enemyRadar ? radarRangeFor(enemyRadar, ship.signature.radar.crossSectionFrontM2, reference.doctrine.sectorHalfAngleRad) : null,
    missileName: ship.missile.name ?? "missile",
    missileCount: ship.missileCount,
    missileDeltaVMps:
      ship.missile.specificImpulseSeconds * STANDARD_GRAVITY * Math.log((ship.missile.structureMassKg + ship.missile.reservoir.quantityKg) / ship.missile.structureMassKg),
    missileReachMeters: missileReachMeters(ship.missile, ship.doctrine.maxMissileFlightSeconds),
    decoyName: ship.decoy?.name ?? null,
    decoyCount: ship.decoy ? (ship.decoyCount ?? 0) : 0,
    pdcCount: pdcs.length,
    pdcRounds: pdcs.reduce((sum, m) => sum + m.pdc.magazineRounds, 0),
    pdcMaxRangeMeters: pdcs.reduce((max, m) => Math.max(max, m.pdc.maxRangeMeters), 0),
  };
}

export function formatCredits(credits: number): string {
  return `${Math.round(credits).toLocaleString("fr-FR")} Cr`;
}
