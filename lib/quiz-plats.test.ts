import { describe, it, expect } from "vitest";
import { choisirPlat, type PoolPlat } from "./quiz-plats";

const P = (over: Partial<PoolPlat>): PoolPlat => ({
  plat: "Plat",
  restaurant: "Resto",
  prix: "10€",
  ...over,
});

describe("choisirPlat", () => {
  it("filtre par famille et trie par note du mode (sportif)", () => {
    const pool = [
      P({ plat: "Poulet rôti", note: 6 }),
      P({ plat: "Saumon grillé", note: 9 }),
      P({ plat: "Bœuf carottes", note: 8 }),
    ];
    const r = choisirPlat(pool, { famille: "viande" }, "sportif");
    expect(r.exact).toBe(true);
    expect(r.resultat?.plat).toBe("Bœuf carottes");
  });

  it("utilise note_goulaf en mode goulaf", () => {
    const pool = [
      P({ plat: "Poulet rôti", note: 9, note_goulaf: 4 }),
      P({ plat: "Poulet curry", note: 4, note_goulaf: 9 }),
    ];
    const r = choisirPlat(pool, { proteine: "poulet" }, "goulaf");
    expect(r.resultat?.plat).toBe("Poulet curry");
  });

  it("retombe sur le plus proche (exact=false) si aucun match", () => {
    const pool = [P({ plat: "Poulet rôti", note: 7 })];
    const r = choisirPlat(pool, { famille: "poisson" }, "sportif");
    expect(r.exact).toBe(false);
    expect(r.resultat?.plat).toBe("Poulet rôti");
  });

  it("retourne null si le pool est vide", () => {
    const r = choisirPlat([], { famille: "viande" }, "sportif");
    expect(r.resultat).toBeNull();
    expect(r.exact).toBe(false);
  });
});
