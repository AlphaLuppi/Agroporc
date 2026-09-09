import asyncio
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
import run_state


def _run(state, fns, monkeypatch, tmp_path):
    monkeypatch.setattr(run_state, "OUTPUT_DIR", tmp_path)
    repairs = []
    monkeypatch.setattr(main.repair_team, "repair", lambda failures: repairs.append(failures))

    async def go():
        loop = asyncio.get_event_loop()
        monkeypatch.setattr(main, "_SCRAPE_FNS", {l: (lambda loop, f=f: f()) for l, f in fns.items()})
        await main._step_scrape_jour(state, loop)
    asyncio.run(go())
    return repairs


async def _ret(v):
    return v


async def _boom():
    raise RuntimeError("HTTP 500")


def test_optionnel_sans_plat_est_ok_sans_repair(monkeypatch, tmp_path):
    state = run_state.load(date(2026, 9, 9), "jour")
    plat = {"restaurant": "x", "plat": "y", "prix": "1€"}
    fns = {l: (lambda: _ret(plat)) for l in run_state.CORE_LABELS}
    fns.update({l: (lambda: _ret(None)) for l in run_state.OPTIONAL_LABELS})
    repairs = _run(state, fns, monkeypatch, tmp_path)
    assert repairs == []
    assert state["scrapes"]["dubble"] == {"ok": True, "data": None, "erreur": None}
    assert run_state.scrapes_ok(state) == run_state.CORE_LABELS


def test_core_sans_plat_reste_un_echec_avec_repair(monkeypatch, tmp_path):
    state = run_state.load(date(2026, 9, 9), "jour")
    plat = {"restaurant": "x", "plat": "y", "prix": "1€"}
    fns = {l: (lambda: _ret(plat)) for l in run_state.SCRAPER_LABELS}
    fns["truck_muche"] = lambda: _ret(None)
    repairs = _run(state, fns, monkeypatch, tmp_path)
    assert state["scrapes"]["truck_muche"]["ok"] is False
    assert repairs and "truck_muche" in repairs[0]


def test_optionnel_en_exception_est_un_echec_avec_repair(monkeypatch, tmp_path):
    state = run_state.load(date(2026, 9, 9), "jour")
    plat = {"restaurant": "x", "plat": "y", "prix": "1€"}
    fns = {l: (lambda: _ret(plat)) for l in run_state.SCRAPER_LABELS}
    fns["la_mijote"] = _boom
    repairs = _run(state, fns, monkeypatch, tmp_path)
    assert state["scrapes"]["la_mijote"]["ok"] is False
    assert "HTTP 500" in state["scrapes"]["la_mijote"]["erreur"]
    assert repairs and list(repairs[0]) == ["la_mijote"]


def test_scrape_fns_couvre_tous_les_labels():
    assert set(main._SCRAPE_FNS) == set(run_state.SCRAPER_LABELS)
