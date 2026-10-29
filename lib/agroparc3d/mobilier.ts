/**
 * Mobilier urbain d'Agroparc (PUR) : lampadaires, panneaux (stop, cédez-le-passage, passage piéton, arrêt de bus), abris de bus, bancs,
 * corbeilles, racks à vélos, portails. Les nœuds OpenStreetMap de `decor.json` sont complétés par des règles (OSM ne compte que 42 lampadaires
 * sur une zone de 780 × 480 m) ; aucun feu tricolore n'est inventé (il n'y en a aucun dans OSM). Rendu seulement : aucune collision, ni
 * pour `construireMonde`, ni pour `tir.ts`, ni pour la navigation (les balles traversent le mobilier comme les arbres).
 * Spec : docs/superpowers/specs/2026-10-29-da-palantir-design.md (D2, D5).
 */
import { Grille, dansAnneau, dansBoite, pointSegment, type Boite } from "./geo";
import { DEMI_LARGEUR, ZEBRA_LONG_M, contexteSol, dansBatiment, deriverVoirie, type Contexte } from "./voirie";
import type { SceneData, Vec2 } from "./types";

/** Écart entre deux lampadaires d'une même voie (m), distance minimale entre deux lampadaires quelconques (m), plafond. */
export const LAMPADAIRE_PAS_M = 32;
export const LAMPADAIRE_ECART_MIN_M = 18;
export const LAMPADAIRES_MAX = 350;
/** Décalage d'un lampadaire de voirie au-delà du bord de la chaussée (m) et marge minimale au bord (m). */
const LAMPADAIRE_DECALAGE_M = 1.4;
const LAMPADAIRE_MARGE_M = 0.6;
/** Surface de parking par mât (m²). */
const PARKING_M2_PAR_MAT = 900;
/** Mât, bras (m). */
export const MAT_HAUTEUR_M = 6.5;
export const MAT_BRAS_M = 1.6;
/** Distance minimale d'une cachette du tigre au mobilier (m). */
export const MOBILIER_DISTANCE_CACHETTE_M = 3;

export type GenrePanneau = "stop" | "cedez" | "passage" | "bus";

export interface Lampadaire { x: number; z: number; /** sens du bras (unitaire) : vers la chaussée */ ax: number; az: number }
export interface Panneau { x: number; z: number; genre: GenrePanneau; /** sens d'arrivée des véhicules (unitaire) : la plaque leur fait face */ ux: number; uz: number }
export interface Orientee { x: number; z: number; ux: number; uz: number }
export interface Mobilier {
  lampadaires: Lampadaire[];
  panneaux: Panneau[];
  abris: Orientee[];
  bancs: Orientee[];
  corbeilles: { x: number; z: number }[];
  velos: Orientee[];
  portails: Orientee[];
}

export interface OptionsMobilier {
  ambiance?: "complete" | "zombies";
  exclure?: readonly Boite[];
  eviter?: readonly Vec2[];
}

const VIDE: Mobilier = { lampadaires: [], panneaux: [], abris: [], bancs: [], corbeilles: [], velos: [], portails: [] };

/** Distance du point au bord de la chaussée M ou R la plus proche (négative dedans), jusqu'à `max`. */
function distanceAuBord(c: Contexte, x: number, z: number, max: number): { d: number; ux: number; uz: number; px: number; pz: number } | null {
  let m: { d: number; ux: number; uz: number; px: number; pz: number } | null = null;
  c.chaussees.proches(x, z, max + 4, (s) => {
    const q = pointSegment(x, z, s.ax, s.az, s.bx, s.bz);
    const d = q.d - s.demi;
    if (d <= max && (!m || d < m.d)) {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
      m = { d, ux: (s.bx - s.ax) / L, uz: (s.bz - s.az) / L, px: q.x, pz: q.z };
    }
  });
  return m;
}

/** Sens (unitaire) de la voie carrossable la plus proche à moins de `max` m, ou null. */
function sensVoie(c: Contexte, x: number, z: number, max: number): Vec2 | null {
  let m: { d: number; u: Vec2 } | null = null;
  c.carrossables.proches(x, z, max, (s) => {
    const q = pointSegment(x, z, s.ax, s.az, s.bx, s.bz);
    if (q.d <= max && (!m || q.d < m.d)) { const L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1; m = { d: q.d, u: [(s.bx - s.ax) / L, (s.bz - s.az) / L] }; }
  });
  return (m as { d: number; u: Vec2 } | null)?.u ?? null;
}

/** Les règles communes : hors bâtiment, hors boîte exclue, à plus de 3 m d'une cachette. */
function admissible(c: Contexte, o: OptionsMobilier, ev: Grille<Vec2> | null, x: number, z: number): boolean {
  if (o.exclure?.some((b) => dansBoite(x, z, b))) return false;
  if (dansBatiment(c, x, z)) return false;
  let proche = false;
  ev?.proches(x, z, MOBILIER_DISTANCE_CACHETTE_M, (q) => { if (Math.hypot(q[0] - x, q[1] - z) < MOBILIER_DISTANCE_CACHETTE_M) proche = true; });
  return !proche;
}

const memo = new WeakMap<object, Map<string, Mobilier>>();

/**
 * Mobilier dérivé. Lampadaires : nœuds OSM puis un tous les 32 m le long des voies M et R (côté alterné, à demi-largeur + 1,4 m de l'axe), un mât par
 * 900 m² de parking ; au moins 18 m entre deux mâts, jamais sur la chaussée (≥ 0,6 m du bord) ni dans un bâtiment, 350 au plus. Panneaux : stops et
 * cédez OSM, passage piéton (bleu) à 1,5 m avant chaque passage des voies M et R, arrêt de bus. Abris de bus aux arrêts de `data.busStops`.
 * `ambiance: "zombies"` : rien (leurs aménagements maison le remplacent).
 */
export function mobilier(data: SceneData, o: OptionsMobilier = {}): Mobilier {
  if (o.ambiance === "zombies") return VIDE;
  const cle = JSON.stringify([o.exclure ?? [], o.eviter ?? []]);
  const parCle = memo.get(data.roads) ?? new Map<string, Mobilier>();
  memo.set(data.roads, parCle);
  const cache = parCle.get(cle + data.buildings.length + (data.decor ? 1 : 0));
  if (cache) return cache;
  const c = contexteSol(data);
  const voirie = deriverVoirie(data);
  const d = data.decor;
  const ev = (() => { if (!o.eviter?.length) return null; const g = new Grille<Vec2>(16); for (const p of o.eviter) g.ajouter(p[0], p[1], p[0], p[1], p); return g; })();
  const ok = (x: number, z: number) => admissible(c, o, ev, x, z);

  // ---- lampadaires : priorité OSM, puis voirie, puis parkings, espacement minimal commun
  const lampes: Lampadaire[] = [];
  const grille = new Grille<Lampadaire>(LAMPADAIRE_ECART_MIN_M * 2);
  const poser = (x: number, z: number, bras: Vec2 | null): void => {
    if (lampes.length >= LAMPADAIRES_MAX || !ok(x, z)) return;
    const b = distanceAuBord(c, x, z, 12);
    if (b && b.d < LAMPADAIRE_MARGE_M) return;
    let proche = false;
    grille.proches(x, z, LAMPADAIRE_ECART_MIN_M, (l) => { if (Math.hypot(l.x - x, l.z - z) < LAMPADAIRE_ECART_MIN_M) proche = true; });
    if (proche) return;
    // le bras tend vers la chaussée la plus proche (sinon vers le sens donné)
    let ax = bras?.[0] ?? 0, az = bras?.[1] ?? 1;
    if (b) { const dx = b.px - x, dz = b.pz - z, L = Math.hypot(dx, dz) || 1; ax = dx / L; az = dz / L; }
    const l = { x, z, ax, az };
    grille.ajouter(x, z, x, z, l);
    lampes.push(l);
  };
  for (const [x, z] of d?.lampadaires ?? []) poser(x, z, null);
  data.roads.forEach((r, i) => {
    if (r.c !== "M" && r.c !== "R") return;
    const demi = DEMI_LARGEUR[r.c];
    let cote = i % 2 === 0 ? 1 : -1, prochain = LAMPADAIRE_PAS_M / 2, parcouru = 0;
    for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (; prochain <= parcouru + L; prochain += LAMPADAIRE_PAS_M) {
        const s = prochain - parcouru, dec = demi + LAMPADAIRE_DECALAGE_M;
        poser(ax + ux * s - uz * cote * dec, az + uz * s + ux * cote * dec, [uz * cote, -ux * cote]);
        cote = -cote;
      }
      parcouru += L;
    }
  });
  for (const r of data.parkings) {
    let a = 0;
    for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; }
    const n = Math.floor(Math.abs(a / 2) / PARKING_M2_PAR_MAT);
    if (n < 1) continue;
    // mâts aux points de la boîte englobante en grille de ~30 m qui tombent dans le parking
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    let poses = 0;
    for (let x = x0 + 10; x <= x1 && poses < n; x += 30) for (let z = z0 + 10; z <= z1 && poses < n; z += 30) {
      if (!dansAnneau(x, z, r)) continue;
      const avant = lampes.length;
      poser(x, z, null);
      if (lampes.length > avant) poses++;
    }
  }

  // ---- panneaux
  const panneaux: Panneau[] = [];
  /** un panneau n'est jamais sur une chaussée (celle d'une autre voie, à un carrefour, comprise) */
  const horsChaussee = (x: number, z: number) => { const b = distanceAuBord(c, x, z, 3); return !b || b.d >= 0.5; };
  for (const a of voirie.arrets) {
    // plaque sur le côté droit du sens d'arrivée, à 0,8 m du bord
    const x = a.x - a.uz * (a.demi + 0.8), z = a.z + a.ux * (a.demi + 0.8);
    if (ok(x, z) && horsChaussee(x, z)) panneaux.push({ x, z, genre: a.genre, ux: a.ux, uz: a.uz });
  }
  for (const p of voirie.passages) {
    if (p.demi < DEMI_LARGEUR.R) continue;
    for (const sensCirc of [1, -1]) {
      // un panneau pour chaque sens de circulation, à 1,5 m avant les bandes, côté droit de ce sens
      const ux = p.ux * sensCirc, uz = p.uz * sensCirc;
      const x = p.x - ux * (ZEBRA_LONG_M / 2 + 1.5) - uz * (p.demi + 0.8), z = p.z - uz * (ZEBRA_LONG_M / 2 + 1.5) + ux * (p.demi + 0.8);
      if (ok(x, z) && horsChaussee(x, z)) panneaux.push({ x, z, genre: "passage", ux, uz });
    }
  }

  // ---- abris et arrêts de bus
  const abris: Orientee[] = [];
  for (const [bx, bz] of data.busStops) {
    if (abris.some((a) => Math.hypot(a.x - bx, a.z - bz) < 6)) continue;
    const b = distanceAuBord(c, bx, bz, 10);
    if (!b) continue;
    // du côté où se trouve l'arrêt, au-delà du bord ; sinon à droite
    let nx = -b.uz, nz = b.ux;
    const cote = (bx - b.px) * nx + (bz - b.pz) * nz;
    if (cote < 0) { nx = -nx; nz = -nz; }
    const dec = (DEMI_LARGEUR.M + 1.8) ;
    const x = b.px + nx * dec, z = b.pz + nz * dec;
    if (ok(x, z)) {
      abris.push({ x, z, ux: b.ux, uz: b.uz });
      // panneau d'arrêt de bus au bord de l'abri, face aux véhicules (le sens de la voie)
      const sx = b.px + nx * (DEMI_LARGEUR.M + 0.8) - b.ux * 2.5, sz = b.pz + nz * (DEMI_LARGEUR.M + 0.8) - b.uz * 2.5;
      if (ok(sx, sz) && horsChaussee(sx, sz)) panneaux.push({ x: sx, z: sz, genre: "bus", ux: b.ux, uz: b.uz });
    }
  }

  // ---- bancs, corbeilles, racks à vélos, portails (nœuds OSM), orientés sur la voie la plus proche
  const orienter = (p: Vec2): Orientee | null => {
    if (!ok(p[0], p[1])) return null;
    const u = sensVoie(c, p[0], p[1], 20);
    return { x: p[0], z: p[1], ux: u?.[0] ?? 1, uz: u?.[1] ?? 0 };
  };
  const liste = (l: readonly Vec2[] | undefined) => (l ?? []).map(orienter).filter((v): v is Orientee => !!v);
  const res: Mobilier = {
    lampadaires: lampes, panneaux, abris,
    bancs: liste(d?.bancs), velos: liste(d?.velos), portails: liste(d?.portails),
    corbeilles: (d?.corbeilles ?? []).filter(([x, z]) => ok(x, z)).map(([x, z]) => ({ x, z })),
  };
  parCle.set(cle + data.buildings.length + (data.decor ? 1 : 0), res);
  return res;
}
