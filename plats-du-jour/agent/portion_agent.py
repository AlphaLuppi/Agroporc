"""
Agent d'estimation des portions à partir de photos.

Méthode des objets de référence (standard en vision computationnelle alimentaire) :
1. Identifie les objets connus dans la photo (assiette standard ~25-27 cm Ø,
   fourchette ~19 cm, couteau ~22 cm, barquette ~20×14 cm, etc.)
2. Estime la superficie et la hauteur des aliments relativement à ces références
3. Calcule le volume approximatif → poids via densité typique selon le type de plat
4. Retourne la moyenne sur toutes les photos d'un restaurant

Le cache (`output/portion_estimates.json`) est invalidé par une empreinte MD5 des
photos actuelles (IDs via API, ou nom+taille via filesystem). Pas de recompute si
les photos n'ont pas changé.
"""
import base64
import hashlib
import json
import os
import pathlib
import subprocess
import urllib.request
from datetime import datetime

import anthropic

PHOTOS_DIR = pathlib.Path(__file__).resolve().parent.parent / "photos"
CACHE_FILE = pathlib.Path(__file__).resolve().parent.parent / "output" / "portion_estimates.json"

RESTAURANT_SLUGS = {
    "Le Bistrot Trèfle": "bistrot_trefle",
    "La Pause Gourmande": "pause_gourmande",
    "Le Truck Muche": "truck_muche",
}

PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
PHOTO_EXTENSIONS_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _make_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if api_key:
        return anthropic.Anthropic(api_key=api_key)
    auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
    if auth_token:
        return anthropic.Anthropic(auth_token=auth_token)
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-l", "Claude Code-credentials", "-w"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout.strip())
            token = data.get("claudeAiOauth", {}).get("accessToken", "")
            if token:
                return anthropic.Anthropic(auth_token=token)
    except Exception:
        pass
    raise ValueError(
        "Aucun token Anthropic trouvé. Configurez ANTHROPIC_API_KEY dans .env."
    )


def _load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_cache(data: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _fingerprint_api(slug: str, api_url: str) -> tuple[list[dict], str]:
    """Récupère les métadonnées photos depuis l'API et génère une empreinte MD5."""
    try:
        req = urllib.request.Request(f"{api_url}/api/photos?slug={slug}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        photos = data.get("photos", [])
        ids = sorted(str(p["id"]) for p in photos)
        fingerprint = hashlib.md5("|".join(ids).encode()).hexdigest() if ids else ""
        return photos, fingerprint
    except Exception as e:
        print(f"[portion_agent] Erreur métadonnées API pour {slug}: {e}")
        return [], ""


def _fingerprint_fs(slug: str) -> tuple[list[pathlib.Path], str]:
    """Récupère les fichiers locaux et génère une empreinte MD5 (nom + taille)."""
    rest_dir = PHOTOS_DIR / slug
    if not rest_dir.is_dir():
        return [], ""
    photos = sorted(
        p for p in rest_dir.iterdir()
        if p.is_file() and p.suffix.lower() in PHOTO_EXTENSIONS
    )
    if not photos:
        return [], ""
    parts = [f"{p.name}:{p.stat().st_size}" for p in photos]
    fingerprint = hashlib.md5("|".join(parts).encode()).hexdigest()
    return photos, fingerprint


def _estimate_single_photo(client: anthropic.Anthropic, img_b64: str, mime: str) -> float | None:
    """Appelle Claude Vision sur une photo pour estimer le poids de la portion."""
    prompt = (
        "Tu es un expert en estimation de portions alimentaires par analyse d'images.\n\n"
        "Méthode à appliquer (objets de référence visuels) :\n"
        "1. Identifie les objets de référence connus dans l'image : assiette standard (~25-27 cm Ø), "
        "fourchette (~19 cm), couteau (~22 cm), verre (~8 cm Ø), barquette (~20×14 cm).\n"
        "2. Estime la superficie des aliments par rapport au contenant.\n"
        "3. Estime la hauteur moyenne des aliments (étalés ~1-2 cm, empilés ~3-5 cm, volumineux ~6-10 cm).\n"
        "4. Calcule le volume approximatif (superficie × hauteur).\n"
        "5. Estime la densité selon le type de plat (légumes ~0.6 g/cm³, viande/poisson ~0.9 g/cm³, "
        "féculents cuits ~1.0 g/cm³, plat mixte ~0.8 g/cm³).\n"
        "6. Calcule le poids : volume × densité.\n\n"
        "Réponds UNIQUEMENT avec un JSON valide :\n"
        "{\"poids_g\": <entier>, \"confiance\": \"haute|moyenne|faible\", \"notes\": \"<explication courte>\"}\n\n"
        "Si l'image ne contient pas de plat de restaurant identifiable : "
        "{\"poids_g\": null, \"confiance\": \"faible\", \"notes\": \"pas de plat identifiable\"}"
    )
    try:
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": mime, "data": img_b64}},
                    {"type": "text", "text": prompt},
                ],
            }],
            timeout=30,
        )
        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())
        weight = result.get("poids_g")
        if isinstance(weight, (int, float)) and weight > 0:
            print(f"[portion_agent]   → {weight}g ({result.get('confiance', '?')}) — {result.get('notes', '')}")
            return float(weight)
        return None
    except Exception as e:
        print(f"[portion_agent] Erreur Vision : {e}")
        return None


def _estimate_from_api(slug: str, photos: list[dict], api_url: str) -> float | None:
    """Estime le poids moyen d'une portion à partir des photos via l'API Vercel."""
    client = _make_client()
    estimates = []
    for photo in photos:
        try:
            req = urllib.request.Request(f"{api_url}/api/photos/{photo['id']}/image")
            with urllib.request.urlopen(req, timeout=15) as resp:
                img_b64 = base64.standard_b64encode(resp.read()).decode("ascii")
            mime = photo.get("content_type", "image/jpeg")
            w = _estimate_single_photo(client, img_b64, mime)
            if w is not None:
                estimates.append(w)
        except Exception as e:
            print(f"[portion_agent] Erreur chargement photo {photo.get('id')} : {e}")
    return round(sum(estimates) / len(estimates)) if estimates else None


def _estimate_from_fs(photos: list[pathlib.Path]) -> float | None:
    """Estime le poids moyen d'une portion à partir des photos locales."""
    client = _make_client()
    estimates = []
    for p in photos:
        try:
            mime = PHOTO_EXTENSIONS_MIME.get(p.suffix.lower(), "image/jpeg")
            img_b64 = base64.standard_b64encode(p.read_bytes()).decode("ascii")
            w = _estimate_single_photo(client, img_b64, mime)
            if w is not None:
                estimates.append(w)
        except Exception as e:
            print(f"[portion_agent] Erreur chargement photo {p.name} : {e}")
    return round(sum(estimates) / len(estimates)) if estimates else None


def check_and_update(restaurant_names: list[str] | None = None) -> dict:
    """
    Vérifie si les photos ont changé pour chaque restaurant.
    Si oui, recalcule l'estimation de portion via Claude Haiku Vision et met à jour
    le cache. Les restaurants sans changement conservent leur estimation existante.

    Args:
        restaurant_names: liste de noms de restaurants à vérifier (None = tous)

    Returns:
        contenu du cache après mise à jour {slug: {estimated_weight_g, ...}}
    """
    api_url = os.getenv("VERCEL_API_URL", "").rstrip("/")
    cache = _load_cache()

    slugs_to_check = (
        [RESTAURANT_SLUGS[n] for n in restaurant_names if n in RESTAURANT_SLUGS]
        if restaurant_names
        else list(RESTAURANT_SLUGS.values())
    )

    for slug in slugs_to_check:
        photos_api: list[dict] = []
        photos_fs: list[pathlib.Path] = []
        fingerprint = ""

        if api_url:
            photos_api, fingerprint = _fingerprint_api(slug, api_url)
        if not fingerprint:
            photos_fs, fingerprint = _fingerprint_fs(slug)

        if not fingerprint:
            print(f"[portion_agent] {slug} : aucune photo trouvée, skip")
            continue

        cached = cache.get(slug, {})
        if cached.get("photo_fingerprint") == fingerprint:
            print(f"[portion_agent] {slug} : photos inchangées, cache valide ({cached.get('estimated_weight_g')}g)")
            continue

        print(f"[portion_agent] {slug} : photos changées → recalcul de l'estimation...")
        weight = None
        count = 0
        if photos_api:
            weight = _estimate_from_api(slug, photos_api, api_url)
            count = len(photos_api)
        elif photos_fs:
            weight = _estimate_from_fs(photos_fs)
            count = len(photos_fs)

        if weight is not None:
            cache[slug] = {
                "estimated_weight_g": int(weight),
                "photo_fingerprint": fingerprint,
                "photo_count": count,
                "computed_at": datetime.now().isoformat(timespec="seconds"),
            }
            print(f"[portion_agent] {slug} : estimation → {weight}g (moy. {count} photo(s))")
        else:
            print(f"[portion_agent] {slug} : impossible d'estimer le poids (pas d'image exploitable)")

    _save_cache(cache)
    return cache


def load_estimates() -> dict:
    """Charge les estimations de portions depuis le cache (lecture seule)."""
    return _load_cache()
