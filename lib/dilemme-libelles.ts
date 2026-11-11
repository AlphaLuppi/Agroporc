/** Libellés français du dilemme du jour et de l'historique des plats. Pur, testé. */
import { resumerVotes, type StatPlat } from "./dilemme";
import type { DuelAvecVoix } from "./db";
import { formatDateCourte } from "./format";

/** « 0 voix », « 1 voix », « 5 voix » (voix reste invariable). */
export function libelleVoix(n: number): string {
  return `${n} voix`;
}

/** « Personne n'a voté pour l'instant. », « 1 personne a voté. », « 4 personnes ont voté. » */
export function libelleTotalVotants(n: number): string {
  if (n <= 0) return "Personne n'a voté pour l'instant.";
  return n === 1 ? "1 personne a voté." : `${n} personnes ont voté.`;
}

/**
 * « Servi 3 fois · dernier le jeu. 5 nov. » ; une seule fois : « Servi le jeu. 5 nov. » ;
 * `avecPremiere` (historique) : « Servi 3 fois · du mar. 6 oct. au jeu. 5 nov. ».
 * null quand le catalogue ne connaît pas le plat (0 service).
 */
export function libelleService(
  nbServices: number, premiere: string | null, derniere: string | null, avecPremiere = false,
): string | null {
  if (nbServices <= 0 || !derniere) return null;
  if (nbServices === 1) return `Servi le ${formatDateCourte(derniere)}`;
  if (avecPremiere && premiere && premiere !== derniere) {
    return `Servi ${nbServices} fois · du ${formatDateCourte(premiere)} au ${formatDateCourte(derniere)}`;
  }
  return `Servi ${nbServices} fois · dernier le ${formatDateCourte(derniere)}`;
}

export const libelleVictoires = (n: number): string => `${n} victoire${n > 1 ? "s" : ""}`;

/** « 12 plats », « 1 plat », « Aucun plat ». */
export function libelleNombrePlats(n: number): string {
  return n <= 0 ? "Aucun plat" : `${n} plat${n > 1 ? "s" : ""}`;
}

/** Une ligne de « Duels précédents » : le texte du score et la mention du résultat. */
export function resumeDuelPasse(d: Pick<DuelAvecVoix, "a_plat" | "b_plat" | "voix_a" | "voix_b">): {
  texte: string; mention: string;
} {
  const r = resumerVotes(d.voix_a, d.voix_b);
  if (r.total === 0) return { texte: `${d.a_plat} contre ${d.b_plat}`, mention: "Personne n'a voté" };
  const texte = `${d.a_plat} ${r.pctA} % contre ${d.b_plat} ${r.pctB} %`;
  if (r.gagnant === "egalite") return { texte, mention: "Égalité" };
  return { texte, mention: `Vainqueur : ${r.gagnant === "a" ? d.a_plat : d.b_plat}` };
}

/** Part des voix reçues (pas le score lissé) sur tous les duels clos du plat, en %. */
export function partDeVoix(s: Pick<StatPlat, "pour" | "contre">): number {
  const total = s.pour + s.contre;
  return total > 0 ? Math.round((100 * s.pour) / total) : 0;
}

/** « 75 % des voix · 2 victoires · 3 duels » */
export function detailClassement(s: StatPlat): string {
  return `${partDeVoix(s)} % des voix · ${libelleVictoires(s.victoires)} · ${s.duels} duel${s.duels > 1 ? "s" : ""}`;
}
