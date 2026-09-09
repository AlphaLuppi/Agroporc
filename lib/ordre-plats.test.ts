import { describe, it, expect } from "vitest";
import type { Plat } from "./db";
import { separerPlats } from "./ordre-plats";

const plat = (restaurant: string, extra: Partial<Plat> = {}): Plat => ({
  restaurant,
  plat: `Plat ${restaurant}`,
  prix: "12 €",
  ...extra,
});

describe("separerPlats", () => {
  it("place les plats notés avant les « coming soon », en conservant l'index d'origine", () => {
    const plats = [
      plat("Le Bistrot Trèfle", { coming_soon: true }),
      plat("La Pause Gourmande", { note: 7 }),
      plat("Le Truck Muche", { note: 8 }),
      plat("Dubble", { coming_soon: true }),
    ];
    const { notes, comingSoon } = separerPlats(plats);
    expect(notes.map((p) => p.index)).toEqual([1, 2]);
    expect(notes.map((p) => p.plat.restaurant)).toEqual(["La Pause Gourmande", "Le Truck Muche"]);
    expect(comingSoon.map((p) => p.index)).toEqual([0, 3]);
  });

  it("garde l'ordre relatif d'origine dans chaque groupe", () => {
    const plats = [plat("A", { note: 3 }), plat("B", { note: 9 }), plat("C", { note: 5 })];
    expect(separerPlats(plats).notes.map((p) => p.plat.restaurant)).toEqual(["A", "B", "C"]);
  });

  it("renvoie deux listes vides sans plat", () => {
    expect(separerPlats([])).toEqual({ notes: [], comingSoon: [] });
  });
});
