import asyncio
import io
import json
import sys
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import truck_muche as tm

PARIS = ZoneInfo("Europe/Paris")
LUNDI = date(2026, 10, 19)  # semaine du 19 au 25 octobre 2026


def _ts(jour: int, h: int, mn: int = 0, mois: int = 10) -> int:
    return int(datetime(2026, mois, jour, h, mn, tzinfo=PARIS).timestamp())


def _story(post_id, ts, *, alt=None, dim=None, media=("111",), avatar=True):
    """Un chunk Story minimal, dans l'ordre des champs observé sur la page réelle."""
    s = tm.STORY_SPLIT + f',"post_id":"{post_id}","creation_time":{ts}'
    if alt is not None:
        s += f',"accessibility_caption":"{alt}"'
    if dim is not None:
        s += f',"viewer_image":{{"height":{dim[0]},"width":{dim[1]}}}'
    if avatar:
        s += f',"profile":"https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id={tm.AVATAR_MEDIA_ID}"'
    for m in media:
        s += f',"uri":"https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id={m}\\u0026ext=1"'
    return s + "}}"


def _html(*stories):
    return '<html>{"data":' + "".join(stories) + "</html>"


# Menu du dimanche 18/10 à 19h05 (1921x1440, alt « image de texte »), un post photo plus récent,
# un vieux menu de la semaine précédente.
H_MENU = _html(
    "AVANT-PROPOS-IGNORE" '"creation_time":1',
    _story("900", _ts(20, 9), alt="Peut être une image de nourriture", dim=(800, 800), media=("333",)),
    _story("1727076606089388", _ts(18, 19, 5), alt="Peut être une image de texte",
           dim=(1440, 1921), media=("1727076566089392",)),
    _story("1727076606089388", _ts(18, 19, 5), alt="doublon", dim=(1, 1), media=("999",)),
    _story("700", _ts(11, 19), alt="Peut être une image de texte", dim=(900, 1200), media=("222",)),
)


@pytest.fixture(autouse=True)
def _reset_echec(monkeypatch):
    monkeypatch.setattr(tm, "_dernier_echec", None)


def _post(post_id="1", ts=0, alt=None, largeur=None, hauteur=None, media=("1",)):
    return {"post_id": post_id, "creation_time": ts, "alt": alt, "largeur": largeur,
            "hauteur": hauteur, "media_ids": list(media)}


# ── Parsing ──────────────────────────────────────────────────────────────────

def test_parse_posts_extrait_champs_et_dedoublonne():
    posts = tm._parse_posts(H_MENU)
    assert [p["post_id"] for p in posts] == ["900", "1727076606089388", "700"]
    menu = posts[1]
    assert menu["creation_time"] == _ts(18, 19, 5)
    assert menu["alt"] == "Peut être une image de texte"
    assert (menu["largeur"], menu["hauteur"]) == (1921, 1440)  # viewer_image : height puis width
    assert menu["media_ids"] == ["1727076566089392"]  # l'avatar est ignoré


def test_parse_posts_decode_alt_json_echappe_et_champs_absents():
    html = _html(_story("5", 1000, alt="Peut \\u00eatre une image de \\\"texte\\\"", media=()))
    (p,) = tm._parse_posts(html)
    assert p["alt"] == 'Peut être une image de "texte"'
    assert p["largeur"] is None and p["hauteur"] is None and p["media_ids"] == []


def test_parse_posts_ignore_chunk_sans_post_id_ou_date():
    html = _html(tm.STORY_SPLIT + ',"creation_time":5}}', tm.STORY_SPLIT + ',"post_id":"8"}}')
    assert tm._parse_posts(html) == []


# ── Sélection des candidats ──────────────────────────────────────────────────

NOW = _ts(19, 8)  # lundi 19/10 08:00


def test_candidats_portrait_ou_texte_dans_la_fenetre():
    posts = tm._parse_posts(H_MENU)
    cands = tm._candidats_menu(posts, LUNDI, NOW)
    # le post de nourriture carré (futur ici : 20/10) et le vieux menu (11/10) sont écartés
    assert [p["post_id"] for p in cands] == ["1727076606089388"]


def test_candidats_fenetre_commence_le_samedi_texte_d_abord_puis_portraits_recents():
    posts = [
        _post("a", _ts(16, 23, 59), hauteur=1200, largeur=900),  # vendredi : trop tôt
        _post("b", _ts(17, 0, 1), hauteur=1200, largeur=900),    # samedi 00:01 : ok
        _post("c", _ts(19, 7), alt="image de texte"),            # lundi, alt texte, sans dimensions
        _post("d", _ts(19, 7, 30), alt="image de nourriture", hauteur=500, largeur=900),  # paysage
        _post("e", _ts(19, 9), hauteur=1200, largeur=900),       # dans le futur
    ]
    cands = tm._candidats_menu(posts, LUNDI, NOW)
    assert [p["post_id"] for p in cands] == ["c", "b"]


def test_candidats_photos_portrait_recentes_ne_repoussent_pas_le_menu_texte():
    """Mardi : des photos portrait plus récentes que le menu du dimanche passent après lui."""
    posts = [
        _post("dessert", _ts(20, 12), alt="image de nourriture", hauteur=1600, largeur=900),
        _post("plat", _ts(20, 11), alt="image de nourriture", hauteur=1600, largeur=900),
        _post("menu", _ts(18, 19, 5), alt="Peut être une image de texte", hauteur=1440, largeur=1921),
        _post("menu2", _ts(19, 7), alt="image de texte", hauteur=1440, largeur=1921),
    ]
    cands = tm._candidats_menu(posts, LUNDI, _ts(20, 13))
    assert [p["post_id"] for p in cands] == ["menu2", "menu", "dessert", "plat"]


def test_candidats_sans_media_ou_avatar_seul_ecartes():
    posts = tm._parse_posts(_html(
        _story("1", _ts(18, 19), alt="image de texte", media=()),
    ))
    assert tm._candidats_menu(posts, LUNDI, NOW) == []


def test_aucun_menu_publie_donne_liste_vide():
    posts = [_post("x", _ts(15, 12), alt="image de texte")]
    assert tm._candidats_menu(posts, LUNDI, NOW) == []


# ── Image ────────────────────────────────────────────────────────────────────

def _image(fmt):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (40, 60), (200, 30, 30)).save(buf, format=fmt)
    return buf.getvalue()


@pytest.mark.parametrize("fmt", ["WEBP", "PNG", "JPEG"])
def test_image_en_jpeg_accepte_les_formats_connus(fmt):
    out = tm._image_en_jpeg(_image(fmt))
    assert out[:3] == b"\xff\xd8\xff"


def test_image_en_jpeg_refuse_le_html_et_les_octets_corrompus():
    assert tm._image_en_jpeg(b"<html>login</html>") is None
    assert tm._image_en_jpeg(b"RIFF\x00\x00\x00\x00WEBPgarbage") is None


# ── Retries Facebook (réseau mocké, pas de sleep) ────────────────────────────

class _Resp:
    def __init__(self, status=200, text="", content=b""):
        self.status_code, self.text, self.content = status, text, content


@pytest.fixture
def sans_sommeil(monkeypatch):
    pauses = []
    monkeypatch.setattr(tm, "_dormir", pauses.append)
    return pauses


def test_fetch_facebook_reessaie_sur_302_puis_reussit(monkeypatch, sans_sommeil):
    reponses = iter([_Resp(302), _Resp(302), _Resp(200, "<html>sans posts</html>"), _Resp(200, H_MENU)])
    appels = []

    def fake_get(url, **kw):
        appels.append((url, kw))
        return next(reponses)

    monkeypatch.setattr(tm.requests, "get", fake_get)
    assert tm._fetch_facebook_html() == H_MENU
    assert len(appels) == 4 and len(sans_sommeil) == 3
    assert all(tm.FB_PAUSE_MIN_S <= p <= tm.FB_PAUSE_MAX_S for p in sans_sommeil)
    url, kw = appels[0]
    assert url == tm.PAGE_URL and kw["allow_redirects"] is False
    assert "Googlebot" in kw["headers"]["User-Agent"]


def test_fetch_facebook_abandonne_apres_max_essais(monkeypatch, sans_sommeil):
    n = []
    monkeypatch.setattr(tm.requests, "get", lambda url, **kw: n.append(1) or _Resp(302))
    assert tm._fetch_facebook_html() is None
    assert len(n) == tm.FB_MAX_ATTEMPTS
    assert len(sans_sommeil) == tm.FB_MAX_ATTEMPTS - 1  # pas de pause après le dernier essai


def test_fetch_facebook_erreur_reseau_reessaie(monkeypatch, sans_sommeil):
    suite = iter([tm.requests.ConnectionError("boom"), _Resp(200, H_MENU)])

    def fake_get(url, **kw):
        r = next(suite)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(tm.requests, "get", fake_get)
    assert tm._fetch_facebook_html() == H_MENU


def test_fetch_facebook_respecte_le_budget_de_temps(monkeypatch, sans_sommeil):
    horloge = iter([0.0] + [1000.0] * 50)  # le budget (180 s) est dépassé dès la 1re pause
    monkeypatch.setattr(tm.time, "monotonic", lambda: next(horloge))
    n = []
    monkeypatch.setattr(tm.requests, "get", lambda url, **kw: n.append(1) or _Resp(302))
    assert tm._fetch_facebook_html() is None
    assert len(n) == 1 and sans_sommeil == []


def test_telecharger_media_webp_servi_comme_jpeg(monkeypatch, sans_sommeil):
    vus = []

    def fake_get(url, **kw):
        vus.append((url, kw))
        return _Resp(200, content=_image("WEBP"))

    monkeypatch.setattr(tm.requests, "get", fake_get)
    out = tm._telecharger_media("1727076566089392")
    assert out[:3] == b"\xff\xd8\xff"
    assert vus[0][0] == "https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1727076566089392"
    assert vus[0][1]["allow_redirects"] is False


def test_telecharger_media_non_image_et_http_erreur(monkeypatch, sans_sommeil):
    monkeypatch.setattr(tm.requests, "get", lambda url, **kw: _Resp(200, content=b"<html>"))
    assert tm._telecharger_media("1") is None
    monkeypatch.setattr(tm.requests, "get", lambda url, **kw: _Resp(404))
    assert tm._telecharger_media("1") is None


# ── Transcription LLM → menu ─────────────────────────────────────────────────

class _FauxJour(date):
    @classmethod
    def today(cls):
        return LUNDI


@pytest.fixture
def semaine_du_19(monkeypatch):
    monkeypatch.setattr(tm, "date", _FauxJour)


VERITE = {
    "LUNDI": "BLANQUETTE DE DINDE",
    "MARDI": "HACHIS PARMENTIER",
    "MERCREDI": "PASTA CARBO",
    "JEUDI": "POULET CURRY COCO",
    "VENDREDI": "LES GNOCCHIS DELLA MAMMA ET BŒUF À LA TOMATE",
}
TRANSCRIPTION = {
    "periode": "du 19 au 25 octobre",
    "menu": {
        "LUNDI": "Blanquette de dinde", "MARDI": "Hachis parmentier", "MERCREDI": "Pasta carbo",
        "JEUDI": "Poulet curry coco", "VENDREDI": "Les gnocchis della mamma et bœuf à la tomate",
    },
}


def test_texte_depuis_transcription_format_attendu():
    texte = tm._texte_depuis_transcription(TRANSCRIPTION)
    assert texte.startswith("PLATS DU JOUR DU 19 AU 25 OCTOBRE LUNDI BLANQUETTE DE DINDE MARDI HACHIS")
    assert "BŒUF À LA TOMATE" in texte


def test_menu_depuis_transcription_valide(semaine_du_19):
    assert tm._menu_depuis_transcription(TRANSCRIPTION) == VERITE


def test_menu_depuis_transcription_alternatives_et_apostrophe_typographique(semaine_du_19):
    data = {"periode": "DU 19 AU 25 OCTOBRE", "menu": {
        "LUNDI": "Dos de colin OU Curry d’agneau", "MARDI": "B", "MERCREDI": "C", "JEUDI": None, "VENDREDI": ""}}
    menu = tm._menu_depuis_transcription(data)
    assert menu["LUNDI"] == "DOS DE COLIN OU CURRY D'AGNEAU"
    assert set(menu) == {"LUNDI", "MARDI", "MERCREDI"}


def test_menu_depuis_transcription_refus(semaine_du_19):
    assert tm._menu_depuis_transcription(None) is None
    assert tm._menu_depuis_transcription({"menu": None}) is None
    # période manquante sans repli
    assert tm._menu_depuis_transcription({"menu": TRANSCRIPTION["menu"]}) is None
    # mauvaise semaine
    assert tm._menu_depuis_transcription({**TRANSCRIPTION, "periode": "DU 12 AU 18 OCTOBRE"}) is None
    # moins de 3 jours
    court = {"periode": "DU 19 AU 25 OCTOBRE", "menu": {"LUNDI": "A", "MARDI": "B", "MERCREDI": None}}
    assert tm._menu_depuis_transcription(court) is None


@pytest.mark.parametrize("periode", [
    "Du lundi 19 au vendredi 23 octobre", "19/10 au 23/10", "DU 19/10 AU 23/10/2026",
    "Semaine du 19 au 23 Octobre", "19 AU 23 OCTOBRE",
])
def test_menu_depuis_transcription_normalise_la_periode(semaine_du_19, periode):
    data = {"periode": periode, "menu": TRANSCRIPTION["menu"]}
    assert tm._menu_depuis_transcription(data) == VERITE


def test_menu_depuis_transcription_periode_absente_repli_semaine_courante(semaine_du_19):
    data = {"periode": None, "menu": TRANSCRIPTION["menu"]}
    assert tm._menu_depuis_transcription(data) is None
    assert tm._menu_depuis_transcription(data, repli_semaine=True) == VERITE
    # une période écrite mais d'une autre semaine reste rejetée, même avec repli
    vieux = {"periode": "DU 12 AU 18 OCTOBRE", "menu": TRANSCRIPTION["menu"]}
    assert tm._menu_depuis_transcription(vieux, repli_semaine=True) is None


def test_periode_semaine_courante_a_cheval_sur_deux_mois(monkeypatch):
    class Fin(date):
        @classmethod
        def today(cls):
            return date(2026, 10, 28)  # mercredi : lundi 26 oct, vendredi 30 oct
    monkeypatch.setattr(tm, "date", Fin)
    assert tm._periode_semaine_courante() == "DU 26 OCTOBRE AU 30 OCTOBRE"
    monkeypatch.setattr(tm, "date", type("D", (date,), {"today": classmethod(lambda c: date(2026, 4, 29))}))
    assert tm._periode_semaine_courante() == "DU 27 AVRIL AU 1 MAI"


# ── Flux complet Facebook (tout mocké) ───────────────────────────────────────

@pytest.fixture
def fb_mock(monkeypatch, semaine_du_19, sans_sommeil):
    """Facebook sert H_MENU, l'image est un JPEG factice, le LLM rend TRANSCRIPTION."""
    monkeypatch.setattr(tm.time, "time", lambda: NOW)
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: H_MENU)
    telechargements, llm = [], []
    monkeypatch.setattr(tm, "_telecharger_media",
                        lambda mid, fin=None: telechargements.append(mid) or b"jpeg")

    import agent.menu_vision_agent as mva

    def fake_transcrire(image, media_type="image/jpeg", timeout=90.0):
        llm.append((image, media_type))
        return TRANSCRIPTION

    monkeypatch.setattr(mva, "transcrire_menu", fake_transcrire)
    return telechargements, llm


def test_scrape_facebook_sync_flux_complet(fb_mock):
    telechargements, llm = fb_mock
    assert tm._scrape_facebook_sync() == ((VERITE, "1727076606089388"), True)
    assert telechargements == ["1727076566089392"]
    assert llm == [(b"jpeg", "image/jpeg")]


def test_scrape_facebook_sync_aucun_menu_publie(monkeypatch, fb_mock):
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: _html(_story("1", _ts(12, 12), alt="texte")))
    assert tm._scrape_facebook_sync() == (None, True)
    assert fb_mock[1] == []  # aucun appel LLM


def test_scrape_facebook_sync_page_indisponible(monkeypatch, fb_mock):
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: None)
    assert tm._scrape_facebook_sync() == (None, False)


def test_scrape_facebook_sync_candidat_suivant_si_llm_en_echec(monkeypatch, fb_mock):
    html = _html(
        _story("2", _ts(19, 6), alt="image de texte", media=("20",)),
        _story("1", _ts(18, 19), alt="image de texte", media=("10",)),
    )
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: html)
    import agent.menu_vision_agent as mva
    reponses = iter([RuntimeError("timeout"), TRANSCRIPTION])

    def fake(image, media_type="image/jpeg", timeout=90.0):
        r = next(reponses)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(mva, "transcrire_menu", fake)
    assert tm._scrape_facebook_sync() == ((VERITE, "1"), True)
    assert fb_mock[0] == ["20", "10"]


def test_scrape_facebook_sync_menu_incomplet_essaie_le_candidat_suivant(monkeypatch, fb_mock):
    html = _html(
        _story("2", _ts(19, 6), alt="image de texte", media=("20",)),
        _story("1", _ts(18, 19), alt="image de texte", media=("10",)),
    )
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: html)
    import agent.menu_vision_agent as mva
    partiel = {"periode": "DU 19 AU 25 OCTOBRE",
               "menu": {**TRANSCRIPTION["menu"], "MERCREDI": None, "JEUDI": None}}
    reponses = iter([partiel, TRANSCRIPTION])
    monkeypatch.setattr(mva, "transcrire_menu", lambda *a, **k: next(reponses))
    assert tm._scrape_facebook_sync() == ((VERITE, "1"), True)  # le 2e candidat est complet
    assert fb_mock[0] == ["20", "10"]


def test_scrape_facebook_sync_garde_le_menu_partiel_si_aucun_complet(monkeypatch, fb_mock):
    html = _html(
        _story("2", _ts(19, 6), alt="image de texte", media=("20",)),
        _story("1", _ts(18, 19), alt="image de texte", media=("10",)),
    )
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: html)
    import agent.menu_vision_agent as mva
    partiel = {"periode": "DU 19 AU 25 OCTOBRE", "menu": {**TRANSCRIPTION["menu"], "JEUDI": None}}
    monkeypatch.setattr(mva, "transcrire_menu", lambda *a, **k: partiel)
    (menu, post_id), lue = tm._scrape_facebook_sync()
    assert lue and post_id == "2" and len(menu) == 4  # semaine fériée possible : on garde le plus complet


def test_scrape_facebook_sync_budget_epuise_pas_d_appel_llm(monkeypatch, fb_mock):
    horloge = iter([0.0, 100.0] + [100.0] * 50)
    monkeypatch.setattr(tm.time, "monotonic", lambda: next(horloge))
    assert tm._scrape_facebook_sync(fin=105.0) == (None, True)  # reste 5 s < VISION_RESTE_MIN_S
    assert fb_mock[1] == []


# ── scrape() / scrape_semaine() et cache ─────────────────────────────────────

@pytest.fixture
def cache_tmp(monkeypatch, tmp_path):
    f = tmp_path / "output" / "truck_muche_semaine.json"
    monkeypatch.setattr(tm, "CACHE_FILE", f)
    return f


def _sans_instagram(monkeypatch):
    async def rien():
        return None
    monkeypatch.setattr(tm, "_scrape_instagram", rien)


def test_scrape_semaine_scrape_puis_cache(monkeypatch, cache_tmp, fb_mock):
    _sans_instagram(monkeypatch)
    semaine = asyncio.run(tm.scrape_semaine())
    assert semaine["LUNDI"] == {"plat": "BLANQUETTE DE DINDE", "prix": "11.50€"}
    assert len(semaine) == 5
    cache = json.loads(cache_tmp.read_text(encoding="utf-8"))
    assert cache == {"lundi": "2026-10-19", "menu": VERITE, "post_id": "1727076606089388"}

    # 2e appel : cache, plus aucun accès réseau
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: pytest.fail("réseau appelé"))
    assert asyncio.run(tm.scrape_semaine()) == semaine


def test_scrape_semaine_alternatives_en_minuscules(monkeypatch, cache_tmp, semaine_du_19):
    cache_tmp.parent.mkdir(parents=True)
    cache_tmp.write_text(json.dumps({"lundi": "2026-10-19", "menu": {"LUNDI": "A OU B"}}), encoding="utf-8")
    assert asyncio.run(tm.scrape_semaine())["LUNDI"]["plat"] == "A ou B"


def test_scrape_mardi_sans_cache_balaye_le_menu_hebdo(monkeypatch, cache_tmp, fb_mock):
    """Hors lundi et cache absent : plus de chemin IG quotidien, on balaye le menu hebdo et on le met en cache."""
    _sans_instagram(monkeypatch)

    class Mardi(_FauxJour):
        @classmethod
        def today(cls):
            return date(2026, 10, 20)

    monkeypatch.setattr(tm, "date", Mardi)
    r = asyncio.run(tm.scrape())
    assert r == {"restaurant": "Le Truck Muche", "plat": "HACHIS PARMENTIER", "prix": "11.50€"}
    assert json.loads(cache_tmp.read_text(encoding="utf-8"))["menu"] == VERITE


def test_scrape_plat_multi_options(monkeypatch, cache_tmp, semaine_du_19):
    cache_tmp.parent.mkdir(parents=True)
    cache_tmp.write_text(json.dumps({"lundi": "2026-10-19", "menu": {"LUNDI": "DOS DE COLIN OU CURRY"}}),
                         encoding="utf-8")
    assert asyncio.run(tm.scrape())["plat"] == ["DOS DE COLIN", "CURRY"]


def test_scrape_aucune_source_donne_none_et_pas_de_cache(monkeypatch, cache_tmp, semaine_du_19):
    appels = []
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: appels.append(1))
    _sans_instagram(monkeypatch)
    assert asyncio.run(tm.scrape()) is None
    assert asyncio.run(tm.scrape_semaine()) is None
    assert not cache_tmp.exists()
    assert len(appels) == 1  # le 2e appel du run ne refait pas de balayage


def test_echec_memorise_expire_apres_le_ttl(monkeypatch, cache_tmp, semaine_du_19):
    appels = []
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: appels.append(1))
    _sans_instagram(monkeypatch)
    assert asyncio.run(tm.scrape()) is None
    monkeypatch.setattr(tm, "_dernier_echec", time.monotonic() - tm.ECHEC_TTL_S - 1)
    assert asyncio.run(tm.scrape()) is None
    assert len(appels) == 2


def test_instagram_saute_si_facebook_a_repondu_sans_menu(monkeypatch, cache_tmp, semaine_du_19):
    monkeypatch.setattr(tm.time, "time", lambda: NOW)
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: _html(_story("1", _ts(12, 12), alt="texte")))
    monkeypatch.setattr(tm, "_scrape_instagram_sync", lambda: pytest.fail("Instagram appelé"))
    assert asyncio.run(tm.scrape()) is None


def test_instagram_saute_si_budget_epuise(monkeypatch, cache_tmp, semaine_du_19):
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: None)
    monkeypatch.setattr(tm, "SWEEP_BUDGET_S", tm.INSTAGRAM_RESTE_MIN_S - 1)
    monkeypatch.setattr(tm, "_scrape_instagram_sync", lambda: pytest.fail("Instagram appelé"))
    assert asyncio.run(tm.scrape()) is None


def test_scrape_instagram_en_dernier_recours(monkeypatch, cache_tmp, semaine_du_19):
    monkeypatch.setattr(tm, "_fetch_facebook_html", lambda fin=None: None)
    monkeypatch.setattr(tm, "_scrape_instagram_sync",
                        lambda: "PLATS DU JOUR DU 19 AU 25 OCTOBRE LUNDI POULET MARDI PÂTES")
    r = asyncio.run(tm.scrape())
    assert r["plat"] == "POULET"
    assert "post_id" not in json.loads(cache_tmp.read_text(encoding="utf-8"))


def test_scrape_jour_sans_plat_dans_le_cache(monkeypatch, cache_tmp, semaine_du_19):
    cache_tmp.parent.mkdir(parents=True)
    cache_tmp.write_text(json.dumps({"lundi": "2026-10-19", "menu": {"MARDI": "X"}}), encoding="utf-8")
    assert asyncio.run(tm.scrape()) is None  # lundi absent du menu


def test_cache_d_une_autre_semaine_ignore(monkeypatch, cache_tmp, semaine_du_19):
    cache_tmp.parent.mkdir(parents=True)
    cache_tmp.write_text(json.dumps({"lundi": "2026-10-12", "menu": {"LUNDI": "VIEUX"}}), encoding="utf-8")
    assert tm._load_cache() is None


# ── Agent vision : sortie stream-json de la CLI ──────────────────────────────

def test_resultat_stream_json():
    from agent import menu_vision_agent as mva
    sortie = "\n".join([
        json.dumps({"type": "system", "subtype": "init"}),
        "ligne parasite",
        json.dumps({"type": "assistant", "message": {}}),
        json.dumps({"type": "result", "is_error": False, "result": '{"menu": null}'}),
    ])
    assert mva._resultat_stream_json(sortie) == '{"menu": null}'
    with pytest.raises(RuntimeError):
        mva._resultat_stream_json(json.dumps({"type": "result", "is_error": True, "result": "boom"}))
    with pytest.raises(RuntimeError):
        mva._resultat_stream_json("rien")


def test_transcrire_menu_cli_envoie_l_image_en_stream_json(monkeypatch):
    from agent import menu_vision_agent as mva
    import agent.diet_agent as diet
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(diet, "CLAUDE_BIN", "/usr/bin/claude")
    vus = {}

    class Res:
        returncode, stderr = 0, ""
        stdout = json.dumps({"type": "result", "is_error": False,
                             "result": '```json\n{"periode": "DU 19 AU 25 OCTOBRE", "menu": {"LUNDI": "A"}}\n```'})

    def fake_run(cmd, **kw):
        vus["cmd"], vus["input"] = cmd, kw["input"]
        return Res()

    monkeypatch.setattr(mva.subprocess, "run", fake_run)
    data = mva.transcrire_menu(b"\xff\xd8\xffabc", "image/jpeg", 30)
    assert data == {"periode": "DU 19 AU 25 OCTOBRE", "menu": {"LUNDI": "A"}}
    assert vus["cmd"][:2] == ["/usr/bin/claude", "-p"] and "stream-json" in vus["cmd"]
    msg = json.loads(vus["input"])
    bloc = msg["message"]["content"][0]
    assert bloc["type"] == "image" and bloc["source"]["media_type"] == "image/jpeg"
