# Fiabilisation pipeline PDJ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la pipeline PDJ reprenable (état de run idempotent) avec retries cron 7h45→10h00, lock global anti-parallélisme, et statut `partial` sur /admin.

**Architecture:** Un fichier d'état par jour (`output/run_state_<date>.json`, volume Docker) mémorise ce qui a réussi ; `main.py` ne refait que ce qui manque et sort avec un code (0=complet, 3=partiel, 4=no-op). `entrypoint.sh` prend un `flock` sur le volume partagé, mappe les codes vers `success`/`partial`/`error` et ne reporte pas les no-op.

**Tech Stack:** Python 3 (asyncio, pytest), Bash (flock), Next.js 15 (routes API), Docker cron.

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-10-fiabilisation-pipeline-design.md`
- Jamais deux runs pipeline en parallèle (flock sur `output/pdj_run.lock`).
- Un retry no-op doit coûter ~2 s et ne pas reporter vers /admin.
- Après un scrape réussi, le resto n'est JAMAIS re-scrapé le même jour (ni Instagram re-sollicité).
- `repair_team` lancée une seule fois par jour (premier run avec échecs).
- Tout texte UI/messages en français ; dates `YYYY-MM-DD`.
- Codes de sortie main.py : `0`=complet, `3`=partiel (a travaillé, incomplet), `4`=no-op (déjà complet).

---

### Task 1: Module `run_state.py` + tests

**Files:**
- Create: `plats-du-jour/run_state.py`
- Test: `plats-du-jour/tests/test_run_state.py`

**Interfaces:**
- Produces: `load(d: date, mode: str) -> dict`, `save(state: dict) -> None`,
  `purge(today: date) -> None`, `est_complet(state: dict) -> bool`,
  `scrapes_ok(state: dict) -> list[str]`, `resume(state: dict) -> str`,
  `SCRAPER_LABELS = ["bistrot_trefle", "pause_gourmande", "truck_muche"]`,
  `OUTPUT_DIR: Path` (surchargeable en test).

- [ ] **Step 1: Écrire les tests (échec attendu)**

`plats-du-jour/tests/test_run_state.py` :

```python
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
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd plats-du-jour && source .venv/bin/activate && python -m pytest tests/test_run_state.py -v`
Expected: FAIL (`ModuleNotFoundError: run_state`)

- [ ] **Step 3: Implémenter `run_state.py`**

```python
"""État de run quotidien — source de vérité intra-journée pour la reprise.

Le fichier output/run_state_<date>.json enregistre ce qui a réussi (scrapes,
éval, commentaires, jours futurs) pour que les retries ne refassent que le
travail manquant.
"""
import json
from datetime import date as date_cls, timedelta
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
RETENTION_JOURS = 7
SCRAPER_LABELS = ["bistrot_trefle", "pause_gourmande", "truck_muche"]


def _state_file(date_str: str) -> Path:
    return OUTPUT_DIR / f"run_state_{date_str}.json"


def _vierge(d: date_cls, mode: str) -> dict:
    return {
        "date": str(d),
        "mode": mode,
        "attempts": 0,
        "ferie": None,
        "scrapes": {label: {"ok": False, "data": None, "erreur": None} for label in SCRAPER_LABELS},
        "semaine": {"trefle": None, "truck": None},
        "eval": {"restos": [], "output": None},
        "commentaires_par_resto": {},
        "futurs_publies": False,
        "carte_traitee": False,
        "repair_lancee": False,
        "reset_semaine_fait": False,
    }


def load(d: date_cls, mode: str) -> dict:
    f = _state_file(str(d))
    if f.exists():
        try:
            state = json.loads(f.read_text(encoding="utf-8"))
            if state.get("date") == str(d):
                return state
        except Exception as e:
            print(f"[run_state] État illisible ({e}) — repart de zéro")
    return _vierge(d, mode)


def save(state: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    f = _state_file(state["date"])
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(f)


def purge(today: date_cls) -> None:
    """Supprime les états de plus de RETENTION_JOURS jours."""
    seuil = today - timedelta(days=RETENTION_JOURS)
    for f in OUTPUT_DIR.glob("run_state_*.json"):
        try:
            d = date_cls.fromisoformat(f.stem.removeprefix("run_state_"))
        except ValueError:
            continue
        if d < seuil:
            try:
                f.unlink()
            except OSError:
                pass


def scrapes_ok(state: dict) -> list[str]:
    return [l for l in SCRAPER_LABELS if state["scrapes"][l]["ok"]]


def _weekday(state: dict) -> int:
    return date_cls.fromisoformat(state["date"]).weekday()


def est_complet(state: dict) -> bool:
    """Complet = férié, OU 3 scrapes ok + éval à jour + commentaires partout
    + jours futurs publiés (sauf vendredi/week-end)."""
    if state.get("ferie"):
        return True
    ok = scrapes_ok(state)
    if len(ok) < len(SCRAPER_LABELS):
        return False
    if sorted(state["eval"]["restos"]) != sorted(ok):
        return False
    if any(l not in state["commentaires_par_resto"] for l in ok):
        return False
    if _weekday(state) < 4 and not state["futurs_publies"]:
        return False
    return True


def resume(state: dict) -> str:
    """Ligne de synthèse pour le log, ex. :
    scrapes 2/3 (truck_muche: IG 429) · éval 1/2 · commentaires 2/2 · futurs non"""
    ok = scrapes_ok(state)
    rates = [
        f"{l}: {state['scrapes'][l].get('erreur') or 'échec'}"
        for l in SCRAPER_LABELS if not state["scrapes"][l]["ok"]
    ]
    partie_scrapes = f"scrapes {len(ok)}/{len(SCRAPER_LABELS)}"
    if rates:
        partie_scrapes += f" ({', '.join(rates)})"
    n_eval = len([l for l in ok if l in state["eval"]["restos"]])
    n_comm = len([l for l in ok if l in state["commentaires_par_resto"]])
    futurs = "oui" if state["futurs_publies"] else "non"
    return (f"{partie_scrapes} · éval {n_eval}/{len(ok)} · "
            f"commentaires {n_comm}/{len(ok)} · futurs {futurs}")
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `python -m pytest tests/test_run_state.py -v`
Expected: 11 PASS

- [ ] **Step 5: Commit**

```bash
git add plats-du-jour/run_state.py plats-du-jour/tests/test_run_state.py
git commit -m "feat(pipeline): module run_state — état de run quotidien reprenable"
```

---

### Task 2: Refactor `main.py` — étapes idempotentes partagées + `run_jour`

**Files:**
- Modify: `plats-du-jour/main.py`

**Interfaces:**
- Consumes: tout `run_state` (Task 1).
- Produces: `EXIT_OK = 0`, `EXIT_PARTIAL = 3`, `EXIT_NOOP = 4` ;
  `run_jour(retry: bool = False) -> int` ; helpers async
  `_step_scrape_jour(state, loop)`, `_step_eval(state, loop) -> dict`,
  `_step_commentaires(state, loop, output) -> dict`,
  `_step_futurs(state, loop)` réutilisés par Task 3.
  `main()` accepte le flag `--retry` et propage le code via `sys.exit`.

- [ ] **Step 1: Ajouter constantes + import**

En tête de `main.py` (après les imports existants) :

```python
import run_state

EXIT_OK = 0        # journée complète
EXIT_PARTIAL = 3   # a travaillé mais il manque des données
EXIT_NOOP = 4      # état déjà complet, rien fait
```

- [ ] **Step 2: Écrire les helpers d'étapes**

Remplacer le corps scraping/éval/commentaires dupliqué de `run_jour`/`run_semaine` par ces helpers (ajoutés dans la section « Utilitaires communs ») :

```python
_SCRAPE_FNS = {
    "bistrot_trefle": lambda loop: loop.run_in_executor(None, bistrot_trefle.scrape),
    "pause_gourmande": lambda loop: pause_gourmande.scrape(),
    "truck_muche": lambda loop: truck_muche.scrape(),
}


async def _step_scrape_jour(state: dict, loop) -> None:
    """Scrape uniquement les restos pas encore ok ; repair_team une fois par jour."""
    a_faire = [l for l in run_state.SCRAPER_LABELS if not state["scrapes"][l]["ok"]]
    if not a_faire:
        return
    results = await asyncio.gather(*(_SCRAPE_FNS[l](loop) for l in a_faire), return_exceptions=True)
    failures = {}
    for label, r in zip(a_faire, results):
        if isinstance(r, Exception):
            print(f"[pipeline] Erreur {label} : {r}")
            err = traceback.format_exception_only(type(r), r)[-1].strip()
            state["scrapes"][label] = {"ok": False, "data": None, "erreur": err}
            failures[label] = err
        elif r is None:
            print(f"[pipeline] {label} n'a rien retourné")
            state["scrapes"][label] = {"ok": False, "data": None, "erreur": "scrape() a retourné None"}
            failures[label] = "scrape() a retourné None"
        else:
            state["scrapes"][label] = {"ok": True, "data": r, "erreur": None}
    run_state.save(state)
    if failures and not state["repair_lancee"]:
        print(f"[pipeline] {len(failures)} scraper(s) en échec → lancement de la repair team...")
        state["repair_lancee"] = True
        run_state.save(state)
        await loop.run_in_executor(None, repair_team.repair, failures)


async def _step_eval(state: dict, loop) -> dict:
    """Évalue si l'ensemble des restos scrapés a changé ; sinon réutilise l'état.
    Retourne l'output du jour (dégradé si l'éval échoue) et l'écrit/archive."""
    ok = run_state.scrapes_ok(state)
    plats = [state["scrapes"][l]["data"] for l in ok]
    if not plats:
        output = {"date": state["date"], "erreur": "Aucun plat du jour récupéré",
                  "plats": [], "recommandation": None}
        return output
    if sorted(state["eval"]["restos"]) == sorted(ok) and state["eval"]["output"]:
        print("[pipeline] Évaluation déjà à jour, réutilisée")
        evaluation = state["eval"]["output"]
    else:
        print("[pipeline] Évaluation par l'agent diététicien...")
        try:
            evaluation = await loop.run_in_executor(None, diet_agent.evaluate, plats)
            state["eval"] = {"restos": ok, "output": evaluation}
            run_state.save(state)
        except Exception as e:
            # Non publiée telle quelle : plats sans scores (mode dégradé), éval
            # retentée au prochain retry (state["eval"] non mis à jour).
            print(f"[pipeline] Erreur agent (non publiée) : {e}")
            evaluation = {"plats": plats, "recommandation": None}
    output = {"date": state["date"], **evaluation}
    _archiver_et_ecrire(output)
    return output


def _archiver_et_ecrire(output: dict) -> None:
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    if OUTPUT_FILE.exists():
        try:
            old = json.loads(OUTPUT_FILE.read_text())
            old_date = old.get("date", "inconnu")
            if old_date != output.get("date"):
                archive = HISTORY_DIR / f"pdj_{old_date}.json"
                archive.write_text(OUTPUT_FILE.read_text())
                print(f"[pipeline] Archivé → {archive.name}")
        except Exception as e:
            print(f"[pipeline] Avertissement archivage : {e}")
    OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(f"[pipeline] Résultat écrit dans {OUTPUT_FILE}")


async def _step_commentaires(state: dict, loop, output: dict) -> dict:
    """Génère les commentaires des restos qui n'en ont pas encore, merge le tout."""
    ok = run_state.scrapes_ok(state)
    manquants = [l for l in ok if l not in state["commentaires_par_resto"]]
    if manquants:
        input_plats = [
            {"restaurant": state["scrapes"][l]["data"]["restaurant"],
             "plat": state["scrapes"][l]["data"]["plat"],
             "prix": state["scrapes"][l]["data"]["prix"]}
            for l in manquants
        ]
        nom_vers_label = {state["scrapes"][l]["data"]["restaurant"]: l for l in manquants}
        print(f"[pipeline] Génération des commentaires pour {len(manquants)} resto(s)...")
        try:
            nouveaux = await loop.run_in_executor(
                None, comment_agent.generate_commentaires_jour, input_plats)
            for c in nouveaux:
                label = nom_vers_label.get(c.get("restaurant", ""))
                if label:
                    state["commentaires_par_resto"][label] = [c]
            run_state.save(state)
        except Exception as e:
            print(f"[pipeline] Erreur commentaires jour : {e}")
    commentaires = [c for lst in state["commentaires_par_resto"].values() for c in lst]
    if commentaires:
        today_name = DAY_NAMES[_weekday_of(state)] if _weekday_of(state) < 5 else None
        if today_name:
            _persist_day_comments(today_name, commentaires)
        output = comment_agent.merge_commentaires(output, commentaires, None)
        OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))
        print("[pipeline] Commentaires fusionnés dans pdj.json")
    return output


def _weekday_of(state: dict) -> int:
    return date.fromisoformat(state["date"]).weekday()
```

Note : `merge_commentaires` attend `[{restaurant, commentaires}, …]` — on stocke
donc l'entrée complète du resto (`[c]`) dans `commentaires_par_resto[label]`.

- [ ] **Step 3: Réécrire `_publier_jours_futurs` en `_step_futurs`**

Remplace l'actuel `_publier_jours_futurs` (même logique, mais données semaine
lues/écrites dans l'état et flag `futurs_publies`) :

```python
async def _step_futurs(state: dict, loop) -> None:
    """Évalue et publie les jours futurs une seule fois (flag futurs_publies)."""
    today_idx = _weekday_of(state)
    if today_idx >= 4:
        state["futurs_publies"] = True
        run_state.save(state)
        return
    if state["futurs_publies"]:
        return

    if state["semaine"]["trefle"] is None:
        try:
            state["semaine"]["trefle"] = await loop.run_in_executor(None, bistrot_trefle.scrape_semaine)
            run_state.save(state)
        except Exception as e:
            print(f"[pipeline:futurs] Erreur scrape_semaine Trèfle : {e}")
    if state["semaine"]["truck"] is None:
        try:
            state["semaine"]["truck"] = await truck_muche.scrape_semaine()
            run_state.save(state)
        except Exception as e:
            print(f"[pipeline:futurs] Erreur scrape_semaine Truck : {e}")

    trefle_semaine = state["semaine"]["trefle"]
    truck_semaine = state["semaine"]["truck"]
    if not trefle_semaine and not truck_semaine:
        print("[pipeline:futurs] Aucune donnée semaine disponible, retenté au prochain run")
        return

    future_days = {}
    for day_name in DAY_NAMES[today_idx + 1:]:
        plats_jour = []
        if trefle_semaine and day_name in trefle_semaine:
            t = trefle_semaine[day_name]
            plats_jour.append({"restaurant": "Le Bistrot Trèfle", "plat": t["plat"], "prix": t["prix"]})
        if truck_semaine and day_name in truck_semaine:
            t = truck_semaine[day_name]
            plats_jour.append({"restaurant": "Le Truck Muche", "plat": t["plat"], "prix": t["prix"]})
        if plats_jour:
            future_days[day_name] = plats_jour

    future_evaluations = {}
    eval_ok = True
    if future_days:
        print(f"[pipeline:futurs] Évaluation des plats de {len(future_days)} jours futurs...")
        try:
            future_evaluations = await loop.run_in_executor(
                None, diet_agent.evaluate_semaine, future_days)
        except Exception as e:
            print(f"[pipeline:futurs] Erreur évaluation semaine : {e}")
            eval_ok = False

    for i, day_name in enumerate(DAY_NAMES[today_idx + 1:], start=1):
        future_date = date.fromisoformat(state["date"]) + timedelta(days=i)
        ferie_nom = est_ferie(future_date)
        if ferie_nom:
            publish_pdj({"date": str(future_date), "ferie": ferie_nom, "plats": []})
            print(f"[pipeline:futurs] Jour férié publié : {day_name} ({future_date}) — {ferie_nom}")
            continue
        day_eval = future_evaluations.get(day_name, {})
        day_plats = day_eval.get("plats", future_days.get(day_name, []))
        day_plats.append({"restaurant": "La Pause Gourmande", "plat": "Coming soon",
                          "prix": "", "coming_soon": True})
        publish_pdj({
            "date": str(future_date),
            "plats": day_plats,
            "recommandation": day_eval.get("recommandation"),
            "recommandation_goulaf": day_eval.get("recommandation_goulaf"),
        })
        print(f"[pipeline:futurs] Jour futur publié : {day_name} ({future_date})")

    # Publié en dégradé si l'éval a échoué : on laisse le flag à False pour
    # que le prochain retry ré-évalue et republie proprement.
    if eval_ok:
        state["futurs_publies"] = True
        run_state.save(state)
```

- [ ] **Step 4: Réécrire `run_jour`**

```python
async def run_jour(retry: bool = False) -> int:
    """Scrape/évalue/commente ce qui manque, publie l'agrégat courant."""
    today = date.today()
    run_state.purge(today)
    state = run_state.load(today, "jour")

    if run_state.est_complet(state):
        print(f"[pipeline:jour] Déjà complet ({run_state.resume(state)}) — rien à faire")
        return EXIT_NOOP

    ferie = est_ferie(today)
    if ferie:
        print(f"[pipeline:jour] Jour férié ({ferie}) — pas de scraping")
        state["ferie"] = ferie
        run_state.save(state)
        return EXIT_OK

    state["attempts"] += 1
    run_state.save(state)
    print(f"[pipeline:jour] Démarrage (tentative {state['attempts']})...")

    loop = asyncio.get_event_loop()
    await _step_scrape_jour(state, loop)
    print(f"[pipeline:jour] {len(run_state.scrapes_ok(state))}/3 plats récupérés")

    output = await _step_eval(state, loop)
    output = await _step_commentaires(state, loop, output)

    pause = state["scrapes"]["pause_gourmande"]["data"]
    if pause:
        maj_message_jour({"plat": pause["plat"], "prix": pause["prix"]})

    await _step_futurs(state, loop)
    publish_pdj(output)

    try:
        await loop.run_in_executor(None, idee_agent.evaluer_idees)
    except Exception as e:
        print(f"[pipeline:jour] Erreur évaluation idées : {e}")

    complet = run_state.est_complet(state)
    print(f"[état] {run_state.resume(state)}")
    return EXIT_OK if complet else EXIT_PARTIAL
```

Supprimer l'ancien `_evaluer_et_sauver` et l'ancien `_publier_jours_futurs`
(remplacés par `_step_eval`/`_archiver_et_ecrire`/`_step_futurs`).

- [ ] **Step 5: Mettre à jour `main()`**

```python
    retry = "--retry" in sys.argv
    if mode == "semaine":
        sys.exit(asyncio.run(run_semaine(retry=retry)))
    elif mode == "jour":
        sys.exit(asyncio.run(run_jour(retry=retry)))
```

- [ ] **Step 6: Vérifier le fast-exit sans réseau**

```bash
cd plats-du-jour && source .venv/bin/activate
python - <<'PY'
from datetime import date
import run_state
state = run_state.load(date.today(), "jour")
state["ferie"] = "TEST"
run_state.save(state)
PY
python main.py jour --retry; echo "exit=$?"
rm output/run_state_$(date +%F).json
```
Expected: sortie « Déjà complet … rien à faire », `exit=4`, en ~2 s.

- [ ] **Step 7: Commit**

```bash
git add plats-du-jour/main.py
git commit -m "feat(pipeline): run_jour idempotent — reprise par étape via run_state"
```

---

### Task 3: `run_semaine` idempotent

**Files:**
- Modify: `plats-du-jour/main.py` (fonction `run_semaine`, `_traiter_carte`)

**Interfaces:**
- Consumes: helpers de Task 2 (`_step_scrape_jour`, `_step_eval`, `_step_commentaires`, `_step_futurs`), `run_state`.
- Produces: `run_semaine(retry: bool = False) -> int` (mêmes codes de sortie).

- [ ] **Step 1: Réécrire `run_semaine`**

```python
async def run_semaine(retry: bool = False) -> int:
    """Pipeline du lundi, reprenable : semaine + jour + carte."""
    today = date.today()
    run_state.purge(today)
    state = run_state.load(today, "semaine")

    if run_state.est_complet(state):
        print(f"[pipeline:semaine] Déjà complet ({run_state.resume(state)}) — rien à faire")
        return EXIT_NOOP

    ferie = est_ferie(today)
    if ferie:
        print(f"[pipeline:semaine] Jour férié ({ferie}) — pas de scraping")
        state["ferie"] = ferie
        run_state.save(state)
        return EXIT_OK

    state["attempts"] += 1
    run_state.save(state)
    print(f"[pipeline:semaine] Démarrage (tentative {state['attempts']})...")
    loop = asyncio.get_event_loop()

    # ── Nouvelle semaine : reset GIFs + cache commentaires (une seule fois) ──
    if not state["reset_semaine_fait"]:
        reset_used_gifs()
        if comment_agent.COMMENTAIRES_SEMAINE_FILE.exists():
            try:
                comment_agent.COMMENTAIRES_SEMAINE_FILE.unlink()
            except Exception as e:
                print(f"[pipeline:semaine] Erreur suppression cache commentaires : {e}")
        state["reset_semaine_fait"] = True
        run_state.save(state)

    # ── Scrapes semaine (retentés seulement si absents) ──
    if state["semaine"]["trefle"] is None:
        try:
            state["semaine"]["trefle"] = await loop.run_in_executor(None, bistrot_trefle.scrape_semaine)
            run_state.save(state)
        except Exception as e:
            print(f"[pipeline:semaine] Erreur scrape_semaine Trèfle : {e}")
    if state["semaine"]["truck"] is None:
        try:
            state["semaine"]["truck"] = await truck_muche.scrape_semaine()
            run_state.save(state)
        except Exception as e:
            print(f"[pipeline:semaine] Erreur scrape_semaine Truck : {e}")

    # ── Scrape du jour + éval + commentaires (helpers communs) ──
    await _step_scrape_jour(state, loop)
    print(f"[pipeline:semaine] {len(run_state.scrapes_ok(state))}/3 plats du jour récupérés")

    # Messages de la semaine (peu coûteux : régénérés tant que la journée n'est pas close)
    pg = state["scrapes"]["pause_gourmande"]["data"]
    pause_data = {"plat": pg["plat"], "prix": pg["prix"]} if pg else None
    fichiers = generer_messages_semaine(state["semaine"]["trefle"], state["semaine"]["truck"], pause_data)
    print(f"[pipeline:semaine] {len(fichiers)} fichiers messages générés")

    output = await _step_eval(state, loop)
    output = await _step_commentaires(state, loop, output)

    await _step_futurs(state, loop)
    publish_pdj(output)

    # ── Carte permanente du Trèfle (une fois par lundi) ──
    if not state["carte_traitee"]:
        try:
            await _traiter_carte(loop)
            state["carte_traitee"] = True
            run_state.save(state)
        except Exception as e:
            print(f"[pipeline:semaine] Erreur traitement carte : {e}")

    try:
        await loop.run_in_executor(None, idee_agent.evaluer_idees)
    except Exception as e:
        print(f"[pipeline:semaine] Erreur évaluation idées : {e}")

    complet = run_state.est_complet(state)
    print(f"[état] {run_state.resume(state)}")
    return EXIT_OK if complet else EXIT_PARTIAL
```

Note : `_traiter_carte` garde son garde-fou par hash ; le flag évite juste de
relancer Playwright à chaque retry. Un échec de carte ne bloque pas `complet`
(elle est hors complétude, conformément au spec) : le flag reste False et elle
sera retentée au retry suivant uniquement.

`_step_futurs` réutilise `state["semaine"]` déjà rempli ci-dessus (pas de
double scrape).

- [ ] **Step 2: Vérification syntaxe + tests existants**

Run: `python -m py_compile main.py && python -m pytest tests/test_run_state.py -q`
Expected: compile OK, tests PASS

- [ ] **Step 3: Commit**

```bash
git add plats-du-jour/main.py
git commit -m "feat(pipeline): run_semaine idempotent (semaine, messages, carte via run_state)"
```

---

### Task 4: `entrypoint.sh` (lock + retry + statuts), Dockerfile cron, `poll_runs.sh`

**Files:**
- Modify: `plats-du-jour/entrypoint.sh`
- Modify: `plats-du-jour/Dockerfile` (bloc crontab)
- Modify: `plats-du-jour/poll_runs.sh` (mapping partial)

**Interfaces:**
- Consumes: codes de sortie main.py (0/3/4).
- Produces: statuts reportés `success` | `partial` | `error` ; `triggered_by`
  `cron` | `cron-retry` ; lock `output/pdj_run.lock`.

- [ ] **Step 1: Réécrire `entrypoint.sh`**

```bash
#!/bin/bash
# Charger les variables d'environnement (cron ne les hérite pas)
set -a
source /app/.env
set +a

# Cron n'hérite pas non plus des ENV Docker → réexporter celles dont Playwright a besoin
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

MODE="${1:-jour}"
RETRY=""
FINAL=""
if [ "$MODE" = "retry" ]; then
  RETRY=1
  [ "${2:-}" = "final" ] && FINAL=1
  # Lundi → semaine, sinon jour (mêmes modes que le run principal 7h30)
  [ "$(date +%u)" = "1" ] && MODE=semaine || MODE=jour
fi

# Lock global (volume partagé → vaut aussi pour les runs `docker compose run`
# du poller /admin). Retries : sautent leur tour si un run tourne déjà.
mkdir -p /app/output
exec 200>/app/output/pdj_run.lock
if [ -n "$RETRY" ]; then
  flock -n 200 || { echo "$(date '+%Y-%m-%d %H:%M') [cron] run en cours, retry sauté"; exit 0; }
else
  flock -w 900 200 || { echo "$(date '+%Y-%m-%d %H:%M') [cron] lock non obtenu après 15 min, abandon"; exit 1; }
fi

echo "$(date '+%Y-%m-%d %H:%M') [cron] Lancement pipeline mode=$MODE${RETRY:+ (retry)}"

LOGFILE="$(mktemp)"
cd /app && ionice -c 3 nice -n 19 python main.py "$MODE" ${RETRY:+--retry} 2>&1 | tee -a "$LOGFILE"
rc="${PIPESTATUS[0]}"

# 0=complet, 3=partiel, 4=no-op (déjà complet). Le dernier retry (10h00)
# transforme partiel en erreur : journée définitivement incomplète.
case "$rc" in
  0) status=success ;;
  3) status=partial; [ -n "$FINAL" ] && status=error ;;
  4) status=noop ;;
  *) status=error ;;
esac

# Report vers /admin. Jamais pour un no-op (pas de bruit) ; désactivé quand
# PDJ_REPORT=off (le poller /admin reporte lui-même avec un id).
# Seuls jour/semaine sont suivis côté /admin (desserts non).
TRIGGER="cron"; [ -n "$RETRY" ] && TRIGGER="cron-retry"
if [ "${PDJ_REPORT:-on}" = "on" ] && [ "$status" != "noop" ] \
   && { [ "$MODE" = "jour" ] || [ "$MODE" = "semaine" ]; } \
   && [ -n "${VERCEL_API_URL:-}" ] && [ -n "${API_SECRET_TOKEN:-}" ]; then
  python3 - "$MODE" "$status" "$LOGFILE" "$TRIGGER" <<'PY'
import json, os, sys, urllib.request
mode, status, logfile, trigger = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    log = open(logfile, errors="replace").read()[-200000:]
    data = json.dumps({"mode": mode, "triggered_by": trigger,
                       "status": status, "log": log}).encode()
    req = urllib.request.Request(
        os.environ["VERCEL_API_URL"].rstrip("/") + "/api/pipeline/report",
        data=data, method="POST",
        headers={"Authorization": "Bearer " + os.environ["API_SECRET_TOKEN"],
                 "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=30)
except Exception as e:
    print("[report] échec:", e)
PY
fi
rm -f "$LOGFILE"

echo "$(date '+%Y-%m-%d %H:%M') [cron] Terminé (rc=$rc, status=$status)"
# Propager le code pour le poller /admin (docker compose run) :
# no-op = succès du point de vue appelant.
[ "$rc" = "4" ] && exit 0
exit "$rc"
```

- [ ] **Step 2: Ajouter les lignes de retry au crontab du Dockerfile**

Dans le bloc `RUN echo …` existant du `Dockerfile`, après la ligne `jour`, ajouter :

```dockerfile
    echo '45 7 * * 1-5 root /entrypoint.sh retry >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '0,15,30,45 8-9 * * 1-5 root /entrypoint.sh retry >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
    echo '0 10 * * 1-5 root /entrypoint.sh retry final >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
```

- [ ] **Step 3: Mapper `partial` dans `poll_runs.sh`**

Remplacer le bloc `if log=$(docker compose run …)` par :

```bash
set +e
log=$(docker compose run --rm -e PDJ_REPORT=off plats-du-jour /entrypoint.sh "$mode" 2>&1)
rc=$?
set -e
case "$rc" in
  0) status=success ;;
  3) status=partial ;;
  *) status=error ;;
esac
```

- [ ] **Step 4: Vérifier la syntaxe bash**

Run: `bash -n plats-du-jour/entrypoint.sh && bash -n plats-du-jour/poll_runs.sh`
Expected: aucune sortie (OK)

- [ ] **Step 5: Commit**

```bash
git add plats-du-jour/entrypoint.sh plats-du-jour/Dockerfile plats-du-jour/poll_runs.sh
git commit -m "feat(pipeline): retries cron 7h45-10h, lock flock global, statut partial"
```

---

### Task 5: Statut `partial` côté site (`db.ts`, route report, AdminDashboard)

**Files:**
- Modify: `lib/db.ts:604` (type `PipelineStatus`)
- Modify: `app/api/pipeline/report/route.ts:20`
- Modify: `app/admin/AdminDashboard.tsx:6-9` (badges)

**Interfaces:**
- Consumes: POST `/api/pipeline/report` avec `status: "partial"`,
  `triggered_by: "cron-retry"` (Task 4).
- Produces: type `PipelineStatus = "requested" | "running" | "success" | "error" | "partial"`.

- [ ] **Step 1: Étendre le type dans `lib/db.ts`**

```typescript
export type PipelineStatus = "requested" | "running" | "success" | "error" | "partial";
```

- [ ] **Step 2: Accepter `partial` dans `report/route.ts`**

```typescript
    if (status !== "success" && status !== "error" && status !== "partial") {
      return NextResponse.json({ error: "status invalide" }, { status: 400 });
    }
```

- [ ] **Step 3: Badge orange dans `AdminDashboard.tsx`**

Ajouter dans l'objet des couleurs de badge :

```typescript
  partial: "bg-orange-200 text-orange-900",
```

(La détection de run actif `requested`/`running` reste inchangée : un run
`partial` est terminé, les boutons de relance doivent être disponibles.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build Next.js OK, zéro erreur TypeScript.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts app/api/pipeline/report/route.ts app/admin/AdminDashboard.tsx
git commit -m "feat(admin): statut partial (badge orange) + triggered_by cron-retry"
```

---

### Task 6: Test d'intégration reprise + notes de déploiement

**Files:**
- Test: vérification manuelle scriptée (état simulé, sans réseau)
- Modify: `docs/superpowers/plans/DEPLOY-admin-logs.md` (section déploiement fiabilisation) — ou créer `docs/superpowers/plans/DEPLOY-fiabilisation.md`

**Interfaces:**
- Consumes: tout ce qui précède.

- [ ] **Step 1: Test de reprise simulé (sans réseau)**

Simuler « Truck raté, tout le reste ok » et vérifier qu'un retry ne retente que Truck :

```bash
cd plats-du-jour && source .venv/bin/activate
python - <<'PY'
from datetime import date
import run_state
state = run_state.load(date.today(), "jour")
for label in ["bistrot_trefle", "pause_gourmande"]:
    state["scrapes"][label] = {"ok": True, "data": {"restaurant": label, "plat": "Test", "prix": "10€"}, "erreur": None}
state["scrapes"]["truck_muche"] = {"ok": False, "data": None, "erreur": "IG 429 (simulé)"}
state["repair_lancee"] = True
run_state.save(state)
print(run_state.resume(state))
PY
```
Expected: `scrapes 2/3 (truck_muche: IG 429 (simulé)) · éval 0/2 · commentaires 0/2 · futurs non`

Puis inspecter la logique sans appels réseau/LLM :

```bash
python - <<'PY'
import asyncio, main, run_state
from datetime import date
state = run_state.load(date.today(), "jour")
# _step_scrape_jour ne doit tenter QUE truck_muche
a_faire = [l for l in run_state.SCRAPER_LABELS if not state["scrapes"][l]["ok"]]
assert a_faire == ["truck_muche"], a_faire
print("OK: seul truck_muche serait re-scrapé")
PY
rm plats-du-jour/output/run_state_$(date +%F).json 2>/dev/null || true
```
Expected: `OK: seul truck_muche serait re-scrapé`

- [ ] **Step 2: Écrire les notes de déploiement**

Créer `docs/superpowers/plans/DEPLOY-fiabilisation.md` :

```markdown
# Déploiement — fiabilisation pipeline (retries + lock + partial)

1. Sur le VPS (`vps:/opt/pdj`) : `git pull` (ou rsync) puis rebuild :
   `docker compose build && docker compose up -d`
   (le nouveau crontab retry est baké dans l'image).
2. Vérifier le montage volume `./output:/app/output` dans le
   `docker-compose.yml` du VPS (persistance cache Truck + run_state + lock).
3. Vérifier Vercel déployé avec le statut `partial` (merge main → auto).
4. `poll_runs.sh` : re-rsync sur le VPS (mapping partial ajouté).
5. Test : depuis /admin, « Relancer (jour) » → le run doit finir `success`
   (ou `partial` si un resto échoue) ; retenter → no-op non reporté.
6. Vérifier le lendemain 7h30-10h : runs retry visibles uniquement s'ils ont
   travaillé (`triggered_by: cron-retry`).
```

- [ ] **Step 3: Vérification finale globale**

Run: `cd plats-du-jour && python -m pytest tests/test_run_state.py -q && python -m py_compile main.py run_state.py && bash -n entrypoint.sh poll_runs.sh && cd .. && npm run build`
Expected: tout PASS/OK.

- [ ] **Step 4: Commit final**

```bash
git add docs/superpowers/plans/DEPLOY-fiabilisation.md
git commit -m "docs: notes de déploiement fiabilisation pipeline"
```
