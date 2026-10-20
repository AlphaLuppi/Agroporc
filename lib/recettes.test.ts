import { describe, expect, it } from "vitest";
import exemple from "./recette-exemple.json";
import { CLE_IMAGE_RE, normPlatImage } from "./plat-image";
import {
  ajusterIngredients, ajusterQuantite, BANDEAU_HONNETETE_DEBUT, BANDEAU_HONNETETE_SUITE, bornerPersonnes, dateValide,
  etatRecetteDepuisStatut, formaterDuree, formaterQuantite, grouperIngredients, jourParis, libelleDifficulte,
  MENTION_PANNEAU, parametresBanque, RESTAURANTS_RECETTES, tempsTotal, texteRecherche, UNITES, validerRecette,
  validerServices, type IngredientRecette,
  dateServie, heureParis, messageRecetteAbsente, motifsRecherche, recetteAttendue,
} from "./recettes";

const copie = (): Record<string, unknown> => JSON.parse(JSON.stringify(exemple));

function erreurs(entree: unknown): string[] {
  const r = validerRecette(entree);
  if (r.ok) throw new Error("validation inattendue");
  return r.erreurs;
}

describe("validerRecette : la fixture commune", () => {
  it("passe et ressort identique", () => {
    const r = validerRecette(copie());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.recette).toEqual(exemple);
  });
  it("UNITES : liste exacte et ordonnée du contrat", () => {
    expect(UNITES).toEqual([
      "g", "kg", "ml", "cl", "l", "c. à café", "c. à soupe", "pincée", "pièce",
      "gousse", "tranche", "feuille", "brin", "botte", "boîte", "sachet",
    ]);
  });
});

describe("validerRecette : normalisation", () => {
  it("trim, espaces multiples, entiers en chaîne ou flottants entiers, virgule française", () => {
    const e = copie();
    e.titre = "  Rôti   de dinde  ";
    e.personnes = "4";
    e.temps_preparation_min = 30.0;
    e.temps_cuisson_min = "25";
    (e.ingredients as Record<string, unknown>[])[0].quantite = "1,5";
    (e.ingredients as Record<string, unknown>[])[0].unite = "kg";
    (e.etapes as string[]).push("   ");
    const r = validerRecette(e);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recette.titre).toBe("Rôti de dinde");
    expect(r.recette.personnes).toBe(4);
    expect(r.recette.temps_cuisson_min).toBe(25);
    expect(r.recette.ingredients[0].quantite).toBe(1.5);
    expect(r.recette.etapes).toHaveLength(5);
  });
  it("quantité arrondie à 2 décimales", () => {
    const e = copie();
    (e.ingredients as Record<string, unknown>[])[0].quantite = 1.23456;
    const r = validerRecette(e);
    expect(r.ok && r.recette.ingredients[0].quantite).toBe(1.23);
  });
  it("défauts des champs optionnels et champs inconnus retirés", () => {
    const e = copie();
    delete e.description;
    delete e.astuces;
    delete e.ustensiles;
    delete e.temps_repos_min;
    e.chef = "Bocuse";
    (e.ingredients as Record<string, unknown>[])[0].marque = "X";
    const r = validerRecette(e);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recette.description).toBe("");
    expect(r.recette.astuces).toEqual([]);
    expect(r.recette.ustensiles).toEqual([]);
    expect(r.recette.temps_repos_min).toBe(0);
    expect("chef" in r.recette).toBe(false);
    expect("marque" in r.recette.ingredients[0]).toBe(false);
  });
  it("note / groupe vides : retirés", () => {
    const e = copie();
    (e.ingredients as Record<string, unknown>[])[0].note = "  ";
    const r = validerRecette(e);
    expect(r.ok && "note" in r.recette.ingredients[0]).toBe(false);
  });
});

describe("validerRecette : une erreur par contrainte, avec chemin", () => {
  const cas: [string, (e: Record<string, unknown>) => void, string][] = [
    ["titre trop court", (e) => { e.titre = "ab"; }, "titre"],
    ["titre absent", (e) => { delete e.titre; }, "titre"],
    ["description trop longue", (e) => { e.description = "x".repeat(601); }, "description"],
    ["personnes 0", (e) => { e.personnes = 0; }, "personnes : entier entre 1 et 12 attendu"],
    ["personnes 13", (e) => { e.personnes = 13; }, "personnes : entier entre 1 et 12 attendu"],
    ["personnes non entier", (e) => { e.personnes = 2.5; }, "personnes"],
    ["préparation > 600", (e) => { e.temps_preparation_min = 601; }, "temps_preparation_min"],
    ["cuisson négative", (e) => { e.temps_cuisson_min = -1; }, "temps_cuisson_min"],
    ["repos > 2880", (e) => { e.temps_repos_min = 2881; }, "temps_repos_min"],
    ["difficulté hors liste", (e) => { e.difficulte = "extrême"; }, "difficulte"],
    ["0 ingrédient", (e) => { e.ingredients = []; }, "ingredients"],
    ["41 ingrédients", (e) => { e.ingredients = Array.from({ length: 41 }, () => ({ nom: "sel", quantite: null, unite: null })); }, "ingredients : au plus 40"],
    ["ingrédient non objet", (e) => { (e.ingredients as unknown[])[1] = "beurre"; }, "ingredients[1] : objet attendu"],
    ["nom vide", (e) => { (e.ingredients as Record<string, unknown>[])[1].nom = " "; }, "ingredients[1].nom"],
    ["quantité 0", (e) => { (e.ingredients as Record<string, unknown>[])[1].quantite = 0; }, "ingredients[1].quantite"],
    ["quantité > 10000", (e) => { (e.ingredients as Record<string, unknown>[])[1].quantite = 10001; }, "ingredients[1].quantite"],
    ["unité inconnue", (e) => { (e.ingredients as Record<string, unknown>[])[3].unite = "verres"; }, "ingredients[3].unite : unité inconnue « verres »"],
    ["unité null avec quantité", (e) => { (e.ingredients as Record<string, unknown>[])[0].unite = null; }, "ingredients[0].unite"],
    ["note trop longue", (e) => { (e.ingredients as Record<string, unknown>[])[0].note = "x".repeat(121); }, "ingredients[0].note"],
    ["groupe trop long", (e) => { (e.ingredients as Record<string, unknown>[])[0].groupe = "x".repeat(61); }, "ingredients[0].groupe"],
    ["0 étape", (e) => { e.etapes = ["  "]; }, "etapes : au moins 1 étape"],
    ["31 étapes", (e) => { e.etapes = Array.from({ length: 31 }, () => "Mélanger."); }, "etapes : au plus 30"],
    ["étape trop courte", (e) => { (e.etapes as string[])[0] = "ok"; }, "etapes[0]"],
    ["11 astuces", (e) => { e.astuces = Array.from({ length: 11 }, () => "Astuce"); }, "astuces"],
    ["ustensile trop long", (e) => { e.ustensiles = ["x".repeat(81)]; }, "ustensiles[0]"],
  ];
  it.each(cas)("%s", (_nom, modifier, attendu) => {
    const e = copie();
    modifier(e);
    const errs = erreurs(e);
    expect(errs.some((m) => m.includes(attendu))).toBe(true);
  });
  it("plusieurs erreurs cumulées", () => {
    const e = copie();
    e.personnes = 0;
    e.difficulte = "dur";
    e.etapes = [];
    expect(erreurs(e).length).toBeGreaterThanOrEqual(3);
  });
  it("synonyme d'unité (« cs ») refusé côté serveur", () => {
    const e = copie();
    (e.ingredients as Record<string, unknown>[])[1].unite = "cs";
    expect(erreurs(e)).toContain("ingredients[1].unite : unité inconnue « cs »");
  });
  it.each([null, "texte", 42, []])("entrée non objet (%s) → KO", (entree) => {
    expect(erreurs(entree)).toEqual(["recette : objet attendu"]);
  });
});

describe("dateValide / validerServices", () => {
  it("dates", () => {
    expect(dateValide("2026-10-20")).toBe(true);
    expect(dateValide("2026-02-30")).toBe(false);
    expect(dateValide("20-10-2026")).toBe(false);
    expect(dateValide(20261020)).toBe(false);
  });
  const cle = "0123456789abcdef01234567";
  it("couples dédoublonnés", () => {
    expect(validerServices({ services: [{ cle, date: "2026-10-20" }, { cle, date: "2026-10-20" }] }, CLE_IMAGE_RE)).toEqual([{ cle, date: "2026-10-20" }]);
  });
  it.each([
    ["absent", {}],
    ["vide", { services: [] }],
    ["> 200", { services: Array.from({ length: 201 }, () => ({ cle, date: "2026-10-20" })) }],
    ["clé invalide", { services: [{ cle: "xyz", date: "2026-10-20" }] }],
    ["date invalide", { services: [{ cle, date: "2026-13-01" }] }],
  ])("%s → null", (_n, corps) => {
    expect(validerServices(corps, CLE_IMAGE_RE)).toBeNull();
  });
});

describe("ajusterQuantite", () => {
  it.each([
    [600, "g", 4, 2, 300],
    [15, "g", 4, 1, 4],
    [2, "g", 4, 1, 1],
    [60, "g", 4, 5, 75],
    [62, "ml", 4, 5, 80],
    [120, "g", 4, 5, 150],
    [15, "cl", 4, 1, 4],
    [1, "cl", 4, 1, 0.5],
    [0.8, "kg", 4, 3, 0.6],
    [0.1, "l", 4, 1, 0.05],
    [1, "pincée", 4, 1, 1],
    [3, "pincée", 4, 6, 5],
    [2, "pièce", 4, 1, 0.5],
    [1, "c. à café", 4, 1, 0.5],
    [2, "c. à soupe", 4, 5, 2.5],
    [1, "gousse", 4, 6, 1.5],
    [1, null, 3, 1, 0.33],
  ])("%s %s × %s→%s = %s", (q, unite, base, cible, attendu) => {
    expect(ajusterQuantite(q, unite, base, cible)).toBe(attendu);
  });
  it("cible === base : inchangé, sans arrondi", () => {
    expect(ajusterQuantite(13.37, "g", 4, 4)).toBe(13.37);
  });
  it("null → null", () => {
    expect(ajusterQuantite(null, null, 4, 2)).toBeNull();
  });
});

describe("formaterQuantite", () => {
  it.each([
    [null, null, "selon goût"],
    [null, "pincée", "selon goût"],
    [200, "g", "200 g"],
    [1.5, "c. à soupe", "1 ½ c. à soupe"],
    [2, "gousse", "2 gousses"],
    [1, "gousse", "1 gousse"],
    [0.5, "pièce", "½"],
    [2, "pièce", "2"],
    [1.5, "kg", "1,5 kg"],
    [0.25, "l", "0,25 l"],
    [1.5, "pincée", "1 ½ pincées"],
    [3, "sachet", "3 sachets"],
    [3, "c. à café", "3 c. à café"],
    [15, "cl", "15 cl"],
    [2.5, "cl", "2,5 cl"],
    [0.33, null, "0,33"],
  ])("%s %s → %s", (q, unite, attendu) => {
    expect(formaterQuantite(q, unite)).toBe(attendu);
  });
});

describe("ajusterIngredients / grouperIngredients", () => {
  const ings = (exemple as { ingredients: IngredientRecette[] }).ingredients;
  it("ajuste et formate chaque ingrédient", () => {
    const deux = ajusterIngredients(ings, 4, 2);
    expect(deux[0]).toMatchObject({ nom: "rôti de dinde", quantite: 400, libelleQuantite: "400 g" });
    expect(deux[6]).toMatchObject({ nom: "ail", quantite: 0.5, libelleQuantite: "½ gousse" });
    expect(deux[8].libelleQuantite).toBe("selon goût");
  });
  it("groupes dans l'ordre d'apparition, null pour les non groupés", () => {
    const g = grouperIngredients(ings);
    expect(g.map((x) => x.groupe)).toEqual(["Pour le rôti", "Pour la gribiche", "Pour les légumes", null]);
    expect(g[1].ingredients.map((i) => i.nom)).toEqual(["œufs", "cornichons", "moutarde de Dijon", "huile de colza"]);
  });
  it("un groupe non contigu est rassemblé à sa première apparition", () => {
    const g = grouperIngredients<IngredientRecette>([
      { nom: "a", quantite: 1, unite: "g", groupe: "A" },
      { nom: "b", quantite: 1, unite: "g" },
      { nom: "c", quantite: 1, unite: "g", groupe: "A" },
    ]);
    expect(g).toEqual([
      { groupe: "A", ingredients: [expect.objectContaining({ nom: "a" }), expect.objectContaining({ nom: "c" })] },
      { groupe: null, ingredients: [expect.objectContaining({ nom: "b" })] },
    ]);
  });
});

describe("petits utilitaires", () => {
  it("bornerPersonnes", () => {
    expect(bornerPersonnes(0)).toBe(1);
    expect(bornerPersonnes(13)).toBe(12);
    expect(bornerPersonnes(NaN)).toBe(1);
    expect(bornerPersonnes(2.6)).toBe(3);
  });
  it("tempsTotal", () => {
    expect(tempsTotal({ temps_preparation_min: 30, temps_cuisson_min: 60, temps_repos_min: 120 })).toBe(210);
  });
  it.each([[0, "0 min"], [45, "45 min"], [60, "1 h"], [75, "1 h 15"], [65, "1 h 05"], [1500, "25 h"]])("formaterDuree(%s)", (m, attendu) => {
    expect(formaterDuree(m)).toBe(attendu);
  });
  it("libelleDifficulte", () => {
    expect(libelleDifficulte("facile")).toBe("Facile");
    expect(libelleDifficulte("moyenne")).toBe("Moyenne");
    expect(libelleDifficulte("difficile")).toBe("Difficile");
  });
  it("jourParis : date de Paris d'un horodatage UTC", () => {
    expect(jourParis("2026-10-19T23:30:00.000Z")).toBe("2026-10-20");
    expect(jourParis("pas une date")).toBe("");
  });
  it("etatRecetteDepuisStatut", () => {
    expect(etatRecetteDepuisStatut(200)).toBe("ok");
    expect(etatRecetteDepuisStatut(404)).toBe("absente");
    expect(etatRecetteDepuisStatut(500)).toBe("erreur");
    expect(etatRecetteDepuisStatut(0)).toBe("erreur");
  });
});

describe("texteRecherche", () => {
  it("sans accents ni ligatures, concordant avec normPlatImage", () => {
    const t = texteRecherche("Le Bistrot Trèfle", "RÔTI DE DINDE", { titre: "Rôti, gribiche", ingredients: [{ nom: "Œufs", quantite: 2, unite: "pièce" }] });
    expect(t).toBe("le bistrot trefle roti de dinde roti gribiche oeufs");
    expect(t).toBe(normPlatImage(t));
    expect(t.includes(normPlatImage("œufs"))).toBe(true);
  });
});

describe("parametresBanque", () => {
  it("défauts", () => {
    expect(parametresBanque(new URLSearchParams())).toEqual({ ok: true, q: "", qNorm: "", slug: null, restaurant: null, page: 1 });
  });
  it("q normalisé, slug converti en nom, page", () => {
    expect(parametresBanque(new URLSearchParams("q=  Bœuf &restaurant=bistrot_trefle&page=3"))).toEqual({
      ok: true, q: "Bœuf", qNorm: "boeuf", slug: "bistrot_trefle", restaurant: "Le Bistrot Trèfle", page: 3,
    });
  });
  it.each(["0", "abc", "-1", "1.5"])("page=%s → erreur", (page) => {
    expect(parametresBanque({ page })).toEqual({ ok: false, erreur: "Paramètre 'page' invalide" });
  });
  it.each(["inconnu", "vival"])("restaurant=%s → Restaurant inconnu", (restaurant) => {
    expect(parametresBanque({ restaurant })).toEqual({ ok: false, erreur: "Restaurant inconnu" });
  });
  it("q tronqué à 100 caractères", () => {
    const r = parametresBanque({ q: "a".repeat(150) });
    expect(r.ok && r.q.length).toBe(100);
  });
  it("tableau de valeurs → la première", () => {
    expect(parametresBanque({ q: ["tarte", "pizza"], page: ["2", "5"] })).toMatchObject({ ok: true, q: "tarte", page: 2 });
  });
  it("restaurants filtrables : sans les liens seuls", () => {
    expect(RESTAURANTS_RECETTES.map((r) => r.slug)).not.toContain("vival");
  });
});

describe("libellés d'honnêteté", () => {
  const textes = [BANDEAU_HONNETETE_DEBUT + BANDEAU_HONNETETE_SUITE, MENTION_PANNEAU];
  it("disent « recette maison inspirée du plat »", () => {
    for (const t of textes) expect(t.startsWith("Recette maison inspirée du plat")).toBe(true);
  });
  it("aucune formulation interdite (hors négation imposée)", () => {
    for (const t of textes) {
      const l = t.toLowerCase().replace("ce n'est pas la recette du restaurant", "");
      for (const interdit of ["recette du chef", "recette du restaurant", "recette originale", "secret du chef"]) {
        expect(l.includes(interdit)).toBe(false);
      }
    }
  });
});

describe("motifsRecherche", () => {
  it("un motif par mot normalisé, dédoublonné, ordre libre", () => {
    expect(motifsRecherche("Curry  POULET curry")).toEqual(["%curry%", "%poulet%"]);
    expect(motifsRecherche("  ")).toEqual([]);
    expect(motifsRecherche("tajine, courgette…")).toEqual(["%tajine%", "%courgette%"]);
  });
  it("chaque mot est cherché séparément (« curry poulet » trouve « poulet au curry »)", () => {
    const indexe = texteRecherche("Le Bistrot Trèfle", "Poulet au curry", { titre: "Poulet au curry", ingredients: [] });
    const correspond = (q: string) =>
      motifsRecherche(q).every((m) => indexe.includes(m.slice(1, -1)));
    expect(correspond("curry poulet")).toBe(true);
    expect(correspond("poulet trefle")).toBe(true);
    expect(correspond("poulet tajine")).toBe(false);
  });
  it("au plus 8 mots, sans caractère à échapper", () => {
    const m = motifsRecherche("a b c d e f g h i j 100% _x_");
    expect(m).toHaveLength(8);
    expect(m.every((x) => /^%[a-z0-9]+%$/.test(x))).toBe(true);
  });
});

describe("messageRecetteAbsente / recetteAttendue / dateServie", () => {
  it("texte selon la date du plat", () => {
    expect(messageRecetteAbsente("2026-10-22", "2026-10-20", 9)).toBe("La recette sera rédigée le jour où le plat est servi.");
    expect(messageRecetteAbsente("2026-10-20", "2026-10-20", 9)).toBe(
      "Pas encore de recette pour ce plat : elles sont rédigées en fin de matinée.",
    );
    expect(messageRecetteAbsente("2026-10-20", "2026-10-20", 14)).toBe("Pas de recette pour ce plat.");
    expect(messageRecetteAbsente("2026-10-13", "2026-10-20", 9)).toBe("Pas de recette pour ce plat.");
  });
  it("heureParis suit le fuseau de Paris", () => {
    expect(heureParis(new Date("2026-10-20T08:30:00Z"))).toBe(10); // UTC+2 en octobre
    expect(heureParis(new Date("2026-12-01T23:30:00Z"))).toBe(0); // UTC+1, minuit
  });
  it("pas de recette attendue pour un nom vide une fois normalisé (comme a_cuisiner)", () => {
    expect(recetteAttendue("Le Truck Muche", "—")).toBe(false);
    expect(recetteAttendue("Le Truck Muche", "?")).toBe(false);
    expect(recetteAttendue("Le Truck Muche", "🍔🍟")).toBe(false);
    expect(recetteAttendue("Le Truck Muche", "Burger")).toBe(true);
  });
  it("une date de service n'est enregistrée qu'une fois le plat servi", () => {
    expect(dateServie("2026-10-20", "2026-10-20")).toBe(true);
    expect(dateServie("2026-10-19", "2026-10-20")).toBe(true);
    expect(dateServie("2026-10-23", "2026-10-20")).toBe(false);
  });
});
