import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import {
  AMBIANCE, DUREE_FLASH_S, couleurBrouillard, densiteBrouillard, flashEclair, melangerCouleur, opaciteBrouillard, partBrouillard, pointEclairAmbiance,
  porteeFlash, prochainEclairAmbiance, tracerEclair, type EtatAmbiance,
} from "./ambiance-zombies";
import type { Vec3 } from "./protocole";

const HORS: EtatAmbiance = { truck: false, debutS: null, finS: null };

describe("brouillard des manches du Truck Muche", () => {
  it("hors livraison : celui de l'arène, quasi nul", () => {
    expect(partBrouillard(HORS, 12)).toBe(0);
    expect(densiteBrouillard(HORS, 12)).toBe(AMBIANCE.densiteBase);
    expect(opaciteBrouillard(50, AMBIANCE.densiteBase)).toBeLessThan(0.01);
  });

  it("tombe en 3 s au début de la livraison, puis on n'y voit qu'à quelques mètres", () => {
    const e: EtatAmbiance = { truck: true, debutS: 100, finS: null };
    expect(partBrouillard(e, 100)).toBe(0);
    expect(partBrouillard(e, 101.5)).toBeCloseTo(0.5, 9);
    expect(partBrouillard(e, 103)).toBe(1);
    expect(partBrouillard(e, 200)).toBe(1);
    // monotone pendant la montée
    let avant = -1;
    for (let t = 100; t <= 103; t += 0.1) { const k = partBrouillard(e, t); expect(k).toBeGreaterThanOrEqual(avant); avant = k; }
    const d = AMBIANCE.densiteTruck;
    expect(opaciteBrouillard(7, d)).toBeLessThan(0.3);
    expect(opaciteBrouillard(12, d)).toBeCloseTo(0.5, 1);
    expect(opaciteBrouillard(20, d)).toBeGreaterThan(0.85);
    // des nappes : la densité ondule de ± 12 % au plus
    for (let t = 103; t < 130; t += 0.37) {
      const x = densiteBrouillard(e, t);
      expect(x).toBeGreaterThanOrEqual(d * (1 - AMBIANCE.houle) - 1e-12);
      expect(x).toBeLessThanOrEqual(d * (1 + AMBIANCE.houle) + 1e-12);
    }
  });

  it("se lève 2 s après le dernier ennemi, en 3,5 s ; une livraison expédiée (fin pendant la montée) se lève aussi", () => {
    const e: EtatAmbiance = { truck: false, debutS: 100, finS: 140 };
    expect(partBrouillard(e, 141.9)).toBe(1);
    expect(partBrouillard(e, 142 + 3.5 / 2)).toBeCloseTo(0.5, 9);
    expect(partBrouillard(e, 145.5)).toBe(0);
    expect(densiteBrouillard(e, 150)).toBeCloseTo(AMBIANCE.densiteBase, 12);
    const court: EtatAmbiance = { truck: false, debutS: 100, finS: 101 };
    expect(partBrouillard(court, 103)).toBeLessThanOrEqual(1);
    expect(partBrouillard(court, 106.6)).toBe(0);
  });

  it("couleur : la base, tirée vers le ciel d'orage puis vers le bleu de l'éclair", () => {
    expect(melangerCouleur(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(melangerCouleur(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(melangerCouleur(0x123456, 0xabcdef, 2)).toBe(0xabcdef);
    expect(couleurBrouillard(0x04060a, 0, 0)).toBe(0x04060a);
    expect(couleurBrouillard(0x04060a, 1, 0)).toBe(AMBIANCE.couleurTruck);
    const eclaire = couleurBrouillard(0x04060a, 1, 1);
    expect(eclaire & 255).toBeGreaterThan(0x80); // bleu
  });
});

describe("éclairs", () => {
  it("flash : plein 60 ms, retombée, second coup, puis s'éteint avant 0,8 s", () => {
    expect(flashEclair(-0.01)).toBe(0);
    expect(flashEclair(0)).toBe(1);
    expect(flashEclair(0.09)).toBe(0.2);
    expect(flashEclair(0.15)).toBe(0.8);
    expect(flashEclair(0.3)).toBeLessThan(0.8);
    expect(flashEclair(0.3)).toBeGreaterThan(0.2);
    expect(flashEclair(DUREE_FLASH_S)).toBe(0);
    expect(flashEclair(Number.NaN)).toBe(0);
    expect(porteeFlash(0)).toBe(1);
    expect(porteeFlash(100)).toBeCloseTo(0.35, 9);
  });

  it("éclairs d'ambiance : toutes les 3,5 à 8 s, de 25 à 70 m autour du joueur", () => {
    expect([prochainEclairAmbiance(0), prochainEclairAmbiance(0.999999), prochainEclairAmbiance(5)]).toEqual([3.5, expect.closeTo(8, 4), 8]);
    const alea = aleaGraine(9);
    for (let k = 0; k < 50; k++) {
      const p = pointEclairAmbiance([10, 1.7, -20], alea);
      const d = Math.hypot(p[0] - 10, p[2] + 20);
      expect(d).toBeGreaterThanOrEqual(25);
      expect(d).toBeLessThanOrEqual(70);
      expect(p[1]).toBe(0);
    }
  });

  it("tracé : frappe exactement le point d'impact, part du ciel, zigzag borné, déterministe à hasard égal", () => {
    const sol: Vec3 = [5, 0, -3];
    const t1 = tracerEclair(sol, 50, aleaGraine(4));
    const t2 = tracerEclair(sol, 50, aleaGraine(4));
    expect(t1).toEqual(t2);
    expect(t1.tronc.at(-1)).toEqual(sol);
    expect(t1.tronc[0][1]).toBe(50);
    expect(t1.tronc).toHaveLength(2 ** 5 + 1);
    // la hauteur descend le long du tronc ; aucun point à plus de 30 % de la hauteur de l'axe ciel → sol
    const a = t1.tronc[0];
    for (let i = 1; i < t1.tronc.length; i++) {
      const p = t1.tronc[i];
      expect(p[1]).toBeLessThanOrEqual(t1.tronc[i - 1][1] + 1e-9);
      const k = (a[1] - p[1]) / 50;
      const ax = a[0] + (sol[0] - a[0]) * k, az = a[2] + (sol[2] - a[2]) * k;
      expect(Math.hypot(p[0] - ax, p[2] - az)).toBeLessThan(0.3 * 50);
    }
    expect(t1.branches).toHaveLength(2);
    for (const b of t1.branches) {
      expect(t1.tronc).toContainEqual(b[0]);
      expect(b.at(-1)![1]).toBeLessThan(b[0][1]);
      expect(b.at(-1)![1]).toBeGreaterThanOrEqual(0);
    }
    expect(tracerEclair(sol, 50, aleaGraine(5))).not.toEqual(t1);
  });
});
