import { NextRequest, NextResponse } from "next/server";
import { addImage } from "@/lib/db";

export const runtime = "nodejs";

const VALID_TYPES: Record<string, { type: string; ext: string }> = {
  "image/jpeg": { type: "image/jpeg", ext: "jpg" },
  "image/jpg": { type: "image/jpeg", ext: "jpg" },
  "image/png": { type: "image/png", ext: "png" },
  "image/webp": { type: "image/webp", ext: "webp" },
  "image/gif": { type: "image/gif", ext: "gif" },
};
const MAX_SIZE = 3 * 1024 * 1024; // 3 MB (le client recompresse avant)

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const ipRequests = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequests.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRequests.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

/** Envoi d'une image (multipart, champ `file`) → `{ url: "/api/images/<id>.<ext>" }`. */
export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: "Trop d'envois, réessayez dans une minute" }, { status: 429 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
    }
    const format = VALID_TYPES[file.type];
    if (!format) {
      return NextResponse.json({ error: "Format non supporté (JPG, PNG, WEBP, GIF)" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Fichier trop lourd (max 3 Mo)" }, { status: 400 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const id = await addImage(format.type, base64);
    // L'extension dans l'URL permet au pipeline Python de la reconnaître comme image directe.
    return NextResponse.json({ ok: true, url: `/api/images/${id}.${format.ext}` }, { status: 201 });
  } catch (e) {
    console.error("[api/images POST]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
