# Serveur de l'arène FPS

Serveur temps réel (Node 22 + `ws`) de l'arène « chacun pour soi » de la vue Palantir. Une salle
unique de 16 joueurs EN ARÈNE ; Vercel ne tient pas de WebSocket, il tourne donc sur le VPS. Toute la logique
de jeu est dans `lib/fps/match.ts` (classe `Salle`, pure, testée par `npx vitest run lib/fps`) et ses services
`match-elsa.ts` / `match-vehicules.ts` (via `ContexteSalle`, `match-contexte.ts`) ; `src/index.ts` ne fait
que l'I/O (WebSocket, `GET /sante`, anti-flood, origines, ping, tic à 60 Hz) et assemble la salle (circuits des voitures PNJ,
voitures conduisibles, Elsa, zone d'apparition autour du rond-point, cachettes des tigres). **Protocole 3** (`VERSION_PROTOCOLE = 3`) :
arène v2 (spec `docs/superpowers/specs/2026-10-22-arene-v2-design.md`, v1 en `2026-10-22-agroparc-fps-design.md`) plus l'avion, les tigres
et le sort d'invocation (`2026-10-23-arene-tigres-design.md`, service `lib/fps/match-tigres.ts`, logique pure `tigre-arene.ts` et `avion.ts`).

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
| `PDJ_FPS_EVT_MIN_MS` / `PDJ_FPS_EVT_MAX_MS` | 45–70 s puis 70–110 s | délai (ms) avant chaque événement (Truck Muche fou, tigre géant), courts pour les essais |
| `PDJ_FPS_EVT_TYPE` | alternance | `truck` ou `tigre` : toujours le même événement |
| `PDJ_FPS_TIGRE_PV` | 4 000 + 1 500 / joueur | PV imposés au tigre géant des événements (essais), sans effet sur les tigres largués |
| `PDJ_FPS_TIGRE_ATTAQUE` | au hasard | `laser`, `saut` ou `charge` : attaque spéciale imposée au tigre géant (essais) |

`GET /sante` renvoie `{ ok, joueurs, enJeu, match }` (connectés, joueurs en arène, numéro du match). Limites : messages ≤ 4 Ko, ≤ 90 messages/s par
client (sinon `erreur flood` et fermeture), ping WebSocket toutes les 5 s (connexion morte fermée au bout de 10 s : un joueur parti ne reste pas en cible),
« bonjour » attendu dans les 10 s. Capacité : 16 joueurs EN ARÈNE (les spectateurs de la vue 3D n'occupent aucune place ; `rejoindre` au-delà répond `refus plein`, la socket reste ouverte), 64 connexions inscrites au plus, 96 connexions au total et 24 par IP (dernier élément de `x-forwarded-for`, fermeture 1013 au-delà), un spectateur muet depuis 15 min est recyclé (le client se reconnecte seul). Un joueur vivant sans état accepté depuis 20 s (onglet gelé) est retiré de l'arène
(le client redemande à entrer). Les tirs sont validés contre les positions de la cible des 300 dernières ms
(compensation de latence, `positionsCible` dans `lib/fps/match.ts`).

## Protocole v3 (résumé)

Contrat complet et commenté : `lib/fps/protocole.ts` (ne change qu'avec le client, `lib/fps/reseau.ts`). Premier message obligatoire :
`bonjour{v, pseudo}` ; une version différente de `VERSION_PROTOCOLE` reçoit `erreur{version}` (« rechargez la page ») et la socket est fermée.

* **Client → serveur** : `rejoindre{principale, secondaire}` (l'alias v1 `arme` reste accepté), `quitter`, `pseudo`, `equiper` (équipement de la prochaine apparition),
  `main{slot}` (principale, secondaire, couteau, spéciale), `etat` (≈ 30 Hz : position, vitesse, regard, posture, `accroupi?`, `glisse?`), `tir{arme, o, d[], touches[]}`,
  `coup{o, d, cible}` (couteau), `monter{vehicule, siege?}`, `descendre`, `siege`, `conduite` (≈ 30 Hz, conducteur seulement, remplace `etat`),
  `vueScores{ouvert}` (tableau des scores maintenu), `invoquer` (sort d'invocation, v3), `ping`.
* **Serveur → client** : `bienvenue`, `presence`, `snap` (20 Hz, joueurs en jeu + `vehicules`), `apparition` (le joueur se téléporte, avec son équipement), `equipement`,
  `tir` / `coup` (autres joueurs : traçantes, sons), `degats` (cible, tireur, zone, PV et bouclier restants : source des retours de touche), `mort` (cause, `tueur`, `ts` du rejeu de la killcam,
  délai de réapparition), `match` (classement), `elsa{etat|apparue|prise|expiree}`, `ramassage`, `sieges`, `embarque`, `descente`, `refus{action, raison}`
  (jamais `erreur` pour un refus : le serveur ferme la socket sur tout `erreur`), `scores` (statistiques, 1 Hz aux clients ouverts), `pong`, `erreur{plein|version|pseudo|flood}`.
  v3 : `snap.tigres` (identifiant, sauvage ou allié avec son lanceur, position, cap, état, pose, PV, action en cours et son instant de début),
  `avion{passage|largage|etat}` (trajectoire, instant du largage, identifiant du tigre largué), `tigre{apparu|alerte|touche|mort|parti}`,
  `sort{gagne|lance|perdu}`, cause de mort `tigre` (`par` = le lanceur d'un tigre allié, "" pour un tigre sauvage).
* **Tigres (v3)** : un avion passe toutes les 90 à 180 s en phase de jeu avec 2 joueurs au moins en arène et aucun tigre sauvage en vie, et largue un
  tigre au-dessus d'une cachette de l'anneau à plus de 30 m de tout joueur. Le tigre sauvage (2 500 PV) se tapit, s'alerte, attaque (patte 25, bond annoncé 40,
  aucun coup au-delà de 40), s'enfuit sous 30 % et repart au bout de 4 min. Le joueur qui l'achève gagne une charge du sort, perdue à sa mort. Le tigre
  allié (500 PV, 30 s) attaque l'ennemi le plus proche du lanceur à 18 m (patte 15 par seconde), ses kills reviennent au lanceur. Un tir ou un coup de
  couteau dont la cible est l'identifiant d'un tigre est validé comme sur un joueur, sur les positions du tigre des 300 dernières ms (200 ms au couteau)
  et sa silhouette selon la pose. Les voitures lancées lui infligent 150 dégâts.
* **Règles côté serveur** : un état n'est accepté que dans la vitesse permise depuis le dernier état accepté (un téléporteur est ignoré) ; un tir ou un coup est validé
  (cadence, œil proche de la position connue, direction conforme à la visée, ligne de vue, portée, positions de la cible rejouées sur 300 ms, 200 ms au couteau) ;
  aucune dispersion, la gerbe du pompe est fixe et vérifiée à 0,02 rad ; les voitures conduisibles suivent le conducteur (`y` imposé à 0, vitesse bornée), les passagers tirent avec
  leur arme en main (le conducteur non) ; les voitures PNJ (12 sur 4 circuits, 9 m/s) tuent à pied, instant de test propre à chaque joueur ; Elsa est à (−120 ; 39) près du Truck Muche.
* **Capacité** : voir plus haut ; `rejoindre` refusé (`refus{plein}`) au-delà de 16 joueurs en arène, `quitter` puis `rejoindre` ne contourne ni la réapparition (4 s) ni la santé (mémorisée 60 s).

## Test de bout en bout

`node scripts/fps/e2e_arene_v2.mjs` (depuis la racine, Node 22, Playwright : `npm i --no-save playwright`) lance ce serveur sur un port libre avec `PDJ_FPS_ELSA_MIN_MS=6000` /
`PDJ_FPS_ELSA_MAX_MS=7000`, un `next dev` pointé dessus (`NEXT_PUBLIC_FPS_WS_URL`) et deux Chromium headless ; il vérifie l'entrée en arène, la vue mutuelle, les armes, un kill confirmé
par le serveur, la killcam, le couteau, la glissade, la conduite et le tir d'un passager, Elsa, la mini-carte et le tableau des scores, puis arrête ce qu'il a lancé (captures dans `E2E_OUT`).
N'utilise jamais le port 8787 (un onglet de développement ouvert sur le site s'y reconnecterait).

## Déploiement (VPS, Docker + Traefik)

Le contexte de build est la **racine du dépôt** (le serveur regroupe `lib/fps`, `lib/agroparc3d`,
`public/agroparc/scene.json` et `public/agroparc/cachettes.json`) :

```bash
docker build -f serveur-fps/Dockerfile -t pdj-fps .        # depuis la racine
# ou, sur le VPS, depuis serveur-fps/ :
ORIGINES=https://<domaine-du-site> docker compose up -d --build
```

**Le protocole 3 (tigres) remplace le 2 sur le même hôte, comme la v2 avait remplacé la v1.** Un client v2 en cache reçoit `erreur{version}`, il faut donc
redéployer ce serveur avec la branche qui livre le client v3. **La v2 remplace la v1 sur le même hôte** (`wss://pdj-fps.toam.tech`) : client et serveur se déploient ensemble (fusion de la PR, puis `docker compose up -d --build` sur le VPS) ;
un client v1 encore en cache reçoit `erreur{version}`. `ORIGINES` doit inclure le site et le joker des previews Vercel.

`docker-compose.yml` : conteneur `pdj-fps` sur le réseau externe `dokploy-network`, 256 Mo, 0,3 vCPU
(`lib/fps/match.charge.test.ts` : 16 joueurs, 6 voitures conduisibles, 12 PNJ et Elsa, un tic coûte ≈ 0,05 ms de CPU et un snap pèse ≈ 3,5 Ko,
`lib/fps/match.charge-tigres.test.ts` : la même salle avec un tigre sauvage en attaque et quatre tigres alliés, tic du même ordre et snap ≈ 3,8 Ko),
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
