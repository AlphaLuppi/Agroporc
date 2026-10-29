/**
 * Cadrages de la caméra de la vue Palantir par mode de jeu et transition entre deux cadrages (arc : la caméra monte à mi-chemin puis redescend).
 * PUR : positions en tableaux [x, y, z], aucune dépendance à three. Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { bornesBr } from "./br-carte";
import type { ModeSalle } from "./protocole";
import { FOCUS_ZOMBIES } from "./zombies-carte";

export type Vec3 = [number, number, number];

export interface Cadrage {
  /** point visé (x, z) ; null = le point visé de la scène (`data.focus`) */
  focus: Vec2 | null;
  /** décalage de la caméra par rapport au point visé : dx et dz en mètres, y = altitude */
  dx: number;
  y: number;
  dz: number;
  /** densité du brouillard exponentiel */
  brouillard: number;
}

export const CADRAGES: Record<ModeSalle, Cadrage> = {
  // la position de repos historique (`REST` de scene.ts : un test les égale)
  arene: { focus: null, dx: -30, y: 230, dz: 380, brouillard: 0.0011 },
  // le Pôle R&D en gros plan : la carte tient dans 230 × 135 m
  zombies: { focus: FOCUS_ZOMBIES, dx: -10, y: 135, dz: 175, brouillard: 0.0017 },
  // plongée haute et large sur toute la carte : la zone et l'avion tiennent à l'écran
  br: { focus: null, dx: 0, y: 540, dz: 330, brouillard: 0.0006 },
};

export interface Pose { pos: Vec3; cible: Vec3 }

/** Milieu de la transition : le décor est échangé à ce moment (k = 0,5). */
export const MI_TRANSITION = 0.5;

/** Point visé d'un mode : arène = `data.focus`, zombies = le Pôle R&D, Battle Royale = le centre de ses bornes. */
export function focusDuMode(mode: ModeSalle, data: Pick<SceneData, "focus" | "buildings">): Vec2 {
  const c = CADRAGES[mode];
  if (c.focus) return c.focus;
  if (mode === "br") {
    const b = bornesBr(data as SceneData);
    return [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
  }
  return data.focus;
}

/** Pose de la caméra (position et point visé) d'un mode. */
export function poseCadrage(mode: ModeSalle, data: Pick<SceneData, "focus" | "buildings">): Pose {
  const c = CADRAGES[mode];
  const f = focusDuMode(mode, data);
  return { pos: [f[0] + c.dx, c.y, f[1] + c.dz], cible: [f[0], 0, f[1]] };
}

const distance3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const recul = (p: Pose): number => distance3(p.pos, p.cible);

/** Entrée-sortie cubique, 0 → 0, 1 → 1, symétrique. */
export const easeEntreeSortie = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Élévation de l'arc à la fraction `k` : `leve` × sin(πk), nulle aux deux bouts, maximale au milieu. */
export const arcDeLeve = (leve: number, k: number): number => leve * Math.sin(Math.PI * Math.min(1, Math.max(0, k)));

/** Élévation de l'arc entre deux poses : 18 % de la plus grande distance caméra-cible des deux. */
export const leveDeTransition = (de: Pose, vers: Pose): number => 0.18 * Math.max(recul(de), recul(vers));

/** Pose intermédiaire à la fraction `k` (0..1) : position et cible interpolées par `easeEntreeSortie`, plus l'élévation de l'arc sur la position. */
export function interpolerCadrage(de: Pose, vers: Pose, k: number, leve: number): Pose {
  const kk = Math.min(1, Math.max(0, k));
  const e = easeEntreeSortie(kk);
  const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
  const pos = mix(de.pos, vers.pos);
  pos[1] += arcDeLeve(leve, kk);
  return { pos, cible: mix(de.cible, vers.cible) };
}

/** Durée de la transition (s) : 0 en mouvement réduit, sinon 1,6 s + 0,4 s par 500 m de déplacement de la cible et du recul, 2,6 s au plus. */
export function dureeTransition(de: Pose, vers: Pose, reduit: boolean): number {
  if (reduit) return 0;
  const d = distance3(de.cible, vers.cible) + Math.abs(recul(de) - recul(vers));
  return Math.min(2.6, 1.6 + 0.4 * (d / 500));
}

/** Brouillard à la fraction `k` d'une transition : interpolé de la densité de départ à celle du mode d'arrivée. */
export const brouillardInterpole = (de: number, vers: number, k: number): number => de + (vers - de) * easeEntreeSortie(Math.min(1, Math.max(0, k)));

/** Impulsion de bloom (0..1) autour du milieu de la transition : un « scan » néon de 0,45 s qui cache l'échange du décor. */
export function impulsionBloom(k: number, duree: number): number {
  if (duree <= 0) return 0;
  const demi = 0.225 / duree;
  return Math.max(0, 1 - Math.abs(k - MI_TRANSITION) / demi);
}
