/**
 * Ciblage de la frappe aérienne (PUR, sans three ni DOM ni horloge), arène seulement.
 *
 * Pourquoi un module : la frappe se cible sur la grande carte, mais la souris est PRISE par le jeu (pointer lock) pendant toute la partie. Un clic sur
 * la carte n'arrive jamais à la carte (l'événement va à l'élément verrouillé, les coordonnées sont figées) : l'ancienne interface « cliquez sur la
 * carte » ne pouvait donc rien déclencher. Le ciblage se fait maintenant à la souris prise : K ouvre la carte avec un réticule posé sous le joueur, la
 * souris le déplace (`deplacerCiblage`, la caméra ne tourne plus), le tir le valide, K ou le clic droit l'annulent. Le réticule est en mètres du monde,
 * borné à la zone de la carte ; la grande carte le dessine à la position reçue.
 */
import type { Vec3 } from "./protocole";

/** Rectangle jouable du monde (m) : la zone de la grande carte (`ZONE_CARTE`). */
export interface ZoneCiblage { x0: number; z0: number; x1: number; z1: number }
/** Point au sol visé (m, repère du monde). */
export interface PointCiblage { x: number; z: number }

/** Mètres du monde parcourus par le réticule pour un pixel de déplacement de la souris (une carte de ≈ 900 px couvre ≈ 700 m). */
export const CIBLAGE_M_PAR_PX = 0.8;
/** Série de kills qui rapporte une frappe (rappel de `FRAPPE.serieRequise` pour le HUD : « encore n kills »). */
export const KILLS_PAR_FRAPPE = 5;

/** Ramène un point dans la zone. */
export function bornerCiblage(p: PointCiblage, zone: ZoneCiblage): PointCiblage {
  return {
    x: Math.min(zone.x1, Math.max(zone.x0, Number.isFinite(p.x) ? p.x : (zone.x0 + zone.x1) / 2)),
    z: Math.min(zone.z1, Math.max(zone.z0, Number.isFinite(p.z) ? p.z : (zone.z0 + zone.z1) / 2)),
  };
}

/** Réticule au départ : sous le joueur (pieds en `p`), borné à la zone. */
export function demarrerCiblage(zone: ZoneCiblage, p: Vec3): PointCiblage {
  return bornerCiblage({ x: p[0], z: p[2] }, zone);
}

/**
 * Déplacement du réticule par la souris prise : `dx` pixels vers la droite = vers +x, `dy` pixels vers le bas = vers +z (nord en haut sur la carte,
 * donc le sud est en bas). Borné à la zone.
 */
export function deplacerCiblage(c: PointCiblage, dx: number, dy: number, zone: ZoneCiblage, metresParPixel: number = CIBLAGE_M_PAR_PX): PointCiblage {
  return bornerCiblage({ x: c.x + (Number.isFinite(dx) ? dx : 0) * metresParPixel, z: c.z + (Number.isFinite(dy) ? dy : 0) * metresParPixel }, zone);
}

/** Kills d'affilée qui manquent avant la prochaine frappe (5 à la mort ou juste après un palier) : « encore 3 kills ». */
export function killsAvantFrappe(serie: number): number {
  const s = Number.isFinite(serie) ? Math.max(0, Math.floor(serie)) : 0;
  return KILLS_PAR_FRAPPE - (s % KILLS_PAR_FRAPPE);
}

/** Ce que fait la touche de frappe (K) selon l'état. */
export type DecisionFrappe = "ouvrir" | "annuler" | "indisponible" | "impossible";

/**
 * - ciblage ouvert : la même touche l'annule ;
 * - pas de frappe en poche : `indisponible` (le jeu le dit, au lieu de ne rien faire) ;
 * - frappe en poche mais le joueur ne peut pas agir (mort, killcam, entracte, au volant, aux commandes du titan) : `impossible` ;
 * - sinon : on ouvre le ciblage.
 */
export function decisionToucheFrappe(e: { dispo: boolean; ciblageOuvert: boolean; peutAgir: boolean }): DecisionFrappe {
  if (e.ciblageOuvert) return "annuler";
  if (!e.dispo) return "indisponible";
  return e.peutAgir ? "ouvrir" : "impossible";
}

/** Texte du HUD : frappe prête (touche, ou « touche non assignée ») ou progression de la série. */
export function texteFrappe(dispo: boolean, serie: number, touche: string): string {
  if (dispo) return touche ? `FRAPPE AÉRIENNE PRÊTE : [${touche}]` : "FRAPPE AÉRIENNE PRÊTE (touche non assignée, voir Commandes)";
  const n = killsAvantFrappe(serie);
  return `Frappe aérienne : encore ${n} kill${n > 1 ? "s" : ""} d'affilée`;
}
