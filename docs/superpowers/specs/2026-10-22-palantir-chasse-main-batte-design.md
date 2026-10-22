# Palantir, chasse au tigre, main humaine et coup de batte : conception

État au 2026-10-22, branche `feat/palantir-chasse-main-batte`.

Cette branche livre quatre changements du site Agroporc, tous côté Next.js, sans toucher au pipeline Python :

1. La vue 3D « Agroporc x Palantir » gagne un bouton de sortie et perd les boutons Sportif/Goulaf.
2. Un tigre 3D est caché dans cette vue. Le trouver rapporte des points selon la difficulté de la cachette.
3. Les scores s'enregistrent sous un pseudo dans un classement durable, affiché ou caché d'un bouton.
4. Dans le thème Tigre, la patte du tigre se transforme en main humaine pendant la poignée de main, et le tigre assomme Macron d'un coup de batte quand il le voit.

## Vue Palantir : sortie et boutons

Un bouton « Retour au site » et la touche Échap ferment la vue Palantir, qui ne se fermait jusqu'ici qu'en retapant `myrtille`.

Le défaut corrigé : sur un téléphone ou une tablette, aucun clavier n'est ouvert, donc on ne peut pas retaper `myrtille` et on reste bloqué dans la vue. La vue s'affiche correctement sur ordinateur (1400 × 900) et sur mobile (390 × 800), vérifié par capture le 2026-10-22.

Changements dans `app/components/Agroparc3D.tsx` et `Agroparc3D.module.css` :

- **Bouton « Retour au site »**, toujours visible, en haut à droite. Il appelle `onClose`, que `MyrtilleEasterEgg` passe déjà. Il reste actif pendant l'écran de chargement et l'écran d'erreur, donc il n'est pas placé dans un bloc `inert={chargement}`. Cible tactile d'au moins 40 px, comme les autres contrôles.
- **Touche Échap** : ferme la vue, sauf quand le focus est dans un champ de saisie (le champ pseudo du classement, voir la section « Classement durable »).
- **Le panneau d'un restaurant** descend sous le bouton de sortie pour ne pas le recouvrir.
- **Boutons Sportif/Goulaf retirés**, avec `MODES`, `changerMode` et les styles `.modes`. Les jauges du panneau d'un restaurant gardent le mode choisi sur le site : la vue lit le mode par le hook `useModeSite` (`app/menus/useModeSite.ts`) au lieu de `modeInitial()`. La vue ne modifie plus le mode.
- **Texte d'aide** (`.hint`) : la mention « Retape myrtille pour revenir au site » devient « Échap ou Retour au site pour revenir ». Le texte de l'écran d'erreur suit la même règle.
- **Documentation** : la ligne `Agroparc3D.tsx` de `CLAUDE.md` ne cite plus le toggle Sportif/Goulaf. La spécification du 2026-09-09 (`2026-09-09-agroparc-v2-restaurants-design.md`) reçoit une note qui renvoie à ce document.

## Chasse au tigre dans Palantir

Un tigre 3D est caché à chaque ouverture de la vue Palantir dans une cachette tirée au hasard parmi plusieurs centaines, et un clic sur lui rapporte de 100 à 500 points selon la difficulté de la cachette.

### Règles du jeu, décidées par l'utilisateur

- Pas de chrono, pas de début ni de fin de partie. On explore la carte librement.
- Le tigre est bien caché à chaque fois, dans l'environnement 3D.
- Une cachette difficile rapporte plus de points qu'une cachette facile.
- Les cachettes possibles sont très nombreuses.

### Déroulé

1. À l'ouverture de la vue, une fois la scène prête, le tigre est posé dans une cachette tirée au hasard.
2. Un clic ou un tap sur le tigre le « débusque ». Le journal en bas à droite affiche par exemple « Tigre débusqué, cachette difficile, +420 ». Le score et le nombre de tigres trouvés s'affichent en haut à gauche, sous le titre, à la place des anciens boutons Sportif/Goulaf.
3. Le tigre disparaît, puis réapparaît environ 1,5 s plus tard dans une nouvelle cachette.
4. Le score s'additionne jusqu'à l'enregistrement dans le classement. *Choix du concepteur* : le score survit à la fermeture et à la réouverture de la vue dans le même onglet (état gardé dans `MyrtilleEasterEgg`), et il est perdu au rechargement de la page.

### Le tigre dans la scène

- **Modèle** : le GLB du thème Tigre (`public/tigre/tigre.glb`), chargé par `chargerModele()` de `lib/tigre3d/modele.ts` et cloné par `SkeletonUtils.clone`. La vue Palantir n'appelle jamais `libererModele()`, parce que ce cache est partagé avec le tigre du thème Tigre qui tourne sous la vue.
- **Taille** : grandeur réelle, 3,75 m du museau au bout de la queue (`ECHELLE_MODELE` de `lib/tigre3d/troupe.ts`). Depuis la caméra de départ, il mesure quelques pixels, ce qui oblige à zoomer.
- **Rendu** : le matériau du GLB est sans éclairage (`KHR_materials_unlit`), donc la scène n'a pas besoin de lumière. Le tigre de Palantir utilise une copie du matériau, assombrie, pour ne pas briller sur le fond noir ni déclencher le halo du post-traitement (`UnrealBloomPass`, seuil 0,24). Le matériau d'origine reste intact pour le thème Tigre.
- **Mouvement** : posture basse et animation de repos de faible amplitude, sans déplacement. Le choix du clip (« Curious » du GLB ou pose fixe) revient au développeur.
- **Clic** : une sphère invisible d'environ 2,5 m de rayon entoure le tigre et reçoit le lancer de rayon (raycast). Un clic compte seulement si le pointeur a bougé de moins de 6 px entre l'appui et le relâchement, pour ne pas confondre un glisser de caméra avec un clic. Le raycast ne vise jamais le maillage animé (`SkinnedMesh`), parce que three le teste dans sa pose de repos.

### Cachettes

Un module pur `lib/agroparc3d/cachettes.ts`, testé, génère les cachettes candidates à partir de `public/agroparc/scene.json` (142 bâtiments, 788 arbres, 374 tronçons de route) :

1. Échantillonner une grille irrégulière, d'un pas d'environ 6 m, sur la zone jouable autour de `data.focus`.
2. Écarter les points à moins de 1,5 m d'un bâtiment, à moins de 4 m d'une route, dans l'eau ou hors de la zone jouable.
3. Garder au moins 500 cachettes candidates. Un test le vérifie sur le vrai `scene.json`.

Chaque candidate reçoit une **difficulté** entre 0 et 1, somme pondérée de quatre critères :

| Critère | Mesure | Poids |
|---|---|---|
| Masquage | Part des points du corps du tigre (environ 5, de 0,3 à 1 m de haut) dont le segment vers la caméra de départ traverse un bâtiment extrudé | 0,45 |
| Couvert d'arbres | Nombre d'arbres à moins de 6 m, normalisé | 0,20 |
| Éloignement | Distance à `data.focus`, normalisée sur la zone jouable | 0,20 |
| Recoin | Proximité du mur de bâtiment le plus proche, maximale sous 3 m | 0,15 |

La **caméra de départ** est la position de repos `REST` de `lib/agroparc3d/scene.ts`. Elle est exportée pour que le module pur et la scène utilisent la même valeur.

Les **points** valent 100 + 400 × difficulté, arrondis à la dizaine, donc de 100 à 500. Le journal nomme trois paliers : « facile » sous 0,33, « moyenne » de 0,33 à 0,66, « difficile » au-dessus.

Le **tirage** passe par une fonction pure qui prend un générateur aléatoire en paramètre, testée avec une graine :

- 15 % de cachettes faciles, 45 % de moyennes, 40 % de difficiles, puis une cachette uniforme dans le palier tiré.
- Jamais à moins de 80 m de l'une des 5 cachettes précédentes.

Le calcul des cachettes tourne au chargement de la vue. Si le calcul dépasse 100 ms sur la machine de développement, le développeur le déplace dans un script hors ligne qui écrit `public/agroparc/cachettes.json`, avec un test qui vérifie que le fichier se régénère à l'identique, sur le modèle de `lib/tigre3d/clips/chat-serre-main.json`.

### Crochet de développement

En développement seulement, `window.__palantir` expose la cachette courante et une fonction qui la débusque, pour les captures et les vérifications.

## Classement durable

Le joueur enregistre son score sous un pseudo dans une table Postgres, et un bouton « Classement » affiche ou cache les 10 meilleurs scores.

### Interface, dans la vue Palantir

- **« Enregistrer mon score »** apparaît sous le score dès qu'il dépasse 0. Il ouvre un champ pseudo, prérempli avec le dernier pseudo utilisé (clé `localStorage` `palantir-pseudo`), et un bouton de validation.
- **Après l'enregistrement**, la vue affiche le rang obtenu (« Score enregistré, 4e place »), remet le score à 0 et ouvre le classement.
- **« Classement »** affiche ou cache un panneau des 10 meilleurs scores : rang, pseudo, score, nombre de tigres, date. Le panneau reprend le style du panneau d'un restaurant. L'état ouvert ou fermé est mémorisé en `localStorage`.
- **En cas d'échec** (réseau, base indisponible, limite de débit), le message « Classement indisponible pour le moment » s'affiche et le score est conservé.
- La touche Échap dans le champ pseudo ferme le formulaire, pas la vue.

### Table

`pdj_tigre_scores`, créée par une fonction `ensureTigreScoresTable()` de `lib/db.ts` (même modèle que `ensureRecettesTable()`) et ajoutée à `lib/migrate.mjs` :

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
- **POST** `{ pseudo, score, tigres, website }` : enregistre un score et renvoie son rang. Le champ `website` est le piège à robots du formulaire de commentaires : rempli, la route renvoie un faux succès.
- **Limite de débit** : 3 enregistrements par minute et par IP, en mémoire, comme `app/api/commentaire/route.ts`.

La validation est une fonction pure de `lib/tigre-scores.ts`, testée :

- `pseudo` : texte, espaces de bord retirés, de 1 à 20 caractères, sans caractère de contrôle.
- `tigres` : entier de 1 à 500.
- `score` : entier multiple de 10, entre 100 × `tigres` et 500 × `tigres`.

Le score est calculé par le navigateur, donc un appel direct à l'API peut enregistrer un faux score cohérent. Le site est privé, et cette limite est acceptée.

### Vérification locale

`lib/db.ts` utilise le pilote `pg`. Le développeur vérifie la route contre un Postgres local (Homebrew est installé sur le poste) avec `PGSSL=disable`.

## Main humaine pendant la poignée de main

Pendant la poignée de main, la patte avant droite du tigre se déforme en continu en une main humaine au pelage rayé et à la paume de peau, puis redevient patte.

### Ce que l'utilisateur a demandé

- **Forme et position** : celles du chat du mème « shake my hand », dont l'utilisateur a fourni une capture. L'avant-bras pend vers la caméra et se termine par une main aux doigts longs, couverte de pelage.
- **Transformation** : la patte se déforme en main. Une patte qui rétrécit pendant qu'une main grandit, ou un objet qui en remplace un autre, est refusé.
- **Aspect** : pelage de tigre rayé sur le dos de la main et les doigts, peau humaine sur la paume.

### Moment

La réaction `serre-main` (`lib/tigre3d/gestes/serre-main.ts`) joue le clip `lib/tigre3d/clips/chat-serre-main.json`, 205 images à 30 images par seconde. Le segment des images 156 à 204 est décrit dans le clip comme « patte d balancée vers le bas puis tendue vers la caméra et pendante, patte g croisée sur le ventre ». C'est la poignée de main.

À l'image 180, la cible de la patte `avD` est 0,15 m devant le corps, contre 0,056 m pour `avG` : la patte tendue est donc `avD`, la patte avant droite du tigre, dont l'extrémité est l'os `mainD` (`Bone024_028` dans le GLB).

Le poids de la main humaine suit une fonction pure `poidsMainHumaine(t)` exportée par `serre-main.ts` et testée, où `t` est le temps depuis le début du geste :

1. 0 avant l'image 156, soit `ENTREE_SERRE_MAIN + 156 / 30` ≈ 6,15 s.
2. Montée de 0 à 1 en environ 0,5 s, selon une courbe lissée (smoothstep), sans saut.
3. 1 jusqu'à la fin du clip, `ENTREE_SERRE_MAIN + DUREE_CLIP_SERRE_MAIN` ≈ 7,78 s.
4. Descente de 1 à 0 en environ 0,5 s, pendant que le tigre retombe à quatre pattes (`SORTIE_SERRE_MAIN` = 0,9 s).

### Déformation : une cible de déformation (morph target) sur la patte d'origine

Le GLB contient un seul maillage animé, de 15 629 sommets et 25 000 triangles. Mesures du 2026-10-22 avec `@gltf-transform/core` :

- L'os `Bone.024_028` du GLB (nommé `Bone024_028` par three) a pour parents `Bone.023_027` puis `Bone.022_026`, soit `mainD`, `brasD` et `epauleD` dans `lib/tigre3d/os.ts`.
- 954 sommets ont `mainD` comme influence principale. 638 d'entre eux sont dans les 40 % de la patte les plus éloignés du poignet.
- La répartition de ces 638 sommets en travers de la patte ne montre pas d'orteils sculptés séparément : le bout de la patte est une surface continue, en moufle.

La déformation porte sur les sommets de la patte d'origine. Une cible de déformation déplace des sommets sans couper la surface, donc les doigts se séparent en creusant des sillons profonds entre eux, avec une palmure à leur base comme sur une vraie main. Des doigts séparés jusqu'à la paume demanderaient de modifier la topologie du maillage, ce qui sort de cette conception.

C'est un risque. Le développeur produit d'abord une capture de la main à pleine déformation et la soumet à l'utilisateur avant de finir le reste du chantier.

Mécanisme :

- **Calcul de la forme cible**, une fois au chargement du modèle, dans `lib/tigre3d/modele.ts` ou un module dédié. Chaque sommet de la patte est exprimé dans le repère de l'os `mainD` au repos, à l'aide de sa matrice de liaison inverse. Une fonction de correspondance l'envoie vers une position sur une main humaine paramétrique, dont les doigts suivent l'axe de l'os : la position en travers de la patte choisit le doigt, la position le long de la patte choisit la phalange, et la face inférieure devient la paume.
- **Stockage** : la forme cible est ajoutée à la géométrie comme `morphAttributes.position`. La géométrie est partagée entre la mère et ses petits, mais chaque clone a son propre tableau `morphTargetInfluences`. Seule la mère reçoit un poids non nul.
- **Les sommets à poids partagés** entre `mainD` et `brasD`, au poignet, reçoivent un déplacement atténué, pour que le raccord entre l'avant-bras et la main reste continu.
- **Pelage rayé** : une cible de déformation ne change que les positions, donc les coordonnées de texture restent celles de la patte. Les rayures devraient s'étirer le long des doigts. Ce rendu n'est pas encore vérifié et se juge sur la première capture.
- **Paume de peau** : un attribut par sommet, nommé par exemple `peau` et valant 1 sur la face de la paume, mélange la couleur de la texture avec une couleur de peau. Le mélange vaut `peau × poids de la déformation`, et le nuanceur (shader) lit ce poids dans le tableau `morphTargetInfluences` que three lui transmet. Les petits n'ont jamais de peau.
- **Pilotage** : `lib/tigre3d/scene.ts`, dans `dessiner()`, lit la réaction en cours de la mère (`anim.reaction`, son nom et son `tGeste`) et règle le poids de la cible avec `poidsMainHumaine`.

Le squelette n'est pas modifié, donc les zones de clic et le point de la patte levée, calculés à partir des os, ne changent pas.

### Critère d'acceptation

Les captures se prennent à 6,0 s, 6,4 s, 7,0 s et 8,2 s du geste, en développement, avec `window.__tigre` (réaction forcée, horloge gelée puis avancée à la main). Trois conditions :

- À 7,0 s, on lit une main humaine : quatre doigts distincts et un pouce. La paume est en couleur de peau, visible quand le clip la tourne vers la caméra.
- Entre deux captures successives, aucune partie de la patte ne saute ni ne disparaît.
- À 8,2 s, la patte a retrouvé sa forme d'origine.

Le tigre de secours en image 2D (`TigreSprite.tsx`, sans WebGL) n'a pas de main humaine.

## Macron assommé d'un coup de batte

Dans le thème Tigre, un tigre qui voit Macron court vers lui, se dresse et l'assomme d'un coup de batte de baseball. Macron tombe, se relève et repart en titubant.

### Règles décidées par l'utilisateur

- Le tigre se dirige vers Macron dès qu'il le voit, c'est-à-dire dès que les deux sont à l'écran en même temps.
- Si aucun tigre n'est à l'écran pendant le passage de Macron, Macron passe sans être frappé. Aucun tigre n'est appelé exprès.
- Le tigre se dresse sur ses pattes arrière et frappe avec une batte de baseball. Macron tombe par terre, se relève et reprend son trajet en titubant un peu.

### Situation de départ

- **Tigre** (`app/components/Tigre3D.tsx`, `lib/tigre3d/`) : thème Tigre seulement. Il traverse le bas de l'écran toutes les 10 à 15 s, sur une largeur de 140 à 220 px pour 3,75 m.
- **Macron** (`app/components/MacronEasterEgg.tsx`, `lib/macron3d/`) : tous thèmes, déclenché en tapant `macron`. Il traverse le bas de l'écran d'un bord à l'autre, sur une hauteur de 110 à 230 px pour 1,81 m.
- Les deux composants sont des voisins indépendants dans `app/layout.tsx`. Chacun a son propre canvas WebGL, fixé en bas de l'écran et translaté en CSS (z-index 40 pour le tigre, 41 pour Macron). Aucun des deux ne connaît la position de l'autre aujourd'hui.

### Coordination entre les deux animations

Un module `lib/rencontre.ts` relie les deux animations, sans React ni three :

- **Un canal en mémoire** (abonnement et publication) où chaque scène publie à chaque image son état à l'écran : présence, abscisse du centre en px de page, sens, vitesse en px par seconde, et disponibilité (Macron déjà frappé pendant ce passage, tigre déjà en réaction).
- **Des fonctions pures testées** qui décident de la rencontre, décrites ci-dessous.

La frappe a lieu tigre arrêté et dressé, et c'est Macron qui court dans la batte. Macron n'a aucune pose debout immobile, et son animation ne sait que courir. Le tigre tend donc une embuscade :

1. **Plan d'embuscade.** Quand les deux sont à l'écran, `planEmbuscade` choisit un point sur la trajectoire de Macron, devant lui, que le tigre peut atteindre avec assez d'avance pour s'arrêter, se tourner vers Macron, se dresser et armer la batte. Le tigre accélère au galop (allure `eclair` permise) vers ce point, en faisant demi-tour si Macron vient de l'autre côté ou s'il doit le dépasser.
2. **Abandon.** Si aucun point atteignable ne reste dans l'écran, il n'y a pas de rencontre et chacun continue son passage.
3. **Frappe.** Tigre en position, `declencherFrappe` lance le coup quand la distance à Macron, diminuée de ce que Macron parcourt pendant l'élan du coup, atteint la portée de la batte. Le contact a lieu à l'instant où le corps de Macron arrive sur la batte.
4. **Un seul coup par passage de Macron.** Pour une famille (une mère et ses petits), seule la mère frappe, et les petits s'arrêtent et regardent.

### Le tigre : geste « batte »

- **Module** : un nouveau geste `lib/tigre3d/gestes/batte.ts`, inscrit dans `gestes/index.ts` et dans le type `Reaction` de `lib/tigre-reactions.ts`, avec un poids de tirage nul. Il ne se déclenche jamais au clic, seulement par la rencontre, via `demarrer("batte")` de l'animateur.
- **Pose** : le tigre se dresse sur ses pattes arrière comme dans `serre-main` (corps cabré autour des hanches, `pivot: "hanches"`), tourné de profil vers Macron. Les deux pattes avant tiennent la batte, armée au-dessus de l'épaule opposée à Macron.
- **Coup** : élan court, frappe horizontale au niveau du buste de Macron, accompagnement, puis tenue d'une demi-seconde. Le tigre dressé est plus petit que Macron à l'écran (voir « Cas limites »), donc la batte n'atteint pas la tête.
- **Événements** : à l'instant du contact, un événement `impact` part vers la rencontre, avec une secousse (événement `secousse` existant), des particules (genre `clap` existant) et une bulle « BONK ! ».
- **Sortie** : la batte disparaît, le tigre retombe à quatre pattes et reprend sa course dans son sens d'origine.
- **Batte** : un maillage construit dans le code (cylindre effilé couleur bois, poignée sombre, environ 1 m à l'échelle du tigre), rattaché à l'os `mainD` avec un décalage. Elle apparaît quand le tigre se dresse, avec une montée d'échelle de 0,15 s.

### Macron : chute, relevé et démarche titubante

Un module pur `lib/macron3d/ko.ts`, testé, produit les intentions de pose (`IntentionsCourse` de `lib/macron3d/course.ts`) pendant la séquence. Le poseur existant (`lib/macron3d/pose.ts`) les applique sans changement :

1. **Impact** : la course s'arrête net. L'avance de Macron est figée, donc son canvas ne bouge plus.
2. **Chute** : recul du buste, bassin qui descend jusqu'au sol, corps qui bascule en arrière à plat, en environ 0,6 s, sans traverser le sol.
3. **Au sol** : environ 1,5 s, avec des étoiles qui tournent au-dessus de la tête. *Choix du concepteur* : étoiles en éléments HTML, comme les particules du tigre.
4. **Relevé** : environ 1,2 s, sur les genoux puis debout.
5. **Reprise** : la course repart dans le même sens. Pendant environ 3 s, la vitesse remonte de 60 % à 100 %, le bassin et la tête oscillent de côté (roulis et lacet), et la longueur et le rythme des foulées deviennent irréguliers. L'oscillation décroît jusqu'à la course normale.
6. **Bulle** : *choix du concepteur*, « En… marche… ? » pendant la reprise titubante, à la place de « En marche ! ».

La fin du passage reste la sortie de l'écran : `passageFini` lit l'avance, qui ne progresse pas pendant la chute et le relevé.

### Cas limites

- Thème changé, onglet caché ou composant démonté pendant la rencontre : la rencontre est annulée sans erreur. Macron reprend sa course s'il était au sol.
- `prefers-reduced-motion` : aucun des deux ne s'affiche déjà, donc aucune rencontre.
- Tigre de secours en image 2D (sans WebGL) : Macron exige WebGL, donc le cas ne se présente pas.
- Les échelles des deux personnages restent celles d'aujourd'hui (environ 47 px par mètre pour le tigre, environ 100 px par mètre pour Macron). Le tigre dressé paraît donc plus petit que Macron.

### Crochet de développement

`window.__tigre` et `window.__macron` existent déjà. Le développeur leur ajoute de quoi forcer une rencontre (un tigre et un Macron placés face à face) pour les captures.

## Contraintes communes

Les quatre changements suivent les conventions du dépôt décrites dans `CLAUDE.md` : modules purs testés par vitest, three chargé à la demande, texte de l'interface en français, `CLAUDE.md` mis à jour.

- **Tests** : les 526 tests vitest existants restent verts (`npx vitest run`). Chaque module pur nouveau a ses tests : `cachettes.ts`, `tigre-scores.ts`, `rencontre.ts`, `ko.ts`, `poidsMainHumaine`, et la pose du geste `batte`.
- **Build** : `npm run build` passe.
- **Chargement à la demande** : three, le GLB du tigre et celui de Macron ne sont téléchargés qu'à l'ouverture de la vue Palantir, au thème Tigre ou au code `macron`, comme aujourd'hui.
- **Texte** : interface et messages d'erreur en français. Les commentaires de code ne contiennent ni tiret cadratin ni point-virgule, parce qu'un hook du poste les refuse.
- **Contraste et cibles tactiles** : les nouveaux boutons de la vue Palantir reprennent les tokens `--ag-*` de `Agroparc3D.module.css` et font au moins 40 px sur mobile.
- **Documentation** : chaque nouveau module a sa ligne dans la section « Frontend structure » de `CLAUDE.md`.
- **Vérification visuelle** : captures sur ordinateur et sur mobile par Chrome sans interface, avec les crochets de développement de chaque section. La page 404 (`/rien-ici`) charge le layout sans base de données.
- **Livraison** : un commit par chantier sur la branche. Ni fusion dans `main` ni publication sans l'accord de l'utilisateur.

## Ce qui est laissé au développeur

Le développeur règle les points suivants, dans les limites que fixent les sections précédentes :

- les durées, vitesses, poids et seuils marqués « environ »,
- la fonction de correspondance de la patte vers la main et les proportions de la main,
- les courbes du geste `batte` et de la séquence `ko.ts`,
- le placement exact des nouveaux éléments du HUD de la vue Palantir,
- le choix entre calcul des cachettes au chargement ou fichier précalculé, selon la règle des 100 ms.
