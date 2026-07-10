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
    if state.get("ferie"):
        return f"férié : {state['ferie']}"
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
