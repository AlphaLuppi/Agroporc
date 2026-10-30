/**
 * Entrée en arène sur un serveur à parties parallèles : « Entrer » demande d'abord `mode{arene, partie:"auto"}` (le serveur déborde sur une autre arène si le hall
 * est plein) et le jeu ne se monte qu'une fois le serveur ayant placé le client (`confirmationsMode`). L'entrée EN ATTENTE est un état qui doit mourir avec le
 * contexte qui l'a demandée : panneau fermé, plat ouvert, connexion perdue, ou autre choix de partie (« Rejoindre », « Créer une arène », choix du mode).
 * Sinon une confirmation sans rapport (ou tardive) monterait le jeu sans que le joueur l'ait demandé. PUR, testé (`entree-auto.test.ts`).
 */

/** `null` : rien en attente. `depuisPanneau` : demandée panneau ouvert (l'entrée meurt avec lui) ; sinon via le crochet de développement, panneau fermé. */
export type EntreeAuto = { depuisPanneau: boolean } | null;

export interface ContexteEntreeAuto {
  /** le panneau « Arène » est ouvert */
  areneOuverte: boolean;
  /** un autre panneau (plat, restaurant) est ouvert par-dessus la vue */
  autrePanneau: boolean;
  /** la socket est ouverte */
  connecte: boolean;
}

/** « Entrer » vient d'envoyer la demande. */
export const armerEntreeAuto = (areneOuverte: boolean): EntreeAuto => ({ depuisPanneau: areneOuverte });

/** Le contexte a changé : l'entrée en attente survit-elle ? (Une connexion perdue l'abandonne toujours : la demande et sa réponse sont perdues.) */
export function entreeApresContexte(e: EntreeAuto, c: ContexteEntreeAuto): EntreeAuto {
  if (!e) return null;
  if (!c.connecte) return null;
  if (e.depuisPanneau && (!c.areneOuverte || c.autrePanneau)) return null;
  return e;
}

/**
 * Le serveur a confirmé un placement (`confirmationsMode`). Toujours consommée ; le jeu se monte seulement si le client est bien dans une arène, pas déjà en
 * jeu, connecté, et (entrée du panneau) le panneau est encore ouvert.
 */
export function confirmerEntreeAuto(
  e: EntreeAuto,
  c: { enArene: boolean; mode: string; monId: string | null; areneOuverte: boolean },
): { entree: EntreeAuto; monter: boolean } {
  if (!e) return { entree: null, monter: false };
  const monter = !c.enArene && c.mode === "arene" && !!c.monId && (!e.depuisPanneau || c.areneOuverte);
  return { entree: null, monter };
}
