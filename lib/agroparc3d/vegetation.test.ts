import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dansAnneau, pointSegment } from "./geo";
import type { DecorOsm, SceneData } from "./types";
import { ARBUSTES_MAX, DISTANCE_CACHETTE_M, TYPES_ARBRE, arbustes, classerArbres, haies, pelouses, trianguler } from "./vegetation";
import { DEMI_LARGEUR } from "./voirie";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const decor = JSON.parse(readFileSync("public/agroparc/decor.json", "utf8")) as DecorOsm;
const data: SceneData = { ...scene, decor };
const dansBatiment = (x: number, z: number) => data.buildings.some((b) => (!b.type || b.type === "mur") && dansAnneau(x, z, b.r) && !(b.holes ?? []).some((h) => dansAnneau(x, z, h)));
const surChaussee = (x: number, z: number, marge = 0) => data.roads.some((r) => {
  if (r.c !== "M" && r.c !== "R") return false;
  for (let i = 0; i < r.p.length - 1; i++) if (pointSegment(x, z, r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1]).d < DEMI_LARGEUR[r.c] - marge) return true;
  return false;
});

describe("classerArbres", () => {
  const arbres = classerArbres(data);

  it("un élément par arbre de scene.trees, même ordre, même position", () => {
    expect(arbres.length).toBe(data.trees.length);
    arbres.forEach((a, i) => { expect(a.x).toBe(data.trees[i][0]); expect(a.z).toBe(data.trees[i][1]); });
  });

  it("seul l'arbre planté dans un bâtiment est retiré du rendu (1 sur 788)", () => {
    expect(arbres.filter((a) => !a.visible).length).toBe(1);
    for (const a of arbres) expect(a.visible).toBe(!dansBatiment(a.x, a.z));
  });

  it("chaque type est représenté (au moins 3 %), échelle 0,75 à 1,3, teinte et rotation bornées", () => {
    for (const t of TYPES_ARBRE) expect(arbres.filter((a) => a.type === t).length / arbres.length, t).toBeGreaterThanOrEqual(0.03);
    for (const a of arbres) {
      expect(a.echelle).toBeGreaterThanOrEqual(0.75);
      expect(a.echelle).toBeLessThanOrEqual(1.3);
      expect(a.teinte).toBeGreaterThanOrEqual(0.85);
      expect(a.teinte).toBeLessThanOrEqual(1.15);
      expect(a.rot).toBeGreaterThanOrEqual(0);
      expect(a.rot).toBeLessThan(Math.PI * 2);
    }
  });

  it("les platanes sont près d'une voie M ou R, et un tiers environ est d'automne", () => {
    const pl = arbres.filter((a) => a.type === "platane");
    expect(pl.length).toBeGreaterThan(40);
    for (const a of pl) {
      let d = Infinity;
      for (const r of data.roads) {
        if (r.c !== "M" && r.c !== "R") continue;
        for (let i = 0; i < r.p.length - 1; i++) d = Math.min(d, pointSegment(a.x, a.z, r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1]).d - DEMI_LARGEUR[r.c]);
      }
      expect(d).toBeLessThanOrEqual(8.001);
    }
    const a = pl.filter((x) => x.automne).length / pl.length;
    expect(a).toBeGreaterThan(0.15);
    expect(a).toBeLessThan(0.55);
    expect(arbres.filter((x) => x.type !== "platane").every((x) => !x.automne)).toBe(true);
  });

  it("les arbres d'un bois OSM sont des pins", () => {
    let dans = 0;
    for (const a of arbres) {
      if (decor.bois.some((r) => dansAnneau(a.x, a.z, r))) { dans++; expect(a.type).toBe("pin"); }
    }
    expect(dans).toBeGreaterThan(0);
  });

  it("déterministe, mémoïsé, et sans decor.json (repli sans erreur)", () => {
    expect(classerArbres(data)).toBe(arbres);
    const sans = classerArbres({ ...scene, trees: scene.trees.map((t) => [...t] as [number, number]) });
    expect(sans.length).toBe(arbres.length);
    const a = classerArbres({ ...data, trees: scene.trees.map((t) => [...t] as [number, number]) });
    const b = classerArbres({ ...data, trees: scene.trees.map((t) => [...t] as [number, number]) });
    expect(a).toEqual(b);
  });
});

describe("haies", () => {
  const h = haies(data);
  it("des tronçons, jamais dans un bâtiment ni sur une chaussée", () => {
    expect(h.length / 4).toBeGreaterThan(1500);
    for (let i = 0; i < h.length; i += 4) {
      expect(dansBatiment(h[i], h[i + 1])).toBe(false);
      expect(surChaussee(h[i], h[i + 1], -0.3)).toBe(false);
      expect(Math.hypot(h[i + 2], h[i + 3])).toBeCloseTo(1, 6);
    }
  });
  it("rien en qualité basse, rien sans decor.json, rien dans une boîte exclue ni près d'une cachette", () => {
    expect(haies(data, { qualite: "basse" })).toEqual([]);
    expect(haies(scene)).toEqual([]);
    const cache: [number, number] = [h[0], h[1]];
    const sans = haies(data, { eviter: [cache] });
    expect(sans.length).toBeLessThan(h.length);
    for (let i = 0; i < sans.length; i += 4) expect(Math.hypot(sans[i] - cache[0], sans[i + 1] - cache[1])).toBeGreaterThanOrEqual(DISTANCE_CACHETTE_M);
    const boite = { x0: -1e4, z0: -1e4, x1: 1e4, z1: 1e4 };
    expect(haies(data, { exclure: [boite] })).toEqual([]);
  });
});

describe("pelouses", () => {
  const p = pelouses(data);
  it("triangles hors bâtiments et hors chaussée", () => {
    expect(p.length / 6).toBeGreaterThan(800);
    for (let i = 0; i < p.length; i += 6) {
      const x = (p[i] + p[i + 2] + p[i + 4]) / 3, z = (p[i + 1] + p[i + 3] + p[i + 5]) / 3;
      expect(dansBatiment(x, z)).toBe(false);
      expect(surChaussee(x, z, -0.3)).toBe(false);
    }
  });
  it("l'îlot du rond-point est une pelouse ; rien dans une boîte exclue", () => {
    const t = pelouses({ ...scene, decor: undefined });
    expect(t.length).toBeGreaterThan(0); // sans OSM : l'îlot seul
    expect(pelouses(data, { exclure: [{ x0: -1e4, z0: -1e4, x1: 1e4, z1: 1e4 }] })).toEqual([]);
  });
  it("trianguler : un carré rend 2 triangles de même aire, un anneau concave aussi", () => {
    const aire = (r: [number, number][], t: number[]) => { let a = 0; for (let i = 0; i < t.length; i += 3) { const A = r[t[i]], B = r[t[i + 1]], C = r[t[i + 2]]; a += Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2; } return a; };
    const carre: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(trianguler(carre).length / 3).toBe(2);
    expect(aire(carre, trianguler(carre))).toBeCloseTo(16, 6);
    const L: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    expect(trianguler(L).length / 3).toBe(4);
    expect(aire(L, trianguler(L))).toBeCloseTo(12, 6);
    const horaire = [...L].reverse();
    expect(aire(horaire, trianguler(horaire))).toBeCloseTo(12, 6);
  });
});

describe("arbustes", () => {
  const a = arbustes(data);
  it("400 au plus, un massif sur l'îlot du rond-point, hors bâtiments, écartés de 3 m", () => {
    expect(a.length / 2).toBeLessThanOrEqual(ARBUSTES_MAX);
    expect(a.length / 2).toBeGreaterThan(50);
    const rond = { c: [28.4, 2.5], r: 14.7 };
    const surIlot = Array.from({ length: a.length / 2 }, (_, i) => Math.hypot(a[i * 2] - rond.c[0], a[i * 2 + 1] - rond.c[1])).filter((d) => d < rond.r);
    expect(surIlot.length).toBeGreaterThan(3);
    for (let i = 0; i < a.length; i += 2) expect(dansBatiment(a[i], a[i + 1]) && Math.hypot(a[i] - rond.c[0], a[i + 1] - rond.c[1]) > rond.r).toBe(false);
  });
  it("rien en qualité basse ; rien à moins de 3 m d'une cachette", () => {
    expect(arbustes(data, { qualite: "basse" })).toEqual([]);
    const cache: [number, number] = [a[0], a[1]];
    const sans = arbustes(data, { eviter: [cache] });
    for (let i = 0; i < sans.length; i += 2) expect(Math.hypot(sans[i] - cache[0], sans[i + 1] - cache[1])).toBeGreaterThanOrEqual(DISTANCE_CACHETTE_M);
  });
});
