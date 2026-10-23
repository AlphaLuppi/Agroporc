/**
 * Circulation PNJ (PUR) : 4 circuits fermés, 12 voitures dont la position est une FONCTION PURE de l'horloge serveur
 * (`s = (s0 + v·(t − T0)) mod L`) : zéro bande passante, calculée à l'identique par le client et le serveur. Les voitures écrasent
 * (mort immédiate) les joueurs à pied, testés chacun à leur propre instant `tMs = etatT − ping/2` (équité, marge 0).
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.11, §5.5, annexe §10)
 *
 * Aucune horloge ni hasard globaux : l'instant est toujours un paramètre.
 */
import { distSegment } from "../agroparc3d/cachettes";
import type { Vec2 } from "../agroparc3d/types";
import type { Vec3 } from "./protocole";

export const VOITURE = { longueur: 4.4, largeur: 1.9, hauteur: 1.5 } as const;
/** Référence de temps commune (ms epoch) : s = (s0 + v·(t − T0)/1000) mod L. */
export const T0_MS = 1_700_000_000_000;
/** Vitesse unique des quatre circuits (m/s) : ils partagent des arcs de l'anneau, des vitesses différentes feraient se traverser les voitures. */
export const VITESSE_PNJ_M_S = 9;
export interface CircuitDef { id: "anneau" | "sud" | "nord_est" | "ouest"; points: readonly Vec2[]; decalageVoie: number; vitesse: number; voitures: number }

/** Annexe §10 : sens antihoraire sur l'anneau, tous à VITESSE_PNJ_M_S. Le lot D les revalide dans `circulation.test.ts` et peut les re-échantillonner. */
export const CIRCUITS: readonly CircuitDef[] = [
  {
    id: "anneau", decalageVoie: 3.2, vitesse: VITESSE_PNJ_M_S, voitures: 3,
    points: [[46.3, 5.8], [43.8, -7.3], [32.9, -15.2], [19.6, -13.5], [11, -3.2], [11.1, 8.5], [14, 13.7], [23.8, 20.1], [31.2, 20.5], [38.1, 17.8], [43.5, 12.7], [46.3, 5.8]],
  },
  {
    id: "sud", decalageVoie: 0.6, vitesse: VITESSE_PNJ_M_S, voitures: 2,
    points: [[46.3, 5.8], [116.3, 25.1], [103.3, 67.4], [89.1, 63.1], [78.5, 94.1], [7.7, 80], [-4.5, 73.9], [17.3, 44.7], [23.8, 20.1], [31.2, 20.5], [38.1, 17.8], [43.5, 12.7], [46.3, 5.8]],
  },
  {
    id: "nord_est", decalageVoie: 1.5, vitesse: VITESSE_PNJ_M_S, voitures: 3,
    points: [[46.3, 5.8], [43.8, -7.3], [32.9, -15.2], [36.6, -44], [29.5, -131.5], [48.8, -129.2], [229.4, -77.8], [234.5, -73.3], [206.5, 29.4], [95.9, -4.3], [88.8, 16.9], [46.3, 5.8]],
  },
  {
    id: "ouest", decalageVoie: 1.5, vitesse: VITESSE_PNJ_M_S, voitures: 4,
    points: [[46.3, 5.8], [43.8, -7.3], [32.9, -15.2], [19.6, -13.5], [11, -3.2], [-62, -21], [-73.7, -27.3], [-105.2, -34.9], [-115.3, -34.9], [-184.6, -54.9], [-228.7, 75.4], [-110, 116.4], [-41.5, 146.8], [-17.6, 92], [17.3, 44.7], [23.8, 20.1], [31.2, 20.5], [38.1, 17.8], [43.5, 12.7], [46.3, 5.8]],
  },
];

/** Facteur maximal du décalage aux coins : la mitre `1 / cos(θ/2)` vaut 1,56 à 100° ; au-delà de 2 (virage > 120°) elle est tronquée. */
export const MITRE_MAX = 2;
/** Demi-corde (m) qui donne le cap : direction de P(s + 2) − P(s − 2), continue aux coins (la tangente d'une polyligne saute de 100°). */
export const DEMI_CORDE_M = 2;
/** Sous cette hauteur de pieds, un joueur est sous la voiture / contre sa carrosserie ; plus haut (toit, saut), il est épargné. */
export const MARGE_PIEDS_M = 0.1;
/** Distance minimale (m) d'un point d'apparition à l'axe d'un circuit, et nombre minimal de points à garder (§2.10). */
export const DISTANCE_APPARITION_MIN_M = 4;
export const APPARITIONS_MIN_RESTANTES = 30;

/** pts = ligne décalée à droite (jonctions en MITRE bornée aux coins, jusqu'à 100°), fermée. */
export interface Circuit { def: CircuitDef; pts: Vec2[]; cumul: number[]; longueur: number }

/**
 * Décale la polyligne fermée `axe` (premier = dernier point) de `d` mètres à DROITE du sens de marche (`(−hz, hx)` pour un cap `(hx, hz)`, z vers le sud).
 * Chaque sommet est déplacé le long de la bissectrice des normales des deux segments voisins, de `d / cos(θ/2)` (mitre), bornée à `MITRE_MAX × d`.
 * Le sommet de fermeture raccorde le dernier segment au premier : la ligne reste fermée et sans pointe.
 */
function decaler(axe: readonly Vec2[], d: number): Vec2[] {
  // sommets distincts consécutifs, sans le doublon de fermeture
  const sommets: Vec2[] = [];
  for (const p of axe) {
    const q = sommets[sommets.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) sommets.push([p[0], p[1]]);
  }
  while (sommets.length > 1 && sommets[0][0] === sommets[sommets.length - 1][0] && sommets[0][1] === sommets[sommets.length - 1][1]) sommets.pop();
  const n = sommets.length;
  // normale droite de chaque segment i (sommet i → i + 1)
  const normales: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = sommets[i], b = sommets[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    normales.push([-(b[1] - a[1]) / l, (b[0] - a[0]) / l]);
  }
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const n0 = normales[(i + n - 1) % n], n1 = normales[i];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const lm = Math.hypot(mx, mz);
    if (lm < 1e-9) { mx = n1[0]; mz = n1[1]; } else { mx /= lm; mz /= lm; }
    const cosMoitie = mx * n1[0] + mz * n1[1];
    const facteur = Math.min(MITRE_MAX, 1 / Math.max(cosMoitie, 1e-9));
    pts.push([sommets[i][0] + mx * d * facteur, sommets[i][1] + mz * d * facteur]);
  }
  pts.push([pts[0][0], pts[0][1]]);
  return pts;
}

export function construireCircuits(defs: readonly CircuitDef[] = CIRCUITS): Circuit[] {
  return defs.map((def) => {
    const pts = decaler(def.points, def.decalageVoie);
    const cumul = [0];
    for (let i = 1; i < pts.length; i++) cumul.push(cumul[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { def, pts, cumul, longueur: cumul[cumul.length - 1] };
  });
}

export interface VoiturePnj { id: number; circuit: number; s0: number; teinte: number }
/** Angle d'or (degrés) : teintes bien réparties quel que soit le nombre de voitures. */
const ANGLE_OR_DEG = 137.508;
/**
 * 12 voitures, déterministe, espacées de L/n sur leur circuit. Chaque circuit est décalé d'un quart d'espacement par rang de circuit :
 * à `T0_MS` les quatre circuits partent du même nœud (le rond-point est) et leurs premières voitures ne s'y croiseraient pas à la fois.
 * `teinte` en degrés [0, 360) (teinte HSL de la carrosserie).
 */
export function flotte(circuits: readonly Circuit[]): VoiturePnj[] {
  const voitures: VoiturePnj[] = [];
  circuits.forEach((c, ic) => {
    const n = c.def.voitures;
    for (let k = 0; k < n; k++) {
      const id = voitures.length;
      voitures.push({ id, circuit: ic, s0: ((k + ic * 0.25) / n) * c.longueur, teinte: (id * ANGLE_OR_DEG) % 360 });
    }
  });
  return voitures;
}

/** p = centre au sol, v ≥ 0 ; cap (convention lacet) = direction de la CORDE entre s − 2 m et s + 2 m (continu aux coins, pas la tangente de la polyligne). */
export interface EtatVoiture { p: Vec3; cap: number; v: number }

/** Abscisse curviligne (m, dans [0, L[) de la voiture à l'instant `tMs` (horloge serveur, ms epoch). */
function abscisse(c: Circuit, v: VoiturePnj, tMs: number): number {
  // (tMs − T0) d'abord : à 1,7·10¹² ms la multiplication par la vitesse perdrait la précision du centimètre
  const s = v.s0 + (c.def.vitesse * (tMs - T0_MS)) / 1000;
  const r = s % c.longueur;
  return r < 0 ? r + c.longueur : r;
}

/** Position (x, z) sur la ligne décalée à l'abscisse `s` (bouclée), recherche dichotomique dans `cumul`. */
function positionSur(c: Circuit, s: number): Vec2 {
  const L = c.longueur;
  s %= L;
  if (s < 0) s += L;
  let lo = 0, hi = c.cumul.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.cumul[mid] <= s) lo = mid; else hi = mid;
  }
  const l = c.cumul[hi] - c.cumul[lo];
  const t = l > 0 ? (s - c.cumul[lo]) / l : 0;
  return [c.pts[lo][0] + (c.pts[hi][0] - c.pts[lo][0]) * t, c.pts[lo][1] + (c.pts[hi][1] - c.pts[lo][1]) * t];
}

/** Position seule (sans cap) : le tri grossier d'`ecrasements` n'a pas besoin des deux points de la corde. */
function centreVoiture(c: Circuit, v: VoiturePnj, tMs: number): Vec2 {
  return positionSur(c, abscisse(c, v, tMs));
}

export function etatVoiture(c: Circuit, v: VoiturePnj, tMs: number): EtatVoiture {
  const s = abscisse(c, v, tMs);
  const [x, z] = positionSur(c, s);
  const a = positionSur(c, s - DEMI_CORDE_M), b = positionSur(c, s + DEMI_CORDE_M);
  const dx = b[0] - a[0], dz = b[1] - a[1];
  return { p: [x, 0, z], cap: Math.atan2(-dx, -dz), v: c.def.vitesse };
}

export interface BoiteVoiture { cx: number; cz: number; ux: number; uz: number; demiLongueur: number; demiLargeur: number }
/** Boîte orientée au sol : (ux, uz) = avant de la voiture (convention lacet : `(−sin cap, −cos cap)`), élargie de `marge` de chaque côté. */
export function boiteVoiture(e: EtatVoiture, marge = 0): BoiteVoiture {
  return {
    cx: e.p[0], cz: e.p[2], ux: -Math.sin(e.cap), uz: -Math.cos(e.cap),
    demiLongueur: VOITURE.longueur / 2 + marge, demiLargeur: VOITURE.largeur / 2 + marge,
  };
}

/** Cylindre (rayon `rayon`, pieds p) recoupant la boîte, pieds sous VOITURE.hauteur + 0,1 ; marge 0 par défaut (équité : aucun biais contre le joueur). */
export function joueurEcrase(e: EtatVoiture, p: Vec3, rayon: number, marge = 0): boolean {
  if (p[1] >= VOITURE.hauteur + MARGE_PIEDS_M) return false;
  const b = boiteVoiture(e, marge);
  const dx = p[0] - b.cx, dz = p[2] - b.cz;
  // repère de la voiture : longitudinal (avant) et latéral (droite = (−uz, ux))
  const lon = Math.abs(dx * b.ux + dz * b.uz), lat = Math.abs(-dx * b.uz + dz * b.ux);
  const ex = Math.max(0, lon - b.demiLongueur), ez = Math.max(0, lat - b.demiLargeur);
  return ex * ex + ez * ez <= rayon * rayon;
}

/** Rayon du cercle qui contient la boîte d'une voiture : au-delà (plus `rayon`), aucun joueur ne peut être touché, inutile de calculer le cap. */
const RAYON_ENGLOBANT_M = Math.hypot(VOITURE.longueur / 2, VOITURE.largeur / 2);

/**
 * Ids des joueurs écrasés. Chaque joueur a SON instant `tMs` (instant de capture estimé de `p` = `etatT − ping/2`) : le client dessine la voiture à
 * `maintenantServeur()` et reporte sa position à cet instant, tester tout le monde à l'instant courant décalerait de 0,5 à 1 m à 9 m/s.
 */
export function ecrasements(
  circuits: readonly Circuit[], voitures: readonly VoiturePnj[],
  joueurs: readonly { id: string; p: Vec3; tMs: number }[], rayon: number, marge = 0,
): string[] {
  const ids: string[] = [];
  const portee = RAYON_ENGLOBANT_M + marge + rayon;
  for (const j of joueurs) {
    for (const v of voitures) {
      const c = circuits[v.circuit];
      const [x, z] = centreVoiture(c, v, j.tMs);
      if (Math.hypot(j.p[0] - x, j.p[2] - z) > portee) continue;
      if (joueurEcrase(etatVoiture(c, v, j.tMs), j.p, rayon, marge)) { ids.push(j.id); break; }
    }
  }
  return ids;
}

/** Distance (m) de (x, z) à la ligne décalée la plus proche ; sert à écarter les points d'apparition à < 4 m d'un circuit. */
export function distanceAuxCircuits(circuits: readonly Circuit[], x: number, z: number): number {
  let d = Infinity;
  for (const c of circuits) {
    for (let i = 1; i < c.pts.length; i++) d = Math.min(d, distSegment(x, z, c.pts[i - 1][0], c.pts[i - 1][1], c.pts[i][0], c.pts[i][1]));
  }
  return d;
}

/** Écarte les points à moins de `distMin` (4 m) d'un circuit ; si moins de `minRestant` (30) points resteraient, renvoie `points` tel quel. */
export function ecarterDesCircuits(
  points: readonly Vec2[], circuits: readonly Circuit[], distMin = DISTANCE_APPARITION_MIN_M, minRestant = APPARITIONS_MIN_RESTANTES,
): Vec2[] {
  const restants = points.filter(([x, z]) => distanceAuxCircuits(circuits, x, z) >= distMin);
  return restants.length < minRestant ? [...points] : restants;
}
