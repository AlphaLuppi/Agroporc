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
cd /app && python main.py "$MODE"
echo "$(date '+%Y-%m-%d %H:%M') [cron] Terminé"
