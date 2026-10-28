/**
 * Grenades et projectiles balistiques (PUR, sans three ni DOM ni hasard ; partagé par le client et le serveur).
 *
 * Un lancer part de l'œil du joueur avec une vitesse connue ; sa trajectoire est intégrée à pas fixe (1/60 s) dans le `Monde` de collision :
 * gravité, rebonds sur les murs des prismes, leurs toits et le sol (restitution `rebond` sur la normale, `frottement` sur la tangente),
 * roulement freiné au sol, faux plafond facultatif (`plafond`), arrêt sous `vitesseArret`. Les mêmes entrées (monde, o, v) donnent la même
 * trajectoire au client et au serveur : le serveur la calcule UNE fois au lancer et diffuse `grenade{o, v, t0, explosionT}`, le client la
 * recalcule et la dessine sans saccade (`positionTrajectoire`). Les projectiles « à percussion » (`percussion`) s'arrêtent et explosent au
 * premier contact (base des armes à projectile d'un autre lot : obus, boulons ; `arret` leur permet de s'arrêter sur une cible mobile).
 *
 * Explosion : rayon, dégâts dégressifs du centre au bord (`degatsGrenade`), bloqués par les murs (`souffleAtteint` : ligne de vue du centre
 * à la cible). Inventaire de Black Ops 1 : 2 grenades à fragmentation au début de chaque manche, 4 au plus (`grenadesDebutManche`), le
 * « tigre à remontoir » (la Monkey Bomb) par 3 depuis la boîte mystère. Validation d'un lancer par le serveur : `validerLancer`.
 * Valeurs de BO1 : `award_grenades_for_survivors` (_zombiemode.gsc), `frag_grenade_zm` (fuseTime 3,5 s, explosionRadius 256 u. ≈ 6,5 m,
 * dégâts 600 au centre, 150 au bord). Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (complément « grenades », lot zr/grenades).
 */
import { dedans } from "../agroparc3d/cachettes";
import { lancerRayon, normaleImpact, visible, type Monde } from "./collision";
import type { GenreGrenade, Vec3 } from "./protocole";

/** Profil balistique et explosif d'un genre de grenade. */
export interface ProfilGrenade {
  /** vitesse de lancer le long de la visée (m/s) et coup de pouce vers le haut (m/s) */
  vitesse: number;
  bonusHaut: number;
  /** m/s² */
  gravite: number;
  /** restitution sur la normale (0 : colle, 1 : rebond parfait) et part de la vitesse tangentielle gardée à chaque choc */
  rebond: number;
  frottement: number;
  /** décélération du roulement au sol (m/s²) */
  roulement: number;
  /** rayon de l'objet (m) : il ne rentre pas dans les murs */
  rayonObjet: number;
  /** sous cette vitesse au sol, l'objet s'arrête (m/s) */
  vitesseArret: number;
  /** mèche (ms) depuis le lancer ; pour le remontoir : durée de l'attraction APRÈS l'arrêt au sol */
  mecheMs: number;
  /** la mèche part dès que la goupille est tirée : maintenir la touche « cuit » la grenade (BO1) */
  cuisson: boolean;
  /** explose au premier contact (projectile à percussion) */
  percussion: boolean;
  /** rayon du souffle (m), dégâts au centre et au bord */
  rayonM: number;
  degatsCentre: number;
  degatsBord: number;
  /** dégâts maximum au lanceur pris dans son propre souffle (jamais aux coéquipiers) */
  degatsLanceurMax: number;
  /** attire les tigres dans ce rayon (m) une fois posé, 0 = n'attire pas */
  attractionM: number;
  /** durée de vol simulée au plus (ms) pour un objet qui n'explose qu'une fois posé */
  volMaxMs: number;
}

export const GRENADES: Readonly<Record<GenreGrenade, Readonly<ProfilGrenade>>> = {
  // grenade à fragmentation de BO1 : mèche 3,5 s, 256 u. de rayon (≈ 6,5 m), 600 au centre (un coup jusqu'à la manche 5), 150 au bord
  frag: {
    vitesse: 19, bonusHaut: 3, gravite: 18, rebond: 0.38, frottement: 0.72, roulement: 7, rayonObjet: 0.08, vitesseArret: 0.4,
    mecheMs: 3_500, cuisson: true, percussion: false, rayonM: 6.5, degatsCentre: 600, degatsBord: 150, degatsLanceurMax: 45,
    attractionM: 0, volMaxMs: 3_500,
  },
  // « tigre à remontoir » : la Monkey Bomb de BO1 en peluche mécanique. Lancé moins fort, il roule peu, joue des cymbales 8 s en attirant
  // tous les tigres à 40 m (BO1 : point d'intérêt de 1 536 u.), puis saute avec eux
  remontoir: {
    vitesse: 14, bonusHaut: 3.5, gravite: 18, rebond: 0.25, frottement: 0.55, roulement: 10, rayonObjet: 0.15, vitesseArret: 0.5,
    mecheMs: 8_000, cuisson: false, percussion: false, rayonM: 6.5, degatsCentre: 1_200, degatsBord: 400, degatsLanceurMax: 45,
    attractionM: 40, volMaxMs: 4_000,
  },
};

export const GENRES_GRENADE: readonly GenreGrenade[] = ["frag", "remontoir"];
/** Noms affichés (HUD, invites). */
export const NOMS_GRENADES: Readonly<Record<GenreGrenade, string>> = { frag: "Grenade", remontoir: "Tigre à remontoir" };
/** Ce que la boîte mystère offre à la place d'une arme. */
export const NOM_REMONTOIRS = "Tigres à remontoir ×3";
export const estGenreGrenade = (g: unknown): g is GenreGrenade => g === "frag" || g === "remontoir";

/** Inventaire (BO1) : grenades par manche et maximum, remontoirs reçus de la boîte (et maximum). */
export const INVENTAIRE_GRENADES = { fragParManche: 2, fragMax: 4, remontoirBoite: 3, remontoirMax: 3 } as const;
/** Intervalle minimal entre deux lancers d'un même joueur (ms). */
export const INTERVALLE_LANCER_MS = 500;
/** Pas d'intégration des trajectoires (ms). */
export const PAS_TRAJECTOIRE_MS = 1000 / 60;
/** Bips de la cuisson (ms) : un bip par demi-seconde tant que la touche est maintenue. */
export const BIP_CUISSON_MS = 500;
/** Rebond audible : vitesse normale au choc au-dessus de laquelle on entend le choc (m/s). */
export const REBOND_AUDIBLE_M_S = 1.2;

/** BO1 `award_grenades_for_survivors` : au début de chaque manche, +2 grenades à fragmentation, 4 au plus (0 → 2, 1 → 3, 2 ou plus → 4). */
export function grenadesDebutManche(n: number): number {
  const actuel = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return Math.min(INVENTAIRE_GRENADES.fragMax, actuel + INVENTAIRE_GRENADES.fragParManche);
}

/** Vitesse initiale d'un lancer de genre `g` dans la direction `d` (normalisée ou non). */
export function vitesseLancer(g: GenreGrenade, d: Vec3): Vec3 {
  const p = GRENADES[g];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [(d[0] / l) * p.vitesse, (d[1] / l) * p.vitesse + p.bonusHaut, (d[2] / l) * p.vitesse];
}

/** Hauteur du plafond au-dessus de (x, z), Infinity à ciel ouvert. */
export type Plafond = (x: number, z: number) => number;

/**
 * Faux plafond des bâtiments creusés de la carte zombies : leurs prismes ont `hOrigine = 0` (ni collision ni rayon) ; un point de leur
 * emprise est sous un plafond à `hauteur`. Dans l'arène, aucun prisme n'est creusé : le plafond est partout infini.
 */
export function plafondBatimentsCreux(monde: Monde, hauteur: number): Plafond {
  const creux = monde.prismes.filter((p) => p.hOrigine === 0 && p.anneau.length >= 3);
  if (!creux.length) return () => Infinity;
  return (x, z) => {
    for (const p of creux) {
      const b = p.boite;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !dedans(x, z, p.anneau)) continue;
      if (p.trous.some((t) => dedans(x, z, t))) continue;
      return hauteur;
    }
    return Infinity;
  };
}

export interface OptionsTrajectoire {
  plafond?: Plafond;
  /**
   * Arrêt sur une cible mobile (projectiles à percussion, serveur) : fraction [0, 1] du segment a→b où il touche, null sinon. Le client ne
   * le passe pas (il ne connaît pas les tigres) : le serveur fait foi et diffuse l'explosion.
   */
  arret?: (a: Vec3, b: Vec3) => number | null;
}

/** Trajectoire échantillonnée : un point par pas de `PAS_TRAJECTOIRE_MS` depuis le lancer. */
export interface Trajectoire {
  /** x, y, z à plat, un point par pas (le premier = l'origine) */
  points: number[];
  /** instants (ms après le lancer) des chocs audibles et leur vitesse normale (m/s) */
  rebonds: { tMs: number; force: number }[];
  /** instant (ms après le lancer) où l'objet s'immobilise ou touche (percussion) ; Infinity s'il bouge encore à la fin */
  arretMs: number;
  /** percussion : a touché quelque chose (mur, sol, cible) */
  contact: boolean;
}

const EPS = 1e-3;

/**
 * Intègre la trajectoire de `o` à la vitesse `v` pendant `dureeMs` (au plus), à pas fixe. Déterministe : mêmes monde, o, v, durée → mêmes
 * points. Un pas : gravité, puis le premier obstacle sur le segment (mur ou toit par `lancerRayon`, sol y = 0, plafond) ; au contact,
 * l'objet est posé au point de contact (rayon de l'objet en retrait), sa vitesse est réfléchie (restitution sur la normale, frottement sur
 * la tangente) et le reste du pas est perdu. Au sol, un choc lent devient du roulement (vitesse verticale annulée, décélération).
 */
export function simulerTrajectoire(
  monde: Monde, genre: GenreGrenade | Readonly<ProfilGrenade>, o: Vec3, v: Vec3, dureeMs: number, opts: OptionsTrajectoire = {},
): Trajectoire {
  // un profil peut être passé directement (projectiles des armes, obus à percussion)
  const prof = typeof genre === "string" ? GRENADES[genre] : genre;
  const dt = PAS_TRAJECTOIRE_MS / 1000;
  const r = prof.rayonObjet;
  const plafond = opts.plafond;
  const p: Vec3 = [o[0], Math.max(r, o[1]), o[2]];
  const vit: Vec3 = [v[0], v[1], v[2]];
  const points: number[] = [p[0], p[1], p[2]];
  const rebonds: Trajectoire["rebonds"] = [];
  const n = Math.max(0, Math.ceil(Math.min(dureeMs, 60_000) / PAS_TRAJECTOIRE_MS));
  let arretMs = Infinity;
  let contact = false;
  let auRepos = false;
  for (let k = 1; k <= n; k++) {
    if (auRepos) { points.push(p[0], p[1], p[2]); continue; }
    vit[1] -= prof.gravite * dt;
    const dx = vit[0] * dt, dy = vit[1] * dt, dz = vit[2] * dt;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-9) { points.push(p[0], p[1], p[2]); continue; }
    const d: Vec3 = [dx / l, dy / l, dz / l];
    // premier obstacle sur le segment, mesuré au centre de l'objet : on arrête le centre `r` avant la surface
    let s = Infinity;
    let normale: Vec3 | null = null;
    const mur = lancerRayon(monde, p, d, l + r);
    if (mur < s) { s = mur; normale = null; }
    if (d[1] < 0) {
      const sSol = (p[1] - r) / -d[1];
      if (sSol >= 0 && sSol <= l && sSol < s) { s = sSol; normale = [0, 1, 0]; }
    }
    if (plafond && d[1] > 0) {
      const ex = p[0] + dx, ez = p[2] + dz;
      const h = Math.min(plafond(p[0], p[2]), plafond(ex, ez));
      if (h < Infinity) {
        const sPl = Math.max(0, (h - r - p[1]) / d[1]);
        if (sPl <= l && sPl < s) { s = sPl; normale = [0, -1, 0]; }
      }
    }
    let fraction: number | null = null;
    if (opts.arret) {
      const fin: Vec3 = [p[0] + dx, p[1] + dy, p[2] + dz];
      fraction = opts.arret(p, fin);
    }
    if (fraction !== null && fraction >= 0 && fraction <= 1 && fraction * l <= Math.min(s, l)) {
      // cible mobile touchée avant tout obstacle (percussion seulement)
      p[0] += dx * fraction; p[1] += dy * fraction; p[2] += dz * fraction;
      points.push(p[0], p[1], p[2]);
      arretMs = k * PAS_TRAJECTOIRE_MS;
      contact = true;
      break;
    }
    if (s > l) {
      p[0] += dx; p[1] += dy; p[2] += dz;
      points.push(p[0], p[1], p[2]);
      continue;
    }
    // contact. Sol et plafond : `s` mène déjà le centre à `r` de la surface ; mur ou toit : `s` mène le centre SUR la surface, le centre est
    // reposé à `r` le long de la normale
    let c: Vec3 = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
    if (!normale) {
      normale = normaleImpact(monde, c, p);
      c = [c[0] + normale[0] * r, c[1] + normale[1] * r, c[2] + normale[2] * r];
    }
    if (prof.percussion) {
      p[0] = c[0]; p[1] = c[1]; p[2] = c[2];
      points.push(p[0], p[1], p[2]);
      arretMs = k * PAS_TRAJECTOIRE_MS;
      contact = true;
      break;
    }
    const vn = vit[0] * normale[0] + vit[1] * normale[1] + vit[2] * normale[2];
    if (vn < 0) {
      const tx = vit[0] - vn * normale[0], ty = vit[1] - vn * normale[1], tz = vit[2] - vn * normale[2];
      const sol = normale[1] > 0.7;
      // choc lent au sol (ou sur un toit) : roulement, sans micro-rebonds
      const nouvelleVn = sol && -vn < 1.5 ? 0 : -vn * prof.rebond;
      const garde = sol && nouvelleVn === 0 ? 1 : prof.frottement;
      vit[0] = tx * garde + nouvelleVn * normale[0];
      vit[1] = ty * garde + nouvelleVn * normale[1];
      vit[2] = tz * garde + nouvelleVn * normale[2];
      if (-vn >= REBOND_AUDIBLE_M_S) rebonds.push({ tMs: k * PAS_TRAJECTOIRE_MS, force: -vn });
      if (sol && nouvelleVn === 0) {
        // roulement : la vitesse horizontale décroît de `roulement` m/s²
        const vh = Math.hypot(vit[0], vit[2]);
        const reste = Math.max(0, vh - prof.roulement * dt);
        if (vh > 1e-9) { vit[0] *= reste / vh; vit[2] *= reste / vh; }
        vit[1] = 0;
        if (reste < prof.vitesseArret) { vit[0] = 0; vit[2] = 0; auRepos = true; arretMs = k * PAS_TRAJECTOIRE_MS; }
      }
    }
    p[0] = c[0] + normale[0] * EPS; p[1] = Math.max(r, c[1] + normale[1] * EPS); p[2] = c[2] + normale[2] * EPS;
    points.push(p[0], p[1], p[2]);
  }
  return { points, rebonds, arretMs, contact };
}

/** Position (interpolée) `ms` après le lancer ; avant 0 : l'origine, après la fin : le dernier point. */
export function positionTrajectoire(tr: Trajectoire, ms: number): Vec3 {
  const nb = tr.points.length / 3;
  if (nb === 0) return [0, 0, 0];
  const f = Math.max(0, ms) / PAS_TRAJECTOIRE_MS;
  const i = Math.floor(f);
  if (i >= nb - 1) { const b = (nb - 1) * 3; return [tr.points[b], tr.points[b + 1], tr.points[b + 2]]; }
  const k = f - i, a = i * 3, b = a + 3;
  const P = tr.points;
  return [P[a] + (P[b] - P[a]) * k, P[a + 1] + (P[b + 1] - P[a + 1]) * k, P[a + 2] + (P[b + 2] - P[a + 2]) * k];
}

/**
 * Lancer complet : trajectoire et instant d'explosion (ms serveur). Grenade : `t0 + mèche − cuisson` (la mèche court depuis la goupille) ;
 * remontoir : posé (ou au bout de `volMaxMs`), il joue `mecheMs` puis saute ; percussion : au contact.
 */
export interface Lancer {
  genre: GenreGrenade;
  o: Vec3;
  v: Vec3;
  t0: number;
  explosionT: number;
  traj: Trajectoire;
  /** instant (ms serveur) où il se pose ; Infinity s'il ne se pose pas avant l'explosion */
  poseT: number;
}

export function preparerLancer(monde: Monde, genre: GenreGrenade, o: Vec3, v: Vec3, t0: number, cuissonMs = 0, opts: OptionsTrajectoire = {}): Lancer {
  const prof = GRENADES[genre];
  if (prof.attractionM > 0 || prof.percussion) {
    const traj = simulerTrajectoire(monde, genre, o, v, dureeSimulee(genre, t0, 0), opts);
    const pose = Math.min(traj.arretMs, prof.volMaxMs);
    const explosionT = prof.percussion ? t0 + pose : t0 + pose + prof.mecheMs;
    return { genre, o, v, t0, explosionT, traj, poseT: t0 + pose };
  }
  const cuisson = prof.cuisson ? Math.max(0, Math.min(prof.mecheMs, Number.isFinite(cuissonMs) ? cuissonMs : 0)) : 0;
  const explosionT = t0 + prof.mecheMs - cuisson;
  const traj = simulerTrajectoire(monde, genre, o, v, dureeSimulee(genre, t0, explosionT), opts);
  return { genre, o, v, t0, explosionT, traj, poseT: Number.isFinite(traj.arretMs) ? t0 + traj.arretMs : Infinity };
}

/**
 * Durée à simuler (ms) : le vol au plus pour un objet qui explose une fois posé ou au contact, sinon jusqu'à l'explosion. Le client appelle
 * `trajectoireDuMessage` avec ce que le serveur a diffusé : même durée, donc mêmes points.
 */
function dureeSimulee(genre: GenreGrenade, t0: number, explosionT: number): number {
  const prof = GRENADES[genre];
  return prof.attractionM > 0 || prof.percussion ? prof.volMaxMs : Math.max(0, explosionT - t0);
}

/** Trajectoire d'une grenade diffusée par le serveur (`grenade{genre, o, v, t0, explosionT}`), identique à celle du serveur. */
export function trajectoireDuMessage(
  monde: Monde, m: { genre: GenreGrenade; o: Vec3; v: Vec3; t0: number; explosionT: number }, opts: OptionsTrajectoire = {},
): Trajectoire {
  return simulerTrajectoire(monde, m.genre, m.o, m.v, dureeSimulee(m.genre, m.t0, m.explosionT), opts);
}

/** Position du lancer à l'instant serveur `t`. */
export const positionLancer = (l: Lancer, t: number): Vec3 => positionTrajectoire(l.traj, t - l.t0);

/** Dégâts du souffle à `distance` (m) du centre : linéaires de `degatsCentre` à `degatsBord`, 0 au-delà du rayon. */
export function degatsGrenade(genre: GenreGrenade, distance: number): number {
  const p = GRENADES[genre];
  if (!(distance <= p.rayonM)) return 0;
  const k = Math.max(0, distance) / p.rayonM;
  return Math.round(p.degatsCentre + (p.degatsBord - p.degatsCentre) * k);
}

/** Dégâts au lanceur pris dans son propre souffle (BO1 : limités), même décroissance. */
export function degatsLanceur(genre: GenreGrenade, distance: number): number {
  const p = GRENADES[genre];
  if (!(distance <= p.rayonM)) return 0;
  return Math.round(p.degatsLanceurMax * (1 - Math.max(0, distance) / p.rayonM));
}

/**
 * Le souffle parti de `centre` atteint-il `cible` ? Il faut une ligne de vue (les murs l'arrêtent, pas les champs passe-tigres) depuis le
 * centre relevé de 25 cm (une grenade au sol souffle par-dessus le carrelage) vers la cible ou vers un point 1 m plus haut (le dos d'un
 * tigre dépasse d'un bureau).
 */
export function souffleAtteint(monde: Monde, centre: Vec3, cible: Vec3): boolean {
  const c: Vec3 = [centre[0], centre[1] + 0.25, centre[2]];
  return visible(monde, c, cible) || visible(monde, c, [cible[0], cible[1] + 1, cible[2]]);
}

/** Raisons d'un lancer refusé par le serveur. */
export type RefusLancer = "stock" | "cadence" | "genre";

/**
 * Validation serveur d'un lancer : genre connu, stock > 0, pas plus d'un lancer toutes les `INTERVALLE_LANCER_MS`. Renvoie la cuisson
 * retenue (bornée à la mèche, nulle pour un genre qui ne cuit pas).
 */
export function validerLancer(
  genre: unknown, stock: number, dernierLancerT: number | undefined, t: number, cuissonMs: unknown,
): { ok: true; genre: GenreGrenade; cuissonMs: number } | { ok: false; raison: RefusLancer } {
  if (!estGenreGrenade(genre)) return { ok: false, raison: "genre" };
  if (!(stock > 0)) return { ok: false, raison: "stock" };
  if (dernierLancerT !== undefined && t - dernierLancerT < INTERVALLE_LANCER_MS) return { ok: false, raison: "cadence" };
  const p = GRENADES[genre];
  const c = typeof cuissonMs === "number" && Number.isFinite(cuissonMs) ? cuissonMs : 0;
  return { ok: true, genre, cuissonMs: p.cuisson ? Math.max(0, Math.min(p.mecheMs, c)) : 0 };
}

/** Explosion d'une grenade (événement serveur PUR, écouté par le service zombies et ses quêtes) : où, par qui, quel genre, quand. */
export interface ExplosionGrenade {
  id: number;
  genre: GenreGrenade;
  p: Vec3;
  par: string;
  t: number;
}
