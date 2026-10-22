# Palantir, chasse au tigre, main humaine et coup de batte : conception

État au 2026-10-22, branche `feat/palantir-chasse-main-batte`. Ce document spécifie ce que la branche doit livrer. Rien n'est encore implémenté à cette date.

La branche doit livrer cinq changements du site Agroporc. Ils touchent le code Next.js et ne modifient pas le pipeline Python :

1. La vue 3D « Agroporc x Palantir » gagne un bouton de sortie et perd les boutons Sportif/Goulaf.
2. Un tigre 3D est caché dans la vue Palantir. Le trouver rapporte des points selon la difficulté de la cachette.
3. Les scores s'enregistrent sous un pseudo dans un classement durable, affiché ou caché d'un bouton.
4. Dans le thème Tigre, la patte avant droite du tigre se transforme en main humaine pendant la poignée de main.
5. Dans le thème Tigre, le tigre frappe Macron avec une batte de baseball quand les deux sont à l'écran.

Les choix marqués « *choix de l'auteur* » sont des décisions de l'auteur de ce document, présentées à l'utilisateur avec le document. Les autres règles de comportement viennent de l'utilisateur.

## Vue Palantir : sortie et boutons

Aujourd'hui, la vue Palantir ne se ferme qu'en retapant `myrtille`. Après ce changement, un bouton « Retour au site » et la touche Échap la ferment aussi.

Sur un téléphone ou une tablette, aucun clavier n'est ouvert, donc le visiteur ne peut pas retaper `myrtille` et reste bloqué dans la vue. Une capture du 2026-10-22 de la vue actuelle, avant ce changement, montre qu'elle s'affiche sans erreur sur ordinateur (1400 × 900 px) et sur mobile (390 × 800 px). Le seul défaut constaté est donc l'absence de sortie.

Changements dans `app/components/Agroparc3D.tsx` et `Agroparc3D.module.css` :

- **Bouton « Retour au site »** : toujours visible, en haut à droite. Il appelle `onClose`, que `MyrtilleEasterEgg` passe déjà. Il reste actif pendant l'écran de chargement et l'écran d'erreur, donc il n'est pas placé dans un bloc `inert={chargement}`. Sa cible tactile mesure au moins 40 px, comme celle des autres contrôles.
- **Touche Échap** : elle ferme la vue, sauf quand le focus est dans un champ de saisie, comme le champ pseudo du classement (voir « Classement durable »).
- **Panneau d'un restaurant** : il descend sous le bouton de sortie pour ne pas le recouvrir.
- **Boutons Sportif/Goulaf** : ils sont retirés, avec `MODES`, `changerMode` et les styles `.modes`. Les jauges du panneau d'un restaurant gardent le mode choisi sur le site. Pour cela, la vue lit le mode avec le hook `useModeSite` (`app/menus/useModeSite.ts`) au lieu de `modeInitial()`. La vue ne modifie plus le mode.
- **Texte d'aide** (`.hint`) : « Retape myrtille pour revenir au site » devient « Échap ou Retour au site pour revenir ». Le texte de l'écran d'erreur suit la même règle.
- **Documentation** : la ligne `Agroparc3D.tsx` de `CLAUDE.md` ne cite plus le toggle Sportif/Goulaf. La spécification `2026-09-09-agroparc-v2-restaurants-design.md` reçoit une note qui renvoie à ce document.

## Chasse au tigre dans Palantir

À chaque ouverture de la vue Palantir, un tigre 3D est placé dans une cachette tirée au hasard parmi plusieurs centaines. Un clic sur le tigre rapporte de 100 à 500 points selon la difficulté de la cachette.

### Règles du jeu, décidées par l'utilisateur

- Pas de chrono, pas de début ni de fin de partie. Le joueur explore la carte librement.
- Le tigre est bien caché à chaque fois, dans l'environnement 3D.
- Une cachette difficile rapporte plus de points qu'une cachette facile.
- Les cachettes possibles sont très nombreuses.

### Déroulé

1. À l'ouverture de la vue, une fois la scène prête, le tigre est posé dans une cachette tirée au hasard.
2. Un clic ou un tap sur le tigre le « débusque ». Le journal d'événements en bas à droite affiche par exemple « Tigre débusqué, cachette difficile, +420 ». Le score et le nombre de tigres trouvés s'affichent en haut à gauche, sous le titre, à la place des anciens boutons Sportif/Goulaf.
3. Le tigre disparaît, puis réapparaît environ 1,5 s plus tard dans une nouvelle cachette.
4. Le score s'additionne jusqu'à l'enregistrement dans le classement.

*Choix de l'auteur* : le score survit à la fermeture et à la réouverture de la vue dans le même onglet, parce que l'état est gardé dans `MyrtilleEasterEgg`. Il est perdu au rechargement de la page.

### Le tigre dans la scène

- **Modèle** : le GLB du thème Tigre (`public/tigre/tigre.glb`), chargé par `chargerModele()` de `lib/tigre3d/modele.ts` et cloné par `SkeletonUtils.clone`. La vue Palantir n'appelle jamais `libererModele()`. Le cache de `chargerModele()` sert aussi au tigre du thème Tigre, qui reste affiché sous la vue Palantir.
- **Taille** : grandeur réelle, 3,75 m du museau au bout de la queue (`ECHELLE_MODELE` de `lib/tigre3d/troupe.ts`). Vu depuis la caméra de départ (voir « Cachettes »), le tigre mesure quelques pixels. Le joueur doit zoomer pour le voir.
- **Rendu** : le matériau du GLB est sans éclairage (extension `KHR_materials_unlit`), donc la scène n'a pas besoin de lumière. Le tigre de Palantir utilise une copie du matériau, assombrie. Elle ne doit ni briller sur le fond noir ni déclencher le halo du post-traitement (`UnrealBloomPass`, seuil 0,24). Le matériau d'origine reste intact pour le thème Tigre.
- **Mouvement** : le tigre garde une posture basse et ne se déplace pas. Le développeur choisit entre deux options : le clip « Curious » du GLB joué avec une faible amplitude, ou une pose fixe sans animation.
- **Clic** : une sphère invisible d'environ 2,5 m de rayon entoure le tigre et reçoit le lancer de rayon (raycast). Un clic compte seulement si le pointeur a bougé de moins de 6 px entre l'appui et le relâchement. Un glisser de caméra n'est donc pas pris pour un clic. Le raycast ne vise jamais le maillage animé (`SkinnedMesh`), parce que three le teste dans sa pose de repos.

### Cachettes

Un module pur `lib/agroparc3d/cachettes.ts`, testé, génère les cachettes candidates à partir de `public/agroparc/scene.json`. Ce fichier contient 142 bâtiments, 788 arbres et 374 tronçons de route, en mètres, dans un repère local. `data.focus` y désigne le point visé par la caméra au repos, au centre du quartier de CBA et des restaurants.

La **zone jouable** est le rectangle qui englobe tous les bâtiments, agrandi de 40 m de chaque côté.

Génération :

1. Échantillonner une grille irrégulière d'un pas d'environ 6 m sur la zone jouable.
2. Écarter les points à moins de 1,5 m d'un bâtiment, à moins de 4 m d'une route, ou dans l'eau.
3. Calculer la difficulté de chaque point restant.
4. Ne garder que les points tapis contre un bâtiment, dont le mur le plus proche est à moins de 5 m, et masqués par un bâtiment depuis au moins 3 des 8 caméras décrites plus bas. Une caméra compte quand les 5 points du corps du tigre sont masqués depuis elle.
5. Écarter le quart des points les moins difficiles.
6. Garder au moins 300 cachettes (le minimum de 500 a été abaissé, voir la décision appliquée plus bas). Un test le vérifie sur le vrai `scene.json`.

*Décision prise après revue de code, le 2026-10-22* : l'étape 4 a été ajoutée parce que, sans elle, l'éloignement suffisait à classer un point en terrain nu dans les paliers facile et moyenne. Mesure sur le vrai `scene.json` : 94 % des cachettes faciles et 88 % des moyennes n'avaient aucun masquage, et 57 % des tirages montraient le tigre à découvert. Le masquage seul admettait encore des points en terrain dégagé à 15 ou 20 m d'un mur, d'où la condition des 8 m. Les arbres ne suffisent pas à admettre un point, parce qu'ils sont dessinés en fil de fer translucide et ne cachent pas le tigre. Avec cette étape, 681 cachettes sont gardées.

*Décision de l'utilisateur, le 2026-10-22* : la règle doit être plus dure. Il faut moins de cachettes, mieux masquées. Le seuil du mur, le nombre de caméras masquées et le nombre de points du corps masqués se resserrent, tant que la règle des 80 m reste tenable et que le minimum de 500 cachettes est atteint. Si ce minimum empêche de durcir la règle, il passe à 300.

*Décision appliquée le 2026-10-22* : mur à moins de 5 m (8 m avant), masqué depuis au moins 3 caméras (2 avant), corps entier masqué depuis chacune (5 points sur 5, 3 sur 5 avant). Cela garde 341 cachettes (681 avant). Le minimum de 500 empêche de durcir : resserrer les trois réglages ensemble donne au plus 451 cachettes (mur à 7 m, 3 caméras, 4 points), et à 500 ou plus le meilleur masquage depuis le départ est 62,1 % des points du corps contre 58,5 % avant (3 caméras, 3 points, mur à 8 m, 513 cachettes), sans toucher au seuil du mur. Le minimum passe donc à 300, comme la décision de l'utilisateur le prévoit. Mesure sur le vrai `scene.json` (7 030 points évalués avant filtre). « Départ » désigne la première des 8 caméras, celle de la vue de départ. Les parts sont pondérées par la probabilité de tirage (palier 15, 45 et 40 %, puis cachette uniforme dans le palier), pas par le nombre de cachettes. La règle des 80 m est mesurée sur 20 000 tirages enchaînés.

| Réglage (mur, caméras, points) | Cachettes | Aucun point masqué depuis le départ | Points du corps masqués depuis le départ, en moyenne | Règle des 80 m |
|---|---|---|---|---|
| 8 m, 2, 3 (avant) | 681 | 38,5 % | 58,5 % | tenue |
| 8 m, 3, 3 | 513 | 35,5 % | 62,1 % | tenue |
| 7 m, 3, 4 | 451 | 36,0 % | 61,9 % | tenue |
| 6 m, 3, 4 | 408 | 35,3 % | 62,5 % | tenue |
| **5 m, 3, 5 (retenu)** | **341** | **33,0 %** | **64,7 %** | tenue |
| 8 m, 4, 3 | 309 | 29,0 % | 68,5 % | tenue |
| 7 m, 4, 3 | 294 | 30,1 % | 67,4 % | tenue |

« Tenue » veut dire aucun tirage à moins de 80 m d'une des 5 cachettes précédentes et aucun repli sur un autre palier, dans tous les réglages mesurés à partir de 53 cachettes (le repli sur un autre palier n'apparaît qu'avec moins de 30 cachettes), donc cette règle ne départage pas les réglages. Le nombre de caméras est le seul réglage qui améliore nettement le masquage depuis le départ. Le seuil du mur et le nombre de points du corps le déplacent de un à deux points, mais ils rendent le tigre réellement tapi contre un mur et masqué en entier depuis les caméras comptées. À 4 caméras, il ne reste que 309 cachettes avec un mur à 8 m, donc aucune marge pour resserrer les deux autres réglages.

*Limite constatée, non appliquée* : aucun réglage de ces trois seuils ne garantit que le tigre est caché depuis la vue de départ, parce que la règle compte les caméras parmi les 8 sans privilégier la première. Avec les réglages retenus, un tirage sur trois environ (33,0 %) n'a aucun point du corps masqué depuis le départ. Vérifié à l'écran avec `window.__palantir.ecran()` sur les 341 cachettes (probabilités de tirage appliquées) : 32,5 % des tirages tombent hors du cadre de la vue de départ (28,3 % avant), 16,7 % sont dans le cadre sans aucun point masqué (24,4 % avant), les autres sont dans le cadre avec au moins un point masqué. Une condition supplémentaire, « le tigre est aussi masqué depuis la caméra de départ », donnerait 100 % de tirages masqués au départ : 322 cachettes avec les réglages d'origine (8 m, 2, 3), 179 avec les réglages retenus (5 m, 3, 5), ce qui passerait sous le minimum de 300. Ce quatrième réglage n'est pas dans la décision de l'utilisateur, il lui revient de le trancher.

*Variante écartée par l'utilisateur le 2026-10-22, qui garde le réglage retenu à 341 cachettes* (relecture indépendante, mesurée sur le même `scene.json`) : avec la condition « masqué depuis la caméra de départ », aucun réglage ne garde 300 cachettes en resserrant le mur ou le nombre de caméras. Seuls tiennent le mur à 8 m et 2 caméras, avec 322 cachettes à 3 points du corps masqués (au moins 3 sur 5 depuis le départ) ou 306 cachettes à 4 points. Ces deux réglages masquent 100 % des tirages au départ et tiennent la règle des 80 m (aucune violation, aucun repli sur 20 000 tirages). Elle coûte le reste de la décision : seul le nombre de points du corps se resserre (3 vers 4), le mur reste à 8 m et 2 caméras suffisent, dont celle du départ. Depuis les 7 autres caméras, le masquage devient alors celui d'avant la décision, voire un peu moins bon : sans aucun point masqué, 48,9 % des tirages (48,0 % avant, 42,4 % avec les réglages retenus). Le tigre est aussi moins tapi (mur moyen de 3,5 m contre 2,9 m). Comme le joueur pivote librement, les réglages retenus restent plus durs pour qui tourne, la variante l'est plus pour qui reste sur la vue de départ. Le tigre mesure déjà quelques pixels depuis le départ (taille réelle), et le joueur doit zoomer et tourner pour le trouver dans les deux cas.

La **difficulté** d'une cachette, entre 0 et 1, est une somme pondérée de quatre critères, chacun entre 0 et 1 :

| Critère | Calcul | Poids |
|---|---|---|
| Masquage | Environ 5 points sont placés sur le corps du tigre, entre 0,3 et 1 m de haut. Pour chacune de 8 caméras, on compte la part de ces points dont le segment vers la caméra traverse un bâtiment extrudé. Le critère est la moyenne sur les 8 caméras. | 0,45 |
| Couvert d'arbres | Nombre d'arbres à moins de 6 m, divisé par 6 et plafonné à 1 | 0,20 |
| Éloignement | Distance à `data.focus`, divisée par la plus grande distance entre `data.focus` et un coin de la zone jouable | 0,20 |
| Recoin | 1 si le mur de bâtiment le plus proche est à moins de 3 m, puis décroissance linéaire jusqu'à 0 à 15 m | 0,15 |

Les **8 caméras** sont la position de repos `REST` de `lib/agroparc3d/scene.ts` et ses 7 rotations de 45° autour de `data.focus`, ce que donnent les boutons « Pivoter ». Le joueur tourne librement autour du quartier, donc une cachette masquée depuis une seule position ne suffit pas. `REST` est exportée pour que le module pur et la scène utilisent la même valeur.

Le **rang de difficulté** classe les cachettes gardées, de la moins difficile à la plus difficile, de 0 à 1. *Choix de l'auteur* : les points et les paliers suivent ce rang, et non la note brute. Une estimation de la relecture développeur, du 2026-10-22, montre qu'avec des seuils fixes à 0,33 et 0,66 sur la note brute, 88 à 92 % des cachettes tomberaient dans le palier facile.

- **Points** : 100 + 400 × rang, arrondis à la dizaine, donc de 100 à 500.
- **Paliers** nommés dans le journal : « facile » pour le premier tiers des rangs, « moyenne » pour le deuxième, « difficile » pour le dernier.

Le **tirage** passe par une fonction pure, testée avec une graine. Elle prend le générateur aléatoire en paramètre :

1. Elle tire un palier : facile 15 %, moyenne 45 %, difficile 40 %.
2. Elle choisit une cachette de ce palier, avec la même probabilité pour chacune.
3. Elle écarte toute cachette à moins de 80 m de l'une des 5 cachettes précédentes.

Le calcul des cachettes tourne au chargement de la vue. S'il dépasse 100 ms sur la machine de développement, le développeur le déplace dans un script Node hors ligne qui écrit `public/agroparc/cachettes.json`. Un test vérifie alors que le fichier se régénère à l'identique, comme `lib/tigre3d/clips/chat-serre-main.json`, que le script `scripts/tigre/retargeting_chat.mjs` génère et qu'un test régénère à l'octet.

### Crochet de développement

En développement seulement, `window.__palantir` donne la cachette courante et une fonction qui débusque le tigre, pour les captures et les vérifications.

## Classement durable

Le joueur enregistre son score sous un pseudo dans une table Postgres. Un bouton « Classement » affiche ou cache les 10 meilleurs scores.

### Interface, dans la vue Palantir

- **Bouton « Enregistrer mon score »** : il apparaît sous le score dès que le score dépasse 0. Il ouvre un champ pseudo et un bouton de validation. Le champ est prérempli avec le dernier pseudo utilisé, gardé sous la clé `localStorage` `palantir-pseudo`.
- **Après l'enregistrement** : la vue affiche le rang obtenu (« Score enregistré, 4e place »), remet le score à 0 et ouvre le classement.
- **Bouton « Classement »** : il affiche ou cache un panneau des 10 meilleurs scores, avec rang, pseudo, score, nombre de tigres et date. Le panneau reprend le style du panneau d'un restaurant. L'état ouvert ou fermé est gardé en `localStorage`.
- **En cas d'échec** (réseau, base indisponible, limite de débit) : le message « Classement indisponible pour le moment » s'affiche et le score est conservé.
- **Touche Échap dans le champ pseudo** : elle ferme le formulaire, pas la vue.

### Table

La table `pdj_tigre_scores` est créée par une fonction `ensureTigreScoresTable()` de `lib/db.ts`, sur le modèle de `ensureRecettesTable()`. Elle est aussi ajoutée à `lib/migrate.mjs`.

| Colonne | Type |
|---|---|
| `id` | `SERIAL PRIMARY KEY` |
| `pseudo` | `VARCHAR(20) NOT NULL` |
| `score` | `INTEGER NOT NULL` |
| `tigres` | `INTEGER NOT NULL` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |

Un index sur `(score DESC, created_at)` sert la lecture du top 10. Un même pseudo peut apparaître plusieurs fois dans le classement.

### Route `app/api/tigre-scores/route.ts`

- **GET** : renvoie les 10 meilleurs scores, triés par score décroissant puis par date croissante.
- **POST** `{ pseudo, score, tigres, website }` : enregistre un score et renvoie son rang. Le champ `website` reprend le champ caché anti-robots (honeypot) du formulaire de commentaires. S'il est rempli, la route n'enregistre rien et renvoie quand même un succès.
- **Limite de débit** : 3 enregistrements par minute et par adresse IP, comptés en mémoire, comme dans `app/api/commentaire/route.ts`.

La validation est une fonction pure de `lib/tigre-scores.ts`, testée :

- `pseudo` : texte, espaces de bord retirés, de 1 à 20 caractères, sans caractère de contrôle.
- `tigres` : entier de 1 à 500.
- `score` : entier multiple de 10, entre 100 × `tigres` et 500 × `tigres`.

Le score est calculé par le navigateur. Un appel direct à l'API peut donc enregistrer un faux score cohérent. Cette limite est acceptée parce que le site est privé.

### Vérification locale

`lib/db.ts` utilise le pilote `pg`. Le développeur vérifie la route contre un Postgres local, installé par Homebrew sur le poste, avec `PGSSL=disable`.

## Main humaine pendant la poignée de main

Pendant la poignée de main, la patte avant droite du tigre doit se déformer en continu en une main humaine, au pelage rayé et à la paume de peau, puis redevenir patte.

### Ce que l'utilisateur a demandé

- **Forme et position** : celles du chat du mème « shake my hand ». L'utilisateur a fourni une capture, gardée hors du dépôt dans `/private/tmp/claude-892683127/-Users-nicolas-bataille-Projects-work/63aca858-e380-4c77-9b96-50bf885290f0/scratchpad/reference-chat-shake.png`. L'avant-bras pend vers la caméra et se termine par une main aux doigts longs, couverte de pelage.
- **Transformation** : la patte se déforme en main. Une patte qui rétrécit pendant qu'une main grandit, ou un objet qui en remplace un autre, est refusé.
- **Aspect** : pelage de tigre rayé sur le dos de la main et les doigts, peau humaine sur la paume.

### Moment

La réaction `serre-main` (`lib/tigre3d/gestes/serre-main.ts`) joue le clip `lib/tigre3d/clips/chat-serre-main.json`, 205 images à 30 images par seconde. Le clip décrit le segment des images 156 à 204 ainsi : « patte d balancée vers le bas puis tendue vers la caméra et pendante, patte g croisée sur le ventre ». Ce segment est la poignée de main.

La patte tendue est `avD`, la patte avant droite du tigre. Dans le clip, chaque image donne la cible du poignet de chaque patte avant, en mètres du modèle (1,104 m de long) et dans le repère du corps. À l'image 180, la cible de `avD` vaut (−0,137, 0,041, 0,150), presque la position de repos du poignet droit, (−0,108, 0,041, 0,150). Le tigre étant dressé, cette patte pend vers la caméra. La cible de `avG` vaut (−0,015, 0,16, 0,056) : la patte gauche est ramenée sur le ventre.

L'extrémité de la patte `avD` est l'os `mainD` de `lib/tigre3d/os.ts`. Le GLB le nomme `Bone.024_028`, et three le renomme `Bone024_028` en retirant le point.

Le **poids de la déformation** va de 0 (patte d'origine) à 1 (main complète). Il suit une fonction pure `poidsMainHumaine(t)`, exportée par `serre-main.ts` et testée. `t` est le temps depuis le début du geste :

1. 0 avant l'image 156. Cet instant vaut `ENTREE_SERRE_MAIN` (0,95 s dans `serre-main.ts`) plus 156 / 30 s, soit environ 6,15 s.
2. Montée de 0 à 1 en environ 0,5 s, selon une courbe lissée (smoothstep), sans saut.
3. 1 jusqu'à la fin du clip, `ENTREE_SERRE_MAIN + DUREE_CLIP_SERRE_MAIN`, soit environ 7,78 s.
4. Descente de 1 à 0 en 0,4 s au plus, pendant que le tigre retombe à quatre pattes (`SORTIE_SERRE_MAIN` vaut 0,9 s). Le poids vaut donc 0 avant 8,2 s.

### Ce que le modèle permet

Le GLB contient un seul maillage animé, de 15 629 sommets et 25 000 triangles. Mesures du 2026-10-22 avec `@gltf-transform/core` :

- Dans `lib/tigre3d/os.ts`, l'os `Bone.024_028` est `mainD`. Son parent est `Bone.023_027` (`brasD`), lui-même enfant de `Bone.022_026` (`epauleD`).
- 954 sommets ont `mainD` comme influence principale, et 228 l'ont comme influence secondaire.
- Dans le repère de `mainD` au repos, ces 954 sommets s'étendent sur 0,755 unité le long de l'axe de l'os. 638 d'entre eux sont dans les 40 % de cette étendue les plus éloignés du poignet.
- La répartition de ces 638 sommets en travers de la patte ne montre pas de pics. C'est un indice, non une preuve, que le bout de la patte est une surface continue, sans orteils séparés.
- Selon une estimation de la relecture développeur, l'arête moyenne près de `mainD` vaut environ 0,045 unité, pour une patte d'environ 0,48 de large. Cela laisse 2 à 3 arêtes par doigt.

Une cible de déformation déplace des sommets sans couper la surface. Les doigts se séparent donc par des sillons profonds, reliés à leur base par une palmure, comme sur une vraie main. Avec 2 à 3 arêtes par doigt, le risque est que la main se lise comme une moufle rainurée.

*Choix de l'auteur* : si la première capture montre ce défaut, le développeur peut subdiviser au chargement les triangles du bout de la patte. Le maillage reste unique, animé par le même squelette, et c'est toujours la patte d'origine qui se déforme. Cette subdivision ne s'applique qu'aux triangles dont tous les sommets ont `mainD` comme influence principale.

### Mécanisme

- **Forme cible** : calculée une fois au chargement du modèle, dans `lib/tigre3d/modele.ts` ou un module dédié. Chaque sommet de la patte est exprimé dans le repère de l'os `mainD` en pose de repos, avec la matrice de liaison inverse (inverse bind matrix) de cet os.
- **Correspondance** : une fonction envoie chaque sommet vers un point d'une main humaine définie par des paramètres, dont les doigts suivent l'axe de l'os. La position du sommet en travers de la patte détermine le doigt. Sa position le long de la patte détermine la phalange. Les sommets de la face inférieure, tournée vers le sol au repos, forment la paume.
- **Stockage** : la forme cible est ajoutée à la géométrie comme `morphAttributes.position`. Le thème Tigre affiche parfois une mère suivie de ses petits, et tous partagent la même géométrie. Chaque clone a son propre tableau `morphTargetInfluences`, et seule la mère reçoit un poids non nul.
- **Poignet** : les sommets partagés entre `mainD` et `brasD` reçoivent un déplacement atténué, pour que l'avant-bras et la main restent raccordés.
- **Pelage rayé** : une cible de déformation ne change que les positions. La texture n'a aucune rayure sur le dessus des orteils, donc le dos de la main serait orange uni. Des rayures obliques sont tracées par le nuanceur sur le dos de la main seulement (constante `RAYURES_DOS` de `lib/tigre3d/main-humaine.ts`), dans le sens des chevrons de l'avant-bras. *Décision de l'utilisateur, le 2026-10-22* : ces rayures sont validées.
- **Paume de peau** : un attribut par sommet, par exemple `peau`, vaut 1 sur la face de la paume et 0 ailleurs. Il est calculé sur la forme 3D au repos, sans lire la texture. Le nuanceur (shader) mélange la couleur de la texture et une couleur de peau dans la proportion `peau × poids de la déformation`, en lisant ce poids dans le tableau `morphTargetInfluences` que three lui transmet. Les petits n'ont jamais de peau.
- **Pilotage** : `lib/tigre3d/scene.ts`, dans `dessiner()`, lit la réaction en cours de la mère (`anim.reaction`, son nom et son `tGeste`) et règle le poids avec `poidsMainHumaine`.

*Décision de l'utilisateur, le 2026-10-22* : la main montre son dos rayé à la caméra, comme sur l'image de référence. Le dessous de la patte, crème dans la texture, ne fait plus face à la caméra pendant la poignée de main. Pour cela, l'os `mainD` (et si besoin `brasD`) pivote pendant la poignée de main, avec le même poids `poidsMainHumaine` que la déformation, donc sans saut à l'entrée ni à la sortie. La paume de peau reste du côté opposé à la caméra. L'auriculaire, plus étroit et plus court que les autres doigts, est corrigé.

Le squelette n'est pas modifié en dehors de cette rotation. Les zones de clic du tigre et le point de la patte levée, que `lib/tigre3d/scene.ts` calcule à partir des os pour placer les bulles et les particules, ne changent donc pas.

### Critère d'acceptation

`window.__tigre`, en développement, force la réaction `serre-main`, gèle l'horloge, puis l'avance à la main. Les captures se prennent à 6,0 s, 6,4 s, 7,0 s et 8,2 s du geste. Trois conditions :

- À 7,0 s, la capture montre une main humaine : quatre doigts et un pouce, séparés par des sillons visibles. La paume est en couleur de peau, visible quand le clip la tourne vers la caméra.
- Entre deux captures successives, aucune partie de la patte ne saute ni ne disparaît.
- À 8,2 s, la patte a retrouvé sa forme d'origine.

Le tigre de secours en image 2D (`TigreSprite.tsx`, affiché sans WebGL) n'a pas de main humaine.

## Macron frappé d'un coup de batte

Dans le thème Tigre, quand un tigre et Macron sont à l'écran en même temps, le tigre court vers Macron, se dresse et le frappe avec une batte de baseball. Macron tombe, se relève et repart en titubant. Il n'y a pas de frappe si le tigre ne peut atteindre aucun point d'embuscade dans l'écran (voir « Coordination entre les deux animations »).

### Règles décidées par l'utilisateur

- Le tigre se dirige vers Macron dès qu'il le voit, c'est-à-dire dès que les deux sont à l'écran en même temps.
- Si aucun tigre n'est à l'écran pendant le passage de Macron, Macron passe sans être frappé. Aucun tigre n'est appelé exprès.
- Le tigre se dresse sur ses pattes arrière et frappe avec une batte de baseball. Macron tombe par terre, se relève et reprend son trajet en titubant un peu.

### Situation de départ

- **Tigre** (`app/components/Tigre3D.tsx`, `lib/tigre3d/`) : thème Tigre seulement. Il traverse le bas de l'écran toutes les 10 à 15 s. Un tigre de 3,75 m y mesure de 140 à 220 px de long selon la largeur de la fenêtre.
- **Macron** (`app/components/MacronEasterEgg.tsx`, `lib/macron3d/`) : tous thèmes, déclenché par la saisie du code `macron`. Il traverse le bas de l'écran d'un bord à l'autre. Il mesure de 110 à 230 px de haut pour 1,81 m.
- Les deux composants sont des voisins indépendants dans `app/layout.tsx`. Chacun a son propre canvas WebGL, fixé en bas de l'écran et déplacé en CSS (z-index 40 pour le tigre, 41 pour Macron). Aucun des deux ne connaît aujourd'hui la position de l'autre.

### Coordination entre les deux animations

Un module `lib/rencontre.ts` relie les deux animations, sans React ni three. Il contient deux parties :

- **Un canal en mémoire**, avec abonnement et publication. À chaque image, chaque scène y publie son état à l'écran : présence, abscisse du centre en px de page, sens, vitesse en px par seconde, et disponibilité. Macron est indisponible s'il a déjà été frappé pendant ce passage. Le tigre est indisponible s'il joue déjà une réaction.
- **Des fonctions pures testées** qui décident de la rencontre, décrites ci-dessous.

Au moment de la frappe, le tigre est arrêté et dressé. Macron court vers lui, et son corps arrive sur la batte pendant le coup. Le tigre doit attendre Macron parce que l'animation de Macron ne sait que courir : elle n'a aucune pose debout immobile. Le tigre tend donc une embuscade :

1. **Plan d'embuscade** : quand les deux sont à l'écran, `planEmbuscade` choisit un point sur la trajectoire de Macron, devant lui. Le tigre doit atteindre ce point assez tôt pour faire quatre actions avant l'arrivée de Macron : s'arrêter, se tourner vers lui, se dresser, armer la batte. Le tigre accélère au galop vers ce point, l'allure `eclair` comprise. Il fait demi-tour si le point est derrière lui.
2. **Abandon** : si aucun point atteignable ne reste dans l'écran, il n'y a pas de rencontre et chacun continue son passage. Sur téléphone (390 px de large), aucun point n'est jamais atteignable : il n'y a pas de frappe. *Décision de l'utilisateur, le 2026-10-22* : ce comportement est accepté.
3. **Frappe** : tigre en position, `declencherFrappe` lance le coup quand d moins v × t atteint la portée de la batte. d est la distance entre le tigre et Macron, v la vitesse de Macron, t la durée de l'élan du coup. Le contact a lieu quand le corps de Macron arrive sur la batte.
4. **Un seul coup par passage de Macron** : quand le tigre est une mère suivie de ses petits, seule la mère frappe. Les petits s'arrêtent et regardent.

### Le tigre : geste « batte »

- **Module** : un nouveau geste `lib/tigre3d/gestes/batte.ts`, inscrit dans `lib/tigre3d/gestes/index.ts` et dans le type `Reaction` de `lib/tigre-reactions.ts`. Son poids est nul dans `POIDS_REACTIONS`, la liste qui tire au hasard la réaction d'un tigre cliqué. Le geste ne se déclenche donc jamais au clic. La rencontre le lance avec `demarrer("batte")` de l'animateur du tigre (`lib/tigre3d/animateur.ts`).
- **Pose** : le tigre se dresse sur ses pattes arrière comme dans `serre-main`, le corps cabré autour des hanches (`pivot: "hanches"`), tourné de profil vers Macron. Les deux pattes avant tiennent la batte, armée au-dessus de l'épaule opposée à Macron.
- **Coup** : quatre phases. Un élan court, une frappe montante vers le corps de Macron, un accompagnement du geste après le contact, puis une tenue d'une demi-seconde.
- **Hauteur du contact** : *choix de l'auteur*. Le tigre dressé est plus petit que Macron à l'écran (voir « Cas limites »). La batte touche Macron à la hauteur qu'elle atteint : le buste sur un écran large, les hanches sur un écran de téléphone.
- **Événements** : à l'instant du contact, le geste publie un événement `impact` dans le canal de `lib/rencontre.ts`. Il déclenche aussi une secousse (événement `secousse` existant), des particules (genre `clap` existant) et une bulle « BONK ! ».
- **Sortie** : la batte disparaît, le tigre retombe à quatre pattes et reprend sa course dans son sens d'origine.
- **Batte** : un maillage construit dans le code, en cylindre effilé couleur bois avec une poignée sombre, d'environ 1 m à l'échelle du tigre. Il est rattaché à l'os `mainD` avec un décalage. La batte apparaît quand le tigre se dresse, avec une montée d'échelle de 0,15 s.

### Macron : chute, relevé et démarche titubante

Un module pur `lib/macron3d/ko.ts`, testé, calcule pendant la séquence des valeurs du type `IntentionsCourse`, défini dans `lib/macron3d/course.ts`. Ces valeurs décrivent la pose de Macron image par image. Le poseur existant (`lib/macron3d/pose.ts`) les applique sans changement.

1. **Impact** : la course s'arrête net. L'avance de Macron, sa progression le long de son trajet, cesse d'augmenter. Son canvas ne se déplace donc plus.
2. **Chute** : recul du buste, bassin qui descend jusqu'au sol, corps qui bascule en arrière à plat, en environ 0,6 s, sans traverser le sol.
3. **Au sol** : environ 1,5 s. Des étoiles tournent au-dessus de sa tête. *Choix de l'auteur* : les étoiles sont des éléments HTML, comme les particules du tigre.
4. **Relevé** : environ 1,2 s, sur les genoux puis debout.
5. **Reprise** : la course repart dans le même sens. Pendant environ 3 s, trois effets se superposent, puis décroissent jusqu'à la course normale :
   - la vitesse remonte de 60 % à 100 %,
   - le bassin et la tête oscillent de côté, en roulis et en lacet,
   - la longueur et le rythme des foulées deviennent irréguliers.
6. **Bulle** : *choix de l'auteur*. La bulle de Macron affiche « En… marche… ? » pendant la reprise titubante, au lieu de « En marche ! ».

La fin du passage reste la sortie de l'écran. `passageFini` lit l'avance, qui ne progresse pas pendant la chute et le relevé.

### Cas limites

- **Thème changé, onglet caché ou composant démonté pendant la rencontre** : la rencontre est annulée sans erreur. Macron reprend sa course s'il était au sol.
- **`prefers-reduced-motion` actif** : ni le tigre ni Macron ne s'affichent, comme avant ce changement. Aucune rencontre n'a donc lieu.
- **Tigre de secours en image 2D** : il remplace le tigre 3D quand WebGL manque. Macron exige WebGL, donc les deux ne se croisent jamais.
- **Échelles** : celles des deux personnages restent celles d'aujourd'hui. Le tigre compte de 37 à 56 px par mètre, et Macron de 97 à 109 px par mètre. Le tigre dressé paraît donc plus petit que Macron.

### Crochet de développement

`window.__tigre` et `window.__macron` existent déjà. Le développeur leur ajoute une fonction qui force une rencontre, en plaçant un tigre et un Macron face à face, pour les captures.

## Contraintes communes

Les cinq changements suivent les conventions du dépôt décrites dans `CLAUDE.md`. La liste ci-dessous les détaille.

- **Tests** : les 526 tests vitest existants restent verts (`npx vitest run`). Chaque module pur nouveau a ses tests : `cachettes.ts`, `tigre-scores.ts`, `rencontre.ts`, `ko.ts`, `poidsMainHumaine`, et la pose du geste `batte`.
- **Build** : `npm run build` passe.
- **Chargement à la demande** : three et les GLB ne sont téléchargés qu'au besoin, comme aujourd'hui. Le GLB du tigre se charge à l'ouverture de la vue Palantir ou à l'activation du thème Tigre. Le GLB de Macron se charge à la saisie du code `macron`.
- **Texte** : interface et messages d'erreur en français. Les commentaires de code ne contiennent ni tiret cadratin ni point-virgule. Un hook installé sur le poste de développement bloque l'écriture de tout fichier qui en contient dans ses commentaires.
- **Contraste et cibles tactiles** : les nouveaux boutons de la vue Palantir reprennent les variables de couleur `--ag-*` de `Agroparc3D.module.css` et mesurent au moins 40 px sur mobile.
- **Documentation** : chaque nouveau module a sa ligne dans la section « Frontend structure » de `CLAUDE.md`.
- **Vérification visuelle** : captures sur ordinateur et sur mobile par Chrome sans interface, avec les crochets de développement de chaque section. Les captures se prennent sur la page 404 (`/rien-ici`) : elle charge le layout, donc la vue Palantir, le tigre et Macron, sans base de données.
- **Livraison** : un commit par changement, cinq au total, sur la branche `feat/palantir-chasse-main-batte`. Pas de fusion dans `main` ni de publication sans l'accord de l'utilisateur.

## Ce qui est laissé au développeur

Le développeur règle les points suivants, dans les limites que fixent les sections précédentes :

- les durées, vitesses, poids et seuils marqués « environ »,
- la fonction de correspondance de la patte vers la main et les proportions de la main,
- la subdivision du bout de la patte, si la première capture la rend nécessaire,
- les courbes du geste `batte` et de la séquence `ko.ts`,
- le placement exact des nouveaux éléments de l'affichage tête haute (HUD) de la vue Palantir,
- le choix entre calcul des cachettes au chargement ou fichier précalculé, selon la règle des 100 ms.
