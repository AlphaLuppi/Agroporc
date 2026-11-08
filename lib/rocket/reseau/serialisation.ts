/**
 * Rocket Muche en ligne : codec du monde et des trames (lot SALLE). PUR : ni horloge, ni hasard, ni DOM, ni `three`.
 *
 * - `extraireEtat` / `restaurerEtat` : copie profonde d'un `MondeRocket` en `EtatMondeReseau` (état caché `interne` de `match.ts` compris) et
 *   écriture de cet état DANS un monde existant. Le monde restauré poursuit exactement comme l'original (même entrées, même flux de `Rng`).
 * - `encoderEtat` / `decoderEtat` : codage binaire de l'état (doubles IEEE conservés, donc aussi ±Infinity et NaN ; petit-boutiste par `DataView`).
 *   La section est AUTONOME (`nbVoitures` et `nbPlots` en tête) : le décodeur n'a besoin d'aucun état externe.
 * - Trames : entrées (client → serveur) et instantané (serveur → client), cf. spec § 3.2. Tout décodeur rend null sur une trame malformée,
 *   tronquée, trop longue ou incohérente, sans jamais lever.
 *
 * Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md (§ 3.2, § 3.4, § 5.3). Contrat : `protocole.ts`.
 */
import { PLOTS } from "../contrat";
import type { Equipe, EntreesVoiture, EtatVoiture, MondeRocket, PhaseMatch, Vec3 } from "../contrat";
import type { InterneMatch, MondeMatch } from "../match";
import { affecter, affecterBase } from "../vec";
import { RESEAU, TRAME_ENTREES, TRAME_SNAP } from "./protocole";
import type {
  DecoderEtat, DecoderSnap, DecoderTrameEntrees, DequantifierEntrees, EncoderEtat, EncoderSnap, EncoderTrameEntrees, EntreesQuantifiees,
  EtatMondeReseau, EtatVoitureReseau, ExtraireEtat, QuantifierEntrees, RestaurerEtat, SnapRocket, TrameEntrees, TypeDeTrame,
} from "./protocole";

// ============================================================================================================================
// Quantification des entrées
// ============================================================================================================================

/** Valeur entière maximale d'un axe quantifié : réel = entier / 127. */
const Q = 127;

/** Réel quelconque (non fini → 0) vers l'entier de −127 à 127 le plus proche, arrondi symétrique, sans −0. */
function axeQuantifie(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  const a = Math.round(Math.abs(c) * Q);
  return (c < 0 ? -a : a) || 0;
}

/** `cible ← quantification de e` (aucune allocation) : utilisée par la salle pour les cerveaux de bots. */
export function quantifierEntreesDans(cible: EntreesQuantifiees, e: Readonly<EntreesVoiture>): EntreesQuantifiees {
  cible.accel = axeQuantifie(e.accel); cible.direction = axeQuantifie(e.direction); cible.tangage = axeQuantifie(e.tangage);
  cible.lacet = axeQuantifie(e.lacet); cible.roulis = axeQuantifie(e.roulis);
  cible.saut = !!e.saut; cible.boost = !!e.boost; cible.derapage = !!e.derapage;
  return cible;
}

/** `cible ← q / 127` (aucune allocation). Même résultat que `dequantifierEntrees`. */
export function dequantifierEntreesDans(cible: EntreesVoiture, q: Readonly<EntreesQuantifiees>): EntreesVoiture {
  cible.accel = q.accel / Q; cible.direction = q.direction / Q; cible.tangage = q.tangage / Q; cible.lacet = q.lacet / Q; cible.roulis = q.roulis / Q;
  cible.saut = q.saut; cible.boost = q.boost; cible.derapage = q.derapage;
  return cible;
}

export const quantifierEntrees: QuantifierEntrees = (e) =>
  quantifierEntreesDans({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false }, e);

export const dequantifierEntrees: DequantifierEntrees = (q) =>
  dequantifierEntreesDans({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false }, q);

// ============================================================================================================================
// Extraction et restauration de l'état
// ============================================================================================================================

const copieVec = (v: Readonly<Vec3>): Vec3 => [v[0], v[1], v[2]];

/** Valeurs de `interne()` de `match.ts` pour un monde qui n'en a pas encore (même forme, jamais partagée). */
function interneParDefaut(n: number): InterneMatch {
  const vide = (): number[] => new Array<number>(n).fill(-Infinity);
  return { touchePoints: vide(), toucheEvenement: vide(), dernierArret: vide(), dernierTir: vide(), chronoZeroEmis: false, graceBalleS: 0 };
}

export const extraireEtat: ExtraireEtat = (m: Readonly<MondeRocket>): EtatMondeReseau => {
  const n = m.voitures.length;
  const it = (m as MondeMatch).interne;
  const interne: InterneMatch = it && it.touchePoints.length === n
    ? {
      touchePoints: it.touchePoints.slice(), toucheEvenement: it.toucheEvenement.slice(), dernierArret: it.dernierArret.slice(),
      dernierTir: it.dernierTir.slice(), chronoZeroEmis: it.chronoZeroEmis, graceBalleS: it.graceBalleS,
    }
    : interneParDefaut(n);
  const b = m.balle;
  return {
    tick: m.tick, temps: m.temps, phase: m.phase, tempsPhase: m.tempsPhase, tempsRestant: m.tempsRestant, prolongation: m.prolongation,
    attenteSolBalle: m.attenteSolBalle, score: { bleue: m.score.bleue, orange: m.score.orange },
    dernierBut: m.dernierBut ? { ...m.dernierBut } : null, vainqueur: m.vainqueur, rngS: m.rng.s,
    voitures: m.voitures.map((v): EtatVoitureReseau => ({
      p: copieVec(v.p), v: copieVec(v.v), w: copieVec(v.w),
      base: { avant: copieVec(v.base.avant), droite: copieVec(v.base.droite), haut: copieVec(v.base.haut) },
      boost: v.boost, rouesContact: v.rouesContact, normaleSurface: v.normaleSurface ? copieVec(v.normaleSurface) : null, auSol: v.auSol,
      saut: { ...v.saut }, flip: { actif: v.flip.actif, temps: v.flip.temps, dir: [v.flip.dir[0], v.flip.dir[1]], stall: v.flip.stall, verrouTangage: v.flip.verrouTangage },
      redressement: { ...v.redressement }, supersonique: v.supersonique, boostActif: v.boostActif, boostDepuis: v.boostDepuis, derapage: v.derapage,
      demolie: v.demolie, reapparitionDans: v.reapparitionDans, figee: v.figee, dernierContactBalleTick: v.dernierContactBalleTick,
      dernierBumpTick: v.dernierBumpTick, sautPrecedent: v.sautPrecedent, stats: { ...v.stats },
    })),
    balle: {
      p: copieVec(b.p), v: copieVec(b.v), w: copieVec(b.w),
      dernierToucheur: b.dernierToucheur ? { ...b.dernierToucheur } : null,
      avantDernierToucheur: b.avantDernierToucheur ? { ...b.avantDernierToucheur } : null,
    },
    plots: m.plots.map((p) => ({ actif: p.actif, recharge: p.recharge })),
    interne,
  };
};

function restaurerVoiture(e: Readonly<EtatVoitureReseau>, v: EtatVoiture): void {
  affecter(v.p, e.p); affecter(v.v, e.v); affecter(v.w, e.w);
  affecterBase(v.base, e.base);
  v.boost = e.boost; v.rouesContact = e.rouesContact; v.auSol = e.auSol;
  if (!e.normaleSurface) v.normaleSurface = null;
  else if (v.normaleSurface) affecter(v.normaleSurface, e.normaleSurface);
  else v.normaleSurface = copieVec(e.normaleSurface);
  v.saut.aSaute = e.saut.aSaute; v.saut.temps = e.saut.temps; v.saut.tenue = e.saut.tenue; v.saut.secondUtilise = e.saut.secondUtilise;
  v.saut.tempsEnLAir = e.saut.tempsEnLAir;
  v.flip.actif = e.flip.actif; v.flip.temps = e.flip.temps; v.flip.dir[0] = e.flip.dir[0]; v.flip.dir[1] = e.flip.dir[1];
  v.flip.stall = e.flip.stall; v.flip.verrouTangage = e.flip.verrouTangage;
  v.redressement.actif = e.redressement.actif; v.redressement.temps = e.redressement.temps;
  v.supersonique = e.supersonique; v.boostActif = e.boostActif; v.boostDepuis = e.boostDepuis; v.derapage = e.derapage;
  v.demolie = e.demolie; v.reapparitionDans = e.reapparitionDans; v.figee = e.figee;
  v.dernierContactBalleTick = e.dernierContactBalleTick; v.dernierBumpTick = e.dernierBumpTick; v.sautPrecedent = e.sautPrecedent;
  const s = v.stats, t = e.stats;
  s.buts = t.buts; s.passes = t.passes; s.arrets = t.arrets; s.tirs = t.tirs; s.demolitions = t.demolitions; s.demolie = t.demolie;
  s.touches = t.touches; s.points = t.points;
}

export const restaurerEtat: RestaurerEtat = (e: Readonly<EtatMondeReseau>, vers: MondeRocket): void => {
  const n = vers.voitures.length;
  if (e.voitures.length !== n || e.plots.length !== vers.plots.length) {
    throw new Error(`restaurerEtat : état de ${e.voitures.length} voitures / ${e.plots.length} plots, monde de ${n} / ${vers.plots.length}`);
  }
  vers.tick = e.tick; vers.temps = e.temps; vers.phase = e.phase; vers.tempsPhase = e.tempsPhase; vers.tempsRestant = e.tempsRestant;
  vers.prolongation = e.prolongation; vers.attenteSolBalle = e.attenteSolBalle;
  vers.score.bleue = e.score.bleue; vers.score.orange = e.score.orange;
  vers.dernierBut = e.dernierBut ? { ...e.dernierBut } : null;
  vers.vainqueur = e.vainqueur;
  vers.rng.s = e.rngS;
  for (let i = 0; i < n; i++) restaurerVoiture(e.voitures[i], vers.voitures[i]);
  const b = vers.balle, eb = e.balle;
  affecter(b.p, eb.p); affecter(b.v, eb.v); affecter(b.w, eb.w);
  b.dernierToucheur = eb.dernierToucheur ? { ...eb.dernierToucheur } : null;
  b.avantDernierToucheur = eb.avantDernierToucheur ? { ...eb.avantDernierToucheur } : null;
  for (let k = 0; k < vers.plots.length; k++) { vers.plots[k].actif = e.plots[k].actif; vers.plots[k].recharge = e.plots[k].recharge; }
  const mm = vers as MondeMatch;
  let it = mm.interne;
  if (!it || it.touchePoints.length !== n) it = mm.interne = interneParDefaut(n);
  for (let i = 0; i < n; i++) {
    it.touchePoints[i] = e.interne.touchePoints[i]; it.toucheEvenement[i] = e.interne.toucheEvenement[i];
    it.dernierArret[i] = e.interne.dernierArret[i]; it.dernierTir[i] = e.interne.dernierTir[i];
  }
  it.chronoZeroEmis = e.interne.chronoZeroEmis; it.graceBalleS = e.interne.graceBalleS;
  // `precedent` repart de l'état restauré : aucune interpolation d'affichage parasite.
  const pr = vers.precedent;
  for (let i = 0; i < n; i++) { affecter(pr.voitures[i].p, vers.voitures[i].p); affecterBase(pr.voitures[i].base, vers.voitures[i].base); }
  affecter(pr.balle.p, b.p);
};

// ============================================================================================================================
// Écriture / lecture binaire (DataView, petit-boutiste)
// ============================================================================================================================

/**
 * Écrivain en deux passes : sans tampon (`dv` null) il ne fait que COMPTER les octets, ce qui donne la taille exacte à allouer ; avec tampon
 * il écrit. Le même code d'écriture sert aux deux passes.
 */
class Ecrivain {
  pos = 0;
  constructor(readonly dv: DataView | null) {}
  u8(x: number): void { this.dv?.setUint8(this.pos, x); this.pos += 1; }
  i8(x: number): void { this.dv?.setInt8(this.pos, x); this.pos += 1; }
  u16(x: number): void { this.dv?.setUint16(this.pos, x, true); this.pos += 2; }
  u32(x: number): void { this.dv?.setUint32(this.pos, x, true); this.pos += 4; }
  i32(x: number): void { this.dv?.setInt32(this.pos, x, true); this.pos += 4; }
  f64(x: number): void { this.dv?.setFloat64(this.pos, x, true); this.pos += 8; }
  vec(v: Readonly<Vec3>): void { this.f64(v[0]); this.f64(v[1]); this.f64(v[2]); }
}

/** Lecteur borné : toute lecture hors tampon met `ok` à faux et rend 0 (le décodeur teste `ok` à la fin, il ne lève jamais). */
class Lecteur {
  pos = 0;
  ok = true;
  private readonly dv: DataView;
  constructor(readonly octets: Uint8Array) {
    this.dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  }
  private place(n: number): boolean {
    if (!this.ok || this.pos + n > this.octets.length) { this.ok = false; return false; }
    return true;
  }
  u8(): number { if (!this.place(1)) return 0; const x = this.dv.getUint8(this.pos); this.pos += 1; return x; }
  i8(): number { if (!this.place(1)) return 0; const x = this.dv.getInt8(this.pos); this.pos += 1; return x; }
  u16(): number { if (!this.place(2)) return 0; const x = this.dv.getUint16(this.pos, true); this.pos += 2; return x; }
  u32(): number { if (!this.place(4)) return 0; const x = this.dv.getUint32(this.pos, true); this.pos += 4; return x; }
  i32(): number { if (!this.place(4)) return 0; const x = this.dv.getInt32(this.pos, true); this.pos += 4; return x; }
  f64(): number { if (!this.place(8)) return 0; const x = this.dv.getFloat64(this.pos, true); this.pos += 8; return x; }
  vec(): Vec3 { return [this.f64(), this.f64(), this.f64()]; }
  /** tout a été lu, sans reste ni dépassement */
  fini(): boolean { return this.ok && this.pos === this.octets.length; }
}

const PHASES: readonly PhaseMatch[] = ["decompte", "enJeu", "but", "fini"];
const EQUIPES: readonly Equipe[] = ["bleue", "orange"];
/** bornes de plausibilité du décodage (un monde réel a 2, 4 ou 6 voitures) */
const VOITURES_MAX = 6;

// drapeaux (u16) d'une voiture
const F_AU_SOL = 1, F_A_SAUTE = 2, F_TENUE = 4, F_SECOND = 8, F_FLIP = 16, F_STALL = 32, F_REDRESS = 64, F_SUPERSONIQUE = 128;
const F_BOOST_ACTIF = 256, F_DERAPAGE = 512, F_DEMOLIE = 1024, F_FIGEE = 2048, F_SAUT_PREC = 4096, F_NORMALE = 8192;

function ecrireVoiture(w: Ecrivain, v: Readonly<EtatVoitureReseau>, it: Readonly<InterneMatch>, i: number): void {
  const f = (v.auSol ? F_AU_SOL : 0) | (v.saut.aSaute ? F_A_SAUTE : 0) | (v.saut.tenue ? F_TENUE : 0) | (v.saut.secondUtilise ? F_SECOND : 0)
    | (v.flip.actif ? F_FLIP : 0) | (v.flip.stall ? F_STALL : 0) | (v.redressement.actif ? F_REDRESS : 0) | (v.supersonique ? F_SUPERSONIQUE : 0)
    | (v.boostActif ? F_BOOST_ACTIF : 0) | (v.derapage ? F_DERAPAGE : 0) | (v.demolie ? F_DEMOLIE : 0) | (v.figee ? F_FIGEE : 0)
    | (v.sautPrecedent ? F_SAUT_PREC : 0) | (v.normaleSurface ? F_NORMALE : 0);
  w.u16(f);
  w.u8(v.rouesContact);
  w.vec(v.p); w.vec(v.v); w.vec(v.w);
  w.vec(v.base.avant); w.vec(v.base.droite); w.vec(v.base.haut);
  w.f64(v.boost); w.f64(v.boostDepuis); w.f64(v.reapparitionDans);
  w.vec(v.normaleSurface ?? [0, 0, 0]);
  w.f64(v.saut.temps); w.f64(v.saut.tempsEnLAir);
  w.f64(v.flip.temps); w.f64(v.flip.dir[0]); w.f64(v.flip.dir[1]); w.f64(v.flip.verrouTangage);
  w.f64(v.redressement.temps);
  w.f64(v.dernierContactBalleTick); w.f64(v.dernierBumpTick);
  const s = v.stats;
  w.u32(s.buts); w.u32(s.passes); w.u32(s.arrets); w.u32(s.tirs); w.u32(s.demolitions); w.u32(s.demolie); w.u32(s.touches); w.u32(s.points);
  w.f64(it.touchePoints[i]); w.f64(it.toucheEvenement[i]); w.f64(it.dernierArret[i]); w.f64(it.dernierTir[i]);
}

function lireVoiture(r: Lecteur, it: InterneMatch): EtatVoitureReseau {
  const f = r.u16();
  const rouesContact = r.u8();
  const p = r.vec(), v = r.vec(), w = r.vec();
  const base = { avant: r.vec(), droite: r.vec(), haut: r.vec() };
  const boost = r.f64(), boostDepuis = r.f64(), reapparitionDans = r.f64();
  const normale = r.vec();
  const sautTemps = r.f64(), sautEnLAir = r.f64();
  const flipTemps = r.f64(), dir0 = r.f64(), dir1 = r.f64(), verrou = r.f64();
  const redressTemps = r.f64();
  const dernierContactBalleTick = r.f64(), dernierBumpTick = r.f64();
  const stats = { buts: r.u32(), passes: r.u32(), arrets: r.u32(), tirs: r.u32(), demolitions: r.u32(), demolie: r.u32(), touches: r.u32(), points: r.u32() };
  it.touchePoints.push(r.f64()); it.toucheEvenement.push(r.f64()); it.dernierArret.push(r.f64()); it.dernierTir.push(r.f64());
  return {
    p, v, w, base, boost, rouesContact, normaleSurface: f & F_NORMALE ? normale : null, auSol: !!(f & F_AU_SOL),
    saut: { aSaute: !!(f & F_A_SAUTE), temps: sautTemps, tenue: !!(f & F_TENUE), secondUtilise: !!(f & F_SECOND), tempsEnLAir: sautEnLAir },
    flip: { actif: !!(f & F_FLIP), temps: flipTemps, dir: [dir0, dir1], stall: !!(f & F_STALL), verrouTangage: verrou },
    redressement: { actif: !!(f & F_REDRESS), temps: redressTemps },
    supersonique: !!(f & F_SUPERSONIQUE), boostActif: !!(f & F_BOOST_ACTIF), boostDepuis, derapage: !!(f & F_DERAPAGE),
    demolie: !!(f & F_DEMOLIE), reapparitionDans, figee: !!(f & F_FIGEE), dernierContactBalleTick, dernierBumpTick,
    sautPrecedent: !!(f & F_SAUT_PREC), stats,
  };
}

const idEquipe = (e: Equipe): number => (e === "orange" ? 1 : 0);

/** Section `etat` complète (autonome). Sans validation : un état issu d'`extraireEtat` est cohérent par construction. */
function ecrireEtat(w: Ecrivain, e: Readonly<EtatMondeReseau>): void {
  const n = e.voitures.length, np = e.plots.length;
  w.u8(n); w.u8(np);
  w.u8(PHASES.indexOf(e.phase));
  const vainqueur = e.vainqueur === null ? 0 : e.vainqueur === "bleue" ? 1 : 2;
  w.u8((e.prolongation ? 1 : 0) | (e.attenteSolBalle ? 2 : 0) | (e.interne.chronoZeroEmis ? 4 : 0) | (e.dernierBut ? 8 : 0) | (vainqueur << 4));
  w.u32(e.tick); w.u32(e.rngS); w.u16(e.score.bleue); w.u16(e.score.orange);
  w.f64(e.temps); w.f64(e.tempsPhase); w.f64(e.tempsRestant); w.f64(e.interne.graceBalleS);
  const bt = e.dernierBut;
  if (bt) {
    w.u8(idEquipe(bt.equipe) | (bt.idMarqueur !== null ? 2 : 0) | (bt.idPasse !== null ? 4 : 0));
    if (bt.idMarqueur !== null) w.u8(bt.idMarqueur);
    if (bt.idPasse !== null) w.u8(bt.idPasse);
    w.f64(bt.vitesseKmh);
  }
  const b = e.balle;
  w.vec(b.p); w.vec(b.v); w.vec(b.w);
  const t1 = b.dernierToucheur, t2 = b.avantDernierToucheur;
  w.u8((t1 ? 1 | (idEquipe(t1.equipe) << 1) : 0) | (t2 ? 4 | (idEquipe(t2.equipe) << 3) : 0));
  if (t1) { w.u8(t1.idVoiture); w.f64(t1.temps); }
  if (t2) { w.u8(t2.idVoiture); w.f64(t2.temps); }
  for (let i = 0; i < n; i++) ecrireVoiture(w, e.voitures[i], e.interne, i);
  // plots : deux bitmaps (actif ; recharge différente de +0) puis un double par plot marqué
  const octetsBitmap = (np + 7) >> 3;
  for (let o = 0; o < octetsBitmap; o++) {
    let x = 0;
    for (let k = 0; k < 8 && o * 8 + k < np; k++) if (e.plots[o * 8 + k].actif) x |= 1 << k;
    w.u8(x);
  }
  for (let o = 0; o < octetsBitmap; o++) {
    let x = 0;
    for (let k = 0; k < 8 && o * 8 + k < np; k++) if (!Object.is(e.plots[o * 8 + k].recharge, 0)) x |= 1 << k;
    w.u8(x);
  }
  for (let k = 0; k < np; k++) if (!Object.is(e.plots[k].recharge, 0)) w.f64(e.plots[k].recharge);
}

function lireEtat(r: Lecteur): EtatMondeReseau | null {
  const n = r.u8(), np = r.u8();
  if (!r.ok || n < 1 || n > VOITURES_MAX || np !== PLOTS.length) return null;
  const phase = PHASES[r.u8()];
  const fl = r.u8();
  const vq = fl >> 4;
  if (!phase || vq > 2 || fl & 0x80) return null;
  const tick = r.u32(), rngS = r.u32(), bleue = r.u16(), orange = r.u16();
  const temps = r.f64(), tempsPhase = r.f64(), tempsRestant = r.f64(), graceBalleS = r.f64();
  let dernierBut: EtatMondeReseau["dernierBut"] = null;
  if (fl & 8) {
    const bf = r.u8();
    if (bf > 7) return null;
    const idMarqueur = bf & 2 ? r.u8() : null, idPasse = bf & 4 ? r.u8() : null;
    if ((idMarqueur !== null && idMarqueur >= n) || (idPasse !== null && idPasse >= n)) return null;
    dernierBut = { equipe: EQUIPES[bf & 1], idMarqueur, idPasse, vitesseKmh: r.f64() };
  }
  const p = r.vec(), v = r.vec(), w = r.vec();
  const tf = r.u8();
  if (tf > 15) return null;
  let dernierToucheur: EtatMondeReseau["balle"]["dernierToucheur"] = null, avant: EtatMondeReseau["balle"]["avantDernierToucheur"] = null;
  if (tf & 1) { const id = r.u8(); dernierToucheur = { idVoiture: id, equipe: EQUIPES[(tf >> 1) & 1], temps: r.f64() }; if (id >= n) return null; }
  if (tf & 4) { const id = r.u8(); avant = { idVoiture: id, equipe: EQUIPES[(tf >> 3) & 1], temps: r.f64() }; if (id >= n) return null; }
  const interne: InterneMatch = { touchePoints: [], toucheEvenement: [], dernierArret: [], dernierTir: [], chronoZeroEmis: !!(fl & 4), graceBalleS };
  const voitures: EtatVoitureReseau[] = [];
  for (let i = 0; i < n && r.ok; i++) voitures.push(lireVoiture(r, interne));
  const octetsBitmap = (np + 7) >> 3;
  const actifs: number[] = [], marques: number[] = [];
  for (let o = 0; o < octetsBitmap; o++) actifs.push(r.u8());
  for (let o = 0; o < octetsBitmap; o++) marques.push(r.u8());
  const plots: EtatMondeReseau["plots"] = [];
  for (let k = 0; k < np && r.ok; k++) {
    const actif = !!(actifs[k >> 3] & (1 << (k & 7)));
    plots.push({ actif, recharge: marques[k >> 3] & (1 << (k & 7)) ? r.f64() : 0 });
  }
  if (!r.fini()) return null;
  return {
    tick, temps, phase, tempsPhase, tempsRestant, prolongation: !!(fl & 1), attenteSolBalle: !!(fl & 2), score: { bleue, orange }, dernierBut,
    vainqueur: vq === 0 ? null : vq === 1 ? "bleue" : "orange", rngS, voitures,
    balle: { p, v, w, dernierToucheur, avantDernierToucheur: avant }, plots, interne,
  };
}

function enOctets(ecrire: (w: Ecrivain) => void): Uint8Array {
  const mesure = new Ecrivain(null);
  ecrire(mesure);
  const octets = new Uint8Array(mesure.pos);
  ecrire(new Ecrivain(new DataView(octets.buffer)));
  return octets;
}

export const encoderEtat: EncoderEtat = (e) => enOctets((w) => ecrireEtat(w, e));

export const decoderEtat: DecoderEtat = (octets) => {
  try {
    if (!(octets instanceof Uint8Array)) return null;
    return lireEtat(new Lecteur(octets));
  } catch {
    return null;
  }
};

// ============================================================================================================================
// Trames
// ============================================================================================================================

/** octets d'une entrée : cinq axes int8, un octet de boutons */
const OCTETS_ENTREE = 6;
const BIT_SAUT = 1, BIT_BOOST = 2, BIT_DERAPAGE = 4;
/** en-têtes : trame d'entrées (type, numero, tickDebut, snapRecu, nombre) et instantané (type, numero, nbVoitures, drapeaux, tick, entreesRecuesJusqua, avance, manquees) */
const ENTETE_ENTREES = 11;
const ENTETE_SNAP = 14;

const axeOctet = (x: number): number => (x < -Q ? -Q : x > Q ? Q : Number.isFinite(x) ? Math.trunc(x) : 0);

function ecrireEntree(w: Ecrivain, q: Readonly<EntreesQuantifiees>): void {
  w.i8(axeOctet(q.accel)); w.i8(axeOctet(q.direction)); w.i8(axeOctet(q.tangage)); w.i8(axeOctet(q.lacet)); w.i8(axeOctet(q.roulis));
  w.u8((q.saut ? BIT_SAUT : 0) | (q.boost ? BIT_BOOST : 0) | (q.derapage ? BIT_DERAPAGE : 0));
}

function lireEntree(r: Lecteur): EntreesQuantifiees | null {
  const accel = r.i8(), direction = r.i8(), tangage = r.i8(), lacet = r.i8(), roulis = r.i8(), bits = r.u8();
  if (!r.ok || bits > 7) return null;
  // −128 n'est pas une valeur légale (−127..127) : ramené à −127
  const c = (x: number): number => (x < -Q ? -Q : x);
  return {
    accel: c(accel), direction: c(direction), tangage: c(tangage), lacet: c(lacet), roulis: c(roulis),
    saut: !!(bits & BIT_SAUT), boost: !!(bits & BIT_BOOST), derapage: !!(bits & BIT_DERAPAGE),
  };
}

export const encoderTrameEntrees: EncoderTrameEntrees = (t) => {
  if (t.entrees.length > RESEAU.entreesMaxParTrame) throw new RangeError(`encoderTrameEntrees : ${t.entrees.length} entrées (max ${RESEAU.entreesMaxParTrame})`);
  return enOctets((w) => {
    w.u8(TRAME_ENTREES); w.u8(t.numero & 255); w.u32(t.tickDebut >>> 0); w.i32(t.snapRecu | 0); w.u8(t.entrees.length);
    for (const q of t.entrees) ecrireEntree(w, q);
  });
};

export const decoderTrameEntrees: DecoderTrameEntrees = (octets) => {
  try {
    if (!(octets instanceof Uint8Array)) return null;
    const r = new Lecteur(octets);
    if (r.u8() !== TRAME_ENTREES) return null;
    const numero = r.u8(), tickDebut = r.u32(), snapRecu = r.i32(), n = r.u8();
    if (!r.ok || n > RESEAU.entreesMaxParTrame || octets.length !== ENTETE_ENTREES + n * OCTETS_ENTREE) return null;
    const entrees: EntreesQuantifiees[] = [];
    for (let i = 0; i < n; i++) {
      const q = lireEntree(r);
      if (!q) return null;
      entrees.push(q);
    }
    return r.fini() ? { numero, tickDebut, snapRecu, entrees } : null;
  } catch {
    return null;
  }
};

export const encoderSnap: EncoderSnap = (s) => {
  const n = s.nbVoitures;
  if (s.entrees.length !== n || s.etat.voitures.length !== n) throw new RangeError("encoderSnap : nbVoitures incohérent avec les entrées ou l'état");
  return enOctets((w) => {
    w.u8(TRAME_SNAP); w.u8(s.numero & 255); w.u8(n); w.u8(s.ralenti ? 1 : 0);
    w.u32(s.tick >>> 0); w.i32(s.entreesRecuesJusqua | 0);
    w.i8(s.avance < -128 ? -128 : s.avance > 127 ? 127 : s.avance | 0); w.u8(s.manquees < 0 ? 0 : s.manquees > 255 ? 255 : s.manquees | 0);
    for (const q of s.entrees) ecrireEntree(w, q);
    ecrireEtat(w, s.etat);
  });
};

export const decoderSnap: DecoderSnap = (octets) => {
  try {
    if (!(octets instanceof Uint8Array) || octets.length < ENTETE_SNAP) return null;
    const r = new Lecteur(octets);
    if (r.u8() !== TRAME_SNAP) return null;
    const numero = r.u8(), nbVoitures = r.u8(), drapeaux = r.u8();
    const tick = r.u32(), entreesRecuesJusqua = r.i32(), avance = r.i8(), manquees = r.u8();
    if (!r.ok || nbVoitures < 1 || nbVoitures > VOITURES_MAX || drapeaux > 1) return null;
    if (octets.length < ENTETE_SNAP + nbVoitures * OCTETS_ENTREE) return null;
    const entrees: EntreesQuantifiees[] = [];
    for (let i = 0; i < nbVoitures; i++) {
      const q = lireEntree(r);
      if (!q) return null;
      entrees.push(q);
    }
    // copie de la section `etat` : le tampon reçu peut être réutilisé par l'appelant
    const octetsEtat = octets.slice(r.pos);
    const etat = lireEtat(new Lecteur(octetsEtat));
    if (!etat || etat.voitures.length !== nbVoitures) return null;
    return { tick, ralenti: drapeaux === 1, numero, nbVoitures, entreesRecuesJusqua, avance, manquees, entrees, etat, octetsEtat };
  } catch {
    return null;
  }
};

export const typeDeTrame: TypeDeTrame = (octets) => {
  if (!(octets instanceof Uint8Array) || octets.length < 1) return null;
  const t = octets[0];
  return t === TRAME_ENTREES ? TRAME_ENTREES : t === TRAME_SNAP ? TRAME_SNAP : null;
};

/** Types exposés pour les tests de la salle. */
export type { EtatMondeReseau, SnapRocket, TrameEntrees };
