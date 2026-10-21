import { describe, expect, it } from "vitest";
import {
  decimales,
  delaiCascade,
  easeOutCubic,
  etatCompteur,
  gerbe,
  prefereMoinsDeMouvement,
  repartitionCalories,
  valeurCountUp,
} from "./motion-commentaires";

describe("easeOutCubic", () => {
  it("borne et monotone", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("decimales / valeurCountUp", () => {
  it("compte les décimales (max 2)", () => {
    expect(decimales(12)).toBe(0);
    expect(decimales(12.5)).toBe(1);
    expect(decimales(1.234)).toBe(2);
    expect(decimales(NaN)).toBe(0);
  });
  it("garde la précision de la cible", () => {
    expect(valeurCountUp(650, 0)).toBe("0");
    expect(valeurCountUp(650, 0.5)).toMatch(/^\d+$/);
    expect(valeurCountUp(28.5, 0.5)).toMatch(/^\d+\.\d$/);
    expect(valeurCountUp(28.5, 0)).toBe("0.0");
  });
  it("vaut exactement la cible à la fin", () => {
    expect(valeurCountUp(650, 1)).toBe("650");
    expect(valeurCountUp(28.5, 1.2)).toBe("28.5");
  });
});

describe("repartitionCalories", () => {
  it("pondère P×4, G×4, L×9 et somme à 100", () => {
    const r = repartitionCalories(30, 60, 20)!;
    // 120 + 240 + 180 = 540 kcal
    expect(r).toEqual({ proteines: 22, glucides: 45, lipides: 33 });
    expect(r.proteines + r.glucides + r.lipides).toBe(100);
  });
  it("plus fort reste quand ça ne tombe pas rond", () => {
    const r = repartitionCalories(1, 1, 0)!;
    expect(r).toEqual({ proteines: 50, glucides: 50, lipides: 0 });
    const t = repartitionCalories(9, 9, 4)!; // 36/36/36
    expect(t.proteines + t.glucides + t.lipides).toBe(100);
  });
  it("null si une valeur manque ou si tout est nul", () => {
    expect(repartitionCalories(undefined, 10, 10)).toBeNull();
    expect(repartitionCalories(10, null, 10)).toBeNull();
    expect(repartitionCalories(0, 0, 0)).toBeNull();
    expect(repartitionCalories(-1, 10, 10)).toBeNull();
  });
});

describe("delaiCascade", () => {
  it("plafonne", () => {
    expect(delaiCascade(0, 25, 200)).toBe(0);
    expect(delaiCascade(3, 25, 200)).toBe(75);
    expect(delaiCascade(30, 25, 200)).toBe(200);
    expect(delaiCascade(-2, 25, 200)).toBe(0);
  });
});

describe("gerbe", () => {
  it("8 directions à 45° déterministes", () => {
    const g = gerbe(8, 20);
    expect(g).toHaveLength(8);
    expect(g[0]).toEqual({ dx: 20, dy: 0 });
    expect(g[2]).toEqual({ dx: 0, dy: 20 });
    expect(g[4]).toEqual({ dx: -20, dy: 0 });
    expect(g[1]).toEqual({ dx: 14, dy: 14 });
    expect(gerbe(8, 20)).toEqual(g);
    expect(g.every((p) => !Object.is(p.dx, -0) && !Object.is(p.dy, -0))).toBe(true);
  });
});

describe("etatCompteur", () => {
  it("caché, visible puis limite", () => {
    expect(etatCompteur(0)).toBe("cache");
    expect(etatCompteur(400)).toBe("cache");
    expect(etatCompteur(401)).toBe("visible");
    expect(etatCompteur(479)).toBe("visible");
    expect(etatCompteur(480)).toBe("limite");
    expect(etatCompteur(500)).toBe("limite");
  });
});

describe("prefereMoinsDeMouvement", () => {
  it("faux hors navigateur", () => {
    expect(prefereMoinsDeMouvement()).toBe(false);
  });
});
