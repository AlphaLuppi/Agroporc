"""
Scraper pour La Mijote (775 route de l'Aérodrome) — page HTML statique
https://la-mijote-avignon.fr/menu.html : un <div data-pgc-edit="plat_<jour>"> par
jour (lundi→vendredi), intitulé en <b>. Prix « Plat du jour 15 € ».

Le site n'est pas toujours tenu à jour (menu de novembre 2025 encore affiché en
septembre 2026). Garde-fou : HEAD + Last-Modified ; si la page n'a pas changé
depuis plus de MAX_AGE_JOURS jours, ou sans en-tête → None + warning, et le GET
n'est même pas fait. Resto optionnel : None = pas de plat.
"""
import html as html_lib
import re
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime

import requests

RESTAURANT = "La Mijote"
URL = "https://la-mijote-avignon.fr/menu.html"
PRIX = "15€"
MAX_AGE_JOURS = 10
HEADERS = {"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache", "Pragma": "no-cache"}
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"]

_TAG_RE = re.compile(r"<[^>]+>")

# Carte : les divs plat_<jour> ont un contenu simple (<b>…</b>, pas de div imbriqué —
# vérifié le 9 septembre 2026), on peut les retirer par regex non gourmande.
_PLAT_JOUR_RE = re.compile(r'<div[^>]*data-pgc-edit="plat_[a-z]+"[^>]*>.*?</div>', re.S)
_SCRIPT_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.S | re.I)
_BLOCK_TAG_RE = re.compile(r"</?(?:p|div|h[1-6]|li|ul|ol|br|tr|td|th|table|section|article)\b[^>]*>", re.I)
CARTE_MIN_CHARS = 200


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _last_modified() -> datetime | None:
    """Date Last-Modified de la page (HEAD), ou None si absente / erreur."""
    try:
        r = requests.head(URL, headers=HEADERS, timeout=15, allow_redirects=True)
        lm = r.headers.get("Last-Modified")
        return parsedate_to_datetime(lm) if lm else None
    except Exception as e:
        print(f"[la_mijote] Erreur HEAD : {e}")
        return None


def _est_frais(last_modified: datetime | None, now: datetime) -> bool:
    if last_modified is None:
        return False
    if last_modified.tzinfo is None:
        last_modified = last_modified.replace(tzinfo=timezone.utc)
    return (now - last_modified).days <= MAX_AGE_JOURS


def _fetch_html() -> str | None:
    try:
        r = requests.get(URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
        r.encoding = r.encoding or "utf-8"
        return r.text
    except Exception as e:
        print(f"[la_mijote] Erreur GET : {e}")
        return None


def _parse(html: str, weekday: int) -> str | None:
    """Parser pur : HTML + jour (0 = lundi) → intitulé du plat, ou None (week-end, absent)."""
    if not 0 <= weekday < len(JOURS):
        return None
    m = re.search(rf'data-pgc-edit="plat_{JOURS[weekday]}"[^>]*>(.*?)</div>', html, re.S)
    if not m:
        return None
    texte = " ".join(html_lib.unescape(_TAG_RE.sub(" ", m.group(1))).split())
    texte = re.sub(r"\s+([,.;:!?…)])", r"\1", texte).rstrip(" .")
    return texte or None


def scrape(today: date | None = None) -> dict | None:
    """Retourne {"restaurant", "plat", "prix"} ou None (week-end, page figée, plat absent)."""
    today = today or date.today()
    if today.weekday() >= 5:
        return None
    lm = _last_modified()
    if not _est_frais(lm, _now()):
        print(f"[la_mijote] ⚠️ Page figée (Last-Modified : {lm.date() if lm else 'absent'}, "
              f"> {MAX_AGE_JOURS} jours) → rien publié")
        return None
    html = _fetch_html()
    if html is None:
        return None
    plat = _parse(html, today.weekday())
    if not plat:
        print(f"[la_mijote] Pas de plat pour {JOURS[today.weekday()]}")
        return None
    return {"restaurant": RESTAURANT, "plat": plat, "prix": PRIX}


# ── Carte (entrées, carte des Mijoteurs, desserts) ───────────────────────────


def _texte_carte(html: str) -> str:
    """Texte visible de la page sans les plats du jour (pour que le hash ne bouge pas
    chaque semaine) ni scripts/styles ; une ligne par élément bloc, espaces réduits."""
    txt = _PLAT_JOUR_RE.sub(" ", html)
    txt = _SCRIPT_RE.sub(" ", txt)
    txt = _BLOCK_TAG_RE.sub("\n", txt)
    txt = html_lib.unescape(_TAG_RE.sub(" ", txt)).replace("\xa0", " ")
    lignes = [" ".join(l.split()) for l in txt.split("\n")]
    return "\n".join(l for l in lignes if l)


def scrape_carte() -> dict | None:
    """Carte → {"restaurant", "hash", "texte"} ou None. Pas de garde-fou Last-Modified :
    une carte est permanente, la date « notée le » suffit côté site."""
    from agent.carte_agent import _texte_hash
    html = _fetch_html()
    if html is None:
        return None
    texte = _texte_carte(html)
    if len(texte) < CARTE_MIN_CHARS:
        print(f"[la_mijote] Texte de la carte trop court ({len(texte)} car.) → ignoré")
        return None
    return {"restaurant": RESTAURANT, "hash": _texte_hash(texte), "texte": texte}
