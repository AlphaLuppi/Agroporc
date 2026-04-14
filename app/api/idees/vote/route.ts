import { NextRequest, NextResponse } from "next/server";
import { toggleVoteIdee } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ideeId, votant } = body;

    if (!ideeId || !votant) {
      return NextResponse.json(
        { error: "Champs requis : ideeId, votant" },
        { status: 400 }
      );
    }

    if (typeof votant !== "string" || votant.trim().length === 0 || votant.length > 50) {
      return NextResponse.json({ error: "Nom invalide" }, { status: 400 });
    }

    const success = await toggleVoteIdee(ideeId, votant.trim());
    if (!success) {
      return NextResponse.json({ error: "Idée introuvable" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/idees/vote] POST error:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
