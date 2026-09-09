"""
Agent d'évaluation des idées d'améliorations.
Récupère les idées non encore évaluées via l'API Vercel, demande à Claude
d'évaluer faisabilité + filtre des trolls, puis renvoie le verdict.
"""
import json
import os
import re
import requests
from dotenv import load_dotenv

from agent.diet_agent import _call_claude

load_dotenv()

API_URL = os.getenv("VERCEL_API_URL", "").rstrip("/")
API_TOKEN = os.getenv("API_SECRET_TOKEN", "")

CONTEXTE_PROJET = """
Le projet "Plats du Jour" (PDJ) est un agrégateur de menus de cantine pour le bureau.
- Frontend : Next.js 15 + React 19 + Tailwind, déployé sur Vercel, BDD Vercel Postgres.
- Backend : pipeline Python (scrapers Playwright/async pour 3 restaurants historiques : Le Bistrot
  Trèfle, La Pause Gourmande, Le Truck Muche, plus 3 restaurants optionnels présents seulement les
  jours où ils publient un plat : Basilic n'Go, Dubble, La Mijote), agents Claude pour évaluation
  diététique et commentaires générés par des personnages fictifs.
- Deux modes d'évaluation des plats : "Sportif" (santé) et "Goulaf" (gourmandise).
- Système de commentaires utilisateur, votes, idées d'amélioration.
- Pipeline cron lancée chaque matin (semaine le lundi, jour du mardi au vendredi).
""".strip()

PROMPT_TEMPLATE = """Tu évalues des idées d'amélioration soumises par les utilisateurs du projet ci-dessous.

# Contexte du projet
{contexte}

# Idées à évaluer
{idees}

# Ta tâche
Pour CHAQUE idée, retourne un objet JSON avec :
- "id" : l'id de l'idée
- "faisabilite" : "faisable" (réalisable simplement), "complexe" (réalisable mais lourd / coûteux / hors scope évident), "impossible" (incompatible avec le projet, contraintes techniques rédhibitoires) ou "troll" (idée non sérieuse, gag, insulte, hors-sujet total, spam)
- "evaluation" : 1 à 2 phrases en français qui expliquent ton verdict (ce qu'il faudrait faire ou pourquoi ça ne marche pas). Ton direct, sans bullshit.

Sois sévère sur les trolls : "ajouter un bouton qui fait pet", "supprimer Marc du projet", insultes, etc → "troll".
Mais une idée naïve mais sincère ("ajouter un mode sombre", "noter les desserts") n'est PAS un troll, c'est "faisable" ou "complexe".

Réponds UNIQUEMENT avec un tableau JSON, sans texte autour, sans markdown.
Format exact :
[{{"id": 1, "faisabilite": "faisable", "evaluation": "..."}}, ...]
""".strip()


def _fetch_non_evaluees() -> list[dict]:
    if not API_URL or not API_TOKEN:
        print("[idee_agent] VERCEL_API_URL ou API_SECRET_TOKEN manquant")
        return []
    url = f"{API_URL}/api/idees/non-evaluees"
    resp = requests.get(url, headers={"Authorization": f"Bearer {API_TOKEN}"}, timeout=30)
    if not resp.ok:
        print(f"[idee_agent] Erreur fetch {resp.status_code}: {resp.text}")
        return []
    return resp.json()


def _post_evaluation(id_: int, faisabilite: str, evaluation: str) -> bool:
    url = f"{API_URL}/api/idees/evaluation"
    headers = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}
    payload = {"id": id_, "faisabilite": faisabilite, "evaluation": evaluation}
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        if resp.ok:
            return True
        print(f"[idee_agent] POST eval {id_} échec {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"[idee_agent] POST eval {id_} erreur réseau: {e}")
    return False


def _parse_json_array(text: str) -> list[dict]:
    """Extrait un tableau JSON de la réponse de Claude (tolère du markdown autour)."""
    text = text.strip()
    # Nettoyer ```json ... ```
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Trouver le premier '[' et le dernier ']'
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1:
        raise ValueError(f"Pas de tableau JSON trouvé dans la réponse : {text[:200]}")
    return json.loads(text[start : end + 1])


def evaluer_idees() -> int:
    """Évalue toutes les idées non évaluées. Retourne le nombre traité."""
    idees = _fetch_non_evaluees()
    if not idees:
        print("[idee_agent] Aucune idée à évaluer")
        return 0

    print(f"[idee_agent] {len(idees)} idée(s) à évaluer")
    listing = "\n".join(f'- id={i["id"]} | auteur={i["auteur"]} | "{i["texte"]}"' for i in idees)
    prompt = PROMPT_TEMPLATE.format(contexte=CONTEXTE_PROJET, idees=listing)

    try:
        raw = _call_claude(prompt, timeout=120)
        verdicts = _parse_json_array(raw)
    except Exception as e:
        print(f"[idee_agent] Erreur appel Claude / parsing : {e}")
        return 0

    valid = {"faisable", "complexe", "impossible", "troll"}
    ok = 0
    for v in verdicts:
        try:
            id_ = int(v["id"])
            f = str(v["faisabilite"]).lower()
            ev = str(v["evaluation"]).strip()
            if f not in valid or not ev:
                print(f"[idee_agent] Verdict invalide ignoré : {v}")
                continue
            if _post_evaluation(id_, f, ev):
                ok += 1
                print(f"[idee_agent] id={id_} → {f}")
        except (KeyError, TypeError, ValueError) as e:
            print(f"[idee_agent] Verdict mal formé ignoré : {v} ({e})")

    print(f"[idee_agent] {ok}/{len(verdicts)} évaluation(s) enregistrée(s)")
    return ok


if __name__ == "__main__":
    evaluer_idees()
