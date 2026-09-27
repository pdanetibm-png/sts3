import type { PowerStepResult, RigidBody } from "./rigidBody";
import type { ConsumerDef, ConsumerPriorityGroup, SensorDef } from "./types";

/** Ordre de délestage (premier délesté en premier) — section 4.3 : vie/commandes délesté en dernier recours. */
const SHED_ORDER: ConsumerPriorityGroup[] = ["services", "capteurs", "propulsion_auxiliaire", "vie"];

/** Consommation électrique d'un capteur en marche : celle de sa fiche, ou à défaut sa puissance (déjà une consommation pour les capteurs passifs). */
export function sensorElectricalWatts(sensor: SensorDef): number {
  return sensor.electricalPowerWatts ?? sensor.powerWatts;
}

const SENSOR_LOAD_LABELS: Record<SensorDef["mode"], string> = {
  ir_passive: "Capteur IR",
  radar_passive: "Écoute radar",
  radar_active: "Radar actif",
};

/** Identifiant de la charge électrique d'un capteur (distinct des consommateurs fixes). */
export function sensorLoadId(sensorId: string): string {
  return `capteur:${sensorId}`;
}

/** Une charge du réseau de bord : consommateur fixe, ou capteur (actif seulement en marche). */
export interface ElectricalLoad extends ConsumerDef {
  active: boolean;
  sensorId?: string;
}

/**
 * Charges électriques du bord (section 4.3) : les consommateurs fixes, toujours en service, et
 * chaque capteur, qui ne consomme qu'en marche — un radar allumé pèse sur le bilan, donc sur la
 * chaleur rejetée par le générateur.
 */
export function electricalLoads(body: RigidBody): ElectricalLoad[] {
  return [
    ...body.consumers.map((consumer) => ({ ...consumer, active: true })),
    ...body.sensors.map((sensor) => ({
      id: sensorLoadId(sensor.id),
      label: SENSOR_LOAD_LABELS[sensor.mode],
      nominalPowerWatts: sensorElectricalWatts(sensor),
      priorityGroup: "capteurs" as const,
      active: body.sensorStates.get(sensor.id)?.enabled ?? false,
      sensorId: sensor.id,
    })),
  ];
}

/** Capteur privé d'alimentation au dernier pas (délesté) : son cycle s'interrompt sans mesure. */
export function sensorUnpowered(body: RigidBody, sensorId: string): boolean {
  return body.lastPowerStep?.shedConsumerIds.includes(sensorLoadId(sensorId)) ?? false;
}

/**
 * Bilan énergie d'un pas de simulation (RES-01). Appelée après la consommation propergol
 * des propulseurs : le générateur prélève sur ce qu'il reste de réserve ce pas-ci
 * (section 4.3 — réserve commune de carburant/propergol).
 *
 * Simplification assumée : la disponibilité électrique n'interdit pas encore aux
 * propulseurs de tirer (couplage « pas de puissance auxiliaire ⇒ pas de RCS » non modélisé
 * cette passe — non testé explicitement par RES-01/PHY-03..05).
 */
export function stepPower(body: RigidBody, dt: number): PowerStepResult {
  const loads = electricalLoads(body).filter((load) => load.active);
  const demandWatts = loads.reduce((sum, load) => sum + load.nominalPowerWatts, 0);

  const fuelAvailableKg = body.reservoir.quantityKg;
  const fuelDemandAtMaxKg = body.generator.fuelConsumptionKgPerSecondAtMaxPower * dt;
  const fuelFraction = fuelDemandAtMaxKg <= 0 ? 1 : Math.min(1, fuelAvailableKg / fuelDemandAtMaxKg);
  const generatorMaxDeliverable = body.generator.maxPowerWatts * fuelFraction;
  const generatorFuelLimited = fuelFraction < 1;

  const batteryChargeHeadroomWatts = Math.min(
    body.battery.maxChargeRateWatts,
    Math.max(0, (body.battery.capacityWattSeconds - body.battery.currentChargeWattSeconds) / dt),
  );
  const generatorOutputWatts = Math.min(generatorMaxDeliverable, demandWatts + batteryChargeHeadroomWatts);

  const batteryDischargeAvailableWatts = Math.min(
    body.battery.maxDischargeRateWatts,
    body.battery.currentChargeWattSeconds / Math.max(dt, 1e-9),
  );
  const capacityWatts = generatorOutputWatts + batteryDischargeAvailableWatts;

  const shedConsumerIds: string[] = [];
  let servedDemandWatts = demandWatts;
  if (capacityWatts < demandWatts - 1e-6) {
    for (const group of SHED_ORDER) {
      if (servedDemandWatts <= capacityWatts + 1e-6) break;
      // Dans un groupe, le plus gourmand d'abord (le radar avant l'écoute, par exemple).
      const inGroup = loads.filter((load) => load.priorityGroup === group).sort((a, b) => b.nominalPowerWatts - a.nominalPowerWatts);
      for (const load of inGroup) {
        if (servedDemandWatts <= capacityWatts + 1e-6) break;
        shedConsumerIds.push(load.id);
        servedDemandWatts -= load.nominalPowerWatts;
      }
    }
    servedDemandWatts = Math.max(0, servedDemandWatts);
  }

  const netForBattery = generatorOutputWatts - servedDemandWatts;
  const batteryFlowWatts =
    netForBattery >= 0 ? Math.min(netForBattery, batteryChargeHeadroomWatts) : -Math.min(-netForBattery, batteryDischargeAvailableWatts);

  body.battery.currentChargeWattSeconds = Math.max(
    0,
    Math.min(body.battery.capacityWattSeconds, body.battery.currentChargeWattSeconds + batteryFlowWatts * dt),
  );

  const generatorFuelUsedKg =
    body.generator.maxPowerWatts > 0 ? fuelDemandAtMaxKg * (generatorOutputWatts / body.generator.maxPowerWatts) : 0;
  body.reservoir.quantityKg = Math.max(0, body.reservoir.quantityKg - generatorFuelUsedKg);

  return {
    generatorOutputWatts,
    batteryFlowWatts,
    batteryStateOfChargeFraction:
      body.battery.capacityWattSeconds > 0 ? body.battery.currentChargeWattSeconds / body.battery.capacityWattSeconds : 0,
    demandWatts,
    suppliedWatts: servedDemandWatts,
    shedConsumerIds,
    generatorFuelLimited,
    batteryEmpty: body.battery.currentChargeWattSeconds <= 1e-6,
  };
}
