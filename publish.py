"""
Publie les données PDJ vers l'API Vercel.
Remplace generate_site() + deploy_site.sh.

Usage :
  python publish.py                  # publie le pdj.json courant
  python publish.py --historique     # publie tout l'historique (migration initiale)
"""
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

OUTPUT_DIR = Path(__file__).parent / "output"
PDJ_FILE = OUTPUT_DIR / "pdj.json"
HISTORY_DIR = OUTPUT_DIR / "historique"

API_URL = os.getenv("VERCEL_API_URL", "").rstrip("/")
API_TOKEN = os.getenv("API_SECRET_TOKEN", "")


def publish_pdj(data: dict) -> bool:
    """Envoie un PDJ vers l'API Vercel."""
    if not API_URL or not API_TOKEN:
        print("[publish] VERCEL_API_URL ou API_SECRET_TOKEN non configuré")
        return False

    url = f"{API_URL}/api/update"
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(url, json=data, headers=headers, timeout=30)
        if resp.ok:
            print(f"[publish] OK — {data.get('date', '?')} publié")
            return True
        else:
            print(f"[publish] Erreur {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        print(f"[publish] Erreur réseau: {e}")
        return False


def publish_current():
    """Publie le pdj.json courant."""
    if not PDJ_FILE.exists():
        print("[publish] Pas de pdj.json à publier")
        return

    data = json.loads(PDJ_FILE.read_text())
    publish_pdj(data)


def publish_historique():
    """Publie tout l'historique (pour migration initiale)."""
    files = []

    if HISTORY_DIR.exists():
        for f in sorted(HISTORY_DIR.glob("pdj_*.json")):
            files.append(f)

    if PDJ_FILE.exists():
        files.append(PDJ_FILE)

    print(f"[publish] {len(files)} fichier(s) à publier")
    ok = 0
    for f in files:
        try:
            data = json.loads(f.read_text())
            if publish_pdj(data):
                ok += 1
        except Exception as e:
            print(f"[publish] Erreur {f.name}: {e}")

    print(f"[publish] {ok}/{len(files)} publiés")


if __name__ == "__main__":
    if "--historique" in sys.argv:
        publish_historique()
    else:
        publish_current()
