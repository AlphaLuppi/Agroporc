import { describe, expect, it } from "vitest";
import { PAS_MAX_PAR_IMAGE, PAS_S } from "./contrat";
import { avancerAccumulateur, creerAccumulateur, IMAGE_MAX_S } from "./boucle";

describe("accumulateur de pas fixes", () => {
  it("60 images/s donnent 2 pas par image et aucun reste", () => {
    const acc = creerAccumulateur();
    let total = 0;
    for (let i = 0; i < 600; i++) total += avancerAccumulateur(acc, 1 / 60).pas;
    expect(total).toBe(1200);
    expect(acc.reste).toBeLessThan(PAS_S);
  });

  it("le temps ne se perd ni ne se crée : la somme des pas suit le temps versé", () => {
    const acc = creerAccumulateur();
    let total = 0, temps = 0;
    for (let i = 0; i < 1000; i++) {
      const dt = 0.004 + (i % 7) * 0.002;
      temps += dt;
      total += avancerAccumulateur(acc, dt).pas;
    }
    expect(total * PAS_S + acc.reste).toBeCloseTo(temps, 6);
  });

  it("alpha ∈ [0, 1[ et croît dans une image courte", () => {
    const acc = creerAccumulateur();
    const a = avancerAccumulateur(acc, PAS_S * 0.3);
    expect(a.pas).toBe(0);
    expect(a.alpha).toBeCloseTo(0.3, 6);
    const b = avancerAccumulateur(acc, PAS_S * 0.3);
    expect(b.alpha).toBeCloseTo(0.6, 6);
  });

  it("retard : au plus PAS_MAX_PAR_IMAGE pas, le surplus est jeté", () => {
    const acc = creerAccumulateur();
    const r = avancerAccumulateur(acc, IMAGE_MAX_S);
    expect(r.pas).toBe(PAS_MAX_PAR_IMAGE);
    expect(acc.reste).toBe(0);
    // une très longue image (onglet en arrière-plan) est ramenée au plafond
    expect(avancerAccumulateur(creerAccumulateur(), 30).pas).toBe(PAS_MAX_PAR_IMAGE);
  });

  it("échelle de temps (ralenti du but ×0,5) : deux fois moins de pas", () => {
    const a = creerAccumulateur(), b = creerAccumulateur();
    let pa = 0, pb = 0;
    for (let i = 0; i < 120; i++) { pa += avancerAccumulateur(a, 1 / 60).pas; pb += avancerAccumulateur(b, 1 / 60, 0.5).pas; }
    expect(pb).toBeGreaterThanOrEqual(pa / 2 - 1);
    expect(pb).toBeLessThanOrEqual(pa / 2 + 1);
  });

  it("valeurs invalides ignorées", () => {
    const acc = creerAccumulateur();
    expect(avancerAccumulateur(acc, NaN).pas).toBe(0);
    expect(avancerAccumulateur(acc, -1).pas).toBe(0);
    expect(avancerAccumulateur(acc, 1 / 60, -3).pas).toBe(0);
  });
});
