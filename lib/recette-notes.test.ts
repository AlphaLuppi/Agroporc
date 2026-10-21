import { describe, expect, it } from "vitest";
import type { PdjEntry, Plat } from "./db";
import vecteurs from "./plat-image-vecteurs.json";
import { clePlatImage } from "./plat-image-cle";
import { fusionnerNotes, noteValide, notesDuJour, proteineDepuisRecette, type NotesVariante } from "./recette-notes";

const jour = (date: string, plats: Partial<Plat>[], extra: Partial<PdjEntry> = {}): PdjEntry => ({
  date,
  plats: plats.map((p) => ({ restaurant: "Le Bistrot Trèfle", prix: "12€", plat: "", ...p }) as Plat),
  ...extra,
});

describe("notesDuJour", () => {
  it("plat simple : base, notes, protéine du tag LLM", () => {
    const [n, ...reste] = notesDuJour(jour("2026-10-20", [
      { plat: "Suprême de volaille, purée", note: 7.5, note_goulaf: 6, quiz_tags: { envie: "poulet" } },
    ]));
    expect(reste).toHaveLength(0);
    expect(n).toEqual({
      base: "le bistrot trefle|supreme de volaille puree", restaurant: "Le Bistrot Trèfle", plat: "Suprême de volaille, purée",
      date: "2026-10-20", sportif: 7.5, goulaf: 6, proteine: "poulet",
    });
  });

  it("multi-options : une entrée par option, avec ses notes et ses tags", () => {
    const notes = notesDuJour(jour("2026-10-20", [{
      restaurant: "Basilic n'Go",
      plat: ["Bowl saumon", "Bowl falafel"],
      options: [
        { plat: "Bowl saumon", note: 8, note_goulaf: 6.5, quiz_tags: { envie: "poisson" } },
        { plat: "Bowl falafel", note: 7, note_goulaf: 7.5, quiz_tags: { envie: "vege" } },
      ],
    }]));
    expect(notes.map((n) => [n.plat, n.sportif, n.goulaf, n.proteine])).toEqual([
      ["Bowl saumon", 8, 6.5, "poisson"],
      ["Bowl falafel", 7, 7.5, "vege"],
    ]);
  });

  it("tableau de noms sans options : aucune note, aucune entrée", () => {
    expect(notesDuJour(jour("2026-10-20", [{ restaurant: "Dubble", plat: ["A", "B"] }]))).toEqual([]);
  });

  it("écarte coming soon, jour férié, nom vide après normalisation et variante sans note", () => {
    expect(notesDuJour(jour("2026-10-20", [{ plat: "Tajine", note: 6, coming_soon: true }]))).toEqual([]);
    expect(notesDuJour(jour("2026-11-11", [{ plat: "Tajine", note: 6 }], { ferie: "Armistice" }))).toEqual([]);
    expect(notesDuJour(jour("2026-10-20", [{ plat: "— ?", note: 6 }]))).toEqual([]);
    expect(notesDuJour(jour("2026-10-20", [{ plat: "Tajine" }]))).toEqual([]);
  });

  it("ignore un jour publié d'avance, pas encore servi (le menu peut encore changer)", () => {
    const j = jour("2026-10-22", [{ plat: "Tajine", note: 6 }]);
    expect(notesDuJour(j, "2026-10-21")).toEqual([]);
    expect(notesDuJour(j, "2026-10-22")).toHaveLength(1);
    expect(notesDuJour(jour("2026-10-22T00:00:00.000Z", [{ plat: "Tajine", note: 6 }]), "2026-10-22")).toHaveLength(1);
  });

  it("Goulaf absente : repli sur la note Sportif", () => {
    const [n] = notesDuJour(jour("2026-10-20", [{ plat: "Tajine d'agneau", note: 6 }]));
    expect(n.goulaf).toBe(6);
  });

  it("doublon de base dans un même jour : la première variante notée l'emporte", () => {
    const notes = notesDuJour(jour("2026-10-20", [
      { restaurant: "Le Truck Muche", plat: "Poke bowl saumon teryaki" },
      { restaurant: "Le Truck Muche", plat: "POKE BOWL SAUMON TERYAKI", note: 6 },
      { restaurant: "Le Truck Muche", plat: "Poke bowl saumon teryaki.", note: 9 },
    ]));
    expect(notes).toHaveLength(1);
    expect(notes[0].sportif).toBe(6);
  });

  it("date tronquée à YYYY-MM-DD", () => {
    const [n] = notesDuJour(jour("2026-10-20T00:00:00.000Z", [{ plat: "Tajine", note: 6 }]));
    expect(n.date).toBe("2026-10-20");
  });

  it("protéine : agneau → veau ; sans tags, mots-clés", () => {
    const [a, b] = notesDuJour(jour("2026-10-20", [
      { plat: "Navarin printanier", note: 6, quiz_tags: { envie: "agneau" } },
      { plat: "Blanquette de dinde", note: 6 },
    ]));
    expect(a.proteine).toBe("veau");
    expect(b.proteine).toBe("poulet");
  });

  it("garde-fou : la clé d'une variante est celle des vecteurs partagés avec le Python", () => {
    const v = vecteurs.vecteurs[0];
    const [n] = notesDuJour(jour("2026-10-20", [{ restaurant: v.restaurant, plat: v.plat, note: 7 }]));
    expect(n.base).toBe(v.base);
    expect(clePlatImage(n.restaurant, n.plat)).toBe(v.cle);
  });
});

describe("noteValide", () => {
  it("bornée à [0, 10], arrondie au dixième", () => {
    expect(noteValide(Number.NaN)).toBeNull();
    expect(noteValide(12)).toBeNull();
    expect(noteValide(-1)).toBeNull();
    expect(noteValide("7")).toBeNull();
    expect(noteValide(undefined)).toBeNull();
    expect(noteValide(7.25)).toBe(7.3);
    expect(noteValide(8.300000190734863)).toBe(8.3);
    expect(noteValide(0)).toBe(0);
  });
});

describe("fusionnerNotes", () => {
  const n = (base: string, date: string, sportif: number): NotesVariante => ({
    base, restaurant: "R", plat: base, date, sportif, goulaf: sportif, proteine: "autre",
  });
  it("une entrée par base, la date la plus récente gagne (même publiée d'avance)", () => {
    const out = fusionnerNotes([n("a", "2026-10-23", 8), n("a", "2026-10-13", 6), n("b", "2026-10-01", 5)]);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.base === "a")!.sportif).toBe(8);
  });
  it("à date égale, la dernière rencontrée", () => {
    expect(fusionnerNotes([n("a", "2026-10-20", 6), n("a", "2026-10-20", 7)])[0].sportif).toBe(7);
  });
});

describe("proteineDepuisRecette", () => {
  it("mots-clés du plat, du titre et des ingrédients", () => {
    expect(proteineDepuisRecette("Dubble", "Bowl du jour", { titre: "Bowl au poulet rôti", ingredients: [] })).toBe("poulet");
    expect(proteineDepuisRecette("La Mijote", "Gratin de courgettes", {
      titre: "Gratin de courgettes", ingredients: [{ nom: "courgette", quantite: 500, unite: "g" }],
    })).toBe("vege");
  });

  it("le plat et le titre priment ; bouillons et fonds ignorés", () => {
    const ingredients = [
      { nom: "épaule de veau", quantite: 600, unite: "g" },
      { nom: "bouillon de volaille", quantite: 20, unite: "cl" },
      { nom: "semoule moyenne", quantite: 200, unite: "g" },
    ];
    expect(proteineDepuisRecette("Le Bistrot Trèfle", "Pastilla de veau. Semoule.", { titre: "Pastilla de veau", ingredients })).toBe("veau");
    expect(proteineDepuisRecette("Dubble", "Bowl du jour", { titre: "Bowl du jour", ingredients })).toBe("veau");
    expect(proteineDepuisRecette("La Pause Gourmande", "Risotto butternut", {
      titre: "Risotto butternut", ingredients: [{ nom: "bouillon de volaille", quantite: 1, unite: "l" }],
    })).toBe("vege");
  });
});
