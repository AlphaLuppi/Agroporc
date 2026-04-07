"""
Scraper pour La Pause Gourmande (Foxorders).
Le plat du jour apparaît en bas de la page catégorie PLATS CHAUD.
URL ciblée : /category-la-pause-gourmande-avignon-84000-24706-0.html
Nécessite une navigation préalable via le selectbox pour initialiser la session.
"""
import re
import asyncio
from playwright.async_api import async_playwright

SELECTBOX_URL = (
    "https://lapausegourmandeagroparc.foxorders.com"
    "/mb/index/selectbox?shortcut=1&deliveryId=2&restaurantId=2050"
)
CATEGORY_URL = (
    "https://lapausegourmandeagroparc.foxorders.com"
    "/category-la-pause-gourmande-avignon-84000-24706-0.html"
)
PRICE_RE = re.compile(r"(\d+[.,]\d+)\s*€")


async def scrape() -> dict | None:
    """
    Retourne un dict { "restaurant": str, "plat": str, "prix": str } ou None si échec.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            # Initialiser la session via selectbox
            await page.goto(SELECTBOX_URL, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(1500)

            # Naviguer vers la page catégorie PLATS CHAUD
            await page.goto(CATEGORY_URL, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)
        except Exception as e:
            print(f"[pause_gourmande] Erreur navigation : {e}")
            await browser.close()
            return None

        body = await page.inner_text("body")
        await browser.close()

    return _parse(body)


def _parse(body: str) -> dict | None:
    """Parse le texte de la page pour extraire le plat du jour."""
    # Le plat du jour est nommé "PLAT DU JOUR DU [JOUR] [DATE]"
    # et sa description est sur la ligne suivante
    lines = [l.strip() for l in body.splitlines() if l.strip()]

    for i, line in enumerate(lines):
        # "PLAT DU JOUR DU LUNDI..." = le produit réel (pas la catégorie de nav)
        if re.search(r"PLAT DU JOUR\s+DU\s+", line.upper()):
            # La description est sur la ligne suivante non vide
            description = ""
            prix = ""
            for j in range(i + 1, min(i + 6, len(lines))):
                candidate = lines[j]
                if not candidate:
                    continue
                price_match = PRICE_RE.search(candidate)
                if price_match and not description:
                    # C'est une ligne de prix sans description avant
                    prix = f"{price_match.group(1)}€"
                    break
                if not description and "AJOUTER" not in candidate.upper():
                    description = candidate
                if description and not prix:
                    price_match = PRICE_RE.search(candidate)
                    if price_match:
                        prix = f"{price_match.group(1)}€"
                        break

            if not description:
                description = "Plat du jour"

            return {
                "restaurant": "La Pause Gourmande",
                "plat": description,
                "prix": prix or "N/A",
            }

    return None
