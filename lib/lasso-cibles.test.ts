import { describe, expect, it } from "vitest";
import { cibleSous, enregistrerCible, type CibleLasso } from "./lasso-cibles";
import { touche } from "./tigre-lasso";

const cible = (zone: CibleLasso["zone"]): CibleLasso => ({
  taille: () => 200, zone, attraper: () => null, serrer: () => {}, relacher: () => {},
});

describe("cibles du lasso", () => {
  it("trouve la cible sous la boucle, la plus récente d'abord, et l'oublie une fois retirée", () => {
    const tigre = cible(() => ({ x: 0, y: 500, w: 200, h: 150 }));
    const macron = cible(() => ({ x: 150, y: 450, w: 100, h: 220 }));
    const retirerTigre = enregistrerCible(tigre);
    const retirerMacron = enregistrerCible(macron);
    expect(cibleSous({ x: 50, y: 550 }, touche)).toBe(tigre);
    expect(cibleSous({ x: 180, y: 560 }, touche)).toBe(macron);
    expect(cibleSous({ x: 900, y: 100 }, touche)).toBeNull();
    retirerMacron();
    expect(cibleSous({ x: 180, y: 560 }, touche)).toBe(tigre);
    retirerTigre();
    expect(cibleSous({ x: 50, y: 550 }, touche)).toBeNull();
  });

  it("une cible sans zone (pas à l'écran, famille) ne s'attrape pas", () => {
    const retirer = enregistrerCible(cible(() => null));
    expect(cibleSous({ x: 0, y: 0 }, touche)).toBeNull();
    retirer();
  });
});
