# Design — Onglet « Aide-moi à choisir » (arbre de décision plat/menu)

Date : 2026-06-23
Statut : validé (design), prêt pour plan d'implémentation

## Objectif

Aider l'utilisateur à choisir quoi manger via un **arbre de décision déterministe** :
une série de questions à choix multiples, prédéterminées, qui filtrent
progressivement jusqu'à **un seul résultat idéal** — un plat seul, ou un menu
(plat + dessert) selon le choix de l'utilisateur.

Contrainte forte : **aucune IA à l'exécution**. Quand l'utilisateur clique sur
les réponses, tout est de la logique de filtrage/tri pure. L'IA n'intervient
qu'en amont (pipeline) si besoin, jamais en direct.

## Périmètre

- Pool de plats sur lequel on sélectionne : **plats du jour** (3 restos) **+
  plats des cartes permanentes**.
- Résultat : **un seul résultat idéal** (plat seul, ou plat + dessert).
- Vit dans un **nouvel onglet « Aide-moi à choisir »** → route
  `app/aide-moi-a-choisir/`.

## Architecture

### 1. Dérivation des tags de plats — `lib/quiz-tags.ts`

Fonctions **pures** (testables) qui déduisent, pour un `Plat` ou `CartePlat` :

- `famillePlat(plat) => "viande" | "poisson" | "vege"`
- `proteinePlat(plat) => "poulet" | "boeuf" | "porc" | "veau" | "agneau" | "poisson" | "autre"`

Logique :
1. Lire les `matched_nom` des `ingredients_detail` (noms Ciqual fiables, ex.
   `"Poulet, blanc, grillé"`, `"Agneau, gigot…"`, noms de poissons).
2. Mapper via des listes de mots-clés par catégorie :
   - poisson : `saumon, cabillaud, thon, colin, lieu, dorade, truite, crevette,
     poisson, accra de poisson, …`
   - poulet : `poulet, volaille, dinde`
   - bœuf : `boeuf, bœuf, steak, bavette, bourguignon`
   - porc : `porc, jambon, lardon, saucisse, chipolata`
   - veau : `veau`
   - agneau : `agneau`
3. famille : si poisson détecté → `poisson` ; sinon si une viande → `viande` ;
   sinon → `vege`.
4. **Repli** : si pas d'`ingredients_detail`, scanner les mêmes mots-clés sur
   `plat.plat` (le nom).

### 2. Base de desserts — `lib/desserts.ts`

Liste curée **éditable** (donnée par l'utilisateur). Type :

```ts
interface DessertConnu {
  nom: string;
  restaurant: string;          // "Le Truck Muche" | "Le Bistrot Trèfle" | …
  type_saveur: "fruite" | "chocolate" | "creme_lacte" | "patissier";
  leger_gourmand: "leger" | "gourmand";
  proba: number;               // 0-100, chance d'être dispo aujourd'hui
  note?: number;               // optionnel (si évalué)
}
```

Pourquoi statique : les desserts du Truck sont postés sur Facebook ~11h30-45 le
jour même → **non scrapables**, donc impossibles à mettre dans la pipeline. On
maintient une base des desserts **probables**.

Seed initial :
- **Truck — quasi-permanents (proba ~85)** : Fromage blanc muesli coulis
  framboise, Salade de fruits, Mi-cuit, Mousse spéculoos, Tiramisu Oreo,
  Banoffee.
- **Truck — tournants (proba ~30)** : Flan aux œufs, Fraises chantilly, Tarte
  abricots amandine, Clafoutis pêches, Crème brûlée chocolat, Crumble pommes
  spéculoos, Tiramisu framboise spéculoos, Brioche perdue Nutella.
- **Bistrot Trèfle (carte fiable, proba 100)** : desserts de la section
  `DESSERTS`.

Les valeurs `type_saveur` / `leger_gourmand` / `proba` sont attribuées à la main
dans le fichier (ajustables).

### 3. L'arbre de décision (déterministe)

Ordre des questions :

1. **Mode** : `Sportif` ou `Goulaf` → sert au tri par note (`note` vs
   `note_goulaf`).
2. **Plat seul ou plat + dessert ?**
3. *(branche plat)* **Viande / poisson / végé ?**
4. *(si « viande »)* **Poulet / bœuf / porc / veau / peu importe ?**
   → Résultat plat = filtrer le pool par famille (+ protéine si précisée),
     trier par note du mode choisi (décroissant), prendre le meilleur.
5. *(si « + dessert »)* **Type/saveur ?** puis **Léger / gourmand ?**
   → Résultat dessert = filtrer la base, trier par `proba` puis `note`, prendre
     le meilleur.

Chaque question a une option **« peu importe »** qui n'applique pas de filtre sur
cet axe.

### 4. Cas limites

- **Aucun match** (ex. pas de poisson aujourd'hui) : message clair (« Pas de
  poisson aujourd'hui ») + proposer le **plat le plus proche** (en relâchant le
  dernier filtre).
- Desserts sans `note` : le tri par note est ignoré, on s'appuie sur `proba`.

### 5. Écran de résultat

- **Carte plat idéal** : restaurant, prix, note (mode), justification.
- **Carte dessert** (si menu) : nom, restaurant, **« ≈X % de chances de l'avoir
  aujourd'hui — à vérifier sur place »**.
- Bouton **« Recommencer »**.

## Flux de données

```
SSR page (app/aide-moi-a-choisir/page.tsx)
  ├─ getLatestPdj()            → plats du jour
  ├─ getCarte(slug) × restos   → plats des cartes permanentes
  └─ DESSERTS_CONNUS (lib/desserts.ts) statique
        ↓ props
Composant client (arbre)
  ├─ lib/quiz-tags.ts  → tags plats (pur)
  └─ logique filtrage/tri (pur) → résultat
```

## Tests

Tests unitaires sur les fonctions pures :
- `lib/quiz-tags.ts` : dérivation famille/protéine depuis `ingredients_detail`
  et depuis le repli sur le nom.
- Filtrage/tri des plats (par famille, protéine, mode).
- Filtrage/tri des desserts (par saveur, léger/gourmand, proba, note).

## Hors périmètre (YAGNI)

- Pas de saisie quotidienne manuelle des desserts du Truck (base probable
  suffit pour v1).
- Pas de tagging dans la pipeline Python (approche A front-only retenue ;
  pipeline = évolution future seulement si la précision est insuffisante).
- Pas d'axes supplémentaires (budget, restaurant préféré, légèreté du plat) en
  v1.
```