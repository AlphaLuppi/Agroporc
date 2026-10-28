import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, detruireBatiment, plafondSur, releverBatiments, type Monde } from "./collision";
import { MOUV, etape, etatInitial, type Entrees, type EtatMouvement } from "./mouvement";
import { SILHOUETTE, type Vec3 } from "./protocole";
import {
  BATIMENTS_CREUX, DEPARTS, HAUTEUR_PLAFOND_ZOMBIES, HAUTEUR_PORTE_INTERIEURE, INDEX_PREMIERE_PIECE, construireMondeZombies, donneesZombies,
  plafondZombies,
} from "./zombies-carte";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const DT = 1 / 60;
const SOMMET_SAUT = MOUV.saut ** 2 / (2 * MOUV.gravite);

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Monde réduit (bornes à ±275 m) ; les bâtiments sont après les deux coins (index 2, 3…). */
function mondeDe(...batiments: Building[]): Monde {
  const coins = [rect(-250, -250, -249, -249, 3), rect(249, 249, 250, 250, 3)];
  return construireMonde({ ...scene, buildings: [...coins, ...batiments], pois: [] });
}
const lacetVers = (fx: number, fz: number): number => Math.atan2(-fx, -fz);
/** Saute dès qu'il touche le sol (front montant toutes les 0,4 s), en avançant (ou pas) vers `lacet`. */
const sauts = (t: number, avant = 0, lacet = 0): Entrees => ({ avant, droite: 0, saut: Math.floor(t / 0.4) % 2 === 0, sprint: avant > 0, lacet });

/** Simule `secondes` s et rend l'état final et la plus grande hauteur des pieds atteinte. */
function simuler(e: EtatMouvement, secondes: number, en: (t: number) => Entrees, m: Monde, surPas?: (e: EtatMouvement) => void): { e: EtatMouvement; yMax: number } {
  let yMax = -Infinity;
  const n = Math.round(secondes / DT);
  for (let k = 0; k < n; k++) {
    e = etape(e, en((k + 1) * DT), DT, m);
    yMax = Math.max(yMax, e.p[1]);
    surPas?.(e);
  }
  return { e, yMax };
}
const etatA = (p: Vec3): EtatMouvement => etatInitial(p);

describe("plafondSur (collision)", () => {
  // salle de 10 × 10 m (prisme sans hauteur, faux plafond à 3,4) et linteau fin (porte achetée : h = 0) à 2,6 m
  const salle = rect(0, 0, 10, 10, 0), linteau = rect(10, 4, 10.4, 6.6, 0);
  const m = mondeDe(salle, linteau);
  m.prismes[2].plafond = 3.4;
  m.prismes[3].plafond = 2.6;
  m.plafonds = true;

  it("dans l'emprise, le plafond ; dehors, Infinity ; près d'un linteau fin, le linteau à r près", () => {
    expect(plafondSur(m, 5, 5, 0.3)).toBe(3.4);
    expect(plafondSur(m, -3, 5, 0.3)).toBe(Infinity);
    expect(plafondSur(m, 10.2, 5, 0.3)).toBe(2.6);
    expect(plafondSur(m, 10.6, 5, 0.3)).toBe(2.6); // la tête (0,3 m) passe encore sous le linteau
    expect(plafondSur(m, 10.8, 5, 0.3)).toBe(Infinity);
    // le plus bas l'emporte
    expect(plafondSur(m, 9.9, 5, 0.3)).toBe(2.6);
  });

  it("indépendant de la hauteur du prisme : gardé quand il est détruit ou relevé", () => {
    const mm = mondeDe(rect(0, 0, 3, 3, 40));
    mm.prismes[2].plafond = 2.6;
    mm.plafonds = true;
    detruireBatiment(mm, 2);
    expect(plafondSur(mm, 1.5, 1.5, 0.3)).toBe(2.6);
    releverBatiments(mm);
    expect(plafondSur(mm, 1.5, 1.5, 0.3)).toBe(2.6);
  });

  it("sans `Monde.plafonds` (arène, vue aérienne), aucun plafond", () => {
    const arene = construireMonde(scene);
    expect(arene.plafonds).toBeUndefined();
    expect(arene.prismes.some((p) => p.plafond !== undefined)).toBe(false);
    expect(plafondSur(arene, 140, -40, 0.3)).toBe(Infinity);
  });
});

describe("plafonds dans le mouvement (monde réduit)", () => {
  const salle = rect(0, 0, 10, 10, 0), bureau = rect(4, 4, 6, 6, 1.1), linteau = rect(10, 4, 10.4, 6.6, 0);
  const murN = rect(10, 0, 10.4, 4, 40), murS = rect(10, 6.6, 10.4, 10, 40);
  const m = mondeDe(salle, bureau, linteau, murN, murS);
  m.prismes[2].plafond = 3.4;
  m.prismes[4].plafond = 2.6;
  m.plafonds = true;
  const limite = (plafond: number) => plafond - MOUV.degagementTete;

  it("au sol, le saut est inchangé (sommet ≈ 1,16 m, sous la butée de 1,30 m)", () => {
    const { yMax } = simuler(etatA([2, 0, 2]), 1, (t) => sauts(t), m);
    expect(yMax).toBeCloseTo(SOMMET_SAUT, 1);
    expect(yMax).toBeLessThan(limite(3.4));
  });

  it("depuis un meuble, le saut s'arrête au plafond (vitesse verticale annulée) : l'œil reste sous le plafond", () => {
    let vy = 0, butee = false;
    const { e, yMax } = simuler(etatA([5, 1.1, 5]), 2, (t) => sauts(t), m, (s) => {
      if (s.p[1] >= limite(3.4) - 1e-9) { butee = true; vy = Math.max(vy, s.v[1]); }
    });
    expect(butee).toBe(true);
    expect(vy).toBeLessThanOrEqual(0);
    expect(yMax + SILHOUETTE.oeil).toBeLessThanOrEqual(3.4 - 0.15 + 1e-9);
    expect(e.p[1]).toBeCloseTo(1.1, 6); // toujours sur le bureau
  });

  it("sous un linteau (porte achetée), les pieds restent sous 0,5 m ; sauter dans la porte de trop haut fait buter, sans saut de position", () => {
    const { yMax } = simuler(etatA([10.2, 0, 5.3]), 1.5, (t) => sauts(t), m);
    expect(yMax).toBeLessThanOrEqual(limite(2.6) + 1e-9);
    // dehors (aucun plafond), on saute vers la porte en courant
    let sautMax = 0;
    let prec = etatA([14, 0, 5.3]);
    simuler(prec, 2, (t) => ({ avant: 1, droite: 0, saut: t < 0.05, sprint: true, lacet: lacetVers(-1, 0) }), m, (s) => {
      sautMax = Math.max(sautMax, Math.abs(s.p[1] - prec.p[1]));
      // jamais sous le linteau plus haut que la butée
      if (plafondSur(m, s.p[0], s.p[2], MOUV.rayonTete) <= 2.6) expect(s.p[1]).toBeLessThanOrEqual(limite(2.6) + 1e-9);
      prec = s;
    });
    expect(sautMax).toBeLessThan(0.2);
    expect(prec.p[0]).toBeLessThan(9); // il a fini par entrer
  });

  it("posé sur un meuble trop haut pour y tenir debout, on est remis plus bas, écarté du meuble, et l'on tombe", () => {
    const mm = mondeDe(salle, rect(4, 4, 6, 6, 2.1));
    mm.prismes[2].plafond = 3.4;
    mm.plafonds = true;
    simuler(etatA([5, 2.1, 5]), 2, (t) => sauts(t), mm, (s) => {
      expect(s.p[1] + SILHOUETTE.oeil).toBeLessThanOrEqual(3.4 - 0.15 + 1e-9);
    });
  });

  it("l'escalade est coupée par `sansParkour` (zombies) : un bloc de 1,25 m s'escalade dans l'arène, pas en zombies", () => {
    const bloc = rect(-30, 0, 30, 10, 1.25); // face nord en z = 0
    const arene = mondeDe(bloc), zombies = mondeDe(bloc);
    zombies.sansParkour = true;
    const en = (t: number): Entrees => ({ avant: 1, droite: 0, saut: t < 0.05, sprint: false, lacet: lacetVers(0, 1) });
    expect(simuler(etatA([0, 0, -1]), 1.5, en, arene).e.p[1]).toBeGreaterThan(1.2);
    expect(simuler(etatA([0, 0, -1]), 1.5, en, zombies).e.p[1]).toBe(0);
  });
});

describe("plafonds de la carte zombies (vrai scene.json)", () => {
  const donnees = donneesZombies(scene);
  const monde = construireMondeZombies(scene);
  const types = donnees.data.buildings.map((b) => b.type);

  it("chaque bâtiment creusé a le faux plafond du rendu, chaque porte intérieure son linteau, rien d'autre", () => {
    expect(monde.plafonds).toBe(true);
    expect(HAUTEUR_PLAFOND_ZOMBIES).toBe(3.4);
    monde.prismes.forEach((p, i) => {
      if (types[i] === "creux") expect(p.plafond).toBe(Math.min(3.4, scene.buildings[i].h - 0.3));
      else if (types[i] === "porte" && donnees.pieces[i - INDEX_PREMIERE_PIECE]?.batiment !== undefined) expect(p.plafond).toBe(HAUTEUR_PORTE_INTERIEURE);
      else expect(p.plafond).toBeUndefined();
    });
    for (const b of BATIMENTS_CREUX) expect(plafondSur(monde, scene.buildings[b].c[0], scene.buildings[b].c[1], 0)).toBeLessThanOrEqual(3.4);
    expect(plafondZombies(4.7)).toBeCloseTo(3.4, 9);
  });

  it("debout sur chaque meuble puis en sautant (du plus haut au plus bas), l'œil reste sous le plafond", () => {
    const meubles = donnees.data.buildings.map((b, i) => ({ b, i })).filter(({ b, i }) => b.type === "meuble" && donnees.pieces[i - INDEX_PREMIERE_PIECE]?.batiment !== undefined);
    expect(meubles.length).toBeGreaterThan(10);
    meubles.sort((a, b) => b.b.h - a.b.h);
    expect(meubles[0].b.h).toBeGreaterThanOrEqual(2); // le rack ou la cuve
    for (const { b } of meubles) {
      const plafond = plafondSur(monde, b.c[0], b.c[1], MOUV.rayonTete);
      expect(plafond).toBeLessThanOrEqual(3.4);
      let oeilMax = 0;
      const suivre = (s: EtatMouvement) => { oeilMax = Math.max(oeilMax, s.p[1] + SILHOUETTE.oeil); };
      let { e } = simuler(etatA([b.c[0], b.h, b.c[1]]), 2, (t) => sauts(t), monde, suivre);
      e = simuler(e, 1, () => sauts(1), monde, suivre).e; // puis immobile, retombé
      expect(oeilMax, `meuble de ${b.h} m`).toBeLessThanOrEqual(plafond - 0.15 + 1e-9);
      // un meuble assez bas reste praticable (on tient debout dessus) ; un plus haut renvoie au sol
      if (b.h + MOUV.degagementTete <= plafond) expect(e.p[1]).toBeCloseTo(b.h, 6);
      else expect(e.p[1]).toBe(0);
    }
  });

  it("au départ (open space), le saut au sol est celui de l'arène", () => {
    for (const d of DEPARTS.slice(0, 3)) {
      const { yMax } = simuler(etatA([d[0], 0, d[1]]), 1, (t) => sauts(t), monde);
      expect(yMax).toBeCloseTo(SOMMET_SAUT, 1);
    }
  });

  it("portes intérieures achetées : en sautant sous le linteau, l'œil reste sous 2,6 m − 0,15", () => {
    const m = construireMondeZombies(scene);
    const portes = donnees.data.buildings.map((b, i) => ({ b, i })).filter(({ i }) => monde.prismes[i].plafond === HAUTEUR_PORTE_INTERIEURE);
    expect(portes.length).toBeGreaterThanOrEqual(5);
    for (const { i } of portes) detruireBatiment(m, i);
    for (const { b } of portes) {
      let oeilMax = 0;
      simuler(etatA([b.c[0], 0, b.c[1]]), 1.2, (t) => sauts(t), m, (s) => {
        if (plafondSur(m, s.p[0], s.p[2], MOUV.rayonTete) <= HAUTEUR_PORTE_INTERIEURE) oeilMax = Math.max(oeilMax, s.p[1] + SILHOUETTE.oeil);
      });
      expect(oeilMax).toBeLessThanOrEqual(HAUTEUR_PORTE_INTERIEURE - 0.15 + 1e-9);
    }
  });

  it("pas d'escalade en zombies : contre une étagère de 1,8 m, sauter en poussant ne hisse jamais dessus", () => {
    const etagere = donnees.data.buildings.find((b, i) => b.type === "meuble" && b.h === 1.8 && donnees.pieces[i - INDEX_PREMIERE_PIECE]?.genre === "etagere")!;
    expect(etagere).toBeDefined();
    // départ à 3 m du centre, vers lui, par les quatre côtés
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = etagere.c[0] + dx * 3, z = etagere.c[1] + dz * 3;
      const { yMax } = simuler(etatA([x, 0, z]), 2, (t) => sauts(t, 1, lacetVers(-dx, -dz)), monde);
      expect(yMax).toBeLessThan(1.5);
    }
  });
});
