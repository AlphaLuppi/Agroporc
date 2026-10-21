import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
import plat_image as pi
from agent import image_agent

JPEG = b"\xff\xd8\xff" + b"\0" * 6000
PDJ = {"date": "2026-10-20", "plats": [
    {"restaurant": "Le Truck Muche", "plat": "POKE BOWL"},
    {"restaurant": "Le Bistrot Trèfle", "plat": "Blanquette de veau"},
    {"restaurant": "La Pause Gourmande", "plat": "Coming soon", "coming_soon": True},
]}


class Espion:
    def __init__(self, monkeypatch, existantes=frozenset(), generer=None, publier_ok=True,
                 descriptions=None):
        self.generes, self.publies, self.demandes, self.decrits = [], [], [], []
        self.descriptions_recues = {}

        def _existantes(cles):
            self.demandes.append(list(cles))
            return None if existantes is None else set(existantes)

        def _generer(restaurant, plat, deadline, description=None):
            self.generes.append(plat)
            self.descriptions_recues[plat] = description
            if generer:
                return generer(restaurant, plat)
            return {"prompt": "p", "fournisseur": "test", "content_type": "image/jpeg", "data": JPEG}

        monkeypatch.setattr(image_agent, "fetch_plat_images_existantes", _existantes)
        monkeypatch.setattr(image_agent, "generer", _generer)
        monkeypatch.setattr(image_agent, "decrire",
                            lambda items, timeout: self.decrits.append([it["plat"] for it in items])
                            or dict(descriptions or {}))
        monkeypatch.setattr(image_agent, "publish_plat_image",
                            lambda payload: self.publies.append(payload) or publier_ok)


def test_saute_les_images_existantes_et_coming_soon(monkeypatch):
    e = Espion(monkeypatch, existantes={pi.cle_image("Le Truck Muche", "POKE BOWL")})
    bilan = image_agent.illustrer([PDJ], budget_s=60)
    assert e.generes == ["Blanquette de veau"]
    assert bilan == {"a_faire": 1, "deja": 1, "ok": 1, "echecs": 0, "restantes": 0}
    p = e.publies[0]
    assert p["cle"] == pi.cle_image("Le Bistrot Trèfle", "Blanquette de veau")
    assert p["restaurant"] == "Le Bistrot Trèfle" and p["force"] is False
    assert p["image_base64"]


def test_force_ne_consulte_pas_l_api_et_regenere_tout(monkeypatch):
    e = Espion(monkeypatch, existantes={pi.cle_image("Le Truck Muche", "POKE BOWL")})
    image_agent.illustrer([PDJ], budget_s=60, force=True)
    assert e.demandes == [] and e.generes == ["POKE BOWL", "Blanquette de veau"]
    assert all(p["force"] for p in e.publies)


def test_api_injoignable_ne_genere_rien(monkeypatch):
    e = Espion(monkeypatch, existantes=None)
    bilan = image_agent.illustrer([PDJ], budget_s=60)
    assert e.generes == [] and bilan["restantes"] == 2


def test_echec_fournisseur_ne_remonte_pas(monkeypatch):
    def boum(restaurant, plat):
        if plat == "POKE BOWL":
            raise RuntimeError("402 FREE_LIMIT")
        return {"prompt": "p", "fournisseur": "test", "content_type": "image/jpeg", "data": JPEG}
    e = Espion(monkeypatch, generer=boum)
    bilan = image_agent.illustrer([PDJ], budget_s=60)
    assert bilan["echecs"] == 1 and bilan["ok"] == 1
    assert [p["plat"] for p in e.publies] == ["Blanquette de veau"]


def test_budget_epuise_s_arrete(monkeypatch):
    e = Espion(monkeypatch)
    bilan = image_agent.illustrer([PDJ], budget_s=0)
    assert e.generes == [] and bilan["restantes"] == 2


def test_max_images(monkeypatch):
    e = Espion(monkeypatch)
    bilan = image_agent.illustrer([PDJ], budget_s=60, max_images=1)
    assert len(e.publies) == 1 and bilan["restantes"] == 1


def test_generer_passe_au_fournisseur_suivant(monkeypatch):
    monkeypatch.setenv("PDJ_IMAGES_FOURNISSEURS", "cloudflare,pollinations")
    appels = []

    def cf(prompt, seed, deadline):
        appels.append("cloudflare")
        raise image_agent.Indisponible("pas de compte")

    def poll(prompt, seed, deadline):
        appels.append("pollinations")
        return JPEG

    monkeypatch.setitem(image_agent.FOURNISSEURS, "cloudflare", cf)
    monkeypatch.setitem(image_agent.FOURNISSEURS, "pollinations", poll)
    res = image_agent.generer("Le Truck Muche", "POKE BOWL", deadline=float("inf"))
    assert appels == ["cloudflare", "pollinations"]
    assert res["fournisseur"] == "pollinations" and res["content_type"] == "image/jpeg"
    assert 'Poke bowl' in res["prompt"] and '"' not in res["prompt"]


def test_generer_refuse_une_reponse_non_image(monkeypatch):
    monkeypatch.setenv("PDJ_IMAGES_FOURNISSEURS", "pollinations")
    monkeypatch.setitem(image_agent.FOURNISSEURS, "pollinations", lambda p, s, d: b'{"error":"x"}' * 500)
    try:
        image_agent.generer("Dubble", "Hot Bowl", deadline=float("inf"))
        assert False, "aurait dû lever"
    except RuntimeError as e:
        assert "non image" in str(e)


def test_fournisseurs_actifs(monkeypatch):
    for v in ("PDJ_IMAGES_FOURNISSEURS", "CF_ACCOUNT_ID", "CF_API_TOKEN", "AIHORDE_API_KEY", "PDJ_IMAGES_HORDE_ANONYME"):
        monkeypatch.delenv(v, raising=False)
    assert image_agent.fournisseurs_actifs() == ["pollinations"]
    monkeypatch.setenv("CF_ACCOUNT_ID", "a")
    monkeypatch.setenv("CF_API_TOKEN", "b")
    monkeypatch.setenv("AIHORDE_API_KEY", "c")
    assert image_agent.fournisseurs_actifs() == ["cloudflare", "horde", "pollinations"]
    monkeypatch.setenv("PDJ_IMAGES_FOURNISSEURS", "horde, inconnu")
    assert image_agent.fournisseurs_actifs() == ["horde"]


# ── Branchement dans main.py ────────────────────────────────────────────────

def test_step_images_ne_leve_jamais_et_respecte_pdj_images_off(monkeypatch):
    appels = []
    monkeypatch.setattr(main.image_agent, "illustrer", lambda pdjs, budget: appels.append(budget) or 1 / 0)

    async def go():
        await main._step_images(asyncio.get_event_loop(), PDJ)
    asyncio.run(go())  # l'exception d'illustrer est avalée
    assert appels == [main.IMAGES_BUDGET_RUN_S]

    monkeypatch.setenv("PDJ_IMAGES", "off")
    asyncio.run(go())
    assert len(appels) == 1


def test_step_images_ignore_un_pdj_sans_plats(monkeypatch):
    appels = []
    monkeypatch.setattr(main.image_agent, "illustrer", lambda *a, **k: appels.append(a))
    asyncio.run(main._step_images(None, {"date": "x", "plats": [], "erreur": "Aucun plat"}))
    assert appels == []


def test_dates_images():
    from datetime import date
    mercredi = date(2026, 10, 21)
    assert main._dates_images(None, mercredi) == ["2026-10-21"]
    semaine = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]
    assert main._dates_images("semaine", mercredi) == semaine  # jours passés compris
    assert main._dates_images("semaine", date(2026, 10, 24)) == semaine  # samedi
    assert main._dates_images("2026-10-16..2026-10-20", mercredi) == [
        "2026-10-16", "2026-10-19", "2026-10-20"]  # week-end sauté
    import pytest
    with pytest.raises(ValueError):
        main._dates_images("2026-10-20..2026-10-16", mercredi)
    assert main._dates_images("2026-10-19", mercredi) == ["2026-10-19"]


def test_run_images_relit_l_api_et_passe_force(monkeypatch):
    lus, appels = [], []
    monkeypatch.setattr(main, "fetch_pdj", lambda d: lus.append(d) or {**PDJ, "date": d})
    monkeypatch.setattr(main.image_agent, "illustrer",
                        lambda pdjs, budget, force=False: appels.append(([p["date"] for p in pdjs], force)))
    assert main.run_images("2026-10-20", force=True) == 0
    assert lus == ["2026-10-20"] and appels == [(["2026-10-20"], True)]
    assert main.run_images("pas-une-date") == 1


class _Resp:
    def __init__(self, status, content=b"", text="", headers=None):
        self.status_code, self.content, self.text, self.headers = status, content, text, headers or {}

    def iter_content(self, taille):
        for i in range(0, len(self.content), taille):
            yield self.content[i:i + taille]

    def close(self):
        pass


def _pollinations_simule(monkeypatch, reponses):
    attentes = []
    monkeypatch.setattr(image_agent.requests, "get", lambda *a, **k: reponses.pop(0))
    horloge = [1000.0]
    monkeypatch.setattr(image_agent.time, "monotonic", lambda: horloge[0])

    def dormir(s):
        attentes.append(round(s))
        horloge[0] += s
    monkeypatch.setattr(image_agent.time, "sleep", dormir)
    monkeypatch.setattr(image_agent, "_dernier_appel_pollinations", 0.0)
    return attentes


def test_pollinations_402_attend_l_intervalle_complet_malgre_retry_after(monkeypatch):
    attentes = _pollinations_simule(monkeypatch, [
        _Resp(402, text='{"error":{"message":"Free limit reached. Retry after 8s"}}'),
        _Resp(402, text='{"error":{"message":"Free limit reached. Retry after 8s"}}'),
        _Resp(200, content=JPEG),
    ])
    assert image_agent._pollinations("p", 1, deadline=5000.0) == JPEG
    assert attentes == [46, 61]  # refus = fenêtre relancée, + 15 s par essai


def test_pollinations_503_respecte_retry_after(monkeypatch):
    attentes, reponses = [], [
        _Resp(503, text='{"error":{"message":"Classic API is at its limit, retry after 8s"}}'),
        _Resp(200, content=JPEG),
    ]
    monkeypatch.setattr(image_agent.requests, "get", lambda *a, **k: reponses.pop(0))
    horloge = [1000.0]
    monkeypatch.setattr(image_agent.time, "monotonic", lambda: horloge[0])

    def dormir(s):
        attentes.append(round(s))
        horloge[0] += s
    monkeypatch.setattr(image_agent.time, "sleep", dormir)
    monkeypatch.setattr(image_agent, "_dernier_appel_pollinations", 0.0)
    assert image_agent._pollinations("p", 1, deadline=5000.0) == JPEG
    assert attentes == [10]  # 8 s demandées + 2 s de marge, pas l'intervalle complet


def test_pollinations_erreur_non_retentable(monkeypatch):
    appels = []
    monkeypatch.setattr(image_agent.requests, "get", lambda *a, **k: appels.append(1) or _Resp(400, text="bad"))
    monkeypatch.setattr(image_agent, "_dernier_appel_pollinations", 0.0)
    try:
        image_agent._pollinations("p", 1, deadline=image_agent.time.monotonic() + 600)
        assert False
    except image_agent.Indisponible:
        pass
    assert appels == [1]


# ── Budgets par fournisseur, lectures bornées (revue) ───────────────────────

def test_sous_deadline_plafonne_et_reserve_le_suivant():
    sd = image_agent.sous_deadline_fournisseur
    # Horde dans une commande de 1500 s : plafonné à 300 s
    assert sd("horde", 0.0, 1500.0, dernier=False) == 300.0
    # budget court : on garde 60 s pour le fournisseur suivant
    assert sd("cloudflare", 0.0, 140.0, dernier=False) == 80.0
    # dernier fournisseur : tout le restant (dans la limite de son plafond)
    assert sd("pollinations", 0.0, 150.0, dernier=True) == 150.0


def test_horde_saute_si_budget_court_et_pollinations_essaye(monkeypatch):
    monkeypatch.setenv("PDJ_IMAGES_FOURNISSEURS", "horde,pollinations")
    appels = []
    monkeypatch.setattr(image_agent.time, "monotonic", lambda: 0.0)
    monkeypatch.setitem(image_agent.FOURNISSEURS, "horde", lambda p, s, d: appels.append(("horde", d)) or JPEG)
    monkeypatch.setitem(image_agent.FOURNISSEURS, "pollinations", lambda p, s, d: appels.append(("pollinations", d)) or JPEG)
    res = image_agent.generer("Dubble", "Hot Bowl", deadline=150.0)  # budget du run 7h30
    assert res["fournisseur"] == "pollinations" and appels == [("pollinations", 150.0)]


def test_horde_lent_laisse_du_temps_a_pollinations(monkeypatch):
    monkeypatch.setenv("PDJ_IMAGES_FOURNISSEURS", "horde,pollinations")
    vus = []
    monkeypatch.setattr(image_agent.time, "monotonic", lambda: 0.0)

    def horde(p, s, d):
        vus.append(("horde", d))
        raise TimeoutError("lent")
    monkeypatch.setitem(image_agent.FOURNISSEURS, "horde", horde)
    monkeypatch.setitem(image_agent.FOURNISSEURS, "pollinations", lambda p, s, d: vus.append(("pollinations", d)) or JPEG)
    assert image_agent.generer("Dubble", "Hot Bowl", deadline=1500.0)["fournisseur"] == "pollinations"
    assert vus == [("horde", 300.0), ("pollinations", 300.0)]


def test_lecture_bornee():
    assert image_agent._lire_borne(_Resp(200, content=JPEG)) == JPEG
    for r in (_Resp(200, content=b"x" * 101), _Resp(200, content=b"x", headers={"Content-Length": "999"})):
        try:
            image_agent._lire_borne(r, maximum=100)
            assert False
        except ValueError as e:
            assert "trop grosse" in str(e)


def test_url_horde_sure():
    assert image_agent._url_horde_sure("https://abc.r2.cloudflarestorage.com/x.webp?sig=1")
    assert not image_agent._url_horde_sure("http://abc.r2.cloudflarestorage.com/x.webp")
    assert not image_agent._url_horde_sure("https://169.254.169.254/latest")
    assert not image_agent._url_horde_sure("https://evil.example/r2.cloudflarestorage.com")
    assert not image_agent._url_horde_sure(None)


def test_un_pdj_mal_forme_ne_bloque_pas_les_autres(monkeypatch):
    e = Espion(monkeypatch)
    casse = {"date": "x", "plats": "pas une liste de dicts"}
    original = pi.a_illustrer

    def a_illustrer(pdj):
        if pdj is casse:
            raise RuntimeError("boom")
        return original(pdj)
    monkeypatch.setattr(image_agent.plat_image, "a_illustrer", a_illustrer)
    bilan = image_agent.illustrer([casse, PDJ], budget_s=60)
    assert bilan["ok"] == 2 and e.generes == ["POKE BOWL", "Blanquette de veau"]


def test_descriptions_llm_transmises_aux_seules_images_a_faire(monkeypatch):
    cle = pi.cle_image("Le Bistrot Trèfle", "Blanquette de veau")
    e = Espion(monkeypatch, existantes={pi.cle_image("Le Truck Muche", "POKE BOWL")},
               descriptions={cle: "veal chunks in creamy white sauce"})
    image_agent.illustrer([PDJ], budget_s=60)
    assert e.decrits == [["Blanquette de veau"]]
    assert e.descriptions_recues == {"Blanquette de veau": "veal chunks in creamy white sauce"}


def test_decrire_llm_en_echec_renvoie_vide(monkeypatch):
    def boum(prompt, timeout):
        raise RuntimeError("LLM down")
    monkeypatch.setattr(image_agent, "_appel_llm", boum)
    items = [{"cle": "a" * 24, "restaurant": "Dubble", "plat": "Hot Bowl"}]
    assert image_agent.decrire(items, timeout=60) == {}
    monkeypatch.setattr(image_agent, "_appel_llm", lambda p, t: '{"%s": "a steaming curry bowl with rice"}' % ("a" * 24))
    assert image_agent.decrire(items, timeout=60) == {"a" * 24: "a steaming curry bowl with rice"}
    assert image_agent.decrire(items, timeout=5) == {}  # budget trop court : pas d'appel
