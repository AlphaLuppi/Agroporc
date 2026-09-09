import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import basilic_ngo


def _prod(pid, name, desc, menu_mode, section_id=basilic_ngo.SECTION_ID, price=9.4):
    return {
        "id": pid, "name": name, "price": price, "description": desc, "menuMode": menu_mode,
        "section": {"id": section_id, "name": "Plat ", "menu": False},
    }


def _sample_outlet():
    """Réponse ObyPay réduite : chaque plat du jour est en double (menuMode order / null),
    plus un produit d'une autre section (menu complet) à ignorer."""
    return {"data": {"products": [
        _prod("vofBeQYyBK", "Plat du jour poisson", "<b>Emietté de saumon, poêlée indienne et boulgour</b>", "order"),
        _prod("EcrtMi6aEA", "Plat du jour viande 1", "<b>sauté de boeuf, légumes de saison et riz</b>", "order"),
        _prod("ufQNjRwXyC", "Plat du jour viande 1", "<b>sauté de boeuf,  légumes de saison et riz</b>", None),
        _prod("oMK4C76bym", "Plat du jour poisson", "<b>Emietté de saumon, poêlée indienne et boulgour</b>", None),
        _prod("menu1", "Menu plat du jour", "plat + boisson + dessert", "order", section_id="AUTRE", price=13.3),
    ]}, "meta": {}}


def test_extract_plats_dedoublonne_et_strip_html():
    plats = basilic_ngo._extract_plats(_sample_outlet())
    assert plats == [
        "Emietté de saumon, poêlée indienne et boulgour",
        "sauté de boeuf, légumes de saison et riz",
    ]


def test_extract_plats_vide_si_section_absente():
    assert basilic_ngo._extract_plats({"data": {"products": [_prod("x", "Menu", "y", "order", section_id="AUTRE")]}}) == []


def test_extract_plats_retombe_sur_le_nom_sans_description():
    data = {"data": {"products": [_prod("a", "Plat du jour poisson", "", "order")]}}
    assert basilic_ngo._extract_plats(data) == ["Plat du jour poisson"]


def test_jours_ouvres_depuis():
    lundi, jeudi, mercredi = date(2026, 9, 7), date(2026, 9, 10), date(2026, 9, 9)
    assert basilic_ngo._jours_ouvres_depuis(lundi, lundi) == 0
    assert basilic_ngo._jours_ouvres_depuis(lundi, mercredi) == 2
    assert basilic_ngo._jours_ouvres_depuis(lundi, jeudi) == 3
    assert basilic_ngo._jours_ouvres_depuis(date(2026, 9, 4), lundi) == 1  # vendredi → lundi : week-end ignoré


def test_scrape_retourne_liste_d_options_et_prix(monkeypatch, tmp_path):
    monkeypatch.setattr(basilic_ngo, "CACHE_FILE", tmp_path / "basilic_ngo_dernier.json")
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: _sample_outlet())
    r = basilic_ngo.scrape(today=date(2026, 9, 9))
    assert r == {
        "restaurant": "Basilic n'Go",
        "plat": ["Emietté de saumon, poêlée indienne et boulgour", "sauté de boeuf, légumes de saison et riz"],
        "prix": "9.40€",
    }


def test_scrape_plat_unique_est_une_chaine(monkeypatch, tmp_path):
    monkeypatch.setattr(basilic_ngo, "CACHE_FILE", tmp_path / "c.json")
    data = {"data": {"products": [_prod("a", "Plat du jour poisson", "<b>Dos de cabillaud</b>", "order")]}}
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: data)
    assert basilic_ngo.scrape(today=date(2026, 9, 9))["plat"] == "Dos de cabillaud"


def test_scrape_none_si_api_ko_ou_sans_plat(monkeypatch, tmp_path):
    monkeypatch.setattr(basilic_ngo, "CACHE_FILE", tmp_path / "c.json")
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: None)
    assert basilic_ngo.scrape(today=date(2026, 9, 9)) is None
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: {"data": {"products": []}})
    assert basilic_ngo.scrape(today=date(2026, 9, 9)) is None


def test_scrape_garde_fou_plats_figes(monkeypatch, tmp_path):
    """Mêmes plats depuis ≥ 3 jours ouvrés → None (l'API n'a pas de date)."""
    monkeypatch.setattr(basilic_ngo, "CACHE_FILE", tmp_path / "c.json")
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: _sample_outlet())
    lundi = date(2026, 9, 7)
    assert basilic_ngo.scrape(today=lundi) is not None          # 1re vue : depuis = lundi
    assert basilic_ngo.scrape(today=date(2026, 9, 9)) is not None   # mercredi : 2 jours ouvrés
    assert basilic_ngo.scrape(today=date(2026, 9, 10)) is None      # jeudi : 3 jours ouvrés → figé
    # Un changement de plats réarme le compteur
    data = {"data": {"products": [_prod("a", "Plat du jour poisson", "<b>Nouveau plat</b>", "order")]}}
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: data)
    assert basilic_ngo.scrape(today=date(2026, 9, 10))["plat"] == "Nouveau plat"


def _sample_carte():
    def prod(name, price, sec_id, sec_name):
        return {"name": name, "price": price, "description": "", "section": {"id": sec_id, "name": sec_name}}

    return {"products": [
        prod("La César", 10.4, "SxAY5moTd3", "Salade"),
        prod("La César", 10.4, "SxAY5moTd3", "Salade"),            # doublon menuMode
        prod("La Niçoise", 8.9, "SxAY5moTd3", "Salade"),
        prod("Ciabatta Italien", 7.9, "RNTDcsfYnC", "Sandwich "),   # espace final dans le nom de section
        prod("Poke bowl poulet", 13.4, "nJPphmXghg", "Poke Bowl "),
        prod("Brownie", 3.1, "zL1WM8RrTa", "Dessert "),
        prod("Crème glacée", 0, "zL1WM8RrTa", "Dessert "),           # prix 0 → ignoré
        prod("Plat du jour poisson", 9.4, "Nf8NZ3MTtZ", "Plat "),    # hors allowlist
        prod("Coca Cola 33cl", 2, "WFzyFtcGFf", "Boisson"),          # hors allowlist
        prod("Livraison zone 1", 8.9, "wgbSoCSErR", "Livraison"),    # hors allowlist
    ]}


def test_extract_carte_allowlist_dedup_prix():
    sections = basilic_ngo._extract_carte(_sample_carte())
    assert [s["nom"] for s in sections] == ["SALADE", "SANDWICH", "POKE BOWL", "DESSERT"]
    assert sections[0]["plats"] == [
        {"plat": "La César", "prix": "10.40€"},
        {"plat": "La Niçoise", "prix": "8.90€"},
    ]
    assert sections[3]["plats"] == [{"plat": "Brownie", "prix": "3.10€"}]


def test_carte_hash_stable_a_l_ordre():
    a = basilic_ngo._extract_carte(_sample_carte())
    data = _sample_carte()
    data["products"].reverse()
    b = basilic_ngo._extract_carte(data)
    assert basilic_ngo._carte_hash(a) == basilic_ngo._carte_hash(b)


def test_scrape_carte(monkeypatch):
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: _sample_carte())
    carte = basilic_ngo.scrape_carte()
    assert carte["restaurant"] == "Basilic n'Go"
    assert len(carte["hash"]) == 40
    assert len(carte["sections"]) == 4


def test_scrape_carte_api_ko_ou_vide(monkeypatch):
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: None)
    assert basilic_ngo.scrape_carte() is None
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: {"products": []})
    assert basilic_ngo.scrape_carte() is None
