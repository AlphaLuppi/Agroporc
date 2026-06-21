"""
Scraper pour Le Bistrot Trèfle via l'API REST Obypay (pas besoin de Playwright).
API publique : order-api.obypay.com
Section ciblée : "PLAT DU JOUR & FORMULE" (id: 8yMbeExQfQ)
"""
import hashlib
import json
import urllib.request
from datetime import date

OUTLET_ID = "i-eKnzdpaAY8-1"
SECTION_ID = "8yMbeExQfQ"  # PLAT DU JOUR & FORMULE
API_URL = f"https://order-api.obypay.com/api/cashless/outlets/{OUTLET_ID}?instance=null"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}

DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"]


def _fetch_outlet_data() -> dict | None:
    """Télécharge la réponse brute de l'API Obypay (ou None si échec)."""
    try:
        req = urllib.request.Request(API_URL, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"[bistrot_trefle] Erreur API : {e}")
        return None


def scrape() -> dict | None:
    """
    Retourne un dict { "restaurant": str, "plat": str, "prix": str } ou None si échec.
    """
    data = _fetch_outlet_data()
    if data is None:
        return None

    today = DAY_NAMES[date.today().weekday()]
    products = _extract_products(data)

    # Chercher le plat du jour (sans formule dessert)
    for p in products:
        name = p.get("name", "")
        if today in name.upper() and "DESSERT" not in name.upper():
            description = p.get("description", "").strip()
            plat = description if description else name
            prix = p.get("price")
            return {
                "restaurant": "Le Bistrot Trèfle",
                "plat": plat,
                "prix": f"{prix}€" if prix else "N/A",
            }

    # Fallback : premier plat de la section si pas trouvé par jour
    for p in products:
        if "DESSERT" not in p.get("name", "").upper():
            description = p.get("description", "").strip()
            plat = description if description else p.get("name", "")
            prix = p.get("price")
            return {
                "restaurant": "Le Bistrot Trèfle",
                "plat": plat,
                "prix": f"{prix}€" if prix else "N/A",
            }

    print(f"[bistrot_trefle] Aucun plat trouvé pour {today}")
    return None


def scrape_semaine() -> dict[str, dict] | None:
    """
    Retourne un dict { "LUNDI": {"plat": str, "prix": str}, ... } pour toute la semaine.
    """
    data = _fetch_outlet_data()
    if data is None:
        return None

    products = _extract_products(data)
    semaine = {}

    for day in DAY_NAMES[:5]:
        for p in products:
            name = p.get("name", "")
            if day in name.upper() and "DESSERT" not in name.upper():
                description = p.get("description", "").strip()
                plat = description if description else name
                prix = p.get("price")
                semaine[day] = {
                    "plat": plat,
                    "prix": f"{prix}€" if prix else "N/A",
                }
                break

    if not semaine:
        print("[bistrot_trefle] Aucun plat trouvé pour la semaine")
        return None

    print(f"[bistrot_trefle] {len(semaine)}/5 jours récupérés pour la semaine")
    return semaine


def _extract_products(data: dict) -> list[dict]:
    """Extrait tous les produits de la section PLAT DU JOUR."""
    results = []
    _recurse(data, results)
    return results


def _recurse(obj, results: list):
    if isinstance(obj, dict):
        section = obj.get("section")
        if (obj.get("name") and obj.get("price") is not None
                and isinstance(section, dict) and section.get("id") == SECTION_ID):
            results.append(obj)
            return
        for v in obj.values():
            _recurse(v, results)
    elif isinstance(obj, list):
        for item in obj:
            _recurse(item, results)


# ── Carte permanente (à emporter) ────────────────────────────────────────────
#
# Obypay expose dans le même catalogue la carte « sur place » du resto ET l'offre
# à emporter. Seuls les produits rattachés à une collection (Salé/Sucré) sont
# réellement commandables à emporter ; ceux sans collection sont la carte sur place
# (ex. la section "PLATS", des desserts en double à prix sur-place). On filtre donc
# sur la présence d'une collection, en plus de l'allowlist de sections.

CARTE_SECTIONS = ["SALADES ET POKE BOWLS", "PÂTES", "POISSONS", "CLUBS SANDWICH", "DESSERTS"]


def _normalize(s: str) -> str:
    return " ".join((s or "").split()).upper()


_CARTE_SECTION_SET = {_normalize(s) for s in CARTE_SECTIONS}


def _has_collection(prod: dict) -> bool:
    """True si le produit est rattaché à une collection emporter (Salé/Sucré).

    Les produits sans collection ne sont pas commandables à emporter (carte sur place).
    """
    col = prod.get("collection")
    if isinstance(col, dict):
        return bool(col.get("id"))
    return bool(col)


def scrape_carte() -> dict | None:
    """
    Récupère la carte permanente (plats salés + desserts).
    Retourne { "restaurant": str, "hash": str, "sections": [ {nom, plats:[{plat,prix}]} ] }
    ou None si échec / carte vide.
    """
    data = _fetch_outlet_data()
    if data is None:
        return None

    by_section = _extract_carte_products(data)
    sections = []
    for nom in CARTE_SECTIONS:
        prods = by_section.get(nom)
        if not prods:
            continue
        seen = set()
        plats = []
        for p in prods:
            name = (p.get("name") or "").strip()
            key = _normalize(name)
            if not name or key in seen:
                continue
            seen.add(key)
            prix = p.get("price")
            plats.append({"plat": name, "prix": f"{prix}€" if prix is not None else "N/A"})
        if plats:
            sections.append({"nom": nom, "plats": plats})

    if not sections:
        print("[bistrot_trefle] Carte vide")
        return None

    return {
        "restaurant": "Le Bistrot Trèfle",
        "hash": _carte_hash(sections),
        "sections": sections,
    }


def _carte_hash(sections: list[dict]) -> str:
    """SHA-1 déterministe du contenu (insensible à l'ordre renvoyé par l'API)."""
    parts = [
        f"{sec['nom']}|{_normalize(p['plat'])}|{p['prix']}"
        for sec in sections for p in sec["plats"]
    ]
    parts.sort()
    return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()


def _extract_carte_products(data: dict) -> dict[str, list[dict]]:
    """Regroupe les produits par nom de section canonique (allowlist uniquement)."""
    results: dict[str, list[dict]] = {}

    def rec(obj):
        if isinstance(obj, dict):
            section = obj.get("section")
            if (obj.get("name") and obj.get("price") is not None
                    and isinstance(section, dict)
                    and _normalize(section.get("name")) in _CARTE_SECTION_SET
                    and _has_collection(obj)):
                results.setdefault(_normalize(section.get("name")), []).append(obj)
                # Les produits Obypay sont des feuilles : pas de produit imbriqué dans un produit
                return
            for v in obj.values():
                rec(v)
        elif isinstance(obj, list):
            for item in obj:
                rec(item)

    rec(data)
    return {nom: results[_normalize(nom)] for nom in CARTE_SECTIONS if _normalize(nom) in results}
