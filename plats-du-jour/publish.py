"""
Publie les données PDJ vers l'API Vercel.
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


def publish_carte(data: dict) -> bool:
    """Envoie la carte évaluée vers l'API Vercel (POST /api/carte)."""
    if not API_URL or not API_TOKEN:
        print("[publish] VERCEL_API_URL ou API_SECRET_TOKEN non configuré")
        return False

    url = f"{API_URL}/api/carte"
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json=data, headers=headers, timeout=60)
        if resp.ok:
            print(f"[publish] OK — carte publiée ({str(data.get('hash', '?'))[:8]})")
            return True
        print(f"[publish] Erreur carte {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        print(f"[publish] Erreur réseau carte: {e}")
        return False


def publish_desserts_observation(date: str, noms: list[str]) -> bool:
    """Envoie les desserts observés du jour vers l'API (POST /api/desserts-observation)."""
    if not API_URL or not API_TOKEN:
        print("[publish] VERCEL_API_URL ou API_SECRET_TOKEN non configuré")
        return False
    url = f"{API_URL}/api/desserts-observation"
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json={"date": date, "desserts": noms}, headers=headers, timeout=30)
        if resp.ok:
            print(f"[publish] OK — {len(noms)} dessert(s) pour {date}")
            return True
        print(f"[publish] Erreur desserts {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        print(f"[publish] Erreur réseau desserts: {e}")
        return False


def fetch_carte_hash(slug: str = "bistrot_trefle") -> str | None:
    """Hash de la carte stockée pour un resto (GET /api/carte?slug=…), ou None."""
    if not API_URL:
        return None
    url = f"{API_URL}/api/carte"
    try:
        resp = requests.get(url, params={"slug": slug}, timeout=30)
        if not resp.ok:
            return None
        data = resp.json()
        return data.get("hash") if isinstance(data, dict) else None
    except Exception as e:
        print(f"[publish] Erreur lecture hash carte ({slug}) : {e}")
        return None


def fetch_plat_images_existantes(cles: list[str]) -> set[str] | None:
    """Clés d'images de plats déjà en base (GET /api/plat-image?cles=…), par lots de 100.
    None si l'API est injoignable : l'appelant ne génère rien plutôt que de tout refaire."""
    if not API_URL:
        return None
    existantes: set[str] = set()
    try:
        for i in range(0, len(cles), 100):
            resp = requests.get(f"{API_URL}/api/plat-image",
                                params={"cles": ",".join(cles[i:i + 100])}, timeout=30)
            if not resp.ok:
                print(f"[publish] Erreur liste images {resp.status_code}: {resp.text[:200]}")
                return None
            existantes.update(resp.json().get("existantes") or [])
        return existantes
    except Exception as e:
        print(f"[publish] Erreur réseau liste images : {e}")
        return None


def publish_plat_image(data: dict) -> bool:
    """Envoie une image de plat générée par IA (POST /api/plat-image, Bearer)."""
    if not API_URL or not API_TOKEN:
        print("[publish] VERCEL_API_URL ou API_SECRET_TOKEN non configuré")
        return False
    headers = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}
    try:
        resp = requests.post(f"{API_URL}/api/plat-image", json=data, headers=headers, timeout=60)
        if resp.ok:
            return True
        print(f"[publish] Erreur image {resp.status_code}: {resp.text[:200]}")
        return False
    except Exception as e:
        print(f"[publish] Erreur réseau image : {e}")
        return False


def fetch_recettes_existantes(cles: list[str]) -> set[str] | None:
    """Clés des recettes déjà en base (GET /api/recette?cles=…), par lots de 100.
    None si l'API est injoignable : l'appelant ne génère rien plutôt que de tout refaire."""
    if not API_URL:
        return None
    existantes: set[str] = set()
    try:
        for i in range(0, len(cles), 100):
            resp = requests.get(f"{API_URL}/api/recette",
                                params={"cles": ",".join(cles[i:i + 100])}, timeout=30)
            if not resp.ok:
                print(f"[publish] Erreur liste recettes {resp.status_code}: {resp.text[:200]}")
                return None
            existantes.update(resp.json().get("existantes") or [])
        return existantes
    except Exception as e:
        print(f"[publish] Erreur réseau liste recettes : {e}")
        return None


def publish_recette(data: dict) -> bool:
    """Envoie une recette maison d'un plat (POST /api/recette, Bearer)."""
    if not API_URL or not API_TOKEN:
        print("[publish] VERCEL_API_URL ou API_SECRET_TOKEN non configuré")
        return False
    headers = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}
    try:
        resp = requests.post(f"{API_URL}/api/recette", json=data, headers=headers, timeout=30)
        if resp.ok:
            return True
        print(f"[publish] Erreur recette {resp.status_code}: {resp.text[:300]}")
        return False
    except Exception as e:
        print(f"[publish] Erreur réseau recette : {e}")
        return False


def publish_recette_services(services: list[dict]) -> int:
    """Enregistre les dates de service des plats (POST /api/recette/services, Bearer), par
    lots de 200. Renvoie le nombre de couples ajoutés (0 si non configuré ; s'arrête au
    premier lot en erreur en gardant le compte des lots déjà passés)."""
    if not API_URL or not API_TOKEN or not services:
        return 0
    headers = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}
    ajoutes = 0
    try:
        for i in range(0, len(services), 200):
            resp = requests.post(f"{API_URL}/api/recette/services",
                                 json={"services": services[i:i + 200]}, headers=headers, timeout=30)
            if not resp.ok:
                print(f"[publish] Erreur dates de service {resp.status_code}: {resp.text[:200]}")
                break
            n = resp.json().get("ajoutes")
            ajoutes += n if isinstance(n, int) else 0
    except Exception as e:
        print(f"[publish] Erreur réseau dates de service : {e}")
    return ajoutes


def fetch_pdj(date: str) -> dict | None:
    """PDJ publié pour une date (GET /api/pdj?date=), ou None."""
    if not API_URL:
        return None
    try:
        resp = requests.get(f"{API_URL}/api/pdj", params={"date": date}, timeout=30)
        if not resp.ok:
            return None
        data = resp.json()
        return data if isinstance(data, dict) and data.get("date") == date else None
    except Exception as e:
        print(f"[publish] Erreur lecture PDJ {date} : {e}")
        return None


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
