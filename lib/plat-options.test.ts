import { describe, it, expect } from "vitest";
import type { Plat } from "./db";
import { variantesPlat, libellePlat, meilleureNote, estMultiOptions } from "./plat-options";

const simple: Plat = {
  restaurant: "Le Bistrot Trèfle",
  plat: "Tajine d'agneau aux abricots",
  prix: "12,50€",
  note: 6,
  note_goulaf: 8,
  justification: "Sportif.",
  justification_goulaf: "Goulaf.",
  nutrition_source: "ciqual",
};

const multi: Plat = {
  restaurant: "Basilic n'Go",
  plat: ["Emietté de saumon, poêlée indienne et boulgour", "Sauté de boeuf, légumes de saison et riz"],
  prix: "10,90€",
  commentaires: [],
  options: [
    { plat: "Emietté de saumon, poêlée indienne et boulgour", note: 8.5, note_goulaf: 7, justification: "S1", justification_goulaf: "G1" },
    { plat: "Sauté de boeuf, légumes de saison et riz", note: 8, note_goulaf: 6.5, justification: "S2", justification_goulaf: "G2" },
  ],
};

describe("variantesPlat", () => {
  it("un plat simple donne une seule variante, lui-même", () => {
    const [v, ...rest] = variantesPlat(simple);
    expect(rest).toEqual([]);
    expect(v).toMatchObject({ plat: "Tajine d'agneau aux abricots", note: 6, note_goulaf: 8, justification: "Sportif.", nutrition_source: "ciqual" });
  });

  it("un plat multi-options donne une variante par option, avec ses notes", () => {
    const vs = variantesPlat(multi);
    expect(vs.map((v) => v.plat)).toEqual(["Emietté de saumon, poêlée indienne et boulgour", "Sauté de boeuf, légumes de saison et riz"]);
    expect(vs.map((v) => v.note)).toEqual([8.5, 8]);
    expect(vs.map((v) => v.note_goulaf)).toEqual([7, 6.5]);
    expect(vs.map((v) => v.justification_goulaf)).toEqual(["G1", "G2"]);
  });

  it("une option sans nom reprend le nom correspondant du tableau plat", () => {
    const p: Plat = { ...multi, options: [{ note: 5 }, { note: 6 }] };
    expect(variantesPlat(p).map((v) => v.plat)).toEqual(multi.plat);
  });

  it("un plat dont le nom est une liste mais sans options notées donne une variante par nom, non notée", () => {
    const p: Plat = { restaurant: "Dubble", plat: ["Hot bowl classique", "Hot bowl vegé"], prix: "9,90€" };
    const vs = variantesPlat(p);
    expect(vs.map((v) => v.plat)).toEqual(["Hot bowl classique", "Hot bowl vegé"]);
    expect(vs.every((v) => v.note === undefined)).toBe(true);
  });

  it("ignore un tableau options vide", () => {
    expect(variantesPlat({ ...simple, options: [] })).toHaveLength(1);
  });
});

describe("libellePlat", () => {
  it("renvoie le nom tel quel pour un plat simple", () => {
    expect(libellePlat(simple)).toBe("Tajine d'agneau aux abricots");
  });
  it("joint les options par « ou » pour un plat multi-options", () => {
    expect(libellePlat(multi)).toBe("Emietté de saumon, poêlée indienne et boulgour ou Sauté de boeuf, légumes de saison et riz");
  });
});

describe("estMultiOptions", () => {
  it("vrai seulement quand il y a plusieurs variantes", () => {
    expect(estMultiOptions(simple)).toBe(false);
    expect(estMultiOptions(multi)).toBe(true);
  });
});

describe("meilleureNote", () => {
  it("plat simple : sa note du mode, Goulaf retombe sur la note sportive si absente", () => {
    expect(meilleureNote(simple, "sportif")).toBe(6);
    expect(meilleureNote(simple, "goulaf")).toBe(8);
    expect(meilleureNote({ ...simple, note_goulaf: undefined }, "goulaf")).toBe(6);
  });
  it("plat multi-options : la meilleure note parmi les options, par mode", () => {
    expect(meilleureNote(multi, "sportif")).toBe(8.5);
    expect(meilleureNote(multi, "goulaf")).toBe(7);
  });
  it("undefined quand aucune variante n'est notée", () => {
    expect(meilleureNote({ restaurant: "X", plat: "Coming soon", prix: "N/A", coming_soon: true }, "sportif")).toBeUndefined();
  });
});
