"""
Jours fériés français.
Inclut les fêtes fixes et les fêtes mobiles (basées sur Pâques).
"""
from datetime import date, timedelta


def _paques(annee: int) -> date:
    """Calcul de la date de Pâques (algorithme de Butcher/Meeus)."""
    a = annee % 19
    b, c = divmod(annee, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mois, jour = divmod(h + l - 7 * m + 114, 31)
    return date(annee, mois, jour + 1)


def jours_feries(annee: int) -> dict[date, str]:
    """Retourne un dict {date: nom} des jours fériés français pour l'année donnée."""
    p = _paques(annee)
    return {
        date(annee, 1, 1): "Jour de l'An",
        p + timedelta(days=1): "Lundi de Pâques",
        date(annee, 5, 1): "Fête du Travail",
        date(annee, 5, 8): "Victoire 1945",
        p + timedelta(days=39): "Ascension",
        p + timedelta(days=50): "Lundi de Pentecôte",
        date(annee, 7, 14): "Fête nationale",
        date(annee, 8, 15): "Assomption",
        date(annee, 11, 1): "Toussaint",
        date(annee, 11, 11): "Armistice 1918",
        date(annee, 12, 25): "Noël",
    }


def est_ferie(d: date) -> str | None:
    """Retourne le nom du jour férié si d est férié, sinon None."""
    return jours_feries(d.year).get(d)
