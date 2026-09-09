import { NextRequest, NextResponse } from "next/server";
import { ensureCarteTable, getCarte, upsertCarte } from "@/lib/db";
import type { Carte } from "@/lib/db";
import { RESTAURANTS } from "@/lib/restaurants";

export const runtime = "nodejs";

const SLUGS_CONNUS = new Set(RESTAURANTS.map((r) => r.slug));

/** Lecture publique d'une carte (`?slug=`, défaut Trèfle) : rendu à la demande côté
 *  home + comparaison de hash côté pipeline. Slug inconnu → 400. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "bistrot_trefle";
  if (!SLUGS_CONNUS.has(slug)) {
    return NextResponse.json({ error: "Slug de restaurant inconnu" }, { status: 400 });
  }
  const carte = await getCarte(slug);
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
