import { NextResponse } from "next/server";
import { ensureTable, getAllPdj } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTable();
    const all = await getAllPdj();
    return NextResponse.json(all);
  } catch (e) {
    console.error("[api/historique] Erreur:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
