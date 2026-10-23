/**
 * Modèle du HUD (PUR) : décodage de la chaîne `slots`, seuils de munitions et de PV, pips de balles, formats français, synthèse du
 * match (rang, leader, « POINT DE MATCH »), file anti-bavardage de la région `aria-live`, écriture des valeurs continues (`HudLive`).
 * Tolère 4 champs par slot (`slot:arme:munitions:chargeur`) ou 5 (réserve finie en plus, −1 = infinie).
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§3.2, §5.1, §7.2, §12)
 */
import { COUTEAU, STATS } from "./armes";
import { ARMES, SLOTS, type ArmeId, type ArmeSpecialeId, type CauseMort, type JoueurPublic, type Slot } from "./protocole";
import type { HudLive } from "./jeu-types";

/** Espace insécable (avant m, s, km/h, %). */
export const NBSP = " ";

/** Un slot décodé de `HudEtat.slots`. `reserve` : −1 = infinie. */
export interface SlotHud { slot: Slot; arme: ArmeId; munitions: number; chargeur: number; reserve: number }
export type NiveauMunitions = "normal" | "bas" | "critique" | "vide";
export type NiveauPv = "normal" | "moyen" | "bas";

/** Seuils (§5.1) : chargeur ≤ 25 % ou ≤ 3 balles = ambre ; ≤ 10 % ou 0 balle = danger + invite de rechargement ; 0 = « VIDE ». */
export const SEUILS_MUNITIONS = { basFraction: 0.25, basBalles: 3, critiqueFraction: 0.1 } as const;
/** Seuils de PV : cyan au-dessus de 50, ambre de 26 à 50, danger à 25 ou moins ; libellé « PV BAS » à 30 ou moins. */
export const SEUILS_PV = { moyen: 50, bas: 25, libelleBas: 30 } as const;
/** Pips : un cran par balle jusqu'à 30, au-delà une barre proportionnelle (un cran pour 5 balles au-dessus de 40 : minigun). */
export const PIPS = { parBalleMax: 30, parCinqAu: 40 } as const;
/** « POINT DE MATCH » quand le leader est à ce nombre de kills de l'objectif, ou moins. */
export const SEUIL_POINT_DE_MATCH = 3;
/** Une série de kills à partir de laquelle la puce « SÉRIE ×N » s'affiche. */
export const SEUIL_SERIE = 3;
/** Paliers de minuterie annoncés (s). */
export const PALIERS_MINUTERIE: readonly number[] = [60, 30, 10];

const entier = (s: string): number | null => (/^-?\d+$/.test(s) ? Number(s) : null);

/** Décode `HudEtat.slots` ; le slot spécial est absent s'il n'est pas porté. Les entrées mal formées sont ignorées. */
export function parseSlots(s: string): SlotHud[] {
  const res: SlotHud[] = [];
  for (const brut of s.split("|")) {
    const c = brut.split(":");
    if (c.length !== 4 && c.length !== 5) continue;
    const slot = c[0] as Slot;
    const arme = c[1];
    if (!SLOTS.includes(slot)) continue;
    if (arme !== "couteau" && !(ARMES as readonly string[]).includes(arme)) continue;
    const munitions = entier(c[2]);
    const chargeur = entier(c[3]);
    const reserve = c.length === 5 ? entier(c[4]) : -1;
    if (munitions === null || chargeur === null || reserve === null) continue;
    res.push({ slot, arme: arme as ArmeId, munitions, chargeur, reserve });
  }
  return res;
}

/** Niveau d'alerte du chargeur (le couteau, chargeur 0, est toujours « normal »). */
export function niveauMunitions(munitions: number, chargeur: number): NiveauMunitions {
  if (chargeur <= 0) return "normal";
  if (munitions <= 0) return "vide";
  if (munitions <= chargeur * SEUILS_MUNITIONS.critiqueFraction) return "critique";
  if (munitions <= chargeur * SEUILS_MUNITIONS.basFraction || munitions <= SEUILS_MUNITIONS.basBalles) return "bas";
  return "normal";
}

export function niveauPv(pv: number): NiveauPv {
  if (pv > SEUILS_PV.moyen) return "normal";
  if (pv > SEUILS_PV.bas) return "moyen";
  return "bas";
}

/** Libellé « PV BAS » (texte, jamais la couleur seule) : 30 PV ou moins. */
export function libellePvBas(pv: number): boolean {
  return pv <= SEUILS_PV.libelleBas;
}

/**
 * Nombre de crans de la rangée de pips et nombre de crans pleins : un cran par balle jusqu'à 30 ; de 31 à 40, 30 crans proportionnels ;
 * au-delà de 40, un cran pour 5 balles. Un chargeur non vide garde toujours au moins un cran plein.
 */
export function pips(munitions: number, chargeur: number): { crans: number; pleins: number; parCran: number } {
  if (chargeur <= 0) return { crans: 0, pleins: 0, parCran: 1 };
  const m = Math.max(0, Math.min(munitions, chargeur));
  if (chargeur <= PIPS.parBalleMax) return { crans: chargeur, pleins: m, parCran: 1 };
  if (chargeur <= PIPS.parCinqAu) {
    return { crans: PIPS.parBalleMax, pleins: Math.ceil((m * PIPS.parBalleMax) / chargeur), parCran: chargeur / PIPS.parBalleMax };
  }
  return { crans: Math.ceil(chargeur / 5), pleins: Math.ceil(m / 5), parCran: 5 };
}

// ---------- formats français ----------

const FR0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const FR1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatNombre(n: number): string {
  return FR0.format(Math.round(n));
}
/** « 112 m » (espace insécable). */
export function formatMetres(m: number): string {
  return `${FR0.format(Math.round(m))}${NBSP}m`;
}
/** « 27 s » pour une valeur entière, « 2,5 s » sinon (une décimale, virgule). */
export function formatSecondes(s: number): string {
  const v = Math.round(Math.max(0, s) * 10) / 10;
  return Number.isInteger(v) ? `${FR0.format(v)}${NBSP}s` : `${FR1.format(v)}${NBSP}s`;
}
/** Pourcentage d'une fraction 0..1 : « 44 % ». */
export function formatPourcent(x: number): string {
  return `${FR0.format(Math.round(x * 100))}${NBSP}%`;
}
/** « 11 m/s ». */
export function formatVitesse(ms: number): string {
  return `${FR0.format(Math.round(Math.max(0, ms)))}${NBSP}m/s`;
}
/** « 12 K » : kills du match. */
export function formatKills(n: number): string {
  return `${FR0.format(n)}${NBSP}K`;
}
/** Rang en toutes lettres abrégées : 1er, 2e, 3e… */
export function formatRang(n: number): string {
  return n === 1 ? "1er" : `${FR0.format(n)}e`;
}

/** Libellé d'une ligne du fil : nom court de l'arme (« Fusil »), ou la cause en toutes lettres pour une voiture. */
export function libelleFil(arme: ArmeId, cause: CauseMort, par: string): string {
  if (cause === "ecrase_pnj") return "Écrasé par la circulation";
  if (cause === "ecrase_vehicule") return par ? `Renversé par ${par}` : "Renversé";
  return arme === "couteau" ? COUTEAU.nomCourt : STATS[arme].nomCourt;
}

/** Texte du contenu d'une offre d'Elsa (bandeau et annonce). */
export function texteOffreElsa(genre: "soin" | "arme", arme?: ArmeSpecialeId): string {
  if (genre === "soin") return "SOIN COMPLET : PV 100 + BOUCLIER 100";
  if (!arme) return "ARME SPÉCIALE";
  const tirs = STATS[arme].chargeur;
  return `ARME : ${STATS[arme].nom.toUpperCase()}, ${tirs} tir${tirs > 1 ? "s" : ""}`;
}
/** Texte du toast quand j'ai pris le cadeau : « Bouclier 100 », « Railgun · 6 tirs · touche 4 ». */
export function texteBonus(genre: "soin" | "arme", arme: ArmeSpecialeId | undefined, touche: string): string {
  if (genre === "soin") return "Soin complet : PV 100, bouclier 100";
  if (!arme) return "Arme spéciale";
  const tirs = STATS[arme].chargeur;
  return `${STATS[arme].nom} · ${tirs} tir${tirs > 1 ? "s" : ""}${touche ? ` · touche ${touche}` : ""}`;
}

// ---------- synthèse du match (barre du haut) ----------

export interface SyntheseMatch {
  /** mon rang (ex aequo : mêmes kills et morts), 0 si je ne suis pas en jeu */
  rang: number;
  exAequo: boolean;
  enJeu: number;
  mesKills: number;
  mesMorts: number;
  serie: number;
  leader: { id: string; pseudo: string; couleur: string; kills: number } | null;
  /** rang 1 et strictement devant le deuxième (ou seul en jeu) */
  jeMene: boolean;
  /** rang 1 mais à égalité de kills avec un autre joueur */
  egalite: boolean;
  /** si je mène : avance sur le deuxième ; sinon retard sur le leader */
  ecart: number;
  pointDeMatch: boolean;
  /** kills du leader / objectif, et mes kills / objectif (0..1) */
  progressionLeader: number;
  maProgression: number;
}

/** Tri du tableau : kills décroissants, morts croissantes, pseudo. */
const comparer = (a: JoueurPublic, b: JoueurPublic) => b.kills - a.kills || a.morts - b.morts || a.pseudo.localeCompare(b.pseudo, "fr");

export function syntheseMatch(joueurs: readonly JoueurPublic[], monId: string | null, objectif: number): SyntheseMatch {
  const enJeu = joueurs.filter((j) => j.enJeu).sort(comparer);
  const moi = monId ? enJeu.find((j) => j.id === monId) : undefined;
  const leader = enJeu[0] ?? null;
  const autres = enJeu.filter((j) => j !== moi);
  const devant = moi ? autres.filter((j) => j.kills > moi.kills || (j.kills === moi.kills && j.morts < moi.morts)).length : 0;
  const rang = moi ? devant + 1 : 0;
  const exAequo = moi ? autres.some((j) => j.kills === moi.kills && j.morts === moi.morts) : false;
  const meilleurAutre = autres[0] ?? null;
  const jeMene = !!moi && rang === 1 && (!meilleurAutre || moi.kills > meilleurAutre.kills);
  const egalite = !!moi && rang === 1 && !jeMene;
  const ecart = !moi || !leader ? 0 : jeMene ? moi.kills - (meilleurAutre?.kills ?? 0) : Math.max(0, leader.kills - moi.kills);
  const borne = (x: number) => (objectif > 0 ? Math.max(0, Math.min(1, x / objectif)) : 0);
  return {
    rang, exAequo, enJeu: enJeu.length,
    mesKills: moi?.kills ?? 0, mesMorts: moi?.morts ?? 0, serie: moi?.serie ?? 0,
    leader: leader ? { id: leader.id, pseudo: leader.pseudo, couleur: leader.couleur, kills: leader.kills } : null,
    jeMene, egalite, ecart,
    pointDeMatch: !!leader && objectif > 0 && leader.kills < objectif && objectif - leader.kills <= SEUIL_POINT_DE_MATCH,
    progressionLeader: borne(leader?.kills ?? 0),
    maProgression: borne(moi?.kills ?? 0),
  };
}

/** Palier de minuterie (60, 30 ou 10 s) franchi entre deux mesures du temps restant (s), sinon null. */
export function palierFranchi(avantS: number, apresS: number): number | null {
  for (const p of PALIERS_MINUTERIE) if (avantS > p && apresS <= p) return p;
  return null;
}

// ---------- région vive : file anti-bavardage (§12) ----------

/** Un message de la région `aria-live` ; `assertif` seulement pour « PV critiques ». */
export interface MessageVif { id: number; texte: string; priorite: number; assertif?: boolean }
export interface FileVive { attente: readonly MessageVif[]; dernierT: number }
/** Un message toutes les 2 s au plus ; au-delà de 4 en attente, les moins importants (puis les plus anciens) sont jetés. */
export const INTERVALLE_VIF_MS = 2000;
export const FILE_VIVE_MAX = 4;
export const PRIORITE_VIVE = { critique: 5, elimine: 4, match: 3, elsa: 3, bouclier: 2, info: 1 } as const;

export function fileViveVide(): FileVive {
  return { attente: [], dernierT: Number.NEGATIVE_INFINITY };
}

export function pousserVif(f: FileVive, m: MessageVif): FileVive {
  let attente = [...f.attente, m];
  while (attente.length > FILE_VIVE_MAX) {
    // le moins important, à égalité le plus ancien (le premier rencontré)
    let pire = 0;
    for (let i = 1; i < attente.length; i++) if (attente[i].priorite < attente[pire].priorite) pire = i;
    attente = attente.filter((_, i) => i !== pire);
  }
  return { attente, dernierT: f.dernierT };
}

/** Délai (ms) avant que le prochain message puisse partir ; −1 si la file est vide, 0 s'il peut partir tout de suite. */
export function delaiVif(f: FileVive, t: number): number {
  if (f.attente.length === 0) return -1;
  return Math.max(0, f.dernierT + INTERVALLE_VIF_MS - t);
}

/** Sort le message le plus important (à égalité le plus ancien) si l'intervalle est écoulé. */
export function prendreVif(f: FileVive, t: number): { message: MessageVif | null; file: FileVive } {
  if (delaiVif(f, t) !== 0) return { message: null, file: f };
  let meilleur = 0;
  for (let i = 1; i < f.attente.length; i++) if (f.attente[i].priorite > f.attente[meilleur].priorite) meilleur = i;
  const message = f.attente[meilleur];
  return { message, file: { attente: f.attente.filter((_, i) => i !== meilleur), dernierT: t } };
}

// ---------- valeurs continues (HudLive) écrites hors React ----------

/** Ce que `ecrireLive` demande à un élément (le vrai `HTMLElement` convient ; un faux suffit aux tests). */
export interface ElementEcrivable {
  style: { setProperty(nom: string, valeur: string): void };
  textContent: string | null;
  dataset?: Record<string, string | undefined>;
  setAttribute?(nom: string, valeur: string): void;
}
type Ref<E> = { current: E | null } | null | undefined;
export interface CiblesLive<E extends ElementEcrivable = ElementEcrivable> {
  anneauRecharge?: Ref<E>;
  barreRecharge?: Ref<E>;
  /** `dataset.duree` = durée totale du rechargement (s) ; le temps restant y est écrit */
  tempsRecharge?: Ref<E>;
  traitRegen?: Ref<E>;
  vitesse?: Ref<E>;
  kmh?: Ref<E>;
}
/**
 * Dernières valeurs numériques écrites (une valeur identique n'est pas réécrite). Les textes se comparent au contenu de l'élément :
 * un élément remonté entre deux images (changement d'arme, de véhicule) est ainsi toujours rempli.
 */
export interface CacheLive { recharge: number; regen: number; aria: number }
export const cacheLiveVide = (): CacheLive => ({ recharge: -1, regen: -1, aria: -1 });

/** Écrit les variables CSS `--recharge` et `--regen` et les textes de vitesse sur LEURS éléments (aucun rendu React). */
export function ecrireLive(live: HudLive, c: CiblesLive, cache: CacheLive): void {
  const recharge = Math.round(Math.max(0, Math.min(1, live.recharge)) * 1000) / 1000;
  if (recharge !== cache.recharge) {
    cache.recharge = recharge;
    c.anneauRecharge?.current?.style.setProperty("--recharge", String(recharge));
    c.barreRecharge?.current?.style.setProperty("--recharge", String(recharge));
    const aria = Math.round(recharge * 20) * 5;
    if (aria !== cache.aria) {
      cache.aria = aria;
      c.barreRecharge?.current?.setAttribute?.("aria-valuenow", String(aria));
    }
    const t = c.tempsRecharge?.current;
    if (t) {
      const duree = Number(t.dataset?.duree);
      const texte = Number.isFinite(duree) && duree > 0 ? formatSecondes(duree * (1 - recharge)) : "";
      if (t.textContent !== texte) t.textContent = texte;
    }
  }
  const regen = Math.round(Math.max(0, Math.min(1, live.regenDelai)) * 100) / 100;
  if (regen !== cache.regen) {
    cache.regen = regen;
    c.traitRegen?.current?.style.setProperty("--regen", String(regen));
  }
  const vitesse = formatVitesse(live.vitesse);
  const ev = c.vitesse?.current;
  if (ev && ev.textContent !== vitesse) ev.textContent = vitesse;
  const kmh = formatNombre(live.vitesseKmh);
  const ek = c.kmh?.current;
  if (ek && ek.textContent !== kmh) ek.textContent = kmh;
}

/**
 * Rupture du bouclier (flash de la barre, vignette bleue) : "demarrer" quand le bouclier passe de > 0 à 0 pendant que le HUD de combat est
 * actif, "annuler" dès qu'il ne l'est plus (mort, entracte : rien ne doit rester affiché à la réapparition), sinon "rien".
 */
export function etapeRupture(precedent: number, bouclier: number, actif: boolean): "demarrer" | "annuler" | "rien" {
  if (!actif) return "annuler";
  return precedent > 0 && bouclier === 0 ? "demarrer" : "rien";
}
