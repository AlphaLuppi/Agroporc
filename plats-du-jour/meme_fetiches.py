"""
Gifs fétiches des IA tirés des memes du moment (meme.com) — logique pure, testée.

Chaque lundi, `agent/meme_agent.py` lit les memes tendance/récents de meme.com, fait choisir
au LLM 4 memes par personnage, trouve leur version animée sur Giphy (repli : image meme.com)
puis remplace dans `gifs_fetiches` les seuls gifs posés automatiquement.

Un gif automatique porte le fragment `#meme-auto=<slug>` : jamais envoyé au serveur (l'image
s'affiche normalement), il distingue les gifs ajoutés à la main (conservés) et donne le slug
pour ne pas reprendre la semaine suivante les memes de la semaine passée.
"""
import html
import json
import re
from email.utils import parsedate_to_datetime
from urllib.parse import unquote, urlsplit

MARQUEUR = "#meme-auto="
PAR_PERSONNAGE = 4
RESERVES = 2

# Garde-fou avant le LLM (qui filtre aussi) : meme.com documente tout, y compris le NSFW.
MOTS_EXCLUS = re.compile(
    r"\b(sex|sexual|porn|nsfw|nude|naked|hentai|ahegao|fetish|\w*philia|onlyfans|horny|gooner|"
    r"coomer|nazi|hitler|racis|slur|n-word|rape|suicide|murder|shooting|massacre|terror|"
    r"genocide|trump|biden|harris|election|israel|gaza|palestin|ukrain|putin|cocaine|"
    r"femcel|incel|white boy|hyperborea)",
    re.I,
)

_SLUG_RE = re.compile(r'href="/memes/([^"/?#]+)"')
_OG_RE = re.compile(r'<meta\s+property="og:(title|description|image)"\s+content="([^"]*)"', re.I)
_GIPHY_RE = re.compile(r"^https://media\d*\.giphy\.com/media/(?:v1\.[^/]+/)?([A-Za-z0-9]+)/")


def acceptable(*textes: str) -> bool:
    return not any(MOTS_EXCLUS.search(t or "") for t in textes)


def _slug_de_lien(lien: str) -> str:
    return unquote(urlsplit(lien).path.rstrip("/").rsplit("/", 1)[-1])


def parser_rss(xml: str) -> list[dict]:
    """Articles de https://meme.com/recent.xml : [{slug, titre, resume, date}] (plus récent d'abord)."""
    memes = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        champ = lambda nom: html.unescape(
            (re.search(rf"<{nom}>(.*?)</{nom}>", item, re.S) or [None, ""])[1].strip())
        lien, titre = champ("link"), champ("title")
        if not lien or not titre:
            continue
        try:
            date = parsedate_to_datetime(champ("pubDate")).date().isoformat()
        except (TypeError, ValueError):
            date = ""
        memes.append({"slug": _slug_de_lien(lien), "titre": titre,
                      "resume": champ("description")[:300], "date": date})
    return memes


def parser_tendances(page: str, maxi: int = 40) -> list[str]:
    """Slugs de la page d'accueil à partir de la section « Trending Now » (ordre de la page)."""
    debut = page.find("Trending Now")
    zone = page[debut:] if debut >= 0 else page
    return list(dict.fromkeys(_SLUG_RE.findall(zone)))[:maxi]


def parser_og(page: str) -> dict:
    """{titre, resume, image} d'une page meme depuis ses balises Open Graph."""
    og = {k: html.unescape(v) for k, v in _OG_RE.findall(page)}
    titre = re.sub(r"\s+Meme:.*$", "", og.get("title", "")).strip()
    image = og.get("image", "")
    return {"titre": titre, "resume": og.get("description", "")[:300],
            "image": image if image.startswith("https://cdn-v2.meme.com/") else ""}


def url_auto(url: str, slug: str) -> str:
    return f"{url.split('#', 1)[0]}{MARQUEUR}{slug}"


def slug_auto(url: str) -> str | None:
    """Slug d'un gif posé automatiquement, None pour un gif ajouté à la main."""
    if MARQUEUR not in url:
        return None
    return url.split(MARQUEUR, 1)[1] or None


def sans_marqueur(url: str) -> str:
    return url.split(MARQUEUR, 1)[0]


def fusionner(existants: list[str], nouveaux: list[str]) -> list[str]:
    """Gifs ajoutés à la main d'abord (le prompt n'en lit que 5), puis les nouveaux automatiques."""
    manuels = [u for u in existants if slug_auto(u) is None]
    vus = {sans_marqueur(u) for u in manuels}
    auto = [u for u in nouveaux if sans_marqueur(u) not in vus]
    return manuels + auto


def prompt_casting(profils: list[dict], catalogue: list[dict], exclus: set[str]) -> str:
    persos = [{"nom": p["nom"], "prenom": p.get("prenom", ""), "role": p.get("role", ""),
               "personnalite": (p.get("personnalite") or "")[:300],
               "traits": (p.get("traits") or [])[:6],
               "blagues": (p.get("blagues_recurrentes") or [])[:4]} for p in profils]
    memes = [{"slug": m["slug"], "titre": m["titre"], "resume": m["resume"][:220],
              "fraicheur": m["fraicheur"]} for m in catalogue if m["slug"] not in exclus]
    return f"""Tu es directeur de casting de memes pour des personnages IA qui commentent le déjeuner \
entre collègues de bureau. Attribue à CHAQUE personnage exactement {PAR_PERSONNAGE} memes « fétiches » \
+ {RESERVES} réserves, tous pris dans le catalogue ci-dessous (memes du moment sur meme.com).

Règles :
- Un slug n'est attribué qu'une fois au total (memes et réserves confondus).
- L'humour prime : un meme qui colle à la vibe ou aux tics du personnage, ou un décalage absurde. \
Aucun lien avec la nourriture requis.
- Au moins 2 memes « tendance » ou « recent » par personnage quand c'est possible.
- Privilégie les memes qui existent en gif animé (réactions, danses, animaux, scènes de film/série).
- Ignore tout meme sexuel, NSFW, politique clivant, haineux, ou lié à un drame réel.
- requete_giphy : requête anglaise de 2 à 5 mots qui trouve CE meme sur Giphy, terminée par "meme".

Personnages :
{json.dumps(persos, ensure_ascii=False)}

Catalogue :
{json.dumps(memes, ensure_ascii=False)}

Réponds UNIQUEMENT avec ce JSON :
{{"attributions": [{{"nom": "<nom exact>", "memes": [{{"slug": "...", "requete_giphy": "... meme"}}], \
"reserves": [{{"slug": "...", "requete_giphy": "... meme"}}]}}]}}"""


def valider_casting(data: dict, catalogue: list[dict], noms: list[str]) -> dict[str, list[dict]]:
    """{nom: [{slug, titre, requete_giphy, image}]} (memes puis réserves), slugs connus et uniques."""
    par_slug = {m["slug"]: m for m in catalogue}
    pris: set[str] = set()
    sortie: dict[str, list[dict]] = {}
    for a in (data or {}).get("attributions") or []:
        nom = a.get("nom") if isinstance(a, dict) else None
        if nom not in noms or nom in sortie:
            continue
        choix = []
        for m in (a.get("memes") or []) + (a.get("reserves") or []):
            slug = m.get("slug") if isinstance(m, dict) else None
            if slug not in par_slug or slug in pris:
                continue
            pris.add(slug)
            ref = par_slug[slug]
            requete = str(m.get("requete_giphy") or "").strip()[:80] or ref["titre"]
            if "meme" not in requete.lower():
                requete += " meme"
            choix.append({"slug": slug, "titre": ref["titre"], "requete_giphy": requete,
                          "image": ref.get("image", "")})
        sortie[nom] = choix
    return sortie


def _mots(texte: str) -> set[str]:
    return {m for m in re.findall(r"[a-z0-9]+", texte.lower())
            if len(m) > 2 and m not in {"the", "and", "meme", "memes", "gif", "with", "you"}}


def choisir_giphy(resultats: list[dict], titre: str, deja: set[str]) -> str | None:
    """URL propre du premier résultat Giphy dont le titre/slug partage un mot du titre du meme."""
    attendus = _mots(titre)
    for r in resultats:
        texte = f"{r.get('title', '')} {r.get('slug', '')}".replace("-", " ")
        if attendus and not attendus & _mots(texte):
            continue
        imgs = r.get("images") or {}
        url = (imgs.get("downsized") or {}).get("url") or (imgs.get("original") or {}).get("url") or ""
        m = _GIPHY_RE.match(url)
        if not m:
            continue
        propre = f"https://media.giphy.com/media/{m[1]}/giphy.gif"
        if propre not in deja:
            return propre
    return None
