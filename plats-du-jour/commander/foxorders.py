"""
Commander via Foxorders pour La Pause Gourmande (Playwright).
URL : https://lapausegourmandeagroparc.foxorders.com

Stratégie :
1. Naviguer vers selectbox pour init session
2. Se connecter avec les credentials
3. Aller sur la page des plats chauds
4. Trouver le "PLAT DU JOUR" et cliquer "Ajouter"
5. Aller au panier, sélectionner "payer sur place", valider

Variables d'environnement :
  FOXORDERS_EMAIL
  FOXORDERS_PASSWORD
"""

import asyncio
import os
from playwright.async_api import async_playwright, Page
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://lapausegourmandeagroparc.foxorders.com"
SELECTBOX_URL = f"{BASE_URL}/mb/index/selectbox?shortcut=1&deliveryId=2&restaurantId=2050"
CATEGORY_URL = f"{BASE_URL}/category-la-pause-gourmande-avignon-84000-24706-0.html"


async def _login(page: Page, email: str, password: str) -> bool:
    """Tente de se connecter si un formulaire de login est visible."""
    # Chercher un lien ou bouton de connexion
    login_selectors = [
        'a[href*="login"]',
        'a[href*="connexion"]',
        'button:has-text("Connexion")',
        'a:has-text("Connexion")',
    ]
    for sel in login_selectors:
        el = page.locator(sel).first
        if await el.count() > 0 and await el.is_visible():
            await el.click()
            await page.wait_for_timeout(1500)
            break

    # Remplir le formulaire
    email_input = page.locator('input[type="email"], input[name="email"], input[name="login"]').first
    if await email_input.count() == 0 or not await email_input.is_visible():
        return False

    await email_input.fill(email)
    pw_input = page.locator('input[type="password"]').first
    await pw_input.fill(password)
    await page.locator('button[type="submit"]').first.click()
    await page.wait_for_timeout(2000)
    return True


async def _add_plat_du_jour(page: Page, dish_name: str) -> bool:
    """Ajoute le plat du jour au panier. Retourne True si réussi."""
    # Le plat du jour est dans la catégorie PLATS CHAUD
    # Chercher une carte avec "PLAT DU JOUR" dans le texte
    plat_cards = page.locator('.product, .product-item, [class*="product"], article, .item')
    count = await plat_cards.count()

    for i in range(count):
        card = plat_cards.nth(i)
        text = (await card.inner_text()).upper()
        if "PLAT DU JOUR" in text or (dish_name and dish_name.upper() in text):
            # Chercher le bouton d'ajout
            add_btn = card.locator(
                'button:has-text("Ajouter"), button:has-text("Add"), '
                'button[class*="add"], button[class*="cart"], '
                '[onclick*="add"], [data-action*="add"]'
            ).first
            if await add_btn.count() > 0:
                await add_btn.click()
                await page.wait_for_timeout(1000)
                return True

    # Fallback : chercher globalement n'importe quel "Ajouter" visible
    add_btns = page.locator(
        'button:has-text("Ajouter"), button:has-text("Ajouter au panier")'
    )
    btn_count = await add_btns.count()
    if btn_count > 0:
        await add_btns.last.click()
        await page.wait_for_timeout(1000)
        return True

    return False


async def _checkout(page: Page) -> dict:
    """Navigue vers le panier et valide avec 'payer sur place'."""
    # Aller au panier
    cart_url = f"{BASE_URL}/cart"
    await page.goto(cart_url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(1500)

    if page.url == cart_url or "cart" in page.url:
        # Sélectionner "payer sur place" / "sur place"
        pay_options = page.locator(
            '[value="on_delivery"], [data-payment="on_delivery"], '
            'label:has-text("sur place"), label:has-text("payer plus tard"), '
            'input[value*="place"], input[value*="later"]'
        )
        if await pay_options.count() > 0:
            await pay_options.first.click()
            await page.wait_for_timeout(500)

        # Valider
        confirm = page.locator(
            'button[type="submit"]:has-text("Commander"), '
            'button[type="submit"]:has-text("Valider"), '
            'button:has-text("Passer la commande"), '
            'button[type="submit"]'
        ).first
        if await confirm.count() > 0:
            await confirm.click()
            await page.wait_for_timeout(3000)
            return {"ok": True, "message": "Commande validée"}

    return {"ok": False, "message": "Impossible de trouver le bouton de validation"}


async def commander(dish_name: str = "plat du jour", quantity: int = 1) -> dict:
    """Passe commande sur Foxorders via Playwright."""
    email = os.environ.get("FOXORDERS_EMAIL")
    password = os.environ.get("FOXORDERS_PASSWORD")
    if not email or not password:
        raise ValueError("FOXORDERS_EMAIL et FOXORDERS_PASSWORD requis dans l'environnement")

    print(f"[foxorders] Lancement Playwright...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="fr-FR",
        )
        page = await context.new_page()

        # Intercepter les calls réseau (pour debugging / reverse engineering)
        intercepted = []
        page.on("request", lambda req: intercepted.append({
            "method": req.method,
            "url": req.url,
        }) if req.resource_type in ("xhr", "fetch") else None)

        try:
            # 1. Init session
            print("[foxorders] Init session selectbox...")
            await page.goto(SELECTBOX_URL, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)

            # 2. Login
            print(f"[foxorders] Connexion ({email})...")
            logged_in = await _login(page, email, password)
            if not logged_in:
                print("[foxorders] Formulaire de login non trouvé — peut-être déjà connecté")

            # 3. Naviguer vers les plats
            print("[foxorders] Navigation vers PLATS CHAUD...")
            await page.goto(CATEGORY_URL, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)

            # 4. Ajouter le plat
            print(f"[foxorders] Ajout de '{dish_name}'...")
            added = await _add_plat_du_jour(page, dish_name)
            if not added:
                await browser.close()
                return {
                    "ok": False,
                    "restaurant": "La Pause Gourmande",
                    "error": f"Plat '{dish_name}' introuvable sur la page",
                }

            # 5. Checkout
            print("[foxorders] Validation de la commande...")
            result = await _checkout(page)
            result["restaurant"] = "La Pause Gourmande"
            result["plat"] = dish_name

            # Log des appels API interceptés (utile pour reverse engineering)
            api_calls = [c for c in intercepted if "api" in c["url"] or "order" in c["url"]]
            if api_calls:
                print(f"[foxorders] Appels API interceptés : {api_calls}")

        except Exception as e:
            await browser.close()
            return {"ok": False, "restaurant": "La Pause Gourmande", "error": str(e)}

        await browser.close()
        return result


if __name__ == "__main__":
    import sys
    plat = sys.argv[1] if len(sys.argv) > 1 else "plat du jour"
    qty = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    print(asyncio.run(commander(plat, qty)))
