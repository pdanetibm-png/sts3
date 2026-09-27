import { describe, expect, it } from "vitest";
import { sumThrusterWrench } from "../src/sim/thrusters";
import type { ThrusterDef } from "../src/sim/types";

const thruster = (overrides: Partial<ThrusterDef>): ThrusterDef => ({
  id: "t",
  kind: "rcs",
  localPosition: [0, 0, 0],
  localAxis: [1, 0, 0],
  maxThrustNewtons: 5000,
  specificImpulseSeconds: 300,
  ...overrides,
});

// PHY-03 : signe et axe du couple corrects pour un banc symétrique et un banc décentré ;
// un propulseur dont le bras de levier est parallèle à son axe de poussée ne produit aucun couple.
describe("PHY-03 — forces et couples placés", () => {
  it("banc symétrique : une paire de propulseurs opposés produit un couple pur, sans force nette", () => {
    const thrusters = [
      thruster({ localPosition: [0, 8, 0], localAxis: [0, 0, 1] }),
      thruster({ localPosition: [0, -8, 0], localAxis: [0, 0, -1] }),
    ];
    const { forceLocal, torqueBody } = sumThrusterWrench(thrusters, [1, 1]);

    expect(forceLocal.length()).toBeCloseTo(0, 9);
    expect(torqueBody.x).toBeCloseTo(8 * 5000 + 8 * 5000, 6);
    expect(torqueBody.y).toBeCloseTo(0, 9);
    expect(torqueBody.z).toBeCloseTo(0, 9);
  });

  it("banc décentré : un propulseur unique produit à la fois force et couple, de signe cohérent", () => {
    const thrusters = [thruster({ localPosition: [2, 0, 0], localAxis: [0, 0, 1], maxThrustNewtons: 1000 })];
    const { forceLocal, torqueBody } = sumThrusterWrench(thrusters, [1]);

    expect(forceLocal.z).toBeCloseTo(1000, 6);
    expect(forceLocal.x).toBeCloseTo(0, 9);
    // r=(2,0,0) × F=(0,0,1000) = (0*1000-0*0, 0*0-2*1000, 2*0-0*0) = (0,-2000,0)
    expect(torqueBody.y).toBeCloseTo(-2000, 6);
    expect(torqueBody.x).toBeCloseTo(0, 9);
    expect(torqueBody.z).toBeCloseTo(0, 9);
  });

  it("un propulseur dont le bras de levier est parallèle à l'axe de poussée ne produit aucun couple parasite", () => {
    const thrusters = [thruster({ localPosition: [3, 0, 0], localAxis: [1, 0, 0], maxThrustNewtons: 2000 })];
    const { forceLocal, torqueBody } = sumThrusterWrench(thrusters, [1]);

    expect(forceLocal.x).toBeCloseTo(2000, 6);
    expect(torqueBody.length()).toBeCloseTo(0, 6);
  });

  it("un propulseur passant exactement par le centre de masse (r=0) ne produit aucun couple", () => {
    const thrusters = [thruster({ localPosition: [0, 0, 0], localAxis: [0, 1, 0], maxThrustNewtons: 4000 })];
    const { torqueBody } = sumThrusterWrench(thrusters, [1]);

    expect(torqueBody.length()).toBeCloseTo(0, 9);
  });

  it("un throttle nul n'apporte ni force ni couple", () => {
    const thrusters = [thruster({ localPosition: [0, 8, 0], localAxis: [0, 0, 1] })];
    const { forceLocal, torqueBody } = sumThrusterWrench(thrusters, [0]);

    expect(forceLocal.length()).toBe(0);
    expect(torqueBody.length()).toBe(0);
  });
});
