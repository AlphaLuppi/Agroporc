/**
 * Équipements de toit SOLIDES : les caissons de clim, édicules, antennes et panneaux solaires que dessine `decor.ts` arrêtent les joueurs, les
 * bots et les balles, portent qui saute dessus, et disparaissent avec leur bâtiment. Testé sur le vrai scene.json.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placementsSolaires, placementsToit } from "../agroparc3d/facade";
import type { SceneData } from "../agroparc3d/types";
import { construireMondeBr } from "./br-carte";
import { creuserBatiment, construireMonde, detruireBatiment, lancerRayon, normaleImpact, releverBatiments, resoudre, solSous, type Monde } from "./collision";
import { etape, etatInitial, type Entrees } from "./mouvement";
import { equipementsSolides, type EquipementSolide } from "./toit-solide";
import { PAS_NAV_M, grilleNav } from "./tigre-arene";
import { construireMondeZombies } from "./zombies-carte";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const R = 0.4;

/** Premier bâtiment (index) qui porte un équipement du type donné, et cet équipement. */
function trouver(type: EquipementSolide["type"], exiger: (e: EquipementSolide) => boolean = () => true): { id: number; e: EquipementSolide } {
  for (let id = 0; id < scene.buildings.length; id++) {
    const e = equipementsSolides(scene.buildings[id], id).find((x) => x.type === type && exiger(x));
    if (e) return { id, e };
  }
  throw new Error(`aucun équipement ${type} dans scene.json`);
}
const centre = (e: EquipementSolide): [number, number] => [(e.x0 + e.x1) / 2, (e.z0 + e.z1) / 2];

describe("équipements solides : tirage", () => {
  it("reprennent exactement les tirages du décor (placementsToit puis placementsSolaires)", () => {
    let n = 0;
    scene.buildings.forEach((b, id) => {
      const attendu = b.type && b.type !== "mur" ? [] : [...placementsToit(b, id), ...placementsSolaires(b, id)];
      const solides = equipementsSolides(b, id);
      expect(solides.map((s) => s.type)).toEqual(attendu.map((a) => a.type));
      attendu.forEach((a, k) => {
        const [cx, cz] = centre(solides[k]);
        expect(cx).toBeCloseTo(a.x, 6);
        expect(cz).toBeCloseTo(a.z, 6);
        expect(solides[k].base).toBe(b.h);
        n++;
      });
    });
    expect(n).toBeGreaterThan(200);
  });

  it("une boîte pleine posée sur le toit : quatre coins, hauteur positive", () => {
    for (let id = 0; id < scene.buildings.length; id++) {
      for (const e of equipementsSolides(scene.buildings[id], id)) {
        expect(e.anneau).toHaveLength(4);
        expect(e.haut).toBeGreaterThan(e.base);
        expect(e.x1).toBeGreaterThan(e.x0);
      }
    }
  });

  it("le monde de l'arène range les équipements dans leur bâtiment, sans ajouter de prisme", () => {
    const monde = construireMonde(scene);
    const sans = monde.prismes.filter((p) => !p.toit).length;
    expect(monde.prismes.length).toBeGreaterThanOrEqual(scene.buildings.length);
    expect(monde.prismes.length - sans).toBeGreaterThan(50);
    const { id, e } = trouver("clim");
    expect(monde.prismes[id].toit?.length).toBe(equipementsSolides(scene.buildings[id], id).length);
    expect(monde.prismes[id].toit?.[0].base).toBe(e.base);
  });

  it("deux constructions du même monde sont identiques (client et serveur voient la même chose)", () => {
    expect(JSON.stringify(construireMonde(scene).prismes)).toBe(JSON.stringify(construireMonde(scene).prismes));
    expect(JSON.stringify(construireMondeBr(scene).prismes)).toBe(JSON.stringify(construireMondeBr(scene).prismes));
  });
});

describe("équipements solides : joueurs", () => {
  const { id, e } = trouver("clim");
  const [cx, cz] = centre(e);
  const h = e.base;

  it("un joueur debout sur le toit ne traverse pas la clim : poussé hors de la boîte", () => {
    const monde = construireMonde(scene);
    const r = resoudre(monde, [cx, h, cz], R, 1.8);
    expect(r.contacts.length).toBeGreaterThan(0);
    expect(r.contacts[0].prisme).toBe(id);
    // hors de la boîte tournée : distance au centre au moins un rayon de corps
    expect(Math.hypot(r.p[0] - cx, r.p[2] - cz)).toBeGreaterThan(R);
    expect(resoudre(monde, r.p, R, 1.8).contacts).toHaveLength(0);
  });

  it("marcher droit vers la clim depuis le toit : le joueur est arrêté contre elle", () => {
    const monde = construireMonde(scene);
    // on part à 6 m d'un côté, sur le toit, et on marche vers le centre de la boîte
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let arrete = 0;
    for (const [ux, uz] of dirs) {
      const depart: [number, number, number] = [cx - ux * 6, h, cz - uz * 6];
      // le point de départ doit être sur le toit de ce bâtiment (sinon on tomberait) : on saute les directions qui sortent du bâtiment
      if (solSous(monde, depart[0], depart[2], h) !== h) continue;
      let s = etatInitial(depart);
      const entrees: Entrees = { avant: 1, droite: 0, saut: false, sprint: false, lacet: Math.atan2(-ux, -uz) };
      for (let k = 0; k < 120; k++) s = etape(s, entrees, 1 / 60, monde);
      // jamais à l'intérieur de la boîte : le centre de la clim reste hors d'atteinte du corps
      if (s.p[1] < h + 0.5) { expect(Math.hypot(s.p[0] - cx, s.p[2] - cz)).toBeGreaterThan(R); arrete++; }
    }
    expect(arrete).toBeGreaterThan(0);
  });

  it("on monte dessus en sautant : le dessus porte, aucune poussée au-dessus", () => {
    const monde = construireMonde(scene);
    expect(solSous(monde, cx, cz, h)).toBe(h);
    expect(solSous(monde, cx, cz, e.haut)).toBe(e.haut);
    expect(solSous(monde, cx, cz, e.haut + 0.1)).toBe(e.haut);
    expect(resoudre(monde, [cx, e.haut, cz], R, 1.8).contacts).toHaveLength(0);
  });

  it("antenne, édicule et panneau solaire sont solides aussi", () => {
    const monde = construireMonde(scene);
    for (const type of ["edicule", "antenne", "solaire"] as const) {
      const t = trouver(type);
      const [x, z] = centre(t.e);
      expect(resoudre(monde, [x, t.e.base, z], R, 1.8).contacts.length, type).toBeGreaterThan(0);
      expect(solSous(monde, x, z, t.e.haut), type).toBe(t.e.haut);
    }
  });
});

describe("équipements solides : balles", () => {
  const { id, e } = trouver("clim");
  const [cx, cz] = centre(e);

  it("une balle rasante à mi-hauteur de la clim s'y arrête", () => {
    const monde = construireMonde(scene);
    const y = e.base + (e.haut - e.base) / 2;
    // de 4 m à l'ouest du centre vers le centre : touche la face ouest (ou un flanc) avant le centre
    const t = lancerRayon(monde, [cx - 4, y, cz], [1, 0, 0], 4);
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(4);
    // la même balle, sans les équipements du monde, passe
    const nu = construireMonde(scene);
    delete nu.prismes[id].toit;
    expect(lancerRayon(nu, [cx - 4, y, cz], [1, 0, 0], 4)).toBe(Infinity);
  });

  it("une balle de haut en bas touche le dessus de la clim, pas le toit", () => {
    const monde = construireMonde(scene);
    const t = lancerRayon(monde, [cx, e.haut + 3, cz], [0, -1, 0], 10);
    expect(t).toBeCloseTo(3, 3);
    expect(normaleImpact(monde, [cx, e.haut, cz], [cx, e.haut + 3, cz])).toEqual([0, 1, 0]);
  });

  it("une balle qui passe au-dessus de la clim n'est pas arrêtée", () => {
    const monde = construireMonde(scene);
    expect(lancerRayon(monde, [cx - 4, e.haut + 0.3, cz], [1, 0, 0], 4)).toBe(Infinity);
  });

  it("le flanc touché donne une normale horizontale tournée vers le tireur", () => {
    const monde = construireMonde(scene);
    const y = e.base + (e.haut - e.base) / 2;
    const t = lancerRayon(monde, [cx - 4, y, cz], [1, 0, 0], 4);
    const n = normaleImpact(monde, [cx - 4 + t, y, cz], [cx - 4, y, cz]);
    expect(n[1]).toBe(0);
    expect(n[0]).toBeLessThan(0);
  });
});

describe("équipements solides : destruction", () => {
  it("un bâtiment détruit perd ses équipements (plus de poussée, plus d'arrêt de balle), relevé il les retrouve", () => {
    const monde = construireMonde(scene);
    const { id, e } = trouver("clim");
    const [cx, cz] = centre(e);
    const y = e.base + 0.5;
    expect(lancerRayon(monde, [cx - 4, y, cz], [1, 0, 0], 4)).toBeLessThan(4);
    expect(detruireBatiment(monde, id)).toBe(true);
    expect(lancerRayon(monde, [cx - 4, y, cz], [1, 0, 0], 4)).toBe(Infinity);
    expect(resoudre(monde, [cx, e.base, cz], R, 1.8).contacts).toHaveLength(0);
    expect(solSous(monde, cx, cz, e.haut)).toBe(0);
    releverBatiments(monde);
    expect(lancerRayon(monde, [cx - 4, y, cz], [1, 0, 0], 4)).toBeLessThan(4);
  });

  it("une brèche qui couvre le centre de l'équipement l'arrache, une brèche ailleurs le laisse", () => {
    const monde = construireMonde(scene);
    const { id, e } = trouver("clim");
    const [cx, cz] = centre(e);
    const y = e.base + 0.5;
    // brèche petite, loin de l'équipement : il reste
    creuserBatiment(monde, id, cx + 40, cz + 40, 1);
    expect(lancerRayon(monde, [cx - 4, y, cz], [1, 0, 0], 4)).toBeLessThan(4);
    releverBatiments(monde);
    // brèche au pied de l'équipement (rayon 2 m, sous le seuil d'effondrement total) : il tombe
    const r = creuserBatiment(monde, id, cx, cz, 2);
    if (r === "breche") expect(lancerRayon(monde, [cx - 4, y, cz], [1, 0, 0], 4)).toBe(Infinity);
  });
});

describe("équipements solides : navigation et modes", () => {
  it("la grille de navigation des bots reste fermée sous les équipements (l'emprise du bâtiment est occupée)", () => {
    const monde: Monde = construireMonde(scene);
    const g = grilleNav(monde);
    let testes = 0;
    for (let id = 0; id < scene.buildings.length; id++) {
      for (const e of equipementsSolides(scene.buildings[id], id)) {
        const [cx, cz] = centre(e);
        // quelques bâtiments dépassent les bornes de l'arène (hors de la grille de navigation)
        const i = Math.floor((cx - g.x0) / PAS_NAV_M), j = Math.floor((cz - g.z0) / PAS_NAV_M);
        if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
        const k = i + j * g.nx;
        expect(g.libre[k]).toBe(0);
        testes++;
      }
    }
    expect(testes).toBeGreaterThan(200);
  });

  it("zombies : aucun équipement de toit (toits hors d'atteinte), arène et BR en ont", () => {
    expect(construireMondeZombies(scene).prismes.some((p) => p.toit)).toBe(false);
    expect(construireMonde(scene).prismes.some((p) => p.toit)).toBe(true);
    expect(construireMondeBr(scene).prismes.some((p) => p.toit)).toBe(true);
  });

  it("BR : les bâtiments creux n'ont pas d'équipement, les autres gardent les mêmes que l'arène", () => {
    const br = construireMondeBr(scene);
    const arene = construireMonde(scene);
    br.prismes.forEach((p, i) => {
      if (i >= scene.buildings.length) return;
      if (p.hOrigine === 0) expect(p.toit).toBeUndefined();
      else expect(JSON.stringify(p.toit)).toBe(JSON.stringify(arene.prismes[i].toit));
    });
  });
});
