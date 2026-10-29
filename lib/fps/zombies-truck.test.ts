import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { aleaGraine } from "../agroparc3d/cachettes";
import { DEPARTS, ZONES, construireMondeZombies, etiqueterZones, zoneEn, type ZoneId } from "./zombies-carte";
import {
  ECLAIRS, centreSouffleMini, choisirPointEclair, degatsSouffleMiniJoueur, degatsSouffleMiniTigre, intervalleEclairMs, pointsEclair,
} from "./zombies-truck";
import { ZOMBIES } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const carte = etiqueterZones(construireMondeZombies(scene));
const POINTS = pointsEclair(carte);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("points de foudre", () => {
  it("couvrent toutes les zones, intérieurs compris (l'open space de départ), loin des murs", () => {
    const zones = new Set(POINTS.map((p) => p.zone));
    for (const z of ZONES) expect(zones.has(z.id), z.id).toBe(true);
    for (const { zone, p } of POINTS) expect(zoneEn(carte, p[0], p[1])).toBe(zone);
    expect(POINTS.filter((p) => p.zone === "open").length).toBeGreaterThan(20);
  });

  it("frappe entre 6 et 18 m d'un joueur, dans une zone active, à plus de 4 m de chacun et à l'écart des ennemis", () => {
    const alea = aleaGraine(3);
    const actives = new Set<ZoneId>(["open"]);
    const joueurs: Vec2[] = [DEPARTS[0], DEPARTS[3]];
    for (let k = 0; k < 50; k++) {
      const p = choisirPointEclair(POINTS, actives, joueurs, [], alea)!;
      expect(p).not.toBeNull();
      expect(zoneEn(carte, p[0], p[1])).toBe("open");
      const dmin = Math.min(...joueurs.map((j) => dist(j, p)));
      expect(dmin).toBeGreaterThanOrEqual(ECLAIRS.distanceMinAutresM);
      expect(joueurs.some((j) => dist(j, p) >= ECLAIRS.distanceMinM && dist(j, p) <= ECLAIRS.distanceMaxM)).toBe(true);
    }
    // un ennemi sur un point : jamais choisi
    const occupe = choisirPointEclair(POINTS, actives, [DEPARTS[0]], [], () => 0)!;
    for (let k = 0; k < 20; k++) {
      const p = choisirPointEclair(POINTS, actives, [DEPARTS[0]], [occupe], alea);
      if (p) expect(dist(p, occupe)).toBeGreaterThanOrEqual(ECLAIRS.distanceEnnemisM);
    }
  });

  it("aucun point hors des zones actives, ni sans joueur", () => {
    expect(choisirPointEclair(POINTS, new Set<ZoneId>(), [DEPARTS[0]], [], Math.random)).toBeNull();
    expect(choisirPointEclair(POINTS, new Set<ZoneId>(["open"]), [], [], Math.random)).toBeNull();
    // un joueur loin de toute zone active : on essaie les autres
    const p = choisirPointEclair(POINTS, new Set<ZoneId>(["open"]), [[500, 500], DEPARTS[2]], [], () => 0);
    expect(p).not.toBeNull();
    expect(dist(p!, DEPARTS[2])).toBeLessThanOrEqual(ECLAIRS.distanceMaxM);
  });
});

describe("cadence des éclairs", () => {
  it("1,4 / 1,15 / 0,95 / 0,8 s selon la livraison, de plus en plus court au fil de la manche, jamais sous 0,35 s", () => {
    expect([1, 2, 3, 4, 9].map((n) => intervalleEclairMs(n, 0))).toEqual([1400, 1150, 950, 800, 800]);
    expect(intervalleEclairMs(1, 1)).toBe(700);
    expect(intervalleEclairMs(1, 0.5)).toBeLessThan(intervalleEclairMs(1, 0.2));
    expect(intervalleEclairMs(4, 1)).toBe(400);
    expect(intervalleEclairMs(0, -1)).toBe(1400);
    for (let n = 1; n < 8; n++) for (let f = 0; f <= 1; f += 0.1) expect(intervalleEclairMs(n, f)).toBeGreaterThanOrEqual(350);
  });
});

describe("souffle du mini Truck", () => {
  it("joueur : 80 au centre, 15 au bord (4,5 m), rien au-delà ; selon la difficulté", () => {
    expect(degatsSouffleMiniJoueur(0)).toBe(80);
    expect(degatsSouffleMiniJoueur(ZOMBIES.miniTruck.souffleM)).toBe(15);
    expect(degatsSouffleMiniJoueur(ZOMBIES.miniTruck.souffleM + 0.01)).toBe(0);
    expect(degatsSouffleMiniJoueur(2.25)).toBe(48);
    expect([degatsSouffleMiniJoueur(0, "entree"), degatsSouffleMiniJoueur(0, "goulaf")]).toEqual([60, 100]);
    expect(degatsSouffleMiniJoueur(Number.NaN)).toBe(0);
    // deux mini Trucks à bout portant couchent un joueur sans Gratin, pas un joueur au Gratin
    expect(2 * degatsSouffleMiniJoueur(0)).toBeGreaterThanOrEqual(ZOMBIES.pvMax);
    expect(2 * degatsSouffleMiniJoueur(0)).toBeLessThan(ZOMBIES.pvMaxGratin);
  });

  it("tigres : 1 600 au centre à 400 au bord (un petit de la première livraison y passe), centre à mi-hauteur de la caisse", () => {
    expect(degatsSouffleMiniTigre(0)).toBe(1600);
    expect(degatsSouffleMiniTigre(ZOMBIES.miniTruck.souffleM)).toBe(400);
    expect(degatsSouffleMiniTigre(9)).toBe(0);
    expect(centreSouffleMini([3, 0, 4])).toEqual([3, 0.5, 4]);
  });
});
