/**
 * Traçantes visibles (PUR) : un segment lumineux qui VOYAGE de la bouche du canon vers l'impact à vitesse visuelle (le tir reste
 * hitscan : les dégâts sont instantanés), en ruban orienté caméra d'au moins 3 px d'épaisseur écran, durée de vie ≥ 0,25 s,
 * traînée persistante pour le sniper (1,0 s) et le railgun (1,5 s). Les impacts sont déclenchés à l'arrivée visuelle de la tête.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.9, §5.14)
 *
 * Les fonctions ne dépendent ni de three ni du temps global : `rendu.ts` (`Effets.traçante`) les appelle à chaque image avec l'âge de la traçante.
 * Valeurs de `TRACEURS` : réglables en jeu sans toucher aux invariants des tests (vie ≥ 0,25 s, ruban ≥ 3 px, persistance du sniper et du railgun).
 */
import type { ArmeFeuId, Vec3 } from "./protocole";

export interface ParamsTraceur {
  /** vitesse visuelle (m/s) */
  vitesse: number;
  /** longueur du ruban (m) */
  longueur: number;
  epaisseurPx: number;
  /** durée de vie minimale (s) */
  vieMinS: number;
  /** traînée persistante après l'arrivée (s), 0 = aucune */
  persistanceS: number;
  couleur: string;
}

/** Une entrée par arme à feu : `Record` exhaustif, une arme oubliée casse la compilation (voulu). */
export const TRACEURS: Record<ArmeFeuId, ParamsTraceur> = {
  pistolet: { vitesse: 200, longueur: 6, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ffe08a" },
  mitraillette: { vitesse: 220, longueur: 6, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ffd166" },
  pompe: { vitesse: 160, longueur: 6, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ffb86b" },
  sniper: { vitesse: 420, longueur: 25, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 1.0, couleur: "#9be9ff" },
  fusil_assaut: { vitesse: 260, longueur: 7, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ffd166" },
  mitrailleuse: { vitesse: 230, longueur: 7, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ffc14d" },
  revolver: { vitesse: 240, longueur: 7, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ffe08a" },
  mini_uzi: { vitesse: 210, longueur: 5, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ffe08a" },
  railgun: { vitesse: 600, longueur: 25, epaisseurPx: 4, vieMinS: 0.25, persistanceS: 1.5, couleur: "#7fb2ff" },
  minigun: { vitesse: 240, longueur: 8, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ff9b6b" },
  magnum_dore: { vitesse: 280, longueur: 8, epaisseurPx: 3, vieMinS: 0.25, persistanceS: 0, couleur: "#ffd700" },
};

export interface EtatTraceur {
  /** pointe lumineuse (la plus proche de l'impact) */
  tete: Vec3;
  /** extrémité arrière du ruban */
  queue: Vec3;
  /** opacité 0..1 : pleine en vol, puis décroissante jusqu'à la fin de vie */
  alpha: number;
  /** la tête a atteint l'impact (déclenche étincelles, anneau et poussière) */
  arrive: boolean;
  /** vie écoulée : à retirer */
  fini: boolean;
}

/** Délai (s) pendant lequel une traînée persistante s'étire de la queue du ruban jusqu'au point de départ après l'arrivée de la tête. */
export const ETIREMENT_TRAINEE_S = 0.15;
/** Marge (s) ajoutée au temps de vol avant la fin de vie d'une traçante ordinaire. */
export const MARGE_VIE_S = 0.12;
/** Demi-largeur monde minimale (m) d'un ruban. */
export const LARGEUR_MIN_M = 0.04;

const distance = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const borne01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Durée de vie (s) : max(vieMinS ; distance / vitesse + 0,12), plus la persistance. */
export function dureeVie(depart: Vec3, fin: Vec3, p: ParamsTraceur): number {
  return Math.max(p.vieMinS, distance(depart, fin) / p.vitesse + MARGE_VIE_S) + p.persistanceS;
}

/** Instant (s) où la tête atteint l'impact (déclenche étincelles, anneau, poussière). */
export function instantImpact(depart: Vec3, fin: Vec3, p: ParamsTraceur): number {
  return distance(depart, fin) / p.vitesse;
}

/**
 * État du ruban à l'âge `ageS` : la tête avance à `vitesse` de `depart` vers `fin` (puis s'arrête sur l'impact), la queue reste à
 * `longueur` derrière (au plus au départ). Après l'arrivée le ruban ne bouge plus et s'estompe jusqu'à la fin de la vie ; une traînée
 * persistante (sniper, railgun) s'étire en plus jusqu'au point de départ en `ETIREMENT_TRAINEE_S`.
 */
export function etatTraceur(depart: Vec3, fin: Vec3, p: ParamsTraceur, ageS: number): EtatTraceur {
  const d = distance(depart, fin);
  const age = Math.max(ageS, 0);
  const vie = dureeVie(depart, fin, p);
  const tImpact = d / p.vitesse;
  const sTete = Math.min(d, age * p.vitesse);
  let sQueue = Math.max(0, sTete - p.longueur);
  if (p.persistanceS > 0 && age > tImpact) sQueue *= 1 - borne01((age - tImpact) / ETIREMENT_TRAINEE_S);
  const k = (s: number): Vec3 => {
    const u = d < 1e-9 ? 0 : s / d;
    return [depart[0] + (fin[0] - depart[0]) * u, depart[1] + (fin[1] - depart[1]) * u, depart[2] + (fin[2] - depart[2]) * u];
  };
  const arrive = age >= tImpact;
  const alpha = arrive ? 1 - borne01((age - tImpact) / Math.max(vie - tImpact, 1e-9)) : 1;
  return { tete: k(sTete), queue: k(sQueue), alpha, arrive, fini: age >= vie };
}

/**
 * Demi-largeur monde (m) pour que le ruban garde `epaisseurPx` à l'écran à cette distance de la caméra : taille d'un pixel à `distanceCamera`
 * = 2 d tan(fov/2) / hauteurPx ; plancher `LARGEUR_MIN_M`.
 */
export function largeurMonde(distanceCamera: number, epaisseurPx: number, fovVerticalDeg: number, hauteurPx: number): number {
  const d = Math.max(distanceCamera, 0);
  const metresParPixel = (2 * d * Math.tan((fovVerticalDeg * Math.PI) / 360)) / Math.max(hauteurPx, 1);
  return Math.max(LARGEUR_MIN_M, (epaisseurPx / 2) * metresParPixel);
}
