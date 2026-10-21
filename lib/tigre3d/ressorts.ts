/**
 * Ressorts et bruit (purs, indépendants du pas de temps) : tout ce qui raccorde deux états du
 * tigre passe par là au lieu d'un fondu figé. Un ressort a une position ET une vitesse : quand la
 * cible change en route, il repart sans cassure.
 */

/** Ressort scalaire amorti critique (forme fermée : exact quel que soit dt). */
export interface Ressort { x: number; v: number }

export function ressort(x = 0, v = 0): Ressort { return { x, v }; }

/**
 * Avance un ressort critique de pulsation `omega` (rad/s) vers `cible`. Temps de réponse à 95 %
 * ≈ 4,7 / omega. Retourne la nouvelle position.
 */
export function amortir(r: Ressort, cible: number, omega: number, dt: number): number {
  if (dt <= 0) return r.x;
  const e = r.x - cible;
  const j = r.v + omega * e;
  const ex = Math.exp(-omega * dt);
  r.x = cible + (e + j * dt) * ex;
  r.v = (r.v - omega * j * dt) * ex;
  return r.x;
}

/** Même ressort, sur un angle : suit le plus court chemin vers la cible (modulo 2π). */
export function amortirAngle(r: Ressort, cible: number, omega: number, dt: number): number {
  let d = (cible - r.x) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return amortir(r, r.x + d, omega, dt);
}

/**
 * Dynamique du second ordre (f, ζ, r) : f = fréquence propre (Hz), ζ = amortissement
 * (< 1 : dépassement), r = réponse initiale (< 0 : anticipation, le mouvement part d'abord à
 * l'envers ; > 1 : il devance la cible). Intégration semi-implicite stable, sous-pas si dt est grand.
 */
export interface SecondOrdre { y: number; v: number; xPrec: number; k1: number; k2: number; k3: number }

export function secondOrdre(f: number, zeta: number, r: number, x0 = 0): SecondOrdre {
  const w = 2 * Math.PI * f;
  return { y: x0, v: 0, xPrec: x0, k1: zeta / (Math.PI * f), k2: 1 / (w * w), k3: (r * zeta) / w };
}

export function avancerSecondOrdre(s: SecondOrdre, x: number, dt: number): number {
  if (dt <= 0) return s.y;
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  const xd = (x - s.xPrec) / dt;
  s.xPrec = x;
  for (let i = 0; i < n; i++) {
    const k2 = Math.max(s.k2, 1.1 * (h * h / 4 + h * s.k1 / 2));
    s.y += h * s.v;
    s.v += (h * (x + s.k3 * xd - s.y - s.k1 * s.v)) / k2;
  }
  return s.y;
}

/** Hachage entier → [0, 1[ (reproductible). */
function hache(i: number, graine: number): number {
  let h = (i * 374761393 + graine * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Bruit de valeur 1D lissé (quintique), dans [-1, 1], non périodique : la base des micro-mouvements
 * (tête, queue, oreilles, cadence) pour que deux secondes ne se ressemblent jamais exactement.
 */
export function bruit(t: number, graine = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hache(i, graine), b = hache(i + 1, graine);
  return (a + (b - a) * s) * 2 - 1;
}

/** Somme de deux octaves de bruit (variations lentes + un peu de grain), dans ≈ [-1, 1]. */
export function bruitDouble(t: number, graine = 0): number {
  return bruit(t, graine) * 0.7 + bruit(t * 2.37 + 11.3, graine + 7) * 0.3;
}

export const borne = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lisse = (x: number) => { const t = borne(x, 0, 1); return t * t * (3 - 2 * t); };
export const tresLisse = (x: number) => { const t = borne(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Rampe lissée de 0 (t ≤ a) à 1 (t ≥ b). */
export const rampe = (t: number, a: number, b: number) => lisse((t - a) / (b - a));
/** Bosse lissée : monte de a à b, tient, redescend de c à d. */
export const bosse = (t: number, a: number, b: number, c: number, d: number) => rampe(t, a, b) * (1 - rampe(t, c, d));
