#!/bin/bash
# Charger les variables d'environnement (cron ne les hérite pas)
set -a
source /app/.env
set +a

# Cron n'hérite pas non plus des ENV Docker → réexporter celles dont Playwright a besoin
# (binaire Chromium installé dans /ms-playwright par l'image de base mcr.microsoft.com/playwright)
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

MODE="${1:-jour}"
echo "$(date '+%Y-%m-%d %H:%M') [cron] Lancement pipeline mode=$MODE"

# Capture de la sortie pour report vers l'API (logs visibles sur /admin).
LOGFILE="$(mktemp)"
status=success
cd /app && ionice -c 3 nice -n 19 python main.py "$MODE" 2>&1 | tee -a "$LOGFILE"
[ "${PIPESTATUS[0]}" -ne 0 ] && status=error

# Report du run planifié (triggered_by=cron). Désactivé quand PDJ_REPORT=off :
# le poller /admin lance /entrypoint.sh lui-même et reporte de son côté avec un id.
# Seuls jour/semaine sont suivis côté /admin (desserts non).
if [ "${PDJ_REPORT:-on}" = "on" ] \
   && { [ "$MODE" = "jour" ] || [ "$MODE" = "semaine" ]; } \
   && [ -n "${VERCEL_API_URL:-}" ] && [ -n "${API_SECRET_TOKEN:-}" ]; then
  python3 - "$MODE" "$status" "$LOGFILE" <<'PY'
import json, os, sys, urllib.request
mode, status, logfile = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    log = open(logfile, errors="replace").read()[-200000:]
    data = json.dumps({"mode": mode, "triggered_by": "cron",
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

echo "$(date '+%Y-%m-%d %H:%M') [cron] Terminé"
