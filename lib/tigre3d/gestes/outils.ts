/**
 * Outils pour écrire un geste (purs) : courbes, positions de repos utiles, assise, passage du sol
 * au repère du corps. Positions en repère du modèle au repos (cf. types.ts) : x > 0 = gauche du
 * tigre, museau +Z, pieds à y = 0.
 */
import { Euler, Quaternion, Vector3 } from "three";
import { squelette, reposDe } from "../squelette";
import type { Patte, Role } from "../os";
import type { PoseGeste, Vec3 } from "./types";
import { borne } from "../ressorts";
export { rampe, bosse, lisse, tresLisse, lerp, borne, bruit, bruitDouble } from "../ressorts";

type Deltas = NonNullable<PoseGeste["deltas"]>;
export type CorpsGeste = NonNullable<PoseGeste["corps"]>;

/** Position de repos d'un os (m, repère du modèle). */
export function repos(r: Role): Vec3 {
  const p = reposDe(squelette(), r);
  return [p.x, p.y, p.z];
}

/** Patte avant côté caméra quand le tigre est tourné de trois quarts vers nous dans le sens `sens`. */
export function patteCoteCamera(sens: 1 | -1): Patte {
  // Cap ≈ sens·0,25 : le tigre allant vers la droite (sens 1) montre son flanc gauche (+X).
  return sens === 1 ? "avG" : "avD";
}

/** +1 pour une patte gauche (x > 0), -1 pour une droite. */
export const cote = (p: Patte): 1 | -1 => (p.endsWith("G") ? 1 : -1);

/** Pivots des mouvements du corps (cf. corps.ts), repère du modèle au repos. */
const PIVOTS = {
  centre: [0, 0.2625, 0],
  hanches: [0, 0.211, -0.274],
  epaules: [0, 0.21, 0.13],
} as const;

const qT = new Quaternion(), vT = new Vector3(), eT = new Euler();

/**
 * Point du SOL (repère du modèle au repos, tigre non déplacé) → repère du CORPS une fois `co`
 * appliqué (même transformation que corps.ts : rotation YXZ (lacet, -tangage, roulis) autour du
 * pivot, puis dy / dz). Sert à poser une patte tenue par le geste au sol, ou à viser un point fixe
 * (devant l'écran) quelle que soit l'inclinaison du corps.
 */
export function solVersCorps(co: CorpsGeste | undefined, p: Vec3): Vec3 {
  if (!co) return p;
  const pv = PIVOTS[co.pivot ?? "centre"];
  qT.setFromEuler(eT.set(-(co.tangage ?? 0), co.lacet ?? 0, co.roulis ?? 0, "YXZ")).invert();
  vT.set(p[0] - pv[0], p[1] - pv[1] - (co.dy ?? 0), p[2] - pv[2] - (co.dz ?? 0)).applyQuaternion(qT);
  return [vT.x + pv[0], vT.y + pv[1], vT.z + pv[2]];
}

/**
 * Rotation (Euler XYZ, repère du modèle) à donner en `extremite` pour que la main / le pied ait,
 * dans le monde, l'orientation `voulue` (rotation ajoutée au repos, XYZ) malgré l'inclinaison du
 * corps : `extremite = corps⁻¹ · voulue`.
 */
export function extremiteMonde(co: CorpsGeste | undefined, voulue: Vec3 = [0, 0, 0]): Vec3 {
  const qv = new Quaternion().setFromEuler(eT.set(voulue[0], voulue[1], voulue[2], "XYZ"));
  if (co) qT.setFromEuler(eT.set(-(co.tangage ?? 0), co.lacet ?? 0, co.roulis ?? 0, "YXZ")).invert().multiply(qv);
  else qT.copy(qv);
  eT.setFromQuaternion(qT, "XYZ");
  return [eT.x, eT.y, eT.z];
}

/**
 * Patte posée au sol (tenue par le geste) : poignet / cheville à sa place de repos décalée de
 * (dx, dz), relevée de `h` (petit pas en arc), pied à plat malgré l'inclinaison du corps.
 */
export function patteAuSol(co: CorpsGeste | undefined, p: Patte, dx = 0, dz = 0, h = 0): { cible: Vec3; extremite: Vec3 } {
  const r = repos(p.startsWith("av") ? (p === "avG" ? "mainG" : "mainD") : (p === "arG" ? "piedG" : "piedD"));
  return { cible: solVersCorps(co, [r[0] + dx, r[1] + h, r[2] + dz]), extremite: extremiteMonde(co, [-2.2 * h, 0, 0]) };
}

/**
 * Assis (k ∈ [0, 1]) : arrière-train abaissé autour des hanches, poitrail redressé (le cou garde la
 * tête de niveau). Les pattes arrière restent plantées (l'IK les replie) ; les pattes avant, qui
 * ne peuvent pas suivre le poitrail (patte sans coude), reculent d'un petit pas : `pattesAssis`.
 */
export function assis(k: number, extra: Partial<CorpsGeste> = {}): CorpsGeste {
  return {
    dy: -0.14 * k + (extra.dy ?? 0), tangage: 0.45 * k + (extra.tangage ?? 0),
    roulis: extra.roulis ?? 0, lacet: extra.lacet ?? 0, dz: extra.dz ?? 0, pivot: "hanches",
  };
}

/**
 * Pattes avant d'un tigre qui s'assoit : elles reculent sous le poitrail en un petit pas en arc
 * (`pas` ∈ [0, 1], avancement du pas ; la patte se lève au milieu). `decale` (s) retarde la
 * seconde patte : jamais les deux ensemble.
 */
export function pattesAssis(co: CorpsGeste, k: number, pas: (p: Patte) => number, sauf: Patte[] = []): NonNullable<PoseGeste["pattes"]> {
  const r: NonNullable<PoseGeste["pattes"]> = {};
  for (const p of ["avG", "avD"] as Patte[]) {
    if (sauf.includes(p)) continue;
    const u = borne(pas(p), 0, 1);
    r[p] = patteAuSol(co, p, 0, -0.1 * k * u, 0.05 * Math.sin(Math.PI * u));
  }
  return r;
}

/** Ajoute `d` (rad) aux deltas d'un rôle. */
export function ajouter(deltas: Deltas, r: Role, d: Vec3): void {
  const a = deltas[r] ?? [0, 0, 0];
  deltas[r] = [a[0] + d[0], a[1] + d[1], a[2] + d[2]];
}

/**
 * Tourne (lacet, rad, > 0 vers sa gauche), penche (roulis) et baisse (> 0) la tête : cou + les 4
 * os de tête (pas d'os parent commun : ils tournent ensemble autour du même pivot).
 */
export function tete(deltas: Deltas, lacet: number, penche = 0, baisse = 0): void {
  ajouter(deltas, "cou", [baisse * 0.5, lacet * 0.4, penche * 0.3]);
  for (const r of ["tete", "machoire", "oreilleG", "oreilleD"] as Role[]) ajouter(deltas, r, [baisse * 0.5, lacet * 0.6, penche * 0.7]);
}

/** Oreilles plaquées en arrière (k > 0) ou dressées vers l'avant (k < 0). */
export function oreilles(deltas: Deltas, k: number, gauche = 1, droite = 1): void {
  ajouter(deltas, "oreilleG", [-0.6 * k * gauche, 0, 0.25 * k * gauche]);
  ajouter(deltas, "oreilleD", [-0.6 * k * droite, 0, -0.25 * k * droite]);
}

/** Gueule : ouverture (rad) de la mâchoire (pas d'intérieur de gueule : le menton descend). */
export function gueule(deltas: Deltas, ouverture: number): void {
  ajouter(deltas, "machoire", [ouverture, 0, 0]);
}

/**
 * Ressort amorti « analytique » (réponse à un échelon à l'instant t0, pulsation w, amortissement
 * z < 1) : 0 avant t0, tend vers 1 en dépassant un peu. Pour des gestes échantillonnés au temps
 * (sans état), c'est l'équivalent pur d'un ressort : départ en douceur, léger dépassement, retour.
 */
export function echelon(t: number, t0: number, w = 14, z = 0.55): number {
  const u = t - t0;
  if (u <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * u));
}

/** Passage 0 → 1 par ressort à t0, puis 1 → 0 par ressort à t1. */
export function aller(t: number, t0: number, t1: number, w = 14, z = 0.55): number {
  return echelon(t, t0, w, z) - echelon(t, t1, w, z);
}

/** Squash rapide (impact) : pic à t0 + 1/w, amorti, en [−0.3, 1]. */
export function impact(t: number, t0: number, w = 18, z = 0.35): number {
  const u = t - t0;
  if (u <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * u) * Math.sin(wd * u) * 1.6;
}

const qX = new Quaternion(), qM = new Quaternion();

/**
 * Clip du GLB (rotations LOCALES absolues, `os`) → deltas ADDITIFS en repère du modèle : l'écart du
 * clip à la pose de repos, que l'on pose par-dessus le moteur (regard vers la caméra, assise…) au
 * lieu de le remplacer. `gain` = [tangage, lacet, roulis] (Euler XYZ du modèle) : on peut garder
 * l'inclinaison de tête d'un clip en atténuant son balayage du regard.
 */
export function deltasDepuisClip(p: PoseGeste, roles: readonly Role[], gain: Vec3 = [1, 1, 1], sortie: Deltas = {}): Deltas {
  const sq = squelette();
  for (const r of roles) {
    const q = p.os?.[r];
    if (!q) continue;
    const k = sq.i[r];
    // X = repos⁻¹ · clip (local) ; D = modèle · X · modèle⁻¹ (cf. appliquerCouchesOs dans corps.ts).
    qX.copy(sq.qRepos[k]).invert().multiply(qM.set(q[0], q[1], q[2], q[3]).normalize());
    qM.copy(sq.qModele[k]).multiply(qX).multiply(qX.copy(sq.qModele[k]).invert());
    eT.setFromQuaternion(qM, "XYZ");
    ajouter(sortie, r, [eT.x * gain[0], eT.y * gain[1], eT.z * gain[2]]);
  }
  return sortie;
}

/**
 * Queue : `leve` (rad, > 0 = dressée, réparti sur la base), `lat` (rad, > 0 = vers sa gauche,
 * croissant vers le bout : enroulée autour des pattes quand il est assis), `fouet` ajouté au bout.
 */
export function queue(deltas: Deltas, leve: number, lat = 0, fouet = 0): void {
  const roles: Role[] = ["queue1", "queue2", "queue3", "queue4", "queue5", "queue6"];
  roles.forEach((r, j) => {
    ajouter(deltas, r, [leve * [0.45, 0.35, 0.15, 0.05, 0, 0][j], lat * [0.1, 0.15, 0.2, 0.25, 0.3, 0.3][j] + (j >= 4 ? fouet : 0), 0]);
  });
}
