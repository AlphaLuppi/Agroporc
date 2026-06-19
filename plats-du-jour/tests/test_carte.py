import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import bistrot_trefle


def _sample_outlet():
    """Réponse API Obypay minimale : sections allowlist + sections exclues + doublons."""
    def prod(name, price, sec_id, sec_name):
        return {"name": name, "price": price, "section": {"id": sec_id, "name": sec_name}}

    return {
        "products": [
            prod("FISH AND CHIPS", 16, "E9", "PLATS"),
            prod("fish and chips", 16, "X1", "PLATS"),          # doublon (casse/section)
            prod("LINGUINE AU PESTO VERT", 14, "rv", "PÂTES"),
            prod("TIRAMISU À LA FRAMBOISE", 7, "z1", "DESSERTS"),
            prod("TIRAMISU À LA FRAMBOISE", 7, "z2", "DESSERTS"),  # doublon (même nom de plat, dédup)
            prod("COCA-COLA 33cl", 3, "jj", "BOISSONS"),         # exclu
            prod("MENU À 24,90", 24, "mm", "Menus"),             # exclu
        ]
    }


def test_scrape_carte_filtre_et_dedup(monkeypatch):
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: _sample_outlet())
    carte = bistrot_trefle.scrape_carte()

    assert carte is not None
    assert carte["restaurant"] == "Le Bistrot Trèfle"
    noms = [s["nom"] for s in carte["sections"]]
    # Seules les sections allowlist, dans l'ordre canonique (PLATS, PÂTES, DESSERTS)
    assert noms == ["PLATS", "PÂTES", "DESSERTS"]

    plats_par_section = {s["nom"]: [p["plat"] for p in s["plats"]] for s in carte["sections"]}
    assert plats_par_section["PLATS"] == ["FISH AND CHIPS"]            # doublon retiré
    assert plats_par_section["DESSERTS"] == ["TIRAMISU À LA FRAMBOISE"]  # doublon inter-sections retiré
    assert "BOISSONS" not in noms and "Menus" not in noms

    plat = carte["sections"][0]["plats"][0]
    assert plat["prix"] == "16€"


def test_scrape_carte_hash_stable_selon_ordre(monkeypatch):
    sample = _sample_outlet()
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: sample)
    h1 = bistrot_trefle.scrape_carte()["hash"]

    shuffled = {"products": list(reversed(sample["products"]))}
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: shuffled)
    h2 = bistrot_trefle.scrape_carte()["hash"]

    assert h1 == h2 and len(h1) == 40  # SHA-1 hex


def test_scrape_carte_none_si_api_ko(monkeypatch):
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: None)
    assert bistrot_trefle.scrape_carte() is None
