import { NextResponse } from "next/server";
import { ensureTable, getLatestPdj } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTable();
    const pdj = await getLatestPdj();
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
