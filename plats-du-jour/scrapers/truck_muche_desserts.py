"""
Scrape la liste des desserts du jour (texte) sur le Facebook/Instagram du Truck Muche,
pour accumuler une base de probabilités côté front.

Les desserts sont publiés EN TEXTE dans un post (pas une image) → parsing heuristique.
"""
import asyncio
import re
import unicodedata

import requests
from playwright.async_api import async_playwright

PAGE_URL = "https://www.facebook.com/letruckmuche/"
INSTAGRAM_USERNAME = "le_truckmuche_"
INSTAGRAM_API_URL = (
    f"https://i.instagram.com/api/v1/users/web_profile_info/?username={INSTAGRAM_USERNAME}"
)

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


# ── Scraping (IO) ────────────────────────────────────────────────────────────

def _recent_instagram_captions(limit: int = 8) -> list[str]:
    """Renvoie les légendes des derniers posts Instagram (sans auth), plus récent d'abord."""
    headers = {
        "User-Agent": "Instagram 76.0.0.15.395 Android",
        "x-ig-app-id": "936619743392459",
    }
    try:
        resp = requests.get(INSTAGRAM_API_URL, headers=headers, timeout=20)
    except Exception as e:
        print(f"[truck_desserts] Erreur Instagram : {e}")
        return []
    if resp.status_code != 200:
        print(f"[truck_desserts] Instagram HTTP {resp.status_code}")
        return []
    try:
        data = resp.json()
    except ValueError:
        return []
    user = (data.get("data") or {}).get("user")
    if not user:
        return []
    edges = (user.get("edge_owner_to_timeline_media") or {}).get("edges") or []
    captions = []
    for e in edges[:limit]:
        node = e.get("node") or {}
        caption_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
        caption = caption_edges[0].get("node", {}).get("text", "") if caption_edges else ""
        if caption.strip():
            captions.append(caption.strip())
    return captions


async def _recent_facebook_posts(limit: int = 8) -> list[str]:
    """Renvoie le texte des posts récents de la page FB (best-effort, plus récent d'abord)."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--window-size=1280,900"])
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="fr-FR",
            viewport={"width": 1280, "height": 900},
        )
        page = await context.new_page()
        try:
            await page.goto(PAGE_URL, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)
        except Exception as e:
            print(f"[truck_desserts] Erreur navigation FB : {e}")
            await browser.close()
            return []
        await page.evaluate("""async () => {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            for (const el of document.querySelectorAll('[aria-label="Fermer"], [aria-label="Close"]')) {
                el.click(); await delay(300);
            }
        }""")
        await page.wait_for_timeout(1000)
        texts = await page.evaluate(f"""async () => {{
            const delay = ms => new Promise(r => setTimeout(r, ms));
            const found = [];
            for (let pos = 0; pos <= 6000; pos += 500) {{
                window.scrollTo(0, pos);
                await delay(700);
                const sels = ['[data-ad-comet-preview="message"]', '[data-ad-preview="message"]', 'div[dir="auto"]'];
                for (const sel of sels) {{
                    for (const el of document.querySelectorAll(sel)) {{
                        const t = (el.innerText || '').trim();
                        if (t.length > 15 && !found.includes(t)) found.push(t);
                    }}
                }}
                if (found.length >= {limit}) break;
            }}
            return found.slice(0, {limit});
        }}""")
        await browser.close()
        return texts or []


def scrape_desserts_du_jour() -> list[str] | None:
    """
    Cherche le post de desserts le plus récent (Instagram d'abord, FB ensuite) et
    en extrait la liste des noms. Renvoie None si aucun post de desserts trouvé.
    """
    # 1) Instagram (légendes fiables via l'API publique)
    for caption in _recent_instagram_captions():
        if is_dessert_post(caption):
            noms = parse_desserts_from_caption(caption)
            if noms:
                print(f"[truck_desserts] Instagram : {len(noms)} dessert(s)")
                return noms
    # 2) Facebook (best-effort sur le texte des posts)
    try:
        fb_posts = asyncio.run(_recent_facebook_posts())
    except Exception as e:
        print(f"[truck_desserts] Erreur FB : {e}")
        fb_posts = []
    for texte in fb_posts:
        if is_dessert_post(texte):
            noms = parse_desserts_from_caption(texte)
            if noms:
                print(f"[truck_desserts] Facebook : {len(noms)} dessert(s)")
                return noms
    print("[truck_desserts] Aucun post de desserts trouvé")
    return None
