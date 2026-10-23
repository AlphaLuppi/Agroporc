# Arène : tigres largués par avion et sort d'invocation

État au 2026-10-23, branche `feat/arene-tigres`. Ce document spécifie ce que la branche doit livrer. Rien n'est implémenté à cette date, sauf la section « Chasse de la vue Palantir », livrée dans le commit `b3fcee5`.

Dans l'arène FPS de la vue Palantir, un avion survole parfois le terrain et largue un tigre en parachute. Le tigre se pose dans une cachette, se défend quand on l'attaque et s'enfuit quand il faiblit. Le joueur qui le tue gagne un sort d'invocation : un tigre allié l'accompagne un temps et attaque le joueur ennemi le plus proche à portée.

Les choix marqués *choix de l'auteur* viennent de l'auteur de ce document : l'utilisateur lui a demandé d'avancer avec des choix par défaut. Les autres règles viennent de l'utilisateur.

## Demande de l'utilisateur

- Des tigres apparaissent au hasard dans l'arène, toujours cachés, à l'intérieur de la zone de jeu.
- Ils arrivent comme un largage de PUBG : un avion survole parfois le ciel et les largue.
- Le tigre se défend, sans tuer un joueur en un coup.
- Le tuer donne un sort d'invocation : le tigre accompagne le joueur et attaque le joueur le plus proche à portée.
- Le sort ne doit pas être trop puissant. Le tigre doit se mériter.

## Chasse de la vue Palantir

Hors de l'arène, dans la vue aérienne, le tigre caché était introuvable depuis la vue de départ : 2 à 4 px brun sombre sur fond sombre. Livré dans `b3fcee5` :

- la teinte du clone passe de 0,2 à 0,5 (`TEINTE` de `lib/agroparc3d/tigre.ts`),
- une signature thermique orange de 14 m traverse les bâtiments, allumée pendant le premier quart d'une période de 4 s (`LUEUR`, `battement`, testé).

## Architecture

Le serveur `serveur-fps` arbitre le tigre, comme Elsa et les voitures PNJ : apparition, position, PV, dégâts donnés et reçus, mort, sort. Le client affiche ce que le serveur décrit.

- **Logique pure, testée** : `lib/fps/tigre-arene.ts` (état d'un tigre, machine d'états, attaques, fuite, sort), `lib/fps/avion.ts` (passage de l'avion, point et instant du largage).
- **Service de salle** : `lib/fps/match-tigres.ts`, sur le modèle de `match-elsa.ts`, branché par `ContexteSalle` dans `lib/fps/match.ts` et assemblé dans `serveur-fps/src/index.ts`.
- **Protocole** : `lib/fps/protocole.ts`, `VERSION_PROTOCOLE` passe de 2 à 3. Le serveur déployé sur `wss://pdj-fps.toam.tech` doit être redéployé avec la branche, sinon les clients reçoivent `erreur{version}`.
- **Client** : rendu de l'avion, du parachute et des tigres dans `lib/fps/rendu-monde.ts` ou un module voisin, état dans `lib/fps/jeu-monde.ts`, HUD dans `app/components/arene/`.

## Avion et largage

*Choix de l'auteur* pour toute cette section.

- **Fréquence** : un passage toutes les 90 à 180 s, tiré au hasard, seulement en phase de jeu avec au moins 2 joueurs en arène. Variables `PDJ_FPS_AVION_MIN_MS` et `PDJ_FPS_AVION_MAX_MS` pour les tests, comme pour Elsa.
- **Un seul tigre sauvage à la fois** : pas de passage tant qu'un tigre sauvage est en vie.
- **Trajectoire** : ligne droite d'un bord à l'autre de la zone de jeu, à 120 m d'altitude et 60 m/s, cap tiré au hasard, passant à moins de 60 m de la cachette choisie.
- **Cachette** : tirée parmi les cachettes de `public/agroparc/cachettes.json` situées dans l'anneau de 25 à 140 m du rond-point (`ZONE_APPARITION` de `zones.ts`), à plus de 30 m de tout joueur vivant au moment du largage.
- **Descente** : le tigre quitte l'avion au point de la trajectoire le plus proche de la cachette et descend en parachute vers elle en 12 s environ. Il est visible de tous pendant la descente. Le parachute disparaît à l'atterrissage.
- **Annonce** : au largage, message HUD « Un tigre a été largué ! » et son d'avion. La mini-carte ne montre pas le point d'atterrissage.
- Un joueur peut tirer sur le tigre pendant sa descente.

## Tigre sauvage

*Choix de l'auteur* pour les valeurs. Toutes sont des constantes nommées et ajustables.

- **Vie** : 2 500 PV, sans régénération en combat. Pas de bouclier. Le fusil d'assaut (`STATS` de `armes.ts` : 22 dégâts toutes les 0,10 s, chargeur de 30) inflige 220 dégâts par seconde au corps, avant la chute de dégâts à distance. Il faut 114 balles au corps, soit 4 chargeurs : 11,4 s de tir et 3 recharges de 2,2 s, environ 18 s pour un joueur seul qui touche à chaque balle. Il faut donc le tenir à distance ou s'y mettre à plusieurs.
- **Zones** : tête et corps, avec le multiplicateur de tête des armes existantes. La silhouette de touche suit la pose (couché, debout, en course).
- **Machine d'états** :
  1. **Tapi** dans sa cachette après l'atterrissage, posture basse, immobile.
  2. **Alerte** quand un joueur vivant entre à moins de 20 m avec ligne de vue, ou dès qu'il reçoit des dégâts. Il se tourne vers ce joueur.
  3. **Attaque** : il poursuit le dernier joueur qui l'a blessé, sinon le plus proche en vue, à 10,5 m/s (sous le sprint des joueurs, 12,5 m/s).
     - Coup de patte à 2,5 m : 25 dégâts, toutes les 1,2 s.
     - Bond : annoncé 0,6 s à l'avance (il se ramasse, rugit), portée 6 à 10 m, 40 dégâts au contact, une fois toutes les 7 s.
     - Aucun coup ne dépasse 40 dégâts, donc aucun coup ne tue un joueur à 100 PV.
  4. **Fuite** quand il passe sous 30 % de ses PV : il court vers une autre cachette à plus de 60 m. Une fois arrivé, s'il n'a pas reçu de dégâts depuis 8 s, il régénère 15 PV/s jusqu'à 50 %, puis repart en **Tapi**. Il faut donc le poursuivre pour l'achever.
  5. **Départ** : un tigre sauvage non tué au bout de 4 minutes repart, et un nouvel avion peut passer.
- **Déplacement** : le tigre suit le sol et contourne les bâtiments avec le module de collision existant (`collision.ts`). Il ne traverse ni bâtiment ni voiture.
- **Voitures** : une voiture conduite ou PNJ qui le percute lui inflige 150 dégâts, sans le tuer d'un coup.
- **Mort** : le joueur qui porte le dernier coup gagne le sort. Le fil des éliminations affiche « [joueur] a abattu le tigre ».

## Sort d'invocation

*Choix de l'auteur* pour toute cette section.

- **Gain** : une charge, au joueur qui tue le tigre sauvage. Au plus une charge à la fois. Elle est perdue à la mort du joueur et à la fin du match.
- **Lancer** : touche `T` par défaut, modifiable dans le réglage des touches (`touches.ts`, action « invoquer »). Le HUD montre l'icône du sort quand une charge est disponible.
- **Tigre allié** : il apparaît à 2 m du lanceur avec une courte animation de fumée. Il dure 30 s ou jusqu'à sa mort.
  - 500 PV, que les autres joueurs peuvent abattre : environ 2,3 s de fusil d'assaut au corps.
  - Il suit le lanceur à 3 à 6 m.
  - Il attaque le joueur ennemi vivant le plus proche du lanceur, à moins de 18 m et en ligne de vue. Coup de patte de 15 dégâts toutes les 1,0 s, sans bond.
  - Il change de cible si la sienne meurt, sort de portée ou n'est plus en vue.
  - Les éliminations par le tigre allié comptent pour le lanceur, avec l'arme « tigre » dans le fil des éliminations.
- **Équilibre** : le tigre allié inflige 15 dégâts par seconde au plus, contre 220 pour le fusil d'assaut au corps. Contre le tigre seul, un joueur à 100 PV tient environ 7 s, assez pour l'abattre ou se replier. Le tigre allié harcèle et distrait, il ne remplace pas une arme.
- **Couleur** : le tigre allié porte un liseré de la couleur du lanceur, pour qu'aucun joueur ne le confonde avec un tigre sauvage.

## Rendu

- **Modèle** : le GLB du thème Tigre (`public/tigre/tigre.glb`), chargé une fois au lancement de l'arène. Clips du GLB : « Walking » pour la marche et la course (vitesse de lecture proportionnelle), « Attack jump » pour le bond, « Curious » pour l'alerte, pose tapie pour la cachette.
- **Avion** : silhouette en fil de fer, comme l'avion de la vue aérienne, avec un son de moteur spatialisé.
- **Parachute** : voilure et suspentes en fil de fer, au style de l'arène.
- **Teinte** : le tigre garde sa texture, sans assombrissement, pour rester lisible en vue à la première personne.
- **Sons** : rugissement à l'alerte et avant le bond, coup de patte, plainte à la mort. Synthétisés dans `sons.ts` comme les autres sons de l'arène.

## Réseau

- Le snap porte les tigres présents : identifiant, sauvage ou allié (avec le lanceur), position, cap, état, PV, et l'instant de début de l'action en cours (bond, coup) pour que le client cale ses animations.
- Messages nouveaux : `avion` (passage, trajectoire, largage), `tigre` (apparu, alerte, mort, parti), `sort` (gagné, lancé, perdu).
- Les tirs et coups de couteau sur un tigre passent par la validation existante, avec des positions de tigre rejouées sur l'historique serveur pour la compensation de latence. La cible d'une touche est l'identifiant du tigre.

## Tests et vérification

- Modules purs testés : machine d'états du tigre, poursuite et fuite, coups (aucun ne dépasse 40 dégâts), régénération, départ au bout de 4 minutes, sort (gain, perte, ciblage, durée), avion (fréquence, conditions, point de largage, cachette à plus de 30 m des joueurs).
- `npx vitest run` et `npm run build` passent. `serveur-fps` compile (`npm run build`, `npm run typecheck`).
- Bout en bout : `scripts/fps/e2e_arene_v2.mjs` étendu, avec un intervalle d'avion court, deux navigateurs : largage visible, tigre tué, sort lancé, tigre allié qui attaque l'autre joueur. Captures dans `E2E_OUT`.
- `CLAUDE.md` décrit les nouveaux modules et le changement de protocole.

## Ce qui est laissé au développeur

- les valeurs marquées « environ » et l'ajustement des constantes après essai,
- le détail du calcul de chemin du tigre autour des bâtiments,
- la forme exacte des messages du protocole, dans les limites de la section « Réseau »,
- le placement de l'icône du sort et de l'annonce dans le HUD.
