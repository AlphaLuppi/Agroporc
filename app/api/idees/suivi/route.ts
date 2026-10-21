import { NextRequest, NextResponse } from "next/server";
import { setIdeeSuivi } from "@/lib/db";

export const runtime = "nodejs";

const STATUTS = ["nouveau", "fait", "refusé"] as const;

/** Suivi d'une idée par l'équipe : { id, statut?, reponse?, archiver? } (Bearer). */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = process.env.API_SECRET_TOKEN || "";
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id, statut, reponse, archiver } = await request.json();
    if (
      typeof id !== "number" ||
      (statut !== undefined && !STATUTS.includes(statut)) ||
      (reponse !== undefined && typeof reponse !== "string") ||
      (archiver !== undefined && typeof archiver !== "boolean")
    ) {
      return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
    }
    const ok = await setIdeeSuivi(id, { statut, reponse: reponse?.slice(0, 1000), archiver });
    if (!ok) return NextResponse.json({ error: "Idée introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/idees/suivi] error:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
