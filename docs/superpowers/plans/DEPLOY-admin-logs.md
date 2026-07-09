# Déploiement — page admin logs/relance

## Vercel
- Ajouter la variable d'env `ADMIN_PASSWORD` (mot de passe de la page /admin).
- `API_SECRET_TOKEN` déjà présent (réutilisé pour /next et /report).
- Déployer normalement (la table `pipeline_runs` se crée toute seule au 1er accès).

## VPS (/opt/pdj)
1. `rsync` le repo (poll_runs.sh + cron_pdj.sh mis à jour).
2. Vérifier que `jq` et `flock` (util-linux) sont installés : `which jq flock`.
   Sinon `apt-get install -y jq util-linux`.
3. Vérifier `.env` : `API_SECRET_TOKEN` et `VERCEL_API_URL` présents.
4. Ajouter au crontab la ligne du poller (chaque minute) :
   `* * * * * /opt/pdj/poll_runs.sh >> /opt/pdj/output/poll.log 2>&1`
5. Le cron 7h30 existant (cron_pdj.sh) reporte désormais automatiquement.

## Vérif
- Ouvrir https://<site>/admin, se connecter, cliquer « Relancer (jour) ».
- Dans la minute, le run passe requested → running → success/error avec le log.
