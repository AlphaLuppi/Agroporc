"""
Scraper pour Le Truck Muche.

Le menu de la semaine n'est publié que sous forme d'IMAGE (post Facebook du dimanche soir
ou du lundi matin). Sources tentées dans l'ordre :
1. Facebook, rendu serveur servi à Googlebot (aucun login) : on parse les posts de la page,
   on retient l'image du menu hebdo (portrait ou alt « texte »), on la télécharge via le
   crawler média de Facebook et un LLM vision la transcrit. Depuis une IP datacenter le
   rendu Googlebot répond par intermittence 302 → /login : quelques essais espacés.
2. Instagram (@le_truckmuche_) — dernier recours bon marché (endpoint public
   web_profile_info, 1-2 essais ; presque toujours 429/401 depuis le VPS).

Le menu hebdo couvre toute la semaine, donc il est mis en cache quel que soit le jour.
Stratégie cache :
- Cache absent (lundi, ou rattrapage les autres jours) : balayage des sources + sauvegarde
- Cache valide : lecture directe, aucun scraping
"""
import asyncio
import io
import json
import random
import re
import time
from datetime import date, datetime, time as heure, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

PAGE_URL = "https://www.facebook.com/letruckmuche/"
MEDIA_URL = "https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id={media_id}"
# Facebook sert son rendu SSR complet (posts, légendes, media_id) à Googlebot sans login.
GOOGLEBOT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Accept-Language": "fr-FR,fr;q=0.9",
}
PARIS = ZoneInfo("Europe/Paris")
# Avatar de la page : présent dans chaque post, jamais le menu.
AVATAR_MEDIA_ID = "100063611949283"

# Rendu Googlebot : ~1,5 Mo, 302 → /login par intermittence depuis une IP datacenter.
FB_MAX_ATTEMPTS = 8
FB_PAUSE_MIN_S, FB_PAUSE_MAX_S = 10, 20
FB_BUDGET_S = 180
FB_TIMEOUT_S = 30
MEDIA_MAX_ATTEMPTS = 3
MEDIA_PAUSE_S = 5
# Candidats transcrits au plus (alt « texte » d'abord, puis portraits, du plus récent au plus
# ancien) : un appel LLM chacun.
MAX_CANDIDATS = 4
VISION_TIMEOUT_S = 90
VISION_RESTE_MIN_S = 20  # sous ce reste de budget, on ne lance plus d'appel LLM
# Budget global d'un balayage (page Facebook + images + LLM + Instagram) et mémoire d'un échec :
# scrape_semaine() puis scrape() dans le même run ne refont pas deux balayages complets.
SWEEP_BUDGET_S = 330
INSTAGRAM_RESTE_MIN_S = 45
ECHEC_TTL_S = 900
JOURS_MIN = 3  # jours lisibles minimum pour accepter une transcription

STORY_SPLIT = '{"node":{"__typename":"Story"'
CHUNK_MAX = 60_000

INSTAGRAM_USERNAME = "le_truckmuche_"
INSTAGRAM_HOME = "https://www.instagram.com/"
INSTAGRAM_API_URL = (
    f"https://i.instagram.com/api/v1/users/web_profile_info/?username={INSTAGRAM_USERNAME}"
)
# UA desktop cohérent avec le x-ig-app-id "web" (936619743392459).
INSTAGRAM_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
INSTAGRAM_APP_ID = "936619743392459"
# Dernier recours : le 429 est un rate-limit par IP, insister depuis le VPS ne sert à rien.
INSTAGRAM_MAX_ATTEMPTS = 2

JOURS_SEMAINE = 5
DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"]
MOIS_FR = {
    "JANVIER": 1, "FEVRIER": 2, "FÉVRIER": 2, "MARS": 3, "AVRIL": 4,
    "MAI": 5, "JUIN": 6, "JUILLET": 7, "AOUT": 8, "AOÛT": 8,
    "SEPTEMBRE": 9, "OCTOBRE": 10, "NOVEMBRE": 11, "DECEMBRE": 12, "DÉCEMBRE": 12,
}
MOIS_NOMS = ["", "JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOUT",
             "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE"]
CACHE_FILE = Path(__file__).parent.parent / "output" / "truck_muche_semaine.json"
_dernier_echec: float | None = None  # time.monotonic() du dernier balayage sans menu


def _dormir(secondes: float) -> None:
    time.sleep(secondes)


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


def _save_cache(menu_semaine: dict[str, str], post_id: str | None = None) -> None:
    """Sauvegarde le menu de la semaine avec le lundi comme clé de validité
    (+ l'id du post Facebook transcrit, à titre d'information)."""
    today = date.today()
    lundi_semaine = today - timedelta(days=today.weekday())
    contenu = {"lundi": str(lundi_semaine), "menu": menu_semaine}
    if post_id:
        contenu["post_id"] = post_id
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(contenu, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[truck_muche] Menu de la semaine mis en cache ({CACHE_FILE.name})")


# ── Facebook : rendu SSR servi à Googlebot ───────────────────────────────────

def _fetch_facebook_html(fin: float | None = None) -> str | None:
    """Page Facebook en rendu Googlebot. Succès = HTTP 200 contenant « "creation_time" ».
    Un 302 vers /login est intermittent depuis une IP datacenter : on réessaie avec une pause
    de 10-20 s (+ jitter), dans la limite de FB_MAX_ATTEMPTS essais et FB_BUDGET_S secondes (`fin` = échéance
    time.monotonic() plus proche imposée par le balayage)."""
    limite = time.monotonic() + FB_BUDGET_S
    fin = limite if fin is None else min(fin, limite)
    for essai in range(1, FB_MAX_ATTEMPTS + 1):
        reste = fin - time.monotonic()
        if essai > 1 and reste <= 0:
            break
        try:
            resp = requests.get(PAGE_URL, headers=GOOGLEBOT_HEADERS, allow_redirects=False,
                                timeout=min(FB_TIMEOUT_S, max(5, reste)))
        except requests.RequestException as e:
            print(f"[truck_muche] Facebook erreur réseau (essai {essai}/{FB_MAX_ATTEMPTS}) : {e}")
        else:
            if resp.status_code == 200 and '"creation_time"' in resp.text:
                print(f"[truck_muche] Facebook : page récupérée (essai {essai}, {len(resp.text) // 1024} Ko)")
                return resp.text
            print(f"[truck_muche] Facebook HTTP {resp.status_code} sans contenu exploitable "
                  f"(essai {essai}/{FB_MAX_ATTEMPTS})")
        if essai < FB_MAX_ATTEMPTS:
            pause = random.uniform(FB_PAUSE_MIN_S, FB_PAUSE_MAX_S)
            if time.monotonic() + pause > fin:
                break
            _dormir(pause)
    print("[truck_muche] Facebook : page indisponible après retries")
    return None


def _parse_posts(html: str) -> list[dict]:
    """Posts de la page, dédoublonnés par post_id, dans l'ordre d'apparition :
    {post_id, creation_time, alt, largeur, hauteur, media_ids}. Un post sans post_id ou
    sans creation_time est ignoré ; les autres champs absents valent None / []."""
    posts: dict[str, dict] = {}
    for chunk in html.split(STORY_SPLIT)[1:]:
        chunk = chunk[:CHUNK_MAX]
        m_id = re.search(r'"post_id":"(\d+)"', chunk)
        m_ts = re.search(r'"creation_time":(\d+)', chunk)
        if not m_id or not m_ts or m_id.group(1) in posts:
            continue
        alt = None
        m_alt = re.search(r'"accessibility_caption":"((?:[^"\\]|\\.)*)"', chunk)
        if m_alt:
            try:
                alt = json.loads('"' + m_alt.group(1) + '"')
            except ValueError:
                alt = m_alt.group(1)
        m_dim = re.search(r'"viewer_image":\{"height":(\d+),"width":(\d+)\}', chunk)
        media_ids: list[str] = []
        for mid in re.findall(r"media_id=(\d+)", chunk):
            if mid != AVATAR_MEDIA_ID and mid not in media_ids:
                media_ids.append(mid)
        posts[m_id.group(1)] = {
            "post_id": m_id.group(1),
            "creation_time": int(m_ts.group(1)),
            "alt": alt,
            "largeur": int(m_dim.group(2)) if m_dim else None,
            "hauteur": int(m_dim.group(1)) if m_dim else None,
            "media_ids": media_ids,
        }
    return list(posts.values())


def _candidats_menu(posts: list[dict], today: date, now: float) -> list[dict]:
    """Posts susceptibles d'être le menu hebdo : image portrait (hauteur > largeur) ou alt
    contenant « texte », publiée entre le samedi précédant le lundi de la semaine (le menu sort
    le dimanche soir ou le lundi tôt) et maintenant. Les alt « texte » (signal fort : le menu de
    référence est une image de texte paysage) passent avant les simples portraits (photos de
    plats postées après le menu), chacun du plus récent au plus ancien."""
    lundi = today - timedelta(days=today.weekday())
    debut = datetime.combine(lundi - timedelta(days=2), heure.min, tzinfo=PARIS).timestamp()
    textes, portraits = [], []
    for p in posts:
        if not p["media_ids"] or not (debut <= p["creation_time"] <= now):
            continue
        portrait = bool(p["largeur"] and p["hauteur"] and p["hauteur"] > p["largeur"])
        texte = "texte" in (p["alt"] or "").lower()
        if texte:
            textes.append(p)
        elif portrait:
            portraits.append(p)
    recent_d_abord = lambda liste: sorted(liste, key=lambda p: p["creation_time"], reverse=True)
    return recent_d_abord(textes) + recent_d_abord(portraits)


def _image_en_jpeg(data: bytes) -> bytes | None:
    """Vérifie les magic bytes (WEBP, JPEG ou PNG — Facebook sert du WEBP même quand le
    content-type annonce du JPEG) puis convertit en JPEG pour le LLM. None si ce n'est pas une image."""
    if not (data[:4] == b"RIFF" and data[8:12] == b"WEBP") and data[:3] != b"\xff\xd8\xff" \
            and data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data)).convert("RGB")
        sortie = io.BytesIO()
        img.save(sortie, format="JPEG", quality=90)
        return sortie.getvalue()
    except Exception as e:
        print(f"[truck_muche] Image illisible : {e}")
        return None


def _telecharger_media(media_id: str, fin: float | None = None) -> bytes | None:
    """Image d'un media Facebook (JPEG) via le crawler média, même UA Googlebot. None si
    indisponible ou si l'échéance `fin` (time.monotonic()) est atteinte."""
    for essai in range(1, MEDIA_MAX_ATTEMPTS + 1):
        reste = FB_TIMEOUT_S if fin is None else fin - time.monotonic()
        if reste <= 0:
            return None
        try:
            resp = requests.get(MEDIA_URL.format(media_id=media_id), headers=GOOGLEBOT_HEADERS,
                                allow_redirects=False, timeout=min(FB_TIMEOUT_S, max(5, reste)))
        except requests.RequestException as e:
            print(f"[truck_muche] Média {media_id} erreur réseau (essai {essai}/{MEDIA_MAX_ATTEMPTS}) : {e}")
        else:
            if resp.status_code == 200:
                jpeg = _image_en_jpeg(resp.content)
                if jpeg:
                    return jpeg
                print(f"[truck_muche] Média {media_id} : contenu non image")
                return None
            print(f"[truck_muche] Média {media_id} HTTP {resp.status_code} (essai {essai}/{MEDIA_MAX_ATTEMPTS})")
        if essai < MEDIA_MAX_ATTEMPTS:
            _dormir(MEDIA_PAUSE_S + random.uniform(0, 3))
    return None


def _periode_semaine_courante() -> str:
    """« DU 19 OCTOBRE AU 23 OCTOBRE » pour la semaine en cours (mois explicites : semaine à cheval)."""
    lundi = date.today() - timedelta(days=date.today().weekday())
    vendredi = lundi + timedelta(days=4)
    return f"DU {lundi.day} {MOIS_NOMS[lundi.month]} AU {vendredi.day} {MOIS_NOMS[vendredi.month]}"


def _normaliser_periode(periode: str) -> str:
    """Période du LLM ramenée à « DU x AU y MOIS » : noms de jours retirés (sinon
    _parse_menu_semaine prendrait « LUNDI » de la période pour le début du lundi), « 19/10 » →
    « 19 OCTOBRE », « DU » ajouté s'il manque."""
    p = " ".join(periode.split()).upper()
    p = re.sub(r"\b(?:LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE)\b", " ", p)
    p = re.sub(r"\b(\d{1,2})/(\d{1,2})(?:/\d{2,4})?\b",
               lambda m: f"{int(m[1])} {MOIS_NOMS[int(m[2])]}" if 1 <= int(m[2]) <= 12 else m[0], p)
    p = " ".join(p.split())
    return p if re.search(r"\bDU\b", p) else f"DU {p}"


def _texte_depuis_transcription(data: dict | None, repli_semaine: bool = False) -> str | None:
    """Reconstruit « PLATS DU JOUR <période> LUNDI <plat> MARDI <plat> … » à partir du JSON du LLM
    (format que lisent _menu_est_semaine_courante et _parse_menu_semaine). None si ce n'est
    pas un menu hebdo ou s'il manque la période (sauf `repli_semaine` : le post a été publié
    dans la fenêtre de la semaine courante, on prend alors la semaine en cours)."""
    if not isinstance(data, dict) or not isinstance(data.get("menu"), dict):
        return None
    periode = data.get("periode")
    if isinstance(periode, str) and periode.strip():
        periode = _normaliser_periode(periode)
    elif repli_semaine:
        periode = _periode_semaine_courante()
    else:
        return None
    morceaux = ["PLATS DU JOUR", periode]
    for jour in DAY_NAMES[:JOURS_SEMAINE]:
        plat = data["menu"].get(jour)
        if isinstance(plat, str) and plat.strip():
            plat = plat.replace("’", "'")
            morceaux += [jour, " ".join(plat.split()).upper()]
    return " ".join(morceaux)


def _menu_depuis_transcription(data: dict | None, repli_semaine: bool = False) -> dict[str, str] | None:
    """Menu {jour: plat} validé (semaine courante, ≥ JOURS_MIN jours) ou None."""
    texte = _texte_depuis_transcription(data, repli_semaine)
    if not texte:
        print("[truck_muche] Transcription : pas un menu hebdo exploitable")
        return None
    if not _menu_est_semaine_courante(texte):
        return None
    menu = _parse_menu_semaine(texte)
    if len(menu) < JOURS_MIN:
        print(f"[truck_muche] Transcription : {len(menu)} jour(s) lisible(s), {JOURS_MIN} requis")
        return None
    return menu


def _scrape_facebook_sync(fin: float | None = None) -> tuple[tuple[dict[str, str], str] | None, bool]:
    """Page Facebook → candidats menu → image → LLM vision → ((menu, post_id) ou None, page_lue).
    `page_lue` = la page a été récupérée (un menu absent est alors un cas normal, pas une erreur).
    Un menu de moins de 5 jours déclenche le candidat suivant ; à défaut on garde le plus complet
    (semaine fériée possible). `fin` = échéance time.monotonic() du balayage."""
    if fin is None:
        fin = time.monotonic() + SWEEP_BUDGET_S
    html = _fetch_facebook_html(fin)
    if not html:
        return None, False
    posts = _parse_posts(html)
    candidats = _candidats_menu(posts, date.today(), time.time())
    print(f"[truck_muche] Facebook : {len(posts)} post(s), {len(candidats)} candidat(s) menu")
    if not candidats:
        return None, True

    from agent.menu_vision_agent import transcrire_menu
    meilleur: tuple[dict[str, str], str] | None = None
    for post in candidats[:MAX_CANDIDATS]:
        if fin - time.monotonic() < VISION_RESTE_MIN_S:
            print("[truck_muche] Budget du balayage épuisé, candidats restants ignorés")
            break
        print(f"[truck_muche] Candidat post {post['post_id']} "
              f"({datetime.fromtimestamp(post['creation_time'], PARIS):%Y-%m-%d %H:%M})")
        jpeg = _telecharger_media(post["media_ids"][0], fin)
        if not jpeg:
            continue
        timeout = min(VISION_TIMEOUT_S, fin - time.monotonic())
        if timeout < VISION_RESTE_MIN_S:
            break
        try:
            data = transcrire_menu(jpeg, "image/jpeg", timeout)
        except Exception as e:
            print(f"[truck_muche] Transcription LLM en échec : {e}")
            continue
        menu = _menu_depuis_transcription(data, repli_semaine=True)
        if not menu:
            continue
        if len(menu) >= JOURS_SEMAINE:
            return (menu, post["post_id"]), True
        print(f"[truck_muche] Menu incomplet ({len(menu)}/{JOURS_SEMAINE} jours), on regarde le candidat suivant")
        if meilleur is None or len(menu) > len(meilleur[0]):
            meilleur = (menu, post["post_id"])
    return meilleur, True


async def _scrape_facebook(fin: float | None = None) -> tuple[tuple[dict[str, str], str] | None, bool]:
    return await asyncio.to_thread(_scrape_facebook_sync, fin)


# ── Scraping Instagram (dernier recours, sans auth) ──────────────────────────

def _instagram_session() -> requests.Session:
    """Session « warm-up » : un GET sur instagram.com pose les cookies
    (csrftoken, mid, ig_did) qui rendent l'endpoint web_profile_info bien moins
    sujet au 429 qu'un appel à froid."""
    s = requests.Session()
    s.headers.update({
        "User-Agent": INSTAGRAM_UA,
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    })
    try:
        s.get(INSTAGRAM_HOME, timeout=15)
    except requests.RequestException as e:
        print(f"[truck_muche] Instagram warm-up échoué (on continue) : {e}")
    return s


def _fetch_instagram_json() -> dict | None:
    """Appelle web_profile_info via une session avec cookies (INSTAGRAM_MAX_ATTEMPTS essais
    courts : un 429 depuis une IP datacenter ne se libère pas en quelques secondes)."""
    session = _instagram_session()
    headers = {
        "User-Agent": INSTAGRAM_UA,
        "x-ig-app-id": INSTAGRAM_APP_ID,
        "x-requested-with": "XMLHttpRequest",
        "x-csrftoken": session.cookies.get("csrftoken", ""),
        "Referer": f"https://www.instagram.com/{INSTAGRAM_USERNAME}/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    }

    for attempt in range(1, INSTAGRAM_MAX_ATTEMPTS + 1):
        try:
            resp = session.get(INSTAGRAM_API_URL, headers=headers, timeout=15)
        except requests.RequestException as e:
            print(f"[truck_muche] Instagram erreur réseau (essai {attempt}/{INSTAGRAM_MAX_ATTEMPTS}) : {e}")
        else:
            if resp.status_code == 200:
                try:
                    return resp.json()
                except ValueError:
                    print("[truck_muche] Instagram JSON invalide")
                    return None
            print(f"[truck_muche] Instagram HTTP {resp.status_code} (essai {attempt}/{INSTAGRAM_MAX_ATTEMPTS})")

        if attempt < INSTAGRAM_MAX_ATTEMPTS:
            _dormir(3 + random.uniform(0, 2))

    print("[truck_muche] Instagram : abandon")
    return None


def _scrape_instagram_sync() -> str | None:
    """
    Interroge l'endpoint public web_profile_info et retourne le premier post
    récent dont la caption/alt contient des indices de menu hebdo. La validation
    de la date de semaine est faite plus loin par _menu_est_semaine_courante.
    """
    data = _fetch_instagram_json()
    if data is None:
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


async def _scrape_instagram() -> tuple[dict[str, str], str | None] | None:
    """Texte IG → menu validé (semaine courante, parsable), ou None."""
    text = await asyncio.to_thread(_scrape_instagram_sync)
    if not text:
        return None
    if not _menu_est_semaine_courante(text):
        print("[truck_muche] Instagram : menu hors semaine courante")
        return None
    menu = _parse_menu_semaine(text)
    if not menu:
        print("[truck_muche] Instagram : parsing impossible")
        return None
    return menu, None


# ── Orchestration : Facebook (Googlebot + vision) puis Instagram ─────────────

async def _sweep_sources_once() -> tuple[dict[str, str], str | None] | None:
    """Un balayage borné par SWEEP_BUDGET_S : Facebook d'abord, puis Instagram en dernier recours
    (sauté si Facebook a répondu sans menu publié, ou s'il reste trop peu de budget)."""
    fin = time.monotonic() + SWEEP_BUDGET_S
    print("[truck_muche] Tentative via Facebook...")
    resultat, page_lue = await _scrape_facebook(fin)
    if resultat:
        menu, post_id = resultat
        print(f"[truck_muche] Facebook : menu récupéré ({len(menu)} jours)")
        return menu, post_id
    print("[truck_muche] Facebook : rien trouvé")
    if page_lue:
        print("[truck_muche] Page Facebook lue sans menu exploitable : Instagram inutile")
        return None
    if fin - time.monotonic() < INSTAGRAM_RESTE_MIN_S:
        print("[truck_muche] Budget du balayage épuisé : Instagram ignoré")
        return None
    print("[truck_muche] Tentative via Instagram...")
    resultat = await _scrape_instagram()
    if not resultat:
        print("[truck_muche] Instagram : rien trouvé")
        return None
    menu, post_id = resultat
    print(f"[truck_muche] Instagram : menu récupéré ({len(menu)} jours)")
    return menu, post_id


async def _scrape_menu_semaine_raw() -> tuple[dict[str, str], str | None] | None:
    """
    (menu {"LUNDI": "plat", ...}, post_id Facebook ou None), ou None si aucune source n'a rien donné.
    Un seul balayage borné (les retries Facebook sont dans _fetch_facebook_html, et le cron relance
    le pipeline toutes les 15 min) ; un balayage sans menu est mémorisé ECHEC_TTL_S pour que
    scrape_semaine() puis scrape() d'un même run ne le refassent pas.
    """
    global _dernier_echec
    if _dernier_echec is not None and time.monotonic() - _dernier_echec < ECHEC_TTL_S:
        print("[truck_muche] Balayage déjà échoué dans ce run : on n'insiste pas")
        return None
    resultat = await _sweep_sources_once()
    _dernier_echec = None if resultat else time.monotonic()
    return resultat


# ── Validation de la date ────────────────────────────────────────────────────

def _menu_est_semaine_courante(text: str) -> bool:
    """
    Vérifie que la date inscrite sur le menu correspond à la semaine en cours.
    Cherche un pattern type "DU 20 AU 24 AVRIL" dans le texte OCR.
    """
    text_upper = text.upper()
    # Décoller les tokens OCR fusionnés par Facebook (ex: "DU4AU10MAI" → "DU 4 AU 10 MAI")
    text_upper = re.sub(r'([A-ZÀ-Ü])(\d)', r'\1 \2', text_upper)
    text_upper = re.sub(r'(\d)([A-ZÀ-Ü])', r'\1 \2', text_upper)
    # Pattern : "DU <jour_debut> [<mois_debut>] AU <jour_fin> <mois_fin>"
    # - Le mois du jour de début est optionnel (cas semaine sur un seul mois) ;
    #   quand il est présent (semaine à cheval, ex. "DU 27 AVRIL AU 01 MAI"),
    #   c'est lui qui s'applique au jour de début.
    # - Espaces tolérés en option autour de "AU" car l'OCR Facebook colle
    #   parfois les tokens (ex. "AU3MAI" pour "AU 3 MAI").
    match = re.search(
        r"DU\s+(\d{1,2})(?:\s+([A-ZÀ-Ü]+))?\s*AU\s*(\d{1,2})\s*([A-ZÀ-Ü]+)",
        text_upper,
    )
    if not match:
        print("[truck_muche] Aucune date trouvée dans le menu, impossible de valider la semaine")
        return False

    jour_debut = int(match.group(1))
    mois_str = match.group(2) or match.group(4)
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
    Scrape (FB Googlebot + vision, IG en dernier recours) si pas de cache, sinon lit le cache.
    """
    cache = _load_cache()

    if cache is None:
        resultat = await _scrape_menu_semaine_raw()
        if not resultat:
            print("[truck_muche] Aucune source n'a fourni le menu → fermé cette semaine")
            return None
        menu_semaine, post_id = resultat
        _save_cache(menu_semaine, post_id)
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


def _plat_result(plat: str) -> dict:
    """Construit le dict de sortie, en séparant les options ("A OU B")."""
    options = [p.strip() for p in plat.split(" OU ") if p.strip()]
    return {
        "restaurant": "Le Truck Muche",
        "plat": options if len(options) > 1 else options[0],
        "prix": "11.50€",
    }


async def scrape() -> dict | None:
    """
    Retourne un dict { "restaurant": str, "plat": str, "prix": str } ou None si échec.
    Cache absent (lundi, ou rattrapage un autre jour) : balayage FB → IG et mise en cache,
    le menu hebdo couvrant toute la semaine. Cache valide : lecture directe, pas de scraping.
    """
    today = date.today()
    today_name = DAY_NAMES[today.weekday()]

    cache = _load_cache()

    if cache is None:
        if today.weekday() != 0:
            print("[truck_muche] Cache absent en dehors du lundi → balayage du menu hebdo")
        resultat = await _scrape_menu_semaine_raw()
        if not resultat:
            print("[truck_muche] Aucune source n'a fourni le menu → fermé cette semaine")
            return None
        menu_semaine, post_id = resultat
        _save_cache(menu_semaine, post_id)
        cache = {"menu": menu_semaine}
    else:
        print("[truck_muche] Menu chargé depuis le cache (pas de scraping)")

    plat = cache["menu"].get(today_name)
    if not plat:
        print(f"[truck_muche] Pas de plat trouvé pour {today_name} dans le cache")
        return None

    return _plat_result(plat)
