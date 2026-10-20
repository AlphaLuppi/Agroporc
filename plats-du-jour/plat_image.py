"""
Logique pure des images IA des plats (POC) : clé d'image, variantes, prompt, validation.

La clé est calculée À L'IDENTIQUE côté Next (`lib/plat-image.ts`) : les deux suites de
tests lisent les mêmes vecteurs (`lib/plat-image-vecteurs.json`).

  base = norm(restaurant) + "|" + norm(nom_variante)
  norm = NFKD → sans diacritiques → minuscules → œ/æ/ß/ø → [^a-z0-9]+ → " " → trim
  cle  = sha256(base).hex[:24]

Unité = la variante (comme `variantesPlat` côté front) : un plat multi-options
(Basilic n'Go, Dubble) donne une image par option, chacune ayant sa tuile.
"""
import hashlib
import json
import re
import unicodedata
import zlib

CLE_RE = re.compile(r"^[0-9a-f]{24}$")

TAILLE_MIN = 4 * 1024           # en dessous : réponse tronquée / image vide
TAILLE_MAX = 1_500_000          # plafond aussi appliqué par POST /api/plat-image


# Lettres que NFKD ne décompose pas (même table en TS).
LIGATURES = {"œ": "oe", "æ": "ae", "ß": "ss", "ø": "o"}


def norm(s: str) -> str:
    t = unicodedata.normalize("NFKD", s or "")
    t = "".join(c for c in t if not unicodedata.category(c).startswith("M"))  # = \p{M} en JS
    t = t.lower()
    for lig, rempl in LIGATURES.items():
        t = t.replace(lig, rempl)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return t.strip()


def base_cle(restaurant: str, plat: str) -> str:
    return f"{norm(restaurant)}|{norm(plat)}"


def cle_image(restaurant: str, plat: str) -> str:
    return hashlib.sha256(base_cle(restaurant, plat).encode("utf-8")).hexdigest()[:24]


def seed_image(restaurant: str, plat: str) -> int:
    """Seed déterministe (Horde/Pollinations ; Cloudflare l'ignore)."""
    return zlib.crc32(base_cle(restaurant, plat).encode("utf-8")) % (2 ** 31)


def variantes(plat: dict) -> list[str]:
    """Noms des variantes d'un plat (miroir de `variantesPlat` dans lib/plat-options.ts)."""
    noms = plat.get("plat")
    noms = [n for n in noms if isinstance(n, str)] if isinstance(noms, list) else [noms or ""]
    options = plat.get("options")
    if isinstance(options, list) and options:
        out = []
        for i, o in enumerate(options):
            o = o if isinstance(o, dict) else {}
            nom = o.get("plat") if isinstance(o.get("plat"), str) else ""
            nom = nom or (noms[i] if i < len(noms) else "") or (noms[0] if noms else "")
            out.append(nom)
        return [n for n in out if n]
    return [n for n in noms if n]


def a_illustrer(pdj: dict) -> list[dict]:
    """Variantes d'un PDJ publié à illustrer, sans doublon de clé, hors `coming_soon`."""
    vus, out = set(), []
    for p in (pdj or {}).get("plats") or []:
        if not isinstance(p, dict) or p.get("coming_soon"):
            continue
        resto = p.get("restaurant") or ""
        for nom in variantes(p):
            if not norm(nom) or not norm(resto):
                continue
            cle = cle_image(resto, nom)
            if cle in vus:
                continue
            vus.add(cle)
            out.append({"cle": cle, "restaurant": resto, "plat": nom})
    return out


def libelle_lisible(nom: str) -> str:
    """Comme `casseLisible` : espaces normalisés, point final retiré, MAJUSCULES adoucies."""
    t = re.sub(r"\s+", " ", nom or "").strip()
    t = re.sub(r"\s+,", ",", t)
    t = re.sub(r"\s*\.$", "", t)
    lettres = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ]", "", t)
    if len(lettres) > 3 and lettres == lettres.upper():
        t = t.lower()
        t = t[:1].upper() + t[1:]
    return t


# Contexte visuel par resto (clé = norm(nom du resto)) : oriente le dressage.
CONTEXTE_RESTO = {
    # Contenants réels des plats à emporter (constatés sur place).
    "le bistrot trefle": ("a French bistro takeaway lunch, served in a round brown kraft paper "
                          "takeaway bowl with a clear plastic lid, the only container in the picture"),
    "la pause gourmande": ("a generous homemade French takeaway lunch, served in a round brown kraft "
                           "paper takeaway bowl with a clear plastic lid, the only container in the picture"),
    "le truck muche": "a hearty French food-truck lunch, served in a plain rectangular aluminium foil takeaway tray",
    "basilic n go": "a fresh homemade lunch dish",
    "dubble": "a colorful hot bowl lunch, served in a wide bowl",
    "la mijote": "a slow-cooked French home-style lunch plate",
}
CONTEXTE_DEFAUT = "a French lunch plate"

NEGATIF = "text, letters, watermark, logo, label, branding, blurry, cartoon, drawing, deformed, people, hands"

# FLUX n'a pas de prompt négatif : l'interdit du texte est répété en fin de prompt. Le libellé
# français n'est jamais mis entre guillemets (FLUX recopie les chaînes citées en lettrage).
SANS_TEXTE = ("absolutely no text, no letters, no logos, no labels, no branding, "
              "no packaging print, no watermark")

DESCRIPTION_MAX = 400


def construire_prompt(restaurant: str, plat: str, description: str | None = None) -> str:
    """Prompt anglais. Avec `description` (rédigée par le LLM, cf. `prompt_descriptions`) le
    plat est décrit visuellement ; sinon on retombe sur le libellé français brut."""
    contexte = CONTEXTE_RESTO.get(norm(restaurant), CONTEXTE_DEFAUT)
    sujet = description or f"the French dish {libelle_lisible(plat)}"
    return (
        f"Professional food photography of {sujet}, {contexte}. "
        "Every component of the dish is clearly visible. "
        "Soft natural window light on a wooden bistro table, shallow depth of field, "
        f"45-degree angle, appetizing, photorealistic, highly detailed, {SANS_TEXTE}"
    )


def prompt_descriptions(items: list[dict]) -> str:
    """Prompt LLM : une description visuelle anglaise par variante, en JSON {cle: description}."""
    lignes = "\n".join(
        f'- {it["cle"]} : {libelle_lisible(it["plat"])} (restaurant : {it["restaurant"]})'
        for it in items
    )
    return (
        "Tu prépares des prompts pour un générateur d'images (FLUX) qui illustre des plats du "
        "jour de restaurants français. Pour chaque plat ci-dessous, écris en ANGLAIS une "
        "description visuelle concrète de ce qu'on voit dans l'assiette (25 à 45 mots) : "
        "l'ingrédient principal et sa forme (morceaux, tranches, effiloché…), la cuisson et la "
        "couleur, la sauce et sa texture, chaque accompagnement nommé, la garniture. Traduis "
        "les termes culinaires français par ce qu'ils désignent visuellement (ex. blanquette de "
        "veau → chunks of tender veal in a pale creamy white sauce with carrots and button "
        "mushrooms). N'invente pas d'ingrédient absent du libellé au-delà de la recette "
        "classique. Pas de nom de marque, pas de texte à afficher, pas de guillemets.\n\n"
        f"Plats (clé : libellé) :\n{lignes}\n\n"
        'Réponds UNIQUEMENT avec un objet JSON {"<clé>": "<description>", ...}, sans markdown.'
    )


def nettoyer_description(s) -> str | None:
    """Description LLM utilisable dans un prompt, sinon None."""
    if not isinstance(s, str):
        return None
    t = re.sub(r"\s+", " ", s).strip()
    t = t.replace('"', "").replace("\u201c", "").replace("\u201d", "").strip().rstrip(".")
    if len(t) < 10:
        return None
    return t[:DESCRIPTION_MAX].strip()


def parser_descriptions(brut: str, cles: list[str]) -> dict[str, str]:
    """Réponse LLM → {cle: description}, limité aux clés demandées. Ne lève jamais."""
    t = (brut or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    debut, fin = t.find("{"), t.rfind("}")
    if debut < 0 or fin <= debut:
        return {}
    try:
        data = json.loads(t[debut:fin + 1])
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    out = {}
    for cle in cles:
        d = nettoyer_description(data.get(cle))
        if d:
            out[cle] = d
    return out


def type_image(data: bytes) -> str | None:
    """Content-Type d'après les magic bytes (jpeg/png/webp), sinon None."""
    if not data:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def valider_image(data: bytes) -> str:
    """Renvoie le Content-Type ou lève ValueError (pas une image, trop petite/grosse)."""
    ct = type_image(data)
    if not ct:
        debut = (data or b"")[:80]
        raise ValueError(f"réponse non image : {debut!r}")
    if len(data) < TAILLE_MIN:
        raise ValueError(f"image trop petite ({len(data)} o)")
    if len(data) > TAILLE_MAX:
        raise ValueError(f"image trop grosse ({len(data)} o)")
    return ct
