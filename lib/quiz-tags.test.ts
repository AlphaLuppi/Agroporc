import { describe, it, expect } from "vitest";
import { tagsForPlat } from "./quiz-tags";

describe("tagsForPlat", () => {
  it("détecte le poisson depuis le nom", () => {
    expect(tagsForPlat({ plat: "Filet de saumon, riz basmati" })).toEqual({
      famille: "poisson",
      proteine: "poisson",
    });
  });

  it("détecte le poulet depuis le nom", () => {
    expect(tagsForPlat({ plat: "Poulet rôti et frites" })).toEqual({
      famille: "viande",
      proteine: "poulet",
    });
  });

  it("détecte le bœuf depuis le nom", () => {
    expect(tagsForPlat({ plat: "Bœuf bourguignon" })).toEqual({
      famille: "viande",
      proteine: "boeuf",
    });
  });

  it("classe un plat sans viande ni poisson en végé", () => {
    expect(tagsForPlat({ plat: "Curry de légumes et lentilles" })).toEqual({
      famille: "vege",
      proteine: "autre",
    });
  });

  it("priorise les ingrédients Ciqual sur le nom du plat", () => {
    expect(
      tagsForPlat({
        plat: "Plat du jour",
        ingredients_detail: [
          { matched_nom: "Poulet, blanc, grillé" } as never,
          { matched_nom: "Riz blanc, cuit" } as never,
        ],
      })
    ).toEqual({ famille: "viande", proteine: "poulet" });
  });

  it("détecte une viande générique sans protéine précise", () => {
    expect(tagsForPlat({ plat: "Steak haché, sauce poivre" })).toEqual({
      famille: "viande",
      proteine: "boeuf",
    });
  });

  it("ne prend pas une sous-chaîne pour un mot-clé (semoule ≠ moule, soleil ≠ sole)", () => {
    expect(tagsForPlat({ plat: "Pastilla de veau aux épices douces. Semoule, légumes fondants." }).proteine).toBe("veau");
    expect(tagsForPlat({ plat: "Paleron de porc rôti, polenta (semoule de maïs)" }).proteine).not.toBe("poisson");
    expect(tagsForPlat({ plat: "Poulet rôti, légumes du soleil" }).proteine).toBe("poulet");
    expect(tagsForPlat({ plat: "Ratatouille au milieu du riz" })).toEqual({ famille: "vege", proteine: "autre" });
  });

  it("accepte pluriels et accords des mots-clés", () => {
    expect(tagsForPlat({ plat: "Moules frites" }).proteine).toBe("poisson");
    expect(tagsForPlat({ plat: "Saucisses grillées, purée" }).proteine).toBe("porc");
    expect(tagsForPlat({ plat: "Boulettes à la tomate" }).famille).toBe("viande");
  });
});
