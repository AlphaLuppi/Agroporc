"""
Équipe d'agents de réparation automatique — version `claude -p`.

Quand un scraper échoue, on délègue à Claude via le CLI `claude -p` pour
produire un diagnostic. Le diagnostic est écrit dans `output/repair_<date>.json`.

Mode read-only : on ne laisse pas Claude modifier le code automatiquement
sur le VPS, pour éviter des altérations silencieuses. Les corrections sont
appliquées à la main après lecture du rapport.
"""
import json
import shutil
import subprocess
import traceback
from datetime import date
from pathlib import Path

SCRAPERS_DIR = Path(__file__).parent.parent / "scrapers"
OUTPUT_DIR = Path(__file__).parent.parent / "output"
CLAUDE_BIN = shutil.which("claude")


def _diagnostic_prompt(scraper_name: str, error: str) -> str:
    scraper_path = SCRAPERS_DIR / f"{scraper_name}.py"
    return (
        "Tu es un ingénieur senior spécialisé en web scraping Python "
        "(Playwright, requests, BeautifulSoup).\n\n"
        f"Le scraper `{scraper_name}` a échoué avec cette erreur :\n\n"
        f"```\n{error}\n```\n\n"
        f"Le fichier source est ici : {scraper_path}\n\n"
        "Lis le code (tu peux te servir de Read), identifie la cause "
        "racine de l'erreur, et propose en clair un correctif ciblé "
        "(sans l'appliquer). Rends un diagnostic en 5-10 lignes max "
        "incluant : 1) la cause, 2) le correctif proposé, 3) le niveau "
        "de confiance."
    )


def _run_claude_diagnostic(scraper_name: str, error: str, timeout: int = 180) -> str:
    if not CLAUDE_BIN:
        return "claude CLI introuvable — diagnostic impossible."

    prompt = _diagnostic_prompt(scraper_name, error)
    result = subprocess.run(
        [
            CLAUDE_BIN, "-p", prompt,
            "--output-format", "text",
            "--allowedTools", "Read,Bash",
        ],
        capture_output=True, text=True, timeout=timeout,
        cwd=str(SCRAPERS_DIR.parent),
    )
    if result.returncode != 0:
        return f"claude CLI a échoué : {result.stderr.strip()[:800]}"
    return result.stdout.strip()


def repair(failing_scrapers: dict[str, str]) -> dict:
    """
    Produit un rapport de diagnostic pour les scrapers en échec.

    Args:
        failing_scrapers: { scraper_name: error_message }

    Returns:
        dict { scraper_name: { diagnostic, succes: False } }
    """
    rapport = {}
    for scraper_name, error in failing_scrapers.items():
        print(f"\n[repair_team] ══ Diagnostic de '{scraper_name}' ══")
        try:
            diagnostic = _run_claude_diagnostic(scraper_name, error)
            print(f"[repair_team] {diagnostic[:300]}")
            rapport[scraper_name] = {
                "diagnostic": diagnostic,
                "fix_applique": None,
                "validation": "mode read-only — correctif à appliquer manuellement",
                "succes": False,
            }
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[repair_team] Erreur : {e}")
            rapport[scraper_name] = {
                "diagnostic": str(e),
                "fix_applique": None,
                "validation": tb,
                "succes": False,
            }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rapport_path = OUTPUT_DIR / f"repair_{date.today()}.json"
    rapport_path.write_text(json.dumps(rapport, ensure_ascii=False, indent=2))
    print(f"\n[repair_team] Rapport écrit dans {rapport_path}")

    return rapport
