# Mode Battle Royale (largage, fouille, tempête) — design

Date : 2026-10-28 (révisée après deux critiques le 2026-10-29) · Branche : `feat/battle-royale` · Protocole : `VERSION_PROTOCOLE = 8`. Les changements v8 sont purement additifs (champs optionnels, nouveau mode) : le serveur accepte les versions **7 et 8** (`VERSIONS_ACCEPTEES` de `protocole.ts`) pour l'arène et les zombies, et un client v7 ne voit jamais le BR (son `MODES_SALLE` l'ignore). **Ordre de déploiement : le serveur d'abord, puis la fusion du client** ; un client v8 devant un serveur v7 reçoit `erreur{version}`. Le 7 sera retiré dans un second temps.

## Statut

**Implémenté** sur la branche `feat/battle-royale` (vagues 0 à 4 : contrat, modules purs, serveur, intégration, assemblage client ; vague 5 : test de bout en bout `scripts/fps/e2e_br.mjs` et documentation, `CLAUDE.md` et `serveur-fps/README.md` à jour). Pas encore déployé : le serveur d'abord, puis la fusion du client (voir l'ordre de déploiement ci-dessus).

Décisions prises sur les questions ouvertes pendant l'implémentation :

- **Reconnexion en cours de partie** : hors périmètre v1 (la place est éliminée, voir « Décisions de conception » et « Risques »).
- **Chat vocal** : désactivé en BR (les messages `voix*` sont ignorés par la salle). **Remplacé le 2026-10-29** par la proximité entre vivants et le canal des spectateurs, avec les parties multiples et le spectateur venu regarder : `2026-10-29-br-voix-parties-design.md`.
- **Rayon final de la zone** : 0 (palier 6), avec le départage de la clé de place de « Éliminations » ; la zone fermée tue tous les survivants, donc la partie ne dure jamais indéfiniment.
- **Partie comptée** : en plus de 2 joueurs atterris, durée minimale réglable par l'essai serveur `PDJ_FPS_BR_VALIDE_MS` (défaut 60 000 ms, `BR.partieValideMinMs`).
- **Snap** : les morts sortent du snap `joueurs` `BR.retraitMortSnapMs` (5 s) après leur mort et restent dans `presence` ; le client tolère l'absence de sa propre entrée.
- **Déploiement** : plafond global de 160 connexions (`PDJ_FPS_CONNEXIONS_TOTAL`), 24 par IP par défaut (`PDJ_FPS_CONNEXIONS_IP`, 60 dans le `docker-compose.yml`), volume nommé `pdj-fps-donnees` pour les statistiques.
- **Performance du site** : aucun code du BR dans le premier chargement de la page du menu ; tout reste derrière les imports dynamiques existants (`MyrtilleEasterEgg` → `next/dynamic` `Agroparc3D` → `import("@/lib/fps/jeu")`), et les statistiques ne sont demandées qu'à l'ouverture du lobby BR.

À mesurer après le déploiement : `/sante.ticMaxMs` et `docker stats` avec 50 joueurs (conteneur à 0,6 vCPU et 384 Mo), débit sortant à 10 Hz.

## Demande

Un troisième mode de jeu dans la vue Palantir, « Battle Royale », façon Fortnite :

1. **Lobby** : on arrive, on attend ses amis, l'hôte lance la partie. De 2 à 50 joueurs.
2. Tout le monde est dans un **avion** qui traverse la carte ; chacun saute quand il veut (parachute) et atterrit sur Agroparc.
3. On part **sans arme à feu** ; on **fouille les bâtiments** (et leurs abords) pour trouver des armes, puis on se bat.
4. Une **zone** (tempête) se réduit par paliers, les centres sont **aléatoires** (chaque cercle est tiré au hasard dans le précédent) : attente, rétrécissement, dégâts croissants hors zone.
5. **Mort définitive** : pas de réapparition, on regarde la fin en spectateur.
6. **+50 PV** à chaque élimination (au tueur).
7. À la fin : **statistiques**, notamment le **nombre de TOP 1** de chaque joueur, persistées entre les parties.

## Décisions de conception (fermées, ne pas rediscuter)

- **Troisième salle, un seul serveur, une seule WebSocket** : `ModeSalle = "arene" | "zombies" | "br"`. `serveur-fps/src/index.ts` instancie `salleBr` à côté de `salleArene` et `salleZombies` ; le message `mode{mode:"br"}` change un client de salle (même mécanique que les zombies, décision prise AVANT de quitter l'ancienne salle dans `lib/fps/salons.ts`).
- **Option `br` de `Salle`, jamais l'option `zombies`** : `zombies` coupe le joueur contre joueur (`match.ts` ~938-959), impose les règles de santé des zombies et le cycle de matchs. Le BR a son champ `private readonly br: ServiceBr | null`, créé par `creerServiceBr` (`lib/fps/match-br.ts`), branché par `ContexteSalle` comme `match-zombies.ts`. Dans la salle BR : ni Elsa, ni voitures, ni circulation PNJ, ni événements, ni avion des tigres, ni tigres largués, ni bus C3, ni fumigène, ni frappe aérienne, ni régénération.
- **Logique PURE** (`lib/fps`, sans horloge ni hasard globaux : horloge `maintenant` et `alea` injectés, aucun import de `three`, du DOM ni de `lib/tigre3d`, `scene.json` en paramètre) : le Dockerfile n'embarque que `lib/fps` et `lib/agroparc3d`.
- **Identité des stats = pseudo normalisé** : `cleStats(pseudo)` (voir §Stats). Aucune authentification (site privé).
- **Le serveur est autoritaire sur** : la phase, l'avion, la chute (simulation en temps réel à partir des dernières entrées du client, voir §Chute), la zone et ses dégâts, le butin, les ramassages, les soins, les éliminations, les places. Les munitions de chargeur et de réserve restent côté client (comme l'arène), le serveur ne suit que `munSpeciale`.
- **Un client modifié peut tricher** (munitions, tirs vraisemblables dans les bornes existantes) : accepté, site privé, comme pour l'arène.
- **Mort = fin de participation** : un joueur éliminé reste dans la salle (`enJeu` vrai, `vivant` faux, posture `"mort"`), reçoit tous les snaps et regarde ; il ne revient jamais. Quitter la partie en cours = abandon = éliminé. Reconnexion en cours de partie : impossible (le serveur oublie la salle, le client repart dans l'arène, la place BR est éliminée).
- **Arrivée pendant une partie** : le nouvel arrivant entre dans le lobby en état `attente` (pas admis, ne peut ni lancer ni rejoindre) ; il rejoindra la partie suivante. Pas de spectateur extérieur.
- **Tactile** : indisponible (comme les zombies), la carte de mode est désactivée.

## Règles de jeu chiffrées

Toutes les constantes vivent dans `lib/fps/br-regles.ts` (`BR`), `lib/fps/br-zone.ts` (paliers), `lib/fps/br-chute.ts` (`CHUTE_BR`, `AVION_BR`) et `lib/fps/br-butin.ts` (tables).

### Lobby et lancement

| Constante | Valeur |
| --- | --- |
| Joueurs (lobby compris) | `BR.joueursMax = 50` |
| Minimum pour lancer | `BR.joueursMin = 2` (essais : `PDJ_FPS_BR_MIN_JOUEURS`) |
| Hôte | premier arrivé de `ctx.joueurs()` (passe au suivant s'il part) |
| Décompte | plafond `BR.decompteMaxMs = 30 000` ; il se termine **dès que tous les admis ont envoyé `rejoindre`** (= « prêt »), jamais avant `BR.decompteMinMs = 3 000` |
| Affichage de la fin avant retour au lobby | `BR.finAffichageMs = 30 000` |

- Le lobby est une phase de la machine d'états du service : `lobby` → `decompte` → `vol` → `jeu` → `fin` → `lobby`.
- `lancerPartie` (message existant, `difficulte` ignorée) : réservé à l'hôte, en phase `lobby`, avec au moins `joueursMin` membres **et sans conflit de noms** (deux membres dont le nom de base, pseudo normalisé sans chiffres finaux, est identique : voir §Statistiques), sinon ignoré ; dans le cas du conflit, `etat.conflitNoms = true` (lobby : « Deux joueurs portent le même nom : renommez-vous. »). Tous les membres présents sont **admis**. Le service tire la `graine` du butin (interne, jamais diffusée) et fixe `nbObjets`, passe en `decompte`, diffuse `br{etat}` immédiatement.
- Les clients voient `moi.admis`, montent le jeu (`lancerJeu(..., {mode:"br"})`) qui envoie `rejoindre` ; `Salle.rejoindreBr` refuse (`refus{rejoindre, lobby}`) un joueur non admis, place les autres **dans l'avion à l'arrêt** (voir §Avion).
- **Fin du décompte** : tous les admis ont rejoint (au moins 3 s écoulées) ou le plafond de 30 s est atteint. Si moins de `joueursMin` joueurs sont à bord à ce moment, la partie est annulée, tout le monde est ramené au lobby (`etat.annule = true`, « Départ annulé : pas assez de joueurs ») ; sinon l'avion part.
- **Admission** : elle dure jusqu'à la fin de la phase `vol` (`finT` de l'avion). Un admis qui n'a pas encore envoyé `rejoindre` au départ monte encore en vol (placé à la position courante de l'avion, il peut sauter aussitôt) ; `rejoindre` après `finT` est refusé (`refus{rejoindre, lobby}`) et l'admission est annulée (il revient en attente).
- Si la salle se vide (tout le monde déconnecté) : retour au lobby **synchrone dans `liberer`** (le serveur saute le tic d'une salle vide, `nombreJoueurs() > 0`), sans stats, comme `retourLobby` des zombies.

### Avion

Module `lib/fps/br-chute.ts` : `AVION_BR = { altitude: 350, vitesse: 30 }` (`y ≤ 400`, borne de `Salle.recevoirEtat`).

- **Trajectoire** `tracerVolBr(bornes, alea, debutT)` : cap aléatoire uniforme ; la droite passe à un point tiré dans un disque de 110 m de rayon autour du centre des `bornes` de la carte jouable, perpendiculairement au cap ; elle est coupée aux bords des `bornes` ; longueur minimale 450 m (jusqu'à 20 tirages, repli : axe long de la carte par le centre). Durée de vol = longueur / 30 m/s ≈ 15 à 30 s.
- Pendant le **décompte** l'avion est immobile au point de départ ; il part à la fin du décompte (`debutT`). Tous les joueurs à bord sont à la position de l'avion (le serveur écrit `j.p`, `etatT` rafraîchi à chaque tic pour échapper à `INACTIF_MS`).
- **Saut libre** : message `sauter`, accepté pendant la phase `vol` (pas pendant le décompte) ; le joueur quitte l'avion au point courant, vitesse horizontale initiale = vitesse de l'avion (30 m/s dans le cap). **Éjection forcée** : à `finT` de l'avion, tous les joueurs encore à bord sautent d'office.
- Un joueur à bord est invisible dans le snap (ni avatar ni `j` du snap) ; l'avion est décrit par `br.etat.avion` et dessiné par le client (fil de fer, le modèle de `rendu-tigres.ts`).
- **Admission tardive** : un admis qui monte en vol (voir §Lobby) est placé à la position courante de l'avion ; l'éjection forcée de `finT` s'applique à lui aussi.

### Chute libre et parachute

Module PUR `lib/fps/br-chute.ts`, utilisé à l'identique par le client (prédiction) et le serveur (autorité). Pas fixe `CHUTE_BR.pas = 1/60 s`.

| Phase | Vertical | Horizontal |
| --- | --- | --- |
| Chute libre | vitesse cible −35 m/s (regard à l'horizon) à −55 m/s (piqué, regard à −60° ou plus bas), accélération 20 m/s² | vitesse max 30 m/s (horizon) à 6 m/s (piqué), accélération 14 m/s² |
| Parachute | vitesse cible −6,5 m/s, rattrapage en `ouvertureMs = 1200` (accélération 40 m/s²) | vitesse max 14 m/s, accélération 8 m/s² |

- Formule : `t = clamp(−tangage / (π/3), 0, 1)` ; `vyCible = lerp(−35, −55, t)` ; `vhMax = lerp(30, 6, t)` ; direction horizontale = (`avance` · cap + `lateral` · droite) normalisé (norme ≤ 1) × `vhMax` ; sous parachute `vyCible = −6,5` et `vhMax = 14`.
- **Pilotage** : touches de déplacement (avance, arrière, gauche, droite) + regard ; aucune autre action.
- **Ouverture** : manuelle par un appui sur la touche de saut (front montant), refusée avant `delaiOuvertureMinMs = 1000` après le saut (le même appui qui quitte l'avion n'ouvre pas) ; **automatique** quand la hauteur au sol passe sous `hauteurOuvertureAutoM = 90` (hauteur au-dessus de `solSous` : un toit compte comme sol). Une fois ouvert, le parachute ne se referme pas.
- **Collisions** : `resoudre(monde, p, 0.4, 1.8)` à chaque pas pour les murs ; atterrissage dès que `p[1] ≤ solSous(monde, x, z, y, 0.5)` : l'état devient `atterri`, `p[1]` = le sol, vitesse nulle. Toit ou sol, aucun dégât de chute. Un joueur qui tombe sur un bâtiment « creux » (toit ouvert, voir §Carte) traverse jusqu'au sol intérieur.
- **Invulnérabilité** : `protegeJusqua = Infinity` du placement dans l'avion jusqu'à l'atterrissage, puis `t + BR.protectionAtterrissageMs` (**5 000 ms**) ; la tempête, elle, passe toujours (`infliger` ne teste pas la protection).
- **Portée atteignable** (à vérifier par test) : depuis 350 m, environ **8 s de chute libre** (de 350 à 90 m, soit 260 m à 35-55 m/s) puis environ **14 s sous voile** (90 m à 6,5 m/s), soit une portée latérale de l'ordre de 330 à 430 m selon le piqué. Test : depuis tout point de saut de la droite de l'avion, les quatre coins des `bornes` (cas pire : l'avion suit l'axe court) sont atteignables.

#### Protocole de la chute : serveur autoritaire en temps réel, client prédictif

Le serveur n'accepte aucun `etat` d'un joueur à bord ou en vol (`Salle.recevoirEtat` retourne tôt : `this.br?.enVol(j.id) || this.br?.aBord(j.id)`). Il simule la chute **en temps réel** à partir des dernières entrées reçues :

- Client → serveur, 30 Hz pendant la chute : `{ t: "chute", lacet, tangage, avance, lateral, ouvrir }` (`avance` et `lateral` dans [−1, 1] ; `ouvrir` vrai tant que le client n'a pas vu `chute: "voile"` pour lui dans le snap, donc idempotent). Aucun numéro de séquence, aucun nombre de pas, aucun budget : le client ne peut pas simuler plus vite que le temps réel parce que c'est le serveur qui avance.
- À chaque tic (60 Hz), le service accumule le temps écoulé et applique `floor(dt / CHUTE_BR.pas)` fois (au plus 6) `pasChute(...)` avec les dernières entrées de chaque joueur en vol (mêmes fonction et état initial arrondi au centimètre que le client). Sans message depuis 1,5 s, les dernières entrées continuent de servir et l'ouverture automatique sous 90 m s'applique : un joueur absent atterrit quand même.
- Le client **prédit** avec le même `pasChute` (accumulateur de pas fixes, indépendant du rendu) et envoie ses entrées. Il ne se recale pas en vol sauf si l'écart avec le snap retardé dépasse 25 m. Il prédit aussi l'atterrissage mais reste figé au sol prédit jusqu'au message `atterri` (au plus un aller-retour).
- Le service recopie dans `j.p`, `j.v`, `j.lacet`, `j.tangage`, `j.posture = "air"` ; `etatT = t`. Le snap porte `chute: "libre" | "voile"` (champ optionnel d'`EtatJoueurSnap`).
- Serveur → client : `saut` (privé) à l'ordre ou à l'éjection, donne l'état initial ; `atterri` (privé) à l'atterrissage : `p` serveur, `j.seq = -1` (le client repart de `etatInitial(p)` et de ses `etat` normaux) ; si la position prédite du client diffère de plus de **0,5 m** il s'y téléporte (la parité « à l'octet près » ne tient qu'entre deux exécutions du même moteur JavaScript : `Math.sin` et `Math.cos` peuvent différer entre V8, JavaScriptCore et SpiderMonkey, et le décalage des entrées par la latence ajoute quelques mètres, d'où ce recalage).
- La phase `chute` du client n'utilise ni `etape()` ni la gravité de `MOUV` (`chuteMax = 45` y serait en dessous de la chute piquée) ; le plafond serveur `PLAFONDS.vitesseVerticaleMax = 45` ne concerne que `etat`, qui n'est pas utilisé en vol.

### Carte : bâtiments fouillables

Les 142 bâtiments de `scene.json` sont des prismes PLEINS (on marche sur les toits, on n'entre pas). Pour « fouiller les bâtiments » le BR creuse **20 bâtiments** (monde BR propre, `lib/fps/br-carte.ts`) :

- **Les 4 bâtiments déjà creusés des zombies** (index 72, 70, 62, 74, murs, cloisons, fenêtres et mobilier de `CREUSAGES` de `zombies-carte.ts`), **sans les portes** (les pièces de type `porte` sont omises : l'ouverture reste libre). Avec toutes les portes fermées 0 m² intérieur est atteignable ; sans elles ≈ 1 500 m² sont atteignables de l'extérieur (mesuré).
- **16 bâtiments creusés procéduralement** (`choisirBatimentsProcedurals`) : emprise (aire du polygone) entre **100 et 700 m²**, hauteur ≥ 3,5 m, remplissage du rectangle englobant dans le repère à 16° ≥ **0,8** (sur `scene.json` : 20 éligibles aux anciens seuils 150 m² / 0,85, **25** aux nouveaux ; 8 de ces 25 ont plus de 8 sommets : L, courbes), hors les 4 précédents et hors le bâtiment 114 (qui porte aussi le Truck Muche), choisis par éloignement maximal (point le plus éloigné des choisis, en partant du plus grand) pour couvrir la carte. **La coque se pose sur le plus grand rectangle inscrit dans le polygone** (`rectangleInscrit(anneau)`, repère à 16°, recherche sur une grille de 0,5 m, trous exclus), jamais sur le rectangle englobant (il dépasserait l'emprise jusqu'à 15 % et mordrait la chaussée ou un voisin) ; le reste de l'emprise devient une cour libre. Repli : s'il y a moins de 16 bâtiments éligibles, tous sont pris (le test exige au moins 12). Coque de quatre murs (demi-épaisseur 0,2 m, à l'intérieur du rectangle inscrit), une porte ouverte de 2,6 m au milieu de l'arête sud (`t` minimal du repère à 16°, comme `BATIMENTS_CREUX`), une fenêtre de 1,8 m (type `fenetre`, bloque les joueurs, pas les balles) au milieu de l'arête nord, 0 à 2 meubles (étagère) tirés par hachage de l'index.
- Un bâtiment creux est un prisme `creux` de hauteur 0 (aucune collision, comme `construireMondeZombies`) dont les murs sont des pièces ajoutées après l'index 142. Le toit est **ouvert** (pas de plafond : on voit le ciel en fil de fer, un parachutiste qui y tombe atterrit à l'intérieur) ; le rendu passe l'option `sansPlafond`.
- Les wall-run, double saut et escalade de l'arène restent actifs (`sansParkour` faux) ; les toits des bâtiments pleins (≥ 3,5 m) sont atteignables au parachute et par saut de mur.
- `bornes` du monde BR = celles de `construireMonde(scene)` sur les **142 bâtiments d'origine** : `construireMonde` calcule les bornes sur les centres de TOUS les `buildings`, pièces ajoutées comprises (les milieux de murs du bâtiment 126 feraient passer `x1` de 392,4 à environ 411) ; `construireMondeBr` **réécrit donc `monde.bornes`** à partir des 142 centres d'origine, comme `construireMondeZombies` le fait pour les siennes : x ≈ −348,8 à 392,4, z ≈ −257,9 à 233,7 (741 × 492 m, demi-diagonale ≈ 445 m). L'avion, la zone et les tirages dépendent de ces bornes.
- **Truck Muche** : `donneesBr` retire le POI `truck` (`pois.filter(p => p.type !== "truck")`, comme `donneesZombies`) : `obstacleTruck` ne crée alors aucun prisme, pas de mur invisible (en BR `dyn = mondeDynamiqueVide()` ne dessine pas le Truck).
- **Marque de la scène** : `donneesBr(scene).data` porte `modeCarte: "br"` (champ optionnel de `SceneData`, `lib/agroparc3d/types.ts`). `estSceneZombies` (`lib/fps/minimap.ts`) teste la présence d'un `type` sur la première pièce synthétique, que la scène BR a aussi : elle renvoie donc **faux** quand `modeCarte === "br"`, et `ZONE_CARTE` (appelée par `GrandeCarte.tsx` et `minimap-couche.ts`) garde la zone de l'arène au lieu de `BORNES_ZOMBIES`. `Agroparc3D.tsx` (lignes ~645-648) choisit aussi la scène de la carte : branche `br`.

### Butin (loot)

Emplacements (`pointsButin(scene, monde): PointButin[]`, déterministe) répartis en quatre **pools**. Les comptes ci-dessous sont des estimations de conception (le lot B3 les remesure avec les rectangles inscrits et les consigne dans le test) :

| Pool | Points | Définition |
| --- | --- | --- |
| `interieur` | 400 à 600 (à remesurer) | grille de 3 m dans l'intérieur des 20 bâtiments creux, à ≥ 1,0 m des murs, libre pour un joueur de rayon 0,4 (`resoudre`) |
| `toit` | ≈ 2 000 | grille de 5 m sur les toits des bâtiments pleins de ≥ 3,5 m de haut et ≥ 40 m², à ≥ 1,5 m du bord, `y` = hauteur du toit |
| `facade` | ≈ 780 | à 1,8 m des murs extérieurs, un tous les 10 m d'arête (arêtes ≥ 4 m, bâtiments ≥ 30 m²) |
| `route` | ≈ 610 | `pointsApparition` (collision.ts) |

- **Nombre d'objets** : `nbObjets = clamp(9 × nbJoueurs, 120, 480)` (2 joueurs : 120, 50 joueurs : 450). Essai : `PDJ_FPS_BR_OBJETS`.
- **Tirage** (`genererButin(points, graine, nb)`, PRNG `mulberry32(graine)`) : répartition des objets par pool **45 % intérieur, 10 % toit, 30 % façade, 15 % route** (les toits sont atteignables au parachute sans entrer nulle part : le meilleur butin doit se trouver dans les bâtiments) ; pas deux objets à moins de 1,8 m. **Débordement de quota** : quand un pool ne peut pas placer son quota (plus de point à 1,8 m des déjà posés), le reste est reversé aux autres pools au prorata de leur quota. **Le serveur est seul à tirer** : à la synchro (`rejoindre`) il envoie la liste initiale complète en `butin{ajoutes}` (≈ 450 objets, ≈ 20 Ko, une fois par joueur, à lui seul) ; le client ne régénère rien (pas de `graine` publique, pas de parité de tirage à garantir entre moteurs JavaScript ni entre versions de `scene.json`).
- **Genre** : arme 46 %, munitions 24 %, bandage 18 %, potion de bouclier 12 %.
- **Rareté d'une arme** (poids [commun, peu commun, rare, légendaire] par pool) : intérieur [30, 30, 25, 15] ; toit [35, 35, 22, 8] ; façade [60, 28, 10, 2] ; route [75, 20, 5, 0]. Le test de rareté vérifie que la part de rare + légendaire est strictement plus haute à l'intérieur que sur les toits.

| Rareté | Armes (ids du registre `armes.ts`) |
| --- | --- |
| commun | `pistolet`, `mini_uzi` |
| peu commun | `revolver`, `mitraillette`, `pompe` |
| rare | `fusil_assaut`, `mitrailleuse`, `sniper`, `epee` (arme blanche) |
| légendaire | `railgun`, `minigun`, `magnum_dore`, `bazooka`, `lance_grenades` |

Exclus du butin : `rayon` (zombies), `fumigene` (dépend du bus C3). Les spéciales et uniques se rangent dans le slot `speciale` avec `munSpeciale = STATS[arme].chargeur` (railgun 6, minigun 150, magnum 8, lance-grenades 6, bazooka 3).

- **Munitions** : trois classes (`ClasseMunitions`) : `legeres` (pistolet, mini_uzi, mitraillette), `moyennes` (fusil_assaut, mitrailleuse), `cartouches` (pompe, revolver, sniper). Une boîte donne **+2 chargeurs** de réserve à l'arme de la classe portée (principale, sinon secondaire) ; sans arme compatible, `ramasser` est refusé (`ramasse{ok:false, raison:"inutile"}`). Réserve plafonnée à 6 chargeurs par arme (côté client).
- **Ramasser une arme** : chargeur plein + `BR.reserveChargeursDepart = 2` chargeurs de réserve. Une arme déjà portée (même id) devient +1 chargeur. Les spéciales sans recharge n'ont pas de réserve.
- **Soins** (stock côté serveur, messages privés `inventaire`) :
  - **bandage** : +20 PV, 3 s d'usage, utilisable seulement sous 75 PV, ne dépasse pas 75 PV ; pile de 5.
  - **potion de bouclier** : +50 de bouclier, 4 s d'usage, utilisable sous 100 de bouclier, plafond `JEU.bouclierMax = 100` ; pile de 3.
  - L'usage est interrompu par `utiliser{objet:null}`, un changement d'arme (`main`), un coup reçu ou la mort ; un seul usage à la fois ; le soin s'applique à la fin.
- **Coffres** : pas de coffre ; la « fouille » est le déplacement dans les bâtiments creux (objets visibles au sol avec halo coloré par rareté). Le ramassage est manuel (voir plus bas).

### Inventaire

- Slots existants : `principale`, `secondaire`, `couteau` (arme blanche), `speciale` (touches 1 à 4). **Départ** : aucun slot à feu (`EQUIPEMENT_DEPART_BR = { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true, sansSecondaire: true }`, `main = "couteau"`, 100 PV, 0 bouclier). `sansSecondaire?: true` est le pendant de `sansPrincipale` (nouveau champ optionnel d'`Equipement`, géré par `armeDuSlot`, `slotDeLArme`, `copierEquipement`, `normaliserEquipement`, `consommerSpeciale`).
- **Ramassage** (`ramasser{id}`, touche d'interaction E existante, `interagir`) : objet existant, à ≤ `BR.rayonRamassageM = 2,5` m en horizontal et ≤ 2,5 m en hauteur, joueur vivant, pas dans l'avion ni en vol. Une arme va dans le slot de sa catégorie ; **échange** : l'arme qui occupait le slot tombe aux pieds du joueur (nouvel objet) ; l'épée remplace l'arme blanche (le couteau ne tombe pas). Le slot de l'arme ramassée passe en main.
- **Lâcher** (`lacher{slot}`, nouvelle action `lacher`, `KeyU`) : jette l'arme du slot (`principale`, `secondaire`, `speciale`) à ses pieds. Nouvelles actions de touches : `soigner` (`KeyH`, bandage), `potion` (`KeyJ`), `lacher` (`KeyU`).
- **À la mort** : la victime lâche toutes ses armes (jusqu'à 4 objets) et ses soins restants (1 objet bandage et 1 objet potion par pile non vide, quantité conservée dans l'objet), dispersés à moins de 1,5 m de son corps.
- Objets lâchés : ids numériques continuant ceux du butin initial, diffusés par `butin{ajoutes}`. Aucun objet n'expire.

### Zone (tempête)

Module PUR `lib/fps/br-zone.ts`.

- **Cercle initial** : centre = centre des `bornes`, rayon `rayonInitialPour(bornes)` = **demi-diagonale des bornes + 10 m ≈ 455 m** (les quatre coins sont dans la zone dès le départ : personne ne prend de dégâts en atterrissant dans un coin). Le jeu commence à `debutT` = départ de l'avion. Le palier 1 reste à 250 m.
- **Paliers** (`PALIERS_ZONE`), chaque palier = une attente puis un rétrécissement vers un nouveau cercle :

| Palier | Rayon cible | Attente | Rétrécissement | Dégâts hors zone |
| --- | --- | --- | --- | --- |
| 1 | 250 m | 120 s | 60 s | 1 PV/s |
| 2 | 150 m | 60 s | 45 s | 2 PV/s |
| 3 | 85 m | 45 s | 40 s | 4 PV/s |
| 4 | 45 m | 40 s | 30 s | 7 PV/s |
| 5 | 20 m | 30 s | 25 s | 10 PV/s |
| 6 | 0 m (fermeture totale) | 20 s | 20 s | 15 PV/s |

  Durée totale 535 s (≈ 9 min) à l'échelle 1 ; après le palier 6 la zone est fermée (rayon 0, dégâts 15 PV/s) et tue tous les survivants en une dizaine de secondes : la partie ne peut pas durer indéfiniment. Les dégâts sont ceux du palier courant, **pendant l'attente comme pendant le rétrécissement**.
- **Échelle de durée selon le nombre d'admis** (`echelleDureeZone(nbAdmis)`, appliquée à `echelleZone` dans `creerServiceBr`) : **0,6** pour 2 à 4 joueurs, **0,8** jusqu'à 10, **1,0** au-delà (le bord avance à 4,4 m/s au plus quand un joueur sprinte à 12,5 m/s : la pression vient des dégâts, et ceux des paliers 1 et 2 sont négligeables ; sans cette échelle deux joueurs subiraient 535 s). L'attente du palier 1 reste ≥ 70 s (0,6 × 120 s = 72 s) parce que le dernier joueur touche le sol environ 50 s après le départ de l'avion (vol 15 à 30 s + 8 s de chute + 14 s sous voile) ; un test fige `echelleDureeZone(n) × 120 s ≥ 70 s`. L'essai `PDJ_FPS_BR_ZONE_ECHELLE` (défaut absent, ex. 0,08 pour les tests de bout en bout) remplace cette échelle et lève le plancher.
- **Tirage aléatoire du centre** (`tirerCercleSuivant(precedent, rayon, bornes, alea, centres?)`) : le nouveau cercle est **inclus dans le précédent** (`|c1 − c0| + r1 ≤ r0`) ET son centre est dans la carte jouable : `c1` dans les `bornes` rétrécies de `0,5 × r1` de chaque côté (rectangle vide : centre des `bornes`). Tirage uniforme par rejet dans le disque de rayon `r0 − r1` autour de `c0` (40 tentatives) ; avec une probabilité de 60 %, le tirage est biaisé vers le **centroïde de l'un des 20 bâtiments creux** (`centresBatimentsEligibles` = ces 20 centres, les seuls où l'on trouve un abri et du butin) plus un bruit de ±15 m dans la limite d'inclusion, pour éviter la majorité de finales sans abri (mesuré sur 2 000 simulations avec un tirage uniforme) ; repli : `c1 = c0`. Un test mesure la part de cercles biaisés (≈ 60 % ± tolérance sur 2 000 graines). **Zone jouable réelle** : puisque le centre peut approcher le bord des bornes à `0,5 × r1`, un cercle de 250 m peut sortir de la carte jusqu'à 125 m ; la partie jouable des paliers 2 et 3 est donc plus petite que le rayon affiché (le HUD dessine le cercle entier). Les cercles sont tirés tous à l'avance dans `genererPlanZone` (avec `alea` du service) mais seul le cercle suivant est transmis aux clients.
- **Interpolation** : pendant le rétrécissement le centre et le rayon évoluent linéairement de `cercles[i−1]` à `cercles[i]` (l'inclusion tient à chaque instant). `etatZone(plan, t)` est la source unique côté serveur ; le client reconstruit l'état avec `etatDepuisZoneBr(zone, t)` à partir du message (parité testée).
- **Dégâts** : **appliqués à chaque tic** avec un accumulateur fractionnaire par joueur (`degatsParS × dt` ajoutés au reste ; la partie entière ≥ 1 est infligée) : les morts de tempête ont ainsi des instants distincts (les dégâts par paquets d'une seconde les auraient fait tous mourir au même tic, dans l'ordre de leur distance au centre). Chaque joueur vivant hors zone (distance au centre > rayon courant, à bord exclus, en vol compris) subit `ctx.infliger(j, pv, null, "tempete", "corps", "couteau", t)` : le bouclier absorbe d'abord, aucun kill crédité, cause de mort `"tempete"`, message `degats` avec `par: ""`. L'invulnérabilité d'atterrissage n'est pas ignorée par la tempête : `infliger` ne la teste pas, seuls tirs et coups la respectent. **La tempête n'interrompt pas les soins** : `surDegats(j, cause, t)` ignore la cause `"tempete"` (sinon un bandage de 3 s ou une potion de 4 s ne s'achèveraient jamais hors zone, ce qui n'est pas le comportement d'un BR).
- Pas de palier 0 : la tempête ne fait rien avant `debutT` et personne n'est hors zone au départ.

### Mêlée en BR

Le couteau tue en un coup en arène (`MELEE.couteau.degats = 100`, cadence 0,5 s, vitesse ×1,3) et l'épée fait 140 : avec 100 PV, 0 bouclier, 50 joueurs sur 0,36 km² et aucune arme à feu au départ, le premier qui croise un autre au sol le tue, ce qui contredit « fouiller puis se battre ». Le BR a donc **ses propres dégâts de mêlée** : `BR.melee = { couteau: 34, epee: 70 }` (couteau : 3 coups ; épée : 2 coups, toujours jusqu'à 3 cibles), exportés par `br-regles.ts` (`degatsMeleeBr(id)`) et appliqués par `Salle` (là où les dégâts de `coup` sont calculés) quand la salle est BR. Le client ne prédit aucun dégât de mêlée (les retours de touche sont confirmés par le message `degats` du serveur) ; un test de `match.br` couvre les trois coups. L'épée reste « rare » dans le butin. L'invulnérabilité d'atterrissage passe à 5 s.

### Éliminations, +50 PV, spectateur

- **+50 PV au tueur** (`BR.pvKill = 50`) : à la mort d'un joueur par l'arme ou la mêlée d'un autre joueur, le tueur gagne 50 PV **plafonnés à `JEU.pvMax = 100`** (le surplus est perdu : pas de conversion en bouclier, fidèle à la demande). **Seul un tueur vivant est soigné** et un kill n'est compté que si la victime meurt **avant ou au même tic que le tueur** (`ServiceBr.tueurValide`) : un kill croisé au même tic compte pour les deux, une explosion ou un projectile qui tue après la mort du lanceur ne crédite rien. Pas de soin pour une mort par tempête ou abandon. Message privé `soin{pv, bouclier, motif:"kill"}` (évite que le client prenne la hausse de PV pour de la régénération).
- **Pas de régénération** : `Salle.tic` passe `{ pvMax: 100, delaiMs: Infinity, pvParS: 0 }` à `regenerer` quand `this.br` est défini.
- **Mort définitive** : la branche `br` de `mourir` réutilise le tronc commun (voir §Modifications de `match.ts`, point 5) : `vivant = false`, `posture = "mort"`, `morts++`, `serie = 0`, message `mort` à tous (`delai: 0`, causes `"arme" | "tempete" | "abandon"`, killcam existante : rejeu de 2,5 s à la vue du tueur puis carte du tueur 1,5 s), compteurs du tueur (`kills`, `serie`, `serieMax`, `killsParArme`) s'il est valide, puis `br.surMort` (lâcher du butin AVANT l'effacement de l'arme spéciale). Ni réapparition (`reapparitionT` reste `null`), ni bus C3, ni frappe, ni `terminer`.
- **Spectateur** : après la killcam, le joueur mort suit un joueur vivant (le tueur s'il vit, sinon le plus proche à la mort), change de cible (clic, ou actions `spectateurSuivant` / `spectateurPrecedent`), voit son arme et ses PV, a accès à la mini-carte et à la grande carte, au tableau des scores et au menu pause. Il reçoit les joueurs vivants dans le snap ; les morts sortent du snap `joueurs` 5 s après leur mort (`BR.retraitMortSnapMs`, la killcam dure 4 s) mais restent dans `presence`. Le client tolère l'absence de sa propre entrée. « Quitter » le ramène au lobby. Les spectateurs reçoivent le snap complet : un ami mort pourrait annoncer des positions par un canal externe (accepté, site privé, documenté).
- **Place** : à la mort, `place provisoire = vivants restants + 1` (affichée à l'écran de mort). La place définitive du bilan suit la clé de mort **(instant de mort du tic, puis distance au centre de la zone à la mort : le plus proche du centre est mieux classé, puis id)** : il n'y a plus d'ex æquo, donc un seul TOP 1 par partie.

### Fin de partie

- Test de victoire à chaque tic du service (donc après toutes les morts du tic) : `vivants ≤ 1` pendant les phases `vol` et `jeu`.
- **Un survivant** : il est TOP 1. **Zéro survivant** (les derniers joueurs meurent au même tic) : le vainqueur est le premier de la clé de place ci-dessus (le plus proche du centre de la zone à sa mort) ; il n'y a **jamais plusieurs TOP 1**. **Joueur qui part** (quitter, déconnexion, inactivité de 20 s hors vol) : éliminé (cause `abandon`, sans +50 PV pour personne), et le test de victoire est refait. **Tout le monde déconnecté** : retour au lobby, pas de stats.
- **Partie non comptée** : une partie n'est enregistrée dans les stats que si **au moins 2 joueurs ont atterri** et que **60 s** (`BR.partieValideMinMs`) se sont écoulées depuis le départ de l'avion ; sinon ni `parties` ni `top1` ne bougent (deux amis qui se déconnectent à tour de rôle pendant le vol ne gagnent aucun TOP 1) ; le bilan s'affiche avec « Partie trop courte : non comptée ».
- Phase `fin` : `br{etat}` immédiat avec `bilan` (lignes triées par place, durée, vainqueur), `statsBr` à tous, affichage `finAffichageMs`, puis retour au lobby (`retirerJoueur` de tous, membres remis en attente). Le client libère la souris (pointer lock) pour afficher le bilan. Le bilan et `ResultatPartieBr` sont construits à partir d'**instantanés** `{ pseudo, couleur, kills, degats, tMort, distZone }` pris par le service à `surMort` et à `liberer` (un joueur déconnecté disparaît de la table avant le calcul).

### Statistiques persistées

- Table des stats par joueur : `{ cle, pseudo, top1, parties, kills, meilleurePlace, derniereT }` (`LigneStatsBr`). Une partie comptée (voir §Fin de partie) compte pour tous ceux qui sont montés dans l'avion.
- **Clé = pseudo normalisé** : `cleStats(pseudo) = nettoyerPseudo(pseudo)` (NFC, caractères autorisés, espaces réduits) puis `toLocaleLowerCase("fr")`. Le pseudo retenu est celui **affiché dans la salle** (après `pseudoUnique`). Trois garde-fous parce que le défaut est `"Agent"` et que `pseudoUnique` suffixe les doublons (`Agent2`, `Toto2`) : (1) `estPseudoCompte(pseudo)` est faux pour `/^Agent\d*$/i` : ces joueurs jouent mais **ne sont pas enregistrés**, et le lobby affiche « Choisissez un nom pour compter vos TOP 1 » ; (2) deux membres dont le **nom de base** (`cleStats` sans chiffres finaux) est identique **bloquent le lancement** (`etat.conflitNoms`, message « renommez-vous ») ; (3) l'identité reste le pseudo (décision prise : un renommage en cours de partie change la fiche). Le dernier pseudo affiché (avec sa casse) est conservé pour l'affichage.
- **Persistance** : fichier JSON `{ version: 1, joueurs: Record<cle, LigneStatsBr> }`, chemin donné par `PDJ_FPS_BR_STATS` (prod : `/donnees/stats-br.json`, dev : `donnees/stats-br.json` dans le dossier courant de `serveur-fps`), **écriture atomique ASYNCHRONE et sérialisée** (`fs.promises` : fichier temporaire du MÊME dossier, `fsync`, `rename`, une seule écriture à la fois, la suivante enchaînée sur la promesse précédente) en fin de partie, **synchrone seulement dans `arreter()` (SIGTERM)** ; un `fsync` synchrone bloquerait la boucle de tic partagée par les trois salles. Lecture au démarrage (absent : vide ; JSON corrompu : renommé `.corrompu-<horodatage>` puis repart à vide). Volume Docker nommé `pdj-fps-donnees` monté sur `/donnees` (dossier créé avec `chown node:node` dans le Dockerfile ; ne jamais `docker compose down -v`). Si l'écriture échoue : erreur journalisée, la partie n'est pas bloquée, les stats restent en mémoire et sont réécrites à la partie suivante.
- **Lecture** : message client `statsBr` (limité à 1 toutes les 2 s) → réponse privée `statsBr{lignes (top 25), moi?}` ; diffusé à tous en fin de partie. Tri : `top1` décroissant, puis `kills` décroissant, puis `parties` croissant, puis pseudo. `GET /stats-br` de `serveur-fps` (top 50, `cache-control: no-store`, `access-control-allow-origin` seulement si l'origine passe `ORIGINES`) sert aux curieux et aux tests.

## Architecture

### Nouveaux modules PURS (`lib/fps/`, chacun avec son test)

**`br-regles.ts`** : constantes et fonctions de base.

```ts
export const BR = {
  joueursMin: 2, joueursMax: 50, decompteMaxMs: 30_000, decompteMinMs: 3_000, finAffichageMs: 30_000,
  pvKill: 50, protectionAtterrissageMs: 5_000,
  melee: { couteau: 34, epee: 70 },                 // dégâts de mêlée propres au BR (voir §Mêlée en BR)
  partieValideMinMs: 60_000, atterrisMin: 2, retraitMortSnapMs: 5_000,
  snapHz: 10, interpolationMs: 150, rewindMaxMs: 400, historiqueMs: 500,
  periodeEtatMs: 200, periodeEtatJeuMs: 1_000,
  rayonRamassageM: 2.5, reserveChargeursDepart: 2, reserveChargeursMax: 6,
  inactifMs: 20_000,
  usage: { bandage: { ms: 3_000, pv: 20, plafondPv: 75, pile: 5 }, potion: { ms: 4_000, bouclier: 50, pile: 3 } },
} as const;
export const degatsMeleeBr: (id: "couteau" | "epee") => number;
export const EQUIPEMENT_DEPART_BR: Readonly<Equipement>;
export const MAIN_DEPART_BR: Slot;                                  // "couteau"
export const REGLES_SANTE_BR: { pvMax: number; delaiMs: number; pvParS: number };  // delaiMs: Infinity
export const estClasseMunitions: (x: unknown) => x is ClasseMunitions;
```

**`br-zone.ts`** (voir §Zone).

```ts
export interface PalierZone { rayon: number; attenteMs: number; retreciMs: number; degatsParS: number }
export const PALIERS_ZONE: readonly PalierZone[];
export interface Cercle { c: [number, number]; r: number }
export interface PlanZone { debutT: number; cercles: Cercle[]; paliers: readonly PalierZone[] }   // cercles[0] initial, cercles[i] = cible du palier i
export interface EtatZone {
  palier: number;                        // 1..nbPaliers, nbPaliers une fois fermée
  phase: "attente" | "retrecit" | "fermee";
  centre: [number, number]; rayon: number;
  cible: Cercle | null;                  // cercle visé (null une fois fermée)
  t0: number; t1: number; t2: number;    // début d'attente, début du rétrécissement, fin du rétrécissement (ms serveur)
  degatsParS: number;
}
export function tirerCercleSuivant(precedent: Cercle, rayon: number, bornes: Boite, alea: () => number, centres?: readonly [number, number][]): Cercle;
export function genererPlanZone(o: { bornes: Boite; debutT: number; alea: () => number; centresBatiments?: readonly [number, number][]; echelle?: number; paliers?: readonly PalierZone[]; rayonInitial?: number }): PlanZone;
export const rayonInitialPour: (bornes: Boite) => number;                       // demi-diagonale + 10 m
export const echelleDureeZone: (nbAdmis: number) => number;                      // 0,6 (≤ 4), 0,8 (≤ 10), 1,0
export function etatZone(plan: PlanZone, t: number): EtatZone;
export function horsZone(e: EtatZone, x: number, z: number): boolean;
export function distanceAuBord(e: EtatZone, x: number, z: number): number;      // > 0 dehors, < 0 dedans (m)
export function zoneBrPublique(plan: PlanZone, t: number): ZoneBr;              // message
export function etatDepuisZoneBr(z: ZoneBr, t: number): EtatZone;               // même résultat côté client
```

**`br-chute.ts`** (avion et chute ; voir §Avion et §Chute).

```ts
export const AVION_BR: { altitude: number; vitesse: number; longueurMinM: number };
export const CHUTE_BR: { pas: number; libre: {...}; voile: {...}; hauteurOuvertureAutoM: number; delaiOuvertureMinMs: number };
export type { AvionBr } from "./protocole";                                      // UNE seule définition (protocole.ts), réexportée ici
export function tracerVolBr(bornes: Boite, alea: () => number, debutT: number, o?: { altitude?: number; dureeMs?: number }): AvionBr;
export function positionAvionBr(a: AvionBr, t: number): Vec3;                    // à l'arrêt avant debutT
export function capAvionBr(a: AvionBr): number;                                  // lacet, convention du jeu
export function vitesseAvionBr(a: AvionBr): Vec3;
export interface EtatChute { p: Vec3; v: Vec3; voile: boolean; tVoile: number; tLibre: number; atterri: boolean }
export interface EntreesChute { lacet: number; tangage: number; avance: number; lateral: number; ouvrir: boolean }
export function etatChuteInitial(p: Vec3, v: Vec3): EtatChute;
export function hauteurAuSol(monde: Monde, p: Vec3): number;
export function pasChute(e: EtatChute, en: EntreesChute, monde: Monde): EtatChute;     // UN pas fixe, sans effet de bord
export function pasDuTemps(dtMs: number, reste: number): { pas: number; reste: number };  // temps écoulé -> nombre de pas fixes (≤ 6)
```

**`br-carte.ts`** (voir §Carte).

```ts
export interface DonneesBr { data: SceneData; pieces: PieceSynth[]; creux: number[]; bornes: Boite }    // data.modeCarte = "br", POI truck retiré
export function rectangleInscrit(anneau: Vec2[], trous?: Vec2[][]): Rect | null;      // plus grand rectangle inscrit, repère à 16°
export function choisirBatimentsProcedurals(scene: SceneData): number[];
export function piecesProcedurales(scene: SceneData, indices: readonly number[]): PieceSynth[];
export function donneesBr(scene: SceneData): DonneesBr;                         // COPIE la scène (comme donneesZombies), jamais de mutation
export function construireMondeBr(scene: SceneData): Monde;                     // MUTABLE (brèches), une instance par salle ; RÉÉCRIT monde.bornes (142 bâtiments d'origine)
export function pointsButin(scene: SceneData, monde: Monde): PointButin[];      // déterministe, ordre stable
export function centresBatimentsEligibles(scene: SceneData): [number, number][]; // les 20 bâtiments creux, pour la zone
```

**`br-butin.ts`** (voir §Butin).

```ts
export const ARMES_PAR_RARETE: Record<Rarete, readonly (ArmeFeuId | "epee")[]>;
export const POIDS_RARETE_PAR_POOL: Record<PoolButin, [number, number, number, number]>;
export const REPARTITION_POOLS: Record<PoolButin, number>;                       // 0,45 / 0,10 / 0,30 / 0,15
export const nbObjetsPour = (nbJoueurs: number): number;
export function raretePourArme(ref: ArmeFeuId | "epee"): Rarete;
export function classeMunitions(arme: ArmeFeuId): ClasseMunitions | null;
export function genererButin(points: readonly PointButin[], graine: number, nb: number): ObjetBr[];   // débordement de quota reversé aux autres pools
export interface ResultatRamassage {
  ok: boolean; raison?: "inutile" | "loin" | "inconnu";
  equip?: Equipement; main?: Slot; munSpeciale?: number;
  lache?: { genre: GenreObjetBr; ref: ObjetBr["ref"] }[];
  ajoutMunitions?: { arme: ArmeFeuId; chargeurs: number };
  soins?: Partial<Record<"bandage" | "potion", number>>;
}
export function appliquerRamassage(equip: Readonly<Equipement>, soins: Readonly<{ bandage: number; potion: number }>, objet: ObjetBr): ResultatRamassage;
```

**`br-stats.ts`** (voir §Stats).

```ts
export interface StatsBr { version: 1; joueurs: Record<string, LigneStatsBr> }
export interface ResultatPartieBr { t: number; lignes: { pseudo: string; place: number; kills: number }[] }   // lignes des seuls pseudos comptés
export interface PersistanceBr { lire(): StatsBr; enregistrer(partie: ResultatPartieBr): StatsBr }   // injecté, implémenté par serveur-fps (écriture asynchrone sérialisée)
export const statsVides = (): StatsBr;
export function cleStats(pseudo: string): string;
export function estPseudoCompte(pseudo: string): boolean;                       // faux pour /^Agent\d*$/i
export function nomDeBase(pseudo: string): string;                              // cleStats sans chiffres finaux (conflit de noms)
export function appliquerPartie(stats: StatsBr, partie: ResultatPartieBr): StatsBr;  // pur, nouvelle valeur
export function classementStats(stats: StatsBr, n: number): LigneStatsBr[];
export function lireStatsBr(brut: unknown): StatsBr;                                // validation, tolérante
```

**`match-br.ts`** : `creerServiceBr(ctx: ContexteSalle, opts: OptionsServiceBr): ServiceBr`.

```ts
export interface OptionsServiceBr {
  alea: () => number;
  scene: SceneData;                       // pour pointsButin / centres (le monde est ctx.monde, issu de construireMondeBr)
  stats?: PersistanceBr;                  // absent : stats en mémoire seulement
  joueursMin?: number; decompteMaxMs?: number; decompteMinMs?: number; finAffichageMs?: number;
  dureeVolMs?: number;                    // essais : durée du trajet de l'avion (la vitesse en découle)
  altitude?: number; echelleZone?: number; nbObjets?: number;
}
```

Machine d'états (lobby, décompte « prêt », annulation, places, victoire, bilan par instantanés, stats, `br{etat}` ≤ 5 Hz en lobby, décompte et fin, 1 Hz et sur changement en vol et en jeu), tempête à accumulateur, remise à zéro des compteurs de chaque joueur au lancement (le service met `kills`, `morts`, `tirs`, `touches`, `tetes`, `degats`, `serie`, `serieMax`, `killsParArme` à zéro directement sur les `JoueurSalle` : `demarrerMatch` ne s'exécute jamais en BR et sans cela les kills s'additionneraient d'une partie à l'autre, donc les stats aussi). Le service est composé de deux sous-services dont les interfaces vivent dans `match-contexte.ts` : **`VolBr`** (`match-br-vol.ts` : avion, saut, éjection, chute simulée, atterrissage, invulnérabilité) et **`ButinBr`** (`match-br-butin.ts` : tirage, ramassage, lâcher, inventaires, soins, usages, messages `butin` / `inventaire` / `soin` / `ramasse`).

```ts
// forme attendue (lot A)
export interface VolBr {
  demarrer(bord: JoueurSalle[], bornes: Boite, alea: () => number, debutT: number, o: { dureeMs?: number; altitude?: number }): AvionBr;
  entrer(j: JoueurSalle, t: number): Sortie[];          // à l'arrêt ou en vol (admission tardive)
  sauter(j: JoueurSalle, t: number): Sortie[];
  recevoirChute(j: JoueurSalle, m: Extract<MessageClient, { t: "chute" }>, t: number): void;
  tic(t: number): Sortie[];                             // éjection forcée à finT, pas de chute, atterrissages
  aBord(id: string): boolean; enVol(id: string): boolean; chute(id: string): "libre" | "voile" | undefined;
  avion(): AvionBr | null; atterris(): number; retirer(id: string): void; reinitialiser(): void;
}
export interface ButinBr {
  initialiser(points: readonly PointButin[], graine: number, nb: number): void;
  recevoir(j: JoueurSalle, m: MessageClient, t: number): Sortie[];     // ramasser, lacher, utiliser
  tic(t: number): Sortie[];                                           // fin des usages
  surDegats(j: JoueurSalle, cause: CauseMort, t: number): void;        // ignore "tempete"
  lacherALaMort(j: JoueurSalle, t: number): Sortie[];
  synchro(idDest: string): Sortie[];                                   // liste initiale complète + écarts + inventaire
  reinitialiser(): void;
}
```

### Interface `ServiceBr` (`match-contexte.ts`)

```ts
export interface ResumeBr { phase: PhaseBr; joueurs: number; vivants: number; palier?: number }
export interface ServiceBr {
  tic(maintenant: number): Sortie[];                 // machine d'états, avion, chute, tempête, usages, victoire, diffusion de br{etat}
  reinitialiser(maintenant: number): Sortie[];       // retour au lobby à blanc
  synchro(idDest: string): Sortie[];                 // etat, butin (liste complète), inventaire : réponse à rejoindre
  admis(id: string): boolean;                        // condition de rejoindre (jusqu'à finT de l'avion)
  entreeJoueur(j: JoueurSalle, maintenant: number): Sortie[];   // place le joueur dans l'avion (appelé par Salle.rejoindreBr)
  aBord(id: string): boolean;                        // dans l'avion : absent du snap
  enVol(id: string): boolean;                        // à bord ou en chute : `etat` ignoré
  chute(id: string): "libre" | "voile" | undefined;  // pour le champ `chute` du snap
  recevoir(j: JoueurSalle, m: MessageClient, maintenant: number): Sortie[];  // lancerPartie, sauter, chute, ramasser, lacher, utiliser, statsBr
  surDegats(j: JoueurSalle, cause: CauseMort, maintenant: number): void;      // interrompt l'usage d'un soin, sauf cause "tempete"
  tueurValide(tueur: JoueurSalle, maintenant: number): boolean;               // vivant, ou mort au même tic
  surMort(cible: JoueurSalle, tueur: JoueurSalle | null, cause: CauseMort, maintenant: number): Sortie[];  // instantané, place, +50 PV (tueur vivant), butin lâché ; appelé AVANT l'effacement de l'arme spéciale
  liberer(j: JoueurSalle, maintenant: number): Sortie[];  // départ : instantané, éliminé si en partie, hôte suivant, victoire éventuelle, retour au lobby synchrone si la salle est vide
  arrivee(j: JoueurSalle, maintenant: number): Sortie[];  // nouveau membre du lobby
  enCours(): boolean;
  etat(): EtatPartieBr;
  resume(): ResumeBr;
}
```

### Protocole v8 (`lib/fps/protocole.ts`)

- `VERSION_PROTOCOLE = 8` (commentaire d'en-tête : « v8 : Battle Royale »), `VERSIONS_ACCEPTEES = [7, 8]` (le serveur refuse tout autre `m.v` ; le retrait du 7 est une PR ultérieure).
- `ModeSalle = "arene" | "zombies" | "br"`, `MODES_SALLE` en conséquence.
- `CauseMort` += `"tempete" | "abandon"`.
- `Equipement.sansSecondaire?: true` (copié par `copierEquipement` seulement s'il est défini).
- `EtatJoueurSnap.chute?: "libre" | "voile"`.
- Types : `PhaseBr = "lobby" | "decompte" | "vol" | "jeu" | "fin"`, `Rarete = "commun" | "peu_commun" | "rare" | "legendaire"`, `ClasseMunitions = "legeres" | "moyennes" | "cartouches"`, `GenreObjetBr = "arme" | "munitions" | "bandage" | "potion"`, `PoolButin = "interieur" | "toit" | "facade" | "route"`, `PointButin { p: Vec3; pool: PoolButin }`.

```ts
export interface ObjetBr { id: number; genre: GenreObjetBr; ref: ArmeFeuId | "epee" | ClasseMunitions | null; p: Vec3; qte?: number }  // qte : soins lâchés à la mort
export interface AvionBr { depart: [number, number]; arrivee: [number, number]; altitude: number; vitesse: number; debutT: number; finT: number }   // défini UNE seule fois ici, réexporté par br-chute.ts
export interface ZoneBr {
  palier: number; nbPaliers: number; phase: "attente" | "retrecit" | "fermee";
  t0: number; t1: number; t2: number;          // ms serveur (début d'attente, début et fin du rétrécissement)
  c0: [number, number]; r0: number;            // cercle en cours au début du palier
  c1: [number, number]; r1: number;            // cercle visé
  degats: number;                              // PV/s hors zone
}
export interface JoueurBr { id: string; pseudo: string; couleur: string; admis: boolean; vivant: boolean; aBord: boolean; kills: number; place: number | null }
export interface LigneBilanBr { id: string; pseudo: string; couleur: string; place: number; kills: number; degats: number; survieS: number }
export interface BilanBr { vainqueurs: string[]; dureeMs: number; lignes: LigneBilanBr[] }
export interface LigneStatsBr { cle: string; pseudo: string; top1: number; parties: number; kills: number; meilleurePlace: number; derniereT: number }
export interface EtatPartieBr {
  phase: PhaseBr; hote: string; capacite: number; minJoueurs: number;
  debutT: number; finT: number;                // début de la phase ; fin prévue du décompte (plafond) / de l'affichage de la fin (0 sinon)
  avion: AvionBr | null; zone: ZoneBr | null;
  vivants: number; total: number;              // restants / partants
  joueurs?: JoueurBr[];                        // seulement en lobby, décompte et fin (50 lignes, 5 Hz maxi)
  bilan?: BilanBr; annule?: true; conflitNoms?: true; nonComptee?: true;
}
```

Messages **client → serveur** :

```ts
| { t: "sauter" }
| { t: "chute"; lacet: number; tangage: number; avance: number; lateral: number; ouvrir: boolean }   // 30 Hz en chute, entrées seulement
| { t: "ramasser"; id: number }
| { t: "lacher"; slot: "principale" | "secondaire" | "speciale" }
| { t: "utiliser"; objet: "bandage" | "potion" | null }       // null : interrompre
| { t: "statsBr" }
```
(`lancerPartie`, `rejoindre`, `quitter`, `mode`, `main`, `etat`, `tir`, `coup`, `pseudo`, `vueScores`, `voix*`, `ping` existent déjà et gardent leur sens ; `arme` et `equiper` sont ignorés en BR comme en zombies.)

Messages **serveur → client** :

```ts
| { t: "br"; etat: EtatPartieBr }
| { t: "saut"; p: Vec3; v: Vec3; lacet: number }                       // privé : début de ta chute
| { t: "atterri"; p: Vec3 }                                           // privé : fin de ta chute
| { t: "butin"; ajoutes?: ObjetBr[]; retires?: number[] }              // à la salle ; la synchro (privée) envoie la LISTE INITIALE COMPLÈTE (≈ 450 objets) plus les écarts cumulés
| { t: "ramasse"; ok: boolean; id: number; raison?: "inutile" | "loin" | "inconnu" }   // privé : réponse à ramasser
| { t: "inventaire"; bandage: number; potion: number; usage: { objet: "bandage" | "potion"; finT: number } | null }  // privé
| { t: "soin"; pv: number; bouclier: number; motif: "kill" | "bandage" | "potion" }                            // privé
| { t: "statsBr"; lignes: LigneStatsBr[]; moi?: LigneStatsBr }
```

Le message `salons` devient `{ t:"salons", arene:{joueurs, enJeu}, zombies:{phase, joueurs, manche}, br?:{phase, joueurs, vivants, palier?} }` (`br` OPTIONNEL côté type : rien ne casse entre le lot A et les suivants ; un client v7 ignore le champ). `equipement` gagne un champ optionnel `ajoutMunitions?: { arme: ArmeFeuId; chargeurs: number }` (le client ajoute des chargeurs à la réserve sans remplir le chargeur). `refus.raison` n'ajoute rien (`lobby` = non admis, `plein` = 50). `pseudoUnique`, `PSEUDO_DEFAUT` et les couleurs : voir §Modifications de `match.ts`.

Ids : joueurs `j<n>`, tigres `t<n>` et `z<n>` (inchangés) ; le butin est numérique (message `butin`), jamais dans `tir.touches`.

### Modifications de `match.ts`

Toutes calquées sur `this.zombies` mais distinctes :

1. `OptionsSalle.br?: Omit<OptionsServiceBr, "alea">` et `OptionsSalle.fabriqueBr?: (ctx, opts) => ServiceBr` (injection du service factice dans les tests, défaut `creerServiceBr`) ; `OptionsSalle.rewindMaxMs?` et `historiqueMs?` (défaut `REWIND_MAX_MS` = 300 et `HISTORIQUE_MS` = 400 ; **400 et 500 en BR** : à 10 Hz avec 150 ms d'interpolation un tireur voit sa cible avec environ 150 ms + ping de retard, le ping tolérable passerait de ≈ 190 à ≈ 150 ms avec 300) ; `private readonly br: ServiceBr | null` ; `this.fin = options.zombies || options.br ? null : ...` ; `this.busC3 = options.zombies || options.br ? null : creerEtatBusC3(...)`.
2. `connecter` : capacité `this.zombies ? ZOMBIES.joueursMax : this.br ? BR.joueursMax : JEU.connexionsMax` ; `...(this.br ? this.br.arrivee(j, maintenant) : [])`. `deconnecter` : `this.br ? this.br.liberer(j, maintenant) : []` (l'objet `j` est celui déjà retiré de la table : le service s'en sert tel quel). **Couleurs** : `PALETTE` n'a que 16 couleurs pour 50 joueurs ; les 16 premiers joueurs gardent `PALETTE`, les suivants reçoivent `couleurJoueur(rang)` (teinte HSL en pas d'angle d'or, `lib/fps/couleurs.ts`, pur, testé, sortie `#rrggbb` distincte des 16 premières).
3. `recevoir` : `rejoindre` → `this.br ? this.rejoindreBr(j, maintenant) : ...` ; `arme`/`equiper` ignorés si `this.br` ; `lancerPartie`, `sauter`, `chute`, `ramasser`, `lacher`, `utiliser`, `statsBr` → `this.br.recevoir(...)` (sinon `[]`) ; `main` : si un usage est en cours, `br.surDegats(j, "arme", t)` l'interrompt ; les messages `voix*` sont **ignorés en BR** (chat vocal désactivé en v1 : `correspondants` ouvrirait 49 `RTCPeerConnection` par client et ≈ 1 225 échanges SDP à 50 joueurs).
4. `rejoindreBr` : `if (j.enJeu) return []` ; non admis → `refus{rejoindre, lobby}` ; `nombreEnJeu() >= BR.joueursMax` → `refus plein` ; `j.enJeu = true` ; `return [...this.br.entreeJoueur(j, t), ...this.br.synchro(j.id)]` ; **la `presence` n'est PAS renvoyée à toute la salle à chaque `rejoindre`** (50 `rejoindre` × 4,8 Ko ≈ 240 Ko par client en quelques secondes face à `TAMPON_MAX_OCTETS` de 512 Ko, et un `setState` React chacune) : `rejoindreBr` lève `presenceSale` et `tic` émet **une seule `presence` fusionnée par tic**. `ctx.placerJoueur` prend une option `{ prive: true }` : l'`apparition` n'est adressée qu'au joueur concerné (les autres le voient par le snap, et à bord personne n'est dans le snap).
5. `mourir`, branche `if (this.br)` avant celle de l'arène : (a) `vivant = false`, `posture = "mort"`, `mur = 0`, `accroupi = false`, `glisse = false`, `morts++`, `serie = 0`, `memoSante = null` ; (b) `tueur = par && par !== cible ? par : null`, `valide = tueur && this.br.tueurValide(tueur, t)` ; (c) message `mort` à tous construit ICI (`infoTueur` est privé à `Salle`, `delai: 0`) ; (d) si `valide` : `tueur.kills++`, `serie++`, `serieMax`, `killsParArme` ; (e) `this.br.surMort(cible, valide ? tueur : null, cause, t)` **avant** d'effacer `cible.equip.speciale` / `munSpeciale` (sinon l'arme spéciale n'est pas lâchée) ; (f) `presence` (fusionnée) ; retour anticipé : ni `reapparitionT`, ni `vehicules.liberer`, ni frappe, ni `terminer`.
6. `infliger` : après les dégâts, `this.br?.surDegats(cible, cause, maintenant)` (interrompt un soin, sauf cause `"tempete"`). Les dégâts de mêlée viennent de `degatsMeleeBr` quand `this.br`.
7. `recevoirEtat` : retour anticipé `|| this.br?.enVol(j.id)`.
8. `tic` : `if (!this.zombies && !this.br)` pour le cycle de matchs ; régénération avec `this.zombies?.sante(j) ?? (this.br ? REGLES_SANTE_BR : undefined)` ; `if (this.br) sorties.push(...this.br.tic(maintenant))` ; branche `INACTIF_MS` : en BR un vivant sans `etat` depuis `BR.inactifMs` hors vol → `retirerDeLArene` (branche `br` : `retirerJoueur` + `br.liberer`) ; la boucle de réapparition ne fait rien (`reapparitionT` reste `null`) ; `presence` fusionnée (point 4).
9. `retirerDeLArene` : branche `if (this.br)` : `[...this.retirerJoueur(j, t), ...this.br.liberer(j, t)]`.
10. `snap` / `sortiesSnap` : en BR, joueurs à bord exclus, morts exclus 5 s après leur mort, champ `chute` ajouté, un seul message `a: "joueurs"` à `BR.snapHz` (10 Hz), pas de snap « spectateurs » (lobby sans snap) ; `periode = 1000 / (this.br ? BR.snapHz : JEU.snapHz)`.
11. `consommerSpeciale` : repli sur `"couteau"` quand ni principale ni secondaire n'existent (`sansSecondaire`). `placerJoueur` et `equiper` : `armeDuSlot` null géré (le client a `main = couteau`).
12. `infoMatch` : `objectif: 0`. `resumeBr(): ResumeBr | null` pour `salons` et `/sante`.
13. Aucun autre `if (this.zombies)` n'est étendu au BR ; en particulier les tirs et coups entre joueurs restent ceux de l'arène (aucun tir allié à neutraliser : tout le monde est ennemi).

### `salons.ts`

`capaciteSalle(mode)` : `zombies → ZOMBIES.joueursMax`, `br → BR.joueursMax`, sinon `JEU.connexionsMax`. `messageSalons(arene, zombies, br?)`. `decisionMode` inchangé (refus `lobby` si en jeu, `plein` si la salle est pleine). **Nouveau** : `modeDeSalle<T>(salle: T, salles: Record<ModeSalle, T>): ModeSalle` (pur, testé : le mode d'un client dans la salle BR n'est jamais pris pour « arène », sinon sa demande `mode{arene}` recevrait un écho et il resterait dans la salle BR avec sa place et peut-être le rôle d'hôte).

### `serveur-fps/src/index.ts`

- `salleBr = new Salle(construireMondeBr(scene), DEPARTS_BR, Math.random, Date.now(), { br: { scene, stats: persistance, ...essais }, rewindMaxMs: 400, historiqueMs: 500 })` ; `DEPARTS_BR` : un point quelconque des `bornes` (jamais utilisé en vol).
- `Client.salle: Salle` reste ; `changerMode` utilise une table `SALLES: Record<ModeSalle, Salle>` et `modeDeSalle(c.salle, SALLES)` (remplace `salleActuelle: c.salle === salleZombies ? "zombies" : "arene"`) ; `salons()` appelle `messageSalons` avec `salleBr.resumeBr()` ; `/sante` gagne `br: { joueurs, enJeu, phase, vivants }`, `ticMaxMs`, `ticsLents` (compteur des tics > 8 ms) et `alerte: true` si un tic a dépassé 8 ms dans la dernière minute ; la boucle de tic ne fait tourner `salleBr` que si `nombreJoueurs() > 0`.
- **Versions** : `traiter` accepte `m.v` dans `VERSIONS_ACCEPTEES`. Un client v7 n'est admis que dans l'arène et les zombies.
- Limites : `CONNEXIONS_TOTAL_MAX = 96 → 160` (50 BR + 64 arène + 8 zombies + marge de poignées de main) ; `CONNEXIONS_PAR_IP_MAX` **garde son défaut 24** et devient paramétrable par `PDJ_FPS_CONNEXIONS_IP` (le docker-compose de la prod peut le monter à 60 pour 50 amis derrière une même IP de bureau : pas de changement du défaut d'un endpoint public) ; `PDJ_FPS_CONNEXIONS_TOTAL` pour le total.
- `SPECTATEUR_INACTIF_MS` (15 min) ne s'applique pas à un client dont la salle BR est en lobby avec au moins deux membres.
- `serveur-fps/src/stats-br.ts` (I/O fichier ; `index.ts` utilise déjà `node:fs`, mais ce module porte la persistance) : `creerPersistanceBr(fichier: string): PersistanceBr` (lecture au démarrage, écriture atomique asynchrone sérialisée, repli en mémoire) ; flush synchrone dans `arreter()` (SIGTERM).
- `GET /stats-br` (voir §Stats).
- Variables d'essai (`dureeEnv` / `process.env`) : `PDJ_FPS_BR_STATS`, `PDJ_FPS_BR_MIN_JOUEURS`, `PDJ_FPS_BR_DECOMPTE_MS` (plafond), `PDJ_FPS_BR_VOL_MS` (durée du trajet de l'avion), `PDJ_FPS_BR_ALTITUDE`, `PDJ_FPS_BR_ZONE_ECHELLE`, `PDJ_FPS_BR_OBJETS`, `PDJ_FPS_BR_FIN_MS`.
- `serveur-fps/docker-compose.yml` : `PDJ_FPS_BR_STATS: /donnees/stats-br.json`, volume nommé `pdj-fps-donnees:/donnees`, `PDJ_FPS_CONNEXIONS_IP: 60`, `cpus: 0.6` (au lieu de 0.3) et `mem_limit: 384m` (au lieu de 256m) : le CPU d'un tic reste faible (≈ 2 ms × 60, ≈ 12 % d'un cœur), le goulot est le débit sortant ; on part à 0,6 et on MESURE (la mémoire du VPS note un gel du 24/06 par saturation CPU et un `docker.service` capé à 180 %). `Dockerfile` : `RUN mkdir -p /donnees && chown node:node /donnees` avant `USER node`, `VOLUME /donnees`. `.gitignore` : `donnees/`. `README.md` : tableau des variables, section « Trois salles », protocole v8, ordre de déploiement (serveur d'abord), correction de « messages ≤ 4 Ko » (le code accepte 16 Ko).

### Réseau et charge

- Snap BR à **10 Hz** (`BR.snapHz`) avec interpolation client de **150 ms** (`BR.interpolationMs` remplace `JEU.interpolationMs` dans `jeu.ts` quand `modeBR`, huit usages à passer par une constante `interpMs`). Un seul `JSON.stringify` par snap et une diffusion `a: "joueurs"` (aux vivants ET aux morts). Compensation de latence : `rewindMaxMs = 400`, `historiqueMs = 500` en BR (point 1 de `match.ts`).
- Mesure de conception (EtatJoueurSnap ≈ 171 octets) : 50 joueurs ≈ 8,6 Ko par snap, 10 Hz ≈ 86 Ko/s par client, ≈ 4,3 Mo/s sortants au pire (tous vivants ; ≈ 2 Mo/s en moyenne sur la partie, moins avec les morts retirés du snap 5 s après leur mort). Budget fixé et vérifié par `match.br.charge.test.ts` : snap ≤ 10 500 octets pour 50 joueurs, coût moyen d'un tic ≤ 2 ms, **et volume cumulé par client du tic de lancement** (50 `rejoindre` + synchro de la liste initiale du butin) bien en dessous de `TAMPON_MAX_OCTETS` (512 Ko). Ce test se lance SEUL (conteneur plafonné). Pas de filtre par distance dans cette version (un joueur tué à 350 m au sniper a besoin de son tueur pour la killcam) ; piste documentée si la charge réelle l'exige. Alerte exploitable : `/sante.alerte` (tic > 8 ms).
- `br{etat}` : `joueurs` seulement en lobby, décompte et fin (≈ 5,5 Ko à 50) ; en vol et en jeu, sans liste, 1 Hz et sur changement.
- `chute` ≤ 30 Hz par joueur en vol (20 à 30 s) : négligeable ; `MESSAGES_PAR_SECONDE_MAX = 90` suffit.

## Client

### Moteur (`jeu.ts` et modules)

- `JeuOptions.mode = "br"` ; `modeBR` dans `lancerJeu` : `data = sceneBrute`, `donneesB = donneesBr(sceneBrute)`, `monde = construireMondeBr(sceneBrute)`, `dyn = mondeDynamiqueVide()`, intérieurs rendus par `creerRenduInterieurs(scene, donneesB.data, donneesB.pieces, { sansPlafond: true, batiments: donneesB.creux })` (la boucle de `rendu-interieurs.ts` qui parcourt `BATIMENTS_CREUX` en dur, plafonds, toits et centres, est généralisée à la liste `batiments`, `BATIMENTS_CREUX` par défaut pour les zombies). Armes : `ControleurArmes(EQUIPEMENT_DEPART_BR, MAIN_DEPART_BR, { reserveChargeurs: BR.reserveChargeursDepart })` ; `ControleurArmes.ajouterReserve(arme, chargeurs)` (plafond `reserveChargeursMax`) pour `equipement.ajoutMunitions` ; `pvMaxMoi()` = 100 ; régénération coupée (`regenDelaiS` infini, la détection « PV qui remontent = régénération » ignore le mode BR, le son et l'indicateur partent du message `soin`).
- **`lib/fps/jeu-br.ts` (PUR, testé)** :
  - `ControleurVol` (modèle : `ControleurTitan` de `jeu-monstres.ts`) : phases `"avion" | "libre" | "voile" | "attenteAtterri" | "sol"`, `entrerAvion(avion, tsServeur)`, `surSaut(m: saut)`, `maj(dt, entrees, monde)` (accumulateur de pas fixes, `pasDuTemps`), `message(lacet, tangage): chute | null`, `surAtterri(p)` (téléportation si l'écart dépasse 0,5 m), `etat()`, `positionAvion(tsServeur)`. Recalage en vol seulement au-delà de 25 m d'écart avec le snap retardé.
  - `ButinClient` : `appliquer(m: butin)` (la liste initiale complète arrive par le même message), `proches(p, rayon)`, `pourDessin()`. **Aucune génération côté client.**
  - `inviteRamassage(butin, p, equip, soins): { id; libelle; detail; refuse? } | null` (objet le plus proche à ≤ `rayonRamassageM`, libellé « Ramasser Fusil d'assaut (rare) », « Boîte de cartouches (aucune arme compatible) »).
  - `SuiviSpectateur` : cible suivie (le tueur s'il vit, sinon le plus proche), `suivant()`, `precedent()`, bascule si la cible meurt.
  - `etatHudBr(...)` : champs scalaires du HUD.
- **Phases du joueur** : à bord (caméra à la position de l'avion + 2 m, regard libre ; touche de saut → `sauter`), chute libre/parachute (caméra à la position simulée, vue à la première personne, pas d'arme, pas de tir), au sol (mouvement normal, `etat` à 30 Hz reprend), spectateur (mort).
- `case "apparition"` en BR : place le joueur dans l'avion (pas de téléportation au sol) ; `case "mort"` en BR : killcam puis spectateur (`reapparitionFin` jamais armé) ; `case "br"` : transmis à `jeu-br` et à la zone ; `case "saut"`, `"atterri"`, `"butin"`, `"ramasse"`, `"inventaire"`, `"soin"`.
- **Touches** (`lib/fps/touches.ts`, `ACTIONS_NOUVELLES`) : `soigner` (`KeyH`), `potion` (`KeyJ`), `lacher` (`KeyU`), facultatives ; `interagir` (E) ramasse ; Espace (`saut`) saute de l'avion puis ouvre le parachute. `HudEtat.invite` += `"ramasser"` ; `InvitesAction` affiche `[E] détail` avec la touche réelle.

### Rendu (`rendu-br.ts`, non pur)

- `creerRenduBr(scene)` : avion en fil de fer (extrait de `rendu-tigres.ts`, `geometriesAvion` et `PARACHUTE` exportés depuis un module commun `rendu-avion.ts`), parachute attaché à l'avatar d'un joueur en `chute: "voile"`, objets du butin en pool indexé par id (jamais de `group.clear()` ni de géométrie recréée par image : modèle `majBonus` de `rendu-objets-zombies.ts`, et NON `creerArmesLachees` qui fuit), modèle d'arme `creerModeleArmeMonde`, colonne lumineuse additive et halo coloré selon la rareté (gris, vert, bleu, ambre), objets visibles à moins de 60 m (distance + `InstancedMesh` si > 300 objets), mur de tempête (`CylinderGeometry` ouvert, `side: DoubleSide`, matériau additif sans halo `sansHalo`, `depthWrite: false`, **une seule géométrie** dont seul le `scale` varie), anneau de la prochaine zone au sol.
- Avatars : joueurs à bord non dessinés (absents du snap) ; avatar en chute libre : pose « air » existante, parachute ouvert au-dessus de la tête en `voile`.
- Sons (`sons.ts`, WebAudio synthétisé) : vent de chute (monte avec la vitesse), ouverture du parachute, grondement et avertissement de zone (« hors zone » en alerte), ramassage de butin (`ramassage("arme")`), usage d'un soin.
- Mini-carte et grande carte : `RadarFrame.zoneBr?: { x, z, r, prochainX, prochainZ, prochainR }`, dessinée par `dessinerZoneBr` (`hud/dessinCarte.ts`, modèle `dessinerFrappeZone`) avant les joueurs ; `RADAR_CAPACITES.joueurs` passe de 16 à 50.

### Interface (`app/components/arene/`)

- **Choix du mode** : `CARTES_MODE` gagne `{ mode: "br", titre: "Battle Royale", description: "Largage en avion, fouille des bâtiments, tempête qui se resserre : un seul survivant." }` ; `compteurMode` traite `br` (« Lobby · 7/50 », « Salle pleine », « Partie en cours · 12 en vie ») sans retomber sur la branche zombies ; grille des cartes en `repeat(auto-fit, minmax(150px, 1fr))` pour trois cartes ; `indisponibles` contient `"br"` sur tactile.
- **`LobbyBR.tsx`** (`aside[aria-label='Battle Royale']`, calqué sur `LobbyZombies.tsx`) : eyebrow « Chacun pour soi », titre, `ChoixMode`, statut (`joueurs/50`), message de l'hôte (« Vous êtes l'hôte : lancez la partie quand tout le monde est là. » / « En attendant l'hôte… » / « Il faut au moins 2 joueurs. » / « Deux joueurs portent le même nom : renommez-vous. » / « Choisissez un nom pour compter vos TOP 1. » / « Départ annulé : pas assez de joueurs. » / **arrivant en cours de partie : « Partie en cours : N en vie · zone palier k/6 — rejoignez à la suivante. »**, tiré de `salons.br` et de `br{etat}` envoyé aux membres en attente), champ « Nom de joueur » (l'aide précise que les statistiques sont rattachées au nom), liste des joueurs défilante (50 lignes, hôte), règles courtes, **palmarès « TOP 1 »** (section repliable : tableau Joueur / TOP 1 / Parties / Kills / Meilleure place, ligne du joueur en `data-moi`, chargé par `statsBr` à l'ouverture), réglages et touches (le chat vocal est absent en BR), bouton « Lancer la partie » (hôte seul, collant en bas). `lobby-modele.ts` : `situationLobbyBR(partie, monId, connecte)`, `TEXTE_BR`, `REGLES_BR`, `commandesLobbyBR`.
- **`useArene` / `contrats`** : `UseArene.br: EtatPartieBr | null`, `statsBr`, `salons.br` (la recopie explicite de `setSalons` ajoute `br: m.br`), `case "br"` (annonces de phase : « L'avion décolle », « La zone se resserre dans 0:42 », « N joueurs restants »), reconnexion générique (`modeVouluRef.current !== "arene"` renvoie `mode`), `texteRefus` par mode, remise à zéro de l'état BR au changement de mode, `lancerPartie()`.
- **HUD** (`HudArene.tsx`, branche `br = hud?.mode === "br"`) : `BarreBR` (haut centre : « 37 EN VIE », tes kills, phase de la zone, décompte local), `BlocZone` (« LA ZONE SE FERME DANS 0:42 » / « RÉTRÉCISSEMENT », distance au bord en m, flèche vers le centre, « HORS ZONE : −4 PV/s » écrit en toutes lettres), `BlocInventaire` (slots, bandages, potions, touches réelles), altitude et vitesse en vol (`HudEtat.altitude`), invite de saut/ouverture (« [Espace] Sauter de l'avion », « [Espace] Ouvrir le parachute »), `FilEliminations` (« Tué par la tempête », « A quitté la partie »), `ZoneVive` pour les annonces vocales (`PRIORITE_VIVE`), `BandeauManche`-like pour les changements de phase de zone. Masqués en BR : `BarreMatch`, `AnnoncesElsa`, `BandeauEvenement`, `IconeSort`, frappe, `ChoixEquipement` (`choixEquipementActif` faux). `BlocVie` avec `regenParS: 0` (ligne de régénération masquée). `pause` exclut la fin BR.
- **Mort et spectateur** : `EcranMort` branche BR (killcam normale sans choix d'équipement ni « Réapparition dans N s », puis bandeau « Éliminé · place #N sur M », nom du joueur suivi, boutons Précédent / Suivant avec leurs touches, « Quitter »). La grande carte reste disponible morte en BR.
- **`FinDePartieBR.tsx`** (modèle `FinDePartieZombies.tsx` : libère le pointer lock, focus différé de 1,5 s sur « Rejouer », compte à rebours jusqu'au retour au lobby) : titre « TOP 1 » / « Victoire » ou « #N sur M », vainqueur nommé, ma place, mes kills, durée, tableau des places, puis « TOP 1 cumulés » (`statsBr`, ma ligne en `data-moi`).
- CSS : uniquement des tokens `--ag-*` (test `hud-contraste.test.ts`), aucune couleur en dur ni `opacity` fractionnaire.
- `Agroparc3D.tsx` : branche `arene.mode === "br"` → `LobbyBR`, `admisBR` → `monterJeu("br")`, libération de la place quand le panneau est refermé hors partie (généralisée à `mode !== "arene"`), `indisponibles`, crochet `window.__arene` : `entrer({ mode: "br" })`, `lancerBr()` (renomme puis `lancerPartie`), `sauter()`, `etat().br` (phase, vivants, zone, avion, `jeuBr` : phase du vol, hauteur, butin proche).

## Plan d'implémentation par lots

Règle : les lots d'une même vague touchent des fichiers DISJOINTS et **compilent chacun isolément** (les interfaces et les stubs sont créés avant, en vague 0) ; chaque lot termine par `npx tsc --noEmit -p .`, `cd serveur-fps && npm run typecheck` et `PATH=~/.nvm/versions/node/v22.22.1/bin:$PATH npx vitest run lib/fps` (Node 22 obligatoire, depuis la racine) sans régression.

### Vague 0 — contrat (1 lot, avant tout)

**Lot A — protocole, constantes, types, interfaces, stubs.** Aucun comportement nouveau, tout reste compilable (`salons.br` et les champs BR de l'interface sont optionnels).
- Modifie : `lib/fps/protocole.ts` (tout le §Protocole v8 : version 8, `VERSIONS_ACCEPTEES`, `ModeSalle`, `CauseMort`, `Equipement.sansSecondaire`, `copierEquipement`, `EtatJoueurSnap.chute`, types BR, `AvionBr` unique, messages client et serveur, `salons.br?`, `equipement.ajoutMunitions`), `lib/fps/equipement.ts` (`sansSecondaire` dans `armeDuSlot`, `slotDeLArme`, `normaliserEquipement` ; tests), `lib/fps/match-contexte.ts` (`ServiceBr`, `ResumeBr`, `VolBr`, `ButinBr`, option `{ prive }` de `placerJoueur`), `lib/fps/salons.ts` et `salons.test.ts` (`capaciteSalle`, `messageSalons(…, br?)`, `modeDeSalle`), `lib/fps/protocole.test.ts` (lignes 95 et 118 : version 8, `MODES_SALLE`, `VERSIONS_ACCEPTEES`), `lib/fps/match.v2.test.ts` (ligne ~1009 : version 8), `lib/fps/jeu-types.ts` (`JeuOptions.mode`, `HudEtat` champs BR optionnels et scalaires, `invite: "ramasser"`, `JeuHandle.br()`), `lib/fps/radar.ts` (`RadarFrame.zoneBr?`), `lib/agroparc3d/types.ts` (`SceneData.modeCarte?: "zombies" | "br"`), `lib/fps/minimap.ts` + son test (`estSceneZombies` faux quand `modeCarte === "br"`, `ZONE_CARTE` de l'arène pour une scène BR), `app/components/arene/contrats.ts` (`UseArene.br?`, `statsBr?`, `PropsHudArene.br?`, `Annonce.genre` += `"zone"`).
- Crée : `lib/fps/br-regles.ts` (+ `br-regles.test.ts` : invariants, `EQUIPEMENT_DEPART_BR` sans arme à feu, `REGLES_SANTE_BR` ne régénère pas via `regenerer`, `degatsMeleeBr`), et trois **stubs** `lib/fps/match-br.ts` (`creerServiceBr` lève « non implémenté »), `match-br-vol.ts` (`creerVolBr`), `match-br-butin.ts` (`creerButinBr`) exportant les types d'options.
- Tests : `copierEquipement` ne recopie `sansSecondaire` que défini ; `armeDuSlot(EQUIPEMENT_DEPART_BR, "secondaire") === null` ; `decisionMode`/`capaciteSalle`/`messageSalons`/`modeDeSalle` à trois salles ; un message `salons` sans `br` reste valide ; la scène BR n'est pas prise pour la scène zombies.

### Vague 1 — modules purs (6 lots en parallèle)

- **Lot B1 — zone** : crée `lib/fps/br-zone.ts` + `br-zone.test.ts`. Tests : inclusion `|c1 − c0| + r1 ≤ r0 + 1e-6` pour 2 000 graines et tous les paliers ; centre dans les `bornes` rétrécies (hors repli) ; déterminisme à graine fixe ; `etatZone` aux bornes des phases ; rayon décroissant ; inclusion à chaque instant de l'interpolation ; `etatDepuisZoneBr(zoneBrPublique(plan, t), t)` égal à `etatZone(plan, t)` ; `echelle` ; `rayonInitialPour(bornes)` couvre les quatre coins ; `echelleDureeZone(n) × 120 s ≥ 70 s` ; part de cercles biaisés vers les 20 bâtiments ≈ 60 %.
- **Lot B2 — avion et chute** : crée `lib/fps/br-chute.ts` + `br-chute.test.ts`. Tests : trajet de ≥ 450 m coupé aux bornes, déterminisme ; `pasChute` : vitesse terminale libre 35 à 55 m/s, voile −6,5 m/s, ouverture auto sous 90 m, ouverture manuelle refusée avant 1 s, atterrissage sur le sol et sur un toit (monde jouet), mur bloquant (`resoudre`) ; `pasDuTemps` (dt irréguliers, plafond de 6 pas) ; **portée** : depuis tout point de saut de la droite de l'avion, les quatre coins des `bornes` sont atteignables, avion sur l'axe court (cas pire) ; rejeu : deux découpages du même flux d'entrées donnent le même état (même moteur JavaScript uniquement).
- **Lot B3 — carte** : crée `lib/fps/br-carte.ts` + `br-carte.test.ts` ; modifie `lib/fps/zombies-carte.ts` (exporter `piecesCreusage` / l'accès aux `CREUSAGES`, élargir `PieceSynth.batiment` à `number` en adaptant les appels signalés par `tsc` ; **aucun changement de comportement zombies** : `zombies-carte.test.ts` reste vert). Tests : jusqu'à 16 bâtiments procéduraux éligibles (≥ 12) ET **dispersés** (distance minimale entre deux choisis ≥ 25 m, au moins trois quadrants représentés) ; **la coque est contenue dans l'emprise réelle** (coins du rectangle inscrit dans le polygone, trous exclus) ; murs `coque` fermés sauf la porte, intérieurs atteignables depuis l'extérieur par flood-fill (porte ouverte) ; `bornes` du monde BR égales à celles de `construireMonde(scene)` sur les 142 bâtiments d'origine ; POI `truck` absent et aucun prisme `fixe` ; `donneesBr` ne mute pas la scène et porte `modeCarte: "br"` ; `pointsButin` déterministe, chaque point libre (`resoudre`), pas dans l'eau, comptes par pool consignés (mesure refaite avec les rectangles inscrits ; **`interieur` ≥ quota de 50 joueurs = 0,45 × 450 ≈ 202**), `facade` à ≥ 1,8 m d'un mur.
- **Lot B4 — butin** : crée `lib/fps/br-butin.ts` + `br-butin.test.ts`. Tests : `genererButin` déterministe par graine, nombre d'objets, répartition par pool et par genre dans des tolérances, **débordement de quota reversé** (pool volontairement trop petit), `interieur ≥ quota` à 50 joueurs sur les vrais points, espacement ≥ 1,8 m, raretés par pool sur 10 000 tirages (rare + légendaire plus fréquents à l'intérieur que sur les toits), aucun `rayon` ni `fumigene`, `nbObjetsPour(2) = 120` et `(50) = 450` ; `appliquerRamassage` : arme dans le bon slot, échange (arme lâchée), retrait de `sansPrincipale` / `sansSecondaire`, épée, spéciale (`munSpeciale`), même arme = +1 chargeur, boîte de munitions sans arme compatible refusée, bandage/potion et plafonds de piles.
- **Lot B5 — stats** : crée `lib/fps/br-stats.ts` + `br-stats.test.ts`. Tests : `cleStats` (casse, accents conservés, espaces, caractères interdits), `estPseudoCompte` (`Agent`, `agent3` faux), `nomDeBase` (`Toto2` → `toto`), `appliquerPartie` (top1 pour la place 1, parties, kills, meilleure place, immutabilité), tri, `lireStatsBr` rejette ou répare un JSON abîmé.
- **Lot B6 — couleurs** : crée `lib/fps/couleurs.ts` + `couleurs.test.ts` (`couleurJoueur(rang)` : HSL en pas d'angle d'or → `#rrggbb`, 50 couleurs deux à deux distinctes, distinctes de `PALETTE`).

### Vague 2 — serveur (4 lots en parallèle)

- **Lot C1a — service principal** : remplace le stub `lib/fps/match-br.ts` + `match-br.test.ts` (faux `ContexteSalle`, `VolBr` et `ButinBr` factices, modèle `match-zombies.test.ts` : `banc()`, `suite()`, `T0`, `avancer`). Machine d'états, lobby/hôte/lancement (minimum, conflit de noms), décompte « prêt » (fin anticipée, plafond 30 s, annulation), admission jusqu'à `finT`, compteurs remis à zéro au lancement, tempête à accumulateur (morts à des tics distincts, cause `tempete`, soins non interrompus), `surMort` (instantané, +50 PV plafonnés à 100 pour un tueur vivant seulement, `tueurValide`), places et départage, victoire unique (un survivant, zéro survivant, abandon du dernier adversaire), partie non comptée (< 2 atterris ou < 60 s), bilan par instantanés (joueur déconnecté compris), stats (persistance simulée, pseudos `Agent` exclus), retour au lobby, **salle vide traitée dans `liberer`**.
- **Lot C1b — vol et butin** : remplace les stubs `match-br-vol.ts` et `match-br-butin.ts` + leurs tests. Vol : avion immobile puis en vol, saut libre, éjection forcée à `finT`, admission tardive, chute simulée en temps réel (entrées, pas fixes, pilote automatique, ouverture, atterrissage, invulnérabilité 5 s). Butin : tirage et synchro complète, ramassage (distance, échange, objets lâchés à la mort), soins (durées, interruption par coup ou changement d'arme, pas par la tempête).
- **Lot C2 — intégration `Salle`** : modifie `lib/fps/match.ts` uniquement (§Modifications de `match.ts`, dont `fabriqueBr`, `rewindMaxMs`, `historiqueMs`, couleurs, `presence` fusionnée, mêlée BR). Tests : `lib/fps/match.br-hooks.test.ts` avec un `ServiceBr` factice injecté par `fabriqueBr` (options `br`, capacité 50, `rejoindreBr`, `mourir` sans réapparition ni `terminer` mais avec `tueur.kills`, `serie` et `killsParArme`, arme spéciale lâchée avant effacement, pas de régénération, `recevoirEtat` ignoré en vol, snap sans joueurs à bord ni morts anciens et avec `chute`, aucun bus C3, `INACTIF_MS`, une seule `presence` pour 50 `rejoindre`, `voix*` ignorés, mêlée 34/70). `match.test.ts`, `match.zombies.test.ts` et `match.v2.test.ts` restent verts.
- **Lot C3 — serveur Node et déploiement** : modifie `serveur-fps/src/index.ts`, `Dockerfile`, `docker-compose.yml`, `.gitignore`, `README.md` ; crée `serveur-fps/src/stats-br.ts` (+ test vitest `lib/fps/stats-br-fichier.test.ts` ou script `serveur-fps/scripts/test-stats.mjs` : écriture atomique asynchrone sérialisée, fichier absent, JSON corrompu renommé, dossier temporaire). Compile seul : il dépend des types (lot A), des stubs (lot A), de `construireMondeBr` (B3) et de `PersistanceBr` (B5). Tests : `VERSIONS_ACCEPTEES` (un client v7 reste servi en arène et zombies), `modeDeSalle` avec `SALLES`.

### Vague 3 — intégration serveur et client (4 lots en parallèle)

- **Lot D1 — tests d'intégration serveur et charge** : crée `lib/fps/match.br.test.ts` (vraie `Salle` + `construireMondeBr(scene)`, LCG déterministe, modèle `match.zombies.test.ts` : connexion → `lancerPartie` → `rejoindre` → avion → `sauter` → `chute` → atterrissage → tempête → kill → +50 PV → mort définitive → victoire → retour au lobby ; messages exacts, absence de `terminer`, un 3ᵉ joueur arrivé en cours de partie reste au lobby, un client qui perd son entrée dans le snap après sa mort) et `lib/fps/match.br.charge.test.ts` (50 joueurs, 600 tics, états à 30 Hz, chute simultanée, tirs valides ; budgets : snap ≤ 10 500 octets, tic moyen ≤ 2 ms, volume cumulé du tic de lancement ; à lancer SEUL) ; corrige `match.ts` / `match-br*.ts` si besoin (seul lot de la vague à les toucher).
- **Lot D2 — moteur client pur et tests** : crée `lib/fps/jeu-br.ts` + `jeu-br.test.ts` (le `ControleurVol` rejoué donne le même état que `pasChute` à tolérance de 0,5 m ; `ButinClient.appliquer` ; `inviteRamassage` ; `SuiviSpectateur`), modifie `lib/fps/jeu-equipement.ts` (`ajouterReserve`, `sansSecondaire` dans les replis `SLOTS_REPLI` / `MAIN_INITIALE`, tests ajoutés à `jeu-equipement.test.ts`), `lib/fps/touches.ts` (+ test : `soigner` H, `potion` J, `lacher` U, `spectateurSuivant` / `spectateurPrecedent` en flèches, avec `LIBELLES_ACTIONS` et `GROUPES_ACTIONS`).
- **Lot D3 — rendu client** : crée `lib/fps/rendu-br.ts` et `lib/fps/rendu-avion.ts` (extrait de `rendu-tigres.ts`, qui l'importe ensuite), modifie `lib/fps/rendu-interieurs.ts` (option `{ sansPlafond, batiments }`), `lib/fps/sons.ts` (vent de chute, voile, zone, usage d'un soin), `lib/fps/rendu.ts` (parachute d'avatar, uniquement si nécessaire). Pas de test de rendu three : un test PUR pour tout calcul extrait (rareté → couleur, visibilité par distance) ; contrôle visuel par capture.
- **Lot D4 — interface** : crée `app/components/arene/LobbyBR.tsx`, `hud/BarreBR.tsx`, `hud/BlocZone.tsx`, `hud/BlocInventaire.tsx`, `hud/EcranSpectateur.tsx`, `hud/FinDePartieBR.tsx` (+ `.module.css`), `hud/TableauStatsBr.tsx`, `hud/useEtatBR.ts` ; modifie `lobby-modele.ts` (type `Salons` avec `br?`), `ChoixMode.tsx`, `Arene.module.css`, `useArene.ts` (recopie `setSalons` avec `br`), `HudArene.tsx`, `HudArene.module.css`, `hud/EcranMort.tsx`, `FilEliminations.tsx`, `InvitesAction.tsx`, `MenuPause.tsx` (sans chat vocal en BR), `AideCommandes.tsx`, `BlocVie.tsx`, `GrandeCarte.tsx`, `dessinCarte.ts`, `armesInfo.ts` (`libelleCause` : tempête, abandon), `lib/fps/hud-modele.ts` (`libelleFil`, `memeEtatBrHud` calqué sur `memeEtatZombiesHud`, annonces) et `lib/fps/classement.ts` (`lignesBilanBR`, mise en forme du palmarès). Tests : `lib/fps/arene-lobby.test.ts`, `lib/fps/zombies-ui.test.ts` (`ChoixMode` change) et `hud-rendu.test.ts` étendus (`renderToStaticMarkup`), `hud-contraste.test.ts` doit rester vert, `situationLobbyBR`, `compteurMode` à trois modes.

### Vague 4 — assemblage client (1 lot)

**Lot E — `jeu.ts` et `Agroparc3D.tsx`** : modifie `lib/fps/jeu.ts` (mode `br`, intégration de `ControleurVol`, `ButinClient`, `creerRenduBr`, caméras avion / chute / spectateur, `interpMs`, messages `saut` `atterri` `butin` `ramasse` `inventaire` `soin` `br`, ramassage par E, usage des soins, `remplirRadar` avec `zoneBr`, `etatHud`, `JeuHandle.br()`), `app/components/Agroparc3D.tsx` (branche BR, **choix de la scène de la carte pour `br` (lignes ~645-648)**, `admisBR`, libération de la place, `indisponibles`, crochet `window.__arene` étendu, rejeu de l'état BR au montage du jeu comme `presence` et `match`). Vérification : `tsc`, `vitest run lib/fps`, démarrage du jeu BR en solo contre `serveur-fps` avec `PDJ_FPS_BR_MIN_JOUEURS=1`.

### Vague 5 — bout en bout et documentation (2 lots en parallèle)

- **Lot F1 — e2e** : crée `scripts/fps/e2e_br.mjs` (modèle : `e2e_zombies.mjs`, mêmes conventions : ports libres jamais 8787, `PLAYWRIGHT_DIR`, `E2E_OUT`, `E2E_SEULES`, `E2E_JUSQUA`, `E2E_GARDER`, `E2E_DEBUG`, TROIS Chromium Alice (hôte), Bob, Cora). Serveur lancé avec `PDJ_FPS_BR_DECOMPTE_MS=6000`, `PDJ_FPS_BR_VOL_MS=12000`, `PDJ_FPS_BR_ALTITUDE=140`, `PDJ_FPS_BR_ZONE_ECHELLE=0.08`, `PDJ_FPS_BR_OBJETS=300`, `PDJ_FPS_BR_STATS` vers un fichier temporaire. Étapes : choix du mode (trois radios `name$='-mode'`), lobby (seul l'hôte lance, minimum 2), décompte raccourci quand tous sont prêts et montée dans l'avion, saut puis atterrissage de chacun, fouille et ramassage d'une arme (téléportation par sauts de 40 m attendus chez le serveur), élimination de Bob par Alice à l'arme blanche (3 coups de couteau, +50 PV plafonnés, Bob spectateur définitif, aucune réapparition), tempête qui rétrécit avec dégâts hors zone, mort de Cora (`tempete`), victoire d'Alice, partie comptée (> 60 s : prévoir l'échelle de zone en conséquence ou `PDJ_FPS_BR_VALIDE_MS` réduit pour l'essai), écran de fin avec stats, TOP 1 persisté (relecture de `GET /stats-br`), retour au lobby. Adapte `e2e_zombies.mjs` (`choix.length === 3`). Vérifie qu'aucun message `erreur` n'est reçu et que les e2e `e2e_arene_v2.mjs` et `e2e_zombies.mjs` passent toujours (le protocole passe à 8). Pièges documentés : rendu logiciel à 2-10 images/s (la chute côté serveur est en temps réel, indépendante du rendu), fenêtres réduites en combat, `teleporter` n'agit que côté client.
- **Lot F2 — documentation** : modifie `CLAUDE.md` (section « Arène FPS » : `VERSION_PROTOCOLE = 8` et `VERSIONS_ACCEPTEES`, mention de la salle BR et des modules `br-*.ts`, `match-br*.ts`, `jeu-br.ts`, `rendu-br.ts`, `couleurs.ts`, 64 connexions / plafond global 160, commande `e2e_br.mjs`, variables `PDJ_FPS_BR_*` et `PDJ_FPS_CONNEXIONS_*`, ordre de déploiement serveur d'abord, persistance `pdj-fps-donnees`), ajoute en tête de ce spec le statut final, vérifie `serveur-fps/README.md`.

## Risques et points de vigilance

- **Parité client / serveur de la chute** : un seul module (`br-chute.ts`) des deux côtés, mais `Math.sin` / `Math.cos` ne sont pas bit-identiques entre navigateurs et la latence décale les entrées : le serveur est autoritaire, le client prédit et se téléporte à l'atterrissage si l'écart dépasse 0,5 m (voir §Chute).
- **`INACTIF_MS`** : le service rafraîchit `etatT` pendant l'avion et la chute ; sinon tout le monde serait évincé en vol.
- **Morts simultanées** : le test de victoire se fait au tic suivant la boucle de mort (`vivants ≤ 1`), jamais dans `surMort` ; `tueurValide` règle les kills croisés ; le classement ne produit jamais d'ex æquo.
- **`deconnecter`** retire le joueur de la table AVANT d'appeler `liberer` : le service travaille sur l'objet reçu et sur ses instantanés, pas sur `ctx.joueur(id)`.
- **Monde** : `construireMondeBr` crée une instance propre par salle (la grille de collision a un tampon non réentrant et des brèches) ; ne jamais partager le monde de `salleArene` ; ses `bornes` sont celles des 142 bâtiments d'origine.
- **`PieceSynth.batiment`** élargi à `number` : les zombies ne doivent pas changer (tests de zombies-carte et de rendu des intérieurs inchangés).
- **Charge réseau et CPU** : 50 joueurs à 10 Hz sans filtre ; surveiller `TAMPON_MAX_OCTETS`, la rafale du lancement et `/sante.alerte` ; conteneur à `cpus: 0.6` à mesurer, jamais de test de charge en parallèle d'autre chose.
- **Pseudos** : l'identité par pseudo permet d'usurper la fiche d'un autre (accepté, site privé) ; les pseudos `Agent*` ne comptent pas, les conflits de noms bloquent le lancement.
- **Déploiement** : serveur d'abord (il accepte 7 et 8), puis fusion du client ; ne jamais supprimer le volume `pdj-fps-donnees`.
- **Réseau instable** : une micro-coupure de socket élimine le joueur pour toute la partie (pas de reconnexion en v1) ; piste documentée : conserver la place 20 s et un message `reprendre`.
- **Hors périmètre** : spectateurs extérieurs, équipes / duo, reconnexion en partie, boutique de butin, coffres, véhicules en BR, chat vocal en BR (désactivé en v1, à reprendre avec une limite aux N plus proches).
