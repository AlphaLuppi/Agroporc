import { NextRequest, NextResponse } from "next/server";
import { ensureCarteTable, getCarte, upsertCarte } from "@/lib/db";
import type { Carte } from "@/lib/db";

export const runtime = "nodejs";

/** Lecture publique de la carte (sert le rendu home + la comparaison de hash côté pipeline) */
export async function GET() {
  // getCarte appelle déjà ensureCarteTable()
  const carte = await getCarte("bistrot_trefle");
  return NextResponse.json(carte);
}

/** Upsert protégé par token (depuis le pipeline) */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Carte;

    if (!body.restaurant_slug || !body.hash) {
      return NextResponse.json(
        { error: "Champs 'restaurant_slug' et 'hash' requis" },
        { status: 400 }
      );
    }

    await ensureCarteTable();
    await upsertCarte(body);

    return NextResponse.json({ ok: true, hash: body.hash });
  } catch (e) {
    console.error("[api/carte] Erreur:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
