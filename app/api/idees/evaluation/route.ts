import { NextRequest, NextResponse } from "next/server";
import { setIdeeEvaluation } from "@/lib/db";

export const runtime = "nodejs";

const FAISABILITES = ["faisable", "complexe", "impossible", "troll"] as const;

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = process.env.API_SECRET_TOKEN || "";
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { id, faisabilite, evaluation } = body;
    if (
      typeof id !== "number" ||
      !FAISABILITES.includes(faisabilite) ||
      typeof evaluation !== "string"
    ) {
      return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
    }
    const ok = await setIdeeEvaluation(id, faisabilite, evaluation.slice(0, 1000));
    if (!ok) return NextResponse.json({ error: "Idée introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/idees/evaluation] error:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
