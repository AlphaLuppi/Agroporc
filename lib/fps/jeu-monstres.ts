/**
 * Monstres côté client (PUR, testé) : tampon des `snap.monstres` interpolé à l'instant du rendu, événement en cours (bandeau),
 * lasers annoncés du tigre, titan en cours et contrôleur du pilote (simulation locale, message `pilotage`).
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import type { Monde } from "./collision";
import { enrouler, pasTitan, type EntreesTitan, type EtatMarcheur } from "./monstres";
import type { MessageClient, MessageServeur, MonstresSnap, TigreSnap, TitanSnap, TruckSnap, TypeEvenement, Vec3 } from "./protocole";

/** Profondeur (ms) du tampon des snaps de monstres. */
const TAMPON_MS = 1_500;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpV = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const lerpAngle = (a: number, b: number, k: number) => a + enrouler(b - a) * k;

function interpoler<T extends { p: Vec3; cap: number; v: number }>(a: T | undefined, b: T | undefined, k: number): T | undefined {
  if (!a || !b) return b ?? (k < 0.5 ? a : undefined);
  return { ...b, p: lerpV(a.p, b.p, k), cap: lerpAngle(a.cap, b.cap, k), v: lerp(a.v, b.v, k) };
}

export interface EvenementEnCours {
  type: TypeEvenement;
  phase: "annonce" | "actif";
  debutT: number;
  finT: number;
}

/** Laser (rayon des yeux + disque d'impact) ou onde de choc (`onde` : disque seul, plus grand). */
export interface LaserAnnonce { de: Vec3; vers: Vec3; rayon: number; tirT: number; onde?: boolean }

export interface TitanEnCours { pilote: string; finT: number }

/** (2026-10-30) Descente de police en cours (message `police`) : `cible` = id du joueur poursuivi au départ. */
export interface PoliceEnCours { debutT: number; finT: number; cible?: string }

export class MondeMonstres {
  private snaps: { ts: number; m: MonstresSnap | null }[] = [];
  private ev: EvenementEnCours | null = null;
  private lasersEnAttente: LaserAnnonce[] = [];
  private ti: TitanEnCours | null = null;
  private po: PoliceEnCours | null = null;

  /** Un snap reçu (`monstres` absent = aucun monstre). */
  alimenter(ts: number, m: MonstresSnap | undefined): void {
    this.snaps.push({ ts, m: m ?? null });
    while (this.snaps.length > 2 && ts - this.snaps[0].ts > TAMPON_MS) this.snaps.shift();
  }

  /** Monstres interpolés à l'instant serveur `ts` (en général maintenant − retard d'interpolation). */
  a(ts: number): MonstresSnap {
    const s = this.snaps;
    if (!s.length) return {};
    if (ts <= s[0].ts) return { ...(s[0].m ?? {}) };
    for (let i = 1; i < s.length; i++) {
      if (ts > s[i].ts) continue;
      const A = s[i - 1], B = s[i];
      const k = (ts - A.ts) / Math.max(1, B.ts - A.ts);
      const r: MonstresSnap = {};
      const truck = interpoler(A.m?.truck, B.m?.truck, k);
      const tigre = interpoler(A.m?.tigre, B.m?.tigre, k);
      const titan = interpoler(A.m?.titan, B.m?.titan, k);
      const bus = interpoler(A.m?.bus, B.m?.bus, k);
      const police = interpoler(A.m?.police, B.m?.police, k);
      if (truck) r.truck = truck;
      if (police) r.police = police;
      if (tigre) r.tigre = tigre;
      if (titan) r.titan = titan;
      if (bus) r.bus = bus;
      if (B.m?.armesLachees) r.armesLachees = B.m.armesLachees;
      if (B.m?.fumigenes) r.fumigenes = B.m.fumigenes;
      if (B.m?.frappes) r.frappes = B.m.frappes;
      return r;
    }
    return { ...(s[s.length - 1].m ?? {}) };
  }

  /** Message `evenement` : annonce, début (ou synchro), fin. */
  majEvenement(m: Extract<MessageServeur, { t: "evenement" }>): void {
    if (m.phase === "fin") {
      if (this.ev?.type === m.type) this.ev = null;
      if (m.type === "tigre") this.lasersEnAttente = [];
      return;
    }
    this.ev = { type: m.type, phase: m.phase === "annonce" ? "annonce" : "actif", debutT: m.debutT, finT: m.finT };
  }
  evenement(): EvenementEnCours | null {
    return this.ev;
  }

  ajouterLaser(m: Extract<MessageServeur, { t: "laser" }>): void {
    this.lasersEnAttente.push({ de: m.de, vers: m.vers, rayon: m.rayon, tirT: m.tirT });
  }
  ajouterOnde(m: Extract<MessageServeur, { t: "onde" }>): void {
    this.lasersEnAttente.push({ de: m.p, vers: m.p, rayon: m.rayon, tirT: m.tirT, onde: true });
  }
  /** Lasers dont l'impact n'est pas passé depuis plus de `apresMs` (l'éclair de l'impact se dessine encore un instant). */
  lasers(ts: number, apresMs = 250): LaserAnnonce[] {
    this.lasersEnAttente = this.lasersEnAttente.filter((l) => ts - l.tirT <= apresMs);
    return this.lasersEnAttente;
  }

  majTitan(m: Extract<MessageServeur, { t: "titan" }>): void {
    this.ti = m.phase === "fin" ? null : { pilote: m.pilote, finT: m.finT };
  }
  titan(): TitanEnCours | null {
    return this.ti;
  }

  /**
   * Message `police` (2026-10-30) : `debut` ou `etat` (arrivant) mémorise la descente, `fin` l'efface. La sirène et le dessin ne dépendent PAS de ce
   * message mais de la présence de `monstres.police` dans le snap : un message perdu ne laisse ni voiture muette ni sirène fantôme.
   */
  majPolice(m: Extract<MessageServeur, { t: "police" }>): void {
    this.po = m.phase === "fin" ? null : { debutT: m.debutT, finT: m.finT, ...(m.cible ? { cible: m.cible } : {}) };
  }
  police(): PoliceEnCours | null {
    return this.po;
  }

  reinitialiser(): void {
    this.snaps = [];
    this.ev = null;
    this.lasersEnAttente = [];
    this.ti = null;
    this.po = null;
  }
}

/** Le pilote simule son titan en local (comme le conducteur sa voiture) et envoie `pilotage` ; le serveur borne. */
export class ControleurTitan {
  private e: EtatMarcheur | null = null;
  private seq = 0;

  actif(): boolean {
    return this.e !== null;
  }
  entrer(p: Vec3, cap: number): void {
    this.e = { p: [p[0], p[1], p[2]], cap, v: 0, vy: 0, auSol: p[1] <= 0.01 };
    this.seq = 0;
  }
  sortir(): void {
    this.e = null;
  }
  etat(): EtatMarcheur | null {
    return this.e ? { ...this.e, p: [this.e.p[0], this.e.p[1], this.e.p[2]] } : null;
  }
  /** Pas découpé à 1/60 s, plafonné à 0,1 s (onglet ralenti). */
  maj(dt: number, en: EntreesTitan, monde: Monde): void {
    if (!this.e || !(dt > 0)) return;
    let reste = Math.min(dt, 0.1);
    // dash et saut sont des impulsions : seulement au premier sous-pas
    let impulsions: EntreesTitan = en;
    while (reste > 1e-9) {
      const h = Math.min(reste, 1 / 60);
      this.e = pasTitan(this.e, impulsions, h, monde);
      impulsions = { avant: en.avant, droite: en.droite, lacet: en.lacet };
      reste -= h;
    }
  }
  message(lacet: number, tangage: number): Extract<MessageClient, { t: "pilotage" }> | null {
    if (!this.e) return null;
    const r = (x: number) => Math.round(x * 100) / 100 + 0;
    return { t: "pilotage", seq: ++this.seq, p: [r(this.e.p[0]), r(this.e.p[1]), r(this.e.p[2])], cap: Math.round(this.e.cap * 1000) / 1000 + 0, lacet, tangage };
  }
}
