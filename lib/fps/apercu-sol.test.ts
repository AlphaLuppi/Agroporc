import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine, dedans } from "../agroparc3d/cachettes";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { creerSolLibre } from "./apercu-sol";
import { bornesBr, donneesBr } from "./br-carte";
import { BORNES_ZOMBIES, donneesZombies } from "./zombies-carte";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const bornes = bornesBr(scene);

const dansBatimentPlein = (x: number, z: number): boolean =>
  scene.buildings.some((b) => dedans(x, z, b.r) && !(b.holes ?? []).some((h) => dedans(x, z, h)));
const dansEau = (x: number, z: number): boolean => scene.water.some((w) => dedans(x, z, w));

describe("sol libre (carte de l'arène)", () => {
  it("construit en moins de 50 ms (grille indexée)", () => {
    creerSolLibre(scene, bornes); // échauffement
    const t0 = performance.now();
    creerSolLibre(scene, bornes);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("aucun point tiré par pointLibre n'est dans un bâtiment plein ni dans l'eau (1 000 tirages par graine)", () => {
    const sol = creerSolLibre(scene, bornes);
    for (const graine of [1, 2, 3]) {
      const alea = aleaGraine(graine);
      for (let i = 0; i < 1000; i++) {
        const p = sol.pointLibre(alea, [28.2, 2.5], 25, 140);
        expect(dansBatimentPlein(p[0], p[1])).toBe(false);
        expect(dansEau(p[0], p[1])).toBe(false);
      }
    }
  });

  it("libre(x, z) est exact : égal à « dans les bornes, hors bâtiment plein et hors eau »", () => {
    const sol = creerSolLibre(scene, bornes);
    const alea = aleaGraine(9);
    for (let i = 0; i < 3000; i++) {
      const x = bornes.x0 + alea() * (bornes.x1 - bornes.x0), z = bornes.z0 + alea() * (bornes.z1 - bornes.z0);
      expect(sol.libre(x, z)).toBe(!dansBatimentPlein(x, z) && !dansEau(x, z));
    }
    expect(sol.libre(bornes.x0 - 1, 0)).toBe(false);
  });

  it("deplacer ne traverse jamais un mur (marche aléatoire de 20 000 pas)", () => {
    const sol = creerSolLibre(scene, bornes);
    const alea = aleaGraine(5);
    const p = sol.pointLibre(alea, [28.2, 2.5], 25, 140);
    const s: Vec2 = [0, 0];
    let x = p[0], z = p[1], a = 0;
    for (let i = 0; i < 20_000; i++) {
      if (i % 40 === 0) a = alea() * Math.PI * 2;
      sol.deplacer(x, z, Math.cos(a) * 0.25, Math.sin(a) * 0.25, s);
      x = s[0]; z = s[1];
      expect(dansBatimentPlein(x, z)).toBe(false);
    }
  });

  it("repli : un centre bloqué donne le point libre le plus proche", () => {
    const sol = creerSolLibre(scene, bornes);
    const b = scene.buildings[0];
    const p = sol.pointLibre(() => 0.5, b.c, 0, 0.1);
    expect(dansBatimentPlein(p[0], p[1])).toBe(false);
  });
});

describe("sol libre des cartes des zombies et du Battle Royale", () => {
  it("les bâtiments creusés se traversent (on marche dedans)", () => {
    const z = donneesZombies(scene).data;
    const sol = creerSolLibre(z, { ...BORNES_ZOMBIES });
    // le centre d'un bâtiment creusé des zombies est libre sur la carte des zombies, bloqué sur celle de l'arène
    const c = scene.buildings[72].c;
    expect(sol.libre(c[0], c[1])).toBe(true);
    expect(creerSolLibre(scene, bornes).libre(c[0], c[1])).toBe(false);
  });
  it("carte du Battle Royale : aucun point tiré dans un bâtiment plein de la carte", () => {
    const d = donneesBr(scene);
    const sol = creerSolLibre(d.data, bornes);
    const alea = aleaGraine(4);
    const pleins = d.data.buildings.filter((b) => !b.type);
    for (let i = 0; i < 500; i++) {
      const p = sol.pointLibre(alea, [0, 0], 0, 300);
      expect(pleins.some((b) => dedans(p[0], p[1], b.r))).toBe(false);
    }
  });
});
