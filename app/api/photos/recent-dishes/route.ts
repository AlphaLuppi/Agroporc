import { NextRequest, NextResponse } from "next/server";
import { getRecentDishesBySlug } from "@/lib/db";

export const runtime = "nodejs";

const VALID_SLUGS = new Set(["bistrot_trefle", "pause_gourmande", "truck_muche"]);

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug || !VALID_SLUGS.has(slug)) {
    return NextResponse.json({ error: "Slug invalide" }, { status: 400 });
  }
  try {
    const dishes = await getRecentDishesBySlug(slug);
    return NextResponse.json({ dishes });
  } catch (e) {
    console.error("[api/photos/recent-dishes]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
