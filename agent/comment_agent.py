"""
Agent commentaires — génère des commentaires de personnages avec interactions.

Charge les 10 personnages depuis les fichiers JSON et utilise Claude pour
produire des commentaires immersifs où les personnages se répondent entre eux.
"""
import json
import subprocess
import shutil
from pathlib import Path

PERSONNAGES_DIR = Path(__file__).parent.parent / "personnages"
COMMENTAIRES_SEMAINE_FILE = Path(__file__).parent.parent / "output" / "commentaires_semaine.json"

CLAUDE_BIN = (
    shutil.which("claude")
    or "/Users/toam/.local/bin/claude"
)

JOURS = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"]


def _load_personnages() -> list[dict]:
    """Charge tous les personnages depuis les fichiers JSON."""
    personnages = []
    for f in sorted(PERSONNAGES_DIR.glob("*.json")):
        personnages.append(json.loads(f.read_text(encoding="utf-8")))
    return personnages


def _build_personnages_prompt(personnages: list[dict]) -> str:
    """Construit la section personnages du prompt."""
    lines = []
    for p in personnages:
        lines.append(f"**{p['prenom']}** {p['emoji']} — {p['role']}")
        lines.append(f"  Personnalité : {p['personnalite']}")
        lines.append(f"  Traits : {', '.join(p['traits'])}")
        lines.append(f"  Style : {p['style_de_parole']}")
        lines.append(f"  Sujets fétiches : {', '.join(p['sujets_fetiches'])}")
        lines.append(f"  Blagues récurrentes : {', '.join(p['blagues_recurrentes'])}")
        lines.append("")
    return "\n".join(lines)


def _build_system_prompt(personnages: list[dict]) -> str:
    """Construit le prompt système pour la génération de commentaires."""
    personnages_desc = _build_personnages_prompt(personnages)

    return f"""Tu es un générateur de commentaires humoristiques pour un site de plats du jour.
Tu dois générer des commentaires de personnages fictifs qui réagissent aux plats du jour.

**PERSONNAGES DISPONIBLES :**

{personnages_desc}

**RÈGLES DE GÉNÉRATION :**

1. Pour chaque plat, génère entre 4 et 7 commentaires.
2. Chaque commentaire fait 1-2 phrases MAX. Sois concis et percutant.
3. Varie les personnages d'un plat à l'autre — pas toujours les mêmes en premier.
4. Choisis les personnages les plus pertinents/drôles pour chaque plat.
5. **INTERACTIONS** : Quand c'est naturel, fais des personnages se répondre entre eux.
   - Un personnage peut réagir au commentaire d'un autre (indique-le avec "en réponse à X" dans un champ "reponse_a").
   - Exemples d'interactions naturelles :
     - Nikou s'extasie sur un plat gras → Gab ou Ricardo répondent avec dégoût
     - Tom mentionne Claude Code → Sylvain rebondit sur l'IA / Jimmy se vexe
     - Philippe critique le plat → Thomas le défend avec pragmatisme
     - Gab écrit un pavé → quelqu'un lui dit de se calmer
     - Ricardo dit qu'il mange sa propre bouffe → Nikou est outré
     - Alicia fait une ref Shrek → quelqu'un rebondit
     - Hervé insulte quelqu'un → les autres le remettent en place ou l'ignorent
   - N'OBLIGE PAS les interactions. Si ça ne colle pas, laisse des commentaires indépendants.
   - Maximum 2-3 interactions par plat, pas plus.

6. Le ton est décontracté, entre collègues/potes. C'est drôle, jamais méchant.
7. Chaque commentaire doit refléter le caractère UNIQUE du personnage (ses tics, ses obsessions, son style).

**FORMAT DE SORTIE :** Réponds UNIQUEMENT en JSON valide."""


def generate_commentaires_jour(plats: list[dict]) -> list[dict]:
    """
    Génère des commentaires pour une liste de plats (un seul jour).

    Args:
        plats: liste de dicts {{ restaurant, plat, prix }}

    Returns:
        liste de {{ restaurant, plat, commentaires: [{{ auteur, texte, reponse_a? }}] }}
    """
    if not plats:
        return []

    personnages = _load_personnages()
    system = _build_system_prompt(personnages)

    prompt = (
        f"{system}\n\n"
        f"Voici les plats du jour :\n\n"
        f"{json.dumps(plats, ensure_ascii=False, indent=2)}\n\n"
        f"Génère les commentaires pour chaque plat.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{"plats": [\n'
        f'  {{"restaurant": "nom", "plat": "nom du plat", "commentaires": [\n'
        f'    {{"auteur": "Prénom", "texte": "commentaire drôle"}},\n'
        f'    {{"auteur": "Prénom", "texte": "commentaire en réponse", "reponse_a": "Prénom du personnage auquel il répond"}}\n'
        f"  ]}}\n"
        f"]}}"
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
    return json.loads(raw.strip()).get("plats", [])


def generate_commentaires_semaine(
    trefle_semaine: dict[str, dict] | None,
    truck_semaine: dict[str, dict] | None,
) -> dict[str, list[dict]]:
    """
    Génère les commentaires pour tous les plats de la semaine (Trèfle + Truck).
    Les stocke dans commentaires_semaine.json.

    Args:
        trefle_semaine: {{ "LUNDI": {{"plat": ..., "prix": ...}}, ... }}
        truck_semaine:  {{ "LUNDI": {{"plat": ..., "prix": ...}}, ... }}

    Returns:
        dict {{ "LUNDI": [commentaires], "MARDI": [...], ... }}
    """
    personnages = _load_personnages()
    system = _build_system_prompt(personnages)

    # Construire la liste des plats par jour
    plats_par_jour = {}
    for jour in JOURS:
        plats = []
        if trefle_semaine and jour in trefle_semaine:
            t = trefle_semaine[jour]
            plats.append({
                "restaurant": "Le Bistrot Trèfle",
                "plat": t["plat"],
                "prix": t["prix"],
            })
        if truck_semaine and jour in truck_semaine:
            t = truck_semaine[jour]
            plats.append({
                "restaurant": "Le Truck Muche",
                "plat": t["plat"],
                "prix": t["prix"],
            })
        if plats:
            plats_par_jour[jour] = plats

    if not plats_par_jour:
        print("[comment_agent] Aucun plat de la semaine à commenter")
        return {}

    prompt = (
        f"{system}\n\n"
        f"Voici les plats du jour de toute la semaine, organisés par jour :\n\n"
        f"{json.dumps(plats_par_jour, ensure_ascii=False, indent=2)}\n\n"
        f"Génère les commentaires pour CHAQUE plat de CHAQUE jour.\n"
        f"Varie bien les personnages d'un jour à l'autre pour que ce ne soit pas répétitif.\n"
        f"Les personnages peuvent faire référence aux plats des autres jours (ex: 'enfin du gras après la salade d'hier').\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{\n'
        f'  "LUNDI": [{{"restaurant": "nom", "plat": "nom", "commentaires": [{{"auteur": "X", "texte": "..."}}]}}],\n'
        f'  "MARDI": [...],\n'
        f'  ...\n'
        f'}}'
    )

    print("[comment_agent] Génération des commentaires de la semaine (10 personnages)...")
    result = subprocess.run(
        [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
        capture_output=True, text=True, timeout=180,
    )

    if result.returncode != 0:
        raise RuntimeError(f"claude CLI error: {result.stderr.strip()}")

    raw = result.stdout.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    commentaires = json.loads(raw.strip())

    # Sauvegarder pour usage quotidien
    COMMENTAIRES_SEMAINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    COMMENTAIRES_SEMAINE_FILE.write_text(
        json.dumps(commentaires, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[comment_agent] Commentaires semaine sauvegardés → {COMMENTAIRES_SEMAINE_FILE.name}")

    return commentaires


def load_commentaires_jour(jour: str) -> list[dict]:
    """
    Charge les commentaires pré-générés pour un jour donné.

    Args:
        jour: nom du jour en majuscules (ex: "MARDI")

    Returns:
        liste de {{ restaurant, plat, commentaires }} ou []
    """
    if not COMMENTAIRES_SEMAINE_FILE.exists():
        return []
    try:
        data = json.loads(COMMENTAIRES_SEMAINE_FILE.read_text(encoding="utf-8"))
        return data.get(jour, [])
    except Exception as e:
        print(f"[comment_agent] Erreur lecture commentaires semaine : {e}")
        return []


def merge_commentaires(evaluation: dict, commentaires_jour: list[dict], commentaires_pg: list[dict] | None = None) -> dict:
    """
    Fusionne les commentaires pré-générés dans l'évaluation du diet_agent.

    Les commentaires pré-générés (semaine + PG) sont ajoutés après ceux
    déjà générés par le diet_agent. Les doublons (même auteur) sont évités.
    """
    if not evaluation.get("plats"):
        return evaluation

    # Index des commentaires pré-générés par restaurant
    comments_by_resto = {}
    for c in commentaires_jour:
        resto = c.get("restaurant", "")
        comments_by_resto[resto] = c.get("commentaires", [])

    if commentaires_pg:
        for c in commentaires_pg:
            resto = c.get("restaurant", "")
            comments_by_resto[resto] = c.get("commentaires", [])

    # Ajouter les commentaires pré-générés (sans doublons d'auteur)
    for plat in evaluation["plats"]:
        resto = plat.get("restaurant", "")
        if resto in comments_by_resto:
            existing = plat.get("commentaires", [])
            existing_authors = {c.get("auteur") for c in existing}
            new_comments = [
                c for c in comments_by_resto[resto]
                if c.get("auteur") not in existing_authors
            ]
            plat["commentaires"] = existing + new_comments

    return evaluation
