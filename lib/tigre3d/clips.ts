/**
 * Clips d'images (pur) : une `PoseGeste` par image, interpolée entre les images (Catmull-Rom pour
 * les nombres et les cibles, slerp pour les rotations). C'est le format commun des clips du GLB
 * (convertis au chargement par `clipDepuisPistes`) et des clips capturés hors ligne
 * (lib/tigre3d/clips/*.json, ex. le chat « shake my hand »).
 *
 * Registre : `enregistrerClip(nom, clip)` / `clipNomme(nom)`. Les clips du GLB y sont mis par
 * lib/tigre3d/modele.ts au chargement (« Curious », « Trick », « Attack jump », « Walking ») ; un
 * geste qui en dépend doit prévoir le cas `null` (tests, GLB pas encore chargé).
 */
import { Quaternion, Vector3 } from "three";
import { NOMS_OS, ROLES, type Role } from "./os";
import type { Squelette } from "./squelette";
import type { ClipImages, PoseGeste, Quat, Vec3 } from "./gestes/types";

const registre = new Map<string, ClipImages>();
export function enregistrerClip(nom: string, clip: ClipImages): void { registre.set(nom, clip); }
export function clipNomme(nom: string): ClipImages | null { return registre.get(nom) ?? null; }
export function oublierClips(): void { registre.clear(); }

export function dureeClip(c: ClipImages): number { return Math.max(0, (c.images.length - 1) / c.fps); }

const qa = new Quaternion(), qb = new Quaternion();

/** Catmull-Rom uniforme entre b et c (a, d voisins), k ∈ [0, 1]. */
function cr(a: number, b: number, c: number, d: number, k: number): number {
  const k2 = k * k, k3 = k2 * k;
  return 0.5 * (2 * b + (-a + c) * k + (2 * a - 5 * b + 4 * c - d) * k2 + (-a + 3 * b - 3 * c + d) * k3);
}

type Champ = Record<string, unknown> | undefined;

function interpVec(A: Champ, B: Champ, P: Champ, N: Champ, k: number): Record<string, number[]> | undefined {
  if (!A && !B) return undefined;
  const r: Record<string, number[]> = {};
  const cles = new Set([...Object.keys(A ?? {}), ...Object.keys(B ?? {})]);
  for (const c of cles) {
    const a = (A?.[c] ?? B?.[c]) as number[], b = (B?.[c] ?? a) as number[];
    const p = ((P?.[c] as number[]) ?? a), n = ((N?.[c] as number[]) ?? b);
    r[c] = a.map((x, i) => cr(p[i] ?? x, x, b[i] ?? x, n[i] ?? b[i] ?? x, k));
  }
  return r;
}

function interpNum<T extends Record<string, unknown>>(A: T | undefined, B: T | undefined, P: T | undefined, N: T | undefined, k: number): T | undefined {
  if (!A && !B) return undefined;
  const r: Record<string, unknown> = {};
  const cles = new Set([...Object.keys(A ?? {}), ...Object.keys(B ?? {})]);
  for (const c of cles) {
    const a = (A?.[c] ?? B?.[c]), b = (B?.[c] ?? a);
    if (typeof a !== "number" || typeof b !== "number") { r[c] = k < 0.5 ? a : b; continue; }
    const p = typeof P?.[c] === "number" ? (P[c] as number) : a, n = typeof N?.[c] === "number" ? (N[c] as number) : b;
    r[c] = cr(p, a, b, n, k);
  }
  return r as T;
}

/**
 * Pose du clip à l'instant t (s). Hors bornes : première / dernière image (ou bouclé si `boucle`).
 */
export function echantillonnerClip(c: ClipImages, t: number, boucle = false): PoseGeste {
  const n = c.images.length;
  if (n === 0) return {};
  if (n === 1) return c.images[0];
  let f = t * c.fps;
  if (boucle) f = ((f % (n - 1)) + (n - 1)) % (n - 1);
  f = Math.min(Math.max(f, 0), n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  const A = c.images[i], B = c.images[i + 1];
  const P = c.images[Math.max(0, i - 1)], N = c.images[Math.min(n - 1, i + 2)];
  const r: PoseGeste = {};
  if (A.corps || B.corps) r.corps = interpNum(A.corps, B.corps, P.corps, N.corps, k);
  const d = interpVec(A.deltas, B.deltas, P.deltas, N.deltas, k);
  if (d) r.deltas = d as unknown as PoseGeste["deltas"];
  const tr = interpVec(A.t, B.t, P.t, N.t, k);
  if (tr) r.t = tr as unknown as PoseGeste["t"];
  if (A.os || B.os) {
    const o: Partial<Record<Role, Quat>> = {};
    for (const cle of new Set([...Object.keys(A.os ?? {}), ...Object.keys(B.os ?? {})]) as Set<Role>) {
      const a = A.os?.[cle] ?? B.os?.[cle], b = B.os?.[cle] ?? a;
      if (!a || !b) continue;
      qa.set(a[0], a[1], a[2], a[3]).slerp(qb.set(b[0], b[1], b[2], b[3]), k);
      o[cle] = [qa.x, qa.y, qa.z, qa.w];
    }
    r.os = o;
  }
  if (A.pattes || B.pattes) {
    const p: NonNullable<PoseGeste["pattes"]> = {};
    for (const cle of new Set([...Object.keys(A.pattes ?? {}), ...Object.keys(B.pattes ?? {})]) as Set<keyof NonNullable<PoseGeste["pattes"]>>) {
      const a = A.pattes?.[cle] ?? B.pattes?.[cle], b = B.pattes?.[cle] ?? a;
      if (!a || !b) continue;
      const pa = P.pattes?.[cle] ?? a, nb = N.pattes?.[cle] ?? b;
      const cible = [0, 1, 2].map((j) => cr(pa.cible[j], a.cible[j], b.cible[j], nb.cible[j], k)) as unknown as Vec3;
      const ext = a.extremite && b.extremite ? ([0, 1, 2].map((j) => a.extremite![j] + (b.extremite![j] - a.extremite![j]) * k) as unknown as Vec3) : (a.extremite ?? b.extremite);
      p[cle] = ext ? { cible, extremite: ext } : { cible };
    }
    r.pattes = p;
  }
  for (const champ of ["regard", "avance"] as const) {
    const a = A[champ], b = B[champ];
    if (a != null || b != null) r[champ] = cr(P[champ] ?? a ?? b ?? 0, a ?? b ?? 0, b ?? a ?? 0, N[champ] ?? b ?? a ?? 0, k);
  }
  if (A.poids || B.poids) r.poids = interpNum(A.poids, B.poids, P.poids, N.poids, k);
  return r;
}

/** Une piste three (KeyframeTrack) réduite à ce qui sert ici. */
export interface Piste { name: string; times: ArrayLike<number>; values: ArrayLike<number> }

function echantillonPiste(p: Piste, t: number, taille: number, sortie: number[]): number[] {
  const T = p.times, V = p.values, n = T.length;
  if (t <= T[0]) { for (let j = 0; j < taille; j++) sortie[j] = V[j]; return sortie; }
  if (t >= T[n - 1]) { for (let j = 0; j < taille; j++) sortie[j] = V[(n - 1) * taille + j]; return sortie; }
  let i = 0;
  while (i < n - 2 && T[i + 1] < t) i++;
  const k = (t - T[i]) / (T[i + 1] - T[i]);
  if (taille === 4) {
    qa.fromArray(V as number[], i * 4).slerp(qb.fromArray(V as number[], (i + 1) * 4), k);
    sortie[0] = qa.x; sortie[1] = qa.y; sortie[2] = qa.z; sortie[3] = qa.w;
  } else for (let j = 0; j < taille; j++) sortie[j] = V[i * taille + j] + (V[(i + 1) * taille + j] - V[i * taille + j]) * k;
  return sortie;
}

/**
 * Convertit un clip three (pistes `<os>.quaternion` / `<os>.position`) en clip d'images par rôle.
 * Avec `extraireAvance`, la translation d'ensemble vers l'avant (root motion d'« Attack jump »,
 * portée par les os enfants de la racine) est retirée des os et rendue dans `avance` (m du modèle,
 * vers +Z) : la troupe avance d'autant, les pieds ne glissent pas.
 */
export function clipDepuisPistes(
  nom: string, duree: number, pistes: Piste[], sq: Squelette, fps = 30, extraireAvance = false,
): ClipImages {
  const parNom = new Map<string, Role>();
  for (const r of ROLES) parNom.set(NOMS_OS[r], r);
  const rot: Array<[Role, Piste]> = [], pos: Array<[Role, Piste]> = [];
  for (const p of pistes) {
    const [os, prop] = p.name.split(".");
    const r = parNom.get(os);
    if (!r) continue;
    if (prop === "quaternion") rot.push([r, p]);
    else if (prop === "position") pos.push([r, p]);
  }
  // Os qui portent la root motion : enfants de la racine translatés ensemble.
  const enfantsRacine = new Set(sq.enfants[sq.i.racine].map((k) => sq.noms[k]));
  const porteurs = pos.filter(([r]) => enfantsRacine.has(NOMS_OS[r]));
  const n = Math.max(2, Math.round(duree * fps) + 1);
  const images: PoseGeste[] = [];
  const tmp: number[] = [0, 0, 0, 0];
  const dRacine = new Vector3();
  for (let i = 0; i < n; i++) {
    const t = Math.min(duree, i / fps);
    const img: PoseGeste = {};
    const os: Partial<Record<Role, Quat>> = {};
    for (const [r, p] of rot) {
      echantillonPiste(p, t, 4, tmp);
      os[r] = [+tmp[0].toFixed(5), +tmp[1].toFixed(5), +tmp[2].toFixed(5), +tmp[3].toFixed(5)];
    }
    img.os = os;
    let avance = 0;
    if (extraireAvance && porteurs.length) {
      // Décalage moyen (repère du modèle) des porteurs par rapport au repos.
      dRacine.set(0, 0, 0);
      for (const [r, p] of porteurs) {
        echantillonPiste(p, t, 3, tmp);
        const k = sq.i[r];
        dRacine.add(new Vector3(tmp[0], tmp[1], tmp[2]).sub(sq.tRepos[k]));
      }
      dRacine.divideScalar(porteurs.length).multiplyScalar(sq.racine.s).applyQuaternion(sq.racine.q);
      avance = dRacine.z;
      img.avance = +avance.toFixed(5);
    }
    if (pos.length) {
      const tr: Partial<Record<Role, Vec3>> = {};
      for (const [r, p] of pos) {
        echantillonPiste(p, t, 3, tmp);
        const v = new Vector3(tmp[0], tmp[1], tmp[2]);
        if (avance && enfantsRacine.has(NOMS_OS[r])) {
          // Retire l'avance (repère du modèle → local de la racine, au repos).
          v.sub(new Vector3(0, 0, avance).applyQuaternion(sq.racine.qInv).divideScalar(sq.racine.s));
        }
        tr[r] = [+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5)];
      }
      img.t = tr;
    }
    images.push(img);
  }
  return { nom, fps, images };
}
