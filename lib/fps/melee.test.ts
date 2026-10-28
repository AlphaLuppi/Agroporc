import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { COUTEAU, MELEE } from "./armes";
import { construireMonde } from "./collision";
import { REWIND_MAX_MS } from "./match";
import { coupVraisemblable, dansCone, distanceSurface, REWIND_MELEE_MS, trouverCibleCouteau, trouverCiblesMelee, type CibleMelee } from "./melee";
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
    expect(coupVraisemblable(libre, o, X, cible("b", 2.2))).toBe(true);
    expect(coupVraisemblable(libre, o, X, cible("b", 2.7))).toBe(true);
    expect(coupVraisemblable(libre, o, X, cible("b", 2.9))).toBe(false);
    expect(COUTEAU.margePortee).toBe(0.6);
  });

  it("la vitesse de la cible n'élargit pas la portée (le rejeu de 200 ms s'en charge)", () => {
    expect(coupVraisemblable(libre, o, X, cible("b", 2.9))).toBe(false);
  });

  it("derrière un mur : refusé", () => {
    const oMur: Vec3 = [9, 1.5, 0];
    const derriere: CibleMelee = { id: "b", p: [9 + R + 1.6 + 0.5, 0, 0], vivant: true };
    expect(coupVraisemblable(avecMur, oMur, X, derriere)).toBe(false);
    expect(coupVraisemblable(libre, oMur, X, derriere)).toBe(true);
  });

  it("hors cône : refusé", () => {
    const c = cible("b", 1.5);
    expect(coupVraisemblable(libre, o, [0, 0, 1], c)).toBe(false);
    expect(coupVraisemblable(libre, o, [-1, 0, 0], c)).toBe(false);
    expect(coupVraisemblable(libre, o, [Math.cos(0.5), 0, Math.sin(0.5)], c)).toBe(true);
  });

  it("cible morte : refusée", () => {
    expect(coupVraisemblable(libre, o, X, { ...cible("b", 1), vivant: false })).toBe(false);
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
    expect(coupVraisemblable(libre, oeil, X, debout)).toBe(true);
    expect(coupVraisemblable(libre, oeil, X, acc)).toBe(false);
    expect(coupVraisemblable(libre, oeil, X, cible("b", 2.0, 0, true))).toBe(true);
  });
});

describe("épée (arme blanche à plusieurs cibles)", () => {
  const dir = (deg: number): Vec3 => [Math.cos((deg * Math.PI) / 180), 0, Math.sin((deg * Math.PI) / 180)];

  it("portée 2,6 mesurée de la SURFACE de la cible (le couteau s'arrête à 2,2)", () => {
    expect(MELEE.epee.portee).toBe(2.6);
    const r = trouverCiblesMelee(libre, o, X, [cible("b", 2.6)], "a", "epee");
    expect(r).toHaveLength(1);
    expect(r[0].cible).toBe("b");
    expect(r[0].distance).toBeCloseTo(2.6, 9);
    expect(trouverCiblesMelee(libre, o, X, [cible("b", 2.7)], "a", "epee")).toEqual([]);
    // à 2,4 m de surface : l'épée touche, le couteau non
    expect(trouverCiblesMelee(libre, o, X, [cible("b", 2.4)], "a", "epee")).toHaveLength(1);
    expect(trouverCiblesMelee(libre, o, X, [cible("b", 2.4)], "a", "couteau")).toEqual([]);
    expect(trouverCiblesMelee(libre, o, X, [cible("b", 2.4)], "a")).toEqual([]);
  });

  it("cône de 70° : 75° et 80° acceptés à l'épée, refusé au couteau ; dos refusé ; au contact, toute direction", () => {
    const c = cible("b", 1.5);
    expect(trouverCiblesMelee(libre, o, dir(75), [c], "a", "epee")).toHaveLength(1);
    expect(trouverCiblesMelee(libre, o, dir(75), [c], "a", "couteau")).toHaveLength(0);
    expect(trouverCiblesMelee(libre, o, dir(-75), [c], "a", "epee")).toHaveLength(1);
    expect(trouverCiblesMelee(libre, o, dir(80), [c], "a", "epee")).toHaveLength(1);
    expect(trouverCiblesMelee(libre, o, dir(80), [c], "a", "couteau")).toHaveLength(0);
    expect(trouverCiblesMelee(libre, o, dir(95), [c], "a", "epee")).toEqual([]);
    expect(trouverCiblesMelee(libre, o, dir(180), [c], "a", "epee")).toEqual([]);
    const contact: CibleMelee = { id: "b", p: [0.2, 0, 0], vivant: true };
    expect(trouverCiblesMelee(libre, o, [-1, 0, 0], [contact], "a", "epee")).toHaveLength(1);
  });

  it("dansCone : le cosinus du demi-angle est un paramètre", () => {
    const c = cible("b", 1.5);
    expect(dansCone(o, dir(75), c, MELEE.couteau.cosCone)).toBe(false);
    expect(dansCone(o, dir(75), c, MELEE.epee.cosCone)).toBe(true);
  });

  it("jusqu'à 3 cibles, triées de la plus proche à la plus lointaine", () => {
    const cibles = [cible("loin", 2.5), cible("pres", 0.8), cible("milieu", 1.6), cible("quatrieme", 2.2)];
    const r = trouverCiblesMelee(libre, o, X, cibles, "a", "epee");
    expect(r.map((x) => x.cible)).toEqual(["pres", "milieu", "quatrieme"]);
    expect(r[0].distance).toBeLessThan(r[1].distance);
    expect(r[1].distance).toBeLessThan(r[2].distance);
    // moins de cibles que le maximum : toutes
    expect(trouverCiblesMelee(libre, o, X, [cible("b", 1), cible("c", 2)], "a", "epee").map((x) => x.cible)).toEqual(["b", "c"]);
    // le couteau n'en prend qu'une : la plus proche
    expect(trouverCiblesMelee(libre, o, X, cibles, "a", "couteau").map((x) => x.cible)).toEqual(["pres"]);
  });

  it("ignore le tireur, les morts et les cibles hors portée ou hors cône au milieu des autres", () => {
    const moi = cible("a", 0.5);
    const mort: CibleMelee = { ...cible("mort", 1), vivant: false };
    const dos: CibleMelee = { id: "dos", p: [-3, 0, 0], vivant: true };
    const ok = cible("ok", 2);
    expect(trouverCiblesMelee(libre, o, X, [moi, mort, dos, cible("loin", 4), ok], "a", "epee").map((x) => x.cible)).toEqual(["ok"]);
    expect(trouverCiblesMelee(libre, o, X, [], "a", "epee")).toEqual([]);
  });

  it("ligne de vue : un mur arrête le coup d'épée, seule la cible dégagée est prise", () => {
    const oMur: Vec3 = [9, 1.5, 0];
    // derrière le mur (x = 10 à 10,5), à 1,5 m de surface
    const derriere: CibleMelee = { id: "derriere", p: [10.5 + 0.5 + R, 0, 0], vivant: true };
    // du même côté que l'œil, dans le cône
    const devant: CibleMelee = { id: "devant", p: [9 + 0.3, 0, 6], vivant: true };
    expect(trouverCiblesMelee(avecMur, oMur, X, [derriere], "a", "epee")).toEqual([]);
    expect(trouverCiblesMelee(libre, oMur, X, [derriere], "a", "epee").map((x) => x.cible)).toEqual(["derriere"]);
    expect(trouverCiblesMelee(avecMur, oMur, X, [derriere, devant], "a", "epee").map((x) => x.cible)).not.toContain("derriere");
  });

  it("trouverCibleCouteau délègue au couteau : même résultat que trouverCiblesMelee(…, 'couteau')[0]", () => {
    const cibles = [cible("loin", 2.0), cible("pres", 1.0), cible("trop", 2.4)];
    expect(trouverCibleCouteau(libre, o, X, cibles, "a")).toEqual(trouverCiblesMelee(libre, o, X, cibles, "a", "couteau")[0]);
    expect(trouverCibleCouteau(libre, o, X, cibles, "a")?.cible).toBe("pres");
    expect(trouverCibleCouteau(libre, o, X, [cible("trop", 2.4)], "a")).toBeNull();
  });

  it("serveur : coupVraisemblable accepte 2,6 + 0,7 de marge à l'épée (3,3), pas au-delà ; le couteau s'arrête à 2,8", () => {
    expect(coupVraisemblable(libre, o, X, cible("b", 3.2), "epee")).toBe(true);
    expect(coupVraisemblable(libre, o, X, cible("b", 3.3), "epee")).toBe(true);
    expect(coupVraisemblable(libre, o, X, cible("b", 3.4), "epee")).toBe(false);
    expect(coupVraisemblable(libre, o, X, cible("b", 3.2), "couteau")).toBe(false);
    expect(coupVraisemblable(libre, o, X, cible("b", 3.2))).toBe(false);
    expect(coupVraisemblable(libre, o, X, cible("b", 2.8), "couteau")).toBe(true);
  });

  it("serveur : cône de 70° et ligne de vue pour l'épée, cible morte refusée", () => {
    expect(coupVraisemblable(libre, o, dir(75), cible("b", 1.5), "epee")).toBe(true);
    expect(coupVraisemblable(libre, o, dir(75), cible("b", 1.5), "couteau")).toBe(false);
    expect(coupVraisemblable(libre, o, dir(150), cible("b", 1.5), "epee")).toBe(false);
    const oMur: Vec3 = [9, 1.5, 0];
    const derriere: CibleMelee = { id: "b", p: [10.5 + 0.3 + R, 0, 0], vivant: true };
    expect(coupVraisemblable(avecMur, oMur, X, derriere, "epee")).toBe(false);
    expect(coupVraisemblable(libre, oMur, X, derriere, "epee")).toBe(true);
    expect(coupVraisemblable(libre, o, X, { ...cible("b", 1), vivant: false }, "epee")).toBe(false);
  });
});
