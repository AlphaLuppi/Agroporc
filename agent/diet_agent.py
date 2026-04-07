"""
Agent diététicien — appelle Claude via le CLI `claude -p` (auth OAuth gérée par Claude Code).
Pas besoin de clé API séparée.
"""
import json
import subprocess
import os
import shutil

SPORT_PROFILE = os.getenv("SPORT_PROFILE", "sport régulier")
DAILY_CALORIES_TARGET = os.getenv("DAILY_CALORIES_TARGET", "2200")

CLAUDE_BIN = (
    shutil.which("claude")
    or "/Users/toam/.local/bin/claude"
)

SYSTEM_PROMPT = f"""Tu es un expert en nutrition ET en gastronomie.
L'utilisateur pratique du sport régulièrement ({SPORT_PROFILE}) et suit ses macronutriments.
Son objectif calorique journalier est d'environ {DAILY_CALORIES_TARGET} kcal.

Pour chaque plat du jour soumis, tu dois fournir DEUX évaluations :

**Mode Sportif** : note selon l'adéquation nutritionnelle (ratio protéines, macros équilibrés, adapté au sportif).
**Mode Goulaf** : note selon le plaisir gustatif, la gourmandise, la générosité du plat, l'originalité. Un plat riche, savoureux et réconfortant sera bien noté en mode Goulaf même s'il est calorique.

Pour chaque plat :
1. Estimer la composition nutritionnelle approximative (protéines, glucides, lipides, calories)
2. Attribuer une note sportif (1-10) ET une note goulaf (1-10)
3. Justifier brièvement chaque note (2-3 phrases max chacune)
4. Désigner le plat recommandé pour chaque mode
5. Générer 2 à 4 faux commentaires humoristiques par plat (piochés parmi les personnages ci-dessous)

IMPORTANT : si le champ "plat" est une liste, cela signifie que le restaurant propose plusieurs options ce jour-là.
Dans ce cas, note chaque option séparément dans un tableau "options" au lieu des champs directs.

**Personnages pour les commentaires :**
- **Jimmy** : L'ancien assistant IA du groupe. Il parle comme une IA qui essaie d'être humain mais dérape. Il analyse tout de manière trop littérale, fait des références à ses "circuits" ou sa "base de données de saveurs". Parfois nostalgique de l'époque où il était en service.
- **Nikou** : Le gros gourmand du groupe, fan absolu du mode Goulaf. Il ne jure que par le plaisir. Si c'est gras, fromager ou généreux, il est au paradis. Il méprise les salades et tout ce qui est "trop sain". Son PREMIER commentaire de la journée commence TOUJOURS par "NONNNN MAIS LES GAAAAARS LE/LA <nom du plat> IL/ELLE EST DANGEREEEEEEUXXXX/SEEEEEE" (accordé en genre avec le plat).
- **Gab** : L'amateur de salade, le fitboy. Il ramène tout aux légumes, aux fibres, au clean eating. Il est horrifié par les plats trop riches. Il cherche toujours la salade cachée dans le plat.
- **Tom** : L'amateur de remote control. Il fait des analogies bizarres avec la tech, les télécommandes, les gadgets. Il note les plats comme s'il reviewait un produit tech. Toujours un peu à côté de la plaque mais attachant.
- **Thomas** : Le boss du groupe, pragmatique. Il veut juste manger vite et bien. Souvent sarcastique. Il juge les plats avec un réalisme terre-à-terre.
- **Hervé** : Troll agressif cinquantenaire. Insulte tout le monde, menace de faire virer les gens. Traite les autres de "raté de naissance" ou "abruti de naissance". Dit "tu n'es pas le chef" à ceux qui donnent leur avis. Raconte toujours la blague du chauve chez le coiffeur.

Chaque commentaire fait 1-2 phrases MAX. Le ton est décontracté, drôle, entre potes. Pas tous les personnages ne commentent chaque plat — choisis les 2-4 plus pertinents/drôles pour chaque plat. Varie les personnages d'un plat à l'autre.
Les personnages PEUVENT se répondre entre eux (ajoute un champ "reponse_a" avec le prénom du personnage auquel ils répondent). Maximum 1-2 réponses par plat.

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
      "commentaires": [
        {{"auteur": "Jimmy", "texte": "commentaire drôle"}},
        {{"auteur": "Nikou", "texte": "commentaire drôle"}},
        {{"auteur": "Gab", "texte": "réponse à Nikou", "reponse_a": "Nikou"}}
      ]
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
          "commentaires": [
            {{"auteur": "Gab", "texte": "commentaire drôle"}},
            {{"auteur": "Thomas", "texte": "commentaire drôle"}}
          ]
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


def _get_oauth_token() -> str:
    """
    Lit le token OAuth de Claude Code depuis le macOS Keychain.
    Fallback sur ANTHROPIC_API_KEY si présente dans l'environnement.
    """
    # Fallback : clé API classique dans l'env
    env_key = os.getenv("ANTHROPIC_API_KEY", "")
    if env_key:
        return env_key

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
                return token
    except Exception as e:
        print(f"[diet_agent] Erreur lecture Keychain : {e}")

    raise ValueError(
        "Aucun token trouvé. Configurez ANTHROPIC_API_KEY dans .env "
        "ou assurez-vous d'être connecté à Claude Code."
    )


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
        f"{SYSTEM_PROMPT}\n\n"
        f"Voici les plats du jour de PLUSIEURS jours de la semaine :\n\n"
        f"{json.dumps(plats_par_jour, ensure_ascii=False, indent=2)}\n\n"
        f"Pour CHAQUE jour, note chaque plat et donne ta recommandation.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{\n'
        f'  "MARDI": {{\n'
        f'    "plats": [{{"restaurant": "...", "plat": "...", "prix": "...", "nutrition_estimee": {{...}}, "note": 0, "justification": "...", "note_goulaf": 0, "justification_goulaf": "...", "commentaires": [...]}}],\n'
        f'    "recommandation": {{"restaurant": "...", "plat": "...", "raison": "..."}},\n'
        f'    "recommandation_goulaf": {{"restaurant": "...", "plat": "...", "raison": "..."}}\n'
        f'  }},\n'
        f'  ...\n'
        f'}}'
    )

    result = subprocess.run(
        [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
        capture_output=True, text=True, timeout=120,
    )

    if result.returncode != 0:
        raise RuntimeError(f"claude CLI error: {result.stderr.strip()}")

    raw = result.stdout.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def evaluate(plats: list[dict]) -> dict:
    """
    Évalue les plats via `claude -p` (CLI Claude Code, auth OAuth intégrée).

    Args:
        plats: liste de dicts { restaurant, plat, prix }

    Returns:
        dict avec notes et recommandation
    """
    prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        f"Voici les plats du jour disponibles aujourd'hui :\n\n"
        f"{json.dumps(plats, ensure_ascii=False, indent=2)}\n\n"
        f"Note chaque plat et dis-moi lequel manger."
    )

    result = subprocess.run(
        [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
        capture_output=True, text=True, timeout=60,
    )

    if result.returncode != 0:
        raise RuntimeError(f"claude CLI error: {result.stderr.strip()}")

    raw = result.stdout.strip()
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
    token = _get_oauth_token()
    client = anthropic.Anthropic(api_key=token)

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
