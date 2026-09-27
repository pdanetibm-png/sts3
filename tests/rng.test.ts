import { describe, expect, it } from "vitest";
import { createSeededRng } from "../src/sim/rng";

describe("RNG restaurable (SAV-01, MIS-02)", () => {
  it("même graine sans état restauré : même séquence à chaque fois (reproductibilité de base)", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("getState() capture l'état interne courant, pas la graine d'origine", () => {
    const rng = createSeededRng(42);
    rng();
    rng();
    const stateAfterTwoDraws = rng.getState();
    expect(stateAfterTwoDraws).not.toBe(42);
  });

  it("reprendre avec l'état sauvegardé continue exactement la même séquence, sans la rejouer depuis le début", () => {
    const original = createSeededRng(42);
    const before = [original(), original(), original()];
    const stateAfterThreeDraws = original.getState();
    const continued = [original(), original(), original()];

    const resumed = createSeededRng(42, stateAfterThreeDraws);
    const resumedDraws = [resumed(), resumed(), resumed()];

    expect(resumedDraws).toEqual(continued);
    expect(resumedDraws).not.toEqual(before);
  });
});
