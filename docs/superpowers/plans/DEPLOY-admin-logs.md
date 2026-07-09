# Déploiement — page admin logs/relance

## Vercel
- `ADMIN_PASSWORD` : **déjà présent** (utilisé par `/api/auth` pour tout l'espace
  admin existant). La page `/admin` réutilise le même login (`/admin/login` → cookie
  `pdj-admin`). Rien à ajouter.
- `API_SECRET_TOKEN` déjà présent (réutilisé pour /next et /report).
- Déployer normalement (la table `pipeline_runs` se crée toute seule au 1er accès).
- Note UX : après login sur `/admin/login`, on est redirigé vers `/` (comportement
  existant partagé) ; il faut revenir sur `/admin` manuellement.

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
