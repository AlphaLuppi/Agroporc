import { describe, it, expect } from "vitest";
import {
  envieForPlat,
  cuisineForPlat,
  lourdeurForPlat,
  budgetForPlat,
  prixEuros,
  meilleursCandidats,
  type Criteres,
} from "./quiz-engine";
import type { PoolPlat, Mode } from "./quiz-plats";

const P = (over: Partial<PoolPlat>): PoolPlat => ({
  plat: "Plat",
  restaurant: "Resto",
  prix: "12€",
  ...over,
});

describe("tags", () => {
  it("envie : famille/protéine → axe combiné", () => {
    expect(envieForPlat(P({ plat: "Poulet rôti" }))).toBe("poulet");
    expect(envieForPlat(P({ plat: "Bœuf bourguignon" }))).toBe("boeuf");
    expect(envieForPlat(P({ plat: "Gigot d'agneau" }))).toBe("veau");
    expect(envieForPlat(P({ plat: "Saumon grillé" }))).toBe("poisson");
    expect(envieForPlat(P({ plat: "Curry de légumes" }))).toBe("vege");
  });

  it("cuisine : mots-clés du nom", () => {
    expect(cuisineForPlat(P({ plat: "Wok de bœuf, nouilles" }))).toBe("asiatique");
    expect(cuisineForPlat(P({ plat: "Burger maison frites" }))).toBe("streetfood");
    expect(cuisineForPlat(P({ plat: "Risotto aux champignons" }))).toBe("mediterraneen");
    expect(cuisineForPlat(P({ plat: "Salade César" }))).toBe("froid");
    expect(cuisineForPlat(P({ plat: "Bœuf bourguignon" }))).toBe("mijote");
  });

  it("budget : seuil 10€", () => {
    expect(prixEuros("11.9€")).toBe(11.9);
    expect(prixEuros("9,50 €")).toBe(9.5);
    expect(budgetForPlat(P({ prix: "9.5€" }))).toBe("eco");
    expect(budgetForPlat(P({ prix: "13€" }))).toBe("standard");
  });

  it("lourdeur : mots-clés puis note en repli", () => {
    expect(lourdeurForPlat(P({ plat: "Salade de quinoa" }))).toBe("leger");
    expect(lourdeurForPlat(P({ plat: "Gratin dauphinois" }))).toBe("copieux");
    expect(lourdeurForPlat(P({ plat: "Plat neutre", note: 8 }))).toBe("leger");
    expect(lourdeurForPlat(P({ plat: "Plat neutre", note: 4 }))).toBe("copieux");
  });
});

describe("meilleursCandidats", () => {
  const pool = [
    P({ plat: "Wok de bœuf asiatique nouilles", prix: "11.9€", note: 7, note_goulaf: 8 }),
    P({ plat: "Poulet rôti pommes de terre", prix: "9.9€", note: 8, note_goulaf: 6 }),
    P({ plat: "Curry de légumes coco", prix: "10€", note: 9, note_goulaf: 7 }),
  ];

  it("un critère précis isole le plat correspondant", () => {
    const r = meilleursCandidats(pool, { envie: "poulet" }, "sportif");
    expect(r.candidats).toHaveLength(1);
    expect(r.candidats[0].plat).toContain("Poulet");
    expect(r.exact).toBe(true);
  });

  it("chaque plat est atteignable via son profil exact", () => {
    for (const p of pool) {
      const c: Criteres = {
        envie: envieForPlat(p) === "autre" ? undefined : (envieForPlat(p) as Criteres["envie"]),
        cuisine: cuisineForPlat(p) === "autre" ? undefined : (cuisineForPlat(p) as Criteres["cuisine"]),
        lourdeur: lourdeurForPlat(p),
        budget: budgetForPlat(p),
      };
      const r = meilleursCandidats(pool, c, "sportif");
      expect(r.candidats.map((x) => x.plat)).toContain(p.plat);
    }
  });

  it("aucun critère → tous candidats triés par note (recommandation)", () => {
    const r = meilleursCandidats(pool, {}, "sportif");
    expect(r.nbCriteres).toBe(0);
    expect(r.candidats[0].plat).toContain("Curry"); // note 9
  });

  it("repli au plus proche si aucun plat ne matche (exact=false)", () => {
    const r = meilleursCandidats(pool, { envie: "porc" }, "sportif");
    expect(r.exact).toBe(false);
    expect(r.candidats.length).toBeGreaterThan(0); // toujours un plat du jour
  });

  it("déterminisme : mêmes critères → mêmes candidats dans le même ordre", () => {
    const c: Criteres = { envie: "boeuf", cuisine: "asiatique" };
    const a = meilleursCandidats(pool, c, "goulaf").candidats.map((x) => x.plat);
    const b = meilleursCandidats(pool, c, "goulaf").candidats.map((x) => x.plat);
    expect(a).toEqual(b);
  });

  it("pool vide → aucun candidat", () => {
    const r = meilleursCandidats([], { envie: "poulet" }, "sportif");
    expect(r.candidats).toEqual([]);
  });
});
