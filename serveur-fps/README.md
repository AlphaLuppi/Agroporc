# Serveur de l'arène FPS

Serveur temps réel (Node 22 + `ws`) de l'arène « chacun pour soi » de la vue Palantir. Une salle
unique de 16 joueurs ; Vercel ne tient pas de WebSocket, il tourne donc sur le VPS. Toute la logique
de jeu est dans `lib/fps/match.ts` (pur, testé par `npx vitest run lib/fps`) ; `src/index.ts` ne fait
que l'I/O (WebSocket, `GET /sante`, anti-flood, origines, ping, tic à 60 Hz).

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
| `ORIGINES` | vide = toutes | origines `Origin` autorisées, séparées par des virgules |

`GET /sante` renvoie `{ ok, joueurs, enJeu, match }`. Limites : messages ≤ 4 Ko, ≤ 90 messages/s par
client (sinon `erreur flood` et fermeture), ping WebSocket toutes les 5 s (connexion morte fermée au bout de 10 s : un joueur parti ne reste pas en cible),
« bonjour » attendu dans les 10 s. Un joueur vivant sans état accepté depuis 20 s (onglet gelé) est retiré de l'arène
(le client redemande à entrer). Les tirs sont validés contre les positions de la cible des 300 dernières ms
(compensation de latence, `positionsCible` dans `lib/fps/match.ts`).

## Déploiement (VPS, Docker + Traefik)

Le contexte de build est la **racine du dépôt** (le serveur regroupe `lib/fps`, `lib/agroparc3d` et
`public/agroparc/scene.json`) :

```bash
docker build -f serveur-fps/Dockerfile -t pdj-fps .        # depuis la racine
# ou, sur le VPS, depuis serveur-fps/ :
ORIGINES=https://<domaine-du-site> docker compose up -d --build
```

`docker-compose.yml` : conteneur `pdj-fps` sur le réseau externe `dokploy-network`, 256 Mo, 0,3 vCPU,
redémarrage automatique, aucun port publié. Route Traefik (`/etc/dokploy/traefik/dynamic/pdj-fps.yml`,
adapter le nom du résolveur de certificats) :

```yaml
http:
  routers:
    pdj-fps:
      rule: Host(`pdj-fps.187-124-217-58.sslip.io`)
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

Le client se connecte à `wss://pdj-fps.187-124-217-58.sslip.io` (ou `NEXT_PUBLIC_FPS_WS_URL`). Vérification :
`curl https://pdj-fps.187-124-217-58.sslip.io/sante`.
