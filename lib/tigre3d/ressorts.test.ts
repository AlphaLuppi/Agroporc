import { describe, it, expect } from "vitest";
import { Vector3 } from "three";
import { amortir, amortirAngle, ressort, secondOrdre, avancerSecondOrdre, bruit, bruitDouble } from "./ressorts";
import { ik2 } from "./ik";

describe("ressorts", () => {
  it("le ressort critique ne dépend pas du pas de temps (forme fermée)", () => {
    const a = ressort(0), b = ressort(0);
    amortir(a, 1, 8, 1 / 30);
    amortir(b, 1, 8, 1 / 60); amortir(b, 1, 8, 1 / 60);
    expect(a.x).toBeCloseTo(b.x, 10);
    expect(a.v).toBeCloseTo(b.v, 10);
  });

  it("atteint la cible sans la dépasser", () => {
    const r = ressort(0);
    let max = 0;
    for (let i = 0; i < 120; i++) max = Math.max(max, amortir(r, 1, 10, 1 / 60));
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.x).toBeCloseTo(1, 3);
  });

  it("raccorde sans cassure quand la cible change en route (la vitesse est gardée)", () => {
    const r = ressort(0);
    for (let i = 0; i < 10; i++) amortir(r, 1, 8, 1 / 60);
    const v = r.v;
    amortir(r, -1, 8, 1e-4);
    expect(Math.abs(r.v - v)).toBeLessThan(0.05 * Math.abs(v) + 0.01);
  });

  it("amortirAngle prend le plus court chemin", () => {
    const r = ressort(3.0);
    for (let i = 0; i < 200; i++) amortirAngle(r, -3.0, 8, 1 / 60);
    expect(r.x).toBeCloseTo(2 * Math.PI - 3.0, 2);
  });

  it("second ordre : r < 0 anticipe (part à l'envers), ζ < 1 dépasse", () => {
    const s = secondOrdre(2, 0.5, -1, 0);
    const ys: number[] = [];
    for (let i = 0; i < 120; i++) ys.push(avancerSecondOrdre(s, 1, 1 / 60));
    expect(Math.min(...ys.slice(0, 5))).toBeLessThan(0);
    expect(Math.max(...ys)).toBeGreaterThan(1);
    expect(ys[ys.length - 1]).toBeCloseTo(1, 1);
  });

  it("bruit lent : continu, borné, non périodique", () => {
    let prec = bruit(0), saut = 0;
    for (let t = 0; t < 50; t += 0.01) { const b = bruit(t); saut = Math.max(saut, Math.abs(b - prec)); prec = b; expect(Math.abs(b)).toBeLessThanOrEqual(1); }
    expect(saut).toBeLessThan(0.05);
    expect(bruitDouble(1.3)).not.toBeCloseTo(bruitDouble(11.3), 3);
  });
});

describe("ik2", () => {
  it("atteint une cible à portée en gardant les longueurs, du côté du pôle", () => {
    const A = new Vector3(0, 1, 0), C = new Vector3(0.3, 0.2, 0.1), B = new Vector3(), D = new Vector3();
    const r = ik2(A, C, 0.6, 0.5, new Vector3(0, 0, 1), B, D);
    expect(D.distanceTo(C)).toBeLessThan(1e-9);
    expect(B.distanceTo(A)).toBeCloseTo(0.6, 9);
    expect(B.distanceTo(D)).toBeCloseTo(0.5, 9);
    expect(B.z).toBeGreaterThan(0);
    expect(r.atteinte).toBeCloseTo(r.demande, 9);
  });

  it("hors de portée : la patte se tend vers la cible, l'extrémité reste en deçà", () => {
    const A = new Vector3(), C = new Vector3(0, -3, 0), B = new Vector3(), D = new Vector3();
    const r = ik2(A, C, 0.6, 0.5, new Vector3(0, 0, 1), B, D);
    expect(r.atteinte).toBeLessThan(1.1);
    expect(D.y).toBeLessThan(-1.09);
  });
});
