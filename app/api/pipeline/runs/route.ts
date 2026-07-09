import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { getRecentRuns } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const runs = await getRecentRuns();
  return NextResponse.json({ runs });
}
