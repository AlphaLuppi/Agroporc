#!/bin/bash
# Script cron pour le pipeline PDJ + déploiement site
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Charger l'environnement
source .venv/bin/activate
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
set -a; source .env; set +a   # API_SECRET_TOKEN, VERCEL_API_URL

MODE="${1:-jour}"
echo "$(date '+%Y-%m-%d %H:%M') [cron] Lancement pipeline mode=$MODE"

# Capture combinée pour report vers l'API
LOGFILE="$(mktemp)"
status=success
{
  python3 main.py check-portions
  python3 main.py "$MODE"
} >> "$LOGFILE" 2>&1 || status=error

# Conserver aussi le log local existant
cat "$LOGFILE" >> output/cron.log

# Report vers l'API (best-effort ; n'échoue pas le cron)
if [ -n "${VERCEL_API_URL:-}" ] && [ -n "${API_SECRET_TOKEN:-}" ]; then
  jq -n --arg mode "$MODE" --arg s "$status" --rawfile l "$LOGFILE" \
    '{mode:$mode, triggered_by:"cron", status:$s, log:$l}' \
  | curl -sf -X POST \
      -H "Authorization: Bearer $API_SECRET_TOKEN" \
      -H 'Content-Type: application/json' -d @- \
      "$VERCEL_API_URL/api/pipeline/report" > /dev/null || true
fi
rm -f "$LOGFILE"

echo "$(date '+%Y-%m-%d %H:%M') [cron] Terminé"
