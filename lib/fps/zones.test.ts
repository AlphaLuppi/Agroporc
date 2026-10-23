import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine, dedans, distSegment } from "../agroparc3d/cachettes";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde, pointsApparition } from "./collision";
import { SILHOUETTE } from "./protocole";
import {
  EMPLACEMENTS_VOITURES, ROND_POINT, ZONE_APPARITION, capDepuisDirection, choisirPointZone, filtrerApparitions, lacetVers, positionElsa, trouverRondPoint,
  type ZoneApparition,
  TRUCK, obstacleTruck, placeTruck,
} from "./zones";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMonde(scene);
const zone: ZoneApparition = { centre: ROND_POINT.centre, ...ZONE_APPARITION };
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Distance d'un point à l'anneau extérieur le plus proche parmi tous les bâtiments. */
function distBatiments(x: number, z: number): number {
  let d = Infinity;
  for (const b of scene.buildings) {
    for (let i = 0, j = b.r.length - 1; i < b.r.length; j = i++) d = Math.min(d, distSegment(x, z, b.r[j][0], b.r[j][1], b.r[i][0], b.r[i][1]));
  }
  return d;
}
function distEau(x: number, z: number): number {
  let d = Infinity;
  for (const w of scene.water) {
    if (dedans(x, z, w)) return 0;
    for (let i = 0, j = w.length - 1; i < w.length; j = i++) d = Math.min(d, distSegment(x, z, w[j][0], w[j][1], w[i][0], w[i][1]));
  }
  return d;
}

describe("constantes (annexe §10)", () => {
  it("rond-point et anneau", () => {
    expect(ROND_POINT.centre).toEqual([28.2, 2.5]);
    expect(ROND_POINT.rayon).toBe(18.1);
    expect(ZONE_APPARITION).toMatchObject({ rMin: 25, rMax: 140, bandeMin: 40, bandeMax: 110, bandeCible: 75 });
  });
});

describe("trouverRondPoint (vrai scene.json)", () => {
  it("retrouve le rond-point à 0,5 m près", () => {
    const r = trouverRondPoint(scene)!;
    expect(r).not.toBeNull();
    expect(dist(r.centre, ROND_POINT.centre)).toBeLessThan(0.5);
    expect(Math.abs(r.rayon - ROND_POINT.rayon)).toBeLessThan(0.5);
  });
  it("null sans rond-point", () => {
    expect(trouverRondPoint({ ...scene, roads: scene.roads.filter((_, i) => ![4, 120, 121, 122].includes(i)) })).toBeNull();
    expect(trouverRondPoint({ ...scene, roads: [] })).toBeNull();
  });
  it("ignore les routes droites et les arcs qui ne font pas le tour", () => {
    // 3 arcs d'un quart de cercle seulement : trou de 90° sur... on garde 2 arcs de 90° (trou > 120°).
    const arc = (a0: number, a1: number) => ({ c: "M" as const, p: Array.from({ length: 5 }, (_, k) => {
      const a = a0 + ((a1 - a0) * k) / 4;
      return [20 * Math.cos(a), 20 * Math.sin(a)] as Vec2;
    }) });
    const quartDeTour = { ...scene, roads: [arc(0, Math.PI / 2), arc(Math.PI / 2, Math.PI), arc(Math.PI, 1.2 * Math.PI)] };
    expect(trouverRondPoint(quartDeTour)).toBeNull();
    const complet = { ...scene, roads: [arc(0, 2.1), arc(2.1, 4.2), arc(4.2, 2 * Math.PI)] };
    const r = trouverRondPoint(complet)!;
    expect(r.rayon).toBeCloseTo(20, 3);
    expect(Math.hypot(r.centre[0], r.centre[1])).toBeLessThan(1e-6);
  });
});

describe("filtrerApparitions", () => {
  const points = pointsApparition(scene, monde);
  const reservoir = filtrerApparitions(points);
  it("garde les points de l'anneau 25-140 m (≥ 100, ≥ 16 distincts)", () => {
    expect(reservoir.length).toBeGreaterThanOrEqual(100);
    expect(reservoir.length).toBeLessThan(points.length);
    expect(new Set(reservoir.map((p) => p.join(","))).size).toBeGreaterThanOrEqual(16);
    for (const p of reservoir) {
      const d = dist(p, ROND_POINT.centre);
      expect(d).toBeGreaterThanOrEqual(25);
      expect(d).toBeLessThanOrEqual(140);
    }
  });
  it("accepte une zone explicite et ne modifie pas l'entrée", () => {
    const entree: Vec2[] = [[0, 0], [10, 0], [20, 0], [30, 0]];
    const copie = entree.map((p) => [...p]);
    expect(filtrerApparitions(entree, { ...zone, centre: [0, 0], rMin: 5, rMax: 25 })).toEqual([[10, 0], [20, 0]]);
    expect(entree).toEqual(copie);
  });
});

describe("choisirPointZone", () => {
  const reservoir = filtrerApparitions(pointsApparition(scene, monde));
  const plusProche = (p: Vec2, ennemis: Vec2[]) => Math.min(...ennemis.map((e) => dist(p, e)));
  const mediane = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

  /** Ennemis tirés dans l'anneau (graine fixe), 2 000 tirages. */
  function essai(nbEnnemis: number, graine: number) {
    const alea = aleaGraine(graine);
    const distances: number[] = [];
    let horsBande = 0;
    for (let k = 0; k < 2000; k++) {
      const ennemis = Array.from({ length: nbEnnemis }, () => reservoir[Math.floor(alea() * reservoir.length)]);
      const p = choisirPointZone(reservoir, ennemis, zone, alea);
      const d = plusProche(p, ennemis);
      distances.push(d);
      const enBande = reservoir.filter((q) => { const dq = plusProche(q, ennemis); return dq >= 40 && dq <= 110; }).length;
      if (enBande >= 3 && (d < 40 || d > 110)) horsBande++;
    }
    return { mediane: mediane(distances), horsBande };
  }

  it("1 ennemi : médiane ≤ 100 m, bande respectée", () => {
    const r = essai(1, 11);
    expect(r.horsBande).toBe(0);
    expect(r.mediane).toBeLessThanOrEqual(100);
  });
  it("3 ennemis : médiane ≤ 90 m, bande respectée", () => {
    const r = essai(3, 22);
    expect(r.horsBande).toBe(0);
    expect(r.mediane).toBeLessThanOrEqual(90);
  });
  it("7 ennemis : médiane ≤ 80 m, bande respectée", () => {
    const r = essai(7, 33);
    expect(r.horsBande).toBe(0);
    expect(r.mediane).toBeLessThanOrEqual(80);
  });
  it("repli : ennemi à 400 m ⇒ un des 6 points les plus proches de 75 m", () => {
    const ennemis: Vec2[] = [[400, 0]];
    const attendus = [...reservoir].sort((a, b) => Math.abs(plusProche(a, ennemis) - 75) - Math.abs(plusProche(b, ennemis) - 75)).slice(0, 6);
    const alea = aleaGraine(5);
    const vus = new Set<string>();
    for (let k = 0; k < 300; k++) {
      const p = choisirPointZone(reservoir, ennemis, zone, alea);
      expect(attendus.some((a) => a[0] === p[0] && a[1] === p[1])).toBe(true);
      vus.add(p.join(","));
    }
    expect(vus.size).toBeGreaterThan(1);
  });
  it("sans ennemi : tirage uniforme sur tout le réservoir", () => {
    const alea = aleaGraine(9);
    const vus = new Set<string>();
    for (let k = 0; k < 5000; k++) vus.add(choisirPointZone(reservoir, [], zone, alea).join(","));
    expect(vus.size).toBeGreaterThan(reservoir.length * 0.9);
  });
  it("réservoir vide : le centre de la zone (copie)", () => {
    const p = choisirPointZone([], [[0, 0]], zone, () => 0.5);
    expect(p).toEqual(zone.centre);
    expect(p).not.toBe(zone.centre);
  });
  it("alea = 0,999… : indice borné", () => {
    expect(() => choisirPointZone(reservoir, [[400, 0]], zone, () => 0.9999999)).not.toThrow();
    expect(() => choisirPointZone(reservoir, [], zone, () => 0.9999999)).not.toThrow();
  });
  it("déterministe pour une graine", () => {
    const suite = (g: number) => {
      const alea = aleaGraine(g);
      return Array.from({ length: 50 }, () => choisirPointZone(reservoir, [[100, 20], [-30, 60]], zone, alea));
    };
    expect(suite(77)).toEqual(suite(77));
    expect(suite(77)).not.toEqual(suite(78));
  });
});

describe("Truck Muche garé et positionElsa (v3 §2)", () => {
  it("le truck est garé sur le POI, dans le sens d'arrivée (nez vers l'ouest-sud-ouest), loin des bâtiments", () => {
    const t = placeTruck(scene);
    expect([t.x, t.z]).toEqual([-125, 39]);
    // avant (−sin cap, −cos cap) : vers l'ouest et le nord (z < 0), comme le trajet de la vue aérienne
    expect(-Math.sin(t.cap)).toBeLessThan(-0.6);
    expect(-Math.cos(t.cap)).toBeLessThan(-0.3);
    const o = obstacleTruck(scene)!;
    for (const [x, z] of o.r) expect(distBatiments(x, z)).toBeGreaterThan(5);
  });
  it("Elsa est dans la caisse, le point de service dehors devant le passe-plat, à > 10 m des bâtiments, hors eau", () => {
    const t = placeTruck(scene);
    const o = obstacleTruck(scene)!;
    expect(dedans(t.elsa[0], t.elsa[1], o.r)).toBe(true);
    const p = positionElsa(scene);
    expect(p).toEqual(t.service);
    expect(dedans(p[0], p[1], o.r)).toBe(false);
    expect(distBatiments(p[0], p[1])).toBeGreaterThan(10);
    expect(distEau(p[0], p[1])).toBeGreaterThan(0);
    // aucun prisme du monde (truck compris) ne contient ce point, et un joueur collé au flanc est à portée de ramassage (2,5 m)
    expect(monde.prismes.some((b) => dedans(p[0], p[1], b.anneau))).toBe(false);
    expect(TRUCK.avanceService - SILHOUETTE.rayon).toBeLessThan(2.5);
    // le passe-plat (Elsa → service) est perpendiculaire au flanc : 0,75 + 1,4 m
    expect(Math.hypot(p[0] - t.elsa[0], p[1] - t.elsa[1])).toBeCloseTo(TRUCK.retraitElsa + TRUCK.avanceService, 1);
  });
  it("repli (−120 ; 39) sans POI truck, suit le POI sinon", () => {
    expect(positionElsa({ ...scene, pois: [] })).toEqual([-120, 39]);
    expect(obstacleTruck({ ...scene, pois: [] })).toBeNull();
    const deplace = { ...scene, pois: scene.pois.map((p) => (p.type === "truck" ? { ...p, x: 10, z: -4 } : p)) };
    const t = placeTruck(deplace);
    expect([t.x, t.z]).toEqual([10, -4]);
    expect(Math.hypot(positionElsa(deplace)[0] - 10, positionElsa(deplace)[1] + 4)).toBeGreaterThan(TRUCK.largeur / 2);
  });
});

describe("EMPLACEMENTS_VOITURES", () => {
  const parking = scene.parkings[3];
  it("6 points dans parkings[3], à > 3,5 m des bâtiments et de l'eau, cap ≈ −1,808", () => {
    expect(EMPLACEMENTS_VOITURES).toHaveLength(6);
    for (const e of EMPLACEMENTS_VOITURES) {
      expect(dedans(e.p[0], e.p[1], parking)).toBe(true);
      expect(distBatiments(e.p[0], e.p[1])).toBeGreaterThan(3.5);
      expect(distEau(e.p[0], e.p[1])).toBeGreaterThan(3.5);
      expect(e.cap).toBeCloseTo(-1.808, 3);
    }
  });
  it("emplacements distincts (≥ 8 m entre eux)", () => {
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) expect(dist(EMPLACEMENTS_VOITURES[i].p, EMPLACEMENTS_VOITURES[j].p)).toBeGreaterThan(8);
  });
  it("à 33-54 m environ du rond-point (annexe : 58 m pour le parking)", () => {
    for (const e of EMPLACEMENTS_VOITURES) expect(dist(e.p, ROND_POINT.centre)).toBeGreaterThan(30);
  });
});

describe("lacetVers / capDepuisDirection", () => {
  it("0 = vers −z, ±π/2 = vers ∓x, π = vers +z", () => {
    expect(capDepuisDirection(0, -1)).toBeCloseTo(0, 12);
    expect(capDepuisDirection(1, 0)).toBeCloseTo(-Math.PI / 2, 12);
    expect(capDepuisDirection(-1, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(Math.abs(capDepuisDirection(0, 1))).toBeCloseTo(Math.PI, 12);
  });
  it("cap du parking : l'axe long à +13,6° donne −1,808", () => {
    const a = (13.6 * Math.PI) / 180;
    expect(capDepuisDirection(Math.cos(a), Math.sin(a))).toBeCloseTo(-1.808, 3);
  });
  it("lacetVers regarde de `de` vers `vers`", () => {
    expect(lacetVers([0, 0], [0, -10])).toBeCloseTo(0, 12);
    expect(lacetVers([5, 5], [15, 5])).toBeCloseTo(-Math.PI / 2, 12);
    expect(lacetVers([10, 10], [0, 10])).toBeCloseTo(Math.PI / 2, 12);
  });
});
