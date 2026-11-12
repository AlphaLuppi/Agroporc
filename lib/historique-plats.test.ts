import { describe, expect, it } from "vitest";
import {
  filtrerHistorique, hrefHistorique, PAR_PAGE, parametresHistorique, type ParametresHistorique, type PlatHistorique,
} from "./historique-plats";

const defaut: ParametresHistorique = { q: "", restaurant: null, tri: "recents", photo: false, page: 1 };

function plat(nom: string, o: Partial<PlatHistorique> = {}): PlatHistorique {
  return {
    cle: o.cle ?? nom.toLowerCase().replace(/\W+/g, "-"),
    base: "x|" + nom, restaurant: "Le Bistrot Trèfle", nom,
    dates: ["2026-11-01"], premiere: "2026-11-01", derniere: "2026-11-01", nbServices: 1,
    prix: null, noteSportif: null, noteGoulaf: null, victoires: 0, aImage: false, ...o,
  };
}

describe("parametresHistorique", () => {
  it("renvoie les défauts sans paramètre", () => {
    expect(parametresHistorique({})).toEqual(defaut);
  });
  it("prend la dernière valeur d'un paramètre répété", () => {
    const p = parametresHistorique({ tri: ["alpha", "servis"], q: ["a", "b"], page: ["2", "3"] });
    expect(p).toMatchObject({ tri: "servis", q: "b", page: 3 });
  });
  it("normalise et tronque q", () => {
    expect(parametresHistorique({ q: "  pâtes    carbo " }).q).toBe("pâtes carbo");
    expect(parametresHistorique({ q: "x".repeat(200) }).q).toHaveLength(60);
  });
  it("ignore un restaurant ou un tri inconnu", () => {
    expect(parametresHistorique({ restaurant: "mcdo", tri: "hasard" })).toMatchObject({ restaurant: null, tri: "recents" });
    expect(parametresHistorique({ restaurant: "__proto__" }).restaurant).toBeNull();
    expect(parametresHistorique({ restaurant: "truck_muche" }).restaurant).toBe("truck_muche");
  });
  it("photo vrai pour 1, on, true", () => {
    for (const v of ["1", "on", "true", "ON"]) expect(parametresHistorique({ photo: v }).photo).toBe(true);
    for (const v of ["0", "", "non", "yes"]) expect(parametresHistorique({ photo: v }).photo).toBe(false);
  });
  it("page : entier >= 1, sinon 1", () => {
    for (const v of ["-2", "0", "abc", "1.5", "", "99999999999999999999"]) expect(parametresHistorique({ page: v }).page).toBe(1);
    expect(parametresHistorique({ page: "7" }).page).toBe(7);
  });
  it("ignore les paramètres parasites", () => {
    expect(parametresHistorique({ foo: "bar", utm: ["1", "2"] })).toEqual(defaut);
  });
});

describe("hrefHistorique", () => {
  it("renvoie l'URL nue quand tout est par défaut", () => {
    expect(hrefHistorique(defaut)).toBe("/dilemme/plats");
  });
  it("n'écrit que les valeurs différentes du défaut", () => {
    expect(hrefHistorique({ ...defaut, q: "croz", tri: "alpha", photo: true, page: 3, restaurant: "dubble" }))
      .toBe("/dilemme/plats?q=croz&restaurant=dubble&tri=alpha&photo=1&page=3");
  });
  it("accepte une surcharge", () => {
    expect(hrefHistorique({ ...defaut, q: "a", page: 4 }, { page: 1 })).toBe("/dilemme/plats?q=a");
  });
  it("fait l'aller-retour avec le parseur", () => {
    const p: ParametresHistorique = { q: "pâtes & œuf", restaurant: "basilic_ngo", tri: "victoires", photo: true, page: 2 };
    const url = new URL(hrefHistorique(p), "http://x");
    expect(parametresHistorique(Object.fromEntries(url.searchParams))).toEqual(p);
  });
});

describe("filtrerHistorique", () => {
  const liste = [
    plat("Croziflette", { derniere: "2026-11-05", victoires: 2, nbServices: 3, aImage: true }),
    plat("Pâtes carbonara", { derniere: "2026-11-09", victoires: 1, nbServices: 1 }),
    plat("Burger", { restaurant: "Le Truck Muche", derniere: "2026-10-01", victoires: 0, nbServices: 5, aImage: true }),
    plat("Soupe à l'oignon", { derniere: "2026-11-09", victoires: 1, nbServices: 2 }),
  ];

  it("cherche en début de mot, sans accent ni casse", () => {
    expect(filtrerHistorique(liste, { ...defaut, q: "croz" }).plats.map((p) => p.nom)).toEqual(["Croziflette"]);
    expect(filtrerHistorique(liste, { ...defaut, q: "CARBO" }).plats.map((p) => p.nom)).toEqual(["Pâtes carbonara"]);
    expect(filtrerHistorique(liste, { ...defaut, q: "pates carbo" }).total).toBe(1);
    expect(filtrerHistorique(liste, { ...defaut, q: "flette" }).total).toBe(0);
    expect(filtrerHistorique(liste, { ...defaut, q: "oignon soupe" }).total).toBe(1);
  });
  it("filtre par restaurant", () => {
    expect(filtrerHistorique(liste, { ...defaut, restaurant: "truck_muche" }).plats.map((p) => p.nom)).toEqual(["Burger"]);
  });
  it("filtre les plats avec photo", () => {
    expect(filtrerHistorique(liste, { ...defaut, photo: true }).total).toBe(2);
  });
  it("trie : recents, victoires, servis, alpha", () => {
    const noms = (tri: ParametresHistorique["tri"]) => filtrerHistorique(liste, { ...defaut, tri }).plats.map((p) => p.nom);
    expect(noms("recents")).toEqual(["Pâtes carbonara", "Soupe à l'oignon", "Croziflette", "Burger"]);
    expect(noms("victoires")).toEqual(["Croziflette", "Pâtes carbonara", "Soupe à l'oignon", "Burger"]);
    expect(noms("servis")).toEqual(["Burger", "Croziflette", "Soupe à l'oignon", "Pâtes carbonara"]);
    expect(noms("alpha")).toEqual(["Burger", "Croziflette", "Pâtes carbonara", "Soupe à l'oignon"]);
  });
  it("départage par clé pour un résultat stable", () => {
    const egaux = [plat("A", { cle: "z" }), plat("B", { cle: "a" })];
    expect(filtrerHistorique(egaux, defaut).plats.map((p) => p.cle)).toEqual(["a", "z"]);
  });
  it("pagine et borne la page", () => {
    const beaucoup = Array.from({ length: PAR_PAGE * 2 + 1 }, (_, i) => plat(`Plat ${i}`, { cle: `c${String(i).padStart(3, "0")}` }));
    const p1 = filtrerHistorique(beaucoup, defaut);
    expect(p1).toMatchObject({ total: 49, page: 1, pages: 3 });
    expect(p1.plats).toHaveLength(PAR_PAGE);
    expect(filtrerHistorique(beaucoup, { ...defaut, page: 3 }).plats).toHaveLength(1);
    expect(filtrerHistorique(beaucoup, { ...defaut, page: 99 }).page).toBe(3);
  });
  it("une liste vide donne pages = 1", () => {
    expect(filtrerHistorique([], defaut)).toEqual({ plats: [], total: 0, page: 1, pages: 1 });
    expect(filtrerHistorique(liste, { ...defaut, q: "zzz", page: 5 })).toMatchObject({ total: 0, page: 1, pages: 1 });
  });
  it("ne modifie pas la liste d'entrée", () => {
    const copie = [...liste];
    filtrerHistorique(liste, { ...defaut, tri: "alpha" });
    expect(liste).toEqual(copie);
  });
});
