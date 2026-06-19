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


from agent import diet_agent


def test_rebuild_carte_sections_merge_par_nom():
    sections = [
        {"nom": "PLATS", "plats": [
            {"plat": "FISH AND CHIPS", "prix": "16€"},
            {"plat": "SALADE CAESAR", "prix": "13€"},
        ]},
    ]
    evaluated = [
        {"plat": "fish and chips", "note": 5, "note_goulaf": 8,
         "justification": "frit", "justification_goulaf": "régal",
         "nutrition_estimee": {"calories": 800, "proteines_g": 30, "glucides_g": 70, "lipides_g": 40},
         "nutrition_source": "ciqual"},
        # SALADE CAESAR absente de l'éval → conservée sans note
    ]
    out = diet_agent._rebuild_carte_sections(sections, evaluated)

    fish = out[0]["plats"][0]
    assert fish["note"] == 5 and fish["note_goulaf"] == 8
    assert fish["prix"] == "16€"  # prix d'origine préservé
    assert fish["nutrition_source"] == "ciqual"

    salade = out[0]["plats"][1]
    assert salade["plat"] == "SALADE CAESAR"
    assert "note" not in salade  # pas d'éval → pas de note inventée


def test_evaluate_carte_sans_recommandation(monkeypatch):
    sections = [{"nom": "PLATS", "plats": [{"plat": "FISH AND CHIPS", "prix": "16€"}]}]

    fake_raw = '{"plats": [{"restaurant": "Le Bistrot Trèfle", "plat": "FISH AND CHIPS", "prix": "16€", "note": 4, "note_goulaf": 9, "justification": "x", "justification_goulaf": "y"}]}'
    monkeypatch.setattr(diet_agent, "_call_claude", lambda prompt, timeout=180: fake_raw)
    monkeypatch.setattr(diet_agent, "_apply_ciqual", lambda result: result)  # bypass appel Ciqual/Claude

    out = diet_agent.evaluate_carte(sections)
    assert isinstance(out, list)
    plat = out[0]["plats"][0]
    assert plat["note"] == 4 and plat["note_goulaf"] == 9


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
