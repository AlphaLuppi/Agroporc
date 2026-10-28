/**
 * Carte « Cour des Restos » du mode zombies (PUR : aucune dépendance en dehors de lib/fps et lib/agroparc3d, `scene.json` est passé en
 * paramètre et n'est JAMAIS modifié). Pièces synthétiques (portes payantes, barricades, champs passe-tigres, murs), portes payantes,
 * fenêtres d'où entrent les tigres, points de départ, achats au mur. Serveur ET client appellent `donneesZombies` / `construireMondeZombies`
 * avant de bâtir le monde de collision, pour que les deux voient exactement la même carte.
 * Repère de scene.json : x vers l'est, z vers le sud, mètres.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Carte « Cour des Restos » »)
 */
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde, type Boite, type Monde } from "./collision";
import { capVers } from "./monstres";
import type { ArmeFeuId } from "./protocole";
import { ZOMBIES } from "./zombies-vagues";

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

/** Bornes de la zone de jeu (m) : plus étroites que celles de l'arène. */
export const BORNES_ZOMBIES: Boite = { x0: 8, z0: -110, x1: 214, z1: 24 };
/** Hauteur de TOUS les prismes de la carte zombies (murs hauts : ni toit ni saut de mur ne permet de quitter la zone). */
export const HAUTEUR_MURS_ZOMBIES = 40;
/** Index de la première pièce synthétique dans `buildings` (`scene.json` en a 142). */
export const INDEX_PREMIERE_PIECE = 142;
/** Demi-épaisseur (m) d'une pièce synthétique, prolongement (m) à chacun de ses bouts, hauteur de dessin (m). */
export const DEMI_EPAISSEUR_PIECE = 0.8;
export const PROLONGEMENT_PIECE = 0.3;
export const HAUTEUR_PIECE = 6;
/** Centre de la cour de départ : les joueurs y apparaissent tournés vers lui. */
export const CENTRE_COUR: Vec2 = [128, -50];
/** Point de focus de la caméra de la carte zombies. */
export const FOCUS_ZOMBIES: Vec2 = [130, -50];

export type PorteId = "P1" | "P2" | "P3" | "P4" | "P5";
export type ZoneId = "centre" | "est" | "ouest" | "niche";
export type TypePiece = NonNullable<Building["type"]>;

// ---------------------------------------------------------------------------------------------
// Pièces synthétiques
// ---------------------------------------------------------------------------------------------

export interface PieceSynth { id: string; type: TypePiece; p: Vec2; q: Vec2 }

/** Les 20 pièces, dans l'ordre FIXE de la spec : index `INDEX_PREMIERE_PIECE + rang` dans `buildings`. */
export const PIECES_SYNTH: readonly PieceSynth[] = [
  { id: "G1", type: "porte", p: [96.8, -40.2], q: [100.0, -51.1] },
  { id: "G2", type: "porte", p: [106.4, -33.2], q: [103.1, -50.2] },
  { id: "G3", type: "porte", p: [148.1, -37.3], q: [145.1, -26.5] },
  { id: "G4", type: "porte", p: [159.2, -18.1], q: [156.0, -35.1] },
  { id: "E", type: "porte", p: [200.6, -22.3], q: [197.6, -11.5] },
  { id: "S1", type: "barricade", p: [98.9, -24.5], q: [103.5, -23.2] },
  { id: "S2", type: "barricade", p: [151.6, -9.5], q: [156.3, -8.1] },
  { id: "N4", type: "barricade", p: [164.2, -64.1], q: [170.5, -62.3] },
  { id: "W", type: "barricade", p: [55.1, -52.1], q: [58.2, -63.0] },
  { id: "N2c", type: "champ", p: [117.9, -77.2], q: [111.4, -79.1] },
  { id: "S1c", type: "champ", p: [98.9, -24.5], q: [103.5, -23.2] },
  { id: "S2c", type: "champ", p: [151.6, -9.5], q: [156.3, -8.1] },
  { id: "N4c", type: "champ", p: [164.2, -64.1], q: [170.5, -62.3] },
  { id: "Wc", type: "champ", p: [55.1, -52.1], q: [58.2, -63.0] },
  { id: "N1", type: "mur", p: [96.2, -85.5], q: [97.7, -83.1] },
  { id: "N3", type: "mur", p: [149.1, -70.4], q: [150.6, -68.1] },
  { id: "N5", type: "mur", p: [201.7, -55.4], q: [203.0, -53.1] },
  { id: "PW", type: "mur", p: [55.5, -36.8], q: [55.5, 24] },
  { id: "PN", type: "mur", p: [55.2, -101.3], q: [55.2, -110] },
  { id: "PE", type: "mur", p: [207.8, 6.6], q: [207.8, 24] },
];

const pieceDe = (id: string): PieceSynth => {
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

/** Bâtiment de la pièce : rectangle du segment p → q, demi-épaisseur 0,8 m, prolongé de 0,3 m à chaque bout, h 6, c = milieu. */
export function batimentDePiece(piece: PieceSynth): Building {
  const [px, pz] = piece.p, [qx, qz] = piece.q;
  const l = Math.hypot(qx - px, qz - pz);
  const ux = (qx - px) / l, uz = (qz - pz) / l;
  const nx = -uz, nz = ux;
  const e = DEMI_EPAISSEUR_PIECE, a = PROLONGEMENT_PIECE;
  const ax = px - ux * a, az = pz - uz * a, bx = qx + ux * a, bz = qz + uz * a;
  return {
    h: HAUTEUR_PIECE,
    r: [[ax + nx * e, az + nz * e], [ax - nx * e, az - nz * e], [bx - nx * e, bz - nz * e], [bx + nx * e, bz + nz * e]],
    c: [(px + qx) / 2, (pz + qz) / 2],
    type: piece.type,
  };
}

// ---------------------------------------------------------------------------------------------
// Zones, portes payantes
// ---------------------------------------------------------------------------------------------

export interface Zone {
  id: ZoneId;
  nom: string;
  /** portes à ouvrir pour y accéder (toutes, prérequis compris) */
  portes: readonly PorteId[];
}
export const ZONES: readonly Zone[] = [
  { id: "centre", nom: "Cour Centre", portes: [] },
  { id: "est", nom: "Cour Est", portes: ["P1", "P2"] },
  { id: "ouest", nom: "Cour Ouest", portes: ["P3", "P4"] },
  { id: "niche", nom: "Niche Est", portes: ["P1", "P2", "P5"] },
];

export interface Porte {
  id: PorteId;
  prix: number;
  prerequis: PorteId | null;
  /** pièces détruites à l'ouverture, la première définit la portée d'achat */
  prismes: readonly string[];
  /** fenêtre à tigres (champ) activée par l'ouverture, null s'il n'y en a pas */
  fenetre: string | null;
  /** point d'achat : milieu du segment du premier prisme */
  point: Vec2;
  /** distance maximale (m) au segment du premier prisme, des deux côtés */
  portee: number;
}

const milieu = (id: string): Vec2 => { const s = pieceDe(id); return [(s.p[0] + s.q[0]) / 2, (s.p[1] + s.q[1]) / 2]; };
const definirPorte = (id: PorteId, prix: number, prerequis: PorteId | null, prismes: string[], fenetre: string | null): Porte => ({
  id, prix, prerequis, prismes, fenetre, point: milieu(prismes[0]), portee: ZOMBIES.porteeAchatPorte,
});

/** Les cinq portes payantes, dans l'ordre de la spec. */
export const PORTES_PAYANTES: readonly Porte[] = [
  definirPorte("P1", 750, null, ["G3", "S2"], "S2c"),
  definirPorte("P3", 1000, null, ["G2", "S1"], "S1c"),
  definirPorte("P2", 1250, "P1", ["G4", "N4"], "N4c"),
  definirPorte("P4", 1500, "P3", ["G1", "W"], "Wc"),
  definirPorte("P5", 2000, "P2", ["E"], null),
];
/** Alias de `PORTES_PAYANTES`. */
export const PORTES = PORTES_PAYANTES;

export function porteDeId(id: string): Porte | null {
  return PORTES_PAYANTES.find((p) => p.id === id) ?? null;
}

/** Distance (m) du point (x, z) au segment p → q. */
function distanceSegment(x: number, z: number, p: Vec2, q: Vec2): number {
  const ux = q[0] - p[0], uz = q[1] - p[1], l2 = ux * ux + uz * uz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - p[0]) * ux + (z - p[1]) * uz) / l2)) : 0;
  return Math.hypot(x - (p[0] + ux * t), z - (p[1] + uz * t));
}

/** Distance (m) de `pos` au segment du premier prisme de la porte (la porte est à cheval sur deux zones : les deux côtés comptent). */
export function distancePorte(porte: Porte, pos: Vec2): number {
  const s = pieceDe(porte.prismes[0]);
  return distanceSegment(pos[0], pos[1], s.p, s.q);
}

// ---------------------------------------------------------------------------------------------
// Fenêtres à tigres, départs
// ---------------------------------------------------------------------------------------------

export interface Fenetre {
  /** id du champ passe-tigres (aussi celui de la fenêtre) */
  id: string;
  milieu: Vec2;
  /** points d'apparition à 6, 12 et 18 m côté extérieur le long de la normale */
  points: readonly [Vec2, Vec2, Vec2];
  /** porte dont l'ouverture active la fenêtre, null si elle l'est dès le départ */
  porte: PorteId | null;
}

/** `N2c` est l'unique entrée de tigres au départ ; les autres s'activent avec leur porte. */
export const FENETRES: readonly Fenetre[] = [
  { id: "N2c", milieu: milieu("N2c"), porte: null, points: [[116.3, -83.9], [118.0, -89.7], [119.6, -95.5]] },
  { id: "S1c", milieu: milieu("S1c"), porte: "P3", points: [[99.6, -18.1], [98.0, -12.3], [96.4, -6.5]] },
  { id: "S2c", milieu: milieu("S2c"), porte: "P1", points: [[152.2, -3.0], [150.5, 2.7], [148.8, 8.4]] },
  { id: "N4c", milieu: milieu("N4c"), porte: "P2", points: [[169.0, -69.0], [170.6, -74.7], [172.3, -80.5]] },
  { id: "Wc", milieu: milieu("Wc"), porte: "P4", points: [[50.9, -59.2], [45.1, -60.9], [39.3, -62.5]] },
];

/** Huit points de départ des joueurs, dans la cour Centre (≥ 12 m de `N2c`, ≥ 2,5 m des murs). */
export const DEPARTS: readonly Vec2[] = [
  [126.5, -53], [142.5, -30.5], [109.5, -35.5], [107.5, -56], [147, -67.5], [120, -45], [135, -38], [130, -62],
];

/** Lacet (convention de monstres.ts) du joueur au départ `i` : tourné vers le centre de la cour. */
export function lacetDepart(i: number): number {
  const d = DEPARTS[((i % DEPARTS.length) + DEPARTS.length) % DEPARTS.length];
  return capVers(d[0], d[1], CENTRE_COUR[0], CENTRE_COUR[1]);
}

/** Fenêtres actives selon les portes ouvertes (celles sans porte le sont toujours). */
export function fenetresActives(ouvertes: ReadonlySet<string> | readonly string[]): Fenetre[] {
  const o = ouvertes instanceof Set ? ouvertes : new Set(ouvertes);
  return FENETRES.filter((f) => f.porte === null || o.has(f.porte));
}

// ---------------------------------------------------------------------------------------------
// Achats
// ---------------------------------------------------------------------------------------------

export type GenreAchat = "mur" | "porte" | "boite" | "soin";
/** Arme à acheter au mur : une arme à feu ou l'épée. */
export type ArmeAchat = ArmeFeuId | "epee";

export interface Achat {
  /** id du catalogue (`mur:pompe`, `boite`, `soin`, `P1`…) */
  id: string;
  genre: GenreAchat;
  prix: number;
  /** recharge de munitions (arme déjà possédée), à moitié prix */
  prixMunitions?: number;
  /** position (m) : point de la façade décalé de 1,2 m du côté libre */
  position: Vec2;
  /** rayon d'action (m) */
  rayon: number;
  zone: ZoneId;
  /** `mur` : l'arme vendue */
  arme?: ArmeAchat;
  /** `porte` : l'id de la porte payante */
  porte?: PorteId;
  /** `mur` : façade d'où la position est calculée (bâtiment, segment p → q, fraction t) ; absent pour l'achat posé à la main */
  facade?: { batiment: number; p: Vec2; q: Vec2; t: number };
}

const R_ACHAT = ZOMBIES.rayonAchat;
const mur = (arme: ArmeAchat, prix: number, prixMunitions: number | undefined, zone: ZoneId, position: Vec2, facade?: Achat["facade"]): Achat => ({
  id: `mur:${arme}`, genre: "mur", prix, ...(prixMunitions !== undefined ? { prixMunitions } : {}), position, rayon: R_ACHAT, zone, arme, ...(facade ? { facade } : {}),
});

/** Distance du point d'achat à la façade (m), du côté libre. */
export const DECALAGE_FACADE_M = 1.2;

/** Les onze achats fixes (sans les portes payantes), positions EXACTES de la spec. */
export const ACHATS: readonly Achat[] = [
  mur("pistolet", 250, 125, "centre", [144.0, -49.4], { batiment: 70, p: [143.4, -42.7], q: [150.6, -68.1], t: 0.25 }),
  mur("epee", 500, undefined, "centre", [147.6, -62.1], { batiment: 70, p: [143.4, -42.7], q: [150.6, -68.1], t: 0.75 }),
  mur("mini_uzi", 500, 250, "centre", [136.3, -72.8], { batiment: 69, p: [124.1, -77.5], q: [149.1, -70.4], t: 0.5 }),
  mur("revolver", 650, 325, "centre", [120.6, -34.7], { batiment: 72, p: [114.7, -35.1], q: [125.8, -31.9], t: 0.5 }),
  mur("pompe", 900, 450, "est", [188.9, -57.8], { batiment: 61, p: [176.7, -62.5], q: [201.7, -55.4], t: 0.5 }),
  { id: "boite", genre: "boite", prix: 950, position: [198.2, -40.7], rayon: R_ACHAT, zone: "est", facade: { batiment: 62, p: [203.0, -53.1], q: [195.8, -27.7], t: 0.5 } },
  { id: "soin", genre: "soin", prix: 400, position: [173.4, -19.7], rayon: R_ACHAT, zone: "est", facade: { batiment: 73, p: [178.6, -17.0], q: [167.5, -20.1], t: 0.5 } },
  mur("mitraillette", 1000, 500, "ouest", [86.7, -44.3], { batiment: 74, p: [96.8, -40.2], q: [55.1, -52.1], t: 0.25 }),
  mur("fusil_assaut", 1300, 650, "ouest", [65.9, -50.3], { batiment: 74, p: [96.8, -40.2], q: [55.1, -52.1], t: 0.75 }),
  mur("sniper", 1500, 750, "ouest", [92.9, -70.8], { batiment: 75, p: [97.7, -83.1], q: [90.5, -57.9], t: 0.5 }),
  mur("mitrailleuse", 2000, 1000, "niche", [211.0, 18.0]),
];

/** Niche Est : fond de la niche, où se tient l'achat de la mitrailleuse (atteinte après `P5`). */
export const NICHE: Vec2 = [211.0, 18.0];

/** Achats « porte » du catalogue (position = point d'achat, rayon = portée de la porte), un par porte payante. */
export const ACHATS_PORTES: readonly Achat[] = PORTES_PAYANTES.map((p) => ({
  id: p.id, genre: "porte" as const, prix: p.prix, position: p.point, rayon: p.portee, zone: "centre" as ZoneId, porte: p.id,
}));

/** Achat du catalogue (fixes puis portes) par id. */
export function achatDeId(id: string): Achat | null {
  return ACHATS.find((a) => a.id === id) ?? ACHATS_PORTES.find((a) => a.id === id) ?? null;
}

/**
 * Achats à portée de `pos` : les achats fixes à moins de leur rayon (2,5 m) et les portes à moins de leur portée (3 m) du SEGMENT de leur
 * premier prisme. Les portes déjà ouvertes (`ouvertes`) sont écartées. Triés du plus proche au plus lointain.
 */
export function achatsProches(pos: Vec2, ouvertes: ReadonlySet<string> | readonly string[] = []): Achat[] {
  const o = ouvertes instanceof Set ? ouvertes : new Set(ouvertes);
  const res: { a: Achat; d: number }[] = [];
  for (const a of ACHATS) {
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
// Données de scène et monde
// ---------------------------------------------------------------------------------------------

export interface DonneesZombies {
  /** copie de la scène avec les 20 pièces ajoutées à la fin de `buildings` et sans le POI `truck` */
  data: SceneData;
  bornes: Boite;
  zones: readonly Zone[];
  portes: readonly Porte[];
  achats: readonly Achat[];
  departs: readonly Vec2[];
  fenetres: readonly Fenetre[];
}

const copieBatiment = (b: Building): Building => ({
  ...b,
  r: b.r.map((p) => [p[0], p[1]] as Vec2),
  c: [b.c[0], b.c[1]],
  ...(b.holes ? { holes: b.holes.map((h) => h.map((p) => [p[0], p[1]] as Vec2)) } : {}),
});

/**
 * Scène de la carte zombies, SANS modifier `scene` : les bâtiments sont copiés en profondeur, les 20 pièces s'y ajoutent à la fin
 * (index 142 à 161), le POI `truck` est retiré (plus de prisme `fixe` du Truck) et le focus est fixé sur la cour Centre. Le reste de
 * la scène (routes, arbres…) est partagé tel quel, en lecture seule.
 */
export function donneesZombies(scene: SceneData): DonneesZombies {
  const buildings = scene.buildings.map(copieBatiment);
  if (buildings.length !== INDEX_PREMIERE_PIECE) throw new Error(`scene.json : ${buildings.length} bâtiments, ${INDEX_PREMIERE_PIECE} attendus`);
  for (const piece of PIECES_SYNTH) buildings.push(batimentDePiece(piece));
  const data: SceneData = { ...scene, buildings, pois: scene.pois.filter((p) => p.type !== "truck"), focus: [FOCUS_ZOMBIES[0], FOCUS_ZOMBIES[1]] };
  return { data, bornes: { ...BORNES_ZOMBIES }, zones: ZONES, portes: PORTES_PAYANTES, achats: ACHATS, departs: DEPARTS, fenetres: FENETRES };
}

/**
 * Monde de collision de la carte zombies : bornes réduites et murs hauts (`h = hOrigine = 40` pour TOUS les prismes, pour qu'on ne puisse
 * ni marcher sur un toit ni sauter par-dessus un mur). Le décor garde, lui, les vraies hauteurs de `donneesZombies(scene).data`.
 */
export function construireMondeZombies(scene: SceneData): Monde {
  const monde = construireMonde(donneesZombies(scene).data);
  monde.bornes = { ...BORNES_ZOMBIES };
  for (const p of monde.prismes) { p.h = HAUTEUR_MURS_ZOMBIES; p.hOrigine = HAUTEUR_MURS_ZOMBIES; }
  return monde;
}
