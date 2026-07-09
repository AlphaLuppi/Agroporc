# Déploiement — page admin logs/relance

## Architecture réelle du VPS (vérifiée)

Le pipeline tourne **dans le conteneur** `pdj-plats-du-jour-1` dont la commande est
`cron -f`. Un **cron interne au conteneur** planifie les runs :
- `30 7 * * 1` → `/entrypoint.sh semaine` (lundi)
- `30 7 * * 2-5` → `/entrypoint.sh jour` (mar-ven)
- `0 13 * * 1-5` → `/entrypoint.sh desserts`

Il n'y a **pas de `.venv`** ni de cron hôte pour le pipeline : `cron_pdj.sh` est un
script legacy non utilisé sur le VPS (laissé tel quel).

## Vercel
- `ADMIN_PASSWORD` : **déjà présent** (login admin existant, cookie signé `pdj-admin`).
- `API_SECRET_TOKEN` déjà présent (réutilisé pour `/next` et `/report`).
- Le déploiement se fait au merge sur `main` (la table `pipeline_runs` se crée au 1er accès).

## VPS (`/opt/pdj`, propriétaire `toam`)

`jq`, `flock`, `docker` sont présents sur l'hôte ; le conteneur a `curl` + `python3`
(pas de `jq` → le report interne utilise `python3`).

### A. Relance manuelle + logs (indispensable, sans rebuild)
1. Copier `poll_runs.sh` dans `/opt/pdj` (rsync/scp) et `chmod +x`.
2. Ajouter la ligne crontab (utilisateur `toam`, chaque minute) :
   `* * * * * /opt/pdj/poll_runs.sh >> /opt/pdj/output/poll.log 2>&1`
   Le poller récupère un run demandé via `/api/pipeline/next`, lance
   `docker compose run --rm -e PDJ_REPORT=off plats-du-jour /entrypoint.sh <mode>`,
   capture la sortie et la POST vers `/api/pipeline/report` (avec l'id, + retry).

### B. Capturer aussi les runs planifiés 7h30 (nécessite un rebuild d'image)
`entrypoint.sh` a été modifié pour reporter son run (`triggered_by=cron`) via
`python3` en fin d'exécution (sauf `PDJ_REPORT=off`). Comme `entrypoint.sh` est
**baké dans l'image**, il faut reconstruire :
```bash
cd /opt/pdj
docker compose build
docker compose up -d --force-recreate   # recrée le conteneur cron -f
```
Fenêtre sûre : les runs planifiés sont lun→ven 7h30 ; recréer hors de ce créneau
(ex. week-end) évite d'interrompre un run.

## Vérif
- `/admin` → se connecter → « Relancer (jour) ». Dans la minute : requested → running
  → success/error avec le log complet.
- (Si B fait) le run 7h30 suivant apparaît automatiquement avec `triggered_by=cron`.
