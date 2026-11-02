/**
 * Replay de fin de match d'arène (PUR, ni three ni DOM, sans horloge) : pendant le match le client garde, sous un plafond de mémoire, une
 * fenêtre de quelques secondes autour de chaque élimination ; à la fin il choisit les plus beaux moments (multi-kills, tirs de loin, coups
 * d'arme blanche, séries, dernier kill) et les rejoue avec une caméra cinématique, le classement restant visible (`FinDeMatch`).
 *
 * Aucun message nouveau : tout vient des snaps, des tirs / coups / dégâts horodatés (`vue-joueur.ts`) et du message `mort` (déjà envoyé à tous,
 * avec la distance et l'arme du tueur). Coût pendant le match : un snap sur deux est gardé par référence dans un anneau glissant de
 * `anneauMs` (aucune copie), une fenêtre n'est copiée dans un clip qu'à une mort, et le tout est borné (`clipsMax`, `octetsMax`).
 *
 * Étapes : `EnregistreurReplay` (anneau → clips notés, éviction du moins bon) → `choisirMoments` (notation, exclusion des doublons, ordre
 * chronologique) → `titreMoment` (libellés) ; `CameraCinemato` calcule la pose de la caméra à chaque image. Le lecteur est `jeu-replay-fin.ts`.
 */
import { nomArme } from "./armes";
import type { ArmeId, CauseMort, EtatJoueurSnap, VehiculeSnap, Vec3, Zone } from "./protocole";
import { estMelee } from "./protocole";
import type { EvenementVue } from "./vue-joueur";
import { anglesVers } from "./vue";

export const REPLAY_FIN = {
  /** fenêtre rejouée avant / après l'instant de la mort (ms) */
  avantMs: 4000,
  apresMs: 1200,
  /** écart minimal entre deux snaps gardés (≈ 11 Hz au lieu des 20 Hz du serveur) */
  echantillonMs: 90,
  /** profondeur de l'anneau glissant (ms) : plus que `avantMs`, pour que les fenêtres encore ouvertes ne perdent rien */
  anneauMs: 6500,
  /** événements gardés dans l'anneau (tirs, coups, dégâts) : borne dure, une rafale de 16 joueurs en met moins de 400 sur 6,5 s */
  evenementsMax: 700,
  /** clips gardés en mémoire en même temps, et plafond de leur taille estimée */
  clipsMax: 10,
  octetsMax: 6 * 1024 * 1024,
  /** moments rejoués au plus, notes minimales au-delà des deux premiers, écart minimal entre deux moments choisis (ms) */
  momentsMax: 4,
  seuilMin: 14,
  exclusionMs: 5500,
  /** deux kills du même tueur à moins de cet écart forment une série (multi-kill) */
  chaineMs: 2500,
  /** nombre minimal de snaps pour qu'un clip se rejoue */
  snapsMin: 6,
  /** attente maximale (ms) des fenêtres encore ouvertes à la fin du match */
  attenteMaxMs: 1800,
} as const;

/** Taille estimée d'un joueur / d'un véhicule dans un snap gardé (objet, tableaux de position et de vitesse) : ordre de grandeur, pour le plafond. */
const OCTETS_JOUEUR = 240;
const OCTETS_VEHICULE = 90;
const OCTETS_EVENEMENT = 160;
const OCTETS_SNAP = 64;

/** Instantané gardé : joueurs et voitures tels que le serveur les a envoyés (références, jamais modifiés). */
export interface SnapReplay { ts: number; j: readonly EtatJoueurSnap[]; v?: readonly VehiculeSnap[] }

/** Mort d'un joueur, telle qu'elle est utile au replay (extraite du message `mort`). */
export interface MarqueMort {
  ts: number;
  tueur: string;
  cible: string;
  arme: ArmeId;
  cause: CauseMort;
  zone: Zone;
  /** distance tueur → victime (m) */
  distance: number;
}

export interface Clip {
  marque: MarqueMort;
  /** kills de suite du tueur dans la fenêtre, celui-ci compris (1 = isolé) */
  multi: number;
  /** série du tueur (kills depuis sa dernière mort), celui-ci compris */
  serie: number;
  /** dernier kill du match (posé à la fin) */
  final: boolean;
  debut: number;
  fin: number;
  snaps: SnapReplay[];
  evenements: EvenementVue[];
  score: number;
  octets: number;
}

/** Causes d'une mort qui est un kill de joueur à joueur (les autres n'ont pas de tueur à suivre). */
const CAUSES_KILL: readonly CauseMort[] = ["arme", "ecrase_vehicule", "explosion", "frappe_aerienne", "tigre", "grenade", "titan"];

/** Mort replayable : un tueur, qui n'est pas la victime, une cause qui lui est imputable. */
export function estKillReplay(m: { cible: string; par: string; cause: CauseMort }): boolean {
  return m.par !== "" && m.par !== m.cible && CAUSES_KILL.includes(m.cause);
}

/** Note d'un moment : plus elle est haute, plus il mérite d'être rejoué. Pur, sans l'effet « dernier kill » (posé à la fin). */
export function noteMoment(c: Pick<Clip, "marque" | "multi" | "serie">): number {
  const m = c.marque;
  let n = 10;
  if (m.cause === "arme" && estMelee(m.arme)) n += m.arme === "epee" ? 30 : 26;
  if (m.cause === "arme" && m.zone === "tete") n += 8;
  // tir de loin : rien sous 40 m, puis 0,4 point par mètre, plafonné à 30 (≈ 115 m)
  if (m.cause === "arme" && !estMelee(m.arme)) n += Math.min(30, Math.max(0, (m.distance - 40) * 0.4));
  if (m.cause === "ecrase_vehicule") n += 14;
  if (m.cause === "explosion" || m.cause === "grenade" || m.cause === "frappe_aerienne" || m.cause === "tigre" || m.cause === "titan") n += 10;
  n += Math.max(0, c.multi - 1) * 30;
  // série : rien avant 4 kills de suite, puis 3 points par kill, plafonné
  n += Math.min(20, Math.max(0, c.serie - 3) * 3);
  return n;
}

/** Bonus du dernier kill du match (le plus décisif : celui qui clôt la partie). */
export const BONUS_DERNIER_KILL = 18;

/** Estimation de la taille d'un clip (octets), pour le plafond de mémoire. */
export function octetsClip(snaps: readonly SnapReplay[], evenements: readonly EvenementVue[]): number {
  let n = 0;
  for (const s of snaps) n += OCTETS_SNAP + s.j.length * OCTETS_JOUEUR + (s.v?.length ?? 0) * OCTETS_VEHICULE;
  return n + evenements.length * OCTETS_EVENEMENT;
}

/** Mort en attente de son « après » : la marque, la série dans la fenêtre et la série du tueur. */
interface Ouverte { marque: MarqueMort; multi: number; serie: number }

/**
 * Enregistreur du match (anneau glissant + clips). `alimenter` à chaque snap, `evenement` à chaque tir / coup / dégât, `surMort` à chaque
 * mort ; `terminer` à la fin du match pour clore les fenêtres encore ouvertes ; `vider` au nouveau match.
 */
export class EnregistreurReplay {
  private anneau: SnapReplay[] = [];
  private evts: EvenementVue[] = [];
  private attente: Ouverte[] = [];
  private clips: Clip[] = [];
  /** kills récents par tueur (instants), pour les séries */
  private recents = new Map<string, number[]>();
  /** série en cours par joueur (kills depuis sa dernière mort) */
  private series = new Map<string, number>();

  /** Un snap de plus : gardé s'il est assez loin du précédent, puis les fenêtres dont l'« après » est écoulé deviennent des clips. */
  alimenter(ts: number, joueurs: readonly EtatJoueurSnap[], vehicules?: readonly VehiculeSnap[]): void {
    if (!Number.isFinite(ts)) return;
    const dernier = this.anneau[this.anneau.length - 1];
    if (dernier && ts < dernier.ts) return; // jamais en arrière : un paquet en retard ne se range pas
    if (!dernier || ts - dernier.ts >= REPLAY_FIN.echantillonMs) {
      this.anneau.push({ ts, j: joueurs, ...(vehicules && vehicules.length ? { v: vehicules } : {}) });
      const limite = ts - REPLAY_FIN.anneauMs;
      let n = 0;
      while (n < this.anneau.length - 1 && this.anneau[n].ts < limite) n++;
      if (n) this.anneau.splice(0, n);
    }
    this.clore(ts);
  }

  /** Tir, coup, dégât : gardé dans l'anneau des événements (les morts passent par `surMort`). */
  evenement(e: EvenementVue): void {
    if (e.genre === "mort" || !Number.isFinite(e.ts)) return;
    let i = this.evts.length;
    while (i > 0 && this.evts[i - 1].ts > e.ts) i--;
    this.evts.splice(i, 0, e);
    const plus = this.evts[this.evts.length - 1].ts;
    const limite = plus - REPLAY_FIN.anneauMs;
    let n = 0;
    while (n < this.evts.length && this.evts[n].ts < limite) n++;
    const trop = this.evts.length - n - REPLAY_FIN.evenementsMax;
    if (trop > 0) n += trop;
    if (n) this.evts.splice(0, n);
  }

  /** Une mort : compte les séries, ouvre une fenêtre si c'est un kill replayable. `distance` : celle du message, sinon calculée aux snaps. */
  surMort(m: { cible: string; par: string; arme: ArmeId; cause: CauseMort; zone: Zone; ts: number; distance?: number }): void {
    if (!Number.isFinite(m.ts)) return;
    this.series.delete(m.cible);
    if (!estKillReplay(m)) return;
    const serie = (this.series.get(m.par) ?? 0) + 1;
    this.series.set(m.par, serie);
    const liste = this.recents.get(m.par) ?? [];
    liste.push(m.ts);
    this.recents.set(m.par, liste.filter((t) => t >= m.ts - REPLAY_FIN.avantMs));
    // série dans la fenêtre : kills consécutifs du tueur espacés de `chaineMs` au plus, en remontant depuis celui-ci (calculée maintenant :
    // les kills suivants du même tueur purgeraient les précédents de `recents` avant la clôture de la fenêtre)
    let multi = 1;
    for (let i = liste.length - 1; i > 0 && liste[i] - liste[i - 1] <= REPLAY_FIN.chaineMs; i--) multi++;
    const distance = m.distance ?? this.distanceAuxSnaps(m.par, m.cible, m.ts);
    const marque: MarqueMort = { ts: m.ts, tueur: m.par, cible: m.cible, arme: m.arme, cause: m.cause, zone: m.zone, distance };
    this.attente.push({ marque, multi, serie });
  }

  /** Quelque chose à montrer ou à clore (un clip gardé, ou une fenêtre encore ouverte). */
  aDuContenu(): boolean {
    return this.clips.length + this.attente.length > 0;
  }

  /** Fenêtres encore ouvertes (leur « après » n'a pas fini d'arriver). */
  enAttente(): number {
    return this.attente.length;
  }

  /** Fin du match : les fenêtres encore ouvertes se closent avec ce qu'on a. */
  terminer(): void {
    const dernier = this.anneau[this.anneau.length - 1];
    this.clore(dernier ? dernier.ts + REPLAY_FIN.apresMs + 1 : Infinity, true);
  }

  vider(): void {
    this.anneau = [];
    this.evts = [];
    this.attente = [];
    this.clips = [];
    this.recents.clear();
    this.series.clear();
  }

  /** Clips gardés (le dernier kill est marqué `final`) : à passer à `choisirMoments`. */
  lesClips(): Clip[] {
    const dernier = this.clips.reduce<Clip | null>((a, c) => (!a || c.marque.ts > a.marque.ts ? c : a), null);
    return this.clips.map((c) => (c === dernier ? { ...c, final: true, score: c.score + BONUS_DERNIER_KILL } : c));
  }

  /** Snaps dans l'anneau glissant (borné par `anneauMs` / `echantillonMs`). */
  tailleAnneau(): number {
    return this.anneau.length;
  }

  /** Taille estimée de ce qui est gardé (anneau exclu : ce sont des références déjà tenues par le réseau, bornées à `anneauMs`). */
  octets(): number {
    return this.clips.reduce((n, c) => n + c.octets, 0);
  }

  private distanceAuxSnaps(a: string, b: string, ts: number): number {
    let s: SnapReplay | null = null;
    for (const x of this.anneau) if (!s || Math.abs(x.ts - ts) < Math.abs(s.ts - ts)) s = x;
    const pa = s?.j.find((e) => e.id === a)?.p, pb = s?.j.find((e) => e.id === b)?.p;
    return pa && pb ? Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) : 0;
  }

  /** Transforme en clips les marques dont la fenêtre est close à `ts` (ou toutes, `tout`). */
  private clore(ts: number, tout = false): void {
    if (!this.attente.length) return;
    const restantes: Ouverte[] = [];
    for (const o of this.attente) {
      if (!tout && ts < o.marque.ts + REPLAY_FIN.apresMs) { restantes.push(o); continue; }
      this.ajouterClip(o);
    }
    this.attente = restantes;
  }

  private ajouterClip({ marque, multi, serie }: Ouverte): void {
    const debut = marque.ts - REPLAY_FIN.avantMs, fin = marque.ts + REPLAY_FIN.apresMs;
    const snaps = this.anneau.filter((s) => s.ts >= debut && s.ts <= fin);
    if (snaps.length < REPLAY_FIN.snapsMin) return;
    const evenements = this.evts.filter((e) => e.ts >= debut && e.ts <= fin);
    const base = { marque, multi, serie };
    const clip: Clip = { ...base, final: false, debut, fin, snaps, evenements, score: noteMoment(base), octets: octetsClip(snaps, evenements) };
    this.clips.push(clip);
    this.evincer();
  }

  /** Respecte `clipsMax` et `octetsMax` : le moins bon part, jamais le plus récent (le dernier kill compte toujours). */
  private evincer(): void {
    for (;;) {
      const trop = this.clips.length > REPLAY_FIN.clipsMax || this.octets() > REPLAY_FIN.octetsMax;
      if (!trop || this.clips.length <= 1) return;
      const recent = this.clips.reduce((a, c) => (c.marque.ts > a.marque.ts ? c : a));
      let pire: Clip | null = null;
      for (const c of this.clips) if (c !== recent && (!pire || c.score < pire.score || (c.score === pire.score && c.marque.ts < pire.marque.ts))) pire = c;
      if (!pire) return;
      this.clips.splice(this.clips.indexOf(pire), 1);
    }
  }
}

/**
 * Les moments à rejouer : par note décroissante, sans deux moments à moins de `exclusionMs` l'un de l'autre (la série d'un multi-kill n'est
 * montrée qu'une fois, par son kill final), jamais plus de `momentsMax`, les notes faibles écartées au-delà des deux premiers ; le dernier
 * kill du match est toujours gardé. Rendu dans l'ordre chronologique : le dernier kill clôt le replay.
 */
export function choisirMoments(clips: readonly Clip[], max: number = REPLAY_FIN.momentsMax): Clip[] {
  const tries = [...clips].sort((a, b) => b.score - a.score || b.marque.ts - a.marque.ts);
  const choisis: Clip[] = [];
  const libre = (c: Clip) => choisis.every((x) => Math.abs(x.marque.ts - c.marque.ts) >= REPLAY_FIN.exclusionMs);
  const final = clips.find((c) => c.final);
  if (final) choisis.push(final);
  for (const c of tries) {
    if (choisis.length >= max) break;
    if (choisis.includes(c) || !libre(c)) continue;
    if (choisis.length >= 2 && c.score < REPLAY_FIN.seuilMin) continue;
    choisis.push(c);
  }
  return choisis.sort((a, b) => a.marque.ts - b.marque.ts);
}

/** Marge gardée avant le match suivant (ms) : le replay ne doit pas courir jusqu'à la dernière image de l'entracte. */
export const MARGE_FIN_ENTRACTE_MS = 1500;

/**
 * Réduit les moments à ce qui tient dans `budgetMs` (temps réel restant avant le match suivant). Le dernier kill du match est toujours gardé ;
 * les autres partent du moins noté au plus noté jusqu'à tenir. Ordre chronologique conservé. Budget inconnu ou infini : rien ne change.
 */
export function tenirDansLeTemps(moments: readonly Clip[], budgetMs: number | null | undefined): Clip[] {
  if (budgetMs == null || !Number.isFinite(budgetMs)) return [...moments];
  const duree = (c: Clip) => c.fin - c.debut;
  const gardes = [...moments];
  let total = gardes.reduce((n, c) => n + duree(c), 0);
  const ordreRetrait = [...gardes].filter((c) => !c.final).sort((a, b) => a.score - b.score || a.marque.ts - b.marque.ts);
  for (const c of ordreRetrait) {
    if (total <= budgetMs) break;
    gardes.splice(gardes.indexOf(c), 1);
    total -= duree(c);
  }
  return gardes;
}

const NOMS_SERIE = ["", "", "Double kill", "Triple kill", "Quadruple kill"];

/** Titre et détail d'un moment (`pseudo` : id → pseudo). Le titre suit la meilleure raison de rejouer ce moment. */
export function titreMoment(c: Pick<Clip, "marque" | "multi" | "serie" | "final">, pseudo: (id: string) => string): { titre: string; detail: string } {
  const m = c.marque;
  const tueur = pseudo(m.tueur), cible = pseudo(m.cible);
  const arme = m.cause === "arme" ? nomArme(m.arme) : "";
  const metres = Math.round(m.distance);
  let libelle: string;
  if (c.multi >= 2) libelle = c.multi < NOMS_SERIE.length ? NOMS_SERIE[c.multi] : `Multi-kill ×${c.multi}`;
  else if (m.cause === "arme" && m.arme === "epee") libelle = "Coup d'épée";
  else if (m.cause === "arme" && m.arme === "couteau") libelle = "Kill au couteau";
  else if (m.cause === "arme" && m.distance >= 70) libelle = `Tir à ${metres} m`;
  else if (m.cause === "arme" && m.zone === "tete" && m.arme === "sniper") libelle = "Headshot au sniper";
  else if (m.cause === "ecrase_vehicule") libelle = "Écrasé";
  else if (m.cause === "explosion" || m.cause === "frappe_aerienne") libelle = "Explosion";
  else if (m.cause === "grenade") libelle = "Grenade";
  else if (m.cause === "titan") libelle = "Titan";
  else if (m.cause === "tigre") libelle = "Tigre allié";
  else if (c.serie >= 5) libelle = `Série de ${c.serie}`;
  else if (c.final) libelle = "Dernier kill du match";
  else libelle = "Élimination";
  const parts: string[] = [`${tueur} → ${cible}`];
  if (arme) parts.push(arme);
  if (m.cause === "arme" && !estMelee(m.arme) && m.distance >= 30 && !libelle.startsWith("Tir à")) parts.push(`${metres} m`);
  if (c.final && libelle !== "Dernier kill du match") parts.push("dernier kill du match");
  return { titre: `${libelle} · ${tueur}`, detail: parts.join(" · ") };
}

// ---------- caméra cinématique ----------

export const CAMERA_REPLAY = {
  /** rayon de l'orbite : proportionnel à l'écart tueur / victime, borné (m) */
  rayonMin: 5.5,
  rayonMax: 15,
  rayonBase: 4.5,
  rayonParMetre: 0.8,
  /** vitesse de l'orbite (rad/s) : un quart de tour en 5 s */
  orbiteRadS: 0.3,
  /** au-delà de cet écart, la caméra ne suit que la victime */
  ecartMax: 45,
  /** lissage du point visé (1/s) */
  lissage: 6,
  /** hauteur de la caméra au-dessus de la cible (m) */
  hauteur: 2.4,
  /** poussée vers la victime à l'instant du kill (part du rayon retirée) */
  poussee: 0.24,
  /** poitrine d'un joueur au-dessus de ses pieds (m) */
  poitrine: 1.1,
  /** distance de la caméra à un mur quand elle est ramenée devant (m) */
  margeMur: 0.7,
} as const;

export interface PoseCamera { pos: Vec3; lacet: number; tangage: number }
export type Lancer = (o: Vec3, d: Vec3, max: number) => number;

const lisse = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Caméra cinématique d'un moment : orbite autour du point entre le tueur et la victime (seulement la victime s'ils sont éloignés ou si le tueur
 * a disparu), qui se resserre à l'instant de la mort. `commencer` fixe le sens et l'angle de départ ; `maj` renvoie la pose de l'image.
 * Dérivable en pur : même entrée, même pose ; ramenée devant un mur si `lancer` en trouve un entre le point visé et la caméra.
 */
export class CameraCinemato {
  private centre: Vec3 | null = null;
  private ecart = 0;
  private angle0 = 0;
  private sens = 1;

  /** `graine` : tire le sens de l'orbite et le côté de départ (le même moment se rejoue de la même façon). */
  commencer(graine: number, axe: number): void {
    this.centre = null;
    this.ecart = 0;
    this.sens = (Math.abs(Math.floor(graine)) & 1) === 0 ? 1 : -1;
    this.angle0 = axe + this.sens * (Math.PI / 2 - 0.35);
  }

  /**
   * `ecoule` : secondes depuis le début du clip, `tMort` : instant de la mort dans le clip (secondes), `victime` / `tueur` : pieds des deux
   * joueurs à cet instant (null si absent des snaps).
   */
  maj(dt: number, ecoule: number, tMort: number, victime: Vec3 | null, tueur: Vec3 | null, lancer?: Lancer): PoseCamera | null {
    const proche = victime && tueur && Math.hypot(victime[0] - tueur[0], victime[2] - tueur[2]) <= CAMERA_REPLAY.ecartMax;
    const a = victime ?? tueur;
    if (!a) return null;
    const cible: Vec3 = proche && victime && tueur
      ? [(victime[0] + tueur[0]) / 2, (victime[1] + tueur[1]) / 2 + CAMERA_REPLAY.poitrine, (victime[2] + tueur[2]) / 2]
      : [a[0], a[1] + CAMERA_REPLAY.poitrine, a[2]];
    const ecartVoulu = proche && victime && tueur ? Math.hypot(victime[0] - tueur[0], victime[2] - tueur[2]) : 0;
    if (!this.centre) { this.centre = [...cible] as Vec3; this.ecart = ecartVoulu; }
    else {
      const k = 1 - Math.exp(-CAMERA_REPLAY.lissage * Math.max(0, dt));
      for (let i = 0; i < 3; i++) this.centre[i] += (cible[i] - this.centre[i]) * k;
      this.ecart += (ecartVoulu - this.ecart) * k;
    }
    const c = this.centre;
    const angle = this.angle0 + this.sens * CAMERA_REPLAY.orbiteRadS * ecoule;
    // resserrement autour de la mort : de 0,8 s avant à 0,5 s après
    const pousse = lisse(tMort - 0.8, tMort + 0.1, ecoule) * (1 - lisse(tMort + 0.1, tMort + 0.9, ecoule) * 0.4);
    const rayon0 = Math.min(CAMERA_REPLAY.rayonMax, Math.max(CAMERA_REPLAY.rayonMin, CAMERA_REPLAY.rayonBase + this.ecart * CAMERA_REPLAY.rayonParMetre));
    let rayon = rayon0 * (1 - CAMERA_REPLAY.poussee * pousse);
    const dir: Vec3 = [Math.sin(angle), 0, Math.cos(angle)];
    const haut = CAMERA_REPLAY.hauteur * (1 - 0.35 * lisse(0, 6, ecoule)) + rayon * 0.12;
    if (lancer) {
      // ramenée devant le premier mur entre le point visé et la caméra (on la cherche à sa hauteur finale)
      const o: Vec3 = [c[0], c[1] + haut, c[2]];
      const d = lancer(o, dir, rayon + CAMERA_REPLAY.margeMur);
      if (Number.isFinite(d) && d < rayon + CAMERA_REPLAY.margeMur) rayon = Math.max(1.6, d - CAMERA_REPLAY.margeMur);
    }
    const pos: Vec3 = [c[0] + dir[0] * rayon, Math.max(0.7, c[1] + haut), c[2] + dir[2] * rayon];
    const { lacet, tangage } = anglesVers(c[0] - pos[0], c[1] + 0.15 - pos[1], c[2] - pos[2]);
    return { pos, lacet, tangage };
  }
}

/** Angle du segment tueur → victime (repère de la caméra : `atan2(dx, dz)`), 0 si l'un manque. */
export function axeDuel(victime: Vec3 | null, tueur: Vec3 | null): number {
  return victime && tueur ? Math.atan2(victime[0] - tueur[0], victime[2] - tueur[2]) : 0;
}
