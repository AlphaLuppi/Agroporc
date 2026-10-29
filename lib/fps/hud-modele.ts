/**
 * Modèle du HUD (PUR) : décodage de la chaîne `slots`, seuils de munitions et de PV, pips de balles, formats français, synthèse du
 * match (rang, leader, « POINT DE MATCH »), file anti-bavardage de la région `aria-live`, écriture des valeurs continues (`HudLive`).
 * Tolère 4 champs par slot (`slot:arme:munitions:chargeur`) ou 5 (réserve finie en plus, −1 = infinie).
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§3.2, §5.1, §7.2, §12)
 */
import { MELEE, STATS } from "./armes";
import { ARMES, SLOTS, estMelee, type ArmeId, type ArmeSpecialeId, type CauseMort, type EtatPartieZombies, type JoueurPublic, type PhaseZombies, type RaisonAchat, type Slot } from "./protocole";
import type { EtatZombiesHud, HudLive } from "./jeu-types";
import type { Stockage } from "./touches";
import { PORTES_PAYANTES } from "./zombies-carte";

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
    if (!estMelee(arme) && !(ARMES as readonly string[]).includes(arme)) continue;
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
const FR_MAX1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
/** Nombre à une décimale au plus, virgule française : « 2,5 », « 3 ». */
export function formatDecimal(n: number): string {
  return FR_MAX1.format(n);
}
/** Argent des zombies : « 1 250 $ » (espaces insécables). */
export function formatArgent(n: number): string {
  return `${FR0.format(Math.round(n))}${NBSP}$`;
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

/**
 * Libellé d'une ligne du fil : nom court de l'arme (« Fusil »), ou la cause en toutes lettres pour une voiture. Coup de tigre : « Tigre »
 * pour un tigre allié (le kill est crédité à son lanceur, `par`), « Tué par le tigre » pour le tigre sauvage (`par` vide).
 */
export function libelleFil(arme: ArmeId, cause: CauseMort, par: string): string {
  if (cause === "ecrase_pnj") return "Écrasé par la circulation";
  if (cause === "ecrase_vehicule") return par ? `Renversé par ${par}` : "Renversé";
  if (cause === "tigre") return par ? "Tigre" : "Tué par le tigre";
  if (cause === "explosion") return par ? `Explosé par ${par}` : "Explosion de voiture";
  if (cause === "truck_fou") return "Écrasé par le Truck Muche fou";
  if (cause === "tigre_robot") return "Déchiqueté par le tigre robot";
  if (cause === "titan") return par ? `Titan tigre de ${par}` : "Titan tigre";
  if (cause === "tigre_zombie") return "Griffé par un tigre";
  return estMelee(arme) ? MELEE[arme].nomCourt : STATS[arme].nomCourt;
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

// ---------- mode zombies (v5) ----------

/** « 12 TIGRES », « 1 TIGRE », « AUCUN TIGRE » : tigres restants à tuer (pas encore apparus compris). */
export function libelleTigres(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v === 0) return "AUCUN TIGRE";
  return `${FR0.format(v)}${NBSP}TIGRE${v > 1 ? "S" : ""}`;
}

/** Secondes (entières, arrondies au-dessus) avant un horodatage serveur ; 0 une fois passé. */
export function secondesAvant(finT: number, maintenantMs: number): number {
  return Math.max(0, Math.ceil((finT - maintenantMs) / 1000));
}

export interface LibelleVague {
  /** « MANCHE 7 » */
  titre: string;
  /** « 12 TIGRES », « PAUSE · MANCHE 8 DANS 7 s », « BILAN » */
  detail: string;
  /** vrai pendant la pause (décompte) */
  pause: boolean;
}

/**
 * Texte de la barre de vague. Pendant une pause `manche` est déjà le numéro de la manche À VENIR (le serveur l'incrémente à l'entrée en
 * pause) : « MANCHE 8 » avec « PAUSE · DÉPART DANS 7 s ». Phase `lobby` : tiret.
 */
export function libelleVague(phase: PhaseZombies, manche: number, restants: number, secondesPause: number): LibelleVague {
  const m = Math.max(0, Math.round(manche));
  if (phase === "pause") {
    return { titre: `MANCHE ${m}`, detail: `PAUSE · DÉPART DANS ${formatSecondes(secondesPause)}`, pause: true };
  }
  if (phase === "fin") return { titre: m > 0 ? `MANCHE ${m}` : "FIN DE PARTIE", detail: "PARTIE PERDUE", pause: false };
  if (phase === "lobby") return { titre: "ZOMBIES", detail: "EN ATTENTE", pause: false };
  return { titre: `MANCHE ${m}`, detail: libelleTigres(restants), pause: false };
}

/** Motifs d'`argent{motif}` du serveur, lisibles. */
const MOTIFS_ARGENT: Record<string, string> = {
  touche: "touche", kill: "kill", tete: "tête", melee: "mêlée", manche: "fin de manche", achat: "achat", depart: "départ", retour: "retour", synchro: "",
};

/** « +60 $ · kill », « −950 $ · achat » ; le signe moins est un vrai « − » (U+2212). Vide pour un delta nul. */
export function libelleGain(delta: number, motif: string): string {
  if (delta === 0) return "";
  const signe = delta > 0 ? "+" : "\u2212";
  const nom = MOTIFS_ARGENT[motif] ?? "";
  return `${signe}${formatArgent(Math.abs(delta))}${nom ? ` · ${nom}` : ""}`;
}

/** Texte écrit d'un achat refusé (jamais la couleur seule). */
export function texteRefusAchat(raison: RaisonAchat): string {
  switch (raison) {
    case "argent": return "Argent insuffisant";
    case "loin": return "Trop loin";
    case "deja": return "Déjà acquis, ouvert ou inutile";
    case "verrou": return "Porte verrouillée : ouvrez d'abord la précédente";
    default: return "Achat impossible pour le moment";
  }
}

/**
 * Précision à ajouter à l'invite d'un achat : « Argent insuffisant » quand l'argent manque, rien quand le détail dit déjà pourquoi
 * (porte verrouillée, soin pas prêt) ou quand l'achat est possible.
 */
export function manqueInvite(detail: string, assez: boolean): string {
  if (assez || /verrouill|prêt dans/i.test(detail)) return "";
  return "Argent insuffisant";
}

/** Égalité des champs affichés de `EtatZombiesHud` : le HUD ne se rend que si l'un d'eux change (la réanimation par pas de 5 %). */
export function memeEtatZombiesHud(a: EtatZombiesHud | null, b: EtatZombiesHud | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const pas = (x: EtatZombiesHud) => (x.reanimation ? Math.round(x.reanimation.progression * 20) : -1);
  // (v8) la mèche d'une grenade en cuisson se lit au dixième de seconde
  const meche = (x: EtatZombiesHud) => (x.cuisson == null ? -1 : Math.round(x.cuisson * 35));
  // (v8) la cinématique du grand secret avance par pas de 1/40
  const cine = (x: EtatZombiesHud) => (x.cinematique == null ? -1 : Math.round(x.cinematique * 40));
  return a.argent === b.argent && a.manche === b.manche && a.restants === b.restants && a.vivants === b.vivants
    && a.gain?.n === b.gain?.n && a.refus?.n === b.refus?.n && a.achats === b.achats
    && a.aTerre === b.aTerre && a.elimine === b.elimine && a.terreFinT === b.terreFinT
    && a.reanimation?.cible === b.reanimation?.cible && pas(a) === pas(b) && a.partie === b.partie
    && a.pvMax === b.pvMax && a.note === b.note && a.annonce?.n === b.annonce?.n && a.objectif === b.objectif && a.reparation === b.reparation
    && (a.grenades ?? 0) === (b.grenades ?? 0) && (a.remontoirs ?? 0) === (b.remontoirs ?? 0) && meche(a) === meche(b)
    && cine(a) === cine(b);
}

/** Record local des zombies : la manche la plus haute atteinte (et les tigres tués cette partie-là). */
export const CLE_RECORD_ZOMBIES = "pdj-fps-zombies-record";
export interface RecordZombies { manche: number; kills: number }
export const RECORD_ZOMBIES_VIDE: RecordZombies = Object.freeze({ manche: 0, kills: 0 });

const entierPositif = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Lit le record ; stockage absent, illisible ou mal formé : record vide. */
export function lireRecordZombies(stockage?: Stockage | null): RecordZombies {
  try {
    const brut = stockage?.getItem(CLE_RECORD_ZOMBIES);
    if (!brut) return RECORD_ZOMBIES_VIDE;
    const o = JSON.parse(brut) as { manche?: unknown; kills?: unknown } | null;
    return { manche: entierPositif(o?.manche), kills: entierPositif(o?.kills) };
  } catch {
    return RECORD_ZOMBIES_VIDE;
  }
}

/** Évalue une partie contre le record (pur) : `battu` si la manche atteinte le dépasse (à manche égale, plus de tigres tués) ; zéro tigre tué : jamais. */
export function evaluerRecordZombies(ancien: RecordZombies, manche: number, kills: number): { record: RecordZombies; battu: boolean } {
  const m = entierPositif(manche);
  const k = entierPositif(kills);
  // une partie sans aucun tigre abattu n'est jamais un record (sinon « NOUVEAU RECORD » dès la première partie perdue en manche 1)
  const battu = k > 0 && (m > ancien.manche || (m === ancien.manche && m > 0 && k > ancien.kills));
  return { record: battu ? { manche: m, kills: k } : ancien, battu };
}

/** Enregistre le record s'il est battu ; renvoie le résultat de l'évaluation. Un stockage qui refuse l'écriture est ignoré. */
export function majRecordZombies(stockage: Stockage | null | undefined, manche: number, kills: number): { record: RecordZombies; battu: boolean } {
  const r = evaluerRecordZombies(lireRecordZombies(stockage), manche, kills);
  if (r.battu) {
    try { stockage?.setItem(CLE_RECORD_ZOMBIES, JSON.stringify(r.record)); } catch { /* stockage indisponible : record non retenu */ }
  }
  return r;
}

/** Zone gagnée en ouvrant chaque porte payante (annonce « Porte ouverte : carrefour Est »). */
export const ZONE_PORTE: Readonly<Record<string, string>> = Object.fromEntries(PORTES_PAYANTES.map((p) => [p.id, p.nom]));

/**
 * Annonces du fil et de la région vive entre deux états successifs de la partie : début de manche, porte ouverte, joueur à terre,
 * relevé, éliminé, retour en jeu, partie perdue. Aucune annonce au premier état reçu (`avant` null).
 */
export function annoncesZombies(avant: EtatPartieZombies | null, apres: EtatPartieZombies, monId: string | null): string[] {
  if (!avant) return [];
  const textes: string[] = [];
  if (apres.phase === "manche" && (avant.phase !== "manche" || avant.manche !== apres.manche)) textes.push(`Manche ${apres.manche}`);
  for (const porte of apres.portes) {
    const etait = avant.portes.find((x) => x.id === porte.id);
    if (porte.ouverte && etait && !etait.ouverte) textes.push(`Ouverture : ${ZONE_PORTE[porte.id] ?? porte.id}`);
  }
  for (const j of apres.joueurs) {
    const prec = avant.joueurs.find((x) => x.id === j.id);
    if (!prec || prec.etat === j.etat) continue;
    const moi = j.id === monId;
    if (j.etat === "terre") textes.push(moi ? "Vous êtes à terre : un coéquipier peut vous relever" : `${j.pseudo} est à terre`);
    else if (j.etat === "elimine") textes.push(moi ? "Vous êtes éliminé : retour à la prochaine pause" : `${j.pseudo} est éliminé`);
    else if (j.etat === "debout" && prec.etat === "terre") textes.push(moi ? "Vous avez été relevé" : `${j.pseudo} a été relevé`);
    else if (j.etat === "debout" && prec.etat === "elimine") textes.push(moi ? "Vous revenez en jeu" : `${j.pseudo} revient en jeu`);
  }
  if (apres.phase === "fin" && avant.phase !== "fin") textes.push(`Partie perdue : manche ${apres.bilan?.manche ?? apres.manche}`);
  return textes;
}
