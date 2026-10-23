/**
 * Santé d'un joueur de l'arène (PUR) : PV, bouclier, dégâts, régénération, soin d'Elsa, mémo de santé à la sortie de l'arène.
 * Le bouclier absorbe d'abord ; après `REGEN.delaiMs` sans dégât, les PV remontent de `REGEN.pvParS` par seconde (entiers,
 * accumulateur `regenAcc`) ; le bouclier ne se régénère pas. Mutations en place sur le joueur de la salle.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.6, §5.1)
 */
import { JEU } from "./protocole";

/** Sous-ensemble de JoueurSalle : passer le joueur directement. Mutations en place. */
export interface Sante { pv: number; bouclier: number; dernierDegatT: number; regenAcc: number }
export const REGEN = { delaiMs: JEU.regenDelaiMs, pvParS: JEU.regenPvParS } as const;
/** `absorbe` = points pris par le bouclier, `subi` = PV réellement perdus (bornés aux PV restants), `mort` = ce coup vient de tuer. */
export interface ResultatDegats { absorbe: number; subi: number; mort: boolean }

/** Plus grand pas de temps (s) pris en compte par `regenerer` (un onglet gelé ne régénère pas d'un coup). */
const DT_MAX_S = 0.25;

export function santeInitiale(maintenant: number): Sante {
  return { pv: JEU.pvMax, bouclier: 0, dernierDegatT: maintenant, regenAcc: 0 };
}
/**
 * Bouclier d'abord, puis PV ; degats ≤ 0 (ou NaN) ignorés ; remet regenAcc à 0 et dernierDegatT à maintenant. Un joueur déjà mort
 * (pv ≤ 0) ne subit rien et ne « meurt » pas une seconde fois : `mort` n'est vrai que pour le coup qui fait passer les PV à 0.
 */
export function appliquerDegats(s: Sante, degats: number, maintenant: number): ResultatDegats {
  if (!(degats > 0) || s.pv <= 0) return { absorbe: 0, subi: 0, mort: false };
  const absorbe = Math.min(s.bouclier, degats);
  const subi = Math.min(s.pv, degats - absorbe);
  s.bouclier -= absorbe;
  s.pv -= subi;
  s.regenAcc = 0;
  s.dernierDegatT = maintenant;
  return { absorbe, subi, mort: s.pv <= 0 };
}
/** Mort instantanée (écrasement) : pv = 0, bouclier = 0. */
export function tuer(s: Sante, maintenant: number): void {
  s.pv = 0;
  s.bouclier = 0;
  s.regenAcc = 0;
  s.dernierDegatT = maintenant;
}
/**
 * Régénère les PV (entiers) après REGEN.delaiMs sans dégât ; dtS borné à 0,25 ; vrai si `pv` a changé. Jamais sur un mort.
 * Seule la part du pas postérieure à la fin du délai compte : la régénération démarre à 5,000 s, pas au tic suivant.
 */
export function regenerer(s: Sante, maintenant: number, dtS: number): boolean {
  if (s.pv <= 0) return false;
  if (s.pv >= JEU.pvMax) { s.regenAcc = 0; return false; }
  const apresDelaiS = (maintenant - s.dernierDegatT - REGEN.delaiMs) / 1000;
  const dt = Math.min(Math.max(0, dtS), DT_MAX_S, apresDelaiS);
  if (!(dt > 0)) return false;
  s.regenAcc += REGEN.pvParS * dt;
  // 1e-9 : 20 × (1/60) × 3 ne doit pas rester à 0,999…
  const n = Math.floor(s.regenAcc + 1e-9);
  if (n < 1) return false;
  s.regenAcc -= n;
  s.pv = Math.min(JEU.pvMax, s.pv + n);
  if (s.pv >= JEU.pvMax) s.regenAcc = 0;
  return true;
}
/** Soin d'Elsa : pv = pvMax, bouclier = bouclierMax. */
export function soinComplet(s: Sante): void {
  s.pv = JEU.pvMax;
  s.bouclier = JEU.bouclierMax;
  s.regenAcc = 0;
}
/** Apparition : pv = pvMax, bouclier = 0, regenAcc = 0, dernierDegatT = maintenant. */
export function reinitialiserSante(s: Sante, maintenant: number): void {
  s.pv = JEU.pvMax;
  s.bouclier = 0;
  s.regenAcc = 0;
  s.dernierDegatT = maintenant;
}
/** Mémo d'un joueur qui quitte l'arène en vie : on restaure sa santé s'il revient dans JEU.memoSanteMs (pas de soin gratuit). */
export interface MemoSante { pv: number; bouclier: number; sansDegatMs: number; t: number }
export function memoriserSante(s: Sante, maintenant: number): MemoSante {
  return { pv: s.pv, bouclier: s.bouclier, sansDegatMs: Math.max(0, maintenant - s.dernierDegatT), t: maintenant };
}
/** Vrai et santé restaurée (dernierDegatT = maintenant − sansDegatMs, regenAcc = 0) si le mémo a moins de JEU.memoSanteMs et pv > 0 ; sinon faux, rien n'est changé. */
export function restaurerSante(s: Sante, memo: MemoSante | null, maintenant: number): boolean {
  if (!memo || memo.pv <= 0) return false;
  const age = maintenant - memo.t;
  if (age < 0 || age >= JEU.memoSanteMs) return false;
  s.pv = Math.min(JEU.pvMax, memo.pv);
  s.bouclier = Math.min(JEU.bouclierMax, memo.bouclier);
  s.dernierDegatT = maintenant - memo.sansDegatMs;
  s.regenAcc = 0;
  return true;
}
