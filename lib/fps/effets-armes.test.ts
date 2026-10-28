import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, lancerRayon } from "./collision";
import {
  PAS_BRULURE_MS, allumer, chaineArc, dansSouffle, degeler, fractionSphere, geler, pointImpact, positionProjectile, preparerProjectile, profilProjectile,
  segmentsRicochet, ticBrulures, trajectoireProjectile, type EtatBrulure, type EtatGel,
} from "./effets-armes";
import { STATS } from "./armes";
import { PAS_TRAJECTOIRE_MS } from "./grenades";
import type { Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
const mondeAvec = (b: Building[]) => construireMonde({ ...scene, buildings: b, pois: [] });
/** un mur nord-sud épais en x ∈ [10, 11], haut de 6 m */
const mur = mondeAvec([rect(10, -20, 11, 20, 6)]);
const vide = mondeAvec([rect(500, 500, 501, 501, 1)]);
const proche = (a: Vec3, b: Vec3, eps = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps;

describe("ricochets", () => {
  it("sans rebond : un seul tronçon, la portée entière", () => {
    const s = segmentsRicochet(mur, [0, 1.6, 0], [0, 0, -1], 50, 0);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ longueur: 50, debut: 0 });
  });

  it("la balle rebondit sur le mur (réflexion sur sa normale) puis repart vers le tireur, distance cumulée", () => {
    const d: Vec3 = [Math.SQRT1_2, 0, -Math.SQRT1_2];
    const s = segmentsRicochet(mur, [0, 1.6, 0], d, 60, 2);
    expect(s.length).toBeGreaterThanOrEqual(2);
    // premier tronçon : jusqu'au mur (x = 10), à 10√2 m
    expect(s[0].longueur).toBeCloseTo(10 * Math.SQRT2, 2);
    // second : x repart vers −x, z continue vers −z ; il part du mur
    expect(s[1].d[0]).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(s[1].d[2]).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(s[1].o[0]).toBeLessThan(10);
    expect(s[1].debut).toBeCloseTo(s[0].longueur, 6);
    // le total ne dépasse jamais la portée
    const total = s.reduce((n, x) => n + x.longueur, 0);
    expect(total).toBeLessThanOrEqual(60 + 1e-6);
  });

  it("rebond sur le sol : la balle tirée vers le bas remonte avec la même pente", () => {
    const d0: Vec3 = [0, -0.6, -0.8];
    const s = segmentsRicochet(vide, [0, 1.6, 0], d0, 40, 1);
    expect(s).toHaveLength(2);
    expect(s[0].o[1] + s[0].d[1] * s[0].longueur).toBeCloseTo(0, 6);
    expect(s[1].d[1]).toBeCloseTo(0.6, 6);
    expect(s[1].d[2]).toBeCloseTo(-0.8, 6);
  });

  it("déterministe : les mêmes entrées donnent les mêmes tronçons (client = serveur), au plus 3 rebonds", () => {
    const d: Vec3 = [0.6, -0.1, -0.79];
    const a = segmentsRicochet(mur, [0, 1.6, 0], d, 120, 5);
    const b = segmentsRicochet(mur, [0, 1.6, 0], d, 120, 5);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(4);
  });
});

describe("arc électrique", () => {
  const c = (id: number, x: number, z: number) => ({ id, p: [x, 0, z] as Vec3 });
  it("saute de proche en proche, jamais deux fois sur le même tigre, au plus `sauts` fois, dans le rayon", () => {
    const tigres = [c(1, 0, 0), c(2, 3, 0), c(3, 6, 0), c(4, 6.5, 0), c(5, 30, 0)];
    const ch = chaineArc(tigres[0], tigres, { sauts: 9, rayon: 4 });
    expect(ch.map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(chaineArc(tigres[0], tigres, { sauts: 2, rayon: 4 }).map((x) => x.id)).toEqual([1, 2, 3]);
    expect(chaineArc(tigres[0], tigres, { sauts: 9, rayon: 2 }).map((x) => x.id)).toEqual([1]);
  });

  it("un mur coupe l'arc (ligne de vue au dos des tigres)", () => {
    const tigres = [c(1, 8, 0), c(2, 13, 0)];
    expect(chaineArc(tigres[0], tigres, { sauts: 3, rayon: 8 }).map((x) => x.id)).toEqual([1, 2]);
    expect(chaineArc(tigres[0], tigres, { sauts: 3, rayon: 8 }, mur).map((x) => x.id)).toEqual([1]);
  });
});

describe("brûlure et gel", () => {
  it("un pas de dps × 0,5 s par demi-seconde, renouvelée sans cumul, oubliée à la fin ou à la mort du tigre", () => {
    const b = new Map<number, EtatBrulure>();
    allumer(b, 7, { dps: 200, dureeS: 2 }, "a", 1000);
    expect(ticBrulures(b, 1000 + PAS_BRULURE_MS - 1, () => true)).toEqual([]);
    expect(ticBrulures(b, 1000 + PAS_BRULURE_MS, () => true)).toEqual([{ id: 7, degats: 100, par: "a" }]);
    // un tic en retard rattrape ses pas
    expect(ticBrulures(b, 1000 + 3 * PAS_BRULURE_MS, () => true)).toEqual([{ id: 7, degats: 200, par: "a" }]);
    // ravivée par un autre joueur : la fin recule, le crédit change, le dps ne s'additionne pas
    allumer(b, 7, { dps: 150, dureeS: 2 }, "b", 2500);
    expect(b.get(7)).toMatchObject({ dps: 200, par: "b", finT: 4500 });
    let total = 0;
    for (let t = 3000; t <= 6000; t += 100) for (const x of ticBrulures(b, t, () => true)) total += x.degats;
    expect(total).toBe(200 * 2); // de 2 500 à 4 500 : quatre pas de 100
    expect(b.size).toBe(0);
    allumer(b, 9, { dps: 100, dureeS: 5 }, "a", 0);
    expect(ticBrulures(b, 600, () => false)).toEqual([]);
    expect(b.size).toBe(0);
  });

  it("gel : vitesse réduite, prolongé sans re-réduire, rendue à la fin seulement si personne d'autre ne l'a changée", () => {
    const g = new Map<number, EtatGel>();
    expect(geler(g, 1, 6, { dureeS: 4, facteur: 0.35 }, 0)).toBeCloseTo(2.1, 9);
    expect(geler(g, 1, 2.1, { dureeS: 4, facteur: 0.35 }, 1000)).toBeNull();
    expect(degeler(g, 4000, () => 2.1)).toEqual([]);
    expect(degeler(g, 5000, () => 2.1)).toEqual([{ id: 1, vitesse: 6 }]);
    geler(g, 2, 5, { dureeS: 1, facteur: 0.5 }, 0);
    // le dernier tigre s'est mis à sprinter entre-temps : on ne le ralentit pas en le « dégelant »
    expect(degeler(g, 2000, () => 9)).toEqual([]);
    expect(g.size).toBe(0);
  });
});

describe("souffle en cône (Soufflerie)", () => {
  const s = STATS.soufflerie.zombie.souffle!;
  it("dans l'axe jusqu'à la portée, de plus en plus large ; rien derrière ni sur les côtés", () => {
    const o: Vec3 = [0, 1.6, 0], d: Vec3 = [0, 0, -1];
    expect(dansSouffle(o, d, [0, 1.6, -5], s)).toBeCloseTo(5, 9);
    expect(dansSouffle(o, d, [0, 1.6, -(s.portee + 0.5)], s)).toBeNull();
    expect(dansSouffle(o, d, [0, 1.6, 3], s)).toBeNull();
    expect(dansSouffle(o, d, [s.rayonDebut + 0.3, 1.6, -0.2], s)).toBeNull();
    expect(dansSouffle(o, d, [s.rayonFin - 0.2, 1.6, -s.portee + 0.1], s)).not.toBeNull();
  });
});

describe("projectiles", () => {
  it("profil balistique : à percussion, sans rebond, délai de l'arme en mèche", () => {
    const p = profilProjectile(STATS.brochette.zombie.projectile!);
    expect(p).toMatchObject({ percussion: true, rebond: 0, bonusHaut: 0, mecheMs: STATS.brochette.zombie.projectile!.delaiMs });
  });

  it("le carreau se plante dans le mur, explose `delaiMs` plus tard ; une arme à balles n'a pas de projectile", () => {
    const tir = preparerProjectile(mur, "brochette", false, [0, 1.6, 0], [1, 0, 0], 10_000)!;
    expect(tir.contact).toBe(true);
    const planté = positionProjectile(tir.traj, tir.t0, tir.impactT, tir.explosionT);
    expect(planté[0]).toBeGreaterThan(9.8);
    expect(planté[0]).toBeLessThanOrEqual(10);
    expect(tir.explosionT - tir.impactT).toBe(STATS.brochette.zombie.projectile!.delaiMs);
    // planté : il ne bouge plus après l'impact
    expect(positionProjectile(tir.traj, tir.t0, tir.impactT, tir.impactT + 500)).toEqual(planté);
    expect(preparerProjectile(mur, "pistolet", false, [0, 1.6, 0], [1, 0, 0], 0)).toBeNull();
    expect(preparerProjectile(mur, "pistolet", true, [0, 1.6, 0], [1, 0, 0], 0)).not.toBeNull();
  });

  it("le client recalcule la même trajectoire (sans les tigres) : identique jusqu'à l'impact du serveur, arrêté sur une cible", () => {
    const o: Vec3 = [0, 1.6, 0];
    // le serveur arrête le projectile sur un « tigre » à 6 m
    const cible: Vec3 = [6, 1.4, 0];
    const tir = preparerProjectile(vide, "pistolet", true, o, [1, 0, 0], 0, { arret: (a, b) => fractionSphere(a, b, cible, 0.5) })!;
    expect(tir.contact).toBe(true);
    const client = trajectoireProjectile(vide, { arme: "pistolet", ameliore: true, o: tir.o, v: tir.v })!;
    // identiques jusqu'au dernier pas (l'arrêt sur cible tombe au milieu d'un pas : le point d'impact diffusé le corrige)
    for (let t = 0; t <= tir.impactT - PAS_TRAJECTOIRE_MS; t += 5) {
      expect(proche(positionProjectile(client, 0, tir.impactT, t), positionProjectile(tir.traj, 0, tir.impactT, t), 1e-9)).toBe(true);
    }
    const impact = pointImpact(tir);
    const p = positionProjectile(client, 0, tir.impactT, tir.impactT + 1000, impact);
    expect(p).toEqual(impact);
    expect(Math.hypot(p[0] - cible[0], p[1] - cible[1])).toBeLessThan(0.6);
    expect(lancerRayon(vide, o, [1, 0, 0], 100)).toBe(Infinity);
  });

  it("fractionSphere : entrée dans la sphère, départ de l'intérieur, manque", () => {
    expect(fractionSphere([0, 0, 0], [10, 0, 0], [5, 0, 0], 1)).toBeCloseTo(0.4, 9);
    expect(fractionSphere([5, 0, 0], [10, 0, 0], [5, 0, 0], 1)).toBe(0);
    expect(fractionSphere([0, 3, 0], [10, 3, 0], [5, 0, 0], 1)).toBeNull();
    expect(fractionSphere([0, 0, 0], [2, 0, 0], [5, 0, 0], 1)).toBeNull();
  });
});
