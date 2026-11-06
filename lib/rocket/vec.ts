/**
 * Rocket Muche : petites maths 3D PURES, partagées par tous les modules de `lib/rocket/` (aucun module ne doit en réécrire).
 * Repère : Y vers le haut, vecteurs `[x, y, z]` ; une `Base` est orthonormée directe avec `droite = avant × haut`.
 * Les variantes en `...Dans(sortie, …)` ne créent aucun objet : à préférer dans les boucles du pas de physique (120 Hz).
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (§1)
 */

export type Vec3 = [number, number, number];

/** Orientation d'un solide : trois axes unitaires orthogonaux, `droite = avant × haut`. */
export interface Base {
  avant: Vec3;
  droite: Vec3;
  haut: Vec3;
}

/** Composantes dans le repère d'une voiture : `[avant, droite, haut]`. */
export type VecLocal = [number, number, number];

export const ZERO = (): Vec3 => [0, 0, 0];
export const HAUT_MONDE: Readonly<Vec3> = [0, 1, 0];

export const clamp = (x: number, min: number, max: number): number => (x < min ? min : x > max ? max : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const signe = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);
/** Normalise un angle dans ]-π, π]. */
export function angleNormalise(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  else if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

export const ajouter = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const soustraire = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mult = (a: Readonly<Vec3>, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const croix = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norme = (a: Readonly<Vec3>): number => Math.hypot(a[0], a[1], a[2]);
export const norme2 = (a: Readonly<Vec3>): number => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const distance = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const copier = (a: Readonly<Vec3>): Vec3 => [a[0], a[1], a[2]];
export const melanger = (a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Vecteur unitaire de `a`, ou `repli` (défaut : vers le haut) si `a` est quasi nul. */
export function normaliser(a: Readonly<Vec3>, repli: Readonly<Vec3> = HAUT_MONDE): Vec3 {
  const n = norme(a);
  return n < 1e-9 ? copier(repli) : [a[0] / n, a[1] / n, a[2] / n];
}

/** `sortie ← a + b × k` (aucune allocation) ; `sortie` peut être `a` ou `b`. Rend `sortie`. */
export function ajouterDans(sortie: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>, k = 1): Vec3 {
  sortie[0] = a[0] + b[0] * k; sortie[1] = a[1] + b[1] * k; sortie[2] = a[2] + b[2] * k;
  return sortie;
}
/** `sortie ← v` (copie sans allocation). */
export function affecter(sortie: Vec3, v: Readonly<Vec3>): Vec3 {
  sortie[0] = v[0]; sortie[1] = v[1]; sortie[2] = v[2];
  return sortie;
}
/** Composante de `v` perpendiculaire à la normale unitaire `n` (projection sur le plan tangent). */
export function projeterSurPlan(v: Readonly<Vec3>, n: Readonly<Vec3>): Vec3 {
  const d = dot(v, n);
  return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
}
/** Réflexion de `v` sur un plan de normale unitaire `n`. */
export function reflechir(v: Readonly<Vec3>, n: Readonly<Vec3>): Vec3 {
  const d = 2 * dot(v, n);
  return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
}

// ---------- bases ----------

export function baseIdentite(): Base {
  return { avant: [0, 0, 1], droite: [-1, 0, 0], haut: [0, 1, 0] };
}
export function copierBase(b: Readonly<Base>): Base {
  return { avant: copier(b.avant), droite: copier(b.droite), haut: copier(b.haut) };
}
export function affecterBase(sortie: Base, b: Readonly<Base>): Base {
  affecter(sortie.avant, b.avant); affecter(sortie.droite, b.droite); affecter(sortie.haut, b.haut);
  return sortie;
}
/**
 * Base à plat dont l'avant vise `(sin cap, 0, cos cap)` : cap 0 = vers +Z (le but orange), cap π/2 = vers +X.
 * Même convention de cap partout (positions de coup d'envoi, bots, caméra).
 */
export function baseDepuisCap(cap: number): Base {
  const s = Math.sin(cap), c = Math.cos(cap);
  return { avant: [s, 0, c], droite: [-c, 0, s], haut: [0, 1, 0] };
}
/** Cap (rad) de l'avant projeté à l'horizontale ; 0 si l'avant est vertical. */
export const capDeBase = (b: Readonly<Base>): number => Math.atan2(b.avant[0], b.avant[2]);

/** Vecteur local `[avant, droite, haut]` → monde. */
export function localVersMonde(b: Readonly<Base>, l: Readonly<VecLocal>): Vec3 {
  return [
    b.avant[0] * l[0] + b.droite[0] * l[1] + b.haut[0] * l[2],
    b.avant[1] * l[0] + b.droite[1] * l[1] + b.haut[1] * l[2],
    b.avant[2] * l[0] + b.droite[2] * l[1] + b.haut[2] * l[2],
  ];
}
/** Vecteur monde → local `[avant, droite, haut]`. */
export function mondeVersLocal(b: Readonly<Base>, v: Readonly<Vec3>): VecLocal {
  return [dot(v, b.avant), dot(v, b.droite), dot(v, b.haut)];
}

/** Rotation de `v` d'un angle `a` (rad, sens direct) autour de l'axe UNITAIRE `axe` (Rodrigues). */
export function tournerVec(v: Readonly<Vec3>, axe: Readonly<Vec3>, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a), d = dot(axe, v) * (1 - c);
  const x = croix(axe, v);
  return [v[0] * c + x[0] * s + axe[0] * d, v[1] * c + x[1] * s + axe[1] * d, v[2] * c + x[2] * s + axe[2] * d];
}

/** Réorthonormalise une base dérivée (garde `haut`, recalcule `avant` puis `droite`) ; évite la dérive numérique. */
export function reorthonormaliser(b: Base): Base {
  const haut = normaliser(b.haut);
  let avant = projeterSurPlan(b.avant, haut);
  avant = normaliser(avant, croix(haut, b.droite));
  const droite = croix(avant, haut);
  affecter(b.avant, avant); affecter(b.droite, droite); affecter(b.haut, haut);
  return b;
}

/** Fait tourner la base de la vitesse angulaire MONDE `w` (rad/s) pendant `dt` (rotation de l'angle |w|·dt autour de ŵ), puis réorthonormalise. */
export function integrerBase(b: Base, w: Readonly<Vec3>, dt: number): Base {
  const n = norme(w);
  if (n * dt < 1e-12) return b;
  const axe: Vec3 = [w[0] / n, w[1] / n, w[2] / n];
  const a = n * dt;
  affecter(b.avant, tournerVec(b.avant, axe, a));
  affecter(b.droite, tournerVec(b.droite, axe, a));
  affecter(b.haut, tournerVec(b.haut, axe, a));
  return reorthonormaliser(b);
}

/** Base la plus proche de `b` dont le haut est `normale` (sert à poser une voiture sur une surface) : l'avant glisse dans le plan tangent. */
export function alignerSurNormale(b: Readonly<Base>, normale: Readonly<Vec3>): Base {
  const haut = normaliser(normale);
  const avant = normaliser(projeterSurPlan(b.avant, haut), croix(haut, b.droite));
  return { avant, droite: croix(avant, haut), haut };
}

/** Axe et angle de la rotation la plus courte qui amène `haut` de `b` sur `cible` (axe nul si alignés). */
export function rotationVers(depart: Readonly<Vec3>, cible: Readonly<Vec3>): { axe: Vec3; angle: number } {
  const c = croix(depart, cible);
  const s = norme(c);
  const angle = Math.atan2(s, dot(depart, cible));
  return { axe: s < 1e-9 ? [0, 0, 0] : [c[0] / s, c[1] / s, c[2] / s], angle };
}
