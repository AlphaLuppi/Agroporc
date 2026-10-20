import { NextRequest, NextResponse } from "next/server";
import { getPlatImage } from "@/lib/db";
import { CLE_IMAGE_RE, paramVersion, versionDepuisParam } from "@/lib/plat-image";

export const runtime = "nodejs";

// `s-maxage` : sans lui, le CDN Vercel ne met pas en cache la réponse d'une fonction
// (il est retiré de l'en-tête transmis au navigateur).
const CACHE_VERSIONNE = "public, max-age=31536000, s-maxage=31536000, immutable";
const CACHE_COURT = "public, max-age=300, s-maxage=300";
const SECURITE = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Content-Disposition": "inline",
};

/**
 * Image IA d'un plat. L'URL de la page porte `?v=<version>` (created_at en ms, base 36) :
 * une régénération change l'URL, d'où un cache immuable (navigateur + CDN). Un `v` qui
 * n'est pas la version en base est redirigé vers la bonne URL sans lire les octets, et
 * n'est jamais servi en `immutable`. Sans `v` : cache court, ETag.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ cle: string }> }) {
  const { cle } = await params;
  if (!CLE_IMAGE_RE.test(cle)) {
    return NextResponse.json({ error: "Clé invalide" }, { status: 400 });
  }
  const brut = request.nextUrl.searchParams.get("v");
  const demandee = versionDepuisParam(brut);
  try {
    const img = await getPlatImage(cle, brut === null ? null : demandee ?? -1);
    if (!img) {
      return NextResponse.json({ error: "Image introuvable" }, { status: 404, headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
    }
    const version = paramVersion(img.version_ms);
    if (brut !== null && (brut !== version || !img.image_data)) {
      const cible = new URL(`/api/plat-image/${cle}?v=${version}`, request.nextUrl.origin);
      return NextResponse.redirect(cible, { status: 307, headers: { "Cache-Control": CACHE_COURT } });
    }
    if (!img.image_data) {
      return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
    }
    const etag = `"${cle}-${version}"`;
    const entetes = { ETag: etag, "Cache-Control": brut !== null ? CACHE_VERSIONNE : CACHE_COURT, ...SECURITE };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: entetes });
    }
    return new NextResponse(new Uint8Array(img.image_data), {
      headers: { ...entetes, "Content-Type": img.content_type, "Content-Length": String(img.image_data.length) },
    });
  } catch (e) {
    console.error("[api/plat-image/[cle] GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
