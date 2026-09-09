import { describe, it, expect } from "vitest";
import { RESTAURANTS, SLUG_TO_RESTAURANT, statutSansPlat, titreCarte } from "./restaurants";

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
