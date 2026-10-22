/**
 * Répliques des personnages pris au lasso (pur, testé). Pendant qu'il pend au bout de la corde, le
 * personnage enchaîne les répliques (une nouvelle toutes les INTERVALLE_REPLIQUE_S, jamais deux fois
 * la même d'affilée) ; relâché, il en lâche une dernière en repartant.
 *
 * Inspirations : le mème marseillais « tié un tigre » (TikTok), les phrases restées célèbres
 * d'Emmanuel Macron (« qu'ils viennent me chercher », « je traverse la rue », « poudre de
 * perlimpinpin », « Gaulois réfractaires », « pognon de dingue »…) et les classiques du gars qui se
 * fait embarquer (« j'ai rien fait », « je veux mon avocat », « vous savez pas qui je suis »).
 */

export const INTERVALLE_REPLIQUE_S = 2.6;

export interface Repliques {
  /** Pendu au bout de la corde. */
  pris: readonly string[];
  /** Retombé et relâché, il repart. */
  libre: readonly string[];
}

export const REPLIQUES_TIGRE: Repliques = {
  pris: [
    "Tu fais quoi, cowboy ?!",
    "Repose-moi, cowboy !",
    "J'ai le seum !",
    "C'est toi tié le tigre…",
    "Tié un tigre du Bengale, toi !",
    "J'ai rien fait, m'sieur !",
    "Je veux voir mon avocat !",
    "Vous savez pas qui je suis ?!",
    "C'est un contrôle de routine ?",
    "Pas les moustaches !",
    "Grrr… c'est abusé !",
  ],
  libre: ["Le seum…", "Même pas mal.", "Je reviendrai… avec mon avocat.", "Tié pas un tigre, toi.", "Je me casse !"],
};

export const REPLIQUES_MACRON: Repliques = {
  pris: [
    "Fallait pas venir me chercher !",
    "Lâchez-moi, je traverse la rue !",
    "Poudre de perlimpinpin !",
    "C'est croquignolesque !",
    "Ça coûte un pognon de dingue, ce lasso !",
    "Gaulois réfractaire, va !",
    "C'est pas notre projeeet !",
    "En même temps… lâchez-moi !",
    "Vous savez pas qui je suis ?!",
    "Je veux voir mon avocat !",
  ],
  libre: ["En marche !", "Je traverse la rue !", "Même pas mal, en même temps.", "On s'en souviendra !"],
};

/** Une réplique de la liste, tirée avec `alea` ∈ [0, 1[, jamais `precedente` (s'il y a le choix). */
export function tirerReplique(liste: readonly string[], alea: number, precedente: string | null = null): string {
  const choix = liste.length > 1 && precedente !== null ? liste.filter((r) => r !== precedente) : liste;
  return choix[Math.min(choix.length - 1, Math.floor(Math.max(0, alea) * choix.length))];
}
