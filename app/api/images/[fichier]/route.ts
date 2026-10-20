import { NextRequest, NextResponse } from "next/server";
import { getImage } from "@/lib/db";

export const runtime = "nodejs";

/** Sert une image importée : `/api/images/12.webp` (l'extension est décorative). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fichier: string }> }
) {
  const { fichier } = await params;
  const match = fichier.match(/^(\d+)(?:\.[a-z]+)?$/i);
  if (!match) {
    return NextResponse.json({ error: "ID invalide" }, { status: 400 });
  }

  try {
    const data = await getImage(parseInt(match[1], 10));
    if (!data) {
      return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
    }
    return new NextResponse(Buffer.from(data.image_data, "base64"), {
      headers: {
        "Content-Type": data.content_type,
        // Une image importée n'est jamais modifiée (une nouvelle image = un nouvel id).
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("[api/images GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
