import { describe, it, expect } from "vitest";
import { ecartAvantPassage, passage, ECART_MIN_MS, ECART_MAX_MS } from "./tigre-courant";

describe("ecartAvantPassage", () => {
  it("donne 4 à 6 passages par minute", () => {
    for (const alea of [0, 0.3, 0.5, 0.999]) {
      const ecart = ecartAvantPassage(alea);
      expect(ecart).toBeGreaterThanOrEqual(ECART_MIN_MS);
      expect(ecart).toBeLessThanOrEqual(ECART_MAX_MS);
      expect(60_000 / ecart).toBeGreaterThanOrEqual(4);
      expect(60_000 / ecart).toBeLessThanOrEqual(6);
    }
  });
});

describe("passage", () => {
  it("traverse de gauche à droite, hors champ aux deux bouts", () => {
    expect(passage(1440, 180, 0.9, 0.5)).toMatchObject({ sens: 1, deX: -180, aX: 1440 });
  });

  it("revient parfois de droite à gauche", () => {
    expect(passage(1440, 180, 0.1, 0.5)).toMatchObject({ sens: -1, deX: 1440, aX: -180 });
  });

  it("finit sa traversée avant le passage suivant", () => {
    for (const [ecran, largeur] of [[390, 120], [1440, 180], [2560, 190]]) {
      for (const aleaVitesse of [0, 0.999]) {
        const { dureeMs } = passage(ecran, largeur, 0.5, aleaVitesse);
        expect(dureeMs).toBeGreaterThan(500);
        expect(dureeMs).toBeLessThan(ECART_MIN_MS);
      }
    }
  });

  it("change de vitesse d'un passage à l'autre", () => {
    const lent = passage(1440, 180, 0.5, 0).dureeMs;
    const rapide = passage(1440, 180, 0.5, 0.999).dureeMs;
    expect(lent).toBeGreaterThan(rapide * 2);
  });
});
