import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aleaGraine, camerasRepos, DIRECTIONS_MASQUEES_MIN, ECART_MIN_M, MUR_MAX_M, estCache, evaluerPoints, genererCachettes, lireCachettes, palierDuRang, pointsDuRang, serialiserCachettes,
  tirerCachette, zoneJouable, type Cachette, type FichierCachettes, type PointNote,
} from "./cachettes";
import { REST } from "./scene";
import type { SceneData } from "./types";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const texteFichier = readFileSync("public/agroparc/cachettes.json", "utf8");
const fichier = JSON.parse(texteFichier) as FichierCachettes;
const cachettes = genererCachettes(scene, REST);

function dedans(x: number, z: number, r: [number, number][]): boolean {
  let d = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) d = !d;
  }
  return d;
}
function distSeg(x: number, z: number, a: [number, number], b: [number, number]): number {
  const ux = b[0] - a[0], uz = b[1] - a[1], l2 = ux * ux + uz * uz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * ux + (z - a[1]) * uz) / l2)) : 0;
  return Math.hypot(x - a[0] - t * ux, z - a[1] - t * uz);
}

describe("cachettes du tigre (vrai scene.json)", () => {
  it("garde au moins 500 cachettes, dans la zone jouable", () => {
    expect(cachettes.length).toBeGreaterThanOrEqual(500);
    const z = zoneJouable(scene);
    for (const c of cachettes) {
      expect(c.x).toBeGreaterThanOrEqual(z.x0);
      expect(c.x).toBeLessThanOrEqual(z.x1);
      expect(c.z).toBeGreaterThanOrEqual(z.z0);
      expect(c.z).toBeLessThanOrEqual(z.z1);
    }
  });

  it("aucune cachette dans un bâtiment, à moins de 1,5 m d'un mur ou de 4 m d'une route", () => {
    // Une seule assertion par critère (des millions d'expect seraient trop lents).
    let interieur = 0, dMur = Infinity, dRoute = Infinity;
    for (const c of cachettes) {
      for (const b of scene.buildings) {
        if (dedans(c.x, c.z, b.r)) interieur++;
        for (let i = 0, j = b.r.length - 1; i < b.r.length; j = i++) dMur = Math.min(dMur, distSeg(c.x, c.z, b.r[j], b.r[i]));
      }
      for (const r of scene.roads) for (let i = 0; i < r.p.length - 1; i++) dRoute = Math.min(dRoute, distSeg(c.x, c.z, r.p[i], r.p[i + 1]));
    }
    expect(interieur).toBe(0);
    // Arrondi du fichier à 0,1 m : tolérance de 0,1 m.
    expect(dMur).toBeGreaterThan(1.4);
    expect(dRoute).toBeGreaterThan(3.9);
  });

  it("aucune cachette dans l'eau", () => {
    for (const c of cachettes) for (const w of scene.water) expect(dedans(c.x, c.z, w)).toBe(false);
  });

  it("rang de 0 à 1 dans l'ordre de la difficulté, points de 100 à 500 et paliers par tiers", () => {
    expect(cachettes[0].rang).toBe(0);
    expect(cachettes[cachettes.length - 1].rang).toBe(1);
    for (let i = 1; i < cachettes.length; i++) {
      expect(cachettes[i].difficulte).toBeGreaterThanOrEqual(cachettes[i - 1].difficulte);
      expect(cachettes[i].rang).toBeGreaterThan(cachettes[i - 1].rang);
    }
    expect(cachettes[0].points).toBe(100);
    expect(cachettes[cachettes.length - 1].points).toBe(500);
    for (const c of cachettes) {
      expect(c.points % 10).toBe(0);
      expect(c.difficulte).toBeGreaterThanOrEqual(0);
      expect(c.difficulte).toBeLessThanOrEqual(1);
    }
    const parPalier = { facile: 0, moyenne: 0, difficile: 0 };
    for (const c of cachettes) parPalier[c.palier]++;
    for (const n of Object.values(parPalier)) expect(Math.abs(n - cachettes.length / 3)).toBeLessThanOrEqual(2);
  });

  it("chaque cachette, dans chaque palier, est contre un mur et masquée depuis au moins 2 des 8 caméras", () => {
    // Règle de l'utilisateur : le tigre est bien caché à chaque fois, même dans le palier facile.
    const notes = new Map(evaluerPoints(scene, REST).map((p) => [`${Math.round(p.x * 10) / 10},${Math.round(p.z * 10) / 10}`, p]));
    const parPalier = { facile: [] as PointNote[], moyenne: [] as PointNote[], difficile: [] as PointNote[] };
    for (const c of cachettes) {
      const p = notes.get(`${c.x},${c.z}`);
      expect(p).toBeDefined();
      parPalier[c.palier].push(p!);
    }
    for (const liste of Object.values(parPalier)) {
      expect(liste.every(estCache)).toBe(true);
      expect(Math.min(...liste.map((p) => p.directions))).toBeGreaterThanOrEqual(DIRECTIONS_MASQUEES_MIN);
      expect(Math.min(...liste.map((p) => p.masquage))).toBeGreaterThan(0);
      expect(Math.max(...liste.map((p) => p.mur))).toBeLessThan(MUR_MAX_M);
    }
    // Le filtre écarte bien des points : la plupart des points de la zone sont à découvert.
    expect([...notes.values()].filter(estCache).length).toBeLessThan(notes.size / 2);
  });

  it("le fichier précalculé se régénère à l'identique (et a été calculé avec REST de scene.ts)", () => {
    expect(fichier.repos).toEqual({ dx: REST.dx, y: REST.y, dz: REST.dz });
    expect(serialiserCachettes(cachettes, REST)).toBe(texteFichier);
    expect(lireCachettes(fichier)).toEqual(cachettes);
  });

  it("le script hors ligne réécrit le même fichier, à l'octet", () => {
    const dossier = mkdtempSync(join(tmpdir(), "cachettes-"));
    try {
      const sortie = join(dossier, "cachettes.json");
      execFileSync(process.execPath, ["scripts/agroparc/generer_cachettes.mjs", "public/agroparc/scene.json", sortie], { stdio: "pipe" });
      expect(readFileSync(sortie, "utf8")).toBe(texteFichier);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("caméras de notation", () => {
  it("8 positions : REST puis ses rotations de 45° autour du point visé, à la même distance", () => {
    const cams = camerasRepos(scene.focus, REST);
    expect(cams).toHaveLength(8);
    expect(cams[0][0]).toBeCloseTo(scene.focus[0] + REST.dx, 6);
    expect(cams[0][2]).toBeCloseTo(scene.focus[1] + REST.dz, 6);
    const r = Math.hypot(REST.dx, REST.dz);
    for (const [x, y, z] of cams) {
      expect(y).toBe(REST.y);
      expect(Math.hypot(x - scene.focus[0], z - scene.focus[1])).toBeCloseTo(r, 6);
    }
    // Quatrième rotation : à l'opposé du repos.
    expect(cams[4][0]).toBeCloseTo(scene.focus[0] - REST.dx, 6);
    expect(cams[4][2]).toBeCloseTo(scene.focus[1] - REST.dz, 6);
  });
});

describe("masquage", () => {
  // Un bâtiment de 10 m sur une scène minimale : un tigre collé au mur côté opposé aux caméras est masqué.
  const mini: SceneData = {
    center: [0, 0], buildings: [{ h: 10, r: [[-20, -5], [20, -5], [20, 5], [-20, 5]], c: [0, 0] }],
    roads: [], routes: [], trees: [], parkings: [], water: [], wlines: [], pois: [], truckRoad: [], busRoutes: [], busStops: [],
    focus: [0, 0],
  };
  it("un point le long du mur est plus difficile qu'un point en plein champ, pourtant plus éloigné", () => {
    const liste = evaluerPoints(mini, { dx: 0, y: 230, dz: 380 });
    const auMur = liste.filter((c) => Math.abs(c.z) > 5 && Math.abs(c.z) < 14 && Math.abs(c.x) < 15);
    const champ = liste.filter((c) => Math.abs(c.x) > 45);
    expect(auMur.length).toBeGreaterThan(3);
    expect(champ.length).toBeGreaterThan(3);
    const moy = (l: PointNote[]) => l.reduce((s, c) => s + c.difficulte, 0) / l.length;
    expect(moy(auMur)).toBeGreaterThan(moy(champ) + 0.05);
    // Le tigre se couche le long du mur (est-ouest) : cap ≈ ±π/2.
    for (const c of auMur) expect(Math.abs(Math.abs(c.cap) - Math.PI / 2)).toBeLessThan(0.05);
  });

  it("aucun point en plein champ n'est gardé comme cachette, seulement des points masqués par le bâtiment", () => {
    const liste = genererCachettes(mini, { dx: 0, y: 230, dz: 380 });
    expect(liste.length).toBeGreaterThan(0);
    for (const c of liste) {
      expect(Math.abs(c.x)).toBeLessThan(45);
      expect(Math.abs(c.z)).toBeLessThan(45);
    }
  });
});

describe("paliers et points", () => {
  it("bornes", () => {
    expect(palierDuRang(0)).toBe("facile");
    expect(palierDuRang(0.34)).toBe("moyenne");
    expect(palierDuRang(0.67)).toBe("difficile");
    expect(pointsDuRang(0)).toBe(100);
    expect(pointsDuRang(0.5)).toBe(300);
    expect(pointsDuRang(1)).toBe(500);
    expect(pointsDuRang(0.123)).toBe(150);
  });
});

describe("tirage", () => {
  it("avec une graine : même suite de cachettes", () => {
    const suite = (graine: number) => {
      const alea = aleaGraine(graine);
      const prec: Cachette[] = [];
      for (let i = 0; i < 20; i++) prec.push(tirerCachette(cachettes, prec, alea)!);
      return prec;
    };
    expect(suite(7)).toEqual(suite(7));
    expect(suite(7)).not.toEqual(suite(8));
  });

  it("jamais à moins de 80 m d'une des 5 cachettes précédentes", () => {
    const alea = aleaGraine(42);
    const prec: Cachette[] = [];
    for (let i = 0; i < 300; i++) {
      const c = tirerCachette(cachettes, prec, alea)!;
      for (const p of prec.slice(-5)) expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeGreaterThanOrEqual(ECART_MIN_M);
      prec.push(c);
    }
  });

  it("paliers tirés à 15 / 45 / 40 %", () => {
    const alea = aleaGraine(3);
    const n = 6000;
    const compte = { facile: 0, moyenne: 0, difficile: 0 };
    for (let i = 0; i < n; i++) compte[tirerCachette(cachettes, [], alea)!.palier]++;
    expect(compte.facile / n).toBeCloseTo(0.15, 1);
    expect(compte.moyenne / n).toBeCloseTo(0.45, 1);
    expect(compte.difficile / n).toBeCloseTo(0.4, 1);
  });

  it("repli : palier sans cachette assez loin, puis aucune cachette assez loin", () => {
    const c = (x: number, palier: Cachette["palier"]): Cachette => ({ x, z: 0, cap: 0, difficulte: 0, rang: 0, points: 100, palier });
    const liste = [c(0, "facile"), c(200, "moyenne")];
    // Palier « facile » forcé (premier tirage < 0,15), seule cachette facile trop proche : on prend l'autre palier.
    const forceFacile = (() => { const v = [0.01, 0.5]; let i = 0; return () => v[i++ % v.length]; })();
    expect(tirerCachette(liste, [{ x: 10, z: 0 }], forceFacile)).toBe(liste[1]);
    // Toutes trop proches : la règle des 80 m est levée, le palier tiré est gardé.
    const forceFacile2 = (() => { const v = [0.01, 0.5]; let i = 0; return () => v[i++ % v.length]; })();
    expect(tirerCachette(liste, [{ x: 10, z: 0 }, { x: 190, z: 0 }], forceFacile2)).toBe(liste[0]);
    expect(tirerCachette([], [], Math.random)).toBeNull();
  });
});
