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
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.error("[api/photos/image GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
