import { NextRequest, NextResponse } from "next/server";
import { deletePhoto } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: "ID invalide" }, { status: 400 });
  }

  try {
    const deleted = await deletePhoto(numId);
    if (!deleted) {
      return NextResponse.json({ error: "Photo introuvable" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/photos DELETE]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
