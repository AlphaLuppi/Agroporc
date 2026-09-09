import { describe, it, expect } from "vitest";
import type { PdjEntry, Plat } from "../db";
import type { Poi } from "./types";
import { etatRestaurant } from "./panneau";

const poi = (name: string): Poi => ({ id: name, name, type: "resto", lon: 0, lat: 0, addr: "", x: 0, z: 0, b: 0, bh: 0 });

const plat = (restaurant: string, extra: Partial<Plat> = {}): Plat => ({ restaurant, plat: `Plat ${restaurant}`, prix: "12 €", ...extra });

const TODAY = "2026-09-09";
const pdj = (plats: Plat[], date = TODAY): PdjEntry => ({ date, plats });

describe("etatRestaurant", () => {
  it("renvoie le plat du jour quand le resto en a un, avec sa carte permanente s'il en a une", () => {
    const p = plat("Le Bistrot Trèfle", { note: 7 });
    expect(etatRestaurant(poi("Le Bistrot Trèfle"), pdj([p]), TODAY)).toEqual({ kind: "plat", plat: p, carteSlug: "bistrot_trefle" });
  });

  it("plat du jour d'un resto sans carte permanente : carteSlug null", () => {
    const p = plat("La Pause Gourmande", { note: 6 });
    expect(etatRestaurant(poi("La Pause Gourmande"), pdj([p]), TODAY)).toEqual({ kind: "plat", plat: p, carteSlug: null });
  });

  it("traite un plat « coming soon » comme un resto sans plat, avec sa carte", () => {
    const etat = etatRestaurant(poi("Le Bistrot Trèfle"), pdj([plat("Le Bistrot Trèfle", { coming_soon: true })]), TODAY);
    expect(etat).toMatchObject({ kind: "sans_plat", statut: "Plat du jour dévoilé le matin même", carteSlug: "bistrot_trefle" });
  });

  it("resto core absent : « Fermé aujourd'hui », carte seulement si le resto en a une", () => {
    const entree = pdj([plat("Le Truck Muche", { note: 6 })]);
    expect(etatRestaurant(poi("Le Bistrot Trèfle"), entree, TODAY)).toMatchObject({ kind: "sans_plat", statut: "Fermé aujourd'hui", carteSlug: "bistrot_trefle" });
    expect(etatRestaurant(poi("La Pause Gourmande"), entree, TODAY)).toMatchObject({ kind: "sans_plat", statut: "Fermé aujourd'hui", carteSlug: null });
  });

  it("resto optionnel absent : pas de plat du jour, carte disponible", () => {
    expect(etatRestaurant(poi("La Mijote"), pdj([]), TODAY)).toMatchObject({ kind: "sans_plat", statut: "Pas de plat du jour aujourd'hui", carteSlug: "la_mijote" });
  });

  it("resto optionnel absent sur une date future : dévoilé le matin même", () => {
    expect(etatRestaurant(poi("Dubble"), pdj([], "2026-09-10"), TODAY)).toMatchObject({ kind: "sans_plat", statut: "Plat du jour dévoilé le matin même", carteSlug: "dubble" });
  });

  it("Vival : bar à salades Picadeli, sans carte", () => {
    expect(etatRestaurant(poi("Vival"), pdj([]), TODAY)).toMatchObject({ kind: "sans_plat", statut: "Bar à salades Picadeli en libre-service, prix au poids", carteSlug: null });
  });

  it("sans menu du jour du tout : statut dédié, la carte reste proposée", () => {
    expect(etatRestaurant(poi("Basilic n'Go"), null, TODAY)).toMatchObject({ kind: "sans_plat", statut: "Menu du jour indisponible", carteSlug: "basilic_ngo" });
  });

  it("bâtiment hors liste des restos : aucun resto, aucune carte", () => {
    expect(etatRestaurant(poi("CBA Informatique Libérale"), pdj([]), TODAY)).toMatchObject({ kind: "sans_plat", resto: null, statut: "Pas de restaurant suivi ici", carteSlug: null });
  });
});
