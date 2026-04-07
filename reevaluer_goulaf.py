"""
Re-évalue les PDJ existants pour ajouter les notes goulaf manquantes.
Parcourt pdj.json + historique/ et relance diet_agent.evaluate sur ceux
qui n'ont pas de champ note_goulaf.

Usage : python3 reevaluer_goulaf.py [--dry-run]
"""
import json
import sys
from pathlib import Path

from agent import diet_agent

OUTPUT_DIR = Path(__file__).parent / "output"
PDJ_FILE = OUTPUT_DIR / "pdj.json"
HISTORY_DIR = OUTPUT_DIR / "historique"


def _needs_goulaf(data: dict) -> bool:
    """Vérifie si au moins un plat manque de note_goulaf."""
    for plat in data.get("plats", []):
        if "options" in plat:
            for opt in plat["options"]:
                if "note_goulaf" not in opt:
                    return True
        elif "note_goulaf" not in plat:
            return True
    # Vérifier aussi la recommandation goulaf
    if "recommandation_goulaf" not in data and data.get("plats"):
        return True
    return False


def _merge_goulaf(original: dict, evaluation: dict) -> dict:
    """Fusionne les notes goulaf de l'évaluation dans les données originales."""
    eval_plats = {p["restaurant"]: p for p in evaluation.get("plats", [])}

    for plat in original.get("plats", []):
        resto = plat.get("restaurant", "")
        ev = eval_plats.get(resto, {})

        if "options" in plat and "options" in ev:
            ev_opts = {o["plat"]: o for o in ev["options"]}
            for opt in plat["options"]:
                ev_opt = ev_opts.get(opt["plat"], {})
                if "note_goulaf" not in opt and "note_goulaf" in ev_opt:
                    opt["note_goulaf"] = ev_opt["note_goulaf"]
                if "justification_goulaf" not in opt and "justification_goulaf" in ev_opt:
                    opt["justification_goulaf"] = ev_opt["justification_goulaf"]
        else:
            if "note_goulaf" not in plat and "note_goulaf" in ev:
                plat["note_goulaf"] = ev["note_goulaf"]
            if "justification_goulaf" not in plat and "justification_goulaf" in ev:
                plat["justification_goulaf"] = ev["justification_goulaf"]

    if "recommandation_goulaf" not in original and "recommandation_goulaf" in evaluation:
        original["recommandation_goulaf"] = evaluation["recommandation_goulaf"]

    return original


def reevaluer(dry_run: bool = False):
    """Re-évalue tous les PDJ sans notes goulaf."""
    files = []

    if PDJ_FILE.exists():
        files.append(PDJ_FILE)

    if HISTORY_DIR.exists():
        files.extend(sorted(HISTORY_DIR.glob("pdj_*.json")))

    total = len(files)
    updated = 0
    skipped = 0
    errors = 0

    for f in files:
        try:
            data = json.loads(f.read_text())
        except Exception as e:
            print(f"  ⚠️  Erreur lecture {f.name}: {e}")
            errors += 1
            continue

        if not _needs_goulaf(data):
            print(f"  ✓  {f.name} — déjà complet")
            skipped += 1
            continue

        plats = data.get("plats", [])
        if not plats:
            print(f"  ⏭  {f.name} — aucun plat")
            skipped += 1
            continue

        # Préparer les plats pour l'évaluation (format attendu par diet_agent)
        plats_input = []
        for p in plats:
            plats_input.append({
                "restaurant": p.get("restaurant", "?"),
                "plat": p.get("plat", "?"),
                "prix": p.get("prix", "?"),
            })

        date_str = data.get("date", f.stem)
        print(f"  🔄 {f.name} ({date_str}) — {len(plats_input)} plats à re-évaluer...")

        if dry_run:
            print(f"     [dry-run] Serait re-évalué")
            continue

        try:
            evaluation = diet_agent.evaluate(plats_input)
            data = _merge_goulaf(data, evaluation)
            f.write_text(json.dumps(data, ensure_ascii=False, indent=2))
            print(f"  ✅ {f.name} — mis à jour avec notes goulaf")
            updated += 1
        except Exception as e:
            print(f"  ❌ {f.name} — erreur évaluation: {e}")
            errors += 1

    print(f"\n{'='*40}")
    print(f"Terminé : {updated} mis à jour, {skipped} déjà OK, {errors} erreurs (sur {total})")


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    if dry:
        print("Mode dry-run — aucune modification ne sera faite\n")
    reevaluer(dry_run=dry)
