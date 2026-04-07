import { NextRequest, NextResponse } from "next/server";
import { addCommentaire } from "@/lib/db";

export const runtime = "nodejs";

// --- Rate limiting (in-memory, par IP) ---
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // max 5 commentaires par minute par IP

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

// Nettoyage périodique pour éviter les fuites mémoire
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequests) {
    if (now > entry.resetAt) ipRequests.delete(ip);
  }
}, 60 * 1000);

export async function POST(request: NextRequest) {
  try {
    // Rate limiting par IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Trop de commentaires, réessayez dans une minute" },
        { status: 429 }
      );
    }

    const body = await request.json();

    // Honeypot : si le champ caché "website" est rempli, c'est un bot
    if (body.website) {
      // On renvoie un faux succès pour ne pas alerter le bot
      return NextResponse.json({ ok: true });
    }

    const { date, platIndex, auteur, texte, image_url, reponse_a, reponse_a_index } = body;

    if (!date || platIndex === undefined || !auteur || (!texte && !image_url)) {
      return NextResponse.json(
        { error: "Champs requis : date, platIndex, auteur, texte ou image" },
        { status: 400 }
      );
    }

    if (typeof auteur !== "string" || auteur.trim().length === 0 || auteur.length > 50) {
      return NextResponse.json(
        { error: "Nom invalide" },
        { status: 400 }
      );
    }

    if (texte && (typeof texte !== "string" || texte.length > 500)) {
      return NextResponse.json(
        { error: "Commentaire invalide (max 500 caractères)" },
        { status: 400 }
      );
    }

    // Valider image_url si fourni
    if (image_url) {
      if (typeof image_url !== "string") {
        return NextResponse.json({ error: "URL d'image invalide" }, { status: 400 });
      }
      // Accepter les URLs http(s) et les data URIs (images uploadées en base64)
      const isValidUrl = /^https?:\/\/.+/i.test(image_url);
      const isDataUri = /^data:image\/(gif|png|jpe?g|webp);base64,.+/i.test(image_url);
      if (!isValidUrl && !isDataUri) {
        return NextResponse.json({ error: "URL d'image invalide" }, { status: 400 });
      }
      // Limiter la taille des data URIs (environ 5 Mo en base64)
      if (isDataUri && image_url.length > 7 * 1024 * 1024) {
        return NextResponse.json({ error: "Image trop lourde (max 5 Mo)" }, { status: 400 });
      }
    }

    const commentaire: { auteur: string; texte: string; image_url?: string; reponse_a?: string; reponse_a_index?: number } = {
      auteur: auteur.trim(),
      texte: texte ? texte.trim() : "",
    };
    if (image_url) {
      commentaire.image_url = image_url;
    }
    if (reponse_a && typeof reponse_a === "string" && reponse_a.trim().length > 0) {
      commentaire.reponse_a = reponse_a.trim();
    }
    if (typeof reponse_a_index === "number" && reponse_a_index >= 0) {
      commentaire.reponse_a_index = reponse_a_index;
    }

    const success = await addCommentaire(date, platIndex, commentaire);

    if (!success) {
      return NextResponse.json(
        { error: "Plat ou date introuvable" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/commentaire] Erreur:", e);
    return NextResponse.json(
      { error: "Erreur serveur" },
      { status: 500 }
    );
  }
}
