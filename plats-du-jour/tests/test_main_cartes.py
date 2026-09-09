import asyncio
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
import run_state

SECTIONS = [{"nom": "SALADE", "plats": [{"plat": "La César", "prix": "10.40€"}]}]
NOTEES = [{"nom": "SALADE", "plats": [{"plat": "La César", "prix": "10.40€", "note": 7}]}]


class Espion:
    def __init__(self, monkeypatch, stored_hash="abc"):
        self.evals, self.structs, self.publies = [], [], []
        monkeypatch.setattr(main, "fetch_carte_hash", lambda slug: stored_hash)
        monkeypatch.setattr(main, "publish_carte", lambda payload: self.publies.append(payload) or True)
        monkeypatch.setattr(main.diet_agent, "evaluate_carte",
                            lambda sections, restaurant: self.evals.append((sections, restaurant)) or NOTEES)
        monkeypatch.setattr(main.carte_agent, "structurer_carte",
                            lambda texte, restaurant: self.structs.append((texte, restaurant)) or SECTIONS)


def _traiter(slug, fn, force=False):
    async def go():
        await main._traiter_carte(asyncio.get_event_loop(), slug, fn, force=force)
    asyncio.run(go())


def test_hash_identique_ne_reevalue_pas(monkeypatch):
    e = Espion(monkeypatch, stored_hash="abc")
    _traiter("basilic_ngo", lambda: {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS})
    assert e.evals == [] and e.publies == []


def test_hash_different_evalue_et_publie(monkeypatch):
    e = Espion(monkeypatch, stored_hash="ancien")
    _traiter("basilic_ngo", lambda: {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS})
    assert e.evals == [(SECTIONS, "Basilic n'Go")]
    assert e.structs == []
    assert e.publies == [{"restaurant_slug": "basilic_ngo", "restaurant": "Basilic n'Go", "hash": "abc", "sections": NOTEES}]


def test_texte_brut_est_structure_avant_evaluation(monkeypatch):
    e = Espion(monkeypatch, stored_hash=None)
    _traiter("dubble", lambda: {"restaurant": "Dubble", "hash": "abc", "texte": "hot bowl 9,90"})
    assert e.structs == [("hot bowl 9,90", "Dubble")]
    assert e.evals == [(SECTIONS, "Dubble")]
    assert e.publies[0]["restaurant_slug"] == "dubble"


def test_force_reevalue_meme_hash(monkeypatch):
    e = Espion(monkeypatch, stored_hash="abc")
    _traiter("basilic_ngo", lambda: {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS}, force=True)
    assert len(e.evals) == 1 and len(e.publies) == 1


def test_scrape_ko_ou_exception_ne_publie_rien(monkeypatch):
    e = Espion(monkeypatch, stored_hash=None)
    _traiter("la_mijote", lambda: None)

    def boom():
        raise RuntimeError("HTTP 500")
    _traiter("la_mijote", boom)
    assert e.evals == [] and e.publies == []


def test_step_cartes_continue_apres_une_erreur_et_marque_les_slugs(monkeypatch, tmp_path):
    monkeypatch.setattr(run_state, "OUTPUT_DIR", tmp_path)
    e = Espion(monkeypatch, stored_hash=None)

    def boom():
        raise RuntimeError("API KO")
    monkeypatch.setattr(main, "CARTE_SOURCES", {
        "bistrot_trefle": boom,
        "basilic_ngo": lambda: {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS},
    })
    state = run_state.load(date(2026, 9, 14), "semaine")
    state["cartes_traitees"] = []

    async def go():
        await main._step_cartes(state, asyncio.get_event_loop())
    asyncio.run(go())

    assert state["cartes_traitees"] == ["bistrot_trefle", "basilic_ngo"]
    assert [p["restaurant_slug"] for p in e.publies] == ["basilic_ngo"]


def test_step_cartes_saute_les_slugs_deja_traites(monkeypatch, tmp_path):
    monkeypatch.setattr(run_state, "OUTPUT_DIR", tmp_path)
    e = Espion(monkeypatch, stored_hash=None)
    appels = []
    monkeypatch.setattr(main, "CARTE_SOURCES", {
        "basilic_ngo": lambda: appels.append(1) or {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS},
    })
    state = run_state.load(date(2026, 9, 14), "semaine")
    state["cartes_traitees"] = ["basilic_ngo"]

    async def go():
        await main._step_cartes(state, asyncio.get_event_loop())
    asyncio.run(go())
    assert appels == [] and e.publies == []


def test_run_cartes_slug_inconnu(monkeypatch):
    Espion(monkeypatch)
    assert asyncio.run(main.run_cartes("tholean", force=False)) == 1


def test_step_cartes_dict_incomplet_ne_leve_pas(monkeypatch, tmp_path):
    """Un scraper renvoyant un dict sans "restaurant" (ni "sections"/"texte") ne doit
    jamais faire remonter d'exception jusqu'à _step_cartes (cf. run_semaine)."""
    monkeypatch.setattr(run_state, "OUTPUT_DIR", tmp_path)
    e = Espion(monkeypatch, stored_hash=None)
    monkeypatch.setattr(main, "CARTE_SOURCES", {
        "dubble": lambda: {"hash": "abc"},
    })
    state = run_state.load(date(2026, 9, 14), "semaine")
    state["cartes_traitees"] = []

    async def go():
        await main._step_cartes(state, asyncio.get_event_loop())
    asyncio.run(go())

    assert state["cartes_traitees"] == ["dubble"]
    assert e.publies == []


def test_run_cartes_scraper_ko_renvoie_1(monkeypatch):
    Espion(monkeypatch, stored_hash="abc")
    monkeypatch.setattr(main, "CARTE_SOURCES", {
        "dubble": lambda: None,
    })
    assert asyncio.run(main.run_cartes("dubble", force=False)) == 1
