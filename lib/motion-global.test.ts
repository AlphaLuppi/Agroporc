import { describe, expect, it } from "vitest";
import {
  PLAFOND_STAGGER,
  confetti,
  decimalesDe,
  easeOutExpo,
  indiceStagger,
  sensNavigation,
  texteNote,
  valeurCompteur,
} from "./motion-global";

describe("indiceStagger", () => {
  it("garde l'index sous le plafond, rien au-delà", () => {
    expect(indiceStagger(0)).toBe(0);
    expect(indiceStagger(PLAFOND_STAGGER - 1)).toBe(PLAFOND_STAGGER - 1);
    expect(indiceStagger(PLAFOND_STAGGER)).toBeUndefined();
    expect(indiceStagger(-1)).toBeUndefined();
    expect(indiceStagger(3, 2)).toBeUndefined();
  });
});

describe("sensNavigation", () => {
  it("avance vers la droite, revient vers la gauche", () => {
    expect(sensNavigation("repondre")).toBe(1);
    expect(sensNavigation("revenir")).toBe(-1);
  });
});

describe("count-up", () => {
  it("easeOutExpo borné et monotone", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(-2)).toBe(0);
    expect(easeOutExpo(3)).toBe(1);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.9);
    expect(easeOutExpo(0.3)).toBeLessThan(easeOutExpo(0.31));
  });
  it("valeurCompteur part du départ et finit pile sur la cible", () => {
    expect(valeurCompteur(0, 7.5, 0)).toBe(0);
    expect(valeurCompteur(0, 7.5, 1)).toBe(7.5);
    expect(valeurCompteur(8, 4, 1)).toBe(4);
  });
  it("décimales et texte au format français", () => {
    expect(decimalesDe(7)).toBe(0);
    expect(decimalesDe(7.5)).toBe(1);
    expect(decimalesDe(7.25)).toBe(2);
    expect(decimalesDe(7.125)).toBe(2);
    expect(texteNote(7.5, 1)).toBe("7,5");
    expect(texteNote(3.04, 0)).toBe("3");
    // La valeur finale reproduit l'affichage de String(note).replace(".", ",")
    for (const n of [0, 6, 7.5, 8.25, 10]) expect(texteNote(n, decimalesDe(n))).toBe(String(n).replace(".", ","));
  });
});

describe("confetti", () => {
  it("est déterministe et reste dans les bornes", () => {
    for (let i = 0; i < 14; i++) {
      const c = confetti(i);
      expect(confetti(i)).toEqual(c);
      expect(c.cx).toBeGreaterThanOrEqual(-60);
      expect(c.cx).toBeLessThan(60);
      expect(c.cy).toBeGreaterThanOrEqual(90);
      expect(c.cy).toBeLessThan(150);
      expect(c.gauche).toBeGreaterThanOrEqual(8);
      expect(c.gauche).toBeLessThan(92);
      expect(c.delai).toBeLessThanOrEqual(120);
      expect(c.couleur).toBeGreaterThanOrEqual(0);
      expect(c.couleur).toBeLessThan(4);
    }
  });
  it("alterne le sens de rotation", () => {
    expect(Math.sign(confetti(0).cr)).toBe(-1);
    expect(Math.sign(confetti(1).cr)).toBe(1);
  });
});
