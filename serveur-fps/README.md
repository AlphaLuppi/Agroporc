# Serveur de l'arène FPS

Serveur temps réel (Node 22 + `ws`) de l'arène de la vue Palantir. **Trois salles dans un seul processus et une seule WebSocket par client** :
l'arène « chacun pour soi » (16 joueurs EN ARÈNE), le mode **zombies tigres** (coopératif, 8 membres lobby compris, une seule partie à la fois) et le
**Battle Royale** (2 à 50 joueurs, lobby compris, une seule partie à la fois : avion, parachute, fouille, tempête, mort définitive, stats persistées) ;
Vercel ne tient pas de WebSocket, il tourne donc sur le VPS. Toute la logique de jeu est dans `lib/fps/match.ts` (classe `Salle`, pure, testée par
`npx vitest run lib/fps`) et ses services `match-elsa.ts` / `match-vehicules.ts` / `match-evenements.ts` / `match-tigres.ts` / `match-zombies.ts` / `match-br.ts`
(via `ContexteSalle`, `match-contexte.ts`) ; `src/index.ts` ne fait que l'I/O (WebSocket, `GET /sante`, `GET /stats-br`, anti-flood, origines, ping, tic à 60 Hz), assemble
les trois salles (arène : circuits des voitures PNJ, voitures conduisibles, Elsa, événements, cachettes des tigres largués, zone d'apparition autour du
rond-point ; zombies : monde mutable `construireMondeZombies`, aucun de ces services, donc ni avion, ni tigres largués, ni événements ; Battle Royale : monde mutable `construireMondeBr` (20 bâtiments creusés), service `match-br.ts` composé de
`match-br-vol.ts` et `match-br-butin.ts`, modules purs `br-*.ts`, aucun des services de l'arène, stats dans `src/stats-br.ts`) et route chaque
message vers la salle de son client. **Protocole 8** (`VERSION_PROTOCOLE = 8`, le serveur accepte aussi les clients v7 : `VERSIONS_ACCEPTEES`) : arène v2 (spec `docs/superpowers/specs/2026-10-22-arene-v2-design.md`,
v1 en `2026-10-22-agroparc-fps-design.md`), v3 (`2026-10-23-arene-v3-design.md`), événements de la v4 (`2026-10-24-arene-evenements-design.md` : Truck Muche
fou, tigre géant, titan, bâtiments destructibles), tigres largués de la v5 (`2026-10-23-arene-tigres-design.md` : avion, tigre sauvage, sort d'invocation,
service `lib/fps/match-tigres.ts`, logique pure `tigre-arene.ts` et `avion.ts`, section « Cohabitation avec le tigre géant ») et mode zombies, épée de la v6
(`2026-10-27-arene-zombies-design.md`), zombies façon Black Ops 1 de la v7 (`2026-10-28-zombies-bo1-design.md`) et Battle Royale de la v8
(`2026-10-28-battle-royale-design.md`).

## Développement local

```bash
cd serveur-fps && npm i && npm run dev   # ws://localhost:8787, reconstruit et relance à chaque modification
```

Le site (`npm run dev` à la racine) s'y connecte tout seul en dev (`ws://localhost:8787`).
`npm start` lance le dernier `dist/index.js` (`npm run build`), `npm run typecheck` vérifie les types.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `8787` | port HTTP + WebSocket |
| `SCENE_JSON` | `../public/agroparc/scene.json` | scène d'Agroparc (bâtiments, routes) |
| `ORIGINES` | vide = toutes | origines `Origin` autorisées, séparées par des virgules ; `*` = suite de caractères hors `/` (previews Vercel : `https://*.vercel.app`) |
| `PDJ_FPS_ELSA_MIN_MS` / `PDJ_FPS_ELSA_MAX_MS` | 20 000 / 50 000 | intervalle (ms) entre deux offres d'Elsa au Truck Muche, courts (6 000 / 7 000) pour les tests de bout en bout. Une seule des deux : elle sert aux deux bornes |
| `CACHETTES_JSON` | `../public/agroparc/cachettes.json` | cachettes du tigre largué (seules celles de l'anneau de 25 à 140 m du rond-point servent à l'arène) |
| `PDJ_FPS_AVION_MIN_MS` / `PDJ_FPS_AVION_MAX_MS` | 90 000 / 180 000 | intervalle (ms) entre deux passages de l'avion qui largue un tigre, compté depuis la mort ou le départ du tigre précédent. Courts (quelques secondes) pour les tests de bout en bout. Une seule des deux sert aux deux bornes. Le passage est repoussé tant que dure l'événement du tigre géant |
| `PDJ_FPS_BUS_MIN_MS` / `PDJ_FPS_BUS_MAX_MS` | 45 000 / 75 000 | intervalle (ms) entre deux passages du bus C3 express (arène seulement), qui écrase les joueurs à pied sur son trajet. Longs (une heure) pour les tests de bout en bout de l'arène. Une seule des deux sert aux deux bornes |
| `PDJ_FPS_EVT_MIN_MS` / `PDJ_FPS_EVT_MAX_MS` | 45–70 s puis 70–110 s | délai (ms) avant chaque événement (Truck Muche fou, tigre géant), courts pour les essais |
| `PDJ_FPS_EVT_TYPE` | alternance | `truck` ou `tigre` : toujours le même événement |
| `PDJ_FPS_EVT_ACTIFS` | (absente : tous) | (2026-10-30) événements du hall `ar1` : liste CSV parmi `elsa`, `avion`, `bus`, `truck`, `tigre`, `police` (ex. `elsa,police`). Présente mais VIDE : aucun événement. Les arènes créées par un joueur ont leurs propres réglages (`mode{partie:"nouvelle", reglages}`) |
| `PDJ_FPS_EVT_FREQUENCE` | `normal` | (2026-10-30) rythme des événements du hall : `calme` (intervalles × 3, plus de temps morts), `normal` (× 1,6) ou `chaos` (la cadence historique de la v3). Jamais appliqué à un intervalle fixé par une variable `PDJ_FPS_*_MIN_MS` / `_MAX_MS` |
| `PDJ_FPS_POLICE` | (actif) | (2026-10-30) `off` coupe la descente de police partout (arène et Battle Royale) ; les scripts de test déterministes la coupent |
| `PDJ_FPS_POLICE_MIN_MS` / `PDJ_FPS_POLICE_MAX_MS` | 240–420 s puis 300–540 s | (arène) délai avant la première descente (après la création de la salle ou le passage à 2 joueurs en jeu) ET entre deux descentes. Une seule des deux : elle sert aux deux bornes, et à `premier` comme à `entre`. Jamais mis à l'échelle par la fréquence |
| `PDJ_FPS_POLICE_DUREE_MS` / `PDJ_FPS_POLICE_PV` | 22 000 / 700 | durée de la poursuite (puis retrait de 4 s au plus) et PV de la voiture (essais) |
| `PDJ_FPS_BR_POLICE_MS` | (absent) | (Battle Royale, essais) délai fixe de l'armement après le départ de l'avion ; la descente n'attend plus que ce délai (60 s au plus) après le premier atterrissage d'un humain et se contente de 2 vivants |
| `PDJ_FPS_ZOMBIES_PATROUILLE` | (actif) | (2026-10-30) `off` coupe la patrouille de police en ambiance des zombies |
| `PDJ_FPS_ZOMBIES_PATROUILLE_MANCHE` / `_MS` | 3 / 45 000 puis 240–420 s | (zombies, essais) première manche éligible ; délai du premier passage ET entre deux, `0` = dès le début de la manche |
| `PDJ_FPS_TIGRE_PV` | 4 000 + 1 500 / joueur | PV imposés au tigre géant des événements (essais), sans effet sur les tigres largués |
| `PDJ_FPS_TIGRE_ATTAQUE` | au hasard | `laser`, `saut` ou `charge` : attaque spéciale imposée au tigre géant (essais) |
| `PDJ_FPS_ZOMBIES_ARGENT` | 500 | argent de départ ($) du mode zombies (essais) |
| `PDJ_FPS_ZOMBIES_TOTAL` | selon la manche et les joueurs | nombre de tigres de la manche 1 (essais) |
| `PDJ_FPS_ZOMBIES_PAUSE_MS` | 8 000 (décompte) / 10 000 (pauses) | durée du décompte de départ et des pauses entre manches ; le bilan de fin reste de 25 s |
| `PDJ_FPS_ZOMBIES_GRIFFE` | 50 (selon la difficulté et le type) | dégâts de griffe imposés (ex. 100 : un seul coup met à terre ; le test de bout en bout utilise 20) |
| `PDJ_FPS_ZOMBIES_TRUCK` | 5, 6 ou 7 au hasard | première manche du Truck Muche (essais) ; 0 = jamais |
| `PDJ_FPS_ZOMBIES_COURANT` | (absent) | `1` : courant rétabli dès le départ (essais : atouts et Pack-a-Punch utilisables tout de suite) |
| `PDJ_FPS_BR_STATS` | `donnees/stats-br.json` (dossier courant) | fichier JSON des statistiques du Battle Royale (TOP 1, parties, kills, meilleure place par pseudo). En prod `/donnees/stats-br.json`, sur le volume Docker `pdj-fps-donnees` |
| `PDJ_FPS_BR_MIN_JOUEURS` | 2 | joueurs minimum pour lancer une partie (1 pour jouer seul contre le serveur en essai) |
| `PDJ_FPS_BR_DECOMPTE_MS` | 30 000 | plafond du décompte (il s'arrête dès que tous les admis ont rejoint, au bout de 3 s au plus tôt) |
| `PDJ_FPS_BR_VOL_MS` | 15 à 30 s selon le trajet | durée du trajet de l'avion (la vitesse en découle) |
| `PDJ_FPS_BR_ALTITUDE` | 350 | altitude de l'avion (m) ; plus bas, la chute est plus courte |
| `PDJ_FPS_BR_ZONE_ECHELLE` | selon le nombre d'admis (0,6 / 0,8 / 1) | échelle de durée de la zone, sans plancher (ex. 0,08 pour les tests de bout en bout) |
| `PDJ_FPS_BR_OBJETS` | `clamp(9 × joueurs, 120, 480)` | nombre d'objets du butin |
| `PDJ_FPS_BR_FIN_MS` | 30 000 | durée d'affichage du bilan avant le retour au lobby |
| `PDJ_FPS_BR_PARTIES` | 4 | parties de Battle Royale en même temps au plus (salle permanente comprise ; chacune a son monde, ≈ 2 Mo) |
| `PDJ_FPS_BR_BOTS_MAX` | 20 | bots par partie de Battle Royale (0 = coupés : `lancerPartie.bots` est ignoré, le lobby n'affiche plus le réglage). Seul, sans `bots`, l'hôte reçoit 11 bots (`BR.botsSolo`, aussi pour les clients v8 à v10, qui les voient comme des humanoïdes) ; un lancement refusé répond `refus{lancer, bots}` (pas assez de joueurs) ou `refus{lancer, limite}` (quota épuisé) |
| `PDJ_FPS_BR_BOTS_TOTAL` | 24 (provisoire, 40 après mesure sur le VPS) | bots toutes parties confondues ; le quota restant est publié dans `salons.listes.br[].botsRestants` |
| `PDJ_FPS_BR_BOTS_ESSAI` | absent | `agressif` : graine fixe, les bots ne visent que les humains, apparaissent à 20-80 m du premier humain au sol (en vue) avec une mitraillette. Pour les essais déterministes seulement |
| `PDJ_FPS_ARENE_PARTIES` | 2 | (v11) parties d'arène en même temps au plus (`ar1` permanente comprise) |
| `PDJ_FPS_ZOMBIES_PARTIES` | 3 | (v11) parties de zombies en même temps au plus (`z1` permanente comprise) |
| `PDJ_FPS_PARTIES_TOTAL` | 6 | (v11) parties au total, toutes salles confondues, permanentes comprises (provisoire tant que la charge agrégée n'est pas mesurée sur le VPS, 8 ensuite). Une création par mode reste toujours possible tant que le mode est sous son plafond (réserve d'un emplacement par mode : le total n'est dépassé que de cette réserve, 3 au plus) |
| `PDJ_FPS_CREATION_DELAI_MS` | 10 000 | (v11) délai minimal entre deux créations de partie d'un même client, et fenêtre de `PDJ_FPS_CREATION_RAFALE_IP` (`refus{mode, limite}` sinon) ; non effacé à la fermeture de la socket |
| `PDJ_FPS_CREATION_RAFALE_IP` | 3 | (v11) créations de partie par adresse IP dans une fenêtre de `PDJ_FPS_CREATION_DELAI_MS`, connexions différentes comprises (une reconnexion ne contourne pas le délai) |
| `PDJ_FPS_PARTIES_PAR_IP` | 2 | (v11) parties non permanentes ouvertes en même temps par adresse IP ET par mode (plusieurs groupes d'un même bureau jouent ; la partie compte jusqu'à sa fermeture) |
| `PDJ_FPS_CREATION_TIC_MAX_MS` | 12 | (v11) seuil (ms) d'un tic « lent » pour le disjoncteur de création : construire un monde coûte 17 à 90 ms ; le tic qui suit une création ne compte pas. Les scripts de test le montent à 1000 pour rester déterministes sous charge |
| `PDJ_FPS_CREATION_TICS_LENTS` | 3 | (v11) aucune création de partie tant qu'au moins ce nombre de secondes distinctes des 10 dernières ont un tic lent (un pic isolé : GC, CPU partagé, ne bloque rien) |
| `PDJ_FPS_BR_VALIDE_MS` | 60 000 | durée minimale (ms) depuis le départ de l'avion pour qu'une partie compte dans les stats (avec 2 joueurs atterris au moins) |
| `PDJ_FPS_CONNEXIONS_IP` | 24 | connexions simultanées par adresse IP (le `docker-compose.yml` de prod met 60 : cinquante amis derrière l'IP d'un bureau) |
| `PDJ_FPS_CONNEXIONS_TOTAL` | 160 | connexions simultanées au total, inscrites ou non |
| `PDJ_FPS_ZOMBIES_SUSPENSION_MAX_MS` | 300 000 | (v11) durée maximale d'une suspension de la partie par un joueur (levée automatique avec compte à rebours non annulable) ; plusieurs humains admis seulement |
| `PDJ_FPS_ZOMBIES_COMPTE_MS` | 3 000 | (v11) compte à rebours qui précède la levée d'une suspension quand plusieurs humains sont admis (le jeu reste figé, les joueurs reprennent la souris) ; 0 = levée immédiate (tests de bout en bout) |
| `PDJ_FPS_ZOMBIES_SUSPENSION_COOLDOWN_MS` | 10 000 | (v11) délai entre deux suspensions d'un même joueur (plusieurs humains admis seulement ; un joueur seul admis en est exempt) |
| `PDJ_FPS_ZOMBIES_SUSPENSION_TOTAL_MS` | 900 000 | (v11) pause cumulée maximale par partie de zombies, remise à zéro à chaque partie (plusieurs humains admis seulement) |
| `PDJ_FPS_REPRISE_SUSPENDUE_MS` | 60 000 | (v11) délai de reprise réseau d'un membre coupé dont la salle de zombies est suspendue (20 s sinon, `REPRISE_MS`) : le jeu est figé, sa place est gardée plus longtemps |
| `PDJ_FPS_ZOMBIES_SECRET` | 0 | (v8) grand secret « Le Menu fantôme » : étape de départ de chaque partie, 1 à 9 (les précédentes sont considérées faites ; 9 = servi, la cloche finit la partie). Solution : `docs/superpowers/specs/2026-10-29-zombies-secret-SOLUTION.md` |
| `PDJ_FPS_ZOMBIES_SECRET_MIDI_MS` | 300 000 | (v8) tour du cadran des pendules remontées : midi sonne une fois par tour (essais : 20 000) |
| `PDJ_FPS_ZOMBIES_SECRET_LIVRAISON` | 3 | (v8) première livraison du Truck Muche où le service final du secret s'ouvre (essais : 1) |

`GET /sante` renvoie `{ ok, joueurs, enJeu, match, zombies: { joueurs, enJeu, phase, manche, suspendue, enSuspens }, br: { joueurs, enJeu, phase, vivants, parties }, parties, navigationBots: { recherches, noeudsMax, enAttente }, sallesTiquees, ticMaxMs, ticsLents, alerte? }`
(connectés, joueurs en arène, numéro du match, puis la salle des zombies tigres : 8 membres au plus lobby compris, `enSuspens` = sessions RÉSEAU coupées qui attendent leur reprise (toutes les parties de zombies ; sans rapport avec la pause d'une partie par un joueur, qui est `suspendue`), puis le Battle Royale : 50 membres au plus lobby compris).
Les champs plats historiques décrivent les parties permanentes `ar1`, `z1`, `br1` ; `parties` (v11) liste TOUTES les parties de tous les modes : `[{ id, mode, permanente, joueurs, humains, bots, phase, suspendue? }]`, `sallesTiquees` le nombre de salles tiquées au dernier tic.
`navigationBots` (IA des bots, lot 3b) : recherches de chemin A* depuis le démarrage (UN budget pour toutes les parties de BR : au plus une recherche par période de 12 ms), le plus gros A* en nœuds explorés (borné à 3 000) et les bots qui attendent leur tour ; la grille de navigation du BR et ses composantes connexes sont précalculées AVANT `listen` (≈ 0,5 s de démarrage) puis copiées dans chaque salle BR neuve.
`ticMaxMs` est la durée du plus long tic (les trois salles et leurs diffusions) de la dernière minute environ, `ticsLents` le nombre de tics de plus de 8 ms depuis le démarrage, `alerte: true`
(champ absent sinon) si l'un d'eux a dépassé 8 ms dans la dernière minute : c'est le signal à surveiller après un déploiement.
`GET /stats-br` renvoie `{ lignes }` : le palmarès du Battle Royale (top 50 : TOP 1 décroissant, puis kills, puis parties croissant, puis pseudo), `cache-control: no-store`, `access-control-allow-origin`
seulement pour une origine autorisée par `ORIGINES`. Limites : messages ≤ 16 Ko ; anti-flood
à deux seaux (`lib/fps/anti-flood.ts`) : flux `etat` / `conduite` / `pilotage` / `ping` à 45/s (rafale 90), autres messages à 90/s (rafale 270), l'excédent est JETÉ sans fermer la socket, seule une fenêtre de plus de 600 messages bruts en une seconde vaut `erreur flood` et fermeture ; ping WebSocket toutes les 5 s (connexion morte fermée au bout de 10 s : un joueur parti ne reste pas en cible),
« bonjour » attendu dans les 10 s. Capacité : 16 joueurs EN ARÈNE (les spectateurs de la vue 3D n'occupent aucune place ; `rejoindre` au-delà répond `refus plein`, la socket reste ouverte), 64 connexions inscrites au plus par salle d'arène (50 en Battle Royale, 8 en zombies), 160 connexions au total et 24 par IP par défaut (`PDJ_FPS_CONNEXIONS_TOTAL` / `PDJ_FPS_CONNEXIONS_IP` ; dernier élément de `x-forwarded-for`, fermeture 1013 au-delà), un spectateur muet depuis 15 min est recyclé (le client se reconnecte seul), sauf dans un lobby Battle Royale d'au moins deux joueurs. Un joueur vivant sans état accepté depuis 20 s (onglet gelé) est retiré de l'arène
(le client redemande à entrer) ; pas dans la salle des zombies (v8), où un membre dont la connexion se ferme est gardé 20 s (`REPRISE_MS`) : le client qui revient
avec l'id et le jeton de son dernier `bienvenue` (`bonjour.reprise`) retrouve sa partie au même id (`bienvenue{reprise}`, sans téléportation). Les tirs sont validés contre les positions de la cible des 300 dernières ms
(compensation de latence, `positionsCible` dans `lib/fps/match.ts`).

## Parties parallèles (v11)

Chaque mode a PLUSIEURS parties en même temps, chacune avec sa salle et son monde mutable (jamais partagé : brèches, portes achetées, navigation en cache par monde). Registre pur `lib/fps/parties.ts` (`RegistreParties`),
routage pur `lib/fps/salons.ts` (`decisionPartie`) : ids `ar1`, `ar2`… (arène), `z1`, `z2`… (zombies), `br1`, `br2`… (BR), un compteur par mode, jamais réutilisé. `ar1`, `z1` et `br1` sont permanentes (`ar1` est le hall de tout nouvel
arrivant : la présence du Palantir y vit et elle tique toujours, Elsa et le bus C3 compris) ; les autres sont créées par `mode{mode, partie:"nouvelle"}` et refermées dès qu'elles n'ont plus de membre humain (après chaque
`mode`, chaque déconnexion et une fois par seconde). `mode{mode, partie}` : id d'une partie de `salons.listes[mode]`, `"nouvelle"` (reprend d'abord une partie vide qui accueille), `"auto"` (arène : la plus peuplée qui accueille
EN JEU, sinon une nouvelle ; la place est réservée 5 s) ; sans `partie`, un client déjà dans une partie du mode reçoit l'écho de la sienne, sinon `choisirPartie` choisit. Un `rejoindre` d'arène refusé pour `plein`
porte `alternative` (id d'une autre arène qui accueille). Les clients d'avant la v11 sont toujours routés vers la partie permanente de l'arène et des zombies. Limites de création (`refus{mode, limite}`) : plafonds par mode et au total,
délai de 10 s par client et rafale bornée par IP, parties ouvertes par IP et par mode, disjoncteur sur plusieurs tics lents récents ; rien de tout cela pour le Battle Royale des clients v10 (4 parties au plus comme avant). Quand la création est impossible (plafond ou limite), `mode` SANS `partie` se rabat sur la première partie qui a de la place, seul `partie:"nouvelle"` est refusé `limite`. `salons.listes` (v11) liste les parties de chaque mode ; `salons.parties` ne contient QUE les parties BR (clients v10) et les champs `arene`, `zombies`,
`br` résument les parties permanentes. Reprise réseau : un membre d'une partie de zombies coupé (n'importe laquelle) retrouve SA partie si elle existe encore, sinon il est routé comme un arrivant.
Spec : `docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md`. Déploiement : voir « Protocole v11 (résumé) ».

## Trois salles, salons

Tout client est d'abord spectateur de la salle d'arène (comportement historique). Le message `mode{mode: "arene" | "zombies" | "br"}` le fait changer de salle : la décision
(`lib/fps/salons.ts`, pure : écho, `refus{action: "mode", raison: "lobby"}` s'il est déjà en jeu, `raison: "plein"` si la salle d'arrivée est pleine : 8 membres en zombies, 50 en Battle Royale) est prise
AVANT de quitter l'ancienne salle (le mode d'un client se retrouve par identité de sa salle dans la table `SALLES` : `modeDeSalle`, un client du Battle Royale n'est jamais pris pour un client de l'arène),
puis le serveur répond `mode` (écho) et le `bienvenue` de la nouvelle salle (même id, même pseudo). Le message `salons`
(joueurs et joueurs en jeu de l'arène, phase / joueurs / manche des zombies, phase / joueurs / vivants / palier du Battle Royale) est envoyé à TOUS les clients à la connexion puis à 1 Hz s'il a changé. Le serveur oublie la salle
choisie à la reconnexion : l'interface renvoie `mode{zombies}` ou `mode{br}` dès le `bienvenue` si elle y était (une reconnexion EN COURS de partie Battle Royale n'existe pas en v1 : la place est éliminée). Les clients qui n'ont rien choisi ne coûtent rien aux salles des
zombies et du Battle Royale, dont le tic est sauté tant qu'elles sont vides. Une partie de zombies : lobby (l'hôte, premier arrivé, lance) → décompte → manches séparées de pauses → bilan de 25 s → lobby ;
un arrivant en cours de partie reste en attente et entre à la pause suivante. Une partie de Battle Royale : lobby (hôte, 2 joueurs au moins, noms distincts) → décompte (fini dès que tous ont rejoint) →
avion → chute et parachute (simulés en temps réel par le serveur) → fouille et tempête, mort définitive avec spectateur → bilan de 30 s → lobby. Plusieurs parties tournent en même temps
(2026-10-29, `docs/superpowers/specs/2026-10-29-br-voix-parties-design.md`) : la salle permanente `br1`, plus celles qu'ouvrent les joueurs arrivés pendant une partie en cours
(`mode{mode:"br", partie:"nouvelle"}`, au plus `PDJ_FPS_BR_PARTIES`), refermées dès qu'elles sont vides ; `salons.parties` les liste, `mode{mode:"br", partie}` en choisit une.
Un arrivant en cours de partie peut aussi la regarder en spectateur (`regarder` → `spectateur` : en jeu sans être en vie, hors du snap).
Chat vocal : le serveur ne relaie `voix` qu'entre deux joueurs en vie (le client n'appelle que ses voisins) ou entre deux spectateurs (éliminés et spectateurs venus regarder) ;
un joueur en vie n'entend jamais un spectateur, sauf le lien de killcam : une victime et son tueur, pendant `LIEN_VOIX_KILLCAM_MS` (12 s) après la mort (dans l'arène aussi, ce lien passe outre la proximité). Les messages `tir`, `coup` et `degats` portent `ts` (horodatage serveur) et le snap recopie `vise` / `recharge` déclarés dans `etat` : tout est additif, sans changement de version. Les statistiques (clé = pseudo, les pseudos `Agent*` ne comptent pas) s'écrivent dans `PDJ_FPS_BR_STATS` à la fin d'une partie comptée (2 joueurs atterris au moins, `PDJ_FPS_BR_VALIDE_MS` écoulées) :
écriture atomique asynchrone (fichier temporaire du même dossier, `fsync`, `rename`, une seule à la fois), synchrone seulement à l'arrêt (SIGTERM), fichier illisible renommé `stats-br.json.corrompu-<horodatage>`. Les ids des tigres zombies sont `z<n>` (jamais ceux des tigres largués `t<n>` de l'arène, qui n'existent pas dans cette salle).

## Protocole v11 (résumé)

La v11 (spec `docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md`) apporte trois choses :

* **Pause des zombies** (`pauseZ{actif}` → `zpause{actif, par, pseudo, maintenant, compte?}`) : n'importe quel joueur ADMIS de la partie (debout, à terre, éliminé en attente de relève ; pas pendant le décompte de lancement ni tant qu'un
  admis charge encore, `refus{pause, lobby}`) la suspend pour tous. `Salle` convertit l'horloge réelle en horloge VIRTUELLE (`tJeu = réel − décalage`, `lib/fps/suspension.ts`) AVANT de la passer au moindre service : suspendue, elle vaut une
  constante, `Salle.tic` ne tique rien et tout message de jeu est jeté (liste BLANCHE : `pseudo`, `quitter`, `ping`, `vueScores`, `voixActif`, `voix`, `rejoindre`, `pauseZ`). Aucun fichier de jeu n'a été modifié : la garde
  `suspension.horloge.test.ts` vérifie qu'aucun module serveur de `lib/fps` ne lit l'horloge réelle. N'importe quel admis lève (`pauseZ{false}`) : compte à rebours `PDJ_FPS_ZOMBIES_COMPTE_MS` (3 s, jeu encore figé) annulable
  UNE fois par suspension par un `pauseZ{true}`, ou levée immédiate si l'admis est seul. Abus (plusieurs humains admis seulement ; un joueur seul en est exempté) : 10 s entre deux suspensions d'un même joueur, 5 min au plus par
  suspension (levée automatique, compte à rebours non annulable), 15 min cumulées par partie (remises à zéro à chaque partie) ; refus : `refus{pause, limite}` ; `refus{pause, plusieurs}` si l'auto-suspension du joueur seul
  (Échap, perte du pointer lock) tombe alors que plusieurs humains sont admis. `zpause` est émis à CHAQUE `bienvenue` de la salle des zombies (suspendue ou non : un client gelé qui se reconnecte ou change de salle n'y reste pas),
  puis, si elle est suspendue, un snap et un `zombies{etat}` ciblés ; `bienvenue.maintenant` et `pong.maintenant` sont l'horloge virtuelle. Tant qu'une salle est suspendue, la reprise RÉSEAU de ses membres coupés passe de 20 à
  60 s (`PDJ_FPS_REPRISE_SUSPENDUE_MS`). `/sante` : `zombies.suspendue` et `parties[].suspendue` (pause d'un joueur) sont distincts de `zombies.enSuspens` (sessions réseau coupées). Arène et BR n'ont pas de pause.
* **Parties parallèles** : voir plus haut.
* **Bots du Battle Royale** (`lib/fps/bots-br.ts`, `match-br-bots.ts`) : de vrais `JoueurSalle` de la `table` (ids `b<n>`, `^b\d+$`, `bot: true` dans la présence et le bilan), qui passent par `Salle.recevoir` comme un client (cadence, œil et direction
  du tir, rejeu de latence, dégâts, butin, killcam inchangés) mais sans socket, ni voix, ni reprise. L'hôte les règle au lobby : `lancerPartie{difficulte?, bots?}` (`bots` entier 0 à 20, borné par la place et le quota
  global ; la difficulté Entrée / Plat du jour / Goulaf règle réaction, précision et rafales) ; seul et sans `bots`, il reçoit 11 bots (aussi pour les clients v9 et v10, qui les voient comme des humanoïdes fil de fer). Une partie
  avec bots est de l'entraînement : jamais comptée (TOP 1, kills, parties). Le vol ne part que si un humain est monté, la partie s'achève 15 s après la mort du dernier humain en vie, les bots sont retirés au retour au lobby et
  quand la partie se vide. Un seul A\* par période de 12 ms pour tout le serveur (3 000 nœuds au plus), grille de navigation précalculée avant `listen`. `PDJ_FPS_BR_BOTS_ESSAI=agressif` rend les essais déterministes.

**Ordre de déploiement : le serveur d'abord, puis la fusion du client.** Le serveur v11 accepte les clients 8, 9, 10 et 11 (`VERSIONS_ACCEPTEES`) ; la salle des zombies n'est ouverte qu'aux clients v11 (`VERSION_MIN_ZOMBIES = 11` : un client plus
ancien ne gèlerait pas son horloge pendant une pause, il reçoit `erreur{version}`, « rechargez la page »). Un client v11 devant un serveur plus ancien est refusé de la même façon. Ne JAMAIS `docker compose down -v`. Après le déploiement,
surveiller `/sante` (`ticMaxMs`, `ticsLents`, `alerte`, `parties`, `navigationBots`) et la mémoire du conteneur (1 vCPU, 512 Mo) avec deux parties de chaque mode, puis ajuster `PDJ_FPS_*_PARTIES`, `PDJ_FPS_PARTIES_TOTAL` et
`PDJ_FPS_BR_BOTS_*` (les valeurs par défaut sont provisoires tant que `lib/fps/serveur.charge-agregee.test.ts`, à lancer SEUL, n'a pas été confirmé sur le VPS).
## Descente de police et événements paramétrables (2026-10-30)

Spec `docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md`, `VERSION_PROTOCOLE` reste **11** (tout est additif).

* **Descente de police** (`lib/fps/match-police.ts`, service PUR de `Salle` construit en dernier ; règles par mode `police-regles.ts`, constantes et cible `police.ts`) : une voiture de police surgit d'un point de route hors de la vue de tout le monde
  (à 90 m au moins), fonce sur **le joueur qui a le plus de kills** en arène (sans kill dans le match : elle attend un premier kill, 60 s au plus, puis vise le plus proche) et sur **l'ennemi humain le plus proche** en Battle Royale, l'écrase s'il est
  à pied (cause de mort `police`, aucun kill crédité), se retire après 22 s ou quand elle est détruite à coups de feu (700 PV, cible de tir `police`, boîte orientée rejouée sur son historique). Elle est RARE : une descente toutes les 5 à 9 min en
  arène (jamais pendant un autre événement ni dans les 20 s qui suivent, ni dans la première minute d'un match), une seule par partie de Battle Royale (deux à partir de 20 joueurs au départ), jamais en vol, jamais avec moins de 4 vivants.
  Message `police{debut|fin|etat}` et champ de snap `monstres.police` (la police n'est PAS un `TypeEvenement`). **Capacités** : le client à jour annonce `bonjour.capacites: ["police"]` ; un joueur sans la capacité (client d'avant)
  est immunisé et jamais choisi pour cible, donc l'ordre de déploiement serveur / client est indifférent. La navigation de la voiture (grille de dégagement 1,8 m) est précalculée avant `listen` puis COPIÉE dans chaque monde neuf
  (`copierCarteNavigation`) ; les recherches de chemin passent par le budget unique du serveur (un A\* par 12 ms, parties confondues).
* **Réglages d'événements d'une arène** (`reglages-arene.ts`, `evenements-arene.ts`) : le créateur d'une arène choisit au lobby les événements (Elsa, avion et tigres largués, bus C3, Truck Muche fou, tigre robot géant et titan, descente de police) et
  la fréquence (Calme / Normal / Chaos), envoyés dans `mode{mode:"arene", partie:"nouvelle", reglages}`. Le serveur NORMALISE (jamais d'erreur : liste fermée, doublons retirés, `evenements` absent = tous, `[]` = aucun, fréquence inconnue = `normal`),
  la partie porte ses réglages (`Partie.config`) jusqu'à sa fermeture et les publie (écho `mode.reglages`, `salons.listes.arene[].reglages`). `ar1` (le hall) a les réglages par défaut du serveur (`PDJ_FPS_EVT_ACTIFS`, `PDJ_FPS_EVT_FREQUENCE`) ;
  une arène vide n'est reprise que par qui demande EXACTEMENT les mêmes réglages. Décocher `avion` supprime aussi le sort d'invocation, décocher `tigre` le titan, décocher `bus` supprime les armes uniques larguées (les frappes aériennes et
  les fumigènes continuent). Plafond d'arènes atteint : `refus{mode, limite}`.
* **Battle Royale** : `lancerPartie{police?}` (hôte, activée par défaut), publié dans `EtatPartieBr.police`.
* **Zombies** : pas de voiture, une **patrouille** (`patrouille-zombies.ts`) passe en trombe hors de la carte, sirène et lueur bleu/rouge, 2 fois au plus par partie à partir de la manche 3, jamais pendant une manche du Truck Muche, message
  `zevt{e:"patrouille", p0, p1, t0, finT}` (horloge virtuelle : la pause la fige). Son propre générateur de hasard (le hasard de la salle n'est pas consommé).
* **Son** : `public/arene/sons/sirene-police.mp3` (son ORIGINAL du joueur, FL Studio ; crédité dans `public/arene/CREDITS.txt`), joué en boucle par le client avec effet Doppler et filtre de distance (`Sons.sirenePolice`).

**Déploiement** : reconstruire et redéployer le serveur AVANT la fusion du client (sans lui, ni réglages d'événements ni police) ; jamais de `docker compose down -v`. À surveiller après le déploiement : `/sante.ticMaxMs` et `alerte` pendant une descente.

## Aperçu des spectateurs (vue Palantir, issue #84)

Spec `docs/superpowers/specs/2026-10-29-apercus-modes-design.md`. Le message serveur **`apercu`** (additif, `VERSION_PROTOCOLE` inchangé : un client d'avant l'ignore, un client à
jour devant un serveur d'avant n'en reçoit jamais et affiche une simulation) montre une partie de **zombies** ou de **Battle Royale** aux seuls spectateurs de la salle (inscrits hors jeu :
la vue Palantir avec le panneau « Arène » ouvert) : `{ t: "apercu", ts, mode, partie?, j: [[id, pseudo, couleur, x, y, z (décimètres), drapeaux]], z?: SnapZombies, m?: manche, br?: { phase, vivants, total, zone, avion } }`.
Il réutilise le snap et les tigres déjà calculés (`Salle.sortiesSnap`, aucun recalcul) : un snap sur 4 en zombies (5 Hz), sur 3 en Battle Royale (3,3 Hz), **zéro octet sans spectateur**
(budgets : ≤ 3,6 Ko à 50 joueurs en BR, ≤ 1,8 Ko pour 8 joueurs et 24 tigres). L'arène garde son snap aux spectateurs. En Battle Royale, un spectateur dont la partie n'est ni en vol ni en
jeu reçoit l'aperçu de la partie en cours qui compte le plus de survivants (`partieApercuBr` de `salons.ts`, relayé par `index.ts` ; `partie` porte l'id de la partie d'où il vient) ; la salle
calcule alors son aperçu même sans spectateur (`Salle.relaiApercu`, posé une fois par seconde). **Le serveur doit être reconstruit et redéployé** pour que le direct existe ; ordre indifférent
avec le site (sans lui, la vue affiche des simulations avec un bandeau « SIMULATION »). Aucune variable d'environnement nouvelle.

## Protocole v10 (résumé)

La v10 change les règles de l'inventaire des zombies (spec `docs/superpowers/specs/2026-10-29-zombies-inventaire-design.md`) : emplacements d'armes
génériques (deux armes à feu de n'importe quelle catégorie, une troisième avec l'atout Bento `atout:bento`, la nouvelle arme remplace celle en main),
`coup` accepté arme à feu en main en zombies (coup de couteau rapide, cadence selon le poids de l'arme, `lib/fps/coup-rapide.ts`), `main{couteau}`
refusé à partir de deux armes, armes à munitions limitées jamais retirées en zombies. L'arène et le BR ne changent pas : le serveur accepte les
versions 8, 9 et 10 (`VERSIONS_ACCEPTEES`), mais un client d'avant la v10 qui demande la salle des zombies reçoit `erreur{version}`
(« rechargez la page », `VERSION_MIN_ZOMBIES`). **Ordre de déploiement : le serveur d'abord, puis la fusion du client.**

## Protocole v8 (résumé)

La v8 ajoute le Battle Royale (spec `docs/superpowers/specs/2026-10-28-battle-royale-design.md`) par des ajouts seulement : mode `br`, client `sauter`, `chute{lacet, tangage, avance, lateral, ouvrir}` (entrées de la chute, 30 Hz),
`ramasser{id}`, `lacher{slot}`, `utiliser{objet}`, `statsBr` ; serveur `br{etat}`, `saut`, `atterri`, `butin`, `ramasse`, `inventaire`, `soin`, `statsBr`, `salons.br`, `snap.joueurs[].chute`, causes de mort `tempete` et `abandon`,
`Equipement.sansSecondaire`. Le serveur accepte les versions 7 et 8 (`VERSIONS_ACCEPTEES`) : un client v7 est servi en arène et en zombies, et ne voit jamais le Battle Royale ; le 7 sera retiré dans un second temps.

## Protocole v7 (résumé)

La v7 refond le mode zombies façon Black Ops 1 (spec `docs/superpowers/specs/2026-10-28-zombies-bo1-design.md`) : `lancerPartie{difficulte?}`, `reparer{fenetre}`
(reposer les planches), `equipement.ravitaille` accepte `"tout"` (munitions max), `Equipement.ameliorees` (armes passées au Pack-a-Punch), arme secondaire
`rayon` (zombies seulement), snap `zombies` avec l'allure et le mode de chaque tigre (bits 4 à 7 des drapeaux) et `t` (le Truck Muche), `zombies{etat}` enrichi
(difficulté, courant, boîte, Pack-a-Punch, planches des fenêtres, bonus au sol, effets, quête, Truck, murs achetés, atouts des joueurs), effets ponctuels `zevt`,
`zombieMort.cause`, cible de tir `livraison` (le Truck). Variables d'essai en plus : `PDJ_FPS_ZOMBIES_TRUCK` (première manche du Truck, 0 = jamais) et
`PDJ_FPS_ZOMBIES_COURANT=1` (courant rétabli au départ).

Les ajouts de la v6 : `mode`, `lancerPartie`, `acheter{id}`, `reanimer{cible}`, `coup{o, d, cibles}` (ids de joueurs, de tigres largués `t<n>` ET de tigres zombies `z<n>` ; l'épée en frappe 3 au plus), `rejoindre` / `equiper`
avec `melee?` ; en retour `salons`, `mode`, `zombies{etat}`, `argent`, `achat`, `zombieMort`, `snap.zombies`, `equipement.ravitaille`, `batiments` (portes achetées), cause de mort `tigre_zombie` et `coup{id, o, d, arme}`
pour les autres joueurs. Détail dans `lib/fps/protocole.ts`. Le résumé ci-dessous date de la v2 et de la v5 :

### Résumé v2 à v5

Contrat complet et commenté : `lib/fps/protocole.ts` (ne change qu'avec le client, `lib/fps/reseau.ts`). Premier message obligatoire :
`bonjour{v, pseudo}` ; une version différente de `VERSION_PROTOCOLE` reçoit `erreur{version}` (« rechargez la page ») et la socket est fermée.

* **Client → serveur** : `rejoindre{principale, secondaire}` (l'alias v1 `arme` reste accepté), `quitter`, `pseudo`, `equiper` (équipement de la prochaine apparition),
  `main{slot}` (principale, secondaire, couteau, spéciale), `etat` (≈ 30 Hz : position, vitesse, regard, posture, `accroupi?`, `glisse?`), `tir{arme, o, d[], touches[]}`,
  `coup{o, d, cibles}` (couteau ou épée), `monter{vehicule, siege?}`, `descendre`, `siege`, `conduite` (≈ 30 Hz, conducteur seulement, remplace `etat`),
  `vueScores{ouvert}` (tableau des scores maintenu), `voixActif` / `voix` (chat vocal, v3), `pilotage` / `canon` (titan, v4), `invoquer` (sort d'invocation), `ping`.
* **Serveur → client** : `bienvenue`, `presence`, `snap` (20 Hz, joueurs en jeu + `vehicules`), `apparition` (le joueur se téléporte, avec son équipement), `equipement`,
  `tir` / `coup` (autres joueurs : traçantes, sons), `degats` (cible, tireur, zone, PV et bouclier restants : source des retours de touche), `mort` (cause, `tueur`, `ts` du rejeu de la killcam,
  délai de réapparition), `match` (classement), `elsa{etat|apparue|prise|expiree}`, `ramassage`, `sieges`, `embarque`, `descente`, `refus{action, raison}`
  (jamais `erreur` pour un refus : le serveur ferme la socket sur tout `erreur`), `scores` (statistiques, 1 Hz aux clients ouverts), `pong`, `erreur{plein|version|pseudo|flood}`.
  v3 : `voitures`, `explosion`, `voix`. v4 : `snap.monstres`, `evenement`, `laser`, `onde`, `explosionMonstre`, `batiments`, `titan`, `canon`, causes `explosion`, `truck_fou`, `tigre_robot`, `titan`.
  Tigres largués : `snap.tigres` (identifiant, sauvage ou allié avec son lanceur, position, cap, état, pose, PV, action en cours et son instant de début),
  `avion{passage|largage|etat}` (trajectoire, instant du largage, identifiant du tigre largué), `tigre{apparu|alerte|touche|mort|parti}`,
  `sort{gagne|lance|perdu}`, cause de mort `tigre` (`par` = le lanceur d'un tigre allié, "" pour un tigre sauvage).
* **Tigres largués** : un avion passe toutes les 90 à 180 s en phase de jeu avec 2 joueurs au moins en arène, aucun tigre sauvage en vie et pas d'événement du tigre géant, et largue un
  tigre au-dessus d'une cachette de l'anneau à plus de 30 m de tout joueur. Le tigre sauvage (2 500 PV) se tapit, s'alerte, attaque (patte 25, bond annoncé 40,
  aucun coup au-delà de 40), s'enfuit sous 30 % et repart au bout de 4 min. Le joueur qui l'achève gagne une charge du sort, perdue à sa mort. Le tigre
  allié (500 PV, 30 s) attaque l'ennemi le plus proche du lanceur à 18 m (patte 15 par seconde), ses kills reviennent au lanceur. Un tir ou un coup de
  couteau dont la cible est l'identifiant d'un tigre est validé comme sur un joueur, sur les positions du tigre des 300 dernières ms (200 ms au couteau)
  et sa silhouette selon la pose. Les voitures lancées lui infligent 150 dégâts. Le tigre géant n'est pas annoncé pendant le survol de l'avion ni tant
  qu'un tigre sauvage largué vit.
* **Règles côté serveur** : un état n'est accepté que dans la vitesse permise depuis le dernier état accepté (un téléporteur est ignoré) ; un tir ou un coup est validé
  (cadence, œil proche de la position connue, direction conforme à la visée, ligne de vue, portée, positions de la cible rejouées sur 300 ms, 200 ms au couteau) ;
  aucune dispersion, la gerbe du pompe est fixe et vérifiée à 0,02 rad ; les voitures conduisibles suivent le conducteur (`y` imposé à 0, vitesse bornée), les passagers tirent avec
  leur arme en main (le conducteur non) ; les voitures PNJ (12 sur 4 circuits, 9 m/s) tuent à pied, instant de test propre à chaque joueur ; Elsa est à (−120 ; 39) près du Truck Muche.
* **Capacité** : voir plus haut ; `rejoindre` refusé (`refus{plein}`) au-delà de 16 joueurs en arène, `quitter` puis `rejoindre` ne contourne ni la réapparition (4 s) ni la santé (mémorisée 60 s).

## Tests de bout en bout

Depuis la racine, Node 22, Playwright (`npm i --no-save playwright`). Les scripts lancent ce serveur sur un port libre (jamais 8787 : un onglet de développement ouvert sur le site
s'y reconnecterait), un `next dev` pointé dessus (`NEXT_PUBLIC_FPS_WS_URL`) et des Chromium headless, puis arrêtent ce qu'ils ont lancé (captures dans `E2E_OUT`) :

* `node scripts/fps/captures_apercus.mjs` et `node scripts/fps/e2e_apercus.mjs` (aperçu par mode de la vue Palantir, issue #84) : le premier photographie la vue (arène, transition vers les zombies, manche,
  Battle Royale, retour, panneau fermé, mouvement réduit) et vérifie la caméra, le décor et les simulations ; le second fait jouer un client WebSocket dans chaque mode pendant qu'un navigateur regarde
  la vue (direct, bandeau « En direct », retour à la simulation quand il part). Ils lisent `window.__palantir.apercu()` et avancent la simulation par `apercuAvancer` (le rendu logiciel est lent).
* `node scripts/fps/e2e_arene_v2.mjs` : `PDJ_FPS_ELSA_MIN_MS=6000` / `PDJ_FPS_ELSA_MAX_MS=7000`, avion des tigres et événements repoussés d'une heure ; entrée en arène, vue mutuelle, armes, kill confirmé par le serveur,
  killcam, couteau, épée (un troisième navigateur), glissade, conduite et tir d'un passager, Elsa, mini-carte et tableau des scores.
* `node scripts/fps/e2e_arene_tigres.mjs` : avion toutes les 4 à 5 s, événements neutralisés ; avion, tigre sauvage et sort d'invocation. Étapes 1 à 3 vertes ; l'étape 4 (abattre le tigre) et les suivantes (6, 7) échouent sous le rendu logiciel, déjà avant la v11 (le tigre tue les joueurs plus vite qu'ils ne tirent).
* `node scripts/fps/e2e_br.mjs` : décompte, vol, chute et tempête raccourcis (`PDJ_FPS_BR_DECOMPTE_MS`, `_VOL_MS`, `_ALTITUDE`, `_ZONE_ECHELLE`, `_OBJETS`, `_VALIDE_MS`, fichier de stats temporaire), trois navigateurs : lobby,
  départ, saut et atterrissage, ramassage, élimination à l'arme blanche, tempête, victoire, TOP 1 persisté (relu par `GET /stats-br`).
* `node scripts/fps/e2e_zombies.mjs` : `PDJ_FPS_ZOMBIES_ARGENT=3000`, `_TOTAL=3`, `_PAUSE_MS=20000`, `_GRIFFE=5`, `_TRUCK=0`, `_COMPTE_MS=0` ; choix du mode, lobby, lancement par l'hôte, tigres, kill au pistolet,
  achats (fusil à pompe, porte D1, mini Uzi), joueur à terre relevé, coups de couteau, fin de manche sans bonus, grenade et planches, **pause pour tous (9b : tigres, horloge serveur et snaps figés 3 s, levée sans saut d'horloge)**,
  partie perdue, bilan, retour au lobby, **deux parties parallèles (10b : « Créer ma partie », `z2` lancée à part, refermée quand son joueur part)**.
* `node scripts/fps/e2e_br_bots.mjs` : Battle Royale SOLO avec 11 bots, un seul navigateur, `PDJ_FPS_BR_BOTS_ESSAI=agressif` (déterministe : les bots apparaissent près du joueur) ; réglage « Bots » du lobby, avion, atterrissage,
  capture du tigre bipède armé, un bot blesse puis tue le joueur, killcam sur un bot, spectateur, fin 15 s après la mort du dernier humain, bilan « Entraînement : partie non comptée », `GET /stats-br` vide.
  Sans navigateur, en quelques secondes à une minute : `node scripts/fps/protocole_parties.mjs` (parties parallèles des trois modes, plafonds et réserve par mode, limites de création, pause globale, annulation du compte à rebours, coupure
  et reprise réseau d'un joueur pendant la pause, plafonds de la pause, joueur seul exempté, BR solo avec bots, quota global de bots, capacité 50, ancien client v10) et `node scripts/fps/protocole_br_parties.mjs` (parties du BR,
  spectateur venu regarder, relais de la voix). `protocole_parties.mjs` couvre aussi (scénarios 16 à 19, 2026-10-30) les réglages d'événements d'une arène (écho, `salons.listes`, plafond, normalisation des réglages invalides), la descente de police
  forcée par variables d'environnement (client sans la capacité `police` : aucune voiture ; avec : `police{debut}` sur le joueur qui a le plus de kills, `monstres.police` dans les snaps, écrasement sans kill, `police{fin}`), le réglage
  de police du Battle Royale et la patrouille de police des zombies. Les autres scripts de ce chapitre neutralisent la police (`PDJ_FPS_POLICE=off`) et la patrouille (`PDJ_FPS_ZOMBIES_PATROUILLE=off`).
  Aucun de ces scripts n'utilise le port 8787. Captures du tigre bipède sans serveur : `node scripts/fps/captures_bots.mjs` (images dans `docs/medias/bots/`).

## Déploiement (VPS, Docker + Traefik)

Le contexte de build est la **racine du dépôt** (le serveur regroupe `lib/fps`, `lib/agroparc3d`,
`public/agroparc/scene.json` et `public/agroparc/cachettes.json`) :

```bash
docker build -f serveur-fps/Dockerfile -t pdj-fps .        # depuis la racine
# ou, sur le VPS, depuis serveur-fps/ :
ORIGINES=https://<domaine-du-site> docker compose up -d --build
```

**Chaque version remplace la précédente sur le même hôte** (`wss://pdj-fps.toam.tech`). **Ordre de déploiement de la v8 : le serveur d'abord, puis la fusion du client.** Le serveur v8 accepte les clients v7 et v8 (`VERSIONS_ACCEPTEES`), donc
le site en production continue de fonctionner pendant et après `docker compose up -d --build` sur le VPS (dossier `/opt/pdj-fps`) ; ensuite seulement, fusion de la PR et déploiement Vercel du client v8. L'ordre inverse est cassant : un client v8 devant un serveur v7
reçoit `erreur{version}` (« rechargez la page »), la socket est fermée et l'arène entière est indisponible. (Avant la v8, la v7 (zombies façon Black Ops 1) imposait un déploiement simultané, un seul numéro de version étant accepté.) Le retrait du 7 est une PR ultérieure.
`ORIGINES` doit inclure le site et le joker des previews Vercel. Le Dockerfile n'a besoin d'aucune copie en plus pour les zombies (les imports restent dans `lib/fps` et `lib/agroparc3d`).

`docker-compose.yml` : conteneur `pdj-fps` (les trois salles) sur le réseau externe `dokploy-network`, 512 Mo, 1 vCPU (le Battle Royale à 50 joueurs envoie ≈ 86 Ko/s par client à 10 Hz ; à MESURER après le déploiement avec `/sante.ticMaxMs` et `docker stats`),
volume nommé `pdj-fps-donnees` monté sur `/donnees` (statistiques du Battle Royale : **ne jamais `docker compose down -v`**, il emporterait les TOP 1) et `PDJ_FPS_CONNEXIONS_IP=60`. Le volume appartient à l'utilisateur `node` de l'image (`chown` dans le Dockerfile).
(`lib/fps/match.charge.test.ts` : 16 joueurs, 6 voitures conduisibles, 12 PNJ et Elsa, un tic coûte ≈ 0,05 ms de CPU et un snap pèse ≈ 3,5 Ko,
`lib/fps/match.charge-tigres.test.ts` : la même salle avec un tigre sauvage en attaque et quatre tigres alliés, tic du même ordre et snap ≈ 3,8 Ko ;
`match.zombies.charge.test.ts` : 8 joueurs et 24 tigres, un tic ≤ 2 ms en moyenne et un snap ≤ 4,2 Ko ; `match.br.charge.test.ts` : 50 joueurs, snap ≤ 10,5 Ko, tic ≤ 2 ms en moyenne, à lancer SEUL),
redémarrage automatique, aucun port publié. Route Traefik (`/etc/dokploy/traefik/dynamic/pdj-fps.yml`,
adapter le nom du résolveur de certificats) :

```yaml
http:
  routers:
    pdj-fps:
      rule: Host(`pdj-fps.toam.tech`)
      entryPoints: [websecure]
      service: pdj-fps
      tls:
        certResolver: letsencrypt
  services:
    pdj-fps:
      loadBalancer:
        servers:
          - url: http://pdj-fps:8787
```

Le client se connecte à `wss://pdj-fps.toam.tech` (ou `NEXT_PUBLIC_FPS_WS_URL`). Vérification :
`curl https://pdj-fps.toam.tech/sante`.
