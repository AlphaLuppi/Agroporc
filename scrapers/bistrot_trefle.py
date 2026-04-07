"""
Scraper pour Le Bistrot Trèfle via l'API REST Obypay (pas besoin de Playwright).
API publique : order-api.obypay.com
Section ciblée : "PLAT DU JOUR & FORMULE" (id: 8yMbeExQfQ)
"""
import json
import urllib.request
from datetime import date

OUTLET_ID = "i-eKnzdpaAY8-1"
SECTION_ID = "8yMbeExQfQ"  # PLAT DU JOUR & FORMULE
API_URL = f"https://order-api.obypay.com/api/cashless/outlets/{OUTLET_ID}?instance=null"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}

DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"]


def scrape() -> dict | None:
    """
    Retourne un dict { "restaurant": str, "plat": str, "prix": str } ou None si échec.
    """
    try:
        req = urllib.request.Request(API_URL, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"[bistrot_trefle] Erreur API : {e}")
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
    try:
        req = urllib.request.Request(API_URL, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"[bistrot_trefle] Erreur API : {e}")
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
