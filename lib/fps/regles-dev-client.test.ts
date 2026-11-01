import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, type Monde } from "./collision";
import { ControleurArmes } from "./jeu-equipement";
import { STATS } from "./armes";
import { MOUV, etape, etatInitial, type Entrees, type EtatMouvement } from "./mouvement";
import type { Equipement } from "./protocole";

/**
 * Effets CLIENT des règles du menu de développement : la gravité du monde (`Monde.graviteK`), la vitesse (le multiplicateur d'arme de `etape`) et les
 * munitions infinies du contrôleur d'armes. Les règles pures sont dans regles-dev.test.ts, l'application serveur dans match.regles-dev.test.ts.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const DT = 1 / 60;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 3, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const monde = (): Monde => construireMonde({ ...scene, buildings: [rect(-250, -250, -249, -249), rect(249, 249, 250, 250)], pois: [] });
const REPOS: Entrees = { avant: 0, droite: 0, saut: false, sprint: false, lacet: 0 };

function avancer(e: EtatMouvement, secondes: number, entrees: (t: number) => Entrees, m: Monde, mult = 1, surPas?: (e: EtatMouvement) => void): EtatMouvement {
  const n = Math.round(secondes / DT);
  for (let k = 0; k < n; k++) {
    e = etape(e, entrees((k + 1) * DT), DT, m, mult);
    surPas?.(e);
  }
  return e;
}

describe("gravité réglée", () => {
  /** Hauteur maximale d'un saut fait au sol, `graviteK` donné au monde. */
  const hauteurSaut = (graviteK?: number): number => {
    const m = { ...monde(), ...(graviteK !== undefined ? { graviteK } : {}) };
    let max = 0;
    avancer(etatInitial([0, 0, 0]), 1.5, (t) => ({ ...REPOS, saut: t <= DT + 1e-9 }), m, 1, (s) => { max = Math.max(max, s.p[1]); });
    return max;
  };
  it("sans réglage ou à ×1 : le saut d'origine (v² / 2g)", () => {
    expect(hauteurSaut()).toBeCloseTo(hauteurSaut(1), 6);
    expect(hauteurSaut()).toBeCloseTo((MOUV.saut * MOUV.saut) / (2 * MOUV.gravite), 1);
  });
  it("gravité ×0,5 : on saute deux fois plus haut ; ×2 : deux fois moins", () => {
    const base = hauteurSaut(1);
    expect(hauteurSaut(0.5)).toBeCloseTo(2 * base, 1);
    expect(hauteurSaut(2)).toBeCloseTo(base / 2, 1);
  });
});

describe("vitesse réglée", () => {
  it("le multiplicateur de vitesse passe par celui de l'arme : ×2 double la marche", () => {
    const m = monde();
    const marche = (mult: number): number => {
      const e = avancer(etatInitial([0, 0, 0]), 1, () => ({ ...REPOS, avant: 1 }), m, mult);
      return Math.hypot(e.p[0], e.p[2]);
    };
    expect(marche(2) / marche(1)).toBeGreaterThan(1.8);
    expect(marche(0.5) / marche(1)).toBeLessThan(0.6);
  });
});

describe("munitions infinies", () => {
  const equip = (): Equipement => ({ principale: "fusil_assaut", secondaire: "pistolet", speciale: null });
  it("aucun tir ne décompte, à l'activation tout est rempli, couper les rend normales", () => {
    const c = new ControleurArmes(equip());
    const cap = STATS.fusil_assaut.chargeur;
    for (let i = 0; i < 5; i++) c.tirEffectue();
    expect(c.munitions()).toBe(cap - 5);
    c.definirMunitionsInfinies(true);
    expect(c.munitions()).toBe(cap);
    for (let i = 0; i < cap * 3; i++) c.tirEffectue();
    expect(c.munitions()).toBe(cap);
    c.definirMunitionsInfinies(false);
    c.tirEffectue();
    expect(c.munitions()).toBe(cap - 1);
  });
});
