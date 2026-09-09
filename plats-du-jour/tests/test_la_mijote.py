import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import la_mijote

# Extrait de https://la-mijote-avignon.fr/menu.html (structure Pinegrow, nov. 2025).
FIXTURE_HTML = """
<ul class="splide__list">
  <li><div><div class="text-sm hidden today">Aujourd'hui</div><div class="py-2 px-4">
    <div class="font-bold" data-pgc-lock>Lundi</div>
    <div data-pgc-edit="plat_lundi">
        <b>Traditionnelle saucisse purée</b>.
    </div></div></div></li>
  <li><div><div class="font-bold">Mardi</div>
    <div data-pgc-edit="plat_mardi">
        <b>Mijoté de cochon au lait de coco</b>, citron vert, chorizo et
        carottes glacées.
    </div></div></li>
  <li><div><div class="font-bold">Mercredi</div>
    <div data-pgc-edit="plat_mercredi"><b>Wrap façon raclette</b> (pommes de terre, fromage, jambon…)</div></div></li>
  <li><div><div class="font-bold">Jeudi</div>
    <div data-pgc-edit="plat_jeudi"><b>Poulet mafé, riz basmati</b>, gingembre et cacahuètes.</div></div></li>
  <li><div><div class="font-bold">Vendredi</div>
    <div data-pgc-edit="plat_vendredi"><b>Macaronis au parmesan</b>, compotée de tomates aux
        encornets façon armoricaine.</div></div></li>
</ul>
<td data-pgc-edit="suggestions_descriptions"><b>Plat du jour</b>.</td><td data-pgc-edit="suggestions_prix">15 €</td>
"""


def test_parse_plat_du_lundi():
    assert la_mijote._parse(FIXTURE_HTML, 0) == "Traditionnelle saucisse purée"


def test_parse_plat_multiligne_est_aplati():
    assert la_mijote._parse(FIXTURE_HTML, 1) == "Mijoté de cochon au lait de coco, citron vert, chorizo et carottes glacées"
    assert la_mijote._parse(FIXTURE_HTML, 4) == "Macaronis au parmesan, compotée de tomates aux encornets façon armoricaine"


def test_parse_week_end_ou_html_vide_retourne_none():
    assert la_mijote._parse(FIXTURE_HTML, 5) is None
    assert la_mijote._parse(FIXTURE_HTML, 6) is None
    assert la_mijote._parse("<html></html>", 0) is None


def test_est_frais():
    now = datetime(2026, 9, 9, 8, 0, tzinfo=timezone.utc)
    assert la_mijote._est_frais(None, now) is False
    assert la_mijote._est_frais(now - timedelta(days=3), now) is True
    assert la_mijote._est_frais(now - timedelta(days=10), now) is True
    assert la_mijote._est_frais(now - timedelta(days=11), now) is False
    assert la_mijote._est_frais(datetime(2025, 11, 4, tzinfo=timezone.utc), now) is False


def test_scrape_page_figee_ne_telecharge_pas(monkeypatch):
    monkeypatch.setattr(la_mijote, "_last_modified", lambda: datetime(2025, 11, 4, tzinfo=timezone.utc))

    def _boom():
        raise AssertionError("GET ne doit pas être appelé quand la page est figée")
    monkeypatch.setattr(la_mijote, "_fetch_html", _boom)
    assert la_mijote.scrape(today=date(2026, 9, 9)) is None


def test_scrape_page_fraiche(monkeypatch):
    monkeypatch.setattr(la_mijote, "_last_modified", lambda: datetime(2026, 9, 8, tzinfo=timezone.utc))
    monkeypatch.setattr(la_mijote, "_fetch_html", lambda: FIXTURE_HTML)
    monkeypatch.setattr(la_mijote, "_now", lambda: datetime(2026, 9, 9, 8, 0, tzinfo=timezone.utc))
    assert la_mijote.scrape(today=date(2026, 9, 9)) == {  # mercredi
        "restaurant": "La Mijote",
        "plat": "Wrap façon raclette (pommes de terre, fromage, jambon…)",
        "prix": "15€",
    }


def test_scrape_week_end_retourne_none(monkeypatch):
    monkeypatch.setattr(la_mijote, "_last_modified", lambda: datetime(2026, 9, 8, tzinfo=timezone.utc))
    monkeypatch.setattr(la_mijote, "_fetch_html", lambda: FIXTURE_HTML)
    monkeypatch.setattr(la_mijote, "_now", lambda: datetime(2026, 9, 12, 8, 0, tzinfo=timezone.utc))
    assert la_mijote.scrape(today=date(2026, 9, 12)) is None


# Extrait simplifié de la partie carte de menu.html (formules + carte des Mijoteurs + desserts).
FIXTURE_CARTE_HTML = FIXTURE_HTML + """
<script>document.querySelector('.today').classList.remove('hidden');</script>
<section><h2>Formules</h2>
<div data-pgc-edit="formules_descriptions"><p>Entrée + Plat + Dessert</p><div><span>22 €</span></div>
  <p>Entrée + Plat ou Plat + Dessert</p><div><span>18 €</span></div>
  <h3>La carte des "Mijoteurs"</h3><h4>Plats</h4>
  <div><p><b>Bavette d'aloyau</b> "bœuf qualité Irlande", sauce béarnaise, salade &amp; frites maison.</p><p>23 €</p></div>
  <div><p><b>Pluma de cochon, purée de pommes de terre</b>, panais glacé au jus.</p><p>22 €</p></div>
</div>
<div data-pgc-edit="entree_a"><b>Asperges vertes de pays</b> (en velouté, crues, cuites…), guanciale</div>
<div data-pgc-edit="dessert_a"><b>Dessert du jour</b></div>
</section>
"""


def test_texte_carte_retire_plats_du_jour_et_scripts():
    texte = la_mijote._texte_carte(FIXTURE_CARTE_HTML)
    assert "Bavette d'aloyau" in texte
    assert "Pluma de cochon" in texte
    assert "Asperges vertes" in texte
    assert "23 €" in texte
    assert "saucisse purée" not in texte
    assert "Poulet mafé" not in texte
    assert "classList" not in texte
    assert "<" not in texte


def test_hash_carte_stable_quand_les_plats_du_jour_changent():
    from agent.carte_agent import _texte_hash
    autre_semaine = FIXTURE_CARTE_HTML.replace("Traditionnelle saucisse purée", "Blanquette de veau")
    assert _texte_hash(la_mijote._texte_carte(FIXTURE_CARTE_HTML)) == _texte_hash(la_mijote._texte_carte(autre_semaine))


def test_scrape_carte_sans_garde_fou_fraicheur(monkeypatch):
    def _boom():
        raise AssertionError("HEAD ne doit pas être appelé pour la carte")
    monkeypatch.setattr(la_mijote, "_last_modified", _boom)
    monkeypatch.setattr(la_mijote, "_fetch_html", lambda: FIXTURE_CARTE_HTML)
    carte = la_mijote.scrape_carte()
    assert carte["restaurant"] == "La Mijote"
    assert "Bavette" in carte["texte"]
    assert len(carte["hash"]) == 40


def test_scrape_carte_html_ko_ou_trop_court(monkeypatch):
    monkeypatch.setattr(la_mijote, "_fetch_html", lambda: None)
    assert la_mijote.scrape_carte() is None
    monkeypatch.setattr(la_mijote, "_fetch_html", lambda: "<html><body><p>Fermé</p></body></html>")
    assert la_mijote.scrape_carte() is None
