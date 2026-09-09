import type { Poi } from "./types";

/** En dessous de cette distance (m), deux marqueurs d'un même bâtiment se chevaucheraient à l'écran. */
export const DISTANCE_MIN = 24;
export const DECALAGE = 12;
/** Surélévation (m) du second marqueur d'un bâtiment partagé : les étiquettes ne se recouvrent plus. */
export const ETAGE = 24;

export interface Decalage {
  /** décalage horizontal en x (m) */
  dx: number;
  /** surélévation du faisceau et de l'étiquette (m) */
  dy: number;
}

/**
 * Décalage du marqueur de chaque POI. Deux restos posés sur le même bâtiment (Basilic n'Go et
 * La Mijote) voient le second surélevé de ETAGE pour que les étiquettes ne se recouvrent pas
 * quel que soit l'angle de vue ; s'ils sont en plus trop proches l'un de l'autre, ils sont
 * écartés de ±DECALAGE en x. Des POI déjà distants gardent leur x exact, sinon leurs étiquettes
 * sortiraient de l'emprise du bâtiment.
 */
export function decalages(pois: Poi[]): Map<string, Decalage> {
  const out = new Map<string, Decalage>(pois.map((p) => [p.id, { dx: 0, dy: 0 }]));
  const parBatiment = new Map<number, Poi[]>();
  for (const p of pois) {
    if (p.type === "resto" || p.type === "home") parBatiment.set(p.b, [...(parBatiment.get(p.b) ?? []), p]);
  }
  for (const grp of parBatiment.values()) {
    if (grp.length !== 2) continue;
    const [a, b] = grp;
    const proches = Math.hypot(a.x - b.x, a.z - b.z) < DISTANCE_MIN;
    out.set(a.id, { dx: proches ? -DECALAGE : 0, dy: 0 });
    out.set(b.id, { dx: proches ? DECALAGE : 0, dy: ETAGE });
  }
  return out;
}
