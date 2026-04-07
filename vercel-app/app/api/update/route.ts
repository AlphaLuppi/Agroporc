import { NextRequest, NextResponse } from "next/server";
import { ensureTable, upsertPdj } from "@/lib/db";
import type { PdjEntry } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Vérifier le token
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PdjEntry;

    if (!body.date) {
      return NextResponse.json(
        { error: "Champ 'date' requis" },
        { status: 400 }
      );
    }

    await ensureTable();
    await upsertPdj(body);

    return NextResponse.json({ ok: true, date: body.date });
  } catch (e) {
    console.error("[api/update] Erreur:", e);
    return NextResponse.json(
      { error: "Erreur serveur" },
      { status: 500 }
    );
  }
}

/** GET pour vérifier que l'endpoint est accessible */
export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "POST /api/update" });
}
