"""
Agent diététicien — appelle Claude via API directe (si ANTHROPIC_API_KEY)
ou via le CLI `claude -p` (auth OAuth gérée par Claude Code) en fallback.

Le diet_agent évalue UNIQUEMENT la nutrition et les scores. Les commentaires
sont générés séparément par comment_agent.

Pipeline macros (2 passes) :
1. Le LLM décompose chaque plat en ingrédients + grammages (style canonique Ciqual)
   et fournit aussi une nutrition_estimee_llm de secours.
2. Pour chaque ingrédient, on récupère un top-K de candidats Ciqual (matcheur
   permissif côté Python). Un 2nd appel LLM choisit le code le plus pertinent
   compte tenu du plat (mode de cuisson, présence de peau, etc.).
3. On agrège les macros depuis les codes Ciqual choisis. Si plus de 30% de la
   masse n'est pas matchée, on retombe sur la nutrition_estimee_llm.

Photos de référence (passe 1) :
Si le dossier `plats-du-jour/photos/<slug>/` contient des images JPG/PNG/WEBP,
elles sont envoyées au LLM en début de prompt pour calibrer les grammages selon
les portions typiques de chaque restau (ex. Truck Muche = portions copieuses).
Slugs supportés : `bistrot_trefle`, `pause_gourmande`, `truck_muche`. Cette voie
n'est utilisée qu'en mode API (ANTHROPIC_API_KEY/AUTH_TOKEN ou OAuth Keychain) ;
le CLI `claude -p` retombe sur le mode texte.
"""
import base64
import json
import pathlib
import subprocess
import os
import shutil
import urllib.request
import anthropic

from ciqual.lookup import (
    compute_macros,
    compute_macros_from_codes,
    find_candidates,
    get_entry_by_code,
)

UNMATCHED_FALLBACK_THRESHOLD = 0.30
TOP_K_CANDIDATES = 8

SPORT_PROFILE = os.getenv("SPORT_PROFILE", "sport régulier")
DAILY_CALORIES_TARGET = os.getenv("DAILY_CALORIES_TARGET", "2200")

CLAUDE_BIN = shutil.which("claude")

PHOTOS_DIR = pathlib.Path(__file__).resolve().parent.parent / "photos"
RESTAURANT_PHOTO_SLUGS = {
    "Le Bistrot Trèfle": "bistrot_trefle",
    "La Pause Gourmande": "pause_gourmande",
    "Le Truck Muche": "truck_muche",
}
PHOTO_EXTENSIONS = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
MAX_PHOTOS_PER_RESTAURANT = 4


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


def _load_restaurant_photo_blocks_from_api(restaurants: set[str]) -> list[dict]:
    """Charge les photos depuis l'API Vercel (si VERCEL_API_URL est défini dans .env)."""
    api_url = os.getenv("VERCEL_API_URL", "").rstrip("/")
    if not api_url:
        return []
    blocks: list[dict] = []
    for name in sorted(restaurants):
        slug = RESTAURANT_PHOTO_SLUGS.get(name)
        if not slug:
            continue
        try:
            req = urllib.request.Request(f"{api_url}/api/photos?slug={slug}")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            photos = data.get("photos", [])[:MAX_PHOTOS_PER_RESTAURANT]
            if not photos:
                continue
            blocks.append({
                "type": "text",
                "text": f"Photos de référence — portions typiques de {name} :",
            })
            for photo in photos:
                img_req = urllib.request.Request(f"{api_url}/api/photos/{photo['id']}/image")
                with urllib.request.urlopen(img_req, timeout=15) as img_resp:
                    img_b64 = base64.standard_b64encode(img_resp.read()).decode("ascii")
                mime = photo.get("content_type", "image/jpeg")
                blocks.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": mime, "data": img_b64},
                })
        except Exception as e:
            print(f"[diet_agent] Erreur chargement photos API pour {name}: {e}")
    return blocks


def _load_restaurant_photo_blocks(restaurants: set[str]) -> list[dict]:
    """Charge les photos de référence des restaurants en blocs `content` Anthropic.

    Essaie d'abord l'API Vercel (si VERCEL_API_URL est configuré dans .env),
    sinon retombe sur le dossier local `plats-du-jour/photos/<slug>/`.
    Renvoie [] si aucune photo n'est trouvée.
    """
    api_blocks = _load_restaurant_photo_blocks_from_api(restaurants)
    if api_blocks:
        return api_blocks

    # Fallback : filesystem local
    blocks: list[dict] = []
    for name in sorted(restaurants):
        slug = RESTAURANT_PHOTO_SLUGS.get(name)
        if not slug:
            continue
        rest_dir = PHOTOS_DIR / slug
        if not rest_dir.is_dir():
            continue
        photos = sorted(
            p for p in rest_dir.iterdir()
            if p.is_file() and p.suffix.lower() in PHOTO_EXTENSIONS
        )[:MAX_PHOTOS_PER_RESTAURANT]
        if not photos:
            continue
        blocks.append({
            "type": "text",
            "text": f"Photos de référence — portions typiques de {name} :",
        })
        for p in photos:
            mime = PHOTO_EXTENSIONS[p.suffix.lower()]
            data = base64.standard_b64encode(p.read_bytes()).decode("ascii")
            blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": mime, "data": data},
            })
    return blocks


def _call_claude_with_images(text_prompt: str, image_blocks: list[dict], timeout: int = 300) -> str:
    """Variante de _call_claude avec images. Voie API uniquement (CLI non supporté).

    Utilise _make_client() qui gère API key et OAuth (token env ou Keychain).
    """
    client = _make_client()
    content = list(image_blocks) + [{"type": "text", "text": text_prompt}]
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        messages=[{"role": "user", "content": content}],
        timeout=timeout,
    )
    return message.content[0].text.strip()


def _strip_code_fence(raw: str) -> str:
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def _build_system_prompt() -> str:
    """Prompt lean : ingrédients + nutrition + scores. Pas de commentaires (cf. comment_agent)."""
    return f"""Tu es un expert en nutrition ET en gastronomie.
L'utilisateur pratique du sport régulièrement ({SPORT_PROFILE}) et suit ses macronutriments.
Son objectif calorique journalier est d'environ {DAILY_CALORIES_TARGET} kcal.

Pour chaque plat du jour soumis, fournis DEUX évaluations :
**Mode Sportif** : note selon l'adéquation nutritionnelle (protéines, macros équilibrés).
**Mode Goulaf** : note selon le plaisir gustatif, la gourmandise, la générosité. Un plat riche et savoureux sera bien noté même s'il est calorique.

Pour chaque plat :
1. **Décomposer le plat en ingrédients** avec leur grammage estimé pour une portion adulte (4 à 8 ingrédients, total 350–700 g).
   - Utilise des noms canoniques style table Ciqual : nom principal en premier, attributs séparés par virgules.
   - Indique précisément le mode de cuisson réel (cuit/cru/grillé/rôti/frit/vapeur) et la présence ou non de peau pour les viandes.
   - Exemples : "Poulet, blanc, grillé", "Riz blanc, cuit", "Pomme de terre, vapeur", "Haricot vert, cuit",
     "Saumon, grillé", "Boeuf, steak haché 5%", "Tomate, cerise", "Pomme, golden", "Emmental",
     "Sauce moutarde", "Beurre", "Huile olive", "Pâtes, cuites", "Frites", "Lentilles, cuites".
   - Pour un fruit/légume sans précision, ajoute un attribut ("Pomme, golden" plutôt que "Pomme" seul,
     car "Pomme" seul est ambigu avec "Pomme de terre" en table Ciqual).
2. Donner une nutrition_estimee_llm de secours (calories, protéines, glucides, lipides) — utilisée si trop d'ingrédients ne matchent pas la base Ciqual.
3. Attribuer une note sportif (1-10) ET une note goulaf (1-10).
4. Justifier brièvement chaque note (2-3 phrases max chacune).
5. Désigner le plat recommandé pour chaque mode.

IMPORTANT : si le champ "plat" est une liste, le restaurant propose plusieurs options.
Dans ce cas, note chaque option séparément dans un tableau "options".

Réponds UNIQUEMENT en JSON valide avec cette structure :
{{
  "plats": [
    {{
      "restaurant": "nom",
      "plat": "nom du plat unique",
      "prix": "prix",
      "ingredients": [
        {{"nom": "Poulet, blanc, grillé", "grammes": 150}},
        {{"nom": "Riz blanc, cuit", "grammes": 180}}
      ],
      "nutrition_estimee_llm": {{"calories": 0, "proteines_g": 0, "glucides_g": 0, "lipides_g": 0}},
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
          "ingredients": [
            {{"nom": "ingrédient", "grammes": 100}}
          ],
          "nutrition_estimee_llm": {{"calories": 0, "proteines_g": 0, "glucides_g": 0, "lipides_g": 0}},
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


def _iter_plats(result: dict):
    """Itère sur tous les plats/options de la structure (1 jour ou semaine).

    Yield des tuples (target_dict, plat_label) où target_dict est le dict à
    muter avec les macros (soit le plat, soit chaque option pour les plats
    multi-options) et plat_label est utilisé pour donner du contexte au LLM.
    """
    if not isinstance(result, dict):
        return

    days = [result] if "plats" in result else [
        v for v in result.values() if isinstance(v, dict) and "plats" in v
    ]
    for day in days:
        for p in day.get("plats", []) or []:
            options = p.get("options")
            base_label = p.get("plat") if isinstance(p.get("plat"), str) else ""
            if isinstance(options, list):
                for opt in options:
                    label = opt.get("plat") or base_label
                    yield opt, label
            else:
                yield p, base_label


def _collect_ingredient_queries(result: dict) -> list[dict]:
    """Pour chaque ingrédient unique (par nom), regroupe les contextes de plats.

    Renvoie : [{"nom": <nom_query>, "plats": [<plat_label>, …]}]
    Si le même nom apparaît dans plusieurs plats, on garde tous les labels pour
    aider le LLM à comprendre dans quels contextes il sera utilisé.
    """
    by_nom: dict[str, set[str]] = {}
    for target, label in _iter_plats(result):
        for ing in target.get("ingredients") or []:
            nom = (ing.get("nom") or "").strip()
            if not nom:
                continue
            by_nom.setdefault(nom, set()).add(label or "?")
    return [{"nom": nom, "plats": sorted(labels)} for nom, labels in by_nom.items()]


def _build_picker_prompt(queries: list[dict]) -> tuple[str, dict[str, list[dict]]]:
    """Construit le prompt qui demande au LLM de choisir un code Ciqual par ingrédient.

    Renvoie (prompt, mapping nom → liste candidats) pour pouvoir vérifier
    que les codes choisis sont valides.
    """
    items = []
    candidates_by_nom: dict[str, list[dict]] = {}
    for q in queries:
        cands = find_candidates(q["nom"], k=TOP_K_CANDIDATES)
        cand_summary = [
            {
                "code": c["code"],
                "nom": c["nom"],
                "kcal_100g": c["kcal"],
                "prot_100g": c["prot"],
                "gluc_100g": c["gluc"],
                "lip_100g": c["lip"],
            }
            for c in cands
        ]
        candidates_by_nom[q["nom"]] = cand_summary
        items.append({
            "ingredient": q["nom"],
            "plats_concernes": q["plats"],
            "candidats": cand_summary,
        })

    prompt = (
        "Tu reçois une liste d'ingrédients de recettes (champ `ingredient`) avec les "
        "plats dans lesquels ils apparaissent (`plats_concernes`) et une liste de "
        "candidats issus de la table Ciqual ANSES (`candidats`).\n\n"
        "Pour CHAQUE ingrédient, choisis le code Ciqual le plus pertinent en tenant "
        "compte du contexte des plats : mode de cuisson réel, présence ou non de peau, "
        "type d'aliment moyen vs. spécifique, etc.\n\n"
        "Si AUCUN candidat ne convient (l'ingrédient est trop éloigné), réponds "
        "\"none\" pour ce code.\n\n"
        "Réponds UNIQUEMENT en JSON, format : "
        "{\"<ingredient exact>\": \"<code Ciqual>\", ...}\n\n"
        "Données :\n"
        + json.dumps(items, ensure_ascii=False, indent=2)
    )
    return prompt, candidates_by_nom


def _pick_ciqual_codes(result: dict) -> dict[str, str]:
    """Étape 2 : appelle le LLM pour choisir un code Ciqual par ingrédient.

    Renvoie {nom_query → code Ciqual valide} ; les ingrédients sans candidat ou
    rejetés par le LLM ("none") sont absents du dict.
    """
    queries = _collect_ingredient_queries(result)
    if not queries:
        return {}

    prompt, candidates_by_nom = _build_picker_prompt(queries)

    try:
        raw = _call_claude(prompt, timeout=180)
        picks_raw = json.loads(_strip_code_fence(raw))
    except Exception as e:
        print(f"[diet_agent] picker LLM échoué ({e}), fallback fuzzy")
        return {}

    if not isinstance(picks_raw, dict):
        return {}

    valid_picks: dict[str, str] = {}
    for nom, code in picks_raw.items():
        if not isinstance(code, str) or code.lower() == "none":
            continue
        # Vérifier que le code est bien dans les candidats proposés (anti-hallucination)
        cands = candidates_by_nom.get(nom, [])
        if any(c["code"] == code for c in cands) and get_entry_by_code(code):
            valid_picks[nom] = code

    return valid_picks


def _compute_macros_for_plat(plat: dict, picks: dict[str, str]) -> None:
    """Remplit `nutrition_estimee` et `ingredients_detail` à partir des ingrédients.

    `picks` mappe nom_query → code Ciqual choisi par le LLM. Les ingrédients
    sans pick utilisent un fallback fuzzy interne. Si plus de
    UNMATCHED_FALLBACK_THRESHOLD de la masse n'est pas matchée en Ciqual, on
    retombe sur la nutrition_estimee_llm fournie par le LLM en passe 1.
    """
    ingredients = plat.get("ingredients") or []
    fallback_llm = plat.get("nutrition_estimee_llm")

    if not ingredients:
        if fallback_llm:
            plat["nutrition_estimee"] = fallback_llm
            plat["nutrition_source"] = "llm"
        return

    # Items enrichis : {nom, grammes, code (optionnel)}
    items_with_codes = []
    for ing in ingredients:
        nom = (ing.get("nom") or "").strip()
        items_with_codes.append({
            "nom": nom,
            "grammes": ing.get("grammes", 0) or 0,
            "code": picks.get(nom),  # peut être None → compute_macros_from_codes fera fuzzy fallback
        })

    totals, detail, ratio_unmatched = compute_macros_from_codes(items_with_codes)

    if ratio_unmatched > UNMATCHED_FALLBACK_THRESHOLD and fallback_llm:
        plat["nutrition_estimee"] = fallback_llm
        plat["nutrition_source"] = "llm"
        plat["ingredients_detail"] = detail
        plat["ciqual_unmatched_ratio"] = round(ratio_unmatched, 2)
        return

    plat["nutrition_estimee"] = totals
    plat["nutrition_source"] = "ciqual"
    plat["ingredients_detail"] = detail
    if ratio_unmatched > 0:
        plat["ciqual_unmatched_ratio"] = round(ratio_unmatched, 2)


def _apply_ciqual(result: dict) -> dict:
    """Pipeline complet : pick LLM → calcul macros sur chaque plat/option."""
    if not isinstance(result, dict):
        return result

    picks = _pick_ciqual_codes(result)
    for target, _ in _iter_plats(result):
        _compute_macros_for_plat(target, picks)
    return result


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

    restaurants = {
        p.get("restaurant")
        for plats in plats_par_jour.values()
        for p in (plats or [])
        if p.get("restaurant")
    }
    image_blocks = _load_restaurant_photo_blocks(restaurants)
    photos_hint = (
        "\n\nDes photos de référence des portions typiques de chaque restaurant te "
        "sont fournies en début de message. Utilise-les pour calibrer tes grammages "
        "(petites portions, portions copieuses, etc.) selon le restaurant concerné."
        if image_blocks else ""
    )

    prompt = (
        f"{_build_system_prompt()}{photos_hint}\n\n"
        f"Voici les plats du jour de PLUSIEURS jours de la semaine :\n\n"
        f"{json.dumps(plats_par_jour, ensure_ascii=False, indent=2)}\n\n"
        f"Pour CHAQUE jour, note chaque plat et donne ta recommandation.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{\n'
        f'  "MARDI": {{\n'
        f'    "plats": [{{"restaurant": "...", "plat": "...", "prix": "...", "ingredients": [...], "nutrition_estimee_llm": {{...}}, "note": 0, "justification": "...", "note_goulaf": 0, "justification_goulaf": "...", "commentaires": []}}],\n'
        f'    "recommandation": {{"restaurant": "...", "plat": "...", "raison": "..."}},\n'
        f'    "recommandation_goulaf": {{"restaurant": "...", "plat": "...", "raison": "..."}}\n'
        f'  }},\n'
        f'  ...\n'
        f'}}'
    )

    if image_blocks:
        raw = _call_claude_with_images(prompt, image_blocks, timeout=300)
    else:
        raw = _call_claude(prompt, timeout=300)
    return _apply_ciqual(json.loads(_strip_code_fence(raw)))


def evaluate(plats: list[dict]) -> dict:
    """
    Évalue les plats via Claude (API ou CLI).

    Args:
        plats: liste de dicts { restaurant, plat, prix }

    Returns:
        dict avec notes et recommandation
    """
    restaurants = {p.get("restaurant") for p in plats if p.get("restaurant")}
    image_blocks = _load_restaurant_photo_blocks(restaurants)
    photos_hint = (
        "\n\nDes photos de référence des portions typiques de chaque restaurant te "
        "sont fournies en début de message. Utilise-les pour calibrer tes grammages "
        "(petites portions, portions copieuses, etc.) selon le restaurant concerné."
        if image_blocks else ""
    )

    prompt = (
        f"{_build_system_prompt()}{photos_hint}\n\n"
        f"Voici les plats du jour disponibles aujourd'hui :\n\n"
        f"{json.dumps(plats, ensure_ascii=False, indent=2)}\n\n"
        f"Note chaque plat et dis-moi lequel manger."
    )

    if image_blocks:
        raw = _call_claude_with_images(prompt, image_blocks, timeout=240)
    else:
        raw = _call_claude(prompt, timeout=180)
    return _apply_ciqual(json.loads(_strip_code_fence(raw)))


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
