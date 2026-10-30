import { describe, it, expect } from "vitest";
import { creerCorps, avancerCorps, contactsAtteints, type Consignes } from "./corps";
import { PATTES } from "./os";

const course = (v: number, sens: 1 | -1 = 1): Consignes => ({ vitesse: v, sens, cap: sens * Math.PI / 2, regard: 0, couches: [] });

/**
 * Glissement des pieds : déplacement horizontal (sol) du bout de chaque patte d'une image à
 * l'autre tant qu'elle reste en appui. Retourne le glissement moyen (m/s) et le pire (m/s).
 */
function mesurer(v: number, duree = 3, dt = 1 / 60) {
  const c = creerCorps();
  for (let i = 0; i < Math.round(2 / dt); i++) avancerCorps(c, dt, course(v));
  let prec = contactsAtteints(c), appuiPrec = PATTES.map((p) => c.pattes[p].appui);
  let somme = 0, tAppui = 0, pire = 0, avance = 0;
  for (let i = 0; i < Math.round(duree / dt); i++) {
    avancerCorps(c, dt, course(v));
    avance += c.dx;
    const cc = contactsAtteints(c);
    PATTES.forEach((p, i) => {
      if (c.pattes[p].appui && appuiPrec[i]) {
        const d = Math.hypot(cc[p].x - prec[p].x, cc[p].z - prec[p].z);
        somme += d; tAppui += dt; pire = Math.max(pire, d / dt);
      }
      appuiPrec[i] = c.pattes[p].appui;
    });
    prec = cc;
  }
  return { moyen: somme / tAppui, pire, avance, c };
}

describe("corps : locomotion à pieds plantés", () => {
  it("marche, trot, galop : un pied en appui ne glisse pas", () => {
    for (const v of [0.3, 0.7, 1.1, 1.8, 2.6, 3.4]) {
      const m = mesurer(v);
      // Moyenne : moins de 1 % de la vitesse d'avance ; pire image : un dixième de la vitesse.
      expect(m.moyen, `v=${v}`).toBeLessThan(0.01 * v + 0.002);
      expect(m.pire, `v=${v}`).toBeLessThan(0.12 * v + 0.02);
    }
  });

  it("allureMax bride l'allure au trot (le tigre bipède des bots ne galope jamais) sans changer la vitesse ni les pieds plantés", () => {
    const c = creerCorps();
    for (let i = 0; i < 240; i++) avancerCorps(c, 1 / 60, { ...course(3.4), allureMax: 1 });
    expect(c.allure.x).toBeLessThanOrEqual(1 + 1e-6);
    expect(c.allure.x).toBeGreaterThan(0.99);
    expect(Math.abs(c.v)).toBeCloseTo(3.4, 1);
    // sans la consigne, le même tigre galope
    const g = creerCorps();
    for (let i = 0; i < 240; i++) avancerCorps(g, 1 / 60, course(3.4));
    expect(g.allure.x).toBeGreaterThan(1.9);
  });

  it("le corps avance exactement à la vitesse demandée (l'avance est celle des pieds)", () => {
    const m = mesurer(1.2, 2);
    expect(m.avance / 2).toBeCloseTo(1.2, 2);
  });

  it("l'allure suit la vitesse : marche lente, trot, galop", () => {
    expect(mesurer(0.3, 1).c.allure.x).toBeLessThan(0.1);
    expect(mesurer(1.1, 1).c.allure.x).toBeCloseTo(1, 1);
    expect(mesurer(2.8, 1).c.allure.x).toBeGreaterThan(1.9);
  });

  it("chaque patte se pose et se lève (aucune patte figée en l'air ou au sol)", () => {
    const c = creerCorps();
    const changements = Object.fromEntries(PATTES.map((p) => [p, 0]));
    let prec = PATTES.map((p) => c.pattes[p].appui);
    for (let t = 0; t < 3; t += 1 / 60) {
      avancerCorps(c, 1 / 60, course(1.5));
      PATTES.forEach((p, i) => { if (c.pattes[p].appui !== prec[i]) changements[p]++; prec[i] = c.pattes[p].appui; });
    }
    for (const p of PATTES) expect(changements[p]).toBeGreaterThan(10);
  });

  it("à l'arrêt, il se tourne vers la caméra en piétinant : tête d'abord, puis épaules, puis bassin", () => {
    const c = creerCorps();
    for (let t = 0; t < 1; t += 1 / 60) avancerCorps(c, 1 / 60, course(0));
    const d = { ...course(0), cap: 0.2 };
    let maxPas = 0, prec = c.psiE.x;
    avancerCorps(c, 1 / 60, d);
    // Après 0,2 s, la tête a plus tourné que les épaules, qui ont plus tourné que le bassin.
    for (let t = 0; t < 0.2; t += 1 / 60) avancerCorps(c, 1 / 60, d);
    expect(c.psiT.x).toBeLessThan(c.psiE.x);
    expect(c.psiE.x).toBeLessThan(c.psiB.x);
    let pas = 0;
    prec = c.psiE.x;
    let appui = PATTES.map((p) => c.pattes[p].appui);
    for (let t = 0; t < 2.5; t += 1 / 60) {
      avancerCorps(c, 1 / 60, d);
      maxPas = Math.max(maxPas, Math.abs(c.psiE.x - prec));
      prec = c.psiE.x;
      PATTES.forEach((p, i) => { if (appui[i] && !c.pattes[p].appui) pas++; appui[i] = c.pattes[p].appui; });
    }
    expect(Math.abs(c.psiB.x - 0.2)).toBeLessThan(0.02);
    // Pas de tourelle : < 0,12 rad par image, et des pas pour suivre.
    expect(maxPas).toBeLessThan(0.12);
    expect(pas).toBeGreaterThanOrEqual(4);
    // Une fois tourné, il se fige : plus aucun pas.
    expect(PATTES.every((p) => c.pattes[p].appui)).toBe(true);
    expect(c.actif).toBe(false);
  });

  it("indépendant du framerate (30 et 144 i/s)", () => {
    const a = creerCorps(), b = creerCorps();
    for (let i = 0; i < 60; i++) avancerCorps(a, 1 / 30, course(1.5));
    for (let i = 0; i < 288; i++) avancerCorps(b, 1 / 144, course(1.5));
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.03);
    expect(Math.abs(((a.phase - b.phase) % 1 + 1.5) % 1 - 0.5)).toBeLessThan(0.05);
  });
});
