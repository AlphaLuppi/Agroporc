/**
 * Visibilité des pseudos (PUR) : un pseudo n'est affiché que si le joueur est VU (distance ≤ 70 m, dans le champ de vision, ligne de vue
 * libre vers la tête ou le torse, vivant). Ligne de vue testée à 10 Hz par joueur (phases décalées par hachage de l'id), alpha lissé
 * (monte en 0,15 s, descend en 0,10 s) ; la plaque décroît avec la distance (`hauteurPlaquePx`).
 * `dansChampDeVue` et `ligneDeVue` sont aussi ceux de la mini-map (`radar.ts`, sans plafond de distance : pas de wallhack).
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.2, §5.10)
 */
import { visible, type Monde } from "./collision";
import type { Vec3 } from "./protocole";
import { silhouetteDe } from "./protocole";

export const PSEUDO = {
  distanceMax: 70, cosChamp: 0.5, hzTest: 10, fonduMonteeS: 0.15, fonduDescenteS: 0.10,
  pxMax: 24, pxMin: 14, distancePxPleins: 30, distancePxMin: 55,
} as const;

/** Marge sur le cosinus : un joueur pile à la limite des 60° reste dans le champ malgré l'arrondi flottant. */
const EPS_COS = 1e-9;

/**
 * La cible est-elle dans le cône de vision (demi-angle = arccos(cosChamp), 60° par défaut) ? `regard` est la direction de la vue
 * (`directionRegard`), pas nécessairement normalisée ; une cible confondue avec l'œil est dans le champ.
 */
export function dansChampDeVue(oeil: Vec3, regard: Vec3, cible: Vec3, cosChamp: number = PSEUDO.cosChamp): boolean {
  const dx = cible[0] - oeil[0], dy = cible[1] - oeil[1], dz = cible[2] - oeil[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  const r = Math.hypot(regard[0], regard[1], regard[2]);
  if (r < 1e-9) return false;
  const cos = (dx * regard[0] + dy * regard[1] + dz * regard[2]) / (d * r);
  return cos >= cosChamp - EPS_COS;
}

/** Tête et torse (abaissés si accroupi) : les deux points testés. */
export function pointsTest(p: Vec3, accroupi: boolean): [Vec3, Vec3] {
  const s = silhouetteDe(accroupi);
  return [[p[0], p[1] + s.tete.y, p[2]], [p[0], p[1] + s.centreY, p[2]]];
}

/** Vrai si la tête OU le torse du joueur (pieds en `p`) est visible depuis `oeil` sans traverser un bâtiment. */
export function ligneDeVue(monde: Monde, oeil: Vec3, p: Vec3, accroupi: boolean): boolean {
  const [tete, torse] = pointsTest(p, accroupi);
  return visible(monde, oeil, tete) || visible(monde, oeil, torse);
}

/**
 * 24 px jusqu'à distancePxPleins, puis décroissance en 1/distance (a/d + b, continue aux deux bouts) jusqu'à pxMin à distancePxMin
 * et au-delà. Monotone décroissante.
 */
export function hauteurPlaquePx(distance: number): number {
  const { pxMax, pxMin, distancePxPleins: d0, distancePxMin: d1 } = PSEUDO;
  if (!(distance > d0)) return pxMax;
  if (distance >= d1) return pxMin;
  const a = (pxMax - pxMin) / (1 / d0 - 1 / d1);
  const b = pxMax - a / d0;
  return a / distance + b;
}

export interface JoueurVisible { id: string; p: Vec3; accroupi?: boolean; vivant: boolean }

interface EtatPseudo {
  alpha: number;
  /** décalage de phase en secondes (hachage de l'id), pour que les joueurs ne soient pas tous testés à la même image */
  phase: number;
  /** tranche de 1/hzTest s du dernier rayon lancé ; NaN = jamais */
  tranche: number;
  /** résultat de ce dernier rayon */
  ligne: boolean;
}

/** Hachage FNV-1a de l'id (avec finition) → [0, 1[. */
function hachage01(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // finition type murmur3 : sans elle, des ids qui ne diffèrent que par le dernier caractère tombent dans la même fraction de seconde
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class VisibilitePseudos {
  private etats = new Map<string, EtatPseudo>();

  constructor(private readonly monde: Monde) {}

  /**
   * À appeler chaque image. `t` et `dt` en SECONDES (même unité : `t` n'a besoin que d'être croissant). Les tests bon marché
   * (vivant, distance, champ de vision) se font à chaque image ; le rayon de ligne de vue n'est lancé qu'à PSEUDO.hzTest par joueur
   * (phases décalées), son résultat gardé entre deux lancers. L'alpha est ensuite lissé. Un joueur absent de `joueurs` est oublié.
   */
  maj(t: number, dt: number, oeil: Vec3, regard: Vec3, joueurs: readonly JoueurVisible[]): void {
    const periode = 1 / PSEUDO.hzTest;
    const pas = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const presents = new Set<string>();
    for (const j of joueurs) {
      presents.add(j.id);
      let e = this.etats.get(j.id);
      if (!e) {
        e = { alpha: 0, phase: hachage01(j.id) * periode, tranche: Number.NaN, ligne: false };
        this.etats.set(j.id, e);
      }
      let cible = false;
      if (j.vivant) {
        const dx = j.p[0] - oeil[0], dy = j.p[1] - oeil[1], dz = j.p[2] - oeil[2];
        if (Math.hypot(dx, dy, dz) <= PSEUDO.distanceMax) {
          // le champ de vision se juge sur le torse (centre de la silhouette), pas sur les pieds
          const centre: Vec3 = [j.p[0], j.p[1] + silhouetteDe(j.accroupi).centreY, j.p[2]];
          if (dansChampDeVue(oeil, regard, centre)) {
            const tranche = Math.floor((t + e.phase) / periode);
            if (tranche !== e.tranche) {
              e.tranche = tranche;
              e.ligne = ligneDeVue(this.monde, oeil, j.p, !!j.accroupi);
            }
            cible = e.ligne;
          }
        }
      }
      const duree = cible ? PSEUDO.fonduMonteeS : PSEUDO.fonduDescenteS;
      e.alpha = Math.min(1, Math.max(0, e.alpha + (cible ? pas : -pas) / duree));
    }
    for (const id of this.etats.keys()) if (!presents.has(id)) this.etats.delete(id);
  }

  /** 0..1 */
  alpha(id: string): number {
    return this.etats.get(id)?.alpha ?? 0;
  }

  oublier(id: string): void {
    this.etats.delete(id);
  }

  vider(): void {
    this.etats.clear();
  }
}
