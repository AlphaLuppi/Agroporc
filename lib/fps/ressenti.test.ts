/**
 * Ressenti et physique de l'arène : régressions trouvées à la revue (chaleur des armes qui ne montait
 * jamais, recul sans retour, wall-run immobile dans un coin rentrant, vitesse au-dessus de ce que
 * le serveur accepte).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import type { Building, SceneData } from "../agroparc3d/types";
import {
  RETOUR_RECUL, STATS, apresTir, delaiRecul, delaiRefroidissement, dispersionCourante, refroidir, retourRecul,
} from "./armes";
import { construireMonde, type Monde } from "./collision";
import { VITESSE_MAX_H_M_S } from "./match";
import { etape, etatInitial, MOUV, type Entrees, type EtatMouvement } from "./mouvement";
import { ARMES, type ArmeId } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
function mondeDe(...batiments: Building[]): Monde {
  const coins = [rect(-250, -250, -249, -249, 3), rect(249, 249, 250, 250, 3)];
  return construireMonde({ ...scene, buildings: [...coins, ...batiments], pois: [] });
}

/**
 * Boucle de tir de jeu.ts : un tir dès que la cadence le permet, la chaleur ne retombe qu'après
 * `delaiRefroidissement`. Renvoie la chaleur après chaque tir.
 */
function rafale(arme: ArmeId, intervalleS: number, tirs: number, dt = 1 / 60): number[] {
  const a = STATS[arme];
  let t = 0, chaleur = 0, prochain = 0, dernier = -Infinity, fait = 0;
  const apres: number[] = [];
  while (fait < tirs) {
    t += dt;
    if (t >= prochain) {
      chaleur = apresTir(arme, chaleur);
      apres.push(chaleur);
      dernier = t;
      prochain = t + Math.max(intervalleS, a.cadenceS);
      fait++;
    }
    if (t - dernier > delaiRefroidissement(arme)) chaleur = refroidir(arme, chaleur, dt);
  }
  return apres;
}

describe("chaleur des armes", () => {
  it("le délai de refroidissement dépasse l'intervalle entre deux tirs de chaque arme", () => {
    for (const id of ARMES) expect(delaiRefroidissement(id)).toBeGreaterThan(STATS[id].cadenceS);
  });

  it("une rafale de mitraillette chauffe jusqu'au plafond, la dispersion monte bien au-dessus de la base", () => {
    const chaleurs = rafale("mitraillette", STATS.mitraillette.cadenceS, 32);
    const d = STATS.mitraillette.dispersion;
    expect(chaleurs[0]).toBeCloseTo(d.parTir, 9);
    expect(chaleurs[9]).toBeGreaterThan(8 * d.parTir); // sans délai, elle retombait entre deux balles
    expect(chaleurs[31]).toBeCloseTo(d.max, 9);
    const ctx = { vitesseH: 0, auSol: true, vise: false };
    expect(dispersionCourante("mitraillette", { ...ctx, chaleur: chaleurs[31] })).toBeGreaterThan(4 * d.base);
  });

  it("le pistolet cliqué à la cadence maximale se dérègle, espacé il reste précis", () => {
    const vite = rafale("pistolet", STATS.pistolet.cadenceS, 10);
    expect(vite[9]).toBeGreaterThan(3 * STATS.pistolet.dispersion.parTir);
    const pose = rafale("pistolet", 0.6, 10);
    for (const c of pose) expect(c).toBeLessThanOrEqual(STATS.pistolet.dispersion.parTir + 1e-9);
  });

  it("à l'arrêt, la chaleur retombe en retourS", () => {
    let ch = STATS.mitraillette.dispersion.max;
    const dt = 1 / 60;
    for (let t = 0; t < delaiRefroidissement("mitraillette"); t += dt) { /* délai : rien ne bouge */ }
    for (let t = 0; t < STATS.mitraillette.dispersion.retourS + dt; t += dt) ch = refroidir("mitraillette", ch, dt);
    expect(ch).toBe(0);
  });
});

describe("retour du recul", () => {
  it("ne rend jamais plus que le recul accumulé, et rien sans recul", () => {
    expect(retourRecul(0, 0.016)).toBe(0);
    expect(retourRecul(-1, 0.016)).toBe(0);
    expect(retourRecul(0.05, 0)).toBe(0);
    expect(retourRecul(0.0001, 1)).toBeCloseTo(0.0001, 12);
    for (const r of [0.01, 0.09, 0.4]) expect(retourRecul(r, 0.05)).toBeLessThanOrEqual(r);
  });

  it("le fusil à pompe retrouve sa visée avant le tir suivant, à 60 Hz comme à 20 Hz", () => {
    for (const dt of [1 / 60, 1 / 20]) {
      let reste = STATS.pompe.recul.tangage;
      for (let t = delaiRecul("pompe"); t < STATS.pompe.cadenceS; t += dt) reste -= retourRecul(reste, dt);
      expect(reste).toBeLessThan(0.1 * STATS.pompe.recul.tangage);
    }
  });

  it("pendant une rafale de mitraillette (moins de 0,2 s entre deux tirs) il n'y a pas de retour", () => {
    expect(delaiRecul("mitraillette")).toBeGreaterThan(STATS.mitraillette.cadenceS);
    expect(delaiRecul("pompe")).toBe(RETOUR_RECUL.delaiMaxS);
  });
});

describe("wall-run dans un coin rentrant", () => {
  const DT = 1 / 60;
  // mur A : face nord en z = 0 ; mur B : face ouest en x = 30 (pour z de −50 à 0) → coin rentrant en (30, 0)
  const m = mondeDe(rect(-300, 0, 300, 40, 30), rect(30, -50, 60, 0, 30));

  it("la course s'arrête au coin au lieu d'y rester collée jusqu'à la fin du chrono", () => {
    const FX = Math.cos(Math.PI / 6), FZ = Math.sin(Math.PI / 6);
    const lacet = Math.atan2(-FX, -FZ);
    let e: EtatMouvement = { ...etatInitial([19, 0, -0.5]), v: [9 * FX, 0, 9 * FZ] };
    let pasCollesAuCoin = 0;
    let finie = false;
    for (let k = 0; k < 140; k++) {
      e = etape(e, { avant: 1, droite: 0, saut: k === 0, sprint: true, lacet }, DT, m);
      if (e.mur && e.p[0] > 29.4) pasCollesAuCoin++;
      if (k > 10 && !e.mur) finie = true;
    }
    expect(finie).toBe(true);
    expect(pasCollesAuCoin).toBeLessThanOrEqual(2);
    // elle a bien eu lieu avant le coin
    let e2: EtatMouvement = { ...etatInitial([19, 0, -0.5]), v: [9 * FX, 0, 9 * FZ] };
    let vuMur = false;
    for (let k = 0; k < 40; k++) {
      e2 = etape(e2, { avant: 1, droite: 0, saut: k === 0, sprint: true, lacet }, DT, m);
      if (e2.mur) vuMur = true;
    }
    expect(vuMur).toBe(true);
  });

  it("un mur qui s'éloigne légèrement (pans de 10°) ne coupe pas la course", () => {
    // deux pans consécutifs d'un même bâtiment, 10° d'écart : même prisme, normales proches
    const a = 10 * Math.PI / 180;
    const pan: Building = {
      h: 30, c: [0, 30],
      r: [[-300, 0], [0, 0], [100, 100 * Math.tan(a)], [300, 300 * Math.tan(a)], [300, 60], [-300, 60]],
    };
    const mc = mondeDe(pan);
    const lacet = Math.atan2(-Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6));
    let e: EtatMouvement = { ...etatInitial([-80, 0, -0.5]), v: [9 * Math.cos(Math.PI / 6), 0, 9 * Math.sin(Math.PI / 6)] };
    let tMax = 0;
    for (let k = 0; k < 120; k++) {
      e = etape(e, { avant: 1, droite: 0, saut: k === 0, sprint: true, lacet }, DT, mc);
      if (e.mur) tMax = Math.max(tMax, e.mur.t);
    }
    expect(tMax).toBeGreaterThan(1.0);
  });
});

describe("plafond de vitesse horizontale", () => {
  it("reste sous la limite que le serveur accepte", () => {
    expect(MOUV.vitesseMaxH).toBeLessThan(VITESSE_MAX_H_M_S);
    // au-dessus de tout ce que prévoient les règles (saut de mur : tangente 11 + normale 6,5)
    expect(MOUV.vitesseMaxH).toBeGreaterThan(Math.hypot(MOUV.murVitesseMax, MOUV.murSautNormale));
  });

  it("une vitesse trop grande, en l'air ou au sol, est ramenée au plafond", () => {
    const m = mondeDe();
    const marche: Entrees = { avant: 1, droite: 0, saut: false, sprint: true, lacet: 0 };
    const air = etape({ ...etatInitial([0, 5, 0]), auSol: false, v: [18, 0, 0] }, marche, 1 / 60, m);
    expect(Math.hypot(air.v[0], air.v[2])).toBeLessThanOrEqual(MOUV.vitesseMaxH + 1e-9);
    const sol = etape({ ...etatInitial([0, 0, 0]), v: [20, 0, 0] }, marche, 1 / 60, m);
    expect(Math.hypot(sol.v[0], sol.v[2])).toBeLessThanOrEqual(MOUV.vitesseMaxH + 1e-9);
  });

  it("vrai scene.json : sauts de mur et virages aléatoires ne dépassent jamais le plafond", () => {
    const monde = construireMonde(scene);
    const alea = aleaGraine(7);
    let max = 0;
    for (let run = 0; run < 40; run++) {
      const b = scene.buildings[Math.floor(alea() * scene.buildings.length)];
      const an = b.r[Math.floor(alea() * b.r.length)];
      let e = etatInitial([an[0] + 4, 0, an[1] + 4]);
      let lacet = alea() * 6.28;
      for (let k = 0; k < 60 * 12; k++) {
        lacet += (alea() - 0.5) * 0.1;
        e = etape(e, { avant: 1, droite: 0, saut: k % 50 === 1 || alea() < 0.02, sprint: true, lacet }, 1 / 60, monde);
        max = Math.max(max, Math.hypot(e.v[0], e.v[2]));
      }
    }
    expect(max).toBeLessThanOrEqual(MOUV.vitesseMaxH + 1e-9);
  });
});
