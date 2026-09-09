# Agroparc 3D v2 + nouveaux restaurants — design validé (2026-09-09)

Design validé par Thomas le 9 septembre au matin (« oui, ajoute La Mijote, et plus de
bâtiments » + « oui, redéploie le VPS »). **Rien n'est implémenté** : ce document
sert à reprendre le travail le soir même. Chemin bounded (pas de plan séparé) : TDD sur
les parties pures, puis PR sur `main`, puis rebuild Docker sur le VPS.

## 1. Retours de Thomas sur la v1 (en prod depuis PR #25)

1. Remettre plus de bâtiments (12 = « trop enlevé », 426 = « beaucoup trop »).
2. Le bâtiment de CBA est le bon ; celui qui lui est **parallèle** doit avoir la **même taille**.
3. Le truck doit être **entre les deux** (sud-ouest de CBA, nord-est du parallèle).
4. Ajouter des **bus** dans la circulation.
5. Ajouter les **autres restaurants au scraper** (pipeline complet, pas seulement la 3D).
6. Supprimer l'annonce « avion » dans le journal (l'avion lui-même reste).
7. En haut à gauche, uniquement **« Agroporc x Palantir »** (graphie de Thomas, à garder).

## 2. Décisions prises

| Sujet | Décision |
|---|---|
| Nombre de bâtiments | ~150 : tous ceux dont le centroïde est à moins de ~180 m de la boîte englobante des POI (un seul paramètre, à ajuster visuellement) |
| Bâtiment parallèle à CBA | hauteur forcée = celle de CBA (16,1 m) |
| Truck | garé au milieu des deux bâtiments, sur l'axe entre leurs façades |
| Bus | 3 ou 4 bus fil de fer (≈ 11 × 2,5 × 3 m) sur les axes classe M, arrêt 4 s aux arrêts OSM croisés |
| HUD | haut-gauche = « Agroporc x Palantir » seul ; bas-gauche (légende, aide, boutons) et bas-droite (date, journal) inchangés ; événement AVION supprimé |
| Restaurants ajoutés | **Basilic n'Go**, **Dubble**, **La Mijote** (cette dernière avec garde-fou fraîcheur) |
| Restaurants écartés | Les Deux J & Cie (plat du jour uniquement sur Facebook) et tous ceux du recensement (voir mémoire `reference_restaurants_agroparc_scrapables.md`) |
| Statut pipeline | nouveaux restos = **optionnels** : présents seulement les jours où ils ont un plat, pas de carte « Fermé aujourd'hui », leur absence ne rend pas le run `partial` ; une exception reste une erreur (repair team) |
| Jours futurs | aucun pour les optionnels (sources quotidiennes) |
| Livraison | PR → merge main → Vercel ; puis rsync + `docker compose up -d --build` sur le VPS (Thomas a dit oui) |

## 3. Sources vérifiées le 9 septembre

### Basilic n'Go — ObyPay (même API que le Trèfle, sans Playwright)

- Lien public : `https://go.obypay.com/api/cashless/hws/4o2y` → redirige vers
  `https://basilic-ngo.c.obypay.com/v-v6.16.2/i-E4mhlAmXsn-1/loading-page`.
- **OUTLET_ID = `i-E4mhlAmXsn-1`**, API :
  `https://order-api.obypay.com/api/cashless/outlets/i-E4mhlAmXsn-1?instance=null`
  (réponse ≈ 1,4 Mo, 99 produits, même structure que `scrapers/bistrot_trefle.py` :
  produit = dict avec `name`, `price`, `description` HTML, `section: {id, name}`).
- **SECTION_ID = `Nf8NZ3MTtZ`** (nom « Plat »), 2 produits, chacun présent en double
  (`menuMode: "order"` et `null`, ids différents) → dédoublonner sur la description normalisée :
  - « Plat du jour poisson » — `<b>Emietté de saumon, poêlée indienne et boulgour</b>` — 9.4
  - « Plat du jour viande 1 » — `<b>sauté de boeuf, légumes de saison et riz</b>` — 9.4
- Aussi : section « Menus » → « Menu plat du jour » 13.3 (plat + boisson + dessert). Non utilisé.
- Sortie proposée : `{"restaurant": "Basilic n'Go", "plat": [poisson, viande] (liste = options, comme le Truck), "prix": "9.40€"}`.
- **Aucune date dans l'API.** Garde-fou : cache `output/basilic_ngo_dernier.json` `{plats, depuis}` ;
  plats identiques depuis ≥ 3 jours ouvrés (≈ 4 jours calendaires) → retourner `None` + warning.
- Adresse : 775 route de l'Aérodrome. Nœud OSM « Basilic n’go » 4.8881547 / 43.9165709,
  `amenity=fast_food`, `cuisine=salad;sandwich`.
- Nom à utiliser partout (champ `restaurant`, POI 3D, icônes) : **`Basilic n'Go`**.

### Dubble — HTML rendu côté serveur (Wix SSR), sans Playwright

- URL : `https://www.dubble-food.com/restaurants/avignon-agroparc` (≈ 1,3 Mo).
  Vérifié : le texte rendu par Playwright est **identique** au HTML brut → `requests` suffit.
- Bloc « NOS RECETTES DU JOUR » : `<h2>` date en français (« mercredi 9 septembre »), puis
  6 paires `<p>nom</p><p>description</p>` : Hot Bowl, Hot Bowl Vegé, Wrap Toasté,
  Focaccia Toastée, Soupe maison, Gâteaux et Jus mix 25cl. Slot absent = description
  commençant par « pas de … aujourd'hui ». Le 09/09 les six étaient absents (mode salad bowl
  d'été : « aujourd'hui, je découvre le menu salad bowl ! 13,90€ »).
- Plus bas, des cartes `Chargement... ${recette} 10,90€` : gabarit JS d'un widget ; le prix
  du hot bowl est **10,90 €** (à coder en dur comme le Truck à 11.50€).
- Règles : la date du `<h2>` doit correspondre à aujourd'hui (jour + mois FR, comme
  `pause_gourmande._parse`), sinon `None`. Plat = Hot Bowl ; si Hot Bowl et Vegé présents →
  liste de 2 options ; si aucun hot bowl → `None` (« pas de plat du jour »).
- Parser pur `_parse(lines, today)` testable sur la fixture du 9 septembre (tout absent)
  et une fixture synthétique avec hot bowl.
- Adresse : 1077 route de l'Aérodrome. Nœud OSM « Dubble Food Avignon Agroparc »
  4.8903116 / 43.916144, tél +33 4 90 84 14 78. Liens utiles : carte
  `https://link.dubble-food.com/Carte-Avignon-Agroparc`, fidélité `https://dubble-food.zerosix.com/#/signin`.
- Nom à utiliser : **`Dubble`**.

### La Mijote — HTML statique, mais page figée

- URL : `https://la-mijote-avignon.fr/menu.html` (29 Ko). En-tête **`last-modified: Tue, 04 Nov 2025`**
  (index.html : février 2024). Menu affiché = celui de novembre 2025 (saucisse purée, wrap
  raclette…) : le site n'est plus mis à jour.
- Structure : `<div data-pgc-edit="plat_lundi">…</div>` … `plat_vendredi` (texte avec `<b>` sur
  l'intitulé). Le badge « Aujourd'hui » est posé par JS d'après le jour de la semaine
  (week-end → « Lundi prochain »). Prix « Plat du jour 15 € » dans la carte (formules 18/22 €).
- **Garde-fou décidé** : `HEAD` + `Last-Modified` ; si la page n'a pas changé depuis plus de
  **10 jours**, ou si l'en-tête manque → `None` + warning (donc rien publié tant qu'ils ne
  remettent pas le site à jour). Ne pas oublier `Cache-Control: no-cache` sur la requête.
- Adresse : 775 route de l'Aérodrome (même bâtiment que Basilic n'Go). Nœud OSM
  « La Mijote » 4.8886395 / 43.9164806, `opening_hours=Mo-Fr 12:00-14:00`, tél 04 90 02 03 97.
- Nom à utiliser : **`La Mijote`**.

### Les Deux J & Cie — écarté

Nœud OSM 4.8893057 / 43.9163848 = exactement les coordonnées déjà utilisées pour le POI
« La Pause Gourmande » (même groupe). Plat du jour 14,90 € nommé seulement sur Facebook.

## 4. Pipeline Python — modifications prévues

### `run_state.py`
- `CORE_LABELS = ["bistrot_trefle", "pause_gourmande", "truck_muche"]`,
  `OPTIONAL_LABELS = ["basilic_ngo", "dubble", "la_mijote"]`, `SCRAPER_LABELS = CORE + OPTIONAL`.
- `scrapes_ok(state)` → labels `ok` **avec `data`** (sert à l'éval et aux commentaires).
- `est_complet` : tous les CORE `ok` ; éval alignée sur `scrapes_ok` ; commentaires pour
  chaque label de `scrapes_ok` ; futurs comme avant.
- `resume` : `scrapes {ok_core}/3 (…erreurs…)` + segment optionnels
  (ex. `· optionnels basilic_ngo ✓, dubble —, la_mijote ✗ (stale)`). Adapter
  `tests/test_run_state.py` (le test `test_resume_synthese` attend `2/3`).

### `main.py`
- `_SCRAPE_FNS` : ajouter les trois (fonctions synchrones → `loop.run_in_executor`).
- `_step_scrape_jour` : pour un label optionnel, `r is None` → `{"ok": True, "data": None,
  "erreur": None}` + log « pas de plat du jour » (pas de repair team). Exception → comme aujourd'hui.
- `_step_eval` / `_step_commentaires` : déjà basés sur `scrapes_ok` → OK une fois `scrapes_ok` filtré sur `data`.
- `_step_futurs` : inchangé (rien pour les optionnels).
- Messages bot (`messages.py`) : ajouter une ligne par optionnel **uniquement s'il a un plat**
  dans `maj_message_jour` ; le récap semaine ne les mentionne pas.

### Nouveaux scrapers (`scrapers/`)
- `basilic_ngo.py` : copie du pattern ObyPay (`_fetch_outlet_data`, `_recurse` sur `SECTION_ID`),
  strip HTML des descriptions, dédoublonnage, garde-fou cache. Fonction pure
  `_extract_plats(data) -> list[str]` testée sur un échantillon JSON réduit.
- `dubble.py` : `requests.get`, texte sans balises → lignes, `_parse(lines, today)`.
- `la_mijote.py` : `HEAD` fraîcheur puis `GET`, regex sur `data-pgc-edit="plat_<jour>"`,
  `_parse(html, weekday)` pur.
- Tests : `tests/test_basilic_ngo.py`, `tests/test_dubble.py`, `tests/test_la_mijote.py`
  (fixtures minimales inline, comme `test_carte.py`). Lancer avec `.venv` activé :
  `cd plats-du-jour && python -m pytest -q`.

### Slugs à compléter (mécanique)
`agent/diet_agent.py` `RESTAURANT_PHOTO_SLUGS`, `agent/portion_agent.py`, texte du prompt
`agent/idee_agent.py` (« 3 restaurants »). Slugs : `basilic_ngo`, `dubble`, `la_mijote`.

## 5. Frontend — modifications prévues

- `lib/icons.ts` : icônes SVG (feuille pour Basilic n'Go, bol pour Dubble, marmite pour La
  Mijote) + `RESTAURANT_LINKS` (Basilic → `kind: "order"`, lien ObyPay ci-dessus ; Dubble →
  page restaurant ; La Mijote → `https://la-mijote-avignon.fr/menu.html`).
- `app/page.tsx` : `RESTAURANTS_ATTENDUS` **inchangé** (pas de ClosedCard pour les optionnels).
- Slugs photos : `lib/db.ts` `SLUG_TO_RESTAURANT`, `app/admin/photos/AdminPhotosClient.tsx`,
  `app/admin/photos/actions.ts`, `app/api/photos/route.ts`, `app/api/photos/recent-dishes/route.ts`,
  `app/aide-moi-a-choisir/page.tsx` `SLUGS`.
- `app/components/ClientScripts.tsx` `getPlatform` et `app/api/commander/route.ts` : laisser
  le défaut (« la plateforme » / « Restaurant non supporté »), fonctionnalité admin.
- `CLAUDE.md` : « 3 restaurants » → 6, mention des optionnels.

## 6. Scène 3D — modifications prévues

### Générateur à remettre dans le dépôt : `scripts/agroparc/build_scene.py`
Stdlib uniquement (urllib, json, math). Repart de `build_scene2.py` (copie dans
`/private/tmp/claude-501/-Users-toam-Documents-PDJ-Master/42d997d7-8f1b-43e5-95ec-4ec9717e99e8/scratchpad/`,
peut disparaître) :
- Repère : lon0 4.8885, lat0 43.9160, `MX = 111320·cos(lat0)`, `MY = 111132`,
  `x = (lon−lon0)·MX`, `z = −(lat−lat0)·MY`, 1 unité = 1 m.
- IGN : WFS `https://data.geopf.fr/wfs/ows`, `TYPENAMES=BDTOPO_V3:batiment`, GeoJSON,
  **BBOX en ordre lon,lat** (lat,lon renvoie 0). Zone 4.875–4.900 / 43.905–43.926 = 1398 bâtiments.
- Overpass (`https://overpass-api.de/api/interpreter`) : reprendre `overpass_ctx.ql`
  (voirie, parkings, arbres, eau, POI) **et ajouter** `node["highway"="bus_stop"]` ;
  bbox 43.911,4.880,43.921,4.896 (routes nommées Camille Claudel / Aérodrome / Traité de Rome sur
  43.905,4.875,43.926,4.900). Cache JSON dans `scripts/agroparc/.cache/` (à ajouter au `.gitignore`).
- Sélection bâtiments : centroïde à moins de `MARGE` m de la boîte des POI ; avec l'ancienne
  boîte (sans les nouveaux POI) : 90 m → 64, 120 m → 91, 150 m → 113 ; viser ~150 → ~180 m.
- Override hauteur : « le bâtiment contenant le point local (−175.7, 25.4) prend la hauteur du
  bâtiment de CBA » (plus robuste que l'index ou le `cleabs`).
- Truck : milieu entre la façade SO de CBA et la façade NE du parallèle ≈ **(−165, 7)** ;
  `truckRoad` = route carrossable la plus proche (calcul existant).
- Nouveaux champs `SceneData` : `busRoutes: Route[]` (voies classe M) et `busStops: Vec2[]`.

### Géométrie connue (repère local, indices de la scène **actuelle** `public/agroparc/scene.json`)
- CBA = bâtiment 10, 16,1 m, rectangle ≈ 64 × 10 m :
  `[[-188.2,-16.7],[-185.1,-26.8],[-124.6,-6.6],[-128.1,3.4]]`, centroïde (−162.8, −12.7).
- Parallèle = bâtiment 11, **4,0 m** dans BD TOPO, même empreinte décalée de (−13, +38) :
  `[[-201.2,21.2],[-197.9,11.3],[-137.5,31.8],[-140.8,41.6]]`, centroïde (−175.7, 25.4).
  Écart entre façades ≈ 31 m.
- Truck actuel (à déplacer) : (−113, −16), parking est.
- POI existants : cba (−162.8, −12.7) · trefle (55.2, 48.5) bât. 13,5 m · pause (64.6, −42.8)
  bât. 4,7 m · vival (200, −2.8) bât. 6,9 m.
- Nouveaux POI (indices du jeu complet de 426 bâtiments de la 1re passe, à recalculer) :
  - **Basilic n'Go** (−27.7, −63.4) → bâtiment contenant = #164 (9,3 m, centroïde (−6.1, −63.4)).
  - **La Mijote** (11.2, −53.4) → **même bâtiment #164** (deux libellés sur un bâtiment :
    décaler les ancres ou empiler les étiquettes).
  - **Dubble** (145.3, −16.0) → bâtiment #168 (7,7 m, centroïde (129.9, −26.1)).
- Arrêts de bus OSM proches (lat, lon) : Agroparc Centre 43.916274/4.887426 et 43.91622/4.887414 ;
  Salle de Montfavet 43.917007/4.888889 et 43.916845/4.888907 ; Demonque 43.913217/4.886974 ;
  Le Signal 43.917315/4.882305 ; Félons 43.914137/4.89288 ; Agrosciences 43.912008/4.890378 ;
  P+R Agroparc 43.909314/4.894111. Lignes : C3, 4, 22, 907, 920 (+ A4, M1, M2, V4, CA1).

### `lib/agroparc3d/scene.ts`
- Bus : géométrie `BoxGeometry(11, 3, 2.5)` en arêtes, couleur distincte (ex. `0xbfe7d6`),
  feux blancs avant / rouges arrière, vitesse ≈ 8 m/s, 3–4 bus sur `busRoutes` ; pour chaque
  bus, pré-calculer les abscisses `s` des arrêts à moins de 12 m de sa polyligne ; à
  l'approche (|s − s_arrêt| < 1 m) : pause 4 s puis redémarrage. Désactivés en `prefers-reduced-motion`.
- Supprimer `cb.onEvent("AVION", …)` (garder le vol).
- Étiquettes : deux POI sur le même bâtiment → décaler l'ancre du second en x de ±12 m.

### `app/components/Agroparc3D.tsx` / `.module.css`
- Header haut-gauche : ne garder que `<h1 className={styles.title}>Agroporc x Palantir</h1>`
  (supprimer eyebrow, sub, meta). Le reste inchangé.

## 7. Vérifications prévues
- `npx vitest run`, `npx tsc --noEmit`, `npm run build`.
- `cd plats-du-jour && source .venv/bin/activate && python -m pytest -q`.
- Scrapers en réel une fois : `python -c "from scrapers import basilic_ngo; print(basilic_ngo.scrape())"`
  (idem dubble → attendu `None` en septembre ; la_mijote → attendu `None` tant que la page est figée).
- Playwright headless sur `next dev` (venv `plats-du-jour/.venv`) : flags
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`,
  taper `myrtille`, attendre > 15 s (1re image lente), cliquer les libellés avec `force=True`,
  capture d'écran pour valider bâtiments / truck / bus / HUD.
- Après merge : poller `https://agroporc.vercel.app/agroparc/scene.json` jusqu'au nouveau contenu.

## 8. Déploiement VPS (validé par Thomas)
```bash
rsync -az --exclude '.env' --exclude '.venv' --exclude '__pycache__' --exclude output --exclude logs plats-du-jour/ vps:/opt/pdj/
ssh vps 'cd /opt/pdj && docker compose up -d --build'
ssh vps 'docker exec pdj-plats-du-jour-1 sh -c "echo ok | claude -p"'   # auth toujours OK ?
```
Le `--exclude '.env'` préserve `CLAUDE_CODE_OAUTH_TOKEN`. Le cron interne (7h30) prend les
nouveaux scrapers au prochain run ; on peut aussi déclencher `jour` depuis `/admin`.

## 9. Points ouverts
- Fraîcheur ObyPay de Basilic n'Go : à observer quelques jours (les photos produits datent de
  juin 2026, mais la description peut être éditée sans changer la photo).
- Dubble ne publiera rien avant le retour des hot bowls (automne) : normal, pas un bug.
- Mobile : la vue 3D reste inaccessible (pas de clavier pour « myrtille »).
