import { NextRequest, NextResponse } from "next/server";
import { ajouterTigreScore, getTopTigreScores } from "@/lib/db";
import { TOP_CLASSEMENT, validerScore } from "@/lib/tigre-scores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- Limite de débit (en mémoire, par IP), comme app/api/commentaire ---
const FENETRE_MS = 60 * 1000;
const MAX_PAR_FENETRE = 3; // 3 enregistrements par minute et par IP

const requetesParIp = new Map<string, { count: number; resetAt: number }>();

function limiteAtteinte(ip: string): boolean {
  const now = Date.now();
  const entree = requetesParIp.get(ip);
  if (!entree || now > entree.resetAt) {
    requetesParIp.set(ip, { count: 1, resetAt: now + FENETRE_MS });
    return false;
  }
  entree.count++;
  return entree.count > MAX_PAR_FENETRE;
}

// Nettoyage périodique pour éviter les fuites mémoire
setInterval(() => {
  const now = Date.now();
  for (const [ip, entree] of requetesParIp) if (now > entree.resetAt) requetesParIp.delete(ip);
}, 60 * 1000);

/** Les 10 meilleurs scores : rang, pseudo, score, tigres, date. */
export async function GET() {
  try {
    return NextResponse.json({ scores: await getTopTigreScores(TOP_CLASSEMENT) });
  } catch (e) {
    console.error("[api/tigre-scores] Lecture :", e);
    return NextResponse.json({ error: "Classement indisponible" }, { status: 503 });
  }
}

/** Enregistre `{ pseudo, score, tigres, website }` et rend le rang obtenu. */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  if (limiteAtteinte(ip)) {
    return NextResponse.json({ error: "Trop d'enregistrements, réessayez dans une minute" }, { status: 429 });
  }

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  // Honeypot : le champ caché « website » rempli trahit un robot. Faux succès, rien n'est enregistré.
  if (corps && typeof corps === "object" && (corps as Record<string, unknown>).website) {
    return NextResponse.json({ ok: true });
  }

  const v = validerScore(corps);
  if (!v.ok) return NextResponse.json({ error: v.erreur }, { status: 400 });

  try {
    const rang = await ajouterTigreScore(v.valeur);
    return NextResponse.json({ ok: true, rang });
  } catch (e) {
    console.error("[api/tigre-scores] Écriture :", e);
    return NextResponse.json({ error: "Classement indisponible" }, { status: 503 });
  }
}
