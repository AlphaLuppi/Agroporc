import { describe, expect, it } from "vitest";
import { placerEtiquette, rectEtiquette, seChevauchent, type RectEtiquette } from "./etiquettes";

describe("rectEtiquette", () => {
  it("centrée en x, posée au-dessus de l'ancre", () => {
    expect(rectEtiquette(100, 50, 40, 20)).toEqual({ x0: 80, y0: 30, x1: 120, y1: 50 });
  });
});

describe("seChevauchent", () => {
  const a = rectEtiquette(100, 50, 40, 20);
  it("recouvrement, voisinage et éloignement", () => {
    expect(seChevauchent(a, rectEtiquette(110, 55, 40, 20))).toBe(true);
    expect(seChevauchent(a, rectEtiquette(200, 50, 40, 20))).toBe(false);
    expect(seChevauchent(a, rectEtiquette(100, 90, 40, 20))).toBe(false);
  });
  it("la marge sépare deux étiquettes qui se touchent presque", () => {
    const voisine = rectEtiquette(141, 50, 40, 20); // à 1 px de a
    expect(seChevauchent(a, voisine, 0)).toBe(false);
    expect(seChevauchent(a, voisine, 2)).toBe(true);
  });
});

describe("placerEtiquette", () => {
  it("les prioritaires d'abord : un nom de joueur sur un nom de restaurant est masqué", () => {
    const occupes: RectEtiquette[] = [];
    expect(placerEtiquette(occupes, rectEtiquette(300, 200, 120, 40))).toBe(true); // restaurant
    expect(placerEtiquette(occupes, rectEtiquette(310, 190, 60, 22))).toBe(false); // joueur dessus
    expect(placerEtiquette(occupes, rectEtiquette(600, 190, 60, 22))).toBe(true); // joueur ailleurs
    expect(occupes).toHaveLength(2);
  });
  it("plusieurs noms entassés au même point : seul le premier est affiché, l'ordre décide", () => {
    const occupes: RectEtiquette[] = [];
    const posees = [0, 1, 2, 3].map(() => placerEtiquette(occupes, rectEtiquette(400, 300, 60, 22)));
    expect(posees).toEqual([true, false, false, false]);
  });
});
