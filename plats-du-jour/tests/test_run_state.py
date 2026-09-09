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


# ── Restos optionnels (Basilic n'Go, Dubble, La Mijote) ─────────────────────

def test_labels_core_et_optionnels():
    assert run_state.CORE_LABELS == ["bistrot_trefle", "pause_gourmande", "truck_muche"]
    assert run_state.OPTIONAL_LABELS == ["basilic_ngo", "dubble", "la_mijote"]
    assert run_state.SCRAPER_LABELS == run_state.CORE_LABELS + run_state.OPTIONAL_LABELS


def test_etat_vierge_contient_les_optionnels():
    state = run_state.load(date(2026, 7, 8), "jour")
    assert set(state["scrapes"]) == set(run_state.SCRAPER_LABELS)


def _complet_core_seulement(state):
    """Les 3 restos historiques ok, les optionnels ok mais sans plat (data None)."""
    for label in run_state.CORE_LABELS:
        state["scrapes"][label] = {"ok": True, "data": {"restaurant": label, "plat": "x", "prix": "10"}, "erreur": None}
    for label in run_state.OPTIONAL_LABELS:
        state["scrapes"][label] = {"ok": True, "data": None, "erreur": None}
    state["eval"] = {"restos": sorted(run_state.CORE_LABELS), "output": {"plats": []}}
    state["commentaires_par_resto"] = {label: [] for label in run_state.CORE_LABELS}
    state["futurs_publies"] = True
    return state


def test_scrapes_ok_ignore_les_optionnels_sans_plat():
    state = _complet_core_seulement(run_state.load(date(2026, 7, 8), "jour"))
    assert run_state.scrapes_ok(state) == run_state.CORE_LABELS


def test_complet_sans_aucun_optionnel():
    state = _complet_core_seulement(run_state.load(date(2026, 7, 8), "jour"))
    assert run_state.est_complet(state)


def test_optionnel_en_echec_ne_bloque_pas_la_completude():
    state = _complet_core_seulement(run_state.load(date(2026, 7, 8), "jour"))
    state["scrapes"]["la_mijote"] = {"ok": False, "data": None, "erreur": "page figée"}
    assert run_state.est_complet(state)


def test_optionnel_avec_plat_exige_eval_et_commentaire():
    state = _complet_core_seulement(run_state.load(date(2026, 7, 8), "jour"))
    state["scrapes"]["dubble"] = {"ok": True, "data": {"restaurant": "Dubble", "plat": "Hot Bowl", "prix": "10.90€"}, "erreur": None}
    assert run_state.scrapes_ok(state) == run_state.CORE_LABELS + ["dubble"]
    assert not run_state.est_complet(state)  # éval pas alignée
    state["eval"]["restos"] = sorted(run_state.CORE_LABELS + ["dubble"])
    assert not run_state.est_complet(state)  # commentaire manquant
    state["commentaires_par_resto"]["dubble"] = []
    assert run_state.est_complet(state)


def test_core_manquant_reste_bloquant():
    state = _complet_core_seulement(run_state.load(date(2026, 7, 8), "jour"))
    state["scrapes"]["truck_muche"] = {"ok": False, "data": None, "erreur": "IG 429"}
    assert not run_state.est_complet(state)


def test_resume_compte_les_core_sur_3_et_detaille_les_optionnels():
    state = _complet_core_seulement(run_state.load(date(2026, 7, 8), "jour"))
    state["scrapes"]["basilic_ngo"] = {"ok": True, "data": {"restaurant": "Basilic n'Go", "plat": "x", "prix": "9.40€"}, "erreur": None}
    state["scrapes"]["la_mijote"] = {"ok": False, "data": None, "erreur": "page figée"}
    txt = run_state.resume(state)
    assert "scrapes 3/3" in txt
    assert "optionnels" in txt
    assert "basilic_ngo ✓" in txt
    assert "dubble —" in txt
    assert "la_mijote ✗ (page figée)" in txt


def test_load_complete_les_labels_manquants_d_un_ancien_etat(_tmp_output):
    """Un run_state écrit avant l'ajout des optionnels ne doit pas faire planter le run."""
    d = date(2026, 7, 8)
    ancien = run_state._vierge(d, "jour")
    for label in run_state.OPTIONAL_LABELS:
        del ancien["scrapes"][label]
    (_tmp_output / f"run_state_{d}.json").write_text(json.dumps(ancien), encoding="utf-8")
    state = run_state.load(d, "jour")
    assert set(state["scrapes"]) == set(run_state.SCRAPER_LABELS)
    assert state["scrapes"]["dubble"] == {"ok": False, "data": None, "erreur": None}


def test_etat_vierge_a_cartes_traitees_vide():
    state = run_state.load(date(2026, 9, 14), "semaine")
    assert state["cartes_traitees"] == []
    assert "carte_traitee" not in state


def test_migration_ancien_flag_carte_traitee(_tmp_output):
    for ancien, attendu in ((True, ["bistrot_trefle"]), (False, [])):
        state = run_state._vierge(date(2026, 9, 14), "semaine")
        del state["cartes_traitees"]
        state["carte_traitee"] = ancien
        (_tmp_output / "run_state_2026-09-14.json").write_text(json.dumps(state), encoding="utf-8")
        charge = run_state.load(date(2026, 9, 14), "semaine")
        assert charge["cartes_traitees"] == attendu
        assert "carte_traitee" not in charge
