import { NextRequest, NextResponse } from "next/server";
import { ensureTable, getPdjByDate } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Format de date invalide (attendu : YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  try {
    await ensureTable();
    const entry = await getPdjByDate(date);
    if (!entry) {
      return NextResponse.json(
        { error: "Aucune donnée pour cette date" },
        { status: 404 }
      );
    }
    return NextResponse.json(entry);
  } catch (e) {
    console.error("[api/pdj/date] Erreur:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
