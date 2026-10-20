"""
Recettes maison des plats du jour (POC) : pour chaque variante publiée, le LLM du pipeline
rédige une recette « inspirée du plat » (pas celle du restaurant, qu'on ne connaît pas),
validée ici puis envoyée à l'API Next (POST /api/recette). Best-effort : ne lève jamais.

Schéma et bornes : docs/poc-recettes-spec.md §1.2, revalidés côté serveur par
`validerRecette` (lib/recettes.ts). Seule différence : ici, les unités approximatives du LLM
(« cuillère à soupe », « gr »…) sont ramenées à la liste fermée `UNITES` ; le serveur, lui,
refuse toute unité hors liste.
"""
import json
import math
import os
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import plat_image
import plat_recette
from publish import fetch_recettes_existantes, publish_recette, publish_recette_services

# Liste exacte et ordonnée, identique à `UNITES` dans lib/recettes.ts.
UNITES = ["g", "kg", "ml", "cl", "l", "c. à café", "c. à soupe", "pincée", "pièce",
          "gousse", "tranche", "feuille", "brin", "botte", "boîte", "sachet"]
DIFFICULTES = ["facile", "moyenne", "difficile"]

# Comparaison sur unite.lower().strip().rstrip(".") (cf. _cle_unite).
SYNONYMES_UNITES = {
    "gr": "g", "gramme": "g", "grammes": "g",
    "kilo": "kg", "kilos": "kg", "kilogramme": "kg", "kilogrammes": "kg",
    "millilitre": "ml", "millilitres": "ml",
    "centilitre": "cl", "centilitres": "cl",
    "litre": "l", "litres": "l",
    "cuillère à café": "c. à café", "cuillères à café": "c. à café", "càc": "c. à café",
    "cc": "c. à café", "c.à.c": "c. à café", "c. à c": "c. à café", "cuil. à café": "c. à café",
    "cuillère à soupe": "c. à soupe", "cuillères à soupe": "c. à soupe", "càs": "c. à soupe",
    "cs": "c. à soupe", "c.à.s": "c. à soupe", "c. à s": "c. à soupe", "cuil. à soupe": "c. à soupe",
    "pincées": "pincée",
    "pièces": "pièce", "unité": "pièce", "unités": "pièce", "u": "pièce", "": "pièce",
    "gousses": "gousse", "tranches": "tranche", "feuilles": "feuille", "brins": "brin",
    "bottes": "botte", "boîtes": "boîte", "sachets": "sachet",
}

VERSION_PROMPT = 1
MODELE_API = "claude-sonnet-4-6"
TIMEOUT_MAX_S = 180
ESSAIS = 2
# En dessous, un appel LLM n'a aucune chance d'aboutir : on n'en lance pas.
BUDGET_MIN_S = 20

PERSONNES_MIN, PERSONNES_MAX = 1, 12

# Échecs de rédaction du jour {cle: date} : le run 7h30 et ses retries (toutes les 15 min)
# sautent une clé déjà ratée aujourd'hui ; seuls le cron 11h15 et --force la retentent.
FICHIER_ECHECS = Path(__file__).resolve().parents[1] / "output" / "recettes_echecs.json"
TAILLE_MAX_RECETTE = 30000

# (champ, min, max, défaut si absent ; None = obligatoire)
ENTIERS = [("personnes", PERSONNES_MIN, PERSONNES_MAX, None),
           ("temps_preparation_min", 0, 600, None),
           ("temps_cuisson_min", 0, 1440, None),
           ("temps_repos_min", 0, 2880, 0)]
# (champ, nb min, nb max, longueur min, longueur max)
LISTES = [("etapes", 1, 30, 3, 800), ("astuces", 0, 10, 1, 400), ("ustensiles", 0, 20, 1, 80)]

# Exemple du schéma donné au LLM (spec §1.2, sans commentaires).
EXEMPLE = {
    "titre": "Tataki de bœuf, pesto asiatique et purée de carottes",
    "description": "Un bœuf saisi minute…",
    "personnes": 4,
    "temps_preparation_min": 25,
    "temps_cuisson_min": 15,
    "temps_repos_min": 0,
    "difficulte": "moyenne",
    "ingredients": [
        {"nom": "rumsteck de bœuf", "quantite": 600, "unite": "g",
         "note": "en un seul morceau", "groupe": "Pour le bœuf"},
        {"nom": "œufs", "quantite": 2, "unite": "pièce"},
        {"nom": "sel, poivre", "quantite": None, "unite": None},
    ],
    "etapes": ["Sortir la viande…", "…"],
    "astuces": ["Saisir la viande très chaude…"],
    "ustensiles": ["poêle", "mixeur"],
}


# ── Prompt et appel LLM ─────────────────────────────────────────────────────

def construire_prompt(variante: dict) -> str:
    """Prompt français d'une variante (cf. plat_recette.a_cuisiner)."""
    libelle = plat_image.libelle_lisible(variante.get("plat") or "")
    contexte = (f"Plat servi par {variante.get('restaurant') or ''} le {variante.get('date') or ''} "
                f"sous le libellé : {libelle}")
    ingredients = variante.get("ingredients") or []
    if ingredients:
        lignes = "\n".join(f"- {i['nom']} : {i['grammes']} g" for i in ingredients)
        contexte += ("\n\nIngrédients et grammages estimés pour UNE portion (noms issus d'une "
                     f"table nutritionnelle, à traduire en ingrédients du commerce) :\n{lignes}")
    unites = ", ".join(f'"{u}"' for u in UNITES)
    return (
        "Tu es un cuisinier qui écrit des recettes maison accessibles.\n\n"
        f"{contexte}\n\n"
        "Tu ne connais pas la recette du restaurant : propose une recette maison plausible et "
        "classique qui permet d'obtenir un plat proche. N'affirme jamais que c'est la recette du "
        "restaurant et ne cite pas le restaurant dans le titre ni dans les étapes.\n\n"
        "Consignes :\n"
        "- recette pour 4 personnes (\"personnes\": 4) ;\n"
        "- matériel de cuisine domestique, ingrédients trouvables en supermarché, aucune marque ;\n"
        "- temps de préparation, de cuisson et de repos réalistes, en minutes ;\n"
        "- étapes dans l'ordre, une action par étape, sans numéro dans le texte ;\n"
        f"- quantités exprimées UNIQUEMENT avec ces unités : {unites} ;\n"
        "- pour un ingrédient « selon goût » (sel, poivre…) : \"quantite\": null, \"unite\": null ;\n"
        f"- difficulté parmi : {', '.join(DIFFICULTES)}.\n\n"
        "Schéma attendu (exemple) :\n"
        f"{json.dumps(EXEMPLE, ensure_ascii=False, indent=2)}\n\n"
        "Réponds UNIQUEMENT avec l'objet JSON, sans markdown ni texte autour."
    )


def appeler_llm(prompt: str, timeout: float) -> tuple[str, str, str]:
    """(texte, modele, fournisseur). Un seul essai borné par `timeout`, même mécanisme que
    `image_agent._appel_llm` (API si ANTHROPIC_API_KEY, sinon CLI claude)."""
    from agent.diet_agent import CLAUDE_BIN
    if os.getenv("ANTHROPIC_API_KEY"):
        import anthropic
        client = anthropic.Anthropic(timeout=timeout, max_retries=0)
        msg = client.messages.create(
            model=MODELE_API, max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        texte, modele, fournisseur = msg.content[0].text, MODELE_API, "anthropic-api"
    elif CLAUDE_BIN:
        res = subprocess.run([CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
                             capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            raise RuntimeError(f"claude CLI : {res.stderr.strip()[:200]}")
        texte, modele, fournisseur = res.stdout, "claude-cli", "claude-cli"
    else:
        raise RuntimeError("ni ANTHROPIC_API_KEY ni CLI claude")
    if not (texte or "").strip():
        raise RuntimeError("réponse vide du LLM")
    return texte, modele, fournisseur


def extraire_json(brut: str) -> dict | None:
    """Objet JSON de la réponse LLM (bloc ```json toléré, texte autour ignoré), sinon None."""
    try:
        t = (brut or "").strip()
        t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
        debut, fin = t.find("{"), t.rfind("}")
        if debut < 0 or fin <= debut:
            return None
        data = json.loads(t[debut:fin + 1])
        return data if isinstance(data, dict) else None
    except Exception:
        return None


# ── Normalisation et validation ─────────────────────────────────────────────

def _texte(v) -> str | None:
    """Chaîne nettoyée (trim, espaces multiples → un), None si pas une chaîne."""
    return " ".join(v.split()) if isinstance(v, str) else None


def _lg(s: str) -> int:
    """Longueur en unités UTF-16, comme `String.length` côté serveur (un emoji compte 2)."""
    return len(s.encode("utf-16-le")) // 2


def _tronquer(s: str, maxi: int) -> str:
    """Coupe `s` à `maxi` unités UTF-16 au plus, sans couper un caractère."""
    while _lg(s) > maxi:
        s = s[:-1]
    return s


def _entier(v) -> int | None:
    """int, flottant entier (25.0) ou chaîne de chiffres ("25") → int ; sinon None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() else None
    if isinstance(v, str) and v.strip().isdigit():
        return int(v.strip())
    return None


def _nombre(v) -> float | None:
    """Nombre ou chaîne numérique (virgule française acceptée) ; None si illisible."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip().replace(",", "."))
        except ValueError:
            return None
    return None


def _propre(q: float) -> int | float:
    """Arrondi à 2 décimales ; entier quand il l'est (600 plutôt que 600.0)."""
    q = round(q, 2)
    return int(q) if q.is_integer() else q


def _format_quantite(q) -> str:
    return str(_propre(q)).replace(".", ",") if q is not None else ""


def _cle_unite(unite: str) -> str:
    return unite.lower().strip().rstrip(".")


_UNITES_PAR_CLE = {**SYNONYMES_UNITES, **{_cle_unite(u): u for u in UNITES}}


def normaliser_unite(unite, quantite) -> tuple[float | None, str | None, str | None]:
    """(quantite, unite, note_prefixe). Ramène l'unité du LLM dans `UNITES` ; une unité
    inconnue passe en « selon goût » et la valeur brute part en tête de la note."""
    if unite is None:
        return quantite, None, None
    if not isinstance(unite, str):
        unite = str(unite)
    cle = _cle_unite(" ".join(unite.split()))
    if cle == "" and quantite is None:
        return None, None, None
    if cle in _UNITES_PAR_CLE:
        return quantite, _UNITES_PAR_CLE[cle], None
    brut = " ".join(f"{_format_quantite(quantite)} {' '.join(unite.split())}".split())
    return None, None, brut


def _valider_ingredient(i: int, ing, erreurs: list[str]) -> dict | None:
    chemin = f"ingredients[{i}]"
    if not isinstance(ing, dict):
        erreurs.append(f"{chemin} : objet attendu")
        return None
    out, avant = {}, len(erreurs)
    nom = _texte(ing.get("nom"))
    if nom is None or not 1 <= _lg(nom) <= 120:
        erreurs.append(f"{chemin}.nom : texte de 1 à 120 caractères attendu")
    out["nom"] = nom

    quantite = None
    if ing.get("quantite") is not None:
        q = _nombre(ing.get("quantite"))
        # Contrôle APRÈS l'arrondi, comme le serveur : 0.004 g s'arrondit à 0 et serait refusé (422).
        q2 = _propre(q) if q is not None and math.isfinite(q) else None
        if q2 is None or not 0 < q <= 10000 or q2 <= 0:
            erreurs.append(f"{chemin}.quantite : nombre entre 0 (exclu) et 10000 ou null attendu")
        else:
            quantite = q2

    note = _texte(ing.get("note")) if ing.get("note") is not None else ""
    if note is None or _lg(note) > 120:
        erreurs.append(f"{chemin}.note : texte de 120 caractères au plus attendu")
        note = ""
    quantite, unite, prefixe = normaliser_unite(ing.get("unite"), quantite)
    if prefixe:
        note = _tronquer(f"{prefixe}, {note}" if note else prefixe, 120).strip()
    if unite is None and quantite is not None:
        erreurs.append(f"{chemin}.unite : unité obligatoire quand la quantité est renseignée")
    out["quantite"], out["unite"] = quantite, unite
    if note:
        out["note"] = note

    groupe = _texte(ing.get("groupe")) if ing.get("groupe") is not None else ""
    if groupe is None or _lg(groupe) > 60:
        erreurs.append(f"{chemin}.groupe : texte de 60 caractères au plus attendu")
    elif groupe:
        out["groupe"] = groupe
    return out if len(erreurs) == avant else None


def valider_recette(data: dict) -> dict:
    """Normalise (synonymes d'unités compris) et valide une recette LLM.
    Renvoie le `RecetteContenu` propre (champs inconnus retirés) ou lève ValueError
    avec toutes les erreurs, chemin compris, jointes par « ; »."""
    if not isinstance(data, dict):
        raise ValueError("recette : objet attendu")
    erreurs: list[str] = []
    out: dict = {}

    titre = _texte(data.get("titre"))
    if titre is None or not 3 <= _lg(titre) <= 200:
        erreurs.append("titre : texte de 3 à 200 caractères attendu")
    out["titre"] = titre

    description = _texte(data.get("description")) if data.get("description") is not None else ""
    if description is None or _lg(description) > 600:
        erreurs.append("description : texte de 600 caractères au plus attendu")
    out["description"] = description

    for champ, mini, maxi, defaut in ENTIERS:
        v = data.get(champ)
        n = defaut if v is None and defaut is not None else _entier(v)
        if n is None or not mini <= n <= maxi:
            erreurs.append(f"{champ} : entier entre {mini} et {maxi} attendu")
        out[champ] = n

    difficulte = _texte(data.get("difficulte"))
    difficulte = difficulte.lower() if difficulte else difficulte
    if difficulte not in DIFFICULTES:
        erreurs.append(f"difficulte : valeur parmi {', '.join(DIFFICULTES)} attendue")
    out["difficulte"] = difficulte

    ingredients = data.get("ingredients")
    if not isinstance(ingredients, list):
        erreurs.append("ingredients : liste attendue")
        ingredients = []
    if not 1 <= len(ingredients) <= 40:
        erreurs.append("ingredients : de 1 à 40 ingrédients attendus")
    out["ingredients"] = [_valider_ingredient(i, ing, erreurs) for i, ing in enumerate(ingredients)]

    for champ, nb_min, nb_max, lg_min, lg_max in LISTES:
        v = data.get(champ)
        if v is None and nb_min == 0:
            v = []
        if not isinstance(v, list):
            erreurs.append(f"{champ} : liste attendue")
            v = []
        elements = []
        for i, e in enumerate(v):
            t = _texte(e)
            if t is None:
                erreurs.append(f"{champ}[{i}] : texte attendu")
            elif t:
                if not lg_min <= _lg(t) <= lg_max:
                    erreurs.append(f"{champ}[{i}] : texte de {lg_min} à {lg_max} caractères attendu")
                elements.append(t)
        if not nb_min <= len(elements) <= nb_max:
            if champ == "etapes" and not elements:
                erreurs.append("etapes : au moins 1 étape")
            else:
                erreurs.append(f"{champ} : de {nb_min} à {nb_max} éléments attendus")
        out[champ] = elements

    if not erreurs and _lg(json.dumps(out, ensure_ascii=False)) > TAILLE_MAX_RECETTE:
        erreurs.append(f"recette : {TAILLE_MAX_RECETTE} caractères au plus")
    if erreurs:
        raise ValueError(" ; ".join(erreurs))
    return out


# ── Rédaction et lot ────────────────────────────────────────────────────────

def aujourd_hui_paris() -> str:
    return datetime.now(ZoneInfo("Europe/Paris")).date().isoformat()


def _lire_echecs(jour: str) -> dict:
    """Échecs mémorisés pour `jour` (les autres jours sont oubliés)."""
    try:
        data = json.loads(FICHIER_ECHECS.read_text(encoding="utf-8"))
        return {c: d for c, d in data.items() if d == jour} if isinstance(data, dict) else {}
    except Exception:
        return {}


def _ecrire_echecs(echecs: dict) -> None:
    try:
        FICHIER_ECHECS.parent.mkdir(parents=True, exist_ok=True)
        FICHIER_ECHECS.write_text(json.dumps(echecs, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"[recettes] échecs non mémorisés : {e}")


def rediger(variante: dict, deadline: float) -> dict:
    """Recette validée d'une variante : jusqu'à ESSAIS appels LLM dans le budget.
    Renvoie {recette, modele, fournisseur} ; lève si tous échouent."""
    prompt = construire_prompt(variante)
    erreurs = []
    for _ in range(ESSAIS):
        restant = deadline - time.monotonic()
        if restant < BUDGET_MIN_S:
            erreurs.append("budget de temps insuffisant")
            break
        try:
            texte, modele, fournisseur = appeler_llm(prompt, min(TIMEOUT_MAX_S, restant))
            data = extraire_json(texte)
            if data is None:
                raise ValueError("réponse non JSON")
            return {"recette": valider_recette(data), "modele": modele, "fournisseur": fournisseur}
        except Exception as e:
            erreurs.append(str(e)[:300])
    raise RuntimeError(" | ".join(erreurs) or "budget de temps insuffisant")


def cuisiner(pdjs: list[dict], budget_s: float, force: bool = False,
             max_recettes: int | None = None, sauter_echecs: bool = False,
             aujourd_hui: str | None = None) -> dict:
    """Rédige et publie les recettes manquantes des PDJ donnés, dans la limite du budget, et
    enregistre les dates de service passées ou du jour (pas les jours à venir, publiés
    d'avance : le plat n'est pas encore servi). Ne lève jamais.
    `sauter_echecs` : saute les clés déjà en échec aujourd'hui (run 7h30 et retries).
    Renvoie un bilan {a_faire, deja, ok, echecs, restantes, services}."""
    bilan = {"a_faire": 0, "deja": 0, "ok": 0, "echecs": 0, "restantes": 0, "services": 0}
    try:
        jour = aujourd_hui or aujourd_hui_paris()
        echecs = _lire_echecs(jour)
        deadline = time.monotonic() + budget_s
        items, vus, valides = [], set(), []
        for pdj in pdjs or []:
            try:
                a_faire = plat_recette.a_cuisiner(pdj)
            except Exception as e:  # un PDJ mal formé ne prive pas les autres de recettes
                print(f"[recettes] PDJ {pdj.get('date') if isinstance(pdj, dict) else '?'} ignoré : {e}")
                continue
            valides.append(pdj)
            for it in a_faire:
                if it["cle"] not in vus:
                    vus.add(it["cle"])
                    items.append(it)
        # Historique des services, y compris des plats qui ont déjà leur recette.
        try:
            couples = [c for c in plat_recette.services(valides) if c["date"] <= jour]
            if couples:
                bilan["services"] = publish_recette_services(couples) or 0
        except Exception as e:
            print(f"[recettes] dates de service non enregistrées : {e}")
        if not force and items:
            existantes = fetch_recettes_existantes([it["cle"] for it in items])
            if existantes is None:
                print("[recettes] liste des recettes existantes indisponible → on ne génère rien")
                bilan["restantes"] = len(items)
                return bilan
            bilan["deja"] = sum(1 for it in items if it["cle"] in existantes)
            items = [it for it in items if it["cle"] not in existantes]
        if sauter_echecs and not force and echecs:
            avant = len(items)
            items = [it for it in items if it["cle"] not in echecs]
            if len(items) < avant:
                print(f"[recettes] {avant - len(items)} plat(s) déjà en échec aujourd'hui, retentés au cron de 11h15")
        bilan["a_faire"] = len(items)
        for i, it in enumerate(items):
            if (deadline - time.monotonic() < BUDGET_MIN_S
                    or (max_recettes is not None and bilan["ok"] >= max_recettes)):
                bilan["restantes"] = len(items) - i
                break
            try:
                res = rediger(it, deadline)
            except Exception as e:
                print(f"[recettes] {it['restaurant']} — {it['plat']} : {e}")
                bilan["echecs"] += 1
                echecs[it["cle"]] = jour
                _ecrire_echecs(echecs)
                continue
            ok = publish_recette({
                "cle": it["cle"], "restaurant": it["restaurant"], "plat": it["plat"],
                "date": it["date"], "recette": res["recette"],
                "modele": res["modele"], "fournisseur": res["fournisseur"],
                "version_prompt": VERSION_PROMPT, "force": force,
            })
            if ok:
                bilan["ok"] += 1
                print(f"[recettes] {it['restaurant']} — {it['plat']} : OK ({res['recette']['titre']})")
                if echecs.pop(it["cle"], None):
                    _ecrire_echecs(echecs)
            else:
                bilan["echecs"] += 1
                echecs[it["cle"]] = jour
                _ecrire_echecs(echecs)
    except Exception as e:
        print(f"[recettes] erreur inattendue : {e}")
    print(f"[recettes] bilan {json.dumps(bilan)}")
    return bilan
