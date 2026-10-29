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
| `PDJ_FPS_BR_VALIDE_MS` | 60 000 | durée minimale (ms) depuis le départ de l'avion pour qu'une partie compte dans les stats (avec 2 joueurs atterris au moins) |
| `PDJ_FPS_CONNEXIONS_IP` | 24 | connexions simultanées par adresse IP (le `docker-compose.yml` de prod met 60 : cinquante amis derrière l'IP d'un bureau) |
| `PDJ_FPS_CONNEXIONS_TOTAL` | 160 | connexions simultanées au total, inscrites ou non |
| `PDJ_FPS_ZOMBIES_SECRET` | 0 | (v8) grand secret « Le Menu fantôme » : étape de départ de chaque partie, 1 à 9 (les précédentes sont considérées faites ; 9 = servi, la cloche finit la partie). Solution : `docs/superpowers/specs/2026-10-29-zombies-secret-SOLUTION.md` |
| `PDJ_FPS_ZOMBIES_SECRET_MIDI_MS` | 300 000 | (v8) tour du cadran des pendules remontées : midi sonne une fois par tour (essais : 20 000) |
| `PDJ_FPS_ZOMBIES_SECRET_LIVRAISON` | 3 | (v8) première livraison du Truck Muche où le service final du secret s'ouvre (essais : 1) |

`GET /sante` renvoie `{ ok, joueurs, enJeu, match, zombies: { joueurs, enJeu, phase, manche, enSuspens }, br: { joueurs, enJeu, phase, vivants }, ticMaxMs, ticsLents, alerte? }`
(connectés, joueurs en arène, numéro du match, puis la salle des zombies tigres : 8 membres au plus lobby compris, une seule partie à la fois, `enSuspens` = sessions coupées qui attendent leur reprise, puis le Battle Royale : 50 membres au plus lobby compris).
`ticMaxMs` est la durée du plus long tic (les trois salles et leurs diffusions) de la dernière minute environ, `ticsLents` le nombre de tics de plus de 8 ms depuis le démarrage, `alerte: true`
(champ absent sinon) si l'un d'eux a dépassé 8 ms dans la dernière minute : c'est le signal à surveiller après un déploiement.
`GET /stats-br` renvoie `{ lignes }` : le palmarès du Battle Royale (top 50 : TOP 1 décroissant, puis kills, puis parties croissant, puis pseudo), `cache-control: no-store`, `access-control-allow-origin`
seulement pour une origine autorisée par `ORIGINES`. Limites : messages ≤ 16 Ko ; anti-flood
à deux seaux (`lib/fps/anti-flood.ts`) : flux `etat` / `conduite` / `pilotage` / `ping` à 45/s (rafale 90), autres messages à 90/s (rafale 270), l'excédent est JETÉ sans fermer la socket, seule une fenêtre de plus de 600 messages bruts en une seconde vaut `erreur flood` et fermeture ; ping WebSocket toutes les 5 s (connexion morte fermée au bout de 10 s : un joueur parti ne reste pas en cible),
« bonjour » attendu dans les 10 s. Capacité : 16 joueurs EN ARÈNE (les spectateurs de la vue 3D n'occupent aucune place ; `rejoindre` au-delà répond `refus plein`, la socket reste ouverte), 64 connexions inscrites au plus par salle d'arène (50 en Battle Royale, 8 en zombies), 160 connexions au total et 24 par IP par défaut (`PDJ_FPS_CONNEXIONS_TOTAL` / `PDJ_FPS_CONNEXIONS_IP` ; dernier élément de `x-forwarded-for`, fermeture 1013 au-delà), un spectateur muet depuis 15 min est recyclé (le client se reconnecte seul), sauf dans un lobby Battle Royale d'au moins deux joueurs. Un joueur vivant sans état accepté depuis 20 s (onglet gelé) est retiré de l'arène
(le client redemande à entrer) ; pas dans la salle des zombies (v8), où un membre dont la connexion se ferme est gardé 20 s (`REPRISE_MS`) : le client qui revient
avec l'id et le jeton de son dernier `bienvenue` (`bonjour.reprise`) retrouve sa partie au même id (`bienvenue{reprise}`, sans téléportation). Les tirs sont validés contre les positions de la cible des 300 dernières ms
(compensation de latence, `positionsCible` dans `lib/fps/match.ts`).

## Trois salles, salons

Tout client est d'abord spectateur de la salle d'arène (comportement historique). Le message `mode{mode: "arene" | "zombies" | "br"}` le fait changer de salle : la décision
(`lib/fps/salons.ts`, pure : écho, `refus{action: "mode", raison: "lobby"}` s'il est déjà en jeu, `raison: "plein"` si la salle d'arrivée est pleine : 8 membres en zombies, 50 en Battle Royale) est prise
AVANT de quitter l'ancienne salle (le mode d'un client se retrouve par identité de sa salle dans la table `SALLES` : `modeDeSalle`, un client du Battle Royale n'est jamais pris pour un client de l'arène),
puis le serveur répond `mode` (écho) et le `bienvenue` de la nouvelle salle (même id, même pseudo). Le message `salons`
(joueurs et joueurs en jeu de l'arène, phase / joueurs / manche des zombies, phase / joueurs / vivants / palier du Battle Royale) est envoyé à TOUS les clients à la connexion puis à 1 Hz s'il a changé. Le serveur oublie la salle
choisie à la reconnexion : l'interface renvoie `mode{zombies}` ou `mode{br}` dès le `bienvenue` si elle y était (une reconnexion EN COURS de partie Battle Royale n'existe pas en v1 : la place est éliminée). Les clients qui n'ont rien choisi ne coûtent rien aux salles des
zombies et du Battle Royale, dont le tic est sauté tant qu'elles sont vides. Une partie de zombies : lobby (l'hôte, premier arrivé, lance) → décompte → manches séparées de pauses → bilan de 25 s → lobby ;
un arrivant en cours de partie reste en attente et entre à la pause suivante. Une partie de Battle Royale : lobby (hôte, 2 joueurs au moins, noms distincts) → décompte (fini dès que tous ont rejoint) →
avion → chute et parachute (simulés en temps réel par le serveur) → fouille et tempête, mort définitive avec spectateur → bilan de 30 s → lobby ; un arrivant en cours de partie reste dans le lobby pour la suivante.
Le chat vocal y est désactivé. Les statistiques (clé = pseudo, les pseudos `Agent*` ne comptent pas) s'écrivent dans `PDJ_FPS_BR_STATS` à la fin d'une partie comptée (2 joueurs atterris au moins, `PDJ_FPS_BR_VALIDE_MS` écoulées) :
écriture atomique asynchrone (fichier temporaire du même dossier, `fsync`, `rename`, une seule à la fois), synchrone seulement à l'arrêt (SIGTERM), fichier illisible renommé `stats-br.json.corrompu-<horodatage>`. Les ids des tigres zombies sont `z<n>` (jamais ceux des tigres largués `t<n>` de l'arène, qui n'existent pas dans cette salle).

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

* `node scripts/fps/e2e_arene_v2.mjs` : `PDJ_FPS_ELSA_MIN_MS=6000` / `PDJ_FPS_ELSA_MAX_MS=7000`, avion des tigres et événements repoussés d'une heure ; entrée en arène, vue mutuelle, armes, kill confirmé par le serveur,
  killcam, couteau, épée (un troisième navigateur), glissade, conduite et tir d'un passager, Elsa, mini-carte et tableau des scores.
* `node scripts/fps/e2e_arene_tigres.mjs` : avion toutes les 4 à 5 s, événements neutralisés ; avion, tigre sauvage et sort d'invocation.
* `node scripts/fps/e2e_br.mjs` : décompte, vol, chute et tempête raccourcis (`PDJ_FPS_BR_DECOMPTE_MS`, `_VOL_MS`, `_ALTITUDE`, `_ZONE_ECHELLE`, `_OBJETS`, `_VALIDE_MS`, fichier de stats temporaire), trois navigateurs : lobby,
  départ, saut et atterrissage, ramassage, élimination à l'arme blanche, tempête, victoire, TOP 1 persisté (relu par `GET /stats-br`).
* `node scripts/fps/e2e_zombies.mjs` : `PDJ_FPS_ZOMBIES_ARGENT=3000`, `_TOTAL=3`, `_PAUSE_MS=20000`, `_GRIFFE=5`, `_TRUCK=0` ; choix du mode, lobby, lancement par l'hôte, tigres, kill au pistolet,
  achats (fusil à pompe, porte D1, mini Uzi), joueur à terre relevé, coups de couteau, fin de manche sans bonus, partie perdue, bilan, retour au lobby.

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
