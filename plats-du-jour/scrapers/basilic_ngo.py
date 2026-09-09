"""
Scraper pour Basilic n'Go (775 route de l'Aérodrome) via l'API REST ObyPay,
même structure que le Bistrot Trèfle (pas de Playwright).

Lien public : https://go.obypay.com/api/cashless/hws/4o2y → outlet i-E4mhlAmXsn-1.
Section ciblée : « Plat » (id Nf8NZ3MTtZ) : « Plat du jour poisson » et
« Plat du jour viande 1 », chacun présent en double (menuMode "order" / null).

L'API ne porte AUCUNE date : garde-fou par cache output/basilic_ngo_dernier.json
{plats, depuis}. Si les plats sont identiques depuis ≥ STALE_JOURS_OUVRES jours
ouvrés, on considère la carte figée et on ne publie rien (None + warning).

Resto optionnel : None = pas de plat du jour (pas un échec de scrape).
"""
import hashlib
import html as html_lib
import json
import re
from datetime import date, timedelta
from pathlib import Path

import requests

RESTAURANT = "Basilic n'Go"
OUTLET_ID = "i-E4mhlAmXsn-1"
SECTION_ID = "Nf8NZ3MTtZ"  # section « Plat »
API_URL = f"https://order-api.obypay.com/api/cashless/outlets/{OUTLET_ID}?instance=null"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
CACHE_FILE = Path(__file__).parent.parent / "output" / "basilic_ngo_dernier.json"
STALE_JOURS_OUVRES = 3

_TAG_RE = re.compile(r"<[^>]+>")


def _fetch_outlet_data() -> dict | None:
    """Télécharge la réponse brute de l'API ObyPay (≈ 1,4 Mo) ou None si échec."""
    try:
        r = requests.get(API_URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[basilic_ngo] Erreur API : {e}")
        return None


def _strip_html(s: str) -> str:
    return " ".join(html_lib.unescape(_TAG_RE.sub(" ", s or "")).split())


def _normalize(s: str) -> str:
    return " ".join((s or "").split()).casefold()


def _extract_plats(data: dict) -> list[str]:
    """Plats de la section « Plat », description sans HTML, dédoublonnés
    (chaque produit existe en deux exemplaires), dans l'ordre de l'API.
    Sans description, on retombe sur le nom du produit."""
    products: list[dict] = []

    def rec(obj):
        if isinstance(obj, dict):
            section = obj.get("section")
            if (obj.get("name") and obj.get("price") is not None
                    and isinstance(section, dict) and section.get("id") == SECTION_ID):
                products.append(obj)
                return
            for v in obj.values():
                rec(v)
        elif isinstance(obj, list):
            for item in obj:
                rec(item)

    rec(data)
    plats, seen = [], set()
    for p in products:
        plat = _strip_html(p.get("description", "")) or " ".join(p["name"].split())
        key = _normalize(plat)
        if key in seen:
            continue
        seen.add(key)
        plats.append(plat)
    return plats


def _extract_prix(data: dict) -> str:
    """Prix du premier produit de la section, formaté « 9.40€ » (ou « N/A »)."""
    found: list[float] = []

    def rec(obj):
        if found:
            return
        if isinstance(obj, dict):
            section = obj.get("section")
            if (obj.get("price") is not None and isinstance(section, dict)
                    and section.get("id") == SECTION_ID):
                found.append(float(obj["price"]))
                return
            for v in obj.values():
                rec(v)
        elif isinstance(obj, list):
            for item in obj:
                rec(item)

    rec(data)
    return f"{found[0]:.2f}€" if found else "N/A"


def _jours_ouvres_depuis(depuis: date, today: date) -> int:
    """Nombre de jours ouvrés (lun–ven) dans l'intervalle ]depuis, today]."""
    n, d = 0, depuis
    while d < today:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def _load_cache() -> dict | None:
    if not CACHE_FILE.exists():
        return None
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_cache(plats: list[str], depuis: date) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps({"plats": plats, "depuis": str(depuis)}, ensure_ascii=False, indent=2),
                          encoding="utf-8")


def scrape(today: date | None = None) -> dict | None:
    """Retourne {"restaurant", "plat" (str ou liste d'options), "prix"} ou None
    (API KO, pas de plat, ou plats identiques depuis trop longtemps)."""
    today = today or date.today()
    data = _fetch_outlet_data()
    if data is None:
        return None

    plats = _extract_plats(data)
    if not plats:
        print("[basilic_ngo] Aucun plat du jour dans la section « Plat »")
        return None

    cache = _load_cache()
    if cache and cache.get("plats") == plats:
        try:
            depuis = date.fromisoformat(cache["depuis"])
        except Exception:
            depuis = today
    else:
        depuis = today
    _save_cache(plats, depuis)

    if _jours_ouvres_depuis(depuis, today) >= STALE_JOURS_OUVRES:
        print(f"[basilic_ngo] ⚠️ Plats identiques depuis le {depuis} (≥ {STALE_JOURS_OUVRES} jours ouvrés) "
              "→ carte probablement figée, rien publié")
        return None

    return {
        "restaurant": RESTAURANT,
        "plat": plats if len(plats) > 1 else plats[0],
        "prix": _extract_prix(data),
    }


# ── Carte permanente ─────────────────────────────────────────────────────────
# Même API : sections « Salade », « Sandwich », « Poke Bowl », « Dessert » (noms avec
# espace final côté API). Exclues : Plat (= plat du jour, déjà scrapé), Boisson,
# Livraison, Traiteur, Menus, Envie supplémentaire, Petit plaisir, Petite faim.

CARTE_SECTIONS = ["Salade", "Sandwich", "Poke Bowl", "Dessert"]
_CARTE_SECTION_SET = {_normalize(s) for s in CARTE_SECTIONS}


def _extract_carte(data: dict) -> list[dict]:
    """Sections de la carte (allowlist par nom de section), plats dédoublonnés par nom
    normalisé, prix > 0 uniquement ; ordre canonique CARTE_SECTIONS puis ordre de l'API."""
    by_section: dict[str, list[dict]] = {}

    def rec(obj):
        if isinstance(obj, dict):
            section = obj.get("section")
            if (obj.get("name") and obj.get("price") is not None
                    and isinstance(section, dict)
                    and _normalize(section.get("name")) in _CARTE_SECTION_SET):
                by_section.setdefault(_normalize(section.get("name")), []).append(obj)
                return
            for v in obj.values():
                rec(v)
        elif isinstance(obj, list):
            for item in obj:
                rec(item)

    rec(data)
    sections = []
    for nom in CARTE_SECTIONS:
        seen, plats = set(), []
        for p in by_section.get(_normalize(nom), []):
            name = " ".join(str(p["name"]).split())
            try:
                prix = float(p["price"])
            except (TypeError, ValueError):
                continue
            key = _normalize(name)
            if prix <= 0 or key in seen:
                continue
            seen.add(key)
            plats.append({"plat": name, "prix": f"{prix:.2f}€"})
        if plats:
            sections.append({"nom": nom.upper(), "plats": plats})
    return sections


def _carte_hash(sections: list[dict]) -> str:
    """SHA-1 déterministe (insensible à l'ordre renvoyé par l'API)."""
    parts = sorted(f"{sec['nom']}|{_normalize(p['plat'])}|{p['prix']}"
                   for sec in sections for p in sec["plats"])
    return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()


def scrape_carte() -> dict | None:
    """Carte permanente → {"restaurant", "hash", "sections"} ou None (API KO / carte vide)."""
    data = _fetch_outlet_data()
    if data is None:
        return None
    sections = _extract_carte(data)
    if not sections:
        print("[basilic_ngo] Carte vide")
        return None
    return {"restaurant": RESTAURANT, "hash": _carte_hash(sections), "sections": sections}
