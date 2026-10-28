/**
 * Fumigène de l'arène FPS (PUR, sans three ni DOM).
 *
 * Grenade fumigène tactique :
 *  - Lancée en cloche ou tirée avec le lanceur.
 *  - À la détonation, libère un écran de fumée volumétrique dense qui se déploie jusqu'à 12 m de rayon.
 *  - Dure 20 secondes.
 *  - Masque les lignes de vue : un joueur situé derrière ou à l'intérieur du nuage de fumée a sa silhouette
 *    et son pseudonyme masqués pour les adversaires.
 *  - Un joueur à l'intérieur voit son champ visuel embrumé.
 */
import type { FumigeneSnap, Vec3 } from "./protocole";

export const FUMIGENE = {
  vitesseLancer: 22, // m/s
  gravite: 18,       // m/s²
  rebondSol: 0.4,
  delaiDetonationMs: 1_200,
  rayonMaxM: 12.0,
  expansionS: 2.5,
  dissipationS: 3.5,
  dureeTotaleMs: 20_000,
} as const;

export interface ProjectileFumigene {
  p: Vec3;
  v: Vec3;
  t0: number;
  detoneT: number;
  detone: boolean;
}

export interface NuageFumee {
  id: string;
  p: Vec3;
  debutT: number;
  finT: number;
}

export function creerProjectileFumigene(
  o: Vec3,
  d: Vec3,
  maintenant: number,
  vitesse: number = FUMIGENE.vitesseLancer
): ProjectileFumigene {
  const norm = Math.hypot(d[0], d[1], d[2]) || 1;
  const vx = (d[0] / norm) * vitesse;
  const vy = (d[1] / norm) * vitesse + 2.5; // Légère impulsion vers le haut
  const vz = (d[2] / norm) * vitesse;

  return {
    p: [o[0], o[1], o[2]],
    v: [vx, vy, vz],
    t0: maintenant,
    detoneT: maintenant + FUMIGENE.delaiDetonationMs,
    detone: false,
  };
}

/** Fait avancer le projectile de grenade fumigène. */
export function avancerProjectile(
  proj: ProjectileFumigene,
  dt: number,
  solY: number = 0.05
): boolean {
  if (proj.detone) return false;

  proj.v[1] -= FUMIGENE.gravite * dt;
  proj.p[0] += proj.v[0] * dt;
  proj.p[1] += proj.v[1] * dt;
  proj.p[2] += proj.v[2] * dt;

  // Rebond au sol
  if (proj.p[1] <= solY) {
    proj.p[1] = solY;
    proj.v[1] = -proj.v[1] * FUMIGENE.rebondSol;
    proj.v[0] *= 0.75;
    proj.v[2] *= 0.75;
  }

  return true;
}

export function creerNuageFumee(
  id: string,
  p: Vec3,
  maintenant: number
): NuageFumee {
  return {
    id,
    p: [p[0], Math.max(0.1, p[1]), p[2]],
    debutT: maintenant,
    finT: maintenant + FUMIGENE.dureeTotaleMs,
  };
}

/** Rayon actuel du nuage de fumée (progression et dissipation). */
export function rayonNuage(nuage: NuageFumee, maintenant: number): number {
  if (maintenant < nuage.debutT || maintenant >= nuage.finT) return 0;
  const ageS = (maintenant - nuage.debutT) / 1000;
  const restantS = (nuage.finT - maintenant) / 1000;

  // Phase d'expansion
  if (ageS < FUMIGENE.expansionS) {
    return FUMIGENE.rayonMaxM * Math.min(1, ageS / FUMIGENE.expansionS);
  }
  // Phase de dissipation
  if (restantS < FUMIGENE.dissipationS) {
    return FUMIGENE.rayonMaxM * Math.max(0, restantS / FUMIGENE.dissipationS);
  }
  return FUMIGENE.rayonMaxM;
}

/** Opacité actuelle du nuage de fumée (0 à 1). */
export function opaciteNuage(nuage: NuageFumee, maintenant: number): number {
  if (maintenant < nuage.debutT || maintenant >= nuage.finT) return 0;
  const ageS = (maintenant - nuage.debutT) / 1000;
  const restantS = (nuage.finT - maintenant) / 1000;

  if (ageS < 0.8) return Math.min(1, ageS / 0.8);
  if (restantS < FUMIGENE.dissipationS) return Math.max(0, restantS / FUMIGENE.dissipationS);
  return 1.0;
}

/** Un point est-il immergé dans un nuage de fumée ? */
export function estDansFumee(point: Vec3, nuages: readonly NuageFumee[], maintenant: number): boolean {
  for (const n of nuages) {
    const r = rayonNuage(n, maintenant);
    if (r <= 0.5) continue;
    const dH = Math.hypot(point[0] - n.p[0], point[2] - n.p[2]);
    const dV = Math.abs(point[1] - n.p[1]);
    if (dH <= r && dV <= r * 0.7) {
      return true;
    }
  }
  return false;
}

/**
 * La ligne de vue entre A et B est-elle coupée par un nuage de fumée ?
 * Teste la distance minimale entre le segment AB et le centre du nuage.
 */
export function ligneCoupeeParFumee(
  a: Vec3,
  b: Vec3,
  nuages: readonly NuageFumee[],
  maintenant: number
): boolean {
  for (const n of nuages) {
    const r = rayonNuage(n, maintenant);
    if (r <= 1.0) continue;

    // Projection du point n.p sur le segment AB (en 2D horizontale x, z)
    const abx = b[0] - a[0], abz = b[2] - a[2];
    const anX = n.p[0] - a[0], anZ = n.p[2] - a[2];
    const lenSq = abx * abx + abz * abz;
    if (lenSq < 1e-6) {
      if (Math.hypot(anX, anZ) <= r) return true;
      continue;
    }

    const t = Math.max(0, Math.min(1, (anX * abx + anZ * abz) / lenSq));
    const projX = a[0] + t * abx;
    const projZ = a[2] + t * abz;
    const d = Math.hypot(projX - n.p[0], projZ - n.p[2]);

    if (d <= r * 0.85) {
      // Vérifier également l'altitude
      const projY = a[1] + t * (b[1] - a[1]);
      if (Math.abs(projY - n.p[1]) <= r * 0.75) {
        return true;
      }
    }
  }
  return false;
}

export function nuagesEnSnap(nuages: readonly NuageFumee[]): FumigeneSnap[] {
  return nuages.map((n) => ({
    id: n.id,
    p: [Math.round(n.p[0] * 100) / 100, Math.round(n.p[1] * 100) / 100, Math.round(n.p[2] * 100) / 100],
    debutT: n.debutT,
    finT: n.finT,
  }));
}
