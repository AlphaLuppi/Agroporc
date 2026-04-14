import { NextRequest, NextResponse } from "next/server";
import { getIdeesNonEvaluees } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = process.env.API_SECRET_TOKEN || "";
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const idees = await getIdeesNonEvaluees();
    return NextResponse.json(idees);
  } catch (e) {
    console.error("[api/idees/non-evaluees] error:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
