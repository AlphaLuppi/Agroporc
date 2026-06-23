"""
Scrape la liste des desserts du jour sur l'Instagram du Truck Muche, pour accumuler
une base de probabilités côté front.

Format réel d'un post quotidien (vers 11h-midi) :
    <plat du jour>
    <ligne vide>
    <dessert 1>
    <dessert 2>
    ...
Les desserts ne sont PAS précédés du mot « dessert » → on prend toutes les lignes
sauf la première (le plat). On ne retient que le post DU JOUR (via le timestamp).
"""
import re
import unicodedata
from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests

# Fuseau de référence : les posts (et le cron) sont calés sur l'heure de Paris.
# On le force explicitement pour rester indépendant du fuseau du conteneur (souvent UTC).
PARIS = ZoneInfo("Europe/Paris")

INSTAGRAM_USERNAME = "le_truckmuche_"
INSTAGRAM_API_URL = (
    f"https://i.instagram.com/api/v1/users/web_profile_info/?username={INSTAGRAM_USERNAME}"
)

# Lignes parasites à ignorer (salutations, signature, mentions de plats…).
_LIGNES_PARASITES = (
    "bonjour", "bonsoir", "coucou", "salut", "merci", "a tres vite", "a bientot",
    "truck muche", "bon appetit", "regalez", "plats du jour", "menu",
    "pour la semaine",
)


def _strip_accents(s: str) -> str:
    s = s.replace("œ", "oe").replace("æ", "ae")
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def _nettoyer_ligne(ligne: str) -> str:
    """Retire puces, emojis de début, prix de fin et espaces superflus."""
    s = ligne.strip()
    s = re.sub(r"^[\-•\*–—\d\.\)\s]+", "", s)
    s = re.sub(r"[\s\-–—]*\d+([.,]\d{1,2})?\s*(€|eur|euros?)\.?\s*$", "", s, flags=re.IGNORECASE)
    s = s.strip(" \t:·•-–—🍰😋🍫🍓🥧🥛🎂🍮🍪🧁✨🔥")
    return s.strip()


def parse_desserts_from_menu_post(text: str) -> list[str]:
    """
    Extrait les desserts d'un post quotidien. La 1re ligne (plat du jour) est ignorée ;
    les lignes suivantes sont les desserts. Renvoie [] si le texte n'a pas la forme
    d'un post menu (moins de 2 lignes utiles).
    """
    if not text:
        return []
    lignes = []
    for brute in text.splitlines():
        l = _nettoyer_ligne(brute)
        if l and re.search(r"[a-zA-ZÀ-ÿ]", l):
            lignes.append(l)
    if len(lignes) < 2:
        return []
    desserts = []
    for l in lignes[1:]:  # on saute le plat du jour
        bas = _strip_accents(l).lower()
        if any(p in bas for p in _LIGNES_PARASITES):
            continue
        desserts.append(l)
    return desserts


# ── Scraping (IO) ────────────────────────────────────────────────────────────

def _instagram_posts_with_dates(limit: int = 12) -> list[tuple[date, str]]:
    """Renvoie [(date_du_post, légende), …] des derniers posts IG, plus récent d'abord."""
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
    out: list[tuple[date, str]] = []
    for e in edges[:limit]:
        node = e.get("node") or {}
        ts = node.get("taken_at_timestamp")
        if not ts:
            continue
        post_date = datetime.fromtimestamp(ts, PARIS).date()
        caption_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
        caption = caption_edges[0].get("node", {}).get("text", "") if caption_edges else ""
        if caption.strip():
            out.append((post_date, caption.strip()))
    return out


def scrape_desserts_du_jour(today: date | None = None) -> list[str] | None:
    """
    Récupère les desserts du post Instagram DU JOUR. Renvoie None si le Truck n'a pas
    posté aujourd'hui (ou si aucun dessert n'a pu être extrait).
    """
    jour = today or datetime.now(PARIS).date()
    for post_date, caption in _instagram_posts_with_dates():
        if post_date == jour:
            noms = parse_desserts_from_menu_post(caption)
            if noms:
                print(f"[truck_desserts] Post du {jour} : {len(noms)} dessert(s)")
                return noms
            print(f"[truck_desserts] Post du {jour} trouvé mais aucun dessert extrait")
            return None
    print(f"[truck_desserts] Pas de post Instagram pour le {jour}")
    return None
