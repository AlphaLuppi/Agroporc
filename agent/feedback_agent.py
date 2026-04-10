"""
Agent feedback — synchronise les retours humains dans les fichiers personnages.

Quand un humain répond à un commentaire généré par l'IA sur le site, cette réponse
est stockée en base. Ce module récupère ces retours via l'API Vercel et les écrit
dans le champ `retours_humains` de chaque fichier personnage. Le comment_agent
utilise ensuite ce champ pour adapter les futures générations.
"""
import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

PERSONNAGES_DIR = Path(__file__).parent.parent / "personnages"
API_URL = os.getenv("VERCEL_API_URL", "").rstrip("/")
API_TOKEN = os.getenv("API_SECRET_TOKEN", "")

# Nombre maximum de retours conservés par personnage (les plus récents).
# Évite que le prompt enfle à l'infini.
MAX_RETOURS_PAR_PERSONNAGE = 20


def _fetch_feedback() -> dict[str, list[dict]]:
    """Récupère les retours humains depuis l'API Vercel."""
    if not API_URL or not API_TOKEN:
        print("[feedback_agent] VERCEL_API_URL ou API_SECRET_TOKEN non configuré")
        return {}

    url = f"{API_URL}/api/feedback-ia"
    headers = {"Authorization": f"Bearer {API_TOKEN}"}

    try:
        resp = requests.get(url, headers=headers, timeout=30)
        if not resp.ok:
            print(f"[feedback_agent] Erreur {resp.status_code}: {resp.text}")
            return {}
        data = resp.json()
        return data.get("feedback", {})
    except Exception as e:
        print(f"[feedback_agent] Erreur réseau: {e}")
        return {}


def _personnage_file(prenom: str) -> Path | None:
    """Retourne le chemin du fichier personnage pour un prénom donné.

    On tolère les variations de casse et les caractères accentués en comparant
    sur le champ `prenom` interne des JSON plutôt que sur le nom de fichier.
    """
    for f in PERSONNAGES_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("prenom", "").strip().lower() == prenom.strip().lower():
                return f
        except Exception:
            continue
    return None


def _merge_retours(existants: list[dict], nouveaux: list[dict]) -> list[dict]:
    """Fusionne sans doublons, en conservant l'ordre et en tronquant au max."""
    seen = set()
    merged: list[dict] = []

    def _key(r: dict) -> tuple:
        return (
            r.get("date", ""),
            r.get("ai_texte", ""),
            r.get("human_auteur", ""),
            r.get("human_texte", ""),
        )

    for r in existants + nouveaux:
        k = _key(r)
        if k in seen:
            continue
        seen.add(k)
        merged.append(r)

    # Garder les N plus récents (tri par date desc puis ordre d'insertion stable)
    merged.sort(key=lambda r: r.get("date", ""), reverse=True)
    return merged[:MAX_RETOURS_PAR_PERSONNAGE]


def sync_feedback_to_personnages() -> dict[str, int]:
    """
    Récupère les retours humains et les injecte dans les JSON des personnages.

    Returns:
        dict { prenom: nombre de retours après merge } pour les personnages mis à jour.
    """
    feedback = _fetch_feedback()
    if not feedback:
        print("[feedback_agent] Aucun retour humain à synchroniser")
        return {}

    updated: dict[str, int] = {}

    for prenom, retours in feedback.items():
        pf = _personnage_file(prenom)
        if not pf:
            print(f"[feedback_agent] Personnage introuvable pour '{prenom}' — ignoré")
            continue

        try:
            data = json.loads(pf.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[feedback_agent] Lecture {pf.name} échouée : {e}")
            continue

        existants = data.get("retours_humains") or []
        merged = _merge_retours(existants, retours)

        if merged == existants:
            continue  # rien de nouveau

        data["retours_humains"] = merged
        pf.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        updated[prenom] = len(merged)
        print(f"[feedback_agent] {prenom}: {len(merged)} retour(s) dans {pf.name}")

    return updated


if __name__ == "__main__":
    sync_feedback_to_personnages()
