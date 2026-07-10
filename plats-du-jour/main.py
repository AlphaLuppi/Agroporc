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
from datetime import date, datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv

OUTPUT_FILE = Path(__file__).parent / "output" / "pdj.json"
HISTORY_DIR = Path(__file__).parent / "output" / "historique"

load_dotenv()

from scrapers import bistrot_trefle, pause_gourmande, truck_muche
from agent import diet_agent, repair_team, comment_agent, feedback_agent, idee_agent, portion_agent
from creer_personnage import creer_personnage
from messages import generer_messages_semaine, maj_message_jour
from publish import publish_pdj, publish_carte, fetch_carte_hash
from jours_feries import est_ferie
from gif_search import reset_used_gifs
import run_state

DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"]

# Codes de sortie (mappés par entrypoint.sh vers success/partial/noop)
EXIT_OK = 0        # journée complète
EXIT_PARTIAL = 3   # a travaillé mais il manque des données
EXIT_NOOP = 4      # état déjà complet, rien fait


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

async def run_jour(retry: bool = False) -> int:
    """Scrape/évalue/commente ce qui manque (état reprenable), publie l'agrégat courant."""
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

    # Mettre à jour le message du jour (remplace "on ne sait pas encore" pour la Pause Gourmande)
    pause = state["scrapes"]["pause_gourmande"]["data"]
    if pause:
        maj_message_jour({"plat": pause["plat"], "prix": pause["prix"]})

    # ── Publier les jours futurs (Trèfle + Truck, PG = coming soon) ──────
    await _step_futurs(state, loop)

    # Publier vers Vercel
    publish_pdj(output)

    # ── Évaluation des idées d'amélioration ──────────────────────────────
    try:
        await loop.run_in_executor(None, idee_agent.evaluer_idees)
    except Exception as e:
        print(f"[pipeline:jour] Erreur évaluation idées : {e}")

    complet = run_state.est_complet(state)
    print(f"[état] {run_state.resume(state)}")
    return EXIT_OK if complet else EXIT_PARTIAL


def run_desserts():
    """Scrape les desserts du jour du Truck Muche et les publie comme observation."""
    import publish
    from scrapers import truck_muche_desserts
    from scrapers.truck_muche_desserts import PARIS
    # Date matchée = date publiée (heure de Paris), pour rester cohérent quel que soit
    # le fuseau du conteneur.
    jour = datetime.now(PARIS).date()
    noms = truck_muche_desserts.scrape_desserts_du_jour(jour)
    if not noms:
        print("[pipeline:desserts] Aucun dessert trouvé (post absent aujourd'hui ?)")
        return
    print(f"[pipeline:desserts] {len(noms)} dessert(s) : {noms}")
    publish.publish_desserts_observation(jour.isoformat(), noms)


# ── Publication des jours futurs ───────────────────────────────────────────

async def _step_futurs(state: dict, loop) -> None:
    """Évalue et publie les jours futurs une seule fois (flag futurs_publies)."""
    today_idx = _weekday_of(state)
    if today_idx >= 4:  # vendredi ou week-end, pas de jours futurs en semaine
        state["futurs_publies"] = True
        run_state.save(state)
        return
    if state["futurs_publies"]:
        return

    # Scrape/charge les données de la semaine (retenté seulement si absent)
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

    # Évaluer les plats des jours futurs
    future_evaluations = {}
    eval_ok = True
    if future_days:
        print(f"[pipeline:futurs] Évaluation des plats de {len(future_days)} jours futurs...")
        try:
            future_evaluations = await loop.run_in_executor(
                None,
                diet_agent.evaluate_semaine,
                future_days,
            )
        except Exception as e:
            print(f"[pipeline:futurs] Erreur évaluation semaine : {e}")
            eval_ok = False

    # Publier chaque jour futur (sans commentaires — ils seront générés le jour même)
    for i, day_name in enumerate(DAY_NAMES[today_idx + 1:], start=1):
        future_date = date.fromisoformat(state["date"]) + timedelta(days=i)

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

    # Publié en dégradé si l'éval a échoué : on laisse le flag à False pour
    # que le prochain retry ré-évalue et republie proprement.
    if eval_ok:
        state["futurs_publies"] = True
        run_state.save(state)


# ── Pipeline semaine (lundi) ────────────────────────────────────────────────

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

    # ── Nouvelle semaine : reset mémoire GIFs + cache commentaires (une fois) ──
    if not state["reset_semaine_fait"]:
        reset_used_gifs()
        if comment_agent.COMMENTAIRES_SEMAINE_FILE.exists():
            try:
                comment_agent.COMMENTAIRES_SEMAINE_FILE.unlink()
            except Exception as e:
                print(f"[pipeline:semaine] Erreur suppression cache commentaires : {e}")
        state["reset_semaine_fait"] = True
        run_state.save(state)

    # ── Scrapes semaine (retentés seulement si absents) ──────────────────
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

    # ── Scrape du jour + éval + commentaires (helpers communs) ───────────
    await _step_scrape_jour(state, loop)
    print(f"[pipeline:semaine] {len(run_state.scrapes_ok(state))}/3 plats du jour récupérés")

    # Messages de la semaine (peu coûteux : régénérés tant que la journée n'est pas close)
    pg = state["scrapes"]["pause_gourmande"]["data"]
    pause_data = {"plat": pg["plat"], "prix": pg["prix"]} if pg else None
    fichiers = generer_messages_semaine(state["semaine"]["trefle"], state["semaine"]["truck"], pause_data)
    print(f"[pipeline:semaine] {len(fichiers)} fichiers messages générés")

    output = await _step_eval(state, loop)
    output = await _step_commentaires(state, loop, output)

    # ── Évaluer et publier les jours futurs (Trèfle + Truck, PG = coming soon) ──
    await _step_futurs(state, loop)

    # Publier vers Vercel
    publish_pdj(output)

    # ── Carte permanente du Trèfle (une fois par lundi, hash-guardée) ────
    if not state["carte_traitee"]:
        try:
            await _traiter_carte(loop)
            state["carte_traitee"] = True
            run_state.save(state)
        except Exception as e:
            print(f"[pipeline:semaine] Erreur traitement carte : {e}")

    # ── Évaluation des idées d'amélioration ──────────────────────────────
    try:
        await loop.run_in_executor(None, idee_agent.evaluer_idees)
    except Exception as e:
        print(f"[pipeline:semaine] Erreur évaluation idées : {e}")

    complet = run_state.est_complet(state)
    print(f"[état] {run_state.resume(state)}")
    return EXIT_OK if complet else EXIT_PARTIAL


# ── Utilitaires communs ─────────────────────────────────────────────────────

async def _traiter_carte(loop) -> None:
    """Scrape la carte du Trèfle ; ré-évalue et publie uniquement si elle a changé (hash)."""
    try:
        carte = await loop.run_in_executor(None, bistrot_trefle.scrape_carte)
    except Exception as e:
        print(f"[pipeline:carte] Erreur scrape carte : {e}")
        return
    if not carte:
        print("[pipeline:carte] Carte non récupérée, skip")
        return

    stored_hash = await loop.run_in_executor(None, fetch_carte_hash)
    if stored_hash and stored_hash == carte["hash"]:
        print("[pipeline:carte] Carte inchangée, évaluation réutilisée")
        return

    print("[pipeline:carte] Carte modifiée → ré-évaluation...")
    try:
        sections = await loop.run_in_executor(None, diet_agent.evaluate_carte, carte["sections"])
    except Exception as e:
        print(f"[pipeline:carte] Erreur évaluation carte (non publiée) : {e}")
        return

    payload = {
        "restaurant_slug": "bistrot_trefle",
        "restaurant": carte["restaurant"],
        "hash": carte["hash"],
        "sections": sections,
    }
    publish_carte(payload)
    print(f"[pipeline:carte] Carte publiée (hash {carte['hash'][:8]})")


_SCRAPE_FNS = {
    "bistrot_trefle": lambda loop: loop.run_in_executor(None, bistrot_trefle.scrape),
    "pause_gourmande": lambda loop: pause_gourmande.scrape(),
    "truck_muche": lambda loop: truck_muche.scrape(),
}


def _weekday_of(state: dict) -> int:
    return date.fromisoformat(state["date"]).weekday()


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
        output = {
            "date": state["date"],
            "erreur": "Aucun plat du jour récupéré",
            "plats": [],
            "recommandation": None,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
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
            # L'échec de l'agent diététicien ne doit PAS être publié : on garde les
            # plats scrapés mais on laisse les champs nutritionnels vides plutôt que
            # d'exposer le message d'erreur sur le site (le champ `erreur` est réservé
            # au cas « aucun plat récupéré » et est affiché tel quel aux utilisateurs).
            # state["eval"] n'est pas mis à jour → l'éval sera retentée au prochain run.
            print(f"[pipeline] Erreur agent (non publiée) : {e}")
            evaluation = {"plats": plats, "recommandation": None}

    output = {
        "date": state["date"],
        **evaluation,
    }
    _archiver_et_ecrire(output)
    return output


def _archiver_et_ecrire(output: dict) -> None:
    """Archive l'ancien pdj.json (si autre date) et écrit le nouveau."""
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


# ── Point d'entrée ──────────────────────────────────────────────────────────

def main():
    usage = "Usage: python main.py [semaine|jour|commentaires <personnage>|sync-feedback|nouveau-personnage|check-portions]"

    if len(sys.argv) < 2:
        print(usage)
        sys.exit(1)

    mode = sys.argv[1].lower()
    retry = "--retry" in sys.argv

    if mode == "semaine":
        sys.exit(asyncio.run(run_semaine(retry=retry)))
    elif mode == "jour":
        sys.exit(asyncio.run(run_jour(retry=retry)))
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
    elif mode == "desserts":
        run_desserts()
    else:
        print(f"Mode inconnu : {mode}")
        print(usage)
        sys.exit(1)


if __name__ == "__main__":
    main()
