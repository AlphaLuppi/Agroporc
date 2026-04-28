"""
Agent diététicien — appelle Claude via le CLI `claude -p` (auth OAuth gérée par Claude Code).
Fallback sur l'API directe si le CLI n'est pas disponible.

Le diet_agent évalue UNIQUEMENT la nutrition et les scores. Les commentaires
sont générés séparément par comment_agent.
"""
import json
import subprocess
import os
import shutil
import anthropic
from pathlib import Path

SPORT_PROFILE = os.getenv("SPORT_PROFILE", "sport régulier")
DAILY_CALORIES_TARGET = os.getenv("DAILY_CALORIES_TARGET", "2200")

CLAUDE_BIN = shutil.which("claude")


def _make_client() -> anthropic.Anthropic:
    """
    Crée un client Anthropic.
    Ordre de priorité :
      1. ANTHROPIC_API_KEY (clé API classique)
      2. ANTHROPIC_AUTH_TOKEN (OAuth / bearer token)
      3. Token OAuth depuis le macOS Keychain (dev local)
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if api_key:
        return anthropic.Anthropic(api_key=api_key)

    auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
    if auth_token:
        return anthropic.Anthropic(auth_token=auth_token)

    # Lire le token OAuth depuis le Keychain macOS
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-l", "Claude Code-credentials", "-w"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            raw = result.stdout.strip()
            data = json.loads(raw)
            oauth = data.get("claudeAiOauth", {})
            token = oauth.get("accessToken", "")
            if token:
                return anthropic.Anthropic(auth_token=token)
    except Exception as e:
        print(f"[diet_agent] Erreur lecture Keychain : {e}")

    raise ValueError(
        "Aucun token trouvé. Configurez ANTHROPIC_API_KEY ou ANTHROPIC_AUTH_TOKEN "
        "dans .env, ou assurez-vous d'être connecté à Claude Code."
    )


def _call_claude(prompt: str, timeout: int = 180) -> str:
    """Appelle Claude via API directe (si ANTHROPIC_API_KEY dispo) ou via CLI (OAuth)."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if api_key:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text.strip()

    # Fallback : CLI Claude Code (OAuth par abonnement)
    if CLAUDE_BIN:
        result = subprocess.run(
            [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
            capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(f"claude CLI error: {result.stderr.strip()}")
        return result.stdout.strip()

    raise RuntimeError("Ni ANTHROPIC_API_KEY ni CLI claude disponible.")


def _build_system_prompt() -> str:
    """Prompt lean : nutrition + scores uniquement, sans profils de personnages."""
    return f"""Tu es un expert en nutrition ET en gastronomie.
L'utilisateur pratique du sport régulièrement ({SPORT_PROFILE}) et suit ses macronutriments.
Son objectif calorique journalier est d'environ {DAILY_CALORIES_TARGET} kcal.

Pour chaque plat du jour soumis, fournis DEUX évaluations :
**Mode Sportif** : note selon l'adéquation nutritionnelle (protéines, macros équilibrés).
**Mode Goulaf** : note selon le plaisir gustatif, la gourmandise, la générosité. Un plat riche et savoureux sera bien noté même s'il est calorique.

Pour chaque plat :
1. Estimer la composition nutritionnelle approximative (protéines, glucides, lipides, calories)
2. Attribuer une note sportif (1-10) ET une note goulaf (1-10)
3. Justifier brièvement chaque note (2-3 phrases max chacune)
4. Désigner le plat recommandé pour chaque mode

IMPORTANT : si le champ "plat" est une liste, le restaurant propose plusieurs options.
Dans ce cas, note chaque option séparément dans un tableau "options".

Réponds UNIQUEMENT en JSON valide avec cette structure :
{{
  "plats": [
    {{
      "restaurant": "nom",
      "plat": "nom du plat unique",
      "prix": "prix",
      "nutrition_estimee": {{"calories": 0, "proteines_g": 0, "glucides_g": 0, "lipides_g": 0}},
      "note": 0,
      "justification": "texte sportif",
      "note_goulaf": 0,
      "justification_goulaf": "texte gourmand",
      "commentaires": []
    }},
    {{
      "restaurant": "nom avec plusieurs options",
      "plat": ["option 1", "option 2"],
      "prix": "prix",
      "options": [
        {{
          "plat": "option 1",
          "nutrition_estimee": {{"calories": 0, "proteines_g": 0, "glucides_g": 0, "lipides_g": 0}},
          "note": 0,
          "justification": "texte sportif",
          "note_goulaf": 0,
          "justification_goulaf": "texte gourmand",
          "commentaires": []
        }}
      ]
    }}
  ],
  "recommandation": {{
    "restaurant": "nom du restaurant recommandé en mode sportif",
    "plat": "plat recommandé (option précise si plusieurs)",
    "raison": "explication courte mode sportif"
  }},
  "recommandation_goulaf": {{
    "restaurant": "nom du restaurant recommandé en mode goulaf",
    "plat": "plat recommandé (option précise si plusieurs)",
    "raison": "explication courte mode goulaf"
  }}
}}"""


def evaluate_semaine(plats_par_jour: dict[str, list[dict]]) -> dict[str, dict]:
    """
    Évalue les plats de plusieurs jours en un seul appel Claude.

    Args:
        plats_par_jour: {"MARDI": [{"restaurant": ..., "plat": ..., "prix": ...}], ...}

    Returns:
        {"MARDI": {"plats": [...], "recommandation": {...}, "recommandation_goulaf": {...}}, ...}
    """
    if not plats_par_jour:
        return {}

    prompt = (
        f"{_build_system_prompt()}\n\n"
        f"Voici les plats du jour de PLUSIEURS jours de la semaine :\n\n"
        f"{json.dumps(plats_par_jour, ensure_ascii=False, indent=2)}\n\n"
        f"Pour CHAQUE jour, note chaque plat et donne ta recommandation.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{\n'
        f'  "MARDI": {{\n'
        f'    "plats": [{{"restaurant": "...", "plat": "...", "prix": "...", "nutrition_estimee": {{...}}, "note": 0, "justification": "...", "note_goulaf": 0, "justification_goulaf": "...", "commentaires": []}}],\n'
        f'    "recommandation": {{"restaurant": "...", "plat": "...", "raison": "..."}},\n'
        f'    "recommandation_goulaf": {{"restaurant": "...", "plat": "...", "raison": "..."}}\n'
        f'  }},\n'
        f'  ...\n'
        f'}}'
    )

    raw = _call_claude(prompt, timeout=300)
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def evaluate(plats: list[dict]) -> dict:
    """
    Évalue les plats via Claude (API ou CLI).

    Args:
        plats: liste de dicts { restaurant, plat, prix }

    Returns:
        dict avec notes et recommandation
    """
    prompt = (
        f"{_build_system_prompt()}\n\n"
        f"Voici les plats du jour disponibles aujourd'hui :\n\n"
        f"{json.dumps(plats, ensure_ascii=False, indent=2)}\n\n"
        f"Note chaque plat et dis-moi lequel manger."
    )

    raw = _call_claude(prompt, timeout=180)
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def evaluate_image(image_url: str, context: str = "") -> str:
    """
    Utilise Claude Vision pour extraire le texte d'une photo de menu.

    Args:
        image_url: URL de l'image du menu
        context: contexte additionnel

    Returns:
        texte extrait décrivant le plat
    """
    client = _make_client()

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "url", "url": image_url},
                },
                {
                    "type": "text",
                    "text": (
                        "C'est une photo du plat du jour d'un restaurant. "
                        "Extrait le nom du plat et le prix si visible. "
                        "Réponds en une seule ligne : 'NOM DU PLAT - PRIX€' "
                        "ou juste 'NOM DU PLAT' si pas de prix visible. "
                        f"{context}"
                    )
                }
            ],
        }],
    )
    return message.content[0].text.strip()
