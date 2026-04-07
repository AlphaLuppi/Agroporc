"""
Équipe d'agents de réparation automatique.

Quand un scraper échoue, cette équipe multi-agents tente de :
1. Diagnostiquer la cause (agent Diagnosticien)
2. Proposer et appliquer un correctif (agent Développeur)
3. Valider que le fix fonctionne (agent Testeur)

Les agents communiquent via des tool calls Claude (tool_use).
"""
import json
import subprocess
import sys
import traceback
from datetime import date
from pathlib import Path

import anthropic

SCRAPERS_DIR = Path(__file__).parent.parent / "scrapers"
OUTPUT_DIR = Path(__file__).parent.parent / "output"
VENV_PYTHON = Path(__file__).parent.parent / ".venv" / "bin" / "python3"


# ── Outils disponibles pour les agents ──────────────────────────────────────

def _read_file(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8")
    except Exception as e:
        return f"ERREUR lecture fichier : {e}"


def _run_scraper(scraper_name: str) -> str:
    """Exécute un scraper isolément et retourne stdout + stderr."""
    try:
        result = subprocess.run(
            [str(VENV_PYTHON), "-c",
             f"import asyncio; from scrapers import {scraper_name}; "
             f"r = asyncio.run({scraper_name}.scrape()) if hasattr({scraper_name}.scrape, '__wrapped__') or asyncio.iscoroutinefunction({scraper_name}.scrape) else {scraper_name}.scrape(); "
             f"print(r)"],
            capture_output=True, text=True, timeout=60,
            cwd=str(SCRAPERS_DIR.parent),
        )
        out = result.stdout.strip() or "(pas de sortie)"
        err = result.stderr.strip()
        return f"STDOUT:\n{out}\n\nSTDERR:\n{err}" if err else f"STDOUT:\n{out}"
    except subprocess.TimeoutExpired:
        return "ERREUR : timeout (60s)"
    except Exception as e:
        return f"ERREUR : {e}"


def _write_file(path: str, content: str) -> str:
    try:
        p = Path(path)
        p.write_text(content, encoding="utf-8")
        return f"Fichier écrit : {p}"
    except Exception as e:
        return f"ERREUR écriture : {e}"


TOOLS = [
    {
        "name": "read_file",
        "description": "Lit le contenu d'un fichier source Python.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Chemin absolu du fichier"}
            },
            "required": ["path"],
        },
    },
    {
        "name": "run_scraper",
        "description": "Exécute un scraper et retourne sa sortie pour diagnostic.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scraper_name": {
                    "type": "string",
                    "description": "Nom du module scraper (ex: truck_muche, pause_gourmande, bistrot_trefle)"
                }
            },
            "required": ["scraper_name"],
        },
    },
    {
        "name": "write_file",
        "description": "Écrit (ou écrase) un fichier avec un contenu corrigé.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Chemin absolu du fichier"},
                "content": {"type": "string", "description": "Contenu complet du fichier"},
            },
            "required": ["path", "content"],
        },
    },
]


def _dispatch_tool(tool_name: str, tool_input: dict) -> str:
    if tool_name == "read_file":
        return _read_file(tool_input["path"])
    if tool_name == "run_scraper":
        return _run_scraper(tool_input["scraper_name"])
    if tool_name == "write_file":
        return _write_file(tool_input["path"], tool_input["content"])
    return f"Outil inconnu : {tool_name}"


# ── Agent générique avec boucle tool_use ────────────────────────────────────

def _run_agent(client: anthropic.Anthropic, system: str, user_message: str, label: str) -> str:
    """
    Lance un agent Claude avec tool_use et tourne jusqu'à ce qu'il rende
    une réponse finale (stop_reason != 'tool_use').
    Retourne le texte final de l'agent.
    """
    print(f"[repair/{label}] Démarrage...")
    messages = [{"role": "user", "content": user_message}]

    for step in range(10):  # max 10 tours d'outils
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            system=system,
            tools=TOOLS,
            messages=messages,
        )

        # Ajouter la réponse de l'assistant
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            # Réponse finale
            final = " ".join(
                block.text for block in response.content
                if hasattr(block, "text")
            )
            print(f"[repair/{label}] Terminé en {step + 1} tour(s).")
            return final

        # Exécuter les outils demandés
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                print(f"[repair/{label}] → {block.name}({json.dumps(block.input)[:80]})")
                result = _dispatch_tool(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result[:8000],  # limite de contexte
                })

        messages.append({"role": "user", "content": tool_results})

    return "[repair] Nombre maximum d'itérations atteint."


# ── Agents spécialisés ───────────────────────────────────────────────────────

def _agent_diagnosticien(client, scraper_name: str, error: str) -> str:
    system = (
        "Tu es un ingénieur senior spécialisé en web scraping Python (Playwright, REST).\n"
        "Tu diagnostiques des scrapers cassés. Tu as accès aux outils read_file et run_scraper.\n"
        "Analyse le code source du scraper, reproduis l'erreur, identifie la cause racine.\n"
        "Conclus avec un diagnostic clair en 3-5 lignes max."
    )
    scraper_path = str(SCRAPERS_DIR / f"{scraper_name}.py")
    user = (
        f"Le scraper '{scraper_name}' a échoué avec l'erreur suivante :\n\n"
        f"```\n{error}\n```\n\n"
        f"Le fichier source est à : {scraper_path}\n"
        f"Lis le code, exécute le scraper pour reproduire l'erreur, et pose un diagnostic."
    )
    return _run_agent(client, system, user, "diagnosticien")


def _agent_developpeur(client, scraper_name: str, diagnostic: str) -> str:
    system = (
        "Tu es un développeur Python expert en web scraping (Playwright, requests, BeautifulSoup).\n"
        "Tu corriges des scrapers cassés. Tu as accès à read_file, run_scraper et write_file.\n"
        "Lis le code actuel, propose une correction ciblée, et écris le fichier corrigé avec write_file.\n"
        "Ne change que ce qui est nécessaire. Préserve la signature scrape() -> dict | None."
    )
    scraper_path = str(SCRAPERS_DIR / f"{scraper_name}.py")
    user = (
        f"Voici le diagnostic du scraper '{scraper_name}' :\n\n{diagnostic}\n\n"
        f"Le fichier source est à : {scraper_path}\n"
        f"Lis le code, applique le correctif minimal, puis écris le fichier corrigé."
    )
    return _run_agent(client, system, user, "developpeur")


def _agent_testeur(client, scraper_name: str) -> str:
    system = (
        "Tu es un QA engineer Python.\n"
        "Tu valides que le scraper fonctionne après correction. Tu as accès à run_scraper.\n"
        "Exécute le scraper, vérifie que le résultat est un dict valide avec restaurant/plat/prix.\n"
        "Conclus par SUCCÈS ou ÉCHEC avec les détails."
    )
    user = (
        f"Exécute le scraper '{scraper_name}' et valide son bon fonctionnement.\n"
        f"Le résultat attendu est un dict {{ restaurant, plat, prix }} non-None."
    )
    return _run_agent(client, system, user, "testeur")


# ── Point d'entrée public ────────────────────────────────────────────────────

def repair(failing_scrapers: dict[str, str]) -> dict:
    """
    Lance l'équipe de réparation pour les scrapers en échec.

    Args:
        failing_scrapers: { scraper_name: error_message }

    Returns:
        dict avec le rapport de réparation par scraper
    """
    from agent.diet_agent import _get_oauth_token
    token = _get_oauth_token()
    client = anthropic.Anthropic(api_key=token)

    rapport = {}
    for scraper_name, error in failing_scrapers.items():
        print(f"\n[repair_team] ══ Réparation de '{scraper_name}' ══")
        try:
            diagnostic = _agent_diagnosticien(client, scraper_name, error)
            print(f"[repair_team] Diagnostic : {diagnostic[:200]}...")

            dev_rapport = _agent_developpeur(client, scraper_name, diagnostic)
            print(f"[repair_team] Développeur : {dev_rapport[:200]}...")

            validation = _agent_testeur(client, scraper_name)
            succes = "SUCCÈS" in validation.upper()
            print(f"[repair_team] Validation : {'✅' if succes else '❌'} {validation[:100]}")

            rapport[scraper_name] = {
                "diagnostic": diagnostic,
                "fix_applique": dev_rapport,
                "validation": validation,
                "succes": succes,
            }
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[repair_team] Erreur inattendue : {e}")
            rapport[scraper_name] = {
                "diagnostic": str(e),
                "fix_applique": None,
                "validation": tb,
                "succes": False,
            }

    # Écrire le rapport de réparation
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rapport_path = OUTPUT_DIR / f"repair_{date.today()}.json"
    rapport_path.write_text(json.dumps(rapport, ensure_ascii=False, indent=2))
    print(f"\n[repair_team] Rapport écrit dans {rapport_path}")

    return rapport
