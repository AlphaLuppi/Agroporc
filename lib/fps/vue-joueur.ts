/**
 * Voir EXACTEMENT ce qu'un autre joueur a vu (PUR, ni three ni DOM) : socle commun du rejeu de la killcam (vue du tueur) et du spectateur
 * du Battle Royale (vue du joueur suivi).
 *
 * Trois choses manquaient pour que la vue empruntée ressemble à ce que le joueur a vécu :
 *  1. les ÉVÉNEMENTS (tirs, coups d'arme blanche, dégâts, morts) étaient joués à leur réception, dans le présent, alors que la caméra est
 *     dans le passé (rejeu) ou en retard de l'interpolation (spectateur) : la balle partait avant que le joueur ait visé. Ils passent
 *     maintenant par un `JournalEvenements` horodaté à l'horloge du serveur et sont rejoués à leur instant sur la ligne de temps de la vue ;
 *  2. la VISÉE de la caméra vient des snaps (20 Hz en arène, 10 Hz en BR) interpolés : au moment d'un tir, elle peut être à plusieurs degrés
 *     de la vraie direction (un « flick »). Chaque tir porte l'œil et la direction exacts du tireur : `viseeCorrigee` recale la caméra sur eux,
 *     la correction s'efface d'un snap à l'autre ;
 *  3. le joueur voyait les AUTRES avec son propre retard (ping + interpolation, ce que la compensation de latence du serveur rattrape) :
 *     `decalageVue` les montre à cet instant-là, sinon la cible n'est pas sous le réticule au moment du tir qui la tue.
 *
 * Ligne de temps : celle des états du sujet dans les snaps (`ts` du serveur à la réception de ses états). Ses propres tirs arrivent au serveur
 * avec ses états : ils se jouent à leur `ts`. Tout le reste (tirs des autres, dégâts, morts) lui parvenait un aller-retour plus tard : à `ts + ping`.
 */
import type { ArmeFeuId, ArmeMeleeId, EtatJoueurSnap, MessageServeur, Vec3, Zone } from "./protocole";
import { oeilDe } from "./protocole";
import { anglesVers } from "./vue";

/** Pose de la caméra d'un joueur : œil (monde) et angles (lacet, tangage de la vue, recul compris). */
export interface PoseVue { pos: Vec3; lacet: number; tangage: number }

export type EvenementVue =
  | { genre: "tir"; ts: number; id: string; arme: ArmeFeuId; o: Vec3; d: Vec3[]; main?: "g"; ameliore?: true }
  | { genre: "coup"; ts: number; id: string; o: Vec3; d: Vec3; arme: ArmeMeleeId }
  | { genre: "degats"; ts: number; cible: string; par: string; degats: number; pv: number; zone: Zone; src?: Vec3; absorbe?: number }
  | { genre: "mort"; ts: number; cible: string; par: string; zone: Zone; arme: string };

export const VUE_JOUEUR = {
  /** le ping déclaré est borné : un ping aberrant décalerait le monde de plusieurs secondes */
  pingMaxMs: 300,
  /** journal des événements : un peu plus que le rejeu le plus ancien demandé */
  tamponMs: 5000,
} as const;

/** Événement du journal d'après un message du serveur (`ts` du message, sinon `tsRecu` estimé), null pour les autres messages. */
export function evenementVue(m: MessageServeur, tsRecu: number): EvenementVue | null {
  const ts = "ts" in m && typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : tsRecu;
  switch (m.t) {
    case "tir":
      return { genre: "tir", ts, id: m.id, arme: m.arme, o: m.o, d: m.d, ...(m.main ? { main: m.main } : {}), ...(m.ameliore ? { ameliore: true as const } : {}) };
    case "coup":
      return { genre: "coup", ts, id: m.id, o: m.o, d: m.d, arme: m.arme };
    case "degats":
      return {
        genre: "degats", ts, cible: m.cible, par: m.par, degats: m.degats, pv: m.pv, zone: m.zone,
        ...(m.src ? { src: m.src } : {}), ...(m.absorbe ? { absorbe: m.absorbe } : {}),
      };
    case "mort":
      return { genre: "mort", ts, cible: m.cible, par: m.par, zone: m.zone, arme: m.arme };
    default:
      return null;
  }
}

/** Retard (ms) avec lequel le joueur voyait les autres : son ping (aller-retour, borné) plus l'interpolation de son client. */
export function decalageVue(pingMs: number | undefined, interpolationMs: number): number {
  const p = Number.isFinite(pingMs) ? Math.min(VUE_JOUEUR.pingMaxMs, Math.max(0, pingMs as number)) : 0;
  return p + interpolationMs;
}

/** Instant (sur la ligne de temps du sujet) où l'événement lui est apparu : ses propres tirs et coups tout de suite, le reste un aller-retour plus tard. */
export function instantPourSujet(e: EvenementVue, sujet: string, pingMs: number): number {
  const p = Number.isFinite(pingMs) ? Math.min(VUE_JOUEUR.pingMaxMs, Math.max(0, pingMs)) : 0;
  if ((e.genre === "tir" || e.genre === "coup") && e.id === sujet) return e.ts;
  return e.ts + p;
}

/** Journal des événements horodatés (ordre du serveur), purgé au-delà de `tamponMs` derrière le plus récent. */
export class JournalEvenements {
  private evts: EvenementVue[] = [];
  constructor(private readonly tamponMs: number = VUE_JOUEUR.tamponMs) {}

  ajouter(e: EvenementVue): void {
    if (!Number.isFinite(e.ts)) return;
    let i = this.evts.length;
    while (i > 0 && this.evts[i - 1].ts > e.ts) i--;
    this.evts.splice(i, 0, e);
    const limite = this.evts[this.evts.length - 1].ts - this.tamponMs;
    let n = 0;
    while (n < this.evts.length && this.evts[n].ts < limite) n++;
    if (n) this.evts.splice(0, n);
  }

  /** Événements de `ts` dans [t0, t1] (bornes comprises), par dichotomie : appelé plusieurs fois par image. */
  entre(t0: number, t1: number): EvenementVue[] {
    const ev = this.evts;
    let lo = 0, hi = ev.length;
    while (lo < hi) {
      const mi = (lo + hi) >> 1;
      if (ev[mi].ts < t0) lo = mi + 1; else hi = mi;
    }
    const r: EvenementVue[] = [];
    for (let i = lo; i < ev.length && ev[i].ts <= t1; i++) r.push(ev[i]);
    return r;
  }

  vider(): void {
    this.evts = [];
  }

  get taille(): number {
    return this.evts.length;
  }
}

/** Pose du tir (œil et axe du premier plomb) : là où le tireur regardait EXACTEMENT quand il a tiré. */
export function poseDuTir(e: Extract<EvenementVue, { genre: "tir" }>): PoseVue | null {
  const d = e.d[0];
  if (!d || !(Math.hypot(d[0], d[1], d[2]) > 1e-6)) return null;
  const a = anglesVers(d[0], d[1], d[2]);
  return { pos: [e.o[0], e.o[1], e.o[2]], lacet: a.lacet, tangage: a.tangage };
}

/** Pose de la caméra d'un joueur d'après son état de snap (œil debout, accroupi ou assis). */
export function poseDeSnap(e: Pick<EtatJoueurSnap, "p" | "lacet" | "tangage" | "accroupi" | "vehicule">): PoseVue {
  return { pos: [e.p[0], e.p[1] + oeilDe(e), e.p[2]], lacet: e.lacet, tangage: e.tangage };
}

/** Écart d'angle ramené dans ]−π, π]. */
function ecartAngle(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

interface Ecart { t: number; pos: Vec3; lacet: number; tangage: number }

/**
 * Pose de la caméra à `t`, recalée sur les tirs : à l'instant de chaque tir, la caméra est EXACTEMENT sur l'œil et l'axe du tir ; entre deux
 * tirs rapprochés (moins de 2 × `largeurMs`) l'écart se fond de l'un à l'autre ; ailleurs il s'efface en `largeurMs` (l'écart entre deux snaps),
 * pour retomber sur les snaps. `base(ts)` : la pose interpolée des snaps (null : sujet absent). `tirs` : poses des tirs du sujet, triées.
 */
export function viseeCorrigee(base: (ts: number) => PoseVue | null, tirs: readonly { ts: number; pose: PoseVue }[], t: number, largeurMs: number): PoseVue | null {
  const b = base(t);
  if (!b) return null;
  if (tirs.length === 0 || !(largeurMs > 0)) return b;
  let k = -1;
  for (let i = 0; i < tirs.length; i++) if (tirs[i].ts <= t) k = i; else break;
  const ecartDe = (i: number): Ecart | null => {
    const x = tirs[i];
    const bi = x.ts === t ? b : base(x.ts);
    if (!bi) return null;
    return {
      t: x.ts,
      pos: [x.pose.pos[0] - bi.pos[0], x.pose.pos[1] - bi.pos[1], x.pose.pos[2] - bi.pos[2]],
      lacet: ecartAngle(x.pose.lacet, bi.lacet),
      tangage: x.pose.tangage - bi.tangage,
    };
  };
  const avant = k >= 0 && t - tirs[k].ts < 2 * largeurMs ? ecartDe(k) : null;
  const apres = k + 1 < tirs.length && tirs[k + 1].ts - t < 2 * largeurMs ? ecartDe(k + 1) : null;
  let poids: { e: Ecart; w: number }[];
  if (avant && apres && apres.t - avant.t <= 2 * largeurMs) {
    const u = apres.t > avant.t ? (t - avant.t) / (apres.t - avant.t) : 0;
    poids = [{ e: avant, w: 1 - u }, { e: apres, w: u }];
  } else {
    poids = [];
    if (avant) poids.push({ e: avant, w: Math.max(0, 1 - (t - avant.t) / largeurMs) });
    if (apres) poids.push({ e: apres, w: Math.max(0, 1 - (apres.t - t) / largeurMs) });
  }
  const r: PoseVue = { pos: [b.pos[0], b.pos[1], b.pos[2]], lacet: b.lacet, tangage: b.tangage };
  for (const { e, w } of poids) {
    if (w <= 0) continue;
    r.pos[0] += e.pos[0] * w; r.pos[1] += e.pos[1] * w; r.pos[2] += e.pos[2] * w;
    r.lacet += e.lacet * w;
    r.tangage += e.tangage * w;
  }
  return r;
}

/**
 * Échantillonneur d'états de joueurs (un `Interpolateur`, tampon long ou tampon courant). `voisins` (facultatif) : les états d'un joueur dans
 * les snaps qui encadrent un instant, pour la caméra cubique.
 */
export interface SourceEtats {
  echantillon(ts: number): Map<string, EtatJoueurSnap>;
  voisins?(ts: number, id: string): { ts: number; e: EtatJoueurSnap }[];
}

/**
 * Cache d'échantillons d'UNE image (comme le « frame snapshot » des moteurs de FPS) : la caméra, l'état du sujet et les autres joueurs
 * demandent souvent le même instant ; chaque `echantillon` (une Map de tous les joueurs, 50 en BR) n'est calculé qu'une fois. `vider()` à
 * chaque image. Les Maps rendues sont partagées : ne pas les modifier.
 */
export class EchantillonsImage implements SourceEtats {
  private readonly cache = new Map<number, Map<string, EtatJoueurSnap>>();
  constructor(private readonly source: SourceEtats) {}
  echantillon(ts: number): Map<string, EtatJoueurSnap> {
    let r = this.cache.get(ts);
    if (!r) { r = this.source.echantillon(ts); this.cache.set(ts, r); }
    return r;
  }
  voisins(ts: number, id: string): { ts: number; e: EtatJoueurSnap }[] {
    return this.source.voisins?.(ts, id) ?? [];
  }
  vider(): void {
    this.cache.clear();
  }
}

/** Au-delà de cet écart entre deux snaps (m), c'est une téléportation : pas de courbe, la pose linéaire de l'échantillon. */
const SAUT_COURBE_M = 12;

const h00 = (s: number) => 2 * s * s * s - 3 * s * s + 1;
const h10 = (s: number) => s * s * s - 2 * s * s + s;
const h01 = (s: number) => -2 * s * s * s + 3 * s * s;
const h11 = (s: number) => s * s * s - s * s;

/**
 * Pose de la caméra d'un joueur à `t` par interpolation CUBIQUE (Hermite) entre les snaps qui l'encadrent, au lieu de la ligne brisée de
 * l'interpolation linéaire : à 10 ou 20 snaps par seconde, la visée d'un joueur qu'on regarde par ses yeux change de direction à chaque snap
 * (saccades visibles, surtout en BR). La courbe passe EXACTEMENT par chaque snap, sans retard ajouté. Position : tangentes = vitesses du snap
 * (la vraie physique du joueur) ; angles : tangentes de Catmull-Rom (lacet déroulé par le plus court chemin). Null si la courbe n'est pas
 * possible (pas de snaps qui encadrent `t`, téléportation, joueur mort) : l'appelant garde la pose linéaire.
 */
export function poseCubique(voisins: readonly { ts: number; e: EtatJoueurSnap }[], t: number): PoseVue | null {
  let k = -1;
  for (let i = 0; i + 1 < voisins.length; i++) if (voisins[i].ts <= t && t < voisins[i + 1].ts) { k = i; break; }
  if (k < 0) return null;
  const a = voisins[k], b = voisins[k + 1];
  const p0 = voisins[k - 1] ?? a, p3 = voisins[k + 2] ?? b;
  const ea = a.e, eb = b.e;
  if (!ea.vivant || !eb.vivant) return null;
  if (Math.hypot(eb.p[0] - ea.p[0], eb.p[1] - ea.p[1], eb.p[2] - ea.p[2]) > SAUT_COURBE_M) return null;
  const dtMs = b.ts - a.ts;
  if (!(dtMs > 0)) return null;
  const s = (t - a.ts) / dtMs;
  const dt = dtMs / 1000;
  // œil : l'accroupi est discret, il suit le snap le plus proche (comme `echantillon`)
  const oeil = oeilDe(s < 0.5 ? ea : eb);
  const pos: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    pos[i] = h00(s) * ea.p[i] + h10(s) * ea.v[i] * dt + h01(s) * eb.p[i] + h11(s) * eb.v[i] * dt;
  }
  pos[1] += oeil;
  // la courbe des positions ne doit jamais s'écarter du segment de plus de ce que la vitesse permet (rebond, choc mal daté)
  const lin: Vec3 = [ea.p[0] + (eb.p[0] - ea.p[0]) * s, ea.p[1] + (eb.p[1] - ea.p[1]) * s + oeil, ea.p[2] + (eb.p[2] - ea.p[2]) * s];
  if (Math.hypot(pos[0] - lin[0], pos[1] - lin[1], pos[2] - lin[2]) > 1) { pos[0] = lin[0]; pos[1] = lin[1]; pos[2] = lin[2]; }
  // angles : Catmull-Rom à pas non uniformes, lacet déroulé autour de celui de `a`
  const l1 = ea.lacet;
  const l2 = l1 + ecartAngle(eb.lacet, l1);
  const l0 = l1 + ecartAngle(p0.e.lacet, l1);
  const l3 = l2 + ecartAngle(p3.e.lacet, l2);
  const pente = (x0: number, x1: number, t0: number, t1: number) => (t1 > t0 ? ((x1 - x0) / (t1 - t0)) * dtMs : 0);
  const mL1 = p0 === a ? l2 - l1 : pente(l0, l2, p0.ts, b.ts);
  const mL2 = p3 === b ? l2 - l1 : pente(l1, l3, a.ts, p3.ts);
  const mT1 = p0 === a ? eb.tangage - ea.tangage : pente(p0.e.tangage, eb.tangage, p0.ts, b.ts);
  const mT2 = p3 === b ? eb.tangage - ea.tangage : pente(ea.tangage, p3.e.tangage, a.ts, p3.ts);
  const lacet = h00(s) * l1 + h10(s) * mL1 + h01(s) * l2 + h11(s) * mL2;
  const tangage = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, h00(s) * ea.tangage + h10(s) * mT1 + h01(s) * eb.tangage + h11(s) * mT2));
  return { pos, lacet, tangage };
}

/**
 * La vue d'un sujet sur une source d'états et un journal : caméra recalée, autres joueurs à l'instant où il les voyait, événements à jouer.
 * Le curseur des événements avance avec `aJouer` ; `repartir` le replace (changement de sujet, début d'un rejeu).
 */
export class VueJoueur {
  /** début de la vue (aucun événement plus ancien n'est joué) et instant jusqu'où les événements ont été joués */
  private debut = -Infinity;
  private curseur = -Infinity;
  private dejaJoues = new Set<EvenementVue>();

  /** `largeurMs` : écart entre deux snaps (50 ms en arène, 100 ms en BR). */
  constructor(private readonly largeurMs: number) {}

  /** Caméra du sujet à `t` (horloge du serveur), recalée sur ses tirs du journal ; null s'il est absent de la source. */
  camera(source: SourceEtats, journal: JournalEvenements, sujet: string, t: number): PoseVue | null {
    const tirs: { ts: number; pose: PoseVue }[] = [];
    for (const e of journal.entre(t - 2 * this.largeurMs, t + 2 * this.largeurMs)) {
      if (e.genre !== "tir" || e.id !== sujet) continue;
      const pose = poseDuTir(e);
      if (pose) tirs.push({ ts: e.ts, pose });
    }
    return viseeCorrigee((ts) => {
      // courbe cubique entre les snaps (fluide), sinon la pose linéaire de l'échantillon (extrapolation, téléportation)
      const c = source.voisins ? poseCubique(source.voisins(ts, sujet), ts) : null;
      if (c) return c;
      const s = source.echantillon(ts).get(sujet);
      return s ? poseDeSnap(s) : null;
    }, tirs, t, this.largeurMs);
  }

  /** Les autres joueurs tels que le sujet les voyait à `t` (`decalageMs` plus tôt), sans le sujet. Map neuve (la source n'est pas touchée). */
  autres(source: SourceEtats, sujet: string, t: number, decalageMs: number): Map<string, EtatJoueurSnap> {
    const m = new Map(source.echantillon(t - decalageMs));
    m.delete(sujet);
    return m;
  }

  /** La vue commence à `t` : seuls les événements apparus au sujet APRÈS `t` seront joués. */
  repartir(t: number): void {
    this.debut = t;
    this.curseur = t;
    this.dejaJoues.clear();
  }

  /**
   * Événements apparus au sujet depuis l'appel précédent jusqu'à `t` inclus, une seule fois chacun, dans l'ordre où il les a vus. Un
   * événement arrivé en retard dans le journal (son message a mis un aller-retour) est rattrapé tant qu'il a moins de `rattrapageMs` de retard.
   */
  aJouer(journal: JournalEvenements, sujet: string, pingMs: number, t: number, rattrapageMs = 400): EvenementVue[] {
    if (!Number.isFinite(t)) return [];
    if (this.debut === -Infinity) { this.debut = t; this.curseur = t; }
    const bas = Math.max(this.debut, this.curseur - rattrapageMs);
    const r: { e: EvenementVue; at: number }[] = [];
    for (const e of journal.entre(bas - VUE_JOUEUR.pingMaxMs, t)) {
      if (this.dejaJoues.has(e)) continue;
      const at = instantPourSujet(e, sujet, pingMs);
      if (at <= bas || at > t) continue;
      r.push({ e, at });
    }
    r.sort((a, b) => a.at - b.at);
    for (const x of r) this.dejaJoues.add(x.e);
    this.curseur = Math.max(this.curseur, t);
    // ce qui est sorti de la fenêtre de rattrapage ne reviendra plus : la mémoire reste bornée
    const plancher = Math.max(this.debut, this.curseur - rattrapageMs);
    for (const e of this.dejaJoues) if (instantPourSujet(e, sujet, pingMs) <= plancher) this.dejaJoues.delete(e);
    return r.map((x) => x.e);
  }
}
