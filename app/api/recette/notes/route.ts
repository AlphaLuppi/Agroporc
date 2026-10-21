import { NextRequest, NextResponse } from "next/server";
import { ensureRecettesTable, rattraperNotesRecettes } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST (Bearer API_SECRET_TOKEN) { toutes?: boolean } : rattrapage des notes Sportif / Goulaf
 * et de la protéine des recettes depuis pdj_entries. Sans corps : seulement les recettes jamais
 * traitées ; `toutes: true` recalcule tout (après un changement de règle).
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let toutes = false;
  try {
    const corps = (await request.json()) as { toutes?: unknown } | null;
    toutes = corps?.toutes === true;
  } catch {
    // Corps vide ou JSON invalide : rattrapage simple.
  }
  try {
    await ensureRecettesTable();
    const { notees, sans_note } = await rattraperNotesRecettes(toutes);
    return NextResponse.json({ ok: true, notees, sans_note });
  } catch (e) {
    console.error("[api/recette/notes POST]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
