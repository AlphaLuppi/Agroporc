# Rocket Muche : un « Rocket League like » sur Agroparc

Statut : spec de départ (2026-11-06), branche `claude/rocket-agroparc`. Contrat de code : `lib/rocket/contrat.ts` (types, constantes, signatures) et `lib/rocket/vec.ts` (maths 3D). **En cas de divergence entre ce texte et un commentaire de module, ce texte prime ; en cas de divergence entre ce texte et les constantes de `contrat.ts`, le contrat prime** (il est testé : `contrat.test.ts`).

Demande de l'utilisateur : « un Rocket League like sur Agroparc ; la map doit être la même que Rocket League, les mécaniques aussi les mêmes ; carte blanche pour le reste ».

## 0. Résumé et décisions

- **Nom** : « Rocket Muche » (clin d'œil au Truck Muche). Équipes **Les Trèfles** (bleue, Le Bistrot Trèfle) et **Les Tigres** (orange, le thème Tigre du site). Le stade s'appelle « le Parking Sud ». La balle est « la Boule ».
- **Jeu local** dans le navigateur : 1 humain + bots, formats 1v1 / 2v2 / 3v3. Aucun changement de `serveur-fps/` ni de `lib/fps/protocole.ts` ; `ModeSalle` reste `"arene" | "zombies" | "br"`.
- **Physique pure et déterministe** (`lib/rocket/`) : pas fixe 120 Hz, aucun `Math.random` ni `Date.now`, générateur `Rng` injecté. Le monde est une structure de données copiable : le rendre en ligne plus tard (états + entrées) ne demandera pas de réécrire la physique.
- **Le stade est EXACTEMENT le Soccar standard** (DFH Stadium) : 81,92 × 102,40 m, murs de 20,44 m, buts de 17,86 × 6,43 × 8,80 m, 34 plots de boost aux positions officielles, 5 positions de coup d'envoi. Il est **posé sur le grand parking sud d'Agroparc** : le décor d'Agroparc (routes, bâtiments, arbres) reste visible autour.
- **Bouton séparé « Rocket Muche »** dans la barre du haut de la vue Palantir, à côté de « Arène » (pas une 4ᵉ carte de `ChoixMode`, qui est lié au serveur et à `arene.choisirMode`).
- Tout le code est dans `lib/rocket/` et `app/components/rocket/`. Rien n'entre dans le premier chargement de la page du menu : `three` et le jeu viennent d'un `import("@/lib/rocket/jeu")` au lancement.
- Tout est en français (UI, commentaires, noms du domaine). Style filaire de la vue Palantir (tokens `--ag-*`).

### Non-objectifs (v1)

Multijoueur en ligne, voitures autres que l'Octane, mutateurs, saisons / classement, replays complets (la célébration en ralenti suffit), messages rapides, personnalisation des voitures, tactile sans manette.

### Honnêteté sur la fidélité

Les constantes de Rocket League sont reprises de la documentation communautaire (RLBot, RocketSim, « Rocket League mechanics » de Sam Mish), citées de mémoire. Chaque mécanique est classée dans la table du § 13 : **[RL]** valeur d'origine, **[~]** reproduction approchée (formule du projet calée par un test de ressenti). Aucune ne prétend être le code de Psyonix.

**Depuis le 2026-11-12**, la physique est alignée sur la SOURCE de RocketSim (réimplémentation libre de la physique de Rocket League : `RLConst.h`, `Car.cpp`, `Ball.cpp`, `Arena.cpp`, `btVehicleRL.cpp`, `BoostPad.cpp`, `CarConfig.cpp`, `GameEventTracker.cpp`), lue fichier par fichier et non plus citée de mémoire : constantes, formules, ordre des opérations et nombres de pas. Ce qui dépend du moteur Bullet ou du maillage de collision ne se transpose pas (le stade reste une distance signée, la voiture roule sans suspension) : on en reprend les constantes et la logique, pas le solveur. La table du § 13 dit ce qui vient de RocketSim et ce qui reste approché ; le § 15 liste ce que cet alignement remplace dans les §§ 3 à 7, dont le détail (écrit avant) n'a pas été réécrit : en cas de divergence, les §§ 13 et 15 et les commentaires de `contrat.ts` priment.

## 1. Conventions

- **Unités** : mètres, secondes, radians. Les constantes de RL (1 uu = 1 cm) sont converties par `uu()` dans `contrat.ts` et la valeur d'origine est citée en commentaire.
- **Repère du stade (local)** : Y vers le haut ; X = largeur ; Z = longueur. L'équipe bleue défend le but de Z = -60 m et attaque Z = +60 m. Le terrain est symétrique en X : le passage du repère de RL (x, y, z haut) à celui-ci (x, z, y haut) ne change aucune position.
- **Vecteurs** : `Vec3 = [x, y, z]` ; `Base { avant, droite, haut }`, `droite = avant × haut` ; vecteur local `[avant, droite, haut]`. Cap : `avant = (sin cap, 0, cos cap)`, cap 0 = vers le but orange. Tout vient de `vec.ts` : **personne ne réécrit ses maths** (`ajouterDans`, `affecter`, `integrerBase`… sans allocation pour les boucles chaudes).
- **Signes des entrées** : tangage +1 = nez en haut ; lacet / direction +1 = à droite ; roulis +1 = penche à droite. Rotation positive autour de `droite` = nez en haut ; positive autour de `avant` = penche à droite ; positive autour de `haut` = tourne à GAUCHE (donc le lacet à droite est une vitesse angulaire négative autour de `haut`).
- **Déterminisme** : toute la physique, le match et les bots n'utilisent que `Rng` (`tirer`, `tirerGauss`). Même graine + mêmes entrées = même partie à l'identique (test de hachage de fin de partie).
- **Performance** : un pas de 6 voitures + balle ≤ 1,5 ms en moyenne (Node, test non bloquant mesuré), aucune allocation dans `sd`, `pasBalle`, `pasVoiture`, `contacts` (les tableaux d'événements mis à part). Rendu : ≤ 60 draw calls pour le stade, les voitures et les effets (le décor d'Agroparc en ajoute 26).
- **Langue et style** : français partout, pas d'emoji, tokens `--ag-*`, cibles tactiles / cliquables ≥ 40 px dans l'UI, `prefers-reduced-motion` respecté (pas de secousse, pas de flash plein écran, pas de ralenti brutal).

## 2. Le stade posé sur Agroparc

### 2.1 Emplacement (mesuré sur `public/agroparc/scene.json`)

On a cherché, par rastérisation à 2 m de `scene.json` (bâtiments avec 3 m de marge, plans d'eau, routes M/R/S, arbres, parkings) et pour 18 orientations, un rectangle de 126 × 88 m (le terrain, buts compris, plus 3 m de marge) sans bâtiment ni eau. Retenu : **le grand parking sud et la prairie qui le prolonge**.

| | |
|---|---|
| centre du terrain (scène, X est, Z sud) | (-58 ; 332) |
| orientation | `SITE.cap` = 60° : le +Z local (vers le but orange) pointe vers (sin 60°, cos 60°) = (0,866 ; 0,5) en (x, z) de la scène |
| bâtiments touchés | aucun (le plus proche, à plus de 120 m) ; un test de `contrat.test.ts` le vérifie sur le vrai `scene.json` |
| eau, arbres | aucun |
| allées de parking recouvertes | ≈ 1 900 m² (voies de service S) : le sol du stade les cache |
| hauteur du sol du stade | `SITE.hauteurSol` = 5 cm au-dessus du sol d'Agroparc (évite le combat de profondeur avec chaussée et places) |

Autres candidats mesurés (secours si ce site déplaît) : prairie (126 ; 332) cap 0, aucune route ni place dessous mais loin du reste ; (42 ; 256) cap 50°, plus proche des bâtiments mais 111 cellules de voirie dessous.

Le repère de la scène passe par `localVersScene` / `sceneVersLocal` (`contrat.ts`). Le rendu pose une **racine** (`RenduRocket.racine`) à `SITE.centre`, tournée de `SITE.cap` : tout le contenu et la caméra de jeu sont des enfants en repère local.

### 2.2 Décor autour

- `construireDecor(scene, data, { fantomes: false, ambiance: "complete", qualite: qualiteParDefaut(), exclure: boitesExclusionSite() })` (par `jeu.ts`) : routes, bâtiments, arbres et places d'Agroparc restent visibles ; le mobilier, les haies, les pelouses et les places sont retirés dans le rectangle du stade + 14 m (12 boîtes le long de l'axe long).
- **Gradins** (`rendu.ts`) : autour des quatre murs, hors de l'arène, des gradins en fil de fer (rangées de boîtes en gradins, 3 niveaux, 9 m de profondeur) dont le public est une `InstancedMesh` de petites silhouettes aux couleurs des deux équipes (la moitié bleue du stade côté Trèfles, orange côté Tigres), qui s'agitent à un but (désactivé en mouvement réduit).
- **Le Truck Muche** garé le long du mur est (côté caméra du joueur au repos), réutilisant `creerModeleTruckMuche` de `lib/fps/rendu-monde.ts`, fait office de tableau d'affichage : sa vitre latérale affiche le score en ambre. Optionnel si le budget de draw calls est dépassé (basse qualité : absent).
- Le ciel et le sol sont ceux de la vue Palantir (`C.ground`, brouillard exponentiel léger). Les lumières sont des fils : le stade est lumineux par ses lignes et son bloom (`creerPostTraitement` de `lib/fps/rendu.ts`), pas par un éclairage.

## 3. Géométrie du stade — `arene.ts` (module A)

### 3.1 Dimensions exactes (`STADE`, `BUT`)

| | m | uu RL |
|---|---|---|
| demi-largeur (murs latéraux) | 40,96 | 4096 |
| demi-longueur (plan des buts) | 51,20 | 5120 |
| hauteur du plafond | 20,48 | 2048 (RocketSim `ARENA_HEIGHT`) |
| pan coupé des coins | 11,52 | 1152 |
| rayon de raccord sol / murs, murs / plafond, arêtes verticales | 2,56 | ~256 |
| ouverture du but : largeur × hauteur | 17,8551 × 6,42775 | 1785,51 × 642,775 |
| profondeur du but (jusqu'à Z = ±60) | 8,80 | 880 |
| ligne de but pour marquer (centre de balle) | Z = ±(51,2425 + 0,9125) | 5124,25 + rayon |

Plan : un rectangle de ±40,96 × ±51,20 dont les quatre coins sont coupés de 11,52 m sur chaque mur ; le plan de coupe est `|x| + |z| = 80,64`. Les buts sont des boîtes de ±8,92755 (X) × 0 à 6,42775 (Y) × 51,20 à 60,00 (|Z|), ouvertes sur le terrain.

### 3.2 Le terrain est une SDF continue

`Arene.sd(p)` donne la distance signée (positive dans l'espace libre) et `normale(p)` son gradient. La balle rebondit sur cette SDF, la voiture y roule (sol, murs, plafond). Construction :

1. **Salle principale** = prisme octogonal rétréci de `r = 2,56` (plan : `|x| ≤ 38,40`, `|z| ≤ 48,64`, `|x| + |z| ≤ 80,64 − 2,56·√2 = 77,02` ; hauteur : `y ∈ [r, 20,44 − r]`) **élargi** d'une boule de rayon `r`. Pour un point `p`, `sd_salle = r − dist_prisme(p)`, où `dist_prisme` est la distance signée EXACTE au prisme : dans le plan, le maximum des distances aux demi-plans si le point est dedans, sinon la distance minimale aux segments du polygone ; en 3D la formule d'extrusion (`dedans = max(d2, dy)` ; dehors `hypot(max(d2,0), max(dy,0))`). Tous les raccords (sol, plafond, arêtes verticales) ont ainsi le même rayon 2,56 m, sans couture.
2. **Cages** (une par but) = boîte rétrécie de 0,25 m puis élargie de 0,25 m (angles intérieurs adoucis), de Z = ±44 (elle recouvre le fond de terrain pour éviter une couture) à ±60, plancher abaissé à y = −1 et `sd` borné par `min(sd, y)` : avec la construction d'origine (Z = ±50) le raccord sol / fond de terrain de 2,56 m montait de 39 cm devant la cage et l'union douce relevait son plancher de k/4 = 3,75 cm ; le plancher est désormais exactement à y = 0 jusqu'au fond du but (testé).
3. **Union douce** : `sd = smax(sd_salle, sd_cage_G, sd_cage_D)` avec `smax(a, b, k) = mix(b, a, h) + k·h·(1−h)`, `h = clamp(0,5 + 0,5(a−b)/k, 0, 1)`, `k = BUT.rayonArete` (0,15 m). Cela arrondit les poteaux et la barre transversale (arêtes convexes de la matière), la balle y rebondit sans accrocher.

Contrôles : `sd` est continue (saut max < 1 mm sur une grille de 2 000 points tirés), `|∇sd| ∈ [0,95 ; 1,05]` à moins de 1 m des surfaces, `sd(0, y, 0) = min(y, 20,44 − y)` pour `y` hors des raccords, `sd` au centre du terrain à y = 5 vaut 5, un point dans une cage a `sd > 0`, un point derrière le fond de terrain hors cage a `sd < 0`.

`butMarque(p, rayon)` : l'équipe qui marque si `|p.z| > BUT.seuilMarque + rayon`, `|p.x| < BUT.demiLargeur` et `p.y < BUT.hauteur + rayon` (Z > 0 : bleue marque ; Z < 0 : orange). `dansCage(p)` : boîte de la cage (pour bots, arrêts). `lancerRayon` : sphere tracing avec pas `max(sd, 0,02)`. `surfaceProche` : projection sur la surface le long du gradient.

### 3.3 Plots de boost (`PLOTS`, 34)

Positions officielles de Rocket League, en (x, z) mètres (RL : (x, y) en uu / 100) :

- **6 gros** (100 de boost, recharge 10 s, rayon de ramassage 2,08 m) : (±30,72 ; ±40,96) aux quatre coins du terrain, (±35,84 ; 0) au milieu de chaque mur latéral.
- **28 petits** (12 de boost, recharge 4 s, rayon 1,44 m) : (0 ; ±42,40) ; (±17,92 ; ±41,84) ; (±9,40 ; ±33,08) ; (0 ; ±28,16) ; (±35,84 ; ±24,84) ; (±17,88 ; ±23,00) ; (±20,48 ; ±10,36) ; (0 ; ±10,24) ; (±10,24 ; 0).

La liste complète, ordonnée (Z croissant puis X croissant, `id` = index), est dans `contrat.ts` et testée (34, 6 + 28, symétrie en X et en Z). Un plot est ramassé quand le centre de la hitbox de la voiture est dans le cylindre (rayon, hauteur `PLOT.*`). Jamais ramassé par une voiture démolie. À chaque coup d'envoi, tous les plots sont rechargés.

### 3.4 Coups d'envoi (`COUPS_D_ENVOI`, équipe bleue)

| position | (x ; z) m | cap |
|---|---|---|
| diagonale gauche | (-20,48 ; -25,60) | +45° |
| diagonale droite | (20,48 ; -25,60) | -45° |
| arrière | (0 ; -46,08) | 0 |
| décalée gauche | (-2,56 ; -38,40) | 0 |
| décalée droite | (2,56 ; -38,40) | 0 |

L'orange est le même point tourné de 180° autour de Y (`x → -x`, `z → -z`, cap + π). Pour n voitures, `match.ts` tire n positions parmi les 5 SANS remise avec `Rng` (en 1v1 : l'une des deux diagonales ou l'arrière ou une décalée, comme RL) ; les voitures sont posées à `VOITURE.hauteurRepos` (0,17 m), boost 33,33. La balle est posée en (0 ; 0,9275 ; 0) au repos.

## 4. Physique — la balle (`balle.ts`, module B)

Constantes : `BALLE` (`contrat.ts`). Pas interne ≤ `PAS_S` ; `pasBalle` découpe en sous-pas si `|v|·dt > 0,5·rayon` (jamais de tunnel à 60 m/s).

1. Gravité (`GRAVITE` = 6,5 m/s²) puis amortissement `v ← v·(1−0,03)^dt`, `w ← w·(1−0,03)^dt`.
2. Intégration semi-implicite de la position.
3. Collision avec la SDF : si `sd(p) < rayon`, profondeur `δ = rayon − sd`, normale `n` ; `p += n·δ`. Vitesse du point de contact `vc = v + w × (−n·rayon)` ; `vn = vc·n`. Si `vn < −seuilRebond` : impulsion normale `v += −(1 + e)·vn·n` avec `e = 0,6` ; sinon on annule `vn` (pas de rebond). Frottement : vitesse tangentielle `vt = vc − (vc·n)n` ; impulsion tangentielle limitée par Coulomb (`μ = 0,35`) : `jt = min(|vt|·m/(1 + 1/0,4), μ·jn)` ; elle modifie `v` et `w` (inertie `0,4·m·r²`). Roulement sur une surface : `w` amorti de `frottementRoulement`.
4. Plafonds : `|v| ≤ 60 m/s`, `|w| ≤ 6 rad/s`.
5. Retourne le plus fort impact normal (pour le son et les étincelles).

`predireBalle(arene, balle, dureeS, pasS = 1/30)` : copie la balle, la fait évoluer SEULE sur le décor (sans voiture) et rend des échantillons `{t, p, v}` ; les bots s'en servent. Elle ne modifie jamais l'entrée.

Tests : chute de 5 m sur le sol : première hauteur de rebond = 0,36 × la hauteur de chute à ±8 % (traînée comprise) ; rebond dans un coin sans fuite à travers les murs sur 10 000 pas à 60 m/s ; spin : une balle qui roule acquiert un spin cohérent avec sa vitesse (`w ≈ v / r`) ; stabilité : au repos sur le sol, `|v| < 0,05` après 3 s ; tir dans un but à 30 m/s : `butMarque` vrai, la balle reste dans la cage sans en sortir par le mur ; la balle ne traverse jamais le plafond.

## 5. Physique — la voiture (`voiture.ts` + `contacts.ts`, module C)

L'Octane est la seule carrosserie : masse 180, boîte `1,1801 × 0,8420 × 0,3616` m, centrée à `(0,1388 ; 0 ; 0,2075)` de l'origine (`VOITURE`). L'origine repose à 0,17 m du sol. Pas de 1/120 s.

### 5.1 Contact des roues avec la surface

Pour chacune des 4 roues (`VOITURE.roues` : centre local et rayon) : `centre = p + base·local`, `s = sd(centre) − rayon`. La roue « touche » si `s < margeContactRoue` (5 cm). `rouesContact` = nombre de roues qui touchent ; `normaleSurface` = moyenne des normales aux centres des roues en contact (normalisée) ; `auSol = rouesContact ≥ 3`. Le sol, les murs et le plafond sont traités pareillement : la « surface » est ce que dit la SDF.

Résolution : pour chaque roue qui s'enfonce (`s < 0`), impulsion non élastique (e = 0) au point de la roue, avec masse et inertie du solide (inertie de boîte pleine de masse 180), qui annule la vitesse normale entrante du point et corrige la position de `min(−s, 2 cm)` par pas. Le couple des roues partielles fait naturellement pivoter la voiture. **Pas de frottement dans cette impulsion** : l'adhérence est le modèle de pneu du § 5.3.

### 5.2 Forces par pas (ordre)

1. `demolie` : décompte `reapparitionDans`, sortie ; `figee` : entrées ignorées, mais physique (gravité, collage, contacts) active.
2. Gravité `(0, −6,5, 0)` toujours, y compris sur les murs.
3. **Collage** si `auSol` : accélération `−normale × (collageSol si normale.y > 0,7 sinon collageMur)` (`collageSol` = demi-gravité, `collageMur` = gravité entière : sur un mur la voiture reste plaquée mais la gravité la fait redescendre si on ne roule pas).
4. Conduite (§ 5.3) si `auSol`, sinon contrôle aérien (§ 5.5). Saut (§ 5.4) dans tous les cas.
5. Boost (§ 5.6).
6. Intégration : `v += a·dt` ; plafond `|v| ≤ 23` ; `p += v·dt` ; `integrerBase(base, w, dt)` ; `|w| ≤ 5,5` (y compris pendant un flip).
7. Contact du corps avec le décor (§ 5.8), supersonique, événements.

### 5.3 Conduite (sol, murs, plafond) [~ calée sur RL]

On travaille dans le plan tangent de la surface. `f` = avant projeté sur ce plan (normalisé), `l = normale × f` (latéral), `vf = v·f`, `vl = v·l`.

- **Gaz effectif** : `accelEff = accel`, forcé à `+1` si le boost brûle (comme RL).
- **Longitudinal** (`CONDUITE`) : si `accelEff` va dans le sens de `vf` (ou `|vf| < seuilArretFrein`) : `af = signe(accelEff)·|accelEff|·interpolerTable(courbeGaz, |vf|)` ; au-delà de 14,1 m/s le gaz n'accélère plus mais ne freine pas. Si `accelEff` est opposé à `vf` : `af = −signe(vf)·frein` (3 500 uu/s², sans dépasser zéro dans le pas : au franchissement de zéro on passe en marche arrière). Sans gaz : `af = −signe(vf)·rouleLibre` (sans dépasser zéro).
- **Virage** : vitesse de lacet autour de la normale `ψ = κ(|vf|)·vf·direction` avec `κ = interpolerTable(courbeCourbure, |vf|)` (courbure RL : rayon 2,5 m à 5 m/s, 4,3 m à 10 m/s, 7,3 m à 15 m/s, 11 m à 23 m/s), vitesse effective minimale de 1,5 m/s dans le calcul quand `|accel| > 0` (la voiture pivote doucement à l'arrêt). Appliquée à `w` par lissage de la composante selon la normale (`1 − exp(−30·dt)`). En dérapage `ψ × facteurLacetDerapage` (1,6).
- **Adhérence latérale** : `vl ← vl·exp(−k·dt)`, `k = adherenceLaterale` (20 /s), `×0,1` en dérapage ; en dérapage `vf ← vf·exp(−0,25·dt)`.
- **Décollage de la surface** : si la vitesse normale sortante dépasse `decollageNormal` (3 m/s) ou si l'élan fait sortir une roue de plus de 25 cm, le collage est suspendu 0,15 s (rampes, sauts depuis un mur).
- **Alignement** : avec 1 ou 2 roues seulement en contact, la base glisse vers la surface sous les roues à `autoAlignementRoulis` (4 rad/s max).
- **Retournement forcé** : à plat sur le toit (`haut.y < −0,3`, toit à moins de 15 cm du sol, aucune roue en contact), un appui sur saut déclenche le **redressement** : impulsion `2,0 m/s` vers le haut (`CONDUITE.redressement.impulsion` = uu(200) ; le texte d'origine disait 0,2), vitesse angulaire de 4 rad/s autour de l'axe (`avant` ou `droite`) qui ramène `haut` vers +Y, 0,4 s (`redressement`). Pas de saut normal dans ce cas.

### 5.4 Saut et double saut [RL]

- Appui (front montant) avec `rouesContact ≥ 1` : `v += haut·SAUT.impulsion` (2,91667 m/s ; le saut part du haut de LA VOITURE, donc loin du mur sur un mur), `saut.aSaute = true`, `saut.tenue = true`, `saut.temps = 0`.
- Tant que le bouton reste tenu et `saut.temps < 0,2 s` : accélération supplémentaire `haut·SAUT.maintien` (14,5833 m/s²). Relâcher termine la phase définitivement.
- Une fois en l'air (`rouesContact = 0`), `saut.tempsEnLAir` compte ; **fenêtre de 1,25 s** pour le second saut. Un décollage sans saut (chute d'un mur, rampe) ouvre la même fenêtre ; l'appui y compte comme second saut.
- Second appui (front montant) dans la fenêtre, `secondUtilise = false` : si `|lacet| + |tangage| + |roulis| ≥ FLIP.zoneMorte` (0,5, règle de RL : somme des valeurs absolues) c'est un **flip** (§ 5.5), sinon un **double saut** (impulsion `impulsionDoubleSaut` selon `haut`, sans maintien).
- Retour au sol (`auSol`) : `aSaute`, `secondUtilise`, `tempsEnLAir`, `flip.actif` remis à zéro.
- Hauteur du saut simple (tenu 0,2 s) : l'origine monte d'environ 2,3 m (sommet visé à 2,1–2,6 m ; test).

### 5.5 Flip (dodge), air control, stall [RL / ~]

**Entrées en l'air** (formule RL : couple + amortissement) dans le repère de la voiture. Avec `ω_a`, `ω_d`, `ω_h` les composantes de `w` sur `avant`, `droite`, `haut` :

```
roulisEff = derapage ? clamp(roulis + direction, −1, 1) : roulis     lacetEff = derapage ? 0 : (lacet != 0 ? lacet : direction)
α_avant  =  coupleRoulis · roulisEff  − amortRoulis   · ω_a · (1 − |roulisEff|)
α_droite =  coupleTangage · tangage   − amortTangage  · ω_d · (1 − |tangage|)
α_haut   = −coupleLacet   · lacetEff  − amortLacet    · ω_h · (1 − |lacetEff|)
```

(constantes `AIR` : 36,08 / 12,146 / 8,92 pour les couples, 4,472 / 2,798 / 1,886 pour les amortissements ; le moins devant le lacet vient de la convention de signe du § 1). `w += (α_avant·avant + α_droite·droite + α_haut·haut)·dt`, puis `|w| ≤ 5,5`. Pendant le verrou de tangage d'un flip, `tangage = 0`. Avec le boost : accélération selon `avant` (§ 5.6).

**Flip** (au second appui avec manche) :

1. Direction du dodge `[dirA, dirD] = normaliser([−tangage, lacetEff + roulisEff])` (manche vers l'avant = tangage négatif = flip avant). `stall` si `|dirA| < 0,1` et `|dirD| < 0,1` alors que la somme des entrées dépasse le seuil (lacet et roulis opposés, tangage nul : pas d'impulsion horizontale, rotation de roulis seule).
2. Impulsion horizontale (sauf stall), avec `avantPlat = normaliser(avant, y = 0)`, `droitePlat` de même, `r = min(|v·avantPlat| / 23, 1)` : `Δv = 5 · [ avantPlat · dirA · (1 + (S_A − 1)·r) · k + droitePlat · dirD · (1 + (S_D − 1)·r) ]`, valeurs de RocketSim : `S_D = FLIP.echelleCote` (1,9), `S_A = FLIP.echelleAvant` (1,0) pour un dodge « avant » ou `FLIP.echelleArriere` (2,5, avec `k = 16/15`) pour un dodge « arrière ». « Arrière » se juge par rapport au sens de la marche (`flipEstArriere`) : sous 1 m/s de vitesse avant, manche tiré ; sinon `(dirA ≥ 0) ≠ (vitesse avant ≥ 0)`. Résultat : un flip avant donne +5 m/s à toute vitesse, un flip latéral +7,7 m/s à 14 m/s, un flip arrière −10,2 m/s à 14 m/s. [RL : RocketSim `RLConst.h`.]
3. Rotation : axe monde `avant·dirD − droite·dirA`, vitesse angulaire de consigne `FLIP.vitesseAng` = 5,5 rad/s (le plafond ordinaire : le couple de dodge de RL, 224 / 260 rad/s², l'atteint en quelques ms) tenue 0,65 s. Le flip ne fait donc PAS un tour exact : ≈ 205° à 0,65 s, la voiture est encore sur le dos, puis la vitesse résiduelle est amortie par l'air control (≈ 2,8 /s en tangage), soit ≈ 314° au total. Rien n'est remis à zéro à la fin du couple. **Annulation** : après `annulationMinS` (0,15 s) la consigne est multipliée par `1 − max(0, tangage·signe(dirA))` (tirer le manche à l'opposé stoppe le flip).
4. Amortissement vertical : dès 0,15 s et jusqu'à la fin du couple (0,65 s), tant que la voiture descend ou avant 0,21 s, `v.y *= 1 − 0,35·dt·120` à chaque pas : la voiture « flotte » pendant tout le flip (chute ≈ 0,15 m, comme RL).
5. Verrou de tangage : le tangage est ignoré tant que le flip a moins de `verrouTangageS + verrouTangageExtraS` (0,65 + 0,3 = 0,95 s).
6. Fin : au bout de 0,65 s ou au retour au sol.

### 5.6 Boost [RL]

Un appui consomme au moins `BOOST.dureeMinS` (0,1 s) même si le bouton est relâché plus tôt. Tant que le boost brûle et `boost > 0` : accélération `BOOST.acceleration` (9,91667 m/s²) le long de `f` au sol, `BOOST.accelerationAir` (10,5833 m/s²) le long de `avant` en l'air (la poussée du gaz, 0,667 m/s², s'ajoute en l'air avec ou sans boost) ; consommation `33,33/s` ; plafond de vitesse 23 m/s. Aucun effet à `boost = 0`. `supersonique` : devient vrai à `|v| ≥ 22,0`, retombe sous `21,0`. Événements `boost` (début / fin) et `supersonique`.

### 5.7 Dérapage (powerslide) [~]

Au sol, `derapage` (frein à main) : adhérence latérale ÷ 10, lacet × 1,6, légère perte de vitesse avant (§ 5.3). En l'air, il bascule en air roll libre (§ 5.5). Le rendu laisse des traces de pneus (`derapage && auSol && |vl| > 3`).

### 5.8 Contact du corps avec le décor

Échantillons : les 8 coins et les 6 centres de face de la hitbox. Pour chaque point avec `sd < 0` : impulsion au point (restitution 0,2, pas de frottement) et correction de position (≤ 10 cm par pas). Événement `choc` si la vitesse normale > 3 m/s. En conduite normale la hitbox ne touche jamais (son dessous est à 20 cm du sol, les roues portent) ; le corps ne compte que retourné, de nez sur un mur ou au plafond.

### 5.9 Voiture ↔ balle (`contacts.ts`) [RL / ~]

Détection : boîte orientée (centre `centreHitbox`) contre sphère : point de la boîte le plus proche du centre de la balle. Si distance < rayon de balle :

1. **Séparation** : la balle est repoussée de la profondeur le long de la normale.
2. **Choc physique** : impulsion le long de la normale avec restitution NULLE (`CONTACT_BALLE.restitution` = 0, RocketSim `CARBALL_COLLISION_RESTITUTION`), masses 180 / 30, inertie de la voiture (boîte pleine) pour le couple sur la voiture ; frottement de Coulomb `CONTACT_BALLE.frottement` = 2 (RocketSim `CARBALL_COLLISION_FRICTION`, plafonné par l'adhérence totale `vt / raideur`, donc stable) : spin de la balle et dribble. Une voiture à 23 m/s envoie une balle immobile à ≈ 31 m/s (RL ≈ 32).
3. **Impulsion de Psyonix** (si `tick − dernierContactBalleTick > 0,1 s · 120`) : `rel = centre_balle − centre_hitbox`, composante verticale × 0,35, composante selon `avant` de la voiture × 0,65, normalisée ; intensité = `min(‖v_balle − v_voiture‖, 46) × interpolerTable(courbeImpulsion, vitesse relative)` ; ajoutée à `v_balle` (puis plafond 60 m/s). C'est ce qui rend les frappes de RL plus « longues » qu'un choc physique et fait monter la balle quand on la prend par-dessous.
4. Mise à jour de `dernierContactBalleTick`. `balle.dernierToucheur` est mis à jour par `match.ts`.

Tests : voiture à 23 m/s heurtant de face une balle immobile : la balle sort entre 38 et 48 m/s (RL : ~ 40–45) ; à 5 m/s : entre 8 et 12 m/s ; frapper sous le centre de la balle la lance vers le haut (`v.y > 0`) ; la balle posée sur le toit (« dribble ») se tient plusieurs secondes sans exploser (l'impulsion supplémentaire ne se ré-applique pas tant que le délai n'est pas écoulé).

### 5.10 Voiture ↔ voiture, bump, démolition (`contacts.ts`) [~]

SAT entre deux boîtes orientées (15 axes) : axe de pénétration minimale, point de contact (milieu de la face de recouvrement). Impulsion avec rotation (restitution 0,1, frottement 0,3). **Bump** (RocketSim) : si le délai du couple est écoulé (0,25 s), toute voiture qui fonce vers l'autre PAR SON PARE-CHOCS AVANT (même critère que la démolition, `demoAvantMinM`) ajoute à la victime, le long de sa propre direction de marche (vitesses d'avant le choc), une poussée selon la vitesse `x` de l'attaquant vers la victime : au sol 0 → 0, 14 → 11, 22 → 15,3 m/s ; en l'air 0 → 0, 14 → 13,9, 22 → 19,45 m/s ; plus une poussée verticale 0 → 0, 14 → 2,78, 22 → 4,17 m/s (le long du haut de la victime au sol, +Y en l'air). Un choc frontal bumpe les deux. **Démolition** : l'attaquant est `supersonique`, la victime est d'une AUTRE équipe (`tirAmi` faux : un coéquipier se fait seulement bumper) et le point de contact est à plus de `demoAvantMinM` (0,645 m) devant l'origine de l'attaquant. `contactVoitureVoiture` rend `demolition`, `match.ts` applique : `demolie = true`, `reapparitionDans = 3`. Deux voitures supersoniques qui se percutent peuvent se démolir mutuellement.

## 6. Match — `match.ts` (module D)

### 6.1 Phases

| phase | durée | entrées voitures | chrono |
|---|---|---|---|
| `decompte` | 3 s (événements `decompte` 3, 2, 1 puis `coupDEnvoi`) | ignorées (`figee`) | arrêté |
| `enJeu` | jusqu'au but ou au chrono | actives | décompte (de `dureeS` à 0) |
| `but` | `celebrationS` = 4,5 s | actives (la balle est libre) | arrêté |
| `fini` | — | physique figée | — |

- Le chrono ne tourne qu'en `enJeu`. À 0 : événement `chronoZero`. Si la balle est en l'air (centre à plus de `rayon + 0,3` m du sol) la fin attend qu'elle touche le sol (`attenteSolBalle`), au plus `graceBalleEnAirS` (12 s). Ensuite : score différent → `fini`, vainqueur ; égalité → **prolongation** (mort subite, `prolongation = true`, événement `prolongation`, nouveau coup d'envoi) ; en prolongation le premier but fait passer la phase `but` à `fini`.
- **But** : en `enJeu`, `arene.butMarque(balle.p, BALLE.rayon)` non nul. Le marqueur est `balle.dernierToucheur` s'il est de l'équipe qui marque, sinon null (CSC, le but compte pour l'équipe sans buteur). Passe décisive = `avantDernierToucheur` de la même équipe que le buteur, autre voiture, moins de 5 s avant le but. Événement `but`.
- Après `celebrationS`, si la partie continue : `preparerCoupDEnvoi` (voitures replacées, balle au centre, plots pleins, boost 33,33, démolies ressuscitées, `decompte`).
- **Démolie** : pendant `reapparitionDans` la voiture est invisible et intangible ; à zéro elle réapparaît à une position de coup d'envoi libre de son équipe, cap vers le terrain, boost 33,33 (événement `reapparition`). Pas de démolition pendant le décompte.
- **Plots** : chaque pas, pour toute voiture non démolie, si le centre de sa hitbox est dans le cylindre d'un plot actif : `boost = min(100, boost + valeur)`, plot inactif pour sa recharge. Événements `plot`, `plotRecharge`.

### 6.2 Statistiques et points (barème `MATCH.points`)

But 100, passe décisive 50, arrêt 50, tir cadré 20, démolition 10, touche 2. **Arrêt** : une voiture touche une balle qui allait vers sa cage (prolongement linéaire de la trajectoire dans la cage, à moins de 12 m de la ligne, vitesse ≥ 8 m/s). **Tir** : après un contact, la balle part vers la cage adverse dans les mêmes conditions (une fois par seconde et par voiture). `resultatMatch` trie par points décroissants et désigne le meilleur joueur.

### 6.3 Ce que `pasMonde` fait, dans l'ordre

1. Copie les positions dans `precedent`. 2. `pasVoiture` pour chaque voiture (entrées de `entrees[i]` ; bloquées en décompte). 3. `pasBalle`. 4. Contacts voiture-balle (dans l'ordre des id) puis voiture-voiture (paires i < j). 5. Plots. 6. Règles de phase (but, chrono, prolongation, fin, réapparitions). 7. `tick++`, `temps += dt`. Rend les événements dans l'ordre de leur apparition.

## 7. Bots — `bots.ts` (module D)

Aucune triche : même physique, mêmes entrées que l'humain, aucune téléportation, aucune connaissance autre que l'état du monde (positions, vitesses, boost, plots actifs) et la prévision de la balle (`predireBalle`). Réglés par `PROFILS_BOT` (`contrat.ts`).

**Pipeline** : toutes les `1 / frequenceDecisionHz` s le cerveau décide d'une consigne ; les `EntreesVoiture` calculées sont retardées de `reactionS` (file) et le bruit gaussien de visée est ajouté à la direction visée ; entre deux décisions la dernière consigne est maintenue.

**Comportements** (machine d'états, priorité décroissante) :

1. **Coup d'envoi** : en `decompte`/début d'`enJeu`, accélérer + boost droit sur la balle ; Pro et All-Star : saut de flip avant juste avant le contact (**speed flip** pour l'All-Star, flip diagonal au sol sur le premier tiers du trajet, annulation partielle). Le voisin le plus proche de la balle y va ; les autres ramassent le plot qui est sur leur chemin puis se replient.
2. **Récupération** (en l'air sans objectif) : orienter les roues vers la surface d'atterrissage prévue (air control), flip cancel si la voiture est retournée, atterrir sur les roues.
3. **Attaque / dégagement** : calcule le **point d'interception** : parcourt la trajectoire prévue (`predireBalle`) et prend le premier échantillon `t` tel que le temps d'atteinte de la voiture (distance / vitesse moyenne atteignable, plus le temps de rotation, plus le saut éventuel) est ≤ `t` ; vise une position de frappe derrière la balle, du côté d'où il faut la renvoyer (vers la cage adverse, ou hors de sa cage si défense). Au sol : conduite par contrôleur proportionnel sur l'angle (avec dérapage pour tourner serré), boost si la cible est à plus de 25 m et alignée ; saut / flip pour une balle entre 1 et 4 m d'altitude (Pro, All-Star) ; **aérien** (jump + double saut ou boost, air control, flip final) si la balle est entre 4 m et `hauteurAerienMax` et atteignable (Pro, All-Star).
4. **Rotation** (équipes de 2 ou 3, `rotation` vrai) : le rôle de chaque bot est recalculé à 4 Hz d'après les temps d'atteinte : le plus proche attaque, le deuxième soutient (à 20–30 m derrière la balle, sur le côté libre), le troisième couvre la cage (entre la balle et sa cage, à 12 m de la ligne). Un bot qui vient de frapper se replie (« rotation arrière ») par le côté. Le Débutant n'a pas de rotation : tous chassent la balle.
5. **Ramasser du boost** : si `boost < 35` (ou `< 60` pour `appetitPlots` élevé) et pas d'urgence (balle à plus de 30 m et rôle ≠ attaque), va au plot actif le plus utile (valeur / détour) en restant sur son demi-terrain.
6. **Démolition** (All-Star) : si un adversaire est sur sa route à moins de 25 m et que le bot est supersonique ou peut le devenir, vise l'adversaire (jamais au détriment d'une défense de cage urgente).
7. **Défense de cage** : si la balle part vers sa cage (prévision < 2 s), priorité maximale : se placer sur la trajectoire, sauter / flipper pour dévier.

**Niveaux** :

| | Débutant | Pro | All-Star |
|---|---|---|---|
| réaction / bruit de visée | 0,35 s / 0,20 rad | 0,14 s / 0,07 rad | 0,04 s / 0,02 rad |
| boost | 45 % du temps utile | 80 % | 100 % |
| flips, aériens | non (sauf coup d'envoi simple) | oui, balles jusqu'à 9 m | oui, jusqu'à 18 m, speed flip, demi-flip |
| rotation, plots | non, 25 % | oui, 70 % | oui, 100 % |
| démolitions | non | non | oui |
| prévision de la balle | 0,6 s | 1,5 s | 3 s |
| placement (depuis le 2026-11-12) | aucun : fonce sur la balle, la frappe dans le sens où il arrive | derrière la balle sur la ligne de frappe, contourne, se replie, barre la route | idem |
| vitesse sans boost | 14 m/s (pas de flip) | flip de vitesse (≈ 19 puis 22 m/s) | idem |

Critères : sur 20 graines, une partie 3v3 Pro contre Pro de 5 min se termine sans NaN, sans voiture hors du stade (`sd(origine) > −0,3 m`), avec au moins un but dans 70 % des parties ; un All-Star bat un Débutant dans ≥ 80 % des parties 1v1 de 3 min ; aucune voiture ne reste immobile plus de 6 s hors décompte ; un bot ne se retourne pas définitivement (retombe sur ses roues après un saut).

**Réglage sur la physique de RocketSim (2026-11-12)** : comportements ajoutés ou changés, mesures et résultats au § 15 (« Bots réglés sur cette physique ») ; la description ci-dessus reste vraie pour le reste (pipeline, rôles, aériens, profils).

## 8. Contrôles et caméra

### 8.1 Clavier / souris (positions physiques : `KeyboardEvent.code`, donc ZQSD sur AZERTY)

| action | défaut | notes |
|---|---|---|
| accélérer / reculer | W, ↑ / S, ↓ | au sol ; en l'air W = nez en bas, S = nez en haut |
| diriger / lacet | A, ← / D, → | au sol volant ; en l'air lacet |
| saut | Espace | double appui = double saut ; avec direction = flip |
| boost | Maj gauche ou clic gauche | |
| dérapage / air roll libre | C ou Ctrl gauche | au sol frein à main ; en l'air, avec A/D = roulis |
| roulis gauche / droite | Q / E | air roll direct |
| ball cam | Y ou clic droit | bascule |
| regard arrière | V (tenu) | |
| klaxon | H | le klaxon à deux tons du Truck Muche |
| pause | Échap | menu pause (toujours en première liaison de la pause) |
| classement | Tab (tenu) | |
| réactions rapides | 1 (infos) / 2 (compliments) / 3 (réactions) / 4 (excuses) | croix de Rocket League : un appui ouvre la catégorie, un second envoie le message (spec en ligne § 15) |

Les liaisons sont rebindables (`LiaisonsTouches`, deux codes par action au plus) et sauvegardées. Le regard libre (stick droit) se fait à la souris en tenant le bouton du milieu.

### 8.2 Manette (Gamepad API, mapping « standard »)

RT (7) accélère, LT (6) freine / recule (analogiques), stick gauche : direction au sol, tangage et lacet en l'air ; A (0) saut ; B (1) boost ; X (2) dérapage / air roll libre ; Y (3) ball cam ; LB (4) / RB (5) roulis gauche / droite ; stick droit : regard libre ; R3 (11) vue arrière ; Start (9) pause ; L3 (10) klaxon ; croix directionnelle (12 à 15) : réactions rapides (§ 15 de la spec en ligne). Chaque action est reliable au choix du joueur (boutons et demi-axes, `liaisons.ts`), Start restant toujours sur la pause. Zone morte radiale réglable (défaut 0,12), courbe quadratique sur les sticks, vibrations (`vibrationActuator.playEffect("dual-rumble")`) aux touches de balle, atterrissages et démolitions, jamais si `vibrations` est faux ou en mouvement réduit. La première manette connectée est lue ; clavier et manette sont fusionnés (le plus fort gagne).

### 8.3 Caméra (`camera.ts`, pure)

Paramètres par défaut de Rocket League (`CAMERA_DEFAUT`) : champ **horizontal** 110° (converti en vertical selon l'aspect), distance 2,70 m, hauteur 1,00 m, angle -4°, rigidité 0,45, vitesse du regard 4,6, transition 1,2.

- **Car cam** : la direction de visée suit l'avant de la voiture projeté (la composante verticale de la voiture sur un mur est suivie : sur un mur ou au plafond le « haut » de la caméra suit la normale de la surface, lissé). Position = origine voiture − dir·distance + haut·hauteur ; cible = origine + dir·(distance/2) + haut·0,3 ; angle ajouté en tangage.
- **Ball cam** : direction = voiture → balle ; la caméra se place sur la ligne balle → voiture derrière la voiture ; elle regarde vers la balle (tangage borné pour que la caméra ne passe pas sous le sol). Mélange `melange` 0 → 1 lissé à `vitesseTransition`.
- **Lissage** : la direction converge avec `α = 1 − exp(−dt·(4 + 18·rigidite))` ; position idem (légèrement plus raide).
- **Anticollision** : si `sd(position) < 0,4 m`, la caméra est rapprochée de la voiture le long du rayon (par `lancerRayon`) ; elle ne sort jamais de l'arène et reste à ≥ 0,5 m du plafond.
- **Regard libre** : le stick droit / la souris tourne la caméra autour de la voiture jusqu'à ±90° (lacet) et ±45° (tangage), revient au centre au relâchement.
- **Secousse** (touche de balle forte, démolition, but) décroissante, désactivée en mouvement réduit.
- Pendant la célébration d'un but : la caméra tourne autour de la balle puis du marqueur (orbite lente de 4,5 s) ; pendant un décompte, plan fixe en car cam.
- Après un but, une démolition ou chaque coup d'envoi : retour à la valeur par défaut de la ball cam (`balleCamParDefaut`).

## 9. Rendu, effets, HUD, sons

### 9.1 Rendu (`rendu.ts`, module E) — filaire Palantir

- **Stade** : coque obtenue en balayant le profil (fillet de sol 2,56 m, mur droit, fillet de plafond 2,56 m) le long du contour du plan (octogone aux coins arrondis, buts creusés) ; mêmes formules que la SDF (un test compare quelques points de la coque à `sd ≈ 0`). Murs : réseau de lignes hexagonales cyan (`C.cyan`) peu lumineuses + remplissage translucide additif très faible, plus clair près des cages, teinté bleu côté Trèfles et orange côté Tigres. Sol sombre (`C.ground` un peu relevé), lignes blanches (médiane, rond central de 9,15 m de rayon, surfaces de réparation, 2,5 cm d'épaisseur en plan), demi-terrains légèrement teintés.
- **Buts** : poteaux et barre transversale en tubes de la couleur de l'équipe qui défend (bloom), filet en lignes fines, fond de cage lumineux, bandeau LED.
- **Plots** : anneau au sol + hexagone ; gros plots plus grands, plus lumineux, avec une colonne de lumière ; inactifs : sombres, avec un anneau qui se remplit selon `recharge`. Ramassage : éclair bref.
- **Voitures** : silhouette filaire d'Octane (boîtes + `EdgesGeometry` : caisse, cabine, aileron, 4 roues cylindriques qui tournent à la vitesse de roulement et braquent à l'avant), couleur d'équipe émissive (au-dessus du seuil du bloom), plaque de nom pour les autres voitures (sprite canvas) visible à moins de 60 m, jamais pour la voiture du joueur ; flammes de boost (cône additif animé) ; traînée supersonique (lignes) ; explosion de démolition (particules + anneau) ; traces de pneus au sol (réutiliser `creerTracesPneus` de `lib/fps/rendu-traces.ts`).
- **Balle** : icosphère filaire (rayon visuel 0,9275 m) avec noyau lumineux, orientation intégrée de `balle.w` côté rendu (on ne stocke pas l'orientation dans la physique), traînée de la couleur de la dernière équipe qui l'a touchée, étincelles à l'impact (`balleDecor`, `toucheBalle`).
- **But** : explosion de la couleur de l'équipe qui marque (particules, onde de choc au sol, flash plein écran à 25 % d'opacité, SUPPRIMÉ en mouvement réduit), public qui s'agite, le Truck Muche klaxonne.
- **Interpolation** : `synchroniser(monde, alpha, dt)` interpole position (lerp) et orientation (interpolation de bases par rotation relative) entre `monde.precedent` et l'état courant.
- **Qualité basse** (tactile / ≤ 4 cœurs) : pas de public, pas de Truck, particules divisées par 3, filets simplifiés.
- Les bornes de draw calls et les conventions de bloom sont celles de la vue Palantir : couleurs ordinaires sous 0,24 de luminosité, seuls les éléments actifs (équipes, plots actifs, balle, lignes) bloomment.

### 9.2 Sons (`sons.ts`, module E) — WebAudio synthétisé, aucun fichier

Contexte créé dans un geste utilisateur (`activer()` au clic sur « Lancer »). Moteur : deux oscillateurs en dents de scie filtrés, hauteur selon la vitesse (60 → 260 Hz), plus de gain et un souffle de bruit filtré en boost ; moteurs des 3 voitures les plus proches seulement (volume en 1/distance, panoramique simple). Autres sons : boost (bruit blanc passe-haut), saut (clic grave), flip (zip descendant), atterrissage (thud proportionnel), choc de la balle (clac + grave proportionnel à `force`), rebond au mur, plot (tintement montant, plus grave pour un gros), démolition (explosion), but (klaxon de stade + montée de foule + feu d'artifice), décompte (3 bips puis un plus haut), prolongation, coup de sifflet de fin, **klaxon** (deux tons du Truck Muche). Volume maître `volume`, coupé en pause (`suspendre`), mouvement réduit sans effet sur le son.

### 9.3 HUD (React, `app/components/rocket/`, module G) — façon Rocket League

- **Haut centre** : score bleu | minuteur | score orange (noms d'équipes sous les scores) ; minuteur `m:ss`, « PROLONGATION » à la place en mort subite ; sous 30 s le minuteur passe à l'ambre.
- **Bas droite** : jauge de boost circulaire (SVG, 100 graduations, anneau rempli selon `boost`, chiffre au centre, `role="meter"`), vitesse en km/h dessous (RL : uu/s × 0,036).
- **Centre** : bannière (`BanniereHud`) : « 3 / 2 / 1 / GO ! », « BUT ! » avec le nom du buteur et de la passe, « DÉMOLITION », « PLUS QUE 30 SECONDES », « PROLONGATION ». Mouvement réduit : apparition sans animation.
- **Bas gauche** : fil d'événements (6 lignes, 5 s) : buts, démolitions, passes.
- **Indicateur** : ball cam activée (« BALLE » / « VOITURE »), manette connectée, aide des touches pendant les 8 premières secondes.
- **Tab** : tableau (nom, équipe, points, buts, passes, arrêts, tirs, démos).
- **Voiture démolie** : « Démolie · réapparition dans 2 s ».
- **Pause** (`role="dialog"`, `aria-modal`, focus piégé, Échap = Reprendre) : Reprendre, Recommencer, Réglages (caméra : FOV, distance, hauteur, angle, rigidité ; ball cam par défaut ; volume ; manette), Aide des touches, Quitter. Cibles ≥ 40 px.
- **Fin de match** : vainqueur, score, prolongation éventuelle, tableau complet, MVP, boutons « Rejouer » et « Quitter ». Annonce vocale (`aria-live="polite"`) des buts et du résultat.

## 10. Intégration dans la vue Palantir (module G)

Fichiers modifiés : `app/components/Agroparc3D.tsx` (+ son CSS module). Rien d'autre du site ne change, `ChoixMode.tsx`, `lobby-modele.ts`, `useArene` et le serveur ne sont pas touchés.

1. **Bouton** « Rocket Muche » dans la liste d'actions du haut, après « Arène » (`aria-expanded={rocketOuvert}`). Désactivé avec une infobulle sur tactile (clavier ou manette requis ; si une manette est connectée au moment du clic, l'activer).
2. **Panneau** : `LobbyRocket` s'affiche dans le même emplacement que le panneau « Arène » quand `rocketOuvert && !selected && !enArene && !enRocket`. Ouvrir Rocket ferme « Arène » et le classement et vice versa ; choisir un restaurant ferme Rocket.
3. **État** : `rocketOuvert`, `enRocket`, `configRocket` (mémorisée `localStorage` `pdj-rocket-config`), `hudRocket`, `reglagesRocket` (`pdj-rocket-reglages`), `jeuRocketRef`. « Lancer » : `setEnRocket(true)`, `setCleCanvas((k) => k + 1)` (canvas neuf, comme `monterJeu`), panneau fermé, les `labels` de la vue aérienne masqués comme pour l'arène.
4. **Montage** : un `useEffect` `[enRocket, scene, cleCanvas]` fait `import("@/lib/rocket/jeu").then(({ creerJeuRocket }) => …)` sur le même canvas ; nettoyage = `jeu.dispose()` ; échec (WebGL) = message + sortie. L'effet de la vue aérienne gagne la condition `!enRocket` ; au retour (`quitterRocket` : `setEnRocket(false)`, `setCleCanvas(+1)`) la vue aérienne est recréée et le panneau Rocket rouvert.
5. **`data-arene`** : la racine pose `data-arene="actif"` quand `enArene || enRocket` (neutralise le code « myrtille » de `MyrtilleEasterEgg`). L'écouteur Échap global de `Agroparc3D` ignore Échap quand `enRocket` (le jeu l'écoute lui-même).
6. **Pas de réseau** : `useArene` reste inchangé ; entrer dans Rocket ne touche pas la présence. Le pseudo vient du champ de `LobbyRocket` (par défaut le pseudo de l'arène s'il existe).
7. **HUD** : `<HudRocket>` rendu quand `enRocket`, alimenté par le callback `hud` de `creerJeuRocket` (≤ 20 Hz). Les actions du menu pause appellent la poignée du jeu (`pause`, `recommencer`, `reglages`) ; « Quitter » = `quitterRocket`. `onClose` de la vue (Retour au site) ferme aussi la partie.
8. **Chargement** : aucun import statique de `lib/rocket/*` ni de `three` depuis `Agroparc3D.tsx` ni `app/components/rocket/*` (sauf des types). Seule `import("@/lib/rocket/jeu")` charge le jeu. Vérifier dans le build que le chunk n'est pas dans le premier chargement du menu (règle « menu d'abord »).

Props des composants (module G, `app/components/rocket/contrats.ts`) :

```ts
LobbyRocket({ config, surConfig(c), reglages, surReglages(r), surLancer(), surFermer(), tactile, manette })
HudRocket({ hud: HudRocket | null, reglages, surReglages(r), surReprendre(), surRecommencer(), surQuitter(), surQuitterVue() })
```

`LobbyRocket` : formats 1v1 / 2v2 / 3v3 (radios natives), équipe (Les Trèfles / Les Tigres), niveau des alliés et des adversaires (Débutant / Pro / All-Star), durée (3 / 5 / 7 / 10 min), pseudo, « Lancer », aide des touches repliée (`<details>`), réglages de caméra repliés. Radios natives (flèches du clavier), libellés cliquables, présentation dans l'infobulle comme les lobbies de l'arène (« Menus allégés »).

## 11. Modules, propriétaires et fichiers

Le contrat (`contrat.ts`, `vec.ts` et leurs tests) existe déjà. **Aucun agent ne modifie `contrat.ts` ni `vec.ts`** sans le signaler : un besoin de changement est remonté à l'orchestrateur (les types partagés doivent rester compilables par tous). Chaque module a son fichier de tests Vitest à côté (`*.test.ts`).

| | module | fichiers | dépend de |
|---|---|---|---|
| **A** | stade (SDF) | `lib/rocket/arene.ts`, `arene.test.ts` | contrat, vec |
| **B** | balle | `lib/rocket/balle.ts`, `balle.test.ts` | contrat, vec, A (tests : une arène plate de repli est autorisée dans le test) |
| **C** | voiture + contacts | `lib/rocket/voiture.ts`, `contacts.ts`, `voiture.test.ts`, `contacts.test.ts` | contrat, vec, A |
| **D** | match + bots | `lib/rocket/match.ts`, `bots.ts`, `match.test.ts`, `bots.test.ts`, `match.simulation.test.ts` | contrat, vec, A, B, C |
| **E** | rendu + sons | `lib/rocket/rendu.ts`, `rendu-stade.ts`, `rendu-effets.ts`, `sons.ts`, `rendu.test.ts`, `sons.test.ts` | contrat, vec, three, `lib/fps/rendu*.ts` (réutilisation) |
| **F** | jeu + caméra + entrées + réglages | `lib/rocket/jeu.ts`, `camera.ts`, `entrees.ts`, `reglages.ts` + tests, `scripts/rocket/e2e_rocket.mjs` | contrat, vec, tous |
| **G** | UI + intégration | `app/components/rocket/{LobbyRocket,HudRocket,MenuPauseRocket,FinRocket,contrats}.tsx/.ts`, `Rocket.module.css`, `lib/rocket/lobby.ts` (+ test), modifications de `app/components/Agroparc3D.tsx` | contrat |

Ordre de travail : A, B+C+E+F(G) en parallèle contre le contrat (les tests de B et C utilisent une SDF de sol plan simple en attendant A ; E et F construisent contre le contrat et des mondes jouets), puis D, puis l'intégration (F branche tout, G branche l'UI). Un agent d'intégration lance l'ensemble à la fin : `npx vitest run lib/rocket`, `npx tsc --noEmit -p tsconfig.json`, l'e2e.

Règles communes :
- Aucun `Math.random`, `Date.now`, `performance.now` dans `arene`, `balle`, `voiture`, `contacts`, `match`, `bots`, `camera` (le temps vient des arguments). Le temps réel n'existe que dans `jeu.ts`, `rendu.ts`, `sons.ts`, `entrees.ts`.
- Aucun accès DOM ni `three` hors de `rendu*.ts`, `jeu.ts`, `sons.ts`, `entrees.ts` (qui lit `navigator.getGamepads` et la fenêtre). `arene` … `bots`, `camera`, `reglages`, `lobby` tournent sous Node.
- Les fonctions de la boucle chaude (`sd`, `pasBalle`, `pasVoiture`, `contacts`) n'allouent pas (utiliser les `...Dans` de `vec.ts`, tampons de module).
- Les constantes ne sont jamais recopiées : on importe de `contrat.ts`. Si une valeur manque, on la demande.
- Les signatures sont exactes (`CreerArene`, `PasBalle`… sont des types : `export const creerArene: CreerArene = …` ou une fonction compatible).

Détail par module (tout ce qui n'est pas dit ici est laissé à l'agent, dans le respect de la spec) :

**A — `arene.ts`** : `creerArene()`, § 3. Tests : continuité, gradient, valeurs analytiques (sol, mur latéral à 10 cm → 0,1, plafond, coin, fillet à 45° : `sd = r(√2 − 1)` environ du coin), cages, `butMarque` / `dansCage` aux limites, symétrie (`sd(x,y,z) = sd(−x,y,z) = sd(x,y,−z)`), lancer de rayon contre le mur, `surfaceProche`, une grille de 20 000 points en moins de 100 ms (≈ 5 µs par `sd`).

**B — `balle.ts`** : `creerBalle`, `pasBalle`, `predireBalle`, § 4.

**C — `voiture.ts`, `contacts.ts`** : `creerVoiture`, `replacerVoiture`, `pasVoiture`, `centreHitbox`, `coinsHitbox`, `contactVoitureBalle`, `contactVoitureVoiture`, § 5. Critères d'acceptation chiffrés (sur la SDF réelle de A) : 0 → 14 m/s sans boost en 2,0–2,5 s ; 0 → 23 m/s avec boost en 1,5–1,9 s, supersonique atteint vers 1,6 s ; vitesse max 23,00 m/s ; rayon de virage à 5 m/s : 2,5 m ± 15 % ; saut maintenu : sommet de l'origine à 2,1–2,6 m, retour au sol ; double saut : possible à 1,2 s, refusé à 1,3 s ; flip avant à 14 m/s : gain de vitesse avant +5 m/s (échelle 1,0), flip latéral +7,7 m/s, flip arrière −10,2 m/s ; flip : rotation plafonnée à 5,5 rad/s, ≈ 205° à 0,65 s puis amortissement ; flottement vertical (chute < 0,4 m) ; annulation du flip visible ; air control : tangage max 5,5 rad/s atteint en < 0,6 s ; roulis plus rapide que le tangage ; **mur** : voiture lancée à 15 m/s vers le mur latéral reste en contact ≥ 95 % des pas pendant 3 s en montant (boost), et le plafond se roule de même ; atterrissage retourné → roues au sol après redressement (saut sur le toit) ; dérapage : la vitesse latérale décroît 10 fois moins vite ; démolition à 22,5 m/s supersonique de face, jamais à 18 m/s ; bump sans démolition entre coéquipiers ; contact voiture-balle (chiffres du § 5.9) ; la voiture ne traverse jamais le décor (10 000 pas, trajectoires aléatoires avec `Rng`).

**D — `match.ts`, `bots.ts`** : § 6 et § 7. `match.simulation.test.ts` : parties complètes bot contre bot sur plusieurs graines (critères du § 7), prolongation forcée (égalité artificielle), déterminisme (même graine, même hachage d'état final), chaque événement possible émis au moins une fois sur l'ensemble des parties (`but`, `demolition`, `plot`, `flip`, `chronoZero`, `prolongation`, `fin`).

**E — `rendu.ts`, `sons.ts`** : § 9.1 et § 9.2 ; `creerRenduRocket(monde, opts)` rend `RenduRocket` ; tests sans WebGL : construction des géométries sous Node (three s'importe sans contexte), nombre d'objets ≤ budget (≤ 60 draw calls : compte des `Mesh` / `LineSegments` / `InstancedMesh` visibles), coque cohérente avec la SDF, sons : le moteur construit son graphe avec un `AudioContext` factice.

**F — `jeu.ts`, `camera.ts`, `entrees.ts`, `reglages.ts`** : § 8 et boucle de jeu. `creerJeuRocket(canvas, scene, opts)` : `WebGLRenderer` (pixel ratio ≤ 1,5, comme `lib/fps/jeu.ts`), `THREE.Scene` + fog, décor Agroparc (`construireDecor` avec `exclure: boitesExclusionSite()`, `fantomes: false`, `qualiteParDefaut()`), `creerRenduRocket`, la caméra three **enfant de `rendu.racine`**, `creerPostTraitement(renderer, scene, camera)`, `creerMonde`, un `Cerveau` par bot, accumulateur de pas fixes (`PAS_S`, au plus `PAS_MAX_PAR_IMAGE` par image ; temps réel ralenti de `ralentiCelebration` en phase `but`), interpolation `alpha = reste / PAS_S`, entrées humaines (`creerSourceEntrees`), caméra, sons, HUD (≤ 20 Hz + événements), pause (Échap, `visibilitychange`, perte de focus : pause automatique ; l'accumulateur est remis à zéro à la reprise), fin de partie (`ResultatMatch` dans le HUD), `dispose` (libère renderer, textures, géométries, perd le contexte, écouteurs, audio, `window.__rocket`), crochet de dev `window.__rocket` (type `CrochetRocket`, hors production). Les reglages sont lus de `reglages.ts` (`pdj-rocket-reglages`, tout `try/catch`). `scripts/rocket/e2e_rocket.mjs` (mêmes conventions que les autres e2e : ports libres, Playwright, `next dev`) : ouvre la page, tape « myrtille », clique « Rocket Muche », lance un 1v1 débutant, vérifie `window.__rocket.etat()`, accélère 3 s (vitesse > 10 m/s), téléporte la balle dans le but et vérifie score et coup d'envoi, ouvre la pause (Échap), quitte, vérifie le retour à la vue aérienne ; captures dans `docs/medias/rocket/`.

**G — UI et intégration** : § 9.3 et § 10, `lib/rocket/lobby.ts` (`normaliserConfig`, `libelleConfig`, lecture / écriture de `pdj-rocket-config` avec `StockageMinimal`). Tests : `lobby.test.ts`, rendu serveur des composants (`renderToStaticMarkup`, comme `lib/resto-badge.test.ts`) : formats et niveaux en radios natives, `role="meter"` de la jauge, bannières, dialogue de pause avec les trois boutons, tableau de fin ; vérification que `Agroparc3D.tsx` n'importe pas `lib/rocket/jeu` statiquement.

## 12. Performance, accessibilité, risques

- **Performance** : 120 Hz de physique et 60 Hz d'affichage : jusqu'à 2 pas par image ; si la machine tombe sous 30 images/s, `PAS_MAX_PAR_IMAGE` plafonne le travail (le jeu ralentit). Qualité basse automatique (tactile, ≤ 4 cœurs). `three` chargé à la demande.
- **Accessibilité** : tout le texte d'interface en français, contrastes AA, cibles ≥ 40 px, focus visible, navigation clavier du lobby et de la pause, mouvement réduit (pas de secousse, pas de flash, pas de public animé), annonces `aria-live` des buts. Le jeu n'est pas jouable au lecteur d'écran (comme l'arène) : le lobby le dit.
- **Risques** : (1) la fidélité des constantes de flip (§ 5.5) est la moins sûre ; le ressenti sera réglé par les critères chiffrés ; (2) collage et wall ride sur une SDF : les angles de 135° (pans coupés) sont les points fragiles, d'où le rayon uniforme de 2,56 m ; (3) la balle sur le toit (dribble) ne doit pas exploser : d'où le délai de l'impulsion de Psyonix ; (4) le coût du SAT voiture-voiture à 6 voitures est négligeable ; (5) le site de 126 m sur le parking est mesuré sur `scene.json` mais les allées de parking passent dessous : visuellement sans conséquence (le sol du stade est opaque).
- **Plus tard** (hors v1) : parties en ligne via `serveur-fps` (le monde est déjà une structure de données pure), replays, autres carrosseries, messages rapides.

## 13. Table de fidélité

**[RS]** : constante, formule ET logique lues dans la source de RocketSim (fichier cité), vérifiées par un test qui porte la valeur attendue. **[~]** : approché, parce que la mécanique d'origine dépend du solveur de Bullet ou du maillage de collision, ou parce qu'elle est propre au projet. Unités : 1 m = 100 uu.

| mécanique | statut | source / ce qui reste approché |
|---|---|---|
| dimensions du stade (±4096 × ±5120 × 2048 uu), ouverture de la cage (±892,755 × 642,775 uu), ligne de but (5124,25 uu + rayon de la balle), positions, valeurs et recharges des 34 plots, 5 coups d'envoi, 4 réapparitions | [RS] | `RLConst.h`, `Arena.cpp` (`IsBallScored`) |
| forme des parois : raccords de 2,56 m, pans coupés, intérieur des cages | [~] | distance signée analytique (`arene.ts`), pas le maillage de collision de RL (absent de la source) ; profondeur de cage 8,80 m et raccords repris du wiki RLBot ; biseau des poteaux voulu par le joueur |
| gravité 650, vitesses max (voiture 2300 uu/s et 5,5 rad/s, balle 6000 uu/s et 6 rad/s), plafonds posés APRÈS l'intégration | [RS] | `RLConst.h`, `Car::_FinishPhysicsTick`, `Ball::_FinishPhysicsTick` |
| ordre d'un pas de voiture : forces cumulées puis intégrées, impulsions immédiates, pneus calculés avec les réglages du pas précédent, minuteurs en simple précision (24 pas de maintien du saut, 78 de couple de dodge, 12 de boost minimal, 360 de réapparition) | [RS] | `Car::_PreTickUpdate`, `_PostTickUpdate`, pas de Bullet |
| moteur (courbe du gaz, ÷ 4 sous trois roues), frein plein face à la marche, roue libre 15 %, arrêt franc sous 25 uu/s, gaz réel forcé par le boost | [RS] | `Car::_UpdateWheels`, `RLConst.h` |
| pneus roue par roue : impulsion latérale −0,2 × v × masse effective, adhérences selon le glissement et la pente, angles de braquage selon la vitesse, frein à main analogique (5 /s, 2 /s) | [RS] pour les formules | `btVehicleRL::calcFrictionImpulses`, courbes de `RLConst.h` ; [~] : une roue « touche » selon la distance de la SDF à son centre, pas selon un rayon lancé sous son point d'attache |
| suspension (ressorts, amortisseurs, débattement) | [~] non repris | l'architecture est sans suspension : impulsion non élastique au point de chaque roue qui s'enfonce |
| collage à la surface, alignement (auto-roll), redressement sur le toit (auto-flip) | [RS] | `Car::_UpdateWheels` (sticky), `_UpdateAutoRoll`, `_UpdateAutoFlip` ; le déclencheur du redressement lit le contact de la caisse, résolu par points [~] |
| saut (875/3 uu/s, 4375/3 uu/s², 0,025 à 0,2 s, garde de 0,05 s), fenêtre de 1,25 s depuis la fin du saut, double saut | [RS] | `Car::_UpdateJump`, `_UpdateDoubleJumpOrFlip` |
| flip : impulsion 500 uu/s et échelles 1 / 1,9 / 2,5 × 16/15, couple 260 / 224 rad/s² pendant 0,65 s, annulation qui ne coupe que le tangage (speed flip), stall, amortissement vertical 0,35 entre 0,15 et 0,65 s, verrou de tangage 0,95 s | [RS] | `Car::_UpdateAirTorque`, `_UpdateDoubleJumpOrFlip` |
| contrôle aérien : couples 130 / 95 / 400 et amortissements 30 / 20 / 50 × `CAR_TORQUE_SCALE`, roulis toujours amorti, interdit dès qu'une roue touche, gaz en l'air 200/3 uu/s² | [RS] | `Car::_UpdateAirTorque` |
| boost : 2975/3 uu/s² au sol, 3175/3 en l'air, 100/3 par seconde, 12 pas au moins, 33,33 au départ | [RS] | `Car::_UpdateBoost` |
| supersonique : 2200 uu/s, maintien à 2100 pendant 1 s au plus | [RS] | `Car::_PostTickUpdate` |
| hitbox de l'Octane (120,507 × 86,6994 × 38,6591 uu, décalage 13,8757 ; 0 ; 20,755), roues, portées 11,0 / 11,8 uu, inertie de boîte pleine | [RS] | `CarConfig.cpp` |
| caisse ↔ décor : restitution 0,3, frottement 0,3, pas de rebond sous 10 uu/s | [RS] pour les constantes | `RLConst.h` ; [~] : contact par 14 points d'échantillonnage (coins et centres de face), correction de position |
| balle : rayon 91,25, masse 30, traînée 3 %/s, aucun amortissement angulaire ni frottement de roulement, restitution 0,6, frottement 0,35, seuil de rebond 10 uu/s, marge de contact 1,905 uu (repos à 93,15), sommeil à vitesse nulle, plafonds après tous les contacts | [RS] | `Ball.cpp`, `Arena.cpp`, `RLConst.h` ; [~] : un seul contact par pas contre la SDF, garde-fou qui ressort une balle enfoncée par une voiture |
| voiture ↔ balle : restitution 0, frottement 2, impulsion de Psyonix (depuis l'ORIGINE de la voiture, échelles 0,35 / 0,65, courbe, plafond 4600 uu/s, un pas sauté entre deux ; calculée sur la balle d'AVANT les contacts du pas et mise en attente jusqu'à la fin du pas, `EtatBalle.vitesseEnAttente` : à deux voitures sur la balle au même pas, elle ne dépend pas de l'ordre des voitures), contact dès 1,905 uu, arrondi de 2 uu | [RS] pour les constantes et la logique | `Ball::_OnHit`, `Ball::_velocityImpulseCache`, `Ball::_FinishPhysicsTick`, `RLConst.h` ; [~] : détection boîte / sphère et résolution séquentielle maison au lieu du solveur de Bullet (le choc PHYSIQUE, lui, reste résolu voiture après voiture) |
| flip reset : trois roues dont le rayon de suspension touche la balle valent un retour au sol ; ces roues comptent aussi pour le moteur (÷ 4 sous trois roues) et l'auto-roll (1 à 3 roues), et la normale de la balle sous chacune entre dans la direction des contacts (collage, auto-roll) | [RS] pour la règle | `btVehicleRL` (rayons contre la balle, `getUpwardsDirFromWheelContacts`), `Car.cpp` (`numWheelsInContact`) ; [~] : ces roues ne donnent pas de force de pneu, et le collage attend une roue sur le décor (comme RocketSim : `m_isInContactWithWorld`) |
| voiture ↔ voiture : restitution 0,1, frottement 0,09 | [RS] pour les constantes | `RLConst.h` ; [~] : SAT maison (15 axes) |
| bump (courbes sol / air / vers le haut, pare-chocs à plus de 64,5 uu, délai de 0,25 s = 30 pas par attaquant et par victime) et démolition (supersonique, mêmes gardes, 3 s) ; conditions lues sur les vitesses d'AVANT les contacts du pas, vitesse du bump en attente jusqu'à la fin du pas (`EtatVoiture.vitesseEnAttente`), puis plafond de 23 m/s une fois : à trois voitures au même pas, un bump ne passe pas d'une paire à l'autre | [RS] | `Arena::_BtCallback_OnCarCarCollision`, `Car::_velocityImpulseCache`, `Car::_FinishPhysicsTick`, `RLConst.h` |
| plots : origine de la voiture dans le cylindre (144 / 208 uu, ± 95 uu), verrou par boîte englobante, recharge en simple précision (480 / 1201 pas) | [RS] | `BoostPad.cpp` |
| réapparition : 4 places tirées au hasard, lâchée de 36 uu, 33,33 de boost, 360 pas | [RS] | `Car::Respawn`, `RLConst.h` |
| coup d'envoi : 5 places mélangées, la même pour les deux équipes, balle endormie à 93,15 uu | [RS] | `Arena::ResetToRandomKickoff` |
| buteur (dernière touche de l'équipe, 4 s), passeur (2 s), tir cadré (1750 uu/s, jugé 0,3 s après la touche), arrêt | [RS] | `GameEventTracker.cpp`, `Arena::IsBallProbablyGoingIn` |
| minuteur, prolongation en but en or, attente de la balle au sol, célébration, rejeu du but, barème de points | [~] | règles de Rocket League écrites pour le projet (RocketSim n'a pas de match) |
| bots | original | réglés sur la physique ci-dessus, cf. § 7 et § 15 |
| caméra (paramètres par défaut, ball cam rigide à horizon droit) | [RL] pour les paramètres et le principe, [~] pour les bornes de visée | |

## 14. Documentation à tenir à jour

À la fin, l'intégration ajoute une entrée « Rocket Muche » à `CLAUDE.md` (architecture, tests, e2e, pièges) et à la liste des commandes (`npx vitest run lib/rocket`, `node scripts/rocket/e2e_rocket.mjs`). Les agents n'éditent pas `CLAUDE.md`.

## 15. Écarts constatés à l'intégration

- **Stade** : cage et plancher, cf. § 3.2. `Arene.normale` est un gradient analytique (pas de différences centrées) ; `surfaceProche().distance` est NON signée ; `|∇sd|` descend vers 0,7 à moins de 15 cm des poteaux et de la barre (union douce).
- **Balle**, **Voiture**, **Match** : les écarts notés ici à la première intégration (demi-gravité de collage au plafond, frottement μ = 0,35 de la caisse, une seule démolition retenue, délai de bump par voiture, tir cadré jusqu'à 45 m, arrêt à 12 m) n'existent plus : ils sont remplacés par l'alignement sur RocketSim ci-dessous.
- **Retours du joueur (2026-11-11)** : (1) ball cam refaite (`camera.ts`) : suivi rigide de la droite voiture → balle (cap et élévation suivis à part, cap borné à 10 rad/s quand la balle passe au-dessus du toit), horizon toujours droit (haut du monde, même sur un mur), visée qui monte jusqu'à 78° pour une balle haute (`elevationViseeBalle` : la balle passe avant la voiture), plus de bascule quand la balle touche la voiture, secousses réduites ; (2) cages lisses : le raccord arrondi sol / mur du fond formait un aileron de 2,56 m dans le terrain de chaque côté de la cage ; il s'efface maintenant en biseau sur `BUT.longueurBiseau` = 6 m (`arene.ts` § 3 bis, même plan dans `biseauterCoque` du rendu), le mur tombe droit au poteau ; (3) saut et flip alignés sur RocketSim (table du § 13) : le speed flip existe (flip diagonal, annulation au manche, roulis Q / E) ; (4) rejeu du but (`rejeu-but.ts`) : la célébration passe de 4,5 à 1,25 s de jeu (2,5 s réelles au ralenti), puis le but est rejoué de derrière le buteur en ball cam (4,5 s avant, 0,9 s après au ralenti, Espace ou A pour passer), physique figée, avant le coup d'envoi ; (5) sons : saut et double saut identiques (le double saut ne monte plus dans l'aigu), flip en whoosh de bruit, moteur grave (46 à 132 Hz, sous-octave en triangle) au lieu des dents de scie à 260 Hz.
- **Alignement sur la source de RocketSim (2026-11-12)**, trois lots (voiture ; balle et contacts ; stade et match) puis intégration. Ce qui suit REMPLACE le détail des §§ 3 à 6 là où ils divergent (table du § 13 pour la liste complète, commentaires de `contrat.ts` pour chaque constante) :
  - **§ 3 (stade)** : plafond à 20,48 m, cage de ±8,92755 m. Le reste de la géométrie est inchangé ; le rendu lit `STADE` et `BUT`, rien n'y est écrit en dur.
  - **§ 4 (balle)** : un pas sans sous-pas dans l'ordre de Bullet (traînée, contact détecté sur la position du début du pas à moins de rayon + 1,905 cm, gravité, réponse en vitesse seulement, intégration, plafonds) ; plus d'amortissement angulaire ni de frottement de roulement (une balle qui roule ne ralentit que par la traînée) ; seuil de rebond 0,1 m/s ; une balle sans vitesse ni spin dort (elle ne tombe pas : poser une balle en l'air sans vitesse dans un test ou par `window.__rocket.balle` la laisse suspendue jusqu'à ce qu'on la touche) ; plafonds de 60 m/s et 6 rad/s posés une fois, après les contacts avec les voitures. [~] ajouté : la balle enfoncée par une voiture au-delà de ce que sa vitesse explique est ressortie (RocketSim résout les deux contacts ensemble).
  - **§ 5 (voiture)** : hitbox et roues de `CarConfig.cpp` ; virage, dérapage et adhérence viennent du modèle de pneu roue par roue (plus de lacet cinématique : `CONDUITE.courbeCourbure`, remesurée, ne sert plus qu'aux bots) ; frein à main analogique ; collage dès une roue en contact, sans palier : arrêtée sur un mur la voiture glisse, **au plafond elle tombe** (comme dans RL) ; saut seulement avec trois roues, double saut ou dodge avec une ou deux ; contrôle aérien coupé dès qu'une roue touche ; redressement = 2 m/s vers la surface puis 50 rad/s² autour de l'avant pendant 0,4 s × |roulis| / π ; alignement = auto-roll de RocketSim ; plafond de 23 m/s sans condition en fin de pas ; supersonique tenu à 21 m/s une seconde au plus. Flip avant mesuré : 269° après les 78 pas de couple, 330° à 0,95 s (attendus d'après la logique de RocketSim : 268° / 329°).
  - **§ 5.9, 5.10 (contacts)** : impulsion de Psyonix depuis l'origine de la voiture, un pas sur deux en contact continu (une balle posée en avant de l'origine dérive : le dribble demande d'équilibrer) ; contact voiture ↔ balle dès 1,905 cm ; voiture ↔ voiture à frottement 0,09 ; bump et démolition décidés ensemble, par attaquant (approche sur les origines, pare-chocs, délai de 30 pas par couple), un bump de l'un peut coexister avec une démolition par l'autre ; flip reset par les rayons de suspension, compté comme un retour au sol ; impulsion de Psyonix et vitesse des bumps mises en attente jusqu'à la fin du pas et calculées sur l'état d'avant les contacts (comme les rappels de contact de RocketSim, qui passent avant le solveur) : leur issue ne dépend plus de l'ordre des voitures dans la liste ; les roues posées sur la balle comptent dans le nombre de roues en contact partout où RocketSim lit `numWheelsInContact` (moteur, auto-roll).
  - **§ 6 (match)** : plots pris par l'ORIGINE de la voiture avec verrou par boîte englobante ; réapparition sur 4 places propres (au hasard, lâchée de 36 cm) et non sur une place de coup d'envoi ; buteur = dernière touche de l'équipe dans les 4 s, passe dans les 2 s ; un tir n'est compté qu'au-dessus de 17,5 m/s (63 km/h) s'il file toujours au but 0,3 s après la touche, et il n'y a d'arrêt que sur un tir compté.
  - **Ce qui ne se transpose pas** (reste [~]) : la suspension (ressorts, amortisseurs), le solveur de contacts de Bullet (caisse ↔ décor par points, boîte ↔ sphère et SAT maison, un contact balle ↔ décor par pas), le maillage du stade (distance signée analytique, cages et biseau du projet), la portée des roues (distance de la SDF au centre de la roue, pas un rayon sous le point d'attache).
  - **Test du biseau recalé** (`arene.test.ts`) : avec la hitbox de RocketSim (1,25 cm plus large et plus basse), le coin avant bas de la caisse effleure le biseau (pente de 23° le long du mur, 45° vers lui) à 0,29 × la vitesse, soit 3,1 m/s à 11,6 m/s : juste au-dessus du seuil de l'événement « choc » (3 m/s), que l'ancienne hitbox frôlait par en dessous. L'ancien `choc = 0` devient « jamais plus que ce frôlement géométrique » (un obstacle frontal donnerait ≈ la vitesse entière) ; le reste est durci : la voiture ne descend pas sous 10 m/s (6 avant) et finit sur ses roues. Ni la physique ni la forme du biseau n'ont été touchées.
- **Bots réglés sur cette physique (2026-11-12)**. Mesures : une frappe au sol sans flip lance une balle au repos à ≈ 1,35 × la vitesse de la voiture, 16° d'élévation (au-dessus de la barre à pleine vitesse au-delà de 30 m) ; un flip de frappe tire à plat, 25 à 32 m/s ; un flip avant sans boost fait passer de 14,1 à ≈ 19 m/s et la vitesse se garde. Changements (`bots.ts`, aucun changement de physique ni de `PROFILS_BOT`) :
  - Débutant (sans `rotation`) : plus aucun sens du placement, il fonce sur la balle et la frappe dans le sens où il arrive ; son bruit de visée est corrélé dans le temps (0,7 s) au lieu d'un bruit blanc qui se moyennait ; il ne force plus le boost au coup d'envoi. Avant, il plaçait ses frappes aussi bien qu'un All-Star et gagnait une partie sur deux contre lui.
  - Pro et All-Star : approche sur la LIGNE de frappe (point visé en avant de sa projection, à travers la balle une fois dans l'axe) ; plus de contact visé au-delà du moment où un adversaire peut toucher la balle ; près de leur cage, frappe de côté si elle est sûre, sinon repli devant la cage, et barrage de la trajectoire d'une balle qui entre ; jamais de flip dans une direction dangereuse ; frein quand la cible est à l'intérieur du cercle de virage (ils tournaient autour) ; plots pris sur la route ; **flip de vitesse** sans boost ; démolition (All-Star) tentée seulement lancé, sur un adversaire droit devant, balle hors de son camp.
  - Résultats 1v1 de 3 min : All-Star contre Débutant 16 victoires, 1 nul, 3 défaites sur les graines 1 à 20 du test (seuil : 16), 100 victoires, 6 nuls, 14 défaites sur les graines 1 à 120 (83 %) ; avant ces réglages 6 sur 20 avec la nouvelle physique, 10 sur 20 avec l'ancienne (le critère du § 7 n'était déjà pas tenu). All-Star contre Pro 21 – 4 – 15, Pro contre Débutant 27 – 4 – 9 (40 graines). Le critère est tenu de peu : le seuil du test n'a pas été changé.
  - Toujours pas de demi-flip ni de speed flip des bots ; le flip précoce du coup d'envoi reste désactivé (`BOTS.activeFlipEnvoi`, remesuré : il fait arriver plus tard) ; un coup d'envoi en diagonale part toujours vers le coin.
- **Rendu** : pas de flash plein écran (pulsation des murs et du fond des cages, supprimée en mouvement réduit) ; lignes de 15 cm ; tableau d'affichage sur pieds au-dessus du Truck Muche.
- **Intégration** : e2e `scripts/rocket/e2e_rocket.mjs` vert (9 étapes), captures dans `docs/medias/rocket/`. Après l'alignement sur RocketSim (2026-11-12) : `npx vitest run lib/rocket` 522 tests verts, campagne `ROCKET_LONG=1` 6 sur 6, e2e 10 étapes vertes sur un `next dev` déjà chaud (`E2E_URL`) ; à froid, l'étape 1 dépasse le délai du clic sur « Lancer » tant que le voile de chargement de la vue aérienne le recouvre (piège déjà connu).
