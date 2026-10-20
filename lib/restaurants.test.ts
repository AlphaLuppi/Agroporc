import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESTAURANTS, SLUG_TO_RESTAURANT, repereResto, restoParNom, statutSansPlat, titreCarte } from "./restaurants";
import { PICTO_BASILIC, PICTO_CAMION, PICTO_DEFAUT, PICTO_TREFLE } from "./resto-pictos";

const bySlug = (slug: string) => RESTAURANTS.find((r) => r.slug === slug)!;

describe("RESTAURANTS", () => {
  it("commence par les 3 historiques puis les optionnels puis Vival", () => {
    expect(RESTAURANTS.map((r) => r.slug)).toEqual([
      "bistrot_trefle", "pause_gourmande", "truck_muche",
      "basilic_ngo", "dubble", "la_mijote", "vival",
    ]);
  });

  it("expose la table slug → nom", () => {
    expect(SLUG_TO_RESTAURANT.bistrot_trefle).toBe("Le Bistrot Trèfle");
    expect(SLUG_TO_RESTAURANT.la_mijote).toBe("La Mijote");
    expect(Object.keys(SLUG_TO_RESTAURANT)).toHaveLength(7);
  });

  it("marque les cartes scrapées", () => {
    expect(RESTAURANTS.filter((r) => r.carte).map((r) => r.slug)).toEqual([
      "bistrot_trefle", "basilic_ngo", "dubble", "la_mijote",
    ]);
  });
});

describe("statutSansPlat", () => {
  it("historique fermé", () => {
    expect(statutSansPlat(bySlug("pause_gourmande"), false)).toBe("Fermé aujourd'hui");
    expect(statutSansPlat(bySlug("pause_gourmande"), true)).toBe("Fermé aujourd'hui");
  });
  it("optionnel aujourd'hui vs jour futur", () => {
    expect(statutSansPlat(bySlug("dubble"), false)).toBe("Pas de plat du jour aujourd'hui");
    expect(statutSansPlat(bySlug("dubble"), true)).toBe("Plat du jour dévoilé le matin même");
  });
  it("Vival", () => {
    expect(statutSansPlat(bySlug("vival"), false)).toBe("Bar à salades Picadeli en libre-service, prix au poids");
  });
});

describe("titreCarte", () => {
  it("accorde l'article", () => {
    expect(titreCarte(bySlug("bistrot_trefle"))).toBe("La carte du Bistrot Trèfle");
    expect(titreCarte(bySlug("la_mijote"))).toBe("La carte de la Mijote");
    expect(titreCarte(bySlug("dubble"))).toBe("La carte de Dubble");
    expect(titreCarte(bySlug("basilic_ngo"))).toBe("La carte de Basilic n'Go");
  });
});

describe("restoParNom", () => {
  it("retrouve un resto par son nom exact", () => {
    expect(restoParNom("Basilic n'Go")?.slug).toBe("basilic_ngo");
    expect(restoParNom("Le Truck Muche")?.slug).toBe("truck_muche");
  });
  it("renvoie undefined pour un nom inconnu ou approchant", () => {
    expect(restoParNom("Chez Gégé")).toBeUndefined();
    expect(restoParNom("le bistrot trèfle")).toBeUndefined();
  });
});

describe("repereResto", () => {
  it("associe les pictos demandés : trèfle, camion, feuille de basilic", () => {
    expect(repereResto("Le Bistrot Trèfle")).toEqual({ court: "Trèfle", picto: PICTO_TREFLE, couleur: "var(--resto-trefle)" });
    expect(repereResto("Le Truck Muche").picto).toBe(PICTO_CAMION);
    expect(repereResto("Basilic n'Go").picto).toBe(PICTO_BASILIC);
  });
  it("replie un resto inconnu sur son nom, des couverts et la couleur atténuée", () => {
    expect(repereResto("Chez Gégé")).toEqual({ court: "Chez Gégé", picto: PICTO_DEFAUT, couleur: "var(--text-muted)" });
  });
  it("donne à chaque resto un picto, une couleur et un nom court distincts", () => {
    for (const cle of ["picto", "couleur", "court"] as const) {
      expect(new Set(RESTAURANTS.map((r) => r[cle])).size).toBe(RESTAURANTS.length);
    }
    expect(RESTAURANTS.map((r) => r.picto)).not.toContain(PICTO_DEFAUT);
  });
  it("garde des pictos limités à des formes SVG simples (injectés tels quels)", () => {
    for (const r of RESTAURANTS) {
      const balises = [...r.picto.matchAll(/<(\w+)/g)].map((m) => m[1]);
      expect(balises.length).toBeGreaterThan(0);
      expect(balises.every((b) => b === "path" || b === "circle")).toBe(true);
    }
  });
  it("définit chaque token de couleur dans les trois thèmes", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    for (const r of RESTAURANTS) {
      const token = r.couleur.match(/^var\((--resto-[a-z]+)\)$/)?.[1];
      expect(token, r.nom).toBeTruthy();
      expect(css.split(`${token}:`).length - 1, token).toBe(3);
    }
  });
});
