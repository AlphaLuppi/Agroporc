import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import bistrot_trefle


def _sample_outlet():
    """Réponse API Obypay minimale : sections allowlist + exclusions + doublons + sur-place."""
    def prod(name, price, sec_id, sec_name, coll="salty"):
        p = {"name": name, "price": price, "section": {"id": sec_id, "name": sec_name}}
        if coll is not None:  # coll=None → produit sur-place (pas de collection emporter)
            p["collection"] = {"id": coll}
        return p

    return {
        "products": [
            prod("SALADE CAESAR", 13, "s1", "SALADES ET POKE BOWLS"),
            prod("SALADE CAESAR", 13, "s2", "SALADES ET POKE BOWLS"),  # doublon (même nom, dédup)
            prod("SALADE SUR PLACE", 18, "s3", "SALADES ET POKE BOWLS", coll=None),  # sur-place exclu
            prod("LINGUINE AU PESTO VERT", 14, "rv", "PÂTES"),
            prod("TIRAMISU À LA FRAMBOISE", 5, "z1", "DESSERTS", coll="sweet"),
            prod("TIRAMISU À LA FRAMBOISE", 7, "z2", "DESSERTS", coll=None),  # version sur-place exclue
            prod("FISH AND CHIPS", 16, "E9", "PLATS", coll=None),  # section sur-place exclue
            prod("COCA-COLA 33cl", 3, "jj", "BOISSONS"),          # exclu (hors allowlist)
            prod("MENU À 24,90", 24, "mm", "Menus"),              # exclu (hors allowlist)
        ]
    }


def test_scrape_carte_filtre_et_dedup(monkeypatch):
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: _sample_outlet())
    carte = bistrot_trefle.scrape_carte()

    assert carte is not None
    assert carte["restaurant"] == "Le Bistrot Trèfle"
    noms = [s["nom"] for s in carte["sections"]]
    # Seules les sections allowlist contenant des produits emporter, dans l'ordre canonique
    assert noms == ["SALADES ET POKE BOWLS", "PÂTES", "DESSERTS"]

    plats_par_section = {s["nom"]: [p["plat"] for p in s["plats"]] for s in carte["sections"]}
    assert plats_par_section["SALADES ET POKE BOWLS"] == ["SALADE CAESAR"]  # doublon + sur-place retirés
    assert plats_par_section["DESSERTS"] == ["TIRAMISU À LA FRAMBOISE"]      # version sur-place retirée
    assert "PLATS" not in noms and "BOISSONS" not in noms and "Menus" not in noms

    plat = carte["sections"][0]["plats"][0]
    assert plat["prix"] == "13€"


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
