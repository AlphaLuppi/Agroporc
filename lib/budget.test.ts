import { describe, expect, it } from "vitest";
import { fmtPartBudget, fmtPourcent, partBudget, prixEnEuros, repasParMois, titreBudget } from "./budget";

describe("prixEnEuros", () => {
  it("lit les prix simples, point ou virgule, avec ou sans €", () => {
    expect(prixEnEuros("11.9€")).toBe(11.9);
    expect(prixEnEuros("11,90 €")).toBe(11.9);
    expect(prixEnEuros(" 13 ")).toBe(13);
  });
  it("refuse le reste", () => {
    expect(prixEnEuros(undefined)).toBeNull();
    expect(prixEnEuros("")).toBeNull();
    expect(prixEnEuros("de 9 à 12 €")).toBeNull();
    expect(prixEnEuros("0 €")).toBeNull();
  });
});

describe("partBudget", () => {
  it("rapporte le prix aux 172 € mensuels", () => {
    expect(partBudget(17.2)).toBeCloseTo(10);
    expect(partBudget(172)).toBeCloseTo(100);
    expect(partBudget(null)).toBeNull();
    expect(partBudget(10, 0)).toBeNull();
  });
});

describe("fmtPartBudget", () => {
  it("une décimale à la virgule, espace insécable", () => {
    expect(fmtPartBudget("11.9€")).toBe("6,9 %");
    expect(fmtPartBudget("17,20 €")).toBe("10,0 %");
    expect(fmtPartBudget("prix libre")).toBe("");
    expect(fmtPourcent(null)).toBe("");
  });
});

describe("repasParMois / titreBudget", () => {
  it("compte les repas entiers finançables", () => {
    expect(repasParMois("11,90 €")).toBe(14);
    expect(repasParMois("?")).toBeNull();
  });
  it("infobulle seulement avec un prix exploitable", () => {
    expect(titreBudget("11.9€")).toBe("6,9 % des 172 € mensuels de la carte Edenred");
    expect(titreBudget(undefined)).toBeUndefined();
  });
});
