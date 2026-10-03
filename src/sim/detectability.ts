import type { RigidBody } from "./rigidBody";
import { infraredRangeFor, listenRangeFor } from "./sensorPhysics";
import { infraredIntensityToward } from "./signature";

/**
 * Discrétion : à quelle distance des capteurs IDENTIQUES aux nôtres, en veille sur tout le ciel,
 * nous repéreraient-ils ? Les capteurs adverses sont inconnus du bord : nos propres fiches servent
 * de référence, ce qui reste une connaissance honnête (aucune lecture de l'adversaire).
 */
export interface Detectability {
  radarEmitting: boolean;
  /** Notre radar actif, entendu par une écoute comme la nôtre : dans son faisceau, et hors faisceau (lobes secondaires). */
  radarHeardInBeamMeters: number | null;
  radarHeardOutOfBeamMeters: number | null;
  /** Vu par un capteur IR comme le nôtre, de face (jet masqué par le vaisseau) et de l'arrière (jet en plein). */
  infraredFrontMeters: number | null;
  infraredRearMeters: number | null;
}

/** Distance d'observateur fictif : assez loin pour que seule la direction compte. */
const FAR_METERS = 1e9;

export function ownDetectability(body: RigidBody): Detectability {
  const radar = body.sensors.find((s) => s.mode === "radar_active");
  const listener = body.sensors.find((s) => s.mode === "radar_passive");
  const ir = body.sensors.find((s) => s.mode === "ir_passive");
  const source = body.signatureSource();
  const ahead = body.position.clone().addScaledVector(source.forwardAxisWorld, FAR_METERS);
  const behind = body.position.clone().addScaledVector(source.forwardAxisWorld, -FAR_METERS);
  return {
    radarEmitting: !!(radar && body.sensorStates.get(radar.id)?.enabled),
    radarHeardInBeamMeters: radar && listener ? listenRangeFor(listener, radar, true) : null,
    radarHeardOutOfBeamMeters: radar && listener ? listenRangeFor(listener, radar, false) : null,
    infraredFrontMeters: ir ? infraredRangeFor(ir, infraredIntensityToward(source, ahead, ir.bandFraction!), Math.PI) : null,
    infraredRearMeters: ir ? infraredRangeFor(ir, infraredIntensityToward(source, behind, ir.bandFraction!), Math.PI) : null,
  };
}
