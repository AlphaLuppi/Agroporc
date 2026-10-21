import { describe, expect, it } from "vitest";
import {
  decalageEntree,
  decisionLacher,
  deltaBoite,
  directionJour,
  easeOutCubic,
  etincelles,
  fmtCompteur,
  lireScale,
  lireTranslate,
  pointArc,
  rangStagger,
  suiviDoigt,
  valeurCompteur,
} from "./motion-menus";

describe("directionJour / decalageEntree", () => {
  it("donne le sens du slide", () => {
    expect(directionJour(1, 3)).toBe(1);
    expect(directionJour(3, 0)).toBe(-1);
    expect(directionJour(2, 2)).toBe(0);
  });
  it("slide horizontal au changement de jour, petite montée sinon", () => {
    expect(decalageEntree(1)).toEqual({ dx: 24, dy: 0 });
    expect(decalageEntree(-1)).toEqual({ dx: -24, dy: 0 });
    expect(decalageEntree(0)).toEqual({ dx: 0, dy: 8 });
  });
});

describe("count-up", () => {
  it("easing borné", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
  it("interpole à une décimale, dans les deux sens", () => {
    expect(valeurCompteur(4, 8, 0)).toBe(4);
    expect(valeurCompteur(4, 8, 1)).toBe(8);
    expect(valeurCompteur(8, 4, 1)).toBe(4);
    const v = valeurCompteur(4, 8, 0.5);
    expect(v).toBeGreaterThan(6);
    expect(Math.round(v * 10)).toBe(v * 10);
  });
  it("formate à la française", () => {
    expect(fmtCompteur(7.4)).toBe("7,4");
    expect(fmtCompteur(8)).toBe("8,0");
  });
});

describe("FLIP", () => {
  it("lit la valeur calculée de translate", () => {
    expect(lireTranslate("none")).toEqual({ x: 0, y: 0 });
    expect(lireTranslate("")).toEqual({ x: 0, y: 0 });
    expect(lireTranslate("12px")).toEqual({ x: 12, y: 0 });
    expect(lireTranslate("12.5px -4px")).toEqual({ x: 12.5, y: -4 });
    expect(lireTranslate("1px 2px 0px")).toEqual({ x: 1, y: 2 });
  });
  it("calcule le décalage inverse, ignore les nouveaux et les immobiles", () => {
    expect(deltaBoite({ x: 0, y: 100, w: 50, h: 50 }, { x: 200, y: 0, w: 50, h: 50 })).toEqual({ x: -200, y: 100, sx: 1, sy: 1 });
    expect(deltaBoite({ x: 10, y: 10, w: 50, h: 50 }, { x: 10.4, y: 10, w: 50, h: 50 })).toBeNull();
  });
  it("lit la valeur calculée de scale", () => {
    expect(lireScale("none")).toEqual({ x: 1, y: 1 });
    expect(lireScale("0.5")).toEqual({ x: 0.5, y: 0.5 });
    expect(lireScale("0.5 0.8")).toEqual({ x: 0.5, y: 0.8 });
    expect(lireScale("1 1 1")).toEqual({ x: 1, y: 1 });
  });
  it("calcule translate + scale entre deux boîtes (hero ↔ tuile)", () => {
    // Hero 400×200 en haut à gauche qui redevient une tuile 200×100 plus bas.
    expect(deltaBoite({ x: 0, y: 0, w: 400, h: 200 }, { x: 200, y: 300, w: 200, h: 100 })).toEqual({ x: -200, y: -300, sx: 2, sy: 2 });
    // Même place, taille différente : on anime quand même.
    expect(deltaBoite({ x: 0, y: 0, w: 200, h: 100 }, { x: 0, y: 0, w: 400, h: 200 })).toEqual({ x: 0, y: 0, sx: 0.5, sy: 0.5 });
    expect(deltaBoite(undefined, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
    expect(deltaBoite({ x: 5, y: 5, w: 10, h: 10 }, { x: 5.2, y: 5, w: 10.3, h: 10 })).toBeNull();
  });
});

describe("drag-to-dismiss", () => {
  it("suit le doigt vers le bas, résiste vers le haut", () => {
    expect(suiviDoigt(50)).toBe(50);
    expect(suiviDoigt(-20)).toBe(-10);
    expect(suiviDoigt(-200)).toBe(-40);
  });
  it("ferme au-delà du seuil ou d'un geste rapide", () => {
    expect(decisionLacher(120, 0)).toBe("fermer");
    expect(decisionLacher(40, 0.8)).toBe("fermer");
    expect(decisionLacher(40, 0.2)).toBe("retour");
    expect(decisionLacher(5, 2)).toBe("retour");
    expect(decisionLacher(-30, 0)).toBe("retour");
  });
});

describe("décor", () => {
  it("étincelles déterministes, réparties en cercle", () => {
    const e = etincelles(8);
    expect(e).toHaveLength(8);
    expect(e.map((x) => x.angle)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(etincelles(8)).toEqual(e);
    expect(e[0]).toEqual({ angle: 0, x: 58, y: 0 });
    expect(e[2].x).toBe(0);
    expect(e[2].y).toBeCloseTo(30 * 1, 5);
    expect(Math.abs(e[1].x)).toBeLessThan(58);
  });
  it("arc : part de a, arrive en b, monte au milieu", () => {
    const a = { x: 0, y: 500 };
    const b = { x: 300, y: 20 };
    expect(pointArc(a, b, 0)).toEqual(a);
    expect(pointArc(a, b, 1)).toEqual(b);
    expect(pointArc(a, b, 0.5).y).toBeLessThan(260);
  });
  it("stagger plafonné", () => {
    expect(rangStagger(3)).toBe(3);
    expect(rangStagger(20)).toBe(8);
    expect(rangStagger(-1)).toBe(0);
  });
});
