"""
Script one-shot : renomme un plat dans le PDJ d'une date donnée.

Récupère l'entrée via GET /api/pdj/{date}, modifie le champ `plat` pour tous
les plats du restaurant ciblé, puis republie via POST /api/update. Les autres
champs (notes, macros, commentaires, recommandations) sont préservés.

Usage :
  python rename_plat.py <YYYY-MM-DD> <restaurant> <nouveau_nom>

Exemple :
  python rename_plat.py 2026-05-12 "Le Truck Muche" "ECHINE COCOTTE ET TITAN DE LÉGUMES"
"""
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

API_URL = os.getenv("VERCEL_API_URL", "").rstrip("/")
API_TOKEN = os.getenv("API_SECRET_TOKEN", "")


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__)
        return 2

    date_str, restaurant, nouveau_nom = sys.argv[1], sys.argv[2], sys.argv[3]

    if not API_URL or not API_TOKEN:
        print("[rename] VERCEL_API_URL ou API_SECRET_TOKEN non configuré dans .env")
        return 1

    url_get = f"{API_URL}/api/pdj/{date_str}"
    print(f"[rename] GET {url_get}")
    r = requests.get(url_get, timeout=30)
    if r.status_code == 404:
        print(f"[rename] Aucune entrée pour {date_str}")
        return 1
    if not r.ok:
        print(f"[rename] Erreur GET {r.status_code} : {r.text}")
        return 1

    entry = r.json()

    renamed: list[str] = []
    for plat in entry.get("plats", []):
        if plat.get("restaurant") == restaurant:
            renamed.append(plat.get("plat", ""))
            plat["plat"] = nouveau_nom

    if not renamed:
        print(
            f"[rename] Aucun plat trouvé pour le restaurant '{restaurant}' à la date {date_str}"
        )
        return 1

    print(f"[rename] {len(renamed)} plat(s) renommé(s) :")
    for ancien in renamed:
        print(f"  - {ancien!r} → {nouveau_nom!r}")

    url_post = f"{API_URL}/api/update"
    print(f"[rename] POST {url_post}")
    resp = requests.post(
        url_post,
        json=entry,
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    if not resp.ok:
        print(f"[rename] Erreur POST {resp.status_code} : {resp.text}")
        return 1

    print(f"[rename] OK — {date_str} mis à jour")
    return 0


if __name__ == "__main__":
    sys.exit(main())
