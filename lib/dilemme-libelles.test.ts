import { describe, expect, it } from "vitest";
import {
  detailClassement, libelleNombrePlats, libelleService, libelleTotalVotants, libelleVictoires, libelleVoix,
  partDeVoix, resumeDuelPasse,
} from "./dilemme-libelles";
import { formatDateCourte } from "./format";
import type { StatPlat } from "./dilemme";

describe("formatDateCourte", () => {
  it("jour abrégé, quantième, mois abrégé", () => {
    expect(formatDateCourte("2026-11-05")).toBe("jeu. 5 nov.");
    expect(formatDateCourte("2026-03-02")).toBe("lun. 2 mars");
    expect(formatDateCourte("2026-02-01")).toBe("dim. 1 févr.");
  });
});

describe("libellés de voix", () => {
  it("voix et total de votants", () => {
    expect(libelleVoix(0)).toBe("0 voix");
    expect(libelleVoix(5)).toBe("5 voix");
    expect(libelleTotalVotants(0)).toBe("Personne n'a voté pour l'instant.");
    expect(libelleTotalVotants(1)).toBe("1 personne a voté.");
    expect(libelleTotalVotants(4)).toBe("4 personnes ont voté.");
    expect(libelleVictoires(1)).toBe("1 victoire");
    expect(libelleVictoires(2)).toBe("2 victoires");
    expect(libelleNombrePlats(0)).toBe("Aucun plat");
    expect(libelleNombrePlats(1)).toBe("1 plat");
    expect(libelleNombrePlats(712)).toBe("712 plats");
  });
});

describe("libelleService", () => {
  it("omis sans service connu", () => {
    expect(libelleService(0, null, null)).toBeNull();
    expect(libelleService(0, "2026-11-05", "2026-11-05")).toBeNull();
  });
  it("une fois, plusieurs fois, avec la première date", () => {
    expect(libelleService(1, "2026-11-05", "2026-11-05")).toBe("Servi le jeu. 5 nov.");
    expect(libelleService(3, "2026-10-06", "2026-11-05")).toBe("Servi 3 fois · dernier le jeu. 5 nov.");
    expect(libelleService(3, "2026-10-06", "2026-11-05", true)).toBe("Servi 3 fois · du mar. 6 oct. au jeu. 5 nov.");
  });
});

describe("resumeDuelPasse", () => {
  const base = { a_plat: "Croziflette", b_plat: "Pâtes carbonara" };
  it("vainqueur, égalité, personne", () => {
    expect(resumeDuelPasse({ ...base, voix_a: 5, voix_b: 3 })).toEqual({
      texte: "Croziflette 63 % contre Pâtes carbonara 37 %", mention: "Vainqueur : Croziflette",
    });
    expect(resumeDuelPasse({ ...base, voix_a: 1, voix_b: 4 }).mention).toBe("Vainqueur : Pâtes carbonara");
    expect(resumeDuelPasse({ ...base, voix_a: 2, voix_b: 2 })).toEqual({
      texte: "Croziflette 50 % contre Pâtes carbonara 50 %", mention: "Égalité",
    });
    expect(resumeDuelPasse({ ...base, voix_a: 0, voix_b: 0 })).toEqual({
      texte: "Croziflette contre Pâtes carbonara", mention: "Personne n'a voté",
    });
  });
});

describe("classement", () => {
  const s: StatPlat = {
    cle: "x", restaurant: "R", nom: "N", duels: 3, victoires: 2, defaites: 1, nuls: 0, pour: 6, contre: 2, score: 0.7,
  };
  it("part de voix brute et détail", () => {
    expect(partDeVoix(s)).toBe(75);
    expect(partDeVoix({ pour: 0, contre: 0 })).toBe(0);
    expect(detailClassement(s)).toBe("75 % des voix · 2 victoires · 3 duels");
    expect(detailClassement({ ...s, duels: 1, victoires: 1 })).toBe("75 % des voix · 1 victoire · 1 duel");
  });
});
