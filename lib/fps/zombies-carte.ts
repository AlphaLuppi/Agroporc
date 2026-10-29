/**
 * Carte « Service de midi » du mode zombies v7 (PUR : aucune dépendance en dehors de lib/fps et lib/agroparc3d, `scene.json` est passé en
 * paramètre et n'est JAMAIS modifié). On démarre DANS le bâtiment 72 : quatre bâtiments sont creusés (72, 70, 62, 74), leurs murs deviennent
 * des pièces `coque` percées de portes et de fenêtres, l'intérieur reçoit des `cloison` et des `meuble`. Les cours d'Agroparc relient les
 * intérieurs par des passages fermés de portes payantes ou de barricades à planches. Zones, portes, fenêtres, sorties du sol, achats (murs,
 * atouts, Pack-a-Punch, boîte, disjoncteur, ingrédients, four), notes de lore, quais du Truck Muche, points de départ.
 * Serveur ET client appellent `donneesZombies` / `construireMondeZombies` avant de bâtir le monde de collision, pour voir la même carte.
 * Repère de scene.json : x vers l'est, z vers le sud, mètres. Les bâtiments sont tournés de 16° : chacun a son repère local (s le long
 * de sa façade, t vers le nord), cf. `Repere`.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Carte « Service de midi » »)
 */
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde, resoudre, type Boite, type Monde } from "./collision";
import { capVers } from "./monstres";
import type { ArmeFeuId, AtoutId } from "./protocole";
import { ZOMBIES } from "./zombies-vagues";

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

/** Bornes de la zone de jeu (m) : les tigres attendent dehors, devant les fenêtres (jusqu'à x = 236 derrière le Local technique). */
export const BORNES_ZOMBIES: Boite = { x0: 8, z0: -110, x1: 236, z1: 24 };
/** Hauteur des prismes de la carte (murs hauts : ni toit ni saut ne permet de quitter la zone). Les meubles gardent leur hauteur. */
export const HAUTEUR_MURS_ZOMBIES = 40;
/** Index de la première pièce synthétique dans `buildings` (`scene.json` en a 142). */
export const INDEX_PREMIERE_PIECE = 142;
/** Demi-épaisseur (m) des pièces des passages extérieurs, des coques et des cloisons ; prolongement (m) d'une pièce à ses deux bouts. */
export const DEMI_EPAISSEUR_PIECE = 0.8;
export const DEMI_EPAISSEUR_COQUE = 0.2;
export const DEMI_EPAISSEUR_CLOISON = 0.12;
export const PROLONGEMENT_PIECE = 0.3;
/** Hauteur de dessin d'une pièce extérieure (m) ; une porte intérieure fait la hauteur d'une porte. */
export const HAUTEUR_PIECE = 6;
export const HAUTEUR_PORTE_INTERIEURE = 2.6;
/**
 * Faux plafond des bâtiments creusés (m) : dessiné par rendu-interieurs.ts, solide pour la tête du joueur (`plafondZombies`,
 * `construireMondeZombies`) et pour les grenades (`plafondBatimentsCreux` de grenades.ts). Une seule source pour les trois.
 */
export const HAUTEUR_PLAFOND_ZOMBIES = 3.4;
/** Alias de `HAUTEUR_PLAFOND_ZOMBIES` (nom du lot des grenades). */
export const PLAFOND_INTERIEUR_M = HAUTEUR_PLAFOND_ZOMBIES;
/** Largeur (m) d'une ouverture de porte et d'une fenêtre dans une coque ou une cloison. */
export const LARGEUR_PORTE = 2.6;
export const LARGEUR_FENETRE = 1.8;
/** Bâtiments creusés (index de `scene.json`). */
export const BATIMENTS_CREUX = [72, 70, 62, 74] as const;
export type BatimentCreux = (typeof BATIMENTS_CREUX)[number];
/** Point de focus de la caméra de la carte zombies (open space). */
export const FOCUS_ZOMBIES: Vec2 = [118, -25];
/** Orientation commune des bâtiments d'Agroparc (rad). */
export const ANGLE_BATIMENTS = (16 * Math.PI) / 180;

export type ZoneId = "open" | "pause" | "cour" | "i2" | "cuisine" | "est" | "local" | "i1" | "ouest" | "labo";
export type PorteId = "D1" | "D2" | "D3" | "G3" | "D4" | "D7" | "G4" | "G2" | "G1" | "D8" | "D9";
export type TypePiece = NonNullable<Building["type"]>;

// ---------------------------------------------------------------------------------------------
// Repères locaux des bâtiments
// ---------------------------------------------------------------------------------------------

/** Repère d'un bâtiment : origine (son premier sommet), u le long de la façade (16°), n vers le nord. */
export interface Repere { o: Vec2; u: Vec2; n: Vec2 }
const U: Vec2 = [Math.cos(ANGLE_BATIMENTS), Math.sin(ANGLE_BATIMENTS)];
const N: Vec2 = [Math.sin(ANGLE_BATIMENTS), -Math.cos(ANGLE_BATIMENTS)];
/** Origine des repères des bâtiments creusés (premier sommet de leur anneau dans scene.json, vérifié par un test). */
export const ORIGINES: Readonly<Record<BatimentCreux, Vec2>> = { 72: [124.7, -28], 70: [160.3, -55.9], 62: [216.7, -49.2], 74: [55.1, -52.1] };
export const repere = (b: BatimentCreux): Repere => ({ o: ORIGINES[b], u: U, n: N });
/** Point (s, t) du repère du bâtiment `b` en coordonnées de la carte. */
export function local(b: BatimentCreux, s: number, t: number): Vec2 {
  const o = ORIGINES[b];
  return [o[0] + s * U[0] + t * N[0], o[1] + s * U[1] + t * N[1]];
}
const arr = (v: Vec2): Vec2 => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100];

// ---------------------------------------------------------------------------------------------
// Pièces synthétiques
// ---------------------------------------------------------------------------------------------

/**
 * Pièce de la carte : segment p → q d'épaisseur `2 × demi`, prolongé de `prolonge` m à ses bouts (un rectangle), hauteur de dessin `h`.
 * `meuble` : rectangle de mobilier (collision à sa hauteur `h`), `genre` pour le rendu. `zone` : zone d'une porte ou d'une fenêtre.
 */
export interface PieceSynth {
  id: string; type: TypePiece; p: Vec2; q: Vec2; demi: number; prolonge: number; h: number;
  /** bâtiment creusé d'où vient la pièce (coque, cloison, porte ou fenêtre intérieure, meuble) */
  batiment?: BatimentCreux;
  /** meuble : genre de rendu */
  genre?: GenreMeuble;
}
/**
 * Genres de mobilier. Intérieurs : bureau … piano. Aménagements (v8, dehors et dedans) : `olivier` (tronc de l'olivier, qui dessine aussi
 * l'arbre et son bac), `bac` (barre de collision du bac octogonal, sans dessin propre), `haie`, `conteneur`, `palette`, `voiture`,
 * `terrasse` (table, chaises et parasol), `muret`.
 */
export type GenreMeuble =
  | "bureau" | "table" | "comptoir" | "etagere" | "rack" | "paillasse" | "cuve" | "canape" | "piano"
  | "olivier" | "bac" | "haie" | "conteneur" | "palette" | "voiture" | "terrasse" | "muret";

const piece = (id: string, type: TypePiece, p: Vec2, q: Vec2, o: Partial<PieceSynth> = {}): PieceSynth => ({
  id, type, p: arr(p), q: arr(q), demi: o.demi ?? DEMI_EPAISSEUR_PIECE, prolonge: o.prolonge ?? PROLONGEMENT_PIECE, h: o.h ?? HAUTEUR_PIECE,
  ...(o.batiment !== undefined ? { batiment: o.batiment } : {}), ...(o.genre ? { genre: o.genre } : {}),
});

/** Ouverture dans un mur local : position `a` le long de l'arête (m depuis son premier sommet), largeur, porte ou fenêtre et son id. */
interface Ouverture { a: number; l: number; id: string; type: "porte" | "fenetre" }
/** Arête d'un mur local (s, t) → (s, t) avec ses ouvertures. */
interface MurLocal { de: Vec2; a: Vec2; ouvertures?: Ouverture[] }

/**
 * Coupe un mur local en pièces : murs pleins entre les ouvertures, une pièce par ouverture (porte ou fenêtre). Le mur est décalé vers
 * l'intérieur de `decalage` (coque : sa face extérieure reste sur la façade) ; le premier et le dernier morceau plein débordent de
 * l'épaisseur à leur bout libre pour fermer les coins.
 */
function couperMur(b: BatimentCreux, m: MurLocal, prefixe: string, type: "coque" | "cloison", h: number, decalage: number): PieceSynth[] {
  const res: PieceSynth[] = [];
  const [s0, t0] = m.de, [s1, t1] = m.a;
  const L = Math.hypot(s1 - s0, t1 - t0);
  const us = (s1 - s0) / L, ut = (t1 - t0) / L;
  // normale gauche (−ut, us) : l'intérieur des anneaux, parcourus dans le sens trigonométrique du repère local
  const ns = -ut * decalage, nt = us * decalage;
  const demi = type === "coque" ? DEMI_EPAISSEUR_COQUE : DEMI_EPAISSEUR_CLOISON;
  const pt = (k: number): Vec2 => local(b, s0 + us * k + ns, t0 + ut * k + nt);
  const ouvertures = [...(m.ouvertures ?? [])].sort((x, y) => x.a - y.a);
  const bornes: [number, number][] = [];
  let k = 0;
  for (const o of ouvertures) { bornes.push([k, o.a - o.l / 2]); k = o.a + o.l / 2; }
  bornes.push([k, L]);
  let n = 0;
  bornes.forEach(([a, z], rang) => {
    const debut = rang === 0 ? a - demi : a, fin = rang === bornes.length - 1 ? z + demi : z;
    if (fin - debut > 0.05) res.push(piece(`${prefixe}${n++}`, type, pt(debut), pt(fin), { demi, prolonge: 0, h, batiment: b }));
    const o = ouvertures[rang];
    if (o) {
      res.push(piece(o.id, o.type, pt(o.a - o.l / 2), pt(o.a + o.l / 2), {
        demi: demi + 0.05, prolonge: 0, h: o.type === "porte" ? Math.min(h, HAUTEUR_PORTE_INTERIEURE) : h, batiment: b,
      }));
    }
  });
  return res;
}

/** Murs (anneau local, sens de scene.json) d'un bâtiment creusé avec leurs ouvertures, et son intérieur (cloisons, meubles). */
interface Creusage { b: BatimentCreux; murs: MurLocal[]; cloisons: MurLocal[]; meubles: { s: number; t: number; ls: number; lt: number; h: number; genre: GenreMeuble }[] }

const porte = (id: string, a: number): Ouverture => ({ id, a, l: LARGEUR_PORTE, type: "porte" });
const fen = (id: string, a: number): Ouverture => ({ id, a, l: LARGEUR_FENETRE, type: "fenetre" });

/** Anneaux locaux des bâtiments creusés, relevés dans scene.json (vérifiés par un test à 0,2 m près). */
export const CREUSAGES: readonly Creusage[] = [
  {
    // 72 : Open space (s < 6) et Salle de pause (s > 6)
    b: 72,
    murs: [
      { de: [0, 0], a: [0, 4.1] },
      { de: [0, 4.1], a: [-11.6, 4.1], ouvertures: [porte("D2", 5.8)] },
      { de: [-11.6, 4.1], a: [-11.5, -0.1] },
      { de: [-11.5, -0.1], a: [-19, 0] },
      { de: [-19, 0], a: [-19.1, -10.5] },
      { de: [-19.1, -10.5], a: [31, -10.4], ouvertures: [fen("F1", 6.1), fen("F2", 17.1), fen("F3", 33.1), fen("F4", 44.1)] },
      { de: [31, -10.4], a: [30.9, -0.1], ouvertures: [porte("D3", 5.2)] },
      { de: [30.9, -0.1], a: [23.3, -0.1] },
      { de: [23.3, -0.1], a: [23.3, 4.2] },
      { de: [23.3, 4.2], a: [11.8, 4.1] },
      { de: [11.8, 4.1], a: [11.8, -0.1] },
      { de: [11.8, -0.1], a: [0, 0] },
    ],
    cloisons: [{ de: [6, -10.4], a: [6, 0.05], ouvertures: [porte("D1", 5.2)] }],
    meubles: [
      // open space : îlots de bureaux, imprimante, armoire
      { s: -14, t: -3.2, ls: 3.2, lt: 1.6, h: 0.75, genre: "bureau" },
      { s: -8.5, t: -3.2, ls: 3.2, lt: 1.6, h: 0.75, genre: "bureau" },
      { s: -8.5, t: -7.6, ls: 3.2, lt: 1.6, h: 0.75, genre: "bureau" },
      { s: 2.6, t: -2.2, ls: 1.6, lt: 1.0, h: 1.1, genre: "etagere" },
      // salle de pause : tables, canapé, comptoir de la machine à café
      { s: 11, t: -5.5, ls: 2.2, lt: 1.2, h: 0.75, genre: "table" },
      { s: 18.5, t: -6.5, ls: 2.2, lt: 1.2, h: 0.75, genre: "table" },
      { s: 25.5, t: -4.5, ls: 2.6, lt: 1.0, h: 0.8, genre: "canape" },
      { s: 21, t: -9.4, ls: 3.0, lt: 0.8, h: 0.95, genre: "comptoir" },
    ],
  },
  {
    // 70 : Cuisine du Bistrot Trèfle (s de −12,7 à 1,6, t de −21 à 13)
    b: 70,
    murs: [
      { de: [0, 0], a: [1.5, 1.7] },
      { de: [1.5, 1.7], a: [1.5, 9.0] },
      { de: [1.5, 9.0], a: [1.1, 8.9] },
      { de: [1.1, 8.9], a: [1.1, 12.9] },
      { de: [1.1, 12.9], a: [-3.3, 12.9] },
      { de: [-3.3, 12.9], a: [-3.3, 11.9] },
      { de: [-3.3, 11.9], a: [-6.6, 11.8] },
      { de: [-6.6, 11.8], a: [-6.6, 8.9] },
      { de: [-6.6, 8.9], a: [-12.7, 9.1] },
      { de: [-12.7, 9.1], a: [-12.6, -17.3], ouvertures: [porte("D4", 13.1)] },
      { de: [-12.6, -17.3], a: [-6.6, -17.3] },
      { de: [-6.6, -17.3], a: [-6.6, -21.2] },
      { de: [-6.6, -21.2], a: [1.6, -21.2] },
      { de: [1.6, -21.2], a: [1.5, -3.5], ouvertures: [porte("D7", 9.2)] },
      { de: [1.5, -3.5], a: [0, -3.5] },
      { de: [0, -3.5], a: [0, 0] },
    ],
    cloisons: [],
    meubles: [
      // passe et pianos de cuisson le long du mur ouest, plan de travail central, étagères
      { s: -5.5, t: -9.5, ls: 2.0, lt: 6.0, h: 0.95, genre: "piano" },
      { s: -5.5, t: 1.5, ls: 2.0, lt: 5.0, h: 0.95, genre: "comptoir" },
      { s: -2.7, t: -20.4, ls: 7.0, lt: 0.8, h: 1.8, genre: "etagere" },
      { s: -11.6, t: -12, ls: 1.2, lt: 3.0, h: 1.8, genre: "etagere" },
    ],
  },
  {
    // 62 : Local technique (le disjoncteur)
    b: 62,
    murs: [
      { de: [0, 0], a: [-0.4, 0] },
      { de: [-0.4, 0], a: [-0.4, 3.8] },
      { de: [-0.4, 3.8], a: [-4.8, 3.8] },
      { de: [-4.8, 3.8], a: [-4.8, 2.8] },
      { de: [-4.8, 2.8], a: [-8.2, 2.8] },
      { de: [-8.2, 2.8], a: [-8.1, -0.1] },
      { de: [-8.1, -0.1], a: [-14.2, 0] },
      { de: [-14.2, 0], a: [-14.2, -26.4], ouvertures: [porte("D8", 13)] },
      { de: [-14.2, -26.4], a: [-8.1, -26.3] },
      { de: [-8.1, -26.3], a: [-8.1, -30.3] },
      { de: [-8.1, -30.3], a: [0, -30.3] },
      { de: [0, -30.3], a: [0.1, -12.6], ouvertures: [fen("F5", 9.3)] },
      { de: [0.1, -12.6], a: [-1.6, -12.5] },
      { de: [-1.6, -12.5], a: [-1.6, -9.1] },
      { de: [-1.6, -9.1], a: [0, -7.4] },
      { de: [0, -7.4], a: [0, 0] },
    ],
    cloisons: [],
    meubles: [
      { s: -6, t: -5, ls: 1.0, lt: 4.0, h: 2.1, genre: "rack" },
      { s: -12.9, t: -5.3, ls: 1.0, lt: 4.0, h: 2.1, genre: "rack" },
      { s: -5, t: -24.5, ls: 4.0, lt: 1.0, h: 1.0, genre: "paillasse" },
      { s: -13.2, t: -21.8, ls: 1.2, lt: 3.0, h: 1.8, genre: "etagere" },
    ],
  },
  {
    // 74 : Labo R&D (le Micro-ondes Gratinator)
    b: 74,
    murs: [
      { de: [0, 0], a: [3.3, -9.8] },
      { de: [3.3, -9.8], a: [4.7, -9.7] },
      { de: [4.7, -9.7], a: [4.6, -14.6] },
      { de: [4.6, -14.6], a: [18.7, -14.6], ouvertures: [fen("F6", 6.9)] },
      { de: [18.7, -14.6], a: [18.7, -8.7] },
      { de: [18.7, -8.7], a: [30.9, -8.6] },
      { de: [30.9, -8.6], a: [30.8, -14.6] },
      { de: [30.8, -14.6], a: [49.7, -14.5], ouvertures: [fen("F7", 9.2)] },
      { de: [49.7, -14.5], a: [49.6, -4.1] },
      { de: [49.6, -4.1], a: [43.4, -4.1] },
      { de: [43.4, -4.1], a: [43.4, 0.1] },
      { de: [43.4, 0.1], a: [0, 0], ouvertures: [porte("D9", 21.4)] },
    ],
    cloisons: [],
    meubles: [
      { s: 10, t: -6.5, ls: 4.0, lt: 1.2, h: 0.95, genre: "paillasse" },
      { s: 25, t: -4.5, ls: 4.0, lt: 1.2, h: 0.95, genre: "paillasse" },
      { s: 34, t: -6, ls: 4.0, lt: 1.2, h: 0.95, genre: "paillasse" },
      { s: 35.7, t: -13.5, ls: 1.4, lt: 1.4, h: 2.0, genre: "cuve" },
      { s: 17.6, t: -13.5, ls: 1.4, lt: 1.4, h: 2.0, genre: "cuve" },
    ],
  },
];

/** Pièces d'un bâtiment creusé : coques (et leurs portes / fenêtres), cloisons, meubles. */
function piecesCreusage(c: Creusage, h: number): PieceSynth[] {
  const res: PieceSynth[] = [];
  c.murs.forEach((m, i) => res.push(...couperMur(c.b, m, `${c.b}c${i}_`, "coque", h, DEMI_EPAISSEUR_COQUE)));
  c.cloisons.forEach((m, i) => res.push(...couperMur(c.b, m, `${c.b}k${i}_`, "cloison", h, 0)));
  c.meubles.forEach((m, i) => {
    res.push(piece(`${c.b}m${i}`, "meuble", local(c.b, m.s - m.ls / 2, m.t), local(c.b, m.s + m.ls / 2, m.t), {
      demi: m.lt / 2, prolonge: 0, h: m.h, batiment: c.b, genre: m.genre,
    }));
  });
  return res;
}

/**
 * Pièces des passages extérieurs (repère de la carte) : portes payantes entre les cours, barricades à planches (`fenetre`) et murs
 * qui ferment la carte. Mêmes segments que la carte v6 (relevés au flood-fill), les champs disparaissent : une barricade est une fenêtre.
 */
const PIECES_EXTERIEURES: readonly PieceSynth[] = [
  piece("G1", "porte", [96.8, -40.2], [100.0, -51.1]),
  piece("G2", "porte", [106.4, -33.2], [103.1, -50.2]),
  piece("G3", "porte", [148.1, -37.3], [145.1, -26.5]),
  piece("G4", "porte", [159.2, -18.1], [156.0, -35.1]),
  piece("S1", "fenetre", [98.9, -24.5], [103.5, -23.2]),
  piece("S2", "fenetre", [151.6, -9.5], [156.3, -8.1]),
  piece("N4", "fenetre", [164.2, -64.1], [170.5, -62.3]),
  piece("W", "fenetre", [55.1, -52.1], [58.2, -63.0]),
  piece("N2c", "fenetre", [117.9, -77.2], [111.4, -79.1]),
  piece("E", "fenetre", [200.6, -22.3], [197.6, -11.5]),
  piece("N1", "mur", [96.2, -85.5], [97.7, -83.1]),
  piece("N3", "mur", [149.1, -70.4], [150.6, -68.1]),
  piece("N5", "mur", [201.7, -55.4], [203.0, -53.1]),
  piece("PW", "mur", [55.5, -36.8], [55.5, 24]),
  piece("PN", "mur", [55.2, -101.3], [55.2, -110]),
  piece("PE", "mur", [207.8, 6.6], [207.8, 24]),
];

// ---------------------------------------------------------------------------------------------
// Aménagements (v8) : deux grandes cours à olivier, le reste resserré
// ---------------------------------------------------------------------------------------------

/**
 * Olivier au centre de la Cour Centre et de la Cour Est (le seul obstacle de ces deux cours, autour duquel on fait tourner les tigres) :
 * tronc carré de `demiTronc` (collision jusqu'à `hauteurTronc`, les balles passent dans la ramure), bac octogonal bas d'apothème
 * `apothemeBac` (on peut monter dessus, mais un tigre au pied du bac atteint tout joueur posé dessus : pas de refuge).
 */
export const OLIVIER = { demiTronc: 0.45, hauteurTronc: 2.4, apothemeBac: 1.4, hauteurBac: 0.45 } as const;
/** Dimensions (m) des aménagements : `l` le long de la pièce, `w` en travers, `h` hauteur de collision (≥ 2,45 m : on ne s'y hisse pas). */
export const AMENAGEMENTS = {
  haie: { l: 0, w: 0.9, h: 2.5 },
  conteneur: { l: 6.06, w: 2.44, h: 2.6 },
  voiture: { l: 4.4, w: 1.9, h: 1.5 },
  palette: { l: 2.4, w: 1.2, h: 1.3 },
  terrasse: { l: 1.8, w: 1.8, h: 0.75 },
  muret: { l: 0, w: 0.4, h: 0.9 },
} as const;

/** Pièce d'aménagement : rectangle centré en `c`, `l` le long de l'angle `angle` (rad, 16° par défaut : comme les façades), `w` en travers. */
function amenagement(id: string, genre: GenreMeuble, c: Vec2, l: number, w: number, h: number, angle = ANGLE_BATIMENTS, batiment?: BatimentCreux): PieceSynth {
  const ux = Math.cos(angle) * l / 2, uz = Math.sin(angle) * l / 2;
  return piece(id, "meuble", [c[0] - ux, c[1] - uz], [c[0] + ux, c[1] + uz], { demi: w / 2, prolonge: 0, h, genre, ...(batiment !== undefined ? { batiment } : {}) });
}
/** Aménagement d'un genre standard (dimensions de `AMENAGEMENTS`, longueur imposée pour les haies et murets). */
function amenag(id: string, genre: keyof typeof AMENAGEMENTS, c: Vec2, l?: number, angle = ANGLE_BATIMENTS): PieceSynth {
  const d = AMENAGEMENTS[genre];
  return amenagement(id, genre, c, l ?? d.l, d.w, d.h, angle);
}

/** Les deux oliviers : id de la pièce du tronc, zone, centre. */
export const OLIVIERS: readonly { id: string; zone: ZoneId; c: Vec2 }[] = [
  { id: "OL1", zone: "cour", c: [125.5, -54.5] },
  { id: "OL2", zone: "est", c: [180.5, -36.5] },
];

/** Pièces d'un olivier : le tronc (genre `olivier`) puis les quatre barres du bac (genre `bac`), dont l'union est l'octogone. */
function piecesOlivier(id: string, c: Vec2): PieceSynth[] {
  const o = OLIVIER, a = o.apothemeBac;
  const res = [amenagement(id, "olivier", c, 2 * o.demiTronc, 2 * o.demiTronc, o.hauteurTronc)];
  // l'octogone d'apothème a est l'union de quatre barres de longueur 2a et de largeur égale à son côté (2a tan 22,5°), tous les 45°
  for (let k = 0; k < 4; k++) res.push(amenagement(`${id}b${k}`, "bac", c, 2 * a, 2 * a * Math.tan(Math.PI / 8), o.hauteurBac, ANGLE_BATIMENTS + (k * Math.PI) / 4));
  return res;
}

/** Point (s, t) du repère du Labo (74), qui sert de repère à la Cour Ouest (s le long de la façade nord du Labo, t vers le nord). */
const L74 = (s: number, t: number): Vec2 => local(74, s, t);
/** Angle d'une pièce posée en travers des façades (voiture garée en épi). */
const PERP = ANGLE_BATIMENTS + Math.PI / 2;
/** Rangée de `n` voitures garées côte à côte (en travers des façades, 0,4 m entre deux), la première à (s0, t) du repère du Labo. */
function rangee(prefixe: string, s0: number, t: number, n: number): PieceSynth[] {
  const v = AMENAGEMENTS.voiture;
  return Array.from({ length: n }, (_, k) => amenag(`${prefixe}${k}`, "voiture", L74(s0 + v.w / 2 + k * (v.w + 0.4), t), undefined, PERP));
}

/** Point d'un segment p → q à la fraction t, décalé de `d` m sur sa normale gauche (−uz, ux). */
function surSegment(p: Vec2, q: Vec2, t: number, d: number): Vec2 {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const ux = (q[0] - p[0]) / l, uz = (q[1] - p[1]) / l;
  return [p[0] + (q[0] - p[0]) * t - uz * d, p[1] + (q[1] - p[1]) * t + ux * d];
}
/** Façade sud de la Cour Est (bâtiment 73), de l'ouest vers l'est : la cour est à sa droite (décalage négatif de `surSegment`). */
const MUR_SUD_EST: readonly [Vec2, Vec2] = [[167.5, -20.1], [178.6, -17.0]];
/** Conteneur de livraison de la Cour Est, en travers de sa façade sud, collé à elle à la fraction `FRACTION_CONTENEUR_EST` (coin de la boîte B3). */
const FRACTION_CONTENEUR_EST = 0.2;
const CONTENEUR_EST: Vec2 = surSegment(MUR_SUD_EST[0], MUR_SUD_EST[1], FRACTION_CONTENEUR_EST, -(AMENAGEMENTS.conteneur.l / 2 + 0.05));

/**
 * Aménagements, ajoutés APRÈS toutes les autres pièces (les index des pièces de la v7 ne bougent pas). La Cour Ouest devient le « Parking du
 * personnel » : une rue le long du Labo (W → D9 → G1), puis des îlots de voitures, de conteneurs, de palettes et de haies séparés par des
 * allées de 3 à 4,5 m ; on peut y faire tourner des tigres autour d'un îlot, mais serré. Passage Est, Local technique : un îlot ou un meuble
 * de plus. Cour Centre et Cour Est gardent leur grand anneau autour de l'olivier, avec du mobilier sur les bords seulement.
 */
export const PIECES_AMENAGEMENT: readonly PieceSynth[] = [
  ...OLIVIERS.flatMap((o) => piecesOlivier(o.id, o.c)),
  // ---- Cour Ouest : Parking du personnel (repère du Labo : s de 1 à 32,4, t de 0,5 à 43) ----
  // rue le long du Labo (t de 0,5 à 7,3), puis quatre rangées d'îlots séparées par des allées de 4,2 à 4,6 m, trouées de passages de 3 à 5 m
  ...rangee("PA", 5.4, 9.5, 3), amenag("PA3", "conteneur", L74(18.7, 9.5)), ...rangee("PA4", 25.9, 9.5, 2),
  amenag("PA6", "palette", L74(37.5, 6), undefined, PERP),
  amenag("PB0", "haie", L74(7.4, 18.4), 13.2), ...rangee("PB1", 18.2, 18.4, 3), amenag("PB4", "palette", L74(28.6, 18.4), undefined, PERP),
  amenag("PC0", "conteneur", L74(7.5, 27.4)), ...rangee("PC1", 14.6, 27.4, 2), amenag("PC3", "haie", L74(25, 27.4), 6),
  ...rangee("PD", 5.5, 36, 2), amenag("PD2", "palette", L74(14.2, 36.2)), ...rangee("PD3", 20.4, 36, 3),
  // ---- Cour Centre : terrasse du Bistrot devant D4, loin de l'anneau de l'olivier (≈ 18 m) ----
  amenag("TC1", "terrasse", [142, -63]), amenag("TC2", "terrasse", [140.8, -48.5]), amenag("TC3", "terrasse", [138.5, -67.5]),
  // ---- Cour Est : conteneur de livraison contre la façade sud (coin de la boîte B3), tables devant D7 ----
  amenag("CE1", "conteneur", CONTENEUR_EST, undefined, PERP), amenag("CE2", "palette", surSegment(MUR_SUD_EST[0], MUR_SUD_EST[1], 0.85, -0.75)),
  amenag("TE1", "terrasse", [166, -51]), amenag("TE2", "terrasse", [166.5, -45.5]),
  // ---- Passage Est : une pile de palettes au milieu (on en fait le tour) ----
  amenag("PE1", "palette", [152.3, -26.5], undefined, PERP),
  // ---- Local technique : une baie de plus au milieu ----
  amenagement("LT1", "rack", local(62, -7, -15), 4, 1, 2.1, PERP, 62),
];

/** Hauteur du bâtiment creusé `b` dans scene.json (repli : 6 m). */
const hauteur = (scene: SceneData | null, b: BatimentCreux): number => scene?.buildings[b]?.h ?? 6;

/** Toutes les pièces, dans l'ORDRE FIXE de leur index dans `buildings` (à partir de `INDEX_PREMIERE_PIECE`) : aménagements en dernier. */
export function piecesSynth(scene: SceneData | null = null): PieceSynth[] {
  const res: PieceSynth[] = [...PIECES_EXTERIEURES];
  for (const c of CREUSAGES) res.push(...piecesCreusage(c, hauteur(scene, c.b)));
  res.push(...PIECES_AMENAGEMENT);
  return res;
}
/** Pièces calculées une fois (hauteurs de scene.json : 72 = 7,7, 70 = 8,1, 62 = 8, 74 = 4,7 ; les tests les comparent à la vraie scène). */
export const PIECES_SYNTH: readonly PieceSynth[] = piecesSynth({ buildings: hauteursConnues() } as unknown as SceneData);
function hauteursConnues(): Building[] {
  const b: Building[] = [];
  b[72] = { h: 7.7, r: [], c: [0, 0] }; b[70] = { h: 8.1, r: [], c: [0, 0] }; b[62] = { h: 8, r: [], c: [0, 0] }; b[74] = { h: 4.7, r: [], c: [0, 0] };
  return b;
}

export const pieceDe = (id: string): PieceSynth => {
  const p = PIECES_SYNTH.find((x) => x.id === id);
  if (!p) throw new Error(`pièce inconnue : ${id}`);
  return p;
};

/** Index du prisme (= du bâtiment) de la pièce `id` dans le monde zombies. */
export function idPrisme(id: string): number {
  const rang = PIECES_SYNTH.findIndex((x) => x.id === id);
  if (rang < 0) throw new Error(`pièce inconnue : ${id}`);
  return INDEX_PREMIERE_PIECE + rang;
}

/** Bâtiment d'une pièce : rectangle du segment p → q, demi-épaisseur `demi`, prolongé de `prolonge` à chaque bout, c = milieu. */
export function batimentDePiece(p: PieceSynth): Building {
  const [px, pz] = p.p, [qx, qz] = p.q;
  const l = Math.hypot(qx - px, qz - pz) || 1;
  const ux = (qx - px) / l, uz = (qz - pz) / l;
  const nx = -uz, nz = ux;
  const e = p.demi, a = p.prolonge;
  const ax = px - ux * a, az = pz - uz * a, bx = qx + ux * a, bz = qz + uz * a;
  return {
    h: p.h,
    r: [[ax + nx * e, az + nz * e], [ax - nx * e, az - nz * e], [bx - nx * e, bz - nz * e], [bx + nx * e, bz + nz * e]],
    c: [(px + qx) / 2, (pz + qz) / 2],
    type: p.type,
  };
}

const milieuPiece = (id: string): Vec2 => { const s = pieceDe(id); return [(s.p[0] + s.q[0]) / 2, (s.p[1] + s.q[1]) / 2]; };

/** Distance (m) du point (x, z) au segment p → q. */
export function distanceSegment(x: number, z: number, p: Vec2, q: Vec2): number {
  const ux = q[0] - p[0], uz = q[1] - p[1], l2 = ux * ux + uz * uz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - p[0]) * ux + (z - p[1]) * uz) / l2)) : 0;
  return Math.hypot(x - (p[0] + ux * t), z - (p[1] + uz * t));
}

// ---------------------------------------------------------------------------------------------
// Zones et portes
// ---------------------------------------------------------------------------------------------

export interface Zone {
  id: ZoneId;
  nom: string;
  /** à l'intérieur d'un bâtiment (pas de sortie du sol, lumière du courant) */
  interieur: boolean;
  /** point sûrement dans la zone (graine du flood-fill des zones) */
  graine: Vec2;
}
export const ZONES: readonly Zone[] = [
  { id: "open", nom: "Open space du Pôle R&D", interieur: true, graine: local(72, -8, -5.5) },
  { id: "pause", nom: "Salle de pause", interieur: true, graine: local(72, 20, -3) },
  { id: "cour", nom: "Cour Centre", interieur: false, graine: [128, -55] },
  { id: "i2", nom: "Passage Est", interieur: false, graine: [154, -22] },
  { id: "cuisine", nom: "Cuisine du Bistrot Trèfle", interieur: true, graine: local(70, -9, -4) },
  { id: "est", nom: "Cour Est", interieur: false, graine: [185, -38] },
  { id: "local", nom: "Local technique", interieur: true, graine: local(62, -4, -15) },
  { id: "i1", nom: "Passage Ouest", interieur: false, graine: [102, -42] },
  { id: "ouest", nom: "Cour Ouest", interieur: false, graine: [76, -68] },
  { id: "labo", nom: "Labo R&D", interieur: true, graine: local(74, 22, -5) },
];
export const zoneDeId = (id: ZoneId): Zone => ZONES.find((z) => z.id === id)!;
export const ZONE_DEPART: ZoneId = "open";

export interface Porte {
  id: PorteId;
  nom: string;
  prix: number;
  /** les deux zones qu'elle relie (on l'achète depuis l'une ou l'autre) */
  zones: readonly [ZoneId, ZoneId];
  /** pièces détruites à l'ouverture */
  prismes: readonly string[];
  /** point d'achat : milieu de la pièce */
  point: Vec2;
  /** distance maximale (m) au segment de la pièce, des deux côtés */
  portee: number;
}
const definirPorte = (id: PorteId, nom: string, prix: number, zones: [ZoneId, ZoneId]): Porte => ({
  id, nom, prix, zones, prismes: [id], point: milieuPiece(id), portee: ZOMBIES.porteeAchatPorte,
});

/** Les onze portes payantes (≈ 13 000 $ au total). */
export const PORTES_PAYANTES: readonly Porte[] = [
  definirPorte("D1", "Porte de la salle de pause", 750, ["open", "pause"]),
  definirPorte("D2", "Sortie sur la cour", 1000, ["open", "cour"]),
  definirPorte("D3", "Porte de service", 1250, ["pause", "i2"]),
  definirPorte("G3", "Grille du passage Est", 750, ["cour", "i2"]),
  definirPorte("D4", "Entrée de la cuisine", 1000, ["cour", "cuisine"]),
  definirPorte("D7", "Porte des livraisons", 1000, ["cuisine", "est"]),
  definirPorte("G4", "Grille de la cour Est", 1250, ["i2", "est"]),
  definirPorte("G2", "Grille du passage Ouest", 1000, ["cour", "i1"]),
  definirPorte("G1", "Grille de la cour Ouest", 1250, ["i1", "ouest"]),
  definirPorte("D8", "Local technique", 1500, ["est", "local"]),
  definirPorte("D9", "Labo R&D", 1500, ["ouest", "labo"]),
];
export const PORTES = PORTES_PAYANTES;
export function porteDeId(id: string): Porte | null {
  return PORTES_PAYANTES.find((p) => p.id === id) ?? null;
}
/** Distance (m) de `pos` au segment de la porte (des deux côtés). */
export function distancePorte(porte: Porte, pos: Vec2): number {
  const s = pieceDe(porte.prismes[0]);
  return distanceSegment(pos[0], pos[1], s.p, s.q);
}

/** Zones ouvertes (accessibles aux joueurs) pour un ensemble de portes ouvertes : la zone de départ et tout ce qu'on atteint par elles. */
export function zonesOuvertes(ouvertes: ReadonlySet<string> | readonly string[]): Set<ZoneId> {
  const o = ouvertes instanceof Set ? ouvertes : new Set(ouvertes);
  const res = new Set<ZoneId>([ZONE_DEPART]);
  let change = true;
  while (change) {
    change = false;
    for (const p of PORTES_PAYANTES) {
      if (!o.has(p.id)) continue;
      const [a, b] = p.zones;
      if (res.has(a) && !res.has(b)) { res.add(b); change = true; }
      else if (res.has(b) && !res.has(a)) { res.add(a); change = true; }
    }
  }
  return res;
}

/** Zones voisines de `z` par une porte ouverte. */
export function voisines(z: ZoneId, ouvertes: ReadonlySet<string>): ZoneId[] {
  const res: ZoneId[] = [];
  for (const p of PORTES_PAYANTES) {
    if (!ouvertes.has(p.id)) continue;
    if (p.zones[0] === z) res.push(p.zones[1]);
    else if (p.zones[1] === z) res.push(p.zones[0]);
  }
  return res;
}

/**
 * Zones actives pour les apparitions (gestionnaire de zones de BO1) : les zones ouvertes occupées par un joueur debout et leurs voisines
 * par une porte ouverte. Sans joueur localisé : la zone de départ.
 */
export function zonesActives(occupees: Iterable<ZoneId | null>, ouvertes: ReadonlySet<string>): Set<ZoneId> {
  const res = new Set<ZoneId>();
  for (const z of occupees) {
    if (!z) continue;
    res.add(z);
    for (const v of voisines(z, ouvertes)) res.add(v);
  }
  if (!res.size) res.add(ZONE_DEPART);
  return res;
}

// ---------------------------------------------------------------------------------------------
// Fenêtres (barricades à planches)
// ---------------------------------------------------------------------------------------------

export interface Fenetre {
  /** id de la pièce `fenetre` */
  id: string;
  /** zone intérieure (côté joueurs) */
  zone: ZoneId;
  milieu: Vec2;
  /** largeur (m) de l'ouverture */
  largeur: number;
  /** normale unitaire de l'ouverture, tournée vers la zone */
  normale: Vec2;
  /** le tigre arrache les planches depuis `dehors` et retombe sur `dedans` après le saut */
  dehors: Vec2;
  dedans: Vec2;
  /** points d'apparition à 6, 12 et 18 m côté extérieur le long de la normale */
  points: readonly [Vec2, Vec2, Vec2];
}

/** Côté intérieur de chaque fenêtre : la zone et un point de ce côté (la normale est orientée vers lui). */
const COTES_FENETRES: readonly { id: string; zone: ZoneId; cote: Vec2 }[] = [
  { id: "F1", zone: "open", cote: local(72, -13, -5) },
  { id: "F2", zone: "open", cote: local(72, -2, -5) },
  { id: "F3", zone: "pause", cote: local(72, 14, -5) },
  { id: "F4", zone: "pause", cote: local(72, 25, -5) },
  { id: "N2c", zone: "cour", cote: [116, -72] },
  { id: "S1", zone: "i1", cote: [101, -30] },
  { id: "S2", zone: "i2", cote: [153, -14] },
  { id: "N4", zone: "est", cote: [168, -57] },
  { id: "E", zone: "est", cote: [196, -18] },
  { id: "F5", zone: "local", cote: local(62, -4, -21) },
  { id: "W", zone: "ouest", cote: [62, -58] },
  { id: "F6", zone: "labo", cote: local(74, 11.5, -10) },
  { id: "F7", zone: "labo", cote: local(74, 40, -10) },
];

function definirFenetre(id: string, zone: ZoneId, cote: Vec2): Fenetre {
  const p = pieceDe(id);
  const m = milieuPiece(id);
  const l = Math.hypot(p.q[0] - p.p[0], p.q[1] - p.p[1]);
  let nx = -(p.q[1] - p.p[1]) / l, nz = (p.q[0] - p.p[0]) / l;
  if ((cote[0] - m[0]) * nx + (cote[1] - m[1]) * nz < 0) { nx = -nx; nz = -nz; }
  const at = (k: number): Vec2 => arr([m[0] + nx * k, m[1] + nz * k]);
  const ext = p.demi + 0.9;
  return { id, zone, milieu: arr(m), largeur: l, normale: [nx, nz], dehors: at(-ext), dedans: at(p.demi + 1.5), points: [at(-6), at(-12), at(-18)] };
}

export const FENETRES: readonly Fenetre[] = COTES_FENETRES.map((f) => definirFenetre(f.id, f.zone, f.cote));
export const fenetreDeId = (id: string): Fenetre | null => FENETRES.find((f) => f.id === id) ?? null;
/** Fenêtre dont le milieu est le plus proche de (x, z) (sons du bonus Menuisier). */
export function fenetrePlusProche(x: number, z: number): Fenetre | null {
  let res: Fenetre | null = null, dMin = Infinity;
  for (const f of FENETRES) {
    const d = Math.hypot(f.milieu[0] - x, f.milieu[1] - z);
    if (d < dMin) { dMin = d; res = f; }
  }
  return res;
}

/** Fenêtres des zones données (actives : zones ouvertes et proches des joueurs). */
export function fenetresDesZones(zones: ReadonlySet<ZoneId>): Fenetre[] {
  return FENETRES.filter((f) => zones.has(f.zone));
}

// ---------------------------------------------------------------------------------------------
// Achats et objets de la carte
// ---------------------------------------------------------------------------------------------

export type GenreAchat = "mur" | "porte" | "boite" | "atout" | "pap" | "courant" | "ingredient" | "four";
/** Arme à acheter au mur : une arme à feu ou l'épée. */
export type ArmeAchat = ArmeFeuId | "epee";
export type { AtoutId };
export const ATOUTS_LISTE: readonly AtoutId[] = ["gratin", "expresso", "ristretto", "pausecafe"];
export const estAtout = (x: unknown): x is AtoutId => (ATOUTS_LISTE as readonly unknown[]).includes(x);
export type IngredientId = "sel" | "herbes" | "truffe";
export const INGREDIENTS_LISTE: readonly IngredientId[] = ["sel", "herbes", "truffe"];

/** Mur sur lequel un achat est accroché (dessin à la craie, distributeur) : segment p → q, fraction t, normale tournée vers le joueur. */
export interface Facade { p: Vec2; q: Vec2; t: number; normale: Vec2 }

export interface Achat {
  /** id du catalogue (`mur:pompe`, `boite:B2`, `atout:gratin`, `pap`, `courant`, `ingredient:sel`, `four`, `D1`…) */
  id: string;
  genre: GenreAchat;
  prix: number;
  /** recharge de munitions (arme déjà possédée), à moitié prix */
  prixMunitions?: number;
  /** position (m) du joueur qui achète : devant le mur ou l'objet */
  position: Vec2;
  /** rayon d'action (m) */
  rayon: number;
  zone: ZoneId;
  /** `mur` : l'arme vendue */
  arme?: ArmeAchat;
  /** `porte` : l'id de la porte */
  porte?: PorteId;
  /** `atout` */
  atout?: AtoutId;
  /** `boite` : numéro d'emplacement (0 à 4) */
  emplacement?: number;
  /** `ingredient` */
  ingredient?: IngredientId;
  /** mur ou objet porteur : où dessiner (absent pour un objet posé au sol) */
  facade?: Facade;
}

const R_ACHAT = ZOMBIES.rayonAchat;
/** Distance (m) du point d'achat au mur. */
export const DECALAGE_FACADE_M = 1.1;

/** Point du segment p → q à la fraction t, décalé de `decalage` m du côté du point `cote` ; renvoie position et façade. */
function surMur(p: Vec2, q: Vec2, t: number, cote: Vec2, decalage = DECALAGE_FACADE_M): { position: Vec2; facade: Facade } {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
  let nx = -(q[1] - p[1]) / l, nz = (q[0] - p[0]) / l;
  const mx = p[0] + (q[0] - p[0]) * t, mz = p[1] + (q[1] - p[1]) * t;
  if ((cote[0] - mx) * nx + (cote[1] - mz) * nz < 0) { nx = -nx; nz = -nz; }
  return { position: arr([mx + nx * decalage, mz + nz * decalage]), facade: { p: arr(p), q: arr(q), t, normale: [nx, nz] } };
}
/** Même chose sur un mur local (s, t) d'un bâtiment creusé (face intérieure : décalé de l'épaisseur de la coque). */
function surMurLocal(b: BatimentCreux, de: Vec2, a: Vec2, t: number, coteLocal: Vec2, decalage = DECALAGE_FACADE_M, interieur = true): { position: Vec2; facade: Facade } {
  const ls = a[0] - de[0], lt = a[1] - de[1], L = Math.hypot(ls, lt);
  // décalage du mur vers l'intérieur (face intérieure de la coque, ou cloison sans décalage)
  let ns = -lt / L, nt = ls / L;
  const ms = de[0] + ls * t, mt = de[1] + lt * t;
  if ((coteLocal[0] - ms) * ns + (coteLocal[1] - mt) * nt < 0) { ns = -ns; nt = -nt; }
  const e = interieur ? 2 * DEMI_EPAISSEUR_COQUE : DEMI_EPAISSEUR_CLOISON;
  const p = local(b, de[0] + ns * e, de[1] + nt * e), q = local(b, a[0] + ns * e, a[1] + nt * e);
  return surMur(p, q, t, local(b, coteLocal[0], coteLocal[1]), decalage);
}

const mur = (arme: ArmeAchat, prix: number, prixMunitions: number | undefined, zone: ZoneId, pos: { position: Vec2; facade: Facade }): Achat => ({
  id: `mur:${arme}`, genre: "mur", prix, ...(prixMunitions !== undefined ? { prixMunitions } : {}), position: pos.position, rayon: R_ACHAT, zone, arme, facade: pos.facade,
});

/** Atouts : nom, prix, couleur (rendu, HUD), description. Pause Café : 500 $ en solo. */
export const ATOUTS: Readonly<Record<AtoutId, { nom: string; prix: number; prixSolo?: number; couleur: string; description: string; bo1: string }>> = {
  gratin: { nom: "Gratin Dauphinois", prix: 2500, couleur: "#e24a3b", description: "250 PV au lieu de 100", bo1: "Juggernog" },
  expresso: { nom: "Expresso Serré", prix: 3000, couleur: "#3fa34d", description: "Recharge deux fois plus vite", bo1: "Speed Cola" },
  ristretto: { nom: "Double Ristretto", prix: 2000, couleur: "#e6b422", description: "Cadence de tir × 1,33", bo1: "Double Tap" },
  pausecafe: { nom: "Pause Café", prix: 1500, prixSolo: 500, couleur: "#4fa3e0", description: "Relève en 1,5 s ; seul : se relève tout seul (3 fois)", bo1: "Quick Revive" },
};
/** Prix du Pack-a-Punch, des munitions d'une arme améliorée, de la boîte (BO1) et de la boîte en Happy hour. */
export const PRIX_PAP = 5000;
/**
 * (v8) Micro-ondes Gratinator, déroulé de BO1 (`vending_weapon_upgrade`) : l'arme payée est déposée DANS la machine (`entreeMs` : elle y
 * entre, la porte se ferme), cuit `cuissonMs` en tout (BO1 : reprise possible 4,35 s après le paiement), puis attend `repriseMs` que son
 * joueur vienne la reprendre (BO1 `packapunch_timeout` = 15 s), sinon elle est perdue, sans remboursement.
 */
export const PACK_A_PUNCH = { entreeMs: 700, cuissonMs: 4_000, repriseMs: 15_000 } as const;
export const PRIX_MUNITIONS_AMELIOREE = 2500;
export const PRIX_BOITE = 950;
export const PRIX_BOITE_SOLDES = 10;

/**
 * Caisse de la boîte mystère (m) : `longueur` le long du mur, `profondeur`, `recul` de son centre à la façade (le rendu la pose à
 * façade(t) + normale × recul, son grand côté le long de p → q, sa face ouverte vers la normale), `jeuCoin` entre son bout et le mur
 * perpendiculaire du coin.
 */
export const BOITE = { longueur: 1.6, profondeur: 0.75, recul: 0.5, jeuCoin: 0.15 } as const;
/**
 * Fraction t d'un mur de longueur `l` qui cale la caisse dans le coin du bout `bout` (0 : p, 1 : q) : son bout à `jeuCoin` de la face du mur
 * perpendiculaire, elle-même à `retrait` m en deçà du bout du segment (0,4 m pour une coque : épaisseur du mur voisin).
 */
function tCoin(l: number, bout: 0 | 1, retrait = 0): number {
  const k = (retrait + BOITE.jeuCoin + BOITE.longueur / 2) / l;
  return bout === 0 ? k : 1 - k;
}
const longueurLocale = (de: Vec2, a: Vec2): number => Math.hypot(a[0] - de[0], a[1] - de[1]);
const RETRAIT_COQUE = 2 * DEMI_EPAISSEUR_COQUE;
const LONGUEUR_MUR_SUD_EST = Math.hypot(MUR_SUD_EST[1][0] - MUR_SUD_EST[0][0], MUR_SUD_EST[1][1] - MUR_SUD_EST[0][1]);

/**
 * Emplacements de la boîte mystère (B1 à B5) : position du joueur et façade. Chaque caisse est dans un COIN (v8) : dos à un mur (la façade),
 * un bout à `jeuCoin` d'un mur perpendiculaire, face ouverte vers la pièce ; vérifié par un test (rayons vers le mur du fond et le mur du coin).
 */
const EMPLACEMENTS_BOITE: readonly { zone: ZoneId; pos: { position: Vec2; facade: Facade } }[] = [
  // Salle de pause : coin nord-est, contre le mur nord, à côté de la porte de service D3
  { zone: "pause", pos: surMurLocal(72, [30.9, -0.1], [23.3, -0.1], tCoin(longueurLocale([30.9, -0.1], [23.3, -0.1]), 0, RETRAIT_COQUE), [26, -5]) },
  // Cour Centre : coin nord-ouest, contre la façade du bâtiment 69, au pied du décrochement (près de la barricade N2c)
  { zone: "cour", pos: surMur([124.1, -77.5], [149.1, -70.4], tCoin(Math.hypot(25, 7.1), 0), [130, -60]) },
  // Cour Est : contre la façade sud, calée contre le conteneur de livraison
  {
    zone: "est",
    pos: surMur(MUR_SUD_EST[0], MUR_SUD_EST[1], FRACTION_CONTENEUR_EST + (AMENAGEMENTS.conteneur.w / 2 + BOITE.jeuCoin + BOITE.longueur / 2) / LONGUEUR_MUR_SUD_EST, [175, -30]),
  },
  // Cour Ouest (parking) : coin nord-ouest, contre le mur nord
  { zone: "ouest", pos: surMur([96.2, -85.5], [70.1, -92.9], tCoin(Math.hypot(26.1, 7.4), 1), [85, -75]) },
  // Labo : coin sud-ouest, contre le petit mur du fond
  { zone: "labo", pos: surMurLocal(74, [4.7, -9.7], [4.6, -14.6], tCoin(longueurLocale([4.7, -9.7], [4.6, -14.6]), 1, RETRAIT_COQUE), [10, -12]) },
];
export const NB_EMPLACEMENTS_BOITE = EMPLACEMENTS_BOITE.length;
/** Emplacements possibles au départ (BO1 : la boîte commence près du départ) : Salle de pause ou Cour Centre. */
export const EMPLACEMENTS_DEPART_BOITE: readonly number[] = [0, 1];

/** Tous les achats fixes (sans les portes) : armes au mur, atouts, Pack-a-Punch, boîtes, disjoncteur, ingrédients, four. */
export const ACHATS: readonly Achat[] = ([
  // Open space : le revolver (le M14 de BO1) et le fusil à pompe (l'Olympia)
  mur("revolver", 500, 250, "open", surMurLocal(72, [6, -10.4], [6, 0.05], 0.18, [0, -5], DECALAGE_FACADE_M, false)),
  mur("pompe", 500, 250, "open", surMurLocal(72, [-19, 0], [-19.1, -10.5], 0.5, [-10, -5])),
  // Salle de pause : le mini Uzi (le MPL)
  mur("mini_uzi", 1000, 500, "pause", surMurLocal(72, [6, -10.4], [6, 0.05], 0.82, [12, -5], DECALAGE_FACADE_M, false)),
  // Cour Centre : la mitraillette (l'AK74u)
  mur("mitraillette", 1200, 600, "cour", surMur([124.1, -77.5], [149.1, -70.4], 0.5, [136, -60])),
  // Cuisine : le fusil d'assaut (le M16)
  mur("fusil_assaut", 1200, 600, "cuisine", surMurLocal(70, [-12.7, 9.1], [-12.6, -17.3], 0.15, [-8, 6])),
  // Cour Est : l'épée (le Bowie)
  mur("epee", 3000, undefined, "est", surMur([176.7, -62.5], [201.7, -55.4], 0.7, [188, -45])),
  // Cour Ouest : le sniper
  mur("sniper", 1500, 750, "ouest", surMur([97.7, -83.1], [90.5, -57.9], 0.5, [80, -70])),
  // (v8) armes des zombies le long du chemin, de moins en moins chères à mesure qu'on s'éloigne du départ (BO1 : Olympia, FAL, PPSh, CZ75)
  // Passage Ouest : le Coupe-baguette, sur la façade du Labo
  mur("baguette", 750, 375, "i1", surMur([101.7, -34.5], [95.7, -36.2], 0.5, [102, -42])),
  // Passage Est : l'Agrafeuse, sur la façade de la Cuisine
  mur("agrafeuse", 1200, 600, "i2", surMur([148.1, -37.3], [156.0, -35.1], 0.5, [154, -22])),
  // Local technique : la Photocopieuse, à côté du disjoncteur
  mur("photocopieuse", 1500, 750, "local", surMurLocal(62, [0, -7.4], [0, 0], 0.82, [-5, -3])),
  // Labo : la Perforeuse, sur le mur du Micro-ondes
  mur("perforeuse", 1000, 500, "labo", surMurLocal(74, [49.7, -14.5], [49.6, -4.1], 0.12, [44, -9])),
  // atouts
  { id: "atout:pausecafe", genre: "atout", atout: "pausecafe", prix: ATOUTS.pausecafe.prix, rayon: R_ACHAT, zone: "pause", ...surMurLocal(72, [23.3, 4.2], [11.8, 4.1], 0.5, [17, -2]) },
  { id: "atout:expresso", genre: "atout", atout: "expresso", prix: ATOUTS.expresso.prix, rayon: R_ACHAT, zone: "cuisine", ...surMurLocal(70, [1.5, 1.7], [1.5, 9.0], 0.5, [-4, 5]) },
  { id: "atout:ristretto", genre: "atout", atout: "ristretto", prix: ATOUTS.ristretto.prix, rayon: R_ACHAT, zone: "est", ...surMur([176.7, -62.5], [201.7, -55.4], 0.3, [188, -45]) },
  { id: "atout:gratin", genre: "atout", atout: "gratin", prix: ATOUTS.gratin.prix, rayon: R_ACHAT, zone: "ouest", ...surMur([96.2, -85.5], [70.1, -92.9], 0.6, [85, -75]) },
  // Pack-a-Punch (Labo), disjoncteur (Local technique), four (Cuisine)
  { id: "pap", genre: "pap", prix: PRIX_PAP, rayon: R_ACHAT, zone: "labo", ...surMurLocal(74, [49.7, -14.5], [49.6, -4.1], 0.55, [44, -9]) },
  { id: "courant", genre: "courant", prix: 0, rayon: R_ACHAT, zone: "local", ...surMurLocal(62, [0, -7.4], [0, 0], 0.4, [-5, -3]) },
  { id: "four", genre: "four", prix: 0, rayon: R_ACHAT, zone: "cuisine", ...surMurLocal(70, [-6.6, 11.8], [-6.6, 8.9], 0.5, [-3, 6]) },
  // ingrédients de la Recette ultime
  { id: "ingredient:sel", genre: "ingredient", ingredient: "sel", prix: 0, rayon: 2, zone: "cuisine", position: local(70, -2.2, -18.9) },
  { id: "ingredient:herbes", genre: "ingredient", ingredient: "herbes", prix: 0, rayon: 2, zone: "ouest", position: L74(16.4, 22.9) },
  { id: "ingredient:truffe", genre: "ingredient", ingredient: "truffe", prix: 0, rayon: 2, zone: "labo", position: local(74, 35.7, -11.6) },
  // boîtes
  ...EMPLACEMENTS_BOITE.map((e, i): Achat => ({ id: `boite:B${i + 1}`, genre: "boite", emplacement: i, prix: PRIX_BOITE, rayon: R_ACHAT, zone: e.zone, ...e.pos })),
] as Achat[]).map((a): Achat => ({ ...a, position: arr(a.position) }));

/** Achats « porte » du catalogue (position = point d'achat, rayon = portée), un par porte payante. */
export const ACHATS_PORTES: readonly Achat[] = PORTES_PAYANTES.map((p) => ({
  id: p.id, genre: "porte" as const, prix: p.prix, position: p.point, rayon: p.portee, zone: p.zones[0], porte: p.id,
}));

/** Achat du catalogue (fixes puis portes) par id. */
export function achatDeId(id: string): Achat | null {
  return ACHATS.find((a) => a.id === id) ?? ACHATS_PORTES.find((a) => a.id === id) ?? null;
}
export const achatBoite = (emplacement: number): Achat => ACHATS.find((a) => a.genre === "boite" && a.emplacement === emplacement)!;
export const achatAtout = (id: AtoutId): Achat => ACHATS.find((a) => a.genre === "atout" && a.atout === id)!;

/**
 * Ce qui est actif pour le filtrage des invites : emplacement(s) des boîtes présentes (la principale, plus celles du Happy hour), portes
 * ouvertes, ingrédients déjà pris, courant.
 */
export interface EtatCarte { ouvertes?: Iterable<string>; boite?: number | readonly number[] | null; ingredientsPris?: Iterable<string>; courant?: boolean }

/**
 * Achats à portée de `pos` : les achats fixes à moins de leur rayon et les portes à moins de leur portée du SEGMENT de leur pièce. Les
 * portes déjà ouvertes, les boîtes absentes de l'emplacement courant, les ingrédients pris (et la truffe sans courant) sont écartés.
 * Triés du plus proche au plus lointain.
 */
export function achatsProches(pos: Vec2, e: EtatCarte | ReadonlySet<string> | readonly string[] = {}): Achat[] {
  const etat: EtatCarte = e instanceof Set || Array.isArray(e) ? { ouvertes: e as Iterable<string> } : (e as EtatCarte);
  const o = new Set(etat.ouvertes ?? []);
  const pris = new Set(etat.ingredientsPris ?? []);
  const boites = etat.boite === undefined ? null : new Set(typeof etat.boite === "number" ? [etat.boite] : etat.boite ?? []);
  const res: { a: Achat; d: number }[] = [];
  for (const a of ACHATS) {
    if (a.genre === "boite" && boites && !boites.has(a.emplacement!)) continue;
    if (a.genre === "ingredient" && (pris.has(a.ingredient!) || (a.ingredient === "truffe" && !etat.courant))) continue;
    const d = Math.hypot(pos[0] - a.position[0], pos[1] - a.position[1]);
    if (d <= a.rayon) res.push({ a, d });
  }
  for (const porte of PORTES_PAYANTES) {
    if (o.has(porte.id)) continue;
    const d = distancePorte(porte, pos);
    if (d <= porte.portee) res.push({ a: ACHATS_PORTES.find((x) => x.porte === porte.id)!, d });
  }
  res.sort((x, y) => x.d - y.d);
  return res.map((r) => r.a);
}

// ---------------------------------------------------------------------------------------------
// Notes de lore, quais du Truck, départs
// ---------------------------------------------------------------------------------------------

/** Notes à lire (texte dans `zombies-lore.ts`) : position et zone. */
export const NOTES: readonly { id: number; zone: ZoneId; position: Vec2 }[] = ([
  { id: 1, zone: "open", position: local(72, -8.5, -3.2) },
  { id: 2, zone: "pause", position: local(72, 18.5, -6.5) },
  { id: 3, zone: "cour", position: [134, -62] },
  { id: 4, zone: "cuisine", position: local(70, -5.5, 1.5) },
  { id: 5, zone: "est", position: [190, -40] },
  { id: 6, zone: "local", position: local(62, -5, -24.5) },
  { id: 7, zone: "ouest", position: [84, -60] },
  { id: 8, zone: "labo", position: local(74, 25, -4.5) },
] as { id: number; zone: ZoneId; position: Vec2 }[]).map((n) => ({ ...n, position: arr(n.position) }));

/**
 * Quais du Truck Muche (hors des zones jouables, devant des fenêtres) : point où il se gare, cap (tourné de dos vers la fenêtre), point de
 * départ de son arrivée (il recule depuis là), fenêtre la plus proche.
 */
export interface Quai { id: number; p: Vec2; cap: number; depart: Vec2; fenetre: string }
function definirQuai(id: number, fenetre: string, recul: number): Quai {
  const f = fenetreDeId(fenetre)!;
  const p = arr([f.milieu[0] - f.normale[0] * 11, f.milieu[1] - f.normale[1] * 11]);
  // l'arrière du Truck regarde la fenêtre : son avant pointe à l'opposé (convention du cap : avant = (−sin, −cos))
  const cap = capVers(p[0], p[1], p[0] - f.normale[0], p[1] - f.normale[1]);
  const depart = arr([p[0] - f.normale[0] * recul, p[1] - f.normale[1] * recul]);
  return { id, p, cap, depart, fenetre };
}
export const QUAIS: readonly Quai[] = [
  definirQuai(0, "F2", 4), definirQuai(1, "F4", 4), definirQuai(2, "F5", 3), definirQuai(3, "F6", 4), definirQuai(4, "N2c", 4),
];

/** Truck Muche : durées de l'arrivée et du départ (ms), lâcher des petits (deux toutes les `lacherMs`), épave (ms), souffle (m), caisse (m). */
export const TRUCK = { arriveeMs: 4_000, departMs: 4_000, lacherMs: 1_400, epaveMs: 8_000, souffleM: 6, demiLongueur: 3.2, demiLargeur: 1.3, hauteur: 3 } as const;

/**
 * Distance le long du rayon (o, d normalisé) jusqu'à la caisse orientée du Truck (centre `p` au sol, cap `cap`), ou null. Pur, testé.
 */
export function rayonTruck(o: readonly [number, number, number], d: readonly [number, number, number], p: Vec2, cap: number, portee: number): number | null {
  // repère de la caisse : avant (−sin, −cos), côté (cos, −sin), haut y
  const fx = -Math.sin(cap), fz = -Math.cos(cap), cx = Math.cos(cap), cz = -Math.sin(cap);
  const ox = o[0] - p[0], oy = o[1] - TRUCK.hauteur / 2, oz = o[2] - p[1];
  const lo = [ox * fx + oz * fz, oy, ox * cx + oz * cz];
  const ld = [d[0] * fx + d[2] * fz, d[1], d[0] * cx + d[2] * cz];
  const demi = [TRUCK.demiLongueur, TRUCK.hauteur / 2, TRUCK.demiLargeur];
  let t0 = 0, t1 = portee;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(ld[k]) < 1e-9) { if (Math.abs(lo[k]) > demi[k]) return null; continue; }
    let a = (-demi[k] - lo[k]) / ld[k], b = (demi[k] - lo[k]) / ld[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Huit points de départ des joueurs, dans l'open space (allées entre les bureaux). */
export const DEPARTS: readonly Vec2[] = [
  local(72, -16.5, -5.4), local(72, -11, -5.4), local(72, -5.5, -5.4), local(72, 0.5, -5.4),
  local(72, -11.2, -1.5), local(72, -5.6, 1.8), local(72, 3.6, -8.6), local(72, -17, -9.2),
].map(arr);
/** Centre de l'open space : les joueurs y apparaissent tournés vers lui. */
export const CENTRE_DEPART: Vec2 = arr(local(72, -6, -5.5));
/** Lacet (convention de monstres.ts) du joueur au départ `i`. */
export function lacetDepart(i: number): number {
  const d = DEPARTS[((i % DEPARTS.length) + DEPARTS.length) % DEPARTS.length];
  const c = Math.hypot(d[0] - CENTRE_DEPART[0], d[1] - CENTRE_DEPART[1]) < 1 ? local(72, 6, -5) : CENTRE_DEPART;
  return capVers(d[0], d[1], c[0], c[1]);
}

// ---------------------------------------------------------------------------------------------
// Données de scène, monde, zones au sol
// ---------------------------------------------------------------------------------------------

export interface DonneesZombies {
  /** copie de la scène : bâtiments creusés en `type: "creux"`, pièces ajoutées à la fin de `buildings`, sans le POI `truck` */
  data: SceneData;
  bornes: Boite;
  zones: readonly Zone[];
  portes: readonly Porte[];
  achats: readonly Achat[];
  departs: readonly Vec2[];
  fenetres: readonly Fenetre[];
  pieces: readonly PieceSynth[];
}

const copieBatiment = (b: Building): Building => ({
  ...b,
  r: b.r.map((p) => [p[0], p[1]] as Vec2),
  c: [b.c[0], b.c[1]],
  ...(b.holes ? { holes: b.holes.map((h) => h.map((p) => [p[0], p[1]] as Vec2)) } : {}),
});

/**
 * Scène de la carte zombies, SANS modifier `scene` : bâtiments copiés en profondeur, les quatre creusés passent en `creux`, les pièces
 * s'ajoutent à la fin (à partir de l'index 142), le POI `truck` est retiré et le focus est fixé sur l'open space.
 */
export function donneesZombies(scene: SceneData): DonneesZombies {
  const buildings = scene.buildings.map(copieBatiment);
  if (buildings.length !== INDEX_PREMIERE_PIECE) throw new Error(`scene.json : ${buildings.length} bâtiments, ${INDEX_PREMIERE_PIECE} attendus`);
  for (const b of BATIMENTS_CREUX) buildings[b].type = "creux";
  const pieces = piecesSynth(scene);
  for (const p of pieces) buildings.push(batimentDePiece(p));
  const data: SceneData = { ...scene, buildings, pois: scene.pois.filter((p) => p.type !== "truck"), focus: [FOCUS_ZOMBIES[0], FOCUS_ZOMBIES[1]] };
  return { data, bornes: { ...BORNES_ZOMBIES }, zones: ZONES, portes: PORTES_PAYANTES, achats: ACHATS, departs: DEPARTS, fenetres: FENETRES, pieces };
}

/** Types dont le prisme garde sa vraie hauteur (le mobilier : on tire par-dessus) ; les bâtiments creusés n'ont pas de prisme utile (h = 0). */
const HAUTEUR_REELLE: ReadonlySet<string> = new Set(["meuble"]);


/** Dessous du faux plafond d'un bâtiment creusé de hauteur `h` (m) : `HAUTEUR_PLAFOND_ZOMBIES`, ou 0,3 m sous un toit plus bas. */
export const plafondZombies = (h: number): number => Math.min(HAUTEUR_PLAFOND_ZOMBIES, h - 0.3);

/**
 * Monde de collision de la carte zombies : bornes réduites, bâtiments creusés sans hauteur (ni collision ni rayon, jamais relevés), murs
 * hauts (`h = hOrigine = 40`) pour tout le reste sauf le mobilier, pas de wall-run, de double saut ni d'escalade (`sansParkour`).
 * Plafonds (`Prisme.plafond`, `Monde.plafonds`) : l'emprise d'un bâtiment creusé a son faux plafond (`plafondZombies`), une porte
 * intérieure son linteau (`HAUTEUR_PORTE_INTERIEURE`, gardé quand la porte est achetée) ; la tête du joueur ne les passe pas.
 */
export function construireMondeZombies(scene: SceneData): Monde {
  const { data: donnees, pieces } = donneesZombies(scene);
  const monde = construireMonde(donnees);
  monde.bornes = { ...BORNES_ZOMBIES };
  monde.prismes.forEach((p, i) => {
    const t = donnees.buildings[i]?.type;
    if (t === "creux") { p.plafond = plafondZombies(donnees.buildings[i].h); p.h = 0; p.hOrigine = 0; return; }
    // linteau d'une porte intérieure (dessiné de 2,6 m au toit par `rendu-interieurs.ts`)
    if (t === "porte" && i >= INDEX_PREMIERE_PIECE && pieces[i - INDEX_PREMIERE_PIECE]?.batiment !== undefined) p.plafond = HAUTEUR_PORTE_INTERIEURE;
    if (t && HAUTEUR_REELLE.has(t)) return;
    p.h = HAUTEUR_MURS_ZOMBIES; p.hOrigine = HAUTEUR_MURS_ZOMBIES;
  });
  monde.sansParkour = true;
  monde.plafonds = true;
  return monde;
}

/** Étiquettes des zones au sol : grille de `taille` m, `zone[i + j × nx]` = rang dans `ZONES`, −1 hors zone (mur, dehors). */
export interface CarteZones { x0: number; z0: number; taille: number; nx: number; nz: number; zone: Int8Array }

/**
 * Remplit les zones par flood-fill (cases de 1 m, joueur de rayon 0,4 m) depuis leur graine, toutes portes et fenêtres FERMÉES (le monde
 * fourni doit être celui d'une partie neuve). Une case atteinte par deux graines reste à la première (ne doit pas arriver : testé).
 */
export function etiqueterZones(monde: Monde, taille = 1): CarteZones {
  const b = BORNES_ZOMBIES;
  const nx = Math.ceil((b.x1 - b.x0) / taille), nz = Math.ceil((b.z1 - b.z0) / taille);
  const zone = new Int8Array(nx * nz).fill(-1);
  const libre = new Int8Array(nx * nz).fill(-1);
  const estLibre = (k: number): boolean => {
    if (libre[k] < 0) {
      const x = b.x0 + ((k % nx) + 0.5) * taille, z = b.z0 + (Math.floor(k / nx) + 0.5) * taille;
      libre[k] = resoudre(monde, [x, 0, z], 0.4, 1.8).contacts.length ? 0 : 1;
    }
    return libre[k] === 1;
  };
  ZONES.forEach((zz, rang) => {
    const i0 = Math.floor((zz.graine[0] - b.x0) / taille), j0 = Math.floor((zz.graine[1] - b.z0) / taille);
    const k0 = i0 + j0 * nx;
    if (!estLibre(k0) || zone[k0] >= 0) return;
    const file = [k0];
    zone[k0] = rang;
    while (file.length) {
      const k = file.pop()!;
      const i = k % nx, j = Math.floor(k / nx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const a = i + di, c = j + dj;
        if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
        const kk = a + c * nx;
        if (zone[kk] >= 0 || !estLibre(kk)) continue;
        zone[kk] = rang;
        file.push(kk);
      }
    }
  });
  return { x0: b.x0, z0: b.z0, taille, nx, nz, zone };
}

/** Zone du point (x, z) selon les étiquettes, null hors zone (on cherche aussi dans les cases voisines : un joueur collé à un mur). */
export function zoneEn(c: CarteZones, x: number, z: number): ZoneId | null {
  const i = Math.floor((x - c.x0) / c.taille), j = Math.floor((z - c.z0) / c.taille);
  for (let r = 0; r <= 1; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= c.nx || b >= c.nz) continue;
      const v = c.zone[a + b * c.nx];
      if (v >= 0) return ZONES[v].id;
    }
  }
  return null;
}

/**
 * Sorties du sol des zones extérieures : centres des cases de 4 m de la zone dont tout le disque de 2 m est dans la zone (loin des murs).
 * Tri déterministe (zone puis position).
 */
export function sortiesDuSol(c: CarteZones, pas = 4, marge = 2): { zone: ZoneId; p: Vec2 }[] {
  const res: { zone: ZoneId; p: Vec2 }[] = [];
  for (const z of ZONES) {
    if (z.interieur) continue;
    const rang = ZONES.indexOf(z);
    for (let x = BORNES_ZOMBIES.x0 + pas / 2; x < BORNES_ZOMBIES.x1; x += pas) {
      for (let zz = BORNES_ZOMBIES.z0 + pas / 2; zz < BORNES_ZOMBIES.z1; zz += pas) {
        let ok = true;
        for (let a = 0; a < 8 && ok; a++) {
          const ang = (a / 8) * 2 * Math.PI;
          for (const r of [0, marge]) {
            const px = x + Math.cos(ang) * r, pz = zz + Math.sin(ang) * r;
            const i = Math.floor((px - c.x0) / c.taille), j = Math.floor((pz - c.z0) / c.taille);
            if (i < 0 || j < 0 || i >= c.nx || j >= c.nz || c.zone[i + j * c.nx] !== rang) { ok = false; break; }
          }
        }
        if (ok) res.push({ zone: z.id, p: [x, zz] });
      }
    }
  }
  return res;
}
