/**
 * Frappe aérienne de l'arène FPS (PUR, sans three ni DOM).
 *
 * Débloquée au bout de 5 kills d'affilée sans mourir (`serie >= 5`).
 * Le joueur choisit un point sur la carte (grande carte ou HUD) pour déclencher une attaque de zone dévastatrice :
 *  - Annonce de la frappe et sirène d'alerte pour tous les joueurs.
 *  - 5 roquettes/bombes lourdes s'abattent en grappe sur la zone ciblée (rayon de 18 m).
 *  - Dégâts majeurs de zone (180 au centre, décroissant jusqu'à 18 m) et destruction des véhicules.
 *  - Kills crédités au lanceur de la frappe avec cause "frappe_aerienne".
 */
import type { Vec3 } from "./protocole";

export const FRAPPE = {
  serieRequise: 5,
  rayonZoneM: 18,
  rayonMortelM: 4.5,
  degatsMax: 180,
  degatsVehicule: 320,
  nbImpacts: 5,
  delaiPremierImpactMs: 1_200,
  intervalleImpactsMs: 400,
  dureeTotaleMs: 3_800,
  altitudeDepartM: 120,
} as const;

export interface ImpactFrappe {
  id: string;
  p: Vec3;
  impactT: number;
  degatsMax: number;
  rayonM: number;
}

export interface FrappeEnCours {
  id: string;
  joueur: string;
  cible: Vec3;
  t0: number;
  finT: number;
  impacts: ImpactFrappe[];
  impactsTraites: Set<string>;
}

/** Le joueur a-t-il atteint le palier pour obtenir une frappe aérienne ? */
export function meriteFrappe(serie: number, dejaDisponible: boolean): boolean {
  return serie >= FRAPPE.serieRequise && !dejaDisponible;
}

/** Calcule les dégâts infligés à une cible à `distance` m du point d'impact. */
export function degatsImpactFrappe(distance: number): number {
  if (distance > FRAPPE.rayonZoneM) return 0;
  if (distance <= FRAPPE.rayonMortelM) return FRAPPE.degatsMax;
  const k = (distance - FRAPPE.rayonMortelM) / (FRAPPE.rayonZoneM - FRAPPE.rayonMortelM);
  return Math.round(FRAPPE.degatsMax * (1 - k));
}

/** Calcule les dégâts de carrosserie infligés à un véhicule. */
export function degatsVehiculeFrappe(distance: number): number {
  if (distance > FRAPPE.rayonZoneM) return 0;
  const k = Math.min(1, distance / FRAPPE.rayonZoneM);
  return Math.round(FRAPPE.degatsVehicule * (1 - k * 0.8));
}

/** Crée une frappe aérienne ciblée avec ses impacts échelonnés dans le temps. */
export function creerFrappe(
  id: string,
  joueur: string,
  cible: Vec3,
  t0: number,
  alea: () => number = Math.random
): FrappeEnCours {
  const impacts: ImpactFrappe[] = [];

  // Premier impact pile au centre
  impacts.push({
    id: `${id}_0`,
    p: [cible[0], cible[1], cible[2]],
    impactT: t0 + FRAPPE.delaiPremierImpactMs,
    degatsMax: FRAPPE.degatsMax,
    rayonM: FRAPPE.rayonZoneM,
  });

  // 4 impacts supplémentaires autour du centre
  for (let i = 1; i < FRAPPE.nbImpacts; i++) {
    const angle = (i * 2 * Math.PI) / (FRAPPE.nbImpacts - 1) + (alea() - 0.5) * 0.5;
    const r = 3 + alea() * 8.5; // Entre 3 et 11.5 m du centre
    const x = cible[0] + Math.cos(angle) * r;
    const z = cible[2] + Math.sin(angle) * r;
    impacts.push({
      id: `${id}_${i}`,
      p: [x, cible[1], z],
      impactT: t0 + FRAPPE.delaiPremierImpactMs + i * FRAPPE.intervalleImpactsMs,
      degatsMax: Math.round(FRAPPE.degatsMax * 0.9),
      rayonM: FRAPPE.rayonZoneM * 0.85,
    });
  }

  return {
    id,
    joueur,
    cible: [...cible],
    t0,
    finT: t0 + FRAPPE.dureeTotaleMs,
    impacts,
    impactsTraites: new Set(),
  };
}

/** Tente de consommer les impacts d'une frappe arrivés à échéance. */
export function verifierImpactsFrappe(
  f: FrappeEnCours,
  maintenant: number
): ImpactFrappe[] {
  const prets: ImpactFrappe[] = [];
  for (const imp of f.impacts) {
    if (!f.impactsTraites.has(imp.id) && maintenant >= imp.impactT) {
      f.impactsTraites.add(imp.id);
      prets.push(imp);
    }
  }
  return prets;
}
