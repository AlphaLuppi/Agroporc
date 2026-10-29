import { describe, expect, it } from "vitest";
import { VIE_DEBRIS, etatVieDebris } from "./debris-vie";
import { DUREE_OUVERTURE_S, ECLATS, etatOuverture, planOuverture } from "./ouverture-portes";
import { PORTES_PAYANTES, pieceDe } from "./zombies-carte";

/** Portes payantes façon BO1 (plus de pluie de blocs) et durée de vie bornée des débris. */

function suite(graine = 5): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe("ouverture d'une porte payante", () => {
  it("chaque porte de la carte : quelques éclats légers et lents, le long de la porte, et de la poussière à son pied", () => {
    const alea = suite();
    for (const porte of PORTES_PAYANTES) {
      const piece = pieceDe(porte.prismes[0]);
      const plan = planOuverture(piece, alea);
      expect(plan.eclats.length, porte.id).toBeGreaterThanOrEqual(ECLATS.min);
      expect(plan.eclats.length, porte.id).toBeLessThanOrEqual(ECLATS.max);
      expect(plan.longueur).toBeCloseTo(Math.hypot(piece.q[0] - piece.p[0], piece.q[1] - piece.p[1]), 6);
      expect(plan.hauteur).toBe(piece.h);
      for (const e of plan.eclats) {
        // des planchettes, pas des blocs de béton
        expect(Math.max(...e.taille)).toBeLessThanOrEqual(ECLATS.tailleMax);
        expect(Math.hypot(e.v[0], e.v[2])).toBeLessThanOrEqual(ECLATS.vitesseMax + 0.5);
        expect(e.p[1]).toBeLessThanOrEqual(piece.h);
        // le long du segment de la porte (à son épaisseur près)
        const [px, pz] = piece.p, [qx, qz] = piece.q;
        const l2 = (qx - px) ** 2 + (qz - pz) ** 2;
        const s = ((e.p[0] - px) * (qx - px) + (e.p[2] - pz) * (qz - pz)) / l2;
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        const d = Math.abs((e.p[0] - px) * (qz - pz) - (e.p[2] - pz) * (qx - px)) / Math.sqrt(l2);
        expect(d).toBeLessThanOrEqual(piece.demi + 1e-6);
      }
      expect(plan.poussiere.length).toBeGreaterThanOrEqual(2);
      expect(plan.poussiere.every((p) => p[1] < 0.5)).toBe(true);
    }
  });

  it("le lacet aligne le grand côté du fantôme sur la porte (rotation y de three)", () => {
    const plan = planOuverture({ p: [0, 0], q: [0, 4], demi: 0.1, h: 2.6 }, suite());
    // +x local tourné de lacet autour de y : (cos, 0, −sin) doit valoir la direction p → q
    expect(Math.cos(plan.lacet)).toBeCloseTo(0, 6);
    expect(-Math.sin(plan.lacet)).toBeCloseTo(1, 6);
  });

  it("la porte se soulève, s'efface puis disparaît en un peu plus d'une seconde", () => {
    expect(etatOuverture(0, 2.6)).toEqual({ levee: 0, opacite: 1, finie: false });
    const milieu = etatOuverture(DUREE_OUVERTURE_S * 0.7, 2.6);
    expect(milieu.levee).toBeGreaterThan(0.5);
    expect(milieu.opacite).toBeGreaterThan(0);
    expect(milieu.opacite).toBeLessThan(1);
    expect(etatOuverture(DUREE_OUVERTURE_S, 2.6)).toMatchObject({ opacite: 0, finie: true });
  });
});

describe("durée de vie des débris", () => {
  it("toujours bornée : les éclats d'une porte disparaissent en 3 s, les gravats de l'arène en moins de 40 s", () => {
    for (const p of Object.values(VIE_DEBRIS)) {
      expect(Number.isFinite(p.vie)).toBe(true);
      expect(etatVieDebris(p.vie + p.fondu + 0.01, p.vie, p.fondu).fini).toBe(true);
    }
    expect(VIE_DEBRIS.porte.vie + VIE_DEBRIS.porte.fondu).toBeLessThanOrEqual(3);
    expect(VIE_DEBRIS.effondrement.vie + VIE_DEBRIS.effondrement.fondu).toBeLessThan(40);
  });

  it("entier tant qu'il vit, puis rétrécit et s'enfonce en continu, puis fini", () => {
    expect(etatVieDebris(1, 2, 1)).toEqual({ echelle: 1, enfoncement: 0, fini: false });
    const a = etatVieDebris(2.3, 2, 1), b = etatVieDebris(2.7, 2, 1);
    expect(a.echelle).toBeLessThan(1);
    expect(b.echelle).toBeLessThan(a.echelle);
    expect(b.enfoncement).toBeGreaterThan(a.enfoncement);
    expect(etatVieDebris(3, 2, 1)).toEqual({ echelle: 0, enfoncement: 1, fini: true });
    // sans durée de vie (infinie) : jamais fini
    expect(etatVieDebris(1e9, Infinity, 1).fini).toBe(false);
  });
});
