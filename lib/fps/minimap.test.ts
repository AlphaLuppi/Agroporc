import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import {
  ANCRE_NORD, ANCRE_REGARD, BISEAU_U, Cadence, TAILLE_CARTE_U, ZONE_CARTE, arrondi, capEcran, capEcranObjet, chevronBord, estDansCarte, matriceCouche,
  nomCourtPoi, nomZone, polygoneCadre, positionNord, projeter, rayonAuto, tailleEffective, versCarte, versZone, type VueCarte,
} from "./minimap";
import { ROND_POINT, ZONE_APPARITION, positionElsa } from "./zones";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const vue = (surcharge: Partial<VueCarte> = {}): VueCarte => ({ px: 100, pz: 50, psi: 0, taille: 200, rayonM: 100, mode: "regard", ...surcharge });

describe("constantes de la spec HUD §4", () => {
  it("ancres et tailles", () => {
    expect(ANCRE_REGARD).toBe(0.58);
    expect(ANCRE_NORD).toBe(0.5);
    expect(TAILLE_CARTE_U).toEqual({ s: 208, m: 264, l: 320 });
  });
  it("sous 700 px de hauteur, taille S d'office", () => {
    expect(tailleEffective("l", 699)).toBe("s");
    expect(tailleEffective("l", 700)).toBe("l");
    expect(tailleEffective("m", 1080)).toBe("m");
  });
});

describe("versCarte : mode regard", () => {
  it("le joueur est à 58 % de la hauteur, centré en largeur", () => {
    const p = versCarte(vue(), 100, 50);
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(0.58 * 200, 9);
  });
  it("ψ = 0 : un point au nord (−z) est au-dessus du joueur, un point à l'est à sa droite", () => {
    const nord = versCarte(vue(), 100, 50 - 40);
    expect(nord.x).toBeCloseTo(100, 9);
    expect(nord.y).toBeCloseTo(0.58 * 200 - 40 * 1, 9); // k = 100 px / 100 m = 1 px/m
    const est = versCarte(vue(), 100 + 30, 50);
    expect(est.x).toBeCloseTo(130, 9);
    expect(est.y).toBeCloseTo(116, 9);
  });
  it("ψ = π/2 (regard vers l'ouest, −x) : un point à l'ouest est au-dessus, le nord est à droite", () => {
    const v = vue({ psi: Math.PI / 2 });
    const ouest = versCarte(v, 100 - 40, 50);
    expect(ouest.x).toBeCloseTo(100, 9);
    expect(ouest.y).toBeCloseTo(116 - 40, 9);
    const nord = versCarte(v, 100, 50 - 40);
    expect(nord.x).toBeCloseTo(140, 9);
    expect(nord.y).toBeCloseTo(116, 9);
  });
  it("devant (−sinψ, −cosψ) est toujours vers le haut de l'écran, pour tout lacet", () => {
    for (const psi of [0.3, 1.2, 2.5, -1.9, Math.PI]) {
      const v = vue({ psi });
      const p = versCarte(v, v.px - Math.sin(psi) * 25, v.pz - Math.cos(psi) * 25);
      expect(p.x).toBeCloseTo(100, 9);
      expect(p.y).toBeCloseTo(116 - 25, 9);
    }
  });
});

describe("versCarte : mode nord", () => {
  it("le joueur est au centre et la rotation est ignorée", () => {
    const v = vue({ mode: "nord", psi: 1.7 });
    expect(versCarte(v, 100, 50)).toEqual({ x: 100, y: 100 });
    const p = versCarte(v, 100 + 20, 50 - 30);
    expect(p.x).toBeCloseTo(120, 9);
    expect(p.y).toBeCloseTo(70, 9);
  });
  it("`projeter` écrit le même résultat sans allocation", () => {
    const out = { x: 0, y: 0 };
    const v = vue({ psi: 0.8 });
    projeter(v, 12, -34, out);
    expect(out).toEqual(versCarte(v, 12, -34));
  });
});

describe("rayonAuto", () => {
  it("borné entre ×1 et ×1,6", () => {
    expect(rayonAuto(100, 0)).toBe(100);
    expect(rayonAuto(100, -5)).toBe(100);
    expect(rayonAuto(100, 12)).toBeCloseTo(130, 9);
    expect(rayonAuto(100, 24)).toBeCloseTo(160, 9);
    expect(rayonAuto(100, 80)).toBeCloseTo(160, 9);
    expect(rayonAuto(60, Number.NaN)).toBe(60);
  });
});

describe("estDansCarte et chevronBord", () => {
  it("estDansCarte respecte la marge", () => {
    expect(estDansCarte(100, 100, 200, 10)).toBe(true);
    expect(estDansCarte(9, 100, 200, 10)).toBe(false);
    expect(estDansCarte(100, 191, 200, 10)).toBe(false);
    expect(estDansCarte(10, 190, 200, 10)).toBe(true);
  });
  it("un point à droite : collé au bord droit (à la marge), chevron vers la droite", () => {
    const c = chevronBord(500, 100, 200, 10);
    expect(c.x).toBeCloseTo(190, 9);
    expect(c.y).toBeCloseTo(100, 9);
    expect(c.angle).toBeCloseTo(Math.PI / 2, 9);
  });
  it("un point au-dessus : collé en haut, chevron vers le haut ; en dessous : vers le bas", () => {
    const h = chevronBord(100, -400, 200, 10);
    expect(h.y).toBeCloseTo(10, 9);
    expect(h.angle).toBeCloseTo(0, 9);
    const b = chevronBord(100, 900, 200, 10);
    expect(b.y).toBeCloseTo(190, 9);
    expect(Math.abs(b.angle)).toBeCloseTo(Math.PI, 9);
  });
  it("en diagonale : sur le rayon joueur → cible, jamais au-delà de la marge", () => {
    const c = chevronBord(900, -700, 200, 10, 0.58);
    expect(c.x).toBeLessThanOrEqual(190 + 1e-9);
    expect(c.y).toBeGreaterThanOrEqual(10 - 1e-9);
    // colinéaire avec (cible − joueur)
    const ox = 100, oy = 116;
    const vx = 900 - ox, vy = -700 - oy;
    expect((c.x - ox) * vy - (c.y - oy) * vx).toBeCloseTo(0, 6);
    expect(c.angle).toBeCloseTo(Math.atan2(vx, -vy), 9);
  });
  it("un point déjà dans le cadre est rendu tel quel", () => {
    const c = chevronBord(50, 60, 200, 10);
    expect(c.x).toBe(50);
    expect(c.y).toBe(60);
  });
});

describe("caps d'écran", () => {
  it("capEcran : 0 en mode regard, −ψ en mode nord (triangle vers (−sinψ, −cosψ))", () => {
    expect(capEcran("regard", 1.1)).toBe(0);
    const th = capEcran("nord", 1.1);
    expect(Math.sin(th)).toBeCloseTo(-Math.sin(1.1), 9);
    expect(-Math.cos(th)).toBeCloseTo(-Math.cos(1.1), 9);
  });
  it("capEcranObjet : l'orientation à l'écran suit la carte (direction de l'objet projetée)", () => {
    const v = vue({ psi: 0.9 });
    for (const cap of [0, 1, -2.2]) {
      const th = capEcranObjet("regard", v.psi, cap);
      // un point 10 m devant l'objet, projeté, doit se trouver dans la direction (sin θ, −cos θ) de l'objet
      const a = versCarte(v, 20, 30), b = versCarte(v, 20 - Math.sin(cap) * 10, 30 - Math.cos(cap) * 10);
      const n = Math.hypot(b.x - a.x, b.y - a.y);
      expect((b.x - a.x) / n).toBeCloseTo(Math.sin(th), 9);
      expect((b.y - a.y) / n).toBeCloseTo(-Math.cos(th), 9);
    }
  });
  it("positionNord : en haut en mode nord ; orbite avec le lacet en mode regard, toujours dans le carré", () => {
    const n = positionNord("nord", 2, 200);
    expect(n.x).toBeCloseTo(100, 9);
    expect(n.y).toBeCloseTo(100 - 0.46 * 200, 9);
    const r0 = positionNord("regard", 0, 200);
    expect(r0).toEqual(n);
    // regard vers l'ouest (ψ = π/2) : le nord est à droite
    const r = positionNord("regard", Math.PI / 2, 200);
    expect(r.x).toBeCloseTo(100 + 0.46 * 200, 9);
    expect(r.y).toBeCloseTo(100, 9);
    for (const psi of [0.4, 2.2, 4, -1]) expect(estDansCarte(positionNord("regard", psi, 200).x, positionNord("regard", psi, 200).y, 200, 0)).toBe(true);
    // et cohérent avec la projection d'un point lointain au nord
    const v = vue({ psi: 0.7 });
    const p = versCarte(v, v.px, v.pz - 1000);
    const o = positionNord("regard", 0.7, 200);
    const dir = { x: p.x - 100, y: p.y - 116 }, nn = Math.hypot(dir.x, dir.y);
    expect((o.x - 100) / (0.46 * 200)).toBeCloseTo(dir.x / nn, 6);
    expect((o.y - 100) / (0.46 * 200)).toBeCloseTo(dir.y / nn, 6);
  });
});

describe("arrondi", () => {
  it("arrondit au pas (échos à 8 m)", () => {
    expect(arrondi(13, 8)).toBe(16);
    expect(arrondi(11.9, 8)).toBe(8);
    expect(arrondi(-3, 8)).toBe(0);
    expect(Object.is(arrondi(-0.3, 8), 0)).toBe(true);
    expect(arrondi(-13, 8)).toBe(-16);
    expect(arrondi(5, 0)).toBe(5);
  });
});

describe("ZONE_CARTE(scene.json)", () => {
  const z = ZONE_CARTE(scene);
  const dedans = (x: number, zz: number) => x >= z.x0 && x <= z.x1 && zz >= z.z0 && zz <= z.z1;
  it("contient les 8 POI", () => {
    expect(scene.pois).toHaveLength(8);
    for (const p of scene.pois) expect(dedans(p.x, p.z), p.id).toBe(true);
  });
  it("contient Elsa", () => {
    const [ex, ez] = positionElsa(scene);
    expect(ex).toBeCloseTo(-122.7, 0);
    expect(ez).toBeCloseTo(37.4, 0);
    expect(dedans(ex, ez)).toBe(true);
  });
  it("contient tous les parkings", () => {
    for (const [i, park] of scene.parkings.entries()) for (const [x, zz] of park) expect(dedans(x, zz), `parking ${i}`).toBe(true);
  });
  it("contient tous les bâtiments avec 60 m de marge et l'anneau d'apparition", () => {
    for (const b of scene.buildings) for (const [x, zz] of b.r) {
      expect(x).toBeGreaterThanOrEqual(z.x0 + 60 - 1e-9); expect(x).toBeLessThanOrEqual(z.x1 - 60 + 1e-9 + 100);
      expect(dedans(x, zz)).toBe(true);
    }
    const [cx, cz] = ROND_POINT.centre;
    for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const ang = (a * Math.PI) / 4;
      expect(dedans(cx + Math.cos(ang) * ZONE_APPARITION.rMax, cz + Math.sin(ang) * ZONE_APPARITION.rMax)).toBe(true);
    }
  });
  it("reste de l'ordre de grandeur de la spec (≈ 900 × 600 m)", () => {
    expect(z.x1 - z.x0).toBeGreaterThan(800);
    expect(z.x1 - z.x0).toBeLessThan(1100);
    expect(z.z1 - z.z0).toBeGreaterThan(500);
    expect(z.z1 - z.z0).toBeLessThan(900);
  });
  it("sans bâtiment : zone minimale valide", () => {
    const vide = { ...scene, buildings: [], parkings: [], pois: [] } as SceneData;
    const zv = ZONE_CARTE(vide);
    expect(zv.x1).toBeGreaterThan(zv.x0);
  });
});

describe("versZone (grande carte)", () => {
  it("coins de la zone → coins du rectangle, nord en haut", () => {
    const z = { x0: -100, z0: -50, x1: 100, z1: 50 };
    expect(versZone(z, 400, 200, -100, -50)).toEqual({ x: 0, y: 0 });
    expect(versZone(z, 400, 200, 100, 50)).toEqual({ x: 400, y: 200 });
    expect(versZone(z, 400, 200, 0, 0)).toEqual({ x: 200, y: 100 });
    expect(versZone(z, 400, 200, 0, -25).y).toBeLessThan(100);
  });
});

describe("matriceCouche", () => {
  const dim = { echelle: 1.5, x0: -442, z0: -301 };
  for (const mode of ["regard", "nord"] as const) {
    it(`place un pixel de la couche exactement où versCarte place le point monde (${mode})`, () => {
      const v = vue({ mode, psi: 0.83, px: 12, pz: -40, rayonM: 130, taille: 264 });
      const [a, b, c, d, e, f] = matriceCouche(v, dim);
      for (const [pxl, pyl] of [[0, 0], [300, 200], [1200, 900]]) {
        const sx = a * pxl + c * pyl + e, sy = b * pxl + d * pyl + f;
        const monde = versCarte(v, dim.x0 + pxl / dim.echelle, dim.z0 + pyl / dim.echelle);
        expect(sx).toBeCloseTo(monde.x, 6);
        expect(sy).toBeCloseTo(monde.y, 6);
      }
    });
  }
});

describe("nomCourtPoi et nomZone", () => {
  it("noms courts", () => {
    const noms = Object.fromEntries(scene.pois.map((p) => [p.id, nomCourtPoi(p)]));
    expect(noms).toMatchObject({ cba: "CBA", trefle: "Trèfle", truck: "Truck", mijote: "Mijote", dubble: "Dubble", vival: "Vival" });
  });
  it("zone : POI à moins de 40 m, rond-point à moins de 25 m, sinon rien", () => {
    const truck = scene.pois.find((p) => p.id === "truck")!;
    expect(nomZone(scene, truck.x + 5, truck.z)).toBe("Truck Muche");
    expect(nomZone(scene, ROND_POINT.centre[0], ROND_POINT.centre[1])).toBe("Rond-point");
    expect(nomZone(scene, 1e4, 1e4)).toBeNull();
  });
});

describe("polygoneCadre", () => {
  it("le coin tourné vers le centre de l'écran est biseauté, les trois autres sont francs", () => {
    const cas: [Parameters<typeof polygoneCadre>[2], [number, number]][] = [
      ["hg", [200, 200]], ["hd", [0, 200]], ["bg", [200, 0]], ["bd", [0, 0]],
    ];
    for (const [coin, sommetCoupe] of cas) {
      const pts = polygoneCadre(200, 10, coin);
      expect(pts).toHaveLength(5);
      expect(pts.some(([x, y]) => x === sommetCoupe[0] && y === sommetCoupe[1])).toBe(false);
      for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(200); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(200); }
    }
    expect(BISEAU_U).toBe(10);
  });
  it("sans biseau : le carré", () => {
    expect(polygoneCadre(100, 0, "hg")).toHaveLength(4);
  });
});

describe("Cadence adaptative (60 → 30 Hz)", () => {
  it("passe à 30 Hz au-delà de 4 ms de moyenne sur 60 images, repasse à 60 Hz sous 2 ms sur 120", () => {
    const c = new Cadence();
    for (let i = 0; i < 59; i++) c.noter(6);
    expect(c.reduit).toBe(false);
    c.noter(6);
    expect(c.reduit).toBe(true);
    // 30 Hz : une image sur deux
    const tirs = Array.from({ length: 10 }, () => c.autoriser());
    expect(tirs.filter(Boolean)).toHaveLength(5);
    for (let i = 0; i < 119; i++) c.noter(1);
    expect(c.reduit).toBe(true);
    c.noter(1);
    expect(c.reduit).toBe(false);
    expect(c.autoriser()).toBe(true);
  });
  it("ne ralentit pas sur une moyenne rapide ou sur un pic isolé", () => {
    const c = new Cadence();
    for (let i = 0; i < 200; i++) c.noter(i % 50 === 0 ? 20 : 1);
    expect(c.reduit).toBe(false);
  });
  it("entre 2 et 4 ms : l'état reste celui d'avant (hystérésis)", () => {
    const c = new Cadence();
    for (let i = 0; i < 80; i++) c.noter(3);
    expect(c.reduit).toBe(false);
    for (let i = 0; i < 60; i++) c.noter(5);
    expect(c.reduit).toBe(true);
    for (let i = 0; i < 400; i++) c.noter(3);
    expect(c.reduit).toBe(true);
  });
});
