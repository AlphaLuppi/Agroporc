"""
Transcription par le LLM (vision) d'une image de menu hebdomadaire : sert au scraper
Le Truck Muche, dont le menu n'est publié que sous forme d'image sur Facebook (l'alt text
n'embarque plus l'OCR). Même mécanisme que `image_agent._appel_llm` / `recette_agent.appeler_llm` :
SDK Anthropic si ANTHROPIC_API_KEY, sinon CLI `claude` (abonnement), un seul essai borné
par `timeout`. Lève en cas d'échec : l'appelant décide (le scraper passe au candidat suivant).
"""
import base64
import json
import os
import subprocess

MODELE_API = "claude-sonnet-4-6"

PROMPT_MENU = (
    "Cette image est (peut-être) le menu hebdomadaire des plats du jour d'un food truck, "
    "du lundi au vendredi. Transcris-la fidèlement, en français, avec les accents.\n"
    "Réponds UNIQUEMENT par un objet JSON strict, sans texte autour, de la forme :\n"
    '{"periode": "DU 19 AU 25 OCTOBRE", "menu": {"LUNDI": "...", "MARDI": "...", '
    '"MERCREDI": "...", "JEUDI": "...", "VENDREDI": "..."}}\n'
    "Règles :\n"
    "- « periode » recopie la période écrite sur l'image (ex. « DU 19 AU 25 OCTOBRE »), "
    "null si elle est illisible ou absente.\n"
    "- Un jour dont le plat est illisible ou absent vaut null.\n"
    "- Plusieurs plats pour un même jour : « PLAT A OU PLAT B » (OU en majuscules).\n"
    "- Ignore les autocollants et mentions décoratives (« Pour la semaine !! », prix, "
    "desserts, coordonnées).\n"
    '- Si l\'image n\'est pas un menu hebdomadaire (photo de plat, affiche, autre), '
    'réponds {"menu": null}.\n'
    "- Conserve les accents et ligatures (Œ, À, É…) exactement comme sur l'image.\n"
    "- Ne devine rien : ne transcris que ce qui est lisible."
)


def _appel_cli(prompt: str, image_b64: str, media_type: str, timeout: float) -> str:
    """CLI `claude` en mode stream-json : seul moyen de lui passer une image sur stdin."""
    from agent.diet_agent import CLAUDE_BIN
    if not CLAUDE_BIN:
        raise RuntimeError("ni ANTHROPIC_API_KEY ni CLI claude")
    message = {
        "type": "user",
        "message": {"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
            {"type": "text", "text": prompt},
        ]},
    }
    res = subprocess.run(
        [CLAUDE_BIN, "-p", "--input-format", "stream-json", "--output-format", "stream-json",
         "--verbose", "--max-turns", "1"],
        input=json.dumps(message) + "\n", capture_output=True, text=True, timeout=timeout,
    )
    if res.returncode != 0:
        raise RuntimeError(f"claude CLI : {res.stderr.strip()[:200]}")
    return _resultat_stream_json(res.stdout)


def _resultat_stream_json(sortie: str) -> str:
    """Texte de l'événement final {"type": "result"} d'une sortie stream-json (une ligne JSON par événement)."""
    resultat = None
    for ligne in (sortie or "").splitlines():
        ligne = ligne.strip()
        if not ligne.startswith("{"):
            continue
        try:
            evt = json.loads(ligne)
        except ValueError:
            continue
        if isinstance(evt, dict) and evt.get("type") == "result":
            resultat = evt
    if resultat is None:
        raise RuntimeError("claude CLI : pas d'événement result")
    if resultat.get("is_error"):
        raise RuntimeError(f"claude CLI : {str(resultat.get('result'))[:200]}")
    texte = resultat.get("result")
    if not isinstance(texte, str):
        raise RuntimeError("claude CLI : result illisible")
    return texte


def _appel_api(prompt: str, image_b64: str, media_type: str, timeout: float) -> str:
    import anthropic
    client = anthropic.Anthropic(timeout=timeout, max_retries=0)
    msg = client.messages.create(
        model=MODELE_API, max_tokens=1024,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
            {"type": "text", "text": prompt},
        ]}],
    )
    return msg.content[0].text


def transcrire_menu(image: bytes, media_type: str = "image/jpeg", timeout: float = 90.0) -> dict | None:
    """Objet JSON {"periode": ..., "menu": {...}} lu sur l'image par le LLM, None si la réponse
    n'est pas un objet JSON. Lève si le LLM est indisponible ou trop lent."""
    from agent.recette_agent import extraire_json
    image_b64 = base64.b64encode(image).decode("ascii")
    if os.getenv("ANTHROPIC_API_KEY"):
        brut = _appel_api(PROMPT_MENU, image_b64, media_type, timeout)
    else:
        brut = _appel_cli(PROMPT_MENU, image_b64, media_type, timeout)
    if not (brut or "").strip():
        raise RuntimeError("réponse vide du LLM")
    return extraire_json(brut)
