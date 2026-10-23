import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { STATS, directionsTir } from "./armes";
import { TANGAGE_MAX, directionVisee, rotationCamera, tangageDeVue } from "./jeu-visee";
import { ARMES } from "./protocole";
import { directionRegard } from "./vue";

/** Direction vers laquelle regarde réellement une caméra three réglée avec ces angles (ordre YXZ, comme jeu.ts). */
function regardCamera(lacet: number, tangage: number, kick: number, inclinaison = 0, secousse = 0): [number, number, number] {
  const cam = new THREE.PerspectiveCamera();
  cam.rotation.order = "YXZ";
  const [x, y, z] = rotationCamera(lacet, tangage, kick, inclinaison, secousse);
  cam.rotation.set(x, y, z);
  const d = cam.getWorldDirection(new THREE.Vector3());
  return [d.x, d.y, d.z];
}

const ECHANTILLONS: [number, number, number][] = [
  [0, 0, 0], [0.7, 0.2, 0], [-2.1, -0.4, 0.03], [3.0, 0.9, 0.05], [1.2, -1.2, 0.2], [-0.3, 1.5, 0.1], [6.5, 0.1, -0.02],
];

describe("tangageDeVue", () => {
  it("somme le tangage et le recul visuel", () => {
    expect(tangageDeVue(0.2, 0.05)).toBeCloseTo(0.25, 12);
    expect(tangageDeVue(-0.2, 0)).toBe(-0.2);
  });
  it("est borné juste avant la verticale", () => {
    expect(tangageDeVue(1.5, 0.5)).toBe(TANGAGE_MAX);
    expect(tangageDeVue(-1.5, -0.5)).toBe(-TANGAGE_MAX);
  });
});

describe("tir et caméra dans la même direction (§13.2.4)", () => {
  it.each(ECHANTILLONS)("lacet %f, tangage %f, recul %f : la caméra regarde exactement là où le tir part", (lacet, tangage, kick) => {
    const tir = directionVisee(lacet, tangage, kick);
    const cam = regardCamera(lacet, tangage, kick);
    for (let i = 0; i < 3; i++) expect(cam[i]).toBeCloseTo(tir[i], 9);
  });

  it("la secousse de dégât et l'inclinaison penchent la caméra sans changer son regard", () => {
    for (const [lacet, tangage, kick] of ECHANTILLONS) {
      const tir = directionVisee(lacet, tangage, kick);
      const cam = regardCamera(lacet, tangage, kick, 0.22, 0.04);
      for (let i = 0; i < 3; i++) expect(cam[i]).toBeCloseTo(tir[i], 9);
    }
  });

  it("sans recul, la direction est celle de `directionRegard` (le premier tir part pile)", () => {
    for (const [lacet, tangage] of ECHANTILLONS) {
      expect(directionVisee(lacet, tangage, 0)).toEqual(directionRegard(lacet, tangage));
    }
  });

  it("le recul d'un tir précédent infléchit le tir suivant exactement comme la vue", () => {
    const sans = directionVisee(0.4, 0.1, 0);
    const avec = directionVisee(0.4, 0.1, 0.05);
    expect(avec[1]).toBeGreaterThan(sans[1]);
    const cam = regardCamera(0.4, 0.1, 0.05);
    for (let i = 0; i < 3; i++) expect(cam[i]).toBeCloseTo(avec[i], 9);
  });

  it("le premier plomb de toute arme part dans l'axe de la vue (aucune dispersion, §13.1)", () => {
    for (const arme of ARMES) {
      const axe = directionVisee(1.1, -0.3, 0.04);
      const dirs = directionsTir(arme, axe);
      expect(dirs).toHaveLength(STATS[arme].plombs);
      for (let i = 0; i < 3; i++) expect(dirs[0][i]).toBeCloseTo(axe[i], 9);
    }
  });
});

describe("rotationCamera", () => {
  it("renvoie [tangage de la vue, lacet, roulis]", () => {
    expect(rotationCamera(1, 0.2, 0.05, 0.1, 0.02)).toEqual([tangageDeVue(0.2, 0.05), 1, -0.1 + 0.02]);
  });
});
