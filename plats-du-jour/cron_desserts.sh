#!/bin/bash
# Cron desserts Truck Muche — à lancer ~13h (les desserts sont postés vers midi).
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

source .venv/bin/activate
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "$(date '+%Y-%m-%d %H:%M') [cron-desserts] Scrape desserts du jour"
python3 main.py desserts >> output/cron.log 2>&1
echo "$(date '+%Y-%m-%d %H:%M') [cron-desserts] Terminé"
