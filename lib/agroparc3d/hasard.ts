/**
 * Hasard déterministe du décor (PUR) : hachage entier 32 bits (miroir du nuanceur des façades, produits modulo 2^32) et générateur mulberry32.
 * Partagé par facade.ts (fenêtres allumées, équipements de toit) et les placements de décor (arbres, mobilier, styles de façade) : jamais de
 * `Math.random`, le même `SceneData` donne toujours le même décor.
 */

/** Hachage entier 32 bits : identique à `hachageB` du nuanceur de façade (decor.ts). */
export function hachage32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

export function mulberry32(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage d'une position (x, z) arrondie à 10 cm, salé : un entier 32 bits non signé. */
export function hachagePos(x: number, z: number, sel = 0): number {
  return hachage32((Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663) ^ Math.imul(sel | 0, 83492791)) >>> 0);
}

/** Flottant dans [0, 1[ tiré du hachage d'une position. */
export function alea01(x: number, z: number, sel = 0): number {
  return hachagePos(x, z, sel) / 4294967296;
}
