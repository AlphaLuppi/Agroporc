import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/adminAuth";
import { finishRun, recordFinishedRun, type PipelineMode, type PipelineStatus } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!verifyBearer(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      id?: number;
      mode?: string;
      triggered_by?: string;
      status?: string;
      log?: string;
    };
    const status = body.status;
    if (status !== "success" && status !== "error") {
      return NextResponse.json({ error: "status invalide" }, { status: 400 });
    }
    const log = body.log ?? "";

    if (typeof body.id === "number") {
      await finishRun(body.id, status as PipelineStatus, log);
      return NextResponse.json({ ok: true });
    }
    if (body.mode !== "jour" && body.mode !== "semaine") {
      return NextResponse.json({ error: "mode requis sans id" }, { status: 400 });
    }
    await recordFinishedRun(
      body.mode as PipelineMode,
      status as PipelineStatus,
      log,
      body.triggered_by ?? "cron"
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
}
