import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lireDecor } from "./decor-osm";
import type { SceneData, Vec2 } from "./types";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const brut = JSON.parse(readFileSync("public/agroparc/decor.json", "utf8")) as unknown;
const decor = lireDecor(brut)!;

/** Boîte de `build_scene.py` (TREE_BOX) : bornes des bâtiments + 55 m. */
const boite = (() => {
  const xs = scene.buildings.flatMap((b) => b.r.map((p) => p[0])), zs = scene.buildings.flatMap((b) => b.r.map((p) => p[1]));
  return { x0: Math.min(...xs) - 55, x1: Math.max(...xs) + 55, z0: Math.min(...zs) - 55, z1: Math.max(...zs) + 55 };
})();
const dedans = (p: Vec2) => p[0] >= boite.x0 && p[0] <= boite.x1 && p[1] >= boite.z0 && p[1] <= boite.z1;

describe("decor.json (OpenStreetMap)", () => {
  it("passe la lecture tolérante et pèse de 30 à 60 Ko", () => {
    expect(decor).toBeDefined();
    const ko = statSync("public/agroparc/decor.json").size / 1024;
    expect(ko).toBeGreaterThan(30);
    expect(ko).toBeLessThan(60);
  });

  it("comptes dans des plages larges (résistent aux évolutions d'OSM)", () => {
    const n = (a: unknown[]) => a.length;
    expect(n(decor.lampadaires)).toBeGreaterThanOrEqual(30);
    expect(n(decor.lampadaires)).toBeLessThanOrEqual(60);
    expect(n(decor.passages)).toBeGreaterThanOrEqual(25);
    expect(n(decor.passages)).toBeLessThanOrEqual(50);
    expect(n(decor.haies)).toBeGreaterThanOrEqual(60);
    expect(n(decor.haies)).toBeLessThanOrEqual(110);
    expect(n(decor.pelouses)).toBeGreaterThanOrEqual(120);
    expect(n(decor.pelouses)).toBeLessThanOrEqual(200);
    expect(n(decor.stops) + n(decor.cedez)).toBeGreaterThanOrEqual(6);
    expect(n(decor.signaux)).toBe(0);
  });

  it("anneaux de 3 points au moins, lignes de 2, au moins un sommet dans la boîte de la scène", () => {
    for (const p of decor.pelouses) { expect(p.r.length).toBeGreaterThanOrEqual(3); expect(p.r.some(dedans)).toBe(true); }
    for (const r of decor.bois) { expect(r.length).toBeGreaterThanOrEqual(3); expect(r.some(dedans)).toBe(true); }
    for (const l of [...decor.haies, ...decor.alignements]) { expect(l.length).toBeGreaterThanOrEqual(2); expect(l.some(dedans)).toBe(true); }
  });

  it("les nœuds ponctuels sont dans la boîte des arbres de scene.json", () => {
    for (const k of ["lampadaires", "passages", "stops", "cedez", "signaux", "bancs", "corbeilles", "velos", "portails"] as const) {
      for (const p of decor[k]) expect(dedans(p)).toBe(true);
    }
  });

  it("coordonnées à 0,1 m", () => {
    for (const p of [...decor.lampadaires, ...decor.passages, ...decor.haies.flat()]) {
      expect(Math.abs(p[0] * 10 - Math.round(p[0] * 10))).toBeLessThan(1e-6);
      expect(Math.abs(p[1] * 10 - Math.round(p[1] * 10))).toBeLessThan(1e-6);
    }
  });
});

describe("lireDecor : lecture tolérante", () => {
  it("rejette un fichier absent, d'une autre version ou mal formé", () => {
    expect(lireDecor(null)).toBeUndefined();
    expect(lireDecor(undefined)).toBeUndefined();
    expect(lireDecor({})).toBeUndefined();
    expect(lireDecor({ ...(brut as object), v: 2 })).toBeUndefined();
    expect(lireDecor({ ...(brut as object), lampadaires: [[1, "x"]] })).toBeUndefined();
    expect(lireDecor({ ...(brut as object), pelouses: [{ k: "beton", r: [[0, 0], [1, 0], [1, 1]] }] })).toBeUndefined();
    expect(lireDecor({ ...(brut as object), haies: [[[0, 0]]] })).toBeUndefined();
  });
});
