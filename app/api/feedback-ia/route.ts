import { NextRequest, NextResponse } from "next/server";
import { getAllPdj } from "@/lib/db";
import type { Commentaire } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Retourne toutes les réponses humaines à des commentaires IA, groupées par
 * prénom du personnage IA cible. Utilisé par le backend Python pour adapter
 * les personnages en fonction des retours réels des humains.
 *
 * Format de sortie :
 * {
 *   "Tom": [
 *     {
 *       date: "2026-03-12",
 *       restaurant: "Le Bistrot Trèfle",
 *       plat: "Entrecôte",
 *       ai_texte: "Commentaire original de Tom (IA)",
 *       ai_image_url?: "...",
 *       human_auteur: "Gab",
 *       human_texte: "Réponse de l'humain",
 *       human_image_url?: "..."
 *     },
 *     ...
 *   ],
 *   ...
 * }
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const entries = await getAllPdj();
    const feedback: Record<
      string,
      Array<{
        date: string;
        restaurant: string;
        plat: string;
        ai_texte: string;
        ai_image_url?: string;
        human_auteur: string;
        human_texte: string;
        human_image_url?: string;
      }>
    > = {};

    for (const entry of entries) {
      const date = entry.date;
      for (const plat of entry.plats || []) {
        const commentaires = plat.commentaires || [];
        for (const c of commentaires) {
          // On ne retient que les commentaires humains qui répondent à un autre
          if (!c.is_human) continue;
          if (c.reponse_a_index === undefined || c.reponse_a_index === null) continue;

          const parent = resolveParent(commentaires, c);
          if (!parent) continue;
          // Le parent doit être une IA (is_human falsy)
          if (parent.is_human) continue;

          const aiName = parent.auteur;
          if (!feedback[aiName]) feedback[aiName] = [];
          feedback[aiName].push({
            date,
            restaurant: plat.restaurant,
            plat: plat.plat,
            ai_texte: parent.texte,
            ...(parent.image_url ? { ai_image_url: parent.image_url } : {}),
            human_auteur: c.auteur,
            human_texte: c.texte,
            ...(c.image_url ? { human_image_url: c.image_url } : {}),
          });
        }
      }
    }

    return NextResponse.json({ feedback });
  } catch (e) {
    console.error("[api/feedback-ia] Erreur:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/** Résout le commentaire parent d'une réponse, avec fallback par nom. */
function resolveParent(
  commentaires: Commentaire[],
  reply: Commentaire
): Commentaire | null {
  const idx = reply.reponse_a_index;
  if (
    idx !== undefined &&
    idx !== null &&
    idx >= 0 &&
    idx < commentaires.length &&
    (!reply.reponse_a || commentaires[idx].auteur === reply.reponse_a)
  ) {
    return commentaires[idx];
  }
  // Fallback : chercher par nom d'auteur avant l'index courant
  if (reply.reponse_a) {
    for (const c of commentaires) {
      if (c === reply) break;
      if (c.auteur === reply.reponse_a) return c;
    }
  }
  return null;
}
