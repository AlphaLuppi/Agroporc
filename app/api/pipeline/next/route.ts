import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/adminAuth";
import { claimNextRun } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyBearer(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const run = await claimNextRun();
  return NextResponse.json(run ?? {});
}
