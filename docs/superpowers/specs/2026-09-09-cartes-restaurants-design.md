# Cartes des restaurants et cards « sans plat du jour » — design validé (2026-09-09)

Design validé par Thomas le 9 septembre au soir (« oui » après présentation en six
sections). Chemin architectural : cette spec, puis un plan d'implémentation
(`docs/superpowers/plans/`), puis PR sur `main` et rebuild Docker sur le VPS.

## 1. Problème

Depuis la PR #26, Basilic n'Go, Dubble et La Mijote sont des restos **optionnels** :
ils n'apparaissent sur la home que les jours où ils publient un plat du jour, ce qui
est rare (Dubble en mode salad bowl l'été, La Mijote figée, Basilic parfois). Un resto
sans plat du jour a pourtant une **carte** qui mérite d'être consultable. Thomas veut :

> « On arrive sur la page principale avec la liste actuelle des restos avec les plats
> du jour s'ils en ont, sinon on a juste une card avec le resto et on clique pour
> aller chercher le menu. »

## 2. Décisions

| Sujet | Décision |
|---|---|
| Cartes scrapées et **notées** (Sportif/Goulaf + macros Ciqual) | Basilic n'Go, Dubble, La Mijote, en plus du Trèfle. Même mécanique hash-gardée : une évaluation LLM par changement de carte. |
| Card sans plat du jour | Pour **tout** resto attendu. Historiques : « Fermé aujourd'hui » (inchangé). Optionnels : « Pas de plat du jour aujourd'hui ». Vival : « Bar à salades sur place ». |
| Contenu de la card | Icône, nom, liens (commander / site), statut, et un dépliant **« Voir la carte »** si une carte existe en base. |
| Chargement de la carte | **Au clic** (fetch `/api/carte?slug=`), pas embarquée dans le HTML (la home pèse déjà 433 Ko ; les quatre cartes ≈ 70 Ko de JSON). |
| Onglet « La carte » | Devient multi-restos : un dépliant par carte disponible, Trèfle en premier, même chargement à la demande. |
| Jours futurs (« Aperçu ») | Les optionnels apparaissent avec le statut « Plat du jour dévoilé le matin même », carte accessible. Pause Gourmande garde sa card « Coming soon ». |
| Vival | Épicerie Casino (1159 rte de l'Aérodrome) avec un bar à salades d'une enseigne dont Thomas ne retrouve pas le nom. Card **lien seul** (site Vival Montfavet), aucun scraping, nom « Vival » en attendant. |
| Extraction des cartes | Basilic : déterministe (API ObyPay). Dubble (PDF) et La Mijote (HTML libre) : texte brut puis **structuration par LLM** en sections/plats/prix. |
| Le Tholéan | **Reporté entièrement** (Instagram 401, Facebook mur de connexion, Uber Eats anti-bot, site Google mort). |

### Hors périmètre (YAGNI)
- Commentaires de personnages sur les cartes.
- Dépliant carte sur les cards **avec** plat du jour (l'onglet « La carte » suffit).
- Jours futurs pour les optionnels (sources quotidiennes).
- Historique des versions de carte.
- Vérification quotidienne des cartes (reste dans `run_semaine`, plus la commande manuelle).

## 3. Sources vérifiées le 9 septembre

### Basilic n'Go — API ObyPay (déterministe)
`https://order-api.obypay.com/api/cashless/outlets/i-E4mhlAmXsn-1?instance=null`, sections
(id | nom | produits uniques) :

- `SxAY5moTd3` Salade (14 : La César 10,40, La Niçoise 8,90…)
- `RNTDcsfYnC` Sandwich (10 : Ciabatta Italien 7,90…)
- `nJPphmXghg` Poke Bowl (7 : Poke bowl poulet 13,40…)
- `zL1WM8RrTa` Dessert (15 : Brownie 3,10, Crumble ananas 3,10…)
- Exclues : Plat (`Nf8NZ3MTtZ`, = plat du jour déjà scrapé), Boisson, Livraison, Traiteur,
  Menus, Produits en menu, Envie supplémentaire, Petit plaisir (chips, macarons), Petite faim.

Produits en double (`menuMode` order / null) → dédoublonner par nom normalisé. Prix
`price` numérique → `"9.40€"`. Produits à 0 € (« Besoin de couvert ? », glaces) → ignorés.
Pas de filtre « collection » (spécifique au Trèfle).

### Dubble — PDF saisonnier
`https://link.dubble-food.com/Carte-Avignon-Agroparc` → 301 vers un PDF Wix
(`*.usrfiles.com/ugd/…pdf`, ≈ 360 Ko, 2 pages, « SAISON ÉTÉ 2026 »). Toujours passer par
le lien court (l'URL du PDF change à chaque saison). Texte extractible (vérifié avec
`pdftotext`) : Menu salad bowls 13,90 €, salad bowls 9–11 €, hot bowls 9–9,90 €, petites
salades, mini sandwiches, muffins toastés, soupes, desserts. Mise en page sur deux
colonnes → texte brut désordonné, d'où la structuration LLM. Le hot bowl du jour reste
sur la page HTML (scraper existant).

### La Mijote — `menu.html`
Champs `data-pgc-edit` : `entree_a`, `entree_b`, `dessert_a..c`, `formules_descriptions`
(« Entrée + Plat + Dessert 22 € », « Entrée + Plat ou Plat + Dessert 18 € », puis « La carte
des Mijoteurs » : Bavette d'aloyau 23 €, Pluma de cochon 22 €, Risotto de petit épeautre
18 €…), `suggestions_*`, `plat_<jour>`. Divs imbriqués → extraction par regex non fiable,
d'où le texte brut + LLM. Page figée depuis le 4 nov. 2025 : la carte est publiée quand
même (une carte est permanente, la date « notée le » l'indique) ; le garde-fou
`Last-Modified` reste réservé au plat du jour.

### Vival
Nœud OSM 43.9160254 / 4.8909944, `shop=convenience`, horaires Mo-Fr 08:30-20:00,
site `https://magasins.vival.fr/fr/vival-montfavet`. Facebook « Vival Agroparc Montfavet ».
Uber Eats derrière un anti-bot. Rien à scraper.

## 4. Données et API

- Table `pdj_carte` (clé `restaurant_slug`, `hash`, `data` JSONB, `evaluated_at`) et type
  `Carte { restaurant_slug, hash, restaurant?, sections, evaluated_at? }` **inchangés**.
- `lib/db.ts` : nouvelle fonction `getCartesDisponibles(): Promise<{ slug: string; evaluated_at: string | null }[]>`
  (`SELECT restaurant_slug, evaluated_at FROM pdj_carte`). `getCarte(slug)` inchangé.
- `app/api/carte/route.ts` : `GET` lit `?slug=` (défaut `bistrot_trefle` pour la
  compatibilité), valide le slug contre la liste des restaurants (sinon 400), renvoie la
  carte ou `null`. `POST` inchangé.
- Nouveau `lib/restaurants.ts` :

```ts
export type RestaurantType = "core" | "optionnel" | "lien";
export interface RestaurantDef {
  nom: string;        // champ `restaurant` des plats, clé des icônes et liens
  slug: string;       // restaurant_slug des cartes et des photos
  type: RestaurantType;
  carte: boolean;     // une carte est scrapée pour ce resto
}
export const RESTAURANTS: RestaurantDef[] = [
  { nom: "Le Bistrot Trèfle",  slug: "bistrot_trefle",  type: "core",      carte: true },
  { nom: "La Pause Gourmande", slug: "pause_gourmande", type: "core",      carte: false },
  { nom: "Le Truck Muche",     slug: "truck_muche",     type: "core",      carte: false },
  { nom: "Basilic n'Go",       slug: "basilic_ngo",     type: "optionnel", carte: true },
  { nom: "Dubble",             slug: "dubble",          type: "optionnel", carte: true },
  { nom: "La Mijote",          slug: "la_mijote",       type: "optionnel", carte: true },
  { nom: "Vival",              slug: "vival",           type: "lien",      carte: false },
];
export const SLUG_TO_RESTAURANT: Record<string, string>; // dérivé de RESTAURANTS
export function statutSansPlat(def: RestaurantDef, isFuture: boolean): string;
```

  `statutSansPlat` : core → « Fermé aujourd'hui » ; optionnel → « Pas de plat du jour
  aujourd'hui », ou « Plat du jour dévoilé le matin même » si `isFuture` ; lien → « Bar à
  salades sur place ». La table privée `SLUG_TO_RESTAURANT` de `lib/db.ts` est remplacée
  par l'import.

## 5. Pipeline Python

### Registre des cartes (`main.py`)

```python
CARTE_SOURCES = {
    "bistrot_trefle": bistrot_trefle.scrape_carte,
    "basilic_ngo":    basilic_ngo.scrape_carte,
    "dubble":         dubble.scrape_carte,
    "la_mijote":      la_mijote.scrape_carte,
}
```

Contrat commun : `scrape_carte() -> dict | None` renvoie `{"restaurant": str, "hash": str, …}`
avec **soit** `"sections": [{"nom": str, "plats": [{"plat": str, "prix": str}]}]` (source
structurée : Trèfle, Basilic), **soit** `"texte": str` (source brute : Dubble, La Mijote),
ou `None` (source KO ou carte vide), sans lever. La structuration LLM n'est **pas** faite
dans le scraper : le hash porte sur le texte brut, et c'est `_traiter_carte` qui appelle
`structurer_carte` seulement quand le hash a changé (sinon on paierait un appel LLM chaque
lundi pour rien).

`_traiter_carte(loop, slug, fn, force=False)` : scrape → `fetch_carte_hash(slug)` → si
identique et pas `force`, skip → sinon `sections = carte.get("sections") or
carte_agent.structurer_carte(carte["texte"], restaurant)` → `diet_agent.evaluate_carte(sections, restaurant)`
→ `publish_carte({"restaurant_slug": slug, "restaurant", "hash", "sections"})`. Chaque échec
est loggé et n'empêche pas les autres slugs.

`run_semaine` : boucle sur `CARTE_SOURCES` pour les slugs absents de
`state["cartes_traitees"]` ; ajoute le slug après traitement (même si skip).

### `run_state.py`
`"carte_traitee": False` → `"cartes_traitees": []`. Migration dans `load` : un ancien état
avec `carte_traitee: true` devient `cartes_traitees: ["bistrot_trefle"]`, `false` → `[]`.
Adapter `tests/test_run_state.py`.

### Nouvelle commande `python main.py cartes [slug] [--force]`
Traite toutes les cartes (ou une seule), hors état de run. `--force` ignore le hash stocké
(ré-évaluation). Sert au premier déploiement (ne pas attendre lundi) et au débogage.
Mettre à jour l'usage et `CLAUDE.md`.

### `agent/diet_agent.evaluate_carte(sections, restaurant)`
Ajout du paramètre `restaurant` (aujourd'hui « Le Bistrot Trèfle » en dur, utilisé dans les
plats envoyés au LLM et dans `_build_portion_calibration`). `RESTAURANT_PHOTO_SLUGS` et
`portion_agent` connaissent déjà les slugs des optionnels.

### Nouveau `agent/carte_agent.py`
`structurer_carte(texte: str, restaurant: str) -> list[dict]` : un appel Claude (même
`_call_claude` que le diet agent, sortie JSON) qui transforme le texte brut d'une carte en
`[{"nom", "plats": [{"plat", "prix"}]}]`. Consignes : garder entrées, plats, bowls,
sandwiches, salades, desserts ; **exclure** boissons, suppléments/protéines, formules et
menus composites, plats du jour, livraison ; prix au format `"9.90€"` (`"N/A"` si absent) ;
noms tels qu'écrits, sans description. Lève en cas de JSON invalide (l'appelant loggue et
ne publie pas). Fonction pure `_texte_hash(texte) -> str` (SHA-1 du texte normalisé :
espaces réduits, casse ignorée) partagée par Dubble et La Mijote.

### `scrapers/basilic_ngo.scrape_carte()`
Réutilise `_fetch_outlet_data`. Allowlist par **nom** de section normalisé
(`CARTE_SECTIONS = ["Salade", "Sandwich", "Poke Bowl", "Dessert"]`), dédoublonnage par nom
normalisé, prix `f"{price:.2f}€"`, produits à prix 0 ignorés, hash trié
`(section|nom normalisé|prix)` comme le Trèfle. Fonction pure `_extract_carte(data) -> list[dict]`
testée sur un JSON réduit.

### `scrapers/dubble.scrape_carte()`
`GET` du lien court (suivi des redirections, `Accept: application/pdf`), vérification
`Content-Type` PDF (ou en-tête `%PDF`), texte via **`pypdf`** (nouvelle dépendance,
`requirements.txt` + rebuild Docker ; vérifié : 4 762 caractères propres sur le PDF été 2026) :
`_pdf_texte(bytes) -> str`. Garde-fou : moins de 500 caractères → `None`.
Retour `{"restaurant": "Dubble", "hash": _texte_hash(texte), "texte": texte}`.

### `scrapers/la_mijote.scrape_carte()`
`GET menu.html` (même en-têtes no-cache), **sans** garde-fou `Last-Modified`.
`_texte_carte(html) -> str` : supprime d'abord les cinq divs `data-pgc-edit="plat_<jour>"`
(contenu simple `<b>…</b>`, sans div imbriqué, vérifié le 9 septembre) pour que le hash ne
bouge pas chaque semaine avec les plats du jour, puis retire scripts/styles/balises et
réduit les espaces. Le texte contient donc en-tête, formules, entrées, carte des Mijoteurs,
suggestions et desserts ; c'est le LLM qui écarte formules et bruit. Garde-fou : moins de
200 caractères → `None`. Retour `{"restaurant": "La Mijote", "hash": _texte_hash(texte), "texte": texte}`.

### `publish.py`
`fetch_carte_hash(slug: str) -> str | None` → `GET /api/carte?slug=<slug>`.

## 6. Frontend

### `app/CarteRestaurant.tsx` (ex-`CarteTrefle.tsx`)
Rendu des **sections seulement** (tri par note moyenne, `CartePlatCard`, `MacrosPanel`,
classes `mode-sportif` / `mode-goulaf`, `data-carte-section`). Plus de `<details>` externe
ni de titre. Fichier renommé, `CartePlatCard` inchangé.

### `app/CarteLazy.tsx` (client)
Props : `slug`, `titre` (« La carte du Trèfle », « La carte de Basilic n'Go »…), `icon`
(SVG string), `evaluatedAt`, `compact?` (résumé « Voir la carte » dans une card, vs
en-tête pleine largeur dans l'onglet). Un `<details>` ; au **premier** `toggle` ouvert :
`fetch('/api/carte?slug=' + slug)` → états « Chargement… » / « Carte indisponible » /
`<CarteRestaurant carte>`. Après rendu, `window.dispatchEvent(new Event("pdj:mode-refresh"))`.
Pas de cache autre que l'état du composant (la carte reste montée une fois chargée).

### `app/components/ClientScripts.tsx`
Une ligne : `window.addEventListener("pdj:mode-refresh", () => applyMode(localStorage.getItem("pdj-mode") || "sportif"))`
(avec nettoyage), pour que les notes du bon mode et le tri des sections s'appliquent aux
nœuds insérés après coup.

### `app/page.tsx`
- `Home` : `getCartesDisponibles()` en plus de `getWeekPdj` ; plus de `getCarte("bistrot_trefle")`.
- `ClosedCard` → `RestaurantSansPlatCard({ resto, isFuture, carte?: { evaluated_at } })` :
  même gabarit compact (bordure tirets), icône + nom + `OrderLinks`, ligne de statut
  `statutSansPlat(resto, isFuture)`, puis `CarteLazy compact` si `carte` fourni.
- `DayPanel` : après les `PlatCard`/`ComingSoonCard`, une `RestaurantSansPlatCard` pour
  chaque `RESTAURANTS` dont le `nom` n'est pas dans `pdj.plats` (ordre de `RESTAURANTS`).
- `WeekView` : l'onglet « La carte » est affiché dès qu'au moins une carte est disponible ;
  son panneau liste un `CarteLazy` (non compact) par carte disponible, dans l'ordre de
  `RESTAURANTS` (donc Trèfle en premier).

### `lib/icons.ts`
Icône Vival (panier / feuille) et `RESTAURANT_LINKS["Vival"] = [{ kind: "site", url: "https://magasins.vival.fr/fr/vival-montfavet", label: "Site" }]`.

### Autres
`app/aide-moi-a-choisir/page.tsx` : `SLUGS` peut dériver de `RESTAURANTS.filter(r => r.carte)`
(le quiz charge déjà plusieurs cartes ; les nouvelles entrent dans son pool de repli).
`CLAUDE.md` : décrire les cartes multi-restos, la commande `cartes`, Vival.

## 7. Flux de données

```
lundi (run_semaine) ou `main.py cartes`
  pour chaque slug de CARTE_SOURCES :
    scrape_carte() ─ Basilic : sections déterministes
                   └ Dubble / Mijote : texte brut → hash → structurer_carte (LLM)
    fetch_carte_hash(slug) ── identique ──→ skip
          │ différent
    evaluate_carte(sections, restaurant) → notes + macros Ciqual
    publish_carte → POST /api/carte → pdj_carte

home SSR : getWeekPdj + getCartesDisponibles
  card sans plat ── clic « Voir la carte » ──→ GET /api/carte?slug= ──→ CarteRestaurant
  onglet « La carte » : idem, un dépliant par carte
```

## 8. Gestion des erreurs

- Source de carte KO ou vide → log, slug suivant, carte précédente conservée en base.
- Structuration LLM invalide → exception attrapée dans `_traiter_carte`, rien publié.
- Évaluation KO → rien publié (comportement actuel).
- `GET /api/carte` KO côté pipeline → `stored_hash = None` → ré-évaluation (sûr).
- Slug inconnu sur l'API → 400. Carte absente → `null` → le dépliant affiche
  « Carte indisponible ».
- Front : aucune carte disponible → pas d'onglet « La carte », cards sans dépliant.

## 9. Tests

- **Python** (`cd plats-du-jour && source .venv/bin/activate && python -m pytest -q`) :
  - `test_basilic_ngo.py` : `_extract_carte` sur un JSON réduit (allowlist, doublons,
    prix 0 ignoré, format prix), hash insensible à l'ordre.
  - `test_dubble.py` : `_pdf_texte` sur un mini-PDF généré en test (ou fixture), garde-fou
    texte court, `scrape_carte` avec `structurer_carte` monkeypatché.
  - `test_la_mijote.py` : `_texte_carte` sur un HTML fixture (exclut `plat_<jour>`),
    `scrape_carte` avec LLM monkeypatché.
  - `test_carte_agent.py` : `_texte_hash` (espaces/casse), parsing JSON de la réponse mockée,
    exception si JSON invalide.
  - `test_run_state.py` : migration `carte_traitee` → `cartes_traitees`.
  - `test_main_cartes.py` : `_traiter_carte` hash identique → pas d'appel à `evaluate_carte` ;
    différent → évaluation + publication ; exception d'un slug n'empêche pas le suivant.
- **Front** (`npx vitest run`) : `lib/restaurants.test.ts` (`statutSansPlat`, ordre,
  `SLUG_TO_RESTAURANT` cohérent). Puis `npx tsc --noEmit` et `npm run build`.
- **Manuel** : `python main.py cartes basilic_ngo` en local, vérifier la carte sur la home
  (card + onglet), basculer Sportif/Goulaf après ouverture d'un dépliant.

## 10. Livraison

1. PR → merge `main` → Vercel (front + API).
2. VPS : rsync, `docker compose up -d --build` (dépendance `pypdf`).
3. Dans le conteneur : `python main.py cartes` pour peupler Basilic, Dubble et La Mijote
   sans attendre lundi. Vérifier `GET /api/carte?slug=dubble`.
4. Mettre à jour la mémoire `reference_restaurants_agroparc_scrapables.md` (cartes, Vival,
   Tholéan reporté).
