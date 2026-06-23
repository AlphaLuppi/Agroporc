# Pipeline desserts du Truck Muche (proba data-driven) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scraper chaque jour (~13h) la liste des desserts postée **en texte** sur le Facebook/Instagram du Truck Muche, l'accumuler dans Vercel Postgres, et en déduire une probabilité réaliste de voir chaque dessert (fréquence d'observation) qui alimente l'onglet « Aide-moi à choisir ».

**Architecture :** Un cron 13h lance `python main.py desserts` → scrape le texte du post desserts → POST `/api/desserts-observation` (protégé) → table `pdj_desserts_observations` (date, nom). La page SSR du quiz lit les observations et calcule, via une fonction pure testée, `proba = jours où le dessert a été vu / jours où des desserts ont été postés` sur une fenêtre glissante. La liste statique `DESSERTS_CONNUS` devient un seed de cold-start. **Aucune vision/OCR** : les desserts sont du texte dans le post → parsing heuristique déterministe.

**Point de conception clé :** le dénominateur de la proba = nombre de jours **où des desserts ont été postés** (= dates distinctes présentes dans les observations sur la fenêtre), **pas** le nombre de jours scrapés. Raison : le Truck oublie parfois de poster ; un jour sans post ne doit pas faire baisser la proba de tous les desserts.

**Tech Stack :** Next.js 15 (SSR), TypeScript, Vercel Postgres (`@vercel/postgres`), Vitest (front, fonctions pures), Python 3 + Playwright + requests (pipeline), pytest (helpers de parsing).

---

## File Structure

- `lib/desserts.ts` — **Modify** : ajout `DessertObservation`, `normalizeDessertKey`, `isoMinusDays`, `aggregateObservations`, `mergeDesserts` (purs).
- `lib/desserts.test.ts` — **Modify** : tests des nouvelles fonctions.
- `lib/db.ts` — **Modify** : `ensureDessertsTable`, `insertDessertsObservations`, `getDessertsObservations`.
- `app/api/desserts-observation/route.ts` — **Create** : POST protégé (ingestion) + GET (lecture debug).
- `app/aide-moi-a-choisir/page.tsx` — **Modify** : lit les observations, agrège, fusionne avec le seed.
- `plats-du-jour/scrapers/truck_muche_desserts.py` — **Create** : `is_dessert_post`, `parse_desserts_from_caption` (purs) + `scrape_desserts_du_jour` (IO Playwright/Instagram).
- `plats-du-jour/tests/test_desserts_truck.py` — **Create** : tests pytest des helpers purs.
- `plats-du-jour/publish.py` — **Modify** : `publish_desserts_observation(date, noms)`.
- `plats-du-jour/main.py` — **Modify** : mode `desserts` → `run_desserts()`.
- `plats-du-jour/cron_desserts.sh` — **Create** : script cron 13h (active venv + `main.py desserts`).

---

## Task 1 : Fonctions pures d'agrégation (`lib/desserts.ts`)

**Files:**
- Modify: `lib/desserts.ts`
- Test: `lib/desserts.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `lib/desserts.test.ts`, ajoute ces imports en tête (compléter la ligne d'import existante depuis `./desserts`) et ce bloc de tests à la fin du fichier :

```ts
import {
  normalizeDessertKey,
  aggregateObservations,
  mergeDesserts,
  isoMinusDays,
} from "./desserts";

describe("normalizeDessertKey", () => {
  it("ignore casse, accents, ponctuation et espaces", () => {
    expect(normalizeDessertKey("Mi-cuit  CHOCOLAT !")).toBe("mi cuit chocolat");
  });

  it("regroupe les variantes proches sur la même clé", () => {
    expect(normalizeDessertKey("Tarte aux pommes")).toBe(
      normalizeDessertKey("tarte aux  pommes")
    );
  });

  it("gère la ligature œ", () => {
    expect(normalizeDessertKey("Flan aux œufs")).toBe("flan aux oeufs");
  });
});

describe("isoMinusDays", () => {
  it("soustrait des jours en restant en ISO", () => {
    expect(isoMinusDays("2026-06-23", 7)).toBe("2026-06-16");
  });

  it("traverse un changement de mois", () => {
    expect(isoMinusDays("2026-06-03", 5)).toBe("2026-05-29");
  });
});

describe("aggregateObservations", () => {
  const obs = [
    { date: "2026-06-22", nom: "Mi-cuit chocolat" },
    { date: "2026-06-22", nom: "Salade de fruits" },
    { date: "2026-06-23", nom: "Mi cuit chocolat" }, // variante → même clé
    { date: "2026-06-23", nom: "Tiramisu" },
  ];

  it("calcule la proba sur les jours où des desserts ont été postés", () => {
    const res = aggregateObservations(obs, { today: "2026-06-23", windowDays: 60 });
    // 2 jours postés au total
    const micuit = res.find((d) => normalizeDessertKey(d.nom) === "mi cuit chocolat");
    expect(micuit?.proba).toBe(100); // vu les 2 jours
    const tiramisu = res.find((d) => normalizeDessertKey(d.nom) === "tiramisu");
    expect(tiramisu?.proba).toBe(50); // vu 1 jour sur 2
  });

  it("exclut les observations hors fenêtre", () => {
    const vieux = [
      { date: "2020-01-01", nom: "Vieux dessert" },
      { date: "2026-06-23", nom: "Tiramisu" },
    ];
    const res = aggregateObservations(vieux, { today: "2026-06-23", windowDays: 60 });
    expect(res.map((d) => d.nom)).toEqual(["Tiramisu"]);
    expect(res[0].proba).toBe(100); // 1 jour posté dans la fenêtre, vu 1 fois
  });

  it("classe la saveur/lourdeur via classerDessertNom", () => {
    const res = aggregateObservations(
      [{ date: "2026-06-23", nom: "Mi-cuit chocolat" }],
      { today: "2026-06-23" }
    );
    expect(res[0].type_saveur).toBe("chocolate");
    expect(res[0].restaurant).toBe("Le Truck Muche");
  });

  it("retourne [] si aucune observation dans la fenêtre", () => {
    expect(aggregateObservations([], { today: "2026-06-23" })).toEqual([]);
  });

  it("choisit le libellé le plus fréquent pour une clé", () => {
    const res = aggregateObservations(
      [
        { date: "2026-06-21", nom: "Tarte aux pommes" },
        { date: "2026-06-22", nom: "Tarte aux pommes" },
        { date: "2026-06-23", nom: "tarte aux  pommes" },
      ],
      { today: "2026-06-23" }
    );
    expect(res).toHaveLength(1);
    expect(res[0].nom).toBe("Tarte aux pommes");
  });
});

describe("mergeDesserts", () => {
  it("les desserts observés priment sur le seed (même clé)", () => {
    const seed = [
      { nom: "Mi-cuit chocolat", restaurant: "Le Truck Muche", type_saveur: "chocolate", leger_gourmand: "gourmand", proba: 85 } as const,
    ];
    const observed = [
      { nom: "Mi cuit chocolat", restaurant: "Le Truck Muche", type_saveur: "chocolate", leger_gourmand: "gourmand", proba: 40 } as const,
    ];
    const res = mergeDesserts([...observed], [...seed]);
    expect(res).toHaveLength(1);
    expect(res[0].proba).toBe(40); // observé gagne
  });

  it("garde les entrées du seed absentes des observations", () => {
    const seed = [
      { nom: "Banoffee", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 85 } as const,
    ];
    const res = mergeDesserts([], [...seed]);
    expect(res.map((d) => d.nom)).toEqual(["Banoffee"]);
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd "/Users/toam/Documents/PDJ Master" && npx vitest run lib/desserts.test.ts`
Expected: FAIL — `normalizeDessertKey`, `aggregateObservations`, `mergeDesserts`, `isoMinusDays` non exportés.

- [ ] **Step 3 : Implémenter les fonctions dans `lib/desserts.ts`**

Ajoute à la fin de `lib/desserts.ts` (après `choisirDessert`) :

```ts
/** Une observation quotidienne d'un dessert (issue du scrape). */
export interface DessertObservation {
  date: string; // YYYY-MM-DD
  nom: string;
}

/** Clé de regroupement : minuscule, sans accents/ligatures, sans ponctuation, espaces normalisés. */
export function normalizeDessertKey(nom: string): string {
  return nom
    .toLowerCase()
    .normalize("NFD")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Soustrait `n` jours à une date ISO (YYYY-MM-DD) et renvoie une date ISO. */
export function isoMinusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Agrège des observations en base de desserts data-driven.
 * proba = (jours distincts où le dessert a été vu) / (jours distincts où DES desserts
 * ont été postés), sur la fenêtre [today - windowDays, today]. Les jours sans post
 * n'entrent pas dans le dénominateur.
 */
export function aggregateObservations(
  observations: DessertObservation[],
  opts: { today: string; windowDays?: number }
): DessertConnu[] {
  const windowDays = opts.windowDays ?? 60;
  const cutoff = isoMinusDays(opts.today, windowDays);
  const inWindow = observations.filter(
    (o) => o.date >= cutoff && o.date <= opts.today
  );
  const postDays = new Set(inWindow.map((o) => o.date));
  const totalDays = postDays.size;
  if (totalDays === 0) return [];

  const groups = new Map<
    string,
    { dates: Set<string>; noms: Map<string, number> }
  >();
  for (const o of inWindow) {
    const key = normalizeDessertKey(o.nom);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { dates: new Set(), noms: new Map() };
      groups.set(key, g);
    }
    g.dates.add(o.date);
    g.noms.set(o.nom, (g.noms.get(o.nom) ?? 0) + 1);
  }

  const out: DessertConnu[] = [];
  for (const g of groups.values()) {
    const nom = [...g.noms.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const proba = Math.round((g.dates.size / totalDays) * 100);
    const { type_saveur, leger_gourmand } = classerDessertNom(nom);
    out.push({ nom, restaurant: "Le Truck Muche", type_saveur, leger_gourmand, proba });
  }
  return out;
}

/**
 * Fusionne les desserts observés (prioritaires) et le seed curé (fallback cold-start),
 * dédupliqués par clé normalisée. Un dessert observé écrase l'entrée seed de même clé.
 */
export function mergeDesserts(
  observed: DessertConnu[],
  seed: DessertConnu[]
): DessertConnu[] {
  const byKey = new Map<string, DessertConnu>();
  for (const d of seed) byKey.set(normalizeDessertKey(d.nom), d);
  for (const d of observed) byKey.set(normalizeDessertKey(d.nom), d);
  return [...byKey.values()];
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd "/Users/toam/Documents/PDJ Master" && npx vitest run lib/desserts.test.ts`
Expected: PASS (tous les tests desserts, anciens + nouveaux).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/toam/Documents/PDJ Master" && git add lib/desserts.ts lib/desserts.test.ts && git commit -m "feat(desserts): agrégation data-driven des observations (proba par fréquence)"
```

---

## Task 2 : Couche DB — table d'observations (`lib/db.ts`)

**Files:**
- Modify: `lib/db.ts`

Pas de test unitaire : `lib/db.ts` utilise `@vercel/postgres` (pas de pattern de test DB dans le repo). Vérification via `tsc` puis `npm run build`.

- [ ] **Step 1 : Ajouter les fonctions à la fin de `lib/db.ts`**

Ajoute à la fin de `lib/db.ts` :

```ts
// --- Observations quotidiennes des desserts (Truck Muche) ---

/** Crée la table d'observations de desserts si elle n'existe pas. */
export async function ensureDessertsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_desserts_observations (
      date DATE NOT NULL,
      nom TEXT NOT NULL,
      observed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (date, nom)
    )
  `;
}

/** Insère les desserts observés pour une date (idempotent). Retourne le nb d'inserts tentés. */
export async function insertDessertsObservations(
  date: string,
  noms: string[]
): Promise<number> {
  await ensureDessertsTable();
  let n = 0;
  for (const raw of noms) {
    const nom = raw.trim();
    if (!nom) continue;
    await sql`
      INSERT INTO pdj_desserts_observations (date, nom)
      VALUES (${date}, ${nom})
      ON CONFLICT (date, nom) DO NOTHING
    `;
    n++;
  }
  return n;
}

/** Récupère les observations depuis `sinceDate` (incluse), date renvoyée en YYYY-MM-DD. */
export async function getDessertsObservations(
  sinceDate: string
): Promise<{ date: string; nom: string }[]> {
  await ensureDessertsTable();
  const result = await sql`
    SELECT to_char(date, 'YYYY-MM-DD') AS date, nom
    FROM pdj_desserts_observations
    WHERE date >= ${sinceDate}
    ORDER BY date DESC
  `;
  return result.rows.map((r) => ({ date: r.date as string, nom: r.nom as string }));
}
```

- [ ] **Step 2 : Vérifier le typecheck**

Run: `cd "/Users/toam/Documents/PDJ Master" && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
cd "/Users/toam/Documents/PDJ Master" && git add lib/db.ts && git commit -m "feat(desserts): table et requêtes d'observations en base"
```

---

## Task 3 : Endpoint d'ingestion (`app/api/desserts-observation/route.ts`)

**Files:**
- Create: `app/api/desserts-observation/route.ts`

Calque exact sur `app/api/update/route.ts` (auth Bearer via `API_SECRET_TOKEN`).

- [ ] **Step 1 : Créer la route**

Create `app/api/desserts-observation/route.ts` :

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  ensureDessertsTable,
  insertDessertsObservations,
  getDessertsObservations,
} from "@/lib/db";
import { isoMinusDays } from "@/lib/desserts";

export const runtime = "nodejs";

/** Ingestion protégée par token (depuis le pipeline 13h). */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { date?: string; desserts?: string[] };

    if (!body.date || !Array.isArray(body.desserts)) {
      return NextResponse.json(
        { error: "Champs 'date' et 'desserts' (tableau) requis" },
        { status: 400 }
      );
    }

    await ensureDessertsTable();
    const n = await insertDessertsObservations(body.date, body.desserts);

    return NextResponse.json({ ok: true, date: body.date, inserted: n });
  } catch (e) {
    console.error("[api/desserts-observation] Erreur:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/** Lecture publique des observations récentes (90 derniers jours) — utile pour debug. */
export async function GET() {
  const today = new Date().toLocaleDateString("en-CA");
  const rows = await getDessertsObservations(isoMinusDays(today, 90));
  return NextResponse.json(rows);
}
```

- [ ] **Step 2 : Vérifier le typecheck**

Run: `cd "/Users/toam/Documents/PDJ Master" && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
cd "/Users/toam/Documents/PDJ Master" && git add app/api/desserts-observation/route.ts && git commit -m "feat(desserts): endpoint POST/GET d'observations"
```

---

## Task 4 : Brancher les observations dans la page du quiz (`app/aide-moi-a-choisir/page.tsx`)

**Files:**
- Modify: `app/aide-moi-a-choisir/page.tsx`

- [ ] **Step 1 : Mettre à jour les imports**

Dans `app/aide-moi-a-choisir/page.tsx`, remplace la ligne d'import depuis `@/lib/db` :
```tsx
import { ensureTable, getPdjByDate, getCarte } from "@/lib/db";
```
par :
```tsx
import { ensureTable, getPdjByDate, getCarte, getDessertsObservations } from "@/lib/db";
```

Et remplace la ligne d'import depuis `@/lib/desserts` :
```tsx
import { DESSERTS_CONNUS, classerDessertNom, type DessertConnu } from "@/lib/desserts";
```
par :
```tsx
import {
  DESSERTS_CONNUS,
  classerDessertNom,
  aggregateObservations,
  mergeDesserts,
  isoMinusDays,
  type DessertConnu,
} from "@/lib/desserts";
```

- [ ] **Step 2 : Calculer les desserts data-driven**

Dans la fonction `AideMoiAChoisir`, repère le bloc actuel :
```tsx
  const desserts: DessertConnu[] = [
    ...DESSERTS_CONNUS,
    ...cartes.flatMap((c, i) => dessertsFromCarte(c, SLUGS[i].nom)),
  ];
```
et remplace-le par :
```tsx
  // Desserts Truck Muche : observations réelles (proba = fréquence), seed en fallback cold-start.
  const observations = await getDessertsObservations(isoMinusDays(today, 60));
  const observed = aggregateObservations(observations, { today, windowDays: 60 });
  const truckDesserts = mergeDesserts(observed, DESSERTS_CONNUS);

  const desserts: DessertConnu[] = [
    ...truckDesserts,
    ...cartes.flatMap((c, i) => dessertsFromCarte(c, SLUGS[i].nom)),
  ];
```
(`today` est déjà défini plus haut dans la fonction via `new Date().toLocaleDateString("en-CA")`.)

- [ ] **Step 3 : Vérifier le typecheck**

Run: `cd "/Users/toam/Documents/PDJ Master" && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
cd "/Users/toam/Documents/PDJ Master" && git add app/aide-moi-a-choisir/page.tsx && git commit -m "feat(desserts): proba data-driven dans l'onglet aide-moi à choisir"
```

---

## Task 5 : Helpers de parsing Python (`scrapers/truck_muche_desserts.py`)

**Files:**
- Create: `plats-du-jour/scrapers/truck_muche_desserts.py`
- Test: `plats-du-jour/tests/test_desserts_truck.py`

On crée d'abord les fonctions **pures** testables (`is_dessert_post`, `parse_desserts_from_caption`). Le scraping IO (`scrape_desserts_du_jour`) est ajouté en Task 6.

- [ ] **Step 1 : Écrire les tests qui échouent**

Create `plats-du-jour/tests/test_desserts_truck.py` :
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import truck_muche_desserts as tmd


def test_is_dessert_post_detecte_le_mot_dessert():
    assert tmd.is_dessert_post("🍰 Nos desserts du jour 🍰") is True
    assert tmd.is_dessert_post("LES DESSERTS DE LA SEMAINE") is True


def test_is_dessert_post_rejette_un_menu_de_plats():
    assert tmd.is_dessert_post("LUNDI poulet basquaise MARDI poisson") is False


def test_parse_desserts_nettoie_puces_emojis_et_prix():
    texte = (
        "🍰 Desserts du jour :\n"
        "- Mi-cuit chocolat 3€\n"
        "• Salade de fruits — 2,50€\n"
        "Tiramisu spéculoos\n"
    )
    assert tmd.parse_desserts_from_caption(texte) == [
        "Mi-cuit chocolat",
        "Salade de fruits",
        "Tiramisu spéculoos",
    ]


def test_parse_desserts_ignore_les_lignes_parasites():
    texte = (
        "Bonjour à tous ! Voici nos desserts 😋\n"
        "Mousse au chocolat\n"
        "\n"
        "À très vite au Truck Muche !\n"
    )
    assert tmd.parse_desserts_from_caption(texte) == ["Mousse au chocolat"]


def test_parse_desserts_vide_si_rien():
    assert tmd.parse_desserts_from_caption("") == []
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/test_desserts_truck.py -v`
Expected: FAIL — module `truck_muche_desserts` inexistant.

- [ ] **Step 3 : Créer `scrapers/truck_muche_desserts.py` (helpers purs uniquement)**

Create `plats-du-jour/scrapers/truck_muche_desserts.py` :
```python
"""
Scrape la liste des desserts du jour (texte) sur le Facebook/Instagram du Truck Muche,
pour accumuler une base de probabilités côté front.

Les desserts sont publiés EN TEXTE dans un post (pas une image) → parsing heuristique.
"""
import re
import unicodedata

# Lignes parasites à ignorer (salutations, signature, mentions de plats…).
_LIGNES_PARASITES = (
    "bonjour", "bonsoir", "coucou", "salut", "merci", "a tres vite", "a bientot",
    "truck muche", "bon appetit", "regalez", "plats du jour", "menu",
    "lundi", "mardi", "mercredi", "jeudi", "vendredi",
)


def _strip_accents(s: str) -> str:
    s = s.replace("œ", "oe").replace("æ", "ae")
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def is_dessert_post(text: str) -> bool:
    """True si le texte ressemble à un post de desserts (mot « dessert » présent)."""
    if not text:
        return False
    return "dessert" in _strip_accents(text).lower()


def _nettoyer_ligne(ligne: str) -> str:
    """Retire puces, emojis de début, prix de fin et espaces superflus."""
    s = ligne.strip()
    # Puces de début : -, •, *, –, —, chiffres de liste
    s = re.sub(r"^[\-•\*–—\d\.\)\s]+", "", s)
    # Prix de fin : "3€", "2,50€", "— 3 €", "3.50 EUR"
    s = re.sub(r"[\s\-–—]*\d+([.,]\d{1,2})?\s*(€|eur|euros?)\.?\s*$", "", s, flags=re.IGNORECASE)
    # Emojis / symboles non-texte en bordure
    s = s.strip(" \t:·•-–—🍰😋🍫🍓🥧🥛🎂🍮🍪🧁✨🔥")
    return s.strip()


def parse_desserts_from_caption(text: str) -> list[str]:
    """Extrait la liste des noms de desserts d'un texte de post."""
    if not text:
        return []
    out: list[str] = []
    for ligne_brute in text.splitlines():
        ligne = _nettoyer_ligne(ligne_brute)
        if not ligne or len(ligne) < 3:
            continue
        bas = _strip_accents(ligne).lower()
        # Ignore l'en-tête « desserts … » et les lignes parasites.
        if bas.startswith("dessert") or any(p in bas for p in _LIGNES_PARASITES):
            continue
        # Une ligne qui ne contient aucune lettre est ignorée (emojis seuls).
        if not re.search(r"[a-zA-ZÀ-ÿ]", ligne):
            continue
        out.append(ligne)
    return out
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/test_desserts_truck.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/toam/Documents/PDJ Master" && git add plats-du-jour/scrapers/truck_muche_desserts.py plats-du-jour/tests/test_desserts_truck.py && git commit -m "feat(desserts): helpers de parsing du post desserts (purs, testés)"
```

---

## Task 6 : Scraping IO + publication + commande `desserts`

**Files:**
- Modify: `plats-du-jour/scrapers/truck_muche_desserts.py` (ajout fonction IO)
- Modify: `plats-du-jour/publish.py`
- Modify: `plats-du-jour/main.py`

Pas de test unitaire (IO réseau/Playwright) ; vérification par dry-run manuel en Task 8.

- [ ] **Step 1 : Ajouter le scraping IO dans `truck_muche_desserts.py`**

Ajoute en tête de `plats-du-jour/scrapers/truck_muche_desserts.py` (après les imports existants) :
```python
import asyncio

import requests
from playwright.async_api import async_playwright

PAGE_URL = "https://www.facebook.com/letruckmuche/"
INSTAGRAM_USERNAME = "le_truckmuche_"
INSTAGRAM_API_URL = (
    f"https://i.instagram.com/api/v1/users/web_profile_info/?username={INSTAGRAM_USERNAME}"
)
```

Puis ajoute à la fin du fichier :
```python
# ── Scraping (IO) ────────────────────────────────────────────────────────────

def _recent_instagram_captions(limit: int = 8) -> list[str]:
    """Renvoie les légendes des derniers posts Instagram (sans auth), plus récent d'abord."""
    headers = {
        "User-Agent": "Instagram 76.0.0.15.395 Android",
        "x-ig-app-id": "936619743392459",
    }
    try:
        resp = requests.get(INSTAGRAM_API_URL, headers=headers, timeout=20)
    except Exception as e:
        print(f"[truck_desserts] Erreur Instagram : {e}")
        return []
    if resp.status_code != 200:
        print(f"[truck_desserts] Instagram HTTP {resp.status_code}")
        return []
    try:
        data = resp.json()
    except ValueError:
        return []
    user = (data.get("data") or {}).get("user")
    if not user:
        return []
    edges = (user.get("edge_owner_to_timeline_media") or {}).get("edges") or []
    captions = []
    for e in edges[:limit]:
        node = e.get("node") or {}
        caption_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
        caption = caption_edges[0].get("node", {}).get("text", "") if caption_edges else ""
        if caption.strip():
            captions.append(caption.strip())
    return captions


async def _recent_facebook_posts(limit: int = 8) -> list[str]:
    """Renvoie le texte des posts récents de la page FB (best-effort, plus récent d'abord)."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--window-size=1280,900"])
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="fr-FR",
            viewport={"width": 1280, "height": 900},
        )
        page = await context.new_page()
        try:
            await page.goto(PAGE_URL, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)
        except Exception as e:
            print(f"[truck_desserts] Erreur navigation FB : {e}")
            await browser.close()
            return []
        await page.evaluate("""async () => {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            for (const el of document.querySelectorAll('[aria-label="Fermer"], [aria-label="Close"]')) {
                el.click(); await delay(300);
            }
        }""")
        await page.wait_for_timeout(1000)
        texts = await page.evaluate(f"""async () => {{
            const delay = ms => new Promise(r => setTimeout(r, ms));
            const found = [];
            for (let pos = 0; pos <= 6000; pos += 500) {{
                window.scrollTo(0, pos);
                await delay(700);
                const sels = ['[data-ad-comet-preview="message"]', '[data-ad-preview="message"]', 'div[dir="auto"]'];
                for (const sel of sels) {{
                    for (const el of document.querySelectorAll(sel)) {{
                        const t = (el.innerText || '').trim();
                        if (t.length > 15 && !found.includes(t)) found.push(t);
                    }}
                }}
                if (found.length >= {limit}) break;
            }}
            return found.slice(0, {limit});
        }}""")
        await browser.close()
        return texts or []


def scrape_desserts_du_jour() -> list[str] | None:
    """
    Cherche le post de desserts le plus récent (Instagram d'abord, FB ensuite) et
    en extrait la liste des noms. Renvoie None si aucun post de desserts trouvé.
    """
    # 1) Instagram (légendes fiables via l'API publique)
    for caption in _recent_instagram_captions():
        if is_dessert_post(caption):
            noms = parse_desserts_from_caption(caption)
            if noms:
                print(f"[truck_desserts] Instagram : {len(noms)} dessert(s)")
                return noms
    # 2) Facebook (best-effort sur le texte des posts)
    try:
        fb_posts = asyncio.run(_recent_facebook_posts())
    except Exception as e:
        print(f"[truck_desserts] Erreur FB : {e}")
        fb_posts = []
    for texte in fb_posts:
        if is_dessert_post(texte):
            noms = parse_desserts_from_caption(texte)
            if noms:
                print(f"[truck_desserts] Facebook : {len(noms)} dessert(s)")
                return noms
    print("[truck_desserts] Aucun post de desserts trouvé")
    return None
```

- [ ] **Step 2 : Re-lancer les tests purs (non-régression)**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/test_desserts_truck.py -v`
Expected: PASS (5 tests) — l'ajout du code IO ne casse pas les helpers purs.

- [ ] **Step 3 : Ajouter `publish_desserts_observation` dans `publish.py`**

Dans `plats-du-jour/publish.py`, ajoute après la fonction `publish_carte` :
```python
def publish_desserts_observation(date: str, noms: list[str]) -> bool:
    """Envoie les desserts observés du jour vers l'API (POST /api/desserts-observation)."""
    if not API_URL or not API_TOKEN:
        print("[publish] VERCEL_API_URL ou API_SECRET_TOKEN non configuré")
        return False
    url = f"{API_URL}/api/desserts-observation"
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json={"date": date, "desserts": noms}, headers=headers, timeout=30)
        if resp.ok:
            print(f"[publish] OK — {len(noms)} dessert(s) pour {date}")
            return True
        print(f"[publish] Erreur desserts {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        print(f"[publish] Erreur réseau desserts: {e}")
        return False
```

- [ ] **Step 4 : Ajouter la commande `desserts` dans `main.py`**

Dans `plats-du-jour/main.py`, ajoute cette fonction près de `run_jour` (après sa définition) :
```python
def run_desserts():
    """Scrape les desserts du jour du Truck Muche et les publie comme observation."""
    import publish
    from scrapers import truck_muche_desserts
    today = date.today().isoformat()
    noms = truck_muche_desserts.scrape_desserts_du_jour()
    if not noms:
        print("[pipeline:desserts] Aucun dessert trouvé (post absent aujourd'hui ?)")
        return
    print(f"[pipeline:desserts] {len(noms)} dessert(s) : {noms}")
    publish.publish_desserts_observation(today, noms)
```
Vérifie que `date` est importé en tête de `main.py` (sinon ajoute `from datetime import date`).

Puis, dans le dispatch (bloc `if mode == "semaine": ... elif ...`), ajoute une branche avant le `else` final :
```python
    elif mode == "desserts":
        run_desserts()
```

- [ ] **Step 5 : Vérifier que `main.py` se charge sans erreur**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -c "import main, publish; from scrapers import truck_muche_desserts; print('imports OK')"`
Expected: `imports OK` — aucune `ImportError`/`SyntaxError`.

- [ ] **Step 6 : Commit**

```bash
cd "/Users/toam/Documents/PDJ Master" && git add plats-du-jour/scrapers/truck_muche_desserts.py plats-du-jour/publish.py plats-du-jour/main.py && git commit -m "feat(desserts): scraping IO + publication + commande 'desserts'"
```

---

## Task 7 : Script cron 13h (`cron_desserts.sh`)

**Files:**
- Create: `plats-du-jour/cron_desserts.sh`

- [ ] **Step 1 : Créer le script**

Create `plats-du-jour/cron_desserts.sh` :
```bash
#!/bin/bash
# Cron desserts Truck Muche — à lancer ~13h (les desserts sont postés vers midi).
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

source .venv/bin/activate
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "$(date '+%Y-%m-%d %H:%M') [cron-desserts] Scrape desserts du jour"
python3 main.py desserts >> output/cron.log 2>&1
echo "$(date '+%Y-%m-%d %H:%M') [cron-desserts] Terminé"
```

- [ ] **Step 2 : Rendre exécutable**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && chmod +x cron_desserts.sh`

- [ ] **Step 3 : Commit**

```bash
cd "/Users/toam/Documents/PDJ Master" && git add plats-du-jour/cron_desserts.sh && git commit -m "feat(desserts): script cron 13h"
```

- [ ] **Step 4 : Documenter la ligne crontab (action manuelle VPS — pas de commit)**

Le déploiement tourne dans Docker sur le VPS (`/opt/pdj`, cron 7h30 Paris). Ajouter au mécanisme cron existant la ligne (lun→ven, 13h Paris) :
```
30 13 * * 1-5  cd /opt/pdj && ./cron_desserts.sh
```
**À adapter** selon que le cron est sur l'hôte (préfixer d'un `docker exec <conteneur>`) ou dans le conteneur (supercronic/crontab interne). Cette étape n'est pas automatisable depuis le repo ; à appliquer côté VPS.

---

## Task 8 : Vérification finale

**Files:** aucun (vérification).

- [ ] **Step 1 : Suite de tests front**

Run: `cd "/Users/toam/Documents/PDJ Master" && npm test`
Expected: PASS — tous les tests (anciens 18 + nouveaux desserts).

- [ ] **Step 2 : Build de production**

Run: `cd "/Users/toam/Documents/PDJ Master" && npm run build`
Expected: build réussi, routes `/aide-moi-a-choisir` et `/api/desserts-observation` listées, aucune erreur TypeScript.

- [ ] **Step 3 : Tests Python**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/test_desserts_truck.py -v`
Expected: PASS (5 tests).

- [ ] **Step 4 : Dry-run du scrape (réseau réel)**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -c "from scrapers import truck_muche_desserts as t; print(t.scrape_desserts_du_jour())"`
Vérifier : la sortie est soit une liste de noms de desserts plausibles, soit `None` (si aucun post de desserts récent). Si la liste contient du bruit (lignes parasites), ajuster `_LIGNES_PARASITES` / `_nettoyer_ligne` puis relancer les tests pytest. **Ne pas** publier ici (pas de `main.py desserts`) pour éviter d'écrire en base avec des données mal parsées.

- [ ] **Step 5 : Commit éventuel** (si ajustements du parsing après dry-run)

```bash
cd "/Users/toam/Documents/PDJ Master" && git add -A && git commit -m "fix(desserts): ajustements parsing après dry-run"
```

---

## Self-Review

**Couverture spec :**
- Scrape quotidien du texte du post desserts → Tasks 5, 6. ✓
- Lancement à 13h via cron dédié → Task 7. ✓
- Accumulation d'un historique en base → Task 2 (`pdj_desserts_observations`) + Task 3 (ingestion). ✓
- Proba = fréquence d'observation, dénominateur = jours postés (gère les oublis du Truck) → Task 1 (`aggregateObservations`). ✓
- Seed statique en fallback cold-start → Task 1 (`mergeDesserts`) + Task 4. ✓
- Affichage dans « Aide-moi à choisir » → Task 4 (le composant `Resultat` affiche déjà `proba` + « à vérifier sur place »). ✓
- Pas de vision/OCR (texte) → parsing heuristique pur testé, Task 5. ✓

**Cohérence des types :** `DessertObservation {date, nom}` (desserts.ts) est structurellement compatible avec le retour `{date, nom}[]` de `getDessertsObservations` (db.ts) → passage direct en Task 4. `aggregateObservations`/`mergeDesserts` renvoient `DessertConnu[]`, consommé tel quel par `choisirDessert`. `isoMinusDays` réutilisé dans la route GET et la page.

**DRY :** `classerDessertNom` réutilisé pour classer les desserts observés (pas de duplication de logique saveur/lourdeur). `normalizeDessertKey` partagé entre agrégation et fusion.

**Hors périmètre :** pas d'extraction par LLM (heuristique suffit pour du texte) ; pas de purge automatique des vieilles observations (la fenêtre glissante les ignore déjà au calcul) ; configuration crontab VPS manuelle (Task 7 step 4).
```