import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import meme_fetiches as mf

RSS = """<rss><channel><title>Meme Wiki</title>
<item><title>Black Cat Clapping</title><link>https://meme.com/memes/black-cat-clapping</link>
<pubDate>Wed, 21 Oct 2026 12:43:54 GMT</pubDate><description>A cat &amp; its applause.</description></item>
<item><title></title><link>https://meme.com/memes/vide</link></item>
</channel></rss>"""

ACCUEIL = ('<a href="/memes/doge">Doge</a><h2>Trending Now</h2>'
           '<a href="/memes/mumu">x</a><a href="/memes/stonks">y</a><a href="/memes/mumu">z</a>')

PAGE = ('<meta property="og:title" content="Black Cat Clapping Meme: Origin, Spread, and Examples"/>'
        '<meta property="og:description" content="Sarcastic &amp; slow applause."/>'
        '<meta property="og:image" content="https://cdn-v2.meme.com/memes/bcc/cover.webp"/>')


def test_parser_rss():
    assert mf.parser_rss(RSS) == [{"slug": "black-cat-clapping", "titre": "Black Cat Clapping",
                                   "resume": "A cat & its applause.", "date": "2026-10-21"}]


def test_parser_tendances_part_de_la_section():
    assert mf.parser_tendances(ACCUEIL) == ["mumu", "stonks"]
    assert mf.parser_tendances('<a href="/memes/doge">') == ["doge"]


def test_parser_og():
    assert mf.parser_og(PAGE) == {"titre": "Black Cat Clapping", "resume": "Sarcastic & slow applause.",
                                  "image": "https://cdn-v2.meme.com/memes/bcc/cover.webp"}
    assert mf.parser_og('<meta property="og:image" content="https://ailleurs.com/x.png"/>')["image"] == ""


def test_acceptable():
    assert mf.acceptable("black-cat-clapping", "Black Cat Clapping")
    assert not mf.acceptable("ahegao", "Ahegao")
    assert not mf.acceptable("macrophilia-microphilia")


def test_marqueur_aller_retour():
    u = mf.url_auto("https://media.giphy.com/media/abc/giphy.gif#vieux", "stonks")
    assert u == "https://media.giphy.com/media/abc/giphy.gif#meme-auto=stonks"
    assert mf.slug_auto(u) == "stonks"
    assert mf.sans_marqueur(u) == "https://media.giphy.com/media/abc/giphy.gif"
    assert mf.slug_auto("https://media.tenor.com/x.gif") is None


def test_fusionner_garde_les_gifs_manuels_en_tete():
    manuel = "/api/images/12.gif"
    ancien = mf.url_auto("https://media.giphy.com/media/old/giphy.gif", "doge")
    nouveau = mf.url_auto("https://media.giphy.com/media/new/giphy.gif", "mumu")
    doublon = mf.url_auto(manuel, "stonks")
    assert mf.fusionner([ancien, manuel], [nouveau, doublon]) == [manuel, nouveau]


CATALOGUE = [{"slug": s, "titre": s.title(), "resume": "", "fraicheur": "recent", "image": f"img-{s}"}
             for s in ("doge", "mumu", "stonks")]


def test_prompt_casting_exclut_les_slugs_de_la_semaine_passee():
    p = mf.prompt_casting([{"nom": "tom", "prenom": "Tom"}], CATALOGUE, {"doge"})
    assert '"mumu"' in p and '"doge"' not in p


def test_valider_casting_uniques_et_connus():
    data = {"attributions": [
        {"nom": "tom", "memes": [{"slug": "doge", "requete_giphy": "doge"}, {"slug": "inconnu"}],
         "reserves": [{"slug": "mumu", "requete_giphy": "mumu meme"}]},
        {"nom": "gab", "memes": [{"slug": "doge"}, {"slug": "stonks", "requete_giphy": ""}]},
        {"nom": "intrus", "memes": [{"slug": "stonks"}]},
        "pas un objet",
    ]}
    sortie = mf.valider_casting(data, CATALOGUE, ["tom", "gab"])
    assert [m["slug"] for m in sortie["tom"]] == ["doge", "mumu"]
    assert sortie["tom"][0]["requete_giphy"] == "doge meme"
    assert sortie["gab"] == [{"slug": "stonks", "titre": "Stonks", "requete_giphy": "Stonks meme",
                              "image": "img-stonks"}]
    assert "intrus" not in sortie
    assert mf.valider_casting(None, CATALOGUE, ["tom"]) == {}


def _giphy(titre, url):
    return {"title": titre, "slug": "", "images": {"downsized": {"url": url}}}


def test_choisir_giphy():
    resultats = [
        _giphy("Happy Dog GIF", "https://media2.giphy.com/media/aaa/giphy.gif?cid=1"),
        _giphy("Stonks Meme GIF", "https://media3.giphy.com/media/v1.Y2lk/bbb/giphy.gif?cid=2"),
        _giphy("Stonks again", "https://media.giphy.com/media/ccc/giphy.gif"),
    ]
    assert mf.choisir_giphy(resultats, "Stonks", set()) == "https://media.giphy.com/media/bbb/giphy.gif"
    deja = {"https://media.giphy.com/media/bbb/giphy.gif"}
    assert mf.choisir_giphy(resultats, "Stonks", deja) == "https://media.giphy.com/media/ccc/giphy.gif"
    assert mf.choisir_giphy(resultats, "Harambe", set()) is None
    assert mf.choisir_giphy([_giphy("Stonks", "https://evil.com/x.gif")], "Stonks", set()) is None
