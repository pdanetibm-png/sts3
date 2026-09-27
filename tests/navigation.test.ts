import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { integrateBody } from "../src/sim/integrator";
import { RigidBody } from "../src/sim/rigidBody";
import { updateNavigation } from "../src/sim/navigation";
import { buildShipInit } from "./fixtures";

function ingestPositionedTrack(owner: RigidBody, targetPositionWorld: Vector3, simTime = 0): string {
  const bearing = targetPositionWorld.clone().sub(owner.position).normalize();
  const range = targetPositionWorld.distanceTo(owner.position);
  const track = owner.knowledge.ingest(
    { simTime, sourceSensorId: "radar-1", mode: "radar_active", bearingWorld: bearing, bearingUncertaintyRad: 0.02, rangeMeters: range, rangeUncertaintyMeters: 10 },
    owner.position,
  );
  return track.localId;
}

function ingestBearingOnlyTrack(owner: RigidBody, bearingWorld: Vector3, simTime = 0): string {
  const track = owner.knowledge.ingest(
    { simTime, sourceSensorId: "ir-1", mode: "ir_passive", bearingWorld: bearingWorld.clone().normalize(), bearingUncertaintyRad: 0.05 },
    owner.position,
  );
  return track.localId;
}

const forwardOf = (body: RigidBody) => new Vector3(...body.principalThruster.localAxis).normalize().applyQuaternion(body.command.targetAttitude);

function engage(body: RigidBody, mode: RigidBody["command"]["navMode"], trackId: string): void {
  body.command.navMode = mode;
  body.command.navTrackId = trackId;
}

describe("modes de pilotage — interception", () => {
  it("en mode manuel, ne touche pas à l'attitude cible", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0] }));
    const before = body.command.targetAttitude.clone();
    updateNavigation(body);
    expect(body.command.targetAttitude.equals(before)).toBe(true);
  });

  it("piste avec position connue : oriente le vaisseau vers elle et engage le maintien d'attitude", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0] }));
    engage(body, "interception", ingestPositionedTrack(body, new Vector3(1000, 0, 0)));
    updateNavigation(body);
    expect(body.command.attitudeHoldEngaged).toBe(true);
    expect(forwardOf(body).dot(new Vector3(1, 0, 0))).toBeGreaterThan(0.999);
  });

  it("piste au seul gisement : s'approche le long du gisement, sans inventer de point", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0] }));
    engage(body, "interception", ingestBearingOnlyTrack(body, new Vector3(0, 1, 0)));
    updateNavigation(body);
    expect(forwardOf(body).dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.999);
  });

  it("anticipe le mouvement estimé de la piste plutôt que de viser le point instantané", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0] }));
    const trackId = ingestPositionedTrack(body, new Vector3(1000, 0, 0), 0);
    ingestPositionedTrack(body, new Vector3(1000, 50, 0), 5);
    expect(body.knowledge.getTrack(trackId)!.velocityEstimateWorld).toBeDefined();
    engage(body, "interception", trackId);
    updateNavigation(body);
    expect(forwardOf(body).y).toBeGreaterThan(0);
  });

  it("après un croisement, ramène vers la cible au lieu de figer le cap", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0], velocity: [-50, 0, 0] }));
    engage(body, "interception", ingestPositionedTrack(body, new Vector3(1000, 0, 0)));
    updateNavigation(body);
    expect(forwardOf(body).x).toBeGreaterThan(0.9);
  });

  it("à pleine poussée vers un point fixe, freine à temps et reste sur la cible", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0], velocity: [50, 0, 0] }));
    const target = new Vector3(20000, 4000, -2000);
    engage(body, "interception", ingestPositionedTrack(body, target));
    body.command.throttle = 1;
    let arrivedAt = -1;
    let maxDistanceAfterArrival = 0;
    let maxSpin = 0;
    for (let tick = 0; tick < 300 * 60 && body.reservoir.quantityKg > 0; tick++) {
      updateNavigation(body);
      integrateBody(body, 1 / 60);
      const distance = body.position.distanceTo(target);
      if (arrivedAt < 0 && distance < 500) arrivedAt = tick;
      if (arrivedAt >= 0) maxDistanceAfterArrival = Math.max(maxDistanceAfterArrival, distance);
      maxSpin = Math.max(maxSpin, body.angularVelocity.length());
    }
    expect(arrivedAt).toBeGreaterThan(0);
    // Le pilote garde la main sur la poussée : à plein régime, le vaisseau tourne autour de la
    // cible, mais ne la dépasse jamais largement (freinage anticipé, retournement compris).
    expect(maxDistanceAfterArrival).toBeLessThan(2000);
    // Retournements de 180° au rythme du maintien d'attitude, jamais de vrille qui s'emballe.
    expect(maxSpin).toBeLessThan(2);
  });
});

describe("modes de pilotage — évasion, perpendiculaire, égalisation", () => {
  it("évasion : pousse à l'opposé de la piste", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0] }));
    engage(body, "evasion", ingestPositionedTrack(body, new Vector3(1000, 0, 0)));
    updateNavigation(body);
    expect(forwardOf(body).x).toBeLessThan(-0.999);
  });

  it("perpendiculaire : pousse à 90° de la ligne de visée et de la vitesse relative de la menace", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0] }));
    const trackId = ingestPositionedTrack(body, new Vector3(2000, 0, 0), 0);
    ingestPositionedTrack(body, new Vector3(1500, 0, 0), 5);
    engage(body, "perpendiculaire", trackId);
    updateNavigation(body);
    const forward = forwardOf(body);
    expect(Math.abs(forward.x)).toBeLessThan(0.05);
  });

  it("égaliser : pousse pour annuler la vitesse relative estimée", () => {
    const body = new RigidBody(buildShipInit({ position: [0, 0, 0], velocity: [0, 0, 0] }));
    const trackId = ingestPositionedTrack(body, new Vector3(5000, 0, 0), 0);
    ingestPositionedTrack(body, new Vector3(5000, 0, 500), 10);
    engage(body, "egaliser", trackId);
    updateNavigation(body);
    expect(forwardOf(body).z).toBeGreaterThan(0.9);
  });
});
