import { NextRequest, NextResponse } from "next/server";
import { ajouterServicesRecettes, getPdjDepuis, rafraichirNotesRecettes, rattraperNotesRecettes } from "@/lib/db";
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
    const servis = services.filter((s) => dateServie(s.date));
    const ajoutes = await ajouterServicesRecettes(servis);
    // Notes de ces services (un jour publié d'avance n'est noté qu'une fois servi : /api/update
    // ne repasse pas forcément ce jour-là), puis rattrapage des recettes jamais traitées
    // (premier run après la migration). Best-effort.
    try {
      if (servis.length) {
        const depuis = servis.reduce((min, s) => (s.date < min ? s.date : min), servis[0].date);
        await rafraichirNotesRecettes(await getPdjDepuis(depuis), servis.map((s) => s.cle));
      }
      await rattraperNotesRecettes();
    } catch (e) {
      console.error("[api/recette/services POST] notes", e);
    }
    return NextResponse.json({ ok: true, ajoutes });
  } catch (e) {
    console.error("[api/recette/services POST]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
