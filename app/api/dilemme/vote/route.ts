import { traiterVote } from "@/lib/dilemme-serveur";
import { ipDeRequete } from "@/lib/limiteur-debit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTETES = { "Cache-Control": "no-store" };
const TAILLE_MAX = 1024;

const invalide = () => Response.json({ erreur: "Requête invalide." }, { status: 400, headers: ENTETES });

/**
 * Vote `{ votant, choix: "a" | "b", jour?, website? }`, ou annulation `{ votant, annuler: true, jour? }`
 * (1 Ko au plus) ; rend l'état du duel mis à jour.
 */
export async function POST(request: Request) {
  const annonce = Number(request.headers.get("content-length"));
  if (Number.isFinite(annonce) && annonce > TAILLE_MAX) return invalide();

  let corps: unknown;
  try {
    const texte = await request.text();
    if (new TextEncoder().encode(texte).length > TAILLE_MAX) return invalide();
    corps = JSON.parse(texte);
  } catch {
    return invalide();
  }

  const r = await traiterVote(corps, ipDeRequete(request.headers));
  if (!r.ok) {
    return Response.json(
      r.code ? { erreur: r.erreur, code: r.code } : { erreur: r.erreur },
      { status: r.status, headers: ENTETES },
    );
  }
  if ("factice" in r) return Response.json({ ok: true }, { headers: ENTETES });
  return Response.json(r.etat, { headers: ENTETES });
}
