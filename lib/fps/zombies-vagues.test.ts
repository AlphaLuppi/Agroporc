import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import {
  ZOMBIES, bonusFinManche, coefGain, compositionManche, degatsGriffe, echelleZombie, gainKill, gainTouche, intervalleApparition, nbBrutes,
  plafondVivantsManche, proportionSprinteurs, pvZombie, totalManche, typesManche, vitesseZombie,
} from "./zombies-vagues";

describe("constantes ZOMBIES", () => {
  it("valeurs de la spec", () => {
    expect(ZOMBIES).toMatchObject({
      joueursMax: 8, finAffichageMs: 25_000, decompteDepartMs: 8_000, attenteChargementMaxMs: 15_000, graceApresChargementMs: 3_000, pauseMs: 10_000,
      argentDepart: 500, terreMs: 45_000, reanimationS: 3, reanimationPortee: 2.5, reanimationAnnulePortee: 3.2, plafondVivants: 24,
      echelle: 2.7, echelleBrute: 3.4, tailleCaseNav: 1.5, rayonNav: 0.7, rayonTigre: 0.6, griffePortee: 1.7, griffeMaxPortee: 2.3,
      griffeArmeS: 0.4, griffeRechargeS: 1.0, soinRechargeS: 20, ravitaillementChargeurs: 5, periodeChampMs: 400, separationM: 1.4,
      visionDirecteM: 15, margeTouche: 0.25, multTete: 1.5, historiqueMs: 400, rejeuMs: 300, rejeuMeleeMs: 200, dedoublonnageM: 0.5,
    });
    expect(echelleZombie(0)).toBe(2.7);
    expect(echelleZombie(1)).toBe(2.7);
    expect(echelleZombie(2)).toBe(3.4);
    // marche d'un tigre toujours sous le sprint des joueurs (12,5 m/s)
    for (const n of [1, 5, 9, 30]) for (const type of [0, 1, 2] as const) expect(vitesseZombie(n, type, 0.9999)).toBeLessThan(12.5);
  });
});

describe("courbes de manche", () => {
  it("totalManche : solo 6 / 11 / 17 / 36, quatre joueurs 14 à la manche 1", () => {
    expect([1, 3, 5, 10].map((n) => totalManche(n, 1))).toEqual([6, 11, 17, 36]);
    expect(totalManche(10, 1)).toBe(36); // 35,52 arrondi, et non 35
    expect(totalManche(3, 1)).toBe(11);
    expect(totalManche(1, 4)).toBe(14);
    expect([1, 3, 5, 10].map((n) => totalManche(n, 4))).toEqual([14, 26, 39, 83]);
    expect(totalManche(1, 8)).toBe(Math.round(6 * (1 + 0.45 * 7)));
    expect(totalManche(1, 0)).toBe(6); // au moins un joueur
  });

  it("pvZombie : 100 + 50 (n−1) jusqu'à la 9ᵉ, 550 × 1,1^(n−9) ensuite ; sprinteur × 0,8, brute × 4", () => {
    expect([1, 3, 5, 9, 10].map((n) => pvZombie(n))).toEqual([100, 200, 300, 500, 605]);
    expect(pvZombie(9)).toBe(500);
    expect(pvZombie(10, 0)).toBe(605);
    expect([3, 5, 10].map((n) => pvZombie(n, 1))).toEqual([160, 240, 484]);
    expect([5, 10].map((n) => pvZombie(n, 2))).toEqual([1200, 2420]);
    expect(pvZombie(15)).toBe(Math.round(550 * 1.1 ** 6));
  });

  it("vitesseZombie : 4,2 / 5,5 / 7 / 8,6, ± 8 %, sprinteur × 1,2, brute × 0,8", () => {
    expect([1, 2, 3, 4, 5, 8, 9, 20].map((n) => vitesseZombie(n, 0, 0.5))).toEqual([4.2, 4.2, 5.5, 5.5, 7, 7, 8.6, 8.6]);
    expect(vitesseZombie(5, 0, 0)).toBeCloseTo(7 * 0.92, 9);
    expect(vitesseZombie(5, 0, 1)).toBeCloseTo(7 * 1.08, 9);
    expect(vitesseZombie(5, 1, 0.5)).toBeCloseTo(7 * 1.2, 9);
    expect(vitesseZombie(5, 2, 0.5)).toBeCloseTo(7 * 0.8, 9);
    expect(vitesseZombie(5, 0, -3)).toBeCloseTo(7 * 0.92, 9); // alea borné
  });

  it("sprinteurs à partir de la manche 3 (min 0,5 ; 0,1 (n−2)), brutes à partir de la 5 (floor(n/5))", () => {
    expect([1, 2, 3, 5, 7, 10, 30].map(proportionSprinteurs)).toEqual([0, 0, 0.1, 0.30000000000000004, 0.5, 0.5, 0.5]);
    expect([1, 4, 5, 9, 10, 14, 15].map(nbBrutes)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(compositionManche(10, 1)).toEqual({ total: 36, rodeurs: 17, sprinteurs: 17, brutes: 2 });
    expect(compositionManche(1, 1)).toEqual({ total: 6, rodeurs: 6, sprinteurs: 0, brutes: 0 });
    const c = compositionManche(5, 4);
    expect(c.rodeurs + c.sprinteurs + c.brutes).toBe(c.total);
  });

  it("typesManche : brutes en dernier, effectifs de la composition, hasard injecté", () => {
    for (const [n, j] of [[1, 1], [3, 2], [5, 1], [10, 4]] as const) {
      const types = typesManche(n, j, aleaGraine(n * 10 + j));
      const c = compositionManche(n, j);
      expect(types).toHaveLength(c.total);
      expect([0, 1, 2].map((t) => types.filter((x) => x === t).length)).toEqual([c.rodeurs, c.sprinteurs, c.brutes]);
      expect(types.slice(types.length - c.brutes).every((t) => t === 2)).toBe(true);
    }
    expect(typesManche(10, 1, aleaGraine(1))).toEqual(typesManche(10, 1, aleaGraine(1)));
    expect(typesManche(10, 1, aleaGraine(1))).not.toEqual(typesManche(10, 1, aleaGraine(2)));
  });

  it("degatsGriffe : 30 + 2 (n−1), plafonné à 55", () => {
    expect([1, 3, 5, 10, 13, 14, 30].map(degatsGriffe)).toEqual([30, 34, 38, 48, 54, 55, 55]);
  });

  it("intervalleApparition : max(0,35 ; 2,0 − 0,12 n) s", () => {
    expect(intervalleApparition(1)).toBeCloseTo(1.88, 9);
    expect(intervalleApparition(5)).toBeCloseTo(1.4, 9);
    expect(intervalleApparition(10)).toBeCloseTo(0.8, 9);
    expect(intervalleApparition(14)).toBe(0.35); // 2,0 − 1,68 = 0,32, relevé à 0,35
    expect(intervalleApparition(40)).toBe(0.35);
  });

  it("plafondVivantsManche : min(24, 6 + 3 j + 2 n)", () => {
    expect(plafondVivantsManche(1, 1)).toBe(11);
    expect(plafondVivantsManche(5, 1)).toBe(19);
    expect(plafondVivantsManche(10, 1)).toBe(24);
    expect(plafondVivantsManche(1, 4)).toBe(20);
    expect(plafondVivantsManche(30, 8)).toBe(24);
  });

  it("argent : coefficient min(2, 1 + 0,04 (n−1)), touche 10 $, kill 60 / 100 $, arrondis à 10, bonus 100 + 25 n", () => {
    expect(coefGain(1)).toBe(1);
    expect(coefGain(3)).toBeCloseTo(1.08, 9);
    expect(coefGain(26)).toBe(2);
    expect(coefGain(100)).toBe(2);
    expect([1, 3, 5, 10, 20, 26].map((n) => gainTouche(n))).toEqual([10, 10, 10, 10, 20, 20]);
    expect(gainTouche(5, { melee: true })).toBe(gainTouche(5));
    expect([1, 3, 5, 10, 26].map((n) => gainKill(n))).toEqual([60, 60, 70, 80, 120]);
    expect([1, 3, 5, 10, 26].map((n) => gainKill(n, { tete: true }))).toEqual([100, 110, 120, 140, 200]);
    expect(gainKill(10, { melee: true })).toBe(140);
    expect(gainKill(10, { tete: true, melee: true })).toBe(140);
    for (const n of [1, 4, 9, 17]) { expect(gainKill(n) % 10).toBe(0); expect(gainTouche(n) % 10).toBe(0); }
    expect([1, 2, 10].map(bonusFinManche)).toEqual([125, 150, 350]);
  });
});
