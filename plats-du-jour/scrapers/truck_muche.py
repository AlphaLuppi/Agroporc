"""
Scraper pour Le Truck Muche.
Sources tentées dans l'ordre :
1. Facebook (OCR automatique dans alt, via Playwright sans login)
2. Instagram (@le_truckmuche_) — fallback via l'endpoint public web_profile_info
   qui renvoie les captions des derniers posts sans auth.

Stratégie cache :
- Le lundi : scrape et sauvegarde le menu de la semaine dans le cache
- Mardi-vendredi : lit directement depuis le cache
"""
import asyncio
import json
import re
from datetime import date, timedelta
from pathlib import Path
from playwright.async_api import async_playwright
import requests

PAGE_URL = "https://www.facebook.com/letruckmuche/"
INSTAGRAM_USERNAME = "le_truckmuche_"
INSTAGRAM_API_URL = (
    f"https://i.instagram.com/api/v1/users/web_profile_info/?username={INSTAGRAM_USERNAME}"
)
DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"]
MOIS_FR = {
    "JANVIER": 1, "FEVRIER": 2, "FÉVRIER": 2, "MARS": 3, "AVRIL": 4,
    "MAI": 5, "JUIN": 6, "JUILLET": 7, "AOUT": 8, "AOÛT": 8,
    "SEPTEMBRE": 9, "OCTOBRE": 10, "NOVEMBRE": 11, "DECEMBRE": 12, "DÉCEMBRE": 12,
}
CACHE_FILE = Path(__file__).parent.parent / "output" / "truck_muche_semaine.json"


# ── Cache ────────────────────────────────────────────────────────────────────

def _load_cache() -> dict | None:
    """Charge le cache si il correspond à la semaine en cours (lundi = date de référence)."""
    if not CACHE_FILE.exists():
        return None
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        # Le cache est valide si son lundi correspond au lundi de cette semaine
        today = date.today()
        lundi_semaine = today - timedelta(days=today.weekday())
        if data.get("lundi") == str(lundi_semaine):
            return data
    except Exception:
        pass
    return None


def _save_cache(menu_semaine: dict[str, str]) -> None:
    """Sauvegarde le menu de la semaine avec le lundi comme clé de validité."""
    today = date.today()
    lundi_semaine = today - timedelta(days=today.weekday())
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps({"lundi": str(lundi_semaine), "menu": menu_semaine}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[truck_muche] Menu de la semaine mis en cache ({CACHE_FILE.name})")


# ── Scraping Facebook ────────────────────────────────────────────────────────

async def _scrape_facebook() -> str | None:
    """Lance Playwright et retourne le texte OCR de l'image du menu hebdomadaire."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--window-size=1280,900"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="fr-FR",
            viewport={"width": 1280, "height": 900},
        )
        page = await context.new_page()

        try:
            await page.goto(PAGE_URL, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)
        except Exception as e:
            print(f"[truck_muche] Erreur navigation : {e}")
            await browser.close()
            return None

        # Fermer les popups via JS (le bouton "Fermer" est un DIV, pas un <button>)
        await page.evaluate("""async () => {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            for (const el of document.querySelectorAll('button, [role=button]')) {
                const t = el.innerText || '';
                if (t.includes('Autoriser') && t.includes('cookies')) {
                    el.click();
                    await delay(1000);
                    break;
                }
            }
            for (const el of document.querySelectorAll('[aria-label="Fermer"], [aria-label="Close"]')) {
                el.click();
                await delay(500);
            }
        }""")
        await page.wait_for_timeout(1500)

        # Scroller lentement pour déclencher le lazy-loading et l'OCR Facebook
        menu_text = await page.evaluate("""async () => {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            for (let pos = 0; pos <= 6000; pos += 400) {
                window.scrollTo(0, pos);
                await delay(800);
                for (const img of document.querySelectorAll('img[alt]')) {
                    const alt = img.alt || '';
                    if (alt.toUpperCase().includes('PLATS DU JOUR') ||
                        (alt.toUpperCase().includes('LUNDI') && alt.toUpperCase().includes('MARDI'))) {
                        return alt;
                    }
                }
            }
            return null;
        }""")

        await browser.close()
        return menu_text


# ── Scraping Instagram (fallback, sans auth) ─────────────────────────────────

def _scrape_instagram_sync() -> str | None:
    """
    Interroge l'endpoint public web_profile_info et retourne le premier post
    récent dont la caption/alt contient des indices de menu hebdo. La validation
    de la date de semaine est faite plus loin par _menu_est_semaine_courante.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 "
            "Mobile/15E148 Safari/604.1"
        ),
        "x-ig-app-id": "936619743392459",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    }
    try:
        resp = requests.get(INSTAGRAM_API_URL, headers=headers, timeout=15)
    except requests.RequestException as e:
        print(f"[truck_muche] Erreur Instagram : {e}")
        return None

    if resp.status_code != 200:
        print(f"[truck_muche] Instagram HTTP {resp.status_code}")
        return None

    try:
        data = resp.json()
    except ValueError:
        print("[truck_muche] Instagram JSON invalide")
        return None

    user = (data.get("data") or {}).get("user")
    if not user:
        print("[truck_muche] Instagram : pas de user dans la réponse (profil introuvable ou rate-limited)")
        return None

    edges = (user.get("edge_owner_to_timeline_media") or {}).get("edges") or []
    if not edges:
        print("[truck_muche] Instagram : aucun post trouvé")
        return None

    blobs = []
    for e in edges[:6]:
        node = e.get("node") or {}
        caption_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
        caption = caption_edges[0].get("node", {}).get("text", "") if caption_edges else ""
        acc = node.get("accessibility_caption") or ""
        blob = (caption + "\n" + acc).strip()
        if blob:
            blobs.append(blob)

    for blob in blobs:
        upper = blob.upper()
        if "PLATS DU JOUR" in upper or ("LUNDI" in upper and "MARDI" in upper):
            return blob

    return blobs[0] if blobs else None


async def _scrape_instagram() -> str | None:
    """Wrapper async pour rester cohérent avec _scrape_facebook."""
    return await asyncio.to_thread(_scrape_instagram_sync)


# ── Orchestration : FB puis IG en fallback ───────────────────────────────────

async def _scrape_menu_semaine_raw() -> dict[str, str] | None:
    """
    Tente Facebook d'abord, puis Instagram en fallback. Retourne le dict
    parsé {"LUNDI": "plat", ...} ou None si aucune source n'a fourni un
    menu valide pour la semaine en cours.
    """
    for label, source in (("Facebook", _scrape_facebook), ("Instagram", _scrape_instagram)):
        print(f"[truck_muche] Tentative via {label}...")
        text = await source()
        if not text:
            print(f"[truck_muche] {label} : rien trouvé")
            continue
        if not _menu_est_semaine_courante(text):
            print(f"[truck_muche] {label} : menu hors semaine courante")
            continue
        menu = _parse_menu_semaine(text)
        if not menu:
            print(f"[truck_muche] {label} : parsing impossible")
            continue
        print(f"[truck_muche] {label} : menu récupéré ({len(menu)} jours)")
        return menu
    return None


# ── Validation de la date ────────────────────────────────────────────────────

def _menu_est_semaine_courante(text: str) -> bool:
    """
    Vérifie que la date inscrite sur le menu correspond à la semaine en cours.
    Cherche un pattern type "DU 20 AU 24 AVRIL" dans le texte OCR.
    """
    text_upper = text.upper()
    # Pattern : "DU <jour_debut> AU <jour_fin> <mois>"
    # Espaces optionnels pour tolérer l'OCR qui colle les mots ("DU20AU26AVRIL").
    match = re.search(r"DU\s*(\d{1,2})\s*AU\s*(\d{1,2})\s*([A-ZÀ-Ü]+)", text_upper)
    if not match:
        print("[truck_muche] Aucune date trouvée dans le menu, impossible de valider la semaine")
        return False

    jour_debut = int(match.group(1))
    mois_str = match.group(3)
    mois = MOIS_FR.get(mois_str)
    if not mois:
        print(f"[truck_muche] Mois non reconnu : {mois_str}")
        return False

    today = date.today()
    # Déduire l'année (si on est en janvier et le menu dit décembre, c'est l'année précédente)
    annee = today.year
    if today.month <= 2 and mois >= 11:
        annee -= 1
    elif today.month >= 11 and mois <= 2:
        annee += 1

    try:
        date_debut_menu = date(annee, mois, jour_debut)
    except ValueError:
        print(f"[truck_muche] Date invalide : {jour_debut}/{mois}/{annee}")
        return False

    lundi_semaine = today - timedelta(days=today.weekday())
    vendredi_semaine = lundi_semaine + timedelta(days=4)

    if lundi_semaine <= date_debut_menu <= vendredi_semaine:
        print(f"[truck_muche] Date du menu ({date_debut_menu}) correspond à la semaine en cours")
        return True
    else:
        print(f"[truck_muche] Date du menu ({date_debut_menu}) ne correspond PAS à la semaine en cours ({lundi_semaine} → {vendredi_semaine})")
        return False


# ── Parsing OCR ──────────────────────────────────────────────────────────────

def _parse_menu_semaine(text: str) -> dict[str, str]:
    """
    Parse le texte OCR complet et retourne un dict { "LUNDI": "plat", "MARDI": "plat", ... }
    """
    text_upper = text.upper()
    menu = {}

    for i, day in enumerate(DAY_NAMES[:5]):  # lundi → vendredi
        idx = text_upper.find(day)
        if idx == -1:
            continue

        after = text_upper[idx + len(day):]

        # Fin = prochain jour de la semaine
        next_idx = len(after)
        for other_day in DAY_NAMES:
            pos = after.find(other_day)
            if pos > 0:
                next_idx = min(next_idx, pos)

        plat_raw = after[:next_idx].strip()
        # Supprimer les caractères non-latin (parasites OCR) et la ponctuation excessive
        plat_raw = "".join(c for c in plat_raw if c.isascii() or c in "àâäéèêëîïôùûüçœæÀÂÄÉÈÊËÎÏÔÙÛÜÇŒÆ")
        plat_raw = " ".join(w for w in plat_raw.split() if not all(c in ".'`" for c in w))  # supprimer les tokens parasites (.....)
        plat = _deduplicate_ocr(plat_raw)
        if plat:
            menu[day] = plat

    return menu


def _deduplicate_ocr(text: str) -> str:
    """
    Facebook OCR duplique parfois les mots sous deux formes :
    - "PENNEBOLO PENNE BOLO"      → token collé AVANT les vrais mots
    - "POULET POULETBASQUAISE BASQUAISE" → token collé ENTRE les deux vrais mots
    """
    tokens = text.split()
    result = []
    i = 0
    while i < len(tokens):
        tok = tokens[i].upper()

        # Cas 1 : token collé entre prev et next ("POULET POULETBASQUAISE BASQUAISE")
        if (result and i + 1 < len(tokens) and len(tok) > 4 and
                tok == (result[-1] + tokens[i + 1]).upper()):
            i += 1
            continue

        # Cas 2 : token collé avant les vrais mots ("PENNEBOLO PENNE BOLO")
        skip = False
        for length in range(2, min(5, len(tokens) - i)):
            combined = "".join(tokens[i + 1: i + 1 + length]).upper()
            if tok == combined and len(tok) > 4:
                skip = True
                break

        if not skip:
            result.append(tokens[i])
        i += 1
    return " ".join(result).strip()


# ── Point d'entrée ───────────────────────────────────────────────────────────

async def scrape_semaine() -> dict[str, dict] | None:
    """
    Retourne un dict { "LUNDI": {"plat": str, "prix": str}, ... } pour toute la semaine.
    Scrape (FB puis IG en fallback) si pas de cache, sinon lit le cache.
    """
    cache = _load_cache()

    if cache is None:
        menu_semaine = await _scrape_menu_semaine_raw()
        if not menu_semaine:
            print("[truck_muche] Aucune source n'a fourni le menu → fermé cette semaine")
            return None
        _save_cache(menu_semaine)
    else:
        print("[truck_muche] Menu chargé depuis le cache")
        menu_semaine = cache["menu"]

    semaine = {}
    for day, plat_raw in menu_semaine.items():
        options = [p.strip() for p in plat_raw.split(" OU ") if p.strip()]
        semaine[day] = {
            "plat": " ou ".join(options) if len(options) > 1 else options[0],
            "prix": "11.50€",
        }

    print(f"[truck_muche] {len(semaine)}/5 jours récupérés pour la semaine")
    return semaine


async def scrape() -> dict | None:
    """
    Retourne un dict { "restaurant": str, "plat": str, "prix": str } ou None si échec.
    Le lundi (ou si le cache est absent) : scrape FB → IG en fallback et met en cache.
    Mardi-vendredi avec cache valide : lit depuis le cache, pas de scraping.
    """
    today = date.today()
    today_name = DAY_NAMES[today.weekday()]

    cache = _load_cache()

    if cache is None and today.weekday() != 0:
        print("[truck_muche] Cache absent en dehors du lundi → scraping en fallback")

    if cache is None:
        menu_semaine = await _scrape_menu_semaine_raw()
        if not menu_semaine:
            print("[truck_muche] Aucune source n'a fourni le menu → fermé cette semaine")
            return None
        _save_cache(menu_semaine)
        cache = {"menu": menu_semaine}
    else:
        print("[truck_muche] Menu chargé depuis le cache (pas de scraping)")

    plat = cache["menu"].get(today_name)
    if not plat:
        print(f"[truck_muche] Pas de plat trouvé pour {today_name} dans le cache")
        return None

    # Séparer les options si plusieurs plats du jour ("POULET BASQUAISE OU FILET MIGNON")
    options = [p.strip() for p in plat.split(" OU ") if p.strip()]

    return {
        "restaurant": "Le Truck Muche",
        "plat": options if len(options) > 1 else options[0],
        "prix": "11.50€",
    }
