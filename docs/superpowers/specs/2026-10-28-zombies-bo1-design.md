# Mode zombies v7 « Service de midi » : équilibrage Black Ops 1, carte intérieure, atouts, Pack-a-Punch, lore — design

Date : 2026-10-28 · Protocole : `VERSION_PROTOCOLE = 7` · Prime sur `2026-10-27-arene-zombies-design.md` là où elles divergent.

## Demande

Rejouer le mode zombies avec le sentiment de difficulté et de progression de Call of Duty Black Ops 1 Zombies : en 10 minutes on atteignait
la manche 10 avec beaucoup d'argent et des armes devenues inefficaces, face à des tigres plus rapides que le joueur. On veut les règles de BO1
(vagues, santé, vitesses, points, prix), des atouts, le Pack-a-Punch, des bonus portés par certains tigres, une boîte mystère qui déménage,
des armes dessinées à la craie sur les murs, des barricades à planches, des manches spéciales (le Truck Muche à la place des chiens), des
difficultés, une carte plus profonde où l'on démarre À L'INTÉRIEUR d'un bâtiment d'Agroparc (un seul niveau), et un lore qui donne envie
d'ouvrir les portes. Une seule PR.

## Sources

- Scripts du jeu (`maps/_zombiemode*.gsc`, premier commit de `Jbleezy/BO1-Reimagined`, identiques à ceux du jeu) : nombre de zombies
  (`round_spawning`, `default_max_zombie_func`), santé (`ai_calculate_health`), délai d'apparition, vitesses (`set_run_speed`,
  `zombie_move_speed_multiplier = 8`, dernier zombie qui sprinte `zombie_speed_up`), points (`zombie_score_*`), barricades
  (`rebuild_barrier_cap_per_round`), bonus (`powerup_drop`, `zombie_powerup_drop_increment = 2000 × 1,14`, 4 par manche, 2 % au hasard),
  atouts (`_zombiemode_perks.gsc` : prix), boîte (`treasure_chest` : 950, règles du nounours), chiens (`_zombiemode_ai_dogs.gsc` :
  manche 5 à 7 puis tous les 4 à 6, 6 puis 8 par joueur, PV 400 / 900 / 1 300 / 1 600).
- `AllanLotta/bo1-zombies-coop` et `MisaDev4/bo1-zombies-decompiled` ne contiennent que le réseau et le moteur, aucune règle de jeu.
- Aucun fichier d'Activision (modèle, animation, son) n'est repris : tout est refait en code (three.js, WebAudio, synthèse vocale du navigateur).

## Équilibrage (`zombies-vagues.ts`, PUR)

Manche `n` ≥ 1, joueurs admis `j` ≥ 1.

- **Total de la manche** (BO1 exact) : `max = 24 ; m = max(1, n/5) ; si n ≥ 10 : m ×= 0,15 n ; max += j = 1 ? int(3 m) : int(6 (j − 1) m)`,
  puis × 0,25 / 0,3 / 0,5 / 0,7 / 0,9 aux manches 1 à 5 (`int`). Solo : 6, 8, 13, 18, 24, 27, 28, 28, 29, 33 ; 2 joueurs : 7, 9, 15, 21, 27…
- **PV** : 150, +100 par manche jusqu'à la 9 (950), puis `pv += int(pv × 0,1)` à partir de la 10 (1 045, 1 149…, 2 710 à la 20), plafond 1 000 000.
- **Délai d'apparition** : `2 × 0,95^(n−1)` s, plancher 0,08 s ; **24 tigres vivants au plus** (BO1).
- **Allure** de chaque tigre : `v = n = 1 ? 1 : 8 (n − 1)`, tirage entier dans `[v, v + 35[`, ≤ 35 marche, ≤ 70 course, sinon sprint.
  À partir de la manche 4, quand il reste ≤ 3 tigres vivants et plus aucun à faire apparaître, le dernier tigre passe au sprint.
  Vitesses (m/s, ± 6 % par tigre) : **marche 3,0, course 6,2, sprint 8,4**, toujours sous la marche du joueur (9) : on « traîne » les tigres
  en marchant, le sprint (12,5) sert à se dégager. Rampant : 1,4.
- **Griffe** : 50 dégâts (deux coups couchent un joueur à 100 PV, cinq avec le Gratin à 250), armée 0,4 s, recharge 1 s.
- **Régénération** (salle zombies) : 3 s sans dégât puis 60 PV/s (BO1 : la santé remonte vite).
- **Difficulté** choisie par l'hôte au lobby : `entree` (PV × 0,7, allure −10, griffe 40), `plat` (BO1, défaut), `goulaf` (PV × 1,3, allure
  +10, griffe 60).
- **Types** (2 bits du snap) : 0 tigre, 1 **tigre doré** (porte un bonus : à partir de la manche 2, un par manche avec la probabilité
  `min(0,75 ; 0,35 + 0,05 n)`, apparaît au milieu de la manche, PV × 1,5, lâche TOUJOURS un bonus, hors plafond de 4), 2 **tigre chef** (toque,
  à partir de la manche 10, `floor((n − 6) / 4)` par manche, PV × 4, jamais plus vite que la course, griffe 80, +250 $ au tueur),
  3 **petit** (manches du Truck Muche).

## Points (BO1)

- Touche non mortelle : +10 (une fois par tir). Kill : 50 + bonus : corps +10 (60), tête +50 (100), mêlée +80 (130). Plus de bonus de fin de manche
  ni de coefficient. Double points : × 2 (touches et kills).
- Planche reposée : +10, plafond par joueur et par manche `min(500, 50 n)`.
- Nuke : +400 à chaque joueur (les tigres soufflés ne rapportent rien). Menuisier : +200 à chaque joueur.
- Argent de départ 500 $.

## Bonus (power-ups)

- **Seuil** : `seuil = j × 500 + incrément` (incrément 2 000) ; quand le total GAGNÉ de tous les joueurs le dépasse, le prochain kill lâche un bonus,
  l'incrément est multiplié par 1,14 et `seuil = total + incrément`. 2 % des kills lâchent aussi un bonus. 4 bonus par manche au plus (le tigre
  doré passe outre).
- **Tirage** : paquet mélangé (comme `randomize_powerups`) des six bonus, rebattu une fois épuisé.
  `munitions` (Munitions max : chargeurs, réserves et spéciale pleins), `instakill` (30 s : tout coup tue, sauf le Truck), `double` (30 s),
  `nuke` (tous les tigres vivants meurent, +400), `menuisier` (toutes les planches reposées, +200), `soldes` (Happy hour : boîte à 10 $ 30 s).
- Au sol 15 s, puis clignote 11 s, puis disparaît. Ramassé par le premier joueur debout à ≤ 1,6 m. Annonce vocale (synthèse du navigateur).

## Atouts (distributeurs, besoin du courant sauf la Pause Café)

| id | nom | BO1 | prix | effet |
| --- | --- | --- | --- | --- |
| `gratin` | Gratin Dauphinois | Juggernog | 2 500 $ | PV max 250 |
| `expresso` | Expresso Serré | Speed Cola | 3 000 $ | recharge × 0,5 |
| `ristretto` | Double Ristretto | Double Tap | 2 000 $ | cadence × 1,33 |
| `pausecafe` | Pause Café | Quick Revive | 1 500 $ (500 $ seul) | relève en 1,5 s au lieu de 3 ; seul : se relève tout seul 4 s après être tombé, 3 fois par partie |

Un joueur à terre perd tous ses atouts. Pas de limite (il y en a quatre).

## Pack-a-Punch « Micro-ondes Gratinator » (Labo, besoin du courant)

5 000 $, l'arme en main (pas une arme blanche) : 3,5 s de cuisson visible dans la machine (une seule à la fois) puis l'arme est améliorée
(`Equipement.ameliorees`), chargeur et réserve pleins. Dégâts zombies et chargeur selon la table des armes ; nom de plat (« Pistolet gratiné »…) ;
camouflage animé. Munitions au mur d'une arme améliorée : 2 500 $.

## Armes (dégâts sur les tigres, `STATS[a].zombie`)

| arme | dégâts (tête ×) | amélioré | chargeur → amélioré | mur |
| --- | --- | --- | --- | --- |
| pistolet | 40 (×2) | Pistolet gratiné : 160 + explosion 400 sur 2,5 m | 12 → 16 | — (départ) |
| revolver | 240 (×2,5) | Revolver flambé : 560 | 6 → 8 | 500 $ |
| pompe | 70 / plomb (×1,5) | Pompe royale : 140 / plomb | 6 → 10 | 500 $ |
| mini_uzi | 55 (×2) | Mini Uzi à la plancha : 110 | 25 → 40 | 1 000 $ |
| mitraillette | 95 (×2) | Mitraillette grand-mère : 190 | 32 → 50 | 1 200 $ |
| fusil_assaut | 110 (×2) | Fusil bourguignon : 190 | 30 → 45 | 1 200 $ |
| sniper | 900 (×3) | Sniper en croûte : 2 200, perce | 5 → 8 | 1 500 $ |
| mitrailleuse | 130 (×2) | Mitrailleuse tartiflette : 200 | 60 → 100 | boîte |
| **rayon** (nouveau, secondaire, zombies seulement) | 1 000 + explosion 1 500 sur 1,6 m | Rayon Goulaf : 1 800 + 2 800, 40 coups | 20 → 40 | boîte, quête |
| railgun | 3 000, perce tous les tigres | Railgun thermidor : 6 000 | spéciale | boîte |
| minigun | 70 | Minigun carbonara : 130, 250 coups | spéciale | boîte |
| magnum doré | 800 (×3) | Magnum à l'or fin : 1 600 | spéciale | boîte |
| couteau | 150 | — | — | départ |
| épée | 1 000 | — | — | 3 000 $ (Cour Est) |

Réserve : 5 chargeurs (amélioré : 8). Spéciales : munitions totales, remplies par Munitions max. Le pistolet et le mini Uzi ne sortent pas de la boîte.

## Boîte mystère

950 $ (10 $ en Happy hour). Cinq emplacements (`B1`…`B5`), départ au hasard entre `B1` (Salle de pause) et `B2` (Cour Centre). Achat : tirage
4 s (les armes défilent au-dessus), puis l'arme flotte 12 s : le même joueur la prend avec E (elle remplace l'arme de sa catégorie), sinon elle est perdue.
Tirage uniforme parmi les armes non possédées de la boîte. **Peluche de tigre** (nounours) : jamais avant 4 utilisations ; de 4 à 7 : 15 % ;
8ᵉ forcée si la boîte n'a jamais bougé ; après un déménagement : 30 % de 8 à 12, 50 % au-delà. La peluche rembourse 950 $, la boîte s'envole (4 s) et
réapparaît à un autre emplacement, compteur remis à 0.

## Coup de patte : on le voit venir, on l'esquive

Comme les attaques des zombies de BO1, le coup de patte d'un tigre est **lisible et esquivable** : il ne touche qu'au contact de la patte.

- **Départ** : le tigre lance son coup quand le joueur debout le plus proche est à portée de patte (`porteePatte(échelle)` moins 0,25 m) et en
  vue. Le drapeau « griffe armée » du snap passe à 1, et le client joue le geste `griffe` et le son `griffe`.
- **Armement (0,55 s, `ZOMBIES.griffeArmeS`)** : le tigre se cabre, avant relevé, tête en arrière, oreilles plaquées, et lève la patte avant
  droite ; on entend un feulement grave. Il ne marche plus et ne suit sa cible qu'à 0,6 rad/s (`griffeRotationMax`, ≈ 19° sur l'armement).
- **Contact (à 0,55 s)** : la patte claque, épaule plongée, corps jeté en avant, avec un « clac » au même instant. Le serveur ne teste la touche
  QU'À CET INSTANT : le joueur visé doit être sur le balayage de la patte, c'est-à-dire le segment de l'axe du tigre de 0,18 à 0,5 × échelle
  depuis son centre (+ 1 m à la fenêtre, la patte passe entre les planches), à moins de 0,4 m + 0,06 × échelle, et en vue (`touchePatte`, PUR).
  Un pas en arrière d'environ 1 m ou un pas de côté d'environ 1,3 m pendant l'armement : la patte frappe dans le vide.
- **Recharge** : 1 s après le contact (0,8 s pour la morsure du petit du Truck), puis le tigre recommence.
- **Synchronisation** : `CONTACT_GRIFFE` du geste (`lib/tigre3d/gestes/griffe.ts`) vaut `ZOMBIES.griffeArmeS` (vérifié par
  `zombies-anim.test.ts`). Le client affiche les tigres avec `JEU.interpolationMs` de retard : il démarre donc le geste d'autant plus loin, pour
  que la patte claque à l'écran quand le serveur touche.
- Le chef (échelle 3,4) frappe plus loin, le petit (1,5) plus court. Les dégâts suivent la difficulté et le type (cf. « Équilibrage »).

## Barricades à planches

Chaque fenêtre a 6 planches. Un tigre qui arrive à une fenêtre arrache une planche toutes les 1,4 s (course 1,1 s, sprint 0,9 s) et peut griffer à
travers ; à 0 planche il saute (1 s, clip « Attack jump »). Un joueur debout à ≤ 2,2 m du côté intérieur qui maintient E repose une planche par seconde
(+10 $ dans le plafond). Les fenêtres laissent passer balles et regards, bloquent toujours les joueurs ; les tigres en chasse ne les retraversent pas
(grille de navigation où elles sont des murs), les petits les franchissent d'un bond sans arracher.

## Manches du Truck Muche (à la place des chiens)

Première à la manche 5, 6 ou 7 (tirage), puis tous les 4 à 6. Pas de tigres normaux : `6 j` petits (8 j à partir de la troisième), PV 400 / 900 / 1 300 / 1 600,
sprint 10 m/s, morsure 30 (0,8 s), 8 vivants au plus. Le Truck Muche arrive (klaxon, 4 s) au quai le plus proche des joueurs (quatre quais, hors des zones
jouables, devant des fenêtres), ouvre l'arrière et lâche les petits deux par deux ; on peut le cribler (2 500 PV × numéro de la manche du Truck) : il explose
(souffle de 6 m, +500 $ à chacun). Le dernier petit lâche des Munitions max. Ambiance : lumière orangée, annonce « Livraison ! ».

## Carte « Service de midi » (un seul niveau)

Repère de `scene.json`. On démarre DANS le bâtiment 72. Quatre bâtiments sont **creusés** (`Building.type = "creux"` : leur prisme a `h = hOrigine = 0`,
ni collision ni rayon ; le décor ne les dessine pas) : leurs murs deviennent des pièces `coque` (épaisseur 0,4 m, côté intérieur de l'ancienne façade, ouvertures
pour portes et fenêtres) et l'intérieur des `cloison`. Rendu par `rendu-interieurs.ts` (façade extérieure, doublage, sol, plafond, mobilier, éclairage de secours
rouge puis chaud au courant). Pas de wall-run, de double saut ni de saut de mur en zombies (`Monde.sansParkour`).

Zones (graphe des portes) :

| zone | nom | lieu | contenu |
| --- | --- | --- | --- |
| `open` | Open space du Pôle R&D | 72 ouest | DÉPART, fenêtres F1 F2, mur revolver 500 / pompe 500, note 1 |
| `pause` | Salle de pause | 72 est | fenêtres F3 F4, Pause Café, mur mini Uzi, boîte B1, note 2 |
| `cour` | Cour Centre | extérieur | barricade N2c, sorties du sol, mur mitraillette, boîte B2, note 3 |
| `i2` | Passage Est | entre 72 et 73 | barricade S2 |
| `cuisine` | Cuisine du Bistrot Trèfle | 70 | Expresso, mur fusil d'assaut, four (quête), sel, note 4 |
| `est` | Cour Est | extérieur | barricades N4 et E, sorties du sol, Double Ristretto, mur épée, boîte B3, note 5 |
| `local` | Local technique | 62 | fenêtre F5, **disjoncteur**, note 6 |
| `i1` | Passage Ouest | entre 72 et 74 | barricade S1 |
| `ouest` | Cour Ouest | extérieur | barricade W, sorties du sol, Gratin, mur sniper, boîte B4, herbes, note 7 |
| `labo` | Labo R&D | 74 | fenêtres F6 F7, **Micro-ondes Gratinator**, boîte B5, truffe (au courant), note 8 |

Portes : `D1` open→pause 750, `D2` open→cour 1 000, `D3` pause→i2 1 250, `G3` cour→i2 750, `D4` cour→cuisine 1 000, `D7` cuisine→est 1 000, `G4` i2→est 1 250,
`G2` cour→i1 1 000, `G1` i1→ouest 1 250, `D8` est→local 1 500, `D9` ouest→labo 1 500 (≈ 13 000 $ au total). Une porte s'achète depuis l'une ou l'autre de ses zones.

Apparitions (règle du gestionnaire de zones de BO1) : seules les fenêtres et sorties du sol des zones **ouvertes et occupées par un joueur debout ou voisines
(porte ouverte) d'une zone occupée** sont actives ; une sortie du sol est tirée entre 8 et 35 m du joueur le plus proche.

## Lore « Opération Plat du Jour » et objectifs

Agroparc, 11 h 58. Le Pôle R&D voulait le plat du jour parfait (note Goulaf 10/10) et l'a fait goûter aux tigres du thème Tigre. Huit notes (mails internes,
post-it, rapports) à lire avec E racontent l'histoire. Le panneau d'objectifs guide : sortir de l'open space → rétablir le courant (Local technique) → allumer
le Micro-ondes (Labo) → la Recette ultime. **Quête** : trois ingrédients (sel en Cuisine, herbes en Cour Ouest, truffe dans le congélateur du Labo, visible au
courant), ramassés pour l'équipe, puis E au four de la Cuisine (courant requis) : 30 s de cuisson pendant lesquelles les tigres apparaissent deux fois plus vite,
puis chaque joueur debout reçoit le Rayon Goulaf et un atout manquant. Une fois par partie.

## Protocole v7 (`protocole.ts`)

- `Equipement.ameliorees?: ArmeFeuId[]` (armes au Pack-a-Punch), copié par `copierEquipement` seulement s'il est non vide. `equipement.ravitaille?: ArmeFeuId | "tout"`.
- `lancerPartie{difficulte?}`, `acheter{id}` (ids : `mur:<arme>`, `boite` (acheter ou prendre), `atout:<id>`, `pap`, `courant`, `ingredient:<id>`, `four`, portes),
  `reparer{fenetre: string | null}` (maintenir E).
- `zombies{etat}` : en plus de v6, `difficulte`, `courant`, `boite`, `pap`, `fenetres` (planches par fenêtre), `bonus` (au sol), `effets` (fins d'insta-kill, double, soldes),
  `quete`, `truck`, `murs` (armes déjà achetées : le modèle remplace la craie), `objectif`, et par joueur `atouts`, `autoReleves`.
- `zevt{e}` : effets ponctuels (planche arrachée / reposée, bonus ramassé, nuke, courant, peluche, atout bu, Pack-a-Punch prêt, klaxon, explosion, cuisson).
- `snap.zombies` : drapeaux du tigre = type (bits 0–1), griffe (2), apparition (3), allure (4–5 : marche, course, sprint, rampant), mode (6–7 : chasse, sol, fenêtre, saut) ;
  `t?` = Truck `[xCm, zCm, capMrad, phase, pvPct]`.
- Le serveur déployé doit être reconstruit avec le client v7.

## Animations (procédurales, `zombies-anim.ts`, `lib/tigre3d/gestes/`)

Sortie du sol (le corps monte de −1,6 m en griffant la terre, mottes), arrachage de planche (dressé, coups de patte, la planche part en tournoyant), saut de fenêtre
(clip « Attack jump »), recul à l'impact (tête à la tête, épaule au corps), trois morts (effondrement de côté, chute en avant à la tête, projection par une explosion)
puis le corps s'enfonce, rampant (arrière-train traîné), tigre doré (lueur et paillettes), tigre chef (toque), petits (échelle réduite, bond d'attaque).

## Rendu et sons

Intérieurs, boîte (caisse en bois, points d'interrogation lumineux, faisceau, défilement d'armes, peluche), distributeurs (façade peinte en canvas, lueur au courant),
Micro-ondes, disjoncteur, dessins à la craie (silhouette de l'arme et prix en canvas, bruit de craie), planches, bonus flottants verts, Truck Muche (modèle de `rendu-monde.ts`),
ingrédients, notes. Sons WebAudio : accords de début et de fin de manche, jingles d'atouts, boîte à musique, rire de la peluche, planches, marteau, klaxon, explosion.
HUD : points en bas à droite avec gains flottants, manche à la craie (bâtons jusqu'à 5, puis chiffres), icônes d'atouts, bonus actifs avec minuteur, objectif, lecture de note,
texte d'intro, bandeau du Truck.
