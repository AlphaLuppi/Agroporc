"""
Pipeline principal — plats du jour.

Deux modes d'exécution :
  python main.py semaine   → Pipeline complète du lundi : scrape les menus de la
                              semaine (Trèfle + Truck Muche) + plat du jour Pause
                              Gourmande. Génère un fichier message par jour.
  python main.py jour      → Pipeline légère quotidienne : scrape uniquement le plat
                              du jour des 3 restaurants, met à jour le message du jour.
"""
import asyncio
import json
import sys
import traceback
from datetime import date, timedelta
from pathlib import Path
from dotenv import load_dotenv

OUTPUT_FILE = Path(__file__).parent / "output" / "pdj.json"
HISTORY_DIR = Path(__file__).parent / "output" / "historique"

load_dotenv()

from scrapers import bistrot_trefle, pause_gourmande, truck_muche
from agent import diet_agent, repair_team, comment_agent
from messages import generer_messages_semaine, maj_message_jour
from generate_site import generate_site
from publish import publish_pdj
from jours_feries import est_ferie

DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"]


# ── Pipeline quotidienne (plat du jour) ─────────────────────────────────────

async def run_jour() -> dict:
    """Scrape le plat du jour des 3 restaurants, évalue, met à jour le message du jour."""
    ferie = est_ferie(date.today())
    if ferie:
        print(f"[pipeline:jour] Jour férié ({ferie}) — pas de scraping")
        generate_site()
        return {"date": str(date.today()), "ferie": ferie, "plats": []}

    print("[pipeline:jour] Démarrage scraping du jour...")

    loop = asyncio.get_event_loop()
    bistrot_result, pg_result, tm_result = await asyncio.gather(
        loop.run_in_executor(None, bistrot_trefle.scrape),
        pause_gourmande.scrape(),
        truck_muche.scrape(),
        return_exceptions=True,
    )

    plats = []
    failures = {}
    pause_data = None
    for label, r in [("bistrot_trefle", bistrot_result), ("pause_gourmande", pg_result), ("truck_muche", tm_result)]:
        if isinstance(r, Exception):
            print(f"[pipeline:jour] Erreur {label} : {r}")
            failures[label] = traceback.format_exception_only(type(r), r)[-1].strip()
        elif r is None:
            print(f"[pipeline:jour] {label} n'a rien retourné")
            failures[label] = "scrape() a retourné None"
        else:
            plats.append(r)
            if label == "pause_gourmande":
                pause_data = r

    if failures:
        print(f"[pipeline:jour] {len(failures)} scraper(s) en échec → lancement de la repair team...")
        await loop.run_in_executor(None, repair_team.repair, failures)

    print(f"[pipeline:jour] {len(plats)}/3 plats récupérés")

    # Évaluation diététique
    output = await _evaluer_et_sauver(plats)

    # Générer les commentaires de la Pause Gourmande du jour
    today_name = DAY_NAMES[date.today().weekday()] if date.today().weekday() < 5 else None
    commentaires_pg = None
    if pause_data:
        print("[pipeline:jour] Génération des commentaires Pause Gourmande...")
        try:
            commentaires_pg = await loop.run_in_executor(
                None,
                comment_agent.generate_commentaires_jour,
                [{"restaurant": "La Pause Gourmande", "plat": pause_data["plat"], "prix": pause_data["prix"]}],
            )
        except Exception as e:
            print(f"[pipeline:jour] Erreur commentaires PG : {e}")

    # Charger les commentaires pré-générés de la semaine (Trèfle + Truck)
    commentaires_jour = []
    if today_name:
        commentaires_jour = comment_agent.load_commentaires_jour(today_name)
        if commentaires_jour:
            print(f"[pipeline:jour] {len(commentaires_jour)} commentaires pré-générés chargés pour {today_name}")

    # Fusionner les commentaires dans l'évaluation
    if commentaires_jour or commentaires_pg:
        output = comment_agent.merge_commentaires(output, commentaires_jour, commentaires_pg)
        # Re-sauvegarder avec les commentaires
        OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))
        print("[pipeline:jour] Commentaires fusionnés dans pdj.json")

    # Mettre à jour le message du jour (remplace "on ne sait pas encore" pour la Pause Gourmande)
    if pause_data:
        maj_message_jour({"plat": pause_data["plat"], "prix": pause_data["prix"]})

    # ── Publier les jours futurs (Trèfle + Truck, PG = coming soon) ──────
    await _publier_jours_futurs(loop)

    # Générer le site statique
    generate_site()

    # Publier vers Vercel
    publish_pdj(output)

    return output


# ── Publication des jours futurs ───────────────────────────────────────────

async def _publier_jours_futurs(loop):
    """Publie les jours futurs de la semaine avec les données Trèfle + Truck + commentaires."""
    today_idx = date.today().weekday()
    if today_idx >= 4:  # vendredi ou week-end, pas de jours futurs en semaine
        return

    # Scrape/charge les données de la semaine
    trefle_semaine = None
    truck_semaine = None
    try:
        trefle_semaine = await loop.run_in_executor(None, bistrot_trefle.scrape_semaine)
    except Exception as e:
        print(f"[pipeline:futurs] Erreur scrape_semaine Trèfle : {e}")
    try:
        truck_semaine = await truck_muche.scrape_semaine()
    except Exception as e:
        print(f"[pipeline:futurs] Erreur scrape_semaine Truck : {e}")

    if not trefle_semaine and not truck_semaine:
        print("[pipeline:futurs] Aucune donnée semaine disponible, pas de jours futurs à publier")
        return

    # Construire les plats des jours futurs
    future_days = {}
    for day_name in DAY_NAMES[today_idx + 1:]:
        plats_jour = []
        if trefle_semaine and day_name in trefle_semaine:
            t = trefle_semaine[day_name]
            plats_jour.append({
                "restaurant": "Le Bistrot Trèfle",
                "plat": t["plat"],
                "prix": t["prix"],
            })
        if truck_semaine and day_name in truck_semaine:
            t = truck_semaine[day_name]
            plats_jour.append({
                "restaurant": "Le Truck Muche",
                "plat": t["plat"],
                "prix": t["prix"],
            })
        if plats_jour:
            future_days[day_name] = plats_jour

    if not future_days:
        print("[pipeline:futurs] Pas de plats trouvés pour les jours futurs")
        return

    # Évaluer les plats des jours futurs
    future_evaluations = {}
    print(f"[pipeline:futurs] Évaluation des plats de {len(future_days)} jours futurs...")
    try:
        future_evaluations = await loop.run_in_executor(
            None,
            diet_agent.evaluate_semaine,
            future_days,
        )
    except Exception as e:
        print(f"[pipeline:futurs] Erreur évaluation semaine : {e}")

    # Charger ou générer les commentaires de la semaine
    commentaires_semaine = {}
    existing_comments = comment_agent.COMMENTAIRES_SEMAINE_FILE.exists()
    if existing_comments:
        try:
            commentaires_semaine = json.loads(
                comment_agent.COMMENTAIRES_SEMAINE_FILE.read_text(encoding="utf-8")
            )
            print("[pipeline:futurs] Commentaires semaine chargés depuis le cache")
        except Exception:
            existing_comments = False

    if not existing_comments:
        print("[pipeline:futurs] Génération des commentaires semaine (Trèfle + Truck)...")
        try:
            commentaires_semaine = await loop.run_in_executor(
                None,
                comment_agent.generate_commentaires_semaine,
                trefle_semaine,
                truck_semaine,
            )
        except Exception as e:
            print(f"[pipeline:futurs] Erreur génération commentaires : {e}")

    # Publier chaque jour futur
    for i, day_name in enumerate(DAY_NAMES[today_idx + 1:], start=1):
        future_date = date.today() + timedelta(days=i)
        day_eval = future_evaluations.get(day_name, {})
        day_plats = day_eval.get("plats", future_days.get(day_name, []))

        # Ajouter la Pause Gourmande en "coming soon"
        day_plats.append({
            "restaurant": "La Pause Gourmande",
            "plat": "Coming soon",
            "prix": "",
            "coming_soon": True,
        })

        # Fusionner les commentaires pré-générés
        day_comments = commentaires_semaine.get(day_name, [])
        if day_comments:
            for plat in day_plats:
                resto = plat.get("restaurant", "")
                for c in day_comments:
                    if c.get("restaurant") == resto:
                        existing = plat.get("commentaires", [])
                        existing_authors = {x.get("auteur") for x in existing}
                        new = [x for x in c.get("commentaires", []) if x.get("auteur") not in existing_authors]
                        plat["commentaires"] = existing + new

        future_output = {
            "date": str(future_date),
            "plats": day_plats,
            "recommandation": day_eval.get("recommandation"),
            "recommandation_goulaf": day_eval.get("recommandation_goulaf"),
        }
        publish_pdj(future_output)
        print(f"[pipeline:futurs] Jour futur publié : {day_name} ({future_date})")


# ── Pipeline semaine (lundi) ────────────────────────────────────────────────

async def run_semaine() -> dict:
    """Scrape les menus de la semaine + plat du jour, génère tous les messages."""
    print("[pipeline:semaine] Démarrage scraping semaine complète...")

    loop = asyncio.get_event_loop()

    # Scrape en parallèle : semaine Trèfle + semaine Truck + jour Pause Gourmande
    # + jour Trèfle et Truck (pour l'évaluation diététique du jour)
    trefle_sem_result, truck_sem_result, bistrot_result, pg_result, tm_result = await asyncio.gather(
        loop.run_in_executor(None, bistrot_trefle.scrape_semaine),
        truck_muche.scrape_semaine(),
        loop.run_in_executor(None, bistrot_trefle.scrape),
        pause_gourmande.scrape(),
        truck_muche.scrape(),
        return_exceptions=True,
    )

    # ── Traitement semaine (messages) ────────────────────────────────────
    trefle_semaine = trefle_sem_result if not isinstance(trefle_sem_result, Exception) else None
    truck_semaine = truck_sem_result if not isinstance(truck_sem_result, Exception) else None

    if isinstance(trefle_sem_result, Exception):
        print(f"[pipeline:semaine] Erreur scrape_semaine Trèfle : {trefle_sem_result}")
    if isinstance(truck_sem_result, Exception):
        print(f"[pipeline:semaine] Erreur scrape_semaine Truck : {truck_sem_result}")

    pause_data = None
    if not isinstance(pg_result, Exception) and pg_result is not None:
        pause_data = {"plat": pg_result["plat"], "prix": pg_result["prix"]}

    fichiers = generer_messages_semaine(trefle_semaine, truck_semaine, pause_data)
    print(f"[pipeline:semaine] {len(fichiers)} fichiers messages générés")

    # ── Génération des commentaires de la semaine (Trèfle + Truck) ──────
    try:
        commentaires_semaine = await loop.run_in_executor(
            None,
            comment_agent.generate_commentaires_semaine,
            trefle_semaine,
            truck_semaine,
        )
        print(f"[pipeline:semaine] Commentaires générés pour {len(commentaires_semaine)} jours")
    except Exception as e:
        print(f"[pipeline:semaine] Erreur génération commentaires semaine : {e}")
        commentaires_semaine = {}

    # ── Traitement jour (évaluation diététique) ──────────────────────────
    plats = []
    failures = {}
    for label, r in [("bistrot_trefle", bistrot_result), ("pause_gourmande", pg_result), ("truck_muche", tm_result)]:
        if isinstance(r, Exception):
            print(f"[pipeline:semaine] Erreur {label} : {r}")
            failures[label] = traceback.format_exception_only(type(r), r)[-1].strip()
        elif r is None:
            print(f"[pipeline:semaine] {label} n'a rien retourné")
            failures[label] = "scrape() a retourné None"
        else:
            plats.append(r)

    if failures:
        print(f"[pipeline:semaine] {len(failures)} scraper(s) en échec → lancement de la repair team...")
        await loop.run_in_executor(None, repair_team.repair, failures)

    print(f"[pipeline:semaine] {len(plats)}/3 plats du jour récupérés")

    output = await _evaluer_et_sauver(plats)

    # Fusionner les commentaires du jour (lundi) dans l'évaluation
    today_name = DAY_NAMES[date.today().weekday()] if date.today().weekday() < 5 else None
    commentaires_lundi = commentaires_semaine.get(today_name, []) if today_name else []
    commentaires_pg = None
    if pause_data:
        print("[pipeline:semaine] Génération des commentaires Pause Gourmande du jour...")
        try:
            commentaires_pg = await loop.run_in_executor(
                None,
                comment_agent.generate_commentaires_jour,
                [{"restaurant": "La Pause Gourmande", "plat": pause_data["plat"], "prix": pause_data["prix"]}],
            )
        except Exception as e:
            print(f"[pipeline:semaine] Erreur commentaires PG : {e}")

    if commentaires_lundi or commentaires_pg:
        output = comment_agent.merge_commentaires(output, commentaires_lundi, commentaires_pg)
        OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))
        print("[pipeline:semaine] Commentaires fusionnés dans pdj.json")

    # ── Évaluer et publier les jours futurs (Trèfle + Truck, PG = coming soon) ──
    today_idx = date.today().weekday()
    future_days = {d: [] for d in DAY_NAMES[today_idx + 1:]}

    for day_name in future_days:
        plats_jour = []
        if trefle_semaine and day_name in trefle_semaine:
            t = trefle_semaine[day_name]
            plats_jour.append({
                "restaurant": "Le Bistrot Trèfle",
                "plat": t["plat"],
                "prix": t["prix"],
            })
        if truck_semaine and day_name in truck_semaine:
            t = truck_semaine[day_name]
            plats_jour.append({
                "restaurant": "Le Truck Muche",
                "plat": t["plat"],
                "prix": t["prix"],
            })
        if plats_jour:
            future_days[day_name] = plats_jour

    # Évaluer les plats des jours futurs en un seul appel
    future_evaluations = {}
    plats_a_evaluer = {d: p for d, p in future_days.items() if p}
    if plats_a_evaluer:
        print(f"[pipeline:semaine] Évaluation des plats de {len(plats_a_evaluer)} jours futurs...")
        try:
            future_evaluations = await loop.run_in_executor(
                None,
                diet_agent.evaluate_semaine,
                plats_a_evaluer,
            )
        except Exception as e:
            print(f"[pipeline:semaine] Erreur évaluation semaine : {e}")

    # Publier les jours futurs avec Pause Gourmande "coming soon"
    for i, day_name in enumerate(DAY_NAMES[today_idx + 1:], start=1):
        future_date = date.today() + timedelta(days=i)
        day_eval = future_evaluations.get(day_name, {})
        day_plats = day_eval.get("plats", future_days.get(day_name, []))

        # Ajouter la Pause Gourmande en "coming soon"
        day_plats.append({
            "restaurant": "La Pause Gourmande",
            "plat": "Coming soon",
            "prix": "",
            "coming_soon": True,
        })

        # Fusionner les commentaires pré-générés
        day_comments = commentaires_semaine.get(day_name, [])
        if day_comments:
            for plat in day_plats:
                resto = plat.get("restaurant", "")
                for c in day_comments:
                    if c.get("restaurant") == resto:
                        existing = plat.get("commentaires", [])
                        existing_authors = {x.get("auteur") for x in existing}
                        new = [x for x in c.get("commentaires", []) if x.get("auteur") not in existing_authors]
                        plat["commentaires"] = existing + new

        future_output = {
            "date": str(future_date),
            "plats": day_plats,
            "recommandation": day_eval.get("recommandation"),
            "recommandation_goulaf": day_eval.get("recommandation_goulaf"),
        }
        publish_pdj(future_output)
        print(f"[pipeline:semaine] Jour futur publié : {day_name} ({future_date})")

    # Générer le site statique
    generate_site()

    # Publier vers Vercel
    publish_pdj(output)

    return output


# ── Utilitaires communs ─────────────────────────────────────────────────────

async def _evaluer_et_sauver(plats: list[dict]) -> dict:
    """Évalue les plats avec l'agent diététicien et sauvegarde le JSON."""
    if not plats:
        output = {
            "date": str(date.today()),
            "erreur": "Aucun plat du jour récupéré",
            "plats": [],
            "recommandation": None,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return output

    loop = asyncio.get_event_loop()
    print("[pipeline] Évaluation par l'agent diététicien...")
    try:
        evaluation = await loop.run_in_executor(None, diet_agent.evaluate, plats)
    except Exception as e:
        print(f"[pipeline] Erreur agent : {e}")
        evaluation = {"plats": plats, "recommandation": None, "erreur": str(e)}

    output = {
        "date": str(date.today()),
        **evaluation,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)

    # Archiver l'ancien pdj.json avant d'écraser
    if OUTPUT_FILE.exists():
        try:
            old = json.loads(OUTPUT_FILE.read_text())
            old_date = old.get("date", "inconnu")
            archive = HISTORY_DIR / f"pdj_{old_date}.json"
            archive.write_text(OUTPUT_FILE.read_text())
            print(f"[pipeline] Archivé → {archive.name}")
        except Exception as e:
            print(f"[pipeline] Avertissement archivage : {e}")

    OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(f"[pipeline] Résultat écrit dans {OUTPUT_FILE}")
    return output


# ── Point d'entrée ──────────────────────────────────────────────────────────

def main():
    usage = "Usage: python main.py [semaine|jour]"

    if len(sys.argv) < 2:
        print(usage)
        sys.exit(1)

    mode = sys.argv[1].lower()

    if mode == "semaine":
        asyncio.run(run_semaine())
    elif mode == "jour":
        asyncio.run(run_jour())
    else:
        print(f"Mode inconnu : {mode}")
        print(usage)
        sys.exit(1)


if __name__ == "__main__":
    main()
