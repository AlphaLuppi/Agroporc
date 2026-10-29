import { describe, expect, it } from "vitest";
import scene from "../../public/agroparc/scene.json";
import { dedans, distSegment } from "../agroparc3d/cachettes";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import {
  AIRE_MAX_M2, AIRE_MIN_M2, PORTE_SORTIE_M, BATIMENT_TRUCK, HAUTEUR_MIN_M, NB_PROCEDURAUX, REMPLISSAGE_MIN,
  atteintLExterieur, centresBatimentsEligibles, choisirBatimentsProcedurals, construireMondeBr, depuisRepere, donneesBr, piecesProcedurales, pointsButin,
  rectDansEmprise, rectangleInscrit, versRepere, type Rect,
} from "./br-carte";
import { construireMonde, resoudre, solSous, type Monde } from "./collision";
import type { PoolButin } from "./protocole";
import { BATIMENTS_CREUX, DEMI_EPAISSEUR_COQUE, INDEX_PREMIERE_PIECE, LARGEUR_PORTE, batimentDePiece, local } from "./zombies-carte";

const sc = scene as unknown as SceneData;
const monde = construireMondeBr(sc);
const donnees = donneesBr(sc);
const procedurauxIdx = choisirBatimentsProcedurals(sc);
const rectDe = (i: number): Rect => rectangleInscrit(sc.buildings[i].r, sc.buildings[i].holes)!;

/** Polygone rectangulaire du repère à 16° (coins en coordonnées de la carte). */
const polyRect = (s0: number, t0: number, s1: number, t1: number): Vec2[] => [depuisRepere(s0, t0), depuisRepere(s1, t0), depuisRepere(s1, t1), depuisRepere(s0, t1)];
const larg = (r: Rect) => r.s1 - r.s0, haut = (r: Rect) => r.t1 - r.t0;

/** Distance (m) du point au mur le plus proche : arêtes de tous les prismes qui ont une hauteur (murs, bâtiments pleins, étagères). */
function distanceMur(m: Monde, x: number, z: number): number {
  let d = Infinity;
  for (const p of m.prismes) {
    if (p.h <= 0.05) continue;
    for (const a of [p.anneau, ...p.trous]) for (let i = 0, j = a.length - 1; i < a.length; j = i++) d = Math.min(d, distSegment(x, z, a[j][0], a[j][1], a[i][0], a[i][1]));
  }
  return d;
}

/** Cellules de `pas` m atteignables à pied (cylindre de rayon `rayon`) depuis `depart`, dans la boîte (s, t) donnée. */
function atteignables(m: Monde, depart: Vec2, region: Rect, pas: number, rayon: number): { vus: Set<string>; libres: number; bord: boolean } {
  const libre = (s: number, t: number) => { const [x, z] = depuisRepere(s, t); return resoudre(m, [x, 0, z], rayon, 1.8).contacts.length === 0; };
  const [ds, dt] = versRepere(depart[0], depart[1]);
  const cle = (i: number, j: number) => `${i},${j}`;
  const vus = new Set<string>([cle(0, 0)]);
  const file: [number, number][] = [[0, 0]];
  let bord = false;
  while (file.length) {
    const [i, j] = file.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, s = ds + a * pas, t = dt + b * pas;
      if (vus.has(cle(a, b))) continue;
      if (s < region.s0 || s > region.s1 || t < region.t0 || t > region.t1) { bord = true; continue; }
      if (!libre(s, t)) continue;
      vus.add(cle(a, b));
      file.push([a, b]);
    }
  }
  let libres = 0;
  for (let s = region.s0; s <= region.s1; s += pas) for (let t = region.t0; t <= region.t1; t += pas) if (libre(s, t)) libres++;
  return { vus, libres, bord };
}

describe("rectangleInscrit", () => {
  it("un rectangle du repère à 16° est rendu tel quel", () => {
    const r = rectangleInscrit(polyRect(10, 20, 22, 29))!;
    expect(larg(r)).toBeCloseTo(12, 5);
    expect(haut(r)).toBeCloseTo(9, 5);
  });

  it("un L : le plus grand rectangle est une des deux branches, entièrement dans l'emprise", () => {
    const L = [[0, 0], [20, 0], [20, 6], [8, 6], [8, 16], [0, 16]].map(([s, t]) => depuisRepere(s, t));
    const r = rectangleInscrit(L)!;
    expect(larg(r) * haut(r)).toBeGreaterThanOrEqual(8 * 16 - 1e-9);
    expect(rectDansEmprise(r, L)).toBe(true);
  });

  it("une cour est exclue, même petite", () => {
    const ext = polyRect(0, 0, 30, 10);
    const cour = polyRect(14, 3, 16, 7);
    const r = rectangleInscrit(ext, [cour])!;
    expect(rectDansEmprise(r, ext, [cour])).toBe(true);
    for (const [x, z] of cour) {
      const [s, t] = versRepere(x, z);
      expect(s > r.s0 + 1e-6 && s < r.s1 - 1e-6 && t > r.t0 + 1e-6 && t < r.t1 - 1e-6).toBe(false);
    }
    // le côté sans cour (14 × 10) ou le côté gauche : plus de la moitié de l'emprise utile
    expect(larg(r) * haut(r)).toBeGreaterThanOrEqual(14 * 10 - 1e-9);
  });

  it("est déterministe et inscrit sur les vrais bâtiments, trous compris", () => {
    for (let i = 0; i < INDEX_PREMIERE_PIECE; i++) {
      const b = sc.buildings[i];
      const r = rectangleInscrit(b.r, b.holes);
      if (!r) continue;
      expect(rectDansEmprise(r, b.r, b.holes), `bâtiment ${i}`).toBe(true);
      expect(rectangleInscrit(b.r, b.holes)).toEqual(r);
    }
  });
});

describe("bâtiments procéduraux", () => {
  it("au moins 12, au plus 16, hors les quatre des zombies et le 114, tous éligibles", () => {
    expect(procedurauxIdx.length).toBeGreaterThanOrEqual(12);
    expect(procedurauxIdx.length).toBeLessThanOrEqual(NB_PROCEDURAUX);
    expect([...procedurauxIdx].sort((a, b) => a - b)).toEqual(procedurauxIdx);
    for (const i of procedurauxIdx) {
      const b = sc.buildings[i];
      expect(BATIMENTS_CREUX as readonly number[]).not.toContain(i);
      expect(i).not.toBe(BATIMENT_TRUCK);
      expect(b.h).toBeGreaterThanOrEqual(HAUTEUR_MIN_M);
      const s = b.r.map(([x, z]) => versRepere(x, z));
      const bb = (k: 0 | 1) => Math.max(...s.map((p) => p[k])) - Math.min(...s.map((p) => p[k]));
      let aire = 0;
      for (let k = 0, j = b.r.length - 1; k < b.r.length; j = k++) aire += b.r[j][0] * b.r[k][1] - b.r[k][0] * b.r[j][1];
      aire = Math.abs(aire) / 2;
      expect(aire).toBeGreaterThanOrEqual(AIRE_MIN_M2);
      expect(aire).toBeLessThanOrEqual(AIRE_MAX_M2);
      expect(aire / (bb(0) * bb(1))).toBeGreaterThanOrEqual(REMPLISSAGE_MIN - 1e-9);
    }
  });

  it("dispersés : 25 m au moins entre deux choisis, trois quadrants au moins", () => {
    const cs = procedurauxIdx.map((i) => sc.buildings[i].c);
    for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
      expect(Math.hypot(cs[a][0] - cs[b][0], cs[a][1] - cs[b][1]), `${procedurauxIdx[a]} / ${procedurauxIdx[b]}`).toBeGreaterThanOrEqual(25);
    }
    const bo = donnees.bornes, cx = (bo.x0 + bo.x1) / 2, cz = (bo.z0 + bo.z1) / 2;
    const quadrants = new Set(cs.map(([x, z]) => `${x < cx}${z < cz}`));
    expect(quadrants.size).toBeGreaterThanOrEqual(3);
  });

  it("la sélection est stable d'un appel à l'autre et piecesProcedurales redonne les pièces de la scène BR", () => {
    expect(choisirBatimentsProcedurals(sc)).toEqual(procedurauxIdx);
    const pieces = piecesProcedurales(sc, procedurauxIdx);
    expect(donnees.pieces.slice(-pieces.length)).toEqual(pieces);
    expect(new Set(donnees.pieces.map((p) => p.id)).size).toBe(donnees.pieces.length);
  });

  it("la coque est contenue dans l'emprise réelle (coins du rectangle inscrit et de chaque pièce, cours exclues)", () => {
    for (const i of procedurauxIdx) {
      const b = sc.buildings[i], r = rectDe(i);
      expect(rectDansEmprise(r, b.r, b.holes), `rectangle ${i}`).toBe(true);
      const pieces = donnees.pieces.filter((p) => p.batiment === i);
      expect(pieces.length).toBeGreaterThanOrEqual(6);
      for (const p of pieces) {
        for (const [x, z] of batimentDePiece(p).r) {
          const sur = [b.r, ...(b.holes ?? [])].some((a) => a.some((_, k) => distSegment(x, z, a[k][0], a[k][1], a[(k + 1) % a.length][0], a[(k + 1) % a.length][1]) < 0.03));
          const dans = dedans(x, z, b.r) && !(b.holes ?? []).some((h) => dedans(x, z, h));
          expect(dans || sur, `${p.id} (${x}, ${z})`).toBe(true);
        }
      }
    }
  });

  it("murs fermés sauf la porte du sud : la fenêtre du nord bloque les joueurs, la porte est libre", () => {
    for (const i of procedurauxIdx) {
      const r = rectDe(i), sm = (r.s0 + r.s1) / 2, E = DEMI_EPAISSEUR_COQUE;
      const bloque = (s: number, t: number) => { const [x, z] = depuisRepere(s, t); return resoudre(monde, [x, 0.5, z], 0.05, 1.8).contacts.length > 0; };
      for (let s = r.s0 + 0.1; s <= r.s1 - 0.1; s += 0.25) {
        expect(bloque(s, r.t1 - E), `nord ${i} s=${s}`).toBe(true);
        if (Math.abs(s - sm) > LARGEUR_PORTE / 2 + 0.1) expect(bloque(s, r.t0 + E), `sud ${i} s=${s}`).toBe(true);
        else if (Math.abs(s - sm) < LARGEUR_PORTE / 2 - 0.1) expect(bloque(s, r.t0 + E), `porte ${i} s=${s}`).toBe(false);
      }
      for (let t = r.t0 + 0.1; t <= r.t1 - 0.1; t += 0.25) {
        expect(bloque(r.s0 + E, t), `ouest ${i}`).toBe(true);
        expect(bloque(r.s1 - E, t), `est ${i}`).toBe(true);
      }
    }
  });

  it("l'intérieur est atteignable depuis l'extérieur par la porte (flood-fill, joueur de rayon 0,3)", () => {
    for (const i of procedurauxIdx) {
      const r = rectDe(i), sm = (r.s0 + r.s1) / 2;
      const depart = depuisRepere(sm, r.t0 - 0.6);
      const marge = 4;
      const region: Rect = { s0: r.s0 - marge, s1: r.s1 + marge, t0: r.t0 - marge, t1: r.t1 + marge };
      const { vus, libres, bord } = atteignables(monde, depart, region, 0.5, 0.3);
      const [ds, dt] = versRepere(depart[0], depart[1]);
      // les cellules atteintes à l'intérieur de la coque
      let dedansAtteint = 0, dedansLibre = 0;
      for (const cle of vus) {
        const [a, b] = cle.split(",").map(Number);
        const s = ds + a * 0.5, t = dt + b * 0.5;
        if (s > r.s0 + 0.4 && s < r.s1 - 0.4 && t > r.t0 + 0.4 && t < r.t1 - 0.4) dedansAtteint++;
      }
      for (let s = r.s0 + 0.5; s < r.s1 - 0.4; s += 0.5) for (let t = r.t0 + 0.5; t < r.t1 - 0.4; t += 0.5) {
        const [x, z] = depuisRepere(s, t);
        if (resoudre(monde, [x, 0, z], 0.3, 1.8).contacts.length === 0) dedansLibre++;
      }
      expect(libres).toBeGreaterThan(0);
      expect(dedansLibre, `bâtiment ${i}`).toBeGreaterThan(0);
      // la grille de départ est décalée de celle de comptage : on exige l'essentiel, pas l'égalité
      expect(dedansAtteint, `bâtiment ${i}`).toBeGreaterThanOrEqual(0.9 * dedansLibre);
      expect(bord || vus.size > dedansAtteint).toBe(true);
    }
  });

  it("chaque point de butin d'intérieur mène à l'extérieur à pied (aucune pièce fermée par des voisins), depuis le vrai monde BR", () => {
    const interieurs = pointsButin(sc, monde).filter((p) => p.pool === "interieur");
    expect(interieurs.length).toBeGreaterThan(0);
    // tous les points, un flood-fill par point : la poche fermée (porte contre les murs pleins d'un voisin) laisse des points inaccessibles
    for (const { p } of interieurs) expect(atteintLExterieur(monde, p[0], p[2], 0.4, PORTE_SORTIE_M), `(${p[0]}, ${p[2]})`).toBe(true);
  });

  it("le bâtiment 13, dont la porte donne à moins d'un mètre sur les murs pleins de 12 et 45, n'est pas creusé ; le détecteur voit la poche", () => {
    expect(procedurauxIdx).not.toContain(13);
    // le seuil de la porte du 13 (coque non traversable) est une poche fermée : les voisins pleins ferment la rue à moins d'un mètre
    const r = rectangleInscrit(sc.buildings[13].r, sc.buildings[13].holes)!;
    const [x, z] = depuisRepere((r.s0 + r.s1) / 2, r.t0 - 1);
    const essai = construireMonde({ ...sc, pois: sc.pois.filter((q) => q.type !== "truck") });
    essai.prismes[13].h = 0; essai.prismes[13].hOrigine = 0;
    expect(atteintLExterieur(essai, x, z, 0.4, PORTE_SORTIE_M, r)).toBe(false);
    // un pré dégagé loin de tout bâtiment : atteint l'extérieur
    expect(atteintLExterieur(monde, 0, 0, 0.4, PORTE_SORTIE_M)).toBe(true);
    // départ dans un mur : faux
    const mur = donnees.pieces.find((q) => q.type === "coque")!;
    expect(atteintLExterieur(monde, mur.p[0], mur.p[1], 0.4, PORTE_SORTIE_M)).toBe(false);
  });

  it("les quatre bâtiments des zombies sont ouverts sans leurs portes (l'open space du 72 communique avec l'extérieur)", () => {
    expect(donnees.pieces.some((p) => p.type === "porte")).toBe(false);
    const depart = local(72, -8, -5.5);
    const [s, t] = versRepere(depart[0], depart[1]);
    const region: Rect = { s0: s - 40, s1: s + 55, t0: t - 20, t1: t + 25 };
    const { vus, bord } = atteignables(monde, depart, region, 0.5, 0.3);
    expect(vus.size).toBeGreaterThan(200);
    expect(bord).toBe(true);
  });
});

describe("scène et monde BR", () => {
  it("donneesBr ne modifie pas la scène, marque modeCarte, creuse 4 + procéduraux, retire le Truck", () => {
    const avant = JSON.stringify(sc);
    const d = donneesBr(sc);
    expect(JSON.stringify(sc)).toBe(avant);
    expect(sc.modeCarte).toBeUndefined();
    expect(d.data.modeCarte).toBe("br");
    expect(d.data.pois.some((p) => p.type === "truck")).toBe(false);
    expect(sc.pois.some((p) => p.type === "truck")).toBe(true);
    expect(d.data.buildings).toHaveLength(INDEX_PREMIERE_PIECE + d.pieces.length);
    expect(d.creux).toEqual([...BATIMENTS_CREUX, ...procedurauxIdx].sort((a, b) => a - b));
    d.data.buildings.forEach((b, i) => {
      if (i < INDEX_PREMIERE_PIECE) expect(b.type).toBe(d.creux.includes(i) ? "creux" : undefined);
    });
    // la copie est profonde
    expect(d.data.buildings[0].r).not.toBe(sc.buildings[0].r);
  });

  it("le monde garde les bornes des 142 bâtiments d'origine, sans prisme fixe ni Truck", () => {
    expect(monde.bornes).toEqual(construireMonde(sc).bornes);
    expect(monde.bornes).toEqual(donnees.bornes);
    expect(monde.prismes).toHaveLength(INDEX_PREMIERE_PIECE + donnees.pieces.length);
    expect(monde.prismes.some((p) => p.fixe)).toBe(false);
    expect(construireMonde(donnees.data).bornes).not.toEqual(monde.bornes); // les pièces ajoutées élargiraient les bornes
    expect(monde.sansParkour).toBeUndefined();
  });

  it("deux mondes sont deux instances (brèches propres à la salle)", () => {
    const a = construireMondeBr(sc), b = construireMondeBr(sc);
    expect(a).not.toBe(b);
    expect(a.prismes[0]).not.toBe(b.prismes[0]);
    expect(a.grille.marques).not.toBe(b.grille.marques);
  });

  it("creux sans hauteur, murs à leur hauteur de bâtiment, étagères basses", () => {
    donnees.data.buildings.forEach((b, i) => {
      const p = monde.prismes[i];
      if (b.type === "creux") { expect(p.h).toBe(0); expect(p.hOrigine).toBe(0); }
      else if (b.type === "meuble") expect(p.h).toBeLessThan(2.5);
      else if (b.type === "coque" || b.type === "cloison" || b.type === "fenetre") expect(p.h).toBeGreaterThanOrEqual(HAUTEUR_MIN_M);
      else expect(p.h).toBe(sc.buildings[i].h);
    });
  });

  it("le toit est ouvert et le monde passe par resoudre : intérieur libre, mur plein, toit praticable, bornes", () => {
    const i = procedurauxIdx[0], r = rectDe(i);
    const [cx, cz] = depuisRepere((r.s0 + r.s1) / 2, (r.t0 + r.t1) / 2);
    // toit ouvert : on tombe jusqu'au sol de la coque, aucun toit à y = h
    expect(solSous(monde, cx, cz, sc.buildings[i].h + 1, 0)).toBe(0);
    expect(resoudre(monde, [cx, 0, cz], 0.4, 1.8).contacts).toHaveLength(0);
    // le mur ouest arrête le joueur, la poussée le ramène vers l'intérieur
    const [mx, mz] = depuisRepere(r.s0 + DEMI_EPAISSEUR_COQUE, (r.t0 + r.t1) / 2);
    const mur = resoudre(monde, [mx, 0, mz], 0.4, 1.8);
    expect(mur.contacts.length).toBeGreaterThan(0);
    // un bâtiment plein : bloquant sous son toit, praticable dessus
    const toit = pointsButin(sc, monde).find((p) => p.pool === "toit")!;
    expect(resoudre(monde, [toit.p[0], toit.p[1] - 1, toit.p[2]], 0.4, 1.8).contacts.length).toBeGreaterThan(0);
    expect(resoudre(monde, toit.p, 0.4, 1.8).contacts).toHaveLength(0);
    expect(solSous(monde, toit.p[0], toit.p[2], toit.p[1] + 0.2)).toBeCloseTo(toit.p[1], 6);
    // les bornes
    const hors = resoudre(monde, [monde.bornes.x0 - 10, 0, (monde.bornes.z0 + monde.bornes.z1) / 2], 0.4, 1.8);
    expect(hors.p[0]).toBeCloseTo(monde.bornes.x0 + 0.4, 6);
    expect(hors.contacts.some((c) => c.prisme === -1)).toBe(true);
  });

  it("centresBatimentsEligibles : 20 centres, un par bâtiment creux, dans son emprise", () => {
    const centres = centresBatimentsEligibles(sc);
    expect(centres).toHaveLength(BATIMENTS_CREUX.length + procedurauxIdx.length);
    expect(centres).toHaveLength(20);
    donnees.creux.forEach((i, k) => {
      const b = sc.buildings[i];
      expect(dedans(centres[k][0], centres[k][1], b.r), `bâtiment ${i}`).toBe(true);
    });
  });
});

describe("pointsButin", () => {
  const points = pointsButin(sc, monde);
  const parPool = (pool: PoolButin) => points.filter((p) => p.pool === pool);

  it("est déterministe, d'un monde à l'autre et d'un appel à l'autre", () => {
    expect(pointsButin(sc, construireMondeBr(sc))).toEqual(points);
    expect(pointsButin(sc, monde)).toEqual(points);
  });

  it("comptes par pool consignés (REMESURER si scene.json, les rectangles inscrits ou les pas des grilles changent)", () => {
    const comptes = Object.fromEntries((["interieur", "toit", "facade", "route"] as const).map((p) => [p, parPool(p).length]));
    // mesuré le 2026-10-29 : 16 bâtiments procéduraux sur scene.json (index 16, 18, 32, 33, 45, 61, 64, 67, 68, 69, 86, 98, 115, 122, 126, 131 ; le 13, dont la porte donne à moins d'un mètre sur les murs pleins de 12 et 45, est écarté)
    expect(comptes).toEqual({ interieur: 557, toit: 1012, facade: 589, route: 612 });
    // l'intérieur couvre le quota de 50 joueurs : 0,45 × 450 objets ≈ 202
    expect(comptes.interieur).toBeGreaterThanOrEqual(Math.ceil(0.45 * 450));
    // l'ordre est celui des pools
    expect(points.map((p) => p.pool).filter((p, k, a) => k === 0 || p !== a[k - 1])).toEqual(["interieur", "toit", "facade", "route"]);
  });

  it("chaque point est libre pour un joueur de rayon 0,4 et hors de l'eau", () => {
    const eaux = sc.water;
    for (const { p, pool } of points) {
      expect(resoudre(monde, p, 0.4, 1.8).contacts.length, `${pool} ${p}`).toBe(0);
      expect(eaux.some((w) => dedans(p[0], p[2], w)), `${pool} ${p}`).toBe(false);
    }
  });

  it("intérieur : dans un bâtiment creux, à 1 m au moins de tout mur", () => {
    const creux = new Set(donnees.creux);
    for (const { p } of parPool("interieur")) {
      expect(p[1]).toBe(0);
      expect(distanceMur(monde, p[0], p[2])).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(donnees.creux.some((i) => creux.has(i) && dedans(p[0], p[2], sc.buildings[i].r))).toBe(true);
    }
  });

  it("toit : y = hauteur du toit le plus haut du point, à 1,5 m du bord", () => {
    for (const { p } of parPool("toit")) {
      expect(p[1]).toBeGreaterThanOrEqual(HAUTEUR_MIN_M);
      expect(solSous(monde, p[0], p[2], 1e4, 0)).toBeCloseTo(p[1], 6);
      expect(distanceMur(monde, p[0], p[2])).toBeGreaterThanOrEqual(1.5 - 1e-6);
    }
  });

  it("façade : à 1,8 m au moins de tout mur, au sol", () => {
    for (const { p } of parPool("facade")) {
      expect(p[1]).toBe(0);
      expect(distanceMur(monde, p[0], p[2])).toBeGreaterThanOrEqual(1.8 - 1e-3);
    }
  });
});
