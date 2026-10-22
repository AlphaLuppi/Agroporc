import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { SILHOUETTE, type Vec3 } from "./protocole";
import { tracer, toucheVraisemblable, type Cible } from "./tir";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
const monde = (b: Building[]) => construireMonde({ ...scene, buildings: b, pois: [] });

/** Terrain dégagé (le seul bâtiment est loin) et terrain avec un mur épais entre x = 10 et x = 14. */
const libre = monde([rect(0, 100, 5, 110, 10)]);
const avecMur = monde([rect(10, -5, 14, 5, 20), rect(0, 100, 5, 110, 10)]);

const E = SILHOUETTE;
const cible = (id: string, x: number, z = 0, y = 0, vivant = true): Cible => ({ id, p: [x, y, z], vivant });
const X: Vec3 = [1, 0, 0];

describe("tracer : joueurs", () => {
  it("touche la tête quand on vise la tête", () => {
    const i = tracer(libre, [0, E.tete.y, 0], X, 100, [cible("b", 20)], "a");
    expect(i.cible).toBe("b");
    expect(i.zone).toBe("tete");
    expect(i.distance).toBeCloseTo(20 - E.tete.rayon, 6);
    expect(i.point[0]).toBeCloseTo(20 - E.tete.rayon, 6);
    expect(i.point[1]).toBeCloseTo(E.tete.y, 6);
  });

  it("touche la tête depuis l'œil, un peu au-dessus de la sphère (tir de dessus)", () => {
    const o: Vec3 = [0, E.oeil + 6, 0];
    const cx = 20, cy = E.tete.y + 0.1, haut = Math.hypot(cx, o[1] - cy);
    const d: Vec3 = [cx / haut, (cy - o[1]) / haut, 0];
    const i = tracer(libre, o, d, 100, [cible("b", 20)], "a");
    expect(i.zone).toBe("tete");
  });

  it("touche le corps quand on vise la poitrine ou les jambes", () => {
    for (const y of [0.3, 0.8, 1.2]) {
      const i = tracer(libre, [0, y, 0], X, 100, [cible("b", 20)], "a");
      expect(i.cible).toBe("b");
      expect(i.zone).toBe("corps");
      expect(i.distance).toBeGreaterThan(20 - E.corps.rayon - 1e-9);
      expect(i.distance).toBeLessThan(20);
    }
  });

  it("passe à côté de la silhouette : impact à la portée, en l'air", () => {
    for (const dz of [0.5, 1, 3]) {
      const i = tracer(libre, [0, 1, 0], X, 60, [cible("b", 20, dz)], "a");
      expect(i.cible).toBeNull();
      expect(i.zone).toBeNull();
      expect(i.distance).toBe(60);
      expect(i.point).toEqual([60, 1, 0]);
    }
    // au-dessus de la tête et sous les pieds
    expect(tracer(libre, [0, 2.4, 0], X, 60, [cible("b", 20)], "a").cible).toBeNull();
    expect(tracer(libre, [0, 0.02, 0], X, 60, [cible("b", 20, 0, 0.5)], "a").cible).toBeNull();
  });

  it("la portée limite le tir", () => {
    expect(tracer(libre, [0, 1, 0], X, 15, [cible("b", 20)], "a").cible).toBeNull();
    expect(tracer(libre, [0, 1, 0], X, 25, [cible("b", 20)], "a").cible).toBe("b");
  });

  it("le tireur et les morts sont ignorés, le plus proche l'emporte", () => {
    const cibles = [cible("a", 2), cible("mort", 5, 0, 0, false), cible("loin", 30), cible("pres", 12)];
    const i = tracer(libre, [0, 1, 0], X, 100, cibles, "a");
    expect(i.cible).toBe("pres");
    expect(tracer(libre, [0, 1, 0], X, 100, [cible("a", 2), cible("mort", 5, 0, 0, false)], "a").cible).toBeNull();
  });

  it("marche aussi en diagonale et vers le haut", () => {
    const l = Math.hypot(3, 4);
    const d: Vec3 = [3 / l, 0, -4 / l];
    const i = tracer(libre, [0, 1, 0], d, 100, [cible("b", 15, -20)], "a");
    expect(i.cible).toBe("b");
    expect(i.zone).toBe("corps");
    expect(i.distance).toBeCloseTo(25 - E.corps.rayon, 1);
  });
});

describe("tracer : bâtiments", () => {
  it("un bâtiment entre deux joueurs bloque le tir", () => {
    const i = tracer(avecMur, [0, 1.5, 0], X, 100, [cible("b", 30)], "a");
    expect(i.cible).toBeNull();
    expect(i.zone).toBeNull();
    expect(i.distance).toBeCloseTo(10, 6);
    expect(i.point[0]).toBeCloseTo(10, 6);
  });

  it("une cible devant le mur reste touchable, une cible derrière non", () => {
    expect(tracer(avecMur, [0, 1, 0], X, 100, [cible("devant", 6)], "a").cible).toBe("devant");
    expect(tracer(avecMur, [0, 1, 0], X, 100, [cible("derriere", 18)], "a").cible).toBeNull();
  });

  it("on tire par-dessus un bâtiment bas ou depuis son toit", () => {
    // au-dessus du toit (h = 20) : le rayon descend vers la cible derrière
    const o: Vec3 = [0, 40, 0], vers: Vec3 = [30, 0.9, 0];
    const l = Math.hypot(vers[0] - o[0], vers[1] - o[1]);
    const d: Vec3 = [(vers[0] - o[0]) / l, (vers[1] - o[1]) / l, 0];
    const i = tracer(avecMur, o, d, 100, [cible("b", 30)], "a");
    expect(i.cible).toBe("b");
  });

  it("sans cible, un tir vers le sol touche rien, un tir contre le mur donne l'impact", () => {
    const i = tracer(avecMur, [0, 3, 0], [1, 0, 0], 100, [], "a");
    expect(i.distance).toBeCloseTo(10, 6);
    expect(i.cible).toBeNull();
  });
});

describe("toucheVraisemblable", () => {
  const o: Vec3 = [0, 0.9, 0];

  it("accepte une touche franche", () => {
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 20), 0)).toBe(true);
    expect(toucheVraisemblable(libre, [0, E.oeil, 0], [1, 0, 0], 100, cible("b", 20), 0)).toBe(true);
  });

  it("refuse une touche à travers un mur", () => {
    expect(toucheVraisemblable(avecMur, o, X, 100, cible("b", 30), 0)).toBe(false);
    expect(toucheVraisemblable(avecMur, o, X, 100, cible("b", 30), 8)).toBe(false);
    // même cible, sans mur : acceptée
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 30), 0)).toBe(true);
    // devant le mur : acceptée
    expect(toucheVraisemblable(avecMur, o, X, 100, cible("b", 6), 0)).toBe(true);
  });

  it("refuse une cible à 5 m du rayon, accepte une petite erreur", () => {
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 20, 5), 0)).toBe(false);
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 20, 5), 6)).toBe(false);
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 20, 0.7), 0)).toBe(true);
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 20, 2), 0)).toBe(false);
  });

  it("la marge grandit avec la vitesse de la cible", () => {
    const c = cible("b", 20, 2);
    expect(toucheVraisemblable(libre, o, X, 100, c, 0)).toBe(false);
    expect(toucheVraisemblable(libre, o, X, 100, c, 8)).toBe(true);
  });

  it("refuse hors de la portée (+ 2 m), cible morte ou derrière le tireur", () => {
    expect(toucheVraisemblable(libre, o, X, 45, cible("b", 46.5), 0)).toBe(true);
    expect(toucheVraisemblable(libre, o, X, 45, cible("b", 60), 0)).toBe(false);
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 20, 0, 0, false), 0)).toBe(false);
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", -20), 0)).toBe(false);
  });

  it("accepte ce que `tracer` touche, refuse ce qu'il manque loin", () => {
    for (const dz of [0, 0.2, -0.3]) {
      const c = cible("b", 25, dz);
      expect(tracer(libre, o, X, 100, [c], "a").cible === "b").toBe(Math.abs(dz) < 0.38);
      expect(toucheVraisemblable(libre, o, X, 100, c, 0)).toBe(true);
    }
  });
});

describe("sur le vrai scene.json", () => {
  const vrai = construireMonde(scene);
  it("CBA bloque un tir à hauteur d'homme, pas un tir passant bien au-dessus du toit", () => {
    const cx = -162.8, cz = -12.7;
    const joueurDedans = cible("b", cx, cz);
    const bas = tracer(vrai, [cx + 40, 1.5, cz], [-1, 0, 0], 100, [joueurDedans], "a");
    expect(bas.cible).toBeNull();
    expect(bas.distance).toBeLessThan(40);
    const haut = tracer(vrai, [cx + 40, 60, cz], [-1, 0, 0], 100, [], "a");
    expect(haut.cible).toBeNull();
    expect(haut.distance).toBe(100);
    expect(toucheVraisemblable(vrai, [cx + 40, 1.5, cz], [-1, 0, 0], 100, joueurDedans, 0)).toBe(false);
  });
});
