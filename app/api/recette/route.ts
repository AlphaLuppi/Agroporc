import { NextRequest, NextResponse } from "next/server";
import { getPdjDepuis, rafraichirNotesRecettes, rattraperNotesRecettes, recettesExistantes, upsertRecette } from "@/lib/db";
import { CLE_IMAGE_RE } from "@/lib/plat-image";
import { clePlatImage } from "@/lib/plat-image-cle";
import { dateServie, dateValide, TAILLE_MAX_RECETTE, texteRecherche, validerRecette } from "@/lib/recettes";

export const runtime = "nodejs";

const MAX_CLES = 200;
const SANS_CACHE = { "Cache-Control": "no-store" };

/** GET ?cles=a,b,c (public) → { existantes: [...] } : le pipeline saute les recettes déjà rédigées. */
export async function GET(request: NextRequest) {
  const brut = request.nextUrl.searchParams.get("cles") ?? "";
  const cles = [...new Set(brut.split(",").map((c) => c.trim()).filter(Boolean))];
  if (cles.length > MAX_CLES || cles.some((c) => !CLE_IMAGE_RE.test(c))) {
    return NextResponse.json(
      { error: `Paramètre 'cles' invalide (au plus ${MAX_CLES} clés hexadécimales de 24 caractères)` },
      { status: 400, headers: SANS_CACHE },
    );
  }
  try {
    const existantes = await recettesExistantes(cles);
    return NextResponse.json({ existantes: [...existantes] }, { headers: SANS_CACHE });
  } catch (e) {
    console.error("[api/recette GET]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500, headers: SANS_CACHE });
  }
}

interface Corps {
  cle?: unknown;
  restaurant?: unknown;
  plat?: unknown;
  date?: unknown;
  recette?: unknown;
  modele?: unknown;
  fournisseur?: unknown;
  version_prompt?: unknown;
  force?: unknown;
}

const chaine = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** POST (Bearer API_SECRET_TOKEN) : ingestion d'une recette rédigée par le pipeline. */
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
  const { cle, restaurant, plat, date, recette } = body ?? {};
  if (!chaine(cle) || !chaine(restaurant) || !chaine(plat) || !chaine(date) || typeof recette !== "object" || recette === null || Array.isArray(recette)) {
    return NextResponse.json({ error: "Champs requis : cle, restaurant, plat, date, recette" }, { status: 400 });
  }
  // La clé doit être celle que le front recalculera (même clé que l'image du plat).
  if (!CLE_IMAGE_RE.test(cle) || cle !== clePlatImage(restaurant, plat)) {
    return NextResponse.json({ error: "Clé incohérente avec restaurant + plat" }, { status: 400 });
  }
  if (!dateValide(date)) {
    return NextResponse.json({ error: "Date invalide (YYYY-MM-DD attendu)" }, { status: 400 });
  }
  if (JSON.stringify(recette).length > TAILLE_MAX_RECETTE) {
    return NextResponse.json({ error: "Recette trop volumineuse" }, { status: 413 });
  }
  const v = validerRecette(recette);
  if (!v.ok) {
    return NextResponse.json({ error: "Recette invalide", details: v.erreurs }, { status: 422 });
  }

  const vp = body.version_prompt;
  try {
    const ecrit = await upsertRecette({
      cle,
      restaurant: restaurant.slice(0, 200),
      plat: plat.slice(0, 500),
      titre: v.recette.titre,
      recette: v.recette,
      recherche: texteRecherche(restaurant, plat, v.recette),
      modele: typeof body.modele === "string" ? body.modele.slice(0, 80) : null,
      fournisseur: typeof body.fournisseur === "string" ? body.fournisseur.slice(0, 50) : null,
      // SMALLINT en base.
      version_prompt: typeof vp === "number" && Number.isInteger(vp) && vp >= 1 && vp <= 32767 ? vp : null,
      date,
      servi: dateServie(date),
      force: body.force === true,
    });
    // Notes du plat d'origine (dates ≥ date du plat : les plus anciennes ne peuvent pas gagner),
    // puis rattrapage des recettes jamais traitées. Best-effort : la réponse ne change pas.
    try {
      await rafraichirNotesRecettes(await getPdjDepuis(date), [cle]);
      await rattraperNotesRecettes();
    } catch (e) {
      console.error("[api/recette POST] notes", e);
    }
    return NextResponse.json({ ok: true, cle, ecrit });
  } catch (e) {
    console.error("[api/recette POST]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
