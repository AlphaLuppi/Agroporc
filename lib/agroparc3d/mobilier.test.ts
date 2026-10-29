import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dansAnneau, pointSegment } from "./geo";
import { LAMPADAIRES_MAX, LAMPADAIRE_ECART_MIN_M, MOBILIER_DISTANCE_CACHETTE_M, mobilier } from "./mobilier";
import type { DecorOsm, SceneData } from "./types";
import { DEMI_LARGEUR } from "./voirie";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const decor = JSON.parse(readFileSync("public/agroparc/decor.json", "utf8")) as DecorOsm;
const data: SceneData = { ...scene, decor };
const m = mobilier(data);
const dansBatiment = (x: number, z: number) => data.buildings.some((b) => (!b.type || b.type === "mur") && dansAnneau(x, z, b.r) && !(b.holes ?? []).some((h) => dansAnneau(x, z, h)));
const pasChaussee = (x: number, z: number, marge: number) => data.roads.every((r) => {
  if (r.c !== "M" && r.c !== "R") return true;
  for (let i = 0; i < r.p.length - 1; i++) if (pointSegment(x, z, r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1]).d < DEMI_LARGEUR[r.c] + marge) return false;
  return true;
});

describe("mobilier : lampadaires", () => {
  it("150 à 350, espacés d'au moins 18 m", () => {
    expect(m.lampadaires.length).toBeGreaterThanOrEqual(150);
    expect(m.lampadaires.length).toBeLessThanOrEqual(LAMPADAIRES_MAX);
    for (let i = 0; i < m.lampadaires.length; i++) for (let j = i + 1; j < m.lampadaires.length; j++) {
      expect(Math.hypot(m.lampadaires[i].x - m.lampadaires[j].x, m.lampadaires[i].z - m.lampadaires[j].z)).toBeGreaterThanOrEqual(LAMPADAIRE_ECART_MIN_M);
    }
  });
  it("jamais sur la chaussée (≥ demi-largeur + 0,6 m de l'axe) ni dans un bâtiment ; le bras tend vers une chaussée", () => {
    for (const l of m.lampadaires) {
      expect(pasChaussee(l.x, l.z, 0.6 - 1e-6), `lampadaire (${l.x.toFixed(1)}, ${l.z.toFixed(1)})`).toBe(true);
      expect(dansBatiment(l.x, l.z)).toBe(false);
      expect(Math.hypot(l.ax, l.az)).toBeCloseTo(1, 6);
    }
  });
  it("les nœuds OSM comptent : au moins 25 lampadaires viennent de decor.json", () => {
    const osm = decor.lampadaires.filter(([x, z]) => m.lampadaires.some((l) => l.x === x && l.z === z));
    expect(osm.length).toBeGreaterThanOrEqual(25);
  });
  it("rien à moins de 3 m d'une cachette quand `eviter` est fourni, rien dans une boîte exclue", () => {
    const cachettes: [number, number][] = m.lampadaires.slice(0, 20).map((l) => [l.x + 1, l.z]);
    const sans = mobilier(data, { eviter: cachettes });
    for (const l of sans.lampadaires) for (const c of cachettes) expect(Math.hypot(l.x - c[0], l.z - c[1])).toBeGreaterThanOrEqual(MOBILIER_DISTANCE_CACHETTE_M);
    for (const p of sans.panneaux) for (const c of cachettes) expect(Math.hypot(p.x - c[0], p.z - c[1])).toBeGreaterThanOrEqual(MOBILIER_DISTANCE_CACHETTE_M);
    const boite = { x0: -1e4, z0: -1e4, x1: 1e4, z1: 1e4 };
    const vide = mobilier(data, { exclure: [boite] });
    expect(vide.lampadaires).toEqual([]);
    expect(vide.panneaux).toEqual([]);
  });
  it("ambiance zombies : aucun mobilier", () => {
    const z = mobilier(data, { ambiance: "zombies" });
    expect(Object.values(z).every((l) => l.length === 0)).toBe(true);
  });
  it("déterministe et sans decor.json (repli sur les règles)", () => {
    expect(mobilier({ ...data, roads: data.roads.map((r) => ({ ...r })) })).toEqual(mobilier({ ...data, roads: data.roads.map((r) => ({ ...r })) }));
    const sans = mobilier({ ...scene, roads: scene.roads.map((r) => ({ ...r })) });
    expect(sans.lampadaires.length).toBeGreaterThan(100);
    expect(sans.bancs).toEqual([]);
  });
});

describe("mobilier : panneaux, abris et le reste", () => {
  it("panneaux : unitaires, hors bâtiment ; les stops et cédez sont posés devant leur ligne d'arrêt", () => {
    expect(m.panneaux.length).toBeGreaterThan(40);
    for (const p of m.panneaux) { expect(Math.hypot(p.ux, p.uz)).toBeCloseTo(1, 6); expect(dansBatiment(p.x, p.z)).toBe(false); }
    const genres = new Set(m.panneaux.map((p) => p.genre));
    for (const g of ["stop", "cedez", "passage", "bus"] as const) expect(genres.has(g), g).toBe(true);
  });
  it("panneaux de passage : posés avant les bandes, du côté droit du sens d'arrivée", () => {
    for (const p of m.panneaux.filter((q) => q.genre === "passage").slice(0, 60)) {
      // un panneau regarde les véhicules qui arrivent : la plaque est de l'autre côté de la voie par rapport à sa destination, jamais au milieu de la chaussée
      expect(pasChaussee(p.x, p.z, 0.5)).toBe(true);
    }
  });
  it("un abri de bus à chaque arrêt de data.busStops (à moins de 6 m, hors doublons)", () => {
    expect(m.abris.length).toBeGreaterThanOrEqual(5);
    for (const [bx, bz] of scene.busStops) {
      expect(m.abris.some((a) => Math.hypot(a.x - bx, a.z - bz) < 8), `arrêt (${bx}, ${bz})`).toBe(true);
    }
  });
  it("bancs, corbeilles, racks à vélos et portails d'OSM sont repris", () => {
    expect(m.bancs.length).toBeGreaterThanOrEqual(6);
    expect(m.corbeilles.length).toBeGreaterThanOrEqual(8);
    expect(m.velos.length).toBeGreaterThanOrEqual(8);
    expect(m.portails.length).toBeGreaterThanOrEqual(4);
  });
});
