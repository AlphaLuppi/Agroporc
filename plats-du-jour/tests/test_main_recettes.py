import asyncio
import json
import sys
from datetime import date
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))

import main

PDJ = {"date": "2026-10-20", "plats": [{"restaurant": "Dubble", "plat": "Hot Bowl"}]}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for v in ("PDJ_RECETTES", "PDJ_RECETTES_BUDGET", "PDJ_RECETTES_BUDGET_RUN"):
        monkeypatch.delenv(v, raising=False)


sauts = []


def _espion_cuisiner(monkeypatch, effet=None):
    appels = []
    sauts.clear()

    def cuisiner(pdjs, budget, force=False, sauter_echecs=False):
        appels.append(([p["date"] for p in pdjs], budget, force))
        sauts.append(sauter_echecs)
        if effet:
            effet()
        return {}
    monkeypatch.setattr(main.recette_agent, "cuisiner", cuisiner)
    return appels


# ── _step_recettes ──────────────────────────────────────────────────────────

def _step(output):
    async def go():
        await main._step_recettes(asyncio.get_running_loop(), output)
    asyncio.run(go())


def test_step_recettes_appelle_cuisiner_avec_le_budget_du_run(monkeypatch):
    appels = _espion_cuisiner(monkeypatch)
    _step(PDJ)
    assert appels == [(["2026-10-20"], main.RECETTES_BUDGET_RUN_S, False)]
    assert sauts == [True]  # le run 7h30 et ses retries sautent les échecs du jour
    monkeypatch.setenv("PDJ_RECETTES_BUDGET_RUN", "30")
    _step(PDJ)
    assert appels[-1][1] == 30.0


def test_step_recettes_desactive_ou_sans_plat(monkeypatch):
    appels = _espion_cuisiner(monkeypatch)
    _step({"date": "x", "plats": [], "erreur": "Aucun plat"})
    _step({})
    monkeypatch.setenv("PDJ_RECETTES", "off")
    _step(PDJ)
    assert appels == []


def test_step_recettes_ne_leve_jamais(monkeypatch):
    appels = _espion_cuisiner(monkeypatch, effet=lambda: 1 / 0)
    _step(PDJ)  # l'exception de cuisiner est avalée
    assert len(appels) == 1


def test_run_jour_et_semaine_appellent_le_step_apres_les_images():
    import inspect
    for fn in (main.run_jour, main.run_semaine):
        src = inspect.getsource(fn)
        assert src.index("await _step_images(loop, output)") < src.index("await _step_recettes(loop, output)")


# ── run_recettes ────────────────────────────────────────────────────────────

def test_run_recettes_date_invalide():
    assert main.run_recettes("pas-une-date") == 1


def test_run_recettes_desactive(monkeypatch):
    appels = _espion_cuisiner(monkeypatch)
    monkeypatch.setattr(main, "fetch_pdj", lambda d: pytest.fail("ne doit pas lire l'API"))
    monkeypatch.setenv("PDJ_RECETTES", "off")
    assert main.run_recettes("2026-10-20") == 0
    assert appels == []


def test_run_recettes_relit_l_api_et_passe_force(monkeypatch):
    lus = []
    appels = _espion_cuisiner(monkeypatch)
    monkeypatch.setattr(main, "fetch_pdj", lambda d: lus.append(d) or {**PDJ, "date": d})
    assert main.run_recettes("2026-10-20", force=True) == 0
    assert lus == ["2026-10-20"] and appels == [(["2026-10-20"], main.RECETTES_BUDGET_COMMANDE_S, True)]


def test_run_recettes_semaine(monkeypatch):
    class Mercredi(date):
        @classmethod
        def today(cls):
            return date(2026, 10, 21)
    monkeypatch.setattr(main, "date", Mercredi)
    lus = []
    appels = _espion_cuisiner(monkeypatch)
    monkeypatch.setattr(main, "fetch_pdj", lambda d: lus.append(d) or {**PDJ, "date": d})
    assert main.run_recettes("semaine") == 0
    assert lus == ["2026-10-21", "2026-10-22", "2026-10-23"]
    assert appels[0][0] == lus and appels[0][2] is False


def test_run_recettes_sans_pdj(monkeypatch, tmp_path):
    appels = _espion_cuisiner(monkeypatch)
    monkeypatch.setattr(main, "fetch_pdj", lambda d: None)
    monkeypatch.setattr(main, "OUTPUT_FILE", tmp_path / "absent.json")
    assert main.run_recettes("2026-10-20") == 0
    assert appels == []


def test_run_recettes_repli_sur_output_file(monkeypatch, tmp_path):
    appels = _espion_cuisiner(monkeypatch)
    monkeypatch.setattr(main, "fetch_pdj", lambda d: None)
    fichier = tmp_path / "pdj.json"
    fichier.write_text(json.dumps(PDJ))
    monkeypatch.setattr(main, "OUTPUT_FILE", fichier)
    assert main.run_recettes("2026-10-20") == 0
    assert appels == [(["2026-10-20"], main.RECETTES_BUDGET_COMMANDE_S, False)]
    # pdj.json d'une autre date : pas de repli
    assert main.run_recettes("2026-10-21") == 0
    assert len(appels) == 1


def test_run_recettes_budget_env(monkeypatch):
    appels = _espion_cuisiner(monkeypatch)
    monkeypatch.setattr(main, "fetch_pdj", lambda d: {**PDJ, "date": d})
    monkeypatch.setenv("PDJ_RECETTES_BUDGET", "pas-un-nombre")
    main.run_recettes("2026-10-20")
    monkeypatch.setenv("PDJ_RECETTES_BUDGET", "90")
    main.run_recettes("2026-10-20")
    assert [a[1] for a in appels] == [main.RECETTES_BUDGET_COMMANDE_S, 90.0]


# ── main() ──────────────────────────────────────────────────────────────────

def test_main_mode_recettes(monkeypatch):
    appels = []
    monkeypatch.setattr(main, "run_recettes", lambda arg=None, force=False: appels.append((arg, force)) or 0)
    monkeypatch.setattr(sys, "argv", ["main.py", "recettes", "2026-10-20", "--force"])
    with pytest.raises(SystemExit) as e:
        main.main()
    assert e.value.code == 0 and appels == [("2026-10-20", True)]
    monkeypatch.setattr(sys, "argv", ["main.py", "recettes"])
    with pytest.raises(SystemExit):
        main.main()
    assert appels[-1] == (None, False)


# ── Cron et lock (statique) ─────────────────────────────────────────────────

def test_cron_et_lock_dedies():
    dockerfile = (RACINE / "Dockerfile").read_text()
    entree = (RACINE / "entrypoint.sh").read_text()
    assert "15 11 * * 1-5 root /entrypoint.sh recettes >> /app/logs/cron.log 2>&1" in dockerfile
    assert dockerfile.index("/entrypoint.sh images semaine") < dockerfile.index("/entrypoint.sh recettes")
    assert '[ "$MODE" = "recettes" ]' in entree
    assert "pdj_recettes.lock" in entree
    bloc = entree[entree.index('[ "$MODE" = "recettes" ]'):entree.index("else", entree.index("pdj_recettes.lock"))]
    assert "flock -n 200" in bloc and 'LIMITE="timeout -k 30 1800"' in bloc
