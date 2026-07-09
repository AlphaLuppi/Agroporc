#!/bin/bash
# Poller : récupère un run 'requested' via l'API, lance le pipeline, renvoie le log.
# À lancer par cron chaque minute sur le VPS.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
set -a; source .env; set +a   # API_SECRET_TOKEN, VERCEL_API_URL

# Un seul poller à la fois
exec 9>/tmp/pdj_poll.lock
flock -n 9 || exit 0

resp=$(curl -sf -H "Authorization: Bearer $API_SECRET_TOKEN" \
  "$VERCEL_API_URL/api/pipeline/next" || echo '{}')
id=$(echo "$resp" | jq -r '.id // empty')
mode=$(echo "$resp" | jq -r '.mode // empty')
[ -z "$id" ] && exit 0

echo "$(date '+%Y-%m-%d %H:%M') [poll] run #$id mode=$mode"
if log=$(docker compose run --rm plats-du-jour "$mode" 2>&1); then
  status=success
else
  status=error
fi

jq -n --argjson id "$id" --arg s "$status" --arg l "$log" \
  '{id:$id, status:$s, log:$l}' \
| curl -sf -X POST \
    -H "Authorization: Bearer $API_SECRET_TOKEN" \
    -H 'Content-Type: application/json' -d @- \
    "$VERCEL_API_URL/api/pipeline/report" > /dev/null
