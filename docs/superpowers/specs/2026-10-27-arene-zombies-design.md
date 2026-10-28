# Mode zombies (tigres), épée, bâtiments détaillés — design

> **Refondu par `2026-10-28-zombies-bo1-design.md` (v7, zombies façon Black Ops 1 : carte « Service de midi », équilibrage, atouts, Pack-a-Punch,
> boîte, planches, bonus, manches du Truck Muche, lore).** Ce document reste la référence pour les salles, le lobby et le protocole de base ;
> la v7 prime là où ils divergent (carte « Cour des Restos », portes P1–P5, soin, bonus de fin de manche et courbes de manche ne sont plus en jeu).

Date : 2026-10-27 · Branche : `feat/arene-zombies` · Protocole : `VERSION_PROTOCOLE = 5` (rebasé sur la v4 des événements ; un client en cache reçoit `erreur{version}`)

## Demande

1. **Mode zombies** façon Call of Duty Zombies, mais ce sont des **tigres** qui avancent sur les joueurs : on démarre dans une zone assez refermée, on survit à
   des vagues de plus en plus dures, l'argent rentre (touches, kills), on achète des armes au mur et on débloque d'autres parties de la carte (portes payantes).
2. **Choix du mode à l'entrée de la vue Palantir** : « Arène » (inchangée) ou « Zombies tigres ». On choisit, on attend dans un lobby que les autres arrivent, on lance.
3. **Épée** : arme de mêlée à la place du couteau (slot 3) dans l'arène ET dans les zombies.
4. **Bâtiments plus détaillés** (fenêtres, étages, toits, portes) pour que ça se ressente sur la carte.

## Décisions de conception

- **Deux salles, un seul serveur, une seule WebSocket.** `serveur-fps/src/index.ts` instancie deux `Salle` : `salleArene` (inchangée) et `salleZombies`
  (option `zombies`, son propre `Monde` MUTABLE issu de `donneesZombies(scene)`). Chaque `Client` porte une référence `salle`. À `bonjour`, tout client est
  spectateur de `salleArene` (comportement actuel). Le message `mode{mode}` le fait changer de salle : `deconnecter` de l'ancienne, `connecter` (même id, même
  pseudo) dans la nouvelle, puis `mode` (écho) + `bienvenue` de la nouvelle salle. `diffuser(salle, sorties)` résout `"tous"`, `"joueurs"`, `"spectateurs"` parmi
  les clients de CETTE salle. `salons` (état résumé des deux salles) est diffusé à TOUS les clients (à la connexion, puis 1 Hz si changé).
- **Changement de salle** : `mode` n'est accepté que d'un client qui n'est pas en jeu (`!enJeu`, sinon `refus{action:"mode", raison:"lobby"}`) et pour la salle zombies seulement si elle a de la place (le contrôle se fait AVANT de quitter l'ancienne salle ; `Salle.connecter` renverrait sinon `erreur{plein}`, que le serveur transforme en fermeture de socket).
  Le pseudo, l'`id` et le numéro de client sont conservés. Après une reconnexion (le serveur oublie la salle choisie, tout client repart dans l'arène), l'interface renvoie `mode{zombies}` dès le `bienvenue` si le mode actif est « zombies » ; le mode mémorisé (`pdj-fps-mode`) ne fait que présélectionner la carte de `ChoixMode`, il n'envoie rien tout seul.
- **Ce que le service zombies voit de la salle** (`ContexteSalle`, `match-contexte.ts`) : en plus de l'existant, `joueurs()` (tous les membres, lobby compris), `placerJoueur(j, p, lacet, {pv, equip, main}, t)` (position, équipement, PV, protection 1,5 s, émet `apparition` ; `placer` de `Salle` reste privé), `retirerJoueur(j, t)` (sortie d'arène sans règle de réentrée), `presence()`, et `equiper(j, equip, main, t)` (change l'équipement en cours + émet `equipement`).
  La salle zombies ignore `equiper` / `arme` / l'équipement de `rejoindre` (le client ne choisit rien) et force le départ `{ sansPrincipale, pistolet, couteau }`.
- **Hors périmètre du Dockerfile** : le serveur n'embarque que `lib/fps` et `lib/agroparc3d`. Aucun module importé (transitivement) par `serveur-fps` ne doit toucher `lib/tigre3d`, `lib/format`, `three` ni le DOM : `zombies*.ts`, `match-zombies.ts`, `monstres.ts` (déjà là) restent purs. `scene.json` est passé en paramètre, jamais importé.
- **Une seule partie zombies à la fois** (capacité `ZOMBIES.joueursMax = 8`, lobby compris). Un client qui choisit « Zombies » alors que la salle est pleine reçoit
  `refus{action:"mode", raison:"plein"}` et reste dans l'arène. **Partie en cours** : le nouvel arrivant reste dans le lobby (état `attente`) et est **admis à la
  prochaine pause entre deux manches** (équipement et argent de départ), comme un join-in-progress de CoD.
- **Hôte** = premier arrivé du lobby (passe au suivant s'il part). Seul l'hôte envoie `lancerPartie` (≥ 1 joueur). Après `fin`, la salle revient au lobby au bout
  de 25 s (`ZOMBIES.finAffichageMs`), les joueurs encore là restent dans le lobby.
- **Admission puis `rejoindre`** : `lancerPartie` met chaque joueur du lobby à l'état `admis` (pas encore placé) et diffuse `zombies{phase:"pause"…}`. Le client voit
  `moi.admis` et monte le jeu (`lancerJeu`), qui envoie `rejoindre` comme aujourd'hui (`jeu.ts` n'envoie rien de plus) ; le serveur refuse `rejoindre` à un joueur non admis
  (`refus{rejoindre, "lobby"}`), sinon le place sur un point de départ et répond `apparition`. Aucun changement du flux d'entrée de l'arène.
- **Le serveur reste autoritaire** sur l'argent, les achats, les portes, les tigres, les dégâts et les réanimations. Les munitions de chargeur restent côté client
  (comme aujourd'hui) ; le serveur ordonne seulement un ravitaillement (`equipement.ravitaille`).
- **Site privé** : pas de lutte contre un client truqué au-delà des bornes de vitesse existantes. Les murs, barrières et bornes sont imposés par la collision côté client ET
  côté serveur (`Salle.recevoirEtat` refuse déjà hors bornes ± 0,5 m ; voir « Carte » pour les murs hauts).

## Épée (arène et zombies)

- Nouveau type `ArmeMeleeId = "couteau" | "epee"`, `ARMES_MELEE`, `estMelee(a)`. `ArmeId = ArmeFeuId | ArmeMeleeId`. Le **slot reste `couteau`** (touche 3, V = mêlée rapide ;
  `SLOTS`, `touches.ts` inchangés). `Equipement` gagne `melee?: ArmeMeleeId` (**OPTIONNEL** : une vingtaine de littéraux `Equipement` existent dans le code et les tests, un champ obligatoire casserait `tsc` partout ; absent = `"couteau"` ;
  helper `meleeDe(eq)` ; `EQUIPEMENT_DEFAUT` n'a PAS de `melee` (les `toEqual` existants sur des équipements restent verts), `copierEquipement` ne recopie `melee` / `sansPrincipale` que s'ils sont définis (jamais de clé `undefined`), lu par `normaliserEquipement` (qui range `"couteau"` comme absent : seul `"epee"` écrit la clé), localStorage
  `pdj-fps-equipement`, rétrocompatible ; `armeDuSlot(eq, "couteau") = meleeDe(eq)`). `rejoindre` et `equiper` portent `melee?`.
- **Équipement sans arme principale (zombies)** : on démarre avec le pistolet et le couteau SEULEMENT, or `Equipement.principale` n'est pas nullable et l'est partout dans le code (`ControleurArmes`, `jeu.ts`, HUD, `placer`). Plutôt que de le rendre `null`
  (ripple sur tout), `Equipement` gagne `sansPrincipale?: true` : `principale` garde une valeur de remplissage (`mitraillette`) mais `armeDuSlot(eq, "principale")` et `slotDeLArme` renvoient `null` tant que le drapeau est posé (comme la spéciale vide : `slotVoisin`, `lignes()`, `changerMain` savent déjà
  sauter un slot `null`). `copierEquipement` le copie. Acheter une arme principale au mur pose `principale` et retire le drapeau. Au départ des zombies : `{ principale: "mitraillette", sansPrincipale: true, secondaire: "pistolet", speciale: null }`, slot en main `secondaire`.
  Côté client, `ControleurArmes` ne doit jamais retomber sur `MAIN_INITIALE = "principale"` quand ce slot est vide (premier slot utilisable).
- `armes.ts` : `MELEE: Record<ArmeMeleeId, ArmeMelee>` ; `COUTEAU = MELEE.couteau` reste exporté. `ArmeMelee = { id, nom, nomCourt, description, degats, degatsZombie,
  portee, margePortee, cadenceS, vitesse, cosCone, nbCiblesMax, dureeCoupS }`.

| | degats | degatsZombie | portee | margePortee | cadenceS | vitesse | cosCone | nbCiblesMax | dureeCoupS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| couteau (inchangé) | 100 | 100 | 2,2 | 0,6 | 0,5 | 1,3 | 0,574 (55°) | 1 | 0,40 |
| **épée** | **140** | **220** | **2,6** | **0,7** | **0,85** | **1,2** | **0,342 (70°)** | **3** | **0,55** |

  Invariant : sprint 12,5 × 1,2 = 15 m/s ≤ `PLAFONDS.vitesseHorizontaleMax` (19). L'épée tue en un coup (140 > 100 PV) et touche jusqu'à 3 cibles dans son arc ; elle est plus lente.
- `melee.ts` généralisé : `distanceSurface`, `dansCone(o, d, cible, cosCone)`, `trouverCiblesMelee(monde, o, d, cibles, tireur, arme): {cible, distance}[]` (triées par distance, au plus
  `nbCiblesMax`, ligne de vue libre ; `trouverCibleCouteau` reste, délègue), `coupVraisemblable(monde, o, d, cible, arme)`. Les zombies ont leur équivalent dans `zombies.ts`.
- **Message `coup`** : `{t:"coup", o, d, cibles: string[]}` (ids de joueurs ET de tigres `z<n>` ; vide = coup dans le vide). Le serveur diffuse aux autres
  `{t:"coup", id, o, d, arme: ArmeMeleeId}`. `Salle.recevoirCoup` : garde `main==="couteau"` et `estMelee(j.arme)`, `validerVisee` inchangé, `cadenceOk(j, j.arme, MELEE[j.arme].cadenceS, false, t)`, au plus
  `nbCiblesMax` cibles distinctes, chacune revalidée (joueurs : `positionsCible` sur `REWIND_MELEE_MS` + `coupVraisemblable` avec l'arme ; tigres : `zombies.toucheMelee`),
  dégâts `infliger(c, MELEE[arme].degats, j, "arme", "corps", arme, t, o)` ; `killsParArme` et le fil des éliminations affichent « Épée ».
- Rendu : `case "epee"` dans `creerModeleArme` (fil de fer : lame longue ≈ 0,55 m, garde en croix, manche à deux mains, la main libre `garde` y tient), entrée `PLACEMENT.epee`,
  animation de coup paramétrée par arme (table `COUPS` : durée, amplitude ; l'épée fait un coup de taille horizontal alterné gauche/droite), `sons.coup(touche, pos, arme)` (l'épée : sifflement plus long + tintement métallique triangle 900–2 300 Hz).
  Le lobby de l'arène propose le choix couteau / épée (`ChoixEquipement`, groupe « Arme blanche »). Dans les zombies on part toujours avec le couteau ; l'épée s'achète au mur (500 $).

## Protocole v5 (`lib/fps/protocole.ts`)

Client → serveur :
- `mode{mode: "arene"|"zombies"}`, `lancerPartie` (hôte), `acheter{id}` (id du catalogue, cf. « Achats »), `reanimer{cible: string|null}` (maintenir E ; null = relâché),
  `rejoindre{…, melee?}`, `equiper{…, melee?}`, `coup{o, d, cibles}`, `tir.touches[].cible` accepte un id de tigre `z<n>` (`estIdZombie`, `idZombie(n)`).

Serveur → client :
- `salons{arene: {joueurs, enJeu}, zombies: {phase, joueurs, manche}}` (à tous), `mode{mode}` (confirmation du changement de salle), `refus{action: … | "mode", raison: … | "plein"|"lobby"}`.
- `zombies{etat: EtatPartieZombies}` (aux membres de la salle, à chaque changement : arrivée/départ, lancement, début/fin de manche, porte ouverte, joueur à terre/relevé/éliminé, fin ; ≤ 5 Hz).
- `argent{solde, delta, motif}` privé, `achat{ok, id, raison?}` privé, `zombieMort{id, p, par, zone}` (aux joueurs, effets), `degats{cible:"z<n>", par, degats, pv, bouclier:0, zone}` au SEUL tireur (marqueur de touche).
- `snap.zombies?: SnapZombies = { r: number, z: number[] }` : `r` = tigres restants à tuer (pas encore apparus + vivants), `z` = tableau plat de stride 6 `[id, xCm, zCm, capMrad, drapeaux, pvPct]`
  (`drapeaux` : bits 0–1 type 0 rôdeur / 1 sprinteur / 2 brute, bit 2 griffe armée, bit 3 en apparition). Entiers uniquement (≈ 30 octets par tigre). Jamais envoyé aux spectateurs ni au lobby.
- `equipement` gagne `ravitaille?: ArmeFeuId` (le client remplit chargeur ET réserve de cette arme) ; `batiments` inchangé (la porte achetée est « détruite » : effondrement animé + débris).
- `CauseMort` += `"tigre_zombie"` (aucun tueur ; `mort.arme = "couteau"`). `EtatPartieZombies` :

```ts
type PhaseZombies = "lobby" | "pause" | "manche" | "fin";
interface JoueurZombies { id; pseudo; couleur; etat: "attente"|"debout"|"terre"|"elimine"; admis: boolean; kills: number; gagne: number; reanimations: number; terreFinT?: number }
interface EtatPartieZombies {
  phase: PhaseZombies; manche: number; hote: string; capacite: number; debutT: number; finT: number; // finT : fin de pause / de bilan
  joueurs: JoueurZombies[]; portes: { id: string; ouverte: boolean }[]; bilan?: { manche: number; dureeMs: number }
}
```

`InfoMatch` ne change pas (en zombies : `phase:"jeu"`, `objectif:0`). `JoueurPublic` ne change pas.

## Mode zombies — règles

Constantes exportées par `zombies-vagues.ts` (objet `ZOMBIES`), toutes testées.

- **Machine d'états** (service `match-zombies.ts`) : `lobby` → `pause` (décompte de départ 8 s, manche 1) → `manche n` → `pause` (10 s) → `manche n+1` … → `fin` → `lobby`.
  Fin de manche : tous les tigres de la manche sont apparus ET morts. Bonus de fin de manche à chaque joueur debout : `100 + 25 × n` $. À la pause : les joueurs **à terre sont relevés** (50 PV), les **éliminés** reviennent avec l'équipement de départ et 500 $, les joueurs en `attente` sont admis.
- **Départ** : 100 PV, pistolet + couteau (pas d'arme principale : cf. `sansPrincipale`), 500 $ (`PDJ_FPS_ZOMBIES_ARGENT` pour les essais), régénération de 20 PV/s après 5 s (règle existante, pas de bouclier). Pas de réapparition à 4 s, pas de killcam à rejeu, pas d'objectif de kills, pas d'Elsa, de voitures, de PNJ ni d'événements.
  **Premier tigre d'une partie** : le décompte de départ (8 s) court normalement mais les apparitions de la manche 1 ne commencent que quand tous les joueurs admis sont `enJeu` (leur client a chargé three et le GLB, ce qui peut dépasser 8 s) ou après 15 s au plus, puis 3 s de grâce ; une manche suivante démarre après sa pause de 10 s sans attente.
- **À terre** : un joueur à 0 PV est `terre` (`vivant=false`, posture « mort », immobile, `terreFinT = t + 45 s`). Un coéquipier debout à ≤ 2,5 m qui maintient E (`reanimer{cible}`) pendant 3 s le relève (PV 50, `reanimations++`, message `apparition` privé à sa position,
  chargeurs remplis : limite connue). Le serveur annule si le relanceur lâche (`reanimer{null}`), tombe, s'éloigne (> 3,2 m) ou si la cible est relevée/éliminée. 45 s sans relève : `elimine` (spectateur jusqu'à la pause suivante).
  **Partie perdue dès qu'aucun joueur n'est debout** (tous à terre ou éliminés, même si une relève est en cours) : phase `fin`, bilan (manche atteinte, kills, argent gagné, relèves).
  **Pas de message `mort` en zombies** (il déclencherait la killcam, le fil des éliminations et un compte à rebours de réapparition) : la branche zombies de `Salle.mourir` pose `vivant=false`, `posture="mort"`, `morts++`, SANS `reapparitionT` (le `tic` ne replace donc personne),
  n'émet ni `mort` ni objectif de kills, et laisse au service `surMort` le soin d'émettre `zombies{etat}` (immédiat, hors limite de 5 Hz) + `presence`. Le client sait qu'il est à terre par le `degats` reçu (`pv ≤ 0`) puis par `zombies.joueurs[moi].etat` (`terre` / `elimine`) ;
  `jeu.ts` factorise le bloc d'état du `case "mort"` en `tomber()` (sans `kc.surMort` ni `cb.evenement("mort")`) et l'appelle dans ces deux cas ; la relève repasse par `apparition` (`apparaitre()` existant).
  **Pas de tir allié** : en zombies les joueurs ne sont ni cibles ni obstacles pour les tirs et la mêlée des autres (client : `cibles()` sans joueurs pour `tracer`/`trouverCiblesMelee` ; serveur : `recevoirTir` / `recevoirCoup` ignorent toute cible qui n'est pas un tigre). `kills` / `morts` de `JoueurSalle` comptent les tigres tués et les mises à terre (le tableau des scores reste utile),
  incrémentés par le service qui émet alors `presence`.
  **Éliminés, départs, retour au lobby** : un éliminé reste `enJeu` (`vivant=false`, il reçoit les snaps) jusqu'à la pause ; `Quitter` (message `quitter`) ou une éviction pour inactivité (20 s, règle de `Salle.tic`) le fait repasser `attente` (`admis=false`, argent perdu), et s'il était le dernier debout la partie est perdue ;
  une déconnexion fait de même. À la fin des 25 s de bilan, le service retire TOUS les joueurs de l'arène (`ctx.retirerJoueur`) pour que `enJeu=false` partout et que les clients démontent le jeu (phase `lobby`). `rejoindre` en zombies ignore `reentreeT` / `memoSante` (la santé et la position sont décidées par le service, jamais par la règle des 60 s de l'arène).
- **Vagues** (`zombies-vagues.ts`, fonctions pures de la manche `n` et du nombre de joueurs `j`) :
  - total `round((6 + 2,2 (n−1) + 0,12 (n−1)²) × (1 + 0,45 (j−1)))` (solo : 6 à la manche 1, 11 à la 3, 17 à la 5, 36 à la 10 ; à 4 joueurs : 14 à la manche 1) ;
  - PV `n ≤ 9 ? 100 + 50 (n−1) : round(550 × 1,1^(n−9))`, × 0,8 pour un sprinteur, × 4 pour une brute ;
  - vitesse de marche (m/s) : 4,2 (n ≤ 2), 5,5 (n 3–4), 7 (n 5–8), 8,6 (n ≥ 9), ± 8 % par tigre (hasard injecté) ; un sprinteur ×1,2 ; une brute ×0,8 ; tous sous le sprint des joueurs (12,5) : on peut les semer ;
  - sprinteurs à partir de la manche 3 (proportion `min(0,5; 0,1 (n−2))`), brutes à partir de la manche 5 : `floor(n/5)` par manche, apparaissent en dernier ;
  - dégâts de griffe `min(55, 30 + 2 (n−1))`, cadence 1,0 s par tigre ;
  - apparition : un tigre toutes les `max(0,35; 2,0 − 0,12 n)` s tant que les vivants sont sous le plafond `min(24, 6 + 3 j + 2 n)` ;
  - gain d'argent : +10 $ par tir qui touche un tigre (une fois par tir, quel que soit le nombre de plombs), +10 $ par coup de mêlée qui touche ; kill +60 $ (corps), +100 $ (tête ou mêlée), le tout × `min(2, 1 + 0,04 (n−1))` arrondi à 10.
- **Tigre zombie** (`zombies.ts`, PUR) : le tigre du thème Tigre à `ECHELLE_ZOMBIE = 2,7` (≈ 3 m du museau à la queue, garrot ≈ 1,1 m, tête ≈ 1,45 m), brute à 3,4. Touche : `FORME_TIGRE` de `monstres.ts` × échelle, marge 0,25 m, tête ×1,5, rayon bloqué par un bâtiment fermé ; compensation de latence par un historique de 400 ms
  (positions dédoublonnées à 0,5 m, rejeu 300 ms au plus). Marche : cap vers la cible, rotation limitée à 6 rad/s, `resoudre(monde, p, 0,6, 2, ignorerPasseTigre=true)` à chaque pas, séparation entre tigres (grille de hachage, 1,4 m).
  **Poursuite par champ de distance** : toutes les 400 ms (et seulement si l'ensemble des cases des joueurs debout a changé) un parcours multi-sources depuis ces cases remplit un champ de distance sur la grille de navigation (cases de 1,5 m, rayon 0,7) ; chaque tigre descend le gradient (donc va vers le joueur le plus proche en chemin) ; s'il voit un joueur à ≤ 15 m il le vise
  directement. **Coût MESURÉ** (grille 138 × 90, 2 sources, machine de dev) : Dijkstra à tas binaire du `Tas` existant = 8 à 30 ms par champ (et non 0,3 ms), file à seaux de Dial sur `Int32Array` (poids entiers 10 / 14, seaux circulaires, voisins sans allocation) = ≈ 1 ms une fois le JIT chaud. `champDistance` utilise donc la file à seaux, plus un arrêt anticipé dès que toutes les cases
  des tigres vivants sont réglées et que la distance dépasse la plus lointaine d'entre elles ; jamais d'A* par tigre. Reconstruire la grille après une porte coûte 17 à 40 ms (mesuré). **Griffe** : à ≤ 1,7 m de surface d'un joueur debout, le tigre s'arrête et arme 0,4 s (drapeau « griffe » du snap) ; si le joueur est encore à ≤ 2,3 m,
  `ctx.infliger(joueur, dégâts, null, "tigre_zombie", "corps", "couteau", t, p)` ; recharge 1,0 s. Plafond de 24 tigres vivants (client ET serveur).
- **Dégâts reçus** : `Salle.recevoirTir` : les `touches` dont `cible` est un id de tigre sont revalidées par `zombies.toucheZombie(id, o, d, portee, t)` (rejeu), cumulées par tigre sur le tir (les plombs du pompe s'additionnent), puis `zombies.blesser(id, degats, joueur, zone, t)` →
  `degats` au tireur, `argent`, `zombieMort` + gain de kill. Dégâts de tir = `degatsPlomb(arme, zone, distance)` (tête ×`multTete` de l'arme, non cumulé avec ×1,5) ; mêlée = `MELEE[arme].degatsZombie`.

## Carte « Cour des Restos » (repère de `scene.json`, mètres)

Choisie parmi les candidats de la cartographie (vérifiée au flood-fill avec le vrai moteur `resoudre`). **`scene.json` n'est jamais modifié** (`cachettes.json` doit se régénérer à l'octet) :
`donneesZombies(scene): { data: SceneData; bornes; zones; portes; achats; departs; fenetres }` (PUR, `zombies-carte.ts`) renvoie une COPIE où l'on ajoute des bâtiments synthétiques à la fin de `buildings`,
retire le POI `truck` (plus de prisme `fixe` du Truck) et fixe `focus`. Serveur ET client appellent la même fonction avant `construireMonde` (`construireMondeZombies(scene)` : bornes = `{x0:8, z0:-110, x1:214, z1:24}`, puis **murs hauts** : `h = hOrigine = 40` pour tous les prismes, pour que ni toit ni saut de mur ne permette de quitter la zone ;
le décor, lui, garde les vraies hauteurs).

**Bâtiments qui forment les murs** (tous tournés de 16°) : 74 (4,7 m), 72 (7,7), 73 (6,9) au sud ; 76, 75, 69, 70, 61, 62 (8,0–8,7) au nord. Ils forment 3 cours (1 350–1 800 m²) reliées par 2 carrefours.

**Pièces synthétiques** (`Building` avec `type`, anneau = rectangle du segment, demi-épaisseur 0,8 m, prolongé de 0,3 m aux deux bouts, `h = 6`, `c` = milieu). Ordre FIXE = index dans `buildings` à partir de 142 :

| rang | id | type | segment p → q (m) |
| --- | --- | --- | --- |
| 0 | `G1` | porte | (96.8, −40.2) → (100.0, −51.1) |
| 1 | `G2` | porte | (106.4, −33.2) → (103.1, −50.2) |
| 2 | `G3` | porte | (148.1, −37.3) → (145.1, −26.5) |
| 3 | `G4` | porte | (159.2, −18.1) → (156.0, −35.1) |
| 4 | `E` | porte | (200.6, −22.3) → (197.6, −11.5) |
| 5 | `S1` | barricade | (98.9, −24.5) → (103.5, −23.2) |
| 6 | `S2` | barricade | (151.6, −9.5) → (156.3, −8.1) |
| 7 | `N4` | barricade | (164.2, −64.1) → (170.5, −62.3) |
| 8 | `W` | barricade | (55.1, −52.1) → (58.2, −63.0) |
| 9 | `N2c` | champ | (117.9, −77.2) → (111.4, −79.1) |
| 10–13 | `S1c`, `S2c`, `N4c`, `Wc` | champ | mêmes segments que `S1`, `S2`, `N4`, `W` |
| 14–16 | `N1`, `N3`, `N5` | mur | (96.2, −85.5)→(97.7, −83.1) ; (149.1, −70.4)→(150.6, −68.1) ; (201.7, −55.4)→(203.0, −53.1) |
| 17–19 | `PW`, `PN`, `PE` | mur | (55.5, −36.8)→(55.5, 24) ; (55.2, −101.3)→(55.2, −110) ; (207.8, 6.6)→(207.8, 24) |

  - `champ` (« passe-tigres ») : prisme avec `passeTigre: true` — **bloque les joueurs, laisse passer les tigres, les balles et les regards** ; rendu en ambre translucide. Nouveau drapeau optionnel `Building.type` (`"porte"|"barricade"|"champ"|"mur"`) dans `lib/agroparc3d/types.ts`, copié en `Prisme.passeTigre` par `construireMonde` pour `"champ"`.
  - `resoudre(monde, p, rayon, h, ignorerPasseTigre = false)`, `lancerRayon` et `visible` ignorent les prismes `passeTigre` (les joueurs, eux, appellent `resoudre` sans l'option).
  - Ouvrir = `detruireBatiment(monde, idPrisme)` + `invaliderNavigation(monde)` (recalcul complet de la grille, ≈ 20–40 ms, une fois par achat) + `batiments{complet:false, detruits:[…], breches:[]}` à toute la salle. Nouvelle partie : `releverBatiments` + `batiments{complet:true,…}` (envoyé aussi à un joueur admis plus tard : état complet).
  - `N2c` est l'**unique entrée de tigres au départ**. `N1`, `N3`, `N5`, `PW`, `PN`, `PE` ne s'ouvrent jamais.

**Zones et progression** (aires MESURÉES le 2026-10-27 au flood-fill de 0,5 m, rayon joueur 0,4 m, avec le vrai `resoudre` : tests à ±5 % de ces valeurs) : cour Centre (DÉPART, 1 782 m²) ; carrefour Est `I2` (+193 m² après `P1`) ; cour Est (+1 782 m² après `P2`) ; carrefour Ouest `I1` (+151 m² après `P3`, et non 122) ; cour Ouest (+1 361 m² après `P4`) ; niche Est (+335 m² après `P5`).
Surfaces cumulées du joueur : 1 782 → 1 975 (P1) → 2 126 (P3) → 3 908 (P2) → 5 269 (P4) → 5 604 (P5). Portes fermées, le flood-fill depuis les huit départs ne couvre que la cour Centre. Un tigre qui part d'un point d'apparition de `N2c` atteint tous les départs ; portes toutes ouvertes (champs ignorés), les cinq fenêtres communiquent avec les départs (aire des tigres : 21 031 m²).

| porte payante | prix | prérequis | ouvre (prismes détruits) | zone gagnée | fenêtre à tigres activée |
| --- | --- | --- | --- | --- | --- |
| `P1` | 750 $ | — | `G3`, `S2` | carrefour Est | `S2c` |
| `P3` | 1 000 $ | — | `G2`, `S1` | carrefour Ouest | `S1c` |
| `P2` | 1 250 $ | `P1` | `G4`, `N4` | cour Est | `N4c` |
| `P4` | 1 500 $ | `P3` | `G1`, `W` | cour Ouest | `Wc` |
| `P5` | 2 000 $ | `P2` | `E` | niche Est | — |

  Distance d'achat d'une porte : ≤ 3 m du segment du premier prisme listé, de l'un ou l'autre côté (la porte étant à cheval sur deux zones, c'est voulu). Mesuré depuis la cour Centre, portes fermées : `P1` et `P3` à 1,3 et 1,0 m (achetables dès le départ), `P4` à 4,0 m, `P2` à 9,2 m, `P5` à 55,5 m (hors de portée). Les prérequis fixent l'ordre ; un test vérifie ces distances et qu'aucune case de la cour Centre n'est à ≤ 3 m de `G4`, `G1` ou `E`.

**Points d'apparition des tigres** : pour chaque fenêtre, point à 6 m côté extérieur (vérifiés) — `N2c` (116.3, −83.9), `S1c` (99.6, −18.1), `S2c` (152.2, −3), `N4c` (169, −69), `Wc` (50.9, −59.2) — plus deux autres à 12 m et 18 m le long de la même normale
(vecteur milieu → point de 6 m prolongé ; un test écarte les points non libres à rayon 0,6 m). Mesuré : les quinze points (5 fenêtres × 6 / 12 / 18 m) sont libres à rayon 0,6 m, dans les bornes, et atteints par le flood-fill des tigres (rayon 0,7, champs ignorés) : (118.0, −89.7), (119.6, −95.5) ; (98.0, −12.3), (96.4, −6.5) ; (150.5, 2.7), (148.8, 8.4) ; (170.6, −74.7), (172.3, −80.5) ; (45.1, −60.9), (39.3, −62.5). Choix : parmi les fenêtres actives, celles dont le joueur debout le plus proche est à ≥ 15 m, tirage uniforme ; repli : n'importe quelle fenêtre active.
**Départs des joueurs** (cour Centre, ≥ 12 m de `N2c`, ≥ 2,5 m des murs) : (126.5, −53), (142.5, −30.5), (109.5, −35.5), (107.5, −56), (147, −67.5), (120, −45), (135, −38), (130, −62), lacet vers le centre de la cour (le point d'origine (109, −35.5) n'était qu'à 2,19 m d'un mur : décalé de 0,5 m, dégagement mesuré 2,68 m ; dégagements des autres : 19,1 / 2,78 / 2,63 / 2,54 / 11,0 / 9,6 / 13,3 m ; distance à `N2c` ≥ 22,2 m pour les huit, espacement mutuel ≥ 14 m).

**Achats** (`id` du catalogue ; rayon d'action 2,5 m). Position = point de la façade à la fraction `t` de p → q, décalé de 1,2 m du côté **libre** de la façade (le côté de la cour : des deux candidats un seul est hors bâtiment ; vérifié sur le vrai monde), dégagement mesuré 1,20 m partout ; test : point libre à rayon 0,4 m, dans la zone attendue, à ≤ 2 m d'un mur,
deux achats d'une même zone à ≥ 3 m l'un de l'autre. Plusieurs achats sur une même façade ne se superposent pas : ils ont des `t` distincts (tableau). Positions calculées (arrondies au décimètre) :

| zone | achat | façade (p → q) | t | position | prix |
| --- | --- | --- | --- | --- | --- |
| cour Centre | `mur:pistolet` | ouest de 70 (143.4, −42.7)→(150.6, −68.1) | 0,25 | (144.0, −49.4) | 250 $ (munitions 125 $) |
| cour Centre | `mur:epee` | ouest de 70 | 0,75 | (147.6, −62.1) | 500 $ |
| cour Centre | `mur:mini_uzi` | sud de 69 (124.1, −77.5)→(149.1, −70.4) | 0,5 | (136.3, −72.8) | 500 $ |
| cour Centre | `mur:revolver` | nord de 72 (114.7, −35.1)→(125.8, −31.9) | 0,5 | (120.6, −34.7) | 650 $ |
| cour Est | `mur:pompe` | sud de 61 (176.7, −62.5)→(201.7, −55.4) | 0,5 | (188.9, −57.8) | 900 $ |
| cour Est | `boite` | ouest de 62 (203.0, −53.1)→(195.8, −27.7) | 0,5 | (198.2, −40.7) | 950 $ |
| cour Est | `soin` | nord de 73 (178.6, −17.0)→(167.5, −20.1) | 0,5 | (173.4, −19.7) | 400 $ |
| cour Ouest | `mur:mitraillette` | nord de 74 (96.8, −40.2)→(55.1, −52.1) | 0,25 | (86.7, −44.3) | 1 000 $ |
| cour Ouest | `mur:fusil_assaut` | nord de 74 | 0,75 | (65.9, −50.3) | 1 300 $ |
| cour Ouest | `mur:sniper` | ouest de 75 (97.7, −83.1)→(90.5, −57.9) | 0,5 | (92.9, −70.8) | 1 500 $ |
| niche Est | `mur:mitrailleuse` | fond de la niche (le seul point choisi à la main) | — | (211.0, 18.0), libre à 0,5 m, dégagement 2,4 m, atteint après `P5` | 2 000 $ |

  - `mur:<arme>` : si le joueur n'a pas l'arme, il l'achète plein tarif (elle remplace son arme de la même catégorie, devient l'arme en main, chargeurs pleins) ; s'il l'a déjà, c'est la **recharge de munitions à moitié prix** (`equipement.ravitaille`). `mur:epee` : `equip.melee = "epee"`.
    Réserve limitée en zombies : le client règle la réserve à 5 chargeurs par arme (infinie dans l'arène) ; pas de réserve pour les spéciales (sans recharge).
  - `boite` : tirage dans les 11 armes à feu non possédées (poids 1, spéciales 0,4) avec le hasard injecté ; une spéciale va dans le slot spécial (munitions = son chargeur, comme Elsa). Position fixe.
  - `soin` : PV à 100, réutilisable après 20 s par joueur.
  - Refus (`achat{ok:false, raison}`) : `argent`, `loin`, `deja` (porte ouverte), `verrou` (prérequis), `partie` (pas en manche/pause, joueur à terre, non admis). Les armes spéciales ne se rachètent pas.

## Rendu et performances côté client

- **Tigres** : `rendu-zombies.ts` (three). Un **pool de 24 clones** (`creerTigre` de `lib/tigre3d/modele.ts`) créés au chargement, 2 par image pour étaler le coût ; UNE copie privée de la géométrie, du matériau et de la texture partagée par tous (jamais `libererModele()`, sinon three retient le renderer),
  libérée au `dispose` + perte de contexte forcée ; 3 matériaux teintés (`MeshBasicMaterial`, couleur multipliée : rôdeur brun sombre, sprinteur plus clair, brute rouge sombre), pas de maillage filaire, d'ombre ni d'yeux (1 draw call par tigre). Culling manuel (`visible = devant la caméra && distance < 140 m`).
  LOD d'animation : pose recalculée à chaque image à moins de 40 m, 1 image sur 2 jusqu'à 80 m, 1 sur 4 au-delà.
- **Animation** : `zombies-anim.ts` enveloppe `creerCorps/avancerCorps` (allure marche/trot/galop selon la vitesse, plafonnée à 3,2 en vitesse modèle) + geste court `lib/tigre3d/gestes/griffe.ts` (0,55 s, poids nul au tirage des réactions du thème Tigre). Orientation et échelle comme `rendu-monstres.ts` (`rotation.y = cap + π/2`).
- **Interpolation** : `jeu-zombies.ts` (PUR, testé) : tampon de snaps 1,5 s, appariement par id, interpolation à `tsServeur − JEU.interpolationMs`, apparition/disparition, tableaux préalloués (pas de `Map` copiée à chaque image). Tir : `trouverZombieTouche(o, d, limite, zombies, monde)` pré-filtré par sphère englobante, joue le rôle de `toucheMonstre` pour N tigres ; une balle compte pour le tigre s'il est devant le premier mur/joueur touché.
- **Sons** : rugissement spatialisé (au plus 4 voix simultanées), griffe, achat, nouvelle manche, argent. **Radar** : tigres vus en points rouges (capacité 24), portes sur la grande carte, `ZONE_CARTE` restreinte aux bornes zombies.
- Le fil des éliminations ne reçoit jamais les tigres (`zombieMort` est un message distinct de `mort`).

## HUD et écrans

- **Choix du mode** : à l'ouverture du bouton d'en-tête « Arène » du Palantir, `ChoixMode` (deux cartes radio, compteurs issus de `salons`) précède le lobby du mode : `Arene` (inchangé : même `aside[aria-label='Arène']`, même « Nom de joueur », même bouton « Entrer dans l'arène ») ou `LobbyZombies`
  (`aside[aria-label='Zombies']` : statut, liste d'attente avec puce de couleur, badge « hôte », règles, commandes, « Lancer la partie » pour l'hôte / « En attendant l'hôte… » pour les autres, « Changer de mode »). Mode mémorisé (`localStorage` `pdj-fps-mode`, défaut `arene`). `window.__arene.entrer()` sans argument = arène.
- **HUD zombies** (`HudArene` avec `hud.mode === "zombies"`) : `BarreVague` à la place de `BarreMatch` (« MANCHE 7 », « 12 TIGRES », décompte de pause), `BlocArgent` (« 1 250 $ » en `--ag-amber`, dernier gain animé, libellé écrit pour « argent insuffisant »), invites `[E] Pompe — 900 $` / `[E] Ouvrir la porte — 1 250 $` / `[E] Réanimer {pseudo}` (maintenir), annonce de manche façon `BandeauEvenement`,
  `EcranMort` → « À terre » (barre de saignement, relève par un coéquipier) puis « Éliminé, retour à la prochaine pause », `FinDePartieZombies` (manche atteinte, tableau par joueur : kills, argent gagné, relèves ; record local `pdj-fps-zombies-record` ; « Rejouer » = retour au lobby, « Quitter »).
  Aucune couleur en dur dans les modules CSS du HUD (`hud-contraste.test.ts`).
- Touche : `interagir` (E) pour acheter, ouvrir et réanimer (aucune nouvelle action de `touches.ts`).

## Bâtiments détaillés (arène ET zombies ; vue aérienne inchangée)

Rendu seulement, procédural, aucune collision nouvelle. `decor.ts` (`OptionsDecor.detail`, vrai par défaut quand `destruction` est fourni, donc dans l'arène et pas dans la vue aérienne) :
- murs : un quad par arête de l'anneau (on garde `ExtrudeGeometry` pour le toit et `EdgesGeometry` pour les arêtes) avec attributs par sommet `aBat` (déjà là), `aMur = (u, L, nEtages, porte)` ; murs de moins de 3 m, bâtiments de moins de 3 m de haut ou 40 m² : lisses ;
- nuanceur (extension de `effondrable()` ; `customProgramCacheKey` change) : étages `nEtages = max(1, round(h / 3,2))`, colonnes de fenêtres tous les ≈ 3 m, fenêtres 1,3 × 1,4 m (cadre cyan fin + vitre sombre, ≈ 25 % « allumées » par hachage de `(aBat, étage, colonne)`), bandeau de plancher à chaque étage, socle sombre de 0,6 m, pilastres de coin, corniche et acrotère au sommet, porte au rez-de-chaussée sur le mur le plus long qui regarde la route la plus proche
  (largeur 1,6, hauteur 2,4). `vMondeB.y` est la hauteur non écrasée : le motif suit l'effondrement et le `discard` des brèches s'applique déjà. Atténuation avec la distance (`fwidth`) contre le moiré ; teintes sous le seuil du bloom (0,24) sauf les fenêtres allumées ;
- équipements de toit : `InstancedMesh` (caissons de clim 1,5 × 1 × 1,2, édicules, antennes ; ≈ 1 par 150 m² de toit, ≈ 300 au total) avec `InstancedBufferAttribute aBat` et le même `effondrable()` ;
- types de la carte zombies : `porte` ambre pleine, `barricade` ambre barrée, `champ` ambre translucide, `mur` comme un bâtiment ordinaire.
Fonctions pures dans `lib/agroparc3d/facade.ts` (nombre d'étages, colonnes, mur de la porte, hachage des fenêtres allumées, placement des équipements) : testées.

## Budget

- Serveur : tic de la salle zombies ≤ 1 ms en moyenne avec 8 joueurs et 24 tigres (champ de distance toutes les 400 ms, 0 A* par tigre) ; snap ≤ 4 200 octets à 8 joueurs + 24 tigres. Grille de navigation (cases de 1,5 m, 138 × 90) précalculée à la création de la salle (17 à 40 ms), recalculée une fois par porte achetée. Le champ de distance coûte ≈ 1 ms (file à seaux) toutes les 400 ms au plus, soit < 0,1 ms par tic en moyenne mais un pic de 1 à 3 ms sur un conteneur à 0,3 vCPU. Le test de charge (`match.zombies.charge.test.ts`) vise ≤ 2 ms de moyenne (budget nominal 1 ms ; `match.charge.test.ts` existant dépasse déjà son budget de 1 ms, 1,3 ms mesuré, quand vitest tourne en parallèle sur toute la machine, et passe seul en 0,05 ms). Le serveur Docker (0,3 vCPU) héberge les deux salles ; la salle vide ne coûte rien.
- Client : 24 tigres ≈ 2,5 ms CPU par image (pose complète) avec le LOD ; 24 draw calls skinnés.

## Code

| Module | Rôle |
| --- | --- |
| `lib/fps/protocole.ts` | types v5 (mêlée, messages, `EtatPartieZombies`, `SnapZombies`, ids de tigres) |
| `lib/fps/armes.ts`, `melee.ts`, `equipement.ts` | épée, mêlée multi-cibles, équipement `melee` |
| `lib/fps/collision.ts`, `navigation.ts` | `passeTigre`, `invaliderNavigation`, taille de case paramétrable, champ de distance + descente |
| `lib/fps/zombies-carte.ts` (PUR) | `donneesZombies`, `construireMondeZombies`, portes, zones, départs, apparitions, achats, prix |
| `lib/fps/zombies-vagues.ts` (PUR) | constantes `ZOMBIES`, courbes de manche |
| `lib/fps/zombies.ts` (PUR) | tigres : marche, poursuite, griffe, formes de touche, rejeu, mêlée |
| `lib/fps/match-zombies.ts` (PUR) | service de la salle : états, vagues, argent, achats, portes, à terre, relève, fin |
| `lib/fps/jeu-zombies.ts`, `rendu-zombies.ts`, `zombies-anim.ts` | client : interpolation, rendu, animation |
| `app/components/arene/` | `ChoixMode`, `LobbyZombies`, hud (`BarreVague`, `BlocArgent`, `FinDePartieZombies`), `useArene` |
| `lib/agroparc3d/facade.ts`, `decor.ts` | bâtiments détaillés |

Essais serveur : `PDJ_FPS_ZOMBIES_ARGENT` (argent de départ), `PDJ_FPS_ZOMBIES_TOTAL` (tigres de la manche 1), `PDJ_FPS_ZOMBIES_PAUSE_MS`, `PDJ_FPS_ZOMBIES_GRIFFE` (dégâts de griffe imposés, ex. 100 : un seul coup met à terre, pour que le test de bout en bout couvre la relève sans attendre des manches).

## Limites connues

- Une relève rend les chargeurs pleins (elle passe par `apparition`).
- Les tigres ne grimpent ni ne sautent ; les murs hauts empêchent aussi de tirer par-dessus un bâtiment.
- Pas de barricades à réparer, pas d'atouts, une seule boîte mystère à position fixe, pas de téléportation entre zones.
- Le joueur à terre ne rampe pas et n'a pas de caméra de spectateur sur ses coéquipiers.

## Révision du jour (2026-10-28) : écarts constatés à l'intégration

Relevés en jouant le mode complet avec `scripts/fps/e2e_zombies.mjs` (deux Chromium contre le vrai serveur) et en relisant les restes des tâches précédentes ; le comportement
livré fait foi là où il diffère du texte ci-dessus.

- **Mode mémorisé** : `pdj-fps-mode` n'est pas envoyé au chargement mais **à l'ouverture du panneau « Arène »** (une action du joueur), pour que la carte cochée et le lobby affiché
  restent cohérents. Tant que le panneau est ouvert en zombies, le joueur occupe une des 8 places ; **le refermer hors partie ramène à l'arène** et libère la place. « Quitter » depuis le
  bilan referme aussi le panneau, « Rejouer » ramène au lobby (la salle, elle, reste en phase `fin` jusqu'au bout des 25 s). Les zombies sont **indisponibles au tactile** (radio désactivée,
  « Clavier et souris requis »).
- **Gains** : le message `argent` du tir qui tue porte le motif `kill` et **inclut les +10 $ de la touche** (corps : +70 $, tête ou mêlée : +110 $ à la manche 1) ; les tirs précédents sur le même
  tigre sont des `touche` à +10 $. Le bonus de fin de manche arrive en `manche` (125 $ à la manche 1). Le bilan de fin dure toujours 25 s, `PDJ_FPS_ZOMBIES_PAUSE_MS` ou non
  (il règle le décompte de départ et les pauses).
- **Essais** : `e2e_zombies.mjs` lance le serveur avec argent 2 000 $, 3 tigres à la manche 1, pauses de **10 s** (assez pour acheter le mini Uzi et une porte entre deux manches) et une griffe de **20**
  (cinq griffes couchent un joueur de 100 PV : une griffe de 100 ne laisse aucune marge à un joueur qui frappe à l'épée sous un rendu logiciel de 2–3 images/s ; `E2E_GRIFFE=100` la rétablit).
  Les tigres arrivent **groupés** malgré le décalage de 1,9 s entre apparitions (même couloir, même cible) : un coup d'épée en abat souvent deux d'un coup (balayage de 70° sur 3 m).
- **Joueur hors d'atteinte** : un client qui se téléporte (le serveur ne contrôle que les bornes et la vitesse, jamais les murs ni les portes) dans une zone fermée, par exemple la cour Ouest tant que
  `P3` / `P4` ne sont pas achetées, n'est **pas poursuivi** : le champ de distance n'y arrive pas et les tigres se pressent contre le mur le plus proche. Accepté (site privé, cf. « Décisions de
  conception ») ; le test de bout en bout s'en sert pour garder un joueur à l'abri hors de sa relève.
- **Arène** : `e2e_arene_v2.mjs` repousse d'une heure les événements (Truck fou, tigre robot), qui tuaient les joueurs en pleine étape, joue d'abord le choix du mode « Arène » et ajoute l'étape 6c
  (épée : un troisième navigateur frappe deux joueurs d'un seul coup `coup{cibles}`). Le couteau envoie lui aussi `cibles: [id]`.
- **Limites supplémentaires** (revues de T3 et T6, non exercées par le test) : un joueur à terre ou éliminé n'est jamais retiré
  pour inactivité (la règle des 20 s ne vise que les vivants), il reste `enJeu` jusqu'à la pause comme dans l'arène ; un joueur **admis qui ne rejoint jamais** (onglet gelé après l'admission) compte parmi
  les debout et peut retarder la défaite et la fin de manche (l'interface ne produit plus ce cas) ; `retirerJoueur` ne remet pas `pv` ni `etatT` à zéro (sans conséquence : `rejoindre` repasse toujours par `placerJoueur`).
- **Revue de T8** : le soin à pleins PV est désormais refusé (`achat{ok:false, raison:"deja"}`, rien n'est débité, le délai de 20 s ne démarre pas) ; le texte du refus `deja` est générique (« Déjà acquis, ouvert ou inutile »), il valait « Déjà ouvert » même pour l'épée ou la boîte.
- **Redéploiement** : `VERSION_PROTOCOLE = 5` impose de déployer le front (Vercel) et le serveur (`vps:/opt/pdj-fps`, `docker compose up -d --build`) ENSEMBLE ; tant qu'un seul des deux est à jour, l'arène reçoit
  `erreur{version}`. Le Dockerfile n'a besoin d'aucune copie en plus.
