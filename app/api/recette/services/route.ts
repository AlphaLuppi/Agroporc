import { NextRequest, NextResponse } from "next/server";
import { ajouterServicesRecettes } from "@/lib/db";
import { CLE_IMAGE_RE } from "@/lib/plat-image";
import { dateServie, MAX_SERVICES, validerServices } from "@/lib/recettes";

export const runtime = "nodejs";

/**
 * POST (Bearer API_SECRET_TOKEN) : dates de service des plats déjà pourvus d'une recette
 * (le pipeline ne les régénère pas, mais l'historique de la banque doit suivre).
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const services = validerServices(body, CLE_IMAGE_RE);
  if (!services) {
    return NextResponse.json({ error: `Paramètre 'services' invalide (1 à ${MAX_SERVICES} couples { cle, date })` }, { status: 400 });
  }
  try {
    // Les jours à venir (PDJ publiés d'avance) ne sont pas encore servis : ignorés.
    const ajoutes = await ajouterServicesRecettes(services.filter((s) => dateServie(s.date)));
    return NextResponse.json({ ok: true, ajoutes });
  } catch (e) {
    console.error("[api/recette/services POST]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
