import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import {
  batimentsDetruits, batimentsSous, construireMonde, detruireBatiment, lancerRayon, normaleImpact, releverBatiment, releverBatiments, resoudre, solSous,
} from "./collision";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number, h = 10): Building => ({ h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const monde = () => construireMonde({ ...scene, buildings: [rect(-500, -500, -499, -499), rect(499, 499, 500, 500), rect(0, 0, 10, 10, 8)], pois: [] } as SceneData);

describe("bâtiments destructibles", () => {
  it("un bâtiment détruit n'a plus ni mur, ni toit, ni ligne de vue bloquée ; il se relève", () => {
    const m = monde();
    expect(batimentsSous(m, 5, 5)).toEqual([2]);
    expect(resoudre(m, [-0.2, 0, 5], 0.4, 1.8).contacts.length).toBeGreaterThan(0);
    expect(solSous(m, 5, 5, 9)).toBe(8);
    expect(lancerRayon(m, [-5, 1, 5], [1, 0, 0], 20)).toBeCloseTo(5, 6);
    expect(detruireBatiment(m, 2)).toBe(true);
    expect(detruireBatiment(m, 2)).toBe(false);
    expect(batimentsDetruits(m)).toEqual([2]);
    expect(batimentsSous(m, 5, 5)).toEqual([]);
    expect(resoudre(m, [-0.2, 0, 5], 0.4, 1.8).contacts).toHaveLength(0);
    expect(solSous(m, 5, 5, 9)).toBe(0);
    expect(lancerRayon(m, [-5, 1, 5], [1, 0, 0], 20)).toBe(Infinity);
    releverBatiment(m, 2);
    expect(batimentsSous(m, 5, 5)).toEqual([2]);
    detruireBatiment(m, 2);
    releverBatiments(m);
    expect(batimentsDetruits(m)).toEqual([]);
  });

  it("batimentsSous avec une marge attrape un bâtiment voisin", () => {
    const m = monde();
    expect(batimentsSous(m, -1, 5)).toEqual([]);
    expect(batimentsSous(m, -1, 5, 1.5)).toEqual([2]);
  });

  it("normale d'impact : mur tourné vers le tireur, toit et sol vers le haut", () => {
    const m = monde();
    expect(normaleImpact(m, [0, 3, 5], [-10, 2, 5])).toEqual([-1, 0, 0]);
    expect(normaleImpact(m, [10, 3, 5], [20, 2, 5])).toEqual([1, 0, 0]);
    expect(normaleImpact(m, [5, 8, 5], [5, 20, 5])).toEqual([0, 1, 0]);
    expect(normaleImpact(m, [30, 0, 30], [20, 2, 20])).toEqual([0, 1, 0]);
  });
});
