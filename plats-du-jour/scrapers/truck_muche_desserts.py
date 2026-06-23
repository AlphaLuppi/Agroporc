"""
Scrape la liste des desserts du jour (texte) sur le Facebook/Instagram du Truck Muche,
pour accumuler une base de probabilités côté front.

Les desserts sont publiés EN TEXTE dans un post (pas une image) → parsing heuristique.
"""
import re
import unicodedata

# Lignes parasites à ignorer (salutations, signature, mentions de plats…).
_LIGNES_PARASITES = (
    "bonjour", "bonsoir", "coucou", "salut", "merci", "a tres vite", "a bientot",
    "truck muche", "bon appetit", "regalez", "plats du jour", "menu",
    "lundi", "mardi", "mercredi", "jeudi", "vendredi",
)


def _strip_accents(s: str) -> str:
    s = s.replace("œ", "oe").replace("æ", "ae")
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def is_dessert_post(text: str) -> bool:
    """True si le texte ressemble à un post de desserts (mot « dessert » présent)."""
    if not text:
        return False
    return "dessert" in _strip_accents(text).lower()


def _nettoyer_ligne(ligne: str) -> str:
    """Retire puces, emojis de début, prix de fin et espaces superflus."""
    s = ligne.strip()
    # Puces de début : -, •, *, –, —, chiffres de liste
    s = re.sub(r"^[\-•\*–—\d\.\)\s]+", "", s)
    # Prix de fin : "3€", "2,50€", "— 3 €", "3.50 EUR"
    s = re.sub(r"[\s\-–—]*\d+([.,]\d{1,2})?\s*(€|eur|euros?)\.?\s*$", "", s, flags=re.IGNORECASE)
    # Emojis / symboles non-texte en bordure
    s = s.strip(" \t:·•-–—🍰😋🍫🍓🥧🥛🎂🍮🍪🧁✨🔥")
    return s.strip()


def parse_desserts_from_caption(text: str) -> list[str]:
    """Extrait la liste des noms de desserts d'un texte de post."""
    if not text:
        return []
    out: list[str] = []
    for ligne_brute in text.splitlines():
        ligne = _nettoyer_ligne(ligne_brute)
        if not ligne or len(ligne) < 3:
            continue
        bas = _strip_accents(ligne).lower()
        # Ignore l'en-tête « desserts … » et les lignes parasites.
        if bas.startswith("dessert") or any(p in bas for p in _LIGNES_PARASITES):
            continue
        # Une ligne qui ne contient aucune lettre est ignorée (emojis seuls).
        if not re.search(r"[a-zA-ZÀ-ÿ]", ligne):
            continue
        out.append(ligne)
    return out
