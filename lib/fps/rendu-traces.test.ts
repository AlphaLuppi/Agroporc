import { describe, expect, it } from "vitest";
import { glissementLateral, rouesArriere } from "./rendu-traces";

describe("traces de pneus", () => {
  it("ne mesure aucun glissement quand le véhicule avance dans son axe", () => {
    const cap = 0.7;
    expect(glissementLateral(cap, -Math.sin(cap) * 2, -Math.cos(cap) * 2, 0.1)).toBeCloseTo(0, 9);
  });
  it("mesure la vitesse perpendiculaire au cap", () => {
    // cap 0 : avant = −z, droite = +x ; 1 m vers la droite en 0,1 s = 10 m/s de glissement
    expect(glissementLateral(0, 1, -3, 0.1)).toBeCloseTo(10, 9);
    expect(glissementLateral(0, 1, 0, 0)).toBe(0);
  });
  it("place les roues arrière derrière le centre, de part et d'autre", () => {
    const [g, d] = rouesArriere([0, 0, 0], 0, 0.8, 1.5);
    expect(g[0]).toBeCloseTo(-0.8); expect(g[1]).toBeCloseTo(1.5);
    expect(d[0]).toBeCloseTo(0.8); expect(d[1]).toBeCloseTo(1.5);
  });
});
