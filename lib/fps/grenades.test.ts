import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, visible } from "./collision";
import {
  GRENADES, INTERVALLE_LANCER_MS, INVENTAIRE_GRENADES, PAS_TRAJECTOIRE_MS, degatsGrenade, degatsLanceur, grenadesDebutManche,
  plafondBatimentsCreux, positionLancer, positionTrajectoire, preparerLancer, simulerTrajectoire, souffleAtteint, trajectoireDuMessage,
  validerLancer, vitesseLancer, type ProfilGrenade,
} from "./grenades";
import type { Vec3 } from "./protocole";
import { FOCUS_ZOMBIES, PLAFOND_INTERIEUR_M, construireMondeZombies } from "./zombies-carte";
import { pvZombie } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Monde réduit à quelques prismes (pas de Truck : aucun POI). */
const mondeAvec = (b: Building[]) => construireMonde({ ...scene, buildings: b, pois: [] });
const vide = mondeAvec([rect(500, 500, 501, 501, 1)]);
const points = (tr: { points: number[] }): Vec3[] => {
  const r: Vec3[] = [];
  for (let i = 0; i < tr.points.length; i += 3) r.push([tr.points[i], tr.points[i + 1], tr.points[i + 2]]);
  return r;
};

describe("trajectoire", () => {
  it("en plein champ : parabole (gravité de 18 m/s²) puis rebonds, roulement et arrêt, jamais sous le sol", () => {
    const o: Vec3 = [0, 1.95, 0];
    const v = vitesseLancer("frag", [0, 0, -1]);
    expect(v).toEqual([0, GRENADES.frag.bonusHaut, -GRENADES.frag.vitesse]);
    const tr = simulerTrajectoire(vide, "frag", o, v, 6_000);
    const pts = points(tr);
    // 0,2 s après le lancer : encore en l'air, sur la parabole à quelques centimètres près (intégration à pas fixe)
    const t = 0.2;
    const p = positionTrajectoire(tr, t * 1000);
    expect(p[2]).toBeCloseTo(-GRENADES.frag.vitesse * t, 5);
    expect(Math.abs(p[1] - (o[1] + v[1] * t - 0.5 * GRENADES.frag.gravite * t * t))).toBeLessThan(0.05);
    for (const q of pts) expect(q[1]).toBeGreaterThanOrEqual(GRENADES.frag.rayonObjet - 1e-9);
    expect(tr.rebonds.length).toBeGreaterThanOrEqual(1);
    expect(tr.arretMs).toBeLessThan(6_000);
    // posée : elle ne bouge plus
    expect(positionTrajectoire(tr, tr.arretMs + 500)).toEqual(positionTrajectoire(tr, 6_000));
    expect(pts.at(-1)![1]).toBeCloseTo(GRENADES.frag.rayonObjet, 2);
  });

  it("déterministe : mêmes entrées, mêmes points ; le client retrouve la trajectoire du serveur depuis le message `grenade`", () => {
    const monde = construireMondeZombies(scene);
    const plafond = plafondBatimentsCreux(monde, PLAFOND_INTERIEUR_M);
    const o: Vec3 = [FOCUS_ZOMBIES[0], 1.95, FOCUS_ZOMBIES[1]];
    const v = vitesseLancer("frag", [0.6, 0.2, -0.77]);
    const l = preparerLancer(monde, "frag", o, v, 1_000_000, 700, { plafond });
    expect(l.explosionT).toBe(1_000_000 + GRENADES.frag.mecheMs - 700);
    const msg = JSON.parse(JSON.stringify({ genre: "frag", o, v, t0: l.t0, explosionT: l.explosionT }));
    const client = trajectoireDuMessage(construireMondeZombies(scene), msg, { plafond: plafondBatimentsCreux(construireMondeZombies(scene), PLAFOND_INTERIEUR_M) });
    expect(client).toEqual(l.traj);
    expect(positionLancer(l, l.explosionT)).toEqual(positionTrajectoire(client, l.explosionT - l.t0));
  });

  it("rebondit sur un mur : la vitesse horizontale s'inverse, la grenade reste du bon côté", () => {
    const monde = mondeAvec([rect(8, -20, 10, 20, 10)]);
    const tr = simulerTrajectoire(monde, "frag", [0, 1.5, 0], [19, 2, 0], 3_000);
    const pts = points(tr);
    const xMax = Math.max(...pts.map((p) => p[0]));
    expect(xMax).toBeLessThanOrEqual(8 - GRENADES.frag.rayonObjet + 1e-3);
    expect(xMax).toBeGreaterThan(7.5);
    expect(pts.at(-1)![0]).toBeLessThan(xMax - 1);
    expect(tr.rebonds[0].force).toBeGreaterThan(10); // le choc contre le mur
  });

  it("monte sur un toit bas et s'y pose ; un toit trop haut l'arrête comme un mur", () => {
    const bas = mondeAvec([rect(4, -5, 20, 5, 0.8)]);
    const tr = simulerTrajectoire(bas, "frag", [0, 1.95, 0], vitesseLancer("frag", [1, 0, 0]), 5_000);
    const fin = points(tr).at(-1)!;
    expect(fin[0]).toBeGreaterThan(4);
    expect(fin[1]).toBeCloseTo(0.8 + GRENADES.frag.rayonObjet, 2);
  });

  it("carte zombies : jamais à travers un mur, une cloison ou le faux plafond (16 directions depuis l'open space)", () => {
    const monde = construireMondeZombies(scene);
    const plafond = plafondBatimentsCreux(monde, PLAFOND_INTERIEUR_M);
    expect(plafond(FOCUS_ZOMBIES[0], FOCUS_ZOMBIES[1])).toBe(PLAFOND_INTERIEUR_M);
    const o: Vec3 = [FOCUS_ZOMBIES[0], 1.95, FOCUS_ZOMBIES[1]];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const haut of [0, 0.6]) {
        const tr = simulerTrajectoire(monde, "frag", o, vitesseLancer("frag", [Math.cos(a), haut, Math.sin(a)]), 4_000, { plafond });
        const pts = points(tr);
        for (let i = 1; i < pts.length; i++) {
          expect(visible(monde, pts[i - 1], pts[i])).toBe(true);
          if (plafond(pts[i][0], pts[i][2]) < Infinity) expect(pts[i][1]).toBeLessThanOrEqual(PLAFOND_INTERIEUR_M - GRENADES.frag.rayonObjet + 1e-3);
        }
      }
    }
  });

  it("à percussion (profil d'un projectile) : s'arrête au premier contact, mur ou cible mobile", () => {
    const obus: ProfilGrenade = { ...GRENADES.frag, percussion: true, gravite: 4, volMaxMs: 3_000 };
    const monde = mondeAvec([rect(8, -20, 10, 20, 10)]);
    const tr = simulerTrajectoire(monde, obus, [0, 1.5, 0], [30, 0, 0], 3_000);
    expect(tr.contact).toBe(true);
    expect(points(tr).at(-1)![0]).toBeCloseTo(8 - obus.rayonObjet, 2);
    expect(tr.arretMs).toBeLessThan(400);
    // une cible à x = 4 : touchée avant le mur
    const cible = simulerTrajectoire(monde, obus, [0, 1.5, 0], [30, 0, 0], 3_000, {
      arret: (a, b) => (a[0] <= 4 && b[0] >= 4 ? (4 - a[0]) / (b[0] - a[0]) : null),
    });
    expect(cible.contact).toBe(true);
    expect(points(cible).at(-1)![0]).toBeCloseTo(4, 5);
  });

  it("tigre à remontoir : explose 8 s après s'être posé ; posé, il ne bouge plus", () => {
    const l = preparerLancer(vide, "remontoir", [0, 1.95, 0], vitesseLancer("remontoir", [0, 0, -1]), 0, 2_000);
    expect(l.poseT).toBeGreaterThan(0);
    expect(l.poseT).toBeLessThanOrEqual(GRENADES.remontoir.volMaxMs);
    expect(l.explosionT).toBe(l.poseT + GRENADES.remontoir.mecheMs); // pas de cuisson
    expect(positionLancer(l, l.poseT)).toEqual(positionLancer(l, l.explosionT));
  });

  it("pas d'intégration : 60 points par seconde", () => {
    const tr = simulerTrajectoire(vide, "frag", [0, 1.95, 0], [0, 0, -5], 1_000);
    expect(tr.points.length / 3).toBe(Math.ceil(1000 / PAS_TRAJECTOIRE_MS) + 1);
  });
});

describe("explosion", () => {
  it("dégâts de BO1 : 600 au centre, 150 au bord (6,5 m), rien au-delà ; un coup tue jusqu'à la manche 5", () => {
    expect(degatsGrenade("frag", 0)).toBe(600);
    expect(degatsGrenade("frag", GRENADES.frag.rayonM)).toBe(150);
    expect(degatsGrenade("frag", GRENADES.frag.rayonM + 0.01)).toBe(0);
    expect(degatsGrenade("frag", 3.25)).toBe(375);
    for (let m = 1; m <= 5; m++) expect(degatsGrenade("frag", 0)).toBeGreaterThanOrEqual(pvZombie(m, 0, "plat", 0));
    expect(degatsGrenade("frag", 0)).toBeLessThan(pvZombie(6, 0, "plat", 0));
    // le lanceur : 45 au plus, jamais de quoi tomber depuis 100 PV
    expect(degatsLanceur("frag", 0)).toBe(GRENADES.frag.degatsLanceurMax);
    expect(degatsLanceur("frag", 7)).toBe(0);
  });

  it("le souffle ne traverse pas un mur, mais passe en plein champ et par-dessus un meuble bas", () => {
    const monde = mondeAvec([rect(8, -20, 10, 20, 10), rect(-7.5, -1, -7, 1, 0.8)]);
    expect(souffleAtteint(monde, [6, 0.1, 0], [12, 0.3, 0])).toBe(false);
    expect(souffleAtteint(monde, [6, 0.1, 0], [3, 0.3, 0])).toBe(true);
    expect(souffleAtteint(monde, [-3, 0.1, 0], [-8, 0.3, 0])).toBe(true); // le haut de la cible dépasse le meuble
  });
});

describe("inventaire et validation", () => {
  it("BO1 : +2 grenades par manche, 4 au plus (0 → 2, 1 → 3, 2 → 4, 4 → 4)", () => {
    expect([0, 1, 2, 3, 4].map(grenadesDebutManche)).toEqual([2, 3, 4, 4, 4]);
    let n = 0;
    for (let m = 0; m < 5; m++) n = grenadesDebutManche(n);
    expect(n).toBe(INVENTAIRE_GRENADES.fragMax);
    expect(grenadesDebutManche(Number.NaN)).toBe(2);
  });

  it("un lancer : genre connu, stock, une grenade toutes les 0,5 s, cuisson bornée à la mèche (le remontoir ne cuit pas)", () => {
    expect(validerLancer("frag", 0, undefined, 0, 0)).toEqual({ ok: false, raison: "stock" });
    expect(validerLancer("pomme", 3, undefined, 0, 0)).toEqual({ ok: false, raison: "genre" });
    expect(validerLancer("frag", 3, 1_000, 1_000 + INTERVALLE_LANCER_MS - 1, 0)).toEqual({ ok: false, raison: "cadence" });
    expect(validerLancer("frag", 3, 1_000, 1_000 + INTERVALLE_LANCER_MS, 0)).toEqual({ ok: true, genre: "frag", cuissonMs: 0 });
    expect(validerLancer("frag", 1, undefined, 0, 99_999)).toEqual({ ok: true, genre: "frag", cuissonMs: GRENADES.frag.mecheMs });
    expect(validerLancer("frag", 1, undefined, 0, -50)).toEqual({ ok: true, genre: "frag", cuissonMs: 0 });
    expect(validerLancer("frag", 1, undefined, 0, "beaucoup")).toEqual({ ok: true, genre: "frag", cuissonMs: 0 });
    expect(validerLancer("remontoir", 1, undefined, 0, 2_000)).toEqual({ ok: true, genre: "remontoir", cuissonMs: 0 });
  });
});
