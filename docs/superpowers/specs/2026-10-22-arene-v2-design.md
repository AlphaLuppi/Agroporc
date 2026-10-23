# Arène FPS v2 — design (contrat d'implémentation)

Date : 2026-10-22 (révision après deux revues adversariales : 2026-10-23, journal en §12) · Branche : `feat/arene-v2` · Successeur de `2026-10-22-agroparc-fps-design.md` (v1, en prod).

Ce document est le **contrat** de plusieurs implémenteurs qui travaillent en parallèle. Il fige : les
décisions chiffrées (§2), le protocole (§3), le registre d'armes (§4), les signatures des modules
(§5), les modifications par fichier (§6), le plan de lots avec propriété des fichiers par phase (§7),
les tests à ajuster (§8), les risques (§9), les décisions à confirmer par l'utilisateur (§11) et le journal des révisions (§12). Tout est en français (code, commentaires, textes).
Les coordonnées viennent de `public/agroparc/scene.json` (revérifiées par script les 22 et 23/10 : anneau
centré en (28,2 ; 2,5) de rayon 18,1 m ; POI `truck` en (−125 ; 39) ; `parkings[3]` ; 142 bâtiments ;
30 `routes`). Les chiffres de ce document marqués « mesuré » l'ont été sur une copie du dépôt ou sur le vrai `scene.json`.

## 0. Demande de l'utilisateur (à satisfaire intégralement)

1. Map trop grande : courir plus vite (choix retenu) et personnages plus gros / lisibles.
2. Pseudo d'un joueur affiché seulement quand on VOIT le joueur.
3. Plus d'armes (il y en a 4) ; architecture extensible.
4. Arme principale, arme secondaire, couteau ; on change d'arme en jeu ; couteau = course bien plus rapide
   et coup au corps à corps qui peut tuer.
5. Killcam à la mort (voir qui nous a tués).
6. Régénération de vie quand on n'a pas été touché depuis longtemps.
7. Au Truck Muche, « Elsa » donne à intervalles aléatoires des armes spéciales et de la vie :
   100 PV + jusqu'à 100 PV de bouclier.
8. S'accroupir.
9. Voir les balles partir (traçantes) : l'utilisateur croit voir du bullet drop.
10. Apparitions beaucoup plus rapprochées, près du rond-point.
11. Voitures PNJ sur les routes, qui peuvent écraser.
12. Voitures conduisibles : 4 places, passagers (et conducteur selon la règle) qui tirent en roulant.

## 1. Principes

* **Le serveur reste un validateur autour de `Salle`** (`lib/fps/match.ts`, PUR, horloge `maintenant` et
  hasard `alea` injectés). Mouvement autoritaire côté client (joueur à pied ET conducteur), tirs
  déclarés par le client et revalidés. Hitscan conservé pour toutes les armes.
* **Zéro bande passante pour les voitures PNJ** : position = fonction pure de l'horloge serveur
  (`lib/fps/circulation.ts`), calculée à l'identique par le client et le serveur.
* **Toute logique dans des modules PURS testés** (vitest, Node 22) ; `jeu.ts` et `rendu*.ts` ne font que
  câbler. Aucun `Math.random` / `Date.now` dans un module pur (injectés).
* **`VERSION_PROTOCOLE` passe de 1 à 2.** Le serveur v2 est déployé sur un **second hôte** (`wss://pdj-fps-v2.toam.tech`) à côté du v1 (§7 lot Z) : les previews Vercel et la production se mettent à jour
  en changeant l'URL par défaut du client, et les clients v1 encore chargés continuent de parler au serveur v1. Un client v1 qui atteindrait un serveur v2 reçoit `erreur{code:"version"}` (« rechargez la page »).
* **Compatibilité de test** : tout champ ajouté à un message CLIENT est optionnel ; les alias
  `{t:"rejoindre", arme}` et `{t:"arme", arme}` restent acceptés (les tests existants les utilisent). Tout champ ajouté à un message SERVEUR déjà construit par des tests
  est optionnel ou n'est pas ajouté (`bienvenue` reste identique à la v1).
* **Découpage de `Salle` et de `jeu.ts`** : les gros fichiers sont découpés en modules (services Elsa/véhicules côté serveur, contrôleurs de killcam et de monde côté client) pour que chaque agent
  ait un périmètre tenable (§5.19, §5.20, §7).
* **Vocabulaire** : `bouclier` (nombre, PV de bouclier) ≠ `protege` (invulnérabilité d'apparition) ≠
  la bulle visuelle de protection de `rendu.ts`. Dans le code : `bouclier` pour les PV, `protege` pour
  l'invulnérabilité.
* Repère inchangé : x est, z sud, y haut ; pieds = `p` ; `lacet` 0 = regard vers −z. Le **cap d'un
  véhicule** suit la même convention que le lacet (avant = `(−sin cap, 0, −cos cap)`).

## 2. Décisions par demande

### 2.1 Courir plus vite, personnages plus gros (demande 1)

**Vitesse (≈ +40 %).** Chaîne de plafonds à tenir ensemble. Invariant testé :
`marche×mult ≤ sprint×mult(couteau) = 16,25 ≤ MOUV.vitesseMaxH (18) < PLAFONDS.vitesseHorizontaleMax (19) ≤ PLAFONDS.vitesseDeclareeMax (24)`.

| Constante | Avant | Après | Fichier |
|---|---|---|---|
| `MOUV.marche` | 6,5 | **9** | mouvement.ts |
| `MOUV.sprint` | 9 | **12,5** | mouvement.ts |
| `MOUV.accelSol` | 60 | **84** (sprint atteint en 0,149 s) | mouvement.ts |
| `MOUV.frictionSol` | 55 | 75 | mouvement.ts |
| `MOUV.frictionExces` | 22 | 30 | mouvement.ts |
| `MOUV.accelAir` | 12 | 16 | mouvement.ts |
| `MOUV.murVitesseEntreeMin` | 4 | 5,5 | mouvement.ts |
| `MOUV.murVitesse` | 8,5 | 10 | mouvement.ts |
| `MOUV.murVitesseMax` | 11 | 13 | mouvement.ts |
| `MOUV.vitesseMaxH` | 13,5 | **18** (> hypot(13 ; 6,5) = 14,5, test `ressenti`) | mouvement.ts |
| `VITESSE_MAX_H_M_S` (serveur) | 14 | **19** (= `PLAFONDS.vitesseHorizontaleMax`) | match.ts (lot 0) |
| `VITESSE_DECLAREE_MAX_H_M_S` | 20 | **24** | match.ts (lot 0) |
| `VITESSE_REFERENCE_M_S` (dispersion) | 6,5 | **9** | armes.ts |
| tolérance d'œil serveur (à pied) | `1,5 + 0,15·|v|` | `1,5 + 0,10·|v|` | match.ts (lot 0) |

Mesuré le 22/10 en appliquant ces constantes à une copie du dépôt : seuls trois tests v1 échouent (`mouvement.test.ts:77`,
`mouvement.test.ts:209` « pas d'accroche à 5 m/s » puisque `murVitesseEntreeMin` passe à 5,5, et `match.reseau.test.ts:97`) ; ils
sont listés en §8.

Le couteau (`COUTEAU.vitesse = 1,3`) multiplie marche et sprint : 11,7 et 16,25 m/s. Traversée est-ouest
(740 m) : 82 s → ≈ 59 s au sprint, ≈ 46 s au couteau. Les bornes de la carte ne changent pas.

**Personnages plus gros.** Constante `ECHELLE_AVATAR = 1,25` (protocole.ts). Le rendu agrandit l'avatar
de 1,25 autour des pieds (taille ≈ 2,25 m) ET la hitbox de tir est agrandie à l'identique ; **l'œil monte aussi** (1,62 → **1,95 m**,
accroupi 1,08 → **1,30 m**) pour qu'on ne soit pas touché en dépassant d'un muret sans pouvoir viser en retour (tête adverse à 2,0 m).
Le cylindre de collision au monde (`rayon` 0,4, `hauteur` 1,8) NE CHANGE PAS : `hauteur` n'est qu'une donnée du
cylindre de mouvement, pas la hauteur de l'œil.

| | Avant | Après |
|---|---|---|
| œil debout / accroupi / assis | 1,62 / 1,08 / – | **1,95 / 1,30 / 1,30** (`oeilDe`, protocole.ts) |
| tête (sphère) | y 1,6 · r 0,24 | **y 2,0 · r 0,30** |
| corps (capsule) | y 0,15→1,38 · r 0,38 | **y 0,19→1,73 · r 0,475** (< 0,5, test `tir`) |
| `centreY` (boule englobante) | `hauteur/2` = 0,9 | **1,05**, `rayonEnglobant` **1,45** (couvre le haut de la tête : 1,25 du centre) |
| tolérance de touche serveur | écart du rayon au CENTRE ≤ `TOLERANCE_RAYON_M` (1,2) | écart du rayon à l'**AXE** de la silhouette (5 points de `corps.y0` à `tete.y`) ≤ `TOLERANCE_RAYON_M` (1,2, inchangé) |

La tolérance de touche se mesure à l'axe de la silhouette et non plus à son centre : avec le centre à 1,05 m, une touche au sommet de la tête (y ≥ 2,28 m)
acceptée par `tracer` était refusée par `toucheVraisemblable` à 10, 30, 100 et 300 m (mesuré). Élargir la tolérance à 1,5 m aurait réglé ce cas mais cassé un test v1
(`match.reseau.test.ts:78` : une cible à 1,3 m du rayon doit être refusée) ; mesurer à l'axe laisse la tolérance horizontale à 1,2 m comme en v1. Vérifié sur une copie du dépôt : sommet de la tête accepté
aux quatre distances et tous les tests existants de `toucheVraisemblable` (0,7 m accepté, 2 m refusé, marge liée à la vitesse) et du serveur passent.

Lisibilité à distance (rendu.ts) : arêtes en `LineSegments2` (import statique de `three/examples/jsm/lines/LineSegments2.js`,
présent dans three 0.169 ; largeur 2 px ; `LineMaterial.resolution` réglée avec `renderer.getDrawingBufferSize` au
redimensionnement ; pas de repli : l'import est statique), faces à 24 % de la couleur
(avant 9 %), et **silhouette lointaine** : au-delà de 45 m, une barre verticale additive 0,5 × 2,2 m
(35 % de la couleur, `depthTest: true` donc masquée par les bâtiments) s'ajoute à l'avatar.

### 2.2 Pseudos seulement si le joueur est vu (demande 2)

**Cause réelle** (corrigée après revue) : le sprite du pseudo est déjà testé en profondeur (`rendu.ts`, `depthTest: true`, dessiné après les
bâtiments dont les faces écrivent la profondeur) : un mur le masque déjà. Ce que l'utilisateur voit en premier, c'est une **plaque de 24 px
de haut (≈ 130 px de large) à taille écran constante**, bien plus visible à 100 m qu'un avatar fin à faible opacité : le nom apparaît avant
le corps. Les mesures qui règlent le problème sont donc : plaque dégressive et plus courte portée, avatar plus lisible et silhouette lointaine (§2.1).
Le test de ligne de vue ci-dessous est un **complément** (il évite aussi la plaque à travers un angle de mur ou un feuillage dense), pas le correctif principal.

Module pur `lib/fps/visibilite.ts`. Un pseudo est affiché si, **simultanément** :
* distance œil→joueur ≤ `PSEUDO.distanceMax` = **70 m** (avant : visible à toute distance) ;
* le joueur est dans le champ de vision : `cos(angle regard, direction vers lui) ≥ PSEUDO.cosChamp` = **0,5** (60° de demi-angle,
  couvre la diagonale d'un 90° horizontal) ;
* **ligne de vue** : `visible(monde, oeil, point)` (collision.ts) vers la tête OU le torse (2 points :
  `p + (0, tete.y, 0)` et `p + (0, centreY, 0)`, abaissés si accroupi) ;
* le joueur est vivant et pas en vue de la caméra de mort.

Test **cadencé à 10 Hz** par joueur (phases décalées par hachage de l'id, ≤ 2 joueurs testés par image
en moyenne ⇒ ≤ 30 rayons/s), **fondu** : alpha monte en 0,15 s, descend en 0,10 s. La plaque n'a plus une taille écran
constante : 24 px de haut jusqu'à 30 m, décroissance en 1/distance jusqu'à 14 px à 55 m et au-delà (`hauteurPlaquePx`). La position testée est celle
**interpolée** du joueur (celle du rendu), l'œil est celui de la caméra courante (vivant ou killcam). Elsa suit la même règle.
**Critère visuel (capture)** : à 100 m, aucune plaque ; à 60 m, la plaque n'apparaît jamais avant les arêtes de l'avatar et jamais derrière un bâtiment.

### 2.3 Registre d'armes extensible (demande 3)

Un seul endroit décrit une arme : `STATS[id]` dans `armes.ts` (stats, catégorie, nom, description). Les listes
d'ids sont dans `protocole.ts` (types dérivés). Ajouter une arme = (1) l'id dans la bonne liste de
`protocole.ts`, (2) une entrée `STATS`, (3) une entrée `PLACEMENT_ARMES` / modèle dans `rendu.ts` et
`PROFILS_TIR` dans `sons.ts` et `TRACEURS` dans `traceurs.ts` (ces `Record<ArmeFeuId, …>` cassent la
compilation si on oublie : voulu). L'UI (lobby, HUD, barres de stats) est dérivée de `STATS`.
Catalogue (détail §4) : **principales** mitraillette, pompe, sniper + `fusil_assaut`, `mitrailleuse` ;
**secondaires** pistolet + `revolver`, `mini_uzi` ; **spéciales** (Elsa, munitions limitées, perdues à la
mort) `railgun`, `minigun`, `magnum_dore` ; **couteau** (hors `STATS`, objet `COUTEAU`). Toutes en
hitscan ; aucune arme à effet de zone.

### 2.4 Équipement, changement d'arme, couteau (demande 4)

* **Équipement** = `{principale, secondaire, speciale|null}` (+ couteau toujours présent). Choisi au
  lobby et à l'écran de mort (`equiper`), mémorisé dans `localStorage` `pdj-fps-equipement`
  (`{principale, secondaire}` ; migration de l'ancienne clé `pdj-fps-arme` : l'arme est rangée dans son
  slot par catégorie). **Chaque joueur a sa propre copie** de l'objet (`copierEquipement`) : `EQUIPEMENT_DEFAUT` est figé
  (`Object.freeze`) et n'est jamais affecté tel quel à un joueur (sinon le `speciale = …` d'Elsa ou le `speciale = null` de `infliger`
  modifierait tous les joueurs par défaut).
* **En jeu** : touches `1` principale, `2` secondaire, `3` couteau, `4` spéciale (si portée),
  `Q` = dernière arme (changement rapide), `V` = couteau rapide (rappuyer = retour), molette = slot
  suivant/précédent (saute les slots vides, comportement fixe). Messages `{t:"main", slot}`.
* **Temps de sortie** : `JEU.degainageMs = 350` (aucun tir ni recharge pendant ce délai ; la recharge en
  cours est annulée au changement). Le serveur applique une **tolérance de 30 %** (`TOLERANCE_DEGAINAGE = 0,7` : un tir est refusé
  seulement s'il arrive moins de 245 ms après `main`), car un paquet TCP en rafale peut faire arriver `tir` juste après `main`.
  Le serveur garde une cadence **par arme** (`cadenceArme`) pour qu'un
  aller-retour d'arme ne contourne pas la cadence du sniper.
* **Munitions** par arme gardées au changement (chargeur courant par `ArmeFeuId` ; chargeur plein à
  chaque apparition). Spéciales : `chargeur` = munitions totales, pas de rechargement (`sansRecharge`),
  l'arme disparaît à 0 et le joueur retombe sur le slot précédent.
* **Le serveur valide** que l'arme d'un `tir` est l'arme en main de l'équipement courant
  (`tir.arme === j.arme` et `j.main !== "couteau"`).
* **Cadence des armes rapides** (minigun 0,04 s, mini-uzi 0,06 s) : le client tire en **boucle** `while (t ≥ prochainTir)` bornée à 3 coups par image
  (à 30 images/s, un coup par image plafonnait le minigun à 15 tirs/s) ; le serveur accorde un crédit de rafale **en temps** :
  `max(CREDIT_RAFALE_AUTO × intervalle, 200 ms)` (3 intervalles du minigun ne font que 100 ms).
* **Couteau** : `COUTEAU = {degats 100, portee 2,2 m, margePortee serveur 0,6 m, cadenceS 0,5, vitesse 1,3, cone cos 55°}`.
  Message dédié `{t:"coup", o, d, cible}` (jamais `tir`), **périssable** comme `tir` (un coup en file ne se rejoue pas après une reconnexion).
  Validation serveur dans `melee.ts` : distance de **surface** (œil → axe de la capsule de la cible rejouée dans l'historique, moins
  `corps.rayon`) ≤ 2,2 + 0,6 ; cible dans le cône de 55° ; ligne de vue ; cadence 0,5 s ; cible vivante,
  non protégée. **Mêmes contrôles anti-triche que `recevoirTir`** : `o` et `d` bien formés, `o` à moins de `ECART_OEIL_M` (+ tolérance de vitesse) de l'œil
  connu, `d` de norme ≈ 1, cosinus de visée ≥ `COS_VISEE_MIN` (sinon un client truqué placerait `o` à côté de n'importe qui et tuerait partout).
  **Fenêtre de rejeu propre à la mêlée** : `REWIND_MELEE_MS = 200` (au lieu de `REWIND_MAX_MS = 300`, qui à 16-18 m/s ajouterait ≈ 5 m de portée effective).
  100 dégâts : tue un joueur sans bouclier ; avec bouclier 100, il en faut 2.
  Pas de traçante ni de recul ; animation de coup (avatars : message `coup` diffusé).

### 2.5 Killcam (demande 5)

**Rejeu à la première personne, 100 % client**, à partir des snaps déjà reçus.
* Un second `Interpolateur` à tampon long (**4000 ms**, `KILLCAM.tamponMs`) alimenté par tous les `snap` (le premier garde 1000 ms), et un
  `InterpolateurVehicules` à tampon long alimenté de même (les voitures conduisibles sont rejouées ; les voitures PNJ sont une
  fonction du temps, elles se calculent à l'instant rejoué sans tampon).
* **Horodatage de la mort** : le message `mort` porte `ts` (ms serveur, l'instant de la mort). C'est lui qui ancre le rejeu :
  `tMortServeur = m.ts` (le client ne connaît pas l'horloge serveur de l'événement ; le « dernier snap reçu » pouvait couper l'instant du kill ou le dépasser d'un RTT).
* **Gel du tampon** : le tampon long continue d'être alimenté **150 ms** après la réception de `mort` (`KILLCAM.gelApresMortMs`, le temps de recevoir le snap
  qui suit la mort), puis il est **gelé** (plus aucun `ajouter`, jusqu'à `apparition`). Sans cela, un tueur qui quitte ou est évincé pendant le rejeu disparaît du tampon
  (`Interpolateur.echantillon` retire les joueurs absents du dernier snap) et le rejeu perd son sujet.
* Si le tueur (`par`) est un joueur présent dans le tampon à `tMort − 2,5 s` ⇒ rejeu :
  la caméra est à l'œil du tueur (`cameraTueur` : `p + (0, oeilDe(tueur), 0)`, `lacet`, `tangage` ; **assis dans une voiture** : `p` est la position du siège,
  l'œil est à `OEIL_SIEGE`),
  on rejoue `[tMort − 2500, tMort]` à vitesse 1× avec TOUS les avatars du tampon (dont le nôtre, qu'on
  voit mourir ; l'avatar du tueur est masqué car on est dans sa tête), son arme en main (`armeEnMain` du
  tueur), ses voitures conduisibles interpolées par le tampon long et les voitures PNJ calculées avec `tempsRejeuServeur(k)` (jamais l'horloge courante).
  Les traçantes des tirs du tueur ne sont pas rejouées (les `tir` ne sont pas conservés ; bonus possible : tampon des `tir` reçus).
* **Rien du présent ne se superpose au passé** : pendant le rejeu, les effets en direct (traçantes, sons de tir, impacts, flashes, moteur des voitures,
  pseudos) sont coupés ; seuls les sons du rejeu sont autorisés.
* Puis **carte du tueur** (1,5 s) : pseudo + couleur, arme, distance, « tir à la tête » éventuel, **PV et
  bouclier restants** du tueur (`InfoTueur` du message `mort`), caméra figée sur son dernier état.
* Repli (tueur absent du tampon, déconnecté, mort par PNJ/écrasement sans tueur) : caméra de mort actuelle
  (effondrement) + carte seule (« Écrasé par la circulation »).
* **Délai de réapparition `JEU.delaiReapparitionMs` : 3000 → 4000** (2,5 s de rejeu + 1,5 s de carte ; 5 s dans la première version de cette spec,
  réduit parce que la demande vise un jeu plus rapide, cf. §11). **Espace** (action
  `passer` sans remappage, ou bouton « Passer ») saute le rejeu et va à la carte ; il ne raccourcit pas
  l'attente serveur. Le panneau de choix d'équipement est affiché en version compacte en bas pendant la killcam.
* Le HUD (PV/armes) est masqué pendant la killcam (grisé), bandes noires haut/bas 8 vh, barre de progression.

### 2.6 Régénération (demande 6) et bouclier

* Serveur seul : après **5 s** sans dégâts (`JEU.regenDelaiMs = 5000`), **+20 PV/s** (`JEU.regenPvParS = 20`)
  jusqu'à `pvMax` (100). `pv` reste un entier (accumulateur `regenAcc`). Le bouclier ne se régénère pas.
* Bouclier `0..JEU.bouclierMax` (100), **absorbe d'abord** les dégâts, transmis dans `snap.bouclier`,
  `degats.bouclier` et `apparition.bouclier`. À l'apparition : `pv = 100`, `bouclier = 0`.
* **`quitter` puis `rejoindre` en vie ne rend pas les PV, sans jamais refuser** (la version précédente refusait `rejoindre` 3 s sans aucun retour au client, qui
  attendait sans fin ; une éviction pour inactivité suivie du `reentrer()` immédiat de `jeu.ts` tombait dans ce piège). À `quitter` en vie, le serveur mémorise
  `memoSante = {pv, bouclier, sansDegatMs = maintenant − dernierDegatT, t}` ; si le même joueur `rejoindre` dans les `JEU.memoSanteMs` (60 s), `placer` restaure
  PV et bouclier (le temps passé dehors ne compte pas pour la régénération : `dernierDegatT = maintenant − sansDegatMs`), sinon apparition normale (100 PV). Un joueur mort
  qui quitte repart à 100 PV. L'arme spéciale n'est jamais restaurée.
* HUD : barre de PV + barre de bouclier (teinte `--ag-shield`, étiquette texte « Bouclier N »), étiquette
  « Régénération » (texte, pas la couleur seule) quand `pv < pvMax` et le délai est écoulé.

### 2.7 Elsa au Truck Muche (demande 7)

* Position : **(−120 ; 39)**, 5 m à l'est du POI `truck` (−125 ; 39) ; dégagement mesuré **16,7 m** du bâtiment le plus proche (`buildings[46]` ; le POI lui-même est à
  14,1 m de `buildings[116]`), hors eau. Calculée par `positionElsa(data)` à partir du POI (décalage +5 m en x).
* Minuteur serveur à intervalle aléatoire **20–50 s** (`alea` injecté ; surchargeable : `OptionsSalle.elsa.intervalle`, et côté `serveur-fps` les variables
  `PDJ_FPS_ELSA_MIN_MS` / `PDJ_FPS_ELSA_MAX_MS` pour des tests de bout en bout déterministes), actif seulement pendant la phase
  `jeu` avec ≥ 1 joueur en arène. Une offre dure **40 s** (25 s dans la première version : depuis le point d'apparition le plus éloigné, 281 m en ligne droite,
  il faut déjà 22,5 s à 12,5 m/s, marge nulle avec les détours) puis expire. Réinitialisée à chaque match.
* Contenu tiré à chaque offre : **40 % soin** (« PV à 100 + bouclier à 100 ») · **60 % arme spéciale**
  (uniforme sur `railgun`, `minigun`, `magnum_dore`, munitions = `STATS[arme].chargeur`).
* **Premier joueur à moins de 2,5 m** (horizontal, `|dy| < 3`), vivant, à pied, la prend ; autorité serveur
  (dans `tic`, aucun message client). Une arme spéciale remplace la précédente ; elle devient l'arme en main.
* Annonce : message `elsa` (apparue / prise / expirée) à tous → fil d'annonces « Elsa est au Truck Muche :
  <contenu> », + flèche et distance (arrondie à 10 m) vers Elsa pendant l'offre. **Synchronisation** : à chaque `rejoindre` accepté, le serveur envoie au seul joueur concerné
  `elsa{evenement:"etat"}` (état complet, offre en cours comprise) puis `sieges` ; `bienvenue` ne porte plus ces champs (la vue Palantir ne les affiche pas et le jeu
  est lancé après `bienvenue` : ce qu'un jeu lancé tard n'a pas vu se perdait). Visible dans la scène :
  Elsa (petit personnage fil de fer ambre, échelle 0,8, pseudo « Elsa » soumis à la règle de visibilité),
  caisse tournante + faisceau vertical additif de 60 m au-dessus de l'offre (`depthTest: true`).
* `{t:"ramassage", offre, par, genre, arme?}` diffusé à tous ; le bénéficiaire reçoit `equipement`.

### 2.8 S'accroupir (demande 8)

* Touche rebindable `accroupi` : **C** par défaut (second emplacement libre ; `Ctrl gauche` n'est plus le défaut : Ctrl+W ferme l'onglet et ne s'intercepte pas,
  Ctrl+1..4 change d'onglet en collision avec les touches d'armes, Ctrl+S/D/A déclenchent des raccourcis du navigateur). Case « maintenir /
  basculer » dans le menu pause (`localStorage` `pdj-fps-accroupi-bascule`, maintenir par défaut).
* Seulement **au sol** (pas en l'air, pas en wall-run) ; se relever est toujours possible (les bâtiments
  sont des prismes pleins : aucun plafond bas ; pas de blocage « si on ne peut pas »).
* Effets : vitesse ×**0,5** (`MOUV.accroupiMult`), dispersion ×**0,65** (base + mouvement, pas la chaleur), œil abaissé à
  **1,30 m** (lissé côté caméra, 12/s), silhouette et hitbox accroupies (`SILHOUETTE_ACCROUPIE`, §3).
* **Glissade (bonus, lot A)** : accroupi pressé au sol à ≥ 10,5 m/s ⇒ glisse 0,75 s. Elle a **son propre état** (`glisse: {t, v0, dir}`) et ne réutilise PAS la branche
  « excès de vitesse » de `accelererSol` (avec `frictionExces = 30`, 12,5 m/s retomberait en 0,2 s au lieu de 0,75 s, et sans entrée la friction à 75 la tuerait en 0,17 s) :
  pendant la glissade, `etape` impose `v(t) = vAccroupi + (v0 − vAccroupi)·(1 − t/0,75)²` dans la direction `dir` figée à l'entrée, sans accélération ni friction normales ;
  elle prend fin à 0,75 s, au saut ou si le joueur quitte le sol. Dispersion et hitbox accroupies.
* Réseau : `etat.accroupi?` (client) et `snap.accroupi?` ; le serveur ne l'accepte que si `posture === "sol"` et **l'enregistre dans `histo`** (le rejeu de
  `positionsCible` doit connaître la posture : un joueur qui vient de s'accroupir ne doit pas être touché à l'endroit où le tireur le voyait debout). `Posture` ne change pas.

### 2.9 Balles visibles (demande 9)

* **On garde le hitscan** : il n'y a et n'aura PAS de bullet drop (les dégâts sont instantanés). Ce que
  l'utilisateur voyait : une traçante de 0,08 s, tracée de la bouche (en bas à droite de l'écran) vers un
  point sur le rayon de l'œil, la dispersion aléatoire du cône (jusqu'à 4,5 m à 50 m) et la **chute de dégâts** avec la distance
  (`STATS[].chute`, qui n'est pas une chute de la balle). L'explication est
  affichée au lobby (« tir instantané, la balle ne chute pas ; le trait n'est que visuel ; les dégâts baissent avec la distance »). Si l'utilisateur veut une vraie balle
  physique avec chute, c'est une autre conception (simulation côté serveur), cf. §11.
* Nouveau rendu (`traceurs.ts` pur + `rendu.ts`) : un **segment lumineux qui VOYAGE** de la bouche du canon
  vers l'impact à vitesse visuelle (pistolet 200 m/s, mitraillette 220, fusil d'assaut 260, pompe 160,
  sniper 420, railgun 600…), en **mesh ruban** orienté caméra (≥ 3 px d'épaisseur écran, 0,04 m minimum),
  longueur 6–8 m (sniper 25 m), couleur de l'arme, **durée de vie ≥ 0,25 s** (`max(0,25 ; distance/vitesse + 0,12)`),
  traînée persistante pour sniper (1,0 s) et railgun (1,5 s).
* **Impacts plus marqués** : déclenchés à l'arrivée visuelle de la tête, 14 étincelles, anneau 0,9 m, bouffée de
  poussière 0,5 s. Tireur distant : le trait part de la **bouche de son avatar** (`positionBouche()`), plus de
  l'œil. Pool `TRACANTES` 48 → 96 ; le pompe en consomme 9 par tir.
* Les dégâts (PV, mort, fil des kills) restent instantanés alors que la traçante voyage : un joueur peut voir tomber la cible un peu avant l'arrivée visuelle
  de la balle sur longue distance (accepté, purement cosmétique).
* Aucun changement de protocole pour les traçantes.

### 2.10 Apparitions près du rond-point (demande 10)

* **Rond-point** : un seul, formé des 4 ways `roads[4, 120, 121, 122]` (classe M), centre **(28,2 ; 2,5)**, rayon
  **18,1 m**, sens antihoraire (sens français). Constante `ROND_POINT` + test qui le retrouve dans `scene.json`.
* **Réservoir** = `pointsApparition` filtrés à l'**anneau 25–140 m** autour du centre
  (`filtrerApparitions`) : **111 points** mesurés (612 sur la carte entière) ; ils se répartissent ainsi : 5 à < 40 m, 16 à < 60 m, 30 à < 80 m, 55 à < 100 m, 91 à < 130 m.
  Le chiffre « distance moyenne entre deux points » de la première version était trompeur (moyenne sur tous les points du jeu, pas la distance réelle d'apparition) ;
  la règle de choix ci-dessous est ce qui détermine la distance à l'ennemi.
* **Règle de choix** (`choisirPointZone`, zones.ts, pure) : parmi les points du réservoir dont la distance à l'**ennemi vivant le plus proche** est dans la **bande 40–110 m**,
  tirage uniforme avec `alea` (sans vivant : tirage uniforme dans le réservoir) ; si la bande contient moins de 3 points (ennemi hors de l'anneau, loin du rond-point), repli sur les
  **6 points dont la distance à l'ennemi le plus proche est la plus proche de 75 m**, tirage parmi eux. (La règle précédente « 6 plus éloignés des vivants » restait dominante et plaçait le joueur à
  225 m de l'ennemi en duel.) Mesure sur 3 000 tirages, distance **médiane** à l'ennemi le plus proche :

  | Ennemis vivants | v1 (612 points, 6 plus éloignés) | première version de la spec (anneau, 6 plus éloignés) | règle de bande + repli |
  |---|---|---|---|
  | 1 | 623 m | 229 m | **82 m** (133 m si l'ennemi est hors de l'anneau) |
  | 3 | 426 m | 156 m | **74 m** (90 m) |
  | 7 | 307 m | 109 m | **63 m** (80 m) |

  (ennemis tirés dans l'anneau ; entre parenthèses, ennemis tirés n'importe où sur la carte.)
* **Voitures PNJ (obligatoire)** : les points à moins de **4 m** d'un circuit PNJ sont écartés du réservoir (`ecarterDesCircuits`, circulation.ts, appliqué dans le
  constructeur de `Salle` quand `options.circulation` est présent ; ignoré s'il laisse moins de 30 points). Mesuré sur les axes bruts des circuits : **46 des 111 points (41 %)**
  en sont à moins de 4 m, alors que les voitures sont mortelles dès 6 m/s ; à recompter avec les lignes décalées (test).
* Regard à l'apparition : vers le centre du rond-point, `± 0,6 rad` tiré avec `alea` (évite le face-à-face
  systématique). Sans `options.zoneApparition` le comportement v1 est inchangé (tests v1 intacts).
* Protection d'apparition 1,5 s conservée. **Caméra de survol avant la première apparition** : centrée sur le rond-point (`jeu.ts` la place aujourd'hui sur `focus`).

### 2.11 Voitures PNJ (demande 11)

* **4 circuits fermés** (annexe §10), 12 voitures : anneau 3, sud 2, nord-est 3, ouest 4. **Vitesse unique 9 m/s** pour les quatre circuits (ils partagent des arcs de l'anneau :
  des vitesses différentes faisaient se traverser les voitures). Les voitures d'un circuit sont espacées de `L/n` (pas de dépassement). Environ une voiture traverse le nœud est du
  rond-point toutes les 2,6 s : c'est là que se concentre le danger.
* Position : `s = (s0 + v·(t − T0)) mod L` avec `t` = horloge serveur (ms), `T0 = 1 700 000 000 000` ; décalage
  de voie à droite (`decalageVoie` : anneau 3,2 m ; autres 1,5 m ; sud 0,6 m, passage étroit de 2,7 m en (11 ; 81)), **jonctions en mitre bornée** aux coins (jusqu'à 100° sur
  `sud` et `nord_est`) et **cap lissé** : le cap est la direction de la corde entre `s − 2 m` et `s + 2 m` (un cap égal à la tangente d'une polyligne a des sauts de 100° aux coins).
  Voiture 4,4 × 1,9 × 1,5 m.
* **Écrasement** (serveur, dans `tic`, 60 Hz) : joueur vivant, à pied, non protégé, **pieds sous 1,6 m**, cylindre
  (r 0,4) recoupant la boîte orientée de la voiture, **sans marge** (la marge de 0,3 m de la première version était un biais défavorable au joueur) ⇒ **mort immédiate**
  (bouclier ignoré), `mort{par:"", cause:"ecrase_pnj"}`, `morts++` pour la victime, aucun kill.
* **Équité (ce que le joueur voit, c'est ce qui le touche)** : le client dessine la voiture à `client.maintenantServeur()` (sans retard d'interpolation) et reporte sa position `p`
  capturée à cet instant ; `p` arrive au serveur ≈ `ping/2` plus tard. Le serveur teste donc chaque joueur avec **son propre instant** : `tMs = j.etatT − j.ping/2`
  (instant de capture estimé de `p`), jamais l'instant courant (sinon 50 à 100 ms de décalage = 0,5 à 1 m à 9 m/s, une demi-largeur de voiture : le joueur esquive à l'écran et meurt quand même).
* Client : les voitures sont dessinées d'après la même fonction avec `client.maintenantServeur()`.
  Aucun message réseau. Test d'accord client/serveur : `etatVoiture(circuit, v, t)` identique à l'octet.

### 2.12 Voitures conduisibles (demande 12)

* **6 voitures** garées sur `parkings[3]` (annexe §10), à 33–54 m du rond-point. Indestructibles ; leurs occupants sont
  touchables (hitbox accroupie à la position du siège). Réinitialisées à leur place au début de chaque
  match, et si **inoccupées et déplacées depuis ≥ 60 s**.
* **E** (action `interagir`, rebindable) : demande d'entrée (voiture à ≤ 3,5 m de la boîte, siège libre le plus bas, 0 =
  conducteur) / sortie. **F** (`siege`) change de place. Le serveur attribue le siège.
* **Protocole des places** : `monter` → le serveur répond au demandeur par `embarque{vehicule, siege, p, cap}` (état de la voiture pour démarrer la simulation ou le suivi) et diffuse
  `sieges` ; refus → `refus{action:"monter", raison:"loin"|"plein"|"deja"|"inconnu"|"mort"}` (jamais `erreur` : le serveur ferme la socket sur tout message `erreur`) ; `siege` → `embarque` ou
  `refus{action:"siege"}` ; `descendre` → `descente{raison:"volontaire"}`. Le client reste en « embarquement » (`HudEtat.embarquement`) au plus 1 s, sans autre effet, en attendant la réponse.
* **Libération d'un siège** (`Garage.liberer`) dans tous ces cas : descente volontaire, **mort** de l'occupant (éjecté), `quitter`, **déconnexion** (`Salle.deconnecter`), éviction pour
  inactivité, nouveau match (`descente{raison:"expulse"}`). Dans chaque cas où le **conducteur** part, la voiture est arrêtée (`v = 0`) ; si le conducteur se tait plus de 500 ms
  (client gelé), le serveur remet aussi `v = 0` ; `sieges` est diffusé. Sans cela la voiture serait extrapolée 150 ms puis fantôme.
* **Physique arcade PURE** (`vehicule.ts`) : accélération 14 m/s², vitesse max avant 24, arrière 8, freinage 28,
  frottement 3, braquage max 0,55 rad à basse vitesse (réduit avec la vitesse), adhérence latérale. Collisions
  bâtiments par 3 cercles de rayon 1,0 le long de l'axe (via `resoudre`), la vitesse perd la composante normale.
* **Autorité** : le conducteur simule en local et envoie `conduite` à 30 Hz (REMPLACE `etat` ; budget 90 msg/s) ;
  le serveur borne : `dh ≤ PLAFONDS.vitesseVehiculeMax (28) × dt + 1`, bornes de la carte, pas dans un bâtiment
  (pénétration max 0,6 m), **`y` imposé à 0** (le conducteur envoie `p[1]`, le serveur l'ignore : `resoudre` ne voit aucun prisme quand `y ≥ h − 0,05`, un conducteur pourrait sinon
  rouler sur un toit avec ses passagers). Les passagers continuent d'envoyer `etat` à 15 Hz mais le serveur n'en retient QUE
  `lacet`/`tangage`/`etatT` ; leur `p` = position du siège (recalculée à chaque `conduite` et à chaque tic) **et leur `v` = vecteur vitesse de la voiture** (cap × v), sinon leur tolérance
  d'œil (`1,5 + 0,10·|v|`) et la marge de touche qu'ils reçoivent comme cibles (`1,2 + 0,2·v`) restent celles d'un joueur immobile.
* **Tir** : tous les occupants **sauf le conducteur** tirent avec leur arme en main (`CONDUCTEUR_TIRE = false`,
  constante) ; œil du siège = position du siège + `OEIL_SIEGE` ; le conducteur peut changer d'arme mais le tir est refusé
  (viseur grisé « Conduite »). **Validation de l'œil d'un passager** : il voit sa voiture interpolée (110 ms de retard + descente réseau) et envoie `tir.o` depuis ce point, soit 3 à 4 m
  d'écart à 24 m/s avec l'état le plus récent du serveur. Le serveur accepte donc `o` s'il est à moins de `ECART_OEIL_M` d'**un** des yeux possibles du siège sur l'historique du véhicule
  (`Garage.yeuxPossibles(joueur, maintenant, REWIND_MAX_MS)`), comme `positionsCible` le fait pour les cibles.
* **Historique des véhicules** : `Garage` garde, par voiture, les états reçus des `HISTORIQUE_MS` dernières ms (`{t, p, cap, v}`) et sait reconstituer l'état à un instant (`etatAu`) et
  mesurer la vitesse (`vitesseMesuree`, déplacement entre états sur ≈ 100 ms).
* **Renversement** : voiture ≥ 6 m/s (`VEH.vitesseRenverse`, comparée à la **vitesse mesurée par le serveur**, jamais au `v` déclaré : une voiture immobile déclarant 24 m/s tuerait
  tout ce qui la touche) qui touche un joueur à pied vivant, non protégé, non
  occupant ⇒ mort, kill crédité au conducteur, `cause:"ecrase_vehicule"`. **Équité** : la victime voit la voiture interpolée à `maintenantServeur() − interpolationMs`, le serveur teste donc
  la position `p` du piéton (capturée à `j.etatT − j.ping/2`) contre l'état de la voiture à `tMs − JEU.interpolationMs` (`etatAu`), sans marge. Un occupant n'est jamais écrasé
  par sa voiture. Les balles traversent les carrosseries (aucune cible voiture dans `tracer`).
* La mort d'un occupant l'éjecte (siège libéré). Un conducteur qui descend laisse la voiture à l'arrêt (v = 0).
* Interpolation des voitures côté client : `InterpolateurVehicules` (110 ms de retard, comme les joueurs), avec détection des **sauts** (remise en place à 60 s ou au nouveau match : un écart
  de position supérieur à `PLAFONDS.vitesseVehiculeMax × Δt + 3 m` entre deux échantillons n'est pas interpolé).

## 3. `lib/fps/protocole.ts` — fichier cible complet

Remplace le fichier actuel. Rupture : `ArmeId` s'élargit (11 armes + couteau), `Posture` inchangé, `JEU` et
`SILHOUETTE` étendus, nouveaux messages. Commentaires de tête conservés. **Ce bloc a été vérifié par
`tsc --noEmit` isolé (v2, après la revue du 23/10).** `bienvenue` reste identique à la v1 (aucun champ obligatoire ajouté : `reseau.test.ts`,
qui construit des `MessageServeur` littéraux, compile sans modification).

<!-- PROTOCOLE-DEBUT -->
```ts
/**
 * Arène FPS de la vue Palantir : types partagés client ↔ serveur (PUR, aucun import three ni DOM).
 * Messages JSON sur WebSocket, champ `t` = type. Repère de scene.json : x vers l'est, z vers le
 * sud, y vers le haut, en mètres. Une position de joueur = ses PIEDS. Angles en radians :
 * `lacet` (yaw) autour de y, 0 = regard vers −z (convention three : caméra.rotation.y),
 * `tangage` (pitch) dans [−π/2, π/2], positif = regard vers le haut. Le `cap` d'un véhicule suit
 * la même convention que le lacet.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md (v1), 2026-10-22-arene-v2-design.md (v2)
 */

/** v2 : équipement, couteau, bouclier, accroupi, Elsa, véhicules, killcam. Client et serveur se déploient ensemble. */
export const VERSION_PROTOCOLE = 2;

export type Vec3 = [number, number, number];

// ---------- armes ----------

/** Armes à feu par catégorie. Ajouter une arme = ajouter son id ici + une entrée STATS (lib/fps/armes.ts). */
export const ARMES_PRINCIPALES = ["mitraillette", "pompe", "sniper", "fusil_assaut", "mitrailleuse"] as const;
export const ARMES_SECONDAIRES = ["pistolet", "revolver", "mini_uzi"] as const;
/** Armes spéciales : offertes par Elsa, munitions limitées, perdues à la mort. */
export const ARMES_SPECIALES = ["railgun", "minigun", "magnum_dore"] as const;

export type ArmePrincipaleId = (typeof ARMES_PRINCIPALES)[number];
export type ArmeSecondaireId = (typeof ARMES_SECONDAIRES)[number];
export type ArmeSpecialeId = (typeof ARMES_SPECIALES)[number];
/** Toute arme à feu (a une entrée dans STATS). */
export type ArmeFeuId = ArmePrincipaleId | ArmeSecondaireId | ArmeSpecialeId;
/** Arme en main : une arme à feu ou le couteau (mêlée, voir COUTEAU dans armes.ts). */
export type ArmeId = ArmeFeuId | "couteau";

/** Toutes les armes à feu (principales, secondaires puis spéciales). */
export const ARMES: readonly ArmeFeuId[] = [...ARMES_PRINCIPALES, ...ARMES_SECONDAIRES, ...ARMES_SPECIALES];

/** Emplacement d'équipement. `couteau` est toujours disponible, `speciale` seulement si portée. */
export type Slot = "principale" | "secondaire" | "couteau" | "speciale";
export const SLOTS: readonly Slot[] = ["principale", "secondaire", "couteau", "speciale"];

/** Équipement d'un joueur (le couteau est implicite). */
export interface Equipement {
  principale: ArmePrincipaleId;
  secondaire: ArmeSecondaireId;
  speciale: ArmeSpecialeId | null;
}
/**
 * Équipement et slot quand le joueur n'a rien choisi (compatibilité des tests v1 : pistolet en main).
 * FIGÉ : jamais affecté tel quel à un joueur (Elsa et `infliger` écrivent dans `speciale`) ; utiliser `copierEquipement`.
 */
export const EQUIPEMENT_DEFAUT: Readonly<Equipement> = Object.freeze({
  principale: "mitraillette" as ArmePrincipaleId, secondaire: "pistolet" as ArmeSecondaireId, speciale: null as ArmeSpecialeId | null,
});
export const SLOT_DEFAUT: Slot = "secondaire";
/** Copie modifiable d'un équipement (une par joueur). */
export function copierEquipement(e: Readonly<Equipement>): Equipement {
  return { principale: e.principale, secondaire: e.secondaire, speciale: e.speciale };
}

/** Zone touchée : la tête multiplie les dégâts (cf. lib/fps/armes.ts). */
export type Zone = "tete" | "corps";

/** Posture transmise pour l'animation des avatars distants. L'accroupi est un booléen à part. */
export type Posture = "sol" | "air" | "mur" | "mort";

/** Côté du mur pendant un wall-run (pour pencher l'avatar distant). */
export type CoteMur = -1 | 0 | 1;

/** Siège d'un véhicule : 0 = conducteur, 1 à 3 = passagers. */
export type Siege = 0 | 1 | 2 | 3;
export const SIEGES_PAR_VEHICULE = 4;

/** Comment un joueur est mort. `arme` d'un message `mort` n'a de sens que pour la cause "arme". */
export type CauseMort = "arme" | "ecrase_pnj" | "ecrase_vehicule";

// ---------- données publiques ----------

/** Joueur tel que vu par tout le monde (présence + tableau des scores). */
export interface JoueurPublic {
  id: string;
  pseudo: string;
  /** couleur hex "#rrggbb" attribuée par le serveur */
  couleur: string;
  /** dans l'arène (sinon simple spectateur de la vue Palantir) */
  enJeu: boolean;
  kills: number;
  morts: number;
  /** ms, dernière mesure */
  ping: number;
}

/** Véhicule conduisible occupé par un joueur (dans le snap du joueur). */
export interface OccupationVehicule { id: number; siege: Siege }

/** État d'un joueur en jeu dans un instantané (≈ 20 Hz). */
export interface EtatJoueurSnap {
  id: string;
  p: Vec3;
  v: Vec3;
  lacet: number;
  tangage: number;
  posture: Posture;
  mur: CoteMur;
  /** arme EN MAIN (les distants changent d'arme sans autre message) */
  arme: ArmeId;
  pv: number;
  /** PV de bouclier, 0..JEU.bouclierMax ; absent = 0 */
  bouclier?: number;
  /** accroupi (au sol) ; absent = debout */
  accroupi?: boolean;
  /** assis dans un véhicule : `p` est alors la position du siège */
  vehicule?: OccupationVehicule;
  vivant: boolean;
  /** invulnérable (protection d'apparition) */
  protege: boolean;
}

/** Véhicule conduisible dans le snap (positions au centime). `v` = vitesse signée le long du cap (m/s). */
export interface VehiculeSnap { id: number; p: Vec3; cap: number; v: number }
/** Occupation des sièges (diffusée au changement, et envoyée au seul joueur concerné à `rejoindre`), `null` = siège libre. */
export interface InfoVehicule { id: number; sieges: (string | null)[] }

/** Cadeau d'Elsa. `arme` seulement pour le genre "arme". */
export interface OffreElsa { id: number; genre: "soin" | "arme"; arme?: ArmeSpecialeId; finT: number }
/** Elsa : position fixe, offre en cours ou null. `finT` = horodatage serveur (ms). */
export interface EtatElsaMsg { x: number; z: number; offre: OffreElsa | null }

/** Photographie du tueur à l'instant de la mort (killcam : carte finale et repli si le tueur a quitté). */
export interface InfoTueur {
  id: string;
  pseudo: string;
  couleur: string;
  p: Vec3;
  lacet: number;
  tangage: number;
  arme: ArmeId;
  /** PV et bouclier restants du tueur */
  pv: number;
  bouclier: number;
  /** distance tueur → victime (m) */
  distance: number;
}

export interface InfoMatch {
  /** identifiant croissant du match */
  numero: number;
  /** horodatage serveur (ms epoch) de fin prévue ; null pendant l'entracte */
  fin: number | null;
  /** kills pour gagner */
  objectif: number;
  /** "jeu" ou "entracte" (classement affiché, nouveau match à `prochain`) */
  phase: "jeu" | "entracte";
  /** horodatage serveur du prochain match pendant l'entracte */
  prochain: number | null;
}

export interface LigneClassement { id: string; pseudo: string; couleur: string; kills: number; morts: number }

// ---------- client → serveur ----------

export type MessageClient =
  /** Premier message obligatoire : présence dans la vue Palantir (spectateur). */
  | { t: "bonjour"; v: number; pseudo: string }
  /**
   * Entrer dans l'arène. `principale`/`secondaire` = équipement (v2). `arme` = ALIAS v1 : l'arme est rangée dans
   * son slot par catégorie et devient l'arme en main (une spéciale est ignorée).
   */
  | { t: "rejoindre"; principale?: ArmePrincipaleId; secondaire?: ArmeSecondaireId; arme?: ArmeFeuId }
  /** Changer de pseudo (lobby ou en pleine partie) : le serveur le nettoie, le dédoublonne et renvoie la présence. */
  | { t: "pseudo"; pseudo: string }
  /** Sortir de l'arène (redevient spectateur). */
  | { t: "quitter" }
  /** ALIAS v1 : arme pour la prochaine apparition (immédiate si mort). Préférer `equiper`. */
  | { t: "arme"; arme: ArmeFeuId }
  /** Équipement de la prochaine apparition (immédiat si mort). */
  | { t: "equiper"; principale: ArmePrincipaleId; secondaire: ArmeSecondaireId }
  /** Changer d'arme en main (en vie). Refusé si le slot est vide. */
  | { t: "main"; slot: Slot }
  /** État prédit localement, ≈ 30 Hz. `seq` croissant. Dans un véhicule : seuls lacet/tangage comptent (passager). */
  | {
      t: "etat"; seq: number; p: Vec3; v: Vec3; lacet: number; tangage: number; posture: Posture; mur: CoteMur;
      accroupi?: boolean;
    }
  /**
   * Un tir (une pression de détente ; plusieurs plombs pour le fusil à pompe). Le couteau n'utilise PAS `tir`.
   * `o` = œil du tireur, `d` = direction normalisée de chaque plomb (1 pour les autres armes),
   * `touches` = plombs qui ont touché un joueur selon le client (index dans `d`).
   */
  | { t: "tir"; arme: ArmeFeuId; o: Vec3; d: Vec3[]; touches: { cible: string; zone: Zone; plomb: number }[] }
  /** Coup de couteau. `cible` = joueur touché selon le client (null = coup dans le vide). */
  | { t: "coup"; o: Vec3; d: Vec3; cible: string | null }
  /** Monter dans un véhicule ; `siege` facultatif (sinon le plus bas libre). */
  | { t: "monter"; vehicule: number; siege?: Siege }
  | { t: "descendre" }
  /** Changer de siège dans le véhicule. */
  | { t: "siege"; siege: Siege }
  /** État du véhicule, ≈ 30 Hz, envoyé par le CONDUCTEUR seulement (remplace `etat`). */
  | { t: "conduite"; seq: number; vehicule: number; p: Vec3; cap: number; v: number; lacet: number; tangage: number }
  | { t: "ping"; t0: number };

// ---------- serveur → client ----------

export type MessageServeur =
  | { t: "bienvenue"; id: string; couleur: string; joueurs: JoueurPublic[]; match: InfoMatch; maintenant: number }
  /** Liste complète des connectés, renvoyée à chaque changement (arrivée, départ, score, entrée/sortie d'arène). */
  | { t: "presence"; joueurs: JoueurPublic[] }
  /** Instantané des joueurs en jeu ; `ts` = horodatage serveur ms. `vehicules` = véhicules conduisibles. */
  | { t: "snap"; ts: number; j: EtatJoueurSnap[]; vehicules?: VehiculeSnap[] }
  /**
   * Apparition (ou réapparition) d'un joueur : le client concerné SE TÉLÉPORTE à `p`. `arme` = arme en main.
   * Après `rejoindre`, le serveur envoie dans l'ordre : `apparition`, `presence` (à tous), puis au seul joueur `elsa{evenement:"etat"}` et `sieges`
   * (le jeu est lancé après `bienvenue` : il n'a rien vu de l'état d'Elsa ni des sièges).
   */
  | {
      t: "apparition"; id: string; p: Vec3; lacet: number; arme: ArmeId; pv: number; bouclier: number;
      equip: Equipement; main: Slot; munSpeciale: number;
    }
  /** Équipement du destinataire (ramassage d'une spéciale, munitions épuisées). Privé. */
  | { t: "equipement"; equip: Equipement; main: Slot; munSpeciale: number }
  /** Tir d'un autre joueur, pour les traçantes et le son (pas renvoyé au tireur). */
  | { t: "tir"; id: string; arme: ArmeFeuId; o: Vec3; d: Vec3[] }
  /** Coup de couteau d'un autre joueur (animation et son). */
  | { t: "coup"; id: string; o: Vec3; d: Vec3 }
  /** `bouclier` = bouclier restant de la cible ; `src` = position de la source (angle du marqueur de dégât). */
  | { t: "degats"; cible: string; par: string; degats: number; pv: number; bouclier: number; zone: Zone; src?: Vec3 }
  /**
   * `par` = "" si aucun joueur (écrasé par une voiture PNJ). `arme` n'a de sens que pour cause "arme"
   * (mettre "couteau" sinon). `tueur` absent si `par` est "". `ts` = horodatage serveur (ms) de la mort : il ancre le rejeu de la killcam.
   */
  | {
      t: "mort"; cible: string; par: string; arme: ArmeId; cause: CauseMort; zone: Zone; ts: number;
      /** ms avant réapparition */ delai: number; tueur?: InfoTueur;
    }
  | { t: "match"; match: InfoMatch; classement: LigneClassement[] }
  /** Elsa : offre apparue, prise ou expirée ; état complet à chaque fois. `etat` = synchronisation privée envoyée à `rejoindre`. */
  | { t: "elsa"; evenement: "etat" | "apparue" | "prise" | "expiree"; elsa: EtatElsaMsg }
  /** Un joueur a pris le cadeau d'Elsa (annonce pour tous). */
  | { t: "ramassage"; offre: number; par: string; genre: "soin" | "arme"; arme?: ArmeSpecialeId }
  /** Occupation des sièges de tous les véhicules (au changement, et à `rejoindre` au seul joueur concerné). */
  | { t: "sieges"; vehicules: InfoVehicule[] }
  /** Réponse à `monter` / `siege` acceptés : siège attribué et état de la voiture à rejoindre. Privé. */
  | { t: "embarque"; vehicule: number; siege: Siege; p: Vec3; cap: number }
  /** Réponse à `monter` / `siege` refusés (jamais `erreur` : le serveur ferme la socket sur tout message `erreur`). Privé. */
  | { t: "refus"; action: "monter" | "siege"; raison: "loin" | "plein" | "deja" | "inconnu" | "mort" }
  /** Le destinataire n'est plus dans un véhicule : il se téléporte à `p` (sortie, expulsion). Privé. */
  | { t: "descente"; p: Vec3; lacet: number; raison: "volontaire" | "expulse" }
  | { t: "pong"; t0: number; maintenant: number }
  | { t: "erreur"; code: "plein" | "version" | "pseudo" | "flood"; message: string };

// ---------- constantes ----------

/** Constantes de jeu partagées client/serveur. */
export const JEU = {
  pvMax: 100,
  /** PV de bouclier maximum (bonus d'Elsa) */
  bouclierMax: 100,
  /** 2,5 s de rejeu + 1,5 s de carte du tueur */
  delaiReapparitionMs: 4000,
  protectionMs: 1500,
  dureeMatchMs: 8 * 60_000,
  objectifKills: 25,
  entracteMs: 12_000,
  joueursMax: 16,
  /** fréquence des instantanés serveur */
  snapHz: 20,
  /** fréquence d'envoi de l'état client (et de `conduite`) */
  etatHz: 30,
  /** fréquence d'envoi de `etat` par un passager de véhicule */
  etatPassagerHz: 15,
  /** retard d'interpolation des joueurs distants */
  interpolationMs: 110,
  /** régénération : délai sans dégât (ms) puis PV par seconde */
  regenDelaiMs: 5000,
  regenPvParS: 20,
  /** temps de sortie d'une arme au changement (ms) */
  degainageMs: 350,
  /** durée (ms) pendant laquelle PV et bouclier d'un joueur qui a quitté en vie sont restaurés à son retour (pas de soin gratuit) */
  memoSanteMs: 60_000,
} as const;

/** Plafonds de vitesse validés par le serveur (m/s). Invariant : MOUV.vitesseMaxH < vitesseHorizontaleMax ≤ vitesseDeclareeMax. */
export const PLAFONDS = {
  vitesseHorizontaleMax: 19,
  vitesseDeclareeMax: 24,
  vitesseVerticaleMax: 45,
  vitesseVehiculeMax: 28,
} as const;

/** Les avatars sont dessinés et touchés à cette échelle (autour des pieds). Le cylindre de collision ne change pas. */
export const ECHELLE_AVATAR = 1.25;

/**
 * Silhouette : `rayon`/`hauteur`/`oeil` = cylindre de MOUVEMENT et œil (collision au monde, jamais agrandi) ;
 * `tete`/`corps`/`centreY`/`rayonEnglobant` = HITBOX de tir (pieds en p, tête = sphère, corps = capsule verticale).
 */
export interface Silhouette {
  readonly rayon: number;
  readonly hauteur: number;
  readonly oeil: number;
  /** hauteur du centre de la boule englobante de la hitbox */
  readonly centreY: number;
  readonly rayonEnglobant: number;
  readonly tete: { readonly y: number; readonly rayon: number };
  readonly corps: { readonly y0: number; readonly y1: number; readonly rayon: number };
}

export const SILHOUETTE: Silhouette = {
  rayon: 0.4,
  hauteur: 1.8,
  oeil: 1.95,
  centreY: 1.05,
  rayonEnglobant: 1.45,
  tete: { y: 2.0, rayon: 0.3 },
  corps: { y0: 0.19, y1: 1.73, rayon: 0.475 },
};

/** Même silhouette accroupie (ou assis dans un véhicule). */
export const SILHOUETTE_ACCROUPIE: Silhouette = {
  rayon: 0.4,
  hauteur: 1.2,
  oeil: 1.3,
  centreY: 0.8,
  rayonEnglobant: 1.15,
  tete: { y: 1.3, rayon: 0.3 },
  corps: { y0: 0.19, y1: 1.0, rayon: 0.475 },
};

export function silhouetteDe(accroupi: boolean | undefined): Silhouette {
  return accroupi ? SILHOUETTE_ACCROUPIE : SILHOUETTE;
}

/** Hauteur de l'œil assis dans un véhicule (m au-dessus de `p`, la position du siège). */
export const OEIL_SIEGE = 1.3;

/** Hauteur de l'œil d'un joueur : assis (`vehicule` défini), accroupi ou debout. SEULE source pour caméra, serveur, killcam et visibilité. */
export function oeilDe(e: { accroupi?: boolean; vehicule?: unknown }): number {
  return e.vehicule ? OEIL_SIEGE : silhouetteDe(e.accroupi).oeil;
}
```
<!-- PROTOCOLE-FIN -->

Delta résumé : `ArmeId` 4 → 11 + `couteau` ; `ARMES` = 11 armes à feu ; ajoutés `Slot`, `Equipement`, `copierEquipement`, `Siege`,
`CauseMort`, `InfoTueur`, `OffreElsa`, `EtatElsaMsg`, `VehiculeSnap`, `InfoVehicule`, `OccupationVehicule`,
`PLAFONDS`, `ECHELLE_AVATAR`, `Silhouette`, `SILHOUETTE_ACCROUPIE`, `silhouetteDe`, `OEIL_SIEGE`, `oeilDe` ; messages client `equiper`, `main`,
`coup`, `monter`, `descendre`, `siege`, `conduite` ; messages serveur `equipement`, `coup`, `elsa`, `ramassage`, `sieges`,
`embarque`, `refus`, `descente` ; champs ajoutés à `rejoindre`, `etat`, `snap`, `apparition`, `degats`, `mort` (`cause`, `ts`), `EtatJoueurSnap` (`bienvenue` inchangé) ;
`JEU` : `bouclierMax`, `delaiReapparitionMs` 3000→4000, `etatPassagerHz`, `regenDelaiMs`, `regenPvParS`, `degainageMs`,
`memoSanteMs` ; `SILHOUETTE` : hitbox agrandie (+ `centreY`, `rayonEnglobant`) et **œil 1,62 → 1,95** (accroupi 1,30), `rayon`/`hauteur` inchangés.
Le champ `tir.arme` côté client est typé `ArmeFeuId` : le couteau ne passe jamais par `tir`. Conséquence pour `tsc` : les tests v1 qui annotent une arme en `ArmeId`
(`match.test.ts:30, 50, 155`) doivent passer en `ArmeFeuId` (lot 0, §7) ; mesuré le 23/10 : ce sont les seules erreurs de type des fichiers de test.

## 4. Registre d'armes — `lib/fps/armes.ts` cible

Modifications de l'`interface Arme` et du fichier :

```ts
import type { ArmeFeuId, ArmeId, Vec3, Zone } from "./protocole";

export type CategorieArme = "principale" | "secondaire" | "speciale";

export interface Arme {
  id: ArmeFeuId;
  nom: string;
  /** libellé court pour le HUD (≤ 10 caractères) */
  nomCourt: string;
  categorie: CategorieArme;
  /** une phrase pour le lobby */
  description: string;
  degats: number; multTete: number; plombs: number; cadenceS: number; auto: boolean;
  /** chargeur ; pour une arme `sansRecharge` : munitions TOTALES offertes */
  chargeur: number;
  rechargeS: number;
  /** pas de rechargement : l'arme disparaît à 0 munition (armes spéciales) */
  sansRecharge: boolean;
  dispersion: { base: number; mouvement: number; air: number; parTir: number; max: number; retourS: number; viseur?: number };
  recul: { tangage: number; lacet: number };
  portee: number;
  chute: { debut: number; fin: number; min: number };
  vitesse: number;
  zoom: number | null;
}

/** Multiplicateur de la dispersion (base + mouvement) quand on est accroupi. */
export const MULT_DISPERSION_ACCROUPI = 0.65;
/** Vitesse horizontale (m/s) à partir de laquelle la dispersion de mouvement est maximale (= MOUV.marche). */
export const VITESSE_REFERENCE_M_S = 9;

export const COUTEAU = {
  id: "couteau" as const,
  nom: "Couteau",
  nomCourt: "Couteau",
  description: "Course bien plus rapide ; un coup au corps à corps tue un joueur sans bouclier.",
  degats: 100,
  /** portée annoncée (m, de la surface de la cible) et marge supplémentaire acceptée par le serveur */
  portee: 2.2,
  margePortee: 0.6,
  cadenceS: 0.5,
  /** multiplicateur de marche ET de sprint */
  vitesse: 1.3,
  /** cosinus du demi-angle du cône de frappe (55°) */
  cosCone: 0.574,
} as const;

export const STATS: Record<ArmeFeuId, Arme> = { /* tableau ci-dessous */ };

/** Multiplicateur de déplacement de l'arme en main (couteau compris). */
export function vitesseArme(id: ArmeId): number { return id === "couteau" ? COUTEAU.vitesse : STATS[id].vitesse; }
export function nomArme(id: ArmeId): string { return id === "couteau" ? COUTEAU.nom : STATS[id].nom; }
```

* Les fonctions existantes (`multiplicateurChute`, `degatsPlomb`, `dispersionCourante`, `apresTir`,
  `delaiRefroidissement`, `delaiRecul`, `refroidir`, `directionsTir`) passent leur paramètre `arme` en `ArmeFeuId`.
* `dispersionCourante(arme, ctx)` : `ctx` gagne `accroupi?: boolean` ; si vrai, `(base + mouvement·facteur)` est
  multiplié par `MULT_DISPERSION_ACCROUPI` (la chaleur et `air` ne le sont pas).
* Les 4 armes existantes gardent EXACTEMENT leurs stats (test `armes.test.ts` « stats exactes ») ; elles reçoivent
  `categorie` (pistolet = `secondaire`, les trois autres = `principale`), `nomCourt`, `description`, `sansRecharge: false`.
* Nouvelles armes (valeurs de départ, à régler en jeu sans toucher aux invariants des tests) :

| id | catégorie | dégâts | tête | plombs | cadence s | auto | chargeur | recharge s | portée | chute (début/fin/min) | vitesse | disp. base/mvt/air/parTir/max/retour/viseur | recul (tang/lacet) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `fusil_assaut` | principale | 22 | ×1,8 | 1 | 0,10 | oui | 30 | 2,2 | 140 | 30/90/0,6 | 0,97 | 0,006/0,022/0,045/0,005/0,07/0,5/0,002 | 0,014/0,007 |
| `mitrailleuse` | principale | 19 | ×1,5 | 1 | 0,085 | oui | 60 | 4,2 | 110 | 20/60/0,5 | 0,88 | 0,014/0,03/0,055/0,004/0,10/0,6/0,009 | 0,011/0,010 |
| `revolver` | secondaire | 55 | ×2 | 1 | 0,50 | non | 6 | 2,2 | 130 | 30/80/0,7 | 1,0 | 0,003/0,02/0,04/0,02/0,06/0,45/0,001 | 0,05/0,008 |
| `mini_uzi` | secondaire | 11 | ×1,5 | 1 | 0,06 | oui | 25 | 1,6 | 45 | 8/30/0,4 | 1,05 | 0,02/0,03/0,055/0,008/0,10/0,4/0,014 | 0,010/0,012 |
| `railgun` | spéciale | 140 | ×1,5 (210) | 1 | 1,20 | non | 6 (total) | – | 500 | 500/500/1 | 0,9 | 0,001/0,03/0,05/0,01/0,06/0,6/0 | 0,06/0,004 |
| `minigun` | spéciale | 13 | ×1,4 | 1 | 0,04 | oui | 150 (total) | – | 100 | 20/70/0,5 | 0,75 | 0,025/0,03/0,06/0,006/0,10/0,5/0,018 | 0,006/0,012 |
| `magnum_dore` | spéciale | 70 | ×3 (210) | 1 | 0,70 | non | 8 (total) | – | 160 | 40/100/0,8 | 1,0 | 0,002/0,02/0,04/0,02/0,06/0,5/0,0008 | 0,07/0,01 |

Règles imposées par les tests existants : toute arme a `mouvement > 0` et `air > 0` ; `dispersion.max ≥ base` ;
**seul le sniper a un `zoom`** (aucune nouvelle arme n'en a) ; `plombs ≥ 1`. Les spéciales ont `rechargeS: 0` et
`sansRecharge: true`. **Une touche à la tête à 210 dégâts tue un joueur à 100 PV + 100 de bouclier** : toujours vrai pour le `railgun` (chute 500/500/1, aucune perte de dégâts)
et pour le `magnum_dore` seulement jusqu'à 40 m (`chute.debut`) ; le `minigun` (13 × 1,4) ne tue jamais en un coup.
Descriptions (lobby, une phrase chacune) : à écrire dans `STATS[].description` (ex. fusil d'assaut « Polyvalent :
cadence soutenue, bonne précision à moyenne distance. »).

`app/components/arene/armesInfo.ts` (lot 0) est **dérivé** de `STATS` : `INFOS_ARMES: Record<ArmeFeuId, InfoArme>` construit
par `Object.values(STATS)`, barres normalisées sur le MAX du catalogue (plus de constantes magiques), `armesParCategorie(cat)`,
`libelleCause(arme, cause, par)` (« Pistolet », « Couteau », « Écrasé par la circulation », « Renversé par <pseudo> »).

## 5. Modules nouveaux — signatures exportées exactes

Le **lot 0 crée tous ces fichiers comme squelettes** (types et constantes réels, corps de fonction `throw new
Error("non implémenté : <lot>")`) pour que les lots parallèles compilent les uns contre les autres. Chaque lot remplace
les corps de SES fichiers sans changer une signature. **Une signature qui doit changer ne se négocie PAS en éditant ce document** (onze agents en parallèle
l'éditeraient en même temps) : le lot le signale dans son rapport de fin, et l'orchestrateur est seul à modifier la spec.
Tous : PUR (ni DOM, ni three, sauf mention), `alea` et `maintenant` injectés. Les imports ne forment pas de cycle
(`protocole` ← `armes` ← le reste).

### 5.1 `lib/fps/sante.ts` (lot B)
```ts
import { JEU } from "./protocole";
/** Sous-ensemble de JoueurSalle : passer le joueur directement. Mutations en place. */
export interface Sante { pv: number; bouclier: number; dernierDegatT: number; regenAcc: number }
export const REGEN = { delaiMs: JEU.regenDelaiMs, pvParS: JEU.regenPvParS } as const;
export interface ResultatDegats { absorbe: number; subi: number; mort: boolean }
export function santeInitiale(maintenant: number): Sante;
/** Bouclier d'abord, puis PV ; degats ≤ 0 ignorés ; remet regenAcc à 0 et dernierDegatT à maintenant. */
export function appliquerDegats(s: Sante, degats: number, maintenant: number): ResultatDegats;
/** Mort instantanée (écrasement) : pv = 0, bouclier = 0. */
export function tuer(s: Sante, maintenant: number): void;
/** Régénère les PV (entiers) après REGEN.delaiMs sans dégât ; dtS borné à 0,25 ; vrai si `pv` a changé. Jamais sur un mort. */
export function regenerer(s: Sante, maintenant: number, dtS: number): boolean;
/** Soin d'Elsa : pv = pvMax, bouclier = bouclierMax. */
export function soinComplet(s: Sante): void;
/** Apparition : pv = pvMax, bouclier = 0, regenAcc = 0, dernierDegatT = maintenant. */
export function reinitialiserSante(s: Sante, maintenant: number): void;
/** Mémo d'un joueur qui quitte l'arène en vie : on restaure sa santé s'il revient dans JEU.memoSanteMs (pas de soin gratuit). */
export interface MemoSante { pv: number; bouclier: number; sansDegatMs: number; t: number }
export function memoriserSante(s: Sante, maintenant: number): MemoSante;
/** Vrai et santé restaurée (dernierDegatT = maintenant − sansDegatMs, regenAcc = 0) si le mémo a moins de JEU.memoSanteMs et pv > 0 ; sinon faux, rien n'est changé. */
export function restaurerSante(s: Sante, memo: MemoSante | null, maintenant: number): boolean;
```

### 5.2 `lib/fps/melee.ts` (lot B)
```ts
import type { Monde } from "./collision";
import type { Cible } from "./tir";
import type { Vec3 } from "./protocole";
export interface CibleMelee extends Cible { accroupi?: boolean }
/** Fenêtre de rejeu des positions de la cible pour un coup de couteau (ms), plus courte que REWIND_MAX_MS (300 ms ajouteraient ≈ 5 m de portée à 16 m/s). */
export const REWIND_MELEE_MS = 200;
/** Distance (m) de l'œil `o` à la SURFACE de la capsule de la cible (axe vertical, rayon corps.rayon), 0 si dedans. */
export function distanceSurface(o: Vec3, cible: CibleMelee): number;
/** Client : cible la plus proche dans le cône et à ≤ COUTEAU.portee de surface, ligne de vue libre ; null sinon. */
export function trouverCibleCouteau(monde: Monde, o: Vec3, d: Vec3, cibles: readonly CibleMelee[], tireur: string): { cible: string; distance: number } | null;
/** Serveur : validation d'un coup (portée + margePortee, cône, ligne de vue tête/torse/pieds, cible vivante). */
export function coupVraisemblable(monde: Monde, o: Vec3, d: Vec3, cible: CibleMelee, vitesseCible: number): boolean;
```

### 5.3 `lib/fps/zones.ts` (lot C)
```ts
import type { SceneData, Vec2 } from "../agroparc3d/types";
export const ROND_POINT: { readonly centre: Vec2; readonly rayon: number };            // [28.2, 2.5], 18.1
export const ZONE_APPARITION: { readonly rMin: number; readonly rMax: number; readonly bandeMin: number; readonly bandeMax: number; readonly bandeCible: number }; // 25, 140, 40, 110, 75
export interface ZoneApparition { centre: Vec2; rMin: number; rMax: number; bandeMin: number; bandeMax: number; bandeCible: number }
/** Points de `points` dans l'anneau rMin..rMax autour du centre. */
export function filtrerApparitions(points: readonly Vec2[], zone?: ZoneApparition): Vec2[];
/**
 * Règle de choix (§2.10) : parmi `reservoir`, tirage uniforme des points dont la distance à l'ennemi vivant le plus proche est dans [bandeMin, bandeMax] ;
 * si la bande contient moins de 3 points, tirage parmi les 6 points dont cette distance est la plus proche de `bandeCible` ; sans ennemi, tirage uniforme.
 * `alea` injecté ; `reservoir` vide ⇒ le centre de la zone.
 */
export function choisirPointZone(reservoir: readonly Vec2[], ennemis: readonly Vec2[], zone: ZoneApparition, alea: () => number): Vec2;
/** Retrouve l'anneau (les ways M qui se referment autour du centre) dans scene.json ; null si absent. */
export function trouverRondPoint(data: SceneData): { centre: Vec2; rayon: number } | null;
/** (−120 ; 39) : 5 m à l'est du POI `truck` ; repli si le POI est absent. */
export function positionElsa(data: SceneData): Vec2;
/** Six emplacements de `parkings[3]`, cap en convention lacet. */
export const EMPLACEMENTS_VOITURES: readonly { readonly p: Vec2; readonly cap: number }[];
/** Lacet/cap pour regarder de `de` vers `vers` (0 = −z). */
export function lacetVers(de: Vec2, vers: Vec2): number;
/** Cap pour un vecteur direction (dx, dz) : atan2(−dx, −dz). */
export function capDepuisDirection(dx: number, dz: number): number;
```

### 5.4 `lib/fps/elsa.ts` (lot C)
```ts
import type { ArmeSpecialeId, Vec3 } from "./protocole";
export const ELSA = {
  intervalleMinMs: 20_000, intervalleMaxMs: 50_000, dureeOffreMs: 40_000,
  rayonRamassage: 2.5, hauteurRamassageMax: 3, probaSoin: 0.4,
} as const;
/** Intervalle entre deux offres, surchargeable (tests de bout en bout : `PDJ_FPS_ELSA_MIN_MS` / `PDJ_FPS_ELSA_MAX_MS` lus par serveur-fps). */
export interface IntervalleElsa { minMs: number; maxMs: number }
export interface Offre { id: number; genre: "soin" | "arme"; arme?: ArmeSpecialeId; finT: number }
export interface EtatElsa { x: number; z: number; prochaineT: number; offre: Offre | null; compteur: number }
export type EvenementElsa = { type: "apparue"; offre: Offre } | { type: "expiree"; offre: Offre } | null;
export function intervalleAleatoire(alea: () => number, intervalle?: IntervalleElsa): number;
export function creerElsa(x: number, z: number, maintenant: number, alea: () => number, intervalle?: IntervalleElsa): EtatElsa;
/** `actif` = phase "jeu" et ≥ 1 joueur en arène. Inactif : jamais d'apparition, l'échéance est repoussée. */
export function avancerElsa(e: EtatElsa, maintenant: number, alea: () => number, actif: boolean, intervalle?: IntervalleElsa): EvenementElsa;
/** Horizontal ≤ rayonRamassage et |dy| < hauteurRamassageMax, offre présente et non expirée. */
export function peutRamasser(e: EtatElsa, p: Vec3, maintenant: number): boolean;
/** Retire l'offre, ré-arme le minuteur, renvoie l'offre prise (null s'il n'y en avait pas). */
export function prendre(e: EtatElsa, maintenant: number, alea: () => number, intervalle?: IntervalleElsa): Offre | null;
export function reinitialiserElsa(e: EtatElsa, maintenant: number, alea: () => number, intervalle?: IntervalleElsa): void;
export function munitionsOffertes(arme: ArmeSpecialeId): number;     // STATS[arme].chargeur
```

### 5.5 `lib/fps/circulation.ts` (lot D)
```ts
import type { Vec2 } from "../agroparc3d/types";
import type { Vec3 } from "./protocole";
export const VOITURE = { longueur: 4.4, largeur: 1.9, hauteur: 1.5 } as const;
/** Référence de temps commune (ms epoch) : s = (s0 + v·(t − T0)/1000) mod L. */
export const T0_MS = 1_700_000_000_000;
/** Vitesse unique des quatre circuits (m/s) : ils partagent des arcs de l'anneau, des vitesses différentes feraient se traverser les voitures. */
export const VITESSE_PNJ_M_S = 9;
export interface CircuitDef { id: "anneau" | "sud" | "nord_est" | "ouest"; points: readonly Vec2[]; decalageVoie: number; vitesse: number; voitures: number }
export const CIRCUITS: readonly CircuitDef[];               // annexe §10, sens antihoraire sur l'anneau, tous à VITESSE_PNJ_M_S
/** pts = ligne décalée à droite (jonctions en MITRE bornée aux coins, jusqu'à 100°), fermée. */
export interface Circuit { def: CircuitDef; pts: Vec2[]; cumul: number[]; longueur: number }
export function construireCircuits(defs?: readonly CircuitDef[]): Circuit[];
export interface VoiturePnj { id: number; circuit: number; s0: number; teinte: number }
export function flotte(circuits: readonly Circuit[]): VoiturePnj[];       // 12 voitures, déterministe, espacées de L/n
/** p = centre au sol, v ≥ 0 ; cap (convention lacet) = direction de la CORDE entre s − 2 m et s + 2 m (continu aux coins, pas la tangente de la polyligne). */
export interface EtatVoiture { p: Vec3; cap: number; v: number }
export function etatVoiture(c: Circuit, v: VoiturePnj, tMs: number): EtatVoiture;
export interface BoiteVoiture { cx: number; cz: number; ux: number; uz: number; demiLongueur: number; demiLargeur: number }
export function boiteVoiture(e: EtatVoiture, marge?: number): BoiteVoiture;
/** Cylindre (rayon `rayon`, pieds p) recoupant la boîte, pieds sous VOITURE.hauteur + 0,1 ; marge 0 par défaut (équité : aucun biais contre le joueur). */
export function joueurEcrase(e: EtatVoiture, p: Vec3, rayon: number, marge?: number): boolean;
/**
 * Ids des joueurs écrasés. Chaque joueur a SON instant `tMs` (instant de capture estimé de `p` = `etatT − ping/2`) : le client dessine la voiture à
 * `maintenantServeur()` et reporte sa position à cet instant, tester tout le monde à l'instant courant décalerait de 0,5 à 1 m à 9 m/s.
 */
export function ecrasements(circuits: readonly Circuit[], voitures: readonly VoiturePnj[],
  joueurs: readonly { id: string; p: Vec3; tMs: number }[], rayon: number, marge?: number): string[];
/** Distance (m) de (x, z) à la ligne décalée la plus proche ; sert à écarter les points d'apparition à < 4 m d'un circuit. */
export function distanceAuxCircuits(circuits: readonly Circuit[], x: number, z: number): number;
/** Écarte les points à moins de `distMin` (4 m) d'un circuit ; si moins de `minRestant` (30) points resteraient, renvoie `points` tel quel. */
export function ecarterDesCircuits(points: readonly Vec2[], circuits: readonly Circuit[], distMin?: number, minRestant?: number): Vec2[];
```

### 5.6 `lib/fps/vehicule.ts` (lot E)
```ts
import type { Monde } from "./collision";
import { OEIL_SIEGE, type Siege, type Vec3 } from "./protocole";
import type { Vec2 } from "../agroparc3d/types";
export const VEH = {
  longueur: 4.4, largeur: 1.9, hauteur: 1.5, vitesseMax: 24, vitesseArriere: 8, accel: 14, freinage: 28, frottement: 3,
  braquageMax: 0.55, empattement: 2.6, rayonCercle: 1.0, vitesseRenverse: 6, distanceMontee: 3.5, oeilSiege: OEIL_SIEGE,
} as const;
export interface EtatVehicule { p: Vec3; cap: number; v: number }                    // v signée le long du cap
export interface CommandesVehicule { accel: number; direction: number; frein: boolean }   // accel −1..1, direction −1..1 (+1 = droite)
export function etatVehiculeInitial(p: Vec2, cap: number): EtatVehicule;
/** Un pas (dt ≤ 1/60, sous-découpé en interne). `choc` = vitesse perdue au contact (m/s) pour le son. */
export function pasVehicule(e: EtatVehicule, c: CommandesVehicule, dt: number, monde: Monde): { etat: EtatVehicule; choc: number };
export const SIEGES_LOCAUX: readonly (readonly [number, number])[];                  // (x droite, z avant) des 4 sièges
export function positionSiege(e: EtatVehicule, siege: Siege): Vec3;                  // p du joueur assis (pieds)
export function pointDeSortie(e: EtatVehicule, siege: Siege, monde: Monde): Vec3;    // côté du siège, hors bâtiment
export function distanceVehicule(e: EtatVehicule, p: Vec3): number;                  // à la boîte
/** Recoupe la boîte (sans marge) ET `vitesseMesuree` ≥ vitesseRenverse. La vitesse est celle MESURÉE par le serveur (Garage.vitesseMesuree), jamais le `v` déclaré. */
export function renverse(e: EtatVehicule, joueur: Vec3, rayon: number, vitesseMesuree: number): boolean;
export function coinsVehicule(e: EtatVehicule): [Vec2, Vec2, Vec2, Vec2];
```

### 5.7 `lib/fps/garage.ts` (lot E, logique serveur pure)
```ts
import type { Monde } from "./collision";
import type { InfoVehicule, MessageClient, Siege, Vec3, VehiculeSnap } from "./protocole";
import type { Vec2 } from "../agroparc3d/types";
export interface EtatVehiculeDate { t: number; p: Vec3; cap: number; v: number }
export interface VehiculeSalle {
  id: number; p: Vec3; cap: number; v: number; sieges: (string | null)[];
  conduiteSeq: number; conduiteT: number; libreDepuisT: number | null; depart: { p: Vec3; cap: number };
  /** états reçus (conduite) des HISTORIQUE_MS dernières ms, pour rejouer la voiture à un instant passé */
  histo: EtatVehiculeDate[];
}
export const CONDUCTEUR_TIRE = false;
export const ABANDON_MS = 60_000;
/** Un conducteur qui n'a rien envoyé depuis ce délai (ms) : la voiture est arrêtée (v = 0). */
export const SILENCE_CONDUCTEUR_MS = 500;
export type ResultatMonter = { ok: true; siege: Siege } | { ok: false; raison: "loin" | "plein" | "deja" | "inconnu" };
export class Garage {
  constructor(emplacements: readonly { p: Vec2; cap: number }[], monde: Monde, maintenant: number);
  readonly vehicules: VehiculeSalle[];
  reinitialiser(maintenant: number): void;
  occupation(joueurId: string): { vehicule: number; siege: Siege } | null;
  monter(joueurId: string, p: Vec3, vehicule: number, siege: Siege | undefined, maintenant: number): ResultatMonter;
  /** Libère le siège ; renvoie le point de sortie ou null. Un conducteur qui descend arrête la voiture. */
  descendre(joueurId: string, maintenant: number): { p: Vec3; lacet: number } | null;
  changerSiege(joueurId: string, siege: Siege): boolean;
  /**
   * Libère le siège dans TOUS les cas de départ : mort, quitter, déconnexion, éviction, nouveau match (≠ `descendre`, qui est volontaire et renvoie le point de sortie).
   * Un conducteur qui part arrête la voiture (v = 0). Renvoie les ids de véhicules dont l'occupation a changé (pour diffuser `sieges`).
   */
  liberer(joueurId: string, maintenant: number): number[];
  /** Validation (conducteur du siège 0, seq croissante, bornes, vitesse ≤ PLAFONDS.vitesseVehiculeMax, pas dans un bâtiment) ; `y` imposé à 0 ; alimente `histo`. */
  recevoirConduite(joueurId: string, m: Extract<MessageClient, { t: "conduite" }>, maintenant: number): boolean;
  /** Position des pieds d'un occupant (siège) ou null. */
  positionOccupant(joueurId: string): Vec3 | null;
  /** Vecteur vitesse (m/s) du véhicule d'un occupant (cap × v) ou null : le serveur le recopie dans `j.v` de TOUS les occupants. */
  vitesseOccupant(joueurId: string): Vec3 | null;
  /** Yeux possibles d'un occupant sur les `fenetreMs` dernières ms (siège de chaque état de `histo` + OEIL_SIEGE) : un tir de passager est valide si `o` est près de l'un d'eux. */
  yeuxPossibles(joueurId: string, maintenant: number, fenetreMs: number): Vec3[];
  /** État interpolé de la voiture à l'instant `tMs` (serveur) ; l'état courant si `tMs` est postérieur au dernier. */
  etatAu(vehicule: number, tMs: number): EtatVehiculeDate | null;
  /** Vitesse MESURÉE (m/s) par déplacement entre états sur ≈ 100 ms ; 0 si moins de 2 états. */
  vitesseMesuree(vehicule: number, maintenant: number): number;
  /** Voitures inoccupées déplacées depuis ≥ ABANDON_MS : remises à leur place ; conducteur muet depuis SILENCE_CONDUCTEUR_MS : v = 0 ; renvoie les ids remis en place. */
  tic(maintenant: number): number[];
  infos(): InfoVehicule[];
  snap(): VehiculeSnap[];
  /**
   * Joueurs à pied renversés (vivants, non protégés, non occupants) avec le conducteur responsable. Pour chaque piéton, `tMs` = instant de capture estimé de `p`
   * (`etatT − ping/2`) : la voiture est testée à `tMs − JEU.interpolationMs` (`etatAu`), c'est ce que la victime voyait. Seuil : `vitesseMesuree` ≥ VEH.vitesseRenverse.
   */
  renversements(joueurs: readonly { id: string; p: Vec3; tMs: number; vivant: boolean; protege: boolean }[], maintenant: number): { cible: string; conducteur: string }[];
}
```

### 5.8 `lib/fps/interpolation-vehicules.ts` (lot E)
```ts
import type { VehiculeSnap } from "./protocole";
export class InterpolateurVehicules {
  /** Deux instances côté client : 1000 ms (affichage) et KILLCAM.tamponMs (rejeu), alimentées comme les deux `Interpolateur` de joueurs. */
  constructor(tamponMs?: number);
  ajouter(ts: number, vehicules: readonly VehiculeSnap[]): void;
  vider(): void;
  /**
   * Positions interpolées à l'horodatage serveur demandé ; extrapolation bornée à 150 ms ; angles par le plus court chemin.
   * Un écart de position entre deux échantillons > PLAFONDS.vitesseVehiculeMax × Δt + 3 m est un SAUT (remise en place à 60 s, nouveau match) : on prend l'échantillon le plus récent, sans interpoler.
   */
  echantillon(tsServeur: number): Map<number, VehiculeSnap>;
}
```

### 5.9 `lib/fps/jeu-vehicule.ts` (lot E, client, pur : entrées injectées)
```ts
import type { Monde } from "./collision";
import type { MessageClient, Siege, Vec3 } from "./protocole";
import { type EtatVehicule, type CommandesVehicule } from "./vehicule";
export interface InfoSiegeLocal { vehicule: number; siege: Siege }
export class ControleurVehicule {
  constructor(monde: Monde);
  actif(): InfoSiegeLocal | null;
  entrer(info: InfoSiegeLocal, etat: EtatVehicule): void;
  sortir(): void;
  /** Conducteur : avance la simulation locale. Passager : ne fait rien. */
  maj(dt: number, cmd: CommandesVehicule): void;
  /** Passager : l'état de la voiture vient du snap interpolé. */
  suivre(etat: EtatVehicule): void;
  etat(): EtatVehicule | null;
  estConducteur(): boolean;
  vitesseKmh(): number;
  positionSiege(): Vec3 | null;
  /** Message `conduite` du conducteur (seq croissante gérée ici). */
  messageConduite(lacet: number, tangage: number): Extract<MessageClient, { t: "conduite" }> | null;
}
/** Touches → commandes : avant/arrière → accel, gauche/droite → direction, saut → frein à main. */
export function commandesDepuisEntrees(e: { avant: number; droite: number; saut: boolean }): CommandesVehicule;
```

### 5.10 `lib/fps/visibilite.ts` (lot F)
```ts
import type { Monde } from "./collision";
import type { Vec3 } from "./protocole";
export const PSEUDO = {
  distanceMax: 70, cosChamp: 0.5, hzTest: 10, fonduMonteeS: 0.15, fonduDescenteS: 0.10,
  pxMax: 24, pxMin: 14, distancePxPleins: 30, distancePxMin: 55,
} as const;
export function dansChampDeVue(oeil: Vec3, regard: Vec3, cible: Vec3, cosChamp?: number): boolean;
/** Tête et torse (abaissés si accroupi) : les deux points testés. */
export function pointsTest(p: Vec3, accroupi: boolean): [Vec3, Vec3];
export function ligneDeVue(monde: Monde, oeil: Vec3, p: Vec3, accroupi: boolean): boolean;
/** 24 px jusqu'à distancePxPleins, décroît en 1/d jusqu'à pxMin à distancePxMin. */
export function hauteurPlaquePx(distance: number): number;
export interface JoueurVisible { id: string; p: Vec3; accroupi?: boolean; vivant: boolean }
export class VisibilitePseudos {
  constructor(monde: Monde);
  /** À appeler chaque image : teste chaque joueur à PSEUDO.hzTest (phases décalées) puis lisse l'alpha. */
  maj(t: number, dt: number, oeil: Vec3, regard: Vec3, joueurs: readonly JoueurVisible[]): void;
  alpha(id: string): number;      // 0..1
  oublier(id: string): void;
  vider(): void;
}
```

### 5.11 `lib/fps/killcam.ts` (lot F)
```ts
import type { EtatJoueurSnap, InfoTueur, Vec3 } from "./protocole";
export const KILLCAM = { rejeuMs: 2500, carteMs: 1500, tamponMs: 4000, gelApresMortMs: 150 } as const;
export type PhaseKillcam = "rejeu" | "carte" | "termine";
export interface Killcam {
  tueurId: string; tueur: InfoTueur | null; tMortServeur: number;
  /** rejeu possible (tueur trouvé dans le tampon) */
  avecRejeu: boolean; ecouleMs: number; phase: PhaseKillcam;
}
/** `tMortServeur` = `mort.ts` (horodatage serveur de la mort, pas l'horloge locale ni le dernier snap). */
export function demarrerKillcam(o: { tueurId: string; tueur?: InfoTueur; tMortServeur: number; tueurDansTampon: boolean }): Killcam;
export function avancerKillcam(k: Killcam, dtS: number): Killcam;               // pur : renvoie un nouvel objet
export function passerKillcam(k: Killcam): Killcam;                              // saute le rejeu → carte
/** Horodatage serveur à échantillonner dans le tampon long (début = tMort − rejeuMs, 1×). */
export function tempsRejeuServeur(k: Killcam): number;
export function progressionKillcam(k: Killcam): number;                          // 0..1 sur rejeuMs + carteMs
/** Œil du tueur (`oeilDe` : debout, accroupi ou assis dans un véhicule, où `p` est la position du siège) et angles de sa vue. */
export function cameraTueur(e: Pick<EtatJoueurSnap, "p" | "lacet" | "tangage" | "accroupi" | "vehicule">): { pos: Vec3; lacet: number; tangage: number };
/** Le tueur est-il dans le tampon à `t` ? (échantillon non vide pour son id) */
export function tueurPresent(echantillon: ReadonlyMap<string, EtatJoueurSnap>, tueurId: string): boolean;
```

### 5.12 `lib/fps/equipement.ts` (lot G)
```ts
import type { ArmeFeuId, ArmeId, ArmePrincipaleId, ArmeSecondaireId, ArmeSpecialeId, Equipement, Slot } from "./protocole";
export const estPrincipale: (x: unknown) => x is ArmePrincipaleId;
export const estSecondaire: (x: unknown) => x is ArmeSecondaireId;
export const estSpeciale: (x: unknown) => x is ArmeSpecialeId;
export const estArmeFeu: (x: unknown) => x is ArmeFeuId;
export const estSlot: (x: unknown) => x is Slot;
/** Arme d'un slot ("couteau" pour le couteau ; null si le slot spécial est vide). */
export function armeDuSlot(eq: Equipement, slot: Slot): ArmeId | null;
export function slotDeLArme(eq: Equipement, arme: ArmeId): Slot | null;
/** Équipement valide : valeurs invalides remplacées par `prec`. */
export function normaliserEquipement(brut: { principale?: unknown; secondaire?: unknown }, prec: Equipement): Equipement;
/** Alias v1 `arme` → équipement + slot en main ; null si l'arme est invalide ou spéciale. */
export function depuisAlias(arme: unknown, prec: Equipement): { equip: Equipement; main: Slot } | null;
/** Slot suivant/précédent portant une arme (saute le spécial vide), cyclique. */
export function slotVoisin(eq: Equipement, depuis: Slot, sens: 1 | -1): Slot;
export const CLE_EQUIPEMENT = "pdj-fps-equipement";
/** Lecture/écriture localStorage `{principale, secondaire}` ; migre `pdj-fps-arme`. Stockage injecté. */
export function lireEquipement(stockage?: { getItem(k: string): string | null } | null): { principale: ArmePrincipaleId; secondaire: ArmeSecondaireId };
export function ecrireEquipement(eq: { principale: ArmePrincipaleId; secondaire: ArmeSecondaireId }, stockage?: { setItem(k: string, v: string): void } | null): boolean;
/** Chaîne HUD "principale:fusil_assaut:23:30|secondaire:…" et son décodage. */
export interface LigneSlot { slot: Slot; arme: ArmeId; munitions: number; chargeur: number }
export function serialiserSlots(lignes: readonly LigneSlot[]): string;
export function lireSlots(s: string): LigneSlot[];
```

### 5.13 `lib/fps/jeu-equipement.ts` (lot G, client)
```ts
import type { ArmeFeuId, ArmeId, Equipement, MessageServeur, Slot } from "./protocole";
import { type LigneSlot } from "./equipement";
export class ControleurArmes {
  constructor(equip: Equipement, main?: Slot);
  equipement(): Equipement;
  slotActif(): Slot;
  armeEnMain(): ArmeId;
  /** Change de slot (refus si vide ou identique) : annule la recharge, `sortieFin = t + degainageMs`, mémorise le précédent. */
  equiper(slot: Slot, t: number): boolean;
  molette(sens: 1 | -1, t: number): boolean;
  rapide(t: number): boolean;                     // dernier slot utilisé
  couteauRapide(t: number): boolean;              // couteau ou retour
  munitions(): number;                            // de l'arme en main (Infinity pour le couteau → 0 au HUD)
  chargeur(): number;
  peutTirer(t: number): boolean;                  // sortie terminée, munitions > 0, pas en recharge
  tirEffectue(): void;                            // −1 munition ; spéciale vide → retirée, retour au slot précédent
  demarrerRecharge(t: number): boolean;           // refus : couteau, spéciale, chargeur plein, déjà en cours
  majRecharge(t: number): boolean;                // vrai quand la recharge se termine
  rechargeProgression(t: number): number;         // 0..1, 0 = rien
  /** `apparition` (équipement complet, chargeurs pleins) ou `equipement` (spéciale ramassée / épuisée). */
  appliquerServeur(m: Extract<MessageServeur, { t: "apparition" | "equipement" }>, t: number): void;
  lignes(): LigneSlot[];
  munitionsDe(arme: ArmeFeuId): number;
}
```

### 5.14 `lib/fps/traceurs.ts` (lot H1)
```ts
import type { ArmeFeuId, Vec3 } from "./protocole";
export interface ParamsTraceur {
  /** vitesse visuelle (m/s) */ vitesse: number; longueur: number; epaisseurPx: number;
  vieMinS: number; persistanceS: number; couleur: string;
}
export const TRACEURS: Record<ArmeFeuId, ParamsTraceur>;                       // §2.9
export interface EtatTraceur { tete: Vec3; queue: Vec3; alpha: number; arrive: boolean; fini: boolean }
export function dureeVie(depart: Vec3, fin: Vec3, p: ParamsTraceur): number;   // ≥ vieMinS
export function instantImpact(depart: Vec3, fin: Vec3, p: ParamsTraceur): number;
export function etatTraceur(depart: Vec3, fin: Vec3, p: ParamsTraceur, ageS: number): EtatTraceur;
/** Demi-largeur monde pour garder `epaisseurPx` à l'écran à cette distance (plancher 0,04 m). */
export function largeurMonde(distanceCamera: number, epaisseurPx: number, fovVerticalDeg: number, hauteurPx: number): number;
```

### 5.15 `lib/fps/rendu-monde.ts` (lot H2, three)
```ts
import * as THREE from "three";
import type { EtatElsaMsg, VehiculeSnap, InfoVehicule, Vec3 } from "./protocole";
import type { EtatVoiture } from "./circulation";
export interface MondeDynamique {
  /** Voitures PNJ (une entrée par voiture, dans l'ordre de `flotte`). */
  majVoituresPnj(etats: readonly EtatVoiture[]): void;
  /** Voitures conduisibles (interpolées) ; `couleurs` : couleur du conducteur par id de véhicule si occupé. */
  majVoituresJoueurs(vehicules: readonly VehiculeSnap[], couleurs: ReadonlyMap<number, string>): void;
  /** Elsa (toujours là) + caisse et faisceau quand `elsa.offre` ; `tS` en secondes pour l'animation. */
  majElsa(elsa: EtatElsaMsg | null, tS: number): void;
  /** Étiquette « Elsa » : position monde de la tête (pour VisibilitePseudos) et réglage d'alpha. */
  elsaTete(): Vec3;
  afficherPseudoElsa(alpha: number): void;
  dispose(): void;
}
export function creerMondeDynamique(scene: THREE.Scene, o: { nbPnj: number; nbVehicules: number; elsa: [number, number] }): MondeDynamique;
```

### 5.16 Contrats ajoutés à `lib/fps/rendu.ts` (lot H1, exports existants conservés)
```ts
export interface AvatarJoueur {
  /* existant … */
  /** alpha de l'étiquette de pseudo, 0 = cachée (piloté par VisibilitePseudos) */
  afficherPseudo(alpha: number, distance: number): void;
  /** position monde de la bouche de l'arme en main (départ des traçantes distantes) */
  positionBouche(): Vec3;
  /** animation de coup de couteau */
  coup(): void;
}
/** `maj` accepte `accroupi` et `vehicule` (pose assise) via l'EtatJoueurSnap. */
export interface Effets {
  /* existant … */
  traçante(depart: Vec3, fin: Vec3, arme: ArmeFeuId): void;   // remplace traçante(depart, fin)
  /** impact différé à l'arrivée visuelle ; dessiné par `maj`. */
}
export interface ArmeEnMain { /* existant … */ coup(): void; changer(arme: ArmeId): void; }
```

### 5.17 `app/components/arene/contrats.ts` (lot 0, réel) — contrats React entre U1, U2 et l'hôte

Les lots U1 (hôte `Agroparc3D.tsx`, lobby) et U2 (HUD, `useArene`) se consomment mutuellement (l'hôte lit le type de retour de `useArene` et passe les `Props` de `HudArene` ;
le HUD utilise `ChoixEquipement` de U1). Pour qu'ils soient **indépendants**, le lot 0 écrit ce fichier en réel, déplace dans `contrats.ts` les types `EntreeFil`, `EvenementHud`,
`DerniereMort` et `UseArene` (que `useArene.ts` ré-exporte) et rend `Agroparc3D.tsx` / `HudArene.tsx` / `useArene.ts` conformes à ces types avec des valeurs inertes (§7 lot 0).

```ts
import type { MutableRefObject } from "react";
import type { ClientArene, EtatConnexion } from "@/lib/fps/reseau";
import type {
  ArmeId, ArmePrincipaleId, ArmeSecondaireId, ArmeSpecialeId, CauseMort, EtatElsaMsg, EtatJoueurSnap, InfoMatch, InfoTueur, InfoVehicule,
  JoueurPublic, LigneClassement, Zone,
} from "@/lib/fps/protocole";
import type { HudEtat, JeuEvenement } from "@/lib/fps/jeu-types";
import type { Action, ConfigTouches } from "@/lib/fps/touches";

export interface EquipementChoisi { principale: ArmePrincipaleId; secondaire: ArmeSecondaireId }

/** Ligne du fil des kills. `arme` n'a de sens que pour cause "arme" : afficher `libelleCause(arme, cause, par)`, jamais `INFOS_ARMES[arme]` seul. */
export interface EntreeFil {
  id: number; par: string; parCouleur: string; cible: string; cibleCouleur: string;
  arme: ArmeId; cause: CauseMort; tete: boolean; moi: boolean;
}
export type EvenementHud =
  | { id: number; type: "touche"; zone: Zone }
  | { id: number; type: "kill"; zone: Zone }
  | { id: number; type: "degat"; angle: number };
/** Ma dernière mort ; remise à `null` sur `apparition`. */
export interface DerniereMort { par: string; parCouleur: string; arme: ArmeId; cause: CauseMort; zone: Zone; tueur: InfoTueur | null }

/** Fil d'annonces du HUD (4 au plus, 8 s chacune). */
export interface Annonce { id: number; texte: string; genre: "elsa" | "info" }
/** Toast de bonus (j'ai pris le cadeau d'Elsa). */
export interface Bonus { id: number; genre: "soin" | "arme"; arme?: ArmeSpecialeId }
/** Repère d'Elsa écrit à ~10 Hz par `JeuCallbacks.repere`, lu par rAF (pas de re-render). `elsaDistance < 0` = pas d'offre. */
export interface RepereElsa { elsaAngle: number; elsaDistance: number }

/** Retour de `useArene(pseudo, jeuRef)` (ex-interface `UseArene`, étendue). */
export interface UseArene {
  etat: EtatConnexion; monId: string | null; joueurs: JoueurPublic[]; match: InfoMatch | null;
  classement: LigneClassement[] | null; fil: EntreeFil[]; evenements: EvenementHud[]; derniereMort: DerniereMort | null;
  erreur: string | null;
  clientRef: MutableRefObject<ClientArene | null>;
  snapRef: MutableRefObject<EtatJoueurSnap[]>; snapTRef: MutableRefObject<number>;
  joueursRef: MutableRefObject<JoueurPublic[]>; matchRef: MutableRefObject<InfoMatch | null>;
  pousserEvenement(e: JeuEvenement): void;
  // ---- v2 ----
  elsa: EtatElsaMsg | null;
  annonces: Annonce[];
  sieges: InfoVehicule[];
  bonus: Bonus | null;
  /** carte du tueur de la killcam (le message `mort` étendu) ; null hors killcam */
  killcamInfo: InfoTueur | null;
}

/** Props de `HudArene` (U2 l'implémente, U1/l'hôte les fournit). */
export interface PropsHudArene {
  hud: HudEtat | null;
  monId: string | null;
  joueurs: JoueurPublic[];
  match: InfoMatch | null;
  classement: LigneClassement[] | null;
  fil: EntreeFil[];
  evenements: EvenementHud[];
  derniereMort: DerniereMort | null;
  maintenantServeur(): number;
  sensibilite: number;
  surSensibilite(x: number): void;
  touches: ConfigTouches;
  surTouches(cfg: ConfigTouches): void;
  /** actions sans aucune touche (nouvelles actions dont la touche par défaut était déjà prise dans une sauvegarde v1) : avertissement du menu pause */
  actionsSansTouche: Action[];
  pseudo: string;
  surPseudo(v: string): void;
  surReprendre(): void;
  surQuitter(): void;
  // ---- v2 ----
  /** équipement de la prochaine apparition (remplace `surChoisirArme`) */
  equipement: EquipementChoisi;
  surEquipement(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId): void;
  elsa: EtatElsaMsg | null;
  annonces: Annonce[];
  sieges: InfoVehicule[];
  bonus: Bonus | null;
  repereRef: MutableRefObject<RepereElsa | null>;
  /** accroupi : true = bascule, false = maintenir */
  accroupiBascule: boolean;
  surAccroupiBascule(b: boolean): void;
  /** carte du tueur (UseArene.killcamInfo) ; la phase et la progression viennent de `hud.killcamPhase` / `hud.killcam` (la machine `Killcam` reste dans jeu.ts) */
  killcamInfo: InfoTueur | null;
  /** « Passer » : saute le rejeu (le HUD appelle `jeuRef.current.passerKillcam()` via l'hôte) */
  surPasserKillcam(): void;
}

/** Props de `ChoixEquipement` (écrit par U1, utilisé par U1 : lobby, et par U2 : écran de mort, killcam, pause). */
export interface PropsChoixEquipement {
  principale: ArmePrincipaleId; secondaire: ArmeSecondaireId;
  surChanger(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId): void;
  /** "lobby" = cartes détaillées avec barres ; "compact" = boutons (écran de mort, killcam, pause) */
  variante: "lobby" | "compact";
  /** préfixe d'id (deux instances à l'écran : noms de groupes radio distincts) */
  idGroupe: string;
}
```

* `Arene.tsx` (U1) : props `arme`/`surArme` remplacées par `equipement: EquipementChoisi` et `surEquipement(p, s)`.
* `JeuHandle` gagne `passerKillcam(): void` (§5.18) ; l'hôte le câble sur `surPasserKillcam`.
* **Tokens CSS** `--ag-shield: #7fb2ff`, `--ag-danger: #ff7a6b`, `--ag-ok: #6ff0a8` : ajoutés à `Agroparc3D.module.css` **par le lot 0** (avant la vague 1), donc déjà présents quand U1 et U2 démarrent.
* **Sync Elsa / sièges** : l'hôte ne relaie rien de plus que `presence` et `match` au lancement du jeu (`Agroparc3D.tsx`) ; `elsa{etat}` et `sieges` arrivent en réponse au `rejoindre` envoyé par `lancerJeu`
  (§2.7), `useArene` les met dans ses états comme les autres `elsa` / `sieges` et `jeuRef.current.recevoir` les transmet au jeu.

### 5.18 `lib/fps/jeu-types.ts` (lot 0, réel)

Déplace de `jeu.ts` les types de contrat avec l'hôte (jeu.ts les ré-exporte : `export type { … } from "./jeu-types"`).

```ts
import type { ArmeId, ArmePrincipaleId, ArmeSecondaireId, ArmeSpecialeId, CauseMort, InfoTueur, MessageServeur, Slot, Vec3, Zone } from "./protocole";
import type { ConfigTouches } from "./touches";

/** Scalaires UNIQUEMENT (emettreHud compare champ par champ avec !==) : un objet ou tableau re-rendrait à 15 Hz. */
export interface HudEtat {
  pv: number;
  /** PV de bouclier */
  bouclier: number;
  /** arme en main et son slot */
  arme: ArmeId;
  slot: Slot;
  /** "principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:couteau:0:0|speciale:railgun:4:6" ; speciale absente si non portée */
  slots: string;
  /** équipement de la prochaine apparition : "fusil_assaut|pistolet" */
  equipSuivant: string;
  /** munitions / chargeur de l'arme en main (couteau : 0 / 0) */
  munitions: number;
  chargeur: number;
  /** avancement du rechargement, 0 = rien */
  recharge: number;
  vise: boolean;
  lunette: boolean;
  vitesse: number;
  mur: boolean;
  mort: boolean;
  reapparitionDans: number;
  protege: boolean;
  verrouille: boolean;
  dispersion: number;
  fov: number;
  connecte: boolean;
  entracte: boolean;
  accroupi: boolean;
  glisse: boolean;
  /** les PV remontent (délai sans dégâts écoulé et pv < pvMax) */
  regen: boolean;
  /** multiplicateur de course de l'arme en main (couteau 1,3 ; sinon 1 ; arrondi à 0,01) */
  bonusVitesse: number;
  /** invite d'interaction affichée sous le viseur */
  invite: "" | "elsa" | "monter" | "descendre";
  /** "2/4" occupants pour "monter" */
  inviteDetail: string;
  vehicule: boolean;
  /** siège occupé 0..3, −1 hors véhicule */
  siege: number;
  vitesseKmh: number;
  /** passager/conducteur qui ne peut pas tirer (conducteur) */
  tireInterdit: boolean;
  /** `monter`/`siege` envoyé, réponse (`embarque` ou `refus`) attendue (≤ 1 s) */
  embarquement: boolean;
  /** −1 hors killcam, sinon progression 0..1 (arrondie à 0,02) */
  killcam: number;
  killcamPhase: "" | "rejeu" | "carte";
}

export type JeuEvenement =
  | { type: "touche"; cible: string; zone: Zone; degats: number }
  | { type: "kill"; cible: string; zone: Zone; arme: ArmeId }
  /** je suis mort ; `tueur` pour la carte de killcam */
  | { type: "mort"; par: string; arme: ArmeId; cause: CauseMort; zone: Zone; delai: number; ts: number; tueur?: InfoTueur }
  | { type: "degat"; par: string; degats: number; angle: number }
  /** j'ai pris le cadeau d'Elsa */
  | { type: "bonus"; genre: "soin" | "arme"; arme?: ArmeSpecialeId }
  /** le serveur a refusé `monter` / `siege` (message `refus`) : toast « Voiture trop loin », « Voiture pleine »… */
  | { type: "refus"; action: "monter" | "siege"; raison: "loin" | "plein" | "deja" | "inconnu" | "mort" };

export interface JeuCallbacks {
  hud(e: HudEtat): void;
  evenement(e: JeuEvenement): void;
  /** ≈ 10 Hz : repère d'Elsa pour la flèche du HUD (hors React). elsaDistance < 0 = pas d'offre. */
  repere?(r: { elsaAngle: number; elsaDistance: number }): void;
  sortir(): void;
  erreur?(message: string): void;
}

export interface JeuHandle {
  /** Équipement de la prochaine apparition (immédiat si mort). */
  equiper(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId): void;
  recevoir(m: MessageServeur): void;
  verrouiller(): void;
  sensibilite(x: number): void;
  /** accroupi : true = bascule, false = maintenir */
  accroupiBascule(b: boolean): void;
  /** saute le rejeu de la killcam et passe à la carte du tueur (sans effet hors rejeu) */
  passerKillcam(): void;
  touches(cfg: ConfigTouches): void;
  dispose(): void;
  debug: {
    etat(): Record<string, unknown>;
    teleporter(p: Vec3): void;
    regarder(lacet: number, tangage: number): void;
    tirerVers(id: string): boolean;
    touche(code: string, appuyee: boolean): void;
    /** change de slot sans clavier */
    slot(s: Slot): void;
    /** entre dans le véhicule `id` (téléporte à côté puis envoie `monter`) */
    monter(id: number): void;
    /** état de la killcam, des voitures PNJ et d'Elsa pour les captures */
    killcam(): Record<string, unknown> | null;
    monde(): Record<string, unknown>;
  };
}
```
`lancerJeu(canvas, data, client, equip: {principale: ArmePrincipaleId; secondaire: ArmeSecondaireId}, cb: JeuCallbacks): JeuHandle`
(4ᵉ argument : `ArmeId` → équipement).


### 5.19 `lib/fps/match-contexte.ts` (lot 0, réel) — découpage de `Salle` en services

`match.ts` devenait le goulot d'un seul agent (équipement, couteau, santé, killcam, apparitions, Elsa, voitures PNJ, véhicules conduisibles). Il est découpé : `Salle` (lot S1) garde les joueurs, les
tirs, le couteau, la santé, le cycle des matchs et les apparitions ; **deux services** (lot S2) portent Elsa et les véhicules/circulation. Ils communiquent par les types ci-dessous, écrits en réel par le lot 0
(aucune logique). Le lot 0 déplace dans ce fichier `Sortie` et `JoueurSalle` (que `match.ts` ré-exporte) et ajoute les champs v2 à `JoueurSalle`.

```ts
import type { Monde } from "./collision";
import type { MemoSante } from "./sante";
import type {
  ArmeId, CauseMort, CoteMur, Equipement, MessageClient, MessageServeur, Posture, Siege, Slot, Vec3, VehiculeSnap, Zone,
} from "./protocole";

/**
 * Un message à émettre. `a` : "tous" (tous les inscrits), "joueurs" (en arène), "spectateurs" (inscrits hors arène) ou l'id d'un client ;
 * `sauf` exclut un id. Le snap des spectateurs part à 10 Hz et sans `vehicules` (§6.1.13).
 */
export type Sortie = { a: string; sauf?: string; m: MessageServeur };

/** Champs v2 de `JoueurSalle`. `JoueurSalle` = les champs v1 (déplacés tels quels de `match.ts` ; `prochainTir` y reste jusqu'au lot S1 qui le supprime) + ceux-ci. */
export interface JoueurSalleV2 {
  equip: Equipement;            // copie propre (copierEquipement), jamais EQUIPEMENT_DEFAUT
  main: Slot;
  mainSuivante: Slot;
  munSpeciale: number;
  /** pas de tir ni de recharge avant (maintenant + degainageMs ; le serveur tolère 30 %) */
  sortieJusqua: number;
  /** remplace `prochainTir` : prochain tir permis, par arme (couteau compris) */
  cadenceArme: Partial<Record<ArmeId, number>>;
  bouclier: number;
  dernierDegatT: number;
  regenAcc: number;
  accroupi: boolean;
  memoSante: MemoSante | null;
  /** positions acceptées des HISTORIQUE_MS dernières ms ; `accroupi` pour rejouer la bonne hitbox */
  histo: { t: number; p: Vec3; accroupi: boolean }[];
}

export interface JoueurSalle extends JoueurSalleV2 {
  /* champs v1 de match.ts : id, pseudo, couleur, enJeu, kills, morts, ping, p, v, lacet, tangage, posture, mur, arme, armeSuivante, pv, vivant,
     protegeJusqua, reapparitionT, seq, etatT, prochainTir, renommages ; `histo` est redéfini ci-dessus */
}

/** Ce que les services voient de la salle. Implémenté par `Salle` (lot S1). */
export interface ContexteSalle {
  readonly monde: Monde;
  readonly alea: () => number;
  /** phase "jeu" (les services ne font rien pendant l'entracte, sauf `reinitialiser`) */
  enPhaseJeu(): boolean;
  joueur(id: string): JoueurSalle | undefined;
  joueursEnJeu(): JoueurSalle[];
  /** dégâts d'arme : bouclier d'abord, mort, kills, `degats` + `mort` (avec `ts`, `cause`, `tueur`), libération du siège ; renvoie les sorties */
  infliger(cible: JoueurSalle, degats: number, par: JoueurSalle | null, cause: CauseMort, zone: Zone, arme: ArmeId, maintenant: number, src?: Vec3): Sortie[];
  /** mort instantanée (écrasement) : bouclier ignoré, mêmes sorties que `infliger` ; `par` null pour la circulation PNJ (aucun kill) */
  tuer(cible: JoueurSalle, par: JoueurSalle | null, cause: CauseMort, maintenant: number): Sortie[];
}

/** Elsa (lot S2, `match-elsa.ts` : `creerServiceElsa(ctx, opts)`). */
export interface ServiceElsa {
  /** apparition/expiration de l'offre, ramassage par le premier joueur à portée (soin ou arme spéciale), messages `elsa`, `ramassage`, `equipement` */
  tic(maintenant: number): Sortie[];
  /** nouveau match : offre retirée, minuteur ré-armé */
  reinitialiser(maintenant: number): void;
  /** `elsa{evenement:"etat"}` adressé à `idDest` (réponse à `rejoindre`) */
  synchro(idDest: string): Sortie[];
}

/** Véhicules conduisibles + circulation PNJ (lot S2, `match-vehicules.ts` : `creerServiceVehicules(ctx, opts)`). */
export interface ServiceVehicules {
  /** `monter` / `descendre` / `siege` / `conduite` ; les autres types renvoient [] ; réponses `embarque`, `refus`, `descente`, `sieges` */
  recevoir(j: JoueurSalle, m: MessageClient, maintenant: number): Sortie[];
  occupation(id: string): { vehicule: number; siege: Siege } | null;
  /** mort, quitter, déconnexion, éviction : libère le siège (voiture arrêtée si conducteur) et diffuse `sieges` ; renvoie [] si le joueur est à pied */
  liberer(j: JoueurSalle, maintenant: number): Sortie[];
  /**
   * Chaque tic : `p`/`v` (vitesse de la voiture) des occupants recopiés dans `JoueurSalle`, historique des occupants, silence du conducteur, abandon 60 s, renversements
   * (`ctx.tuer(..., "ecrase_vehicule")`, crédit au conducteur) et écrasements PNJ (`ctx.tuer(..., null, "ecrase_pnj")`).
   */
  tic(maintenant: number): Sortie[];
  /** nouveau match : voitures remises en place, occupants expulsés (`descente{raison:"expulse"}`) */
  reinitialiser(maintenant: number): Sortie[];
  /** `sieges` adressé à `idDest` (réponse à `rejoindre`) */
  synchro(idDest: string): Sortie[];
  snap(): VehiculeSnap[];
  /** yeux acceptables pour un `tir.o` d'occupant (null si le joueur est à pied) ; le conducteur n'a pas le droit de tirer (`CONDUCTEUR_TIRE`) */
  oeilsPossibles(j: JoueurSalle, maintenant: number, fenetreMs: number): Vec3[] | null;
  estConducteur(id: string): boolean;
}
```

### 5.20 Modules client de `jeu.ts` : `jeu-killcam.ts` (lot J2) et `jeu-monde.ts` (lot J3)

`jeu.ts` devait orchestrer huit sous-systèmes (killcam, pseudos, véhicules, Elsa, PNJ, équipement, couteau, accroupi) : l'affirmation « le lot J ne contient plus de logique » était fausse. La logique de la killcam et celle du
monde dynamique sortent dans deux modules **sans three ni DOM**, testés par vitest, que le lot J1 (`jeu.ts`) se contente d'appeler. Le lot 0 en écrit les squelettes.

```ts
// lib/fps/jeu-killcam.ts — lot J2
import type { EtatJoueurSnap, InfoTueur, MessageServeur, VehiculeSnap, Vec3 } from "./protocole";
import { type PhaseKillcam } from "./killcam";
export class ControleurKillcam {
  constructor();
  /** Alimente les tampons longs (joueurs + véhicules) ; sans effet une fois gelé (150 ms après `mort`). À appeler pour CHAQUE snap. */
  alimenter(ts: number, joueurs: readonly EtatJoueurSnap[], vehicules: readonly VehiculeSnap[] | undefined): void;
  /** Ma mort : démarre la machine avec `m.ts`, `m.tueur` ; programme le gel du tampon. Ne fait rien si ce n'est pas moi. */
  surMort(m: Extract<MessageServeur, { t: "mort" }>, moiId: string): void;
  maj(dtS: number): void;
  actif(): boolean;
  /** "" hors killcam */
  phase(): PhaseKillcam | "";
  /** saute le rejeu → carte */
  passer(): void;
  /** −1 hors killcam, sinon 0..1 */
  progression(): number;
  info(): InfoTueur | null;
  tueurId(): string | null;
  /** Horodatage serveur rejoué (pour les voitures PNJ aussi) ; null hors rejeu. */
  tempsServeur(): number | null;
  /** Caméra du tueur (œil via `oeilDe`, siège compris) ; null hors rejeu ou repli. */
  camera(): { pos: Vec3; lacet: number; tangage: number } | null;
  /** Joueurs rejoués à `tempsServeur()` (dont moi, SANS le tueur : on est dans sa tête). */
  joueursRejoues(): Map<string, EtatJoueurSnap>;
  vehiculesRejoues(): Map<number, VehiculeSnap>;
  /** `apparition`, changement d'id de client ou dispose : vide les tampons, dégèle. */
  terminer(): void;
}
```

```ts
// lib/fps/jeu-monde.ts — lot J3
import type { Monde } from "./collision";
import type { EtatVoiture } from "./circulation";
import type { EtatElsaMsg, InfoVehicule, Siege, Vec3, VehiculeSnap } from "./protocole";
import type { SceneData } from "../agroparc3d/types";
export type InviteInteraction = { invite: "" | "elsa" | "monter" | "descendre"; detail: string; vehicule: number | null };
export class MondeJeu {
  constructor(data: SceneData, monde: Monde);
  /** Voitures PNJ à l'horloge serveur `tMs` (12 états, ordre de `flotte`). Pendant la killcam : `tMs` = `ControleurKillcam.tempsServeur()`. */
  etatsPnj(tMs: number): EtatVoiture[];
  /** Snaps de voitures conduisibles reçus (tampon de 1 s) ; `vehiculesA` les interpole à `tsServeur − interpolationMs`. */
  alimenterVehicules(ts: number, v: readonly VehiculeSnap[] | undefined): void;
  vehiculesA(tsServeur: number): Map<number, VehiculeSnap>;
  majSieges(infos: readonly InfoVehicule[]): void;
  siegesDe(vehicule: number): readonly (string | null)[];
  majElsa(m: EtatElsaMsg | null): void;
  elsa(): EtatElsaMsg | null;
  position(): { x: number; z: number };
  /** Flèche vers Elsa : angle relatif au regard (rad) et distance arrondie à 10 m ; distance −1 sans offre. */
  repereElsa(p: Vec3, lacet: number): { elsaAngle: number; elsaDistance: number };
  /** Invite sous le viseur : cadeau d'Elsa à < 6 m, voiture à ≤ VEH.distanceMontee (« 2/4 »), « descendre » en véhicule. */
  invite(p: Vec3, siege: Siege | null, maintenantServeur: number): InviteInteraction;
  reinitialiser(): void;
}
```

## 6. Modifications par fichier existant

Légende : [0] = lot 0, [A]… = lot propriétaire (§7).

* **`lib/fps/protocole.ts`** [0] — §3.
* **`lib/fps/armes.ts`** [0] — §4. **`armes.test.ts`** [0] : `ARMES` couvre 11 armes (boucles inchangées) ; ajouter
  `categorie` valide pour chacune, `sansRecharge ⇒ rechargeS = 0`, `COUTEAU`, `vitesseArme`, dispersion accroupie.
* **`lib/fps/mouvement.ts`** [A] — constantes §2.1 ; `Entrees.accroupi?: boolean` ; `EtatMouvement.accroupi: boolean` et
  `glisse: { t: number; v0: number; dir: [number, number] } | null` (`etatInitial` les initialise à `false`/`null`) ; `MOUV.accroupiMult = 0.5`,
  `MOUV.glisseDureeS = 0.75`, `MOUV.glisseVitesseMin = 10.5` ; règle : s'accroupit seulement si `auSol && !mur`, se relève
  toujours ; `souhait()` applique ×0,5 (accroupi) ; glissade à état propre (§2.8 : elle ne passe pas par la branche d'excès de vitesse de `accelererSol`) ;
  `postureDe` inchangé ; export `hauteurOeil(accroupi)` = `SILHOUETTE.oeil` / `SILHOUETTE_ACCROUPIE.oeil` (1,95 / 1,30).
* **`lib/fps/tir.ts`** [0 : retouche minimale, puis B] — `Cible.accroupi?: boolean` ; `CENTRE_Y` supprimé : `silhouetteDe(c.accroupi)` fournit `centreY`,
  `rayonEnglobant`, `tete`, `corps` dans `tracer` et `toucheVraisemblable`. **La boule englobante de `tracer` devient `rayonEnglobant`** (l'ancienne `hauteur/2 + rayon` = 1,3 ne couvrait plus le haut de la
  tête, centre 1,05 + 1,25) ; **la tolérance de `toucheVraisemblable` se mesure à l'axe de la silhouette (5 points de `corps.y0` à `tete.y`), `TOLERANCE_RAYON_M` restant à 1,2** (§2.1 : 1,5 casserait `match.reseau.test.ts:78`) ; les trois points de visibilité deviennent
  `tete.y`, `centreY`, `corps.y0 + 0,1` de la silhouette de la cible. `MARGE_PORTEE_M` et `LATENCE_TOLEREE_S` inchangés. Le lot 0 ne fait que la retouche indispensable (silhouette debout) pour que les tests
  v1 restent verts ; B ajoute l'accroupi.
* **`lib/fps/collision.ts`** — AUCUN changement (`pointsApparition` reste complet ; le filtre est dans `zones.ts`).
* **`lib/fps/reseau.ts`** [F] — `new Interpolateur(tamponMs = 1000)` (le client en garde deux : 1000 et `KILLCAM.tamponMs`) ;
  `ClientArene` inchangé ; les messages nouveaux ne demandent rien d'autre (JSON). `ecrire` : `conduite` périssable comme `etat`, **`coup` périssable comme `tir`**
  (un coup en file ne doit pas se rejouer à la reconnexion). **`urlArene()`** : la valeur de production par défaut devient `wss://pdj-fps-v2.toam.tech` (§7 lot Z : le serveur v2 est
  déployé à côté du v1 sur un second hôte ; l'ancien client en cache reste servi par `wss://pdj-fps.toam.tech`, aucune fenêtre « rechargez la page »).
* **`lib/fps/touches.ts`** [G] — `Action` : retire `arme1..arme4`, ajoute `armePrincipale armeSecondaire couteau armeSpeciale
  armePrecedente couteauRapide accroupi interagir siege`. Défauts : `armePrincipale ["Digit1","Numpad1"]`,
  `armeSecondaire ["Digit2","Numpad2"]`, `couteau ["Digit3","Numpad3"]`, `armeSpeciale ["Digit4","Numpad4"]`,
  `armePrecedente ["KeyQ",null]`, `couteauRapide ["KeyV",null]`, **`accroupi ["KeyC",null]`** (jamais Ctrl gauche par défaut, §2.8), `interagir ["KeyE",null]`,
  `siege ["KeyF",null]`. `GROUPES_ACTIONS: { titre: string; actions: Action[] }[]` (Déplacement, Combat, Équipement, Véhicule,
  Divers) ; `LIBELLES_ACTIONS` mis à jour (plus de « prochaine apparition »). Attention : en AZERTY `KeyQ` est la touche A (libre, `gauche` est `KeyA`).
  **Migration d'une sauvegarde v1** : `normaliser` dédoublonne dans l'ordre de `ACTIONS` ; une sauvegarde v1 qui met `recharger` sur `KeyE` viderait en silence `interagir`.
  `normaliser` traite donc d'abord les 10 actions v1 conservées (`ACTIONS_V1` : avant … recharger, scores), qui gardent leurs touches, puis les nouvelles actions, dont la touche par
  défaut n'est posée que si elle est libre (sinon le second emplacement par défaut, sinon `null`). Nouvelle fonction `actionsSansTouche(cfg): Action[]` : la liste est affichée en
  avertissement dans le menu pause (`PropsHudArene.actionsSansTouche`) et l'invite d'interaction écrit « (touche non assignée) ».
* **`lib/fps/match.ts`** [0 : constantes et types ; S1] — voir §6.1. **`lib/fps/match-contexte.ts`** [0] §5.19.
* **`lib/fps/jeu.ts`** [0 : compilation ; J1] — voir §6.2.
* **`lib/fps/rendu.ts`** [H1] — avatars × `ECHELLE_AVATAR` (corps, `Y_PSEUDO`, plaque), arêtes `LineSegments2`, faces 24 %,
  silhouette lointaine ; pose accroupie (`corps.position.y` abaissé, genoux fléchis, buste incliné) et pose assise (`vehicule`) ;
  `afficherPseudo(alpha, distance)` (remplace `etiquette.visible = !mort` ; taille via `hauteurPlaquePx`) ; `positionBouche()` ;
  modèles d'armes pour les 7 nouvelles + couteau (en main et avatar) ; `PLACEMENT` → `Record<ArmeFeuId, …>` exhaustif ;
  `Effets.traçante(depart, fin, arme)` en rubans via `traceurs.ts`, pool 96 ; impacts différés plus marqués ; animations `coup`.
* **`lib/fps/sons.ts`** [H1] — `CLICS_RECHARGE` / profils de tir `Record<ArmeFeuId, …>` pour les 7 armes, `coup` de couteau
  (sifflement + impact), ramassage Elsa, régénération (tic doux), moteur de voiture (oscillateur pitché par la vitesse,
  `sons.moteur(vitesse)`), choc, klaxon facultatif.
* **`app/components/arene/armesInfo.ts`** [0] — §4. **`app/components/arene/contrats.ts`** [0] — §5.17.
* **`app/components/arene/Arene.tsx` + `Arene.module.css`** [U1] — deux `<fieldset>` via `ChoixEquipement` (principale, secondaire),
  ligne « Couteau : toujours équipé », note « Armes spéciales : offertes par Elsa au Truck Muche », bloc « Comment ça tire »
  (hitscan, pas de chute de balle, dégâts dégressifs), texte d'aide construit depuis les touches (plus de « Z Q S D » en dur), grille compacte si > 6 cartes.
* **`app/components/arene/ChoixEquipement.tsx` (+ `.module.css`)** [U1] — nouveau.
* **`app/components/Agroparc3D.tsx` + `.module.css`** [0 : compilation et tokens ; U1] — état `equipement` (clé `pdj-fps-equipement`, migration `pdj-fps-arme`) à la
  place de `arme`/`armeInitiale` ; `choisirEquipement` (état + `jeuRef.current?.equiper` + `ecrireEquipement`) ; 4ᵉ argument de
  `lancerJeu` ; `accroupiBascule` (état + clé `pdj-fps-accroupi-bascule` + `jeuRef.current?.accroupiBascule`) ; `PropsHudArene` complètes (§5.17, dont `actionsSansTouche` et `surPasserKillcam` →
  `jeuRef.current?.passerKillcam()`) ; callback `repere` → `repereRef` ; le lancement du jeu ne relaie toujours que `presence` et `match` (Elsa et sièges arrivent par la réponse à `rejoindre`, §2.7).
  Crochet `window.__arene` : ajouter `slot`, `monter`, `killcam`, `monde` (délégués à `JeuHandle.debug`).
* **`app/components/arene/HudArene.tsx` + `.module.css`** [0 : `Props = PropsHudArene` inerte ; U2] — voir §6.3.
* **`app/components/arene/useArene.ts`** [0 : types déplacés dans `contrats.ts`, extras inertes ; U2] — nouveaux messages (`elsa` toutes variantes, `ramassage`, `sieges`, `embarque`/`refus` → annonce d'info,
  `mort` étendu) ; `DerniereMort` gagne `cause`, `tueur`, remise à `null` sur
  `apparition` ; `EntreeFil.arme: ArmeId` + `cause` (ne jamais indexer `INFOS_ARMES` sans `libelleCause`) ; `pousserEvenement`
  traite explicitement `bonus` et `refus` (plus de repli sur `touche`).
* **`app/components/arene/ReglageTouches.tsx`** [U2] — liste groupée par `GROUPES_ACTIONS` (`<h3>`/`role="group"`).
* **`app/components/arene/Killcam.tsx` (+ `.module.css`)** [U2] — nouveau : bandes noires, légende « Killcam », barre
  `role="progressbar"`, bouton « Passer » (≥ 40 px), carte du tueur (`role="status"`), `prefers-reduced-motion` respecté.
* **`serveur-fps/src/index.ts`** [S1] — options de `Salle` (zone d'apparition, Elsa, circulation, véhicules), ids courts
  (`j` + compteur base 36 au lieu de `randomUUID`), `diffuser` gère les adresses `"joueurs"` / `"spectateurs"` (état `enJeu` lu par `salle.inspecter`), variables d'environnement
  `PDJ_FPS_ELSA_MIN_MS` / `PDJ_FPS_ELSA_MAX_MS` (tests), `MESSAGES_PAR_SECONDE_MAX` inchangé (90).
* **`serveur-fps/README.md`, `serveur-fps/docker-compose.yml`, `CLAUDE.md`, spec v1** [Z].

### 6.1 `match.ts` (lot S1) — règles à implémenter

Appui sur : `sante.ts`, `melee.ts`, `tir.ts`, `zones.ts`, `circulation.ts` (`ecarterDesCircuits`), `equipement.ts`, et les deux services (`match-elsa.ts`, `match-vehicules.ts`, lot S2) **par les interfaces de `match-contexte.ts`**.

1. **Constructeur** : `new Salle(monde, apparitions, alea, maintenant, options: OptionsSalle = {})`.
   ```ts
   export interface OptionsSalle {
     zoneApparition?: ZoneApparition;                       // sinon v1
     elsa?: { x: number; z: number; intervalle?: IntervalleElsa };
     circulation?: { circuits: Circuit[]; voitures: VoiturePnj[] };
     vehicules?: readonly { p: Vec2; cap: number }[];
   }
   ```
   Avec `zoneApparition`, le constructeur filtre `apparitions` (`filtrerApparitions`) puis, si `circulation` est présent, `ecarterDesCircuits` (§2.10). `elsa` ⇒ `creerServiceElsa(this, …)` ; `vehicules` et/ou `circulation` ⇒ `creerServiceVehicules(this, …)` ;
   sinon les services sont `null`. Sans options, aucune nouvelle règle n'est active (sauf équipement, bouclier, régénération, couteau, accroupi) : les tests v1 passent.
2. **Constantes** : `VITESSE_MAX_H_M_S = PLAFONDS.vitesseHorizontaleMax` etc. (valeurs §2.1, posées par le lot 0) ; tolérance d'œil `0,10·|v|` ; `TOLERANCE_DEGAINAGE = 0,7` ;
   `CREDIT_RAFALE_AUTO_MS = 200` (crédit de rafale d'une arme auto = `max(CREDIT_RAFALE_AUTO × intervalle, 200 ms)`).
3. **`JoueurSalle`** : voir `match-contexte.ts`. `arme` reste « l'arme en main ». Défaut : `equip = copierEquipement(EQUIPEMENT_DEFAUT)` (**jamais l'objet partagé** : `connecter` ET `placer` créent une copie),
   `main = SLOT_DEFAUT` (pistolet : compatibilité v1), `arme = "pistolet"`.
4. **`rejoindre`** : `principale`/`secondaire` valides ⇒ équipement, `mainSuivante = "principale"` ; sinon `arme` (alias) ⇒
   `depuisAlias`. **`rejoindre` n'est jamais refusé** : si `j.memoSante` a moins de `JEU.memoSanteMs`, `placer` restaure PV et bouclier (`restaurerSante`) ; sinon apparition à 100 PV. Sorties : `apparition`
   (à tous), `presence` (à tous), puis `elsa.synchro(j.id)` et `vehicules.synchro(j.id)`. **`quitter`** en vie : `memoSante = memoriserSante`, `vehicules.liberer`, `equip.speciale = null`,
   `histo` vidé ; mort : `memoSante = null`. **`equiper`** / **`arme`** (alias) : fixent l'équipement et `mainSuivante` ; si mort, appliqués tout de suite (comme v1).
5. **`main`** : vivant, en jeu, slot disponible (`armeDuSlot ≠ null`, spéciale avec `munSpeciale > 0`) ⇒ `j.main`, `j.arme`,
   `sortieJusqua = maintenant + JEU.degainageMs`. Pas de message de retour (le snap porte `arme`).
6. **`infliger` / `tuer`** (implémentent `ContexteSalle`) : factorisent pv/bouclier/mort/kills/`terminer` ; `infliger` utilise `appliquerDegats` ; émettent `degats` (avec `bouclier`, `src`) puis `mort`
   (avec `cause`, **`ts: maintenant`**, `tueur: InfoTueur` si `par ≠ ""`) ; mettent `reapparitionT`, appellent `vehicules.liberer(cible)`, retirent la spéciale (`equip.speciale = null`, `munSpeciale = 0`, sur la
   COPIE du joueur), `memoSante = null`. `tuer` ignore le bouclier (`tuer` de `sante.ts`).
7. **`recevoirTir`** : ajoute `j.main !== "couteau"`, `tir.arme === j.arme`, `maintenant >= j.sortieJusqua − (1 − TOLERANCE_DEGAINAGE) × JEU.degainageMs`, cadence par arme (`cadenceArme[j.arme]`, crédit en temps §2.4),
   spéciale : `munSpeciale--` (à 0 : retrait, retour au slot précédent, message `equipement`) ; **œil** : à pied, `o` à moins de `ECART_OEIL_M + 0,10·|v|` de `[p, p.y + oeilDe(j)]` ; occupant d'un véhicule, `o` à moins de
   `ECART_OEIL_M` d'un des `vehicules.oeilsPossibles(j, maintenant, REWIND_MAX_MS)` (§2.12) ; refus si le tireur est le conducteur (`CONDUCTEUR_TIRE`) ; hitbox des cibles : `Cible.accroupi` (ou assis) lu dans
   `histo` ; distance de dégâts via `SILHOUETTE.centreY`.
8. **`recevoirCoup`** : vivant, en phase `jeu`, `main === "couteau"`, `maintenant >= sortieJusqua − tolérance` et `cadenceArme.couteau`, puis **les mêmes contrôles que `recevoirTir`** : `estVec3(o)`, `estVec3(d)`,
   norme de `d` dans [0,95 ; 1,05], `o` à moins de `ECART_OEIL_M` (+ tolérance de vitesse, ou `oeilsPossibles` en véhicule) de l'œil connu, cosinus de visée ≥ `COS_VISEE_MIN`. Puis `coupVraisemblable` sur les
   positions rejouées sur **`REWIND_MELEE_MS`** (pas `REWIND_MAX_MS`), cible vivante non protégée, pas soi ; `infliger(100, "arme", arme "couteau")` ; diffuse `coup` aux autres ; `j.protegeJusqua = 0`.
9. **`recevoirEtat`** : accepte `accroupi` seulement si `posture === "sol"` ; ignore `p/v/posture/mur` si `vehicules.occupation(j.id)` (retient `lacet`, `tangage`, `etatT = maintenant`, `seq`) ; `histo` alimenté
   aussi pour les occupants (dans `tic`) et stocke `accroupi`.
10. **`monter`/`descendre`/`siege`/`conduite`** : `vehicules.recevoir` (service S2).
11. **`tic(maintenant)`** : `dt = (maintenant − dernierTicT)/1000` (champ `dernierTicT`) ; pour chaque joueur en vie : `regenerer(j, maintenant, dt)` ; `elsa.tic` ; `vehicules.tic` (positions des occupants, vitesse des occupants = vitesse de
    la voiture, renversements, écrasements PNJ, `etatT` des occupants mis à jour) ; apparitions ; inactivité inchangée (`quitter` + `vehicules.liberer`) ; snap.
12. **`placer`** : `choisirApparition` v2 (`choisirPointZone` si `options.zoneApparition`, sinon règle v1 « 6 plus éloignés »), regard vers le centre du rond-point ± 0,6 rad (`alea`), `main = mainSuivante`
    (principale si l'équipement a été choisi), `arme = armeDuSlot`, `equip = copierEquipement(...)` avec `speciale = null`, `reinitialiserSante` (ou `restaurerSante`), `accroupi = false`, `cadenceArme = {}`,
    `sortieJusqua = maintenant`, message `apparition` complet.
13. **`snap` et diffusion** : `bouclier`, `accroupi`, `vehicule` ajoutés seulement s'ils sont non nuls/vrais ; `vehicules: vehicules.snap()` si ≥ 1 ; arrondis (p, v au centime, angles au milliradian) à la sérialisation,
    jamais dans l'état interne. Les snaps partent à `"joueurs"` à 20 Hz ; les **spectateurs** (vue Palantir, `Agroparc3D.tsx` lit `snapRef`) reçoivent **un snap sur deux (10 Hz)**, sans `vehicules`.
14. **`demarrerMatch`** : `elsa.reinitialiser`, `vehicules.reinitialiser` (expulsions `descente` raison `expulse`).
15. **`connecter` / `deconnecter`** : `bienvenue` inchangé. `deconnecter` : `vehicules.liberer(j)` (siège libéré, voiture arrêtée, `sieges` diffusé) avant de retirer le joueur.

### 6.1bis Services (lot S2) — règles

* **`match-elsa.ts`** : `creerServiceElsa(ctx, { x, z, intervalle? })` ; `tic` = `avancerElsa(actif = phase jeu ∧ ≥ 1 joueur en arène)` puis, si offre, premier joueur vivant à pied avec `peutRamasser` ⇒ `prendre` ⇒
  `soinComplet` ou `equip.speciale` + `munSpeciale = munitionsOffertes`, `main = "speciale"`, `sortieJusqua = maintenant + degainageMs`, messages `elsa{prise}` (à tous), `ramassage` (à tous), `equipement` (au bénéficiaire) ;
  `synchro` = `elsa{etat}` privé.
* **`match-vehicules.ts`** : `creerServiceVehicules(ctx, { vehicules?, circulation? })` enveloppe `Garage` + circulation PNJ (`flotte`, `ecrasements`). `recevoir` : `monter` ⇒ `Garage.monter` ⇒ `embarque` (privé) + `sieges` (tous) ou
  `refus` (privé, `mort` si le joueur est mort) ; `descendre` ⇒ `descente{volontaire}` + `sieges` ; `siege` ⇒ `embarque`/`refus` ; `conduite` ⇒ `recevoirConduite` puis `j.p`, `j.v` (cap × v), `etatT`, `lacet`, `tangage`.
  `liberer` = `Garage.liberer` + `sieges`. `tic` : positions et `v` des occupants (`positionOccupant`, `vitesseOccupant`), `histo` des occupants, `Garage.tic` (abandon, silence), `renversements` (`ctx.tuer` avec le conducteur, cause
  `ecrase_vehicule`) et `ecrasements` PNJ (`tMs = j.etatT − j.ping/2`, `ctx.tuer(…, null, "ecrase_pnj")`). Pas d'écrasement pour un joueur protégé, mort, occupant, ni pieds ≥ 1,6 m.

### 6.2 `jeu.ts` (lot J1) — câblage

Le lot J1 **orchestre** ; la logique de la killcam est dans `jeu-killcam.ts` (J2) et celle du monde dynamique dans `jeu-monde.ts` (J3), toutes deux testées (§5.20). Le reste du câblage :
* Équipement : `ControleurArmes` remplace `armeId/armeSuivante/munitions/rechargeFin` ; touches `armePrincipale…`, molette (écouteur `wheel`
  non remappable), `armePrecedente`, `couteauRapide` ; envoie `{t:"main", slot}` à chaque changement ; `appliquerServeur` sur `apparition`/`equipement` ;
  `mult` de vitesse = `vitesseArme(armeEnMain) × (vise ? 0,8 : 1)` ; tir désactivé pour le conducteur.
* Tir : boucle `while (t ≥ prochainTir)` bornée à 3 coups par image (armes rapides, §2.4).
* Couteau : clic = `trouverCibleCouteau` ⇒ `{t:"coup", o, d, cible}` (cadence 0,5 s, animation `armeMain.coup()`), pas de recul ni traçante.
* Accroupi : `Entrees.accroupi` (maintenir ou basculer), œil lissé `oeilDe`, `accroupi` dans `etat`, dispersion accroupie, `cibles()` porte `accroupi`.
* Pseudos : `VisibilitePseudos.maj` dans `majDistants` avec l'œil et le regard de la caméra courante ; `avatar.afficherPseudo(alpha, distance)`.
* Traçantes : `effets.traçante(bouche, fin, arme)` (tir local : bouche de l'arme en main ; tir distant : `avatar.positionBouche()`).
* Killcam : appelle `ControleurKillcam` (`alimenter` à chaque `snap`, `surMort` sur le message `mort` avec soi pour cible, `maj`, `camera`, `joueursRejoues`, `vehiculesRejoues`) ; pendant le rejeu, caméra du tueur, avatars rejoués,
  effets en direct coupés (§2.5), PNJ à `tempsServeur()` ; `apparition` ⇒ `terminer()`.
* Elsa / PNJ / véhicules (rendu) : `MondeJeu` + `creerMondeDynamique` (`majElsa`, `majVoituresPnj(etatsPnj(client.maintenantServeur()))`, `majVoituresJoueurs(vehiculesA(…))`), annonce, `repere` ~10 Hz, invite, `bonus`,
  `refus` ⇒ événement `refus`.
* Véhicules (contrôle) : `ControleurVehicule`, E / F, attente de `embarque` (HUD `embarquement`, ≤ 1 s), caméra à la place du siège (`oeilDe`), `conduite` à 30 Hz au lieu de `etat`, `etat` à 15 Hz passager,
  `descente` ⇒ téléportation sans réinitialiser les munitions, sons du moteur.
* Apparition : `apparaitre()` applique l'équipement du message, sort de la killcam et d'un véhicule ; **caméra de survol avant la première apparition centrée sur le rond-point** (au lieu de `focus`).
* Régénération : `regen = pv < pvMax && t − dernierDegat ≥ 5 s` (le serveur reste l'autorité des PV).
* Vitesse : bob caméra `vh/9`, seuil de pas, `amp` d'animation sur `MOUV.sprint`.

### 6.3 `HudArene.tsx` (lot U2)

Bloc `.vie` : PV + barre de bouclier superposée plus fine (segments tous les 25, étiquette « Bouclier N ») + « Régénération » ; bloc `.arme`
remplacé par une **rangée de 3–4 slots** (touche en `kbd`, nom court, chargeur/réserve, actif en ambre avec `aria-current`, couteau avec pastille
« Vitesse +30 % » en texte, slot spécial seulement s'il est porté) ; invite d'interaction sous le viseur (« E : monter (2/4) », « E : descendre »,
« E : prendre le cadeau d'Elsa », avec la touche réellement assignée ou « touche non assignée ») ; étiquette « Accroupi » ; HUD véhicule (km/h, quatre sièges avec puce de couleur et pseudo, « Libre », « Conduite :
tir impossible ») ; fil d'annonces d'Elsa ; flèche d'Elsa (variable CSS `--elsa-angle` écrite par rAF depuis `repereRef`, distance arrondie à 10 m) ;
toast de bonus ; écran de mort : titre « Éliminé » (`role="status"`) compact et en bas pendant la killcam + `Killcam` (reçoit `killcamInfo`, `hud.killcamPhase`, `hud.killcam`, `surPasserKillcam`) + `ChoixEquipement` compact ;
pause : `ChoixEquipement` compact, case « Accroupi : basculer », avertissement `actionsSansTouche`, `ReglageTouches` groupé ; l'aide du premier lancement liste ≈ 12 commandes sur deux
colonnes sans chevaucher `.tabAstuce` ni `.vie` ; toute nouvelle animation ajoutée à `prefers-reduced-motion`. `commandes()` lit `touche()` pour chaque
action. Les `INFOS_ARMES[…]` sont remplacés par `libelleCause`.

## 7. Plan de lots

Tous les lots travaillent sur `feat/arene-v2`.

**Propriété des fichiers.** Elle est **par phase** : dans une même vague, un fichier n'appartient qu'à UN lot ; d'une phase à l'autre, un fichier peut changer de propriétaire (le lot 0 pose des
squelettes et des retouches de compilation sur des fichiers que la vague 1 ou 2 réécrit ; il est TERMINÉ et fusionné avant que la vague suivante ne démarre, il n'y a donc pas d'édition simultanée).
Le tableau ci-dessous liste **tous** les fichiers touchés, y compris les shims du lot 0.

**La spec n'est éditée que par l'orchestrateur.** Un lot à qui il manque quelque chose ou qui doit changer une signature le dit dans son rapport de fin (section « Écarts »), il ne modifie pas ce document
(onze agents l'éditant en parallèle se marcheraient dessus).

Vérifications communes de fin de lot : `npx vitest run lib/fps` (Node 22) vert pour les fichiers du lot ; `npx tsc --noEmit` à la racine ; pour S1 :
`cd serveur-fps && npm run typecheck && npm run build`. Un lot ne modifie jamais un fichier d'un autre lot de la même vague.

### Tableau des lots

| Lot | Nom | Fichiers possédés (tests inclus) | Dépend de |
|---|---|---|---|
| **0** | Fondations (1 agent, seul, en premier) | **Réels** : `lib/fps/protocole.ts`, `lib/fps/protocole.test.ts`, `lib/fps/armes.ts`, `lib/fps/armes.test.ts`, `lib/fps/jeu-types.ts`, `lib/fps/match-contexte.ts`, `app/components/arene/armesInfo.ts`, `app/components/arene/contrats.ts`. **Squelettes** (§5) : tous les fichiers nouveaux de la vague 1 et 2 (`sante`, `melee`, `zones`, `elsa`, `circulation`, `vehicule`, `garage`, `interpolation-vehicules`, `jeu-vehicule`, `visibilite`, `killcam`, `equipement`, `jeu-equipement`, `traceurs`, `rendu-monde`, `jeu-killcam`, `jeu-monde`, `match-elsa`, `match-vehicules`, `ChoixEquipement.tsx`, `Killcam.tsx`) + leurs fichiers `.test.ts` vides. **Shims de compilation, sans changement de comportement** : `lib/fps/match.ts` (constantes §2.1, `Sortie`/`JoueurSalle` déplacés dans `match-contexte.ts` et ré-exportés, `mort.cause = "arme"` et `mort.ts`, `bouclier: 0`, `equip`/`main`/`munSpeciale` par défaut copiés par joueur, `estArme` accepte `ARMES`), `lib/fps/match.test.ts` et `lib/fps/match.reseau.test.ts` (retouches listées en §8), `lib/fps/tir.ts` (silhouette debout : centre, boule englobante, tolérance), `lib/fps/jeu.ts` (4ᵉ argument encore `ArmeId` avec cast, `ARME_DE_L_ACTION` typé `Partial`), `lib/fps/rendu.ts` et `lib/fps/sons.ts` (`Record<ArmeFeuId, …>` : entrées des 7 nouvelles armes = copie de la plus proche, `TODO lot H1`), `app/components/Agroparc3D.tsx` (+ `Agroparc3D.module.css` : tokens `--ag-*`), `app/components/arene/Arene.tsx`, `HudArene.tsx`, `useArene.ts` (listes filtrées sur `categorie !== "speciale"`, `PropsHudArene` / `UseArene` de `contrats.ts` avec valeurs inertes) | – |
| **A** | Mouvement & vitesse | `lib/fps/mouvement.ts`, `lib/fps/mouvement.test.ts`, `lib/fps/ressenti.test.ts` | 0 |
| **B** | Combat pur | `lib/fps/tir.ts`, `lib/fps/tir.test.ts`, `lib/fps/melee.ts`, `lib/fps/melee.test.ts`, `lib/fps/sante.ts`, `lib/fps/sante.test.ts` | 0 |
| **C** | Zones & Elsa | `lib/fps/zones.ts`, `lib/fps/zones.test.ts`, `lib/fps/elsa.ts`, `lib/fps/elsa.test.ts` | 0 |
| **D** | Circulation PNJ | `lib/fps/circulation.ts`, `lib/fps/circulation.test.ts` (vérifications des circuits INCLUSES dans le test, aucun script `.mjs` : il ne pourrait pas importer `collision.ts`, imports relatifs sans extension et valeurs de `cachettes`, et exigerait Node ≥ 22.18) | 0 |
| **E** | Véhicules | `lib/fps/vehicule.ts`, `lib/fps/garage.ts`, `lib/fps/interpolation-vehicules.ts`, `lib/fps/jeu-vehicule.ts` + 4 `.test.ts` | 0 |
| **F** | Killcam, pseudos, réseau | `lib/fps/visibilite.ts`, `lib/fps/killcam.ts`, `lib/fps/reseau.ts` + tests (`reseau.test.ts` inclus) | 0 |
| **G** | Équipement & touches | `lib/fps/equipement.ts`, `lib/fps/jeu-equipement.ts`, `lib/fps/touches.ts`, `lib/fps/touches.test.ts` + tests des deux nouveaux | 0 |
| **H1** | Rendu avatars, armes, effets, sons | `lib/fps/rendu.ts`, `lib/fps/sons.ts`, `lib/fps/traceurs.ts`, `lib/fps/traceurs.test.ts` | 0 |
| **H2** | Rendu monde (voitures, Elsa) | `lib/fps/rendu-monde.ts` | 0 (+ types de D, E) |
| **U1** | UI lobby, équipement, hôte | `app/components/arene/Arene.tsx`, `Arene.module.css`, `ChoixEquipement.tsx`, `ChoixEquipement.module.css`, `app/components/Agroparc3D.tsx`, `Agroparc3D.module.css` | 0 (contrats), G (clé de stockage) |
| **U2** | UI HUD, killcam, touches | `app/components/arene/HudArene.tsx`, `HudArene.module.css`, `useArene.ts`, `ReglageTouches.tsx`, `Killcam.tsx`, `Killcam.module.css` | 0 (contrats), G (`GROUPES_ACTIONS`, `actionsSansTouche`) ; **plus de dépendance à U1** : `PropsChoixEquipement` est dans `contrats.ts` et le squelette de `ChoixEquipement.tsx` suffit pour compiler |
| **S1** | Serveur : `Salle` | `lib/fps/match.ts`, `lib/fps/match.test.ts`, `lib/fps/match.reseau.test.ts`, `lib/fps/match.v2.test.ts`, `lib/fps/match.charge.test.ts`, `serveur-fps/src/index.ts` | B, C, D, G (modules finis) + interfaces `ServiceElsa` / `ServiceVehicules` (lot 0) ; teste avec des services factices |
| **S2** | Serveur : Elsa, véhicules, circulation | `lib/fps/match-elsa.ts`, `lib/fps/match-elsa.test.ts`, `lib/fps/match-vehicules.ts`, `lib/fps/match-vehicules.test.ts` | C, D, E (modules finis) + `ContexteSalle` (lot 0) ; teste avec un contexte factice |
| **J1** | Client jeu : `jeu.ts` | `lib/fps/jeu.ts` | A, B, E, F, G, H1, H2 (modules finis) + squelettes/contrats de J2, J3, U1/U2 |
| **J2** | Client : killcam | `lib/fps/jeu-killcam.ts`, `lib/fps/jeu-killcam.test.ts` | E (`InterpolateurVehicules`), F (`killcam.ts`, `Interpolateur`) |
| **J3** | Client : monde dynamique | `lib/fps/jeu-monde.ts`, `lib/fps/jeu-monde.test.ts` | C (`positionElsa`), D (`flotte`, `etatVoiture`), E (`InterpolateurVehicules`, `VEH`) |
| **Z** | Docs, déploiement, vérification | `CLAUDE.md`, `docs/superpowers/specs/2026-10-22-agroparc-fps-design.md`, `serveur-fps/README.md`, `serveur-fps/docker-compose.yml`, `scripts/fps/e2e_arene_v2.mjs` | S1, S2, J1, J2, J3 |

Ordre : **0** (terminé, tests verts, fusionné) → vague 1 en parallèle (**A B C D E F G H1 H2 U1 U2**, onze fichiers-ensembles disjoints) → vague 2 en parallèle (**S1 S2 J1 J2 J3**, disjoints) → **Z**.
Les lots S1/J1 s'appuient sur les squelettes/interfaces du lot 0 pour les services de leur propre vague (S2, J2, J3) et ne bloquent pas dessus.

### Lot 0 — Fondations
* **À faire** : §3 (protocole), §4 (armes + `armesInfo.ts`), §5.17 (`contrats.ts`), §5.18 (`jeu-types.ts`, `jeu.ts` réexporte), §5.19 (`match-contexte.ts`), **squelettes** de tous les fichiers de §5
  (types/constantes réels, fonctions qui `throw new Error("non implémenté : lot X")`, classes avec corps vide du même type ; `match-elsa.ts` et `match-vehicules.ts` exportent `creerServiceElsa` / `creerServiceVehicules` pour que S1 compile),
  et **shims de compilation sans changement de comportement** (liste du tableau). Les squelettes de composants React (`ChoixEquipement.tsx`, `Killcam.tsx`) rendent `null`.
  Ordre interne : protocole/armes/jeu-types/match-contexte/contrats → squelettes → shims → tests.
* **Retouches de tests autorisées** (et seulement elles) : `match.test.ts` (annotations `ArmeId` → `ArmeFeuId` aux lignes 30, 50, 155 ; `:343` `toEqual` → `toMatchObject`), `match.reseau.test.ts` (`:97` : `PLAFONDS.vitesseDeclareeMax + 0.001`),
  `armes.test.ts`. `tir.test.ts` et `reseau.test.ts` restent **inchangés** (vérifié le 23/10 : `tir.test.ts` passe avec la nouvelle silhouette, `reseau.test.ts` compile car `bienvenue` est inchangé).
* **Tests** : `armes.test.ts` (§6) ; test de cohérence de `protocole` (nouveau `protocole.test.ts`) : `ARMES` sans doublon,
  listes disjointes, `silhouetteDe`, `oeilDe` (debout 1,95 ; accroupi 1,30 ; assis `OEIL_SIEGE`), `SILHOUETTE.corps.rayon < 0,5`, boule englobante couvrant tête et pieds debout et accroupi, invariants `PLAFONDS`/`JEU`,
  `EQUIPEMENT_DEFAUT` valide ET figé (`Object.isFrozen`) et `copierEquipement` indépendant.
* **Critères** : `npx tsc --noEmit` vert (les erreurs de `reseau.test.ts:214,237` n'existent plus car `bienvenue` est inchangé) ; `npx vitest run lib/fps` **entièrement vert** (le lot 0 ne change pas `MOUV` : `mouvement.test.ts:77` et `:209`, qui ne cassent qu'avec les constantes du lot A, sont corrigés par A ;
`match.reseau.test.ts:97`, cassé par les plafonds serveur que le lot 0 pose, est corrigé par le lot 0) ; serveur-fps` compile ; `npm run build` passe. Aucun comportement de jeu modifié (hors constantes `JEU`/`SILHOUETTE`/vitesses serveur).

### Lot A — Mouvement & vitesse
* Constantes §2.1, `accroupi`, glissade (état propre), `hauteurOeil`. Aucun import de match/jeu.
* **Tests** : sprint atteint en ≤ 0,15 s ; vitesse à 0,05 s = `MOUV.accelSol·0,05` ; marche = `MOUV.marche`, sprint = `MOUV.sprint` ; accroupi ×0,5 ; refus en l'air
  et en wall-run ; relever possible ; glissade (durée 0,75 s, décroissance monotone de la formule §2.8, déclenchée seulement ≥ 10,5 m/s, interrompue par le saut) ; couteau : `etape(…, 1,3)` ne
  dépasse jamais `MOUV.vitesseMaxH` ; invariant `vitesseMaxH < PLAFONDS.vitesseHorizontaleMax` ; wall-run : `murVitesse` atteignable avec la nouvelle vitesse ;
  `mouvement.test.ts:209` (« pas d'accroche ») : le cas « à 5 m/s, si » devient `MOUV.murVitesseEntreeMin + 1` ; `ressenti.test.ts` : `9 * FX` → `MOUV.sprint * FX` (optionnel : ces tests passent déjà).
* **Critères** : tests verts ; aucun test v1 désactivé ; pas de régression des sauts de mur (`murSautNormale` 6,5 inchangé).

### Lot B — Combat pur
* `tir.ts` (silhouettes accroupies, tolérance par silhouette), `melee.ts`, `sante.ts`.
* **Tests** : tête à `SILHOUETTE.tete.y` touchée, tête accroupie plus bas (un tir à hauteur de tête debout passe au-dessus d'un accroupi) ; **sommet de la tête (y = 2,28) accepté par `toucheVraisemblable` quand `tracer` le touche, à 10, 30, 100 et 300 m, cible immobile, debout et accroupi (sommet 1,58)** ; une cible à 1,3 m du rayon reste refusée ;
  littéral `0.38` du test remplacé par `E.corps.rayon` ; `sante` : bouclier absorbe d'abord, débordement vers les PV, `regenerer`
  inactive avant 5 s, +20 PV/s ensuite, entiers, plafond 100, mort jamais régénéré, bouclier jamais régénéré, `soinComplet`, `tuer`, `memoriserSante`/`restaurerSante` (moins de 60 s : restauré ; plus : refusé ; le temps dehors ne compte pas) ; `melee` : 2,2 m
  accepté, 2,9 m refusé, 2,7 m accepté côté serveur (marge), derrière un mur refusé, hors cône refusé, accroupi.
* **Critères** : couverture des cas limites ; aucune dépendance à `match.ts`.

### Lot C — Zones & Elsa
* **Tests** : `trouverRondPoint(scene.json réel)` ≈ `ROND_POINT` à 0,5 m ; `filtrerApparitions` : chaque point entre 25 et 140 m, ≥ 100 points (111 mesurés), ≥ 16 distincts ;
  **`choisirPointZone`** (graine fixe, 2 000 tirages, ennemis tirés dans l'anneau) : si la bande 40–110 m contient ≥ 3 points, le point choisi est dans la bande ; **distance médiane à l'ennemi le plus proche ≤ 100 m à 1 ennemi, ≤ 90 m à 3, ≤ 80 m à 7**
  (mesures : 82 / 74 / 63 m ; v1 : 623 / 426 / 307 m) ; repli (ennemi à 400 m) : les 6 points les plus proches de 75 m ; pas d'ennemi : tirage uniforme ; déterminisme pour une graine ;
  `positionElsa(scene.json)` = (−120 ; 39), à > 10 m de tout bâtiment (`construireMonde`), hors eau ; `EMPLACEMENTS_VOITURES` : 6 points dans `parkings[3]`,
  à > 3,5 m des bâtiments et de l'eau, cap ≈ −1,808 rad ; `lacetVers` ; Elsa : intervalle ∈ [20 s ; 50 s] avec `alea` injecté (et `intervalle` surchargé), **offre de 40 s** qui expire,
  `avancerElsa(actif=false)` ne crée rien, répartition 40/60 sur 10 000 tirages (± 3 %), `peutRamasser` à 2,4 m oui / 2,6 m non, `|dy| ≥ 3` non, `prendre`
  ré-arme le minuteur, hasard déterministe pour une même graine.
* **Critères** : modules sans `Math.random`/`Date.now`.

### Lot D — Circulation PNJ
* **Tests** : `etatVoiture` périodique (même état à `t` et `t + L/v`), continu (pas > 1,5 m entre deux appels à 100 ms), **cap continu aux coins (|Δcap| ≤ 0,5 rad par 100 ms, y compris les virages de 100° de `sud` et `nord_est`)**, cap = direction de la corde ±2 m,
  voie à droite (`(−hz, hx)`), jonctions en mitre sans pointe (le décalage ne dépasse pas `mitre × decalageVoie`), 12 voitures sans doublon d'id, espacement `L/n`, **vitesse unique `VITESSE_PNJ_M_S`** ;
  circuits fermés (premier = dernier point, à 0,00 m), **sens antihoraire sur l'anneau** (aire signée des points à < 22 m du centre), **chaque échantillon (tous les 2 m) à `demiLargeur` + marge d'un bâtiment
  (`resoudre` sans contact, dégagement minimal annoncé 2,74 m)** — la valeur de `decalageVoie` est réglée jusqu'à ce que ce test passe (min 0) ; `joueurEcrase` : au centre oui, à 0,6 m latéral (r 0,4 + demi-largeur 0,95, **sans marge**) borne, sur le toit
  (pieds ≥ 1,6) non ; `ecrasements` : chaque joueur testé à SON `tMs` ; accord client/serveur (appel deux fois, résultat identique) ; précision numérique à `t ≈ 1,7·10¹²` ms ;
  `distanceAuxCircuits` / `ecarterDesCircuits` (sur le vrai `scene.json` + 111 points : combien restent, ≥ 30 sinon `points` inchangé).
* **Critères** : aucune dépendance à `match.ts` ; **aucun script `.mjs`** (la vérification de dégagement vit dans vitest).

### Lot E — Véhicules
* **Tests** : accélération/vitesse max/marche arrière ; braquage nul à l'arrêt ; collision bâtiment (la voiture ne traverse pas, perd sa vitesse normale, `choc` > 0) ;
  `positionSiege` des 4 sièges distincts et dans la boîte ; `pointDeSortie` hors bâtiment ; `renverse` (≥ 6 m/s mesurés oui, 3 m/s non, **vitesse déclarée sans effet**) ; `Garage` : `monter` (loin → refus,
  siège le plus bas, plein, déjà à bord), `descendre` (arrête la voiture si conducteur), **`liberer`** (mort / déconnexion : siège libéré, voiture arrêtée, ids renvoyés), `changerSiege` (siège pris refusé), `recevoirConduite` (non-conducteur
  refusé, seq non croissante refusée, téléportation refusée, dans un bâtiment refusé, vitesse déclarée bornée, **`y` forcé à 0 : un conducteur qui envoie y = 15 reste au sol**), `histo` borné, `etatAu` (interpolation entre deux états,
  extrapolation bornée), `vitesseMesuree` (une voiture immobile qui déclare 24 m/s : 0), `yeuxPossibles`, `vitesseOccupant` (cap × v), `tic` (abandon 60 s ⇒ remise à place ; **conducteur muet 500 ms ⇒ v = 0**),
  `renversements` (protégés/occupants exclus, crédit au conducteur, **piéton testé à `tMs − 110 ms`**) ; `InterpolateurVehicules` (interpolation, extrapolation 150 ms, angle plus
  court chemin, **saut de remise en place non interpolé**, `tamponMs` long) ; `ControleurVehicule` (seq croissante, `messageConduite` null hors conducteur, `commandesDepuisEntrees`).
* **Critères** : `Garage` n'importe pas `match.ts` ; physique déterministe (pas d'aléa).

### Lot F — Killcam, pseudos, réseau
* **Tests** : `dansChampDeVue` (devant/derrière/limite à 60°) ; `ligneDeVue` sur le vrai `scene.json` (un joueur derrière un bâtiment : faux ; visible : vrai ;
  accroupi derrière un muret) ; `VisibilitePseudos` : alpha monte en 0,15 s, descend en 0,10 s, test à 10 Hz seulement (compter les appels `visible` via un monde
  espion), plus de pseudo au-delà de 70 m, `oublier` ; `hauteurPlaquePx` (24 jusqu'à 30 m, 14 à ≥ 55 m, monotone) ; killcam : phases rejeu 2,5 s → carte 1,5 s → terminé,
  `passerKillcam` saute à la carte, repli sans rejeu (`avecRejeu` faux ⇒ phase `carte`), `tempsRejeuServeur` monotone de `tMort − 2500` à `tMort` (avec `tMortServeur` = `mort.ts`), progression 0..1,
  `cameraTueur` (œil abaissé accroupi, **assis : `p` + `OEIL_SIEGE`**) ; `Interpolateur(4000)` garde 4 s et `Interpolateur()` 1 s (régression : `reseau.test.ts` inchangé) ; `ecrire` : `coup` et `conduite` périssables (non rejoués après une coupure) ;
  `urlArene()` par défaut en production = hôte v2.
* **Critères** : `reseau.test.ts` vert sans modification hors ajouts.

### Lot G — Équipement & touches
* **Tests** : `depuisAlias("sniper")` ⇒ principale sniper, main principale ; `"pistolet"` ⇒ main secondaire ; spéciale/invalide ⇒ null ;
  `normaliserEquipement` ; `slotVoisin` saute la spéciale vide, cyclique, dans les deux sens ; `lireEquipement` migre `pdj-fps-arme` et ignore le JSON abîmé ;
  `serialiserSlots`/`lireSlots` aller-retour ; `ControleurArmes` : chargeurs pleins, munitions gardées au changement, recharge annulée au changement, sortie 350 ms
  (`peutTirer` faux avant), `rapide` revient au dernier slot, `couteauRapide` aller-retour, spéciale épuisée ⇒ retirée et retour au slot précédent, recharge refusée
  (couteau, spéciale, chargeur plein), `appliquerServeur(apparition)` remet tout à plein, `appliquerServeur(equipement)` pose la spéciale ; `touches.test.ts` : défauts
  sans doublon (10 actions v1 conservées + 9 nouvelles = 19), **`accroupi` = `["KeyC", null]` (jamais Ctrl gauche)**, `GROUPES_ACTIONS` couvre toutes les actions
  une seule fois, `assigner` entre nouvelles actions, **migration d'une sauvegarde v1 (14 actions) sans perte des touches v1, y compris le cas `recharger: KeyE` (ou `KeyC`, `KeyF`, `KeyQ`, `KeyV`) : l'action v1 garde sa touche, la nouvelle action
  correspondante reprend son second emplacement ou `null`, et `actionsSansTouche` la liste**.
* **Critères** : aucune dépendance DOM autre que le `stockage` injecté.

### Lot H1 — Rendu avatars, armes, effets, sons
* Hors vitest sauf `traceurs.ts` (non couvert : `rendu.ts`, `sons.ts`). Vérification **visuelle** documentée (captures Playwright via `window.__arene`).
* **Tests** `traceurs.test.ts` : `dureeVie ≥ 0,25` pour toute distance ; `instantImpact = distance/vitesse` ; `etatTraceur` : tête de `depart` à `fin`, queue à
  `longueur` derrière, alpha décroissant, `fini` après la vie ; sniper/railgun persistants ; `largeurMonde` ≥ 0,04 et proportionnelle à la distance ; `TRACEURS` couvre
  toutes les `ARMES`.
* **Critères visuels** : avatars 1,25× lisibles à 100 m ; pseudo masqué par `afficherPseudo(0)` ; trait visible de la bouche à l'impact pendant ≥ 0,25 s ; modèles des 7
  armes + couteau en main et sur l'avatar ; pose accroupie et assise ; aucune fuite (dispose des géométries/matériaux des rubans et des `LineMaterial`).

### Lot H2 — Rendu monde
* Voitures PNJ (12 instances), voitures conduisibles (6, couleur du conducteur), Elsa + caisse + faisceau. `renderOrder` des faces/arêtes comme les avatars (masqué par les
  bâtiments). Pas de test unitaire ; critères visuels : voitures sur les circuits, faisceau visible à 150 m, caisse invisible quand `offre` est null, `dispose` complet.

### Lot U1 — UI lobby, équipement, hôte
* **Critères** : lobby avec deux groupes de cartes (principale, secondaire) navigables au clavier, `aria-pressed`/radio corrects, barres `role="img"` « X sur 10 » ;
  l'équipement choisi persiste et survit au rechargement (clé `pdj-fps-equipement`, migration de l'ancienne clé) ; l'hôte fournit les `PropsHudArene` réelles (équipement, bascule d'accroupi, `actionsSansTouche`, `surPasserKillcam`) ; contraste AA
  (tokens `--ag-*`, déjà posés par le lot 0), mobile < 640 px sans défilement horizontal ; plus de couleur en dur hors tokens.
* **Tests** : `npm run build` ; capture Playwright du lobby (desktop + 390 px).

### Lot U2 — UI HUD, killcam, touches
* **Critères** : bouclier + régénération + slots + invites + HUD véhicule + annonces + killcam rendus à partir de `HudEtat`/`useArene` (aucun champ non scalaire dans `HudEtat`) ;
  aucune lecture de `INFOS_ARMES[arme]` sans passer par `libelleCause` ; `prefers-reduced-motion` ; cibles tactiles ≥ 40 px ; focus visible ; menu pause avec touches groupées et avertissement des actions sans touche.
* **Tests** : `npm run build` ; captures du HUD (vivant, mort/killcam, véhicule) par `window.__arene`.

### Lot S1 — Serveur : `Salle`
* §6.1. **Tests** (`match.v2.test.ts`, réutiliser les helpers `duel()`/`tirer()`) : équipement (alias, `equiper`, `main` refusé sans slot, tir d'une arme non en main refusé,
  porte de sortie 350 ms **avec tolérance 30 %** : un tir à 260 ms est accepté, à 200 ms refusé ; cadence par arme sans contournement par aller-retour ; **crédit de rafale en temps du minigun**),
  `EQUIPEMENT_DEFAUT` jamais muté (deux joueurs, l'un perd sa spéciale, l'autre la garde), couteau (tue à 100 PV, 2 coups avec bouclier, hors portée refusé, cadence 0,5 s, mort
  créditée, `coup` diffusé, **fenêtre de rejeu 200 ms, `o` trop loin de l'œil connu refusé, `d` non normalisé refusé, cosinus de visée refusé, `o` non fini refusé**), bouclier (absorbe d'abord ; `degats.bouclier`),
  régénération (3 s : inchangé ; 8 s : 100 ; bouclier non régénéré), **`quitter` puis `rejoindre` +100 ms : jamais refusé, PV restaurés (pas de soin) ; après 61 s : 100 PV ; mort puis quitter : 100 PV**,
  accroupi (refus en l'air ; tir à hauteur de tête debout manque l'accroupi ; œil abaissé accepté ; `histo` porte l'accroupi), `mort` porte `ts` et `cause`,
  apparitions (rayon 25–140 m du rond-point, **distance médiane à l'ennemi ≤ 100 m à 2 joueurs**, aucun point à < 4 m d'un circuit PNJ quand `circulation` est fourni, regard ± 0,6 rad, v1 inchangée sans options),
  `rejoindre` envoie `apparition`, `presence`, puis `elsa{etat}` et `sieges` au seul demandeur, `deconnecter` d'un conducteur (siège libéré, `sieges` diffusé),
  `snap` arrondi et champs optionnels absents quand nuls, **spectateurs : 1 snap sur 2, sans `vehicules`**, `bienvenue` inchangé, débit : un scénario de 16 joueurs reste sous
  90 messages/s par client (minigun 25 tirs/s + `etat` 30 Hz + ping ≈ 57).
* **Test de charge (`match.charge.test.ts`)** : 16 joueurs, 6 voitures, 12 PNJ, tic à 60 Hz pendant 10 s simulées ; affiche et vérifie le temps CPU moyen d'un tic (budget fixé après mesure, ≤ 1 ms attendu) et la taille d'un snap sérialisé (≤ 4 200 octets ; v1 : 4 500 ; ordre de grandeur mesuré en v2 : 3 500).
* **Critères** : tous les tests v1 passent (ajustés en §8) ; `serveur-fps` : `npm run typecheck && npm run build` ; `VERSION_PROTOCOLE === 2` refusé pour v1.

### Lot S2 — Serveur : Elsa, véhicules, circulation
* §6.1bis. **Tests** (`match-elsa.test.ts`, `match-vehicules.test.ts`, avec un `ContexteSalle` factice) : Elsa (minuteur déterministe, `intervalle` surchargé, premier arrivé servi, soin 100/100, spéciale + munitions décomptées côté appelant, `elsa{etat}` privé) ;
  véhicules : `monter` ⇒ `embarque` + `sieges`, `refus` (loin, plein, deja, mort) sans `erreur`, descendre/siège, conducteur autoritaire borné (y = 0), **passager tire depuis le siège d'une voiture à 24 m/s (`o` pris sur la voiture rejouée 130 ms plus tôt : accepté)**,
  **`j.v` de tous les occupants = vitesse de la voiture**, conducteur ne tire pas, renversement crédité (vitesse mesurée), piéton qui s'écarte de la voiture visible est épargné, occupants non écrasés, expulsion à la mort, **déconnexion d'un conducteur : voiture arrêtée et `sieges` diffusé**, conducteur muet 500 ms,
  reset au match (`descente{expulse}`) ; PNJ : écrasé ⇒ `ctx.tuer(null, "ecrase_pnj")` sans kill ; protégé épargné ; sur le toit épargné ; testé à `etatT − ping/2`.

### Lot J1 — Client jeu : `jeu.ts`
* §6.2. **Tests** : pas de vitest sur `jeu.ts` ; critères vérifiés à la main/Playwright (§Z) : un joueur local se déplace à 12,5 m/s au sprint ; touches 1/2/3/4, molette, Q, V
  fonctionnent et chaque changement envoie `main` ; couteau tue en un coup ; accroupi abaisse l'œil et réduit la vitesse ; pseudo invisible derrière un bâtiment et visible
  en ligne de vue ; traçante visible ≥ 0,25 s ; minigun à ≈ 25 tirs/s à 30 images/s ; killcam jouée (rejeu 2,5 s, carte 1,5 s) puis réapparition à 4 s, y compris quand le tueur conduisait ; Elsa annoncée, fléchée, cadeau pris (y compris pour un joueur qui entre
  en arène pendant une offre) ; voiture PNJ passe et écrase ; voiture conduisible : entrer (attente de `embarque`, `refus` affiché), conduire, passager qui tire, sortir ; reconnexion et changement d'id sans état résiduel (véhicule, killcam, Elsa) ; survol centré sur le rond-point avant la première apparition.
* **Critères** : pas de fuite (listeners, rAF, renderers) à `dispose` ; `npm run build`.

### Lot J2 — Client : `jeu-killcam.ts`
* **Tests** : `alimenter` puis `surMort` : `tempsServeur()` monotone de `m.ts − 2500` à `m.ts` ; **tampon gelé 150 ms après `surMort`** (un snap à +200 ms n'est pas ajouté ; un tueur qui disparaît du snap à +1 s reste dans le rejeu) ; tueur absent du tampon ⇒ repli (phase `carte`, `camera()` null) ;
  `camera()` d'un tueur assis (position du siège + `OEIL_SIEGE`) ; `vehiculesRejoues()` rend la voiture conduite par le tueur à l'instant rejoué ; `joueursRejoues()` contient soi et pas le tueur ; `passer()` ; `terminer()` vide et dégèle ; mort d'un autre joueur ignorée.

### Lot J3 — Client : `jeu-monde.ts`
* **Tests** : `etatsPnj(t)` identique à `etatVoiture` du serveur (12 états) ; `vehiculesA` interpole et ne lisse pas un saut ; `repereElsa` (angle relatif au regard, distance arrondie à 10 m, −1 sans offre) ; `invite` (Elsa à 5 m : « elsa » ; voiture à 3 m : « monter » avec « n/4 » ; en véhicule : « descendre » ; rien sinon) ;
  `reinitialiser`.

### Lot Z — Docs, déploiement, vérification
* Met à jour `CLAUDE.md` (paragraphe « Arène FPS » : v2), la spec v1 (renvoi + « écarts »), `serveur-fps/README.md` (version 2, variables, ids courts, déploiement ci-dessous), écrit
  `scripts/fps/e2e_arene_v2.mjs` (deux navigateurs Playwright contre `serveur-fps` local, via `window.__arene`, avec `PDJ_FPS_ELSA_MIN_MS` / `MAX_MS` courts pour un test d'Elsa déterministe), exécute la checklist de J1.
* **Déploiement sans coupure (hôte v2 à côté du v1)** — l'ancienne procédure (remplacer le serveur en même temps que la fusion de la PR) coupait en « version » les previews Vercel et le site actuel dès le déploiement du serveur v2 :
  1. déployer le serveur v2 sur un **second hôte** `wss://pdj-fps-v2.toam.tech` (nouveau conteneur `pdj-fps-v2`, nouvelle route Traefik `pdj-fps-v2.yml`, enregistrement DNS) ; `/opt/pdj-fps` (v1) reste intact et sert les clients déjà chargés ;
  2. `cpus` / `mem_limit` du conteneur v2 réglés d'après le test de charge (le v1 est à `cpus: 0.3`, `mem_limit: 256m` ; viser 0,5 si le tic mesuré l'exige) ; `ORIGINES` incluant le joker des previews ;
  3. les previews Vercel de la branche utilisent déjà l'hôte v2 (valeur par défaut de `urlArene()`) : tester là (deux navigateurs, checklist de J1) ;
  4. fusionner la PR : la production utilise l'hôte v2 (aucune variable d'environnement à changer) ; les clients en cache continuent de parler au v1, sans message d'erreur ;
  5. vérifier `GET /sante` des deux hôtes ; retirer le v1 une semaine plus tard (supprimer conteneur et route, laisser une redirection éventuelle).

## 8. Tests existants à ajuster

Mesuré le 23/10 sur une copie du dépôt avec les constantes de vitesse, la nouvelle silhouette (hitbox + œil) et le nouveau `protocole.ts` : **seuls ces tests existants échouent** (exécution) ou ne compilent plus (`tsc`).

| Test | Pourquoi | Ajustement (lot) |
|---|---|---|
| `mouvement.test.ts:74-77` | sprint 12,5, `accelSol` 84 : « exactement 3 m/s à 0,05 s » devient 4,2 | utiliser `MOUV.accelSol * 0.05` ; titres « 6,5 / 9 » (A) |
| `mouvement.test.ts:~209` | « sans entrée avant ou trop lent : pas d'accroche » : le cas « à 5 m/s, si » passe sous `murVitesseEntreeMin` (5,5) | 5 m/s → `MOUV.murVitesseEntreeMin + 1` (A) |
| `mouvement.test.ts:62-69, 82, 88-91` | valeurs symboliques | titres seulement (A) |
| `mouvement.test.ts:299-308` | saut de mur | inchangé (`murSautNormale` 6,5, `murSautVy` 7) ; relire (A) |
| `mouvement.test.ts:521-531` | `postureDe` | inchangé (A) |
| `match.reseau.test.ts:97` | `hypot(v) ≤ 20.001` | `PLAFONDS.vitesseDeclareeMax + 0.001` (**0**) |
| `match.test.ts:30, 50, 155` | annotations de type `ArmeId` : `tsc` refuse `"couteau"` dans `rejoindre.arme` / `tir.arme` | `ArmeFeuId` (**0**) ; `tsc` exclut aussi `npm run build` (le `tsconfig` racine inclut `**/*.ts`) |
| `match.test.ts:343` | `mort` en `toEqual` strict (le message gagne `cause`, `ts`) | `toMatchObject` + test des nouveaux champs (**0**) |
| `match.test.ts:223, 299` | `SILHOUETTE.hauteur / 2` pour la distance de dégâts | `SILHOUETTE.centreY` (S1) |
| `match.test.ts:226-227, 241, 314` | `pv = pvMax − 28` | inchangé tant que le bouclier initial = 0 ; vérifier qu'aucun `tic` > 5 s ne suit un tir (régénération) (S1) |
| `match.test.ts:135-165` | `rejoindre {arme}` | alias conservé : `"sniper"` ⇒ main principale, `"pistolet"` ⇒ main secondaire ; `"laser"` (invalide) ⇒ pistolet (S1) |
| `match.test.ts:136-143, 158-165, 446-464` | regard, plus éloignés, ≥ 10 points distincts | inchangés sans `options.zoneApparition` (S1) |
| `match.test.ts:253-265, 357` | tir d'une autre arme refusé ; `arme` d'un mort | inchangés (S1) |
| `match.reseau.test.ts:82-89` | `quitter` puis `rejoindre` à +100 ms : `histo` vidé | reste vrai (le `rejoindre` n'est plus refusé mais `histo` est vidé au `quitter`) ; ajouter l'assertion de restauration de santé (S1) |
| `armes.test.ts:22-35, 112-120` | boucle sur `ARMES` (11 armes) | les nouvelles armes respectent `mouvement > 0`, `air > 0`, etc. (0) |
| `armes.test.ts:38-47` | stats exactes des 4 ; seul le sniper a `zoom` | inchangé (0) ; ajouter les nouvelles (0) |
| `armes.test.ts:60-105` | `JEU.pvMax` vs sniper | `pvMax` reste 100 (0) |
| `tir.test.ts:156` | littéral `0.38` | passe tel quel (vérifié) ; remplacer par `E.corps.rayon` par cohérence (B) |
| `touches.test.ts` | `arme1..4` | nouvelles actions, migration (G) |
| `reseau.test.ts` | `Interpolateur()` ; `bienvenue` littéraux | inchangé (valeur par défaut 1000 ; `bienvenue` inchangé) (F) |
| `ressenti.test.ts`, `tir.test.ts` (reste) | constantes de vitesse, silhouette | passent sans modification (vérifié) |
| `collision.test.ts:298-340, 11` | `pointsApparition` complet ; `R`/`H` | inchangés (aucun lot) |
| `vue.test.ts`, `cachettes`, `lib/agroparc3d/*` | – | inchangés |

## 9. Risques

1. **Déploiement** : client Vercel et serveur doivent être en v2 ensemble ; résolu par l'hôte v2 séparé (§7 lot Z) : les clients v1 en cache continuent d'utiliser `wss://pdj-fps.toam.tech`. Prévoir le rollback par simple retour de l'URL par défaut.
2. **Débit** : un snap à 16 joueurs fait ≈ 4,5 ko en v1 (≈ 760 kbit/s par client à 20 Hz) ; en v2 avec arrondi au centime, ids courts, `bouclier`/`accroupi`/`vehicule` et 6 voitures, ≈ 3,5 ko (**−21 %**, pas −43 % comme annoncé à tort), soit ≈ 570 kbit/s par
   client et ≈ 9 Mbit/s de sortie totale à 16 joueurs. Mesures prises : snaps des spectateurs à 10 Hz sans `vehicules`. Pistes si insuffisant : positions en entiers (cm) ou tableaux compacts (≈ 1,1 ko, changement de protocole). Anti-flood : 90 msg/s coupe la connexion ;
   le débit client est de `etat` 30 + `tir` jusqu'à **25/s (minigun, 0,04 s) ou 17/s (mini-uzi)** + ping ≈ 57 msg/s (conducteur : `conduite` 30 ; passager : `etat` 15 + tirs) : sous la limite, mais ne jamais ajouter un flux à 30 Hz sans en retirer un. Message client limité à 4096 octets.
   **CPU** : le conteneur v1 est limité à `cpus: 0.3` / `mem_limit: 256m` ; le test de charge `match.charge.test.ts` (16 joueurs, 12 PNJ, rejeu des positions) donne le budget avant le déploiement.
3. **Tolérances serveur** : plafonds de vitesse plus hauts (19 m/s, véhicule 28 m/s) = plus de marge de téléportation pour un client truqué ; accepté (jeu de bureau).
   La tolérance de touche `1,2 + v × 0,2` m (mesurée à l'axe de la silhouette) est large à 16 m/s (≈ 4,4 m) : surveiller les touches « miraculeuses », resserrer si besoin.
4. **Hitbox agrandie vs œil** : traité (œil à 1,95 m, §2.1). Reste à valider au ressenti : la caméra est plus haute de 33 cm ; `SILHOUETTE.oeil` est la seule constante à changer pour ajuster (serveur et caméra la lisent via `oeilDe`).
5. **Circuits PNJ** : les quatre circuits passent par le nœud est du rond-point (≈ une voiture toutes les 2,6 s) ; le passage étroit du circuit sud
   (2,7 m en (11 ; 81)) impose un décalage de voie 0,6 m ; les points d'apparition à < 4 m d'un circuit sont écartés (obligatoire, §2.10). Les voitures PNJ sont **toujours létales** (vitesse ≥ 6 m/s). La vitesse unique évite que les voitures se traversent sur les arcs partagés
   (elles restent à des voies décalées différentes).
6. **Horloge** : `client.maintenantServeur()` peut dériver de quelques dizaines de ms ⇒ ±0,3 m à 9 m/s ; l'écrasement n'a plus de marge (équité) : un faux positif est possible quand la dérive dépasse 30 ms ; `T0_MS` évite la perte de précision flottante.
7. **Véhicules** : autorité client du conducteur ⇒ téléportations bornées par 28 m/s, `y` imposé à 0 ; `Garage.positionOccupant` appelé dans `tic` ; `histo` alimenté pour les occupants ; tolérance d'œil du passager sur l'historique de la voiture ;
   interaction E/F avec le pointer lock (les touches arme sont traitées sans pointer lock, pas E) ; `resoudre` n'est pas réentrant (le `tampon` de la grille est partagé) : ne pas l'appeler depuis deux contextes
   imbriqués ; collisions voiture/voiture ignorées. Les services S2 partagent le `Monde` avec `Salle` : appels séquentiels uniquement.
8. **Killcam** : tampon long de 4 s × 20 Hz × 16 joueurs (≈ 1 300 objets) + voitures ; le tueur peut avoir quitté ⇒ repli prévu et tampon gelé ; `retirerAvatar` supprime les avatars absents de
   `etats` : en rejeu utiliser l'échantillon du tampon long pour créer/retirer ; sortir de la killcam sur `apparition` ET sur changement d'id de client ; le rejeu reste approximatif
   (snaps à 20 Hz, positions serveur, pas les prédictions locales ; traçantes non rejouées).
9. **Régénération/Elsa et `quitter`/`rejoindre`** : pas de verrou ; la santé est restaurée pendant 60 s (aucun soin gratuit). Un joueur qui quitte puis revient garde donc ses PV bas ; il perd sa spéciale.
10. **Rendu** : `LineSegments2` coûte plus cher que `LineSegments` (16 avatars × ~60 segments), sans repli ; `rendu.ts` n'est pas couvert par vitest ⇒ toute régression visuelle se
    détecte aux captures ; `PLACEMENT`/profils sonores sont des `Record<ArmeFeuId, …>` : une arme oubliée casse la compilation (voulu) ; 8 modèles d'armes à dessiner.
11. **Tests v1 sur `prochainTir`** : aucun test ne lit `prochainTir` (grep) ; le remplacer par `cadenceArme` est sûr, mais la cadence rafale doit être conservée par arme, avec le crédit en temps (§2.4).
12. **Équilibrage des dégâts** : le sniper à la tête à 300 m tue encore un joueur à 100 + 100 ; le railgun tue en un coup à la tête à toute distance, le magnum doré jusqu'à 40 m seulement ; le pompe à bout portant (9 × 20 = 180 max) ne tue plus un joueur à 100 + 100 en un coup
    (voulu). Le couteau (100) ne tue pas un joueur protégé par un bouclier : équilibrage à observer.
13. **Accroupi** : `C` par défaut ; `Ctrl` n'est plus proposé (Ctrl+W ferme l'onglet, Ctrl+clic est un clic droit sur Mac, Ctrl+1..4 change d'onglet).
14. **Dépendance Node 22** pour vitest (`cachettes.test.ts`) ; `serveur-fps` exclu du `tsconfig` racine (typecheck propre).
15. **Spec v1** : l'« anti-triche léger » et les « limites connues » restent vrais ; le wallhack est inchangé (tous les snaps contiennent tous les joueurs ; le pseudo caché n'est qu'un
    confort visuel).
16. **Migration des touches** : une sauvegarde v1 qui occupe déjà `C`, `E`, `F`, `Q` ou `V` laisse la nouvelle action sans touche ; avertissement dans le menu pause (§6 `touches.ts`).

## 10. Annexe — coordonnées (scene.json, repère local en mètres)

Revérifiées par script le 22/10 puis le 23/10 sur le vrai `scene.json`.

**Rond-point** : centre **(28,2 ; 2,5)**, rayon 18,1 m, `roads[4, 120, 121, 122]` (classe M), sens antihoraire : est (46,3 ; 5,8) → nord (32,9 ; −15,2) → ouest
(11 ; −3,2) → sud-ouest (23,8 ; 20,1) → sud → est. Branches : est `roads[2]` 280 m ; nord `roads[330]` ; ouest `roads[218]` ; sud-ouest `roads[214]`.
Distances au rond-point : Trèfle 53 m, Pause 58, Mijote 64, Basilic 87, Dubble 118, Truck 158, Vival 172, CBA 192.

**Truck Muche / Elsa** : POI `truck` (−125 ; 39) ; Elsa et cadeau en **(−120 ; 39)** ; voie d'arrivée `truckRoad`, aucune route à < 40 m ; **le POI est à 14,1 m du bâtiment le plus proche
(`buildings[116]`), Elsa à 16,7 m du sien (`buildings[46]`)** (les deux chiffres coexistaient sans explication) ; 12 points à 5 m du POI tous dégagés de 9,2 à 17,9 m.

**Circuits PNJ** (sens de parcours ; ANNEAU, NORD_EST, OUEST copiés du rapport de géographie ; SUD **inversé** car la liste d'origine parcourait l'anneau à
contresens) :
* `anneau` (114 m, 3 voitures, 9 m/s, décalage 3,2 m) :
  `[[46.3,5.8],[43.8,-7.3],[32.9,-15.2],[19.6,-13.5],[11,-3.2],[11.1,8.5],[14,13.7],[23.8,20.1],[31.2,20.5],[38.1,17.8],[43.5,12.7],[46.3,5.8]]`
* `sud` (342 m, 2 voitures, 9 m/s, décalage 0,6 m ; passage étroit 2,7 m en (11 ; 81)) :
  `[[46.3,5.8],[116.3,25.1],[103.3,67.4],[89.1,63.1],[78.5,94.1],[7.7,80],[-4.5,73.9],[17.3,44.7],[23.8,20.1],[31.2,20.5],[38.1,17.8],[43.5,12.7],[46.3,5.8]]`
* `nord_est` (647 m, 3 voitures, 9 m/s, décalage 1,5 m ; dégagement mini 4,6 m en (216 ; −6)) :
  `[[46.3,5.8],[43.8,-7.3],[32.9,-15.2],[36.6,-44],[29.5,-131.5],[48.8,-129.2],[229.4,-77.8],[234.5,-73.3],[206.5,29.4],[95.9,-4.3],[88.8,16.9],[46.3,5.8]]`
* `ouest` (770 m, 4 voitures, 9 m/s, décalage 1,5 m ; dégagement mini 8,6 m) :
  `[[46.3,5.8],[43.8,-7.3],[32.9,-15.2],[19.6,-13.5],[11,-3.2],[-62,-21],[-73.7,-27.3],[-105.2,-34.9],[-115.3,-34.9],[-184.6,-54.9],[-228.7,75.4],[-110,116.4],[-41.5,146.8],[-17.6,92],[17.3,44.7],[23.8,20.1],[31.2,20.5],[38.1,17.8],[43.5,12.7],[46.3,5.8]]`

Chaque liste est simplifiée (Douglas-Peucker 1,5 m) ; les quatre circuits sont fermés, à moins de 1,4 m des routes, sans aucun point dans un bâtiment (dégagement minimal mesuré le 23/10 : 2,74 m, avant décalage de voie).
Le lot D les **revalide dans `circulation.test.ts`** (fermeture à 0,00 m, 0 échantillon tous les 2 m dans un bâtiment sur la ligne décalée, via `construireMonde` et `resoudre`) et peut
re-échantillonner. Le `decalageVoie` est réglé par ce test de dégagement. Les coins atteignent 100° sur `sud` et `nord_est` : mitre bornée pour la ligne décalée, corde de ±2 m pour le cap (§2.11).

**Parking des voitures conduisibles** : `parkings[3]`, polygone
`[[-32.9,-30.2],[9.8,-19.9],[12.6,-24.8],[17.7,-35.2],[-38.2,-51.5],[-43.8,-32],[-36.7,-30.9],[-34,-30.4],[-32.9,-30.2]]` (1 032 m², à 58 m du rond-point, bâtiments à > 15 m).
Axe long à +13,6° (cap en convention lacet : **−1,808 rad**, voitures orientées vers l'est-sud-est). Six emplacements (rangée A puis B, espacés de 9 m le long de l'axe,
9 m entre les rangées) :
`A : (8.2 ; −24.5), (−0.8 ; −26.5), (−9.8 ; −28.5)` · `B : (10.2 ; −33.5), (1.2 ; −35.5), (−7.8 ; −37.5)`.
`roads[83]` (S) traverse le parking à 3,8–5,4 m de chaque emplacement (les voitures garées ne la bloquent pas). Repli : `parkings[11]` (4 emplacements :
(−7,5 ; 16,9), (−16,5 ; 15,9), (−25,5 ; 13,9), (−32,5 ; 19,9)).

**Apparitions** : anneau 25–140 m autour de (28,2 ; 2,5) ; de 612 points (carte entière) à **111** (mesuré le 23/10 dans l'anneau : < 130 m : 91 ; < 100 m : 55 ; < 80 m : 30 ; < 60 m : 16 ; < 40 m : 5 ; la première version de
la spec comptait ces seuils depuis le centre, anneau intérieur compris, et annonçait 60 à < 100 m). Dont **46 à moins de 4 m de l'axe d'un circuit PNJ**, écartés (§2.10). Bande de choix 40–110 m de l'ennemi le plus proche, repli sur 75 m.
**Bornes de la carte** (inchangées) : x ∈ [−348,8 ; 392,4], z ∈ [−257,9 ; 233,7].


## 11. Décisions à confirmer par l'utilisateur

Ces choix sont retenus dans la spec ; chacun se change en une constante ou une ligne.

1. **Le conducteur ne tire pas, les passagers tirent** (`CONDUCTEUR_TIRE = false`). L'énoncé (« on peut rentrer à 4 dans une voiture et il y en a qui peuvent tirer pendant qu'on conduit ») se lit « certains occupants tirent » ;
   si le conducteur doit aussi tirer, passer la constante à `true` (il tirerait avec le volant à la main, œil à `OEIL_SIEGE`).
2. **Pas de vraie balle avec chute (bullet drop)**. Le jeu reste en hitscan : les dégâts sont instantanés. Ce que l'utilisateur voit comme une « chute » est, d'après le code, soit le trait visuel court de la v1, soit la **chute des dégâts avec la distance**
   (`STATS[].chute`) ; la v2 ajoute des traçantes voyageuses visibles de la bouche à l'impact (§2.9). Une balle physique avec chute et temps de vol demanderait une simulation de projectiles côté serveur (autre conception).
3. **Délai de réapparition 3 s → 4 s** (2,5 s de rejeu de killcam + 1,5 s de carte du tueur) ; la première version de cette spec disait 5 s. « Passer » saute le rejeu mais pas l'attente. Moins de temps mort : réduire `KILLCAM.rejeuMs` ; ou aucune killcam
   obligatoire si on préfère 3 s de délai sans carte.
4. **L'œil monte de 1,62 m à 1,95 m** avec les personnages plus gros (×1,25) : la caméra est plus haute de 33 cm. Alternative : garder 1,62 m et ne pas agrandir la hitbox de tir (mais alors les personnages gros se touchent plus facilement que ce qu'on voit d'eux).
5. **Vitesse unique de 9 m/s pour les quatre circuits de voitures PNJ** (6 à 11 m/s dans la première version).
6. **Pseudo visible jusqu'à 70 m** (illimité en v1, 100 m dans la première version de cette spec).

## 12. Journal des révisions

Revue du 23/10 (deux critiques adversariales : cohérence/complétude et faisabilité), toutes les affirmations vérifiées par script ou par exécution sur une copie du dépôt.

| Point soulevé | Traitement |
|---|---|
| Killcam sans horodatage serveur | `mort.ts` (§3, §2.5), `tMortServeur = m.ts` |
| Killcam : voitures conduisibles non rejouées, `cameraTueur` sans véhicule | `InterpolateurVehicules(tamponMs)` long, `cameraTueur` via `oeilDe` (siège + `OEIL_SIEGE`), voitures PNJ à `tempsRejeuServeur` (§2.5, §5.8, §5.11) |
| Killcam : tueur évincé disparaît du rejeu, effets du présent superposés | tampon gelé 150 ms après `mort`, effets en direct coupés (§2.5) |
| Tirs de passagers refusés en roulant | `j.v` des occupants = vitesse de la voiture, `Garage.yeuxPossibles` sur l'historique du véhicule (§2.12, §5.7) |
| Écrasements injustes (PNJ et joueurs) | instant propre à chaque joueur, marge 0, historique des véhicules `etatAu`, vitesse de renversement mesurée (§2.11, §2.12, §5.5, §5.7) |
| Conducteur sur un toit (`y`) | `y` forcé à 0 (§2.12) |
| Elsa/sièges reçus avant l'entrée en arène perdus | sync privée à chaque `rejoindre` (`elsa{etat}`, `sieges`), `bienvenue` inchangé (§2.7) |
| Contrats U1/U2 circulaires, `Props.killcam`, `Annonce`/`Bonus` sans fichier, tokens `--ag-*` | `contrats.ts` réel du lot 0, `killcamInfo`, tokens posés par le lot 0 (§5.17) |
| `tsc` rouge au lot 0 (`bienvenue`, `ArmeFeuId`), tests oubliés | `bienvenue` inchangé, retouches de tests listées pour le lot 0 ; test `mouvement.test.ts:209` ajouté ; lignes `ressenti`/`tir` retirées (passent) (§7, §8) |
| Fichiers « disjoints » faux, onze éditeurs de la spec | propriété par phase, shims du lot 0 listés, seul l'orchestrateur édite la spec (§7) |
| Apparitions : chiffre trompeur, bande, circuits PNJ non filtrés | règle de bande 40–110 m + repli 75 m, `choisirPointZone`, `ecarterDesCircuits` obligatoire, mesures (§2.10) |
| Accroupi sur Ctrl gauche | `C` seul par défaut (§2.8) |
| `recevoirCoup` sans anti-triche, `coup` non périssable, fenêtre de rejeu | mêmes contrôles que `recevoirTir`, `coup` périssable, `REWIND_MELEE_MS = 200` (§2.4, §6.1.8) |
| `EQUIPEMENT_DEFAUT` mutable partagé | figé + `copierEquipement` (§3, §2.4) |
| Protocole des véhicules incomplet, `deconnecter`, `v = 0`, saut de remise en place | `embarque`/`refus`, `Garage.liberer`, silence conducteur, détection de saut (§2.12, §5.7, §5.8) |
| `rejoindre` refusé sans retour | jamais refusé, santé mémorisée 60 s (§2.6) |
| Dégainage strict | tolérance 30 % (§2.4) |
| Offre d'Elsa trop courte, tests E2E non déterministes | 40 s, intervalle surchargeable (§2.7) |
| `verifier_circuits.mjs` impossible | supprimé, vérifications dans vitest (§7 lot D) |
| Migration des touches | `ACTIONS_V1` d'abord, `actionsSansTouche` (§6) |
| Mise en production : previews et site coupés | second hôte v2, URL par défaut changée, ordre de déploiement (§7 lot Z) |
| Demande 2 : mauvais diagnostic | cause = plaque de taille constante ; distance 70 m ; critère visuel (§2.2) |
| Survol sur le rond-point absent du lot J | ajouté (§6.2) |
| Risque 2 : cadence de tir fausse | 25/s (minigun) et 17/s (mini-uzi) (§9) ; crédit de rafale en temps et boucle de tir client (§2.4) |
| Hitbox : œil à 1,62 m, tolérance qui refuse le sommet de la tête, `histo` sans accroupi | œil 1,95 m, tolérance à l'axe de la silhouette (1,5 aurait cassé `match.reseau.test.ts:78`), `accroupi` dans `histo` (§2.1, §2.8) |
| Circulation : cap aux coins, vitesses différentes sur arcs partagés | corde ±2 m, mitre bornée, vitesse unique (§2.11) |
| Bande passante −43 % faux, spectateurs, CPU | −21 %, spectateurs à 10 Hz sans véhicules, test de charge (§6.1.13, §9) |
| S et J goulots d'un seul agent | S1/S2, J1/J2/J3, services et contrôleurs (§5.19, §5.20, §7) |
| Glissade, `LineSegments2` « repli », spéciales à 210, traçantes plus lentes que les dégâts | état propre ; import statique sans repli ; texte corrigé (railgun partout, magnum ≤ 40 m) ; accepté et documenté (§2.8, §2.1, §4, §2.9) |
| Annexe : 60 points à < 100 m, 14,1 m / 16,7 m | 55 ; deux bâtiments distincts (§10) |

## 13. Ajouts de l'utilisateur (23/10) — PRIORITAIRES sur les sections précédentes

En cas de contradiction avec §1 à §12, cette section l'emporte.

### 13.1 Aucune dispersion : « ce qui est sous le réticule est touché »

* **Toutes les armes** tirent exactement dans l'axe de la vue (œil → centre du réticule), quels que soient le mouvement, le saut, le wall-run, l'accroupi
  ou la visée. `dispersionCourante` renvoie **0** pour toute arme ; la chaleur (`apresTir`, `refroidir`, `delaiRefroidissement`) n'influe plus sur la
  direction (elle peut être supprimée ou gardée à 0 ; les tests de chaleur sont réécrits en conséquence). Plus de `parTir`, `mouvement`, `air`, `viseur`
  qui écartent le tir. La dispersion ×0,65 accroupie (§2.8) devient sans objet.
* **Fusil à pompe** (et toute arme à plusieurs plombs) : gerbe **FIXE et déterministe**, centrée sur l'axe : 1 plomb au centre + 8 sur un cercle de
  demi-angle constant (`gerbe` dans `STATS`, ≈ 0,055 rad), orientée dans la base (u, w) de `directionsTir`. Plus aucun `alea` dans le tir.
* Le **recul** de la vue reste (le premier tir part toujours pile ; le recul ne déplace que la vue des tirs suivants).
* Viseur : statique (plus de viseur dynamique selon la dispersion) ; la lunette du sniper n'a plus besoin de cercle de dispersion.
* Le serveur garde ses contrôles (`COS_VISEE_MIN`, etc.) ; il peut en plus vérifier que les directions d'un tir de pompe respectent la gerbe à 0,02 rad près.

### 13.2 Correctifs du diagnostic sniper (touches non comptées)

1. **Retour de touche confirmé par le serveur** : le son « tic », le marqueur de touche et la giclée sur la cible ne partent plus au tir mais à la réception de
   `degats` avec `par === moi` (zone et dégâts du serveur) ; le HUD affiche le **chiffre des dégâts** (rouge/jaune tête, gris bouclier). Kill confirmé sur `mort`.
2. **Bug de réentrée** : `j.seq = -1` dans `placer` ET `rejoindre` (match.ts), sinon après « Quitter l'arène » puis réentrée sur la même connexion tous les
   états sont ignorés (seq client repart à 0) et tous les tirs sont rejetés. Test de régression dans `match.test.ts`.
3. **Ligne de vue près des murs** : dans `toucheVraisemblable`, la ligne de vue ne va que jusqu'à `proj − rayonCorps` (point d'entrée dans la capsule),
   pas jusqu'au centre de la cible : une cible collée à un mur ne rejette plus des touches justes. Test dédié.
4. **Visée et secousse** : le tir part de la même direction que la caméra (`tangage + kick`), ou la secousse de dégâts reçus ne touche plus le tangage de la caméra
   (au choix du lot J1, mais tir et caméra doivent coïncider exactement ; test sur `vue.ts`).

### 13.3 Glissade OBLIGATOIRE (plus un bonus)

Appuyer sur `accroupi` pendant un sprint au sol déclenche une vraie **glissade** au sol comme dans les FPS courants (§2.8 pour la mécanique : seuil 10,5 m/s,
0,75 s, décroissance quadratique, direction figée) : caméra basse avec léger roulis, son de frottement (lot H1), sauter pendant la glissade garde l'élan
(saut glissé), hitbox accroupie pendant la glissade. Test de ressenti obligatoire (lot A).

### 13.4 HUD, mini-map, tableau des scores

La refonte du HUD, la **mini-map** (position personnalisable : au minimum haut-droite / bas-gauche, mémorisée) et le **tableau des scores enrichi** suivent la
spec dédiée `docs/superpowers/specs/2026-10-23-arene-hud-design.md`, qui prime sur §6.3 pour l'UI. Munitions restantes (chargeur + réserve) toujours visibles.

### 13.5 Décisions §11 retenues par l'orchestrateur

Toutes les valeurs par défaut de §11 sont retenues (conducteur ne tire pas, hitscan, réapparition 4 s, œil 1,95 m, 9 m/s PNJ, pseudo ≤ 70 m).

### 13.6 Décisions après revue (23/10) — PRIORITAIRES sur les sections précédentes

* **Déploiement : la v2 REMPLACE la v1 sur le même hôte `wss://pdj-fps.toam.tech`** (client et serveur sont déployés ensemble ; plus d'hôte `pdj-fps-v2`,
  §1 « second hôte » et §7 lot Z « sans coupure » sont caducs). `urlArene()` pointe sur `wss://pdj-fps.toam.tech` ; un client v1 encore en cache reçoit
  `erreur{version}` (« rechargez la page »).
* **Capacité** : les 16 places sont celles des joueurs EN ARÈNE (`rejoindre`), pas des connectés : `rejoindre` au-delà de 16 répond `refus{action:"rejoindre",
  raison:"plein"}` (la socket reste ouverte, le client sort de la partie et le panneau affiche « L'arène est pleine »). `connecter` plafonne à
  `JEU.connexionsMax` = 64 (`erreur{plein}`), le serveur à 96 connexions au total et 24 par IP (dernier élément de `x-forwarded-for`) ; un spectateur sans message utile
  (hors ping et `vueScores`) depuis 15 min est recyclé (fermeture 1001, le client se reconnecte seul).
* **`quitter` puis `rejoindre`** ne contourne plus la réapparition : un mort garde son `reapparitionT` (`reentreeT`), un joueur sorti en vie ne revient pas avant
  `delaiReapparitionMs` (4 s). `rejoindre` n'est toujours pas refusé : le joueur est en attente (`enJeu`, mort) et `tic` le place à `reentreeT`. Une rentrée qui restaure la santé
  (< 60 s) ne redonne pas la protection d'apparition.
* **Killcam** : pendant la carte du tueur, le monde reste figé à l'instant de la mort (`tempsFige`, `joueursFiges`, `vehiculesFiges` de `ControleurKillcam`), sans le tueur.
  Action **`passer`** (touche Espace par défaut, remappable, groupe « Divers ») : seule action du contexte « mort » (`ACTIONS_MORT`), elle PEUT partager une touche avec une action « en vie »
  (Espace = saut).
* **Conducteur** : les autres occupants de sa voiture sont posés sur leur siège de l'état LOCAL de la voiture (`recalerOccupants`), sinon ils se décrochent de 3 à 4 m.
* **Spéciale d'Elsa** : le ramassage mémorise le slot tenu (`ContexteSalle.memoriserPrecedent`) ; à la dernière munition, serveur et client retombent sur le même slot.
* **Glissade** : seuil RELATIF à l'arme (`seuilGlisse(mult)` = 10,5 × multiplicateur : le minigun et le sniper en visée glissent), recharge de 0,6 s (`MOUV.glisseRechargeS`) entre deux glissades,
  champ optionnel `glisse?: boolean` dans `etat` (client → serveur) et dans le snap (serveur → clients), utilisé par `rendu.ts` pour la pose des avatars distants.
* **Gerbe du pompe** : le serveur vérifie à 0,02 rad près (`gerbeRespectee`, `TOLERANCE_GERBE_RAD`) que les plombs d'un tir sont ceux de `directionsTir` autour de l'axe ; sinon le tir est ignoré.
* **HUD** : « SANS RECHARGE » (armes d'Elsa, `reserve: 0`) au lieu de « RÉSERVE ∞ » ; la plaque de match est en `min-height` (la ligne « DERNIÈRE MINUTE » l'agrandit) ;
  `minimapCoin` agit en jeu (toast « Mini-carte : bas-gauche ») ; scores et grande carte acceptent un bouton de souris ; la rupture de bouclier est annulée à la mort ;
  à l'écran de mort et à l'entracte (souris prise) les touches d'arme principale / secondaire passent à l'arme suivante de leur catégorie.
