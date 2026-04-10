"""
Recherche de GIFs via l'API Giphy.

Nécessite la variable d'environnement GIPHY_API_KEY.
"""
import os
import urllib.request
import urllib.parse
import json


GIPHY_API_KEY = os.environ.get("GIPHY_API_KEY", "")
GIPHY_SEARCH_URL = "https://api.giphy.com/v1/gifs/search"


def search_gif(query: str, limit: int = 1, rating: str = "pg-13") -> str | None:
    """
    Recherche un GIF sur Giphy et retourne l'URL du premier résultat.

    Args:
        query: termes de recherche (ex: "excited food")
        limit: nombre de résultats max
        rating: filtre de contenu (g, pg, pg-13, r)

    Returns:
        URL du GIF (format downsized) ou None si pas de résultat/erreur
    """
    if not GIPHY_API_KEY:
        print("[gif_search] GIPHY_API_KEY non définie, GIF ignoré")
        return None

    # Forcer le style "meme" pour obtenir des GIFs plus drôles/expressifs.
    # On évite le doublon si la requête contient déjà le mot "meme".
    q = query.strip()
    if "meme" not in q.lower():
        q = f"{q} meme"

    params = urllib.parse.urlencode({
        "api_key": GIPHY_API_KEY,
        "q": q,
        "limit": limit,
        "rating": rating,
        "lang": "fr",
    })

    try:
        url = f"{GIPHY_SEARCH_URL}?{params}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        results = data.get("data", [])
        if not results:
            return None

        # Utiliser le format "downsized" pour un bon compromis taille/qualité
        images = results[0].get("images", {})
        downsized = images.get("downsized", {})
        return downsized.get("url") or images.get("original", {}).get("url")

    except Exception as e:
        print(f"[gif_search] Erreur recherche GIF '{query}': {e}")
        return None


def resolve_gif_queries(commentaires: list[dict]) -> list[dict]:
    """
    Parcourt les commentaires et résout les champs 'gif_query' en 'image_url'.

    Si un commentaire contient un champ 'gif_query', cherche le GIF correspondant
    et ajoute l'URL dans 'image_url'. Le champ 'gif_query' est ensuite supprimé.
    """
    for c in commentaires:
        gif_query = c.pop("gif_query", None)
        if gif_query:
            url = search_gif(gif_query)
            if url:
                c["image_url"] = url
    return commentaires
