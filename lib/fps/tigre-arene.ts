/**
 * Tigres de l'arène (PUR : ni three ni DOM, `alea` et horloge injectés). Un tigre sauvage, largué par l'avion, se pose dans une
 * cachette, se défend et s'enfuit quand il faiblit. Un tigre allié, invoqué par le sort, suit son lanceur et attaque le joueur ennemi
 * le plus proche du lanceur. Ce module porte l'état d'un tigre, sa machine d'états, ses coups, son déplacement (sol, bâtiments par
 * `collision.ts`, voitures), sa silhouette de touche selon la pose et la validation serveur des tirs et coups de couteau qui le visent.
 * Le service de salle (`match-tigres.ts`) l'appelle à chaque tic et traduit ses événements en messages.
 * Repère de scene.json : x est, z sud, y haut. Cap en convention lacet : 0 = vers −z, direction (−sin cap, −cos cap).
 * Spec : docs/superpowers/specs/2026-10-23-arene-tigres-design.md (Tigre sauvage, Sort d'invocation, Réseau)
 */
import { dedans, distSegment } from "../agroparc3d/cachettes";
import { COUTEAU } from "./armes";
import { lancerRayon, resoudre, solSous, visible, type Monde, type Prisme } from "./collision";
import type { ActionTigre, EtatTigre, GenreTigre, PoseTigre, Vec3, Zone } from "./protocole";
import { LATENCE_TOLEREE_S, MARGE_PORTEE_M, TOLERANCE_RAYON_M } from "./tir";

/** Constantes du tigre sauvage (toutes ajustables, valeurs de la spec). */
export const TIGRE = {
  pvSauvage: 2500,
  /** rayon du cylindre de collision au monde (m) */
  rayon: 0.6,
  /** hauteur des yeux du tigre debout (ligne de vue) */
  oeil: 1.0,
  /** poursuite et fuite (m/s), sous le sprint des joueurs (12,5) */
  vitesseCourse: 10.5,
  /** retour à la cachette sans cible (m/s) */
  vitesseRetour: 4,
  /** un joueur vivant à moins de 20 m et en vue alerte le tigre tapi */
  rayonAlerte: 20,
  /** durée de l'alerte (il se tourne vers le joueur, rugit) avant l'attaque */
  alerteMs: 800,
  /** cible encore poursuivie jusqu'à cette distance (m), le dernier agresseur compris */
  porteePoursuite: 80,
  /** cible « la plus proche en vue » choisie à moins de cette distance (m) */
  porteeVue: 40,
  /** sans cible depuis ce délai, le tigre rentre à sa cachette */
  sansCibleMs: 6000,
  /** perception (cibles, lignes de vue) toutes les 100 ms, pas à chaque tic */
  perceptionMs: 100,
  /** le tigre s'arrête à cette distance horizontale de sa cible (m), dans la portée du coup de patte (2,5 m) */
  arretM: 2.2,
  /** écart vertical maximal pour qu'un coup porte (m) : un joueur sur un toit est hors d'atteinte */
  ecartVerticalMax: 2,
  patte: { portee: 2.5, degats: 25, cadenceMs: 1200, armeMs: 250, margeM: 0.5 },
  bond: { annonceMs: 600, porteeMin: 6, porteeMax: 10, degats: 40, cadenceMs: 7000, vitesse: 18, contactM: 1.6 },
  /** aucun coup de tigre ne dépasse ce plafond : aucun coup ne tue un joueur à 100 PV */
  coupMax: 40,
  /** fuite quand les PV passent sous cette part du maximum */
  seuilFuite: 0.3,
  /** la cachette de fuite est à plus de 60 m */
  fuiteDistanceMin: 60,
  /** arrivé (à moins de 1,5 m) dans sa cachette de fuite */
  arriveeM: 1.5,
  /** régénération en repos : 8 s sans dégât, puis 15 PV par seconde jusqu'à 50 % */
  reposDelaiMs: 8000,
  regenPvParS: 15,
  regenPlafond: 0.5,
  /** un tigre sauvage non tué repart au bout de 4 min (depuis le largage) */
  dureeSauvageMs: 240_000,
  /** voiture qui le percute : 150 dégâts, au plus un choc par seconde */
  degatsVoiture: 150,
  voitureRepetitionMs: 1000,
  /** vitesse minimale (m/s) d'une voiture pour qu'un contact soit un choc (= VEH.vitesseRenverse) */
  vitesseChocVoiture: 6,
  /** descente en parachute (ms) */
  descenteMs: 12_000,
  /** bloqué : moins de 1 m parcouru en 1 s de poursuite, il change de côté de contournement */
  blocageMs: 1000,
  blocageM: 1,
} as const;

/** Constantes du tigre allié (sort d'invocation). */
export const TIGRE_ALLIE = {
  pv: 500,
  dureeMs: 30_000,
  /** apparaît à 2 m devant le lanceur */
  distanceApparition: 2,
  suiviMin: 3,
  suiviMax: 6,
  /** cible : joueur ennemi vivant à moins de 18 m du lanceur et en vue du tigre */
  porteeCible: 18,
  vitesse: 10.5,
  /** au-delà de 12 m du lanceur il accélère pour le rattraper, au-delà de 40 m il le rejoint d'un coup (réapparition, voiture) */
  rattrapageM: 12,
  vitesseRattrapage: 13,
  teleportM: 40,
  patte: { portee: 2.5, degats: 15, cadenceMs: 1000, armeMs: 250, margeM: 0.5 },
} as const;

/** Cachette d'un tigre : position et cap (convention lacet). */
export interface CachetteTigre { x: number; z: number; cap: number }

/** Voiture vue par un tigre : boîte orientée au sol, vitesse (m/s) et conducteur à créditer (null pour un PNJ ou une voiture vide). */
export interface ObstacleVoiture {
  p: Vec3;
  cap: number;
  demiLongueur: number;
  demiLargeur: number;
  vitesse: number;
  conducteur: string | null;
}

/** Joueur vu par un tigre : seuls les vivants en arène sont passés. `protege` (apparition) et `aPied` excluent des cibles. */
export interface JoueurVu { id: string; p: Vec3; protege: boolean; aPied: boolean }

/** Ce qu'un tigre voit du monde à un tic. */
export interface EnvTigre {
  monde: Monde;
  alea: () => number;
  joueurs: readonly JoueurVu[];
  voitures: readonly ObstacleVoiture[];
  /** cachettes de fuite possibles (anneau de jeu) */
  cachettes: readonly CachetteTigre[];
}

export interface Tigre {
  id: string;
  genre: GenreTigre;
  /** lanceur d'un tigre allié, null pour un sauvage */
  lanceur: string | null;
  p: Vec3;
  cap: number;
  pv: number;
  pvMax: number;
  etat: EtatTigre;
  etatT: number;
  pose: PoseTigre;
  cible: string | null;
  /** dernier joueur qui l'a blessé */
  agresseur: string | null;
  dernierDegatT: number;
  action: ActionTigre | null;
  actionT: number;
  actionCible: string | null;
  /** destination d'un bond, et coup du bond déjà porté */
  bondDest: [number, number] | null;
  bondTouche: boolean;
  prochainePatteT: number;
  prochainBondT: number;
  cachette: CachetteTigre;
  /** fuite faite sous le seuil : pas de nouvelle fuite avant d'être repassé au-dessus */
  fuiteFaite: boolean;
  /** la cachette de fuite reste à choisir (premier tic de la fuite) */
  fuiteAChoisir: boolean;
  regenAcc: number;
  /** départ (sauvage) ou fin (allié) */
  finT: number;
  descente: { de: Vec3; t0: number; t1: number } | null;
  perceptionT: number;
  sansCibleDepuis: number;
  contournement: 1 | -1;
  blocage: { t: number; p: Vec3 };
  /** chemin autour des bâtiments (points à suivre, le dernier est la destination), null si la route directe est libre */
  chemin: [number, number][] | null;
  /** destination du chemin et instant de son calcul */
  cheminBut: [number, number] | null;
  cheminT: number;
  /** point suivi en ce moment (le plus lointain du chemin encore en vue), choisi toutes les 100 ms */
  etape: [number, number] | null;
  etapeT: number;
  voitureT: number;
}

/** Événements d'un tic, traduits en messages par le service. */
export type EvenementTigre =
  | { type: "atterri" }
  | { type: "alerte"; cible: string }
  | { type: "coup"; cible: string; degats: number; action: "patte" | "bond" }
  | { type: "fuite" }
  | { type: "voiture"; degats: number; conducteur: string | null; mort: boolean }
  | { type: "parti" };

// ---------- géométrie ----------

/** Cap pour un vecteur direction (dx, dz) : atan2(−dx, −dz). */
export const capVers = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
/** Cap d'une cachette de cachettes.json (rotation three, museau vers (sin, cos)) en convention lacet. */
export const capDeCachette = (capThree: number): number => capVers(Math.sin(capThree), Math.cos(capThree));
const horizontal = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Pousse un cercle (x, z, rayon) hors de la boîte orientée d'une voiture. Renvoie vrai s'il y avait recouvrement. */
function sortirDeVoiture(p: Vec3, rayon: number, v: ObstacleVoiture): boolean {
  if (p[1] >= 1.6) return false;
  const ux = -Math.sin(v.cap), uz = -Math.cos(v.cap);
  const dx = p[0] - v.p[0], dz = p[2] - v.p[2];
  const lon = dx * ux + dz * uz, lat = -dx * uz + dz * ux;
  const cl = Math.max(-v.demiLongueur, Math.min(v.demiLongueur, lon));
  const ct = Math.max(-v.demiLargeur, Math.min(v.demiLargeur, lat));
  const ex = lon - cl, et = lat - ct;
  const d = Math.hypot(ex, et);
  if (d >= rayon) return false;
  let nl: number, nt: number, prof: number;
  if (d > 1e-6) {
    nl = ex / d;
    nt = et / d;
    prof = rayon - d;
  } else {
    // centre dans la boîte : sortie par le côté le plus proche
    const sl = v.demiLongueur - Math.abs(lon), st = v.demiLargeur - Math.abs(lat);
    if (sl < st) { nl = lon >= 0 ? 1 : -1; nt = 0; prof = sl + rayon; }
    else { nl = 0; nt = lat >= 0 ? 1 : -1; prof = st + rayon; }
  }
  // repère voiture (avant u, droite (−uz, ux)) vers le monde
  p[0] += (nl * ux - nt * uz) * prof;
  p[2] += (nl * uz + nt * ux) * prof;
  return true;
}

/** Le cercle (x, z, rayon) recoupe-t-il la boîte d'une voiture ? */
export function recoupeVoiture(x: number, z: number, y: number, rayon: number, v: ObstacleVoiture): boolean {
  return sortirDeVoiture([x, y, z], rayon, v);
}

const ANGLES_CONTOURNEMENT = [0, 0.45, 0.9, 1.35, 1.8, 2.3];
const HAUTEUR_SONDE = 0.5;

/**
 * Un pas de déplacement vers (x, z) à `vitesse` pendant `dt` (s), en contournant bâtiments et voitures. La direction voulue est essayée
 * d'abord, puis des directions de plus en plus écartées (côté `t.contournement` d'abord) dont un rayon à 0,5 m du sol reste libre sur
 * 3 m. Le pas est ensuite corrigé par `resoudre` (glissement le long des murs) et sorti des voitures. Le tigre suit le sol (`solSous`).
 * Renvoie la distance horizontale parcourue. `arret` = distance à laquelle il s'arrête de la destination.
 */
export function pasVers(t: Tigre, monde: Monde, voitures: readonly ObstacleVoiture[], x: number, z: number, vitesse: number, dt: number, arret = 0): number {
  const dx = x - t.p[0], dz = z - t.p[2];
  const dist = Math.hypot(dx, dz);
  const pas = Math.min(vitesse * dt, Math.max(0, dist - arret));
  if (pas <= 1e-6) return 0;
  const direct = Math.atan2(dz, dx);
  const sonde = Math.min(3, dist) + TIGRE.rayon;
  const o: Vec3 = [t.p[0], t.p[1] + HAUTEUR_SONDE, t.p[2]];
  let choisi = direct;
  trouve: for (const a of ANGLES_CONTOURNEMENT) {
    for (const s of a === 0 ? [1] : [t.contournement, -t.contournement]) {
      const ang = direct + s * a;
      const ux = Math.cos(ang), uz = Math.sin(ang);
      if (lancerRayon(monde, o, [ux, 0, uz], sonde) !== Infinity) continue;
      const fx = t.p[0] + ux * Math.min(sonde, 2), fz = t.p[2] + uz * Math.min(sonde, 2);
      if (voitures.some((v) => recoupeVoiture(fx, fz, t.p[1], TIGRE.rayon, v))) continue;
      choisi = ang;
      break trouve;
    }
  }
  const ux = Math.cos(choisi), uz = Math.sin(choisi);
  const avant: Vec3 = [t.p[0], t.p[1], t.p[2]];
  const np = resoudre(monde, [t.p[0] + ux * pas, t.p[1], t.p[2] + uz * pas], TIGRE.rayon, 1).p;
  for (const v of voitures) sortirDeVoiture(np, TIGRE.rayon, v);
  np[1] = solSous(monde, np[0], np[2], np[1]);
  t.p = np;
  t.cap = capVers(ux, uz);
  return horizontal(avant, np);
}

// ---------- chemin autour des bâtiments ----------

/** Pas (m) de la grille de navigation des tigres. */
export const PAS_NAV_M = 1.5;
/** Dégagement (m) d'une case libre : le centre de la case est à cette distance au moins de tout mur (rayon du tigre + marge). */
const DEGAGEMENT_NAV_M = TIGRE.rayon + 0.2;
/** Nœuds explorés au plus par une recherche de chemin (au-delà, pas de chemin : le tigre se débrouille par balayage d'angles). */
const NOEUDS_MAX = 20_000;

/**
 * Grille de navigation d'un monde (cases de `PAS_NAV_M` m) : une case est libre si son centre est hors des bâtiments debout, à
 * `DEGAGEMENT_NAV_M` au moins de leurs murs et à plus de 1 m des bornes. Un bâtiment détruit (hauteur nulle) ne ferme rien, une brèche
 * (`creux` de collision.ts) libère les cases à `DEGAGEMENT_NAV_M` au moins de son bord. `etats` garde la hauteur et la brèche de chaque
 * prisme au dernier calcul (4 nombres par prisme). Tampons de la recherche A* réutilisés (non réentrant).
 */
export interface GrilleNav {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  libre: Uint8Array;
  g: Float64Array;
  parent: Int32Array;
  vu: Uint32Array;
  ferme: Uint32Array;
  tampon: number;
  etats: Float64Array;
}

const GRILLES = new WeakMap<Monde, GrilleNav>();

/** Plage de cases [i0, i1] × [j0, j1] du voisinage d'une boîte (emprise d'un prisme élargie du dégagement), bornée à la grille. */
function plage(g: GrilleNav, b: { x0: number; z0: number; x1: number; z1: number }): [number, number, number, number] {
  const d = DEGAGEMENT_NAV_M;
  return [
    Math.max(0, Math.floor((b.x0 - d - g.x0) / PAS_NAV_M)), Math.min(g.nx - 1, Math.floor((b.x1 + d - g.x0) / PAS_NAV_M)),
    Math.max(0, Math.floor((b.z0 - d - g.z0) / PAS_NAV_M)), Math.min(g.nz - 1, Math.floor((b.z1 + d - g.z0) / PAS_NAV_M)),
  ];
}

/** Rouvre les cases de la plage selon les seules bornes du monde (avant que les prismes voisins ne les referment). */
function ouvrirPlage(g: GrilleNav, monde: Monde, [i0, i1, j0, j1]: [number, number, number, number]): void {
  const b = monde.bornes;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = g.x0 + (i + 0.5) * PAS_NAV_M, z = g.z0 + (j + 0.5) * PAS_NAV_M;
    g.libre[i + j * g.nx] = x > b.x0 + 1 && x < b.x1 - 1 && z > b.z0 + 1 && z < b.z1 - 1 ? 1 : 0;
  }
}

/** Ferme les cases de la plage que le prisme occupe ou frôle (rien s'il est à terre, cases au fond de sa brèche épargnées). */
function fermerPar(g: GrilleNav, pr: Prisme, [i0, i1, j0, j1]: [number, number, number, number]): void {
  if (pr.h <= 0.05) return;
  const d = DEGAGEMENT_NAV_M;
  const c = pr.creux;
  const anneaux = [pr.anneau, ...pr.trous];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + j * g.nx;
    if (!g.libre[k]) continue;
    const x = g.x0 + (i + 0.5) * PAS_NAV_M, z = g.z0 + (j + 0.5) * PAS_NAV_M;
    // tout le disque de dégagement est dans la brèche : ni mur ni sol du bâtiment autour de la case
    if (c && Math.hypot(x - c.x, z - c.z) <= c.r - d) continue;
    let ferme = dedans(x, z, pr.anneau) && !pr.trous.some((t) => dedans(x, z, t));
    for (const a of anneaux) {
      if (ferme) break;
      for (let u = 0, v = a.length - 1; u < a.length; v = u++) {
        if (distSegment(x, z, a[v][0], a[v][1], a[u][0], a[u][1]) < d) { ferme = true; break; }
      }
    }
    if (ferme) g.libre[k] = 0;
  }
}

/** Note la hauteur et la brèche du prisme `k` dans `etats`. Vrai si elles ont changé depuis le dernier calcul. */
function noterEtat(g: GrilleNav, pr: Prisme, k: number): boolean {
  const e = g.etats, o = 4 * k;
  const h = pr.h, cx = pr.creux?.x ?? 0, cz = pr.creux?.z ?? 0, cr = pr.creux?.r ?? 0;
  if (e[o] === h && e[o + 1] === cx && e[o + 2] === cz && e[o + 3] === cr) return false;
  e[o] = h;
  e[o + 1] = cx;
  e[o + 2] = cz;
  e[o + 3] = cr;
  return true;
}

/**
 * Tient la grille à jour des bâtiments détruits, des brèches et des bâtiments relevés (événements de match-evenements.ts) : seules les
 * cases autour d'un prisme qui a changé sont recalculées, contre tous les prismes qui les touchent.
 */
function actualiserGrille(g: GrilleNav, monde: Monde): void {
  monde.prismes.forEach((pr, k) => {
    if (!noterEtat(g, pr, k)) return;
    const zone = plage(g, pr.boite);
    ouvrirPlage(g, monde, zone);
    const [i0, i1, j0, j1] = zone;
    for (const autre of monde.prismes) {
      const [a0, a1, b0, b1] = plage(g, autre.boite);
      if (a1 < i0 || a0 > i1 || b1 < j0 || b0 > j1) continue;
      fermerPar(g, autre, [Math.max(i0, a0), Math.min(i1, a1), Math.max(j0, b0), Math.min(j1, b1)]);
    }
  });
}

/**
 * Grille de navigation de `monde`, construite à la première demande puis gardée (une par monde), et mise à jour à chaque demande des
 * bâtiments qui ont changé depuis.
 */
export function grilleNav(monde: Monde): GrilleNav {
  const deja = GRILLES.get(monde);
  if (deja) {
    actualiserGrille(deja, monde);
    return deja;
  }
  const b = monde.bornes;
  const nx = Math.max(1, Math.ceil((b.x1 - b.x0) / PAS_NAV_M)), nz = Math.max(1, Math.ceil((b.z1 - b.z0) / PAS_NAV_M));
  const n = nx * nz;
  const g: GrilleNav = {
    x0: b.x0, z0: b.z0, nx, nz, libre: new Uint8Array(n), g: new Float64Array(n), parent: new Int32Array(n), vu: new Uint32Array(n),
    ferme: new Uint32Array(n), tampon: 0, etats: new Float64Array(4 * monde.prismes.length),
  };
  ouvrirPlage(g, monde, [0, nx - 1, 0, nz - 1]);
  // chaque bâtiment ferme les cases de son emprise et de son voisinage immédiat
  monde.prismes.forEach((pr, k) => {
    noterEtat(g, pr, k);
    fermerPar(g, pr, plage(g, pr.boite));
  });
  GRILLES.set(monde, g);
  return g;
}

/** Case libre la plus proche de (x, z), à 4 cases au plus. -1 sinon. */
function caseLibre(g: GrilleNav, x: number, z: number): number {
  const ci = Math.floor((x - g.x0) / PAS_NAV_M), cj = Math.floor((z - g.z0) / PAS_NAV_M);
  let meilleure = -1, dMin = Infinity;
  for (let r = 0; r <= 4 && meilleure < 0; r++) {
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
      const k = i + j * g.nx;
      if (!g.libre[k]) continue;
      const d = (i - ci) ** 2 + (j - cj) ** 2;
      if (d < dMin) { dMin = d; meilleure = k; }
    }
  }
  return meilleure;
}

const VOISINS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Chemin de (x0, z0) à (x1, z1) sur la grille de navigation (A*, 8 voisins, pas de coin coupé en diagonale, heuristique octile).
 * Renvoie les centres des cases traversées (le dernier point est la destination elle-même), ou null si la destination est
 * injoignable dans la limite de `NOEUDS_MAX` nœuds.
 */
export function chercherChemin(g: GrilleNav, x0: number, z0: number, x1: number, z1: number): [number, number][] | null {
  const s = caseLibre(g, x0, z0), b = caseLibre(g, x1, z1);
  if (s < 0 || b < 0) return null;
  if (s === b) return [[x1, z1]];
  const tampon = ++g.tampon;
  const bi = b % g.nx, bj = Math.floor(b / g.nx);
  const h = (k: number): number => {
    const di = Math.abs((k % g.nx) - bi), dj = Math.abs(Math.floor(k / g.nx) - bj);
    return Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj);
  };
  // tas binaire de (f, case)
  const tasF: number[] = [], tasK: number[] = [];
  const pousser = (f: number, k: number) => {
    let i = tasF.length;
    tasF.push(f);
    tasK.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (tasF[p] <= f) break;
      tasF[i] = tasF[p]; tasK[i] = tasK[p];
      i = p;
    }
    tasF[i] = f; tasK[i] = k;
  };
  const extraire = (): number => {
    const k = tasK[0];
    const fDernier = tasF.pop()!, kDernier = tasK.pop()!;
    if (tasF.length) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, c = a + 1;
        let m = i, fm = fDernier;
        if (a < tasF.length && tasF[a] < fm) { m = a; fm = tasF[a]; }
        if (c < tasF.length && tasF[c] < fm) { m = c; fm = tasF[c]; }
        if (m === i) break;
        tasF[i] = tasF[m]; tasK[i] = tasK[m];
        i = m;
      }
      tasF[i] = fDernier; tasK[i] = kDernier;
    }
    return k;
  };
  g.vu[s] = tampon;
  g.g[s] = 0;
  g.parent[s] = -1;
  pousser(h(s), s);
  let explores = 0, trouve = false;
  while (tasF.length) {
    const k = extraire();
    if (g.ferme[k] === tampon) continue;
    g.ferme[k] = tampon;
    if (k === b) { trouve = true; break; }
    if (++explores > NOEUDS_MAX) break;
    const i = k % g.nx, j = Math.floor(k / g.nx);
    for (const [di, dj, cout] of VOISINS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
      const nk = ni + nj * g.nx;
      if (!g.libre[nk] || g.ferme[nk] === tampon) continue;
      if (di !== 0 && dj !== 0 && (!g.libre[i + di + j * g.nx] || !g.libre[i + (j + dj) * g.nx])) continue;
      const ng = g.g[k] + cout;
      if (g.vu[nk] === tampon && ng >= g.g[nk]) continue;
      g.vu[nk] = tampon;
      g.g[nk] = ng;
      g.parent[nk] = k;
      pousser(ng + h(nk), nk);
    }
  }
  if (!trouve) return null;
  const r: [number, number][] = [[x1, z1]];
  for (let k = g.parent[b]; k >= 0 && k !== s; k = g.parent[k]) {
    r.push([g.x0 + ((k % g.nx) + 0.5) * PAS_NAV_M, g.z0 + (Math.floor(k / g.nx) + 0.5) * PAS_NAV_M]);
  }
  return r.reverse();
}

/** La route de `de` à (x, z) est-elle libre pour le tigre ? Trois rayons parallèles à 0,5 m du sol (axe et flancs). */
export function routeLibre(monde: Monde, de: Vec3, x: number, z: number): boolean {
  const dx = x - de[0], dz = z - de[2];
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-3) return true;
  const ux = dx / dist, uz = dz / dist;
  const r = TIGRE.rayon * 0.9;
  for (const s of [0, -1, 1]) {
    const o: Vec3 = [de[0] - uz * s * r, de[1] + HAUTEUR_SONDE, de[2] + ux * s * r];
    if (lancerRayon(monde, o, [ux, 0, uz], dist) !== Infinity) return false;
  }
  return true;
}

// ---------- création ----------

function nouveau(id: string, genre: GenreTigre, lanceur: string | null, p: Vec3, cap: number, pv: number, cachette: CachetteTigre, maintenant: number): Tigre {
  return {
    id, genre, lanceur, p, cap, pv, pvMax: pv, etat: "tapi", etatT: maintenant, pose: "couche", cible: null, agresseur: null,
    dernierDegatT: -Infinity, action: null, actionT: 0, actionCible: null, bondDest: null, bondTouche: false,
    prochainePatteT: maintenant, prochainBondT: maintenant, cachette, fuiteFaite: false, fuiteAChoisir: false, regenAcc: 0,
    finT: Infinity, descente: null, perceptionT: -Infinity, sansCibleDepuis: maintenant, contournement: 1,
    blocage: { t: maintenant, p: [p[0], p[1], p[2]] }, chemin: null, cheminBut: null, cheminT: -Infinity, etape: null, etapeT: -Infinity,
    voitureT: -Infinity,
  };
}

/**
 * Tigre sauvage largué à `de` (point de la trajectoire de l'avion, à son altitude). Il descend en parachute vers `cachette` en
 * `TIGRE.descenteMs`, puis s'y tapit. Il repart `TIGRE.dureeSauvageMs` après le largage s'il n'a pas été tué.
 */
export function creerTigreSauvage(id: string, de: Vec3, cachette: CachetteTigre, maintenant: number): Tigre {
  const t = nouveau(id, "sauvage", null, [de[0], de[1], de[2]], cachette.cap, TIGRE.pvSauvage, cachette, maintenant);
  t.etat = "descente";
  t.pose = "debout";
  t.descente = { de: [de[0], de[1], de[2]], t0: maintenant, t1: maintenant + TIGRE.descenteMs };
  t.finT = maintenant + TIGRE.dureeSauvageMs;
  return t;
}

/** Tigre allié de `lanceur`, posé à 2 m devant lui (corrigé hors des bâtiments), pour `TIGRE_ALLIE.dureeMs`. */
export function creerTigreAllie(id: string, lanceur: { id: string; p: Vec3; lacet: number }, monde: Monde, maintenant: number): Tigre {
  const fx = -Math.sin(lanceur.lacet), fz = -Math.cos(lanceur.lacet);
  const d = TIGRE_ALLIE.distanceApparition;
  const r = resoudre(monde, [lanceur.p[0] + fx * d, lanceur.p[1], lanceur.p[2] + fz * d], TIGRE.rayon, 1);
  const p: Vec3 = [r.p[0], solSous(monde, r.p[0], r.p[2], lanceur.p[1]), r.p[2]];
  const t = nouveau(id, "allie", lanceur.id, p, lanceur.lacet, TIGRE_ALLIE.pv, { x: p[0], z: p[2], cap: lanceur.lacet }, maintenant);
  t.etat = "suivi";
  t.pose = "debout";
  t.finT = maintenant + TIGRE_ALLIE.dureeMs;
  return t;
}

// ---------- dégâts ----------

function changerEtat(t: Tigre, etat: EtatTigre, maintenant: number): void {
  t.etat = etat;
  t.etatT = maintenant;
  t.action = null;
  t.actionCible = null;
  t.bondDest = null;
}

/**
 * Dégâts reçus (tir, couteau, voiture). Renvoie les PV réellement perdus et si ce coup tue. Un tigre tapi, en retour ou au repos passe
 * en alerte vers l'agresseur. Un tigre sauvage qui passe sous 30 % de ses PV s'enfuit (une fois, tant qu'il n'est pas remonté au-dessus).
 * Un tigre en descente garde sa descente et retient son agresseur pour l'atterrissage.
 */
export function blesserTigre(t: Tigre, degats: number, par: string | null, maintenant: number): { subi: number; mort: boolean } {
  if (!(degats > 0) || t.pv <= 0) return { subi: 0, mort: false };
  const avant = t.pv;
  t.pv = Math.max(0, t.pv - Math.round(degats));
  t.dernierDegatT = maintenant;
  t.regenAcc = 0;
  if (par) t.agresseur = par;
  const subi = avant - t.pv;
  if (t.pv <= 0) return { subi, mort: true };
  if (t.genre !== "sauvage" || t.etat === "descente") return { subi, mort: false };
  if (!t.fuiteFaite && avant >= TIGRE.seuilFuite * t.pvMax && t.pv < TIGRE.seuilFuite * t.pvMax) {
    t.fuiteFaite = true;
    changerEtat(t, "fuite", maintenant);
    t.fuiteAChoisir = true;
    t.cible = null;
    t.pose = "course";
    t.blocage = { t: maintenant, p: [t.p[0], t.p[1], t.p[2]] };
    return { subi, mort: false };
  }
  if ((t.etat === "tapi" || t.etat === "retour" || t.etat === "repos") && par) {
    changerEtat(t, "alerte", maintenant);
    t.cible = par;
    t.pose = "debout";
  }
  return { subi, mort: false };
}

// ---------- perception et cibles ----------

const oeilTigre = (t: Tigre): Vec3 => [t.p[0], t.p[1] + TIGRE.oeil, t.p[2]];
const oeilJoueur = (j: JoueurVu): Vec3 => [j.p[0], j.p[1] + 1.5, j.p[2]];
const ciblable = (j: JoueurVu | undefined): j is JoueurVu => !!j && j.aPied && !j.protege;

/** Joueur le plus proche du tigre, à pied, non protégé, à moins de `portee` et en vue. Null sinon. */
export function plusProcheEnVue(t: Tigre, env: EnvTigre, portee: number): JoueurVu | null {
  let meilleur: JoueurVu | null = null;
  let dMin = portee;
  const oeil = oeilTigre(t);
  for (const j of env.joueurs) {
    if (!ciblable(j)) continue;
    const d = horizontal(t.p, j.p);
    if (d > dMin) continue;
    if (!visible(env.monde, oeil, oeilJoueur(j))) continue;
    meilleur = j;
    dMin = d;
  }
  return meilleur;
}

/**
 * Cible du tigre allié : le joueur ennemi (ni le lanceur, ni protégé, à pied) le plus proche DU LANCEUR, à moins de 18 m de lui et en
 * vue du tigre. Une cible qui meurt, sort de portée ou de la vue est remplacée au calcul suivant (toutes les 100 ms).
 */
export function cibleAllie(t: Tigre, lanceur: JoueurVu, env: EnvTigre): JoueurVu | null {
  let meilleur: JoueurVu | null = null;
  let dMin: number = TIGRE_ALLIE.porteeCible;
  const oeil = oeilTigre(t);
  for (const j of env.joueurs) {
    if (j.id === lanceur.id || !ciblable(j)) continue;
    const d = horizontal(lanceur.p, j.p);
    if (d > dMin) continue;
    if (!visible(env.monde, oeil, oeilJoueur(j))) continue;
    meilleur = j;
    dMin = d;
  }
  return meilleur;
}

/** Cachette de fuite : parmi celles à plus de 60 m du tigre, une des 5 plus proches (tirage `alea`), sinon la plus lointaine. */
export function choisirCachetteFuite(t: Tigre, cachettes: readonly CachetteTigre[], alea: () => number): CachetteTigre {
  const loin = cachettes
    .map((c) => ({ c, d: Math.hypot(c.x - t.p[0], c.z - t.p[2]) }))
    .filter((x) => x.d > TIGRE.fuiteDistanceMin)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  if (loin.length) return loin[Math.min(loin.length - 1, Math.floor(alea() * loin.length))].c;
  let pire: CachetteTigre = t.cachette;
  let dMax = -1;
  for (const c of cachettes) {
    const d = Math.hypot(c.x - t.p[0], c.z - t.p[2]);
    if (d > dMax) { dMax = d; pire = c; }
  }
  return pire;
}

// ---------- coups ----------

const aPortee = (t: Tigre, j: JoueurVu, portee: number): boolean =>
  horizontal(t.p, j.p) <= portee && Math.abs(j.p[1] - t.p[1]) <= TIGRE.ecartVerticalMax;

/**
 * Coups du tigre sur sa cible `c` : coup de patte (armé `armeMs`, il porte si la cible est encore à portée + marge) et, pour le
 * sauvage, bond annoncé (`annonceMs`) vers une cible à 6 à 10 m et en vue. Ajoute l'événement de coup éventuel à `ev`. Renvoie vrai
 * si une action (bond annoncé ou en cours) occupe le tigre, qui ne poursuit pas pendant ce tic.
 */
function combattre(t: Tigre, c: JoueurVu, maintenant: number, dt: number, env: EnvTigre, ev: EvenementTigre[]): boolean {
  const patte = t.genre === "sauvage" ? TIGRE.patte : TIGRE_ALLIE.patte;
  if (t.action === "patte") {
    if (maintenant - t.actionT < patte.armeMs) return false;
    const cible = env.joueurs.find((j) => j.id === t.actionCible);
    if (ciblable(cible) && aPortee(t, cible, patte.portee + patte.margeM)) {
      ev.push({ type: "coup", cible: cible.id, degats: Math.min(TIGRE.coupMax, patte.degats), action: "patte" });
    }
    t.action = null;
    t.actionCible = null;
    return false;
  }
  if (t.action === "ramasse") {
    // il se ramasse face à sa cible, immobile, puis bondit vers la position qu'elle occupe à la fin de l'annonce
    t.cap = capVers(c.p[0] - t.p[0], c.p[2] - t.p[2]);
    if (maintenant - t.actionT < TIGRE.bond.annonceMs) return true;
    t.action = "bond";
    t.actionT = maintenant;
    const l = Math.hypot(c.p[0] - t.p[0], c.p[2] - t.p[2]) || 1;
    const portee = Math.min(TIGRE.bond.porteeMax, l);
    t.bondDest = [t.p[0] + ((c.p[0] - t.p[0]) / l) * portee, t.p[2] + ((c.p[2] - t.p[2]) / l) * portee];
    t.bondTouche = false;
    return true;
  }
  if (t.action === "bond" && t.bondDest) {
    const dest = t.bondDest;
    const parcouru = pasVers(t, env.monde, env.voitures, dest[0], dest[1], TIGRE.bond.vitesse, dt);
    const cible = env.joueurs.find((j) => j.id === t.actionCible);
    if (!t.bondTouche && ciblable(cible) && aPortee(t, cible, TIGRE.bond.contactM)) {
      t.bondTouche = true;
      ev.push({ type: "coup", cible: cible.id, degats: Math.min(TIGRE.coupMax, TIGRE.bond.degats), action: "bond" });
    }
    const fini = Math.hypot(dest[0] - t.p[0], dest[1] - t.p[2]) < 0.2 || parcouru < 1e-3 || maintenant - t.actionT > 1500;
    if (fini) {
      t.action = null;
      t.actionCible = null;
      t.bondDest = null;
    }
    return true;
  }
  // aucune action en cours : patte si la cible est à portée, sinon bond si elle est à 6 à 10 m et en vue
  const d = horizontal(t.p, c.p);
  const memeNiveau = Math.abs(c.p[1] - t.p[1]) <= TIGRE.ecartVerticalMax;
  if (d <= patte.portee && memeNiveau) {
    if (maintenant >= t.prochainePatteT) {
      t.action = "patte";
      t.actionT = maintenant;
      t.actionCible = c.id;
      t.prochainePatteT = maintenant + patte.cadenceMs;
      t.cap = capVers(c.p[0] - t.p[0], c.p[2] - t.p[2]);
    }
    return false;
  }
  if (t.genre === "sauvage" && maintenant >= t.prochainBondT && d >= TIGRE.bond.porteeMin && d <= TIGRE.bond.porteeMax && memeNiveau
    && visible(env.monde, oeilTigre(t), oeilJoueur(c))) {
    t.action = "ramasse";
    t.actionT = maintenant;
    t.actionCible = c.id;
    t.prochainBondT = maintenant + TIGRE.bond.cadenceMs;
    return true;
  }
  return false;
}

/** Un chemin est recalculé au plus toutes les 250 ms, et dès que sa destination a bougé de plus de 2 m (ou au bout de 1,5 s). */
const CHEMIN_MIN_MS = 250;
const CHEMIN_MAX_MS = 1500;
const CHEMIN_ECART_M = 2;
/** Points du chemin examinés à chaque choix d'étape (le plus lointain en vue est suivi). */
const ETAPES_REGARDEES = 8;

/**
 * Point à suivre vers (x, z) : la destination elle-même si la route est libre, sinon le point le plus lointain encore en vue d'un chemin
 * A* autour des bâtiments (`chercherChemin`). Null si aucun chemin n'existe (le pas se fait alors droit au but, avec balayage d'angles).
 */
function choisirEtape(t: Tigre, monde: Monde, x: number, z: number, maintenant: number): [number, number] | null {
  if (routeLibre(monde, t.p, x, z)) {
    t.chemin = null;
    return [x, z];
  }
  const perime = !t.chemin || !t.cheminBut || Math.hypot(t.cheminBut[0] - x, t.cheminBut[1] - z) > CHEMIN_ECART_M
    || maintenant - t.cheminT > CHEMIN_MAX_MS;
  if (perime && maintenant - t.cheminT >= CHEMIN_MIN_MS) {
    t.chemin = chercherChemin(grilleNav(monde), t.p[0], t.p[2], x, z);
    t.cheminBut = [x, z];
    t.cheminT = maintenant;
  }
  const ch = t.chemin;
  if (!ch || !ch.length) return null;
  for (let k = Math.min(ETAPES_REGARDEES, ch.length) - 1; k >= 0; k--) {
    if (k === 0 || routeLibre(monde, t.p, ch[k][0], ch[k][1])) {
      ch.splice(0, k);
      return ch[0];
    }
  }
  return ch[0];
}

/**
 * Poursuite : un pas vers (x, z), arrêt à `arret`. Un bâtiment sur la route est contourné par un chemin A* sur la grille de navigation,
 * suivi de point en vue en point en vue (choisi toutes les 100 ms). Si le tigre piétine, il change de côté de balayage d'angles.
 */
function poursuivre(t: Tigre, x: number, z: number, vitesse: number, dt: number, env: EnvTigre, maintenant: number, arret: number): void {
  const proche = t.etape && Math.hypot(t.etape[0] - t.p[0], t.etape[1] - t.p[2]) < 0.75;
  if (maintenant - t.etapeT >= TIGRE.perceptionMs || proche || !t.etape) {
    t.etapeT = maintenant;
    if (proche && t.chemin && t.chemin.length > 1) t.chemin.shift();
    t.etape = choisirEtape(t, env.monde, x, z, maintenant);
  }
  const direct = !t.etape || t.chemin === null || (t.etape[0] === x && t.etape[1] === z);
  const parcouru = direct
    ? pasVers(t, env.monde, env.voitures, x, z, vitesse, dt, arret)
    : pasVers(t, env.monde, env.voitures, t.etape![0], t.etape![1], vitesse, dt);
  t.pose = parcouru > 1e-3 ? "course" : "debout";
  if (maintenant - t.blocage.t >= TIGRE.blocageMs) {
    const loin = Math.hypot(x - t.p[0], z - t.p[2]) > arret + 0.5;
    if (loin && horizontal(t.blocage.p, t.p) < TIGRE.blocageM) {
      t.contournement = t.contournement === 1 ? -1 : 1;
      t.cheminT = -Infinity; // chemin recalculé tout de suite
    }
    t.blocage = { t: maintenant, p: [t.p[0], t.p[1], t.p[2]] };
  }
}

// ---------- voitures ----------

/** Chocs de voitures : une voiture à 6 m/s ou plus qui recoupe le tigre lui inflige 150 dégâts (au plus un choc par seconde). */
function chocsVoitures(t: Tigre, env: EnvTigre, maintenant: number, ev: EvenementTigre[]): boolean {
  if (t.etat === "descente" || maintenant - t.voitureT < TIGRE.voitureRepetitionMs) return false;
  for (const v of env.voitures) {
    if (v.vitesse < TIGRE.vitesseChocVoiture) continue;
    if (!recoupeVoiture(t.p[0], t.p[2], t.p[1], TIGRE.rayon, v)) continue;
    t.voitureT = maintenant;
    const r = blesserTigre(t, TIGRE.degatsVoiture, v.conducteur, maintenant);
    ev.push({ type: "voiture", degats: r.subi, conducteur: v.conducteur, mort: r.mort });
    return r.mort;
  }
  return false;
}

// ---------- tic ----------

/** Fin de la descente : alerte vers l'agresseur s'il en a un (tir pendant la descente), sinon tapi dans sa cachette. */
function atterrir(t: Tigre, maintenant: number, env: EnvTigre, ev: EvenementTigre[]): void {
  t.descente = null;
  t.cap = t.cachette.cap;
  ev.push({ type: "atterri" });
  const agresseur = t.agresseur ? env.joueurs.find((j) => j.id === t.agresseur) : undefined;
  if (ciblable(agresseur)) {
    changerEtat(t, "alerte", maintenant);
    t.cible = agresseur.id;
    t.pose = "debout";
    ev.push({ type: "alerte", cible: agresseur.id });
  } else {
    changerEtat(t, "tapi", maintenant);
    t.pose = "couche";
  }
}

/**
 * Avance un tigre sauvage de `dt` secondes. Événements : `atterri`, `alerte`, `coup` (40 dégâts au plus), `fuite`, `voiture`, `parti`.
 * Un tigre mort (pv 0) ne fait plus rien.
 */
export function avancerTigreSauvage(t: Tigre, maintenant: number, dt: number, env: EnvTigre): EvenementTigre[] {
  const ev: EvenementTigre[] = [];
  if (t.pv <= 0) return ev;
  if (maintenant >= t.finT) {
    ev.push({ type: "parti" });
    return ev;
  }
  if (t.etat === "descente" && t.descente) {
    const { de, t0, t1 } = t.descente;
    const k = Math.min(1, Math.max(0, (maintenant - t0) / (t1 - t0)));
    const sol = solSous(env.monde, t.cachette.x, t.cachette.z, 0);
    t.p = [de[0] + (t.cachette.x - de[0]) * k, de[1] + (sol - de[1]) * k, de[2] + (t.cachette.z - de[2]) * k];
    if (k >= 1) atterrir(t, maintenant, env, ev);
    return ev;
  }
  if (chocsVoitures(t, env, maintenant, ev)) return ev;
  const percevoir = maintenant - t.perceptionT >= TIGRE.perceptionMs;
  if (percevoir) t.perceptionT = maintenant;

  switch (t.etat) {
    case "tapi":
    case "retour": {
      if (t.etat === "retour") {
        poursuivre(t, t.cachette.x, t.cachette.z, TIGRE.vitesseRetour, dt, env, maintenant, 0);
        t.pose = "course";
        if (Math.hypot(t.cachette.x - t.p[0], t.cachette.z - t.p[2]) < TIGRE.arriveeM) {
          changerEtat(t, "tapi", maintenant);
          t.pose = "couche";
          t.cap = t.cachette.cap;
        }
      }
      if (!percevoir) break;
      const j = plusProcheEnVue(t, env, TIGRE.rayonAlerte);
      if (j) {
        changerEtat(t, "alerte", maintenant);
        t.cible = j.id;
        t.pose = "debout";
        ev.push({ type: "alerte", cible: j.id });
      }
      break;
    }
    case "alerte": {
      const c = env.joueurs.find((j) => j.id === t.cible);
      if (c) t.cap = capVers(c.p[0] - t.p[0], c.p[2] - t.p[2]);
      if (maintenant - t.etatT >= TIGRE.alerteMs) {
        changerEtat(t, "attaque", maintenant);
        t.sansCibleDepuis = maintenant;
      }
      break;
    }
    case "attaque": {
      if (percevoir) {
        // le dernier agresseur d'abord, puis la cible courante, sinon le plus proche en vue
        const suivi = [t.agresseur, t.cible]
          .map((id) => env.joueurs.find((j) => j.id === id))
          .find((j): j is JoueurVu => ciblable(j) && horizontal(t.p, j.p) <= TIGRE.porteePoursuite);
        const choix = suivi ?? plusProcheEnVue(t, env, TIGRE.porteeVue);
        if ((choix?.id ?? null) !== t.cible && t.action !== "bond") {
          t.action = null;
          t.actionCible = null;
        }
        t.cible = choix?.id ?? null;
        if (choix) t.sansCibleDepuis = maintenant;
      }
      const c = t.cible ? env.joueurs.find((j) => j.id === t.cible) : undefined;
      if (!ciblable(c)) {
        if (t.action === "bond") combattre(t, { id: "", p: t.p, protege: true, aPied: false }, maintenant, dt, env, ev);
        t.pose = "debout";
        if (maintenant - t.sansCibleDepuis >= TIGRE.sansCibleMs) {
          changerEtat(t, "retour", maintenant);
          t.cible = null;
          t.agresseur = null;
        }
        break;
      }
      if (combattre(t, c, maintenant, dt, env, ev)) {
        t.pose = t.action === "bond" ? "course" : "debout";
        break;
      }
      poursuivre(t, c.p[0], c.p[2], TIGRE.vitesseCourse, dt, env, maintenant, TIGRE.arretM);
      if (horizontal(t.p, c.p) <= TIGRE.arretM + 0.05) t.cap = capVers(c.p[0] - t.p[0], c.p[2] - t.p[2]);
      break;
    }
    case "fuite": {
      if (t.fuiteAChoisir) {
        t.fuiteAChoisir = false;
        t.cachette = choisirCachetteFuite(t, env.cachettes, env.alea);
        ev.push({ type: "fuite" });
      }
      poursuivre(t, t.cachette.x, t.cachette.z, TIGRE.vitesseCourse, dt, env, maintenant, 0);
      t.pose = "course";
      if (Math.hypot(t.cachette.x - t.p[0], t.cachette.z - t.p[2]) < TIGRE.arriveeM) {
        changerEtat(t, "repos", maintenant);
        t.pose = "couche";
        t.cap = t.cachette.cap;
        t.cible = null;
      }
      break;
    }
    case "repos": {
      if (maintenant - t.dernierDegatT < TIGRE.reposDelaiMs) break;
      const plafond = Math.round(TIGRE.regenPlafond * t.pvMax);
      if (t.pv < plafond) {
        t.regenAcc += TIGRE.regenPvParS * Math.min(Math.max(0, dt), 0.25);
        const n = Math.floor(t.regenAcc + 1e-9);
        if (n >= 1) {
          t.regenAcc -= n;
          t.pv = Math.min(plafond, t.pv + n);
        }
      }
      if (t.pv >= plafond) {
        changerEtat(t, "tapi", maintenant);
        t.regenAcc = 0;
        t.agresseur = null;
        if (t.pv >= TIGRE.seuilFuite * t.pvMax) t.fuiteFaite = false;
      }
      break;
    }
    default:
      break;
  }
  return ev;
}

/**
 * Avance un tigre allié de `dt` secondes. `lanceur` = son lanceur s'il est vivant en arène, null sinon (le tigre part). Il suit le
 * lanceur à 3 à 6 m et attaque sa cible (`cibleAllie`) d'un coup de patte de 15 toutes les 1,0 s, sans bond. Événements : `coup`,
 * `voiture`, `parti`.
 */
export function avancerTigreAllie(t: Tigre, lanceur: JoueurVu | null, maintenant: number, dt: number, env: EnvTigre): EvenementTigre[] {
  const ev: EvenementTigre[] = [];
  if (t.pv <= 0) return ev;
  if (maintenant >= t.finT || !lanceur) {
    ev.push({ type: "parti" });
    return ev;
  }
  if (chocsVoitures(t, env, maintenant, ev)) return ev;
  if (horizontal(t.p, lanceur.p) > TIGRE_ALLIE.teleportM) {
    // lanceur très loin (voiture, saut de toit) : le tigre le rejoint d'un coup
    const r = resoudre(env.monde, [lanceur.p[0], lanceur.p[1], lanceur.p[2]], TIGRE.rayon, 1);
    t.p = [r.p[0], solSous(env.monde, r.p[0], r.p[2], lanceur.p[1]), r.p[2]];
    changerEtat(t, "suivi", maintenant);
    t.cible = null;
  }
  if (maintenant - t.perceptionT >= TIGRE.perceptionMs) {
    t.perceptionT = maintenant;
    const choix = cibleAllie(t, lanceur, env);
    if ((choix?.id ?? null) !== t.cible) {
      t.action = null;
      t.actionCible = null;
    }
    t.cible = choix?.id ?? null;
    if (t.cible && t.etat !== "attaque") changerEtat(t, "attaque", maintenant);
    else if (!t.cible && t.etat !== "suivi") changerEtat(t, "suivi", maintenant);
  }
  const c = t.cible ? env.joueurs.find((j) => j.id === t.cible) : undefined;
  if (t.etat === "attaque" && ciblable(c)) {
    if (!combattre(t, c, maintenant, dt, env, ev)) {
      poursuivre(t, c.p[0], c.p[2], TIGRE_ALLIE.vitesse, dt, env, maintenant, TIGRE.arretM);
      if (horizontal(t.p, c.p) <= TIGRE.arretM + 0.05) t.cap = capVers(c.p[0] - t.p[0], c.p[2] - t.p[2]);
    }
    return ev;
  }
  // suivi : rester à 3 à 6 m du lanceur, plus vite quand il est loin
  const d = horizontal(t.p, lanceur.p);
  if (d > TIGRE_ALLIE.suiviMax) {
    const vitesse = d > TIGRE_ALLIE.rattrapageM ? TIGRE_ALLIE.vitesseRattrapage : TIGRE_ALLIE.vitesse;
    poursuivre(t, lanceur.p[0], lanceur.p[2], vitesse, dt, env, maintenant, (TIGRE_ALLIE.suiviMin + TIGRE_ALLIE.suiviMax) / 2);
  } else {
    t.pose = "debout";
  }
  return ev;
}

// ---------- silhouette de touche ----------

/**
 * Silhouette de touche d'une pose : corps = capsule HORIZONTALE le long du cap (centrée sur `p`, demi-longueur, hauteur `y`, rayon),
 * tête = sphère `avance` m devant `p`, à hauteur `y`. Calée sur le GLB du thème Tigre tel que l'arène le dessine (échelle du thème,
 * 3,75 m queue comprise, lib/fps/rendu-tigres.ts), mesuré au client dans chaque pose : 2,5 m du museau à la croupe, croupe à 1,15 m et
 * tête vers 1,7 m debout (le modèle stylisé a de longues pattes et une grosse tête), croupe à 0,9 m et tête vers 1,15 m tapi.
 */
export interface SilhouetteTigre {
  readonly corps: { readonly y: number; readonly demiLongueur: number; readonly rayon: number };
  readonly tete: { readonly avance: number; readonly y: number; readonly rayon: number };
}
export const SILHOUETTES_TIGRE: Readonly<Record<PoseTigre, SilhouetteTigre>> = {
  couche: { corps: { y: 0.8, demiLongueur: 0.8, rayon: 0.45 }, tete: { avance: 1.3, y: 1.15, rayon: 0.38 } },
  debout: { corps: { y: 1.15, demiLongueur: 0.8, rayon: 0.5 }, tete: { avance: 1.25, y: 1.7, rayon: 0.4 } },
  course: { corps: { y: 1.1, demiLongueur: 0.9, rayon: 0.48 }, tete: { avance: 1.3, y: 1.6, rayon: 0.38 } },
};

/** Position d'un tigre à valider : un point de son historique (position, cap, pose). */
export interface PositionTigre { p: Vec3; cap: number; pose: PoseTigre }

/** Silhouette dans le monde : corps de `a` (croupe) à `b` (épaules), tête de centre `c`. */
export function hitboxTigre(pos: PositionTigre): { a: Vec3; b: Vec3; rCorps: number; c: Vec3; rTete: number } {
  const s = SILHOUETTES_TIGRE[pos.pose];
  const fx = -Math.sin(pos.cap), fz = -Math.cos(pos.cap);
  const [x, y, z] = pos.p;
  const l = s.corps.demiLongueur;
  return {
    a: [x - fx * l, y + s.corps.y, z - fz * l], b: [x + fx * l, y + s.corps.y, z + fz * l], rCorps: s.corps.rayon,
    c: [x + fx * s.tete.avance, y + s.tete.y, z + fz * s.tete.avance], rTete: s.tete.rayon,
  };
}

const moins = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scal = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Entrée t (0 ou plus) du rayon (o, d normalisé) dans la sphère (c, r), 0 si o est dedans, Infinity sinon. */
function rayonSphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const m = moins(o, c);
  const b = scal(m, d);
  const cc = scal(m, m) - r * r;
  if (cc <= 0) return 0;
  if (b > 0) return Infinity;
  const disc = b * b - cc;
  return disc < 0 ? Infinity : -b - Math.sqrt(disc);
}

/** Point du segment [a, b] le plus proche de `q`. */
function procheSegment(q: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ba = moins(b, a);
  const baba = scal(ba, ba);
  const u = baba > 0 ? Math.max(0, Math.min(1, scal(moins(q, a), ba) / baba)) : 0;
  return [a[0] + ba[0] * u, a[1] + ba[1] * u, a[2] + ba[2] * u];
}

/** Entrée t du rayon dans la capsule [a, b] de rayon r (cylindre puis calottes), 0 si o est dedans, Infinity sinon. */
function rayonCapsule(o: Vec3, d: Vec3, a: Vec3, b: Vec3, r: number): number {
  const q = procheSegment(o, a, b);
  if (scal(moins(o, q), moins(o, q)) <= r * r) return 0;
  let meilleur = Math.min(rayonSphere(o, d, a, r), rayonSphere(o, d, b, r));
  const ba = moins(b, a), oa = moins(o, a);
  const baba = scal(ba, ba), bard = scal(ba, d), baoa = scal(ba, oa);
  const ka = baba - bard * bard;
  if (ka > 1e-12) {
    const kb = baba * scal(d, oa) - baoa * bard;
    const kc = baba * scal(oa, oa) - baoa * baoa - r * r * baba;
    const h = kb * kb - ka * kc;
    if (h >= 0) {
      const t = (-kb - Math.sqrt(h)) / ka;
      const y = baoa + t * bard;
      if (t >= 0 && y > 0 && y < baba && t < meilleur) meilleur = t;
    }
  }
  return meilleur;
}

/**
 * Client : touche du rayon (o, d normalisé) sur un tigre jusqu'à `limite` (m), la tête primant dès que sa sphère est touchée. Null
 * sinon. Le client compare `distance` à celles des joueurs et des murs (`tracer` de tir.ts) pour choisir l'objet touché.
 */
export function tracerTigre(o: Vec3, d: Vec3, pos: PositionTigre, limite: number): { distance: number; zone: Zone } | null {
  const h = hitboxTigre(pos);
  const tTete = rayonSphere(o, d, h.c, h.rTete);
  if (tTete <= limite) return { distance: tTete, zone: "tete" };
  const tCorps = rayonCapsule(o, d, h.a, h.b, h.rCorps);
  if (tCorps <= limite) return { distance: tCorps, zone: "corps" };
  return null;
}

/** Points de l'axe (croupe, milieu, épaules, tête) avec leur rayon : écart au rayon de tir et lignes de vue. */
function pointsAxe(pos: PositionTigre): { pt: Vec3; r: number }[] {
  const h = hitboxTigre(pos);
  const m: Vec3 = [(h.a[0] + h.b[0]) / 2, (h.a[1] + h.b[1]) / 2, (h.a[2] + h.b[2]) / 2];
  return [{ pt: h.a, r: h.rCorps }, { pt: m, r: h.rCorps }, { pt: h.b, r: h.rCorps }, { pt: h.c, r: h.rTete }];
}

/** Point ramené vers l'œil `o` de `r` (surface côté tireur), comme `pointsVisibilite` de tir.ts. */
function versOeil(o: Vec3, pt: Vec3, r: number): Vec3 {
  const v = moins(o, pt);
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l < 1e-6) return pt;
  const k = Math.min(r, l) / l;
  return [pt[0] + v[0] * k, pt[1] + v[1] * k, pt[2] + v[2] * k];
}

const visiblePoint = (monde: Monde, o: Vec3, pos: PositionTigre): boolean =>
  pointsAxe(pos).some(({ pt, r }) => visible(monde, o, versOeil(o, pt, r)));

/** Distance (m) de l'œil au centre de la silhouette, pour la chute de dégâts. */
export function distanceTigre(o: Vec3, pos: PositionTigre): number {
  const m = pointsAxe(pos)[1].pt;
  return Math.hypot(m[0] - o[0], m[1] - o[1], m[2] - o[2]);
}

/**
 * Validation serveur d'une touche de tir sur un tigre, mêmes règles que `toucheVraisemblable` (tir.ts) : distance au plus portée + 2,
 * axe de la silhouette (croupe, milieu, épaules, tête) à 1,2 m au plus du rayon (plus une marge proportionnelle à la vitesse du tigre),
 * rayon libre jusqu'à l'entrée dans la silhouette, et un point de l'axe visible de l'œil du tireur.
 */
export function toucheTigreVraisemblable(monde: Monde, o: Vec3, d: Vec3, portee: number, pos: PositionTigre, vitesse: number): boolean {
  if (distanceTigre(o, pos) > portee + MARGE_PORTEE_M) return false;
  const tolerance = TOLERANCE_RAYON_M + Math.max(0, vitesse) * LATENCE_TOLEREE_S;
  let ecart = Infinity, proj = 0, rayon = 0;
  for (const { pt, r } of pointsAxe(pos)) {
    const w = moins(pt, o);
    const t = scal(w, d);
    const e = t < 0 ? Math.hypot(w[0], w[1], w[2]) : Math.hypot(w[0] - d[0] * t, w[1] - d[1] * t, w[2] - d[2] * t);
    if (e < ecart) { ecart = e; proj = t; rayon = r; }
  }
  if (ecart > tolerance) return false;
  // le rayon doit être libre jusqu'à l'entrée dans la silhouette (un mur collé au tigre ne compte pas)
  if (proj > 0 && lancerRayon(monde, o, d, Math.min(proj - rayon, portee + MARGE_PORTEE_M)) !== Infinity) return false;
  return visiblePoint(monde, o, pos);
}

/** Distance (m) de l'œil à la SURFACE de la silhouette (corps ou tête), 0 si dedans, avec le point d'axe le plus proche et son rayon. */
export function distanceSurfaceTigre(o: Vec3, pos: PositionTigre): { distance: number; point: Vec3; rayon: number } {
  const h = hitboxTigre(pos);
  const q = procheSegment(o, h.a, h.b);
  const dCorps = Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]) - h.rCorps;
  const dTete = Math.hypot(o[0] - h.c[0], o[1] - h.c[1], o[2] - h.c[2]) - h.rTete;
  return dTete < dCorps
    ? { distance: Math.max(0, dTete), point: h.c, rayon: h.rTete }
    : { distance: Math.max(0, dCorps), point: q, rayon: h.rCorps };
}

/**
 * Validation serveur d'un coup de couteau sur un tigre, mêmes règles que `coupVraisemblable` (melee.ts) : surface à portée + marge au
 * plus, point visé dans le cône de frappe (55°, élargi du rayon de la silhouette), un point de l'axe visible.
 */
export function coupTigreVraisemblable(monde: Monde, o: Vec3, d: Vec3, pos: PositionTigre): boolean {
  const s = distanceSurfaceTigre(o, pos);
  if (s.distance > COUTEAU.portee + COUTEAU.margePortee) return false;
  const v = moins(s.point, o);
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l > s.rayon) {
    const cos = Math.max(-1, Math.min(1, scal(v, d) / l));
    if (Math.acos(cos) > Math.acos(COUTEAU.cosCone) + Math.asin(Math.min(1, s.rayon / l))) return false;
  }
  return visiblePoint(monde, o, pos);
}
