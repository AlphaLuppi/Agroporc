import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, lancerRayon } from "./collision";
import { SILHOUETTE, SILHOUETTE_ACCROUPIE, type Vec3 } from "./protocole";
import { pointsVisibilite, tracer, toucheVraisemblable, type Cible } from "./tir";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
const monde = (b: Building[]) => construireMonde({ ...scene, buildings: b, pois: [] });

/** Terrain dégagé (le seul bâtiment est loin) et terrain avec un mur épais entre x = 10 et x = 14. */
const libre = monde([rect(0, 100, 5, 110, 10)]);
const avecMur = monde([rect(10, -5, 14, 5, 20), rect(0, 100, 5, 110, 10)]);

const E = SILHOUETTE;
const cible = (id: string, x: number, z = 0, y = 0, vivant = true, accroupi = false): Cible => ({ id, p: [x, y, z], vivant, accroupi });
const accroupie = (id: string, x: number, z = 0): Cible => cible(id, x, z, 0, true, true);
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
      expect(tracer(libre, o, X, 100, [c], "a").cible === "b").toBe(Math.abs(dz) < E.corps.rayon);
      expect(toucheVraisemblable(libre, o, X, 100, c, 0)).toBe(true);
    }
  });
});

describe("tracer : cible accroupie", () => {
  const A = SILHOUETTE_ACCROUPIE;
  it("un tir à hauteur de tête debout passe au-dessus d'un accroupi", () => {
    const o: Vec3 = [0, E.tete.y, 0];
    expect(tracer(libre, o, X, 100, [cible("b", 20)], "a").zone).toBe("tete");
    expect(tracer(libre, o, X, 100, [accroupie("b", 20)], "a").cible).toBeNull();
  });

  it("la tête accroupie est plus bas : touchée à A.tete.y, jamais à celle de l'accroupi debout", () => {
    const i = tracer(libre, [0, A.tete.y, 0], X, 100, [accroupie("b", 20)], "a");
    expect(i.cible).toBe("b");
    expect(i.zone).toBe("tete");
    expect(i.distance).toBeCloseTo(20 - A.tete.rayon, 6);
  });

  it("le corps accroupi est touché au torse, pas au-dessus de son sommet", () => {
    expect(tracer(libre, [0, 0.7, 0], X, 100, [accroupie("b", 20)], "a").zone).toBe("corps");
    // 1,65 m : sous le sommet d'un debout (corps jusqu'à 1,73), au-dessus de celui d'un accroupi (tête jusqu'à 1,6)
    expect(tracer(libre, [0, 1.65, 0], X, 100, [accroupie("b", 20)], "a").cible).toBeNull();
    expect(tracer(libre, [0, 1.65, 0], X, 100, [cible("b", 20)], "a").cible).toBe("b");
  });

  it("la boule englobante suit la silhouette : un accroupi proche est touché à son sommet", () => {
    const i = tracer(libre, [0, A.tete.y + A.tete.rayon - 0.02, 0], X, 100, [accroupie("b", 3)], "a");
    expect(i.zone).toBe("tete");
  });
});

describe("toucheVraisemblable : sommet de la tête", () => {
  // `tracer` touche le sommet de la tête (2,28 m debout, 1,58 m accroupi) : la validation serveur doit l'accepter à toute distance.
  const sommet = (acc: boolean) => (acc ? A_ACCROUPIE : E).tete.y + (acc ? A_ACCROUPIE : E).tete.rayon - 0.02;
  const A_ACCROUPIE = SILHOUETTE_ACCROUPIE;
  for (const acc of [false, true]) {
    for (const dist of [10, 30, 100, 300]) {
      it(`${acc ? "accroupi" : "debout"} à ${dist} m, cible immobile`, () => {
        const o: Vec3 = [0, sommet(acc), 0];
        const c = cible("b", dist, 0, 0, true, acc);
        expect(tracer(libre, o, X, dist + 50, [c], "a").zone).toBe("tete");
        expect(toucheVraisemblable(libre, o, X, dist + 50, c, 0)).toBe(true);
      });
    }
  }

  it("une cible à 1,3 m du rayon reste refusée, debout comme accroupie", () => {
    const o: Vec3 = [0, 0.9, 0];
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 20, 1.3), 0)).toBe(false);
    expect(toucheVraisemblable(libre, o, X, 100, accroupie("b", 20, 1.3), 0)).toBe(false);
  });

  it("l'axe accroupi est plus court : un tir à 2,1 m de haut passe trop loin d'un accroupi, pas d'un debout", () => {
    const o: Vec3 = [0, 3.6, 0];
    expect(toucheVraisemblable(libre, o, X, 100, cible("b", 20), 0)).toBe(false);
    expect(toucheVraisemblable(libre, [0, 2.9, 0], X, 100, cible("b", 20), 0)).toBe(true);
    expect(toucheVraisemblable(libre, [0, 2.9, 0], X, 100, accroupie("b", 20), 0)).toBe(false);
  });
});

describe("toucheVraisemblable : cible collée à un mur (§13.2.3)", () => {
  // Mur x ∈ [10 ; 14], z ∈ [-5 ; 5] ; cible dont l'axe est à 0,45 m de sa face ouest, au pied de l'angle (10 ; 5).
  // Le tireur est à l'est, au-delà de l'angle : son rayon rase l'angle et touche la capsule, mais le rayon prolongé jusqu'au pied de l'axe entre dans le mur.
  const mur = monde([rect(10, -5, 14, 5, 20), rect(0, 100, 5, 110, 10)]);
  const o: Vec3 = [20, 1.5, 11];
  const d: Vec3 = [-0.857088636473505, 0, -0.5151689715306891];
  const collee = cible("b", 9.55, 5);

  it("`tracer` touche la cible", () => {
    expect(tracer(mur, o, d, 100, [collee], "a").cible).toBe("b");
  });

  it("la validation serveur l'accepte (ligne de vue jusqu'à l'entrée dans la capsule)", () => {
    expect(toucheVraisemblable(mur, o, d, 100, collee, 0)).toBe(true);
  });

  it("le rayon qui entre dans la capsule est libre jusqu'à `proj − rayon`, il ne l'est pas jusqu'à l'axe", () => {
    const proj = (9.55 - o[0]) * d[0] + (5 - o[2]) * d[2];
    expect(lancerRayon(mur, o, d, proj)).not.toBe(Infinity);
    expect(lancerRayon(mur, o, d, proj - E.corps.rayon)).toBe(Infinity);
  });

  it("derrière le mur, la cible reste refusée", () => {
    expect(toucheVraisemblable(mur, [0, 1.5, 0], X, 100, cible("b", 18), 0)).toBe(false);
    expect(toucheVraisemblable(mur, [0, 1.5, 0], X, 100, cible("b", 14.3), 0)).toBe(false);
    // tireur collé à un mur épais avec la cible derrière : l'entrée dans la capsule est encore derrière le mur
    expect(toucheVraisemblable(mur, [9.8, 1.5, 0], X, 100, cible("b", 14.45), 0)).toBe(false);
  });

  it("pointsVisibilite : des points côté tireur, à l'aplomb l'axe lui-même", () => {
    const [tete, centre, pieds] = pointsVisibilite([20, 1.5, 5], collee);
    expect(tete[0]).toBeCloseTo(9.55 + E.tete.rayon, 9);
    expect(centre[0]).toBeCloseTo(9.55 + E.corps.rayon, 9);
    expect(tete[1]).toBe(E.tete.y);
    expect(pieds[1]).toBeCloseTo(E.corps.y0 + 0.1, 9);
    expect(pointsVisibilite([9.55, 1.5, 5], collee)[1]).toEqual([9.55, E.centreY, 5]);
    // œil plus proche que le rayon : on ne dépasse pas l'œil
    expect(pointsVisibilite([9.7, 1.5, 5], collee)[1][0]).toBeCloseTo(9.7, 9);
    // accroupie : silhouette basse
    expect(pointsVisibilite([20, 1.5, 5], accroupie("b", 9.55, 5))[0][1]).toBe(SILHOUETTE_ACCROUPIE.tete.y);
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
