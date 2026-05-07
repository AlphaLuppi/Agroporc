"""
Agent d'estimation des portions à partir de photos de plats.

Méthode : estimation visuelle avec objets de référence.
  1. Identifier les objets connus dans la photo (assiette ~25-27cm, fourchette ~19cm, couteau ~22cm)
  2. Estimer la surface et la hauteur des aliments par rapport à ces références
  3. Calculer le volume → convertir en masse via densité alimentaire typique
  4. Moyenner sur plusieurs photos pour réduire l'incertitude individuelle

Retourne, pour un ensemble de photos d'un restaurant, un poids de portion moyen en grammes.
"""
import json
import os
import anthropic

PORTION_ESTIMATION_PROMPT = """Tu analyses une photo de plat de restaurant pour estimer le poids total des aliments présentés.

Méthode d'estimation :
1. Identifie les objets de référence visibles dans la photo et leurs dimensions typiques :
   - Assiette standard : diamètre 25-27 cm (surface ≈ 530 cm²)
   - Fourchette : longueur ~19 cm
   - Couteau : longueur ~22 cm
   - Verre : hauteur ~15 cm
2. Estime la fraction de l'assiette occupée par les aliments (0 à 1)
3. Estime la hauteur moyenne des aliments empilés (en cm)
4. Volume estimé ≈ surface_assiette × fraction × hauteur
5. Applique une densité selon le type d'aliment dominant :
   - Viande/poisson : ~1.05 g/cm³
   - Féculents (riz, pâtes, pommes de terre) : ~1.1 g/cm³
   - Légumes cuits : ~0.7 g/cm³
   - Mixte équilibré : ~0.9 g/cm³
6. Poids estimé = volume × densité

Réponds UNIQUEMENT en JSON valide (sans markdown) :
{
  "reference_identifiee": "description de l'objet de référence utilisé",
  "fraction_assiette": 0.65,
  "hauteur_cm": 3.5,
  "densite_gcm3": 0.95,
  "poids_estime_g": 420,
  "confiance": "haute",
  "commentaire": "note sur l'estimation ou les incertitudes"
}"""


def _strip_json(raw: str) -> str:
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def estimate_portion_from_photo(image_b64: str, mime_type: str) -> dict | None:
    """Estime le poids d'une portion à partir d'une photo via Claude Vision.

    Retourne un dict avec `poids_estime_g`, ou None si l'estimation échoue
    (pas d'API key, erreur réseau, JSON invalide…).
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": PORTION_ESTIMATION_PROMPT},
                ],
            }],
        )
        return json.loads(_strip_json(message.content[0].text.strip()))
    except Exception as e:
        print(f"[portion_agent] Erreur estimation photo : {e}")
        return None


def compute_average_portion(photos: list[dict]) -> dict | None:
    """Calcule la portion moyenne d'un restaurant à partir d'une liste de photos.

    Args:
        photos: [{"image_data": str (base64), "content_type": str}, ...]

    Returns:
        {"poids_moyen_g": int, "nb_photos": int, "estimations": list}
        ou None si aucune estimation valide n'a pu être produite.
    """
    estimations = []
    for photo in photos:
        result = estimate_portion_from_photo(
            photo["image_data"],
            photo.get("content_type", "image/jpeg"),
        )
        if result and isinstance(result.get("poids_estime_g"), (int, float)):
            estimations.append(result)
            print(
                f"[portion_agent] Photo estimée : {result['poids_estime_g']}g "
                f"({result.get('confiance', '?')}) — {result.get('commentaire', '')}"
            )

    if not estimations:
        return None

    poids_moyen = round(sum(e["poids_estime_g"] for e in estimations) / len(estimations))
    print(f"[portion_agent] Moyenne sur {len(estimations)} photo(s) : {poids_moyen}g")
    return {
        "poids_moyen_g": poids_moyen,
        "nb_photos": len(estimations),
        "estimations": estimations,
    }
