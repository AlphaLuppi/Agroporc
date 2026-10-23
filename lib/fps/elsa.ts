/**
 * Elsa au Truck Muche (PUR) : à intervalle aléatoire (20-50 s), une offre apparaît (soin complet 40 % ou arme spéciale 60 %) et dure 40 s ;
 * le premier joueur à moins de 2,5 m (horizontal, |dy| < 3) la prend, automatiquement. `alea` et `maintenant` injectés.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.7, §5.4)
 */
import { STATS } from "./armes";
import { ARMES_SPECIALES, type ArmeSpecialeId, type Vec3 } from "./protocole";

export const ELSA = {
  intervalleMinMs: 20_000, intervalleMaxMs: 50_000, dureeOffreMs: 40_000,
  rayonRamassage: 2.5, hauteurRamassageMax: 3, probaSoin: 0.4,
} as const;
/** Intervalle entre deux offres, surchargeable (tests de bout en bout : `PDJ_FPS_ELSA_MIN_MS` / `PDJ_FPS_ELSA_MAX_MS` lus par serveur-fps). */
export interface IntervalleElsa { minMs: number; maxMs: number }
export interface Offre { id: number; genre: "soin" | "arme"; arme?: ArmeSpecialeId; finT: number }
export interface EtatElsa { x: number; z: number; prochaineT: number; offre: Offre | null; compteur: number }
export type EvenementElsa = { type: "apparue"; offre: Offre } | { type: "expiree"; offre: Offre } | null;

const INTERVALLE_DEFAUT: IntervalleElsa = { minMs: ELSA.intervalleMinMs, maxMs: ELSA.intervalleMaxMs };

/** Délai (ms) avant la prochaine offre : uniforme sur [minMs ; maxMs]. */
export function intervalleAleatoire(alea: () => number, intervalle: IntervalleElsa = INTERVALLE_DEFAUT): number {
  return intervalle.minMs + alea() * (intervalle.maxMs - intervalle.minMs);
}
export function creerElsa(x: number, z: number, maintenant: number, alea: () => number, intervalle?: IntervalleElsa): EtatElsa {
  return { x, z, prochaineT: maintenant + intervalleAleatoire(alea, intervalle), offre: null, compteur: 0 };
}
/** `actif` = phase "jeu" et ≥ 1 joueur en arène. Inactif : jamais d'apparition, l'échéance est repoussée. */
export function avancerElsa(e: EtatElsa, maintenant: number, alea: () => number, actif: boolean, intervalle?: IntervalleElsa): EvenementElsa {
  if (e.offre) {
    if (maintenant < e.offre.finT) return null;
    const offre = e.offre;
    e.offre = null;
    e.prochaineT = maintenant + intervalleAleatoire(alea, intervalle);
    return { type: "expiree", offre };
  }
  if (maintenant < e.prochaineT) return null;
  if (!actif) {
    // Échéance atteinte hors jeu : repoussée d'un intervalle entier, jamais d'offre qui attendrait les joueurs.
    e.prochaineT = maintenant + intervalleAleatoire(alea, intervalle);
    return null;
  }
  const genre = alea() < ELSA.probaSoin ? "soin" : "arme";
  const offre: Offre = { id: ++e.compteur, genre, finT: maintenant + ELSA.dureeOffreMs };
  if (genre === "arme") offre.arme = ARMES_SPECIALES[Math.min(ARMES_SPECIALES.length - 1, Math.floor(alea() * ARMES_SPECIALES.length))];
  e.offre = offre;
  return { type: "apparue", offre };
}
/** Horizontal ≤ rayonRamassage et |dy| < hauteurRamassageMax, offre présente et non expirée. */
export function peutRamasser(e: EtatElsa, p: Vec3, maintenant: number): boolean {
  if (!e.offre || maintenant >= e.offre.finT) return false;
  // Elsa est posée au sol (y = 0) ; p est la position des pieds.
  return Math.hypot(p[0] - e.x, p[2] - e.z) <= ELSA.rayonRamassage && Math.abs(p[1]) < ELSA.hauteurRamassageMax;
}
/** Retire l'offre, ré-arme le minuteur, renvoie l'offre prise (null s'il n'y en avait pas). */
export function prendre(e: EtatElsa, maintenant: number, alea: () => number, intervalle?: IntervalleElsa): Offre | null {
  const offre = e.offre;
  if (!offre) return null;
  e.offre = null;
  e.prochaineT = maintenant + intervalleAleatoire(alea, intervalle);
  return offre;
}
/** Nouveau match : plus d'offre, minuteur ré-armé (le compteur d'identifiants continue, un id n'est jamais réutilisé). */
export function reinitialiserElsa(e: EtatElsa, maintenant: number, alea: () => number, intervalle?: IntervalleElsa): void {
  e.offre = null;
  e.prochaineT = maintenant + intervalleAleatoire(alea, intervalle);
}
/** Munitions offertes avec une arme spéciale (= STATS[arme].chargeur). */
export function munitionsOffertes(arme: ArmeSpecialeId): number {
  return STATS[arme].chargeur;
}
