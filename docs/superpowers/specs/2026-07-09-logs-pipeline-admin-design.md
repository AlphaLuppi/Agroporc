# Logs & relance des pipelines — page admin

Date : 2026-07-09

## Objectif

Ajouter au site un endroit (page admin protégée) où l'on peut :
1. **voir les logs** des lancements du pipeline Python (runs `jour`/`semaine`, automatiques ou manuels) ;
2. **relancer** le pipeline à la demande via un bouton, sans accès SSH au VPS.

## Contexte / contrainte

Le site tourne sur **Vercel** (serverless) ; le pipeline tourne sur le **VPS**
(`vps:/opt/pdj`, Docker, cron 7h30 Paris). Vercel ne peut ni lire les fichiers
du VPS ni piloter Docker. Le pont retenu est **Postgres** (déjà utilisé par le
site) : aucune ouverture réseau du VPS, réutilisation du token API existant.

## Architecture

```
[Page admin /admin] --cookie--> [API Vercel] <--Bearer token-- [Poller cron VPS (chaque minute)]
                                     |                                    |
                                 Postgres                          docker/entrypoint.sh <mode>
                              (table pipeline_runs)
```

Flux d'une relance manuelle :
1. L'admin clique « Relancer (jour) » → `POST /api/pipeline/trigger` insère un
   run `status=requested`.
2. Le poller VPS (cron chaque minute) appelle `GET /api/pipeline/next`, récupère
   le run et le passe atomiquement à `running`.
3. Le poller lance le pipeline, capture stdout+stderr.
4. À la fin, le poller `POST /api/pipeline/report` avec `status`
   (`success`/`error`) + `log` complet + `finished_at`.
5. La page admin (auto-refresh tant qu'un run est `running`) montre le passage à
   `success`/`error` et le log.

Le run cron automatique de 7h30 s'enregistre aussi via le même mécanisme
(`triggered_by=cron`) pour apparaître dans l'historique.

## 1. Table `pipeline_runs` (Postgres)

| colonne        | type                     | rôle                                          |
|----------------|--------------------------|-----------------------------------------------|
| `id`           | serial PK                |                                               |
| `mode`         | text                     | `jour` \| `semaine`                           |
| `status`       | text                     | `requested` → `running` → `success`\|`error`  |
| `triggered_by` | text                     | `admin` \| `cron`                             |
| `created_at`   | timestamptz default now()|                                               |
| `started_at`   | timestamptz null         | posé au passage `running`                     |
| `finished_at`  | timestamptz null         | posé par `/report`                            |
| `log`          | text null                | log complet (rempli à la fin)                 |

Création idempotente via une fonction `ensurePipelineRunsTable()` dans `lib/db.ts`
(sur le modèle de `ensureTable()`).

**Purge** : après chaque `/report`, ne garder que les **50 runs les plus récents**
(`DELETE ... WHERE id NOT IN (SELECT id ... ORDER BY id DESC LIMIT 50)`).

## 2. Routes API (Next.js, `runtime = "nodejs"`)

Toutes sous `app/api/pipeline/`.

- `POST /api/pipeline/login` — body `{ password }`. Compare à `ADMIN_PASSWORD`.
  Si OK : pose un cookie httpOnly `pdj_admin` = HMAC signé (secret `ADMIN_PASSWORD`),
  `SameSite=Lax`, `Secure`, `maxAge` ~30 j. Sinon 401.
- `POST /api/pipeline/trigger` *(cookie admin requis)* — body `{ mode }`.
  Refuse (409) s'il existe déjà un run `requested` ou `running`. Sinon insère
  `requested` et renvoie l'id.
- `GET /api/pipeline/runs` *(cookie admin requis)* — renvoie les 50 derniers runs
  (tous champs, log inclus), triés par `id` desc.
- `GET /api/pipeline/next` *(Bearer `API_SECRET_TOKEN`)* — sélectionne le plus
  ancien run `requested`, le passe à `running` (`started_at=now()`) de façon
  atomique (`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`),
  renvoie `{ id, mode }` ou `{}`.
- `POST /api/pipeline/report` *(Bearer `API_SECRET_TOKEN`)* — body
  `{ id?, mode?, triggered_by?, status, log }`. Deux usages :
  - avec `id` : clôt un run existant (`status`, `log`, `finished_at`) ;
  - sans `id` (run cron 7h30 qui ne passe pas par `/next`) : crée directement un
    run terminé (`mode`, `triggered_by=cron`, `started_at`, `finished_at`, log).
  Déclenche la purge.

Helper d'auth partagé `lib/adminAuth.ts` : `signAdminToken()` / `verifyAdminRequest()`
(lecture + vérif du cookie) et `verifyBearer()` (compare au token).

## 3. Poller VPS — `plats-du-jour/poll_runs.sh`

Script bash, lancé par cron **chaque minute**. Pseudo-code :

```bash
resp=$(curl -s -H "Authorization: Bearer $API_SECRET_TOKEN" "$VERCEL_API_URL/api/pipeline/next")
id=$(echo "$resp" | jq -r '.id // empty'); mode=$(echo "$resp" | jq -r '.mode // empty')
[ -z "$id" ] && exit 0                       # rien à faire
# lock local pour ne pas empiler deux runs
exec 9>/tmp/pdj_poll.lock; flock -n 9 || exit 0
log=$(cd /opt/pdj && docker compose run --rm plats-du-jour "$mode" 2>&1)
status=$([ $? -eq 0 ] && echo success || echo error)
jq -n --arg id "$id" --arg s "$status" --arg l "$log" \
   '{id:($id|tonumber), status:$s, log:$l}' \
 | curl -s -X POST -H "Authorization: Bearer $API_SECRET_TOKEN" \
        -H 'Content-Type: application/json' -d @- "$VERCEL_API_URL/api/pipeline/report"
```

Notes :
- `flock` empêche deux runs concurrents (le run 7h30 peut être long).
- Le run cron 7h30 existant (`cron_pdj.sh`) est complété pour capturer sa sortie
  et la POSTer vers `/report` sans `id` (`triggered_by=cron`).
- Déploiement : fichier à `rsync` sur le VPS + une ligne crontab. Non versionné
  automatiquement côté VPS → commande fournie à la livraison.

## 4. Page admin `/admin`

- **Login** : si pas de cookie valide → formulaire mot de passe (`POST /login`).
- **Une fois connecté** :
  - 2 boutons « Relancer (jour) » / « Relancer (semaine) », **désactivés** si un
    run `requested`/`running` existe.
  - Liste des runs : `mode`, badge de statut coloré (gris=requested, bleu=running,
    vert=success, rouge=error), `created_at`, durée (`finished-started`),
    `triggered_by`. Clic sur une ligne → déplie le `log` dans un `<pre>`
    scrollable.
  - Auto-refresh (`GET /runs` toutes les ~10 s) **uniquement** tant qu'un run est
    `requested`/`running`.
- Composants client (`"use client"`) pour l'interactivité ; style cohérent avec
  le reste du site (Tailwind v4 + shadcn/ui déjà présents).

## Variables d'environnement

- Vercel : **`ADMIN_PASSWORD`** (nouveau). `API_SECRET_TOKEN` déjà présent.
- VPS (`plats-du-jour/.env`) : `API_SECRET_TOKEN` + `VERCEL_API_URL` déjà présents.
  Dépendance : `jq` et `flock` disponibles sur le VPS (à vérifier au déploiement).

## Gestion d'erreurs

- Auth invalide → 401 ; double relance → 409 ; corps invalide → 400.
- Si le poller crashe en plein run, le run reste `running` : un run est considéré
  « bloqué » côté UI au-delà de ~2 h (affichage d'un avertissement, sans reset
  automatique en v1).
- Le log est tronqué à ~200 Ko avant insertion pour éviter des lignes DB énormes.

## Hors périmètre (YAGNI)

- Logs live/streaming (choix : log à la fin seulement).
- Multi-utilisateurs / rôles (un seul mot de passe partagé).
- Annulation d'un run en cours.
- Exposition réseau du VPS.

## Tests / vérification

- Unitaire : `verifyAdminRequest` (cookie valide/invalide/absent), `verifyBearer`.
- Route : `trigger` refuse si run actif (409) ; `next` marque bien `running` une
  seule fois (pas de double-claim) ; `report` purge à 50.
- Manuel : login → relance jour → observer `requested`→`running`→`success` et le
  log ; vérifier bouton désactivé pendant le run.
