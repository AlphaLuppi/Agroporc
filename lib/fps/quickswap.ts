/**
 * Changement d'arme en deux temps et « swap cancel » façon Call of Duty (PUR, partagé client / serveur, aucun message nouveau :
 * tout se déduit des `main` déjà envoyés, `VERSION_PROTOCOLE` inchangée).
 *
 * - Un changement simple dure toujours `JEU.degainageMs` (350 ms : l'équilibre ne change pas) : l'arme quittée se rengaine pendant
 *   `CHANGEMENT_ARME.rengaineMs`, puis la nouvelle se dégaine pendant le reste.
 * - Revenir à l'arme qu'on vient de quitter AVANT la fin du changement (Q, 1/2/3, molette) l'annule : l'arme d'origine remonte depuis la
 *   hauteur où se trouve l'arme visible et est prête en `delaiAnnulation(abaissement)` (50 à 120 ms) au lieu d'un nouveau dégainage complet.
 *   Jamais plus tôt que l'instant où elle aurait été prête sans ce changement (`pretDepuis` : un aller-retour ne saute pas un dégainage en cours),
 *   et seulement si aucune autre sortie (apparition, achat, spéciale épuisée) n'a eu lieu entre-temps (`pretActuel === fin`).
 * - Le serveur applique la même règle avec une marge (`margeServeurMs`) : l'écart entre deux `main` y arrive déformé par la gigue du réseau.
 * - (client seulement) Reload cancel : quitter une arme après le point où le chargeur est inséré (`seuilChargeurInsere` du rechargement)
 *   garde le rechargement acquis ; avant, il est perdu. Le serveur ne compte pas les chargeurs (seulement les spéciales, sans recharge) :
 *   rien à juger de son côté.
 * Les instants sont en millisecondes.
 */
import { JEU, type ArmeId, type Slot } from "./protocole";

export const CHANGEMENT_ARME = {
  /** rengainer l'arme quittée (le dégainage de la nouvelle prend le reste de `JEU.degainageMs`) */
  rengaineMs: 140,
  /** arme d'origine prête après une annulation : de `annulationMinMs` (encore en main) à `annulationMaxMs` (tout en bas) */
  annulationMinMs: 50,
  annulationMaxMs: 120,
  /**
   * (serveur) une annulation reste reconnue jusqu'à `fin + margeServeurMs` (gigue entre les deux `main` : 4G, wifi chargé). Sans risque de
   * triche : un tir ou un coup accepté avec la nouvelle arme efface le changement (`Salle`), on ne peut donc pas s'en servir puis revenir.
   */
  margeServeurMs: 120,
  /** (client) part du rechargement à partir de laquelle le chargeur est inséré : quitter l'arme ensuite garde le rechargement */
  seuilChargeurInsere: 0.75,
} as const;

/** Durée du dégainage de la nouvelle arme (après le rengainage). */
export const DEGAINE_MS = JEU.degainageMs - CHANGEMENT_ARME.rengaineMs;

/** Changement d'arme en cours, mémorisé pour reconnaître l'aller-retour. */
export interface EtatChangement {
  depuis: Slot;
  armeDepuis: ArmeId;
  debut: number;
  /** fin nominale (nouvelle arme prête) */
  fin: number;
  /** instant où l'arme quittée aurait été prête (dégainage en cours quand on l'a quittée) */
  pretDepuis: number;
}

export interface DemandeChangement {
  depuis: Slot;
  armeDepuis: ArmeId;
  vers: Slot;
  armeVers: ArmeId;
  t: number;
  /** instant où l'arme actuellement en main est (ou sera) prête : `sortieFin` du client, `sortieJusqua` du serveur */
  pretActuel: number;
  /** tolérance après la fin nominale (serveur : `CHANGEMENT_ARME.margeServeurMs`) ; 0 par défaut */
  margeMs?: number;
}

export interface ResultatChangement {
  /** vrai = swap cancel (retour à l'arme qu'on venait de quitter) */
  annule: boolean;
  /** instant où l'arme demandée est prête */
  pret: number;
  /** abaissement (0..1) de l'arme visible au moment de la demande : départ de la remontée d'une annulation (0 sinon) */
  depart: number;
  /** changement à mémoriser (null après une annulation : pas d'annulation en chaîne) */
  changement: EtatChangement | null;
}

/** Abaissement (0 = en joue, 1 = hors champ) de l'arme VISIBLE pendant un changement : la quittée descend, puis la nouvelle monte. */
export function abaissementChangement(ch: EtatChangement, t: number): number {
  const u = t - ch.debut;
  if (u <= 0) return 0;
  const r = CHANGEMENT_ARME.rengaineMs;
  if (u < r) return u / r;
  const d = Math.max(1, ch.fin - ch.debut - r);
  return Math.max(0, 1 - (u - r) / d);
}

/** Délai d'une annulation, proportionnel à l'abaissement de l'arme visible (plus elle est basse, plus la remontée est longue). */
export function delaiAnnulation(abaissement: number): number {
  const a = Math.min(1, Math.max(0, abaissement));
  return CHANGEMENT_ARME.annulationMinMs + (CHANGEMENT_ARME.annulationMaxMs - CHANGEMENT_ARME.annulationMinMs) * a;
}

/** La demande est un retour à l'arme qu'on vient de quitter, pendant le changement (swap cancel). */
export function estAnnulation(ch: EtatChangement | null, d: DemandeChangement): ch is EtatChangement {
  if (!ch) return false;
  return d.vers === ch.depuis && d.armeVers === ch.armeDepuis && d.pretActuel === ch.fin
    && d.t >= ch.debut && d.t < ch.fin + (d.margeMs ?? 0);
}

/** Règle commune du changement d'arme (client et serveur). */
export function changerArme(ch: EtatChangement | null, d: DemandeChangement): ResultatChangement {
  if (estAnnulation(ch, d)) {
    const depart = abaissementChangement(ch, d.t);
    return { annule: true, pret: Math.max(ch.pretDepuis, d.t + delaiAnnulation(depart)), depart, changement: null };
  }
  const fin = d.t + JEU.degainageMs;
  return {
    annule: false, pret: fin, depart: 0,
    changement: { depuis: d.depuis, armeDepuis: d.armeDepuis, debut: d.t, fin, pretDepuis: d.pretActuel },
  };
}

/** Le rechargement en est au point où le chargeur est inséré (quitter l'arme le garde). */
export function chargeurInsere(progression: number): boolean {
  return progression >= CHANGEMENT_ARME.seuilChargeurInsere;
}

/**
 * Animation de l'arme en main (client) : `changement` (la quittée descend depuis `depart` puis la nouvelle monte), `retour` (annulation :
 * l'arme d'origine remonte depuis `depart`), `sortie` (dégainage seul : apparition d'une arme sans rengainage, spéciale épuisée, changement
 * imposé). `depart` d'un changement = abaissement de l'arme visible à la demande (changements enchaînés : elle ne remonte pas d'un coup).
 */
export type AnimSortie =
  | { genre: "changement"; debut: number; fin: number; armeQuittee: ArmeId; depart?: number }
  /** `depart` : abaissement visible (lissé, celui de `poseSortie`) au moment de l'annulation */
  | { genre: "retour"; debut: number; fin: number; depart: number }
  | { genre: "sortie"; debut: number; fin: number };

const lisse = (x: number) => x * x * (3 - 2 * x);

/** Pose de l'arme : `quittee` = c'est encore l'arme quittée qui est visible ; `abaissement` lissé (0..1), sauf le `depart` déjà lissé. */
export function poseSortie(anim: AnimSortie | null, t: number): { quittee: boolean; abaissement: number } {
  if (!anim || t >= anim.fin) return { quittee: false, abaissement: 0 };
  const u = Math.max(0, t - anim.debut);
  const duree = Math.max(1, anim.fin - anim.debut);
  if (anim.genre === "changement") {
    const r = CHANGEMENT_ARME.rengaineMs;
    // la quittée descend de là où elle est (`depart`, en abaissement lissé) jusqu'en bas
    const d = Math.min(1, Math.max(0, anim.depart ?? 0));
    if (u < r) return { quittee: true, abaissement: d + (1 - d) * lisse(u / r) };
    return { quittee: false, abaissement: lisse(Math.max(0, 1 - (u - r) / Math.max(1, duree - r))) };
  }
  // retour : remonte depuis l'abaissement VISIBLE à l'annulation (`depart`, déjà lissé) ; sortie : depuis tout en bas
  const depart = anim.genre === "retour" ? Math.min(1, Math.max(0, anim.depart)) : 1;
  return { quittee: false, abaissement: depart * lisse(Math.max(0, 1 - u / duree)) };
}
