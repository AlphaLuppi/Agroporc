"""
Structuration LLM d'une carte de restaurant à partir de texte brut (PDF, page HTML
libre). Sert aux sources sans structure exploitable (Dubble, La Mijote). Appelé par
main._traiter_carte uniquement quand le hash du texte a changé, donc quelques fois
par an : le hash est calculé sur le texte brut, pas sur la sortie LLM.
"""
import hashlib
import json

from agent.diet_agent import _call_claude, _strip_code_fence

EXCLUSIONS = ("boissons, suppléments et protéines en plus, formules et menus composites "
              "(ex. « Entrée + Plat 18 € »), plats du jour, frais de livraison, couverts")


def _texte_hash(texte: str) -> str:
    """SHA-1 du texte normalisé (espaces réduits, casse ignorée)."""
    norm = " ".join((texte or "").split()).casefold()
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()


def _build_prompt(texte: str, restaurant: str) -> str:
    return (
        f"Voici le texte brut de la carte du restaurant « {restaurant} », extrait d'un PDF ou "
        f"d'une page web (l'ordre des lignes peut être désordonné, les prix parfois décalés) :\n\n"
        f"---\n{texte}\n---\n\n"
        "Structure cette carte en sections de plats. Règles :\n"
        "- Garde uniquement ce qui se mange : entrées, plats, bowls, salades, sandwiches, desserts.\n"
        f"- EXCLUS : {EXCLUSIONS}.\n"
        "- Le nom du plat est repris tel qu'écrit, sans description longue. Si un plat n'a pas "
        "de nom mais une liste d'ingrédients, cette liste devient le nom.\n"
        "- Prix au format \"9.90€\" (point décimal, symbole collé, sans espace) ; \"N/A\" si absent.\n"
        "- Noms de sections courts, en majuscules (ex. \"SALADES\", \"HOT BOWLS\", \"DESSERTS\").\n\n"
        "Réponds UNIQUEMENT en JSON, sans commentaire, avec cette structure :\n"
        '{ "sections": [ { "nom": "…", "plats": [ { "plat": "…", "prix": "9.90€" } ] } ] }'
    )


def _parse_reponse(raw: str) -> list[dict]:
    """Valide la réponse LLM → sections non vides. Lève ValueError si inexploitable."""
    data = json.loads(_strip_code_fence(raw))
    sections = data.get("sections") if isinstance(data, dict) else None
    if not isinstance(sections, list):
        raise ValueError("réponse LLM sans liste 'sections'")
    out = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        nom = str(sec.get("nom", "")).strip()
        plats = []
        for p in sec.get("plats", []) or []:
            if not isinstance(p, dict):
                continue
            plat = str(p.get("plat", "")).strip()
            if not plat:
                continue
            prix = str(p.get("prix") or "").strip() or "N/A"
            plats.append({"plat": plat, "prix": prix})
        if nom and plats:
            out.append({"nom": nom, "plats": plats})
    if not out:
        raise ValueError("réponse LLM sans aucun plat")
    return out


def structurer_carte(texte: str, restaurant: str) -> list[dict]:
    """Texte brut → [{"nom", "plats": [{"plat", "prix"}]}] via Claude. Lève si la réponse
    n'est pas un JSON exploitable (l'appelant loggue et ne publie pas)."""
    raw = _call_claude(_build_prompt(texte, restaurant), timeout=240)
    return _parse_reponse(raw)
