#!/bin/bash
# Charger les variables d'environnement (cron ne les hérite pas)
set -a
source /app/.env
set +a

# Cron n'hérite pas non plus des ENV Docker → réexporter celles dont Playwright a besoin
# (binaire Chromium installé dans /ms-playwright par l'image de base mcr.microsoft.com/playwright)
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

MODE="${1:-jour}"
RETRY=""
FINAL=""
if [ "$MODE" = "retry" ]; then
  RETRY=1
  [ "${2:-}" = "final" ] && FINAL=1
  # Lundi → semaine, sinon jour (mêmes modes que le run principal 7h30)
  [ "$(date +%u)" = "1" ] && MODE=semaine || MODE=jour
fi

# Lock global sur le volume partagé : vaut aussi pour les runs `docker compose run`
# du poller /admin (même kernel → flock traverse les conteneurs).
# Retries : sautent leur tour si un run tourne déjà (le slot suivant rattrapera).
mkdir -p /app/output
exec 200>/app/output/pdj_run.lock
if [ -n "$RETRY" ]; then
  flock -n 200 || { echo "$(date '+%Y-%m-%d %H:%M') [cron] run en cours, retry sauté"; exit 0; }
else
  flock -w 900 200 || { echo "$(date '+%Y-%m-%d %H:%M') [cron] lock non obtenu après 15 min, abandon"; exit 1; }
fi

echo "$(date '+%Y-%m-%d %H:%M') [cron] Lancement pipeline mode=$MODE${RETRY:+ (retry)}"

# Capture de la sortie pour report vers l'API (logs visibles sur /admin).
LOGFILE="$(mktemp)"
cd /app && ionice -c 3 nice -n 19 python main.py "$MODE" ${RETRY:+--retry} 2>&1 | tee -a "$LOGFILE"
rc="${PIPESTATUS[0]}"

# 0=complet, 3=partiel, 4=no-op (déjà complet). Le dernier retry (10h00)
# transforme partiel en erreur : journée définitivement incomplète.
case "$rc" in
  0) status=success ;;
  3) status=partial; [ -n "$FINAL" ] && status=error ;;
  4) status=noop ;;
  *) status=error ;;
esac

# Report du run planifié. Jamais pour un no-op (pas de bruit dans /admin).
# Désactivé quand PDJ_REPORT=off : le poller /admin lance /entrypoint.sh
# lui-même et reporte de son côté avec un id.
# Seuls jour/semaine sont suivis côté /admin (desserts non).
TRIGGER="cron"
[ -n "$RETRY" ] && TRIGGER="cron-retry"
if [ "${PDJ_REPORT:-on}" = "on" ] && [ "$status" != "noop" ] \
   && { [ "$MODE" = "jour" ] || [ "$MODE" = "semaine" ]; } \
   && [ -n "${VERCEL_API_URL:-}" ] && [ -n "${API_SECRET_TOKEN:-}" ]; then
  python3 - "$MODE" "$status" "$LOGFILE" "$TRIGGER" <<'PY'
import json, os, sys, urllib.request
mode, status, logfile, trigger = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    log = open(logfile, errors="replace").read()[-200000:]
    data = json.dumps({"mode": mode, "triggered_by": trigger,
                       "status": status, "log": log}).encode()
    req = urllib.request.Request(
        os.environ["VERCEL_API_URL"].rstrip("/") + "/api/pipeline/report",
        data=data, method="POST",
        headers={"Authorization": "Bearer " + os.environ["API_SECRET_TOKEN"],
                 "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=30)
except Exception as e:
    print("[report] échec:", e)
PY
fi
rm -f "$LOGFILE"

echo "$(date '+%Y-%m-%d %H:%M') [cron] Terminé (rc=$rc, status=$status)"
# Propager le code pour le poller /admin (docker compose run) :
# no-op = succès du point de vue de l'appelant.
[ "$rc" = "4" ] && exit 0
exit "$rc"
