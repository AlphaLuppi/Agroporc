import { NextRequest, NextResponse } from "next/server";
import { getRecette } from "@/lib/db";
import { CLE_IMAGE_RE } from "@/lib/plat-image";

export const runtime = "nodejs";

// `s-maxage` : sans lui, le CDN Vercel ne met pas en cache la réponse d'une fonction.
const CACHE_ABSENTE = "public, max-age=60, s-maxage=60";
const CACHE_OK = "public, max-age=300, s-maxage=300";

/** Recette complète d'un plat (public) : utilisée par le panneau de détail. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ cle: string }> }) {
  const { cle } = await params;
  if (!CLE_IMAGE_RE.test(cle)) {
    return NextResponse.json({ error: "Clé invalide" }, { status: 400 });
  }
  try {
    const recette = await getRecette(cle);
    if (!recette) {
      return NextResponse.json({ error: "Recette introuvable" }, { status: 404, headers: { "Cache-Control": CACHE_ABSENTE } });
    }
    return NextResponse.json({ recette }, { headers: { "Cache-Control": CACHE_OK } });
  } catch (e) {
    console.error("[api/recette/[cle] GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
