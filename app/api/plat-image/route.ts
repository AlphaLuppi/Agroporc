import { NextRequest, NextResponse } from "next/server";
import { platImagesExistantes, upsertPlatImage } from "@/lib/db";
import { CLE_IMAGE_RE, typeImage } from "@/lib/plat-image";
import { clePlatImage } from "@/lib/plat-image-cle";

export const runtime = "nodejs";

const TAILLE_MAX = 1_500_000;
const TAILLE_MIN = 4 * 1024;
const MAX_CLES = 200;

/** GET ?cles=a,b,c (public) → { existantes: [...] } : le pipeline saute les images déjà faites. */
export async function GET(request: NextRequest) {
  const brut = request.nextUrl.searchParams.get("cles") ?? "";
  const cles = [...new Set(brut.split(",").map((c) => c.trim()).filter(Boolean))];
  if (cles.length > MAX_CLES || cles.some((c) => !CLE_IMAGE_RE.test(c))) {
    return NextResponse.json({ error: `Paramètre 'cles' invalide (au plus ${MAX_CLES} clés hexadécimales de 24 caractères)` }, { status: 400 });
  }
  try {
    const existantes = await platImagesExistantes(cles);
    return NextResponse.json({ existantes: [...existantes.keys()] });
  } catch (e) {
    console.error("[api/plat-image GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

interface Corps {
  cle?: string;
  restaurant?: string;
  plat?: string;
  prompt?: string;
  fournisseur?: string;
  content_type?: string;
  image_base64?: string;
  force?: boolean;
}

/** POST (Bearer API_SECRET_TOKEN) : ingestion d'une image générée par le pipeline. */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: Corps;
  try {
    body = (await request.json()) as Corps;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const { cle, restaurant, plat, image_base64 } = body;
  if (!cle || !restaurant || !plat || !image_base64) {
    return NextResponse.json({ error: "Champs requis : cle, restaurant, plat, image_base64" }, { status: 400 });
  }
  // La clé doit être celle que le front recalculera : sinon l'image serait orpheline.
  if (!CLE_IMAGE_RE.test(cle) || cle !== clePlatImage(restaurant, plat)) {
    return NextResponse.json({ error: "Clé incohérente avec restaurant + plat" }, { status: 400 });
  }
  const data = Buffer.from(image_base64, "base64");
  const type = typeImage(data);
  if (!type) {
    return NextResponse.json({ error: "Image invalide (jpeg, png ou webp attendu)" }, { status: 400 });
  }
  if (data.length < TAILLE_MIN || data.length > TAILLE_MAX) {
    return NextResponse.json({ error: `Taille hors limites (${data.length} octets, max ${TAILLE_MAX})` }, { status: 413 });
  }

  try {
    const ecrit = await upsertPlatImage({
      cle,
      restaurant: restaurant.slice(0, 200),
      plat: plat.slice(0, 500),
      prompt: body.prompt?.slice(0, 2000) ?? null,
      fournisseur: body.fournisseur?.slice(0, 50) ?? null,
      content_type: type,
      data,
      force: body.force === true,
    });
    return NextResponse.json({ ok: true, cle, ecrit });
  } catch (e) {
    console.error("[api/plat-image POST]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
