import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import dubble

# Structure Wix observée le 9 septembre 2026 : <h2> titre avec &nbsp;, <h2> date,
# puis des paires <p>nom</p><p>description</p> (le nom peut contenir un <span>).
FIXTURE_HTML_TOUT_ABSENT = """
<html><head><style>.x{}</style><script>var a = "<p>faux</p>";</script></head><body>
<div><h2><span class="wixui-rich-text__text">NOS RECETTES&nbsp;DU JOUR</span></h2></div>
<div><div><wow-image><picture><img alt=""/></picture></wow-image></div></div>
<div><h2><span>mercredi 9 septembre</span></h2></div>
<div><div></div><div><p><span>Hot Bowl</span></p></div>
<div><p><span>pas de hot bowl classique aujourd&#39;hui</span></p></div></div>
<div><div><p>Hot Bowl <span>Veg&eacute;</span></p></div><div><p><span>pas de hot bowl végétarien aujourd&#39;hui</span></p></div></div>
<div><p>Wrap Toast&eacute;</p></div><div><p><span>pas de wrap toasté aujourd&#39;hui</span></p></div>
<div><p>Focaccia Toast&eacute;e</p></div><div><p>pas de pain toasté aujourd&#39;hui</p></div>
<div><p>Soupe maison</p></div><div><p>pas de soupe aujourd&#39;hui</p></div>
<div><p>Gâteaux et Jus mix 25cl</p></div><div><p>pas de gâteaux aujourd&#39;hui</p></div>
<div><p>aujourd&#39;hui, je découvre le menu salad bowl !</p><p>13,90€</p></div>
<div><p>Chargement...</p><p>${recette}</p><p>10,90€</p></div>
</body></html>
"""

FIXTURE_HTML_HOT_BOWLS = FIXTURE_HTML_TOUT_ABSENT.replace(
    "pas de hot bowl classique aujourd&#39;hui", "poulet tikka, riz basmati, légumes rôtis"
).replace(
    "pas de hot bowl végétarien aujourd&#39;hui", "falafels, boulgour, houmous"
)


def test_html_to_lines_gere_spans_entites_et_scripts():
    lines = dubble._html_to_lines(FIXTURE_HTML_TOUT_ABSENT)
    assert "faux" not in " ".join(lines)
    assert lines[0] == "NOS RECETTES DU JOUR"
    assert lines[1] == "mercredi 9 septembre"
    assert "Hot Bowl Vegé" in lines
    assert "pas de hot bowl classique aujourd'hui" in lines


def test_parse_tout_absent_retourne_none():
    lines = dubble._html_to_lines(FIXTURE_HTML_TOUT_ABSENT)
    assert dubble._parse(lines, date(2026, 9, 9)) is None


def test_parse_deux_hot_bowls_donne_deux_options():
    lines = dubble._html_to_lines(FIXTURE_HTML_HOT_BOWLS)
    r = dubble._parse(lines, date(2026, 9, 9))
    assert r == {
        "restaurant": "Dubble",
        "plat": ["Hot Bowl : poulet tikka, riz basmati, légumes rôtis", "Hot Bowl Vegé : falafels, boulgour, houmous"],
        "prix": "10.90€",
    }


def test_parse_un_seul_hot_bowl_donne_une_chaine():
    html = FIXTURE_HTML_TOUT_ABSENT.replace("pas de hot bowl végétarien aujourd&#39;hui", "curry de légumes, quinoa")
    r = dubble._parse(dubble._html_to_lines(html), date(2026, 9, 9))
    assert r["plat"] == "Hot Bowl Vegé : curry de légumes, quinoa"


def test_parse_date_differente_retourne_none():
    lines = dubble._html_to_lines(FIXTURE_HTML_HOT_BOWLS)
    assert dubble._parse(lines, date(2026, 9, 10)) is None


def test_parse_sans_bloc_recettes_retourne_none():
    assert dubble._parse(["Bienvenue", "mercredi 9 septembre"], date(2026, 9, 9)) is None


def test_scrape_utilise_le_html_telecharge(monkeypatch):
    monkeypatch.setattr(dubble, "_fetch_html", lambda: FIXTURE_HTML_HOT_BOWLS)
    assert dubble.scrape(today=date(2026, 9, 9))["restaurant"] == "Dubble"
    monkeypatch.setattr(dubble, "_fetch_html", lambda: None)
    assert dubble.scrape(today=date(2026, 9, 9)) is None
