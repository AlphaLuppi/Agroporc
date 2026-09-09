import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent import diet_agent


def test_evaluate_carte_utilise_le_restaurant(monkeypatch):
    prompts = []

    def fake_call(prompt, timeout=180):
        prompts.append(prompt)
        return json.dumps({"plats": [{"restaurant": "Dubble", "plat": "Hot bowl poulet", "prix": "9.90€",
                                      "note": 7, "justification": "ok", "note_goulaf": 6,
                                      "justification_goulaf": "ok"}]})

    monkeypatch.setattr(diet_agent, "_call_claude", fake_call)
    monkeypatch.setattr(diet_agent, "_apply_ciqual", lambda result: result)
    monkeypatch.setattr(diet_agent, "_build_portion_calibration", lambda restos: f"CAL:{sorted(restos)}")

    sections = [{"nom": "HOT BOWLS", "plats": [{"plat": "Hot bowl poulet", "prix": "9.90€"}]}]
    out = diet_agent.evaluate_carte(sections, "Dubble")

    assert '"restaurant": "Dubble"' in prompts[0]
    assert "CAL:['Dubble']" in prompts[0]
    assert "carte permanente du restaurant « Dubble »" in prompts[0]
    assert out[0]["plats"][0]["note"] == 7


def test_evaluate_carte_defaut_trefle(monkeypatch):
    prompts = []
    monkeypatch.setattr(diet_agent, "_call_claude", lambda p, timeout=180: (prompts.append(p), '{"plats": []}')[1])
    monkeypatch.setattr(diet_agent, "_apply_ciqual", lambda result: result)
    monkeypatch.setattr(diet_agent, "_build_portion_calibration", lambda restos: "")
    diet_agent.evaluate_carte([{"nom": "PÂTES", "plats": [{"plat": "Linguine", "prix": "14€"}]}])
    assert '"restaurant": "Le Bistrot Trèfle"' in prompts[0]
