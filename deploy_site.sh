#!/bin/bash
# Déploie le site statique vers GitHub Pages (repo Agroporc)
set -e

SITE_DIR="$(dirname "$0")/site"

cd "$SITE_DIR"

git add -A
if git diff --cached --quiet; then
    echo "[deploy] Rien à déployer"
    exit 0
fi

git commit -m "MAJ $(date '+%Y-%m-%d %H:%M')"
git push origin main
echo "[deploy] Site déployé sur https://thomassatory.github.io/Agroporc/"
