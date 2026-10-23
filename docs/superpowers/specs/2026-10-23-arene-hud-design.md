# Arène FPS : refonte du HUD, de la mini-map et du tableau des scores (contrat d'implémentation)

Statut : spec finale, prime sur `2026-10-22-arene-v2-design.md` §6.3 pour toute l'UI (le §13.4 de la v2 y renvoie).
Périmètre : `app/components/arene/` (HUD, lobby, réglages), `lib/fps/` (logique pure testée), et les ajouts de contrat que le HUD exige de `jeu.ts`, `protocole.ts` et `match.ts`.
Tout est en français (UI, erreurs, noms de domaine). Les maquettes ASCII sont indicatives ; les cotes en `u` et les règles écrites font foi.

Demande d'origine : « revoir le tableau de score (trop minime), retravailler le HUD, mieux intégrer la minimap, avoir nos munitions restantes ».

---

## 0. Arbitrages (ce que cette spec tranche)

Base retenue : la proposition « compétitif lisible » (4 zones fixes, mini-map empilée dans un coin, trois canaux de données, tableau riche). Idées greffées des deux autres : barre PV fantôme et trait de délai de régénération, chiffres de dégâts à double codage, pseudos toujours en `--ag-ink` (couleur serveur en pastille seulement), ligne « moi » épinglée, phrase de situation, hachure du bouclier, anneau de rechargement, stats envoyées seulement à qui ouvre Tab, rail de course à l'objectif, crochet `forcerHud`, tests de contraste, sélecteur de coin en radiogroup.

| Point | Décision |
|---|---|
| Réserve de munitions | La v2 n'en a pas (chargeur plein à chaque apparition). **Réserve infinie en v2.** Le contrat porte `reserve` (−1 = infinie, affichée « RÉSERVE ∞ » avec `aria-label="réserve illimitée"`). Passer à une réserve finie ne demande que `reserve ≥ 0` et un 5e champ de `slots` (§3.2). Ce que le joueur voit en permanence : chargeur courant en grand, taille du chargeur, pips de balles, chargeur de chaque slot. |
| Cadeau d'Elsa : automatique ou touche E | **Automatique** (v2 §2.7 : premier joueur à moins de 2,5 m, aucun message client). L'invite est « Avance vers Elsa (12 m) », sans touche. Le « E : prendre le cadeau » de la v2 §6.3 est abandonné. |
| Durée d'une offre | 40 s (v2 §2.7), jamais codée en dur : la jauge du bandeau lit `offre.finT` du serveur. |
| Killcam | 2,5 s de rejeu + 1,5 s de carte (`KILLCAM.rejeuMs`, `carteMs`), réapparition à 4 s. Pendant toute la killcam le **HUD de combat est masqué** (`hidden`), pas grisé : plus aucun texte à faible contraste. |
| Opacité | Jamais d'opacité pour atténuer du texte (règle du projet). Lunette : mini-map et fil restent à pleine opacité. |
| Fond des plaques | Un seul niveau : `--ag-hud-fond` à 0,86 (texte < 24u). `--ag-hud-fond-fort` à 0,94 pour le tableau et la carte du tueur. Pas de fond « léger ». |
| Couleur d'un joueur | Jamais utilisée en texte : pastille (carrée 10u) à côté d'un pseudo en `--ag-ink`. Valable pour fil, tableau, podium, carte du tueur, sièges, mini-map. |
| Marqueur de touche | Uniquement **confirmé par le serveur** (v2 §13.2 : le marqueur ne part plus au tir). Pas de tick local estimé. Latence d'affichage = celle du réseau + une image. |
| Dispersion | Supprimée par la v2 §13.1 : viseur **statique**, `dispersion` et `ecartViseurPx` disparaissent du HUD. |
| Stats du tableau | Compteurs serveur dans `Salle`. Message `scores` envoyé **seulement** au client qui maintient Tab (réponse immédiate à l'appui puis 1 Hz). Livraison en deux phases (§8.6). |
| Alliés | Mode « chacun pour soi » : pas d'alliés, pas de champ `equipe` (code mort). |
| Boussole permanente | Non retenue (doublon de la mini-map). Le bandeau d'Elsa porte sa propre flèche. |
| Mini-map défaut | Haut-gauche, « suit la vue », 100 m de demi-largeur. Quatre coins + masquée, réglage mémorisé `pdj-fps-minimap`. |
| Échos de tir | Activés (`ECHOS_TIR = true`, une constante les coupe) : choix de gameplay à valider, signalé en §14. |

---

## 1. Principes, grille, hiérarchie

### 1.1 Principes

1. **Quatre zones fixes.** Match en haut au centre, vie en bas à gauche, armes en bas à droite, éliminations en haut à droite. Les chiffres vitaux (PV, chargeur) ne changent **jamais de place**, quel que soit le coin de la mini-map : la mini-map s'empile du côté de l'écran, vers l'intérieur.
2. **Le centre reste libre** (rayon 12 % de la hauteur autour du viseur) : seuls y vivent viseur, marqueurs, chiffres de dégâts, invites d'interaction.
3. **Pas de couleur seule.** Chaque état coloré est doublé d'un texte ou d'une forme.
4. **Tout ce qui varie à 60 Hz sort de React** (§3.1).
5. **Langue visuelle de la vue Palantir** : fil de fer, Chakra Petch (libellés, titres) et IBM Plex Mono (chiffres), ambre = « à moi / actif », cyan = information neutre, rouge = danger réel, doré = tête, bleu = bouclier. Pas de décor inutile (pas de balayage radar, pas de point REC, pas de clip-path « arcade »).

### 1.2 Échelle

Toutes les cotes sont en `u` : `--u: calc(clamp(0.8px, min(0.0926vh, 0.0521vw), 1.25px) * var(--echelle-hud))`, `--echelle-hud` valant 0,9 / 1 / 1,15 (réglage, §13). À 1920×1080 : 1 px ; à 1366×768 et 1280×720 : 0,8 px (plancher) ; à 2560×1440 : 1,25 px. Le texte ne descend jamais sous 11 px réels : `font-size: max(11px, calc(N * var(--u)))`. Marge d'écran : `32u`. Espace entre blocs : `12u`.

### 1.3 Zones à pied (tailles à 1080 puis à 768 avec u = 0,8)

| Zone | Ancrage | 1080 | 768 |
|---|---|---|---|
| Mini-map (taille M) | coin choisi | 264×264 + légende 24 | 211×211 + 19 |
| Barre de match | haut centre, y = 32u | 560×76 | 448×61 |
| Fil d'éliminations | haut-droite (sous la mini-map si elle y est) | 340 max, lignes de 28 | 272, lignes de 22 |
| Bandeau Elsa | haut centre, y = 124u | 560×92 (4 s) puis puce 36 | 448×74 puis 29 |
| Viseur, marqueurs | centre | n/a | n/a |
| Invite d'interaction | centre, y = 62 % | 1 ligne de 28 | 1 ligne de 22 |
| Bloc vie | bas-gauche | 264×170 | 211×136 |
| Bloc armes | bas-droite | 320×250 | 256×200 |
| Vitesse et état | bas centre | 1 ligne | 1 ligne |
| Bloc véhicule | bas centre | 420×150 | 336×120 |

### 1.4 Hiérarchie de lecture (du plus lu au moins lu)

1. Viseur et marqueur de touche confirmé.
2. Chargeur courant (64u) et PV (64u).
3. Bouclier, minuterie (40u).
4. Mini-map.
5. Slots d'armes, rang, fil d'éliminations, annonces.
6. Vitesse, ping, aides de touches (couleur `--ag-ink-dim`, jamais d'opacité).

---

## 2. Tokens, typographie, contraste

### 2.1 Tokens

Les trois premiers existent déjà (lot 0 de la v2 les ajoute à `.root` de `Agroparc3D.module.css`). Ajouter les autres au même endroit ; supprimer de `HudArene.module.css` les couleurs en dur (`--danger: #ff7a6b; --tete: #ffd166`, `#ffb3a8`, tous les `rgba(...)`).

```css
/* app/components/Agroparc3D.module.css, bloc .root */
--ag-danger: #ff7a6b;                 /* PV bas, chargeur vide, kill, tir entendu */
--ag-shield: #7fb2ff;                 /* bouclier */
--ag-ok: #6ff0a8;                     /* soin, régénération, ping bon */
--ag-tete: #ffd166;                   /* tir à la tête */
--ag-hud-fond: rgba(4, 6, 10, 0.86);  /* toute plaque qui porte du texte < 24u */
--ag-hud-fond-fort: rgba(4, 6, 10, 0.94); /* tableau, carte du tueur, fin de match */
--ag-cadre: var(--ag-ink-dim);        /* contours ESSENTIELS (mini-map, plaques) */
```
`--ag-line-strong` (43657a) reste réservé aux filets décoratifs et aux pistes de jauge doublées d'un texte : sur la plaque au pire cas il ne fait que 2,35:1.

### 2.2 Contraste, pire cas (calculé : pixel blanc derrière la plaque à 0,86)

Couleur effective de la plaque au pire cas : rgb(39, 41, 44).

| Token | Sur la plaque .86 | Sur la plaque .94 |
|---|---|---|
| `--ag-ink` | 12,7 | 14,4 |
| `--ag-white` | 13,5 | 15,3 |
| `--ag-cyan` | 10,8 | 12,2 |
| `--ag-ok` | 10,2 | 11,6 |
| `--ag-tete` | 10,1 | 11,5 |
| `--ag-amber` | 8,2 | 9,3 |
| `--ag-shield` | 6,8 | 7,6 |
| `--ag-ink-dim` | 6,1 | 6,9 |
| `--ag-danger` | 5,7 | 6,5 |

Règles : texte < 24u toujours sur `--ag-hud-fond` ou plus ; les chiffres de 40u et plus gardent en plus le `text-shadow` actuel ; les contours essentiels utilisent `--ag-cadre` ; `hud-contraste.test.ts` (§15) recalcule ces rapports à partir du CSS et échoue sous 4,5:1 (texte) ou si un token HUD est redéfini en dur dans un module.

### 2.3 Typographie

Chakra Petch (`--ag-display`) pour libellés et titres : 600–700, capitales, `letter-spacing: .14em`, 11–14u. IBM Plex Mono (`--ag-mono`) pour tous les chiffres : `font-variant-numeric: tabular-nums; font-feature-settings: "zero"`. Graisses déjà chargées (400, 500), aucune police ajoutée. Les gros compteurs (PV, chargeur, minuterie) sont en Plex Mono 500 (les chiffres tabulaires de Chakra Petch ne sont pas garantis).

| Rôle | Taille | Police |
|---|---|---|
| `num-xl` : PV, chargeur | 64u | Plex Mono 500 |
| `num-l` : minuterie, km/h | 40u | Plex Mono 500 |
| `num-m` : K/M, vitesse, taille du chargeur | 22u | Plex Mono 500 |
| `num-s` : tableau, fil | 14u | Plex Mono 400 |
| `label` | 11–12u | Chakra Petch 600, capitales |
| `titre` : « ÉLIMINÉ », « MATCH TERMINÉ » | 32u | Chakra Petch 700 |
| Chiffre de dégâts | 24u | Plex Mono 500 |

Formats : `Intl.NumberFormat("fr-FR")`, virgule décimale, espace insécable avant m, s, km/h, %.

---

## 3. Données : transport et contrats

### 3.1 Trois canaux

| Canal | Contenu | Fréquence | Mécanisme |
|---|---|---|---|
| `HudEtat` (React) | scalaires discrets | ≤ 15 Hz, seulement sur changement (`emettreHud` compare champ par champ) | `cb.hud(e)` |
| `HudLive` (hors React) | valeurs continues | 60 Hz | objet mutable `JeuHandle.live` lu en rAF par `useHudLive`, qui écrit des variables CSS **sur l'élément concerné** (pas sur la racine du HUD, pour ne pas recalculer tout le sous-arbre) |
| `RadarFrame` (hors React) | mini-map, flèche d'Elsa | rAF (mini-map), lue à la demande | `JeuHandle.radar()` remplit et renvoie **le même objet** (tableaux préalloués, zéro allocation par image) |
| `scores` (réseau) | stats du tableau | à l'appui sur Tab puis 1 Hz | message serveur (§8.6) |

Le callback `repere` à 10 Hz de la v2 (§5.18) est remplacé par `radar()` : trop lent pour une carte qui tourne avec le regard. `JeuCallbacks.repere` reste optionnel et inutilisé.

### 3.2 `HudEtat` (`lib/fps/jeu-types.ts`) : ajouts et retraits

Ajouts (tous scalaires) :

| Champ | Type | Rôle | Fréquence de changement |
|---|---|---|---|
| `reserve` | number, −1 = infinie | réserve de l'arme en main | changement d'arme |
| `degainage` | boolean | dégainage en cours (350 ms) : la ligne du slot se remplit | 2 changements par changement d'arme |
| `protegeRestant` | number (s, pas de 0,5) | « PROTÉGÉ 2,5 s » | ≤ 2 Hz, seulement protégé |
| `zoomX` | number (entier) | « ×4 » en lunette | changement de visée |
| `distanceVisee` | number (m entier, −1 = rien) | télémétrie de lunette | ≤ 10 Hz, **seulement en lunette** (un rayon par image) |
| `vehiculeId` | number, −1 hors véhicule | choisir la ligne de `sieges: InfoVehicule[]` | entrée/sortie de véhicule |

Si la réserve devient finie : `slots` gagne un 5e champ par arme, `"principale:fusil_assaut:23:30:90|secondaire:pistolet:12:12:48|…"` (−1 = infinie). `parseSlots` (§15) tolère 4 ou 5 champs.

Retraits (ils changent à chaque image et re-rendraient tout le HUD à 15 Hz) : `recharge` (number), `vitesse`, `vitesseKmh`, `dispersion`, `fov` quittent `HudEtat`. Remplacements :
* `recharge: boolean` (rechargement en cours) reste dans `HudEtat` ; la progression 0..1 passe dans `HudLive`.
* `dispersion` et `fov` disparaissent (viseur statique, v2 §13.1 ; `zoomX` remplace le calcul de zoom).
* `vitesse`, `vitesseKmh`, `recharge` (0..1) et `regenDelai` (0..1, avancement des 5 s sans dégâts) vont dans `HudLive`.

Pas de `kills`, `morts`, `serie`, `rang` dans `HudEtat` : ils existent déjà dans la présence (`JoueurPublic`) et un doublon se désynchroniserait. Le rang se calcule dans `classement.ts` (§8).

```ts
// lib/fps/jeu-types.ts
export interface HudLive {
  /** 0..1, 0 = pas de rechargement */
  recharge: number;
  /** m/s horizontaux */
  vitesse: number;
  /** km/h, 0 hors véhicule */
  vitesseKmh: number;
  /** 0..1 : écoulé du délai de 5 s avant régénération ; 1 = régénération en cours ou PV pleins */
  regenDelai: number;
}
// JeuHandle gagne :  live: HudLive;   radar(): RadarFrame;
```

### 3.3 `RadarFrame` (`lib/fps/radar.ts`, pur ; `jeu.ts` le remplit)

```ts
export interface RadarJoueur {
  id: string; x: number; z: number; cap: number; couleur: string;
  /** à pied | en voiture | mort (croix 3 s) */
  etat: "pied" | "voiture" | "mort";
  /** 0..1 : vu à l'écran (pas de wallhack), s'estompe sur 0,6 s */
  vu: number;
  /** âge en s depuis la mort si etat === "mort" */
  age: number;
}
export interface RadarVoiture { id: number; x: number; z: number; cap: number; occupants: number; places: number; moi: boolean }
export interface RadarEcho { x: number; z: number; age: number }
export interface RadarFrame {
  /** moi */
  x: number; z: number; lacet: number;
  /** cap de la voiture si je suis assis, sinon NaN */
  capVehicule: number;
  vitesse: number;
  joueurs: RadarJoueur[]; nJoueurs: number;           // préalloué à 16
  voituresPnj: Float32Array; nPnj: number;             // [x, z, cap] × 12
  voitures: RadarVoiture[]; nVoitures: number;         // préalloué à 6
  echos: RadarEcho[]; nEchos: number;                  // préalloué à 8
  /** null hors offre ; angle relatif à ma vue (0 = devant, + = droite), distance en m */
  elsa: { x: number; z: number; genre: "soin" | "arme"; finT: number; angle: number; distance: number } | null;
  /** Elsa présente même sans offre (losange fixe) */
  elsaPos: { x: number; z: number };
}
```
Règles de remplissage :
* **Visibilité sans wallhack** : un joueur est `vu > 0` s'il passe `dansChampDeVue` et `ligneDeVue` de `visibilite.ts` (le test existant des pseudos, mais **sans plafond de distance** : la mini-map est bornée par son rayon), ou s'il occupe mon véhicule. `vu` est lissé 0,6 s en descente. Un joueur non vu n'est jamais dessiné.
* **Voitures PNJ** : positions calculées avec `circulation.ts` à l'horloge serveur (`maintenantServeur()`), à moins de 100 m seulement.
* **Voitures conduisibles** : issues de l'`InterpolateurVehicules` ; `occupants` lu dans `sieges`.
* **Échos de tir** : tout tir (`tir` diffusé) à moins de 70 m **dont le tireur n'est pas `vu`**, position arrondie à 8 m, durée 1,2 s. Constante `ECHOS_TIR`.
* `elsa.angle` et `distance` sont calculés ici (fonction pure `repereElsa(frame)`), ce qui remplace `RepereElsa`.

### 3.4 Événements (`JeuEvenement`)

Nouveau : `{ type: "confirme"; cible: string; degats: number; absorbe: number; zone: Zone; tue: boolean }`, émis à la réception d'un `degats` dont `par === monId` (et `tue` si le `mort` correspondant suit dans la même trame). **C'est la seule source des marqueurs et chiffres de touche.** `touche` (estimation locale) reste émis pour les tests existants mais le HUD l'ignore.

Protocole : champ optionnel `absorbe?: number` sur le message `degats` (dégâts pris par le bouclier ; absent = 0). Un client plus ancien l'ignore.

### 3.5 Compteurs et messages serveur (stats du tableau)

Dans `Salle` (`match.ts`, pur, lot S1), par joueur : `tirs` (tirs validés, couteau exclu), `touches` (tirs ayant touché au moins un joueur, un tir de pompe compte pour un), `tetes` (touches dont au moins un plomb à la tête), `degats` (PV + bouclier infligés, hors dégâts de véhicule), `serie` / `serieMax` (kills sans mourir), `killsParArme` (donc `armeFav`), `vivant`, `vehicule`. Remis à zéro à chaque match.

```ts
// lib/fps/protocole.ts (champs et messages ajoutés ; tout champ ajouté à un message client est optionnel)
export interface LigneStats {
  id: string; serie: number; serieMax: number; tirs: number; touches: number; tetes: number;
  degats: number; armeFav: ArmeId | null; vivant: boolean; vehicule: boolean;
}
// client -> serveur
{ t: "vueScores"; ouvert: boolean }          // à l'appui / relâchement de Tab (anti-rafale : 1 par 250 ms)
// serveur -> client
{ t: "scores"; lignes: LigneStats[] }        // réponse IMMÉDIATE à ouvert:true, puis 1 Hz, seulement aux clients ouverts
// JoueurPublic.serie?: number               // diffusé avec la présence (déjà émise à chaque kill)
// LigneClassement gagne les mêmes champs, optionnels : le message `match` de fin les porte tous
```
Coût : 16 lignes × ≈ 90 octets × 1 Hz ≈ 1,4 Ko/s, uniquement par client qui tient Tab. Le serveur ignore `vueScores` d'un client non en jeu. À la déconnexion, l'état « ouvert » est oublié.
Le client garde le dernier `scores` reçu (`statsRef`) : à la réouverture, le tableau s'affiche **tout de suite** avec les dernières valeurs connues, puis se met à jour ; seule la toute première ouverture d'un match montre « — » une fraction de seconde.

### 3.6 `useArene` / `PropsHudArene`

Ajouts à `UseArene` (contrats.ts) : `stats: Map<string, LigneStats>` (à jour sur `scores`), `statsRef`, `demanderScores(ouvert: boolean)`. `PropsHudArene` gagne : `stats`, `surVueScores(ouvert)`, `live: HudLive` (ref stable), `radar(): RadarFrame`, `reglagesHud`/`surReglagesHud`. L'hôte `Agroparc3D.tsx` masque déjà `hudTl` et « Sortie » quand `enArene` (lignes 426 et 466) : le coin haut-droite est libre.

---

## 4. Mini-map

### 4.1 Rendu

* **Forme** : carré de `--mm` (S = 208u, M = 264u, L = 320u), cadre `2px solid var(--ag-cadre)`, fond `--ag-hud-fond`, coin intérieur biseauté de 10u. Sous 700 px de hauteur de fenêtre, taille S d'office. La légende (« 100 m · [M] grande carte » et nom de zone « Rond-point », « Truck Muche », 11u) est sous la carte, sur plaque.
* **Une seule couche statique** (`lib/fps/minimap-couche.ts`) : canvas hors écran construit une fois à l'entrée en arène (idle callback), à `min(1,5 px/m, 8 Mpx / aire)`, sur la zone jouable = boîte englobante des bâtiments de `scene.json` + marge 60 m (≈ 900×600 m, soit ≈ 1350×900 px, ≈ 4,9 Mo RGBA). Contient : eau (`--ag-cyan` à 14 %), routes (classe M et R : 3 px `--ag-line-strong`, S : 2 px, F : 1 px seulement si rayon ≤ 100 m), bâtiments (remplissage `--ag-ink` à 10 %, contour 1 px `--ag-ink-dim`), parkings (contour fin), POI restaurants (picto + nom court en 11u). Couleurs lues une fois via `getComputedStyle` (`PaletteCarte`). Libérée (`canvas.width = 0`) à la sortie de l'arène, avec le renderer.
* **Boucle** (`MiniMap.tsx`, canvas 2D, DPR plafonné à 2) : à chaque rAF, `drawImage` de la couche avec translation + rotation + échelle, clip dans le carré, puis les marqueurs dynamiques. Aucun re-rendu React. **Adaptatif** : si la moyenne glissante du temps de dessin dépasse 4 ms sur 60 images, la carte passe à 30 Hz (jamais en dessous) et repasse à 60 Hz après 120 images sous 2 ms.
* **Hors zone jouable** : fond uni `--ag-ground`.

### 4.2 Projection (`lib/fps/minimap.ts`, pur)

Repère monde : x vers l'est, z vers le sud (le nord est −z), conforme à `scene.json` et à `directionRegard` (devant = (−sin ψ, −cos ψ)). Soit `dx = x − px`, `dz = z − pz`, ψ le lacet (ou le cap du véhicule), `k = (taille / 2) / rayonM` en px/m :

* Mode **regard** (défaut) : `sx = k·(dx·cosψ − dz·sinψ)` ; `sy = k·(dx·sinψ + dz·cosψ)` ; point d'écran `(taille/2 + sx, ancre·taille + sy)` avec `ancre = 0,58` (je suis placé à 58 % de la hauteur pour voir plus loin devant).
* Mode **nord** : `sx = k·dx` ; `sy = k·dz` ; je suis au centre (`ancre = 0,5`).
* Mon marqueur : triangle blanc 11u, cône de vue de 90° (dégradé `--ag-cyan` à 18 %) sur 40 m. En mode regard le triangle pointe vers le haut ; en mode nord, vers `(−sinψ, −cosψ)`.
* Un « N » orbite sur le bord (position = projection du vecteur nord à `0,46·taille`).
* **Rayon** : 60 / 100 / 160 m de demi-largeur (réglage), 100 par défaut. En voiture : `rayon = base × (1 + 0,6·min(vitesse, 24) / 24)` lissé par `lissage(k, dt)` de `vue.ts`, et l'orientation « regard » suit le **cap du véhicule** (`capVehicule`).
* Orientation par défaut : « regard », sauf `prefers-reduced-motion` sans choix mémorisé (alors « nord »). La rotation de la carte reste (ce n'est pas une animation décorative) tant que le joueur n'a pas choisi « nord ».
* Fonctions exportées : `versCarte(vue, x, z)`, `rayonAuto(base, vitesse)`, `estDansCarte(px, py, taille, marge)`, `chevronBord(px, py, taille, marge) → {x, y, angle}`, `capEcran(mode, lacet)`, `arrondi(v, pas)` (échos à 8 m), `ZONE_CARTE(scene)` (bbox + marge).

### 4.3 Contenu

| Élément | Marqueur | Règle |
|---|---|---|
| Moi | triangle blanc + cône | toujours |
| Joueur vu | disque 7u de sa couleur serveur, contour blanc 1,5 px, trait de cap 6u | `vu > 0` seulement (pas de wallhack) ; pas de pseudo |
| Joueur en voiture | carré au lieu du disque | |
| Joueur mort | croix | 3 s puis disparaît |
| Tir entendu | anneau `--ag-danger` qui s'élargit 1,2 s | cf. §3.3 |
| Elsa | losange ambre 10u | toujours, fixe |
| Cadeau d'Elsa | anneau ambre pulsant (1,2 s) + croix (soin) ou étoile (arme) | pendant l'offre ; hors cadre : chevron collé au bord avec la distance arrondie à 10 m |
| Voiture PNJ | rectangle 3×5u hachuré `--ag-ink-dim`, contour `--ag-danger` | à moins de 100 m |
| Voiture conduisible | rectangle 5×9u contour `--ag-cyan` + 4 points de sièges (plein = occupé) ; « 2/4 » à moins de 40 m | à moins de 160 m ; la mienne pleine ambre |

Le canvas porte `role="img"` et un `aria-label` générique (« Mini-carte, rayon 100 m ») ; la légende texte est lue. L'information indispensable (Elsa, distance) existe aussi en texte dans le bandeau d'Elsa.

### 4.4 Grande carte

Touche **M maintenue** (action `carte`, rebindable) : `GrandeCarte.tsx` affiche la zone entière en 600u, nord en haut, grille de 100 m, étiquettes de POI, sur son propre canvas ; son rAF ne tourne que tant que la carte est visible. Relâcher revient à la mini-map. Inactive pendant la killcam et la pause.

### 4.5 Position et réglage

* Coins : `hg` (défaut), `hd`, `bg`, `bd`, plus `off` (masquée). Les deux coins demandés (haut-droite, bas-gauche) sont couverts.
* **Où se règle** : (1) menu pause (Échap), section « Interface » de `ReglageInterface.tsx`, **au-dessus** de `ReglageTouches` ; (2) lobby `Arene.tsx` (même composant, repliable) ; (3) action rebindable `minimapCoin` (non assignée par défaut) qui fait défiler les coins avec un toast « Mini-carte : bas-gauche » ; (4) première partie : une ligne dans l'aide des commandes, « Mini-carte : Échap > Interface pour la déplacer ».
* **Sélecteur de coin** (`SelecteurCoin.tsx`) : schéma d'écran 16:9 de 96×54 px avec quatre boutons de coin + un bouton « Masquée », cible ≥ 40 px, `role="radiogroup"`, flèches clavier, anneau de focus blanc 2 px. Autres réglages : taille S/M/L (radios), orientation regard/nord, rayon 60/100/160, taille de l'interface 90/100/115 %, effets auto/réduits.
* Effet immédiat ; la mini-map reste nette sous le voile de pause (le menu pause l'autorise pour permettre de juger le réglage).
* **Mémorisation** : `localStorage` clé `pdj-fps-minimap`, JSON versionné, toujours dans `try/catch` :
  ```json
  { "v": 1, "coin": "hg", "taille": "m", "orientation": "regard", "rayon": 100 }
  ```
  `orientation` absent = « décidé par `prefers-reduced-motion` ». Toute valeur hors liste, version inconnue ou JSON illisible → défauts sûrs, sans erreur. Les réglages d'ensemble (`echelle`, `effets`) sont dans `pdj-fps-hud` : `{ "v": 1, "echelle": 1, "effets": "auto" }`. Validation pure dans `lib/fps/reglages-hud.ts`.

### 4.6 Empilement des coins (`CoinHud.tsx`)

Un coin est une colonne flex de largeur `max(264u, --mm)`. Du bord de l'écran vers l'intérieur :

| Coin | Contenu (haut → bas) |
|---|---|
| haut-gauche | mini-map (défaut) |
| haut-droite | mini-map si choisie, puis fil d'éliminations |
| bas-gauche | mini-map si choisie, puis **bloc vie ancré en bas** |
| bas-droite | mini-map si choisie, puis **bloc armes ancré en bas** |

Le bandeau de match, le bandeau Elsa, le bloc véhicule et l'invite sont au centre et ne bougent pas. Vérification de non-chevauchement (test + captures) pour les cinq positions, à 1920×1080, 1366×768 et 1280×720 ; le bloc véhicule (420u) tient entre vie et armes jusqu'à 1280 px de large.

---

## 5. Maquettes

Légende : `[#]` pastille de couleur ; `|||` jauge ; `o` tête (◎) ; `<>` Elsa ; `[=>]` voiture. Une colonne vaut environ 20 px à 1920. Les textes sont abrégés ; les cotes de §1.3 font foi.

### 5.1 En jeu, à pied (1920×1080)

```
+--------------------------------------------------------------------------------------------------+
|  +- MINI-MAP -----+         +----------------------------------+              Lea [Fusil] Max     |
|  |      :         |         | #3 VOUS 12K    4:32   TETE Lea 18K |        VOUS [Pistolet @] Zoe < |
|  |   :  o    ##   |         |          PREMIER A 30 K          |             Zoe [Railgun] Tom    |
|  |   : /^\        |         | [##################|-----------] |                                  |
|  |==-==-==-==-==-=|         +----------------------------------+                                  |
|  |   :        o   |                                                                                |
|  | ## :           |                                                                                |
|  +----------------+                                                                                |
|  100 m . [M] carte                                                                                 |
|                                                    [34]                                            |
|                                                -- + --                                            |
|                                                                                                    |
|                                                                        FUSIL D'ASSAUT              |
|                                                                        23 /30      RESERVE inf     |
|                                                                        ||||||||||||||||||........ |
|                                                                       > [1] FUSIL        23/30    |
|                                                                         [2] PISTOLET     12/12    |
|  [ACCROUPI] [PROTEGE 2,5 s]                                             [3] COUTEAU    +30 %      |
|  87 PV     REGENERATION +20/s                                           [4] RAILGUN        4      |
|  [########|########|########|##...]                                                              |
|  BOUCLIER 62                                                                                       |
|  [//////|//////|//....|......]                           COURSE 11 m/s                             |
+--------------------------------------------------------------------------------------------------+
```
Détail des blocs :

* **Barre de match** (560×76u), trois cellules : gauche = mon rang (« 3e ») et mes kills ; centre = minuterie `num-l` et « PREMIER À 30 », jauge de progression du leader vers l'objectif avec une encoche à mon score ; droite = leader (« ★ Lea 18 K ») ou, si je mène, « TU MÈNES +3 » (écart sur le deuxième). Minuterie ambre sous 60 s, rouge sous 10 s (texte « 10 s » ajouté, pas d'animation). Quand quelqu'un est à 3 kills ou moins de l'objectif : libellé « POINT DE MATCH » en ambre. Série de 3 kills ou plus : puce texte « SÉRIE ×3 » sous la cellule gauche. À 1366 la cellule droite perd « TÊTE » et garde « ★ Lea 18 K ».
* **Bloc vie** : PV en `num-xl` + « PV ». Jauge continue de 10u en 10 segments (un par 10 PV) ; cyan au-dessus de 50, ambre de 26 à 50, `--ag-danger` à 25 ou moins (hachures diagonales + libellé « PV BAS » à 30 ou moins). **Barre fantôme** plus claire qui reste 600 ms derrière la barre quand je perds des PV. **Trait de délai** de 2u sous la barre qui se remplit pendant les 5 s sans dégâts (`HudLive.regenDelai`), puis libellé « RÉGÉNÉRATION +20/s » en `--ag-ok` et un « + » qui bat à 1 Hz. **Bouclier** : 4 cellules de 25 (hachure `repeating-linear-gradient` en `--ag-shield`), écrit « BOUCLIER 62 » ; la ligne disparaît à 0 (flash de 240 ms à la rupture et annonce « Bouclier détruit »). **Puces d'état** (texte, une rangée, masquée si vide) dans l'ordre : ACCROUPI, GLISSE, WALL-RUN, PROTÉGÉ 2,5 s.
* **Bloc armes** (320×250u) : nom de l'arme ; **munitions fixes** : chargeur en `num-xl` (« 23 »), « / 30 » en `num-m`, réserve à droite (« RÉSERVE ∞ ») ; **pips de balles** : un cran de 6×12u par balle jusqu'à 30, au-delà une barre proportionnelle (un cran pour 5 balles quand le chargeur dépasse 40 : minigun) ; rangée des slots `> [1] FUSIL 23/30`, `[2] PISTOLET 12/12`, `[3] COUTEAU +30 %` (pastille texte « vitesse +30 % »), `[4] RAILGUN 4` (slot présent seulement s'il est porté, étiquette « SPÉCIALE »). Les **noms courts restent complets en permanence** (`nomCourt`, jamais tronqués en « FUSI ») ; l'actif porte un fond ambre 14 % (`color-mix`), un cadre ambre et `aria-current="true"`. Pendant le dégainage (`hud.degainage`) la ligne du slot se remplit.
* **Seuils de munitions** : chargeur ≤ 25 % ou ≤ 3 balles : chiffre ambre ; ≤ 10 % ou 0 balle : `--ag-danger` et invite « R : RECHARGER » (touche réellement assignée) sous le viseur ; chargeur 0 : « VIDE » ; spéciale à 0 : elle quitte le rack et un toast annonce « Railgun épuisé ». Annonce vocale « Chargeur bas » une seule fois par passage sous le seuil.
* **Rechargement** : un **anneau de progression autour du viseur** (variable CSS `--recharge` écrite en rAF sur l'élément de l'anneau) et la rangée de pips remplacée par une barre ambre de 4u (même variable) avec « RECHARGEMENT » et le temps restant en `num-s`. Un seul des deux est exposé aux lecteurs d'écran (`role="progressbar"` sur la barre ; l'anneau est `aria-hidden`).
* **Couteau en main** : pas de chiffres, puce « VITESSE +30 % », le viseur devient un petit chevron de portée.
* **Bas centre** : « COURSE 11 m/s » (texte mis à jour en rAF) et étiquette d'état.
* **Fil d'éliminations** (haut-droite, 6 lignes de 6 s au plus, entrée 300 ms) : pastille + pseudo en `--ag-ink`, arme (`nomCourt`, « ◎ » pour la tête), pastille + pseudo ; mort par véhicule ou circulation en toutes lettres (`libelleCause`). Mes lignes : fond ambre 14 % et barre de 3u. À 1366 : noms d'armes abrégés, 4 lignes.

### 5.2 En jeu, 1366×768 (u = 0,8)

```
+---------------------------------------------------------------------+
|  +- MINI-MAP -+       +---------------------------+   Lea [Fus.] Max |
|  |    :       |       | #3 VOUS 12K  4:32  * Lea 18K |  VOUS [Pis.@] Zoe < |
|  |  :/^\ ##   |       |        A 30 K             |    Zoe [Rail] Tom |
|  |==-==-==-==-|       | [###############|--------] |                   |
|  +------------+       +---------------------------+                   |
|  100 m . [M]                                                          |
|                                      [34]                             |
|                                  -- + --                              |
|                                                   FUSIL D'ASSAUT      |
|                                                   23 /30 RESERVE inf  |
|                                                   |||||||||||||.....  |
|                                                  > [1] FUSIL    23/30 |
|  [ACCROUPI]                                        [2] PISTOLET 12/12 |
|  87 PV   REGEN +20/s                               [3] COUTEAU  +30 % |
|  [###|###|###|##.]                                 [4] RAILGUN      4 |
|  BOUCLIER 62                                                          |
|  [////|////|//..|....]               COURSE 11 m/s                    |
+---------------------------------------------------------------------+
```
Même structure à l'échelle 0,8 ; fil limité à 4 lignes, noms d'armes abrégés, jauge de match réduite. Plancher de texte 11 px respecté partout.

### 5.3 En lunette (sniper)

```
+--------------------------------------------------------------------------------------------------+
|  +- MINI-MAP -----+         +----------------------------------+              Lea [Fusil] Max     |
|  |  (inchangee,   |         | #3 VOUS 12K    4:32   TETE Lea 18K |        VOUS [Pistolet @] Zoe < |
|  |  pleine opacite)|        +----------------------------------+                                  |
|  +----------------+               ***            |            ***                                 |
|  100 m . [M]                    **               |               **                               |
|                               **                 |                 **                              |
|                              *      ------------ -+- ------------  *    x4                         |
|                               **                 |                 **    112 m                     |
|                                 **               |               **                                |
|                                    ***           |           ***                                   |
|  87 PV                                                                     SNIPER   4/5           |
|  BOUCLIER 62               (hors du cercle : noir plein)                  RESERVE inf             |
|  [////|////|//..|....]                                                    ||||| (5 crans)         |
+--------------------------------------------------------------------------------------------------+
```
Le cache noir reste celui de `.lunette` (cercle de 39 vmin, inchangé) : les quatre blocs de coin sont sur noir plein, leur contraste est maximal. Ajouts : « ×4 » (`hud.zoomX`) et distance de la cible visée (`hud.distanceVisee`, absente si −1) à droite et sous le réticule ; le compteur de pips passe à 5 crans. Mini-map et fil gardent taille et opacité. À 1366 : mêmes ajouts, noms abrégés.

### 5.4 En voiture, conducteur (`CONDUCTEUR_TIRE = false`) et passager

```
+--------------------------------------------------------------------------------------------------+
|  +- CARTE (cap) --+         +----------------------------------+              Lea [Fusil] Max     |
|  | (suit le cap,  |         | #3 VOUS 12K    4:32   TETE Lea 18K |                                |
|  |  rayon croissant)|       +----------------------------------+                                  |
|  +----------------+                                                                                |
|                                       ( + )  CONDUITE : TIR IMPOSSIBLE                             |
|                                                                        FUSIL (indisponible)        |
|                              +- VEHICULE ---------------------+        23 /30   TIR IMPOSSIBLE    |
|                              |          87 km/h                |       > [1] FUSIL        23/30    |
|                              |       CONDUCTEUR  place 1/4     |         [2] PISTOLET     12/12    |
|  87 PV    REGENERATION       |  +--------+--------+             |         [3] COUTEAU    +30 %      |
|  [########|####...]         |  | 1 VOUS | 2 Zoe  |             |                                   |
|  BOUCLIER 62                 |  | 3 libre| 4 libre|             |                                   |
|  [////|////|//..]           |  +--------+--------+             |                                   |
|                              |  [F] place   [E] descendre      |                                   |
|                              +---------------------------------+                                   |
+--------------------------------------------------------------------------------------------------+
```
* **Bloc véhicule** (420×150u, bas centre) : vitesse en `num-l` (km/h, `HudLive`), rôle écrit (CONDUCTEUR / PASSAGER), vue de dessus 2×2 des sièges (0 avant-gauche = conducteur, 1 avant-droit, 2 et 3 arrière ; ordre à confirmer avec `vehicule.ts`), chaque cellule = pastille + pseudo (« libre » si vide), mon siège cadré en ambre avec « (vous) » pour les lecteurs d'écran, rappel des touches (assignées).
* **Conducteur** : viseur remplacé par `( + )` en `--ag-ink-dim` et libellé « CONDUITE : TIR IMPOSSIBLE » ; bloc armes visible mais en `--ag-ink-dim` sans opacité, avec la ligne « TIR IMPOSSIBLE ». **Passager** : viseur et armes normaux, seul le bloc véhicule s'ajoute (chiffres de sièges identiques).
* Mini-map : orientée sur le cap du véhicule, rayon croissant avec la vitesse, la voiture remplace le triangle.
* Hors véhicule, à moins de 3,5 m d'une voiture : invite « [E] Monter (2/4) » sous le viseur.

### 5.5 Mort : rejeu puis carte du tueur

```
REJEU (2,5 s)  - bandes noires de 8 vh, HUD de combat MASQUE
+--------------------------------------------------------------------------------------------------+
|##################################################################################################|
|##(o) REJEU . vue de Lea . Fusil d'assaut . 47 m ############################ [Espace] passer ####|
|##################################################################################################|
|                                   (scene vue par le tueur)                                       |
|                                                                                                  |
|                              [1] Fusil d'assaut  [2] Pistolet   (equipement suivant, compact)    |
|##################################################################################################|
|##[##########-------]  ELIMINE . reapparition dans 3,1 s ########################################|
|##################################################################################################|
+--------------------------------------------------------------------------------------------------+
CARTE DU TUEUR (1,5 s)
+--------------------------------------------------------------------------------------------------+
|##################################################################################################|
|                         +------------------------------------------+                             |
|                         |               ELIMINE PAR                |                             |
|                         |                 [#] Lea                  |                             |
|                         |   Fusil d'assaut . 38 m . o tir a la tete|                             |
|                         |  PV      [########--------]  54          |                             |
|                         |  BOUCL.  [////------------]  25          |                             |
|                         |  VOUS lui avez inflige 46 degats         |                             |
|                         |     Reapparition dans 1,4 s              |                             |
|                         |  [###########################-----]     |                             |
|                         +------------------------------------------+                             |
|                    Equipement : [1] Fusil d'assaut  [2] Pistolet   (compact)                     |
|##################################################################################################|
+--------------------------------------------------------------------------------------------------+
```
* Rejeu : bandes de 8 vh (glissent en 250 ms), barre de progression sur la bande basse, légende « REJEU · vue de <pseudo> · <arme> · <distance> », bouton « Passer (Espace) » (action `passer`), titre « ÉLIMINÉ » `role="status"`. **Le HUD de combat est entièrement masqué** (`hidden`, retiré de l'arbre d'accessibilité) ; seul l'équipement suivant (`ChoixEquipement` variante `compact`) reste, sur plaque.
* Carte du tueur (520×300u, plaque `--ag-hud-fond-fort`) : pseudo en `--ag-ink` avec pastille, ses K/M du match, arme, distance, « tir à la tête » en texte + `--ag-tete`, **ses PV et son bouclier restants** (`InfoTueur.pv/bouclier`, jauges + chiffres), dégâts que je lui ai infligés (cumul client des `confirme` sur ce joueur pendant ma vie), compte à rebours de réapparition + barre (`hud.reapparitionDans`).
* **Repli sans tueur joueur** (écrasé par un PNJ, tueur déconnecté) : pas de rejeu ; carte seule avec le titre `libelleCause` (« Écrasé par la circulation », « Renversé par <pseudo> »).

### 5.6 Tableau des scores (Tab maintenu), 1920×1080

```
+--------------------------------------------------------------------------------------------------+
|  +- MINI-MAP --+                                                                                  |
|  |             |   +------------------------------------------------------------------------+    |
|  |    /^\      |   | MATCH #14 . CHACUN POUR SOI                 PREMIER A 30 K        4:32 |    |
|  |             |   | Vous etes 4e, a 6 kills du leader                                      |    |
|  +-------------+   | 0--[T]--[N]----[L]------[V]---[K]------------------------------------30 |    |
|  100 m . [M]       |  #   AGENT        K   M  K/D  SER  PREC  TETE   DEG   ARME FAV.    PING |    |
|                    | -----------------------------------------------------------------------|    |
|                    | * 1  [#] Lea       18   7  2,6   5   41%   22%  2310  Fusil d'assaut  32 |    |
|                    |   2  [#] Zoe       15   9  1,7   3   52%   12%  1980  Revolver        45 |    |
|                    |   3  [#] Max       13  10  1,3   4   36%   31%  1760  Sniper          28 |    |
|                    | > 4  [#] VOUS      12   8  1,5   2   44%   18%  1640  Fusil d'assaut  41 |    |
|                    |   5  [#] Tom        9  12  0,8   1   29%    9%  1120  Pompe           60 |    |
|                    |   6  [#] Evex x     7  11  0,6   0   33%   14%   990  Mini uzi        75 |    |
|                    |   ... 16 lignes, defilement interne, en-tete fige, ligne VOUS epinglee   |    |
|                    | -----------------------------------------------------------------------|    |
|                    | Records : serie Lea x5 . precision Zoe 52% . tetes Max 31%             |    |
|                    | * en tete   > vous   x elimine   voiture = en vehicule    [Tab] maintenir |    |
|                    +------------------------------------------------------------------------+    |
+--------------------------------------------------------------------------------------------------+
```
Détail en §8. À 1366 le panneau fait `min(1280u, 100vw − 2×(264u+48u))` ≈ 868 px : colonnes repliées (§8.3), la mini-map reste visible à sa place. Sous 1000 px de large de fenêtre, la mini-map est masquée tant que le tableau est ouvert.

### 5.7 Fin de match (entracte), 1920×1080

```
+--------------------------------------------------------------------------------------------------+
|                         MATCH TERMINE . Lea remporte la partie (30 K)                              |
|                                         +- 1er ---------+                                          |
|                                         |  [#] Lea      |                                          |
|                       +- 2e ----------+ |  30 K . 7 M   | +- 3e ----------+                        |
|                       | [#] Zoe       | |  K/D 4,3      | | [#] Max       |                        |
|                       | 24 K . 9 M    | |               | | 19 K . 10 M   |                        |
|                       +---------------+ +---------------+ +---------------+                        |
|  TON MATCH (4e/6)                 CLASSEMENT                         DISTINCTIONS                  |
|  K 12  M 8  K/D 1,5               4 > [#] VOUS  12 K  8 M  1,5       Precision : Zoe 52%           |
|  PREC 44%  TETES 18%              5   [#] Tom    9 K 12 M  0,8       Serie max : Lea x5            |
|  SERIE MAX x2  DEGATS 1640        6   [#] Evex   7 K 11 M  0,6       Tetes : Max 31%               |
|  ARME FAV. Fusil d'assaut         (defile, VOUS epinglee)                                          |
|                  Prochain match dans 9 s  [########|----]                                          |
|                  Equipement suivant : [1] Fusil d'assaut  [2] Pistolet   (compact)                |
+--------------------------------------------------------------------------------------------------+
```
Détail en §10. À 1366×768 la vue tient sans défilement : podium compact (hauteurs 100/78/62 %), « Ton match » et suite du classement en deux colonnes, distinctions repliées dans « Ton match » seulement si je les ai gagnées.

### 5.8 Cadeau d'Elsa annoncé

```
+--------------------------------------------------------------------------------------------------+
|  +- MINI-MAP -----+        +----------------------------------+              Elsa : soin (+)      |
|  |  ...      (+)> |        | #3 VOUS 12K    4:32   TETE Lea 18K |            Lea [Fusil] Max     |
|  +----------------+        +----------------------------------+                                   |
|  100 m . [M]         +------------------------------------------------+                           |
|                      | <> ELSA . TRUCK MUCHE                  ->  340 m |                           |
|                      |     SOIN COMPLET : PV 100 + BOUCLIER 100         |                           |
|                      | [##########################----------]  27 s    |                           |
|                      +------------------------------------------------+                           |
|                                              -- + --                                              |
|                                    Avance vers Elsa (12 m)                                        |
+--------------------------------------------------------------------------------------------------+
```
* Déclenché par `elsa{evenement:"apparue"}` ; non modal. Flèche vers Elsa (variable `--elsa-angle` écrite en rAF d'après `repereElsa(radar())`, distance arrondie à 10 m), contenu en texte (« SOIN COMPLET : PV 100 + BOUCLIER 100 » ou « ARME : RAILGUN, 6 tirs »), barre de temps sur `offre.finT`.
* Grand 4 s (entrée 250 ms par le haut), puis **replié en puce** de 36u sous la barre de match (« <> ELSA 340 m · 27 s »), qui reste jusqu'au ramassage ou à l'expiration. À 1366 : replié d'emblée si la fenêtre fait moins de 800 px de haut.
* Fil : ligne « Elsa : … » (genre `elsa`, 8 s, 4 annonces max). Mini-map : anneau pulsant, chevron de bord + distance si hors cadre.
* Invite à moins de 15 m : « Avance vers Elsa (12 m) » ; ramassage par un autre : « <pseudo> a pris le cadeau d'Elsa », puce retirée.
* Ramassage par moi : toast central bas de 2,5 s (« Bouclier 100 », « Railgun · 6 tirs · touche 4 »), la barre de bouclier se remplit en 600 ms. Expiration : « Offre expirée », sans son.

### 5.9 Réglages d'interface (menu pause et lobby)

```
INTERFACE
Mini-map     [+--------+]   ( ) Haut-gauche  (o) Haut-droite  ( ) Bas-gauche  ( ) Bas-droite  ( ) Masquee
             [|##    . |]   Taille          ( ) S  (o) M  ( ) L
             [|        |]   Orientation     (o) Suit ma vue  ( ) Nord en haut
             [+--------+]   Rayon           ( ) 60 m  (o) 100 m  ( ) 160 m
Interface    Taille  ( ) 90 %  (o) 100 %  ( ) 115 %        Effets  (o) Auto  ( ) Reduits
Touches      Grande carte (maintenir) [M]    Mini-map : coin suivant [non assignee]
```

---

## 6. Retours de combat (zone du viseur)

### 6.1 Marqueurs de touche confirmés par le serveur

* Source unique : l'événement `confirme` (§3.4). **Aucun tick local.** Le chiffre apparaît à l'image qui suit la réception du `degats`.
* **Cumul** (`lib/fps/degats-cumul.ts`, pur) : les `confirme` sur la même cible dans 400 ms s'additionnent en un seul chiffre (pompe, minigun) ; les drapeaux tête / bouclier / kill sont combinés par OU.
* **Codage sans couleur seule** : tête = « ◎ » devant, chiffre souligné, `--ag-tete` ; dégâts absorbés par le bouclier (`absorbe > 0`) = crochets `[34]`, `--ag-shield` ; dégâts aux PV = `−34`, `--ag-white`. Les trois formes sont distinguables en niveaux de gris.
* Position : 14u à droite et 14u au-dessus du centre, monte de 22u en 700 ms en s'estompant. Quatre barres autour du viseur (marqueur de touche) 220 ms, plus grandes en tête. **Kill** : X rouge de 20u (échelle 1,35 → 1, 700 ms) et « +1 » 900 ms ; « ÉLIMINÉ <pseudo> » dans le fil.
* Le son « tic » et la giclée sont déjà déplacés par la v2 §13.2 sur la même réception.

### 6.2 Dégâts reçus et PV bas

Arc directionnel `degat` et vignette de sang sous 30 PV inchangés (la vignette devient fixe en mouvement réduit). Une vignette `--ag-shield` de 400 ms à la rupture du bouclier. Pas d'arc sur la mini-map (anneau de tir entendu uniquement).

### 6.3 Viseur

Statique (v2 §13.1) : quatre traits fixes, point central 2u, ancien `--ecart` supprimé. Cyan quand `protege`. En conduite : `( + )` gris. Couteau : chevron de portée. Rechargement : anneau (§5.1).

---

## 7. Composants et fichiers

### 7.1 `app/components/arene/`

| Fichier | Rôle |
|---|---|
| `HudArene.tsx` | orchestrateur (≈ 200 lignes). Garde `useTabMaintenue`, le menu pause, l'aide du premier lancement, le choix de l'écran (jeu / lunette / killcam / entracte). Vidé de tout calcul : il passe des scalaires |
| `HudArene.module.css` | tokens locaux, `--u`, coins, zones, règles `prefers-reduced-motion` |
| `hud/CoinHud.tsx` | colonne de coin, ordre d'empilement (§4.6) |
| `hud/BarreMatch.tsx` | rang, minuterie, leader, jauge d'objectif, « POINT DE MATCH », série |
| `hud/BlocVie.tsx` | PV, barre fantôme, trait de délai, bouclier, puces d'état |
| `hud/BlocArmes.tsx`, `hud/Chargeur.tsx` | nom, chargeur/réserve, pips, rack de slots |
| `hud/Viseur.tsx`, `hud/Lunette.tsx`, `hud/RetoursTouche.tsx` | viseur statique + anneau de rechargement + invite ; lunette ; chiffres et marqueurs confirmés |
| `hud/FilEliminations.tsx`, `hud/AnnoncesElsa.tsx`, `hud/InvitesAction.tsx`, `hud/BlocVehicule.tsx` | |
| `hud/MiniMap.tsx` (+ `MiniMap.module.css`), `hud/GrandeCarte.tsx` | canvas et boucle rAF (§4) |
| `hud/TableauScores.tsx` (+ module), `hud/LigneScore.tsx`, `hud/RailObjectif.tsx` | tableau, ligne mémoïsée, course à l'objectif |
| `hud/FinDeMatch.tsx`, `hud/Podium.tsx`, `hud/CarteBilan.tsx`, `hud/Distinctions.tsx` | entracte |
| `hud/EcranMort.tsx`, `hud/CarteTueur.tsx` | mort (le rejeu reste dans `Killcam.tsx` de la v2) |
| `hud/ZoneVive.tsx` | région `aria-live` unique, file anti-bavardage (§12) |
| `hud/ReglageInterface.tsx`, `hud/SelecteurCoin.tsx`, `hud/useReglagesHud.ts`, `hud/useHudLive.ts`, `hud/useLargeur.ts` | |

Chaque bloc est un composant `memo` qui ne reçoit que des scalaires ; `useHudLive` écrit les variables CSS (`--recharge`, `--regen`) et le texte de vitesse en rAF sur l'élément concerné.

### 7.2 `lib/fps/` (logique pure, vitest)

| Fichier | Contenu |
|---|---|
| `minimap.ts` | projection, rayon auto, bord, ancre (§4.2) |
| `minimap-couche.ts` | dessin de la couche statique avec un contexte 2D **injectable** |
| `radar.ts` | types `RadarFrame`, constructeur à tableaux préalloués, `repereElsa`, filtre de visibilité, purge des échos |
| `classement.ts` | tri, rang (ex aequo), K/D, précision, têtes, palmarès, colonnes visibles, phrase de situation, rail |
| `degats-cumul.ts` | cumul 400 ms des `confirme` |
| `hud-modele.ts` | `parseSlots`, seuils de munitions et de PV, pips, formats français |
| `reglages-hud.ts` | lecture / écriture / validation de `pdj-fps-minimap` et `pdj-fps-hud` |
| `touches.ts` (existant) | actions `carte` (M, maintenir) et `minimapCoin` (non assignée) |

### 7.3 Autres modifications

`jeu.ts` (+ `jeu-types.ts`) : `HudLive`, `live`, `radar()`, nouveaux champs de `HudEtat`, événement `confirme`. `match.ts` et `serveur-fps/src/index.ts` : compteurs, `vueScores` / `scores`, `JoueurPublic.serie`, `LigneClassement` étendue. `protocole.ts` : `absorbe`, `LigneStats`. `useArene.ts` : `stats`, `demanderScores`. `Agroparc3D.module.css` : tokens (§2.1). `Arene.tsx` : `ReglageInterface` replié. `armesInfo.ts` : `nomCourt`. `CLAUDE.md` (section Arène FPS) et la spec v1 mises à jour par le lot Z.

---

## 8. Tableau des scores

### 8.1 Colonnes

| Col. | Contenu | Largeur (1080) | Repli |
|---|---|---|---|
| `#` | rang ; `=` devant les ex aequo ; ★ pour le leader | 40u | jamais |
| Agent | pastille de couleur + pseudo en `--ag-ink` + état écrit (« éliminé », « en véhicule ») + étiquette « VOUS » | 200u | jamais |
| K | kills | 56u | jamais |
| M | morts | 56u | jamais |
| K/D | `kills / max(1, morts)`, 1 décimale, virgule | 64u | jamais |
| SÉR | série en cours (série max en `title` au survol) | 64u | repli 2 |
| PRÉC | `touches / tirs` en % (— si 0 tir) | 72u | repli 2 |
| TÊTE | `tetes / touches` en % | 72u | repli 1 |
| DÉG | dégâts infligés | 80u | repli 1 |
| ARME FAV. | arme avec le plus de kills (`nomCourt`) | 160u | repli 1 |
| PING | ms + pastille de qualité (bon < 60 `--ag-ok`, moyen < 120 ambre, mauvais rouge), valeur toujours écrite | 72u | jamais |

### 8.2 Structure et mise en avant

* Un vrai `<table>` avec `<caption>` (« Tableau des scores, match 14 »), `scope="col"`, `aria-current="true"` sur ma ligne.
* **En-tête figé** (`position: sticky`) : numéro de match, mode « CHACUN POUR SOI », objectif, minuterie, **rail de course à l'objectif** (un jeton pastille + initiale par joueur sur 0 → objectif, repère ▼ pour moi, ★ pour le leader, glissement 300 ms), **phrase de situation** (« Vous êtes 4e, à 6 kills du leader » / « Vous menez de 3 kills ») et « 16 en jeu + 2 spectateurs ».
* **Ma ligne** : bordure gauche ambre 3u, fond ambre 14 % (`color-mix`), étiquette « VOUS », pseudo en gras ; **épinglée en bas** du corps du tableau si elle sort de la zone visible. Leader : ★ + étiquette « LEADER » en texte. Morts : texte en `--ag-ink-dim` et ✕ (pas d'opacité). En véhicule : picto voiture.
* **Pied** : records du match (meilleure série ; meilleure précision avec **minimum 10 tirs** ; plus de têtes avec **minimum 5 touches**), légende des marques, rappel de la touche.
* **Tri** : K décroissant, puis M croissant, puis dégâts décroissants, puis pseudo (`localeCompare("fr")`). Rang ex aequo = mêmes K et M. Réordonnancement par FLIP de 200 ms (aucun en mouvement réduit).
* Panneau : largeur `min(1280u, 100vw − 2 × (264u + 48u))` (ne recouvre jamais la mini-map d'un coin), hauteur max 80 vh avec défilement interne, plaque `--ag-hud-fond-fort`.

### 8.3 Colonnes visibles selon la largeur du panneau (`colonnesVisibles(largeurPx)`, pur, mesuré par `useLargeur`)

| Largeur du panneau | Colonnes |
|---|---|
| ≥ 1100 px | toutes |
| 800 à 1099 px | `#`, Agent, K, M, K/D, SÉR, PRÉC, PING (repli 1 : sans TÊTE, DÉG, ARME) |
| < 800 px | `#`, Agent, K, M, K/D, PING (repli 2) |

Hauteur de ligne : 44u ; 36u au-delà de 12 joueurs ; 32u sous 800 px de hauteur de fenêtre (seize lignes tiennent à 1366×768 et 1280×720). Texte du tableau : `num-s` 14u, soit 11,2 px à u = 0,8.

### 8.4 Alimentation

* K, M, ping, pseudo, couleur, `serie` : présence (`JoueurPublic`), déjà temps réel.
* PRÉC, TÊTE, DÉG, ARME FAV., SÉR max, vivant, véhicule : message `scores` (§3.5), réponse immédiate à l'appui sur Tab puis 1 Hz.
* En entracte, le même composant reçoit `LigneClassement` étendue (message `match`).

### 8.5 Tab et souris

`useTabMaintenue` est conservé (Tab = scores seulement souris prise ; menu pause ouvert, il garde sa navigation clavier). Il appelle `surVueScores(true)` à l'appui, `false` au relâchement, et à `blur`.

### 8.6 Phases de livraison

* **Phase 1 (sans nouveau serveur)** : colonnes `#`, Agent, K, M, K/D, SÉR (via `JoueurPublic.serie`), PING ; phrase de situation, rail, ligne épinglée, fin de match avec podium et « Ton match » partiel (rang, K, M, K/D).
* **Phase 2 (lot S1)** : message `scores`, colonnes PRÉC, TÊTE, DÉG, ARME FAV., records et distinctions complètes. Tant que les stats manquent, ces cellules affichent « — ».

---

## 9. Mort et killcam

Voir §5.5. Règles de comportement :

* `hud.mort` avec `hud.killcamPhase` : `"rejeu"` → `EcranMort` en mode rejeu (bandes, légende, bouton Passer, `ChoixEquipement` compact) ; `"carte"` → `CarteTueur` ; `""` avec `hud.mort` (repli sans rejeu) → `CarteTueur` seule sur 4 s via `reapparitionDans`.
* « Passer » : Espace (action `passer`, rebindable) ou le bouton ; appelle `surPasserKillcam()` ; ne raccourcit pas l'attente serveur.
* Mini-map, bloc vie, bloc armes, fil, barre de match : `hidden` pendant toute la killcam. À `apparition`, retour immédiat du HUD, mini-map recentrée sans animation.
* Les dégâts que j'ai infligés au tueur (carte) sont cumulés dans `useArene` (`degatsAuTueur`, remis à zéro à `apparition`).

---

## 10. Fin de match (entracte)

* Plein écran, voile `--ag-hud-fond` à 0,55 (le voile n'est pas du texte). Le HUD de combat est masqué sauf la mini-map (elle reste à sa place, nette) ; le viseur disparaît.
* **Titre** « MATCH TERMINÉ » + raison (« Lea a atteint 30 kills » / « Temps écoulé »).
* **Podium** : 1er au centre, 2e à gauche, 3e à droite, hauteurs 100 / 78 / 62 %, montée en cascade 3 → 2 → 1 en 1,2 s au total (affichage direct en mouvement réduit). Chaque bloc : pastille, pseudo, K–M, K/D. Moins de 3 joueurs : le podium s'adapte ; ex aequo = même rang.
* **Trois colonnes** : « TON MATCH » (rang final, K, M, K/D, précision, têtes, meilleure série, dégâts, arme favorite) ; « CLASSEMENT » (4e et suite, compact, VOUS épinglé) ; « DISTINCTIONS » (précision, série max, têtes, avec les minimums du §8.2), calculées côté client dans `classement.ts`.
* **Compte à rebours** « Prochain match dans N s » avec barre, d'après `match.prochain` (`JEU.entracteMs`). `ChoixEquipement` compact pour la prochaine apparition.
* **Tab** ouvre le tableau complet par-dessus (le podium se masque, le tableau s'agrandit) ; **Échap** ouvre le menu pause comme aujourd'hui.

---

## 11. Animations

| Élément | Animation | Durée |
|---|---|---|
| Chiffre de dégâts | monte de 22u en s'estompant | 700 ms, ease-out |
| Marqueur de touche | léger grossissement puis fondu | 220 ms |
| X de kill | échelle 1,35 → 1 | 700 ms |
| Ligne du fil | glisse de 10u depuis la droite | 300 ms |
| Barre PV | largeur interpolée ; barre fantôme | 120 ms ; 600 ms |
| Bouclier brisé | flash de la barre + vignette `--ag-shield` | 240 ms ; 400 ms |
| Changement d'arme | cadre qui glisse ; remplissage de dégainage | 120 ms ; 350 ms |
| Bandeau Elsa | entrée par le haut, repli en puce | 250 ms ; 300 ms |
| Anneau du cadeau (mini-map) | pulsation d'échelle 1 → 1,6 | 1,2 s en boucle pendant l'offre |
| Anneau de tir entendu | s'élargit en fondu | 1,2 s |
| Ligne du tableau (tri) | FLIP | 200 ms |
| Jeton du rail | glissement | 300 ms |
| Podium | colonnes en cascade | 1,2 s |
| Bandes de killcam | glissement | 250 ms |
| Carte du tueur | fondu + montée de 12u | 250 ms |
| Vignette PV bas | pulsation d'opacité (existante) | 1,2 s (0,83 Hz) |

Aucun élément ne clignote plus d'une fois par seconde. **`prefers-reduced-motion: reduce` et réglage « Effets : réduits »** (`data-effets="reduits"` sur `.hud`) : plus de montée, glissement, FLIP, pulsation ni cascade ; les chiffres de dégâts apparaissent et s'effacent sur place (150 ms) ; anneau du cadeau et bandeau fixes ; podium d'un coup ; vignette de sang fixe ; la rotation de la mini-map n'est pas retirée mais son orientation par défaut devient « nord ». Les barres de progression (rechargement, compte à rebours) continuent de se mettre à jour, sans transition.

---

## 12. Accessibilité

* **Contraste** : §2.2, vérifié par test. Les contours essentiels sont en `--ag-cadre`.
* **Couleur jamais seule** : PV bas écrit ; bouclier = hachure + « BOUCLIER N » ; tête = « ◎ » + souligné ; absorbé = crochets ; ennemis = disque / carré / croix ; leader = ★ + « LEADER » ; ping avec sa valeur ; mort = ✕ + « éliminé » ; arme active = cadre + `aria-current` ; cadeau d'Elsa = croix ou étoile + texte.
* **Région vivante unique** (`ZoneVive`, `role="status"`, `aria-live="polite"`) : « Éliminé par X », « Elsa : soin complet, 340 m », « Bouclier N », « Bouclier détruit », « Chargeur bas », « Réserve épuisée » (spéciale), « Match terminé », paliers de minuterie (60, 30, 10 s) ; PV annoncés seulement aux seuils 50 et 25 ; **un message toutes les 2 s au plus**, les moins importants jetés. `aria-live="assertive"` uniquement pour « PV critiques », une fois par passage sous le seuil. Le fil d'éliminations reste `aria-live="off"`.
* **Décoratif** (`aria-hidden`) : viseur, lunette, anneau de rechargement, vignettes ; mini-map en `role="img"` avec `aria-label` et légende texte.
* **Clavier** : le HUD n'est pas interactif en jeu. Menu pause et écran de mort prennent le focus ; boutons ≥ 40 px, anneau de focus blanc 2 px existant ; `SelecteurCoin` au clavier (flèches).
* **Texte** : 11 px minimum à tous les rapports d'échelle ; chiffres tabulaires.

---

## 13. CSS : grille, coins, règles clés

```css
/* HudArene.module.css */
.hud {
  --echelle-hud: 1;
  --u: calc(clamp(0.8px, min(0.0926vh, 0.0521vw), 1.25px) * var(--echelle-hud));
  --marge: calc(32 * var(--u));
  --mm: calc(264 * var(--u));              /* 208 / 264 / 320 selon la taille */
  --recharge: 0; --regen: 1;
  position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden;
  font-family: var(--ag-mono), ui-monospace, monospace; color: var(--ag-ink);
  text-shadow: 0 0 6px var(--ag-ground), 0 0 2px var(--ag-ground);
}
.plaque { background: var(--ag-hud-fond); border: 1px solid var(--ag-cadre); }
.plaqueForte { background: var(--ag-hud-fond-fort); border: 1px solid var(--ag-cadre); }

.coin { position: absolute; display: flex; flex-direction: column; gap: calc(12 * var(--u));
        width: max(calc(264 * var(--u)), var(--mm)); }
.coinHG { top: var(--marge);    left: var(--marge); }
.coinHD { top: var(--marge);    right: var(--marge); align-items: flex-end; }
.coinBG { bottom: var(--marge); left: var(--marge);  justify-content: flex-end; }
.coinBD { bottom: var(--marge); right: var(--marge); justify-content: flex-end; align-items: flex-end; }

.pvNum   { font: 500 max(11px, calc(64 * var(--u)))/1 var(--ag-mono); font-variant-numeric: tabular-nums; }
.chargeur{ font: 500 max(11px, calc(64 * var(--u)))/1 var(--ag-mono); font-variant-numeric: tabular-nums; }
.bouclierBarre { background: repeating-linear-gradient(135deg, var(--ag-shield) 0 4px, transparent 4px 8px); }
.anneauRecharge { background: conic-gradient(var(--ag-amber) calc(var(--recharge) * 360deg), transparent 0); }

@media (prefers-reduced-motion: reduce) { .hud * { animation: none !important; transition: none !important; } }
.hud[data-effets="reduits"] * { animation: none !important; transition: none !important; }
```
Aucune couleur en dur dans les modules HUD ; teintes translucides via `color-mix(in srgb, var(--ag-...) N%, transparent)`.

---

## 14. Risques et points à valider

1. **Réserve de munitions** : décision de gameplay différée (infinie en v2). Rien à refaire côté HUD si elle devient finie.
2. **Échos de tir** sur la mini-map : révèlent une zone ; à valider en jeu, coupables par `ECHOS_TIR`.
3. **Visibilité** : `radar.ts` réutilise `visibilite.ts` ; à tester avec `window.__arene` que ni voiture en mouvement ni passager ne fuit un joueur caché.
4. **Tableau à 1280 px** : ≈ 782 px de large, repli 2 ; vérifier en captures 1280×720 et 1366×768.
5. **Mémoire** : couche statique ≈ 4,9 Mo RGBA, libérée à la sortie ; perte de contexte WebGL non concernée (canvas 2D).
6. **Perf rAF** : mini-map à 60 Hz avec repli 30 Hz mesuré ; vérifier sur portable bas de gamme.
7. **Ordre des sièges** (`vehicule.ts`, lot E) et **chiffres tabulaires** de Chakra Petch : à confirmer ; le HUD utilise Plex Mono pour les compteurs.
8. **Charge serveur** de `scores` : négligeable (seulement les clients qui tiennent Tab).
9. **Coordonnées** : nord = −z à confirmer sur `scene.json` ; la zone de carte (bbox + 60 m) doit contenir apparitions, Elsa et parkings (testé).

---

## 15. Critères d'acceptation et tests

### 15.1 Tests unitaires (vitest, Node 22, `npx vitest run lib/fps app/components/arene`)

* `lib/fps/minimap.test.ts` : mode regard avec ψ = 0 (un point au nord est au-dessus du joueur), ψ = π/2, mode nord ; ancre à 58 % ; `rayonAuto` borné entre ×1 et ×1,6 ; `estDansCarte` et `chevronBord` (angle, collé au bord, marge) ; `arrondi(v, 8)` ; la zone `ZONE_CARTE(scene.json)` contient les 8 POI, Elsa (−120 ; 39) et les parkings.
* `lib/fps/minimap-couche.test.ts` : faux contexte 2D, nombre d'appels `fill`/`stroke` cohérent avec 142 bâtiments, aucune coordonnée hors canvas, échelle plafonnée à 8 Mpx.
* `lib/fps/radar.test.ts` : un joueur non vu n'apparaît pas ; `vu` décroît en 0,6 s ; les tableaux conservent leur identité d'une image à l'autre ; échos purgés après 1,2 s, arrondis à 8 m, tireur vu exclu ; PNJ filtrés à 100 m ; `repereElsa` (angle, distance arrondie à 10 m).
* `lib/fps/classement.test.ts` : tri (K, M, dégâts, pseudo), ex aequo, K/D avec 0 mort, précision avec 0 tir (« — »), records avec minimums (10 tirs, 5 touches), `colonnesVisibles` aux seuils 799 / 800 / 1099 / 1100, phrase de situation (« à 6 kills du leader », « vous menez »), « POINT DE MATCH », ligne VOUS épinglée, rail (positions 0..1).
* `lib/fps/degats-cumul.test.ts` : cumul 400 ms par cible, drapeaux combinés, deux cibles distinctes non fusionnées, fenêtre qui expire.
* `lib/fps/hud-modele.test.ts` : `parseSlots` (4 et 5 champs, slot spécial absent), seuils de munitions (25 %, 10 %, 3 balles, 0), seuils de PV (50, 25, 30), pips (≤ 30 un par balle, > 40 un pour 5), formats fr (virgule, espace insécable).
* `lib/fps/reglages-hud.test.ts` : défauts, valeur hors liste, version inconnue, JSON invalide, stockage qui lève, `orientation` absent + `prefers-reduced-motion`.
* `lib/fps/hud-contraste.test.ts` : recalcule les rapports du §2.2 depuis `Agroparc3D.module.css` ; tous ≥ 4,5:1 pour les tokens de texte, `--ag-cadre` ≥ 4,5:1 ; échoue si une couleur hexadécimale ou `rgb(` apparaît dans `HudArene.module.css` ou `hud/*.module.css`.
* `lib/fps/touches.test.ts` : actions `carte` et `minimapCoin` (défauts, migration d'une sauvegarde v1 sans conflit, `actionsSansTouche`).
* Serveur (`match.test.ts`, `match.reseau.test.ts`) : compteurs `tirs/touches/tetes/degats/serie/armeFav`, remise à zéro par match, `vueScores` ouvert → réponse immédiate puis 1 Hz et rien aux clients fermés, `degats.absorbe`, `JoueurPublic.serie`.
* Rendu statique JSX (style `lib/resto-badge.test.ts`) : `TableauScores` (caption, `scope`, `aria-current` sur VOUS, colonnes repliées selon la largeur, « — » sans stats, ligne épinglée), `CoinHud` (ordre d'empilement pour les cinq positions), `BlocArmes` (slot actif `aria-current`, nom court complet, « ∞ »), `BlocVie` (texte « BOUCLIER 62 », « PV BAS »), `FinDeMatch` (podium 2-1-3, moins de 3 joueurs), `CarteTueur` (repli `libelleCause`).

### 15.2 Critères d'acceptation (vérifiés sur captures 1920×1080, 1366×768, 1280×720)

1. Munitions : chargeur courant en `num-xl`, taille du chargeur, réserve (∞), pips, et le chargeur de chaque slot visibles en permanence à pied et en voiture (passager) ; grisés mais lisibles en conduite.
2. Mini-map : présente dans les quatre coins et masquable ; PV et chargeur **identiques en position** quel que soit le coin ; le choix survit à un rechargement de page (`pdj-fps-minimap`) ; réglable depuis le menu pause **et** le lobby sans quitter le jeu ; aucun chevauchement avec fil, barre de match, bandeau Elsa, bloc véhicule ou tableau.
3. Mini-map : n'affiche ni joueur caché ni joueur hors de la ligne de vue ; montre Elsa (fixe), son cadeau avec chevron et distance, les voitures PNJ et conduisibles, mes tirs ennemis entendus ; suit le regard (ou le cap en voiture) ; M maintenu = grande carte.
4. Tableau : rang, pastille, pseudo, K, M, K/D, série, précision, têtes, dégâts, arme favorite, ping, objectif, minuterie, rail, ma ligne mise en avant et épinglée, records, repli de colonnes sans débordement horizontal ; fin de match avec podium, « Ton match », distinctions, compte à rebours.
5. Marqueur de touche : chiffre affiché à l'image qui suit la réception du `degats`, jamais avant ; trois codages distincts (tête, bouclier, PV) lisibles en niveaux de gris ; cumul pompe en un seul chiffre.
6. Killcam : HUD de combat absent de l'arbre d'accessibilité pendant le rejeu et la carte ; pas de texte sous 4,5:1.
7. Aucune opacité ne sert à atténuer du texte ; contraste ≥ 4,5:1 en pire cas (test) ; texte ≥ 11 px réels.
8. Aucune régression des comportements existants : Échap, pause, Tab maintenu avec souris prise, pseudo à chaud, touches modifiables, `data-arene="actif"`.
9. Performances : aucun re-rendu React de `HudArene` provoqué par la vitesse, le rechargement ou la mini-map (profiler : 0 rendu hors changement discret) ; mini-map < 4 ms par image en moyenne sur la machine de développement.
10. `window.__arene.forcerHud(partiel)` permet d'afficher chacun des états du §5 sans jouer ; captures automatisées des états 5.1 à 5.8 aux trois tailles ; test de non-chevauchement des coins sur les cinq positions de mini-map.

---

## 16. Plan de lots et ordre

La v2 attribue l'UI au lot U2 ; on le scinde en gardant la règle « un fichier = un lot » :

* **U2a** : orchestrateur, `CoinHud`, `BarreMatch`, `BlocVie`, `BlocArmes`, `Chargeur`, `Viseur`, `Lunette`, `RetoursTouche`, `FilEliminations`, `AnnoncesElsa`, `InvitesAction`, `BlocVehicule`, `ZoneVive`, `hud-modele.ts`, `degats-cumul.ts`.
* **U2b** : `MiniMap`, `GrandeCarte`, `minimap.ts`, `minimap-couche.ts`, `radar.ts`.
* **U2c** : `TableauScores`, `LigneScore`, `RailObjectif`, `FinDeMatch`, `Podium`, `CarteBilan`, `Distinctions`, `EcranMort`, `CarteTueur`, `ReglageInterface`, `SelecteurCoin`, `useReglagesHud`, `classement.ts`, `reglages-hud.ts`.
* **J1** : `HudLive`, `live`, `radar()` (remplissage), nouveaux champs de `HudEtat`, événement `confirme`.
* **S1** : compteurs, `vueScores` / `scores`, `JoueurPublic.serie`, `LigneClassement` étendue, `degats.absorbe` (phase 2 du tableau).
* **G** : actions `carte` et `minimapCoin`.
* **0** : tokens (§2.1) et types de `contrats.ts`.
* **Z** : `CLAUDE.md` (section Arène FPS), spec v1, `hud-contraste.test.ts` en CI.

Ordre conseillé : 0 → (J1, G) → U2a → U2b → U2c phase 1 → S1 → U2c phase 2 → captures et accessibilité. U2b et U2c phase 1 sont parallélisables ; la killcam et le bloc véhicule dépendent des lots F et E de la v2 (contrats de `sieges`, `killcamInfo`).
