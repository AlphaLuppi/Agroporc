"""
Scraper pour Dubble (1077 route de l'Aérodrome) — page Wix rendue côté serveur,
le HTML brut contient déjà le bloc « NOS RECETTES DU JOUR » (pas de Playwright).

Bloc : <h2>NOS RECETTES DU JOUR</h2>, <h2>date en français</h2> (« mercredi 9
septembre »), puis des paires <p>nom</p><p>description</p> : Hot Bowl, Hot Bowl
Vegé, Wrap Toasté, Focaccia Toastée, Soupe maison, Gâteaux… Un créneau absent a
une description commençant par « pas de … aujourd'hui ».

Règles : la date du <h2> doit être celle du jour, sinon None ; le plat du jour est
le Hot Bowl (classique et/ou végé → liste d'options) ; prix fixe 10,90 € (le
widget prix n'est pas rendu côté serveur). Resto optionnel : None = pas de plat.
"""
import html as html_lib
import re
import unicodedata
from datetime import date

import requests

RESTAURANT = "Dubble"
URL = "https://www.dubble-food.com/restaurants/avignon-agroparc"
PRIX_HOT_BOWL = "10.90€"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
           "Accept-Language": "fr-FR,fr;q=0.9"}
MOIS_FR = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout",
           "septembre", "octobre", "novembre", "decembre"]
TITRE_BLOC = "nos recettes du jour"

_BLOCK_TAG_RE = re.compile(r"</?(?:p|div|h[1-6]|li|ul|ol|br|section|article|header|footer|tr|td|th|table)\b[^>]*>", re.I)
_SCRIPT_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.S | re.I)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_TAG_RE = re.compile(r"<[^>]+>")


def _fetch_html() -> str | None:
    try:
        r = requests.get(URL, headers=HEADERS, timeout=30)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"[dubble] Erreur téléchargement : {e}")
        return None


def _fold(s: str) -> str:
    """Minuscules sans accents, espaces normalisés (comparaisons tolérantes)."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.casefold().split())


def _html_to_lines(html: str) -> list[str]:
    """Texte de la page, une ligne par élément bloc ; les balises inline (span, b…)
    sont retirées sans couper la ligne (« Hot Bowl <span>Vegé</span> » → 1 ligne)."""
    txt = _SCRIPT_RE.sub(" ", html)
    txt = _COMMENT_RE.sub(" ", txt)
    txt = _BLOCK_TAG_RE.sub("\n", txt)
    txt = _TAG_RE.sub("", txt)
    txt = html_lib.unescape(txt).replace("\xa0", " ")
    return [" ".join(l.split()) for l in txt.split("\n") if l.strip()]


def _date_correspond(line: str, today: date) -> bool:
    mois = MOIS_FR[today.month - 1]
    return re.search(rf"\b{today.day}(?:er)?\s+{mois}\b", _fold(line)) is not None


def _parse(lines: list[str], today: date) -> dict | None:
    """Parser pur : lignes de texte → plat du jour (ou None)."""
    try:
        start = next(i for i, l in enumerate(lines) if _fold(l) == TITRE_BLOC)
    except StopIteration:
        print("[dubble] Bloc « NOS RECETTES DU JOUR » introuvable")
        return None
    if start + 1 >= len(lines) or not _date_correspond(lines[start + 1], today):
        print(f"[dubble] Date du bloc ({lines[start + 1] if start + 1 < len(lines) else '?'}) ≠ aujourd'hui → ignoré")
        return None

    options = []
    i = start + 2
    while i < len(lines) - 1 and len(options) < 2:
        nom, desc = lines[i], lines[i + 1]
        if _fold(nom).startswith("hot bowl"):
            if not _fold(desc).startswith("pas de"):
                options.append(f"{nom} : {desc}")
            i += 2
            continue
        # Fin du bloc recettes (menu salad bowl, prix, widgets…)
        if re.search(r"\d+,\d{2}\s*€|chargement", _fold(nom)):
            break
        i += 1

    if not options:
        print("[dubble] Pas de hot bowl aujourd'hui")
        return None
    return {
        "restaurant": RESTAURANT,
        "plat": options if len(options) > 1 else options[0],
        "prix": PRIX_HOT_BOWL,
    }


def scrape(today: date | None = None) -> dict | None:
    """Retourne {"restaurant", "plat", "prix"} ou None (pas de hot bowl / page KO)."""
    html = _fetch_html()
    if html is None:
        return None
    return _parse(_html_to_lines(html), today or date.today())
