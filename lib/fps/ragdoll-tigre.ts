/**
 * Mort « désarticulée » d'un tigre zombie (mode zombies), PURE (classes mathématiques de three seulement, comme `lib/tigre3d/squelette.ts` :
 * ni WebGL, ni DOM ; jamais importée par le serveur). Remplace la rotation rigide préprogrammée de `rendu-zombies.ts` (v7) par un ragdoll :
 *
 *  - des particules de Verlet sur les têtes d'os principales du squelette du GLB (`lib/tigre3d/donnees/squelette.json`) : bassin, colonne,
 *    poitrine, tête, mâchoire, quatre pattes en trois segments, queue (les oreilles suivent le cou, sans particule) ;
 *  - des contraintes de distance : longueurs d'os du repos, amas rigides (torse, bassin, crâne), colonne et cou bornés (le corps ne se plie
 *    pas en deux, la tête ne rentre pas dans le poitrail), butées « grand-parent ↔ petit-enfant » des pattes (genou et jarret jamais
 *    retournés) ; le reste est libre, donc mou et drôle (queue, mâchoire qui pend, pattes qui battent) ;
 *  - gravité, sol (`solSous` : on retombe aussi sur une table), murs du monde (prismes de `collision.ts`, particules-sphères), frottement,
 *    rebond, mise en sommeil quand plus rien ne bouge ;
 *  - une impulsion initiale qui dit COMMENT le tigre est mort (`impulsionMort` : arme, direction du tir, zone touchée) ;
 *  - la reconstruction des rotations des os depuis les positions des particules (`pose()`, `viserOs` / `orienterModele` du squelette),
 *    recopiée telle quelle sur le clone par `Tigre.appliquer`.
 *
 * Repères : les particules vivent dans le monde de l'arène (m). Le clone est posé comme à la mort (`RepereRagdoll` : groupe en (x, 0, z)
 * tourné de `cap + π/2`, modèle à l'échelle `echelle`, corps ramené de `origineX`, cf. `rendu-zombies.ts`) : `pose()` rend une pose du
 * squelette dans ce repère du modèle, la racine pouvant s'éloigner de plusieurs mètres (projection).
 * Pas fixe de 1/120 s (1/240 s au-delà de 10 m/s, pour ne pas traverser une cloison), au plus `RAGDOLL.sousPasMax` sous-pas par image.
 * Aucun hasard global : la variété passe par la graine (l'id du tigre).
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Role } from "../tigre3d/os";
import {
  creerMonde, fk, fkOs, nouvellePose, orienterModele, placerRacine,
  type Monde as MondeOs, type PoseTigre, type Squelette,
} from "../tigre3d/squelette";
import { STATS } from "./armes";
import { resoudre, solSous, type Monde } from "./collision";
import type { ArmeId, Vec3 } from "./protocole";

export const RAGDOLL = {
  /** pas d'intégration (s), et pas fin quand une particule dépasse `vitesseFine` (m/s) */
  pasS: 1 / 120,
  pasFinS: 1 / 240,
  vitesseFine: 10,
  /** au plus ce nombre de sous-pas par image (une image lente ralentit la chute plutôt que de faire exploser le coût) */
  sousPasMax: 8,
  gravite: 9.81,
  /** amortissement de l'air par pas (vitesse conservée) */
  air: 0.998,
  /** amortissement des particules légères (queue, mâchoire : sinon elles se balancent sans fin, la queue est une charnière libre) */
  airLeger: 0.985,
  /** en dessous de cette masse, une particule est légère et ne compte pas pour le sommeil */
  masseLegere: 0.5,
  /** itérations de contraintes par pas */
  iterations: 6,
  /** part de la vitesse horizontale perdue par pas au contact du sol (≈ 10 /s à 120 Hz : le cadavre glisse un peu puis s'arrête) */
  frottementSol: 0.08,
  /** part de la vitesse verticale rendue au rebond sur le sol, et contre un mur par défaut */
  rebondSol: 0.25,
  rebondMur: 0.3,
  /** sommeil : vitesse maximale (m/s) tenue sous ce seuil pendant `dureeSommeilS`, ou simulation plus longue que `vieMaxS` */
  vitesseSommeil: 0.06,
  dureeSommeilS: 0.35,
  vieMaxS: 6,
  /** poussée de côté (m/s) du torse et de la tête à la mort (il tombe sur le flanc) */
  pousseeFlanc: 0.7,
  /** plafond de ragdolls simulés à la fois (au-delà, un nouveau mort joue la mort rigide de la v7 : aucun cadavre figé en l'air) */
  actifsMax: 8,
} as const;

/** Façon de mourir, déduite du message `zombieMort` (cause et zone). */
export type CauseMort = "corps" | "tete" | "explosion" | "nuke" | "melee";

/** Pose du clone à la mort : groupe en (x, 0, z) tourné de `cap + π/2`, modèle à l'échelle `echelle`, corps ramené de `origineX`. */
export interface RepereRagdoll { x: number; z: number; cap: number; echelle: number; origineX: number }

/** Sortie d'une poussée hors d'un mur : position corrigée (x, z) et normale horizontale sortante. */
export interface PousseeMur { x: number; z: number; nx: number; nz: number }

/** Le monde vu du ragdoll (injecté : les tests passent un sol et un mur plans). */
export interface CollisionsRagdoll {
  /** hauteur du sol sous (x, z) pour un point à y (le plus haut toit sous lui, sinon 0) */
  sol(x: number, y: number, z: number): number;
  /** pousse la sphère (x, y, z, r) hors des murs ; faux si elle n'en touche aucun */
  mur(x: number, y: number, z: number, r: number, sortie: PousseeMur): boolean;
  /**
   * (facultatif) dessous du plafond au-dessus de (x, z), `Infinity` à ciel ouvert : le faux plafond des bâtiments creusés du mode zombies
   * (le même que celui des grenades, des projectiles et du joueur) ; un cadavre projeté rebondit dessous au lieu de traverser le toit
   */
  plafond?(x: number, z: number): number;
}

/**
 * Collisions d'un monde de `collision.ts` : `solSous` (petite tolérance) et `resoudre` (les champs passe-tigres arrêtent aussi un cadavre) ;
 * `plafond` : celui des bâtiments creusés (`plafondBatimentsCreux` de grenades.ts), sans plafond par défaut.
 */
export function collisionsDuMonde(m: Monde, plafond?: (x: number, z: number) => number): CollisionsRagdoll {
  const p: Vec3 = [0, 0, 0];
  return {
    ...(plafond ? { plafond } : {}),
    sol: (x, y, z) => solSous(m, x, z, y, 0.05),
    mur(x, y, z, r, sortie) {
      p[0] = x; p[1] = y; p[2] = z;
      const res = resoudre(m, p, r, 0, false);
      if (!res.contacts.length) return false;
      sortie.x = res.p[0]; sortie.z = res.p[2];
      let nx = 0, nz = 0;
      for (const c of res.contacts) { nx += c.nx; nz += c.nz; }
      const l = Math.hypot(nx, nz) || 1;
      sortie.nx = nx / l; sortie.nz = nz / l;
      return true;
    },
  };
}

/**
 * Impulsion de mort (variation de vitesse, m/s).
 *  - `ligne` : le long de `d` (unitaire), pleine pour les particules proches de la droite (o, d) à `rayon` près, `global` pour les autres ;
 *    `d` absent : du point `o` vers la cible (`tete` ou `torse`) ;
 *  - `radiale` : chaque particule s'écarte de `o` (souffle), de `vitesse` au centre à 40 % au bord du `rayon` ;
 *  - `verticale` : vers le haut, dispersée par la graine (nuke).
 * `montee` s'ajoute vers le haut (même poids), `vrille` (rad/s) fait tourner le corps sur lui-même, `rebond` règle les murs.
 */
export interface ImpulsionRagdoll {
  mode: "ligne" | "radiale" | "verticale";
  o: Vec3;
  d?: Vec3;
  cible?: "tete" | "torse";
  vitesse: number;
  montee: number;
  rayon: number;
  global: number;
  vrille?: number;
  rebond?: number;
}

/** Ce que le client sait d'une mort (message `zombieMort`, champs v8 optionnels). */
export interface InfoMort {
  cause: CauseMort;
  arme?: ArmeId;
  ameliore?: boolean;
  /** origine du coup : bouche du canon, centre du souffle ou position du joueur en mêlée (repli : la caméra du joueur local) */
  src?: Vec3;
  /** position du tigre (sol) */
  p: Vec3;
  /** graine (id du tigre) : côté du coup de couteau, sens de la vrille */
  graine: number;
}

/** Force d'une balle selon l'arme (m/s communiqués au torse) : un pistolet bouscule, un sniper renverse, un railgun envoie valser. */
const FORCE_BALLE: Partial<Record<ArmeId, number>> = {
  pistolet: 2.2, mini_uzi: 2.2, mitraillette: 2.4, fusil_assaut: 3, mitrailleuse: 3.4, minigun: 3.4,
  revolver: 4.5, magnum_dore: 5, sniper: 6, railgun: 9, fumigene: 1.5,
  // (v8) armes des zombies
  perforeuse: 3, photocopieuse: 2.4, agrafeuse: 4.5, baguette: 5.5, essoreuse: 4.5, grille_pain: 6,
};

/**
 * L'arme projette le tigre contre les murs : le Pistolet à rayons, la Soufflerie (v8), et toute arme qui explose, de base (la Brochette) ou
 * améliorée (Moutarde & Sally, Pompe royale, lance-gratins…).
 */
export function armeProjette(arme: ArmeId | undefined, ameliore: boolean | undefined): boolean {
  if (!arme) return false;
  if (arme === "rayon" || arme === "soufflerie") return true;
  if (arme === "couteau" || arme === "epee") return false;
  const z = STATS[arme].zombie;
  return !!(ameliore ? z.ameliore : z).explosion;
}

/** Impulsion de la mort `info` (pure, testée) ; `repliSrc` = la caméra du joueur local quand le serveur n'a pas dit d'où venait le coup. */
export function impulsionMort(info: InfoMort, repliSrc: Vec3): ImpulsionRagdoll {
  const p = info.p;
  const src = info.src ?? repliSrc;
  const sens = info.graine % 2 ? 1 : -1;
  const projette = armeProjette(info.arme, info.ameliore);
  // direction horizontale du coup (de la source vers le tigre), repli : vers +x
  let hx = p[0] - src[0], hz = p[2] - src[2];
  const hl = Math.hypot(hx, hz);
  if (hl > 1e-6) { hx /= hl; hz /= hl; } else { hx = 1; hz = 0; }
  const forteProjection = info.arme === "rayon" ? (info.ameliore ? 19 : 15) : info.arme === "bazooka" ? 18
    : info.arme === "soufflerie" ? (info.ameliore ? 24 : 21) : 15;

  if (info.cause === "nuke") return { mode: "verticale", o: [p[0], 0, p[2]], vitesse: 2.2, montee: 3.6, rayon: 0, global: 1, vrille: 2.5 * sens };
  if (info.cause === "explosion") {
    // souffle : radial depuis son centre (sous le tigre s'il est inconnu) ; projection violente au rayon et aux armes gratinées
    const o: Vec3 = info.src ? [src[0], Math.min(src[1], 0.6), src[2]] : [p[0] - hx * 0.6, 0.1, p[2] - hz * 0.6];
    if (projette) return { mode: "radiale", o, vitesse: forteProjection, montee: 5, rayon: 4.5, global: 1, vrille: 5 * sens, rebond: 0.55 };
    const fort = info.arme === "bazooka" || info.arme === "lance_grenades";
    return { mode: "radiale", o, vitesse: fort ? 12 : 9, montee: fort ? 5.5 : 4.5, rayon: 4.5, global: 1, vrille: 2 * sens, rebond: 0.4 };
  }
  if (info.cause === "melee") {
    // coup latéral : le coup de couteau balaie de côté, l'épée fauche et soulève
    const epee = info.arme === "epee";
    const lx = -hz * sens, lz = hx * sens;
    const dx = hx * 0.45 + lx, dz = hz * 0.45 + lz, dl = Math.hypot(dx, dz);
    // la ligne passe par le tigre (pas par le joueur) : c'est le flanc qui prend le coup
    return {
      mode: "ligne", o: [p[0], 0.6, p[2]], d: [dx / dl, 0, dz / dl], vitesse: epee ? 6.5 : 3.6, montee: epee ? 2.6 : 1.2, rayon: 1.2, global: 0.6,
      vrille: (epee ? 4 : 1.5) * sens,
    };
  }
  const tete = info.cause === "tete";
  if (projette) {
    // tir direct du rayon ou d'une arme gratinée explosive : plaqué au premier mur, et ça rebondit
    return { mode: "ligne", o: src, cible: tete ? "tete" : "torse", vitesse: forteProjection, montee: 5, rayon: 0.9, global: 0.85, vrille: 4 * sens, rebond: 0.55 };
  }
  if (info.arme === "pompe") {
    return { mode: "ligne", o: src, cible: tete ? "tete" : "torse", vitesse: tete ? 7 : 6, montee: 1.8, rayon: 0.8, global: 0.5, vrille: 1.2 * sens };
  }
  if (info.arme === "lance_grenades" || info.arme === "bazooka") {
    // tué par l'obus lui-même (le souffle vient avec sa propre cause) : comme un gros calibre
    return { mode: "ligne", o: src, cible: "torse", vitesse: 9, montee: 3.5, rayon: 0.9, global: 0.8, vrille: 2 * sens, rebond: 0.4 };
  }
  const f = (info.arme && FORCE_BALLE[info.arme]) || 2.5;
  // tête : elle part en arrière (impulsion concentrée sur le crâne) ; corps : il encaisse au point touché et s'effondre
  return tete
    ? { mode: "ligne", o: src, cible: "tete", vitesse: f * 1.5 + 1, montee: 1, rayon: 0.35, global: 0.12 }
    : { mode: "ligne", o: src, cible: "torse", vitesse: f, montee: 0.6, rayon: 0.5, global: 0.35 };
}

// ---------------------------------------------------------------------------------------------
// définition des particules et des contraintes
// ---------------------------------------------------------------------------------------------

interface DefParticule { role: Role; masse: number; /** rayon en m du modèle (× échelle), plancher en m */ rayon: number; plancher: number }

const PARTICULES: readonly DefParticule[] = [
  { role: "racine", masse: 4, rayon: 0.085, plancher: 0.13 },
  { role: "thorax", masse: 4, rayon: 0.085, plancher: 0.13 }, // poitrine : épaules et cou y prennent naissance
  { role: "lombaires", masse: 4, rayon: 0.085, plancher: 0.13 },
  { role: "hancheG", masse: 4, rayon: 0.08, plancher: 0.13 }, // bassin : hanches et queue
  { role: "brasG", masse: 1.5, rayon: 0.035, plancher: 0 },
  { role: "mainG", masse: 1, rayon: 0.03, plancher: 0.1 },
  { role: "bout_mainG", masse: 0.5, rayon: 0.025, plancher: 0 },
  { role: "brasD", masse: 1.5, rayon: 0.035, plancher: 0 },
  { role: "mainD", masse: 1, rayon: 0.03, plancher: 0.1 },
  { role: "bout_mainD", masse: 0.5, rayon: 0.025, plancher: 0 },
  { role: "cuisseG", masse: 1.5, rayon: 0.035, plancher: 0 },
  { role: "jarretG", masse: 1, rayon: 0.03, plancher: 0 },
  { role: "piedG", masse: 1, rayon: 0.03, plancher: 0.1 },
  { role: "bout_piedG", masse: 0.5, rayon: 0.025, plancher: 0 },
  { role: "cuisseD", masse: 1.5, rayon: 0.035, plancher: 0 },
  { role: "jarretD", masse: 1, rayon: 0.03, plancher: 0 },
  { role: "piedD", masse: 1, rayon: 0.03, plancher: 0.1 },
  { role: "bout_piedD", masse: 0.5, rayon: 0.025, plancher: 0 },
  { role: "tete", masse: 2, rayon: 0.06, plancher: 0.12 }, // pivot de la tête (mâchoire et oreilles)
  { role: "bout_tete", masse: 1, rayon: 0.05, plancher: 0.1 },
  { role: "bout_machoire", masse: 0.5, rayon: 0.03, plancher: 0 },
  { role: "queue2", masse: 0.3, rayon: 0.025, plancher: 0 },
  { role: "queue3", masse: 0.3, rayon: 0.025, plancher: 0 },
  { role: "queue4", masse: 0.3, rayon: 0.025, plancher: 0 },
  { role: "queue5", masse: 0.3, rayon: 0.025, plancher: 0 },
  { role: "queue6", masse: 0.3, rayon: 0.025, plancher: 0 },
  { role: "bout_queue", masse: 0.3, rayon: 0.02, plancher: 0 },
];

export const ROLES_RAGDOLL: readonly Role[] = PARTICULES.map((d) => d.role);
const TETE: readonly Role[] = ["tete", "bout_tete", "bout_machoire"];

/** Amas rigides (toutes les paires). */
const AMAS: readonly (readonly Role[])[] = [
  ["racine", "thorax", "brasG", "brasD"],
  ["lombaires", "hancheG", "cuisseG", "cuisseD"],
  ["tete", "bout_tete"],
];

/** Bornes [min, max] (× la distance de repos) et raideur : colonne, cou, pattes, queue, mâchoire. */
const BORNES: readonly [Role, Role, number, number, number][] = [
  // colonne : se courbe, ne se plie jamais en deux ; vrille limitée (épaules ↔ hanches)
  ["racine", "lombaires", 0.9, 1.05, 0.6],
  ["thorax", "hancheG", 0.85, 1.03, 1],
  ["racine", "hancheG", 0.85, 1.05, 1],
  ["brasG", "cuisseG", 0.85, 1.12, 0.5],
  ["brasD", "cuisseD", 0.85, 1.12, 0.5],
  ["brasG", "cuisseD", 0.85, 1.12, 0.5],
  ["brasD", "cuisseG", 0.85, 1.12, 0.5],
  // cou : la tête ballotte, sans rentrer dans le poitrail
  ["racine", "tete", 0.75, 1.15, 1],
  ["thorax", "bout_tete", 0.75, 1.2, 1],
  // mâchoire : elle pend, sans traverser le crâne
  ["bout_machoire", "bout_tete", 0.9, 2.2, 1],
  // pattes avant : le poignet ne se retourne pas, la patte ne rentre pas dans le corps
  ["brasG", "bout_mainG", 0.6, 1.02, 1],
  ["brasD", "bout_mainD", 0.6, 1.02, 1],
  ["racine", "mainG", 0.55, 1.6, 1],
  ["racine", "mainD", 0.55, 1.6, 1],
  // pattes arrière : genou et jarret jamais retournés
  ["cuisseG", "piedG", 0.5, 1.0, 1],
  ["cuisseD", "piedD", 0.5, 1.0, 1],
  ["jarretG", "bout_piedG", 0.6, 1.02, 1],
  ["jarretD", "bout_piedD", 0.6, 1.02, 1],
  ["hancheG", "jarretG", 0.6, 1.05, 1],
  ["hancheG", "jarretD", 0.6, 1.05, 1],
  // queue : souple, sans s'enrouler en boule
  ["hancheG", "queue3", 0.6, 1, 0.5],
  ["queue2", "queue4", 0.55, 1, 0.5],
  ["queue3", "queue5", 0.55, 1, 0.5],
  ["queue4", "queue6", 0.55, 1, 0.5],
  ["queue5", "bout_queue", 0.55, 1, 0.5],
];

/** Topologie précalculée pour un squelette (partagée par tous les ragdolls). */
interface Topologie {
  sq: Squelette;
  n: number;
  /** particule de la tête de chaque os (-1 : pas de particule, l'os garde sa rotation de repos relative à son parent) */
  particuleOs: Int16Array;
  /** particule visée par chaque os (celle de la tête de son premier enfant), -1 sinon */
  viseOs: Int16Array;
  invMasse: Float64Array;
  rayon: Float64Array;
  plancher: Float64Array;
  tete: Uint8Array;
  /** contraintes : particules, bornes de distance en m du modèle (min = max : rigide), raideur */
  ca: Int16Array; cb: Int16Array; cmin: Float64Array; cmax: Float64Array; craideur: Float64Array;
  ip: Record<string, number>;
}

const topologies = new WeakMap<Squelette, Topologie>();

const ex = new Vector3(), ey = new Vector3(), ez = new Vector3(), mat = new Matrix4();
/** Quaternion du repère (x = a, y = b orthogonalisé, z = a × b) ; faux si dégénéré. */
function repereDeux(a: Vector3, b: Vector3, q: Quaternion): boolean {
  const la = a.length();
  if (la < 1e-9) return false;
  ex.copy(a).divideScalar(la);
  ey.copy(b).addScaledVector(ex, -b.dot(ex));
  const lb = ey.length();
  if (lb < 1e-6 * Math.max(1, b.length())) return false;
  ey.divideScalar(lb);
  ez.crossVectors(ex, ey);
  mat.makeBasis(ex, ey, ez);
  q.setFromRotationMatrix(mat);
  return true;
}

function topologie(sq: Squelette): Topologie {
  const deja = topologies.get(sq);
  if (deja) return deja;
  const n = PARTICULES.length;
  const ip: Record<string, number> = {};
  PARTICULES.forEach((d, k) => { ip[d.role] = k; });
  const repos = PARTICULES.map((d) => sq.pModele[sq.i[d.role]].clone());
  const particuleOs = new Int16Array(sq.n).fill(-1);
  for (let k = 0; k < sq.n; k++) {
    for (let j = 0; j < n; j++) if (repos[j].distanceTo(sq.pModele[k]) < 1e-4) { particuleOs[k] = j; break; }
  }
  const viseOs = new Int16Array(sq.n).fill(-1);
  for (let k = 0; k < sq.n; k++) {
    const e = sq.enfants[k];
    if (!e.length || particuleOs[k] < 0) continue;
    const c = particuleOs[e[0]];
    if (c >= 0 && c !== particuleOs[k]) viseOs[k] = c;
  }
  const ca: number[] = [], cb: number[] = [], cmin: number[] = [], cmax: number[] = [], craideur: number[] = [];
  const cles = new Set<string>();
  const ajouter = (a: number, b: number, mn: number, mx: number, r: number) => {
    if (a === b) return;
    const cle = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (cles.has(cle)) return;
    cles.add(cle);
    const d = repos[a].distanceTo(repos[b]);
    ca.push(a); cb.push(b); cmin.push(d * mn); cmax.push(d * mx); craideur.push(r);
  };
  // os : parent → chaque enfant ayant une particule distincte
  for (let k = 0; k < sq.n; k++) {
    const a = particuleOs[k];
    if (a < 0) continue;
    for (const e of sq.enfants[k]) { const b = particuleOs[e]; if (b >= 0) ajouter(a, b, 1, 1, 1); }
  }
  for (const amas of AMAS) for (let i = 0; i < amas.length; i++) for (let j = i + 1; j < amas.length; j++) ajouter(ip[amas[i]], ip[amas[j]], 1, 1, 1);
  for (const [a, b, mn, mx, r] of BORNES) ajouter(ip[a], ip[b], mn, mx, r);

  const t: Topologie = {
    sq, n, particuleOs, viseOs,
    invMasse: Float64Array.from(PARTICULES, (d) => 1 / d.masse),
    rayon: Float64Array.from(PARTICULES, (d) => d.rayon),
    plancher: Float64Array.from(PARTICULES, (d) => d.plancher),
    tete: Uint8Array.from(PARTICULES, (d) => (TETE.includes(d.role) ? 1 : 0)),
    ca: Int16Array.from(ca), cb: Int16Array.from(cb), cmin: Float64Array.from(cmin), cmax: Float64Array.from(cmax), craideur: Float64Array.from(craideur),
    ip,
  };
  topologies.set(sq, t);
  return t;
}

// ---------------------------------------------------------------------------------------------
// ragdoll
// ---------------------------------------------------------------------------------------------

export interface Ragdoll {
  /** nombre de particules */
  readonly n: number;
  /** positions (x, y, z) des particules dans le monde, à plat */
  readonly pos: Float64Array;
  /**
   * avance de `dt` secondes (rien s'il dort ou s'il est figé) ; rend le temps réellement simulé (moins que `dt` sous une image lente :
   * au plus `RAGDOLL.sousPasMax` pas)
   */
  pas(dt: number): number;
  /** applique une impulsion (réveille le ragdoll) */
  impulsion(i: ImpulsionRagdoll): void;
  /** pose du squelette dans le repère du modèle de la mort (`RepereRagdoll`), à recopier par `Tigre.appliquer(pose, origineX)` */
  pose(): PoseTigre;
  /** il ne bouge plus (sommeil, durée de vie écoulée ou figé par le plafond) : sa pose ne change plus */
  endormi(): boolean;
  /** fige le ragdoll dans sa pose actuelle (plafond des ragdolls actifs) */
  figer(): void;
  /** position monde de la particule du rôle (copie), null si ce rôle n'a pas de particule */
  particule(role: Role): Vec3 | null;
  /** centre de masse (monde) et vitesse du centre de masse (m/s) */
  centre(): Vec3;
  vitesseCentre(): Vec3;
  /** vitesse maximale d'une particule au dernier pas (m/s) */
  vitesseMax(): number;
  /** temps simulé (s) */
  age(): number;
  readonly repere: RepereRagdoll;
}

/**
 * Ragdoll d'un tigre posé comme `osMonde` (positions des os en repère du modèle, cinématique directe de la pose à la mort) dans le repère
 * `repere`. `vitesse` : vitesse initiale de tout le corps (m/s, monde : le tigre qui court continue sur sa lancée). `graine` (l'id du
 * tigre) : une petite poussée de côté du torse et de la tête, à gauche ou à droite, pour qu'il tombe sur le flanc plutôt que de s'asseoir
 * sur ses pattes arrière tendues (équilibre instable qu'un calcul symétrique tiendrait).
 */
export function creerRagdoll(
  sq: Squelette, osMonde: MondeOs, repere: RepereRagdoll, collisions: CollisionsRagdoll,
  opts: { vitesse?: Vec3; graine?: number } = {},
): Ragdoll {
  const T = topologie(sq);
  const n = T.n;
  const s = repere.echelle;
  const th = repere.cap + Math.PI / 2;
  const cos = Math.cos(th), sin = Math.sin(th);
  const pos = new Float64Array(n * 3), prec = new Float64Array(n * 3);
  const rayon = new Float64Array(n);
  for (let i = 0; i < n; i++) rayon[i] = Math.max(T.rayon[i] * s, T.plancher[i]);
  const masseTot = Array.from(T.invMasse).reduce((a, w) => a + 1 / w, 0);
  const lourde = Uint8Array.from(T.invMasse, (w) => (1 / w > RAGDOLL.masseLegere ? 1 : 0));
  const air = Float64Array.from(lourde, (l) => (l ? RAGDOLL.air : RAGDOLL.airLeger));
  // repère : modèle → monde, p_monde = Ry(θ) · (s · (p − [origineX, 0, 0])) + (x, 0, z)
  const versMonde = (v: Vector3, o: Float64Array, k: number) => {
    const px = (v.x - repere.origineX) * s, py = v.y * s, pz = v.z * s;
    o[k] = cos * px + sin * pz + repere.x;
    o[k + 1] = py;
    o[k + 2] = -sin * px + cos * pz + repere.z;
  };
  // bornes des contraintes en m du monde, élargies à la pose de la mort (le tigre qui court a les épaules, les pattes et la colonne hors
  // de leur repos : sans cela, tout claquerait vers le repos à la première image)
  for (let i = 0; i < n; i++) versMonde(osMonde.p[sq.i[PARTICULES[i].role]], pos, i * 3);
  const nc = T.ca.length;
  const bMin = new Float64Array(nc), bMax = new Float64Array(nc);
  for (let c = 0; c < nc; c++) {
    const a = T.ca[c] * 3, b = T.cb[c] * 3;
    const d0 = Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    const mn = T.cmin[c] * s, mx = T.cmax[c] * s;
    if (mn === mx) { bMin[c] = bMax[c] = d0; } else { bMin[c] = Math.min(mn, d0); bMax[c] = Math.max(mx, d0); }
  }
  const vx0 = opts.vitesse?.[0] ?? 0, vy0 = opts.vitesse?.[1] ?? 0, vz0 = opts.vitesse?.[2] ?? 0;
  const h0 = RAGDOLL.pasS;
  // flanc : l'axe +z du modèle (la gauche du tigre) dans le monde
  const cote = opts.graine === undefined ? 0 : (opts.graine % 2 ? 1 : -1) * RAGDOLL.pousseeFlanc;
  for (let i = 0; i < n; i++) {
    const flanc = PARTICULES[i].masse >= 2 ? cote : 0;
    // jamais sous le sol (tigre qui sortait de terre, patte enfoncée par l'IK)
    const sol = collisions.sol(pos[i * 3], pos[i * 3 + 1] + 0.5, pos[i * 3 + 2]);
    if (pos[i * 3 + 1] < sol + rayon[i]) pos[i * 3 + 1] = sol + rayon[i];
    prec[i * 3] = pos[i * 3] - (vx0 + flanc * sin) * h0;
    prec[i * 3 + 1] = pos[i * 3 + 1] - vy0 * h0;
    prec[i * 3 + 2] = pos[i * 3 + 2] - (vz0 + flanc * cos) * h0;
  }

  let reserve = 0;
  let calme = 0;
  let age = 0;
  let dort = false;
  let fige = false;
  let vMax = 0;
  let h = RAGDOLL.pasS;
  let rebondMur: number = RAGDOLL.rebondMur;
  const poussee: PousseeMur = { x: 0, z: 0, nx: 0, nz: 0 };

  function contraintes(): void {
    const { ca, cb, craideur, invMasse } = T;
    for (let c = 0; c < ca.length; c++) {
      const a = ca[c] * 3, b = cb[c] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const mn = bMin[c], mx = bMax[c];
      let cible: number;
      if (d < mn) cible = mn; else if (d > mx) cible = mx; else continue;
      const wa = invMasse[ca[c]], wb = invMasse[cb[c]];
      const k = ((d - cible) / d) * craideur[c] / (wa + wb);
      pos[a] += dx * k * wa; pos[a + 1] += dy * k * wa; pos[a + 2] += dz * k * wa;
      pos[b] -= dx * k * wb; pos[b + 1] -= dy * k * wb; pos[b + 2] -= dz * k * wb;
    }
  }

  /** sol et plafond sous / au-dessus de chaque particule (une requête par pas), vitesse verticale d'arrivée, contacts du pas */
  const solP = new Float64Array(n), plafondP = new Float64Array(n).fill(Infinity), vyArrivee = new Float64Array(n), contact = new Uint8Array(n);
  const contactHaut = new Uint8Array(n);

  /** Sol (et plafond) : projection dans chaque itération de contraintes (sinon les contraintes et le sol se renvoient la particule, qui tremble). */
  function poserAuSol(): void {
    for (let i = 0; i < n; i++) {
      const k = i * 3 + 1, bas = solP[i] + rayon[i], haut = plafondP[i] - rayon[i];
      if (pos[k] < bas) { pos[k] = bas; contact[i] = 1; }
      else if (pos[k] > haut && haut > bas) { pos[k] = haut; contactHaut[i] = 1; }
    }
  }

  function collisionsPas(): void {
    for (let i = 0; i < n; i++) {
      const k = i * 3, r = rayon[i];
      if (contact[i]) {
        // rebond vertical et frottement : le cadavre glisse un peu puis s'arrête
        prec[k + 1] = vyArrivee[i] < 0 ? pos[k + 1] + vyArrivee[i] * RAGDOLL.rebondSol : pos[k + 1];
        const f = 1 - RAGDOLL.frottementSol;
        prec[k] = pos[k] - (pos[k] - prec[k]) * f;
        prec[k + 2] = pos[k + 2] - (pos[k + 2] - prec[k + 2]) * f;
      } else if (contactHaut[i]) {
        // plafond : la vitesse montante repart vers le bas, amortie comme au sol
        prec[k + 1] = vyArrivee[i] > 0 ? pos[k + 1] + vyArrivee[i] * RAGDOLL.rebondSol : pos[k + 1];
      }
      if (!collisions.mur(pos[k], pos[k + 1], pos[k + 2], r, poussee)) continue;
      // mur : sortie par la normale, vitesse normale renvoyée (rebond), vitesse tangentielle un peu freinée
      const vx = pos[k] - prec[k], vz = pos[k + 2] - prec[k + 2];
      pos[k] = poussee.x; pos[k + 2] = poussee.z;
      const vn = vx * poussee.nx + vz * poussee.nz;
      let nvx = vx, nvz = vz;
      if (vn < 0) {
        nvx = (vx - vn * poussee.nx) * 0.8 - rebondMur * vn * poussee.nx;
        nvz = (vz - vn * poussee.nz) * 0.8 - rebondMur * vn * poussee.nz;
      }
      prec[k] = pos[k] - nvx; prec[k + 2] = pos[k + 2] - nvz;
    }
  }

  function unPas(): void {
    const g = RAGDOLL.gravite * h * h;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const a = air[i];
      const vx = (pos[k] - prec[k]) * a, vy = (pos[k + 1] - prec[k + 1]) * a - g, vz = (pos[k + 2] - prec[k + 2]) * a;
      prec[k] = pos[k]; prec[k + 1] = pos[k + 1]; prec[k + 2] = pos[k + 2];
      pos[k] += vx; pos[k + 1] += vy; pos[k + 2] += vz;
      vyArrivee[i] = vy;
      contact[i] = 0;
      contactHaut[i] = 0;
      // le toit le plus haut sous la particule à sa hauteur d'avant (table, muret) : on retombe dessus
      solP[i] = collisions.sol(pos[k], prec[k + 1], pos[k + 2]);
      // le plafond ne retient qu'une particule qui était dessous (pas un cadavre posé sur un toit au-dessus d'un bâtiment voisin)
      const pf = collisions.plafond ? collisions.plafond(pos[k], pos[k + 2]) : Infinity;
      plafondP[i] = prec[k + 1] < pf ? pf : Infinity;
    }
    for (let it = 0; it < RAGDOLL.iterations; it++) { contraintes(); poserAuSol(); }
    collisionsPas();
    // sommeil : sur les particules lourdes seulement (une queue qui frétille n'empêche pas le corps de dormir)
    let v2 = 0;
    for (let j = 0; j < n * 3; j += 3) {
      if (!lourde[j / 3]) continue;
      const dx = pos[j] - prec[j], dy = pos[j + 1] - prec[j + 1], dz = pos[j + 2] - prec[j + 2];
      const w2 = dx * dx + dy * dy + dz * dz;
      if (w2 > v2) v2 = w2;
    }
    vMax = Math.sqrt(v2) / h;
  }

  /** Change le pas en gardant les vitesses (Verlet : la vitesse est l'écart à la position précédente divisé par le pas). */
  function changerPas(nh: number): void {
    if (nh === h) return;
    const k = nh / h;
    for (let j = 0; j < n * 3; j++) prec[j] = pos[j] - (pos[j] - prec[j]) * k;
    h = nh;
  }

  // pose : cache recalculé seulement quand les particules ont bougé
  const pose = nouvellePose(sq);
  const os = creerMonde(sq);
  let poseAJour = false;
  const vP = new Vector3(), vA = new Vector3(), vB = new Vector3(), qR = new Quaternion(), qM = new Quaternion();
  const modele: Vector3[] = Array.from({ length: n }, () => new Vector3());
  // os orientés par deux directions (racine, cou, lombaires) : attache = repère des particules à la mort⁻¹ · rotation de l'os à la mort ;
  // `qPrec` garde la dernière rotation (repli si un repère devient dégénéré)
  const ip = T.ip;
  const DEUX = {
    racine: { k: sq.i.racine, a: ip.racine, b: ip.thorax, c: ip.brasD, d: ip.brasG },
    cou: { k: sq.i.cou, a: ip.thorax, b: ip.tete, c: ip.tete, d: ip.bout_tete },
    lombaires: { k: sq.i.lombaires, a: ip.lombaires, b: ip.hancheG, c: ip.cuisseD, d: ip.cuisseG },
  };
  const qAttache = { racine: new Quaternion(), cou: new Quaternion(), lombaires: new Quaternion() };
  const qPrec = { racine: new Quaternion(), cou: new Quaternion(), lombaires: new Quaternion() };
  for (const cle of ["racine", "cou", "lombaires"] as const) {
    const { k, a, b, c, d } = DEUX[cle];
    const p = (i: number) => osMonde.p[sq.i[PARTICULES[i].role]];
    if (!repereDeux(vA.subVectors(p(b), p(a)), vB.subVectors(p(d), p(c)), qAttache[cle])) qAttache[cle].identity();
    qAttache[cle].invert();
    // rotation finale = repère courant · repère à la mort⁻¹ · rotation de l'os à la mort
    qAttache[cle].multiply(osMonde.q[k]);
    qPrec[cle].copy(osMonde.q[k]);
  }

  function versModele(): void {
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const wx = pos[k] - repere.x, wy = pos[k + 1], wz = pos[k + 2] - repere.z;
      // inverse de Ry(θ) : (cos·x − sin·z, y, sin·x + cos·z)
      modele[i].set((cos * wx - sin * wz) / s + repere.origineX, wy / s, (sin * wx + cos * wz) / s);
    }
  }

  /** Rotation modèle d'un os orienté par deux directions (repère courant des particules), `qPrec` si le repère est dégénéré. */
  function orienterDeux(cle: keyof typeof DEUX): Quaternion {
    const { a, b, c, d } = DEUX[cle];
    vA.subVectors(modele[b], modele[a]);
    vB.subVectors(modele[d], modele[c]);
    if (repereDeux(vA, vB, qR)) {
      qM.copy(qR).multiply(qAttache[cle]);
      qPrec[cle].copy(qM);
    } else qM.copy(qPrec[cle]);
    return qM;
  }

  const dRepos = new Vector3(), qP = new Quaternion(), qV = new Quaternion();
  /**
   * Oriente l'os k pour que son premier enfant tombe dans la direction `dir` (repère du modèle), par la rotation minimale depuis son
   * orientation de repos relative au parent courant. Comme `viserOs`, mais l'axe vient de la translation de repos de l'enfant : les os du
   * GLB ne pointent pas tous selon +Y local (la colonne, la queue).
   */
  function viser(k: number, dir: Vector3): void {
    const p = sq.parent[k];
    qP.copy(p < 0 ? sq.racine.q : os.q[p]).multiply(sq.qRepos[k]);
    dRepos.copy(sq.tRepos[sq.enfants[k][0]]).normalize().applyQuaternion(qP);
    qV.setFromUnitVectors(dRepos, dir.normalize()).multiply(qP);
    qP.copy(p < 0 ? sq.racine.q : os.q[p]).invert();
    pose.q[k].copy(qP).multiply(qV);
    fkOs(sq, pose, os, k);
  }

  function reconstruire(): void {
    versModele();
    // racine : repère (racine → poitrine, épaule droite → gauche), posée sur sa particule
    const kr = sq.i.racine;
    const qRac = orienterDeux("racine");
    placerRacine(sq, pose, vP.copy(modele[ip.racine]), qRac);
    fkOs(sq, pose, os, kr);
    for (let k = 1; k < sq.n; k++) {
      if (k === sq.i.cou) {
        orienterModele(sq, pose, os, k, orienterDeux("cou"));
      } else if (k === sq.i.lombaires) {
        orienterModele(sq, pose, os, k, orienterDeux("lombaires"));
      } else if (T.viseOs[k] >= 0) {
        // la tête de l'os ne dépend que de son parent : mise à jour avant de viser
        fkOs(sq, pose, os, k);
        vA.subVectors(modele[T.viseOs[k]], os.p[k]);
        if (vA.lengthSq() > 1e-12) viser(k, vA);
        else { pose.q[k].copy(sq.qRepos[k]); fkOs(sq, pose, os, k); }
      } else {
        // oreilles, bouts : rotation de repos relative au parent (elles suivent la tête)
        pose.q[k].copy(sq.qRepos[k]);
        fkOs(sq, pose, os, k);
      }
    }
    poseAJour = true;
  }

  const r: Ragdoll = {
    n, pos, repere,
    pas(dt) {
      if (dort || fige || !(dt > 0)) return 0;
      const age0 = age;
      reserve = Math.min(reserve + dt, RAGDOLL.pasS * RAGDOLL.sousPasMax);
      let pas = 0;
      while (pas < RAGDOLL.sousPasMax) {
        changerPas(vMax > RAGDOLL.vitesseFine ? RAGDOLL.pasFinS : RAGDOLL.pasS);
        if (reserve < h - 1e-9) break;
        reserve -= h;
        age += h;
        unPas();
        pas++;
        calme = vMax < RAGDOLL.vitesseSommeil ? calme + h : 0;
        if (calme >= RAGDOLL.dureeSommeilS || age >= RAGDOLL.vieMaxS) { dort = true; break; }
      }
      if (pas > 0) poseAJour = false;
      return age - age0;
    },
    impulsion(im) {
      dort = false; calme = 0;
      if (im.rebond !== undefined) rebondMur = im.rebond;
      // direction de la ligne : donnée, sinon de la source vers la cible (tête ou torse)
      let dx = 0, dy = 0, dz = 0;
      if (im.mode === "ligne") {
        if (im.d) { dx = im.d[0]; dy = im.d[1]; dz = im.d[2]; } else {
          const cible = im.cible === "tete" ? T.ip.tete : T.ip.racine;
          dx = pos[cible * 3] - im.o[0]; dy = pos[cible * 3 + 1] - im.o[1]; dz = pos[cible * 3 + 2] - im.o[2];
        }
        // un tir plongeant ne plante pas le tigre dans le sol : la composante verticale est bornée
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy = Math.max(-0.1, Math.min(0.35, dy / l)); dz /= l;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        dx /= l2; dy /= l2; dz /= l2;
      }
      // centre de masse (vrille autour de l'axe vertical qui y passe)
      const c = r.centre();
      const hh = h;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        let wx = 0, wy = 0, wz = 0, w = 1;
        if (im.mode === "ligne") {
          // distance de la particule à la droite du coup
          const px = pos[k] - im.o[0], py = pos[k + 1] - im.o[1], pz = pos[k + 2] - im.o[2];
          const t = px * dx + py * dy + pz * dz;
          const qx = px - t * dx, qy = py - t * dy, qz = pz - t * dz;
          const dist = Math.sqrt(qx * qx + qy * qy + qz * qz);
          const local = Math.exp(-((dist / Math.max(im.rayon, 1e-3)) ** 2));
          // tête visée : le crâne prend tout (il part en arrière), le reste suit par les contraintes
          const bonus = im.cible === "tete" && T.tete[i] ? 1 : 0;
          w = Math.min(1, im.global + (1 - im.global) * Math.max(local, bonus));
          wx = dx * im.vitesse; wy = dy * im.vitesse; wz = dz * im.vitesse;
        } else if (im.mode === "radiale") {
          const px = pos[k] - im.o[0], py = pos[k + 1] - im.o[1], pz = pos[k + 2] - im.o[2];
          const dist = Math.sqrt(px * px + py * py + pz * pz) || 1e-3;
          w = Math.max(0.4, 1 - dist / Math.max(im.rayon, 1e-3));
          wx = (px / dist) * im.vitesse; wy = Math.max(0, py / dist) * im.vitesse * 0.5; wz = (pz / dist) * im.vitesse;
        } else {
          // verticale dispersée : chaque particule part un peu de travers (la graine est dans la vrille)
          const a = i * 2.39996 + (im.vrille ?? 0);
          wx = Math.cos(a) * im.vitesse * 0.5; wz = Math.sin(a) * im.vitesse * 0.5;
        }
        wy += im.montee;
        // vrille : rotation autour de l'axe vertical du centre de masse
        const vr = im.vrille ?? 0;
        const rx = pos[k] - c[0], rz = pos[k + 2] - c[2];
        const dvx = wx * w - vr * rz, dvy = wy * w, dvz = wz * w + vr * rx;
        prec[k] -= dvx * hh; prec[k + 1] -= dvy * hh; prec[k + 2] -= dvz * hh;
      }
      vMax = Math.max(vMax, im.vitesse + im.montee);
      poseAJour = false;
    },
    pose() {
      if (!poseAJour) reconstruire();
      return pose;
    },
    endormi: () => dort || fige,
    figer() { fige = true; },
    particule(role) {
      const i = T.ip[role];
      return i === undefined ? null : [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    },
    centre() {
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < n; i++) { const m = 1 / T.invMasse[i]; x += pos[i * 3] * m; y += pos[i * 3 + 1] * m; z += pos[i * 3 + 2] * m; }
      return [x / masseTot, y / masseTot, z / masseTot];
    },
    vitesseCentre() {
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < n; i++) {
        const m = 1 / T.invMasse[i], k = i * 3;
        x += (pos[k] - prec[k]) * m; y += (pos[k + 1] - prec[k + 1]) * m; z += (pos[k + 2] - prec[k + 2]) * m;
      }
      const f = masseTot * h;
      return [x / f, y / f, z / f];
    },
    vitesseMax: () => vMax,
    age: () => age,
  };
  return r;
}

/** Positions des os (repère du modèle) de la pose `pose` : la cinématique directe à donner à `creerRagdoll`. */
export function osDeLaPose(sq: Squelette, pose: PoseTigre, sortie: MondeOs = creerMonde(sq)): MondeOs {
  return fk(sq, pose, sortie);
}

/** Ragdolls encore simulés (éveillés) parmi `ragdolls` (les cadavres sans ragdoll, `null`, ne comptent pas). */
export function ragdollsEveilles(ragdolls: readonly (Ragdoll | null)[]): number {
  let n = 0;
  for (const r of ragdolls) if (r && !r.endormi()) n++;
  return n;
}

/**
 * Plafond des ragdolls simulés : un nouveau mort reçoit un ragdoll tant que moins de `max` sont éveillés ; sinon il joue la mort rigide de
 * la v7. On ne fige JAMAIS un ragdoll déjà lancé : figé avant d'avoir touché le sol (morts simultanées d'une nuke, d'une grenade), il
 * resterait debout comme une statue, ou suspendu en l'air, jusqu'à s'enfoncer.
 */
export function ragdollPermis(ragdolls: readonly (Ragdoll | null)[], max: number = RAGDOLL.actifsMax): boolean {
  return ragdollsEveilles(ragdolls) < max;
}
