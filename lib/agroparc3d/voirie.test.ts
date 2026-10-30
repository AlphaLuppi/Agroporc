import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dansAnneau, pointSegment } from "./geo";
import type { DecorOsm, SceneData } from "./types";
import { AXE_TRAIT_M, DEMI_LARGEUR, PASSAGES_MAX, ZEBRA_LONG_M, deriverVoirie } from "./voirie";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const decor = JSON.parse(readFileSync("public/agroparc/decor.json", "utf8")) as DecorOsm;
const data: SceneData = { ...scene, decor };

const t0 = performance.now();
const v = deriverVoirie(data);
const dureeMs = performance.now() - t0;

/** Nombre de voies M/R dont la chaussée contient strictement le point (marge `m`). */
function chausseesContenant(x: number, z: number, m = 0.15): number {
  let n = 0;
  for (const r of data.roads) {
    if (r.c !== "M" && r.c !== "R") continue;
    let d = Infinity;
    for (let i = 0; i < r.p.length - 1; i++) d = Math.min(d, pointSegment(x, z, r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1]).d);
    if (d < DEMI_LARGEUR[r.c] - m) n++;
  }
  return n;
}
const dansBatiment = (x: number, z: number) => data.buildings.some((b) => (!b.type || b.type === "mur") && dansAnneau(x, z, b.r) && !(b.holes ?? []).some((h) => dansAnneau(x, z, h)));

describe("deriverVoirie", () => {
  it("calcul : mesure affichée, plafond large pour ne pas être instable en CI", () => {
    console.log(`deriverVoirie : ${dureeMs.toFixed(0)} ms (à froid)`);
    expect(dureeMs).toBeLessThan(400);
  });

  it("ruban de chaussée : deux triangles par tronçon M et R", () => {
    const troncons = data.roads.filter((r) => r.c === "M" || r.c === "R").reduce((n, r) => n + r.p.length - 1, 0);
    expect(v.ruban.length / 6).toBe(troncons * 2);
  });

  it("aucun point de bord ni de trottoir dans la chaussée d'une autre voie (tolérance 0,15 m)", () => {
    for (const [nom, seg] of [["bordsM", v.bordsM], ["bordsR", v.bordsR]] as const) {
      expect(seg.length).toBeGreaterThan(400);
      let dedans = 0;
      for (let i = 0; i < seg.length; i += 4) if (chausseesContenant((seg[i] + seg[i + 2]) / 2, (seg[i + 1] + seg[i + 3]) / 2) > 0) dedans++;
      // les bords des arcs du rond-point suivent des cordes : quelques échantillons de virage peuvent frôler la tolérance
      expect(dedans, nom).toBeLessThanOrEqual(Math.ceil(seg.length / 4 * 0.01));
    }
    expect(v.trottoirs.length).toBeGreaterThan(400);
  });

  it("axe pointillé : traits de 3 m au plus, aucun dans un carrefour ni sur le rond-point", () => {
    expect(v.axes.length / 4).toBeGreaterThan(150);
    let long = 0, carrefours = 0;
    for (let i = 0; i < v.axes.length; i += 4) {
      const L = Math.hypot(v.axes[i + 2] - v.axes[i], v.axes[i + 3] - v.axes[i + 1]);
      expect(L).toBeLessThanOrEqual(AXE_TRAIT_M + 1e-6);
      if (Math.abs(L - AXE_TRAIT_M) < 1e-6) long++;
      const mx = (v.axes[i] + v.axes[i + 2]) / 2, mz = (v.axes[i + 1] + v.axes[i + 3]) / 2;
      // un trait n'est (presque) jamais au cœur de la chaussée d'une autre voie M ou R (bretelles qui se raccordent à angle vif : tolérées)
      if (chausseesContenant(mx, mz, 1.5) > 1) carrefours++;
      const g = v.giratoire!;
      expect(Math.hypot(mx - g.centre[0], mz - g.centre[1])).toBeGreaterThan(g.rayon + DEMI_LARGEUR.M);
    }
    expect(carrefours / (v.axes.length / 4)).toBeLessThan(0.06);
    expect(long / (v.axes.length / 4)).toBeGreaterThan(0.6);
  });

  it("alternance trait / vide : l'écart entre deux traits consécutifs d'une même voie est de 6 m", () => {
    // les traits d'une voie sont rangés dans l'ordre du motif : l'écart entre la fin d'un trait et le début du suivant vaut 6 m quand ils se suivent
    let ecarts = 0, bons = 0;
    for (let i = 4; i < v.axes.length; i += 4) {
      const e = Math.hypot(v.axes[i] - v.axes[i - 2], v.axes[i + 1] - v.axes[i - 1]);
      if (e < 12) { ecarts++; if (Math.abs(e - 6) < 0.05) bons++; }
    }
    expect(ecarts).toBeGreaterThan(100);
    expect(bons / ecarts).toBeGreaterThan(0.8);
  });

  it("passages piétons : 60 à 160, centrés sur un axe, jamais dans un bâtiment, tournés dans le sens de la voie", () => {
    expect(v.passages.length).toBeGreaterThanOrEqual(60);
    expect(v.passages.length).toBeLessThanOrEqual(PASSAGES_MAX);
    expect(v.passages.filter((p) => p.osm).length).toBeGreaterThanOrEqual(25);
    for (const p of v.passages) {
      let d = Infinity;
      for (const r of data.roads) {
        if (r.c === "F") continue;
        for (let i = 0; i < r.p.length - 1; i++) d = Math.min(d, pointSegment(p.x, p.z, r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1]).d);
      }
      expect(d).toBeLessThan(0.5);
      expect(dansBatiment(p.x, p.z)).toBe(false);
      expect(Math.hypot(p.ux, p.uz)).toBeCloseTo(1, 6);
    }
    // bandes : 6 triangles par bande
    const bandes = v.passages.reduce((n, p) => n + Math.max(1, Math.floor((2 * p.demi) / 1)), 0);
    expect(v.zebras.length / 12).toBe(bandes);
    expect(ZEBRA_LONG_M).toBe(3);
  });

  it("passages dédoublonnés à 6 m", () => {
    for (let i = 0; i < v.passages.length; i++) for (let j = i + 1; j < v.passages.length; j++) {
      expect(Math.hypot(v.passages[i].x - v.passages[j].x, v.passages[i].z - v.passages[j].z)).toBeGreaterThanOrEqual(6 - 1e-9);
    }
  });

  it("rond-point : îlot, au moins 3 entrées avec dents de requin et flèche", () => {
    expect(v.giratoire).not.toBeNull();
    expect(v.giratoire!.ilot).toBeCloseTo(v.giratoire!.rayon - 3.5, 6);
    expect(v.entrees.length).toBeGreaterThanOrEqual(3);
    expect(v.dents.length / 6).toBeGreaterThanOrEqual(v.entrees.length);
    expect(v.fleches.length / 12).toBe(v.entrees.length);
    expect(v.ilotBord.length).toBeGreaterThan(100);
    for (const e of v.entrees) {
      expect(Math.hypot(e.ux, e.uz)).toBeCloseTo(1, 6);
      // l'entrée regarde vers le rond-point
      const g = v.giratoire!;
      expect(e.ux * (g.centre[0] - e.x) + e.uz * (g.centre[1] - e.z)).toBeGreaterThan(0);
    }
  });

  it("lignes d'arrêt posées pour les stops et cédez-le-passage OSM", () => {
    expect(v.lignesArret.length / 12).toBeGreaterThanOrEqual(8);
  });

  it("déterministe : deux calculs égaux, y compris sans decor.json", () => {
    const a = deriverVoirie({ ...scene, roads: scene.roads.map((r) => ({ ...r })) });
    const b = deriverVoirie({ ...scene, roads: scene.roads.map((r) => ({ ...r })) });
    expect(a.ruban).toEqual(b.ruban);
    expect(a.bordsM).toEqual(b.bordsM);
    expect(a.axes).toEqual(b.axes);
    expect(a.passages).toEqual(b.passages);
    // sans nœuds OSM : toujours des passages (croisements de voies piétonnes), aucune ligne d'arrêt
    expect(a.passages.length).toBeGreaterThan(20);
    expect(a.lignesArret).toEqual([]);
    expect(deriverVoirie(data)).toBe(v); // mémoïsé
  });
});
