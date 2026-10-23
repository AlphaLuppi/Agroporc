import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import {
  ECHELLE_TIGRE, TIGRE_ROBOT, TITAN, TRUCK_FOU, capVers, commandesPoursuite, dansCoupDePatte, ecraseParTruck, pasTigre, pasTitan, pasTruck, pointLocal, pvTigre,
  sousLeTigre, toucheTigre,
} from "./monstres";
import type { Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number, h = 10): Building => ({ h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const mondeAvec = (...b: Building[]) => construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000), ...b], pois: [] } as SceneData);
const vide = mondeAvec();
const CAP_EST = -Math.PI / 2;

describe("capVers", () => {
  it("suit la convention du lacet (avant = (−sin, −cos))", () => {
    expect(capVers(0, 0, 10, 0)).toBeCloseTo(CAP_EST, 9);
    expect(capVers(0, 0, 0, -10)).toBeCloseTo(0, 9);
  });
});

describe("Truck Muche fou", () => {
  it("braque vers sa cible et dérape quand elle est franchement de côté à pleine vitesse", () => {
    const e = { p: [0, 0, 0] as Vec3, cap: CAP_EST, v: 20 };
    expect(commandesPoursuite(e, [30, 0, 10], false).direction).toBeGreaterThan(0); // cible au sud = à droite en roulant vers l'est
    expect(commandesPoursuite(e, [30, 0, -10], false).direction).toBeLessThan(0);
    expect(commandesPoursuite(e, [0, 0, 30], false).frein).toBe(true);
    expect(commandesPoursuite(e, [30, 0, 0], false).frein).toBe(false);
    expect(commandesPoursuite(e, [30, 0, 0], true).accel).toBe(-1);
  });

  it("contourne un bâtiment qui le sépare de sa cible", () => {
    const mur = mondeAvec(rect(20, -12, 30, 12));
    let e = { p: [0, 0, 0] as Vec3, cap: CAP_EST, v: 0 };
    let auPlusPres = Infinity;
    for (let i = 0; i < 60 * 15; i++) {
      e = pasTruck(e, [60, 0, 0], false, 1 / 60, mur);
      auPlusPres = Math.min(auPlusPres, Math.hypot(60 - e.p[0], e.p[2]));
    }
    expect(auPlusPres).toBeLessThan(6);
  });

  it("rejoint une cible placée derrière lui en quelques secondes", () => {
    let e = { p: [0, 0, 0] as Vec3, cap: CAP_EST, v: 0 };
    const cible: Vec3 = [-40, 0, 15];
    let t = 0;
    while (Math.hypot(e.p[0] - cible[0], e.p[2] - cible[2]) > 3 && t < 10) { e = pasTruck(e, cible, false, 1 / 60, vide); t += 1 / 60; }
    expect(t).toBeLessThan(8);
  });

  it("écrase sous sa caisse (plus grande qu'une voiture), seulement lancé", () => {
    const e = { p: [0, 0, 0] as Vec3, cap: CAP_EST, v: 15 };
    expect(ecraseParTruck(e, [TRUCK_FOU.longueur / 2 + 0.3, 0, 0], 0.4)).toBe(true);
    expect(ecraseParTruck(e, [0, 0, 3], 0.4)).toBe(false);
    expect(ecraseParTruck({ ...e, v: 1 }, [0, 0, 0], 0.4)).toBe(false);
    expect(ecraseParTruck(e, [0, TRUCK_FOU.hauteur + 0.1, 0], 0.4)).toBe(false);
  });
});

describe("tigre robot", () => {
  it("pivote puis marche vers sa cible, s'arrête à portée de patte, et ne traverse pas les bâtiments", () => {
    let e = { p: [0, 0, 0] as Vec3, cap: 0, v: 0 };
    for (let i = 0; i < 60 * 12; i++) e = pasTigre(e, [60, 0, 0], 1 / 60, vide);
    expect(e.p[0]).toBeGreaterThan(45);
    expect(e.p[0]).toBeLessThan(60);
    // un mur de 30 m de large entre lui et sa cible : il le contourne au lieu de piétiner devant
    const mur = mondeAvec(rect(20, -15, 30, 15));
    let f = { p: [0, 0, 0] as Vec3, cap: CAP_EST, v: 0 };
    let auPlusPres = Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      f = pasTigre(f, [60, 0, 0], 1 / 60, mur);
      expect(f.p[0] > 20 - 2.9 && f.p[0] < 30 + 2.9 && Math.abs(f.p[2]) < 15 + 2.9).toBe(false); // jamais dans le bâtiment
      auPlusPres = Math.min(auPlusPres, Math.hypot(60 - f.p[0], f.p[2]));
    }
    expect(auPlusPres).toBeLessThan(TIGRE_ROBOT.arret + 1.5); // il s'arrête à portée de patte
  });

  it("coup de patte devant seulement, écrasement sous le corps", () => {
    const e = { p: [0, 0, 0] as Vec3, cap: CAP_EST, v: 0 };
    expect(dansCoupDePatte(e, [14, 0, 0])).toBe(true);
    expect(dansCoupDePatte(e, [-14, 0, 0])).toBe(false);
    expect(dansCoupDePatte(e, [24, 0, 0])).toBe(false);
    // sous les pattes avant (0,13 m du modèle devant le centre, × 24) et entre les flancs
    expect(sousLeTigre(e, [3.1, 0, 1])).toBe(true);
    expect(sousLeTigre(e, [0, 0, 8])).toBe(false);
  });

  it("formes de touche : tête devant (zone tete), corps, raté, et un bâtiment entre les deux protège", () => {
    const p: Vec3 = [0, 0, 0];
    const S = ECHELLE_TIGRE;
    const tete = pointLocal(p, CAP_EST, S, 0, 0.47, 0.37);
    const corps = pointLocal(p, CAP_EST, S, 0, 0.33, -0.03);
    const viser = (o: Vec3, c: Vec3): Vec3 => { const v = [c[0] - o[0], c[1] - o[1], c[2] - o[2]]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    // de côté (le tigre regarde vers l'est), à 60 m au sud
    const de: Vec3 = [0, 2, 60];
    expect(toucheTigre(de, viser(de, tete), 400, p, CAP_EST, S, vide)?.zone).toBe("tete");
    expect(toucheTigre(de, viser(de, corps), 400, p, CAP_EST, S, vide)?.zone).toBe("corps");
    expect(toucheTigre(de, viser(de, [40, 4, 0]), 400, p, CAP_EST, S, vide)).toBeNull();
    const abri = mondeAvec(rect(-30, 25, 30, 30, 40));
    expect(toucheTigre(de, viser(de, corps), 400, p, CAP_EST, S, abri)).toBeNull();
    // le titan est plus petit : un rayon à hauteur du dos du boss passe au-dessus de lui
    expect(toucheTigre(de, viser(de, [0, 0.42 * S, 0]), 400, p, CAP_EST, TITAN.echelle, vide)).toBeNull();
    expect(toucheTigre(de, viser(de, [0, 0.42 * S, 0]), 400, p, CAP_EST, S, vide)).not.toBeNull();
  });

  it("PV selon le nombre de joueurs, bornés à 16", () => {
    expect(pvTigre(1)).toBe(2000);
    expect(pvTigre(4)).toBe(3500);
    expect(pvTigre(40)).toBe(pvTigre(16));
  });
});

describe("titan", () => {
  it("avance dans le repère de la vue à sa vitesse et glisse le long des murs", () => {
    let e = { p: [0, 0, 0] as Vec3, cap: 0, v: 0 };
    for (let i = 0; i < 60; i++) e = pasTitan(e, { avant: 1, droite: 0, lacet: CAP_EST }, 1 / 60, vide);
    expect(e.p[0]).toBeCloseTo(TITAN.vitesse, 0);
    expect(e.cap).toBeCloseTo(CAP_EST, 9);
    const mur = mondeAvec(rect(5, -30, 10, 30));
    let f = { p: [0, 0, 0] as Vec3, cap: 0, v: 0 };
    for (let i = 0; i < 120; i++) f = pasTitan(f, { avant: 1, droite: 0, lacet: CAP_EST }, 1 / 60, mur);
    expect(f.p[0]).toBeLessThanOrEqual(5 - TITAN.rayonCollision + 0.01);
  });
});
