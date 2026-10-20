import { NextRequest, NextResponse } from "next/server";
import { listerRecettes } from "@/lib/db";
import { PAR_PAGE, parametresBanque } from "@/lib/recettes";

export const runtime = "nodejs";

const CACHE = "public, max-age=60, s-maxage=60";

/** GET ?q=&restaurant=<slug>&page= (public) : banque de recettes paginée (24 par page). */
export async function GET(request: NextRequest) {
  const p = parametresBanque(request.nextUrl.searchParams);
  if (!p.ok) {
    return NextResponse.json({ error: p.erreur }, { status: 400 });
  }
  try {
    const { recettes, total } = await listerRecettes({ q: p.qNorm, restaurant: p.restaurant, page: p.page, parPage: PAR_PAGE });
    return NextResponse.json(
      { recettes, total, page: p.page, parPage: PAR_PAGE, pages: Math.max(1, Math.ceil(total / PAR_PAGE)) },
      { headers: { "Cache-Control": CACHE } },
    );
  } catch (e) {
    console.error("[api/recettes GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
