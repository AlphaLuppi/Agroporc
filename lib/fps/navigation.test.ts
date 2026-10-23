import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, pointsApparition, resoudre } from "./collision";
import { TIGRE_ROBOT, pasTigre, pasTruck, type EtatMarcheur } from "./monstres";
import { carteNavigation, chemin, pointDeVisee } from "./navigation";
import type { Vec3 } from "./protocole";
import type { EtatVehicule } from "./vehicule";
import { positionElsa, trouverRondPoint } from "./zones";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const reel = construireMonde(scene);

describe("navigation", () => {
  it("chemin qui contourne un mur sans jamais passer à moins du rayon d'un bâtiment", () => {
    const monde = construireMonde({ ...scene, buildings: [rect(-100, -100, -99, -99), rect(99, 99, 100, 100), rect(-5, -40, 5, 40)], pois: [] } as SceneData);
    const c = carteNavigation(monde, 2);
    const ch = chemin(c, [-30, 0], [30, 0])!;
    expect(ch).not.toBeNull();
    for (const [x, z] of ch) expect(resoudre(monde, [x, 0, z], 2 - c.taille / 2, 8).contacts).toHaveLength(0);
    expect(Math.max(...ch.map((q) => Math.abs(q[1])))).toBeGreaterThan(40); // il passe par un bout du mur
    // le point visé depuis le départ est dégagé
    const v = pointDeVisee(monde, [-30, 0, 0], ch, 1)!;
    expect(v).not.toBeNull();
  });

  it("grille mise en cache par monde et par rayon", () => {
    expect(carteNavigation(reel, 3.3)).toBe(carteNavigation(reel, 3.3));
  });

  it("vraie carte : le Truck parti de chez Elsa rejoint des points d'apparition en moins de 25 s", () => {
    const c = carteNavigation(reel, 1.8);
    const [ex, ez] = positionElsa(scene);
    const cibles = pointsApparition(scene, reel).filter((_, i) => i % 50 === 0).slice(0, 8);
    let reussites = 0;
    for (const j of cibles) {
      let e: EtatVehicule = { p: [ex, 0, ez], cap: 0, v: 0 };
      let t = 0, ch: [number, number][] | null = null, chT = -9, recul = 0, bloque = 0;
      while (Math.hypot(e.p[0] - j[0], e.p[2] - j[1]) > 3 && t < 25) {
        if (t - chT > 1.2) { chT = t; ch = chemin(c, [e.p[0], e.p[2]], [j[0], j[1]]); }
        const vise: Vec3 = ch ? pointDeVisee(reel, e.p, ch, 1.3) ?? [j[0], 0, j[1]] : [j[0], 0, j[1]];
        e = pasTruck(e, vise, recul > 0, 1 / 60, reel);
        t += 1 / 60;
        if (recul > 0) recul -= 1 / 60;
        else if (Math.abs(e.v) < 3) { bloque += 1 / 60; if (bloque > 0.9) { recul = 1.1; bloque = 0; } } else bloque = 0;
      }
      if (t < 25) reussites++;
    }
    expect(reussites).toBeGreaterThanOrEqual(cibles.length - 1);
  });

  it("vraie carte : le tigre parti à 85 m du rond-point rejoint le rond-point", () => {
    const rp = trouverRondPoint(scene)!;
    const c = carteNavigation(reel, TIGRE_ROBOT.rayonCollision + 0.3);
    let essais = 0, reussites = 0;
    for (let a = 0; a < 8; a++) {
      const p: Vec3 = [rp.centre[0] + Math.cos((a * Math.PI) / 4) * 85, 0, rp.centre[1] + Math.sin((a * Math.PI) / 4) * 85];
      if (resoudre(reel, p, 4, 8).contacts.length) continue;
      essais++;
      let e: EtatMarcheur = { p, cap: 0, v: 0 };
      let t = 0, ch: [number, number][] | null = null, chT = -9;
      const cible: Vec3 = [rp.centre[0], 0, rp.centre[1] + rp.rayon + 6];
      while (Math.hypot(e.p[0] - cible[0], e.p[2] - cible[2]) > TIGRE_ROBOT.arret + 2 && t < 60) {
        if (t - chT > 1.2) { chT = t; ch = chemin(c, [e.p[0], e.p[2]], [cible[0], cible[2]]); }
        e = pasTigre(e, cible, 1 / 60, reel, ch ? pointDeVisee(reel, e.p, ch, TIGRE_ROBOT.rayonCollision) : null);
        t += 1 / 60;
      }
      if (t < 60) reussites++;
    }
    expect(essais).toBeGreaterThan(0);
    expect(reussites).toBe(essais);
  });
});
