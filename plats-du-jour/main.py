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
from agent import diet_agent, repair_team, comment_agent, feedback_agent, idee_agent, portion_agent
from creer_personnage import creer_personnage
from messages import generer_messages_semaine, maj_message_jour
from publish import publish_pdj
from jours_feries import est_ferie
from gif_search import reset_used_gifs

DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"]


def _persist_day_comments(day_name: str, commentaires: list[dict]) -> None:
    """Enregistre les commentaires du jour dans commentaires_semaine.json
    (merge avec les autres jours déjà écrits dans la semaine)."""
    data = {}
    if comment_agent.COMMENTAIRES_SEMAINE_FILE.exists():
        try:
            data = json.loads(comment_agent.COMMENTAIRES_SEMAINE_FILE.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    data[day_name] = commentaires
    comment_agent.COMMENTAIRES_SEMAINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    comment_agent.COMMENTAIRES_SEMAINE_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ── Pipeline quotidienne (plat du jour) ─────────────────────────────────────

async def run_jour() -> dict:
    """Scrape le plat du jour des 3 restaurants, évalue, met à jour le message du jour."""
    ferie = est_ferie(date.today())
    if ferie:
        print(f"[pipeline:jour] Jour férié ({ferie}) — pas de scraping")
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

    # Générer les commentaires pour les plats du jour uniquement (3 restos)
    today_name = DAY_NAMES[date.today().weekday()] if date.today().weekday() < 5 else None
    commentaires_jour = []
    if plats:
        print(f"[pipeline:jour] Génération des commentaires pour {len(plats)} plat(s)...")
        try:
            input_plats = [
                {"restaurant": p["restaurant"], "plat": p["plat"], "prix": p["prix"]}
                for p in plats
            ]
            commentaires_jour = await loop.run_in_executor(
                None,
                comment_agent.generate_commentaires_jour,
                input_plats,
            )
        except Exception as e:
            print(f"[pipeline:jour] Erreur commentaires jour : {e}")

    if commentaires_jour:
        if today_name:
            _persist_day_comments(today_name, commentaires_jour)
        output = comment_agent.merge_commentaires(output, commentaires_jour, None)
        OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))
        print("[pipeline:jour] Commentaires fusionnés dans pdj.json")

    # Mettre à jour le message du jour (remplace "on ne sait pas encore" pour la Pause Gourmande)
    if pause_data:
        maj_message_jour({"plat": pause_data["plat"], "prix": pause_data["prix"]})

    # ── Publier les jours futurs (Trèfle + Truck, PG = coming soon) ──────
    await _publier_jours_futurs(loop)

    # Publier vers Vercel
    publish_pdj(output)

    # ── Évaluation des idées d'amélioration ──────────────────────────────
    try:
        await loop.run_in_executor(None, idee_agent.evaluer_idees)
    except Exception as e:
        print(f"[pipeline:jour] Erreur évaluation idées : {e}")

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

    # Publier chaque jour futur (sans commentaires — ils seront générés le jour même)
    for i, day_name in enumerate(DAY_NAMES[today_idx + 1:], start=1):
        future_date = date.today() + timedelta(days=i)

        # Si le jour futur est férié, publier un marqueur ferie sans plats ni commentaires
        ferie_nom = est_ferie(future_date)
        if ferie_nom:
            publish_pdj({"date": str(future_date), "ferie": ferie_nom, "plats": []})
            print(f"[pipeline:futurs] Jour férié publié : {day_name} ({future_date}) — {ferie_nom}")
            continue

        day_eval = future_evaluations.get(day_name, {})
        day_plats = day_eval.get("plats", future_days.get(day_name, []))

        # Ajouter la Pause Gourmande en "coming soon"
        day_plats.append({
            "restaurant": "La Pause Gourmande",
            "plat": "Coming soon",
            "prix": "",
            "coming_soon": True,
        })

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

    # ── Nouvelle semaine : reset mémoire GIFs + cache commentaires ──────
    reset_used_gifs()
    if comment_agent.COMMENTAIRES_SEMAINE_FILE.exists():
        try:
            comment_agent.COMMENTAIRES_SEMAINE_FILE.unlink()
        except Exception as e:
            print(f"[pipeline:semaine] Erreur suppression cache commentaires : {e}")

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

    # Générer les commentaires pour les plats du jour (lundi) uniquement
    today_name = DAY_NAMES[date.today().weekday()] if date.today().weekday() < 5 else None
    commentaires_jour = []
    if plats:
        print(f"[pipeline:semaine] Génération des commentaires du jour ({len(plats)} plat(s))...")
        try:
            input_plats = [
                {"restaurant": p["restaurant"], "plat": p["plat"], "prix": p["prix"]}
                for p in plats
            ]
            commentaires_jour = await loop.run_in_executor(
                None,
                comment_agent.generate_commentaires_jour,
                input_plats,
            )
        except Exception as e:
            print(f"[pipeline:semaine] Erreur commentaires jour : {e}")

    if commentaires_jour:
        if today_name:
            _persist_day_comments(today_name, commentaires_jour)
        output = comment_agent.merge_commentaires(output, commentaires_jour, None)
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

        # Si le jour futur est férié, publier un marqueur ferie sans plats
        ferie_nom = est_ferie(future_date)
        if ferie_nom:
            publish_pdj({"date": str(future_date), "ferie": ferie_nom, "plats": []})
            print(f"[pipeline:semaine] Jour férié publié : {day_name} ({future_date}) — {ferie_nom}")
            continue

        day_eval = future_evaluations.get(day_name, {})
        day_plats = day_eval.get("plats", future_days.get(day_name, []))

        # Ajouter la Pause Gourmande en "coming soon"
        day_plats.append({
            "restaurant": "La Pause Gourmande",
            "plat": "Coming soon",
            "prix": "",
            "coming_soon": True,
        })

        future_output = {
            "date": str(future_date),
            "plats": day_plats,
            "recommandation": day_eval.get("recommandation"),
            "recommandation_goulaf": day_eval.get("recommandation_goulaf"),
        }
        publish_pdj(future_output)
        print(f"[pipeline:semaine] Jour futur publié : {day_name} ({future_date})")

    # Publier vers Vercel
    publish_pdj(output)

    # ── Évaluation des idées d'amélioration ──────────────────────────────
    try:
        await loop.run_in_executor(None, idee_agent.evaluer_idees)
    except Exception as e:
        print(f"[pipeline:semaine] Erreur évaluation idées : {e}")

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
    usage = "Usage: python main.py [semaine|jour|commentaires <personnage>|sync-feedback|nouveau-personnage|check-portions]"

    if len(sys.argv) < 2:
        print(usage)
        sys.exit(1)

    mode = sys.argv[1].lower()

    if mode == "semaine":
        asyncio.run(run_semaine())
    elif mode == "jour":
        asyncio.run(run_jour())
    elif mode == "check-portions":
        print("[main] Vérification des photos de référence...")
        estimates = portion_agent.check_and_update()
        available = [slug for slug, d in estimates.items() if d.get("estimated_weight_g")]
        if available:
            print(f"[main] Estimations disponibles : {', '.join(available)}")
            for slug in available:
                e = estimates[slug]
                print(f"  {slug} : {e['estimated_weight_g']}g ({e['photo_count']} photos, calculé le {e['computed_at']})")
        else:
            print("[main] Aucune estimation de portion disponible (pas de photos ?)")
    elif mode == "commentaires":
        if len(sys.argv) < 3:
            print("Usage: python main.py commentaires <personnage>")
            print("  Génère les commentaires pour un seul personnage et les injecte")
            print("  dans commentaires_semaine.json existant.")
            sys.exit(1)
        prenom = sys.argv[2]
        comment_agent.generate_commentaires_personnage(prenom)
    elif mode == "nouveau-personnage":
        creer_personnage()
    elif mode == "sync-feedback":
        updated = feedback_agent.sync_feedback_to_personnages()
        if updated:
            print(f"[main] {len(updated)} personnage(s) mis à jour : {', '.join(updated.keys())}")
        else:
            print("[main] Aucun personnage mis à jour")
    else:
        print(f"Mode inconnu : {mode}")
        print(usage)
        sys.exit(1)


if __name__ == "__main__":
    main()
