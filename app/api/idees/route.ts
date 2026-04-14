import { NextRequest, NextResponse } from "next/server";
import { getAllIdees, addIdee } from "@/lib/db";

export const runtime = "nodejs";

// Rate limiting
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 3;
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

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequests) {
    if (now > entry.resetAt) ipRequests.delete(ip);
  }
}, 60 * 1000);

export async function GET() {
  try {
    const idees = await getAllIdees();
    return NextResponse.json(idees);
  } catch (e) {
    console.error("[api/idees] GET error:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Trop de requêtes, réessayez dans une minute" },
        { status: 429 }
      );
    }

    const body = await request.json();

    // Honeypot
    if (body.website) {
      return NextResponse.json({ ok: true });
    }

    const { auteur, texte } = body;

    if (!auteur || !texte) {
      return NextResponse.json(
        { error: "Champs requis : auteur, texte" },
        { status: 400 }
      );
    }

    if (typeof auteur !== "string" || auteur.trim().length === 0 || auteur.length > 50) {
      return NextResponse.json({ error: "Nom invalide" }, { status: 400 });
    }

    if (typeof texte !== "string" || texte.trim().length === 0 || texte.length > 500) {
      return NextResponse.json(
        { error: "Texte invalide (max 500 caractères)" },
        { status: 400 }
      );
    }

    const idee = await addIdee(auteur.trim(), texte.trim());
    return NextResponse.json(idee);
  } catch (e) {
    console.error("[api/idees] POST error:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
