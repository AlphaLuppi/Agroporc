import { lireEtatDuel } from "@/lib/dilemme-serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTETES = { "Cache-Control": "no-store" };

/** État d'un duel : `?jour=YYYY-MM-DD` (défaut : aujourd'hui) et `?votant=Nom` (renseigne `monVote`). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const r = await lireEtatDuel(searchParams.get("jour"), searchParams.get("votant"));
  if (r.ok) return Response.json(r.etat, { headers: ENTETES });
  return Response.json(
    r.code ? { erreur: r.erreur, code: r.code } : { erreur: r.erreur },
    { status: r.status, headers: ENTETES },
  );
}
