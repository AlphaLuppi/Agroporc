import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { COUTEAU } from "./armes";
import { construireMonde } from "./collision";
import { REWIND_MAX_MS } from "./match";
import { coupVraisemblable, distanceSurface, REWIND_MELEE_MS, trouverCibleCouteau, type CibleMelee } from "./melee";
import { SILHOUETTE, SILHOUETTE_ACCROUPIE, type Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
const monde = (b: Building[]) => construireMonde({ ...scene, buildings: b, pois: [] });
const libre = monde([rect(0, 100, 5, 110, 10)]);
/** Mur mince entre x = 10 et x = 10,5. */
const avecMur = monde([rect(10, -5, 10.5, 5, 20), rect(0, 100, 5, 110, 10)]);

const R = SILHOUETTE.corps.rayon;
const X: Vec3 = [1, 0, 0];
/** Œil à 1,5 m : dans la hauteur de l'axe de la capsule (0,19 à 1,73), donc la distance de surface est purement horizontale. */
const o: Vec3 = [0, 1.5, 0];
/** Cible dont la SURFACE est à `surface` m devant l'œil, dans l'axe x. */
const cible = (id: string, surface: number, z = 0, accroupi = false): CibleMelee => ({ id, p: [R + surface, 0, z], vivant: true, accroupi });

describe("constantes", () => {
  it("la fenêtre de rejeu du couteau est plus courte que celle des tirs", () => {
    expect(REWIND_MELEE_MS).toBe(200);
    expect(REWIND_MELEE_MS).toBeLessThan(REWIND_MAX_MS);
  });
});

describe("distanceSurface", () => {
  it("horizontale : axe moins le rayon du corps", () => {
    expect(distanceSurface(o, cible("b", 2.2))).toBeCloseTo(2.2, 9);
    expect(distanceSurface(o, { id: "b", p: [3, 0, 4], vivant: true })).toBeCloseTo(5 - R, 9);
  });

  it("0 quand l'œil est dans la capsule", () => {
    expect(distanceSurface(o, { id: "b", p: [0.3, 0, 0], vivant: true })).toBe(0);
    expect(distanceSurface(o, { id: "b", p: [0, 0, 0], vivant: true })).toBe(0);
  });

  it("tient compte de la hauteur : œil au-dessus du haut de la capsule, ou pieds de la cible plus haut", () => {
    // œil à 3,73 m, haut de l'axe à 1,73 m : 2 m plus bas, sur la même verticale
    expect(distanceSurface([0, 3.73, 0], { id: "b", p: [0, 0, 0], vivant: true })).toBeCloseTo(2 - R, 9);
    // cible sur un toit à 5 m de haut, œil à 1,5 m : axe de 5,19 à 6,73, point le plus proche à 5,19
    expect(distanceSurface(o, { id: "b", p: [0, 5, 0], vivant: true })).toBeCloseTo(3.69 - R, 9);
  });

  it("accroupie : la capsule est plus basse (axe jusqu'à 1,0 m)", () => {
    const debout: CibleMelee = { id: "b", p: [0, 0, 0], vivant: true };
    const bas: CibleMelee = { ...debout, accroupi: true };
    expect(distanceSurface([0, 2.5, 0], debout)).toBeCloseTo(2.5 - SILHOUETTE.corps.y1 - R, 9);
    expect(distanceSurface([0, 2.5, 0], bas)).toBeCloseTo(2.5 - SILHOUETTE_ACCROUPIE.corps.y1 - R, 9);
  });
});

describe("trouverCibleCouteau (client)", () => {
  it("2,2 m de surface : accepté", () => {
    const r = trouverCibleCouteau(libre, o, X, [cible("b", 2.2)], "a");
    expect(r?.cible).toBe("b");
    expect(r?.distance).toBeCloseTo(2.2, 9);
  });

  it("2,9 m : hors portée, refusé (le client ne profite pas de la marge du serveur)", () => {
    expect(trouverCibleCouteau(libre, o, X, [cible("b", 2.9)], "a")).toBeNull();
    expect(trouverCibleCouteau(libre, o, X, [cible("b", 2.3)], "a")).toBeNull();
    expect(COUTEAU.portee).toBe(2.2);
  });

  it("le plus proche dans le cône l'emporte ; le tireur, les morts et les cibles hors cône sont ignorés", () => {
    const hors = cible("hors", 1.5, 3); // sur le côté (à ~63° de l'axe, bord compris : hors du cône)
    const mort: CibleMelee = { ...cible("mort", 0.5), vivant: false };
    const moi: CibleMelee = { ...cible("a", 0.4) };
    const cibles = [hors, mort, moi, cible("loin", 2), cible("pres", 1)];
    expect(trouverCibleCouteau(libre, o, X, cibles, "a")?.cible).toBe("pres");
    expect(trouverCibleCouteau(libre, o, X, [hors, mort, moi], "a")).toBeNull();
  });

  it("derrière un mur : refusé", () => {
    // mur entre x = 10 et 10,5 ; l'œil à x = 9, la cible à 1,6 m de surface juste derrière
    const oMur: Vec3 = [9, 1.5, 0];
    const derriere: CibleMelee = { id: "b", p: [9 + R + 1.6 + 0.5, 0, 0], vivant: true };
    expect(distanceSurface(oMur, derriere)).toBeLessThan(COUTEAU.portee);
    expect(trouverCibleCouteau(avecMur, oMur, X, [derriere], "a")).toBeNull();
    expect(trouverCibleCouteau(libre, oMur, X, [derriere], "a")?.cible).toBe("b");
  });

  it("cône : ±40° accepté, 70° refusé, dos refusé", () => {
    const dir = (deg: number): Vec3 => [Math.cos((deg * Math.PI) / 180), 0, Math.sin((deg * Math.PI) / 180)];
    const c = cible("b", 1.5);
    expect(trouverCibleCouteau(libre, o, dir(40), [c], "a")?.cible).toBe("b");
    expect(trouverCibleCouteau(libre, o, dir(-40), [c], "a")?.cible).toBe("b");
    expect(trouverCibleCouteau(libre, o, dir(70), [c], "a")).toBeNull();
    expect(trouverCibleCouteau(libre, o, dir(180), [c], "a")).toBeNull();
  });

  it("au contact (œil dans la capsule), toute direction est dans le cône", () => {
    const c: CibleMelee = { id: "b", p: [0.2, 0, 0], vivant: true };
    expect(trouverCibleCouteau(libre, o, [-1, 0, 0], [c], "a")?.cible).toBe("b");
  });

  it("accroupie : l'œil debout au-dessus d'une cible basse reste dans la portée, la hauteur compte", () => {
    // œil à 1,95 m à l'aplomb d'un accroupi (axe jusqu'à 1,0 m, rayon 0,475) : surface à 0,95 − 0,475 = 0,475 m
    const c: CibleMelee = { id: "b", p: [0, 0, 0], vivant: true, accroupi: true };
    const r = trouverCibleCouteau(libre, [0, 1.95, 0], [0, -1, 0], [c], "a");
    expect(r?.distance).toBeCloseTo(0.475, 9);
  });
});

describe("coupVraisemblable (serveur)", () => {
  it("2,2 m accepté, 2,7 m accepté (marge de 0,6 m), 2,9 m refusé", () => {
    expect(coupVraisemblable(libre, o, X, cible("b", 2.2), 0)).toBe(true);
    expect(coupVraisemblable(libre, o, X, cible("b", 2.7), 0)).toBe(true);
    expect(coupVraisemblable(libre, o, X, cible("b", 2.9), 0)).toBe(false);
    expect(COUTEAU.margePortee).toBe(0.6);
  });

  it("la vitesse de la cible n'élargit pas la portée (le rejeu de 200 ms s'en charge)", () => {
    expect(coupVraisemblable(libre, o, X, cible("b", 2.9), 16)).toBe(false);
  });

  it("derrière un mur : refusé", () => {
    const oMur: Vec3 = [9, 1.5, 0];
    const derriere: CibleMelee = { id: "b", p: [9 + R + 1.6 + 0.5, 0, 0], vivant: true };
    expect(coupVraisemblable(avecMur, oMur, X, derriere, 0)).toBe(false);
    expect(coupVraisemblable(libre, oMur, X, derriere, 0)).toBe(true);
  });

  it("hors cône : refusé", () => {
    const c = cible("b", 1.5);
    expect(coupVraisemblable(libre, o, [0, 0, 1], c, 0)).toBe(false);
    expect(coupVraisemblable(libre, o, [-1, 0, 0], c, 0)).toBe(false);
    expect(coupVraisemblable(libre, o, [Math.cos(0.5), 0, Math.sin(0.5)], c, 0)).toBe(true);
  });

  it("cible morte : refusée", () => {
    expect(coupVraisemblable(libre, o, X, { ...cible("b", 1), vivant: false }, 0)).toBe(false);
  });

  it("accroupie : mesurée sur sa capsule basse", () => {
    // œil debout à 1,95 m ; surface à 2,7 m en x ; le haut de l'axe accroupi (1,0 m) est 0,95 m sous l'œil, celui du debout 0,22 m
    const acc = cible("b", 2.7, 0, true);
    const debout = cible("b", 2.7, 0, false);
    const oeil: Vec3 = [0, SILHOUETTE.oeil, 0];
    const dA = distanceSurface(oeil, acc), dD = distanceSurface(oeil, debout);
    expect(dA).toBeGreaterThan(dD);
    expect(dA).toBeCloseTo(Math.hypot(2.7 + R, SILHOUETTE.oeil - SILHOUETTE_ACCROUPIE.corps.y1) - R, 9);
    // à 2,7 m horizontaux, l'accroupie passe à ≈ 2,84 m (> 2,8) : refusée là où la debout (≈ 2,71 m) est acceptée
    expect(coupVraisemblable(libre, oeil, X, debout, 0)).toBe(true);
    expect(coupVraisemblable(libre, oeil, X, acc, 0)).toBe(false);
    expect(coupVraisemblable(libre, oeil, X, cible("b", 2.0, 0, true), 0)).toBe(true);
  });
});
