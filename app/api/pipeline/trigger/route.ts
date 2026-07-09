import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { requestRun, type PipelineMode } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const { mode } = (await request.json()) as { mode?: string };
    if (mode !== "jour" && mode !== "semaine") {
      return NextResponse.json({ error: "mode invalide" }, { status: 400 });
    }
    const id = await requestRun(mode as PipelineMode, "admin");
    if (id === null) {
      return NextResponse.json({ error: "Un run est déjà en cours" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
}
