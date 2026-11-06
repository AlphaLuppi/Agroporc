import { describe, expect, it } from "vitest";
import {
  alignerSurNormale, angleNormalise, baseDepuisCap, baseIdentite, capDeBase, croix, dot, integrerBase, localVersMonde, mondeVersLocal, norme, normaliser,
  reflechir, reorthonormaliser, rotationVers, tournerVec,
} from "./vec";

const proche = (a: number[], b: number[], eps = 1e-9) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], -Math.log10(eps)));

describe("vec : bases", () => {
  it("droite = avant × haut", () => {
    for (const cap of [0, 0.7, -2.2]) {
      const b = baseDepuisCap(cap);
      proche(croix(b.avant, b.haut), b.droite);
      expect(capDeBase(b)).toBeCloseTo(angleNormalise(cap), 9);
    }
    proche(croix(baseIdentite().avant, baseIdentite().haut), baseIdentite().droite);
  });
  it("local ↔ monde : aller-retour", () => {
    const b = baseDepuisCap(1.1);
    proche(mondeVersLocal(b, localVersMonde(b, [1, 2, 3])), [1, 2, 3]);
  });
  it("intégrer w = π/2 rad/s pendant 1 s autour de Y tourne l'avant d'un quart de tour", () => {
    const b = baseIdentite();
    for (let i = 0; i < 120; i++) integrerBase(b, [0, Math.PI / 2, 0], 1 / 120);
    proche(b.avant, [1, 0, 0], 1e-6);
    proche(croix(b.avant, b.haut), b.droite, 1e-6);
  });
  it("la base reste orthonormée après mille intégrations", () => {
    const b = baseIdentite();
    for (let i = 0; i < 1000; i++) integrerBase(b, [3, -2, 4], 1 / 120);
    expect(norme(b.avant)).toBeCloseTo(1, 9);
    expect(dot(b.avant, b.droite)).toBeCloseTo(0, 9);
    expect(dot(b.avant, b.haut)).toBeCloseTo(0, 9);
    proche(croix(b.avant, b.haut), b.droite, 1e-8);
    expect(reorthonormaliser(b)).toBe(b);
  });
  it("aligner sur une normale (mur) garde l'avant dans le plan tangent", () => {
    const a = alignerSurNormale(baseDepuisCap(0.3), [1, 0, 0]);
    expect(dot(a.avant, a.haut)).toBeCloseTo(0, 9);
    proche(a.haut, [1, 0, 0]);
  });
});

describe("vec : vecteurs", () => {
  it("rotation, réflexion, normalisation, rotationVers", () => {
    proche(tournerVec([1, 0, 0], [0, 1, 0], Math.PI / 2), [0, 0, -1]);
    proche(reflechir([1, -1, 0], [0, 1, 0]), [1, 1, 0]);
    proche(normaliser([0, 0, 0], [1, 0, 0]), [1, 0, 0]);
    const r = rotationVers([0, 1, 0], [1, 0, 0]);
    expect(r.angle).toBeCloseTo(Math.PI / 2, 9);
    proche(tournerVec([0, 1, 0], r.axe, r.angle), [1, 0, 0]);
  });
});
