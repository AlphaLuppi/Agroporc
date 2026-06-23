import { describe, it, expect } from "vitest";
import { classerDessertNom, choisirDessert, type DessertConnu } from "./desserts";

const D = (over: Partial<DessertConnu>): DessertConnu => ({
  nom: "X",
  restaurant: "Le Truck Muche",
  type_saveur: "creme_lacte",
  leger_gourmand: "gourmand",
  proba: 50,
  ...over,
});

describe("classerDessertNom", () => {
  it("classe une salade de fruits en fruité/léger", () => {
    expect(classerDessertNom("Salade de fruits")).toEqual({
      type_saveur: "fruite",
      leger_gourmand: "leger",
    });
  });

  it("classe un mi-cuit chocolat en chocolaté/gourmand", () => {
    expect(classerDessertNom("Mi-cuit au chocolat")).toEqual({
      type_saveur: "chocolate",
      leger_gourmand: "gourmand",
    });
  });

  it("classe une tarte en pâtissier/gourmand", () => {
    expect(classerDessertNom("Tarte abricots amandine")).toEqual({
      type_saveur: "patissier",
      leger_gourmand: "gourmand",
    });
  });
});

describe("choisirDessert", () => {
  it("filtre par saveur et trie par proba décroissante", () => {
    const pool = [
      D({ nom: "A", type_saveur: "fruite", proba: 30 }),
      D({ nom: "B", type_saveur: "fruite", proba: 85 }),
      D({ nom: "C", type_saveur: "chocolate", proba: 99 }),
    ];
    expect(choisirDessert(pool, { saveur: "fruite" })?.nom).toBe("B");
  });

  it("départage par note à proba égale", () => {
    const pool = [
      D({ nom: "A", proba: 80, note: 6 }),
      D({ nom: "B", proba: 80, note: 9 }),
    ];
    expect(choisirDessert(pool, {})?.nom).toBe("B");
  });

  it("ne filtre pas un axe non précisé (peu importe)", () => {
    const pool = [D({ nom: "A", proba: 70 })];
    expect(choisirDessert(pool, {})?.nom).toBe("A");
  });

  it("retourne null si aucun dessert ne matche", () => {
    const pool = [D({ nom: "A", type_saveur: "fruite" })];
    expect(choisirDessert(pool, { saveur: "chocolate" })).toBeNull();
  });
});
