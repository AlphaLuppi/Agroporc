# Déploiement — fiabilisation pipeline (retries + lock + partial)

Spec : `docs/superpowers/specs/2026-07-10-fiabilisation-pipeline-design.md`

1. Sur le VPS (`vps:/opt/pdj`) : `git pull` (ou rsync) puis rebuild :
   `docker compose build && docker compose up -d`
   (le nouveau crontab retry 7h45→10h00 est baké dans l'image).
2. Vérifier le montage volume `./output:/app/output` dans le
   `docker-compose.yml` du VPS — indispensable : persistance du cache Truck,
   des fichiers `run_state_<date>.json` et du lock `pdj_run.lock`.
3. Vérifier que Vercel est déployé avec le statut `partial`
   (merge sur main → déploiement auto).
4. `poll_runs.sh` : re-rsync sur le VPS (mapping du code de sortie 3 → partial).
5. Test : depuis /admin, « Relancer (jour) » → le run doit finir `success`
   (ou `partial` si un resto échoue) ; relancer aussitôt → run quasi instantané
   (état déjà complet).
6. Vérifier le lendemain entre 7h30 et 10h : les runs retry n'apparaissent sur
   /admin que s'ils ont travaillé (`triggered_by: cron-retry`) ; badge orange
   `partial` si journée incomplète en cours, `error` après le slot de 10h00.
