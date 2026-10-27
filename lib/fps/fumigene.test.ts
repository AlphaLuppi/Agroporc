import { describe, expect, it } from "vitest";
import {
  FUMIGENE, avancerProjectile, creerNuageFumee, creerProjectileFumigene,
  estDansFumee, ligneCoupeeParFumee, opaciteNuage, rayonNuage
} from "./fumigene";

describe("fumigene", () => {
  it("initialise un projectile de fumigène avec impulsion balistique", () => {
    const proj = creerProjectileFumigene([10, 1.8, 10], [1, 0, 0], 5000, 20);
    expect(proj.p).toEqual([10, 1.8, 10]);
    expect(proj.v[0]).toBeCloseTo(20, 1);
    expect(proj.v[1]).toBeGreaterThan(0); // Impulsion montante
    expect(proj.detoneT).toBe(5000 + FUMIGENE.delaiDetonationMs);
  });

  it("fait avancer le projectile et gère le rebond au sol", () => {
    const proj = creerProjectileFumigene([0, 1, 0], [1, -0.5, 0], 0, 10);
    const av1 = avancerProjectile(proj, 0.1, 0.1);
    expect(av1).toBe(true);
    expect(proj.p[1]).toBeLessThan(1);

    // Chute jusqu'au sol
    for (let i = 0; i < 20; i++) avancerProjectile(proj, 0.1, 0.1);
    expect(proj.p[1]).toBeGreaterThanOrEqual(0.1);
  });

  it("calcule l'expansion et la dissipation du nuage de fumée", () => {
    const nuage = creerNuageFumee("f1", [20, 0, 20], 10_000);

    // Naissance : petit
    expect(rayonNuage(nuage, 10_000)).toBe(0);
    expect(rayonNuage(nuage, 10_500)).toBeGreaterThan(1);
    expect(rayonNuage(nuage, 10_500)).toBeLessThan(FUMIGENE.rayonMaxM);

    // Pleine expansion à 3 s
    expect(rayonNuage(nuage, 13_000)).toBe(FUMIGENE.rayonMaxM);
    expect(opaciteNuage(nuage, 13_000)).toBe(1.0);

    // Dissipation en fin de vie
    expect(rayonNuage(nuage, 28_000)).toBeLessThan(FUMIGENE.rayonMaxM);
    expect(rayonNuage(nuage, 31_000)).toBe(0); // Expiré
  });

  it("détecte si un joueur est à l'intérieur du nuage", () => {
    const nuage = creerNuageFumee("f1", [0, 0, 0], 1000);
    const t = 1000 + 4000; // Pleinement déployé

    // Dedans
    expect(estDansFumee([2, 1, 2], [nuage], t)).toBe(true);
    // Trop loin horizontalement
    expect(estDansFumee([15, 1, 0], [nuage], t)).toBe(false);
    // Trop haut
    expect(estDansFumee([0, 15, 0], [nuage], t)).toBe(false);
  });

  it("détecte si la ligne de vue entre deux joueurs traverse le nuage", () => {
    const nuage = creerNuageFumee("f1", [0, 0, 0], 1000);
    const t = 1000 + 4000;

    // A à gauche, B à droite, le nuage est entre les deux
    const a: [number, number, number] = [-15, 1.8, 0];
    const b: [number, number, number] = [15, 1.8, 0];
    expect(ligneCoupeeParFumee(a, b, [nuage], t)).toBe(true);

    // C et D passent loin du nuage
    const c: [number, number, number] = [-15, 1.8, 25];
    const d: [number, number, number] = [15, 1.8, 25];
    expect(ligneCoupeeParFumee(c, d, [nuage], t)).toBe(false);
  });
});
