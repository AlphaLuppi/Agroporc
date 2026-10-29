import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dansAnneau, pointSegment } from "./geo";
import { PLACE_LARGEUR_M, PLACE_PROFONDEUR_M, PARKING_MIN_M2, placesParking } from "./parkings";
import type { SceneData } from "./types";
import { DEMI_LARGEUR } from "./voirie";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const t0 = performance.now();
const places = placesParking(scene);
const ms = performance.now() - t0;

const aire = (r: readonly [number, number][]) => { let a = 0; for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; } return Math.abs(a / 2); };
const grands = scene.parkings.filter((p) => aire(p) >= PARKING_MIN_M2);

describe("placesParking", () => {
  it("1 000 à 4 000 séparateurs", () => {
    console.log(`placesParking : ${places.length / 4} séparateurs en ${ms.toFixed(0)} ms`);
    expect(places.length / 4).toBeGreaterThanOrEqual(1000);
    expect(places.length / 4).toBeLessThanOrEqual(4000);
  });

  it("chaque séparateur : 5 m, dans un parking d'au moins 150 m², hors bâtiment, hors chaussée des voies carrossables", () => {
    let pris = 0;
    for (let i = 0; i < places.length; i += 4) {
      const [ax, az, bx, bz] = places.slice(i, i + 4);
      expect(Math.hypot(bx - ax, bz - az)).toBeCloseTo(PLACE_PROFONDEUR_M, 5);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (i % 40 !== 0) continue; // échantillon : un séparateur sur dix (le test reste rapide)
      pris++;
      expect(grands.some((p) => dansAnneau(mx, mz, p)), `séparateur à (${mx.toFixed(1)}, ${mz.toFixed(1)})`).toBe(true);
      expect(scene.buildings.some((b) => (!b.type || b.type === "mur") && dansAnneau(mx, mz, b.r) && !(b.holes ?? []).some((h) => dansAnneau(mx, mz, h)))).toBe(false);
      for (const r of scene.roads) {
        if (r.c === "F") continue;
        for (let k = 0; k < r.p.length - 1; k++) {
          expect(pointSegment(mx, mz, r.p[k][0], r.p[k][1], r.p[k + 1][0], r.p[k + 1][1]).d).toBeGreaterThanOrEqual(DEMI_LARGEUR[r.c] + 0.3 - 1e-6);
        }
      }
    }
    expect(pris).toBeGreaterThan(80);
  });

  it("les séparateurs d'une rangée sont espacés de 2,5 m", () => {
    // deux séparateurs voisins d'une même rangée sont à 2,5 m (le plus proche voisin de la plupart d'entre eux)
    const pts: [number, number][] = [];
    for (let i = 0; i < places.length; i += 4) pts.push([(places[i] + places[i + 2]) / 2, (places[i + 1] + places[i + 3]) / 2]);
    let bons = 0;
    const echantillon = pts.filter((_, i) => i % 25 === 0);
    for (const p of echantillon) {
      let d = Infinity;
      for (const q of pts) if (q !== p) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1]));
      if (Math.abs(d - PLACE_LARGEUR_M) < 0.05) bons++;
    }
    expect(bons / echantillon.length).toBeGreaterThan(0.85);
  });

  it("les boîtes exclues (carte des zombies) n'ont aucun séparateur ; déterministe", () => {
    const boite = { x0: -300, z0: -300, x1: 300, z1: 300 };
    const sans = placesParking({ ...scene, parkings: scene.parkings.map((p) => [...p]) }, [boite]);
    for (let i = 0; i < sans.length; i += 4) {
      const mx = (sans[i] + sans[i + 2]) / 2, mz = (sans[i + 1] + sans[i + 3]) / 2;
      expect(mx < -300 || mx > 300 || mz < -300 || mz > 300).toBe(true);
    }
    expect(sans.length).toBeLessThan(places.length);
    expect(placesParking({ ...scene, parkings: scene.parkings.map((p) => [...p]) })).toEqual(places);
  });
});
