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
import io
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


# ── Carte saisonnière (PDF) ──────────────────────────────────────────────────
# Le lien court redirige (301) vers un PDF Wix dont l'URL change à chaque saison :
# toujours passer par le lien court. Mise en page sur deux colonnes → le texte extrait
# est désordonné, c'est agent.carte_agent.structurer_carte (appelé par main quand le
# hash change) qui le remet en sections. Ici : texte brut + hash uniquement.

CARTE_URL = "https://link.dubble-food.com/Carte-Avignon-Agroparc"
CARTE_MIN_CHARS = 500


def _fetch_pdf() -> bytes | None:
    try:
        r = requests.get(CARTE_URL, headers={**HEADERS, "Accept": "application/pdf,*/*"},
                         timeout=30, allow_redirects=True)
        r.raise_for_status()
        ctype = r.headers.get("Content-Type", "")
        if "pdf" not in ctype.lower() and not r.content.startswith(b"%PDF"):
            print(f"[dubble] Carte : contenu inattendu ({ctype or 'sans Content-Type'})")
            return None
        return r.content
    except Exception as e:
        print(f"[dubble] Erreur téléchargement carte : {e}")
        return None


def _pdf_texte(data: bytes) -> str:
    """Texte de toutes les pages, une ligne par ligne du PDF (espaces réduits, vides retirées)."""
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    lignes = []
    for page in reader.pages:
        for l in (page.extract_text() or "").splitlines():
            l = " ".join(l.split())
            if l:
                lignes.append(l)
    return "\n".join(lignes)


def scrape_carte() -> dict | None:
    """Carte saisonnière → {"restaurant", "hash", "texte"} ou None (PDF KO, texte trop court)."""
    from agent.carte_agent import _texte_hash
    data = _fetch_pdf()
    if data is None:
        return None
    try:
        texte = _pdf_texte(data)
    except Exception as e:
        print(f"[dubble] PDF illisible : {e}")
        return None
    if len(texte) < CARTE_MIN_CHARS:
        print(f"[dubble] Texte de la carte trop court ({len(texte)} car.) → ignoré")
        return None
    return {"restaurant": RESTAURANT, "hash": _texte_hash(texte), "texte": texte}
