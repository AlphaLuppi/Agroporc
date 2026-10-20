import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))

import plat_image as pi
import plat_recette as pr

VECTEURS = json.loads((RACINE.parent / "lib" / "plat-image-vecteurs.json").read_text(encoding="utf-8"))["vecteurs"]

CAS_VARIANTES = [
    {"plat": "Blanquette"},
    {"plat": ["A", "B"]},
    {"plat": ["A", "B"], "options": [{"plat": "A1"}, {}]},
    {"plat": ["A"], "options": [{}, {}]},
    {"plat": ""},
    {"plat": ["A"], "options": ["pas un dict", {"plat": "B"}]},
    {},
]


def test_variantes_avec_source_miroir_de_plat_image():
    for p in CAS_VARIANTES:
        assert [n for n, _ in pr.variantes_avec_source(p)] == pi.variantes(p), p


def test_variantes_avec_source_garde_l_objet_des_ingredients():
    simple = {"plat": "Blanquette", "ingredients": [{"nom": "veau", "grammes": 150}]}
    assert pr.variantes_avec_source(simple) == [("Blanquette", simple)]
    o1, o2 = {"plat": "Hot Bowl", "note": 7}, {"note": 6}
    assert pr.variantes_avec_source({"plat": ["Hot Bowl", "Végé"], "options": [o1, o2]}) == [
        ("Hot Bowl", o1), ("Végé", o2)]
    assert pr.variantes_avec_source({"plat": ["A", "B"], "ingredients": [{"nom": "x", "grammes": 1}]}) == [
        ("A", {}), ("B", {})]


def test_ingredients_estimes():
    src = {"ingredients": [{"nom": " Poulet,  blanc ", "grammes": 150}, {"nom": "Riz", "grammes": 0},
                           {"nom": "", "grammes": 20}, {"nom": "Huile", "grammes": 9.6}, "bruit"],
           "ingredients_detail": [{"nom_query": "ignoré", "grammes": 50}]}
    assert pr.ingredients_estimes(src) == [{"nom": "Poulet, blanc", "grammes": 150},
                                           {"nom": "Huile", "grammes": 10}]
    # repli sur le détail Ciqual
    assert pr.ingredients_estimes({"ingredients": [], "ingredients_detail": [
        {"nom_query": "Carotte, crue", "grammes": 80, "code": "1"}, {"nom_query": "Sel", "grammes": -1}]}) == [
        {"nom": "Carotte, crue", "grammes": 80}]
    beaucoup = {"ingredients": [{"nom": f"i{i}", "grammes": 10} for i in range(40)]}
    assert len(pr.ingredients_estimes(beaucoup)) == 25
    assert pr.ingredients_estimes({}) == [] and pr.ingredients_estimes(None) == []


def test_a_cuisiner_filtre_et_dedoublonne():
    pdj = {"date": "2026-10-20", "plats": [
        {"restaurant": "Le Truck Muche", "plat": "POKE BOWL", "ingredients": [{"nom": "Saumon", "grammes": 120}]},
        {"restaurant": "Le Truck Muche", "plat": "Poke bowl."},
        {"restaurant": "La Pause Gourmande", "plat": "Coming soon", "coming_soon": True},
        {"restaurant": "Dubble", "plat": ["Hot Bowl", "Hot Bowl Végé"],
         "options": [{"plat": "Hot Bowl", "ingredients": [{"nom": "Poulet", "grammes": 100}]},
                     {"plat": "Hot Bowl Végé", "ingredients_detail": [{"nom_query": "Tofu", "grammes": 90}]}]},
        {"restaurant": "", "plat": "orphelin"},
        {"restaurant": "Dubble", "plat": "  .  "},
        "pas un dict",
    ]}
    items = pr.a_cuisiner(pdj)
    assert [(i["restaurant"], i["plat"]) for i in items] == [
        ("Le Truck Muche", "POKE BOWL"), ("Dubble", "Hot Bowl"), ("Dubble", "Hot Bowl Végé")]
    assert items[0] == {"cle": pi.cle_image("Le Truck Muche", "POKE BOWL"), "restaurant": "Le Truck Muche",
                        "plat": "POKE BOWL", "date": "2026-10-20",
                        "ingredients": [{"nom": "Saumon", "grammes": 120}]}
    assert items[1]["ingredients"] == [{"nom": "Poulet", "grammes": 100}]
    assert items[2]["ingredients"] == [{"nom": "Tofu", "grammes": 90}]
    assert all(i["date"] == "2026-10-20" for i in items)


def test_a_cuisiner_jours_sans_plat():
    assert pr.a_cuisiner({}) == [] and pr.a_cuisiner(None) == []
    assert pr.a_cuisiner({"date": "2026-11-11", "ferie": True,
                          "plats": [{"restaurant": "Dubble", "plat": "Hot Bowl"}]}) == []
    assert pr.a_cuisiner({"date": "2026-10-20", "plats": [], "erreur": "Aucun plat"}) == []
    assert pr.a_cuisiner({"date": "2026-10-20"}) == []


def test_a_cuisiner_cle_identique_aux_vecteurs_du_front():
    v = VECTEURS[0]
    items = pr.a_cuisiner({"date": "2026-10-20", "plats": [{"restaurant": v["restaurant"], "plat": v["plat"]}]})
    assert items[0]["cle"] == v["cle"]


def test_services_dedoublonne_sur_plusieurs_pdj():
    lundi = {"date": "2026-10-19", "plats": [{"restaurant": "Dubble", "plat": "Hot Bowl"},
                                             {"restaurant": "Dubble", "plat": "HOT BOWL"}]}
    mardi = {"date": "2026-10-20", "plats": [{"restaurant": "Dubble", "plat": "Hot Bowl"},
                                             {"restaurant": "La Mijote", "plat": "Coming", "coming_soon": True}]}
    cle = pi.cle_image("Dubble", "Hot Bowl")
    assert pr.services([lundi, mardi, lundi]) == [{"cle": cle, "date": "2026-10-19"},
                                                  {"cle": cle, "date": "2026-10-20"}]
    assert pr.services([]) == []
