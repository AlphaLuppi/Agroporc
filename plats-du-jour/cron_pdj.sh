#!/bin/bash
# Script cron pour le pipeline PDJ + déploiement site
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Charger l'environnement
source .venv/bin/activate
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

MODE="${1:-jour}"
echo "$(date '+%Y-%m-%d %H:%M') [cron] Lancement pipeline mode=$MODE"

# Vérification quotidienne des photos de référence (recalcule les estimations si changées)
python3 main.py check-portions >> output/cron.log 2>&1

# Pipeline
python3 main.py "$MODE" >> output/cron.log 2>&1

echo "$(date '+%Y-%m-%d %H:%M') [cron] Terminé"
