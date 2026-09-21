import { NextRequest, NextResponse } from "next/server";
import { getPhotoData } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: "ID invalide" }, { status: 400 });
  }

  try {
    const data = await getPhotoData(numId);
    if (!data) {
      return NextResponse.json({ error: "Photo introuvable" }, { status: 404 });
    }

    const buffer = Buffer.from(data.image_data, "base64");
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": data.content_type,
        // Les octets d'une photo ne changent jamais pour un id donné : le CDN
        // Vercel peut la garder indéfiniment, la fonction n'est appelée qu'une fois.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("[api/photos/image GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
