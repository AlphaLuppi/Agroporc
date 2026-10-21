"""
Rafraîchissement hebdomadaire des gifs fétiches des IA (cron du lundi 6h45, avant le run
semaine qui génère les commentaires). Logique pure dans `meme_fetiches.py`.

meme.com (accueil « Trending Now » + flux recent.xml) → casting LLM (4 memes par personnage,
aucun meme en double, ceux de la semaine passée exclus) → version animée sur Giphy, sinon
image meme.com, chaque URL vérifiée (200, image/*, taille) → PUT /api/ia (gifs ajoutés à la
main conservés). Best-effort : un personnage sans gif valide garde ses gifs actuels.
"""
import os
import time

import requests

import meme_fetiches as mf
from agent.image_agent import _appel_llm
from agent.recette_agent import extraire_json

MEMECOM = "https://meme.com"
GIPHY_URL = "https://api.giphy.com/v1/gifs/search"
UA = {"User-Agent": "plats-du-jour/1.0 (gifs fetiches)"}
TAILLE_MIN, TAILLE_MAX = 5_000, 8_000_000
TIMEOUT_LLM_S = 300
# /api/ia limite à 15 écritures/min par IP.
PAUSE_PUT_S = 4.5


def _get(url: str, **kw) -> requests.Response | None:
    try:
        r = requests.get(url, headers=UA, timeout=20, **kw)
        return r if r.status_code == 200 else None
    except requests.RequestException as e:
        print(f"[memes] GET {url[:80]} : {e}")
        return None


def catalogue() -> list[dict]:
    """Memes tendance (accueil, Open Graph lu pour chacun) puis récents (RSS), filtrés."""
    memes, vus = [], set()
    accueil = _get(MEMECOM + "/")
    for slug in mf.parser_tendances(accueil.text if accueil else "", maxi=80):
        page = _get(f"{MEMECOM}/memes/{slug}")
        og = mf.parser_og(page.text) if page else None
        if og and og["titre"] and slug not in vus:
            vus.add(slug)
            memes.append({"slug": slug, "fraicheur": "tendance", **og})
    rss = _get(MEMECOM + "/recent.xml")
    for m in mf.parser_rss(rss.text if rss else ""):
        if m["slug"] not in vus:
            vus.add(m["slug"])
            memes.append({"slug": m["slug"], "titre": m["titre"], "resume": m["resume"],
                          "image": "", "fraicheur": "recent"})
    return [m for m in memes if mf.acceptable(m["slug"], m["titre"], m["resume"])]


def url_valide(url: str) -> bool:
    try:
        r = requests.get(url, headers=UA, timeout=20, stream=True)
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
            return False
        taille = 0
        for bloc in r.iter_content(65536):
            taille += len(bloc)
            if taille > TAILLE_MAX:
                return False
        return taille >= TAILLE_MIN
    except requests.RequestException:
        return False


def _image_memecom(slug: str) -> str:
    page = _get(f"{MEMECOM}/memes/{slug}")
    return mf.parser_og(page.text)["image"] if page else ""


def resoudre(meme: dict, deja: set[str]) -> str | None:
    """URL (gif Giphy animé de préférence, sinon image meme.com) vérifiée, avec marqueur."""
    cle = os.getenv("GIPHY_API_KEY", "")
    if cle:
        r = _get(GIPHY_URL, params={"api_key": cle, "q": meme["requete_giphy"], "limit": 10,
                                    "rating": "pg-13", "lang": "en"})
        resultats = (r.json().get("data") or []) if r else []
        url = mf.choisir_giphy(resultats, meme["titre"], deja)
        if url and url_valide(url):
            return mf.url_auto(url, meme["slug"])
    image = meme.get("image") or _image_memecom(meme["slug"])
    if image and image not in deja and url_valide(image):
        return mf.url_auto(image, meme["slug"])
    return None


def _put_profil(api: str, nom: str, gifs: list[str]) -> bool:
    corps = {"nom": nom, "updated_by": "memes-cron", "profile": {"gifs_fetiches": gifs}}
    for essai in range(2):
        try:
            r = requests.put(f"{api}/api/ia", json=corps, timeout=30)
        except requests.RequestException as e:
            print(f"[memes] PUT {nom} : {e}")
            return False
        if r.status_code == 429 and essai == 0:
            time.sleep(61)
            continue
        if r.status_code != 200:
            print(f"[memes] PUT {nom} : HTTP {r.status_code} {r.text[:120]}")
        return r.status_code == 200
    return False


def rafraichir(dry_run: bool = False) -> int:
    """0 = au moins un profil mis à jour (ou dry-run abouti), 1 = rien fait."""
    api = os.getenv("VERCEL_API_URL", "").rstrip("/").replace("/api/update", "")
    if not api:
        print("[memes] VERCEL_API_URL manquant")
        return 1
    r = _get(f"{api}/api/ia")
    profils = (r.json().get("profiles") or []) if r else []
    if not profils:
        print("[memes] aucun profil IA lu")
        return 1

    memes = catalogue()
    exclus = {s for p in profils for u in p.get("gifs_fetiches") or [] if (s := mf.slug_auto(u))}
    print(f"[memes] {len(memes)} memes au catalogue, {len(exclus)} de la semaine passée exclus")
    if len(memes) - len(exclus) < len(profils) * mf.PAR_PERSONNAGE:
        exclus = set()  # catalogue trop maigre : mieux vaut un meme déjà vu que rien
    try:
        brut = _appel_llm(mf.prompt_casting(profils, memes, exclus), TIMEOUT_LLM_S)
    except Exception as e:
        print(f"[memes] casting LLM indisponible : {e}")
        return 1
    noms = [p["nom"] for p in profils]
    casting = mf.valider_casting(extraire_json(brut) or {}, memes, noms)

    deja: set[str] = set()
    maj = 0
    for p in profils:
        nouveaux = []
        for meme in casting.get(p["nom"], []):
            if len(nouveaux) == mf.PAR_PERSONNAGE:
                break
            url = resoudre(meme, deja)
            if url:
                deja.add(mf.sans_marqueur(url))
                nouveaux.append(url)
        if not nouveaux:
            print(f"[memes] {p['prenom']} : aucun gif valide, profil inchangé")
            continue
        gifs = mf.fusionner(p.get("gifs_fetiches") or [], nouveaux)
        print(f"[memes] {p['prenom']} : {len(nouveaux)} gifs ({', '.join(mf.slug_auto(u) for u in nouveaux)})")
        if dry_run:
            maj += 1
            continue
        if _put_profil(api, p["nom"], gifs):
            maj += 1
        time.sleep(PAUSE_PUT_S)
    print(f"[memes] {maj}/{len(profils)} profils {'simulés' if dry_run else 'mis à jour'}")
    return 0 if maj else 1
