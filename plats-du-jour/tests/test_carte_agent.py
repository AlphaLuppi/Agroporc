import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent import carte_agent


def test_texte_hash_insensible_aux_espaces_et_a_la_casse():
    a = carte_agent._texte_hash("LES HOT BOWLS\nle hot bowl au poulet   9,90€")
    b = carte_agent._texte_hash("les hot bowls le hot bowl au poulet 9,90€")
    assert a == b
    assert len(a) == 40


def test_texte_hash_change_avec_le_contenu():
    assert carte_agent._texte_hash("bowl 9,90€") != carte_agent._texte_hash("bowl 10,90€")


def test_parse_reponse_accepte_code_fence_et_nettoie():
    raw = '```json\n{"sections": [{"nom": "SALADES", "plats": [{"plat": " La César ", "prix": "10.40€"}, {"plat": "", "prix": "1€"}]}, {"nom": "VIDE", "plats": []}]}\n```'
    assert carte_agent._parse_reponse(raw) == [
        {"nom": "SALADES", "plats": [{"plat": "La César", "prix": "10.40€"}]}
    ]


def test_parse_reponse_prix_absent_devient_na():
    raw = '{"sections": [{"nom": "DESSERTS", "plats": [{"plat": "Brownie"}]}]}'
    assert carte_agent._parse_reponse(raw) == [{"nom": "DESSERTS", "plats": [{"plat": "Brownie", "prix": "N/A"}]}]


def test_parse_reponse_invalide_leve():
    with pytest.raises(ValueError):
        carte_agent._parse_reponse('{"plats": []}')
    with pytest.raises(ValueError):
        carte_agent._parse_reponse('{"sections": [{"nom": "X", "plats": []}]}')


def test_structurer_carte_appelle_claude_avec_le_texte(monkeypatch):
    prompts = []

    def fake_call(prompt, timeout=180):
        prompts.append(prompt)
        return '{"sections": [{"nom": "PLATS", "plats": [{"plat": "Bavette", "prix": "23.00€"}]}]}'

    monkeypatch.setattr(carte_agent, "_call_claude", fake_call)
    sections = carte_agent.structurer_carte("Bavette d'aloyau 23 €", "La Mijote")
    assert sections == [{"nom": "PLATS", "plats": [{"plat": "Bavette", "prix": "23.00€"}]}]
    assert "Bavette d'aloyau 23 €" in prompts[0]
    assert "La Mijote" in prompts[0]
