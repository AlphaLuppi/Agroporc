/**
 * Thème Tigre : le lasso. Un lasso est posé en bas de la page ; pris en main, le cowboy (sous le
 * bas de l'écran) fait tournoyer la boucle au-dessus de sa tête ; un clic la lance vers le point
 * visé. Si elle retombe sur le tigre, le nœud coulant se serre autour de son cou : il a le seum,
 * il est hissé et pend au bout de la corde sous le pointeur, on le balance partout (il rebondit
 * sur les bords) ; lâché, il retombe au sol, se dégage et file.
 *
 * Logique pure, en px d'écran (x à droite, y vers le bas, z vers nous), pour être testée :
 * - la corde : chaîne de particules (Verlet, pas fixe, contraintes de distance itérées, masses :
 *   le tigre au bout est lourd), sol, épingles (la main, le nœud) ;
 * - la boucle : un anneau (centre, normale, rayon, rotation) piloté à la main : tournoiement, vol
 *   balistique, serrage ;
 * - le tigre lâché : vol libre avec rebonds et retour au sol.
 * Le rendu (tube three.js) est dans lib/tigre-lasso-rendu.ts, les états dans app/components/LassoTigre.tsx.
 */

export interface Vec { x: number; y: number }
export interface V3 { x: number; y: number; z: number }

/** Pesanteur (px/s²) : plus forte que la vraie à cette échelle, sinon tout flotte. */
export const GRAVITE = 2600;
/** Durée du vol de la boucle jusqu'au point visé (s) : il faut anticiper la course du tigre. */
export const DUREE_LANCER_S = 0.5;
/** Rayon de la boucle qui tournoie (px), et une fois au sol, desserrée. */
export const RAYON_TOURNOIE = 78;
export const RAYON_ARRIVEE = 40;
/** Tours par seconde de la boucle au-dessus de la tête. */
export const TOURS_S = 1.25;
/** Marge autour de la zone du tigre où la boucle l'attrape encore (px). */
export const RAYON_BOUCLE_PX = 26;
/** Part de la vitesse gardée à chaque rebond du tigre lâché. */
export const RESTITUTION = 0.55;
/** Vitesse de lancer plafonnée (px/s) : un geste brusque ne le téléporte pas. */
export const VITESSE_MAX = 4200;
/** Au sol depuis ce temps (s), à l'arrêt et à l'endroit : il se relève et file. */
export const AU_SOL_S = 0.45;
/** Pas de la simulation (s) : fixe, quel que soit le rythme des images. */
export const PAS_S = 1 / 120;

const OMEGA_MAX = 14;
const REBOND_MIN = 260;
const FROTTEMENT_SOL = 7;

/* ───────────── Vecteurs ───────────── */

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const plus = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const fois = (a: V3, k: number): V3 => v3(a.x * k, a.y * k, a.z * k);
const moins = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const distance = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const unitaire = (a: V3): V3 => { const n = Math.hypot(a.x, a.y, a.z) || 1; return fois(a, 1 / n); };
const vectoriel = (a: V3, b: V3): V3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const melange = (a: V3, b: V3, k: number): V3 => plus(a, fois(moins(b, a), k));

/* ───────────── Corde (Verlet) ───────────── */

export interface Corde {
  p: V3[];
  prec: V3[];
  /** Inverse des masses (0 = épinglée ; le tigre au bout : petite). */
  inv: number[];
  /** Longueur de repos d'un segment (px). */
  repos: number;
  /** Temps pas encore simulé (s), reporté à l'image suivante. */
  reste: number;
}

export interface ConsignesCorde {
  /** Particules tenues (index → position imposée) : la main, le nœud sur la boucle ou sur le cou. */
  epingles: ReadonlyArray<readonly [number, V3]>;
  /** Hauteur du sol (px) : la corde s'y pose et y frotte. */
  sol: number;
  /** Longueur maximale entre la première et la dernière particule (corde tendue par un poids lourd). */
  tendue?: number;
  /** Freinage de l'air sur la dernière particule (1/s) : le tigre qui se débat ne balance pas sans fin. */
  freinFin?: number;
  /**
   * Corde élastique portant un poids (le bout) : au-delà de `longueur` (px), le bout est rappelé vers
   * la première particule (la main) par un ressort de raideur `k` (1/s²) amorti par `amorti` (1/s),
   * le long de la corde seulement : il rebondit au bout comme à un élastique, et balance librement
   * de côté. Les brins, eux, ne font que dessiner la corde entre la main et le poids.
   */
  elastique?: { longueur: number; k: number; amorti: number };
}

/** Corde de `n` particules en ligne droite de `a` à `b`. */
export function creerCorde(n: number, a: V3, b: V3, repos?: number): Corde {
  const p = Array.from({ length: n }, (_, i) => melange(a, b, i / (n - 1)));
  return { p, prec: p.map((q) => ({ ...q })), inv: p.map(() => 1), repos: repos ?? distance(a, b) / (n - 1), reste: 0 };
}

/** Longueur de la corde au repos (px). */
export const longueurRepos = (c: Corde) => c.repos * (c.p.length - 1);

/**
 * Avance la corde de `dt` (pas fixes de PAS_S) : inertie amortie, pesanteur, puis contraintes de
 * longueur itérées (pondérées par les masses : le tigre lourd tire la corde, pas l'inverse), sol,
 * épingles. Rend la vitesse (px/s) de la dernière particule sur le dernier pas.
 */
export function majCorde(c: Corde, dt: number, k: ConsignesCorde): V3 {
  c.reste = Math.min(c.reste + Math.max(0, dt), 0.1);
  const n = c.p.length;
  let vFin = v3();
  const epingle = new Map<number, V3>(k.epingles.map(([i, p]) => [i, p]));
  const gardeFin = Math.exp(-(k.freinFin ?? 0) * PAS_S);
  const el = k.elastique;
  while (c.reste >= PAS_S) {
    c.reste -= PAS_S;
    if (el) {
      // Ressort radial main → poids, puis les brins se répartissent entre les deux (à peine mous).
      const a = c.p[0], b = c.p[n - 1], q = c.prec[n - 1];
      const d = distance(a, b) || 1e-6;
      const allonge = d - el.longueur;
      if (allonge > 0) {
        const u = fois(moins(a, b), 1 / d);
        const vr = ((b.x - q.x) * u.x + (b.y - q.y) * u.y + (b.z - q.z) * u.z) / PAS_S;
        // Rappel vers la main, freiné quand le poids y revient déjà (vr > 0) ; jamais au-delà de 1,8 fois.
        const acc = (el.k * allonge - el.amorti * vr) * PAS_S * PAS_S + Math.max(0, d - 1.8 * el.longueur);
        c.p[n - 1] = plus(b, fois(u, acc));
      }
      c.repos = Math.max(2, (Math.max(d, el.longueur * 0.6) * 1.02) / (n - 1));
    }
    for (let i = 0; i < n; i++) {
      const p = c.p[i], q = c.prec[i];
      const garde = i === n - 1 ? 0.996 * gardeFin : 0.996;
      const vx = (p.x - q.x) * garde, vy = (p.y - q.y) * garde, vz = (p.z - q.z) * garde;
      c.prec[i] = { ...p };
      c.p[i] = v3(p.x + vx, p.y + vy + GRAVITE * PAS_S * PAS_S, p.z + vz);
    }
    // Élastique : le poids n'est mené que par le ressort, les brins le suivent comme s'il était épinglé.
    if (el) epingle.set(n - 1, { ...c.p[n - 1] });
    for (let it = 0; it < 24; it++) {
      for (const [i, pos] of epingle) c.p[i] = { ...pos };
      for (let i = 0; i < n - 1; i++) {
        const a = c.p[i], b = c.p[i + 1];
        const wa = epingle.has(i) ? 0 : c.inv[i], wb = epingle.has(i + 1) ? 0 : c.inv[i + 1];
        const w = wa + wb;
        if (w === 0) continue;
        const d = distance(a, b) || 1e-6;
        const corr = (d - c.repos) / d / w;
        const dx = (b.x - a.x) * corr, dy = (b.y - a.y) * corr, dz = (b.z - a.z) * corr;
        c.p[i] = v3(a.x + dx * wa, a.y + dy * wa, a.z + dz * wa);
        c.p[i + 1] = v3(b.x - dx * wb, b.y - dy * wb, b.z - dz * wb);
      }
      // Attache longue portée : un poids lourd au bout ne détend pas la corde comme un élastique.
      if (k.tendue != null) {
        const a = c.p[0], b = c.p[n - 1];
        const d = distance(a, b);
        if (d > k.tendue && !epingle.has(n - 1)) c.p[n - 1] = plus(a, fois(moins(b, a), k.tendue / d));
      }
      for (let i = 0; i < n; i++) {
        if (c.p[i].y > k.sol) {
          // Posée au sol : elle y frotte.
          const q = c.prec[i];
          c.p[i] = v3(q.x + (c.p[i].x - q.x) * 0.6, k.sol, q.z + (c.p[i].z - q.z) * 0.6);
        }
      }
    }
    for (const [i, pos] of epingle) c.p[i] = { ...pos };
    vFin = fois(moins(c.p[n - 1], c.prec[n - 1]), 1 / PAS_S);
  }
  return vFin;
}

/* ───────────── Boucle (nœud coulant) ───────────── */

export interface Anneau {
  c: V3;
  /** Normale au plan de la boucle (unitaire). */
  n: V3;
  r: number;
  /** Angle de rotation dans son plan (rad) : où se trouve le nœud. */
  tour: number;
}

/** Deux axes du plan de la boucle. */
function repere(n: V3): [V3, V3] {
  const ref = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const u = unitaire(vectoriel(ref, n));
  return [u, vectoriel(n, u)];
}

/** Le nœud (là où la corde rejoint la boucle). */
export function noeud(a: Anneau): V3 {
  const [u, w] = repere(a.n);
  return plus(a.c, plus(fois(u, a.r * Math.cos(a.tour)), fois(w, a.r * Math.sin(a.tour))));
}

/**
 * Points de la boucle, du nœud jusqu'au nœud (chemin ouvert : la corde traverse l'œillet du nœud,
 * fait le tour et revient s'y nouer). Pas un cercle parfait : un peu en goutte vers le nœud, une
 * ondulation qui court le long de la corde (`temps`), et le côté opposé au nœud qui s'affaisse sous
 * son poids. Le premier et le dernier point sont exactement sur le nœud.
 */
export function pointsAnneau(a: Anneau, m = 40, temps = 0): V3[] {
  const [u, w] = repere(a.n);
  const pts: V3[] = [];
  for (let i = 0; i <= m; i++) {
    const t = (i / m) * Math.PI * 2;
    const loin = (1 - Math.cos(t)) / 2;
    const rho = a.r * (1 - 0.1 * loin + 0.04 * Math.sin(3 * t + 7 * temps) * Math.sin(t / 2));
    const ang = a.tour + t;
    const p = plus(a.c, plus(fois(u, rho * Math.cos(ang)), fois(w, rho * Math.sin(ang))));
    // Affaissement : le côté loin du nœud pend un peu (y vers le bas).
    pts.push(v3(p.x, p.y + 0.12 * a.r * loin * loin, p.z));
  }
  return pts;
}

/** Sens de la corde à la sortie du nœud, le long de la boucle (pour orienter l'œillet). */
export function tangenteNoeud(a: Anneau): V3 {
  const [u, w] = repere(a.n);
  return unitaire(plus(fois(u, -Math.sin(a.tour)), fois(w, Math.cos(a.tour))));
}

/**
 * La boucle qui tournoie, comme un cowboy avant de lancer : la main (sous le bas de l'écran) tient
 * la corde et la boucle par le BORD, pas par le centre : le poignet fait tourner la boucle à plat
 * au-dessus de la tête, excentrée autour de la main, le nœud (honda) juste à côté du poignet, la
 * pointe qui balaie loin devant. Le plan penche un peu vers l'avant (on la voit en ellipse).
 */
export function tournoyer(main: V3, t: number, r = RAYON_TOURNOIE): Anneau {
  // Rotation un peu irrégulière (le poignet relance la boucle à chaque tour).
  const tour = 2 * Math.PI * TOURS_S * t + 0.25 * Math.sin(2 * Math.PI * TOURS_S * t);
  const poignet = v3(main.x + 6 * Math.cos(tour), main.y - 110 - 5 * Math.sin(tour), main.z);
  const n = unitaire(v3(0.1 * Math.sin(tour), 1, 0.75));
  const [u, w] = repere(n);
  const dir = plus(fois(u, Math.cos(tour)), fois(w, Math.sin(tour)));
  // Le centre est à 0,8 r du poignet : le nœud (à l'opposé de la pointe) reste près de la main.
  return { c: plus(poignet, fois(dir, 0.8 * r)), n, r, tour: tour + Math.PI };
}

/** Vitesse initiale pour qu'un projectile parti de `a` arrive en `b` au bout de `t` s (pesanteur en y). */
export function vitesseBalistique(a: V3, b: V3, t: number): V3 {
  return v3((b.x - a.x) / t, (b.y - a.y) / t - 0.5 * GRAVITE * t, (b.z - a.z) / t);
}

export function balistique(a: V3, v: V3, t: number): V3 {
  return v3(a.x + v.x * t, a.y + v.y * t + 0.5 * GRAVITE * t * t, a.z + v.z * t);
}

/**
 * La boucle lancée, `t` s après le lâcher : elle part à plat en tournant encore, s'ouvre en vol
 * (centrifuge), pointe devant, et arrive un peu AU-DESSUS de la cible pour retomber dessus.
 */
export function boucleLancee(depart: Anneau, cible: V3, vitesse: V3, t: number): Anneau {
  const u = Math.min(1, Math.max(0, t / DUREE_LANCER_S));
  return {
    c: balistique(depart.c, vitesse, Math.min(t, DUREE_LANCER_S)),
    // Elle reste à plat, inclinée vers l'avant de sa course.
    n: unitaire(v3(-0.25 * Math.sign(vitesse.x) * u, 1, 0.62 - 0.2 * u)),
    r: depart.r * (1 + 0.22 * Math.sin(Math.PI * 0.5 * u)),
    // Elle tourne encore, de moins en moins vite.
    tour: depart.tour + 2 * Math.PI * TOURS_S * (t - 0.35 * t * u),
  };
}

/** Durée du serrage (s) : la boucle tombe autour du cou, le cowboy reprend le mou, elle se ferme. */
export const DUREE_SERRE_S = 0.34;

/**
 * Serrage, `u` ∈ [0, 1] : la boucle arrivée au-dessus de la tête tombe autour du cou (son plan
 * pivote jusqu'à être perpendiculaire au cou, axe `axe`), puis se ferme sur lui (rayon `rCou`,
 * surtout à la fin : c'est le mou repris d'un coup sec), nœud ramené sur la nuque (en haut).
 */
export function boucleSerree(arrivee: Anneau, cou: V3, axe: V3, rCou: number, u: number): Anneau {
  const k = Math.min(1, Math.max(0, u));
  const tombe = k * k * (3 - 2 * k);
  const ferme = k * k * k;
  const nuque = -Math.PI / 2;
  let ecart = nuque - arrivee.tour;
  ecart = Math.atan2(Math.sin(ecart), Math.cos(ecart));
  return {
    c: melange(arrivee.c, cou, tombe),
    n: unitaire(melange(arrivee.n, axe, tombe)),
    r: arrivee.r + (rCou - arrivee.r) * ferme,
    tour: arrivee.tour + ecart * tombe,
  };
}

/** La boucle arrivée en `p` attrape-t-elle le tigre de zone `zone` (rectangle, mêmes px) ? */
export function touche(p: Vec, zone: { x: number; y: number; w: number; h: number }, rayon = RAYON_BOUCLE_PX): boolean {
  const dx = Math.max(zone.x - p.x, 0, p.x - (zone.x + zone.w));
  const dy = Math.max(zone.y - p.y, 0, p.y - (zone.y + zone.h));
  return dx * dx + dy * dy <= rayon * rayon;
}

/* ───────────── Le tigre pendu, puis lâché ───────────── */

export function plafonner(v: Vec, max: number): Vec {
  const n = Math.hypot(v.x, v.y);
  return n > max ? { x: (v.x / n) * max, y: (v.y / n) * max } : v;
}

/** Angle ramené dans ]-π, π]. */
export function normaliser(a: number): number {
  const t = Math.PI * 2;
  let r = ((a % t) + t) % t;
  if (r > Math.PI) r -= t;
  return r;
}

/** Rotation d'un vecteur (sens horaire à l'écran, comme `rotate()` en CSS). */
export function tourner(v: Vec, a: number): Vec {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * Angle (rad, sens horaire à l'écran) à donner au tigre pendu par le cou : son corps (vecteur cou →
 * centre `d`, au repos) prolonge la corde (`amont` → cou). Corde molle : il pend sous le cou.
 */
export function angleSuspendu(amont: Vec, cou: Vec, d: Vec): number {
  let ux = cou.x - amont.x, uy = cou.y - amont.y;
  if (Math.hypot(ux, uy) < 2) { ux = 0; uy = 1; }
  return normaliser(Math.atan2(uy, ux) - Math.atan2(d.y, d.x));
}

/** Corps pendu : angle à l'écran (rad, sens horaire) et vitesse de rotation (rad/s). */
export interface Balancier { angle: number; omega: number }

/**
 * Pendule pesant : un corps rigide pendu à un point d'attache qui bouge (le bout de la corde).
 * `d` = attache → centre de gravité au repos (px), `k` = rayon de giration autour du centre de
 * gravité (px), `aPivot` = accélération de l'attache (px/s²). Le couple de la pesanteur, et des
 * secousses de l'attache (force d'inertie −m·a), fait tourner le corps autour de l'attache :
 *   θ'' = (r × (g − a)) / (|r|² + k²) − amorti·θ'
 * Au repos, le centre de gravité finit sous l'attache ; une secousse le fait balancer.
 */
export function majBalancier(b: Balancier, d: Vec, k: number, aPivot: Vec, dt: number, amorti = 0.7): Balancier {
  let { angle, omega } = b;
  let reste = Math.max(0, Math.min(dt, 0.1));
  const i = d.x * d.x + d.y * d.y + k * k;
  while (reste > 1e-9) {
    const h = Math.min(reste, 1 / 240);
    reste -= h;
    const r = tourner(d, angle);
    const fx = -aPivot.x, fy = GRAVITE - aPivot.y;
    const alpha = (r.x * fy - r.y * fx) / i - amorti * omega;
    omega += alpha * h;
    angle += omega * h;
  }
  return { angle, omega };
}

/** Le tigre lâché : centre du corps, vitesse, angle et rotation propre. */
export interface Vol {
  c: Vec;
  v: Vec;
  angle: number;
  omega: number;
  /** Temps passé posé au sol, à l'arrêt (s). */
  auSol: number;
}

/** Bords où il rebondit (px) : `sol` = hauteur du centre du corps quand il est debout. */
export interface Bornes { gauche: number; droite: number; haut: number; sol: number }

/**
 * Une image de vol libre : pesanteur, rebonds amortis sur les bords et le plafond, puis au sol il
 * glisse, se remet à l'endroit et s'arrête ; `pose` quand il est resté assez longtemps immobile.
 */
export function majVol(e: Vol, b: Bornes, rayon: number, dt: number): { vol: Vol; pose: boolean } {
  if (dt <= 0) return { vol: e, pose: false };
  const v = { ...e.v };
  const c = { x: e.c.x + v.x * dt, y: e.c.y + v.y * dt };
  let omega = e.omega, angle = e.angle;
  v.y += GRAVITE * dt;

  if (c.x < b.gauche + rayon) { c.x = b.gauche + rayon; v.x = Math.abs(v.x) * RESTITUTION; omega = -omega * 0.6; }
  if (c.x > b.droite - rayon) { c.x = b.droite - rayon; v.x = -Math.abs(v.x) * RESTITUTION; omega = -omega * 0.6; }
  if (c.y < b.haut + rayon) { c.y = b.haut + rayon; v.y = Math.abs(v.y) * RESTITUTION; }

  let auSol = 0;
  if (c.y >= b.sol) {
    c.y = b.sol;
    if (v.y > REBOND_MIN) {
      v.y = -v.y * RESTITUTION;
      v.x *= 0.8;
      // Le choc au sol relance la toupie dans le sens où il roule.
      omega = omega * 0.5 + (v.x / Math.max(rayon, 1)) * 0.3;
    } else {
      // Posé : il glisse en freinant et se remet à l'endroit (ressort amorti sur l'angle).
      v.y = 0;
      v.x *= Math.exp(-FROTTEMENT_SOL * dt);
      angle = normaliser(angle);
      omega += (-90 * angle - 16 * omega) * dt;
      auSol = Math.abs(v.x) < 40 && Math.abs(angle) < 0.08 ? e.auSol + dt : 0;
    }
  }
  omega = Math.max(-OMEGA_MAX, Math.min(OMEGA_MAX, omega));
  angle += omega * dt;
  return { vol: { c, v, angle, omega, auSol }, pose: auSol >= AU_SOL_S };
}
