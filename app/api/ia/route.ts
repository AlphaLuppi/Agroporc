import { NextRequest, NextResponse } from "next/server";
import { getAllIaProfiles, getIaProfile, upsertIaProfile, type IaProfile } from "@/lib/db";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;
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
    const profiles = await getAllIaProfiles();
    return NextResponse.json({ profiles });
  } catch (e) {
    console.error("[api/ia GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: "Trop de modifications, réessayez dans une minute" }, { status: 429 });
    }

    const body = await request.json();
    if (body.website) return NextResponse.json({ ok: true });

    const { nom, updated_by, profile } = body as {
      nom?: string;
      updated_by?: string;
      profile?: Partial<IaProfile>;
    };

    if (!nom || typeof nom !== "string") {
      return NextResponse.json({ error: "nom manquant" }, { status: 400 });
    }
    if (!profile || typeof profile !== "object") {
      return NextResponse.json({ error: "profil manquant" }, { status: 400 });
    }

    const existing = await getIaProfile(nom);
    if (!existing) {
      return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
    }

    const toStrArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 50) : [];

    const merged: IaProfile = {
      nom,
      prenom: String(profile.prenom ?? existing.prenom).slice(0, 80),
      emoji: String(profile.emoji ?? existing.emoji).slice(0, 8),
      couleur: String(profile.couleur ?? existing.couleur).slice(0, 20),
      role: String(profile.role ?? existing.role).slice(0, 200),
      personnalite: String(profile.personnalite ?? existing.personnalite).slice(0, 1000),
      style_de_parole: String(profile.style_de_parole ?? existing.style_de_parole).slice(0, 500),
      traits: profile.traits !== undefined ? toStrArr(profile.traits) : existing.traits,
      sujets_fetiches:
        profile.sujets_fetiches !== undefined ? toStrArr(profile.sujets_fetiches) : existing.sujets_fetiches,
      blagues_recurrentes:
        profile.blagues_recurrentes !== undefined
          ? toStrArr(profile.blagues_recurrentes)
          : existing.blagues_recurrentes,
      gifs_fetiches:
        profile.gifs_fetiches !== undefined ? toStrArr(profile.gifs_fetiches) : existing.gifs_fetiches ?? [],
      avatar_url:
        profile.avatar_url !== undefined
          ? String(profile.avatar_url).trim().slice(0, 500) || undefined
          : existing.avatar_url,
      actif: typeof profile.actif === "boolean" ? profile.actif : existing.actif,
    };

    await upsertIaProfile(merged, updated_by?.slice(0, 50));
    return NextResponse.json({ ok: true, profile: merged });
  } catch (e) {
    console.error("[api/ia PUT]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
