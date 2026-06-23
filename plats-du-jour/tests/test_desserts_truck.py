import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import truck_muche_desserts as tmd


def test_is_dessert_post_detecte_le_mot_dessert():
    assert tmd.is_dessert_post("🍰 Nos desserts du jour 🍰") is True
    assert tmd.is_dessert_post("LES DESSERTS DE LA SEMAINE") is True


def test_is_dessert_post_rejette_un_menu_de_plats():
    assert tmd.is_dessert_post("LUNDI poulet basquaise MARDI poisson") is False


def test_parse_desserts_nettoie_puces_emojis_et_prix():
    texte = (
        "🍰 Desserts du jour :\n"
        "- Mi-cuit chocolat 3€\n"
        "• Salade de fruits — 2,50€\n"
        "Tiramisu spéculoos\n"
    )
    assert tmd.parse_desserts_from_caption(texte) == [
        "Mi-cuit chocolat",
        "Salade de fruits",
        "Tiramisu spéculoos",
    ]


def test_parse_desserts_ignore_les_lignes_parasites():
    texte = (
        "Bonjour à tous ! Voici nos desserts 😋\n"
        "Mousse au chocolat\n"
        "\n"
        "À très vite au Truck Muche !\n"
    )
    assert tmd.parse_desserts_from_caption(texte) == ["Mousse au chocolat"]


def test_parse_desserts_vide_si_rien():
    assert tmd.parse_desserts_from_caption("") == []
