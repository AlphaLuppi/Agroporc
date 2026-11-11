import { describe, expect, it, vi } from "vitest";
import { canoniserVotant, CLE_PERSONNAGE, ecrireVotant, EVENEMENT_VOTANT, lireVotant } from "./votant";

function faux(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    m,
  };
}

describe("canoniserVotant", () => {
  it("renvoie le nom canonique quelle que soit la casse", () => {
    expect(canoniserVotant("thomas")).toBe("Thomas");
    expect(canoniserVotant("  NOVA ")).toBe("Nova");
    expect(canoniserVotant("philippe hetschebest")).toBe("Philippe Hetschebest");
  });
  it("accepte les alias hérités", () => {
    expect(canoniserVotant("Toam")).toBe("Thomas");
    expect(canoniserVotant("Philippe")).toBe("Philippe Hetschebest");
    expect(canoniserVotant("ophelie")).toBe("Ophélie");
  });
  it("refuse l'inconnu et les non-chaînes", () => {
    expect(canoniserVotant("Zorglub")).toBeNull();
    expect(canoniserVotant("")).toBeNull();
    expect(canoniserVotant(42)).toBeNull();
    expect(canoniserVotant(null)).toBeNull();
    expect(canoniserVotant("__proto__")).toBeNull();
    expect(canoniserVotant("constructor")).toBeNull();
  });
});

describe("lireVotant", () => {
  it("lit et canonise le personnage mémorisé", () => {
    expect(lireVotant(faux({ [CLE_PERSONNAGE]: "gab" }))).toBe("Gab");
  });
  it("renvoie null si absent, inconnu ou sans stockage", () => {
    expect(lireVotant(faux())).toBeNull();
    expect(lireVotant(faux({ [CLE_PERSONNAGE]: "Inconnu" }))).toBeNull();
    expect(lireVotant(null)).toBeNull();
    expect(lireVotant()).toBeNull(); // pas de window en node
  });
  it("ne lève jamais quand l'accès au stockage lève", () => {
    const casse = { getItem: () => { throw new Error("SecurityError"); } };
    expect(lireVotant(casse)).toBeNull();
  });
});

describe("ecrireVotant", () => {
  it("écrit le nom canonique et émet l'événement", () => {
    const s = faux();
    const cible = new EventTarget();
    const ecoute = vi.fn();
    cible.addEventListener(EVENEMENT_VOTANT, ecoute);
    expect(ecrireVotant("thomas", s, cible)).toBe(true);
    expect(s.m.get(CLE_PERSONNAGE)).toBe("Thomas");
    expect(ecoute).toHaveBeenCalledTimes(1);
  });
  it("refuse un nom inconnu sans rien écrire ni émettre", () => {
    const s = faux();
    const cible = new EventTarget();
    const ecoute = vi.fn();
    cible.addEventListener(EVENEMENT_VOTANT, ecoute);
    expect(ecrireVotant("Zorglub", s, cible)).toBe(false);
    expect(s.m.size).toBe(0);
    expect(ecoute).not.toHaveBeenCalled();
  });
  it("renvoie false si le stockage échoue, mais prévient quand même", () => {
    const casse = { setItem: () => { throw new Error("QuotaExceeded"); } };
    const cible = new EventTarget();
    const ecoute = vi.fn();
    cible.addEventListener(EVENEMENT_VOTANT, ecoute);
    expect(ecrireVotant("Tom", casse, cible)).toBe(false);
    expect(ecoute).toHaveBeenCalledTimes(1);
  });
  it("renvoie false sans stockage", () => {
    expect(ecrireVotant("Tom", null, null)).toBe(false);
  });
});
