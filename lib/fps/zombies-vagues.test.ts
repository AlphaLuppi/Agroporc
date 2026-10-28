import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import { MOUV } from "./mouvement";
import {
  DIFFICULTES, GAIN_CHEF, GAIN_MENUISIER, GAIN_NUKE, GAIN_PLANCHE, GAIN_TRUCK, GENRES_BONUS, ZOMBIES, allureTiree, degatsGriffe, delaiApparition,
  echelleZombie, estDifficulte, gainKill, gainTouche, mancheTruckSuivante, nbChefs, paquetBonus, plafondPlanches, premiereMancheTruck, probaDore,
  pvBase, pvPetit, pvTruck, pvZombie, rechargeGriffe, seuilBonusInitial, totalManche, totalTruck, typesManche, valeurAllure, vitesseAllure,
} from "./zombies-vagues";

describe("constantes ZOMBIES", () => {
  it("valeurs de la spec v7 (BO1)", () => {
    expect(ZOMBIES).toMatchObject({
      joueursMax: 8, finAffichageMs: 25_000, decompteDepartMs: 8_000, pauseMs: 10_000, argentDepart: 500, terreMs: 45_000, reanimationS: 3,
      plafondVivants: 24, pvMax: 100, pvMaxGratin: 250, regenDelaiMs: 3_000, regenPvParS: 60, griffe: 50, griffeChef: 80, planches: 6,
      bonusParManche: 4, incrementBonus: 2_000, facteurIncrement: 1.14, probaBonusHasard: 0.02, bonusDureeMs: 30_000,
    });
    expect(echelleZombie(0)).toBe(2.7);
    expect(echelleZombie(1)).toBe(2.7);
    expect(echelleZombie(2)).toBe(3.4);
    expect(echelleZombie(3)).toBe(1.5);
  });

  it("un tigre ne marche jamais plus vite que le joueur (marche 9 m/s), le petit reste sous le sprint", () => {
    for (const allure of [0, 1, 2, 3] as const) expect(vitesseAllure(allure, 0.9999)).toBeLessThan(MOUV.marche);
    expect(vitesseAllure(2, 0.5)).toBeCloseTo(8.4, 9);
    expect(vitesseAllure(0, 0)).toBeCloseTo(3.0 * 0.94, 9);
    expect(vitesseAllure(1, 1)).toBeCloseTo(6.2 * 1.06, 9);
    expect(vitesseAllure(2, 0.5, 3)).toBe(10);
    expect(vitesseAllure(2, 0.9999, 3)).toBeLessThan(MOUV.sprint);
  });
});

describe("vagues de Black Ops 1", () => {
  it("totalManche solo : 6, 8, 13, 18, 24, 27, 28, 28, 29, 33 puis 44 à la 15 et 60 à la 20", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => totalManche(n, 1))).toEqual([6, 8, 13, 18, 24, 27, 28, 28, 29, 33]);
    expect(totalManche(15, 1)).toBe(44);
    expect(totalManche(20, 1)).toBe(60);
  });

  it("totalManche à plusieurs : 2 joueurs 7, 9, 15, 21, 27 ; 4 joueurs 10 à la 1, 78 à la 10 ; au moins un joueur", () => {
    expect([1, 2, 3, 4, 5].map((n) => totalManche(n, 2))).toEqual([7, 9, 15, 21, 27]);
    expect(totalManche(1, 4)).toBe(10);
    expect(totalManche(10, 4)).toBe(78);
    expect(totalManche(1, 0)).toBe(6);
  });

  it("PV : 150, +100 jusqu'à 950 à la 9, puis +10 % entier ; plafond d'un million", () => {
    expect([1, 2, 5, 9].map(pvBase)).toEqual([150, 250, 550, 950]);
    expect(pvBase(10)).toBe(1045);
    expect(pvBase(11)).toBe(1149);
    expect(pvBase(20)).toBe(2701);
    expect(pvBase(400)).toBe(1_000_000);
  });

  it("PV par type et difficulté : doré × 1,5, chef × 4, petit selon la manche du Truck ; entrée × 0,7, goulaf × 1,3", () => {
    expect(pvZombie(1)).toBe(150);
    expect(pvZombie(9, 1)).toBe(1425);
    expect(pvZombie(10, 2)).toBe(4180);
    expect([1, 2, 3, 4, 9].map((k) => pvPetit(k))).toEqual([400, 900, 1300, 1600, 1600]);
    expect(pvZombie(30, 3, "plat", 2)).toBe(900);
    expect(pvZombie(5, 0, "entree")).toBe(Math.round(550 * 0.7));
    expect(pvZombie(5, 0, "goulaf")).toBe(Math.round(550 * 1.3));
  });

  it("délai d'apparition : 2 s × 0,95 par manche, plancher 0,08 s", () => {
    expect(delaiApparition(1)).toBe(2);
    expect(delaiApparition(2)).toBeCloseTo(1.9, 9);
    expect(delaiApparition(100)).toBe(0.08);
  });

  it("allure (BO1 `set_run_speed`) : que des marcheurs à la 1, des coureurs dès la 2, des sprinteurs dès la 6, que des sprinteurs à la 10", () => {
    expect(valeurAllure(1)).toBe(1);
    expect(valeurAllure(5)).toBe(32);
    const repartition = (n: number, d: "entree" | "plat" | "goulaf" = "plat") => {
      const c = [0, 0, 0];
      for (let i = 0; i < 35; i++) c[allureTiree(n, (i + 0.5) / 35, d)]++;
      return c;
    };
    expect(repartition(1)).toEqual([35, 0, 0]);
    expect(repartition(2)).toEqual([28, 7, 0]);
    expect(repartition(5)).toEqual([4, 31, 0]);
    expect(repartition(6)[2]).toBeGreaterThan(0);
    expect(repartition(10)).toEqual([0, 0, 35]);
    // goulaf : les sprinteurs arrivent plus tôt ; entrée : plus tard
    expect(repartition(6, "goulaf")[2]).toBeGreaterThan(repartition(6)[2]);
    expect(repartition(6, "entree")[2]).toBe(0);
    // le chef ne sprinte jamais, le petit sprinte toujours
    expect(allureTiree(20, 0.99, "plat", 2)).toBe(1);
    expect(allureTiree(1, 0, "plat", 3)).toBe(2);
  });

  it("griffe : 50 (deux coups à 100 PV, cinq avec le Gratin), chef 80, petit 30 ; selon la difficulté", () => {
    expect(degatsGriffe()).toBe(50);
    expect(Math.ceil(ZOMBIES.pvMax / degatsGriffe())).toBe(2);
    expect(Math.ceil(ZOMBIES.pvMaxGratin / degatsGriffe())).toBe(5);
    expect(degatsGriffe(2)).toBe(80);
    expect(degatsGriffe(3)).toBe(30);
    expect(degatsGriffe(0, "entree")).toBe(40);
    expect(degatsGriffe(0, "goulaf")).toBe(60);
    expect(rechargeGriffe(0)).toBe(1);
    expect(rechargeGriffe(3)).toBe(0.8);
  });

  it("chefs à partir de la manche 10, tigre doré à partir de la 2", () => {
    expect([9, 10, 13, 14, 18].map(nbChefs)).toEqual([0, 1, 1, 2, 3]);
    expect(probaDore(1)).toBe(0);
    expect(probaDore(2)).toBeCloseTo(0.45, 9);
    expect(probaDore(20)).toBe(0.75);
  });

  it("typesManche : le total exact, les chefs dans la seconde moitié, au plus un tigre doré", () => {
    for (const n of [1, 3, 10, 15, 25]) {
      const types = typesManche(n, 2, aleaGraine(n));
      expect(types).toHaveLength(totalManche(n, 2));
      expect(types.filter((x) => x === 2)).toHaveLength(Math.min(nbChefs(n), Math.floor(types.length / 2)));
      expect(types.slice(0, Math.floor(types.length / 2)).includes(2)).toBe(false);
      expect(types.filter((x) => x === 1).length).toBeLessThanOrEqual(1);
      expect(types.includes(3)).toBe(false);
    }
    expect(typesManche(1, 1, () => 0.5).every((x) => x === 0)).toBe(true);
  });

  it("difficultés : trois profils nommés", () => {
    expect(Object.keys(DIFFICULTES)).toEqual(["entree", "plat", "goulaf"]);
    expect(estDifficulte("plat")).toBe(true);
    expect(estDifficulte("facile")).toBe(false);
  });
});

describe("manches du Truck Muche (les chiens de BO1)", () => {
  it("première manche 5, 6 ou 7, puis tous les 4 à 6 ; 6 petits par joueur puis 8 ; Truck de 2 500 PV par livraison", () => {
    expect([0, 0.4, 0.99].map(premiereMancheTruck)).toEqual([5, 6, 7]);
    expect([0, 0.5, 0.999].map((a) => mancheTruckSuivante(6, a))).toEqual([10, 11, 12]);
    expect([totalTruck(1, 1), totalTruck(2, 3), totalTruck(3, 2)]).toEqual([6, 18, 16]);
    expect([pvTruck(1), pvTruck(3)]).toEqual([2500, 7500]);
  });
});

describe("points de BO1", () => {
  it("touche 10, kill 60 au corps, 100 à la tête, 130 à l'arme blanche ; tout × 2 en double points", () => {
    expect(gainTouche()).toBe(10);
    expect(gainTouche({ double: true })).toBe(20);
    expect(gainKill()).toBe(60);
    expect(gainKill({ tete: true })).toBe(100);
    expect(gainKill({ melee: true })).toBe(130);
    expect(gainKill({ melee: true, tete: true })).toBe(130);
    expect(gainKill({ tete: true, double: true })).toBe(200);
  });

  it("planches : 10 $ chacune, plafond min(500, 50 n) par manche ; bonus fixes", () => {
    expect(GAIN_PLANCHE).toBe(10);
    expect([1, 4, 10, 30].map(plafondPlanches)).toEqual([50, 200, 500, 500]);
    expect([GAIN_NUKE, GAIN_MENUISIER, GAIN_TRUCK, GAIN_CHEF]).toEqual([400, 200, 500, 250]);
  });

  it("bonus : paquet mélangé des six genres, seuil initial j × 500 + 2 000", () => {
    const p = paquetBonus(aleaGraine(3));
    expect([...p].sort()).toEqual([...GENRES_BONUS].sort());
    expect(new Set(p).size).toBe(6);
    expect(seuilBonusInitial(1)).toBe(2500);
    expect(seuilBonusInitial(4)).toBe(4000);
  });
});
