/**
 * Ouverture d'une porte payante du mode zombies, façon BO1 (PUR, testé) : au lieu de l'effondrement d'un bâtiment (explosion et pluie de
 * blocs de béton), la porte se soulève et s'efface (BO1 `zombie_door` : elle glisse puis disparaît), un petit nuage de poussière monte au
 * pied du passage et quelques éclats légers tombent le long de la porte, puis s'enfoncent dans le sol au bout de quelques secondes
 * (`VIE_DEBRIS.porte`). Ici le plan de l'animation (positions, vitesses, tailles), le rendu est dans `rendu-portes-zombies.ts`.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (portes payantes)
 */
import type { Vec3 } from "./protocole";

/** Durée (s) de la levée de la porte, part de cette durée où elle s'efface, hauteur de levée (en hauteurs de porte). */
export const DUREE_OUVERTURE_S = 1.1;
const DEBUT_FONDU = 0.45;
const LEVEE = 1.15;
/** Éclats : nombre (bornes), taille maximale (m), vitesses maximales (m/s). */
export const ECLATS = { min: 5, max: 9, tailleMax: 0.42, vitesseMax: 2.6 } as const;

/** Pièce d'une porte : segment p → q (repère de la carte), demi-épaisseur, hauteur (m). */
export interface PiecePorte { p: readonly [number, number]; q: readonly [number, number]; demi: number; h: number }

export interface Eclat { p: Vec3; v: Vec3; taille: Vec3 }

export interface PlanOuverture {
  /** centre de la porte au sol, longueur le long de p → q, épaisseur, hauteur, lacet de son grand côté (rotation y de three) */
  centre: Vec3; longueur: number; epaisseur: number; hauteur: number; lacet: number;
  /** éclats de bois légers lâchés le long de la porte */
  eclats: Eclat[];
  /** points de départ des bouffées de poussière, au pied de la porte */
  poussiere: Vec3[];
}

/** Plan d'ouverture d'une pièce de porte ; `alea` dans [0, 1[. */
export function planOuverture(piece: PiecePorte, alea: () => number): PlanOuverture {
  const [px, pz] = piece.p, [qx, qz] = piece.q;
  const dx = qx - px, dz = qz - pz;
  const longueur = Math.hypot(dx, dz) || 1;
  const ux = dx / longueur, uz = dz / longueur;
  const nx = -uz, nz = ux;
  const n = Math.min(ECLATS.max, Math.max(ECLATS.min, Math.round(longueur * 1.4)));
  const eclats: Eclat[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i + 0.2 + 0.6 * alea()) / n;
    const y = 0.3 + alea() * piece.h * 0.7;
    const cote = alea() < 0.5 ? -1 : 1;
    // des deux côtés de la porte, lentement, un peu vers le haut : ils retombent au pied du passage
    const vh = 0.4 + alea() * (ECLATS.vitesseMax - 0.8);
    const l = 0.18 + alea() * (ECLATS.tailleMax - 0.18);
    eclats.push({
      p: [px + dx * s + nx * cote * piece.demi, y, pz + dz * s + nz * cote * piece.demi],
      v: [nx * cote * vh + (alea() - 0.5) * 0.6, 0.6 + alea() * 1.4, nz * cote * vh + (alea() - 0.5) * 0.6],
      taille: [l, 0.04 + alea() * 0.04, 0.05 + alea() * 0.06],
    });
  }
  const poussiere: Vec3[] = [];
  const nb = Math.max(2, Math.min(6, Math.round(longueur / 1.5)));
  for (let i = 0; i < nb; i++) {
    const s = (i + 0.5) / nb;
    poussiere.push([px + dx * s, 0.15, pz + dz * s]);
  }
  return {
    centre: [(px + qx) / 2, 0, (pz + qz) / 2], longueur, epaisseur: Math.max(0.05, 2 * piece.demi), hauteur: piece.h,
    lacet: Math.atan2(-dz, dx), eclats, poussiere,
  };
}

/** Porte à `k` s du début de l'ouverture : levée (m) et opacité ; finie au-delà de `DUREE_OUVERTURE_S`. */
export function etatOuverture(k: number, hauteur: number): { levee: number; opacite: number; finie: boolean } {
  const x = Math.max(0, k / DUREE_OUVERTURE_S);
  if (x >= 1) return { levee: LEVEE * hauteur, opacite: 0, finie: true };
  const levee = LEVEE * hauteur * x * x;
  const opacite = x < DEBUT_FONDU ? 1 : 1 - (x - DEBUT_FONDU) / (1 - DEBUT_FONDU);
  return { levee, opacite, finie: false };
}
