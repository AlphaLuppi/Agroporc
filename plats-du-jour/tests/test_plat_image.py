import json
import sys
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))

import plat_image as pi

VECTEURS = json.loads((RACINE.parent / "lib" / "plat-image-vecteurs.json").read_text(encoding="utf-8"))["vecteurs"]


@pytest.mark.parametrize("v", VECTEURS, ids=lambda v: f"{v['restaurant']}|{v['plat']}"[:40])
def test_concordance_cle_avec_le_front(v):
    assert pi.base_cle(v["restaurant"], v["plat"]) == v["base"]
    assert pi.cle_image(v["restaurant"], v["plat"]) == v["cle"]
    assert pi.CLE_RE.match(v["cle"])


def test_norm():
    assert pi.norm("  Rôti   de DINDE, sauce gribiche. ") == "roti de dinde sauce gribiche"
    assert pi.norm("Œuf cocotte & bœuf") == "oeuf cocotte boeuf"


def test_seed_deterministe_et_bornee():
    s = pi.seed_image("Le Truck Muche", "POKE BOWL")
    assert s == pi.seed_image("le truck muche", "Poke bowl.")
    assert 0 <= s < 2 ** 31


def test_variantes_miroir_du_front():
    assert pi.variantes({"plat": "Blanquette"}) == ["Blanquette"]
    assert pi.variantes({"plat": ["A", "B"]}) == ["A", "B"]
    # options : leur nom prime, sinon le nom de même rang, sinon le premier
    assert pi.variantes({"plat": ["A", "B"], "options": [{"plat": "A1"}, {}]}) == ["A1", "B"]
    assert pi.variantes({"plat": ["A"], "options": [{}, {}]}) == ["A", "A"]
    assert pi.variantes({"plat": ""}) == []


def test_a_illustrer_ignore_coming_soon_et_dedoublonne():
    pdj = {"plats": [
        {"restaurant": "Le Truck Muche", "plat": "POKE BOWL"},
        {"restaurant": "Le Truck Muche", "plat": "Poke bowl."},
        {"restaurant": "La Pause Gourmande", "plat": "Coming soon", "coming_soon": True},
        {"restaurant": "Dubble", "plat": ["Hot Bowl", "Hot Bowl Végé"],
         "options": [{"plat": "Hot Bowl"}, {"plat": "Hot Bowl Végé"}]},
        {"restaurant": "", "plat": "orphelin"},
    ]}
    items = pi.a_illustrer(pdj)
    assert [(i["restaurant"], i["plat"]) for i in items] == [
        ("Le Truck Muche", "POKE BOWL"), ("Dubble", "Hot Bowl"), ("Dubble", "Hot Bowl Végé")]
    assert items[0]["cle"] == pi.cle_image("Le Truck Muche", "POKE BOWL")
    assert pi.a_illustrer({}) == [] and pi.a_illustrer(None) == []


def test_libelle_lisible():
    assert pi.libelle_lisible("JAMBON BRAISE FRITES") == "Jambon braise frites"
    assert pi.libelle_lisible("  Tataki de bœuf ,  pesto.  ") == "Tataki de bœuf, pesto"


def test_prompt_contient_le_plat_et_le_contexte_du_resto():
    p = pi.construire_prompt("Le Truck Muche", "POKE BOWL SAUMON TERYAKI")
    assert 'Poke bowl saumon teryaki' in p and '"' not in p
    assert "food-truck" in p and "no text" in p
    assert "French lunch plate" in pi.construire_prompt("Resto inconnu", "Blanquette")


def test_validation_image():
    jpeg = b"\xff\xd8\xff" + b"\0" * 5000
    assert pi.valider_image(jpeg) == "image/jpeg"
    assert pi.type_image(b"RIFF\0\0\0\0WEBPVP8 ") == "image/webp"
    assert pi.type_image(b"\x89PNG\r\n\x1a\n...") == "image/png"
    with pytest.raises(ValueError):
        pi.valider_image(b'{"error":"FREE_LIMIT"}')
    with pytest.raises(ValueError):
        pi.valider_image(b"\xff\xd8\xff" + b"\0" * 100)
    with pytest.raises(ValueError):
        pi.valider_image(b"\xff\xd8\xff" + b"\0" * (pi.TAILLE_MAX + 1))


def test_variantes_tolere_des_options_non_dict():
    # miroir de variantesPlat (TS) : option non objet → nom de l'index
    plat = {"restaurant": "Dubble", "plat": ["A", "B"], "options": ["A", {"plat": "B"}, 3]}
    assert pi.variantes(plat) == ["A", "B", "A"]


def test_prompt_avec_description_sans_libelle_cite():
    p = pi.construire_prompt("Le Truck Muche", "Jambon braisé frites", "thick slices of braised ham with fries")
    assert "thick slices of braised ham with fries" in p
    assert '"' not in p and "Jambon" not in p
    assert "aluminium" in p and "no logos" in p


def test_prompt_descriptions_liste_les_cles():
    items = [{"cle": "a" * 24, "restaurant": "Dubble", "plat": "HOT BOWL CURRY"}]
    p = pi.prompt_descriptions(items)
    assert "a" * 24 in p and "Hot bowl curry" in p and "JSON" in p


def test_parser_descriptions():
    cles = ["a" * 24, "b" * 24]
    brut = '```json\n{"%s": "  Tender \\"veal\\" chunks in creamy white sauce. ", "%s": "x", "zzz": "ignored dish here"}\n```' % tuple(cles)
    assert pi.parser_descriptions(brut, cles) == {"a" * 24: "Tender veal chunks in creamy white sauce"}
    assert pi.parser_descriptions("pas du json", cles) == {}
    assert pi.parser_descriptions('["liste"]', cles) == {}
    assert pi.nettoyer_description("y" * 1000) == "y" * pi.DESCRIPTION_MAX


def test_contenant_par_resto():
    assert "kraft cardboard" in pi.construire_prompt("Le Bistrot Trèfle", "Poulet")
    assert "plastic lid" in pi.construire_prompt("La Pause Gourmande", "Poulet")
    assert "aluminium" in pi.construire_prompt("Le Truck Muche", "Poulet")
    assert "plate" in pi.construire_prompt("La Mijote", "Poulet")
