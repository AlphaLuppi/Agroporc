import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import truck_muche_desserts as tmd


def test_parse_menu_post_extrait_les_desserts_apres_le_plat():
    texte = (
        "Pasta carbonara \n"
        "\n"
        "Tiramisu oreo \n"
        "Flan aux œufs \n"
        "Salade de fruits\n"
    )
    assert tmd.parse_desserts_from_menu_post(texte) == [
        "Tiramisu oreo",
        "Flan aux œufs",
        "Salade de fruits",
    ]


def test_parse_menu_post_retire_prix_et_puces():
    texte = (
        "Filet de lieu riz thaï\n"
        "- Crème brûlée chocolat 3€\n"
        "• Salade de fruits — 2,50€\n"
    )
    assert tmd.parse_desserts_from_menu_post(texte) == [
        "Crème brûlée chocolat",
        "Salade de fruits",
    ]


def test_parse_menu_post_ignore_lignes_parasites():
    texte = (
        "Cordon bleu coquillettes\n"
        "Mousse au chocolat\n"
        "À très vite au Truck Muche !\n"
    )
    assert tmd.parse_desserts_from_menu_post(texte) == ["Mousse au chocolat"]


def test_parse_menu_post_vide_si_une_seule_ligne():
    assert tmd.parse_desserts_from_menu_post("Pour la semaine!!😊") == []


def test_parse_menu_post_vide_si_texte_vide():
    assert tmd.parse_desserts_from_menu_post("") == []
