import { describe, expect, it } from "vitest";
import {
  STATS, VITESSE_REFERENCE_M_S, apresTir, degatsPlomb, directionsTir, dispersionCourante, multiplicateurChute, refroidir,
} from "./armes";
import { ARMES, JEU, type Vec3 } from "./protocole";

/** Petit générateur déterministe (mulberry32). */
function alea(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const norme = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

describe("STATS", () => {
  it("chaque arme est cohérente", () => {
    for (const id of ARMES) {
      const a = STATS[id];
      expect(a.id).toBe(id);
      expect(a.plombs).toBeGreaterThan(0);
      expect(a.cadenceS).toBeGreaterThan(0);
      expect(a.chargeur).toBeGreaterThan(0);
      expect(a.dispersion.max).toBeGreaterThanOrEqual(a.dispersion.base);
      expect(a.chute.min).toBeGreaterThan(0);
      expect(a.chute.min).toBeLessThanOrEqual(1);
      expect(a.chute.debut).toBeLessThanOrEqual(a.chute.fin);
      expect(a.portee).toBeGreaterThan(0);
    }
  });

  it("valeurs de départ de la spec", () => {
    expect(STATS.pistolet).toMatchObject({ degats: 28, multTete: 2, plombs: 1, cadenceS: 0.2, auto: false, chargeur: 12, rechargeS: 1.3 });
    expect(STATS.mitraillette).toMatchObject({ degats: 16, multTete: 1.6, cadenceS: 0.075, auto: true, chargeur: 32, rechargeS: 2.0 });
    expect(STATS.pompe).toMatchObject({ plombs: 9, multTete: 1.5, cadenceS: 0.85, chargeur: 6, rechargeS: 2.4, portee: 45 });
    expect(STATS.pompe.dispersion.base).toBeCloseTo(0.085, 6);
    expect(STATS.pompe.chute).toEqual({ debut: 8, fin: 30, min: 0.25 });
    expect(STATS.sniper).toMatchObject({ degats: 95, multTete: 2.5, cadenceS: 1.35, chargeur: 5, rechargeS: 2.9, vitesse: 0.9, zoom: 18 });
    expect(STATS.sniper.dispersion.base).toBeCloseTo(0.09, 6);
    expect(STATS.sniper.dispersion.viseur).toBe(0);
    // seul le sniper a une lunette
    for (const id of ARMES) if (id !== "sniper") expect(STATS[id].zoom).toBeNull();
  });
});

describe("degatsPlomb", () => {
  it("corps et tête à bout portant, entiers", () => {
    expect(degatsPlomb("pistolet", "corps", 1)).toBe(28);
    expect(degatsPlomb("pistolet", "tete", 1)).toBe(56);
    expect(degatsPlomb("mitraillette", "corps", 1)).toBe(16);
    expect(degatsPlomb("mitraillette", "tete", 1)).toBe(26);
    expect(degatsPlomb("pompe", "corps", 1)).toBe(20);
    expect(degatsPlomb("pompe", "tete", 1)).toBe(30);
    expect(degatsPlomb("sniper", "corps", 1)).toBe(95);
    expect(degatsPlomb("sniper", "tete", 1)).toBe(238);
    for (const id of ARMES) for (const z of ["tete", "corps"] as const) for (const d of [0, 3.7, 22.2, 61.3]) {
      expect(Number.isInteger(degatsPlomb(id, z, d))).toBe(true);
    }
  });

  it("la chute est linéaire entre début et fin puis plafonnée", () => {
    expect(multiplicateurChute("pompe", 8)).toBe(1);
    expect(multiplicateurChute("pompe", 30)).toBeCloseTo(0.25, 9);
    expect(multiplicateurChute("pompe", 19)).toBeCloseTo(0.625, 9);
    expect(degatsPlomb("pompe", "corps", 30)).toBe(5);
    expect(degatsPlomb("pompe", "corps", 100)).toBe(5);
    expect(degatsPlomb("pompe", "corps", 19)).toBeLessThan(degatsPlomb("pompe", "corps", 8));
    // la chute ne fait jamais gagner de dégâts
    for (const id of ARMES) {
      let precedent = Infinity;
      for (let d = 0; d <= STATS[id].portee; d += 2.5) {
        const v = degatsPlomb(id, "corps", d);
        expect(v).toBeLessThanOrEqual(precedent);
        precedent = v;
      }
    }
    // pistolet : -30 % au plus, sniper : aucune chute
    expect(degatsPlomb("pistolet", "corps", 200)).toBe(Math.round(28 * 0.7));
    expect(degatsPlomb("sniper", "corps", 399)).toBe(95);
  });

  it("un tir de sniper à la tête tue, au corps non", () => {
    expect(degatsPlomb("sniper", "tete", 300)).toBeGreaterThanOrEqual(JEU.pvMax);
    expect(degatsPlomb("sniper", "corps", 1)).toBeLessThan(JEU.pvMax);
  });

  it("le pompe à bout portant tue si la majorité des plombs touchent", () => {
    const n = STATS.pompe.plombs;
    const majorite = Math.floor(n / 2) + 1;
    expect(majorite * degatsPlomb("pompe", "corps", 3)).toBeGreaterThanOrEqual(JEU.pvMax);
    expect((majorite - 1) * degatsPlomb("pompe", "corps", 3)).toBeLessThan(JEU.pvMax);
    // à 30 m, même les 9 plombs ne tuent pas
    expect(n * degatsPlomb("pompe", "corps", 30)).toBeLessThan(JEU.pvMax);
  });

  it("pistolet : 4 balles au corps tuent, mitraillette : 7", () => {
    expect(4 * degatsPlomb("pistolet", "corps", 5)).toBeGreaterThanOrEqual(JEU.pvMax);
    expect(3 * degatsPlomb("pistolet", "corps", 5)).toBeLessThan(JEU.pvMax);
    expect(7 * degatsPlomb("mitraillette", "corps", 5)).toBeGreaterThanOrEqual(JEU.pvMax);
  });
});

describe("dispersionCourante", () => {
  const immobile = { vitesseH: 0, auSol: true, vise: false, chaleur: 0 };

  it("base à l'arrêt au sol, augmente avec le mouvement et en l'air", () => {
    for (const id of ARMES) {
      const base = dispersionCourante(id, immobile);
      expect(base).toBeCloseTo(STATS[id].dispersion.base, 9);
      const marche = dispersionCourante(id, { ...immobile, vitesseH: VITESSE_REFERENCE_M_S });
      expect(marche).toBeGreaterThan(base);
      expect(dispersionCourante(id, { ...immobile, vitesseH: 100 })).toBeCloseTo(marche, 9);
      expect(dispersionCourante(id, { ...immobile, auSol: false })).toBeGreaterThan(base);
      expect(dispersionCourante(id, { vitesseH: 50, auSol: false, vise: false, chaleur: 10 })).toBeCloseTo(STATS[id].dispersion.max, 9);
    }
  });

  it("le sniper est très imprécis sans lunette et parfait avec, à l'arrêt", () => {
    expect(dispersionCourante("sniper", immobile)).toBeCloseTo(0.09, 9);
    expect(dispersionCourante("sniper", { ...immobile, vise: true })).toBe(0);
    expect(dispersionCourante("sniper", { ...immobile, vise: true, vitesseH: 6.5 })).toBeGreaterThan(0);
    expect(dispersionCourante("sniper", { ...immobile, vise: true, auSol: false })).toBeGreaterThan(0);
  });

  it("la visée resserre les armes sans lunette", () => {
    for (const id of ["pistolet", "mitraillette", "pompe"] as const) {
      expect(dispersionCourante(id, { ...immobile, vise: true })).toBeLessThan(dispersionCourante(id, immobile));
    }
  });

  it("la chaleur monte à chaque tir et retombe en retourS", () => {
    let ch = 0;
    for (let i = 0; i < 6; i++) ch = apresTir("mitraillette", ch);
    expect(ch).toBeCloseTo(6 * STATS.mitraillette.dispersion.parTir, 9);
    expect(dispersionCourante("mitraillette", { ...immobile, chaleur: ch })).toBeGreaterThan(dispersionCourante("mitraillette", immobile));
    // plafonnée
    let long = 0;
    for (let i = 0; i < 200; i++) long = apresTir("mitraillette", long);
    expect(long).toBeLessThanOrEqual(STATS.mitraillette.dispersion.max);
    // refroidissement
    expect(refroidir("mitraillette", long, STATS.mitraillette.dispersion.retourS)).toBe(0);
    const moitie = refroidir("mitraillette", long, STATS.mitraillette.dispersion.retourS / 2);
    expect(moitie).toBeGreaterThan(0);
    expect(moitie).toBeLessThan(long);
    // le pompe ne chauffe pas
    expect(apresTir("pompe", 0)).toBe(0);
  });
});

describe("directionsTir", () => {
  const visees: Vec3[] = [[0, 0, -1], [1, 0, 0], [0, 1, 0], [0, -1, 0], [0.6, 0.48, -0.64], [-0.3, -0.2, 0.9327379053088815]];

  it("renvoie `plombs` directions normalisées", () => {
    for (const id of ARMES) for (const d of visees) {
      const dirs = directionsTir(id, d, 0.05, alea(7));
      expect(dirs.length).toBe(STATS[id].plombs);
      for (const v of dirs) expect(norme(v)).toBeCloseTo(1, 9);
    }
  });

  it("le cône des plombs reste dans l'angle de dispersion", () => {
    const cone = STATS.pompe.dispersion.base;
    let maxVu = 0;
    for (let graine = 1; graine <= 60; graine++) for (const d of visees) {
      const n = norme(d);
      const dn: Vec3 = [d[0] / n, d[1] / n, d[2] / n];
      for (const v of directionsTir("pompe", d, cone, alea(graine))) {
        const a = angle(dn, v);
        expect(a).toBeLessThanOrEqual(cone + 1e-9);
        maxVu = Math.max(maxVu, a);
      }
    }
    // et le cône est réellement utilisé (pas un point)
    expect(maxVu).toBeGreaterThan(cone * 0.9);
  });

  it("sans dispersion, tous les plombs partent droit", () => {
    for (const v of directionsTir("pompe", [0, 0, -2], 0, alea(1))) expect(v).toEqual([0, 0, -1]);
    expect(directionsTir("sniper", [3, 0, 4], 0, alea(1))[0]).toEqual([0.6, 0, 0.8]);
  });

  it("les plombs diffèrent entre eux, de façon déterministe pour une graine", () => {
    const a = directionsTir("pompe", [0, 0, -1], 0.085, alea(42));
    const b = directionsTir("pompe", [0, 0, -1], 0.085, alea(42));
    expect(a).toEqual(b);
    expect(new Set(a.map((v) => v.join(","))).size).toBe(a.length);
  });
});
