"""
Agent commentaires — génère des commentaires de personnages avec interactions.

Charge les 10 personnages depuis les fichiers JSON et utilise Claude pour
produire des commentaires immersifs où les personnages se répondent entre eux.
"""
import json
import subprocess
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from gif_search import resolve_gif_queries
from . import feedback_agent

PERSONNAGES_DIR = Path(__file__).parent.parent / "personnages"
COMMENTAIRES_SEMAINE_FILE = Path(__file__).parent.parent / "output" / "commentaires_semaine.json"

CLAUDE_BIN = (
    shutil.which("claude")
    or "/Users/toam/.local/bin/claude"
)

JOURS = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"]


def _insert_responses_after_parent(commentaires: list[dict], reponses: list[dict]) -> list[dict]:
    """
    Insère chaque réponse juste après le commentaire parent dans la liste,
    et met à jour reponse_a_index pour refléter les nouvelles positions.
    """
    # Associer chaque réponse à son index parent
    by_parent: dict[int, list[dict]] = {}
    orphans: list[dict] = []
    for r in reponses:
        parent_idx = r.get("reponse_a_index")
        # Fallback : chercher par nom d'auteur si index absent ou invalide
        if parent_idx is None or parent_idx < 0 or parent_idx >= len(commentaires):
            parent_name = r.get("reponse_a", "")
            parent_idx = None
            for i, c in enumerate(commentaires):
                if c.get("auteur") == parent_name:
                    parent_idx = i
                    break
        if parent_idx is not None:
            by_parent.setdefault(parent_idx, []).append(r)
        else:
            orphans.append(r)

    # Reconstruire la liste en insérant les réponses après leur parent
    result: list[dict] = []
    old_to_new: dict[int, int] = {}
    for i, c in enumerate(commentaires):
        old_to_new[i] = len(result)
        result.append(c)
        for r in by_parent.get(i, []):
            result.append(r)
    result.extend(orphans)

    # Mettre à jour reponse_a_index avec les nouvelles positions
    for c in result:
        if "reponse_a_index" in c and c["reponse_a_index"] in old_to_new:
            c["reponse_a_index"] = old_to_new[c["reponse_a_index"]]
        elif c.get("reponse_a"):
            # Assurer que reponse_a_index est toujours défini pour les réponses
            parent_name = c["reponse_a"]
            for j, other in enumerate(result):
                if other.get("auteur") == parent_name and other is not c:
                    c["reponse_a_index"] = j
                    break

    return result


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

        retours = p.get("retours_humains") or []
        if retours:
            lines.append(f"  Retours humains reçus (à intégrer dans la personnalité de {p['prenom']}) :")
            for r in retours[:10]:  # limiter l'injection au prompt
                ai_txt = (r.get("ai_texte") or "").strip().replace("\n", " ")
                h_auteur = r.get("human_auteur", "?")
                h_txt = (r.get("human_texte") or "").strip().replace("\n", " ")
                lines.append(
                    f"    - Quand {p['prenom']} a dit \"{ai_txt}\", {h_auteur} (humain) a répondu \"{h_txt}\"."
                )
            lines.append(
                f"  → {p['prenom']} DOIT tenir compte de ces retours : éviter ce qui a été mal reçu, "
                f"intégrer les corrections factuelles, s'adapter au ton que les humains attendent de lui, "
                f"et faire parfois allusion à ces échanges passés de façon naturelle."
            )
        lines.append("")
    return "\n".join(lines)


def _build_system_prompt_passe1(personnages: list[dict]) -> str:
    """Construit le prompt système pour la passe 1 : commentaires racines."""
    personnages_desc = _build_personnages_prompt(personnages)

    return f"""Tu es un générateur de commentaires humoristiques pour un site de plats du jour.
Tu dois générer des commentaires de personnages fictifs qui réagissent aux plats du jour.

**PERSONNAGES DISPONIBLES :**

{personnages_desc}

**RÈGLES DE GÉNÉRATION :**

1. Pour chaque plat, génère entre 3 et 5 commentaires INDÉPENDANTS.
2. Chaque commentaire fait 1-2 phrases MAX. Sois concis et percutant.
3. Varie les personnages d'un plat à l'autre — pas toujours les mêmes en premier.
4. Choisis les personnages les plus pertinents/drôles pour chaque plat.
5. **PAS DE RÉPONSES** : Chaque commentaire est indépendant. Pas de champ "reponse_a".
6. Le ton est décontracté, entre collègues/potes. C'est drôle, jamais méchant.
7. Chaque commentaire doit refléter le caractère UNIQUE du personnage (ses tics, ses obsessions, son style).
8. **GIFs/IMAGES** : Environ 20-30% des commentaires peuvent inclure un champ "gif_query" avec des mots-clés de recherche Giphy (en anglais, 2-4 mots). Ex: "excited food", "disgusted face", "gym protein". Le GIF doit être pertinent et renforcer la réaction du personnage. Ne force PAS les GIFs — seulement quand ça ajoute vraiment quelque chose de drôle.

**FORMAT DE SORTIE :** Réponds UNIQUEMENT en JSON valide."""


def _build_system_prompt_passe2(personnages: list[dict]) -> str:
    """Construit le prompt système pour la passe 2 : réponses contextuelles."""
    personnages_desc = _build_personnages_prompt(personnages)

    return f"""Tu es un générateur de réponses humoristiques pour un site de plats du jour.
On te donne des commentaires déjà postés par des personnages fictifs. Tu dois générer des RÉPONSES
qui réagissent à ces commentaires existants.

**PERSONNAGES DISPONIBLES :**

{personnages_desc}

**RÈGLES DE GÉNÉRATION :**

1. Pour chaque plat, génère entre 1 et 3 réponses à des commentaires existants.
2. Chaque réponse fait 1-2 phrases MAX. Sois concis et percutant.
3. Chaque réponse DOIT avoir un champ "reponse_a" (prénom du personnage auquel il répond) ET un champ "reponse_a_index" (index 0-based du commentaire auquel il répond dans la liste).
4. La réponse doit RÉELLEMENT réagir au contenu du commentaire (le mentionner, le contredire, rebondir dessus, etc.).
5. N'utilise PAS le même personnage que celui qui a écrit le commentaire original.
6. Exemples d'interactions naturelles :
   - Nikou s'extasie sur un plat gras → Gab ou Ricardo répondent avec dégoût
   - Tom mentionne Claude Code → Sylvain rebondit sur l'IA / Jimmy se vexe
   - Philippe critique le plat → Thomas le défend avec pragmatisme
   - Gab écrit un pavé → quelqu'un lui dit de se calmer
   - Ricardo dit qu'il mange sa propre bouffe → Nikou est outré
   - Alicia fait une ref Shrek → quelqu'un rebondit
   - Hervé insulte quelqu'un → les autres le remettent en place ou l'ignorent
7. N'OBLIGE PAS les réponses. Si aucun commentaire ne se prête à une réponse naturelle, génère moins de réponses (voire 0).
8. Le ton est décontracté, entre collègues/potes. C'est drôle, jamais méchant.
9. **GIFs/IMAGES** : Certaines réponses peuvent inclure un champ "gif_query" (mots-clés Giphy en anglais, 2-4 mots). Ex: "facepalm", "mind blown", "eye roll". Seulement quand le GIF renforce vraiment la réponse (environ 15-25% des réponses). Ne force PAS.

**FORMAT DE SORTIE :** Réponds UNIQUEMENT en JSON valide."""


def _parse_json_output(raw: str) -> dict | list:
    """Parse la sortie JSON de Claude, en nettoyant les blocs de code markdown."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def _run_claude(prompt: str, timeout: int = 120) -> str:
    """Exécute Claude CLI et retourne la sortie brute."""
    result = subprocess.run(
        [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
        capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI error: {result.stderr.strip()}")
    return result.stdout.strip()


def generate_commentaires_jour(plats: list[dict]) -> list[dict]:
    """
    Génère des commentaires pour une liste de plats (un seul jour).
    Utilise deux passes : commentaires racines puis réponses contextuelles.

    Args:
        plats: liste de dicts {{ restaurant, plat, prix }}

    Returns:
        liste de {{ restaurant, plat, commentaires: [{{ auteur, texte, reponse_a?, reponse_a_index? }}] }}
    """
    if not plats:
        return []

    # Synchroniser d'abord les retours humains pour que les personnages
    # adaptent leurs prochains commentaires aux réponses reçues sur le site.
    try:
        feedback_agent.sync_feedback_to_personnages()
    except Exception as e:
        print(f"[comment_agent] Sync feedback échouée : {e}")

    personnages = _load_personnages()

    # === PASSE 1 : commentaires racines ===
    system1 = _build_system_prompt_passe1(personnages)
    prompt1 = (
        f"{system1}\n\n"
        f"Voici les plats du jour :\n\n"
        f"{json.dumps(plats, ensure_ascii=False, indent=2)}\n\n"
        f"Génère les commentaires pour chaque plat.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{"plats": [\n'
        f'  {{"restaurant": "nom", "plat": "nom du plat", "commentaires": [\n'
        f'    {{"auteur": "Prénom", "texte": "commentaire drôle", "gif_query": "excited food (optionnel)"}}\n'
        f"  ]}}\n"
        f"]}}"
    )

    raw1 = _run_claude(prompt1)
    result_passe1 = _parse_json_output(raw1).get("plats", [])

    # === PASSE 2 : réponses contextuelles ===
    system2 = _build_system_prompt_passe2(personnages)
    prompt2 = (
        f"{system2}\n\n"
        f"Voici les plats du jour avec les commentaires déjà postés :\n\n"
        f"{json.dumps(result_passe1, ensure_ascii=False, indent=2)}\n\n"
        f"Génère des réponses qui réagissent aux commentaires existants.\n"
        f"Le champ reponse_a_index est l'index (0-based) du commentaire auquel la réponse réagit.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{"plats": [\n'
        f'  {{"restaurant": "nom", "plat": "nom du plat", "reponses": [\n'
        f'    {{"auteur": "Prénom", "texte": "réponse au commentaire", "reponse_a": "Prénom", "reponse_a_index": 0, "gif_query": "facepalm (optionnel)"}}\n'
        f"  ]}}\n"
        f"]}}"
    )

    raw2 = _run_claude(prompt2)
    result_passe2 = _parse_json_output(raw2).get("plats", [])

    # Fusionner les réponses dans les commentaires racines
    reponses_by_resto = {}
    for p in result_passe2:
        reponses_by_resto[p.get("restaurant", "")] = p.get("reponses", [])

    for p in result_passe1:
        resto = p.get("restaurant", "")
        if resto in reponses_by_resto:
            p["commentaires"] = _insert_responses_after_parent(
                p["commentaires"], reponses_by_resto[resto]
            )

    # Résoudre les gif_query en image_url
    for p in result_passe1:
        resolve_gif_queries(p.get("commentaires", []))

    return result_passe1


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
    try:
        feedback_agent.sync_feedback_to_personnages()
    except Exception as e:
        print(f"[comment_agent] Sync feedback échouée : {e}")

    personnages = _load_personnages()

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

    # === PASSE 1 : commentaires racines ===
    system1 = _build_system_prompt_passe1(personnages)
    prompt1 = (
        f"{system1}\n\n"
        f"Voici les plats du jour de toute la semaine, organisés par jour :\n\n"
        f"{json.dumps(plats_par_jour, ensure_ascii=False, indent=2)}\n\n"
        f"Génère les commentaires pour CHAQUE plat de CHAQUE jour.\n"
        f"Varie bien les personnages d'un jour à l'autre pour que ce ne soit pas répétitif.\n"
        f"Les personnages peuvent faire référence aux plats des autres jours (ex: 'enfin du gras après la salade d'hier').\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{\n'
        f'  "LUNDI": [{{"restaurant": "nom", "plat": "nom", "commentaires": [{{"auteur": "X", "texte": "...", "gif_query": "excited food (optionnel)"}}]}}],\n'
        f'  "MARDI": [...],\n'
        f'  ...\n'
        f'}}'
    )

    print("[comment_agent] Passe 1 : Génération des commentaires racines de la semaine...")
    raw1 = _run_claude(prompt1, timeout=180)
    commentaires = _parse_json_output(raw1)

    # === PASSE 2 : réponses contextuelles ===
    system2 = _build_system_prompt_passe2(personnages)
    prompt2 = (
        f"{system2}\n\n"
        f"Voici les plats du jour de toute la semaine avec les commentaires déjà postés :\n\n"
        f"{json.dumps(commentaires, ensure_ascii=False, indent=2)}\n\n"
        f"Génère des réponses qui réagissent aux commentaires existants, pour chaque jour.\n"
        f"Le champ reponse_a_index est l'index (0-based) du commentaire auquel la réponse réagit dans la liste du plat correspondant.\n"
        f"Varie les personnages qui répondent d'un jour à l'autre.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{\n'
        f'  "LUNDI": [{{"restaurant": "nom", "plat": "nom", "reponses": [{{"auteur": "X", "texte": "...", "reponse_a": "Y", "reponse_a_index": 0, "gif_query": "facepalm (optionnel)"}}]}}],\n'
        f'  "MARDI": [...],\n'
        f'  ...\n'
        f'}}'
    )

    print("[comment_agent] Passe 2 : Génération des réponses contextuelles...")
    raw2 = _run_claude(prompt2, timeout=180)
    reponses = _parse_json_output(raw2)

    # Fusionner les réponses dans les commentaires racines
    for jour in commentaires:
        if jour not in reponses:
            continue
        # Index par restaurant pour ce jour
        reponses_by_resto = {}
        for p in reponses[jour]:
            reponses_by_resto[p.get("restaurant", "")] = p.get("reponses", [])
        for p in commentaires[jour]:
            resto = p.get("restaurant", "")
            if resto in reponses_by_resto:
                p["commentaires"] = _insert_responses_after_parent(
                    p["commentaires"], reponses_by_resto[resto]
                )

    # Résoudre les gif_query en image_url
    for jour in commentaires:
        for p in commentaires[jour]:
            resolve_gif_queries(p.get("commentaires", []))

    # Sauvegarder pour usage quotidien
    COMMENTAIRES_SEMAINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    COMMENTAIRES_SEMAINE_FILE.write_text(
        json.dumps(commentaires, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[comment_agent] Commentaires semaine sauvegardés → {COMMENTAIRES_SEMAINE_FILE.name}")

    return commentaires


def generate_commentaires_personnage(prenom: str) -> dict[str, list[dict]]:
    """
    Génère des commentaires pour un seul personnage et les injecte dans
    les commentaires de la semaine existants.

    Args:
        prenom: prénom du personnage (ex: "Adel")

    Returns:
        dict mis à jour { "LUNDI": [...], ... }
    """
    # Synchroniser les retours humains avant de charger le personnage,
    # pour que ses nouveaux commentaires intègrent les derniers échanges.
    try:
        feedback_agent.sync_feedback_to_personnages()
    except Exception as e:
        print(f"[comment_agent] Sync feedback échouée : {e}")

    # Charger le personnage cible
    personnage_file = PERSONNAGES_DIR / f"{prenom.lower()}.json"
    if not personnage_file.exists():
        raise FileNotFoundError(f"Personnage introuvable : {personnage_file}")
    personnage = json.loads(personnage_file.read_text(encoding="utf-8"))

    # Charger les commentaires existants
    if not COMMENTAIRES_SEMAINE_FILE.exists():
        raise FileNotFoundError(f"Pas de commentaires semaine existants : {COMMENTAIRES_SEMAINE_FILE}")
    commentaires = json.loads(COMMENTAIRES_SEMAINE_FILE.read_text(encoding="utf-8"))

    # Construire la description du personnage
    personnage_desc = _build_personnages_prompt([personnage])

    # === PASSE 1 : commentaires racines du personnage ===
    system1 = f"""Tu es un générateur de commentaires humoristiques pour un site de plats du jour.
Tu dois générer des commentaires pour UN SEUL personnage : {personnage['prenom']}.

**PERSONNAGE :**

{personnage_desc}

**RÈGLES DE GÉNÉRATION :**

1. Pour chaque plat, génère 0 ou 1 commentaire de {personnage['prenom']} (pas systématiquement, il ne commente pas TOUS les plats).
2. Environ 60-70% des plats devraient avoir un commentaire de ce personnage.
3. Chaque commentaire fait 1-2 phrases MAX. Sois concis et percutant.
4. **PAS DE RÉPONSES** : Chaque commentaire est indépendant. Pas de champ "reponse_a".
5. Le ton est décontracté, entre collègues/potes. C'est drôle, jamais méchant.
6. Le commentaire doit refléter le caractère UNIQUE du personnage (ses tics, ses obsessions, son style).
7. **GIFs/IMAGES** : Le commentaire peut optionnellement inclure un champ "gif_query" avec des mots-clés de recherche Giphy (en anglais, 2-4 mots). Seulement si ça renforce vraiment la réaction. Environ 20% des commentaires max.

**FORMAT DE SORTIE :** Réponds UNIQUEMENT en JSON valide."""

    prompt1 = (
        f"{system1}\n\n"
        f"Voici les plats du jour de toute la semaine avec les commentaires existants des autres personnages :\n\n"
        f"{json.dumps(commentaires, ensure_ascii=False, indent=2)}\n\n"
        f"Génère les commentaires de {personnage['prenom']} pour les plats qui l'inspirent.\n"
        f"Il peut faire référence aux plats des autres jours.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{\n'
        f'  "LUNDI": [{{"restaurant": "nom", "plat": "nom", "commentaire": {{"auteur": "{personnage["prenom"]}", "texte": "...", "gif_query": "excited food (optionnel)"}}}}}},\n'
        f'  "MARDI": [...],\n'
        f'  ...\n'
        f'}}\n'
        f'Si {personnage["prenom"]} ne commente pas un plat, ne l\'inclus pas dans la liste de ce jour.'
    )

    print(f"[comment_agent] Passe 1 : Génération des commentaires racines de {prenom}...")
    raw1 = _run_claude(prompt1, timeout=180)
    nouveaux = _parse_json_output(raw1)

    # Injecter les commentaires racines dans les données existantes
    for jour in nouveaux:
        if jour not in commentaires:
            continue
        for new_entry in nouveaux[jour]:
            resto = new_entry.get("restaurant", "")
            commentaire = new_entry.get("commentaire")
            if not commentaire:
                continue
            # Trouver le plat correspondant dans les commentaires existants
            for existing in commentaires[jour]:
                if existing.get("restaurant") == resto:
                    # Vérifier que le personnage n'a pas déjà commenté
                    auteurs = {c.get("auteur") for c in existing.get("commentaires", [])}
                    if commentaire["auteur"] not in auteurs:
                        existing["commentaires"].append(commentaire)
                    break

    # === PASSE 2 : réponses contextuelles du personnage ===
    system2 = f"""Tu es un générateur de réponses humoristiques pour un site de plats du jour.
Tu dois générer des RÉPONSES pour UN SEUL personnage : {personnage['prenom']}.
Il réagit aux commentaires existants des autres personnages.

**PERSONNAGE :**

{personnage_desc}

**RÈGLES DE GÉNÉRATION :**

1. Génère entre 2 et 5 réponses AU TOTAL sur toute la semaine.
2. Chaque réponse fait 1-2 phrases MAX.
3. Chaque réponse DOIT avoir un champ "reponse_a" (prénom du personnage auquel il répond) ET un champ "reponse_a_index" (index 0-based du commentaire dans la liste).
4. La réponse doit RÉELLEMENT réagir au contenu du commentaire.
5. Ne répond PAS à ses propres commentaires.
6. N'OBLIGE PAS les réponses. Si aucun commentaire ne se prête à une réponse naturelle, génère moins de réponses.
7. Le ton est décontracté, entre collègues/potes. C'est drôle, jamais méchant.
8. **GIFs/IMAGES** : La réponse peut optionnellement inclure un champ "gif_query" (mots-clés Giphy en anglais, 2-4 mots). Seulement quand ça renforce la réponse.

**FORMAT DE SORTIE :** Réponds UNIQUEMENT en JSON valide."""

    prompt2 = (
        f"{system2}\n\n"
        f"Voici les plats du jour de toute la semaine avec TOUS les commentaires (y compris ceux de {personnage['prenom']}) :\n\n"
        f"{json.dumps(commentaires, ensure_ascii=False, indent=2)}\n\n"
        f"Génère des réponses de {personnage['prenom']} aux commentaires des autres.\n"
        f"Le champ reponse_a_index est l'index (0-based) du commentaire auquel la réponse réagit.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{\n'
        f'  "LUNDI": [{{"restaurant": "nom", "plat": "nom", "reponses": [{{"auteur": "{personnage["prenom"]}", "texte": "...", "reponse_a": "Y", "reponse_a_index": 0, "gif_query": "facepalm (optionnel)"}}]}}],\n'
        f'  ...\n'
        f'}}\n'
        f'Si aucun commentaire ne mérite de réponse pour un jour, omets ce jour.'
    )

    print(f"[comment_agent] Passe 2 : Génération des réponses de {prenom}...")
    raw2 = _run_claude(prompt2, timeout=180)
    reponses = _parse_json_output(raw2)

    # Injecter les réponses
    for jour in reponses:
        if jour not in commentaires:
            continue
        for rep_entry in reponses[jour]:
            resto = rep_entry.get("restaurant", "")
            for existing in commentaires[jour]:
                if existing.get("restaurant") == resto:
                    new_reponses = rep_entry.get("reponses", [])
                    existing["commentaires"] = _insert_responses_after_parent(
                        existing["commentaires"], new_reponses
                    )
                    break

    # Résoudre les gif_query en image_url
    for jour in commentaires:
        for p in commentaires[jour]:
            resolve_gif_queries(p.get("commentaires", []))

    # Sauvegarder
    COMMENTAIRES_SEMAINE_FILE.write_text(
        json.dumps(commentaires, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[comment_agent] Commentaires de {prenom} injectés → {COMMENTAIRES_SEMAINE_FILE.name}")

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
            # Décaler les reponse_a_index des nouveaux commentaires
            offset = len(existing)
            for c in new_comments:
                if "reponse_a_index" in c:
                    c["reponse_a_index"] += offset
            plat["commentaires"] = existing + new_comments

    return evaluation
