/**
 * Squelette de repos du GLB et cinématique directe, PURS (classes mathématiques de three
 * seulement : ni WebGL, ni DOM, testables). Les données viennent de donnees/squelette.json,
 * extrait du GLB par scripts/tigre/extraire_squelette.mjs (squelette.test.ts vérifie qu'il
 * colle au GLB).
 *
 * Une pose (`PoseTigre`) = rotation et translation LOCALES de chaque os (repère de son parent),
 * exactement ce que l'on recopie sur les `Bone` three. La racine (`_rootJoint`) a pour parent le
 * nœud « Armature » (rotation de -90° autour de X, échelle 0,1769) : `placerRacine` traduit une
 * pose de la racine exprimée dans le repère du modèle (≈ le sol, en mètres) en repère local.
 */
import { Quaternion, Vector3 } from "three";
import donnees from "./donnees/squelette.json";
import { NOMS_OS, ROLES, type Role } from "./os";

export interface DonneesSquelette {
  source: string;
  parentRacine: { t: number[]; q: number[]; s: number };
  os: Array<{ nom: string; parent: number; t: number[]; q: number[] }>;
}

export interface Squelette {
  n: number;
  noms: string[];
  /** Indice du parent (-1 pour la racine) ; les parents précèdent toujours leurs enfants. */
  parent: number[];
  enfants: number[][];
  tRepos: Vector3[];
  qRepos: Quaternion[];
  /** Au repos, en repère du modèle : position de la tête de l'os, rotation. */
  pModele: Vector3[];
  qModele: Quaternion[];
  /** Rôle → indice. */
  i: Record<Role, number>;
  /** Parent de la racine (repère du modèle) et échelle uniforme des os. */
  racine: { t: Vector3; q: Quaternion; qInv: Quaternion; s: number };
  /** Longueur (m) de chaque os jusqu'à son premier enfant (0 pour les feuilles). */
  longueur: number[];
}

export interface PoseTigre {
  q: Quaternion[];
  t: Vector3[];
}

/** Positions et rotations de chaque os dans le repère du modèle (après cinématique directe). */
export interface Monde {
  p: Vector3[];
  q: Quaternion[];
}

const v3 = (a: number[]) => new Vector3(a[0], a[1], a[2]);
const q4 = (a: number[]) => new Quaternion(a[0], a[1], a[2], a[3]).normalize();

export function creerSquelette(d: DonneesSquelette = donnees as DonneesSquelette): Squelette {
  const n = d.os.length;
  const noms = d.os.map((o) => o.nom);
  const parent = d.os.map((o) => o.parent);
  parent.forEach((p, k) => { if (p >= k) throw new Error("squelette : parent après l'enfant"); });
  const enfants: number[][] = noms.map(() => []);
  parent.forEach((p, k) => { if (p >= 0) enfants[p].push(k); });
  const racine = {
    t: v3(d.parentRacine.t), q: q4(d.parentRacine.q), qInv: q4(d.parentRacine.q).invert(), s: d.parentRacine.s,
  };
  const i = {} as Record<Role, number>;
  for (const r of ROLES) {
    const k = noms.indexOf(NOMS_OS[r]);
    if (k < 0) throw new Error(`squelette : os ${NOMS_OS[r]} (${r}) absent`);
    i[r] = k;
  }
  const sq: Squelette = {
    n, noms, parent, enfants,
    tRepos: d.os.map((o) => v3(o.t)), qRepos: d.os.map((o) => q4(o.q)),
    pModele: [], qModele: [], i, racine, longueur: [],
  };
  const m = creerMonde(sq);
  fk(sq, nouvellePose(sq), m);
  sq.pModele = m.p.map((p) => p.clone());
  sq.qModele = m.q.map((q) => q.clone());
  sq.longueur = enfants.map((e, k) => (e.length ? m.p[e[0]].distanceTo(m.p[k]) : 0));
  return sq;
}

let partage: Squelette | null = null;
/** Le squelette du GLB, construit une fois. */
export function squelette(): Squelette {
  return (partage ??= creerSquelette());
}

export function nouvellePose(sq: Squelette): PoseTigre {
  return { q: sq.qRepos.map((q) => q.clone()), t: sq.tRepos.map((t) => t.clone()) };
}
export function copierPose(dst: PoseTigre, src: PoseTigre): PoseTigre {
  for (let k = 0; k < src.q.length; k++) { dst.q[k].copy(src.q[k]); dst.t[k].copy(src.t[k]); }
  return dst;
}
export function creerMonde(sq: Squelette): Monde {
  return { p: Array.from({ length: sq.n }, () => new Vector3()), q: Array.from({ length: sq.n }, () => new Quaternion()) };
}

const tmp = new Vector3();

/** Cinématique directe d'un seul os, son parent étant déjà calculé dans `m`. */
export function fkOs(sq: Squelette, pose: PoseTigre, m: Monde, k: number): void {
  const p = sq.parent[k];
  if (p < 0) {
    tmp.copy(pose.t[k]).multiplyScalar(sq.racine.s).applyQuaternion(sq.racine.q);
    m.p[k].copy(sq.racine.t).add(tmp);
    m.q[k].copy(sq.racine.q).multiply(pose.q[k]);
  } else {
    tmp.copy(pose.t[k]).multiplyScalar(sq.racine.s).applyQuaternion(m.q[p]);
    m.p[k].copy(m.p[p]).add(tmp);
    m.q[k].copy(m.q[p]).multiply(pose.q[k]);
  }
}

/** Cinématique directe de tous les os (ou du sous-arbre de `depuis`, ses ancêtres étant à jour). */
export function fk(sq: Squelette, pose: PoseTigre, m: Monde, depuis = 0): Monde {
  fkOs(sq, pose, m, depuis);
  const pile = [...sq.enfants[depuis]];
  while (pile.length) {
    const k = pile.pop() as number;
    fkOs(sq, pose, m, k);
    for (const e of sq.enfants[k]) pile.push(e);
  }
  return m;
}

/** Place la racine : position et rotation voulues dans le repère du modèle. */
export function placerRacine(sq: Squelette, pose: PoseTigre, p: Vector3, q: Quaternion): void {
  const k = sq.i.racine;
  pose.t[k].copy(p).sub(sq.racine.t).applyQuaternion(sq.racine.qInv).divideScalar(sq.racine.s);
  pose.q[k].copy(sq.racine.qInv).multiply(q);
}

const qa = new Quaternion(), qb = new Quaternion();

/**
 * Rotation locale de l'os k = repos composé d'un delta `d` exprimé dans le repère du MODÈLE au
 * repos (« tourner l'épaule de 30° autour de X modèle »). Les axes locaux des os du GLB sont
 * hétérogènes : on ne code jamais d'axe local en dur.
 */
export function deltaModele(sq: Squelette, k: number, d: Quaternion, sortie: Quaternion): Quaternion {
  // local = qRepos · (W⁻¹ · d · W), W = rotation de l'os au repos dans le modèle
  qa.copy(sq.qModele[k]).invert().multiply(d).multiply(sq.qModele[k]);
  return sortie.copy(sq.qRepos[k]).multiply(qa);
}

/** Applique en plus un delta (repère modèle au repos) à la rotation locale courante de l'os k. */
export function ajouterDelta(sq: Squelette, pose: PoseTigre, k: number, d: Quaternion): void {
  qa.copy(sq.qModele[k]).invert().multiply(d).multiply(sq.qModele[k]);
  pose.q[k].multiply(qa);
}

/** Donne à l'os k la rotation `q` (repère du modèle) ; son parent doit être à jour dans `m`. */
export function orienterModele(sq: Squelette, pose: PoseTigre, m: Monde, k: number, q: Quaternion): void {
  const p = sq.parent[k];
  qb.copy(p < 0 ? sq.racine.q : m.q[p]).invert();
  pose.q[k].copy(qb).multiply(q);
  fkOs(sq, pose, m, k);
}

const axeY = new Vector3(0, 1, 0), dirRepos = new Vector3(), qd = new Quaternion();

/**
 * Oriente l'os k pour que son axe (+Y local, vers son enfant) pointe selon `dir` (repère modèle),
 * par la rotation minimale depuis son orientation de repos relative au parent courant (pas de
 * vrille parasite), ou depuis sa rotation posée (`depuisPose`). Le parent doit être à jour dans `m`.
 */
export function viserOs(sq: Squelette, pose: PoseTigre, m: Monde, k: number, dir: Vector3, depuisPose = false): void {
  const p = sq.parent[k];
  // Départ : orientation de repos relative au parent courant, ou (depuisPose) la rotation déjà
  // posée — petite correction, jamais de demi-tour instable quand la cible est à l'opposé du repos.
  qb.copy(p < 0 ? sq.racine.q : m.q[p]).multiply(depuisPose ? pose.q[k] : sq.qRepos[k]);
  dirRepos.copy(axeY).applyQuaternion(qb);
  qd.setFromUnitVectors(dirRepos, tmp.copy(dir).normalize());
  qa.copy(qd).multiply(qb);
  qb.copy(p < 0 ? sq.racine.q : m.q[p]).invert();
  pose.q[k].copy(qb).multiply(qa);
  fkOs(sq, pose, m, k);
}

/** Position modèle de repos d'un rôle (copie). */
export function reposDe(sq: Squelette, r: Role): Vector3 {
  return sq.pModele[sq.i[r]].clone();
}
