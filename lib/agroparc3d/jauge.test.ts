import { describe, it, expect } from "vitest";
import { couleurNote, remplissage, COULEUR_SANS_NOTE } from "./jauge";

describe("remplissage", () => {
  it("note sur 10 → fraction [0, 1]", () => {
    expect(remplissage(0)).toBe(0);
    expect(remplissage(5)).toBe(0.5);
    expect(remplissage(10)).toBe(1);
  });

  it("borne les valeurs hors échelle et vide sans note", () => {
    expect(remplissage(12)).toBe(1);
    expect(remplissage(-3)).toBe(0);
    expect(remplissage(undefined)).toBe(0);
  });
});

describe("couleurNote", () => {
  it("rouge à 0, ambre à 5, vert à 10", () => {
    expect(couleurNote(0)).toBe("#ff5a4a");
    expect(couleurNote(5)).toBe("#ffb35c");
    expect(couleurNote(10)).toBe("#5ce0a0");
  });

  it("interpole entre les paliers (2,5 = mi-chemin rouge → ambre)", () => {
    expect(couleurNote(2.5)).toBe("#ff8753");
  });

  it("couleur neutre sans note, bornes respectées", () => {
    expect(couleurNote(undefined)).toBe(COULEUR_SANS_NOTE);
    expect(couleurNote(14)).toBe("#5ce0a0");
    expect(couleurNote(-1)).toBe("#ff5a4a");
  });
});
