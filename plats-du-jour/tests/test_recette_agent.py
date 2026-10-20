import copy
import json
import sys
import types
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))

import plat_image as pi
from agent import diet_agent, recette_agent as ra

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "recette_valide.json").read_text(encoding="utf-8"))
PDJ = {"date": "2026-10-20", "plats": [
    {"restaurant": "Le Truck Muche", "plat": "POKE BOWL"},
    {"restaurant": "Le Bistrot Trèfle", "plat": "Blanquette de veau"},
    {"restaurant": "La Pause Gourmande", "plat": "Coming soon", "coming_soon": True},
]}
CLE_TRUCK = pi.cle_image("Le Truck Muche", "POKE BOWL")
CLE_TREFLE = pi.cle_image("Le Bistrot Trèfle", "Blanquette de veau")


@pytest.fixture(autouse=True)
def _isolement(monkeypatch, tmp_path):
    # Jamais le vrai output/ ; date du jour figée pour les dates de service.
    monkeypatch.setattr(ra, "FICHIER_ECHECS", tmp_path / "recettes_echecs.json")
    monkeypatch.setattr(ra, "aujourd_hui_paris", lambda: "2026-10-20")


def recette(**modifs):
    r = copy.deepcopy(FIXTURE)
    r.update(modifs)
    return r


def ingredient(**ing):
    return recette(ingredients=[{"nom": "farine", **ing}])["ingredients"]


# ── extraire_json ───────────────────────────────────────────────────────────

def test_extraire_json():
    assert ra.extraire_json('{"a": 1}') == {"a": 1}
    assert ra.extraire_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert ra.extraire_json('Voici la recette : {"a": {"b": 2}} Bon appétit !') == {"a": {"b": 2}}
    assert ra.extraire_json('{"a": 1,') is None
    assert ra.extraire_json("[1, 2]") is None
    assert ra.extraire_json("") is None and ra.extraire_json(None) is None


# ── valider_recette ─────────────────────────────────────────────────────────

def test_fixture_valide_et_inchangee():
    assert ra.valider_recette(copy.deepcopy(FIXTURE)) == FIXTURE


def test_unites_listes_identiques_au_contrat():
    assert ra.UNITES == ["g", "kg", "ml", "cl", "l", "c. à café", "c. à soupe", "pincée", "pièce",
                         "gousse", "tranche", "feuille", "brin", "botte", "boîte", "sachet"]
    assert all(v in ra.UNITES for v in ra.SYNONYMES_UNITES.values())


@pytest.mark.parametrize("brut,attendu", [
    ("cuillère à soupe", "c. à soupe"), ("Cuillères à café", "c. à café"), ("cs", "c. à soupe"),
    ("c.à.c.", "c. à café"), ("gr", "g"), ("grammes", "g"), ("Litres", "l"), ("gousses", "gousse"),
    ("pièces", "pièce"), ("unités", "pièce"), ("", "pièce"), ("G", "g"), ("boîtes", "boîte"),
])
def test_synonymes_d_unites(brut, attendu):
    r = ra.valider_recette(recette(ingredients=[{"nom": "x", "quantite": 2, "unite": brut}]))
    assert r["ingredients"][0]["unite"] == attendu and r["ingredients"][0]["quantite"] == 2


def test_unite_inconnue_passe_en_selon_gout_avec_note():
    r = ra.valider_recette(recette(ingredients=[
        {"nom": "vin blanc", "quantite": 200, "unite": "verres"},
        {"nom": "persil", "quantite": "1,5", "unite": "poignées", "note": "ciselé"},
    ]))
    assert r["ingredients"][0] == {"nom": "vin blanc", "quantite": None, "unite": None, "note": "200 verres"}
    assert r["ingredients"][1] == {"nom": "persil", "quantite": None, "unite": None,
                                   "note": "1,5 poignées, ciselé"}
    long = ra.valider_recette(recette(ingredients=[{"nom": "x", "quantite": 1, "unite": "z" * 200}]))
    assert len(long["ingredients"][0]["note"]) == 120


def test_normalisation():
    r = ra.valider_recette({
        **{k: v for k, v in FIXTURE.items() if k not in ("astuces", "ustensiles", "temps_repos_min", "description")},
        "titre": "  Rôti   de dinde  ",
        "personnes": "4", "temps_preparation_min": 30.0, "temps_cuisson_min": "60",
        "difficulte": " Facile ",
        "ingredients": [{"nom": " farine ", "quantite": "1,5", "unite": "kg", "inconnu": 1, "note": "  "}],
        "etapes": ["  ", "Mélanger   tout.", ""],
        "champ_inconnu": "x",
    })
    assert r["titre"] == "Rôti de dinde"
    assert r["personnes"] == 4 and r["temps_preparation_min"] == 30 and r["temps_cuisson_min"] == 60
    assert r["difficulte"] == "facile"
    assert r["ingredients"] == [{"nom": "farine", "quantite": 1.5, "unite": "kg"}]
    assert r["etapes"] == ["Mélanger tout."]
    assert r["astuces"] == [] and r["ustensiles"] == [] and r["temps_repos_min"] == 0 and r["description"] == ""
    assert "champ_inconnu" not in r
    assert list(r) == ["titre", "description", "personnes", "temps_preparation_min", "temps_cuisson_min",
                       "temps_repos_min", "difficulte", "ingredients", "etapes", "astuces", "ustensiles"]


def test_quantite_arrondie_et_selon_gout():
    r = ra.valider_recette(recette(ingredients=[{"nom": "a", "quantite": 0.3333, "unite": "kg"},
                                                {"nom": "sel", "quantite": None, "unite": None},
                                                {"nom": "poivre", "quantite": None, "unite": ""}]))
    assert r["ingredients"][0]["quantite"] == 0.33
    assert r["ingredients"][1] == {"nom": "sel", "quantite": None, "unite": None}
    assert r["ingredients"][2] == {"nom": "poivre", "quantite": None, "unite": None}


@pytest.mark.parametrize("modifs,champ", [
    ({"personnes": 0}, "personnes"),
    ({"personnes": 13}, "personnes"),
    ({"personnes": 2.5}, "personnes"),
    ({"temps_cuisson_min": -5}, "temps_cuisson_min"),
    ({"difficulte": "très dur"}, "difficulte"),
    ({"etapes": []}, "etapes"),
    ({"etapes": ["  "]}, "etapes"),
    ({"ingredients": [{"nom": f"i{i}", "quantite": 1, "unite": "g"} for i in range(41)]}, "ingredients"),
    ({"ingredients": []}, "ingredients"),
    ({"titre": "ab"}, "titre"),
    ({"astuces": ["x"] * 11}, "astuces"),
    ({"ustensiles": ["u" * 81]}, "ustensiles[0]"),
])
def test_erreurs_mentionnent_le_champ(modifs, champ):
    with pytest.raises(ValueError) as e:
        ra.valider_recette(recette(**modifs))
    assert str(e.value).startswith(champ) or f" ; {champ}" in str(e.value)


@pytest.mark.parametrize("ing,chemin", [
    ({"quantite": 2, "unite": None}, "ingredients[0].unite"),
    ({"quantite": 0, "unite": "g"}, "ingredients[0].quantite"),
    ({"quantite": 20000, "unite": "g"}, "ingredients[0].quantite"),
    ({"quantite": "beaucoup", "unite": "g"}, "ingredients[0].quantite"),
    ({"nom": "", "quantite": 1, "unite": "g"}, "ingredients[0].nom"),
    ({"quantite": 1, "unite": "g", "groupe": "g" * 61}, "ingredients[0].groupe"),
])
def test_erreurs_d_ingredient(ing, chemin):
    with pytest.raises(ValueError, match=chemin.replace("[", r"\[").replace("]", r"\]")):
        ra.valider_recette(recette(ingredients=ingredient(**ing)))


@pytest.mark.parametrize("q,unite", [(0.001, "g"), (0.004, "kg"), ("0,004", "g")])
def test_quantite_nulle_apres_arrondi_refusee_comme_le_serveur(q, unite):
    # lib/recettes.ts refuse une quantité dont l'arrondi à 2 décimales vaut 0.
    with pytest.raises(ValueError, match=r"ingredients\[0\]\.quantite"):
        ra.valider_recette(recette(ingredients=ingredient(quantite=q, unite=unite)))
    assert ra.valider_recette(recette(ingredients=ingredient(quantite=0.005, unite="g")))["ingredients"][0]["quantite"] > 0


def test_longueurs_comptees_en_utf16_comme_le_serveur():
    # 150 emojis = 150 points de code mais 300 unités UTF-16 (String.length) > 200.
    with pytest.raises(ValueError, match="titre"):
        ra.valider_recette(recette(titre="🍲" * 150))
    assert ra.valider_recette(recette(titre="🍲" * 100))["titre"] == "🍲" * 100
    with pytest.raises(ValueError, match=r"etapes\[0\]"):
        ra.valider_recette(recette(etapes=["🔥" * 401]))
    # note préfixée par une unité inconnue : tronquée à 120 unités UTF-16 sans couper un emoji
    r = ra.valider_recette(recette(ingredients=ingredient(quantite=1, unite="poignée", note="🌿" * 55)))
    note = r["ingredients"][0]["note"]
    assert note.startswith("1 poignée, 🌿") and note.endswith("🌿") and ra._lg(note) == 119  # 120 couperait un emoji


def test_erreurs_cumulees_et_entree_non_objet():
    with pytest.raises(ValueError) as e:
        ra.valider_recette(recette(personnes=0, difficulte="?", etapes=[]))
    assert str(e.value).count(" ; ") == 2
    with pytest.raises(ValueError):
        ra.valider_recette(["pas", "un", "objet"])


def test_recette_trop_volumineuse():
    etapes = ["e" * 800] * 30
    astuces = ["a" * 400] * 10
    ings = [{"nom": "n" * 120, "quantite": 1, "unite": "g", "note": "x" * 120, "groupe": "g" * 60}] * 40
    with pytest.raises(ValueError, match="30000"):
        ra.valider_recette(recette(etapes=etapes, astuces=astuces, ingredients=ings))


# ── construire_prompt ───────────────────────────────────────────────────────

VARIANTE = {"cle": CLE_TRUCK, "restaurant": "Le Truck Muche", "plat": "POKE BOWL SAUMON TERYAKI",
            "date": "2026-10-20", "ingredients": [{"nom": "Saumon, cru", "grammes": 120}]}


def test_construire_prompt():
    p = ra.construire_prompt(VARIANTE)
    assert "Poke bowl saumon teryaki" in p and "Le Truck Muche" in p and "2026-10-20" in p
    assert "4 personnes" in p
    assert all(f'"{u}"' in p for u in ra.UNITES)
    assert "N'affirme jamais que c'est la recette du restaurant" in p
    assert "pour UNE portion" in p and "- Saumon, cru : 120 g" in p
    assert "Réponds UNIQUEMENT avec l'objet JSON" in p
    sans = ra.construire_prompt({**VARIANTE, "ingredients": []})
    assert "grammages estimés" not in sans


# ── appeler_llm ─────────────────────────────────────────────────────────────

def _faux_anthropic(monkeypatch, texte):
    appels = []

    class Client:
        def __init__(self, **kw):
            appels.append(kw)
            self.messages = self

        def create(self, **kw):
            appels.append(kw)
            return types.SimpleNamespace(content=[types.SimpleNamespace(text=texte)])

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=Client))
    return appels


def test_appeler_llm_api(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    appels = _faux_anthropic(monkeypatch, '{"titre": "x"}')
    assert ra.appeler_llm("prompt", 42) == ('{"titre": "x"}', "claude-sonnet-4-6", "anthropic-api")
    assert appels[0] == {"timeout": 42, "max_retries": 0}
    assert appels[1]["model"] == "claude-sonnet-4-6" and appels[1]["max_tokens"] == 4096


def test_appeler_llm_cli(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(diet_agent, "CLAUDE_BIN", "/faux/claude")
    vus = []

    def run(cmd, **kw):
        vus.append((cmd, kw["timeout"]))
        return types.SimpleNamespace(returncode=0, stdout="{}", stderr="")
    monkeypatch.setattr(ra.subprocess, "run", run)
    assert ra.appeler_llm("prompt", 30) == ("{}", "claude-cli", "claude-cli")
    assert vus == [(["/faux/claude", "-p", "prompt", "--output-format", "text"], 30)]


def test_appeler_llm_indisponible_ou_vide(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(diet_agent, "CLAUDE_BIN", None)
    with pytest.raises(RuntimeError, match="ni ANTHROPIC_API_KEY ni CLI claude"):
        ra.appeler_llm("prompt", 30)
    monkeypatch.setattr(diet_agent, "CLAUDE_BIN", "/faux/claude")
    monkeypatch.setattr(ra.subprocess, "run",
                        lambda cmd, **kw: types.SimpleNamespace(returncode=0, stdout="  \n", stderr=""))
    with pytest.raises(RuntimeError, match="vide"):
        ra.appeler_llm("prompt", 30)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    _faux_anthropic(monkeypatch, "")
    with pytest.raises(RuntimeError, match="vide"):
        ra.appeler_llm("prompt", 30)


# ── rediger ─────────────────────────────────────────────────────────────────

def _llm_scripte(monkeypatch, reponses):
    appels = []

    def appeler(prompt, timeout):
        appels.append(timeout)
        return reponses.pop(0), "claude-cli", "claude-cli"
    monkeypatch.setattr(ra, "appeler_llm", appeler)
    return appels


def test_rediger_reessaie_apres_une_reponse_invalide(monkeypatch):
    appels = _llm_scripte(monkeypatch, ["pas du json", "```json\n" + json.dumps(FIXTURE) + "\n```"])
    res = ra.rediger(VARIANTE, deadline=ra.time.monotonic() + 1000)
    assert res == {"recette": FIXTURE, "modele": "claude-cli", "fournisseur": "claude-cli"}
    assert len(appels) == 2 and all(t == ra.TIMEOUT_MAX_S for t in appels)


def test_rediger_leve_apres_deux_echecs(monkeypatch):
    appels = _llm_scripte(monkeypatch, ["{}", json.dumps(recette(personnes=0))])
    with pytest.raises(RuntimeError, match="personnes"):
        ra.rediger(VARIANTE, deadline=ra.time.monotonic() + 1000)
    assert len(appels) == 2


def test_rediger_sans_budget_n_appelle_pas(monkeypatch):
    appels = _llm_scripte(monkeypatch, [json.dumps(FIXTURE)])
    with pytest.raises(RuntimeError, match="budget"):
        ra.rediger(VARIANTE, deadline=ra.time.monotonic() + 10)
    assert appels == []


def test_rediger_timeout_borne_par_le_budget(monkeypatch):
    appels = _llm_scripte(monkeypatch, [json.dumps(FIXTURE)])
    ra.rediger(VARIANTE, deadline=ra.time.monotonic() + 60)
    assert 50 < appels[0] <= 60


# ── cuisiner ────────────────────────────────────────────────────────────────

class Espion:
    def __init__(self, monkeypatch, existantes=frozenset(), rediger=None, publier_ok=True, services=3):
        self.rediges, self.publies, self.demandes, self.services = [], [], [], []

        def _existantes(cles):
            self.demandes.append(list(cles))
            return None if existantes is None else set(existantes)

        def _rediger(variante, deadline):
            self.rediges.append(variante["plat"])
            if rediger:
                return rediger(variante)
            return {"recette": FIXTURE, "modele": "claude-cli", "fournisseur": "claude-cli"}

        def _services(couples):
            self.services.append(list(couples))
            if isinstance(services, Exception):
                raise services
            return services

        monkeypatch.setattr(ra, "fetch_recettes_existantes", _existantes)
        monkeypatch.setattr(ra, "rediger", _rediger)
        monkeypatch.setattr(ra, "publish_recette", lambda payload: self.publies.append(payload) or publier_ok)
        monkeypatch.setattr(ra, "publish_recette_services", _services)


def test_cuisiner_saute_existantes_et_coming_soon(monkeypatch):
    e = Espion(monkeypatch, existantes={CLE_TRUCK})
    bilan = ra.cuisiner([PDJ], budget_s=600)
    assert e.rediges == ["Blanquette de veau"]
    assert bilan == {"a_faire": 1, "deja": 1, "ok": 1, "echecs": 0, "restantes": 0, "services": 3}
    assert e.publies == [{"cle": CLE_TREFLE, "restaurant": "Le Bistrot Trèfle", "plat": "Blanquette de veau",
                          "date": "2026-10-20", "recette": FIXTURE, "modele": "claude-cli",
                          "fournisseur": "claude-cli", "version_prompt": 1, "force": False}]


def test_cuisiner_envoie_les_services_de_toutes_les_variantes(monkeypatch):
    e = Espion(monkeypatch, existantes={CLE_TRUCK, CLE_TREFLE})
    bilan = ra.cuisiner([PDJ], budget_s=600)
    assert e.services == [[{"cle": CLE_TRUCK, "date": "2026-10-20"}, {"cle": CLE_TREFLE, "date": "2026-10-20"}]]
    assert e.rediges == [] and bilan["deja"] == 2 and bilan["ok"] == 0


def test_cuisiner_force_ne_consulte_pas_l_api(monkeypatch):
    e = Espion(monkeypatch, existantes={CLE_TRUCK})
    ra.cuisiner([PDJ], budget_s=600, force=True)
    assert e.demandes == [] and e.rediges == ["POKE BOWL", "Blanquette de veau"]
    assert all(p["force"] is True for p in e.publies)


def test_cuisiner_api_injoignable_ne_genere_rien(monkeypatch):
    e = Espion(monkeypatch, existantes=None)
    bilan = ra.cuisiner([PDJ], budget_s=600)
    assert e.rediges == [] and bilan["restantes"] == 2 and bilan["ok"] == 0


def test_cuisiner_echec_de_redaction_compte_et_continue(monkeypatch):
    def boum(v):
        if v["plat"] == "POKE BOWL":
            raise RuntimeError("réponse non JSON")
        return {"recette": FIXTURE, "modele": "m", "fournisseur": "f"}
    e = Espion(monkeypatch, rediger=boum)
    bilan = ra.cuisiner([PDJ], budget_s=600)
    assert bilan["echecs"] == 1 and bilan["ok"] == 1
    assert [p["plat"] for p in e.publies] == ["Blanquette de veau"]


def test_cuisiner_publication_refusee_compte_en_echec(monkeypatch):
    Espion(monkeypatch, publier_ok=False)
    bilan = ra.cuisiner([PDJ], budget_s=600)
    assert bilan["echecs"] == 2 and bilan["ok"] == 0


def test_cuisiner_budget_epuise(monkeypatch):
    e = Espion(monkeypatch)
    bilan = ra.cuisiner([PDJ], budget_s=0)
    assert e.rediges == [] and bilan["restantes"] == 2 and bilan["a_faire"] == 2


def test_cuisiner_max_recettes(monkeypatch):
    e = Espion(monkeypatch)
    bilan = ra.cuisiner([PDJ], budget_s=600, max_recettes=1)
    assert len(e.publies) == 1 and bilan["restantes"] == 1


def test_cuisiner_services_en_erreur_n_arrete_rien(monkeypatch):
    e = Espion(monkeypatch, services=RuntimeError("API KO"))
    bilan = ra.cuisiner([PDJ], budget_s=600)
    assert bilan["services"] == 0 and bilan["ok"] == 2 and len(e.publies) == 2


def test_cuisiner_ne_leve_jamais(monkeypatch):
    Espion(monkeypatch)
    monkeypatch.setattr(ra, "publish_recette", lambda payload: 1 / 0)
    bilan = ra.cuisiner([PDJ], budget_s=600)
    assert isinstance(bilan, dict) and bilan["ok"] == 0
    # un PDJ mal formé est ignoré, les autres sont traités
    Espion(monkeypatch)
    bilan = ra.cuisiner([{"date": "x", "plats": 42}, PDJ], budget_s=600)
    assert bilan["ok"] == 2


def test_cuisiner_jour_ferie_ou_sans_plat(monkeypatch):
    e = Espion(monkeypatch)
    bilan = ra.cuisiner([{"date": "2026-11-11", "ferie": True, "plats": PDJ["plats"]},
                         {"date": "2026-10-21", "plats": [], "erreur": "Aucun plat"}], budget_s=600)
    assert e.rediges == [] and e.services == [] and e.demandes == []
    assert bilan == {"a_faire": 0, "deja": 0, "ok": 0, "echecs": 0, "restantes": 0, "services": 0}


def test_cuisiner_n_enregistre_pas_les_services_des_jours_a_venir(monkeypatch):
    e = Espion(monkeypatch, existantes={CLE_TRUCK, CLE_TREFLE})
    vendredi = {**PDJ, "date": "2026-10-23"}
    ra.cuisiner([PDJ, vendredi], budget_s=600, aujourd_hui="2026-10-20")
    assert {c["date"] for c in e.services[0]} == {"2026-10-20"}
    # mais les recettes des jours à venir restent rédigeables
    e = Espion(monkeypatch)
    ra.cuisiner([vendredi], budget_s=600, aujourd_hui="2026-10-20")
    assert e.services == [] and e.rediges == ["POKE BOWL", "Blanquette de veau"]


def test_cuisiner_memorise_les_echecs_du_jour(monkeypatch):
    def boum(v):
        if v["plat"] == "POKE BOWL":
            raise RuntimeError("JSON tronqué")
        return {"recette": FIXTURE, "modele": "m", "fournisseur": "f"}
    e = Espion(monkeypatch, rediger=boum)
    ra.cuisiner([PDJ], budget_s=600)
    assert json.loads(ra.FICHIER_ECHECS.read_text()) == {CLE_TRUCK: "2026-10-20"}
    # retry du run 7h30 : la clé ratée est sautée, pas de nouvel appel LLM
    e = Espion(monkeypatch, rediger=boum)
    bilan = ra.cuisiner([PDJ], budget_s=600, sauter_echecs=True)
    assert e.rediges == ["Blanquette de veau"] and bilan["a_faire"] == 1
    # cron 11h15 (sans sauter_echecs) : retentée, et oubliée une fois réussie
    e = Espion(monkeypatch)
    ra.cuisiner([PDJ], budget_s=600)
    assert "POKE BOWL" in e.rediges and json.loads(ra.FICHIER_ECHECS.read_text()) == {}
    # les échecs d'un autre jour sont ignorés
    ra.FICHIER_ECHECS.write_text(json.dumps({CLE_TRUCK: "2026-10-19"}))
    e = Espion(monkeypatch)
    ra.cuisiner([PDJ], budget_s=600, sauter_echecs=True)
    assert "POKE BOWL" in e.rediges
