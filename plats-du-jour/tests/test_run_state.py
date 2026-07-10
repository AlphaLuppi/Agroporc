import json
from datetime import date

import pytest

import run_state


@pytest.fixture(autouse=True)
def _tmp_output(tmp_path, monkeypatch):
    monkeypatch.setattr(run_state, "OUTPUT_DIR", tmp_path)
    return tmp_path


def _complet(state):
    for label in run_state.SCRAPER_LABELS:
        state["scrapes"][label] = {"ok": True, "data": {"restaurant": label, "plat": "x", "prix": "10"}, "erreur": None}
    state["eval"] = {"restos": sorted(run_state.SCRAPER_LABELS), "output": {"plats": []}}
    state["commentaires_par_resto"] = {label: [] for label in run_state.SCRAPER_LABELS}
    state["futurs_publies"] = True
    return state


def test_etat_vierge_incomplet():
    state = run_state.load(date(2026, 7, 8), "jour")
    assert state["attempts"] == 0
    assert not run_state.est_complet(state)


def test_ferie_est_complet():
    state = run_state.load(date(2026, 7, 8), "jour")
    state["ferie"] = "Test"
    assert run_state.est_complet(state)


def test_complet_quand_tout_ok():
    state = _complet(run_state.load(date(2026, 7, 8), "jour"))  # mercredi
    assert run_state.est_complet(state)


def test_incomplet_si_scrape_manque():
    state = _complet(run_state.load(date(2026, 7, 8), "jour"))
    state["scrapes"]["truck_muche"]["ok"] = False
    assert not run_state.est_complet(state)


def test_incomplet_si_eval_en_retard():
    state = _complet(run_state.load(date(2026, 7, 8), "jour"))
    state["eval"]["restos"] = ["bistrot_trefle"]
    assert not run_state.est_complet(state)


def test_incomplet_si_commentaires_manquent():
    state = _complet(run_state.load(date(2026, 7, 8), "jour"))
    del state["commentaires_par_resto"]["truck_muche"]
    assert not run_state.est_complet(state)


def test_vendredi_sans_futurs_est_complet():
    state = _complet(run_state.load(date(2026, 7, 10), "jour"))  # vendredi
    state["futurs_publies"] = False
    assert run_state.est_complet(state)


def test_save_load_roundtrip():
    d = date(2026, 7, 8)
    state = run_state.load(d, "jour")
    state["attempts"] = 2
    run_state.save(state)
    assert run_state.load(d, "jour")["attempts"] == 2


def test_etat_corrompu_repart_de_zero(_tmp_output):
    d = date(2026, 7, 8)
    (_tmp_output / f"run_state_{d}.json").write_text("{pas du json")
    state = run_state.load(d, "jour")
    assert state["attempts"] == 0


def test_purge_garde_7_jours(_tmp_output):
    (_tmp_output / "run_state_2026-06-01.json").write_text("{}")
    (_tmp_output / "run_state_2026-07-09.json").write_text("{}")
    run_state.purge(date(2026, 7, 10))
    assert not (_tmp_output / "run_state_2026-06-01.json").exists()
    assert (_tmp_output / "run_state_2026-07-09.json").exists()


def test_resume_synthese():
    state = _complet(run_state.load(date(2026, 7, 8), "jour"))
    state["scrapes"]["truck_muche"] = {"ok": False, "data": None, "erreur": "IG 429"}
    txt = run_state.resume(state)
    assert "2/3" in txt and "truck_muche" in txt and "IG 429" in txt
