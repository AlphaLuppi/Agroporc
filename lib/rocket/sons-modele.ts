/**
 * Rocket Muche, sons : les décisions pures (quelles voitures ont un moteur, à quelle hauteur, quel volume, quel panoramique, quel gain pour
 * un choc) séparées de la synthèse WebAudio de `sons.ts`. Sans DOM, sans horloge, sans hasard global : testable sous Node.
 */
import { VOITURE, type EtatVoiture, type EvenementMatch, type MondeRocket } from "./contrat";
import { clamp, lerp } from "./vec";

/**
 * Moteur : un grondement grave, de 46 Hz à l'arrêt à 132 Hz à pleine vitesse (23 m/s), plus 8 % sous boost. (Il montait à 260 Hz en
 * dents de scie avec une quinte désaccordée : un bourdon aigu qui fatiguait l'oreille.)
 */
export const MOTEUR = { fMin: 46, fMax: 132, bonusBoost: 0.08, voixMax: 3, gainMoi: 0.085, gainAutre: 0.05, rayonAudible: 90 } as const;

/**
 * Saut et double saut : le MÊME son (un souffle bref et un coup sourd). Le double saut ne monte pas en hauteur : deux sons de plus
 * en plus aigus à chaque saut tapaient sur les nerfs.
 */
export const SON_SAUT = { graveDe: 118, graveA: 62, dureeS: 0.1, souffleDe: 1100, souffleA: 380, gain: 0.16 } as const;
/** Flip : un « whoosh » de bruit filtré qui monte puis retombe, sans note. */
export const SON_FLIP = { dureeS: 0.3, de: 420, sommet: 1500, a: 520, gain: 0.13 } as const;

export function frequenceMoteur(vitesse: number, boost: boolean): number {
  const k = clamp(Math.abs(vitesse) / VOITURE.vitesseMax, 0, 1);
  return lerp(MOTEUR.fMin, MOTEUR.fMax, k) * (boost ? 1 + MOTEUR.bonusBoost : 1);
}
/** Fréquence de coupure du filtre du moteur (le son s'ouvre avec la vitesse). */
export const coupureMoteur = (vitesse: number): number => 190 + 760 * clamp(Math.abs(vitesse) / VOITURE.vitesseMax, 0, 1);

/** Volume du moteur d'une voiture à `distance` m de l'auditeur (1/distance, borné) ; la voiture du joueur est toujours audible. */
export function gainMoteur(distance: number, estMoi: boolean, boost: boolean, vitesse: number): number {
  const k = 0.35 + 0.65 * clamp(Math.abs(vitesse) / VOITURE.vitesseMax, 0, 1);
  if (estMoi) return MOTEUR.gainMoi * k * (boost ? 1.25 : 1);
  if (distance > MOTEUR.rayonAudible) return 0;
  return (MOTEUR.gainAutre * k * (boost ? 1.2 : 1) * 8) / (8 + distance);
}
/** Gain du souffle du boost (bruit filtré). */
export const gainSouffleBoost = (distance: number, estMoi: boolean): number => (estMoi ? 0.085 : (0.05 * 8) / (8 + distance));

/** Panoramique ∈ [-1, 1] de `autre` vu depuis `moi` : projection de l'écart sur l'axe droite de `moi` (droite = positif). */
export function panoramique(moi: Readonly<EtatVoiture>, autre: Readonly<EtatVoiture>): number {
  const dx = autre.p[0] - moi.p[0], dy = autre.p[1] - moi.p[1], dz = autre.p[2] - moi.p[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return 0;
  const lateral = dx * moi.base.droite[0] + dy * moi.base.droite[1] + dz * moi.base.droite[2];
  return clamp((lateral / (d + 4)) * 1.1, -1, 1);
}
export const distanceVoitures = (a: Readonly<EtatVoiture>, b: Readonly<EtatVoiture>): number => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);

/** Les voitures qui ont un moteur : la sienne d'abord, puis les plus proches (non démolies), `MOTEUR.voixMax` au plus. */
export function choisirMoteurs(m: Readonly<MondeRocket>, idMoi: number, max: number = MOTEUR.voixMax): number[] {
  const moi = m.voitures[idMoi];
  const ids: number[] = [];
  if (moi && !moi.demolie) ids.push(idMoi);
  const autres = m.voitures
    .filter((v) => v.id !== idMoi && !v.demolie)
    .map((v) => ({ id: v.id, d: moi ? distanceVoitures(moi, v) : 0 }))
    .filter((x) => x.d <= MOTEUR.rayonAudible)
    .sort((a, b) => a.d - b.d || a.id - b.id);
  for (const a of autres) { if (ids.length >= max) break; ids.push(a.id); }
  return ids;
}

/** Gain d'un choc de balle / de décor selon la force (m/s relatifs) : 0 sous 1 m/s, ~1 vers 40 m/s. */
export const gainChoc = (force: number): number => clamp(Math.sqrt(Math.max(0, force) / 40), 0, 1);
/** Hauteur du « clac » grave d'une touche de balle : plus la frappe est forte, plus il est grave et long. */
export const frequenceGraveChoc = (force: number): number => lerp(170, 70, clamp(force / 46, 0, 1));
export const dureeGraveChoc = (force: number): number => lerp(0.08, 0.26, clamp(force / 46, 0, 1));
/** Volume relatif d'un événement : plein pour la voiture du joueur, atténué pour les autres. */
export const echelleEvenement = (idVoiture: number, idMoi: number): number => (idVoiture === idMoi ? 1 : 0.3);
/** Identifiant de la voiture concernée par un événement, ou null s'il est global. */
export function voitureDe(e: Readonly<EvenementMatch>): number | null {
  switch (e.t) {
    case "toucheBalle": case "saut": case "doubleSaut": case "flip": case "atterrissage": case "choc": case "boost": case "supersonique":
    case "arret": case "klaxon": case "reapparition": case "plot": case "bump":
      return e.idVoiture;
    case "demolition":
      return e.auteur;
    default:
      return null;
  }
}

/** Temps (s) des éclats du feu d'artifice après un but : déterministes (suite quasi-périodique), `n` éclats répartis sur 2,4 s. */
export function tempsFeuArtifice(n: number): number[] {
  const res: number[] = [];
  for (let i = 0; i < n; i++) res.push(0.3 + ((i * 0.6180339887) % 1) * 2.1);
  return res.sort((a, b) => a - b);
}

/** Notes des sons de jeu (Hz). */
export const NOTES = { decompte: 440, depart: 880, klaxonA: 311, klaxonB: 392, buteA: 233, buteB: 311, sifflet: 2700, prolongationA: 523, prolongationB: 659 } as const;

/** « Bloop » d'une réaction rapide : deux notes montantes brèves (Hz), plus discrètes pour la sienne (gain relatif à `gainReaction`). */
export const SON_REACTION = { noteA: 523, noteB: 784, dureeS: 0.09, ecartS: 0.07 } as const;
export const gainReaction = (moi: boolean): number => (moi ? 0.06 : 0.11);
