import { NextResponse } from "next/server";
import { ensureTable, getLatestPdj, getPdjByDate } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Dernière entrée publiée, ou celle d'une date précise via `?date=YYYY-MM-DD`. */
export async function GET(request: Request) {
  try {
    await ensureTable();
    const date = new URL(request.url).searchParams.get("date");
    const pdj = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? await getPdjByDate(date) : await getLatestPdj();
    if (!pdj) {
      return NextResponse.json(
        { error: "Aucune donnée disponible" },
        { status: 404 }
      );
    }
    return NextResponse.json(pdj);
  } catch (e) {
    console.error("[api/pdj] Erreur:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
