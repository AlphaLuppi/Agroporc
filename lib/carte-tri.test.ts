import { describe, it, expect } from "vitest";
import type { Carte, CartePlat, CarteSection } from "./db";
import { noteMode, trierCarte } from "./carte-tri";

const p = (plat: string, note?: number, note_goulaf?: number): CartePlat => ({ plat, prix: "10 €", note, note_goulaf });

const carte = (sections: CarteSection[]): Carte => ({ restaurant_slug: "test", hash: "h", sections });

describe("noteMode", () => {
  it("renvoie la note du mode demandé", () => {
    expect(noteMode(p("x", 4, 8), "sportif")).toBe(4);
    expect(noteMode(p("x", 4, 8), "goulaf")).toBe(8);
  });

  it("retombe sur la note sportive si la note goulaf manque", () => {
    expect(noteMode(p("x", 4), "goulaf")).toBe(4);
  });

  it("renvoie undefined sans aucune note", () => {
    expect(noteMode(p("x"), "sportif")).toBeUndefined();
    expect(noteMode(p("x"), "goulaf")).toBeUndefined();
  });
});

describe("trierCarte", () => {
  it("trie les plats de chaque section par note décroissante, les non notés en dernier", () => {
    const c = carte([{ nom: "Plats", plats: [p("mauvais", 3), p("sans note"), p("bon", 9)] }]);
    expect(trierCarte(c)[0].plats.map((x) => x.plat)).toEqual(["bon", "mauvais", "sans note"]);
  });

  it("trie les sections par note moyenne décroissante, les sections sans note en dernier", () => {
    const c = carte([
      { nom: "Desserts", plats: [p("a", 2), p("b", 4)] },
      { nom: "Boissons", plats: [p("c")] },
      { nom: "Salades", plats: [p("d", 8), p("e", 6)] },
    ]);
    expect(trierCarte(c).map((s) => s.nom)).toEqual(["Salades", "Desserts", "Boissons"]);
  });

  it("utilise la note goulaf en mode goulaf", () => {
    const c = carte([
      { nom: "Léger", plats: [p("a", 9, 2)] },
      { nom: "Gras", plats: [p("b", 3, 9)] },
    ]);
    expect(trierCarte(c, "sportif").map((s) => s.nom)).toEqual(["Léger", "Gras"]);
    expect(trierCarte(c, "goulaf").map((s) => s.nom)).toEqual(["Gras", "Léger"]);
  });

  it("ne modifie pas la carte d'origine", () => {
    const c = carte([{ nom: "Plats", plats: [p("a", 1), p("b", 9)] }]);
    trierCarte(c);
    expect(c.sections[0].plats.map((x) => x.plat)).toEqual(["a", "b"]);
  });
});
