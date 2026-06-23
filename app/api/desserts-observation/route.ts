import { NextRequest, NextResponse } from "next/server";
import {
  ensureDessertsTable,
  insertDessertsObservations,
  getDessertsObservations,
} from "@/lib/db";
import { isoMinusDays } from "@/lib/desserts";

export const runtime = "nodejs";

/** Ingestion protégée par token (depuis le pipeline 13h). */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { date?: string; desserts?: string[] };

    if (!body.date || !Array.isArray(body.desserts)) {
      return NextResponse.json(
        { error: "Champs 'date' et 'desserts' (tableau) requis" },
        { status: 400 }
      );
    }

    await ensureDessertsTable();
    const n = await insertDessertsObservations(body.date, body.desserts);

    return NextResponse.json({ ok: true, date: body.date, inserted: n });
  } catch (e) {
    console.error("[api/desserts-observation] Erreur:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/** Lecture publique des observations récentes (90 derniers jours) — utile pour debug. */
export async function GET() {
  const today = new Date().toLocaleDateString("en-CA");
  const rows = await getDessertsObservations(isoMinusDays(today, 90));
  return NextResponse.json(rows);
}
