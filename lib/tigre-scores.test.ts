import { describe, expect, it } from "vitest";
import { messageEnregistre, rangOrdinal, validerScore } from "./tigre-scores";

const ok = (corps: unknown) => {
  const r = validerScore(corps);
  if (!r.ok) throw new Error(r.erreur);
  return r.valeur;
};
const refus = (corps: unknown) => validerScore(corps).ok;

describe("validerScore", () => {
  it("accepte un score cohérent et retire les espaces de bord du pseudo", () => {
    expect(ok({ pseudo: "  Nico  ", score: 420, tigres: 1 })).toEqual({ pseudo: "Nico", score: 420, tigres: 1 });
    expect(ok({ pseudo: "a", score: 100, tigres: 1 }).pseudo).toBe("a");
    expect(ok({ pseudo: "x".repeat(20), score: 500 * 500, tigres: 500 }).tigres).toBe(500);
    // Lettres accentuées et emoji : 20 caractères, pas 20 octets.
    expect(ok({ pseudo: "é".repeat(20), score: 200, tigres: 2 }).pseudo).toHaveLength(20);
    expect(ok({ pseudo: "🐯".repeat(20), score: 200, tigres: 2 }).pseudo).toBe("🐯".repeat(20));
  });

  it("refuse un pseudo vide, trop long, non textuel ou avec un caractère de contrôle", () => {
    expect(refus({ pseudo: "", score: 100, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "   ", score: 100, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "x".repeat(21), score: 100, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: 42, score: 100, tigres: 1 })).toBe(false);
    expect(refus({ score: 100, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "ab\ncd", score: 100, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "ab\u0000", score: 100, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "ab\u007f", score: 100, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "ab\u0085cd", score: 100, tigres: 1 })).toBe(false);
  });

  it("tigres : entier de 1 à 500", () => {
    expect(refus({ pseudo: "a", score: 0, tigres: 0 })).toBe(false);
    expect(refus({ pseudo: "a", score: 100 * 501, tigres: 501 })).toBe(false);
    expect(refus({ pseudo: "a", score: 150, tigres: 1.5 })).toBe(false);
    expect(refus({ pseudo: "a", score: 100, tigres: "1" })).toBe(false);
  });

  it("score : entier multiple de 10, entre 100 et 500 points par tigre", () => {
    expect(refus({ pseudo: "a", score: 90, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "a", score: 510, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "a", score: 425, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "a", score: 420.5, tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "a", score: "420", tigres: 1 })).toBe(false);
    expect(refus({ pseudo: "a", score: 1100, tigres: 2 })).toBe(false);
    expect(refus({ pseudo: "a", score: 190, tigres: 2 })).toBe(false);
    expect(refus({ pseudo: "a", score: 200, tigres: 2 })).toBe(true);
    expect(refus({ pseudo: "a", score: 1000, tigres: 2 })).toBe(true);
  });

  it("refuse un corps absent ou non objet", () => {
    expect(refus(null)).toBe(false);
    expect(refus("score")).toBe(false);
    expect(refus(undefined)).toBe(false);
  });
});

describe("libellés", () => {
  it("rang au féminin", () => {
    expect(rangOrdinal(1)).toBe("1re");
    expect(rangOrdinal(2)).toBe("2e");
    expect(rangOrdinal(11)).toBe("11e");
    expect(messageEnregistre(4)).toBe("Score enregistré, 4e place");
  });
});
