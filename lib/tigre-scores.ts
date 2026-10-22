/**
 * Classement de la chasse au tigre de la vue Palantir (PUR, client et serveur, testé) :
 * validation d'un score envoyé à POST /api/tigre-scores, libellés du classement.
 *
 * Le score est calculé par le navigateur : un appel direct à l'API peut enregistrer un faux score
 * cohérent (100 à 500 points par tigre, multiple de 10). Limite acceptée, le site est privé.
 */

export const PSEUDO_MAX = 20;
export const TIGRES_MAX = 500;
export const POINTS_MIN_PAR_TIGRE = 100;
export const POINTS_MAX_PAR_TIGRE = 500;
/** Nombre de scores affichés dans le classement. */
export const TOP_CLASSEMENT = 10;

/** Clés `localStorage` : dernier pseudo utilisé, panneau du classement ouvert ou fermé. */
export const CLE_PSEUDO = "palantir-pseudo";
export const CLE_CLASSEMENT = "palantir-classement";

export interface ScoreTigre {
  pseudo: string;
  score: number;
  tigres: number;
}

export interface LigneClassement extends ScoreTigre {
  rang: number;
  /** Date d'enregistrement (ISO 8601). */
  date: string;
}

export type ResultatValidation = { ok: true; valeur: ScoreTigre } | { ok: false; erreur: string };

// Caractères de contrôle C0, DEL et C1 : interdits dans un pseudo.
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;

/** Valide le corps d'une requête POST (pseudo, score, tigres). Le pseudo est rendu sans espaces de bord. */
export function validerScore(corps: unknown): ResultatValidation {
  if (!corps || typeof corps !== "object") return { ok: false, erreur: "Requête invalide" };
  const { pseudo, score, tigres } = corps as Record<string, unknown>;
  if (typeof pseudo !== "string") return { ok: false, erreur: "Pseudo manquant" };
  const p = pseudo.trim();
  if (p.length < 1 || [...p].length > PSEUDO_MAX) return { ok: false, erreur: `Pseudo de 1 à ${PSEUDO_MAX} caractères` };
  if (CONTROLE.test(p)) return { ok: false, erreur: "Pseudo invalide" };
  if (typeof tigres !== "number" || !Number.isInteger(tigres) || tigres < 1 || tigres > TIGRES_MAX) {
    return { ok: false, erreur: `Nombre de tigres invalide (1 à ${TIGRES_MAX})` };
  }
  if (typeof score !== "number" || !Number.isInteger(score) || score % 10 !== 0
    || score < POINTS_MIN_PAR_TIGRE * tigres || score > POINTS_MAX_PAR_TIGRE * tigres) {
    return { ok: false, erreur: "Score invalide" };
  }
  return { ok: true, valeur: { pseudo: p, score, tigres } };
}

/** Rang en toutes lettres, au féminin (« place ») : 1re, 2e, 3e… */
export function rangOrdinal(rang: number): string {
  return rang === 1 ? "1re" : `${rang}e`;
}

/** Message affiché après l'enregistrement. */
export function messageEnregistre(rang: number): string {
  return `Score enregistré, ${rangOrdinal(rang)} place`;
}
