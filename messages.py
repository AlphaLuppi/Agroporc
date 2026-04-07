"""
Génération des fichiers messages pour le bot.
Produit un fichier par jour (lundi→vendredi) dans output/messages/.
"""
import json
from datetime import date, timedelta
from pathlib import Path

from jours_feries import est_ferie

MESSAGES_DIR = Path(__file__).parent / "output" / "messages"
PDJ_FILE = Path(__file__).parent / "output" / "pdj.json"
DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"]
DAY_NAMES_LOWER = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"]

RESTAURANTS = {
    "trefle": {"emoji": "🍀", "nom": "Le Bistrot Trèfle"},
    "truck": {"emoji": "🚚", "nom": "Le Truck Muche"},
    "pause": {"emoji": "☕", "nom": "La Pause Gourmande"},
}


def _load_notes() -> dict[str, dict]:
    """
    Charge les notes depuis pdj.json.
    Retourne un dict { restaurant_name: { "note": X, "note_goulaf": Y } }.
    """
    if not PDJ_FILE.exists():
        return {}
    try:
        data = json.loads(PDJ_FILE.read_text())
        notes = {}
        for plat in data.get("plats", []):
            resto = plat.get("restaurant", "")
            notes[resto] = {
                "note": plat.get("note"),
                "note_goulaf": plat.get("note_goulaf"),
            }
        return notes
    except Exception:
        return {}


def _format_notes(notes_resto: dict | None) -> str:
    """Formate les notes sportif/goulaf en suffixe pour un plat."""
    if not notes_resto:
        return ""
    parts = []
    note = notes_resto.get("note")
    note_g = notes_resto.get("note_goulaf")
    if note is not None:
        parts.append(f"🏋️ {note}/10")
    if note_g is not None:
        parts.append(f"😋 {note_g}/10")
    if parts:
        return " — " + " · ".join(parts)
    return ""


def _date_du_jour(lundi: date, jour_idx: int) -> str:
    """Retourne ex: 'Lundi 23 mars'."""
    d = lundi + timedelta(days=jour_idx)
    mois = [
        "janvier", "février", "mars", "avril", "mai", "juin",
        "juillet", "août", "septembre", "octobre", "novembre", "décembre",
    ]
    return f"{DAY_NAMES_LOWER[jour_idx].capitalize()} {d.day} {mois[d.month - 1]}"


def generer_messages_semaine(
    trefle_semaine: dict[str, dict] | None,
    truck_semaine: dict[str, dict] | None,
    pause_jour: dict | None,
) -> list[str]:
    """
    Génère les fichiers messages pour chaque jour de la semaine.
    - trefle_semaine / truck_semaine : { "LUNDI": {"plat": ..., "prix": ...}, ... }
    - pause_jour : {"plat": ..., "prix": ...} (seulement le jour actuel, lundi)
    Retourne la liste des fichiers créés.
    """
    MESSAGES_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today()
    lundi = today - timedelta(days=today.weekday())
    fichiers = []

    # ── Message récap semaine ────────────────────────────────────────────
    recap = _generer_recap_semaine(lundi, trefle_semaine, truck_semaine)
    recap_path = MESSAGES_DIR / "semaine.md"
    recap_path.write_text(recap, encoding="utf-8")
    fichiers.append(str(recap_path))
    print(f"[messages] {recap_path.name}")

    # Charger les notes du jour (disponibles seulement pour aujourd'hui)
    notes = _load_notes()

    # ── Un fichier par jour ──────────────────────────────────────────────
    for i, day in enumerate(DAY_NAMES):
        jour_date = lundi + timedelta(days=i)
        date_label = _date_du_jour(lundi, i)
        ferie = est_ferie(jour_date)
        # Notes uniquement pour le jour actuel
        day_notes = notes if i == today.weekday() else {}

        if ferie:
            msg = f"🍽️ **Plats du jour — {date_label}**\n"
            msg += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            msg += f"🚫 **Fermé** — _{ferie}_\n"
        else:
            plats = []

            # Trèfle
            if trefle_semaine and day in trefle_semaine:
                t = trefle_semaine[day]
                n = _format_notes(day_notes.get("Le Bistrot Trèfle"))
                plats.append(f"🍀 **Le Bistrot Trèfle** — {t['plat']} ({t['prix']}){n}")
            else:
                plats.append("🍀 **Le Bistrot Trèfle** — _pas d'info_")

            # Truck Muche
            if truck_semaine and day in truck_semaine:
                t = truck_semaine[day]
                n = _format_notes(day_notes.get("Le Truck Muche"))
                plats.append(f"🚚 **Le Truck Muche** — {t['plat']} ({t['prix']}){n}")
            else:
                plats.append("🚚 **Le Truck Muche** — _pas d'info_")

            # Pause Gourmande : connu seulement si c'est le jour actuel (lundi)
            if i == today.weekday() and pause_jour:
                n = _format_notes(day_notes.get("La Pause Gourmande"))
                plats.append(f"☕ **La Pause Gourmande** — {pause_jour['plat']} ({pause_jour['prix']}){n}")
            else:
                plats.append("☕ **La Pause Gourmande** — _on ne sait pas encore_")

            msg = f"🍽️ **Plats du jour — {date_label}**\n"
            msg += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            msg += "\n".join(plats) + "\n"

        path = MESSAGES_DIR / f"{DAY_NAMES_LOWER[i]}.md"
        path.write_text(msg, encoding="utf-8")
        fichiers.append(str(path))
        print(f"[messages] {path.name}")

    return fichiers


def maj_message_jour(pause_jour: dict | None) -> str | None:
    """
    Met à jour le fichier message du jour actuel avec le plat de la Pause Gourmande.
    Retourne le chemin du fichier modifié ou None.
    """
    today = date.today()
    weekday = today.weekday()
    if weekday > 4:
        print("[messages] Week-end, pas de mise à jour")
        return None

    ferie = est_ferie(today)
    if ferie:
        print(f"[messages] Jour férié ({ferie}), pas de mise à jour")
        return None

    path = MESSAGES_DIR / f"{DAY_NAMES_LOWER[weekday]}.md"
    if not path.exists():
        print(f"[messages] {path.name} n'existe pas — lancer d'abord la pipeline semaine")
        return None

    contenu = path.read_text(encoding="utf-8")

    # Charger les notes pour ajouter les évaluations
    notes = _load_notes()

    # Remplacer la ligne Pause Gourmande
    old_line = "☕ **La Pause Gourmande** — _on ne sait pas encore_"
    if old_line in contenu and pause_jour:
        n = _format_notes(notes.get("La Pause Gourmande"))
        new_line = f"☕ **La Pause Gourmande** — {pause_jour['plat']} ({pause_jour['prix']}){n}"
        contenu = contenu.replace(old_line, new_line)

    # Ajouter les notes aux autres restaurants si elles manquent
    for resto_key, resto_name in [("Le Bistrot Trèfle", "🍀"), ("Le Truck Muche", "🚚")]:
        n = _format_notes(notes.get(resto_key))
        if n and resto_name in contenu and "🏋️" not in contenu.split(resto_name)[1].split("\n")[0]:
            # La ligne du restaurant existe mais n'a pas encore de notes
            lines = contenu.split("\n")
            for idx, line in enumerate(lines):
                if line.startswith(resto_name) and "🏋️" not in line and "_pas d'info_" not in line:
                    lines[idx] = line + n
                    break
            contenu = "\n".join(lines)

    path.write_text(contenu, encoding="utf-8")
    print(f"[messages] {path.name} mis à jour avec notes et Pause Gourmande")

    return str(path)


def _generer_recap_semaine(
    lundi: date,
    trefle_semaine: dict[str, dict] | None,
    truck_semaine: dict[str, dict] | None,
) -> str:
    """Génère le message récap de toute la semaine."""
    lines = []
    lines.append("📋 **Menu de la semaine**")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    # Trèfle
    lines.append("🍀 **Le Bistrot Trèfle**")
    for i, day in enumerate(DAY_NAMES):
        jour_date = lundi + timedelta(days=i)
        date_label = _date_du_jour(lundi, i)
        ferie = est_ferie(jour_date)
        if ferie:
            lines.append(f"  **{date_label}** — _Fermé ({ferie})_")
        elif trefle_semaine and day in trefle_semaine:
            t = trefle_semaine[day]
            lines.append(f"  **{date_label}** — {t['plat']} ({t['prix']})")
        else:
            lines.append(f"  **{date_label}** — _pas d'info_")
    lines.append("")

    # Truck Muche
    lines.append("🚚 **Le Truck Muche**")
    for i, day in enumerate(DAY_NAMES):
        jour_date = lundi + timedelta(days=i)
        date_label = _date_du_jour(lundi, i)
        ferie = est_ferie(jour_date)
        if ferie:
            lines.append(f"  **{date_label}** — _Fermé ({ferie})_")
        elif truck_semaine and day in truck_semaine:
            t = truck_semaine[day]
            lines.append(f"  **{date_label}** — {t['plat']} ({t['prix']})")
        else:
            lines.append(f"  **{date_label}** — _pas d'info_")
    lines.append("")

    lines.append("☕ **La Pause Gourmande** — menu jour par jour uniquement")
    lines.append("")

    return "\n".join(lines) + "\n"
