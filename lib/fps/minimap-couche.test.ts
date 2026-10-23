import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { ZONE_CARTE } from "./minimap";
import {
  COUCHE, avecAlpha, construirePalette, decouperPolygone, decouperPolyligne, dessinerCouche, dimensionsCouche, type Contexte2D,
} from "./minimap-couche";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const palette = construirePalette(() => "");

/** Faux contexte 2D : compte les appels et mémorise toutes les coordonnées. */
function fauxContexte() {
  const xs: number[] = [], ys: number[] = [];
  const n = { fill: 0, stroke: 0, evenodd: 0, fillRect: 0, beginPath: 0 };
  const ctx: Contexte2D = {
    fillStyle: "", strokeStyle: "", lineWidth: 0,
    beginPath: () => { n.beginPath++; }, closePath: () => {},
    moveTo: (x, y) => { xs.push(x); ys.push(y); }, lineTo: (x, y) => { xs.push(x); ys.push(y); },
    fill: (r) => { n.fill++; if (r === "evenodd") n.evenodd++; }, stroke: () => { n.stroke++; },
    fillRect: (x, y, w, h) => { n.fillRect++; xs.push(x, x + w); ys.push(y, y + h); },
  };
  return { ctx, xs, ys, n };
}

describe("COUCHE et dimensionsCouche", () => {
  it("constantes de la spec", () => {
    expect(COUCHE.pxParM).toBe(1.5);
    expect(COUCHE.pixelsMax).toBe(8_000_000);
  });
  it("échelle de 1,5 px/m sur la vraie scène, bien sous 8 Mpx", () => {
    const d = dimensionsCouche(scene);
    const z = ZONE_CARTE(scene);
    expect(d.echelle).toBe(1.5);
    expect(d.x0).toBe(z.x0);
    expect(d.z0).toBe(z.z0);
    expect(d.largeurPx).toBe(Math.ceil((z.x1 - z.x0) * 1.5));
    expect(d.largeurPx * d.hauteurPx).toBeLessThan(8_000_000);
  });
  it("échelle plafonnée à 8 Mpx pour une scène énorme", () => {
    const grosse = { ...scene, buildings: [{ h: 5, r: [[-5000, -5000], [5000, -5000], [5000, 5000], [-5000, 5000]] as Vec2[], c: [0, 0] as Vec2 }] } as SceneData;
    const d = dimensionsCouche(grosse);
    expect(d.echelle).toBeLessThan(1.5);
    expect(d.largeurPx * d.hauteurPx).toBeLessThanOrEqual(8_000_000 * 1.01);
  });
  it("une résolution demandée plus basse est respectée, jamais plus haute que 1,5", () => {
    expect(dimensionsCouche(scene, 1).echelle).toBe(1);
    expect(dimensionsCouche(scene, 9).echelle).toBe(1.5);
  });
});

describe("dessinerCouche (faux contexte)", () => {
  const dim = dimensionsCouche(scene);
  it("un remplissage et un contour par bâtiment (142), cours en trous évenodd", () => {
    const { ctx, n } = fauxContexte();
    dessinerCouche(scene, palette, ctx, dim);
    expect(scene.buildings).toHaveLength(142);
    expect(n.evenodd).toBe(142);
    // fills : plans d'eau (ceux qui touchent la zone) + 142 bâtiments + 8 POI (losanges)
    const autres = n.fill - n.evenodd;
    expect(autres).toBeGreaterThanOrEqual(scene.pois.length);
    expect(autres).toBeLessThanOrEqual(scene.water.length + scene.pois.length);
    // strokes : un par cours d'eau + parkings + 3 groupes de routes + 142 bâtiments
    expect(n.stroke).toBe(scene.wlines.length + scene.parkings.length + 3 + 142);
  });
  it("aucune coordonnée hors du canvas, même pour les routes et l'eau qui dépassent la zone", () => {
    const { ctx, xs, ys } = fauxContexte();
    dessinerCouche(scene, palette, ctx, dim);
    expect(xs.length).toBeGreaterThan(1000);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(-1e-6); expect(x).toBeLessThanOrEqual(dim.largeurPx + 1e-6); }
    for (const y of ys) { expect(y).toBeGreaterThanOrEqual(-1e-6); expect(y).toBeLessThanOrEqual(dim.hauteurPx + 1e-6); }
  });
  it("sans chemins piétons : moins de segments, un tracé de route en moins", () => {
    const a = fauxContexte(), b = fauxContexte();
    dessinerCouche(scene, palette, a.ctx, dim, { avecPietons: true });
    dessinerCouche(scene, palette, b.ctx, dim, { avecPietons: false });
    expect(b.xs.length).toBeLessThan(a.xs.length);
    expect(b.n.stroke).toBe(a.n.stroke - 1);
  });
  it("les bâtiments sont dessinés avec la couleur de la palette", () => {
    const { ctx } = fauxContexte();
    const vus: string[] = [];
    let fs: Contexte2D["fillStyle"] = "";
    Object.defineProperty(ctx, "fillStyle", { get: () => fs, set: (v) => { fs = v; vus.push(String(v)); } });
    dessinerCouche(scene, palette, ctx, dim);
    expect(vus).toContain(palette.batimentFond);
    expect(vus).toContain(palette.poi);
  });
});

describe("découpe au rectangle", () => {
  const r = { x0: 0, y0: 0, x1: 100, y1: 100 };
  it("polyligne : segment entièrement dehors supprimé, traversant coupé aux bords", () => {
    expect(decouperPolyligne([[-50, -50], [-10, -10]], r)).toEqual([]);
    const m = decouperPolyligne([[-50, 50], [150, 50]], r);
    expect(m).toEqual([[[0, 50], [100, 50]]]);
  });
  it("polyligne : un trajet qui sort puis rentre donne deux morceaux", () => {
    const m = decouperPolyligne([[10, 50], [200, 50], [200, 80], [60, 80]], r);
    expect(m).toHaveLength(2);
    expect(m[0][0]).toEqual([10, 50]);
    expect(m[0][m[0].length - 1][0]).toBeCloseTo(100, 9);
    expect(m[1][m[1].length - 1]).toEqual([60, 80]);
  });
  it("polyligne : un trajet entièrement dedans reste continu", () => {
    expect(decouperPolyligne([[10, 10], [20, 30], [40, 30]], r)).toEqual([[[10, 10], [20, 30], [40, 30]]]);
  });
  it("polygone : découpé, tous les points dans le rectangle ; entièrement dehors → vide", () => {
    const d = decouperPolygone([[-50, -50], [150, -50], [150, 50], [-50, 50]], r);
    expect(d.length).toBeGreaterThanOrEqual(4);
    for (const [x, y] of d) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(100); }
    expect(decouperPolygone([[200, 200], [300, 200], [300, 300]], r)).toEqual([]);
  });
});

describe("palette", () => {
  it("avecAlpha convertit l'hexadécimal, laisse le reste", () => {
    expect(avecAlpha("#9be9ff", 0.14)).toBe("rgba(155, 233, 255, 0.14)");
    expect(avecAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(avecAlpha("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
  });
  it("construirePalette lit les tokens du HUD, avec un repli si le CSS ne les définit pas", () => {
    const lus: string[] = [];
    const p = construirePalette((j) => { lus.push(j); return j === "--ag-amber" ? " #112233 " : ""; });
    expect(p.poi).toBe("#112233");
    expect(p.sol).toBe("#04060a");
    expect(p.eau).toBe("rgba(155, 233, 255, 0.14)");
    expect(lus).toContain("--ag-cadre");
  });
});
