import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import messages

BASE = (
    "🍽️ **Plats du jour — Mercredi 9 septembre**\n"
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
    "🍀 **Le Bistrot Trèfle** — Poulet basquaise (13.5€)\n"
    "🚚 **Le Truck Muche** — Lasagnes (11.50€)\n"
    "☕ **La Pause Gourmande** — _on ne sait pas encore_\n"
)


def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(messages, "MESSAGES_DIR", tmp_path)
    monkeypatch.setattr(messages, "PDJ_FILE", tmp_path / "absent.json")
    (tmp_path / "mercredi.md").write_text(BASE, encoding="utf-8")
    return tmp_path / "mercredi.md"


def test_maj_message_jour_ajoute_les_optionnels_ayant_un_plat(tmp_path, monkeypatch):
    path = _setup(tmp_path, monkeypatch)
    optionnels = [
        {"restaurant": "Basilic n'Go", "plat": ["Emietté de saumon", "Sauté de boeuf"], "prix": "9.40€"},
        {"restaurant": "La Mijote", "plat": "Wrap façon raclette", "prix": "15€"},
    ]
    messages.maj_message_jour({"plat": "Blanquette", "prix": "12€"}, optionnels, today=date(2026, 9, 9))
    contenu = path.read_text(encoding="utf-8")
    assert "☕ **La Pause Gourmande** — Blanquette (12€)" in contenu
    assert "🌿 **Basilic n'Go** — Emietté de saumon ou Sauté de boeuf (9.40€)" in contenu
    assert "🍲 **La Mijote** — Wrap façon raclette (15€)" in contenu
    assert "Dubble" not in contenu  # pas de plat → pas de ligne


def test_maj_message_jour_n_ajoute_pas_deux_fois(tmp_path, monkeypatch):
    path = _setup(tmp_path, monkeypatch)
    optionnels = [{"restaurant": "Dubble", "plat": "Hot Bowl : poulet tikka", "prix": "10.90€"}]
    messages.maj_message_jour(None, optionnels, today=date(2026, 9, 9))
    messages.maj_message_jour(None, optionnels, today=date(2026, 9, 9))
    contenu = path.read_text(encoding="utf-8")
    assert contenu.count("🥣 **Dubble**") == 1


def test_maj_message_jour_sans_optionnels_reste_compatible(tmp_path, monkeypatch):
    path = _setup(tmp_path, monkeypatch)
    assert messages.maj_message_jour({"plat": "Blanquette", "prix": "12€"}, today=date(2026, 9, 9)) == str(path)
    assert "Blanquette" in path.read_text(encoding="utf-8")
