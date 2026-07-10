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
id=$(echo "$resp" | jq -r '.id // empty' 2>/dev/null || true)
mode=$(echo "$resp" | jq -r '.mode // empty' 2>/dev/null || true)
[ -z "$id" ] && exit 0

echo "$(date '+%Y-%m-%d %H:%M') [poll] run #$id mode=$mode"
# Le service tourne en 'cron -f' ; pour un run one-shot il faut appeler explicitement
# /entrypoint.sh <mode>. PDJ_REPORT=off : c'est le poller (ici) qui reporte, avec l'id.
set +e
log=$(docker compose run --rm -e PDJ_REPORT=off plats-du-jour /entrypoint.sh "$mode" 2>&1)
rc=$?
set -e
case "$rc" in
  0) status=success ;;
  3) status=partial ;;
  *) status=error ;;
esac

payload=$(jq -n --argjson id "$id" --arg s "$status" --arg l "$log" \
  '{id:$id, status:$s, log:$l}')
for attempt in 1 2 3; do
  if echo "$payload" | curl -sf -X POST \
      -H "Authorization: Bearer $API_SECRET_TOKEN" \
      -H 'Content-Type: application/json' -d @- \
      "$VERCEL_API_URL/api/pipeline/report" > /dev/null; then
    break
  fi
  echo "$(date '+%Y-%m-%d %H:%M') [poll] report échec (tentative $attempt)"
  sleep 5
done
