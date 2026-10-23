import { describe, expect, it } from "vitest";
import { battement } from "./tigre";

describe("battement de la signature thermique du tigre (vue Palantir)", () => {
  it("s'allume sur le premier quart de la période seulement, au plus à 1", () => {
    expect(battement(0)).toBe(0);
    expect(battement(0.125)).toBeCloseTo(1, 6);
    expect(battement(0.3)).toBe(0);
    expect(battement(0.9)).toBe(0);
  });

  it("se répète à chaque période, phase négative comprise", () => {
    expect(battement(3.125)).toBeCloseTo(1, 6);
    expect(battement(-0.875)).toBeCloseTo(1, 6);
  });
});
