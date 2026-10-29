/**
 * Tableau des scores (PUR) : tri, rang (ex aequo), K/D, précision, têtes, records avec minimums, colonnes visibles selon la largeur,
 * phrase de situation, « POINT DE MATCH », rail de course à l'objectif, podium, bilan et distinctions de fin de match.
 * Tri : K décroissant, puis M croissant, puis dégâts décroissants, puis pseudo (`localeCompare("fr")`). Rang ex aequo = mêmes K et M.
 * Toutes les fonctions qui reçoivent des lignes les supposent DÉJÀ TRIÉES (sortie de `construireLignes` / `trierLignes`).
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§8, §10)
 */
import { MELEE, STATS, nomArme } from "./armes";
import { estMelee, type ArmeId, type BilanBr, type JoueurPublic, type JoueurZombies, type LigneClassement, type LigneStats, type LigneStatsBr } from "./protocole";

/** Colonnes du tableau, de gauche à droite (HUD §8.1). */
export type ColonneScore = "rang" | "agent" | "k" | "m" | "kd" | "ser" | "prec" | "tete" | "deg" | "arme" | "ping";
export const COLONNES_TOUTES: readonly ColonneScore[] = ["rang", "agent", "k", "m", "kd", "ser", "prec", "tete", "deg", "arme", "ping"];
/** Colonnes du repli 1 (800 à 1099 px) : sans TÊTE, DÉG, ARME FAV. */
const COLONNES_REPLI_1: readonly ColonneScore[] = ["rang", "agent", "k", "m", "kd", "ser", "prec", "ping"];
/** Colonnes du repli 2 (moins de 800 px). */
const COLONNES_REPLI_2: readonly ColonneScore[] = ["rang", "agent", "k", "m", "kd", "ping"];
/** Colonnes du classement compact de l'entracte (4e et suite). */
export const COLONNES_COMPACTES: readonly ColonneScore[] = ["rang", "agent", "k", "m", "kd"];
/** Largeurs de panneau (px) à partir desquelles les colonnes se replient (§8.3). */
export const SEUILS_COLONNES = { toutes: 1100, repli1: 800 } as const;
/** Minimums pour les records (§8.2) : précision à partir de 10 tirs, têtes à partir de 5 touches. */
export const MINIMUMS_RECORDS = { tirs: 10, touches: 5 } as const;
/** « POINT DE MATCH » quand quelqu'un est à ce nombre de kills de l'objectif, ou moins. */
export const POINT_DE_MATCH_KILLS = 3;
/** Ping : bon sous 60 ms, moyen sous 120 ms, mauvais au-delà (§8.1). */
export const SEUILS_PING = { bon: 60, moyen: 120 } as const;
/** Voies verticales du rail : des jetons trop proches se répartissent sur ces voies au lieu de se superposer. */
export const VOIES_RAIL = 4;
/** Écart (fraction du rail) en dessous duquel deux jetons se gênent. */
const ECART_RAIL = 0.06;
/** Espace insécable (avant %, m, s). */
const NBSP = "\u00a0";
/** Cellule sans valeur (statistiques pas encore reçues, division par zéro). */
export const TIRET = "—";

/** Ligne fusionnée de la présence (`JoueurPublic`), des stats (`LigneStats`, absentes en phase 1) et du classement de fin (`LigneClassement`). */
export interface LigneScore {
  id: string; pseudo: string; couleur: string; kills: number; morts: number; ping: number;
  serie: number; serieMax: number;
  /** `undefined` tant que le message `scores` n'est pas arrivé : les cellules affichent « — » */
  tirs?: number; touches?: number; tetes?: number; degats?: number; armeFav?: ArmeId | null;
  vivant: boolean; vehicule: boolean;
}

// ---------- formats français ----------

const formatsNombre = new Map<number, Intl.NumberFormat>();
/** Nombre au format français (virgule décimale, espace fine insécable pour les milliers). */
export function formaterNombre(n: number, decimales = 0): string {
  let f = formatsNombre.get(decimales);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    formatsNombre.set(decimales, f);
  }
  return f.format(n);
}

/** Rang ordinal : 1er, 2e, 3e… */
export function ordinal(rang: number): string {
  return rang === 1 ? "1er" : `${rang}e`;
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const pourcent = (fraction: number) => `${Math.round(fraction * 100)}${NBSP}%`;

// ---------- fusion, tri, rang ----------

const estNombre = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Fusionne présence + stats (+ classement de fin) en lignes triées. Pendant le match : les joueurs en jeu ; à l'entracte
 * (`classement` non nul) : les lignes du classement, le ping et la série en direct venant de la présence quand le joueur est encore là.
 * K, M, série et ping viennent de la présence (temps réel) ; le reste vient du message `scores` (ou des champs étendus du classement).
 */
export function construireLignes(
  joueurs: readonly JoueurPublic[], stats: ReadonlyMap<string, LigneStats>, classement: readonly LigneClassement[] | null,
): LigneScore[] {
  const parId = new Map(joueurs.map((j) => [j.id, j]));
  const fusion = (
    id: string, pseudo: string, couleur: string, kills: number, morts: number, c: LigneClassement | null,
  ): LigneScore => {
    const j = parId.get(id);
    const s = stats.get(id);
    const serie = j?.serie ?? s?.serie ?? c?.serie ?? 0;
    const tirs = c?.tirs ?? s?.tirs;
    const touches = c?.touches ?? s?.touches;
    const tetes = c?.tetes ?? s?.tetes;
    const degats = c?.degats ?? s?.degats;
    const armeFav = c?.armeFav !== undefined ? c.armeFav : s?.armeFav;
    const ligne: LigneScore = {
      id, pseudo, couleur, kills, morts, ping: j?.ping ?? 0,
      serie, serieMax: Math.max(serie, s?.serieMax ?? c?.serieMax ?? 0),
      vivant: classement ? true : (s?.vivant ?? true), vehicule: classement ? false : (s?.vehicule ?? false),
    };
    if (estNombre(tirs)) ligne.tirs = tirs;
    if (estNombre(touches)) ligne.touches = touches;
    if (estNombre(tetes)) ligne.tetes = tetes;
    if (estNombre(degats)) ligne.degats = degats;
    if (armeFav !== undefined) ligne.armeFav = armeFav;
    return ligne;
  };
  if (classement) return trierLignes(classement.map((c) => fusion(c.id, c.pseudo, c.couleur, c.kills, c.morts, c)));
  return trierLignes(joueurs.filter((j) => j.enJeu).map((j) => fusion(j.id, j.pseudo, j.couleur, j.kills, j.morts, null)));
}

/** Tri du tableau : K décroissant, M croissant, dégâts décroissants (absents = 0), pseudo. Ne modifie pas l'entrée. */
export function trierLignes(lignes: readonly LigneScore[]): LigneScore[] {
  return [...lignes].sort(
    (a, b) => b.kills - a.kills || a.morts - b.morts || (b.degats ?? 0) - (a.degats ?? 0) || a.pseudo.localeCompare(b.pseudo, "fr"),
  );
}

/** Rang de chaque ligne triée (ex aequo = mêmes K et M : même rang, le suivant saute : 1, 2, 2, 4). */
export function rangs(lignes: readonly LigneScore[]): number[] {
  const r: number[] = [];
  lignes.forEach((l, i) => {
    const p = lignes[i - 1];
    r.push(p && p.kills === l.kills && p.morts === l.morts ? r[i - 1] : i + 1);
  });
  return r;
}

/** Leader : rang 1 avec au moins un kill (au départ, 0-0, personne ne mène). */
export function estLeader(l: LigneScore, rang: number): boolean {
  return rang === 1 && l.kills > 0;
}

// ---------- colonnes et cellules ----------

export function colonnesVisibles(largeurPx: number): readonly ColonneScore[] {
  if (largeurPx >= SEUILS_COLONNES.toutes) return COLONNES_TOUTES;
  if (largeurPx >= SEUILS_COLONNES.repli1) return COLONNES_REPLI_1;
  return COLONNES_REPLI_2;
}

/** `kills / max(1, morts)`, 1 décimale, virgule. */
export function ratioKD(l: Pick<LigneScore, "kills" | "morts">): string {
  return formaterNombre(l.kills / Math.max(1, l.morts), 1);
}

/** Précision en fraction 0..1, ou null (aucun tir, stats absentes). */
export function fractionPrecision(l: Pick<LigneScore, "tirs" | "touches">): number | null {
  return estNombre(l.tirs) && l.tirs > 0 && estNombre(l.touches) ? Math.min(1, l.touches / l.tirs) : null;
}
/** Part de têtes en fraction 0..1, ou null (aucune touche, stats absentes). */
export function fractionTetes(l: Pick<LigneScore, "touches" | "tetes">): number | null {
  return estNombre(l.touches) && l.touches > 0 && estNombre(l.tetes) ? Math.min(1, l.tetes / l.touches) : null;
}

/** `touches / tirs` en % (« — » si 0 tir ou stats absentes). */
export function precision(l: Pick<LigneScore, "tirs" | "touches">): string {
  const f = fractionPrecision(l);
  return f === null ? TIRET : pourcent(f);
}
/** `tetes / touches` en % (« — » si 0 touche ou stats absentes). */
export function pourcentageTetes(l: Pick<LigneScore, "touches" | "tetes">): string {
  const f = fractionTetes(l);
  return f === null ? TIRET : pourcent(f);
}
export function texteDegats(l: Pick<LigneScore, "degats">): string {
  return estNombre(l.degats) ? formaterNombre(l.degats) : TIRET;
}
/** Arme favorite (nom court pour la colonne, nom complet pour le bilan) ; « — » sans kill ou sans stats. */
export function texteArmeFav(l: Pick<LigneScore, "armeFav">, court = true): string {
  const a = l.armeFav;
  if (!a) return TIRET;
  return court ? (estMelee(a) ? MELEE[a].nomCourt : STATS[a].nomCourt) : nomArme(a);
}

export type QualitePing = "bon" | "moyen" | "mauvais";
export function qualitePing(ms: number): QualitePing {
  return ms < SEUILS_PING.bon ? "bon" : ms < SEUILS_PING.moyen ? "moyen" : "mauvais";
}

/** « 16 en jeu + 2 spectateurs ». */
export function textePresence(joueurs: readonly Pick<JoueurPublic, "enJeu">[]): string {
  const enJeu = joueurs.filter((j) => j.enJeu).length;
  const spectateurs = joueurs.length - enJeu;
  return `${enJeu} en jeu${spectateurs > 0 ? ` + ${pluriel(spectateurs, "spectateur")}` : ""}`;
}

// ---------- situation du match ----------

/** « Vous êtes 4e, à 6 kills du leader » / « Vous menez de 3 kills » ; vide si je ne suis pas dans le tableau. */
export function phraseSituation(lignes: readonly LigneScore[], moiId: string | null): string {
  const i = moiId === null ? -1 : lignes.findIndex((l) => l.id === moiId);
  if (i < 0) return "";
  if (lignes.length === 1) return "Vous êtes seul en jeu";
  const r = rangs(lignes);
  const moi = lignes[i];
  if (r[i] === 1) {
    // plusieurs rang 1 : égalité en tête ; sinon l'écart sur le deuxième
    if (lignes.filter((_, k) => r[k] === 1).length > 1) return "Vous êtes à égalité en tête";
    const ecart = moi.kills - lignes[1].kills;
    return ecart > 0 ? `Vous menez de ${pluriel(ecart, "kill")}` : "Vous menez, avec moins de morts";
  }
  const ecart = lignes[0].kills - moi.kills;
  return ecart > 0
    ? `Vous êtes ${ordinal(r[i])}, à ${pluriel(ecart, "kill")} du leader`
    : `Vous êtes ${ordinal(r[i])}, à égalité de kills avec le leader`;
}

/** « POINT DE MATCH » : quelqu'un est à `POINT_DE_MATCH_KILLS` kills de l'objectif, ou moins (et a marqué). */
export function pointDeMatch(lignes: readonly Pick<LigneScore, "kills">[], objectif: number): boolean {
  return objectif > 0 && lignes.some((l) => l.kills > 0 && objectif - l.kills <= POINT_DE_MATCH_KILLS);
}

/** Position 0..1 de chaque joueur sur le rail 0 → objectif, et voie verticale (jetons proches répartis sans se recouvrir). */
export function positionsRail(
  lignes: readonly Pick<LigneScore, "id" | "kills">[], objectif: number,
): { id: string; position: number; voie: number }[] {
  const bruts = lignes.map((l) => ({ id: l.id, position: objectif > 0 ? Math.min(1, Math.max(0, l.kills / objectif)) : 0, voie: 0 }));
  const poses: { position: number; voie: number }[] = [];
  for (const p of [...bruts].sort((a, b) => a.position - b.position)) {
    let voie = 0;
    while (voie < VOIES_RAIL - 1 && poses.some((q) => q.voie === voie && Math.abs(q.position - p.position) < ECART_RAIL)) voie++;
    p.voie = voie;
    poses.push({ position: p.position, voie });
  }
  return bruts;
}

// ---------- records, podium, bilan ----------

export interface Palmares {
  serie: { id: string; valeur: number } | null;
  precision: { id: string; valeur: number } | null;
  tetes: { id: string; valeur: number } | null;
}

/**
 * Records du match : meilleure série, meilleure précision (au moins `MINIMUMS_RECORDS.tirs` tirs), plus de têtes en proportion
 * (au moins `MINIMUMS_RECORDS.touches` touches). Valeurs : série en kills, précision et têtes en fraction 0..1. À égalité, la ligne
 * la mieux classée l'emporte ; une valeur nulle n'est jamais un record.
 */
export function palmares(lignes: readonly LigneScore[]): Palmares {
  const meilleur = (valeur: (l: LigneScore) => number | null): { id: string; valeur: number } | null => {
    let m: { id: string; valeur: number } | null = null;
    for (const l of lignes) {
      const v = valeur(l);
      if (v !== null && v > 0 && (!m || v > m.valeur)) m = { id: l.id, valeur: v };
    }
    return m;
  };
  return {
    serie: meilleur((l) => l.serieMax),
    precision: meilleur((l) => (estNombre(l.tirs) && l.tirs >= MINIMUMS_RECORDS.tirs ? fractionPrecision(l) : null)),
    tetes: meilleur((l) => (estNombre(l.touches) && l.touches >= MINIMUMS_RECORDS.touches ? fractionTetes(l) : null)),
  };
}

export type CleDistinction = "precision" | "serie" | "tetes";
export interface Distinction {
  cle: CleDistinction;
  libelle: string;
  /** joueur récompensé, null tant qu'aucun n'atteint le minimum */
  id: string | null;
  pseudo: string;
  /** « 52 % », « ×5 » ; « — » sans lauréat */
  valeur: string;
  /** minimum exigé, pour expliquer l'absence de lauréat */
  minimum: string;
}

/** Les trois distinctions de fin de match, dans l'ordre : précision, série max, têtes. */
export function distinctions(lignes: readonly LigneScore[], p: Palmares = palmares(lignes)): Distinction[] {
  const pseudo = (id: string | undefined) => lignes.find((l) => l.id === id)?.pseudo ?? "";
  return [
    { cle: "precision", libelle: "Précision", id: p.precision?.id ?? null, pseudo: pseudo(p.precision?.id), valeur: p.precision ? pourcent(p.precision.valeur) : TIRET, minimum: `${MINIMUMS_RECORDS.tirs} tirs minimum` },
    { cle: "serie", libelle: "Série max", id: p.serie?.id ?? null, pseudo: pseudo(p.serie?.id), valeur: p.serie ? `×${p.serie.valeur}` : TIRET, minimum: "au moins 1 kill" },
    { cle: "tetes", libelle: "Têtes", id: p.tetes?.id ?? null, pseudo: pseudo(p.tetes?.id), valeur: p.tetes ? pourcent(p.tetes.valeur) : TIRET, minimum: `${MINIMUMS_RECORDS.touches} touches minimum` },
  ];
}

/** Libellés des distinctions que j'ai gagnées (« Précision 52 % »), pour « Ton match ». */
export function distinctionsGagnees(lignes: readonly LigneScore[], moiId: string | null): string[] {
  if (moiId === null) return [];
  return distinctions(lignes).filter((d) => d.id === moiId).map((d) => `${d.libelle} ${d.valeur}`);
}

export interface PlacePodium { ligne: LigneScore; rang: number }
/** Les trois premières places (moins si moins de 3 joueurs ; ex aequo = même rang). */
export function podium(lignes: readonly LigneScore[]): PlacePodium[] {
  const r = rangs(lignes);
  return lignes.slice(0, 3).map((ligne, i) => ({ ligne, rang: r[i] }));
}

/** Hauteur d'une marche du podium en % : 100 / 78 / 62. */
export function hauteurMarche(rang: number): number {
  return rang <= 1 ? 100 : rang === 2 ? 78 : 62;
}

export interface Bilan { ligne: LigneScore; rang: number; total: number }
/** Mon bilan de fin de match ; null si je ne figure pas dans le classement. */
export function bilanJoueur(lignes: readonly LigneScore[], moiId: string | null): Bilan | null {
  const i = moiId === null ? -1 : lignes.findIndex((l) => l.id === moiId);
  return i < 0 ? null : { ligne: lignes[i], rang: rangs(lignes)[i], total: lignes.length };
}

/** « Lea a atteint 30 kills » / « Temps écoulé ». */
export function raisonFinMatch(lignes: readonly LigneScore[], objectif: number): string {
  const t = lignes[0];
  return t && objectif > 0 && t.kills >= objectif ? `${t.pseudo} a atteint ${pluriel(objectif, "kill")}` : "Temps écoulé";
}

/** Titre de la bannière : « Lea remporte la partie » (le premier, si plusieurs sont ex aequo en tête : « Égalité en tête »). */
export function titreVainqueur(lignes: readonly LigneScore[]): string {
  if (lignes.length === 0) return "Personne en jeu";
  const r = rangs(lignes);
  if (lignes.length > 1 && r[1] === 1) return "Égalité en tête";
  return `${lignes[0].pseudo} remporte la partie`;
}

// ---------- bilan d'une partie de zombies ----------

/** Ligne du tableau de fin de partie des zombies. */
export interface LigneBilanZombies {
  id: string; pseudo: string; couleur: string;
  /** tigres tués */
  kills: number;
  /** argent gagné pendant la partie ($) */
  gagne: number;
  /** coéquipiers relevés */
  reanimations: number;
  moi: boolean;
}

/**
 * Lignes du bilan : les joueurs qui ont participé (admis, ou ayant tué, gagné ou relevé quelqu'un), triés par tigres tués, puis argent gagné,
 * puis relèves, puis pseudo (`localeCompare("fr")`). Un joueur resté dans le lobby sans jouer n'y figure pas.
 */
export function lignesBilanZombies(joueurs: readonly JoueurZombies[], monId: string | null): LigneBilanZombies[] {
  return joueurs
    .filter((j) => j.admis || j.kills > 0 || j.gagne > 0 || j.reanimations > 0)
    .map((j) => ({ id: j.id, pseudo: j.pseudo, couleur: j.couleur, kills: j.kills, gagne: j.gagne, reanimations: j.reanimations, moi: j.id === monId }))
    .sort((a, b) => b.kills - a.kills || b.gagne - a.gagne || b.reanimations - a.reanimations || a.pseudo.localeCompare(b.pseudo, "fr"));
}

/** Totaux de l'équipe pour le bilan (tigres tués, argent gagné, relèves). */
export function totauxBilanZombies(lignes: readonly Pick<LigneBilanZombies, "kills" | "gagne" | "reanimations">[]): { kills: number; gagne: number; reanimations: number } {
  return lignes.reduce((t, l) => ({ kills: t.kills + l.kills, gagne: t.gagne + l.gagne, reanimations: t.reanimations + l.reanimations }), { kills: 0, gagne: 0, reanimations: 0 });
}

/** Durée d'une partie, « 12 min 05 s » ou « 48 s » (espaces insécables). */
export function formatDureePartie(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min}${NBSP}min ${String(sec).padStart(2, "0")}${NBSP}s` : `${sec}${NBSP}s`;
}

// ---------- bilan et palmarès du Battle Royale (v8) ----------

/** Ligne du classement d'une partie de Battle Royale (triée par place). */
export interface LigneBilanBrAffichee {
  id: string; pseudo: string; couleur: string;
  place: number; kills: number; degats: number;
  /** temps de survie (s) */
  survieS: number;
  moi: boolean;
  /** TOP 1 de la partie */
  vainqueur: boolean;
}

/** Lignes du bilan par place croissante (à égalité de place, par pseudo). Bilan absent : liste vide. */
export function lignesBilanBR(bilan: BilanBr | null | undefined, monId: string | null): LigneBilanBrAffichee[] {
  if (!bilan) return [];
  return bilan.lignes
    .map((l) => ({
      id: l.id, pseudo: l.pseudo, couleur: l.couleur, place: l.place, kills: l.kills, degats: l.degats, survieS: l.survieS,
      moi: l.id === monId, vainqueur: bilan.vainqueurs.includes(l.id),
    }))
    .sort((a, b) => a.place - b.place || a.pseudo.localeCompare(b.pseudo, "fr"));
}

export interface ResumeFinBr {
  /** « TOP 1 » ou « #4 sur 12 » (« Partie terminée » si je ne figure pas au bilan) */
  titre: string;
  /** « Victoire » pour le TOP 1, sinon « <pseudo> remporte la partie » */
  sousTitre: string;
  top1: boolean;
  /** ma place et le nombre de partants, null si je ne figure pas au bilan */
  place: number | null;
  total: number;
  kills: number;
}

/** Résumé de fin de partie du point de vue du joueur `monId`. */
export function resumeFinBr(bilan: BilanBr | null | undefined, monId: string | null): ResumeFinBr {
  const lignes = lignesBilanBR(bilan, monId);
  const moi = lignes.find((l) => l.moi) ?? null;
  const vainqueur = lignes.find((l) => l.vainqueur) ?? null;
  const total = lignes.length;
  if (moi?.vainqueur) return { titre: "TOP 1", sousTitre: "Victoire", top1: true, place: moi.place, total, kills: moi.kills };
  const sousTitre = vainqueur ? `${vainqueur.pseudo} remporte la partie` : "Personne n'a gagné";
  if (moi) return { titre: `#${moi.place} sur ${total}`, sousTitre, top1: false, place: moi.place, total, kills: moi.kills };
  return { titre: "Partie terminée", sousTitre, top1: false, place: null, total, kills: 0 };
}

/** Ligne du palmarès (« TOP 1 cumulés »). `rang` est null pour ma ligne ajoutée hors du top. */
export interface LignePalmaresBr {
  rang: number | null;
  cle: string; pseudo: string;
  top1: number; parties: number; kills: number;
  /** « #3 », ou « — » si aucune place n'est connue */
  meilleure: string;
  moi: boolean;
}

/** « #3 » ; 0 (aucune partie) : tiret. */
export const libelleMeilleurePlace = (place: number): string => (place > 0 ? `#${Math.floor(place)}` : TIRET);

/**
 * Lignes du palmarès, dans l'ordre reçu du serveur (TOP 1, kills, parties, pseudo). Ma ligne (`moi`) est marquée si elle y figure, sinon ajoutée
 * à la fin sans rang : le joueur retrouve toujours son compte.
 */
export function lignesPalmaresBr(lignes: readonly LigneStatsBr[], moi?: LigneStatsBr | null): LignePalmaresBr[] {
  const ligne = (l: LigneStatsBr, rang: number | null): LignePalmaresBr => ({
    rang, cle: l.cle, pseudo: l.pseudo, top1: l.top1, parties: l.parties, kills: l.kills, meilleure: libelleMeilleurePlace(l.meilleurePlace), moi: !!moi && l.cle === moi.cle,
  });
  const res = lignes.map((l, i) => ligne(l, i + 1));
  if (moi && !res.some((l) => l.moi)) res.push(ligne(moi, null));
  return res;
}

/** Durée de survie (s) en « 3 min 05 s » ou « 48 s ». */
export const formatSurvie = (survieS: number): string => formatDureePartie(survieS * 1000);
