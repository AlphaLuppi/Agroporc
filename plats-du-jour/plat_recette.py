"""
Logique pure des recettes maison des plats (POC) : variantes à cuisiner, ingrédients estimés,
dates de service. Aucun réseau.

Unité = la variante, comme les images : même clé de plat (`plat_image.cle_image`), donc une
recette et la photo du même plat se retrouvent côté Next avec la même clé.
"""
import plat_image

INGREDIENTS_MAX = 25


def variantes_avec_source(plat: dict) -> list[tuple[str, dict]]:
    """Comme `plat_image.variantes`, mais garde l'objet qui porte les ingrédients de chaque
    variante : l'option pour un plat multi-options, rien ({}) pour une simple liste de noms
    (pas d'ingrédients par nom), le plat lui-même sinon."""
    noms = plat.get("plat")
    liste = isinstance(noms, list)
    noms = [n for n in noms if isinstance(n, str)] if liste else [noms or ""]
    options = plat.get("options")
    if isinstance(options, list) and options:
        out = []
        for i, o in enumerate(options):
            o = o if isinstance(o, dict) else {}
            nom = o.get("plat") if isinstance(o.get("plat"), str) else ""
            nom = nom or (noms[i] if i < len(noms) else "") or (noms[0] if noms else "")
            out.append((nom, o))
        return [(n, s) for n, s in out if n]
    if liste:
        return [(n, {}) for n in noms if n]
    return [(n, plat) for n in noms if n]


def ingredients_estimes(source: dict) -> list[dict]:
    """[{nom, grammes}] d'UNE portion estimés par le diet agent (`ingredients`), à défaut
    le détail Ciqual (`ingredients_detail`, champ `nom_query`). Au plus 25."""
    source = source if isinstance(source, dict) else {}
    brut, champ = source.get("ingredients"), "nom"
    if not isinstance(brut, list) or not brut:
        brut, champ = source.get("ingredients_detail"), "nom_query"
    out = []
    for ing in brut if isinstance(brut, list) else []:
        if not isinstance(ing, dict):
            continue
        nom = ing.get(champ)
        nom = " ".join(nom.split()) if isinstance(nom, str) else ""
        try:
            grammes = round(float(ing.get("grammes") or 0))
        except (TypeError, ValueError):
            continue
        if not nom or grammes <= 0:
            continue
        out.append({"nom": nom, "grammes": grammes})
        if len(out) >= INGREDIENTS_MAX:
            break
    return out


def a_cuisiner(pdj: dict) -> list[dict]:
    """Variantes d'un PDJ publié qui méritent une recette : ni jour férié, ni `coming_soon`,
    ni resto / nom vide ; sans doublon de clé."""
    if not pdj or pdj.get("ferie"):
        return []
    vus, out = set(), []
    for p in pdj.get("plats") or []:
        if not isinstance(p, dict) or p.get("coming_soon"):
            continue
        resto = p.get("restaurant") or ""
        if not isinstance(resto, str) or not plat_image.norm(resto):
            continue
        for nom, source in variantes_avec_source(p):
            if not plat_image.norm(nom):
                continue
            cle = plat_image.cle_image(resto, nom)
            if cle in vus:
                continue
            vus.add(cle)
            out.append({"cle": cle, "restaurant": resto, "plat": nom, "date": pdj.get("date"),
                        "ingredients": ingredients_estimes(source)})
    return out


def services(pdjs: list[dict]) -> list[dict]:
    """Couples {cle, date} de toutes les variantes servies, sans doublon."""
    vus, out = set(), []
    for pdj in pdjs or []:
        for it in a_cuisiner(pdj):
            couple = (it["cle"], it["date"])
            if not it["date"] or couple in vus:
                continue
            vus.add(couple)
            out.append({"cle": it["cle"], "date": it["date"]})
    return out
