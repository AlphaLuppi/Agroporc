import { describe, it, expect } from "vitest";
import type { PdjEntry, Plat } from "./db";
import {
  platsAffiches,
  restosSansPlat,
  meilleureNoteDuJour,
  grilleSemaine,
  restosAbsentsSemaine,
  casseLisible,
  platsAVenir,
  macrosTuile,
} from "./menus-vue";

const plat = (restaurant: string, extra: Partial<Plat> = {}): Plat => ({
  restaurant,
  plat: `Plat ${restaurant}`,
  prix: "12 €",
  ...extra,
});

const jour = (date: string, plats: Plat[], extra: Partial<PdjEntry> = {}): PdjEntry => ({ date, plats, ...extra });

describe("platsAffiches", () => {
  it("met la reco du mode en tête puis trie par note, en gardant l'index d'origine", () => {
    const pdj = jour("2026-10-16", [
      plat("Le Bistrot Trèfle", { note: 6, note_goulaf: 9 }),
      plat("La Pause Gourmande", { note: 9, note_goulaf: 5 }),
      plat("Le Truck Muche", { note: 7, note_goulaf: 7 }),
    ], { recommandation: { restaurant: "Le Truck Muche", plat: "Plat Le Truck Muche", raison: "" } });
    const s = platsAffiches(pdj, "sportif");
    expect(s.map((p) => p.plat.restaurant)).toEqual(["Le Truck Muche", "La Pause Gourmande", "Le Bistrot Trèfle"]);
    expect(s[0].reco).toBe(true);
    expect(s.map((p) => p.platIndex)).toEqual([2, 1, 0]);
    // Pas de reco goulaf : retombe sur la reco sportive.
    expect(platsAffiches(pdj, "goulaf").map((p) => p.note)).toEqual([7, 9, 5]);
  });

  it("éclate les plats multi-options et ignore les « coming soon »", () => {
    const pdj = jour("2026-10-16", [
      plat("Basilic n'Go", { plat: ["Saumon", "Poulet"], options: [{ plat: "Saumon", note: 8 }, { plat: "Poulet", note: 8.5 }] }),
      plat("Dubble", { coming_soon: true }),
    ]);
    const l = platsAffiches(pdj, "sportif");
    expect(l.map((p) => p.variante.plat)).toEqual(["Poulet", "Saumon"]);
    expect(l.every((p) => p.platIndex === 0)).toBe(true);
    expect(platsAVenir(pdj).map((p) => p.restaurant)).toEqual(["Dubble"]);
  });

  it("renvoie une liste vide sans menu", () => {
    expect(platsAffiches(undefined, "sportif")).toEqual([]);
    expect(meilleureNoteDuJour(undefined, "sportif")).toBeUndefined();
  });
});

describe("restosSansPlat", () => {
  it("liste les restos suivis absents du jour, dans l'ordre de référence", () => {
    const pdj = jour("2026-10-16", [plat("Le Bistrot Trèfle"), plat("La Mijote"), plat("Dubble", { coming_soon: true })]);
    expect(restosSansPlat(pdj).map((r) => r.slug)).toEqual(["pause_gourmande", "truck_muche", "basilic_ngo", "vival"]);
  });
});

describe("meilleureNoteDuJour", () => {
  it("prend le max du mode", () => {
    const pdj = jour("2026-10-16", [plat("A", { note: 4, note_goulaf: 9 }), plat("B", { note: 7 })]);
    expect(meilleureNoteDuJour(pdj, "sportif")).toBe(7);
    expect(meilleureNoteDuJour(pdj, "goulaf")).toBe(9);
  });
});

describe("grilleSemaine", () => {
  const semaine = [
    jour("2026-10-12", [plat("Le Bistrot Trèfle", { note: 6 }), plat("Basilic n'Go", { plat: ["X", "Y"], options: [{ plat: "X", note: 5 }, { plat: "Y", note: 9 }] })]),
    jour("2026-10-13", [], { ferie: "Toussaint" }),
    jour("2026-10-14", [plat("Le Bistrot Trèfle", { note: 8 }), plat("Dubble", { coming_soon: true })]),
  ];

  it("a une ligne par resto ayant publié, une case par jour, options triées par note", () => {
    const g = grilleSemaine(semaine, "sportif");
    expect(g.map((l) => l.resto.slug)).toEqual(["bistrot_trefle", "basilic_ngo"]);
    expect(g[0].cases.map((c) => c.map((p) => p.note))).toEqual([[6], [], [8]]);
    expect(g[1].cases[0].map((p) => p.variante.plat)).toEqual(["Y", "X"]);
  });

  it("signale les restos scrapés absents toute la semaine (hors Vival)", () => {
    expect(restosAbsentsSemaine(semaine).map((r) => r.slug)).toEqual(["pause_gourmande", "truck_muche", "dubble", "la_mijote"]);
  });
});

describe("casseLisible", () => {
  it("passe les noms tout en majuscules en casse de phrase", () => {
    expect(casseLisible("CORDON BLEU COMTÉ JAMBON CRU ET POTATOES")).toBe("Cordon bleu comté jambon cru et potatoes");
  });
  it("laisse les noms en casse normale et nettoie espaces et point final", () => {
    expect(casseLisible("Wok de canard.  Nouilles de blé.")).toBe("Wok de canard. Nouilles de blé");
    expect(casseLisible("Poulet Pesto verde ,Cacahuètes")).toBe("Poulet Pesto verde,Cacahuètes");
    expect(casseLisible("BBQ")).toBe("BBQ");
  });
});

describe("macrosTuile", () => {
  it("arrondit protéines, glucides et lipides dans cet ordre", () => {
    const m = macrosTuile({ calories: 640, proteines_g: 31.6, glucides_g: 60.2, lipides_g: 18.5 });
    expect(m?.map((x) => [x.cle, x.grammes])).toEqual([
      ["proteines", 32],
      ["glucides", 60],
      ["lipides", 19],
    ]);
  });

  it("renvoie null sans nutrition ou si une valeur manque", () => {
    expect(macrosTuile(undefined)).toBeNull();
    expect(macrosTuile({ calories: 500, proteines_g: 20, glucides_g: null as unknown as number, lipides_g: 10 })).toBeNull();
  });
});
