"""
Recherche de GIFs via Giphy + Tenor en parallèle.

Les deux providers sont interrogés simultanément ; les résultats sont fusionnés
dans un pool commun, puis on choisit un GIF encore jamais utilisé dans la
semaine. Cela maximise la variété et réduit le risque de 0 résultat quand un
provider est pauvre sur un sujet donné.

Env vars :
  - GIPHY_API_KEY  (optionnel, provider Giphy)
  - TENOR_API_KEY  (optionnel, provider Tenor v2)
  - TENOR_CLIENT_KEY (optionnel, identifiant d'app Tenor — recommandé)
"""
import os
import random
import re
import urllib.request
import urllib.parse
import json
from concurrent.futures import ThreadPoolExecutor


GIPHY_API_KEY = os.environ.get("GIPHY_API_KEY", "")
GIPHY_SEARCH_URL = "https://api.giphy.com/v1/gifs/search"

TENOR_API_KEY = os.environ.get("TENOR_API_KEY", "")
TENOR_CLIENT_KEY = os.environ.get("TENOR_CLIENT_KEY", "plats-du-jour")
TENOR_SEARCH_URL = "https://tenor.googleapis.com/v2/search"

# Ensemble des GIFs déjà utilisés dans la semaine (partagé entre les appels
# au sein d'un même process). Permet d'éviter de réutiliser un même GIF
# plusieurs fois dans la même pipeline hebdomadaire.
_used_gif_ids: set[str] = set()
_used_gif_urls: set[str] = set()


def reset_used_gifs() -> None:
    """Réinitialise la mémoire des GIFs utilisés."""
    _used_gif_ids.clear()
    _used_gif_urls.clear()


def register_used_url(url: str) -> None:
    """Marque une URL de GIF comme déjà utilisée cette semaine."""
    if url:
        _used_gif_urls.add(url)


def _http_get_json(url: str, timeout: int = 10) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[gif_search] HTTP error {url[:80]}… : {e}")
        return None


def _giphy_search(query: str, limit: int, rating: str) -> list[dict]:
    if not GIPHY_API_KEY:
        return []
    params = urllib.parse.urlencode({
        "api_key": GIPHY_API_KEY,
        "q": query,
        "limit": limit,
        "rating": rating,
        "lang": "fr",
    })
    data = _http_get_json(f"{GIPHY_SEARCH_URL}?{params}")
    if not data:
        return []
    results = []
    for item in data.get("data", []):
        images = item.get("images", {})
        url = (images.get("downsized", {}).get("url")
               or images.get("original", {}).get("url"))
        if url:
            results.append({
                "id": f"giphy:{item.get('id', '')}",
                "url": url,
                "provider": "giphy",
            })
    return results


# Tenor content filter mapping : on prend "medium" pour rester ~pg-13.
_TENOR_FILTER = {"pg-13": "medium", "pg": "low", "g": "high", "r": "off"}


def _tenor_search(query: str, limit: int, rating: str) -> list[dict]:
    if not TENOR_API_KEY:
        return []
    params = urllib.parse.urlencode({
        "q": query,
        "key": TENOR_API_KEY,
        "client_key": TENOR_CLIENT_KEY,
        "limit": limit,
        "locale": "fr_FR",
        "media_filter": "gif,tinygif",
        "contentfilter": _TENOR_FILTER.get(rating, "medium"),
    })
    data = _http_get_json(f"{TENOR_SEARCH_URL}?{params}")
    if not data:
        return []
    results = []
    for item in data.get("results", []):
        formats = item.get("media_formats", {})
        # On prend le GIF compact si dispo, sinon le GIF complet.
        url = (formats.get("tinygif", {}).get("url")
               or formats.get("gif", {}).get("url"))
        if url:
            results.append({
                "id": f"tenor:{item.get('id', '')}",
                "url": url,
                "provider": "tenor",
            })
    return results


def search_gif(query: str, limit: int = 25, rating: str = "pg-13") -> str | None:
    """
    Recherche un GIF chez Giphy et Tenor en parallèle, renvoie une URL variée.

    Les deux providers sont interrogés simultanément ; on combine les résultats,
    on écarte ceux déjà utilisés cette semaine, puis on choisit aléatoirement.
    """
    if not GIPHY_API_KEY and not TENOR_API_KEY:
        print("[gif_search] Aucune clé API configurée (GIPHY_API_KEY / TENOR_API_KEY), GIF ignoré")
        return None

    # Forcer "meme" pour des GIFs expressifs.
    q = query.strip()
    if "meme" not in q.lower():
        q = f"{q} meme"

    with ThreadPoolExecutor(max_workers=2) as ex:
        fut_giphy = ex.submit(_giphy_search, q, limit, rating)
        fut_tenor = ex.submit(_tenor_search, q, limit, rating)
        results = fut_giphy.result() + fut_tenor.result()

    if not results:
        return None

    fresh = [
        r for r in results
        if r["id"] not in _used_gif_ids and r["url"] not in _used_gif_urls
    ]
    chosen = random.choice(fresh) if fresh else random.choice(results)
    _used_gif_ids.add(chosen["id"])
    _used_gif_urls.add(chosen["url"])
    return chosen["url"]


_DIRECT_IMG_RE = re.compile(r"\.(gif|png|jpe?g|webp)(?:\?|$)", re.I)
_TENOR_VIEW_RE = re.compile(r"tenor\.com/(?:[a-z]{2}/)?view/[^/?#]*-\d+", re.I)
_TENOR_MEDIA_RE = re.compile(r"(?:media\d*\.)?tenor\.com/.+", re.I)


def _is_valid_image_url(url: str) -> bool:
    """Accepte images directes, pages Tenor, et CDN Tenor."""
    if not url:
        return False
    if _DIRECT_IMG_RE.search(url):
        return True
    if _TENOR_VIEW_RE.search(url):
        return True
    if _TENOR_MEDIA_RE.search(url):
        return True
    return False


def resolve_gif_queries(commentaires: list[dict]) -> list[dict]:
    """
    Parcourt les commentaires et résout les champs 'gif_query' en 'image_url'.
    Supprime tout 'image_url' hallucinée par le LLM (URL non valide).
    """
    for c in commentaires:
        gif_query = c.pop("gif_query", None)
        existing = c.get("image_url")
        if existing and not _is_valid_image_url(existing):
            c.pop("image_url", None)
        if gif_query and not c.get("image_url"):
            url = search_gif(gif_query)
            if url:
                c["image_url"] = url
    return commentaires
