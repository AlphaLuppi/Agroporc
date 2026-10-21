import { describe, it, expect } from "vitest";
import {
  ecartAvantPassage, passage, tirerEvenement, nombrePetits,
  ECART_MIN_MS, ECART_MAX_MS, ECHELLE_PETIT, PETITS_MAX, type Evenement,
} from "./tigre-courant";

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

describe("tirerEvenement", () => {
  it("rend l'éclair et la famille rares (10 % chacun)", () => {
    expect(tirerEvenement(0)).toBe("eclair");
    expect(tirerEvenement(0.099)).toBe("eclair");
    expect(tirerEvenement(0.1)).toBe("famille");
    expect(tirerEvenement(0.199)).toBe("famille");
    expect(tirerEvenement(0.2)).toBe("normal");
    expect(tirerEvenement(0.999)).toBe("normal");
  });
});

describe("nombrePetits", () => {
  it("donne 2 à 4 petits", () => {
    expect(nombrePetits(0)).toBe(2);
    expect(nombrePetits(0.5)).toBe(3);
    expect(nombrePetits(0.999)).toBe(4);
  });
});

describe("passage", () => {
  it("traverse de gauche à droite, hors champ aux deux bouts", () => {
    expect(passage(1440, 180, 180, "normal", 0.9, 0.5)).toMatchObject({ sens: 1, deX: -180, aX: 1440 });
  });

  it("revient parfois de droite à gauche", () => {
    expect(passage(1440, 180, 180, "normal", 0.1, 0.5)).toMatchObject({ sens: -1, deX: 1440, aX: -180 });
  });

  it("finit sa traversée avant le passage suivant, famille comprise", () => {
    for (const [ecran, tigre] of [[390, 120], [1440, 180], [2560, 190]]) {
      const groupeFamille = tigre * (1 + PETITS_MAX * ECHELLE_PETIT * 1.15);
      for (const evenement of ["normal", "eclair", "famille"] as Evenement[]) {
        const groupe = evenement === "famille" ? groupeFamille : tigre;
        for (const aleaVitesse of [0, 0.999]) {
          const { dureeMs } = passage(ecran, groupe, tigre, evenement, 0.5, aleaVitesse);
          expect(dureeMs).toBeGreaterThan(200);
          expect(dureeMs).toBeLessThan(ECART_MIN_MS);
        }
      }
    }
  });

  it("change de vitesse d'un passage à l'autre", () => {
    const lent = passage(1440, 180, 180, "normal", 0.5, 0).dureeMs;
    const rapide = passage(1440, 180, 180, "normal", 0.5, 0.999).dureeMs;
    expect(lent).toBeGreaterThan(rapide * 2);
  });

  it("l'éclair file bien plus vite que le plus rapide des passages normaux", () => {
    const rapide = passage(1440, 180, 180, "normal", 0.5, 0.999).dureeMs;
    const eclair = passage(1440, 180, 180, "eclair", 0.5, 0).dureeMs;
    expect(eclair).toBeLessThan(rapide / 2.5);
  });
});
