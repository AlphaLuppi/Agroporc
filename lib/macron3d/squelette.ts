/**
 * Squelette de repos du coureur et cinématique directe, avec les seules maths de three (Vector3,
 * Quaternion : aucun WebGL) : la même structure sert au site (lue sur les os du GLB chargé) et
 * aux tests (lue dans le chunk JSON du GLB par lib/tigre3d/extraction.mjs).
 *
 * « Monde » = repère du modèle (gltf.scene) : les nœuds Sketchfab au-dessus de _rootJoint
 * s'annulent (−90° puis +90° autour de X), le parent de la racine est l'identité.
 */
import { Quaternion, Vector3 } from "three";
import { indexerRoles, type Role } from "./os";

export interface DonneesOs { nom: string; parent: number; t: number[]; q: number[] }

export interface Squelette {
  noms: string[];
  /** Parent de chaque os (−1 pour la racine) ; les parents précèdent toujours leurs enfants. */
  parent: number[];
  /** TRS locaux de repos. */
  t: Vector3[];
  q: Quaternion[];
  /** Repos dans le repère du modèle. */
  pM: Vector3[];
  qM: Quaternion[];
  i: Record<Role, number>;
}

/** Pose : rotation locale de chaque os, translation locale de chaque os (repos sauf le bassin). */
export interface Pose { q: Quaternion[]; t: Vector3[] }
/** Résultat de la cinématique directe (repère du modèle). */
export interface Monde { p: Vector3[]; q: Quaternion[] }

export function creerSquelette(os: readonly DonneesOs[]): Squelette {
  os.forEach((o, k) => {
    if (o.parent >= k) throw new Error("coureur 3D : squelette mal ordonné (parent après l'enfant)");
  });
  const t = os.map((o) => new Vector3(o.t[0], o.t[1], o.t[2]));
  const q = os.map((o) => new Quaternion(o.q[0], o.q[1], o.q[2], o.q[3]).normalize());
  const sq: Squelette = {
    noms: os.map((o) => o.nom),
    parent: os.map((o) => o.parent),
    t, q, pM: [], qM: [],
    i: indexerRoles(os.map((o) => o.nom)),
  };
  const m = creerMonde(sq);
  fk(sq, { q, t }, m);
  sq.pM = m.p;
  sq.qM = m.q;
  return sq;
}

export function nouvellePose(sq: Squelette): Pose {
  return { q: sq.q.map((q) => q.clone()), t: sq.t.map((t) => t.clone()) };
}

export function creerMonde(sq: Squelette): Monde {
  return { p: sq.t.map(() => new Vector3()), q: sq.q.map(() => new Quaternion()) };
}

const v = new Vector3();

/** Monde d'un seul os à partir de celui de son parent (déjà calculé). */
export function fkOs(sq: Squelette, pose: Pose, m: Monde, k: number): void {
  const p = sq.parent[k];
  if (p < 0) {
    m.p[k].copy(pose.t[k]);
    m.q[k].copy(pose.q[k]);
    return;
  }
  v.copy(pose.t[k]).applyQuaternion(m.q[p]);
  m.p[k].copy(m.p[p]).add(v);
  m.q[k].copy(m.q[p]).multiply(pose.q[k]);
}

/** Cinématique directe complète. */
export function fk(sq: Squelette, pose: Pose, m: Monde): void {
  for (let k = 0; k < sq.noms.length; k++) fkOs(sq, pose, m, k);
}

/** Longueur de repos entre deux os (m). */
export function distanceRepos(sq: Squelette, a: Role, b: Role): number {
  return sq.pM[sq.i[a]].distanceTo(sq.pM[sq.i[b]]);
}
