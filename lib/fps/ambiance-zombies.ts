/**
 * Ambiance des manches du Truck Muche côté client (PUR : ni three ni DOM, instants et hasard passés en paramètre) : courbe du brouillard
 * (FogExp2 animé : il tombe en 3 s au début de la livraison, ondule, et se lève 2 s après le dernier ennemi, comme le `dog_stop` de BO1),
 * teinte du ciel, éclair global (flash) d'un coup de foudre, planning des éclairs d'ambiance et tracé d'un éclair en zigzag (déplacement du
 * point milieu, déterministe à hasard égal). `jeu.ts` n'en change que la densité et la couleur du MÊME `FogExp2` (des uniformes : aucune
 * recompilation), la couleur de fond, le bloom et l'éclairage des intérieurs ; `rendu-eclairs.ts` dessine les tracés.
 *
 * BO1 règle le brouillard des manches de chiens dans le script client de chaque carte (`dog_start_monitor` / `SetVolFog`) : les valeurs ne
 * sont pas publiées. Ici, une visibilité de quelques mètres : 22 % de brouillard à 7 m, la moitié à 12 m, presque tout à 20 m.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Manches du Truck Muche »)
 */
import type { Vec3 } from "./protocole";

export const AMBIANCE = {
  /** densité du brouillard hors manche du Truck (celle de l'arène) */
  densiteBase: 0.0013,
  /** densité au plus fort de la livraison (FogExp2 : 1 − exp(−(d × densité)²)) */
  densiteTruck: 0.07,
  /** la densité ondule de ± cette part, sur cette période (s) : des nappes qui passent */
  houle: 0.12,
  periodeHouleS: 7,
  /** montée (s) au début de la manche, levée après le dernier ennemi : attente (s) puis descente (s) */
  monteeS: 3,
  attenteLeveeS: 2,
  descenteS: 3.5,
  /** teinte du brouillard et du ciel pendant la livraison : brun rouge sombre (ciel d'orage, phares rouges qui le percent) */
  couleurTruck: 0x0d0403,
  /** teinte vers laquelle un éclair tire le brouillard */
  couleurEclair: 0x9fb4ff,
  /** éclairs d'ambiance : intervalle (s) entre deux, distance (m) du joueur, hauteur (m) de la décharge */
  ambianceMinS: 3.5,
  ambianceMaxS: 8,
  ambianceDistanceM: [25, 70] as readonly number[],
  hauteurM: 55,
  /** un éclair d'apparition est vu pleinement à moins de cette distance (m), à 35 % au loin */
  porteeFlashM: 30,
} as const;

/** État de la manche vu par le client : livraison en cours ou non, depuis quand (s, horloge locale), fin (s) ou null si elle dure. */
export interface EtatAmbiance { truck: boolean; debutS: number | null; finS: number | null }

const lisse = (x: number): number => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

/**
 * Part du brouillard de la livraison (0 hors manche du Truck, 1 au plus fort) à l'instant `tS` : montée en `monteeS` depuis `debutS`, tenue,
 * puis levée `attenteLeveeS` après `finS` en `descenteS`.
 */
export function partBrouillard(e: EtatAmbiance, tS: number): number {
  if (e.debutS === null) return 0;
  const montee = lisse((tS - e.debutS) / AMBIANCE.monteeS);
  if (e.finS === null) return e.truck ? montee : 0;
  const levee = lisse((tS - e.finS - AMBIANCE.attenteLeveeS) / AMBIANCE.descenteS);
  return montee * (1 - levee);
}

/** Densité du FogExp2 à l'instant `tS` (houle comprise), de `densiteBase` à `densiteTruck`. */
export function densiteBrouillard(e: EtatAmbiance, tS: number): number {
  const k = partBrouillard(e, tS);
  const houle = 1 + AMBIANCE.houle * Math.sin((2 * Math.PI * tS) / AMBIANCE.periodeHouleS) * Math.sin((2 * Math.PI * tS) / (AMBIANCE.periodeHouleS * 2.3) + 1);
  return AMBIANCE.densiteBase + (AMBIANCE.densiteTruck * houle - AMBIANCE.densiteBase) * k;
}

/** Part de brouillard (0..1) à `d` m pour la densité `densite` (formule de three.js `FogExp2`). */
export function opaciteBrouillard(d: number, densite: number): number {
  return 1 - Math.exp(-((d * densite) ** 2));
}

/** Mélange de deux couleurs 0xRRGGBB (k = 0 : a, 1 : b), arrondi. */
export function melangerCouleur(a: number, b: number, k: number): number {
  const t = Math.min(1, Math.max(0, k));
  let r = 0;
  for (const s of [16, 8, 0]) {
    const ca = (a >> s) & 255, cb = (b >> s) & 255;
    r |= Math.round(ca + (cb - ca) * t) << s;
  }
  return r;
}

/** Couleur du brouillard et du fond : la base de l'arène tirée vers le ciel d'orage selon la part de brouillard, puis vers l'éclair. */
export function couleurBrouillard(base: number, part: number, flash: number): number {
  return melangerCouleur(melangerCouleur(base, AMBIANCE.couleurTruck, part), AMBIANCE.couleurEclair, Math.min(0.85, flash));
}

/**
 * Éclat d'un éclair `s` secondes après qu'il a frappé (0 avant et après) : 1 pendant 60 ms, retombée à 0,2, second coup à 0,8 (une
 * décharge de retour, comme la vraie foudre), puis décroissance exponentielle sur ≈ 400 ms.
 */
export function flashEclair(s: number): number {
  if (!(s >= 0)) return 0;
  if (s < 0.06) return 1;
  if (s < 0.12) return 0.2;
  if (s < 0.2) return 0.8;
  const k = 0.8 * Math.exp(-(s - 0.2) / 0.13);
  return k < 0.01 ? 0 : k;
}
/** Durée (s) au-delà de laquelle `flashEclair` vaut 0. */
export const DUREE_FLASH_S = 0.8;

/** Part d'éclat (0,35..1) d'un éclair à `d` m de la caméra. */
export function porteeFlash(d: number): number {
  return 0.35 + 0.65 * Math.max(0, 1 - Math.max(0, d) / AMBIANCE.porteeFlashM);
}

/** Délai (s) avant le prochain éclair d'ambiance d'une livraison, `alea` ∈ [0, 1[. */
export function prochainEclairAmbiance(alea: number): number {
  return AMBIANCE.ambianceMinS + (AMBIANCE.ambianceMaxS - AMBIANCE.ambianceMinS) * Math.min(1, Math.max(0, alea));
}

/** Point d'un éclair d'ambiance autour de la caméra (au sol), à 25–70 m dans une direction tirée. */
export function pointEclairAmbiance(cam: Vec3, alea: () => number): Vec3 {
  const a = alea() * 2 * Math.PI;
  const [d0, d1] = AMBIANCE.ambianceDistanceM;
  const d = d0 + (d1 - d0) * alea();
  return [cam[0] + Math.cos(a) * d, 0, cam[2] + Math.sin(a) * d];
}

/** Tracé d'un éclair : le tronc du ciel jusqu'au point d'impact (exact), et des branches qui en partent. */
export interface TraceEclair { tronc: Vec3[]; branches: Vec3[][] }

/**
 * Éclair frappant `sol`, parti `hauteur` m plus haut (légèrement décalé) : `generations` subdivisions du segment, chaque milieu écarté à
 * l'horizontale d'au plus `ecart` × la longueur du segment (l'écart fond de moitié à chaque génération : extrémités exactes, zigzag borné),
 * et deux branches de 25 à 40 % de la hauteur, qui partent d'un point du tronc vers le bas. Le hasard est injecté (même graine, même tracé).
 */
export function tracerEclair(sol: Vec3, hauteur: number, alea: () => number, generations = 5, ecart = 0.28): TraceEclair {
  const haut: Vec3 = [sol[0] + (alea() - 0.5) * hauteur * 0.3, sol[1] + hauteur, sol[2] + (alea() - 0.5) * hauteur * 0.3];
  const tronc = zigzag(haut, sol, alea, generations, ecart);
  const branches: Vec3[][] = [];
  for (let b = 0; b < 2; b++) {
    const i = 1 + Math.min(tronc.length - 3, Math.floor((0.15 + 0.5 * alea()) * (tronc.length - 2)));
    const o = tronc[i];
    const l = hauteur * (0.25 + 0.15 * alea());
    const ang = alea() * 2 * Math.PI;
    const fin: Vec3 = [o[0] + Math.cos(ang) * l * 0.6, Math.max(sol[1], o[1] - l * 0.8), o[2] + Math.sin(ang) * l * 0.6];
    branches.push(zigzag(o, fin, alea, Math.max(1, generations - 2), ecart));
  }
  return { tronc, branches };
}

function zigzag(a: Vec3, b: Vec3, alea: () => number, generations: number, ecart: number): Vec3[] {
  let pts: Vec3[] = [a, b];
  let k = ecart;
  for (let g = 0; g < generations; g++) {
    const suivants: Vec3[] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      suivants.push([(p[0] + q[0]) / 2 + (alea() - 0.5) * 2 * k * l, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 + (alea() - 0.5) * 2 * k * l], q);
    }
    pts = suivants;
    k /= 2;
  }
  return pts;
}
