import { describe, expect, it } from "vitest";
import { ANGLE_D_OR, couleurJoueur, hslVersHex } from "./couleurs";
import { PALETTE } from "./match";

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];
const distance = (a: string, b: string): number => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

describe("couleurs des joueurs", () => {
  it("convertit correctement HSL en #rrggbb", () => {
    expect(hslVersHex(0, 100, 50)).toBe("#ff0000");
    expect(hslVersHex(120, 100, 50)).toBe("#00ff00");
    expect(hslVersHex(240, 100, 50)).toBe("#0000ff");
    expect(hslVersHex(0, 0, 100)).toBe("#ffffff");
    expect(hslVersHex(-120, 100, 50)).toBe("#0000ff");
  });

  it("rend toujours un #rrggbb en minuscules", () => {
    for (let r = 0; r < 200; r++) expect(couleurJoueur(r)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("est déterministe", () => {
    expect(couleurJoueur(7)).toBe(couleurJoueur(7));
  });

  it("donne 50 couleurs deux à deux distinctes", () => {
    const cs = Array.from({ length: 50 }, (_, r) => couleurJoueur(r));
    expect(new Set(cs).size).toBe(50);
  });

  it("donne 50 couleurs distinctes de la PALETTE de match.ts", () => {
    const palette = new Set(PALETTE.map((c) => c.toLowerCase()));
    for (let r = 0; r < 50; r++) expect(palette.has(couleurJoueur(r))).toBe(false);
  });

  it("garde un écart visible entre deux rangs voisins et avec la palette", () => {
    for (let r = 0; r < 50; r++) {
      expect(distance(couleurJoueur(r), couleurJoueur(r + 1))).toBeGreaterThan(40);
      for (const p of PALETTE) expect(distance(couleurJoueur(r), p)).toBeGreaterThan(3);
    }
  });

  it("ramène un rang invalide au rang 0", () => {
    expect(couleurJoueur(-3)).toBe(couleurJoueur(0));
    expect(couleurJoueur(Number.NaN)).toBe(couleurJoueur(0));
    expect(couleurJoueur(2.9)).toBe(couleurJoueur(2));
  });

  it("avance la teinte d'un angle d'or", () => {
    expect(ANGLE_D_OR).toBeCloseTo(360 * (1 - 1 / ((1 + Math.sqrt(5)) / 2)), 6);
  });
});
