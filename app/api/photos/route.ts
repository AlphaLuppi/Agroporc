import { NextRequest, NextResponse } from "next/server";
import { getAllPhotos, getPhotosBySlug, addPhoto } from "@/lib/db";

export const runtime = "nodejs";

const VALID_SLUGS = new Set(["bistrot_trefle", "pause_gourmande", "truck_muche"]);
const VALID_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};
const MAX_SIZE = 3 * 1024 * 1024; // 3 MB

export async function GET(request: NextRequest) {
  try {
    const slug = request.nextUrl.searchParams.get("slug");
    const photos = slug ? await getPhotosBySlug(slug) : await getAllPhotos();
    return NextResponse.json({ photos });
  } catch (e) {
    console.error("[api/photos GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const slug = formData.get("slug");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
    }
    if (typeof slug !== "string" || !VALID_SLUGS.has(slug)) {
      return NextResponse.json({ error: "Restaurant invalide" }, { status: 400 });
    }

    const contentType = VALID_TYPES[file.type];
    if (!contentType) {
      return NextResponse.json(
        { error: "Format non supporté (JPG, PNG, WEBP, GIF)" },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Fichier trop lourd (max 3 Mo)" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const filename = file.name.slice(0, 255) || `photo_${Date.now()}`;

    const photo = await addPhoto(slug, filename, contentType, base64);
    return NextResponse.json({ ok: true, photo });
  } catch (e) {
    console.error("[api/photos POST]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
