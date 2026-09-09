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
