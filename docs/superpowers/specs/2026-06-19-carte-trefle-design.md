# Carte permanente du Bistrot Trèfle — notée à part

**Date :** 2026-06-19
**Statut :** Design validé, prêt pour le plan d'implémentation

## Contexte

Le scraper du Bistrot Trèfle (`scrapers/bistrot_trefle.py`) ne récupère aujourd'hui
que la section « PLAT DU JOUR & FORMULE » (`SECTION_ID = "8yMbeExQfQ"`) de l'API
Obypay. L'API expose pourtant **toute la carte permanente** du restaurant (plats,
salades, pâtes, poissons, sandwiches, desserts, boissons…).

Cette carte ne change qu'environ **4 fois par an**. L'idée : la scraper, la noter
**une seule fois** (Sportif/Goulaf + macros), puis réutiliser ces notes tant que la
carte n'a pas changé, et l'afficher dans un bloc dédié sur la home.

## Objectif

Afficher la carte permanente du Trèfle (hors plat du jour), notée et avec macros,
dans un bloc repliable sur la page d'accueil. Évaluation LLM déclenchée uniquement
quand la carte change réellement (détection par hash). **Pas de commentaires de
personnages** sur la carte (c'est statique et non daté).

## Périmètre

- **Inclus :** plats salés + desserts. Sections retenues par allowlist de noms :
  `PLATS`, `SALADES ET POKE BOWLS`, `PÂTES`, `POISSONS`, `CLUBS SANDWICH`,
  `DESSERTS`.
- **Exclus :** boissons, eaux, bières, vins, alcools, café, soft, digestifs ; et
  toutes les sections « menu » composites (`Menu plat desserts boissons`,
  `Menus`, `Produits menus`, `MENU 20,90`, `DESSERT DU MENU`, etc.) qui ne sont
  que des regroupements/doublons.
- **Dédup :** l'API renvoie de nombreux items en double (le même plat apparaît dans
  plusieurs sections). On déduplique par **nom normalisé** (trim + casse + espaces),
  à l'intérieur de chaque section retenue.

## Architecture

### Décision de stockage : nouvelle table `pdj_carte`

Retenue plutôt que de réutiliser `pdj_entries` (date sentinelle → pollue toutes les
requêtes par date) ou un fichier JSON commité (le pipeline tourne sur le VPS et
publie vers Vercel par API ; un fichier statique ne se synchroniserait pas sans
commit). La table dédiée garde la carte hors du flux quotidien daté.

## Composants

### 1. Scraper — `bistrot_trefle.scrape_carte()`

Nouvelle fonction dans `scrapers/bistrot_trefle.py`. Réutilise le téléchargement de
l'API existant (extraire un helper `_fetch_outlet_data()` partagé avec `scrape()` /
`scrape_semaine()` pour ne pas dupliquer la requête).

- Parcourt récursivement les produits (comme `_recurse`), mais retient les items
  dont la **section** appartient à l'allowlist de noms ci-dessus.
- Groupe par section, déduplique par nom normalisé, conserve `{ "plat": nom, "prix": "X€" }`.
- Calcule un **hash SHA-1** déterministe du contenu : concaténation triée des
  `(section, nom, prix)` de tous les items retenus. Le tri garantit que l'ordre
  renvoyé par l'API n'influe pas sur le hash.

Retour :

```python
{
  "restaurant": "Le Bistrot Trèfle",
  "hash": "<sha1>",
  "sections": [
    { "nom": "PLATS", "plats": [ { "plat": "FISH AND CHIPS", "prix": "16€" }, ... ] },
    { "nom": "DESSERTS", "plats": [ ... ] },
    ...
  ],
}
```

Retourne `None` en cas d'échec API (comme les autres scrapers).

### 2. Évaluation — `diet_agent.evaluate_carte(sections)`

Nouvelle fonction dans `agent/diet_agent.py`, calquée sur `evaluate()` /
`evaluate_semaine()` :

- Aplatit toutes les sections en une liste de plats `{restaurant, plat, prix}`.
- Appelle Claude avec le même `_build_system_prompt()` + calibration des portions,
  mais **sans demander de recommandation** (la carte n'a pas de « plat du jour »).
- Passe par `_apply_ciqual(...)` pour les macros déterministes (ingrédients +
  grammages → Ciqual, fallback LLM si >30 % non matché), exactement comme l'existant.
- Réinjecte les plats notés dans leur section d'origine (matching par nom) et
  renvoie la même structure `{restaurant, hash, sections}` enrichie : chaque plat
  porte alors `note`, `note_goulaf`, `nutrition_estimee`, `nutrition_source`,
  `justification`, `justification_goulaf`, `ingredients_detail`.

Si l'évaluation échoue, on **ne publie pas** (on conserve la carte précédente),
même logique de prudence que pour le plat du jour.

### 3. Stockage — `lib/db.ts`

Nouveau type et nouvelle table :

```ts
export interface CartePlat {
  plat: string;
  prix: string;
  note?: number;
  justification?: string;
  note_goulaf?: number;
  justification_goulaf?: string;
  nutrition_estimee?: { calories: number; proteines_g: number; glucides_g: number; lipides_g: number };
  nutrition_source?: "ciqual" | "llm";
  ingredients_detail?: IngredientDetail[];
}

export interface CarteSection { nom: string; plats: CartePlat[]; }

export interface Carte {
  restaurant_slug: string;
  hash: string;
  sections: CarteSection[];
  evaluated_at?: string;
}
```

```sql
CREATE TABLE IF NOT EXISTS pdj_carte (
  restaurant_slug VARCHAR(50) PRIMARY KEY,
  hash TEXT NOT NULL,
  data JSONB NOT NULL,        -- { restaurant, hash, sections }
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
)
```

Fonctions : `ensureCarteTable()`, `getCarte(slug)`, `upsertCarte(carte)`.

### 4. API — `app/api/carte/route.ts`

- `GET` **public** : renvoie la carte stockée pour `bistrot_trefle` (ou `null`).
  Sert à la fois le rendu home (SSR) et la comparaison de hash côté pipeline ; le
  hash est inclus dans la réponse.
- `POST` **protégé** par `API_SECRET_TOKEN` (Bearer, même schéma que `/api/update`) :
  upsert de la carte évaluée. Valide la présence de `restaurant_slug` et `hash`.

### 5. Publication — `publish.py`

Ajout de `publish_carte(data: dict) -> bool` (POST `/api/carte`, même en-têtes Bearer
que `publish_pdj`) et d'un `fetch_carte_hash() -> str | None` (GET `/api/carte`,
renvoie le hash stocké ou `None`).

### 6. Pipeline — `main.py` (`run_semaine`)

Étape ajoutée dans la pipeline **semaine** uniquement (la carte change rarement,
inutile de la vérifier chaque jour) :

1. `carte = bistrot_trefle.scrape_carte()`. Si `None` → log + skip, ne casse pas le run.
2. `stored_hash = fetch_carte_hash()`.
3. Si `carte["hash"] == stored_hash` → log « carte inchangée, évaluation réutilisée »,
   skip.
4. Sinon → `evaluate_carte`, puis `publish_carte`. Log « carte modifiée → ré-évaluée ».
   Si l'évaluation lève → log, pas de publication.

Exécution en `run_in_executor` (les fonctions sont synchrones), idéalement dans le
`asyncio.gather` existant ou juste après le bloc semaine.

### 7. Frontend — bloc « La carte du Trèfle » sur la home

Dans `app/page.tsx` (SSR) : lecture via `getCarte("bistrot_trefle")`. Si présente,
rendu d'un **bloc repliable, replié par défaut**, sous la vue du jour :

- Titre « La carte du Trèfle » + indication discrète de la dernière évaluation.
- Groupé par section ; chaque plat réutilise le rendu de carte plat existant
  (note + macros), et les classes `mode-sportif` / `mode-goulaf` déjà en place pour
  basculer les notes selon le mode sélectionné globalement.
- **Aucune zone de commentaires** sur ces plats.

Nouveau composant client `app/CarteTrefle.tsx` pour la gestion du repli/dépli
(`useState`), recevant la `Carte` en props depuis le SSR.

## Flux de données

```
scrape_carte() → hash + sections
      │
      ▼  (run_semaine)
fetch_carte_hash() ── identique ──→ skip (réutilise notes stockées)
      │ différent
      ▼
evaluate_carte() → sections notées + macros Ciqual
      │
      ▼
publish_carte() → POST /api/carte (auth) → upsertCarte → pdj_carte (JSONB)
      │
      ▼
home SSR getCarte("bistrot_trefle") → <CarteTrefle> bloc repliable
```

## Gestion des erreurs

- Échec scrape carte → log, pipeline continue (pas bloquant).
- Échec évaluation → pas de publication, carte précédente conservée.
- Carte absente en base → bloc non affiché sur la home (rendu conditionnel).
- `GET /api/carte` indisponible côté pipeline → on considère `stored_hash = None`,
  donc ré-évaluation (comportement sûr : au pire on recalcule).

## Tests

- **Scraper :** sur un échantillon de réponse API figé, vérifier que seules les
  sections allowlist sortent, que la dédup fonctionne, et que le hash est stable
  quel que soit l'ordre des items.
- **Évaluation :** structure de retour conforme (chaque plat porte note/macros,
  aucune `recommandation`).
- **API :** `POST` refuse sans token (401) ; `GET` renvoie la carte ou `null`.
- **Pipeline :** hash identique → pas d'appel à `evaluate_carte` ; hash différent →
  appel + publication.

## Hors périmètre (YAGNI)

- Pas de commentaires de personnages sur la carte.
- Pas de page dédiée `/carte` (bloc sur la home suffit).
- Pas d'historique des versions de carte (on garde seulement la version courante).
- Pas d'extension aux autres restaurants pour l'instant (Trèfle uniquement, la
  table est néanmoins clé par `restaurant_slug` pour rester extensible).
