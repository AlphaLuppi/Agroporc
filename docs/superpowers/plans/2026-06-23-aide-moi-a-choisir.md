# Onglet « Aide-moi à choisir » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un onglet « Aide-moi à choisir » : un arbre de décision déterministe (questions à choix multiples) qui filtre les plats du jour + cartes + une base de desserts jusqu'à un résultat idéal (plat seul ou plat + dessert).

**Architecture:** Fonctions pures testées (`lib/quiz-tags.ts`, `lib/quiz-plats.ts`, `lib/desserts.ts`) pour la dérivation de tags et la sélection. Une page SSR (`app/aide-moi-a-choisir/page.tsx`) charge le pool (plats du jour + cartes) et passe des données normalisées à un composant client (`app/aide-moi-a-choisir/QuizClient.tsx`) qui déroule l'arbre. Aucune IA à l'exécution.

**Tech Stack:** Next.js 15 (App Router, SSR), React 19, TypeScript, Tailwind v4, Vitest (nouveau, pour les fonctions pures).

---

## File Structure

- `vitest.config.ts` — **Create** : config Vitest (env node, globals).
- `package.json` — **Modify** : ajout `vitest` en devDep + script `test`.
- `lib/quiz-tags.ts` — **Create** : dérivation `famille` / `proteine` d'un plat (pur).
- `lib/quiz-tags.test.ts` — **Create** : tests.
- `lib/desserts.ts` — **Create** : type `DessertConnu`, base `DESSERTS_CONNUS`, classifieur de nom, sélection (pur).
- `lib/desserts.test.ts` — **Create** : tests.
- `lib/quiz-plats.ts` — **Create** : type `PoolPlat`, `choisirPlat` (filtre + tri, pur).
- `lib/quiz-plats.test.ts` — **Create** : tests.
- `app/aide-moi-a-choisir/page.tsx` — **Create** : SSR, construit le pool + desserts, rend `QuizClient`.
- `app/aide-moi-a-choisir/QuizClient.tsx` — **Create** : composant client, arbre + écran résultat.
- `app/layout.tsx` — **Modify** : liens de nav (desktop + mobile).

---

## Task 1: Mise en place de Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Installer Vitest**

Run:
```bash
npm install -D vitest
```
Expected: `vitest` ajouté à `devDependencies`, pas d'erreur.

- [ ] **Step 2: Créer la config Vitest**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Ajouter le script `test`**

Modify `package.json` — dans `"scripts"`, ajouter la ligne `test` (après `db:migrate`):
```json
    "db:migrate": "node lib/migrate.mjs",
    "test": "vitest run"
```

- [ ] **Step 4: Vérifier que Vitest tourne (aucun test pour l'instant)**

Run:
```bash
npm test
```
Expected: Vitest démarre, message « No test files found » (ou 0 test) — pas d'erreur de config.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore(test): mise en place de vitest"
```

---

## Task 2: Dérivation des tags de plats (`lib/quiz-tags.ts`)

**Files:**
- Create: `lib/quiz-tags.ts`
- Test: `lib/quiz-tags.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Create `lib/quiz-tags.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tagsForPlat } from "./quiz-tags";

describe("tagsForPlat", () => {
  it("détecte le poisson depuis le nom", () => {
    expect(tagsForPlat({ plat: "Filet de saumon, riz basmati" })).toEqual({
      famille: "poisson",
      proteine: "poisson",
    });
  });

  it("détecte le poulet depuis le nom", () => {
    expect(tagsForPlat({ plat: "Poulet rôti et frites" })).toEqual({
      famille: "viande",
      proteine: "poulet",
    });
  });

  it("détecte le bœuf depuis le nom", () => {
    expect(tagsForPlat({ plat: "Bœuf bourguignon" })).toEqual({
      famille: "viande",
      proteine: "boeuf",
    });
  });

  it("classe un plat sans viande ni poisson en végé", () => {
    expect(tagsForPlat({ plat: "Curry de légumes et lentilles" })).toEqual({
      famille: "vege",
      proteine: "autre",
    });
  });

  it("priorise les ingrédients Ciqual sur le nom du plat", () => {
    expect(
      tagsForPlat({
        plat: "Plat du jour",
        ingredients_detail: [
          { matched_nom: "Poulet, blanc, grillé" } as never,
          { matched_nom: "Riz blanc, cuit" } as never,
        ],
      })
    ).toEqual({ famille: "viande", proteine: "poulet" });
  });

  it("détecte une viande générique sans protéine précise", () => {
    expect(tagsForPlat({ plat: "Steak haché, sauce poivre" })).toEqual({
      famille: "viande",
      proteine: "boeuf",
    });
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run lib/quiz-tags.test.ts`
Expected: FAIL — `tagsForPlat` n'existe pas.

- [ ] **Step 3: Implémenter `lib/quiz-tags.ts`**

Create `lib/quiz-tags.ts`:
```ts
export type Famille = "viande" | "poisson" | "vege";
export type Proteine =
  | "poulet"
  | "boeuf"
  | "porc"
  | "veau"
  | "agneau"
  | "poisson"
  | "autre";

export interface PlatTags {
  famille: Famille;
  proteine: Proteine;
}

/** Entrée minimale acceptée : un `Plat` ou un `CartePlat`. */
export interface PlatTagInput {
  plat: string;
  ingredients_detail?: { matched_nom: string | null }[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Ordre = priorité de détection. Le poisson est testé en premier.
const PROTEINE_KEYWORDS: { proteine: Exclude<Proteine, "autre">; mots: string[] }[] = [
  {
    proteine: "poisson",
    mots: ["saumon", "cabillaud", "thon", "colin", "lieu", "dorade", "truite", "merlu", "poisson", "crevette", "accra de poisson", "fruits de mer", "calamar", "moule"],
  },
  { proteine: "poulet", mots: ["poulet", "volaille", "dinde"] },
  { proteine: "boeuf", mots: ["boeuf", "steak", "bavette", "bourguignon", "haché"] },
  { proteine: "porc", mots: ["porc", "jambon", "lardon", "saucisse", "chipolata", "andouillette"] },
  { proteine: "veau", mots: ["veau"] },
  { proteine: "agneau", mots: ["agneau", "gigot"] },
];

// Termes de viande génériques (pas de protéine précise mais clairement carné).
const VIANDE_GENERIQUE = ["viande", "boulette", "kebab", "merguez", "magret", "confit"];

export function tagsForPlat(input: PlatTagInput): PlatTags {
  const fromIngredients = (input.ingredients_detail ?? [])
    .map((i) => i.matched_nom ?? "")
    .join(" ");
  const text = normalize(`${fromIngredients} ${input.plat}`);

  let proteine: Proteine = "autre";
  for (const { proteine: p, mots } of PROTEINE_KEYWORDS) {
    if (mots.some((m) => text.includes(normalize(m)))) {
      proteine = p;
      break;
    }
  }

  let famille: Famille;
  if (proteine === "poisson") {
    famille = "poisson";
  } else if (proteine !== "autre") {
    famille = "viande";
  } else if (VIANDE_GENERIQUE.some((m) => text.includes(normalize(m)))) {
    famille = "viande";
  } else {
    famille = "vege";
  }

  return { famille, proteine };
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run lib/quiz-tags.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/quiz-tags.ts lib/quiz-tags.test.ts
git commit -m "feat(quiz): dérivation des tags famille/protéine d'un plat"
```

---

## Task 3: Base de desserts + sélection (`lib/desserts.ts`)

**Files:**
- Create: `lib/desserts.ts`
- Test: `lib/desserts.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Create `lib/desserts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classerDessertNom, choisirDessert, type DessertConnu } from "./desserts";

const D = (over: Partial<DessertConnu>): DessertConnu => ({
  nom: "X",
  restaurant: "Le Truck Muche",
  type_saveur: "creme_lacte",
  leger_gourmand: "gourmand",
  proba: 50,
  ...over,
});

describe("classerDessertNom", () => {
  it("classe une salade de fruits en fruité/léger", () => {
    expect(classerDessertNom("Salade de fruits")).toEqual({
      type_saveur: "fruite",
      leger_gourmand: "leger",
    });
  });

  it("classe un mi-cuit chocolat en chocolaté/gourmand", () => {
    expect(classerDessertNom("Mi-cuit au chocolat")).toEqual({
      type_saveur: "chocolate",
      leger_gourmand: "gourmand",
    });
  });

  it("classe une tarte en pâtissier/gourmand", () => {
    expect(classerDessertNom("Tarte abricots amandine")).toEqual({
      type_saveur: "patissier",
      leger_gourmand: "gourmand",
    });
  });
});

describe("choisirDessert", () => {
  it("filtre par saveur et trie par proba décroissante", () => {
    const pool = [
      D({ nom: "A", type_saveur: "fruite", proba: 30 }),
      D({ nom: "B", type_saveur: "fruite", proba: 85 }),
      D({ nom: "C", type_saveur: "chocolate", proba: 99 }),
    ];
    expect(choisirDessert(pool, { saveur: "fruite" })?.nom).toBe("B");
  });

  it("départage par note à proba égale", () => {
    const pool = [
      D({ nom: "A", proba: 80, note: 6 }),
      D({ nom: "B", proba: 80, note: 9 }),
    ];
    expect(choisirDessert(pool, {})?.nom).toBe("B");
  });

  it("ne filtre pas un axe non précisé (peu importe)", () => {
    const pool = [D({ nom: "A", proba: 70 })];
    expect(choisirDessert(pool, {})?.nom).toBe("A");
  });

  it("retourne null si aucun dessert ne matche", () => {
    const pool = [D({ nom: "A", type_saveur: "fruite" })];
    expect(choisirDessert(pool, { saveur: "chocolate" })).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run lib/desserts.test.ts`
Expected: FAIL — module/fonctions inexistants.

- [ ] **Step 3: Implémenter `lib/desserts.ts`**

Create `lib/desserts.ts`:
```ts
export type SaveurDessert = "fruite" | "chocolate" | "creme_lacte" | "patissier";
export type Lourdeur = "leger" | "gourmand";

export interface DessertConnu {
  nom: string;
  restaurant: string;
  type_saveur: SaveurDessert;
  leger_gourmand: Lourdeur;
  /** 0-100 : chance d'être disponible aujourd'hui. */
  proba: number;
  note?: number;
}

export interface DessertCriteres {
  saveur?: SaveurDessert;
  lourdeur?: Lourdeur;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Déduit saveur + lourdeur d'un nom de dessert (utilisé pour les desserts de carte). */
export function classerDessertNom(nom: string): {
  type_saveur: SaveurDessert;
  leger_gourmand: Lourdeur;
} {
  const t = normalize(nom);
  const has = (...mots: string[]) => mots.some((m) => t.includes(normalize(m)));

  if (has("chocolat", "nutella", "brownie", "fondant", "mi-cuit", "mi cuit")) {
    return { type_saveur: "chocolate", leger_gourmand: "gourmand" };
  }
  if (has("salade de fruits", "fraises", "abricot", "peche", "pomme", "fruits rouges", "ananas", "fruit")) {
    const leger = has("salade de fruits", "fruits rouges") ? "leger" : "gourmand";
    // Une tarte/crumble de fruits reste pâtissier.
    if (has("tarte", "crumble", "clafoutis", "amandine")) {
      return { type_saveur: "patissier", leger_gourmand: "gourmand" };
    }
    return { type_saveur: "fruite", leger_gourmand: leger };
  }
  if (has("tarte", "crumble", "clafoutis", "brioche", "amandine", "banoffee", "perdue")) {
    return { type_saveur: "patissier", leger_gourmand: "gourmand" };
  }
  if (has("fromage blanc", "yaourt", "muesli")) {
    return { type_saveur: "creme_lacte", leger_gourmand: "leger" };
  }
  // tiramisu, mousse, crème, flan, panna cotta…
  return { type_saveur: "creme_lacte", leger_gourmand: "gourmand" };
}

/** Base curée des desserts connus (Truck Muche — non scrapables). À éditer librement. */
export const DESSERTS_CONNUS: DessertConnu[] = [
  // — Truck Muche : quasi-permanents (souvent là) —
  { nom: "Fromage blanc muesli coulis framboise", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "leger", proba: 85 },
  { nom: "Salade de fruits", restaurant: "Le Truck Muche", type_saveur: "fruite", leger_gourmand: "leger", proba: 85 },
  { nom: "Mi-cuit chocolat", restaurant: "Le Truck Muche", type_saveur: "chocolate", leger_gourmand: "gourmand", proba: 85 },
  { nom: "Mousse spéculoos", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 85 },
  { nom: "Tiramisu Oreo", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 85 },
  { nom: "Banoffee", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 85 },
  // — Truck Muche : tournants (vus récemment) —
  { nom: "Flan aux œufs", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Fraises chantilly", restaurant: "Le Truck Muche", type_saveur: "fruite", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Tarte abricots amandine", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Clafoutis pêches", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Crème brûlée chocolat", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Crumble pommes spéculoos", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Tiramisu framboise spéculoos", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Brioche perdue Nutella", restaurant: "Le Truck Muche", type_saveur: "chocolate", leger_gourmand: "gourmand", proba: 30 },
];

/** Filtre par critères (axes non précisés = pas de filtre), trie par proba puis note, retourne le meilleur. */
export function choisirDessert(
  desserts: DessertConnu[],
  criteres: DessertCriteres
): DessertConnu | null {
  const matches = desserts.filter(
    (d) =>
      (!criteres.saveur || d.type_saveur === criteres.saveur) &&
      (!criteres.lourdeur || d.leger_gourmand === criteres.lourdeur)
  );
  if (matches.length === 0) return null;
  return [...matches].sort(
    (a, b) => b.proba - a.proba || (b.note ?? 0) - (a.note ?? 0)
  )[0];
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run lib/desserts.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/desserts.ts lib/desserts.test.ts
git commit -m "feat(quiz): base de desserts connus + sélection"
```

---

## Task 4: Sélection de plats (`lib/quiz-plats.ts`)

**Files:**
- Create: `lib/quiz-plats.ts`
- Test: `lib/quiz-plats.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Create `lib/quiz-plats.test.ts`:
```ts
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
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run lib/quiz-plats.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 3: Implémenter `lib/quiz-plats.ts`**

Create `lib/quiz-plats.ts`:
```ts
import { tagsForPlat, type Famille, type Proteine } from "./quiz-tags";
import type { IngredientDetail } from "./db";

export type Mode = "sportif" | "goulaf";

/** Plat normalisé du pool (issu d'un plat du jour ou d'un plat de carte). */
export interface PoolPlat {
  plat: string;
  restaurant: string;
  prix: string;
  note?: number;
  justification?: string;
  note_goulaf?: number;
  justification_goulaf?: string;
  ingredients_detail?: IngredientDetail[];
}

export interface PlatCriteres {
  famille?: Famille;
  proteine?: Proteine;
}

export interface PlatResultat {
  resultat: PoolPlat | null;
  /** true = match exact des critères ; false = repli sur le plus proche. */
  exact: boolean;
}

function noteFor(p: PoolPlat, mode: Mode): number {
  const n = mode === "sportif" ? p.note : p.note_goulaf;
  return typeof n === "number" ? n : -1;
}

function meilleur(pool: PoolPlat[], mode: Mode): PoolPlat | null {
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => noteFor(b, mode) - noteFor(a, mode))[0];
}

/**
 * Filtre le pool par famille puis protéine, trie par note du mode, retourne le meilleur.
 * Repli : relâche la protéine, puis la famille (exact=false) si rien ne matche.
 */
export function choisirPlat(
  pool: PoolPlat[],
  criteres: PlatCriteres,
  mode: Mode
): PlatResultat {
  if (pool.length === 0) return { resultat: null, exact: false };

  const tagged = pool.map((p) => ({ p, tags: tagsForPlat(p) }));

  const matchFamille = (t: typeof tagged[number]) =>
    !criteres.famille || t.tags.famille === criteres.famille;
  const matchProteine = (t: typeof tagged[number]) =>
    !criteres.proteine || t.tags.proteine === criteres.proteine;

  const exact = tagged.filter((t) => matchFamille(t) && matchProteine(t));
  if (exact.length > 0) {
    return { resultat: meilleur(exact.map((t) => t.p), mode), exact: true };
  }

  const familleOnly = tagged.filter(matchFamille);
  if (familleOnly.length > 0) {
    return { resultat: meilleur(familleOnly.map((t) => t.p), mode), exact: false };
  }

  return { resultat: meilleur(pool, mode), exact: false };
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run lib/quiz-plats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/quiz-plats.ts lib/quiz-plats.test.ts
git commit -m "feat(quiz): sélection de plats (filtre famille/protéine + tri par mode)"
```

---

## Task 5: Page SSR (`app/aide-moi-a-choisir/page.tsx`)

**Files:**
- Create: `app/aide-moi-a-choisir/page.tsx`

Construit le pool (plats du jour + plats des 3 cartes) et la liste de desserts (base statique + desserts de carte), puis passe le tout au composant client (créé en Task 6).

- [ ] **Step 1: Créer la page**

Create `app/aide-moi-a-choisir/page.tsx`:
```tsx
import { ensureTable, getPdjByDate, getCarte } from "@/lib/db";
import type { Carte } from "@/lib/db";
import type { PoolPlat } from "@/lib/quiz-plats";
import { DESSERTS_CONNUS, classerDessertNom, type DessertConnu } from "@/lib/desserts";
import QuizClient from "./QuizClient";

export const dynamic = "force-dynamic";

const SLUGS: { slug: string; nom: string }[] = [
  { slug: "bistrot_trefle", nom: "Le Bistrot Trèfle" },
  { slug: "pause_gourmande", nom: "La Pause Gourmande" },
  { slug: "truck_muche", nom: "Le Truck Muche" },
];

function platsFromCarte(carte: Carte | null, fallbackNom: string): PoolPlat[] {
  if (!carte) return [];
  const restaurant = carte.restaurant ?? fallbackNom;
  const out: PoolPlat[] = [];
  for (const section of carte.sections) {
    if (/dessert/i.test(section.nom)) continue; // les desserts sont gérés à part
    for (const cp of section.plats) {
      out.push({
        plat: cp.plat,
        restaurant,
        prix: cp.prix,
        note: cp.note,
        justification: cp.justification,
        note_goulaf: cp.note_goulaf,
        justification_goulaf: cp.justification_goulaf,
        ingredients_detail: cp.ingredients_detail,
      });
    }
  }
  return out;
}

function dessertsFromCarte(carte: Carte | null, fallbackNom: string): DessertConnu[] {
  if (!carte) return [];
  const restaurant = carte.restaurant ?? fallbackNom;
  const out: DessertConnu[] = [];
  for (const section of carte.sections) {
    if (!/dessert/i.test(section.nom)) continue;
    for (const cp of section.plats) {
      const { type_saveur, leger_gourmand } = classerDessertNom(cp.plat);
      out.push({
        nom: cp.plat,
        restaurant,
        type_saveur,
        leger_gourmand,
        proba: 100, // carte fiable
        note: cp.note,
      });
    }
  }
  return out;
}

export default async function AideMoiAChoisir() {
  await ensureTable();
  const today = new Date().toLocaleDateString("en-CA");
  const todayPdj = await getPdjByDate(today);
  const cartes = await Promise.all(SLUGS.map((s) => getCarte(s.slug)));

  // Pool = plats du jour + plats de toutes les cartes
  const platsJour: PoolPlat[] = (todayPdj?.plats ?? [])
    .filter((p) => !p.coming_soon)
    .map((p) => ({
      plat: p.plat,
      restaurant: p.restaurant,
      prix: p.prix,
      note: p.note,
      justification: p.justification,
      note_goulaf: p.note_goulaf,
      justification_goulaf: p.justification_goulaf,
      ingredients_detail: p.ingredients_detail,
    }));

  const platsCartes = cartes.flatMap((c, i) => platsFromCarte(c, SLUGS[i].nom));
  const pool: PoolPlat[] = [...platsJour, ...platsCartes];

  const desserts: DessertConnu[] = [
    ...DESSERTS_CONNUS,
    ...cartes.flatMap((c, i) => dessertsFromCarte(c, SLUGS[i].nom)),
  ];

  return <QuizClient pool={pool} desserts={desserts} hasJour={platsJour.length > 0} />;
}
```

- [ ] **Step 2: Vérifier que TypeScript ne casse pas (compilation partielle)**

Note : `QuizClient` n'existe pas encore → erreur d'import attendue. On ne build pas ici ; le build complet est en Task 8. Passer à la Task 6.

- [ ] **Step 3: Commit (après Task 6 pour avoir un build vert)** — voir Task 6.

---

## Task 6: Composant client — l'arbre (`app/aide-moi-a-choisir/QuizClient.tsx`)

**Files:**
- Create: `app/aide-moi-a-choisir/QuizClient.tsx`

Machine à états simple : une suite d'étapes, chaque réponse stockée, calcul du résultat à la fin. Style aligné sur les variables CSS existantes (`var(--surface)`, `var(--accent)`, etc.).

- [ ] **Step 1: Créer le composant**

Create `app/aide-moi-a-choisir/QuizClient.tsx`:
```tsx
"use client";

import { useState } from "react";
import { choisirPlat, type PoolPlat, type Mode } from "@/lib/quiz-plats";
import { choisirDessert, type DessertConnu, type SaveurDessert, type Lourdeur } from "@/lib/desserts";
import type { Famille, Proteine } from "@/lib/quiz-tags";

type Answers = {
  mode?: Mode;
  menu?: "plat" | "menu";
  famille?: Famille;
  proteine?: Proteine;
  saveur?: SaveurDessert;
  lourdeur?: Lourdeur;
};

interface Choice<T> {
  label: string;
  value: T;
}

const card =
  "w-full text-left px-4 py-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-accent)] hover:bg-[var(--surface-hover)] transition-colors text-[var(--text)] font-medium cursor-pointer";

function QuestionStep<T extends string>({
  titre,
  choices,
  onPick,
}: {
  titre: string;
  choices: Choice<T>[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
        {titre}
      </h2>
      <div className="flex flex-col gap-2">
        {choices.map((c) => (
          <button key={c.value} className={card} onClick={() => onPick(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function QuizClient({
  pool,
  desserts,
  hasJour,
}: {
  pool: PoolPlat[];
  desserts: DessertConnu[];
  hasJour: boolean;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);

  const reset = () => {
    setAnswers({});
    setDone(false);
  };

  // Détermine l'étape courante à partir des réponses.
  function render() {
    if (done) return <Resultat answers={answers} pool={pool} desserts={desserts} onReset={reset} />;

    if (!answers.mode) {
      return (
        <QuestionStep<Mode>
          titre="Tu manges plutôt malin ou plaisir aujourd'hui ?"
          choices={[
            { label: "🥗 Sportif (équilibré)", value: "sportif" },
            { label: "😋 Goulaf (plaisir)", value: "goulaf" },
          ]}
          onPick={(mode) => setAnswers((a) => ({ ...a, mode }))}
        />
      );
    }

    if (!answers.menu) {
      return (
        <QuestionStep<"plat" | "menu">
          titre="Tu veux juste un plat, ou un plat + un dessert ?"
          choices={[
            { label: "🍽️ Un plat seul", value: "plat" },
            { label: "🍰 Un plat + un dessert", value: "menu" },
          ]}
          onPick={(menu) => setAnswers((a) => ({ ...a, menu }))}
        />
      );
    }

    if (!answers.famille) {
      return (
        <QuestionStep<Famille | "peu_importe">
          titre="Plutôt viande, poisson, ou sans viande ?"
          choices={[
            { label: "🥩 De la viande", value: "viande" },
            { label: "🐟 Du poisson", value: "poisson" },
            { label: "🥦 Sans viande ni poisson", value: "vege" },
            { label: "🤷 Peu importe", value: "peu_importe" },
          ]}
          onPick={(v) =>
            setAnswers((a) => ({
              ...a,
              famille: v === "peu_importe" ? undefined : v,
              // marqueur pour ne pas re-poser la question
              ...(v === "peu_importe" ? { _familleAsked: true } : {}),
            } as Answers))
          }
        />
      );
    }

    // Question protéine uniquement si "viande"
    if (answers.famille === "viande" && !answers.proteine) {
      return (
        <QuestionStep<Proteine | "peu_importe">
          titre="Quelle viande te fait envie ?"
          choices={[
            { label: "🍗 Poulet", value: "poulet" },
            { label: "🐄 Bœuf", value: "boeuf" },
            { label: "🐖 Porc", value: "porc" },
            { label: "🐑 Veau / agneau", value: "veau" },
            { label: "🤷 Peu importe", value: "peu_importe" },
          ]}
          onPick={(v) =>
            setAnswers((a) => ({
              ...a,
              proteine: v === "peu_importe" ? undefined : v,
              _proteineAsked: true,
            } as Answers))
          }
        />
      );
    }

    // Branche dessert
    if (answers.menu === "menu" && !answers.saveur && !( "_saveurAsked" in answers)) {
      return (
        <QuestionStep<SaveurDessert | "peu_importe">
          titre="Côté dessert, tu pars sur quoi ?"
          choices={[
            { label: "🍓 Fruité", value: "fruite" },
            { label: "🍫 Chocolaté", value: "chocolate" },
            { label: "🥛 Crémeux / lacté", value: "creme_lacte" },
            { label: "🥧 Pâtissier", value: "patissier" },
            { label: "🤷 Peu importe", value: "peu_importe" },
          ]}
          onPick={(v) =>
            setAnswers((a) => ({
              ...a,
              saveur: v === "peu_importe" ? undefined : v,
              _saveurAsked: true,
            } as Answers))
          }
        />
      );
    }

    if (answers.menu === "menu" && !answers.lourdeur && !("_lourdeurAsked" in answers)) {
      return (
        <QuestionStep<Lourdeur | "peu_importe">
          titre="Léger ou bien gourmand ?"
          choices={[
            { label: "🍃 Léger", value: "leger" },
            { label: "🤤 Gourmand", value: "gourmand" },
            { label: "🤷 Peu importe", value: "peu_importe" },
          ]}
          onPick={(v) =>
            setAnswers((a) => ({
              ...a,
              lourdeur: v === "peu_importe" ? undefined : v,
              _lourdeurAsked: true,
            } as Answers))
          }
        />
      );
    }

    // Plus de questions → résultat
    setDone(true);
    return null;
  }

  return (
    <div className="max-w-[520px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--accent)]" style={{ fontFamily: "var(--font-heading)" }}>
          Aide-moi à choisir
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Quelques questions, et on te trouve le plat idéal du jour.
        </p>
        {!hasJour && (
          <p className="text-xs text-[var(--text-muted)] mt-2">
            (Pas encore de plats du jour publiés — on cherche dans les cartes.)
          </p>
        )}
      </header>
      {render()}
    </div>
  );
}

function Resultat({
  answers,
  pool,
  desserts,
  onReset,
}: {
  answers: Answers;
  pool: PoolPlat[];
  desserts: DessertConnu[];
  onReset: () => void;
}) {
  const mode: Mode = answers.mode ?? "sportif";
  const { resultat: plat, exact } = choisirPlat(
    pool,
    { famille: answers.famille, proteine: answers.proteine },
    mode
  );
  const dessert =
    answers.menu === "menu"
      ? choisirDessert(desserts, { saveur: answers.saveur, lourdeur: answers.lourdeur })
      : null;

  const noteAffichee = (p: PoolPlat) => (mode === "sportif" ? p.note : p.note_goulaf);
  const justifAffichee = (p: PoolPlat) =>
    mode === "sportif" ? p.justification : p.justification_goulaf;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-heading)" }}>
        {exact ? "Ton plat idéal aujourd'hui" : "Pas de match exact — au plus proche"}
      </h2>

      {plat ? (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-[var(--text)]">{plat.plat}</span>
            {typeof noteAffichee(plat) === "number" && (
              <span className="text-sm font-bold text-[var(--accent)]">{noteAffichee(plat)}/10</span>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {plat.restaurant} · {plat.prix}
          </div>
          {justifAffichee(plat) && (
            <p className="text-sm text-[var(--text-secondary)] mt-2">{justifAffichee(plat)}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">
          Aucun plat trouvé aujourd'hui. Reviens un peu plus tard !
        </p>
      )}

      {answers.menu === "menu" && (
        <>
          <h2 className="text-lg font-bold text-[var(--text)] mt-2" style={{ fontFamily: "var(--font-heading)" }}>
            …et le dessert
          </h2>
          {dessert ? (
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="font-bold text-[var(--text)]">{dessert.nom}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">{dessert.restaurant}</div>
              <div className="text-xs mt-2 text-[var(--text-secondary)]">
                ≈ {dessert.proba}% de chances de l'avoir aujourd'hui
                {dessert.proba < 100 && " — à vérifier sur place"}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              Pas de dessert correspondant dans nos infos.
            </p>
          )}
        </>
      )}

      <button
        className="mt-2 self-start px-4 py-2 rounded-[var(--radius)] bg-[var(--accent)] text-[var(--accent-text)] font-semibold cursor-pointer"
        onClick={onReset}
      >
        ↻ Recommencer
      </button>
    </div>
  );
}
```

Note d'implémentation : les marqueurs internes (`_familleAsked`, `_proteineAsked`, `_saveurAsked`, `_lourdeurAsked`) servent à distinguer « peu importe » (axe laissé `undefined` mais question déjà posée) d'une question pas encore posée. Ils sont stockés dans l'objet `answers` via cast `as Answers`. Le type `Answers` peut être étendu pour les inclure proprement :

```ts
type Answers = {
  mode?: Mode;
  menu?: "plat" | "menu";
  famille?: Famille;
  proteine?: Proteine;
  saveur?: SaveurDessert;
  lourdeur?: Lourdeur;
  _familleAsked?: boolean;
  _proteineAsked?: boolean;
  _saveurAsked?: boolean;
  _lourdeurAsked?: boolean;
};
```

Et la condition de la question protéine doit aussi respecter le marqueur :
```ts
if (answers.famille === "viande" && !answers.proteine && !answers._proteineAsked) {
```
De même, remplacer `!("_familleAsked" in answers)` etc. par les champs typés (`!answers._familleAsked`). La question famille n'a pas de garde « asked » car répondre « peu importe » met `famille` à `undefined` ; ajouter le garde `_familleAsked` évite de la re-poser :
```ts
if (!answers.famille && !answers._familleAsked) {
```

- [ ] **Step 2: Mettre à jour le type `Answers` et les gardes**

Appliquer dans `QuizClient.tsx` : le type `Answers` étendu ci-dessus, et les 3 conditions gardées (`!answers._familleAsked`, `!answers._proteineAsked`, `!answers._saveurAsked`, `!answers._lourdeurAsked`). Retirer les `as Answers` devenus inutiles.

- [ ] **Step 3: Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: aucune erreur dans `app/aide-moi-a-choisir/` ni `lib/`.

- [ ] **Step 4: Commit**

```bash
git add app/aide-moi-a-choisir/page.tsx app/aide-moi-a-choisir/QuizClient.tsx
git commit -m "feat(quiz): page SSR + composant arbre de décision"
```

---

## Task 7: Lien de navigation (`app/layout.tsx`)

**Files:**
- Modify: `app/layout.tsx` (liens desktop ~ligne 47-58 et mobile ~ligne 176-187)

- [ ] **Step 1: Ajouter le lien desktop**

Dans le bloc `<div className="nav-links hidden sm:flex …" data-nav-links>` (après le lien `Aujourd'hui`), insérer :
```tsx
                <a href="/aide-moi-a-choisir" className="text-[var(--text-secondary)] no-underline text-xs sm:text-sm font-medium px-2 sm:px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text)] hover:bg-[var(--surface-hover)]">
                  Aide-moi à choisir
                </a>
```

- [ ] **Step 2: Ajouter le lien mobile**

Dans le bloc `<div className="flex flex-col gap-1 mb-3" data-nav-links>` (après le lien `Aujourd'hui` mobile), insérer :
```tsx
              <a href="/aide-moi-a-choisir" className="text-[var(--text-secondary)] no-underline text-sm font-medium px-3 py-2 rounded-lg transition-colors hover:text-[var(--text)] hover:bg-[var(--surface-hover)]">
                Aide-moi à choisir
              </a>
```

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(quiz): lien de nav vers Aide-moi à choisir"
```

---

## Task 8: Vérification finale (tests + build)

**Files:** aucun (vérification).

- [ ] **Step 1: Lancer toute la suite de tests**

Run: `npm test`
Expected: PASS — 17 tests (6 + 7 + 4).

- [ ] **Step 2: Build de production**

Run: `npm run build`
Expected: build réussi, route `/aide-moi-a-choisir` listée, aucune erreur TypeScript.

- [ ] **Step 3: Vérification manuelle**

Run: `npm run dev`, ouvrir `http://localhost:3000/aide-moi-a-choisir`.
Vérifier :
- Le parcours Sportif → plat seul → poisson aboutit à un plat (ou au plus proche).
- Le parcours Goulaf → plat + dessert → viande → poulet → chocolaté → gourmand affiche un plat ET un dessert avec « ≈X% de chances ».
- Le bouton « Recommencer » remet à zéro.
- « Peu importe » à chaque question n'empêche pas d'avancer.

- [ ] **Step 4: Commit éventuel** (si ajustements nécessaires après vérif manuelle)

```bash
git add -A
git commit -m "fix(quiz): ajustements après vérification manuelle"
```

---

## Self-Review

**Couverture spec :**
- Onglet dédié → Task 7. ✓
- Pool = plats du jour + cartes → Task 5. ✓
- Tags via ingredients_detail + repli nom → Task 2. ✓
- Base desserts probables + proba affichée + « à vérifier sur place » → Tasks 3, 6. ✓
- Desserts carte fiables (proba 100) → Task 5 `dessertsFromCarte`. ✓
- Arbre : mode, plat/menu, viande/poisson/végé, protéine (si viande), saveur, léger/gourmand → Task 6. ✓
- « Peu importe » par axe → Task 6. ✓
- Cas « aucun match » → repli `exact=false` (Task 4) + message (Task 6). ✓
- Résultat plat (resto, prix, note, justif) + dessert (proba) → Task 6. ✓
- Tests unitaires des fonctions pures → Tasks 2-4. ✓

**Cohérence des types :** `PoolPlat`, `DessertConnu`, `Famille`, `Proteine`, `SaveurDessert`, `Lourdeur`, `Mode` définis une fois et importés. `tagsForPlat` accepte `{plat, ingredients_detail}` que `PoolPlat` satisfait. `choisirPlat`/`choisirDessert` signatures cohérentes entre tests, lib et composant.

**Hors périmètre (rappel) :** pas de saisie quotidienne des desserts du Truck, pas de tagging pipeline Python, pas d'axes budget/resto.
```