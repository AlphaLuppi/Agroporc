/**
 * Logique serveur de l'arène FPS (PUR : aucune I/O, ni three ni DOM ; l'horloge `maintenant` est
 * passée à chaque appel et le hasard est injecté par `alea`). Une `Salle` gère les connectés
 * (spectateurs de la vue Palantir et joueurs en jeu), les pseudos, les couleurs, les états reçus
 * (bornage de vitesse), l'équipement et le changement d'arme, les tirs et les coups de couteau (cadence, plombs,
 * portée, ligne de vue, dégâts), le bouclier et la régénération, les morts, les réapparitions, la protection
 * d'apparition et le cycle des matchs (jeu → entracte → jeu). Chaque méthode renvoie les messages à émettre : le
 * serveur Node (`serveur-fps/`) ne fait que les router.
 *
 * Elsa, les véhicules / la circulation PNJ, les événements (v4 : Truck Muche fou, tigre robot géant, titan tigre) et les tigres
 * largués (avion, tigre sauvage, sort d'invocation) sont des services (`match-elsa.ts`, `match-vehicules.ts`, `match-evenements.ts`,
 * `match-tigres.ts`) qui ne voient la salle que par `ContexteSalle` (`match-contexte.ts`), implémenté ici. Un tir ou un coup d'arme blanche
 * dont la cible est un tigre largué est validé par le service des tigres, un tir sur `CIBLE_TIGRE` ou `CIBLE_TITAN` par celui des
 * événements.
 * Avec l'option `zombies` (v6), la salle est celle du mode « zombies tigres » : le service `match-zombies.ts` mène la partie (lobby, manches, argent,
 * achats, tigres), la salle n'y ajoute que l'admission à `rejoindre`, les tirs et coups sur les tigres, la mise à terre à la place de la mort
 * et l'absence de cycle de matchs ; le comportement de l'arène (sans cette option) est inchangé. Sans Elsa, voitures, événements ni tigres largués.
 * Avec l'option `br` (v8, Battle Royale), le service `match-br.ts` mène la partie (lobby, avion, chute, butin, tempête, places, stats) ; la salle y
 * ajoute l'admission à `rejoindre` (`rejoindreBr`), la mort définitive (ni réapparition ni cycle de matchs), la mêlée propre au BR, un snap à
 * 10 Hz sans les joueurs à bord ni les morts anciens, une seule `presence` par tic et des fenêtres de compensation de latence plus larges.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§6.1, §13), 2026-10-23-arene-hud-design.md (§3.5),
 * 2026-10-24-arene-evenements-design.md, 2026-10-23-arene-tigres-design.md, 2026-10-27-arene-zombies-design.md et
 * 2026-10-28-battle-royale-design.md
 */
import { MELEE, STATS, degatsPlomb, gerbeRespectee } from "./armes";
import { ecarterDesCircuits, type Circuit, type VoiturePnj } from "./circulation";
import { BR, REGLES_SANTE_BR, degatsMeleeBr } from "./br-regles";
import type { Monde } from "./collision";
import { couleurJoueur } from "./couleurs";
import type { IntervalleAvion } from "./avion";
import type { IntervalleElsa } from "./elsa";
import { armeDuSlot, depuisAlias, estPrincipale, estSecondaire, estSlot, normaliserEquipement } from "./equipement";
import type {
  ContexteSalle, JoueurSalle, ResumeBr, ResumeZombies, ServiceBr, ServiceElsa, ServiceEvenements, ServiceTigres, ServiceVehicules, ServiceZombies, Sortie,
} from "./match-contexte";
import { creerServiceBr, type OptionsServiceBr } from "./match-br";
import { creerServiceElsa } from "./match-elsa";
import { creerServiceEvenements, type OptionsServiceEvenements } from "./match-evenements";
import { creerServiceTigres } from "./match-tigres";
import { creerServiceVehicules } from "./match-vehicules";
import { EQUIPEMENT_DEPART_ZOMBIES, MAIN_DEPART_ZOMBIES, creerServiceZombies, departPour, type OptionsServiceZombies } from "./match-zombies";
import { REWIND_MELEE_MS, coupVraisemblable } from "./melee";
import {
  CIBLE_LIVRAISON, CIBLE_TIGRE, CIBLE_TITAN, EQUIPEMENT_DEFAUT, JEU, PLAFONDS, SLOT_DEFAUT, copierEquipement, estIdZombie, estMelee, oeilDe, silhouetteDe,
  type ArmeFeuId, type ArmeId, type ArmeMeleeId, type CauseMort, type EtatJoueurSnap, type Equipement, type InfoMatch, type InfoTueur,
  type JoueurPublic, type LigneClassement, type LigneStats, type MessageClient, type MonstresSnap, type SignalVoix, type Slot, type Vec3, type Zone,
} from "./protocole";
import { BUS_C3, avancerBusC3, busEnSnap, armesEnSnap, ecraseParBus, estSurLeToit, ramasserArmeC3, peutMonterSurBus, creerEtatBusC3, type EtatBusC3 } from "./bus-c3";
import { creerFrappe, degatsImpactFrappe, verifierImpactsFrappe, type FrappeEnCours } from "./frappe-aerienne";
import { creerNuageFumee, nuagesEnSnap, type NuageFumee } from "./fumigene";
import { appliquerDegats, memoriserSante, regenerer, reinitialiserSante, restaurerSante, tuer as tuerSante } from "./sante";
import type { CachetteTigre } from "./tigre-arene";
import { toucheVraisemblable } from "./tir";
import { ROND_POINT, ZONE_APPARITION, choisirPointZone, lacetVers, filtrerApparitions, type ZoneApparition } from "./zones";
import { ZOMBIES } from "./zombies-vagues";
import type { Vec2 } from "../agroparc3d/types";

// `Sortie` et `JoueurSalle` vivent dans match-contexte.ts (partagés avec les services Elsa / véhicules) ; réexportés pour les appelants.
export type { JoueurSalle, Sortie } from "./match-contexte";

/** 16 couleurs vives lisibles sur fond noir, attribuées dans l'ordre à la connexion. */
export const PALETTE: readonly string[] = [
  "#ff5252", "#ff8f2e", "#ffd93d", "#b8f13a", "#38e06b", "#22e3b4", "#2fd4ff", "#4a90ff",
  "#8a6bff", "#c561ff", "#ff55d4", "#ff7aa2", "#ffb3a0", "#e6ff8a", "#8ffff0", "#d9d9ff",
];

export const PSEUDO_MIN = 2;
export const PSEUDO_MAX = 16;
export const PSEUDO_DEFAUT = "Agent";
/** Vitesse horizontale maximale d'un joueur (m/s) ; au-delà d'`allure × dt + 1 m` l'état est refusé. */
export const VITESSE_MAX_H_M_S = PLAFONDS.vitesseHorizontaleMax;
/** Vitesse verticale maximale (m/s) : une chute depuis un toit dépasse la vitesse horizontale. */
export const VITESSE_MAX_V_M_S = 45;
/** Plus grand écart de temps (s) crédité à un état : borne la distance acceptée après un silence. */
export const DT_MAX_S = 5;
/** Les pieds peuvent dépasser les bornes de l'arène de cette marge (m). */
export const MARGE_HORS_BORNES_M = 0.5;
/** Cadence tolérée : fraction de la cadence nominale de l'arme. */
export const TOLERANCE_CADENCE = 0.85;
/** Crédit de rafale : un tir peut arriver jusqu'à cette fraction d'intervalle plus tôt (gigue réseau). */
export const CREDIT_RAFALE = 0.5;
/**
 * Idem pour une arme automatique, en intervalles : une coupure réseau de 150 à 200 ms livre d'un coup
 * 2 à 3 tirs de la rafale (à 13 tirs/s), qui ne doivent pas être perdus. Au plus 3 tirs d'avance, une fois.
 */
export const CREDIT_RAFALE_AUTO = 3;
/**
 * Plancher du crédit de rafale d'une arme automatique (ms) : trois intervalles du minigun (40 ms × 0,85) ne font que 100 ms,
 * moins qu'une coupure réseau courante. Crédit effectif = `max(CREDIT_RAFALE_AUTO × intervalle, CREDIT_RAFALE_AUTO_MS)`.
 */
export const CREDIT_RAFALE_AUTO_MS = 200;
/** Écart toléré entre l'œil déclaré par le client et la position connue du serveur (m + 0,15 s de vitesse). */
export const ECART_OEIL_M = 1.5;
/** Part de la vitesse du tireur ajoutée à `ECART_OEIL_M` (m par m/s) : l'œil déclaré peut précéder la position connue. */
export const TOLERANCE_OEIL_VITESSE = 0.10;
/** Cosinus minimal entre la direction d'un plomb et la direction de visée connue (≈ 70°). */
export const COS_VISEE_MIN = 0.35;
/** Un tir ou un coup est accepté dès `(1 − TOLERANCE_DEGAINAGE) × degainageMs` avant la fin nominale du dégainage (paquets TCP en rafale). */
export const TOLERANCE_DEGAINAGE = 0.7;
/** Le conducteur d'un véhicule ne tire pas (ni ne poignarde) ; les passagers oui. */
export const CONDUCTEUR_TIRE = false;
/** Nombre de points d'apparition candidats (les plus éloignés des vivants), règle v1 sans `zoneApparition`. */
export const APPARITIONS_CANDIDATES = 6;
/** Écart aléatoire (rad, ±) du regard à l'apparition autour de la direction du rond-point (avec `zoneApparition`). */
export const REGARD_ALEA_RAD = 0.6;
/** Historique des positions gardé par joueur pour la compensation de latence (ms). */
export const HISTORIQUE_MS = 400;
/**
 * Jusqu'où un tir peut « remonter le temps » (ms) : le tireur voit les autres avec `interpolationMs`
 * de retard, plus la latence du snap et celle de son tir (≈ 100 à 150 ms de ping → ≈ 250 ms).
 */
export const REWIND_MAX_MS = 300;
/** Deux positions historiques à moins de cette distance (m) ne sont testées qu'une fois. */
export const REWIND_PAS_M = 0.5;
/** Vitesse déclarée plafonnée : elle élargit la hitbox (tir) et la tolérance d'œil (m/s). */
export const VITESSE_DECLAREE_MAX_H_M_S = PLAFONDS.vitesseDeclareeMax;
/** Un joueur vivant en arène sans état accepté depuis ce délai (ms) est retiré de l'arène (onglet gelé, zombie). */
export const INACTIF_MS = 20_000;
/** Tableau des scores : un `scores` immédiat au plus tous les 250 ms (anti-rafale), puis un par seconde tant que le tableau est ouvert. */
export const SCORES_ANTI_RAFALE_MS = 250;
export const SCORES_PERIODE_MS = 1000;
/** Suffixe de pseudo dédoublonné : "Nom2", "Nom3"… */
const SUFFIXE_MAX = 99;

/** Changements de pseudo tolérés par fenêtre (on tape son nom par à-coups ; au-delà, c'est du flood). */
export const RENOMMER_MAX = 8;
export const RENOMMER_FENETRE_MS = 10_000;

const estNombre = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const estVec3 = (x: unknown): x is Vec3 => Array.isArray(x) && x.length === 3 && x.every(estNombre);
const estZone = (x: unknown): x is Zone => x === "tete" || x === "corps";
/** Longueur maximale d'une description SDP relayée (offre ou réponse audio seule, candidats ICE compris : 2 à 5 ko en pratique). */
export const SDP_MAX_CARACTERES = 12_000;
/** Signal du chat vocal : `fin`, ou offre / réponse avec une SDP non vide et bornée (rien d'autre n'est relayé). */
function signalVoixValide(s: unknown): s is SignalVoix {
  if (!s || typeof s !== "object") return false;
  const x = s as { type?: unknown; sdp?: unknown };
  if (x.type === "fin") return Object.keys(x).length === 1;
  return (x.type === "offre" || x.type === "reponse") && typeof x.sdp === "string" && x.sdp.length > 0 && x.sdp.length <= SDP_MAX_CARACTERES
    && Object.keys(x).length === 2;
}
const arrondi = (x: number, pas: number): number => Math.round(x * pas) / pas;
/** Sérialisation d'un vecteur : centimètre (jamais dans l'état interne). */
const cm = (v: Vec3): Vec3 => [arrondi(v[0], 100), arrondi(v[1], 100), arrondi(v[2], 100)];
/** Sérialisation d'un angle : milliradian. */
const mrad = (a: number): number => arrondi(a, 1000);

/**
 * Pseudo nettoyé : lettres, chiffres, espace, `_ - . '` ; espaces réduits ; 16 caractères au plus ;
 * "Agent" si moins de 2 caractères restent.
 */
export function nettoyerPseudo(brut: unknown): string {
  const texte = typeof brut === "string" ? brut.normalize("NFC") : "";
  const propre = texte.replace(/[^\p{L}\p{N} _.'-]/gu, "").replace(/\s+/g, " ").trim();
  const coupe = Array.from(propre).slice(0, PSEUDO_MAX).join("").trim();
  return Array.from(coupe).length >= PSEUDO_MIN ? coupe : PSEUDO_DEFAUT;
}

/** Pseudo unique (sans tenir compte de la casse) : suffixe 2, 3… en raccourcissant la base au besoin. */
export function pseudoUnique(base: string, pris: ReadonlySet<string>): string {
  const cle = (s: string) => s.toLocaleLowerCase("fr");
  if (!pris.has(cle(base))) return base;
  for (let n = 2; n <= SUFFIXE_MAX; n++) {
    const suffixe = String(n);
    const candidat = Array.from(base).slice(0, PSEUDO_MAX - suffixe.length).join("").trimEnd() + suffixe;
    if (!pris.has(cle(candidat))) return candidat;
  }
  return Array.from(base).slice(0, PSEUDO_MAX - 4).join("") + String(1000 + pris.size);
}

/** Options de la salle (tout est facultatif : sans options, aucune règle d'apparition, d'Elsa ou de véhicule n'est active). */
export interface OptionsSalle {
  /** zone d'apparition autour du rond-point (§2.10) ; sinon règle v1 « les 6 points les plus éloignés des vivants » */
  zoneApparition?: ZoneApparition;
  elsa?: { x: number; z: number; intervalle?: IntervalleElsa };
  /** circuits et voitures PNJ (§2.11) : écartent aussi les points d'apparition des circuits */
  circulation?: { circuits: Circuit[]; voitures: VoiturePnj[] };
  /** voitures conduisibles (§2.12) : emplacements de départ */
  vehicules?: readonly { p: Vec2; cap: number }[];
  /**
   * Avion et tigres (v3) : cachettes (public/agroparc/cachettes.json, cap en convention lacet), dont seules celles de l'anneau de
   * `zoneApparition` (sinon `ZONE_APPARITION` autour du rond-point) servent, et intervalle des passages surchargeable.
   */
  tigres?: { cachettes: readonly CachetteTigre[]; intervalle?: IntervalleAvion };
  /** événements (v3) : Truck Muche fou, tigre robot géant, titan tigre */
  evenements?: Omit<OptionsServiceEvenements, "maintenant">;
  /**
   * Salle du mode zombies (v5) : machine d'états, tigres, argent, achats (`match-zombies.ts`). Les tirs et coups entre joueurs n'ont aucun
   * effet, `rejoindre` n'est accepté que d'un joueur admis, l'équipement est imposé, aucune règle de réapparition ni de cycle de match.
   * Sans Elsa, voitures ni événements (ne pas les passer avec cette option).
   */
  zombies?: Omit<OptionsServiceZombies, "alea">;
  /**
   * Salle du mode Battle Royale (v8) : machine d'états, avion, chute, butin, tempête, places et stats (`match-br.ts`). Joueur contre joueur
   * conservé (tout le monde est ennemi), mort définitive, mêlée propre au BR, aucune régénération. Sans Elsa, voitures, événements, tigres
   * largués, bus C3, fumigène ni frappe aérienne (ne pas les passer avec cette option) ; incompatible avec `zombies`.
   */
  br?: Omit<OptionsServiceBr, "alea">;
  /** Fabrique du service Battle Royale (injection : un faux service dans les tests) ; `creerServiceBr` par défaut. */
  fabriqueBr?: (ctx: ContexteSalle, opts: OptionsServiceBr) => ServiceBr;
  /** Fenêtres de compensation de latence (ms) : `REWIND_MAX_MS` / `HISTORIQUE_MS` par défaut, `BR.rewindMaxMs` / `BR.historiqueMs` en BR (snap à 10 Hz). */
  rewindMaxMs?: number;
  historiqueMs?: number;
}

/** Ce que la salle retient d'un joueur en plus de `JoueurSalle` : l'équipement de la PROCHAINE apparition et le slot d'avant. */
interface SuiviJoueur {
  prochain: Equipement;
  /** slot tenu avant le changement en cours (retour d'une spéciale épuisée) */
  precedent: Slot;
}

/** Position d'une cible à valider : un point de son historique et sa posture à cet instant. */
interface PositionCible { p: Vec3; accroupi: boolean }

export class Salle implements ContexteSalle {
  private readonly table = new Map<string, JoueurSalle>();
  private readonly suivi = new Map<string, SuiviJoueur>();
  private readonly apparitions: Vec2[];
  private readonly zone: ZoneApparition | null;
  private readonly elsa: ServiceElsa | null;
  private readonly vehicules: ServiceVehicules | null;
  private readonly tigres: ServiceTigres | null;
  private readonly evenements: ServiceEvenements | null;
  private readonly zombies: ServiceZombies | null;
  /** (v8) Service Battle Royale ; null en arène et en zombies. */
  private readonly br: ServiceBr | null;
  /** Compensation de latence : jusqu'où un tir remonte le temps et combien d'historique de positions est gardé (ms). */
  private readonly rewindMaxMs: number;
  private readonly historiqueMs: number;
  /** (v8, BR) `presence` à émettre : levée par `rejoindreBr`, les morts et les évictions, vidée par `tic` (une seule `presence` par tic). */
  private presenceSale = false;
  /** (v8, BR) instant de mort des joueurs morts (retrait du snap `BR.retraitMortSnapMs` plus tard) */
  private readonly mortT = new Map<string, number>();
  /** Bus C3 express : arène seulement (null en zombies). */
  private readonly busC3: EtatBusC3 | null;
  private readonly frappesDisponibles = new Set<string>();
  private frappesEnCours: FrappeEnCours[] = [];
  private nuagesFumee: NuageFumee[] = [];
  private compteurFrappes = 0;
  private compteurFumigenes = 0;
  /** Dernier fumigène lancé par joueur (anti-rafale). */
  private readonly dernierFumigene = new Map<string, number>();
  private numero = 1;
  private phase: "jeu" | "entracte" = "jeu";
  private fin: number | null;
  private prochain: number | null = null;
  private prochainSnap: number;
  private dernierTicT: number;
  /** compteur des snaps : un sur deux part aux spectateurs (10 Hz) */
  private rangSnap = 0;

  constructor(
    readonly monde: Monde,
    apparitions: Vec2[],
    readonly alea: () => number,
    maintenant: number,
    options: OptionsSalle = {},
  ) {
    this.fin = options.zombies || options.br ? null : maintenant + JEU.dureeMatchMs;
    this.rewindMaxMs = options.rewindMaxMs ?? (options.br ? BR.rewindMaxMs : REWIND_MAX_MS);
    this.historiqueMs = options.historiqueMs ?? (options.br ? BR.historiqueMs : HISTORIQUE_MS);
    this.prochainSnap = maintenant;
    this.dernierTicT = maintenant;
    this.zone = options.zoneApparition ?? null;
    let reservoir = apparitions;
    if (this.zone) {
      // un anneau vide (carte réduite) ne doit pas priver la salle de tout point d'apparition
      const filtres = filtrerApparitions(apparitions, this.zone);
      if (filtres.length) reservoir = filtres;
    }
    // les voitures PNJ sont mortelles dès 6 m/s : aucun point d'apparition à < 4 m d'un circuit (ignoré s'il en resterait trop peu)
    if (options.circulation) reservoir = ecarterDesCircuits(reservoir, options.circulation.circuits);
    this.apparitions = reservoir;
    // Elsa ne donne rien à un occupant de véhicule (sa position est celle du siège) ; le minuteur d'offres s'arme dès la création de la salle
    this.elsa = options.elsa
      ? creerServiceElsa(this, { ...options.elsa, maintenant, aPied: (j) => !this.vehicules?.occupation(j.id) && !this.evenements?.estPilote(j.id) })
      : null;
    this.vehicules = options.vehicules || options.circulation
      ? creerServiceVehicules(this, { vehicules: options.vehicules, circulation: options.circulation, maintenant })
      : null;
    // les tigres largués ne ciblent ni ne frappent un occupant de véhicule ni le pilote du titan, et voient les voitures (obstacles, chocs)
    const anneau = this.zone ?? { centre: ROND_POINT.centre, ...ZONE_APPARITION };
    this.tigres = options.tigres
      ? creerServiceTigres(this, {
        cachettes: options.tigres.cachettes, anneau, intervalle: options.tigres.intervalle, maintenant,
        aPied: (j) => !this.vehicules?.occupation(j.id) && !this.pilote(j.id), voitures: (t) => this.vehicules?.voitures?.(t) ?? [],
        evenementTigre: () => this.evenements?.tigreGeantEnCours() ?? false,
      })
      : null;
    // le tigre géant n'est pas annoncé pendant le survol de l'avion ni tant qu'un tigre sauvage largué vit (spec des tigres, Cohabitation)
    this.evenements = options.evenements
      ? creerServiceEvenements(this, {
        ...options.evenements, maintenant, ...(this.tigres ? { tigrePermis: () => !this.tigres?.avionOuSauvage() } : {}),
      })
      : null;
    this.zombies = options.zombies ? creerServiceZombies(this, { ...options.zombies, alea }) : null;
    this.br = options.br ? (options.fabriqueBr ?? creerServiceBr)(this, { ...options.br, alea }) : null;
    this.busC3 = options.zombies || options.br ? null : creerEtatBusC3(maintenant, this.alea);
  }

  /** (v3) Pilote du titan tigre : invulnérable, ni arme ni voiture ni état à pied. */
  private pilote(id: string): boolean {
    return !!this.evenements?.estPilote(id);
  }

  libererVehicule(j: JoueurSalle, maintenant: number): Sortie[] {
    return this.vehicules ? this.vehicules.liberer(j, maintenant) : [];
  }

  toucheJoueur(c: JoueurSalle, o: Vec3, d: Vec3, portee: number, maintenant: number): boolean {
    const vitesseCible = Math.hypot(c.v[0], c.v[1], c.v[2]);
    return this.positionsCible(c, maintenant, this.rewindMaxMs).some((pos) =>
      toucheVraisemblable(this.monde, o, d, portee, { id: c.id, p: pos.p, vivant: true, accroupi: pos.accroupi }, vitesseCible));
  }

  // ---------- ContexteSalle (vue de la salle pour les services) ----------

  enPhaseJeu(): boolean { return this.phase === "jeu"; }
  joueur(id: string): JoueurSalle | undefined { return this.table.get(id); }
  joueursEnJeu(): JoueurSalle[] { return [...this.table.values()].filter((j) => j.enJeu); }
  /** (v5) tous les membres de la salle, lobby compris, dans l'ordre d'arrivée */
  joueurs(): JoueurSalle[] { return [...this.table.values()]; }
  memoriserPrecedent(j: JoueurSalle): void {
    const suivi = this.suivi.get(j.id);
    if (suivi && j.main !== "speciale") suivi.precedent = j.main;
  }

  /**
   * Dégâts d'arme : le bouclier absorbe d'abord. Renvoie `degats` (avec `bouclier`, `absorbe`, `src`) puis, si la cible meurt,
   * `mort` (avec `cause`, `ts`, `tueur`), la libération du siège, `presence` et la fin de match si l'objectif est atteint.
   * Rien pour une cible hors arène ou déjà morte (jamais deux morts).
   */
  infliger(cible: JoueurSalle, degats: number, par: JoueurSalle | null, cause: CauseMort, zone: Zone, arme: ArmeId, maintenant: number, src?: Vec3): Sortie[] {
    if (!cible.enJeu || !cible.vivant || this.pilote(cible.id)) return [];
    const r = appliquerDegats(cible, degats, maintenant);
    if (r.absorbe + r.subi <= 0) return [];
    if (par && par !== cible) par.degats += r.absorbe + r.subi;
    // (BR) un coup reçu interrompt l'usage d'un soin, sauf la tempête (sinon un bandage ne s'achèverait jamais hors zone)
    this.br?.surDegats(cible, cause, maintenant);
    const sorties: Sortie[] = [{
      a: "tous",
      m: {
        t: "degats", cible: cible.id, par: par?.id ?? "", degats, pv: cible.pv, bouclier: cible.bouclier, zone,
        ...(src ? { src } : {}), ...(r.absorbe > 0 ? { absorbe: r.absorbe } : {}),
      },
    }];
    if (r.mort) sorties.push(...this.mourir(cible, par, cause, zone, arme, maintenant));
    return sorties;
  }

  /** Mort instantanée (écrasement) : le bouclier est ignoré. Mêmes sorties que `infliger` ; `par` null pour la circulation PNJ (aucun kill). */
  tuer(cible: JoueurSalle, par: JoueurSalle | null, cause: CauseMort, maintenant: number): Sortie[] {
    if (!cible.enJeu || !cible.vivant || this.pilote(cible.id)) return [];
    const absorbe = cible.bouclier;
    const total = cible.pv + cible.bouclier;
    tuerSante(cible, maintenant);
    const sorties: Sortie[] = [{
      a: "tous",
      m: {
        t: "degats", cible: cible.id, par: par?.id ?? "", degats: total, pv: 0, bouclier: 0, zone: "corps",
        ...(absorbe > 0 ? { absorbe } : {}),
      },
    }];
    sorties.push(...this.mourir(cible, par, cause, "corps", "couteau", maintenant));
    return sorties;
  }

  /** Mort d'un joueur dont les PV viennent de tomber à 0 : compteurs, éjection du siège, kill du tueur, présence, fin de match. */
  private mourir(cible: JoueurSalle, par: JoueurSalle | null, cause: CauseMort, zone: Zone, arme: ArmeId, maintenant: number): Sortie[] {
    if (this.zombies) {
      // zombies : le joueur est « à terre » (ni `mort`, ni killcam, ni réapparition à 4 s, ni objectif de kills) ; le service décide de la suite
      cible.vivant = false;
      cible.posture = "mort";
      cible.mur = 0;
      cible.accroupi = false;
      cible.glisse = false;
      cible.morts++;
      cible.serie = 0;
      cible.equip.speciale = null;
      cible.munSpeciale = 0;
      cible.memoSante = null;
      return this.zombies.surMort(cible, maintenant);
    }
    if (this.br) return this.mourirBr(cible, par, cause, zone, arme, maintenant);
    cible.vivant = false;
    cible.posture = "mort";
    cible.mur = 0;
    cible.accroupi = false;
    cible.glisse = false;
    cible.morts++;
    cible.serie = 0;
    this.frappesDisponibles.delete(cible.id);
    cible.reapparitionT = maintenant + JEU.delaiReapparitionMs;
    cible.equip.speciale = null; // sur la COPIE du joueur (EQUIPEMENT_DEFAUT est figé)
    cible.munSpeciale = 0;
    cible.memoSante = null;
    const tueur = par && par !== cible ? par : null;
    const sorties: Sortie[] = [{
      a: "tous",
      m: {
        t: "mort", cible: cible.id, par: tueur?.id ?? "", arme: cause === "arme" ? arme : "couteau", cause, zone, ts: maintenant,
        delai: JEU.delaiReapparitionMs, ...(tueur ? { tueur: this.infoTueur(tueur, cible) } : {}),
      },
    }];
    if (this.vehicules) sorties.push(...this.vehicules.liberer(cible, maintenant));
    if (tueur) {
      tueur.kills++;
      tueur.serie++;
      tueur.serieMax = Math.max(tueur.serieMax, tueur.serie);
      if (cause === "arme") tueur.killsParArme[arme] = (tueur.killsParArme[arme] ?? 0) + 1;
      // une frappe par tranche de 5 kills d'affilée (5, 10, 15…), arène seulement
      if (this.busC3 && tueur.serie % 5 === 0 && !this.frappesDisponibles.has(tueur.id)) {
        this.frappesDisponibles.add(tueur.id);
        sorties.push({
          a: tueur.id,
          m: { t: "frappe", evenement: "disponible", joueur: tueur.id, serie: tueur.serie },
        });
      }
    }
    sorties.push(this.presence());
    if (tueur && tueur.kills >= JEU.objectifKills) sorties.push(...this.terminer(maintenant));
    return sorties;
  }

  /**
   * (v8, Battle Royale) Mort définitive : ni réapparition, ni libération de siège, ni frappe, ni fin de match. Le kill n'est crédité (et le tueur
   * soigné par le service) que si le tueur est valide (`tueurValide` : vivant, ou mort au même tic). Le butin est lâché par `surMort` AVANT
   * l'effacement de l'arme spéciale. La `presence` est fusionnée : une seule par tic (`presenceSale`).
   */
  private mourirBr(cible: JoueurSalle, par: JoueurSalle | null, cause: CauseMort, zone: Zone, arme: ArmeId, maintenant: number): Sortie[] {
    const br = this.br!;
    cible.vivant = false;
    cible.posture = "mort";
    cible.mur = 0;
    cible.accroupi = false;
    cible.glisse = false;
    cible.morts++;
    cible.serie = 0;
    cible.memoSante = null;
    this.mortT.set(cible.id, maintenant);
    const tueur = par && par !== cible ? par : null;
    const valide = tueur !== null && br.tueurValide(tueur, maintenant);
    const sorties: Sortie[] = [{
      a: "tous",
      m: {
        t: "mort", cible: cible.id, par: tueur?.id ?? "", arme: cause === "arme" ? arme : "couteau", cause, zone, ts: maintenant,
        delai: 0, ...(tueur ? { tueur: this.infoTueur(tueur, cible) } : {}),
      },
    }];
    if (valide) {
      tueur.kills++;
      tueur.serie++;
      tueur.serieMax = Math.max(tueur.serieMax, tueur.serie);
      if (cause === "arme") tueur.killsParArme[arme] = (tueur.killsParArme[arme] ?? 0) + 1;
    }
    sorties.push(...br.surMort(cible, valide ? tueur : null, cause, maintenant));
    cible.equip.speciale = null; // sur la COPIE du joueur (EQUIPEMENT_DEFAUT est figé), après le lâcher du butin
    cible.munSpeciale = 0;
    this.presenceSale = true;
    return sorties;
  }

  /** Photographie du tueur à l'instant de la mort (carte de la killcam, repli si le tueur a quitté). */
  private infoTueur(tueur: JoueurSalle, victime: JoueurSalle): InfoTueur {
    return {
      id: tueur.id, pseudo: tueur.pseudo, couleur: tueur.couleur, p: [...tueur.p], lacet: tueur.lacet, tangage: tueur.tangage,
      arme: tueur.arme, pv: tueur.pv, bouclier: tueur.bouclier,
      distance: Math.hypot(tueur.p[0] - victime.p[0], tueur.p[1] - victime.p[1], tueur.p[2] - victime.p[2]),
    };
  }

  /**
   * (v5, zombies) Place le joueur en `p` : PV, équipement (copie propre), arme en main, protection d'apparition ; l'état de mouvement est remis
   * à zéro (le client repart de `seq` 0). Ne change ni `enJeu` ni les règles de réentrée de l'arène. Renvoie le message `apparition`.
   */
  placerJoueur(j: JoueurSalle, p: Vec3, lacet: number, opts: { pv: number; equip: Equipement; main: Slot; munSpeciale?: number; prive?: boolean }, maintenant: number): Sortie[] {
    j.p = [p[0], p[1], p[2]];
    j.v = [0, 0, 0];
    j.lacet = lacet;
    j.tangage = 0;
    j.posture = "sol";
    j.mur = 0;
    j.accroupi = false;
    j.glisse = false;
    j.seq = -1;
    j.equip = copierEquipement(opts.equip);
    j.main = opts.main;
    j.arme = armeDuSlot(j.equip, j.main) ?? armeDuSlot(j.equip, "couteau") ?? j.equip.secondaire;
    j.munSpeciale = j.equip.speciale ? opts.munSpeciale ?? 0 : 0;
    j.sortieJusqua = maintenant;
    j.cadenceArme = {};
    j.prochainTir = -Infinity;
    j.pv = opts.pv;
    j.bouclier = 0;
    j.regenAcc = 0;
    j.dernierDegatT = maintenant;
    j.memoSante = null;
    j.vivant = true;
    j.protegeJusqua = maintenant + JEU.protectionMs;
    j.reapparitionT = null;
    j.etatT = maintenant;
    j.histo = [];
    this.mortT.delete(j.id);
    const suivi = this.suivi.get(j.id);
    if (suivi) suivi.precedent = j.main === "principale" ? "secondaire" : "principale";
    return [{
      a: opts.prive ? j.id : "tous",
      m: {
        t: "apparition", id: j.id, p: j.p, lacet, arme: j.arme, pv: j.pv, bouclier: j.bouclier,
        equip: copierEquipement(j.equip), main: j.main, munSpeciale: j.munSpeciale,
      },
    }];
  }

  /** (v5, zombies) Sortie d'arène sans règle de réentrée ni mémo de santé ; renvoie la libération des sièges (aucun en zombies). */
  retirerJoueur(j: JoueurSalle, maintenant: number): Sortie[] {
    const liberation = [...(this.vehicules ? this.vehicules.liberer(j, maintenant) : []), ...(this.evenements ? this.evenements.liberer(j, maintenant) : [])];
    j.enJeu = false;
    j.vivant = false;
    j.reapparitionT = null;
    j.memoSante = null;
    j.histo = [];
    j.equip.speciale = null;
    j.munSpeciale = 0;
    j.accroupi = false;
    j.glisse = false;
    j.scoresOuvert = false;
    return liberation;
  }

  /** (v5, zombies) Équipement EN COURS (achat, boîte) et arme en main ; le dégainage ne recommence que si l'arme en main change. */
  equiper(j: JoueurSalle, equip: Equipement, main: Slot, maintenant: number, ravitaille?: ArmeFeuId | "tout"): Sortie[] {
    const arme = armeDuSlot(equip, main) ?? armeDuSlot(equip, "secondaire") ?? j.arme;
    const change = arme !== j.arme || main !== j.main;
    j.equip = copierEquipement(equip);
    j.main = main;
    j.arme = arme;
    if (change) j.sortieJusqua = maintenant + JEU.degainageMs;
    return [{
      a: j.id,
      m: { t: "equipement", equip: copierEquipement(j.equip), main: j.main, munSpeciale: j.munSpeciale, ...(ravitaille ? { ravitaille } : {}) },
    }];
  }

  // ---------- lecture ----------

  infoMatch(): InfoMatch {
    return { numero: this.numero, fin: this.fin, objectif: this.zombies || this.br ? 0 : JEU.objectifKills, phase: this.phase, prochain: this.prochain };
  }
  /** (v5) Résumé de la partie de zombies (message `salons`, `/sante`) ; null dans l'arène. */
  resumeZombies(): ResumeZombies | null { return this.zombies ? this.zombies.resume() : null; }
  /** (v8) Résumé de la partie Battle Royale (message `salons`, `/sante`) ; null hors salle BR. */
  resumeBr(): ResumeBr | null { return this.br ? this.br.resume() : null; }
  nombreJoueurs(): number { return this.table.size; }
  nombreEnJeu(): number { let n = 0; for (const j of this.table.values()) if (j.enJeu) n++; return n; }
  /** État interne d'un joueur (lecture seule : tests et supervision). */
  inspecter(id: string): Readonly<JoueurSalle> | undefined { return this.table.get(id); }
  /** Équipement de la prochaine apparition d'un joueur (tests et supervision) ; l'équipement en cours est `inspecter(id).equip`. */
  equipementProchain(id: string): Readonly<Equipement> | undefined { return this.suivi.get(id)?.prochain; }
  joueursPublics(): JoueurPublic[] {
    return [...this.table.values()].map((j) => ({
      id: j.id, pseudo: j.pseudo, couleur: j.couleur, enJeu: j.enJeu, kills: j.kills, morts: j.morts, ping: j.ping,
      ...(j.serie > 0 ? { serie: j.serie } : {}),
      ...(j.voix ? { voix: true } : {}),
    }));
  }
  classement(): LigneClassement[] {
    return [...this.table.values()]
      .filter((j) => j.enJeu || j.kills > 0 || j.morts > 0)
      .sort((a, b) => b.kills - a.kills || a.morts - b.morts || a.pseudo.localeCompare(b.pseudo, "fr"))
      .map((j) => ({
        id: j.id, pseudo: j.pseudo, couleur: j.couleur, kills: j.kills, morts: j.morts,
        serie: j.serie, serieMax: j.serieMax, tirs: j.tirs, touches: j.touches, tetes: j.tetes, degats: j.degats, armeFav: armeFavorite(j),
      }));
  }
  /** Statistiques du match de tous les joueurs du classement (message `scores`). */
  lignesStats(): LigneStats[] {
    return [...this.table.values()]
      .filter((j) => j.enJeu || j.kills > 0 || j.morts > 0)
      .map((j) => ({
        id: j.id, serie: j.serie, serieMax: j.serieMax, tirs: j.tirs, touches: j.touches, tetes: j.tetes, degats: j.degats,
        armeFav: armeFavorite(j), vivant: j.enJeu && j.vivant, vehicule: this.vehicules?.occupation(j.id) != null,
      }));
  }
  /** Dernière mesure de latence (ms), mesurée par le serveur ; pas de diffusion immédiate. */
  majPing(id: string, ms: number): void {
    const j = this.table.get(id);
    if (j && estNombre(ms) && ms >= 0) j.ping = Math.round(ms);
  }

  // ---------- connexion ----------

  connecter(id: string, pseudo: string, maintenant: number): Sortie[] {
    if (this.table.has(id)) return [];
    // la capacité de JEU (16) se contrôle à `rejoindre` : les spectateurs de la vue 3D ne doivent pas la saturer
    // (zombies : la salle entière, lobby compris, est limitée à `ZOMBIES.joueursMax`)
    // (BR : la salle entière, lobby compris, est limitée à `BR.joueursMax`)
    if (this.table.size >= (this.zombies ? ZOMBIES.joueursMax : this.br ? BR.joueursMax : JEU.connexionsMax)) {
      return [{ a: id, m: { t: "erreur", code: "plein", message: "Le serveur de l'arène est saturé, réessayez plus tard." } }];
    }
    const pris = new Set([...this.table.values()].map((j) => j.pseudo.toLocaleLowerCase("fr")));
    const couleursPrises = new Set([...this.table.values()].map((j) => j.couleur));
    const couleur = PALETTE.find((c) => !couleursPrises.has(c)) ?? couleurAuDela(couleursPrises);
    const j: JoueurSalle = {
      id, pseudo: pseudoUnique(nettoyerPseudo(pseudo), pris), couleur, enJeu: false, kills: 0, morts: 0, ping: 0,
      p: [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
      arme: "pistolet", armeSuivante: "pistolet", pv: JEU.pvMax, vivant: false,
      protegeJusqua: 0, reapparitionT: null, reentreeT: -Infinity, seq: -1, etatT: maintenant, histo: [], prochainTir: -Infinity,
      renommages: [],
      // v2 : une copie PAR joueur (EQUIPEMENT_DEFAUT est figé et ne doit jamais être affecté tel quel)
      equip: copierEquipement(EQUIPEMENT_DEFAUT), main: SLOT_DEFAUT, mainSuivante: SLOT_DEFAUT, munSpeciale: 0,
      sortieJusqua: -Infinity, cadenceArme: {}, bouclier: 0, dernierDegatT: maintenant, regenAcc: 0, accroupi: false, glisse: false, memoSante: null,
      // compteurs du tableau des scores (HUD §3.5)
      tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {},
      scoresOuvert: false, scoresDemandeT: -Infinity, scoresEnvoyeT: -Infinity,
    };
    this.table.set(id, j);
    this.suivi.set(id, { prochain: copierEquipement(EQUIPEMENT_DEFAUT), precedent: "principale" });
    return [
      { a: id, m: { t: "bienvenue", id, couleur, joueurs: this.joueursPublics(), match: this.infoMatch(), maintenant } },
      { a: "tous", sauf: id, m: { t: "presence", joueurs: this.joueursPublics() } },
      // zombies : le nouvel arrivant entre dans le lobby, tout le monde apprend la nouvelle liste
      ...(this.zombies ? this.zombies.arrivee(j, maintenant) : []),
      // BR : idem, le nouvel arrivant entre dans le lobby (en attente si une partie est en cours)
      ...(this.br ? this.br.arrivee(j, maintenant) : []),
    ];
  }

  deconnecter(id: string, maintenant: number): Sortie[] {
    const j = this.table.get(id);
    if (!j) return [];
    // le siège est libéré AVANT de retirer le joueur (voiture arrêtée, `sieges` diffusé) ; un pilote laisse le titan s'éteindre
    const liberation = j.enJeu ? [...(this.vehicules ? this.vehicules.liberer(j, maintenant) : []), ...(this.evenements ? this.evenements.liberer(j, maintenant) : [])] : [];
    this.table.delete(id);
    this.suivi.delete(id);
    this.mortT.delete(id);
    // zombies : le service compte les membres restants (hôte suivant, défaite si c'était le dernier debout) ; le joueur est déjà retiré
    const sortieZombies = this.zombies ? this.zombies.liberer(j, maintenant) : [];
    // BR : idem (éliminé s'il était en partie, hôte suivant, victoire éventuelle) ; `j` est l'objet déjà retiré de la table
    const sortieBr = this.br ? this.br.liberer(j, maintenant) : [];
    return [...liberation, this.presence(), ...sortieZombies, ...sortieBr];
  }

  // ---------- messages des clients ----------

  recevoir(id: string, msg: MessageClient, maintenant: number): Sortie[] {
    const j = this.table.get(id);
    if (!j || !msg || typeof msg !== "object") return [];
    switch (msg.t) {
      case "pseudo": return this.renommer(j, msg.pseudo, maintenant);
      case "rejoindre":
        return this.zombies ? this.rejoindreZombies(j, maintenant) : this.br ? this.rejoindreBr(j, maintenant) : this.rejoindre(j, msg, maintenant);
      case "quitter": return this.quitter(j, maintenant);
      case "arme": if (!this.zombies && !this.br) this.choisir(j, { arme: msg.arme }); return [];
      case "equiper": if (!this.zombies && !this.br) this.choisir(j, msg); return [];
      case "lancerPartie":
        return this.zombies ? this.zombies.recevoir(j, msg, maintenant) : this.br ? this.br.recevoir(j, msg, maintenant) : [];
      case "acheter": case "reanimer":
        return this.zombies ? this.zombies.recevoir(j, msg, maintenant) : [];
      // (v8, BR) le service juge : saut de l'avion, entrées de la chute, ramassage, lâcher, soins, statistiques
      case "sauter": case "chute": case "ramasser": case "lacher": case "utiliser": case "statsBr":
        return this.br ? this.br.recevoir(j, msg, maintenant) : [];
      case "main": return this.changerMain(j, msg.slot, maintenant);
      case "etat": this.recevoirEtat(j, msg, maintenant); return [];
      case "tir": return this.recevoirTir(j, msg, maintenant);
      case "coup": return this.recevoirCoup(j, msg, maintenant);
      case "monter": case "descendre": case "siege": case "conduite":
        return j.enJeu && this.vehicules && !this.pilote(j.id) ? this.vehicules.recevoir(j, msg, maintenant) : [];
      case "pilotage": case "canon":
        return j.enJeu && this.evenements ? this.evenements.recevoir(j, msg, maintenant) : [];
      case "lancerFrappe": {
        if (!j.enJeu || !j.vivant || !this.frappesDisponibles.has(j.id) || !estVec3(msg.cible)) return [];
        this.frappesDisponibles.delete(j.id);
        const f = creerFrappe(`frappe_${++this.compteurFrappes}`, j.id, msg.cible, maintenant, this.alea);
        this.frappesEnCours.push(f);
        return [{ a: "joueurs", m: { t: "frappe", evenement: "lancee", joueur: j.id, cible: msg.cible } }];
      }
      case "lancerFumigene": {
        if (!this.busC3 || !j.enJeu || !j.vivant || !estVec3(msg.p)) return [];
        // anti-rafale : un fumigène toutes les 15 s, lâché près du lanceur
        const dernier = this.dernierFumigene.get(j.id);
        if (dernier !== undefined && maintenant - dernier < 15_000) return [];
        if (Math.hypot(msg.p[0] - j.p[0], msg.p[1] - j.p[1], msg.p[2] - j.p[2]) > 5) return [];
        this.dernierFumigene.set(j.id, maintenant);
        const nuage = creerNuageFumee(`fum_${++this.compteurFumigenes}`, msg.p, maintenant);
        this.nuagesFumee.push(nuage);
        return [{ a: "joueurs", m: { t: "fumigene", id: nuage.id, p: nuage.p, debutT: nuage.debutT, finT: nuage.finT } }];
      }
      case "monterBus": {
        if (!this.busC3 || !j.enJeu || !j.vivant || !peutMonterSurBus(j.p, this.busC3.p)) return [];
        this.busC3.passagers.add(j.id);
        j.p[1] = BUS_C3.toitY;
        return [];
      }
      case "vueScores": return this.vueScores(j, msg.ouvert, maintenant);
      case "invoquer": return j.enJeu && this.tigres ? this.tigres.recevoir(j, msg, maintenant) : [];
      // chat vocal désactivé en BR (v1) : 50 joueurs feraient 1 225 échanges SDP
      case "voixActif": return this.br ? [] : this.voixActif(j, msg.actif);
      case "voix": return this.br ? [] : this.relayerVoix(j, msg.a, msg.s);
      case "ping": return estNombre(msg.t0) ? [{ a: id, m: { t: "pong", t0: msg.t0, maintenant } }] : [];
      default: return []; // "bonjour" : déjà traité par connecter
    }
  }

  // ---------- chat vocal (v3 §5) : le serveur ne fait que relayer la signalisation WebRTC ----------

  /** Voix activée ou coupée : diffusée dans la présence (seulement si elle change). */
  private voixActif(j: JoueurSalle, actif: unknown): Sortie[] {
    if (typeof actif !== "boolean" || !!j.voix === actif) return [];
    j.voix = actif;
    return [this.presence()];
  }

  /** Signal relayé tel quel au joueur `a`, si les deux sont en arène avec la voix activée et que le signal a la bonne forme. */
  private relayerVoix(j: JoueurSalle, a: unknown, s: unknown): Sortie[] {
    if (typeof a !== "string" || a === j.id || !signalVoixValide(s)) return [];
    const dest = this.table.get(a);
    if (!dest || !j.voix || !dest.voix || !j.enJeu || !dest.enJeu) return [];
    return [{ a, m: { t: "voix", de: j.id, s } }];
  }

  /** Au plus `RENOMMER_MAX` changements par fenêtre (chaque changement diffuse la présence à tous). */
  private renommer(j: JoueurSalle, brut: unknown, maintenant: number): Sortie[] {
    j.renommages = j.renommages.filter((t) => maintenant - t < RENOMMER_FENETRE_MS);
    if (j.renommages.length >= RENOMMER_MAX) return [];
    const base = nettoyerPseudo(brut);
    const pris = new Set([...this.table.values()].filter((x) => x !== j).map((x) => x.pseudo.toLocaleLowerCase("fr")));
    const pseudo = pseudoUnique(base, pris);
    if (pseudo === j.pseudo) return [];
    j.pseudo = pseudo;
    j.renommages.push(maintenant);
    return [this.presence()];
  }

  /**
   * Équipement de la PROCHAINE apparition : `principale` / `secondaire` valides (alors la prochaine arme en main est la principale)
   * sinon `arme` (alias v1 : rangée dans son slot par catégorie, une spéciale est ignorée). Mort, le choix s'applique tout de suite.
   * Renvoie vrai si un choix valide a été pris en compte.
   */
  private choisir(j: JoueurSalle, brut: { principale?: unknown; secondaire?: unknown; arme?: unknown }): boolean {
    const suivi = this.suivi.get(j.id);
    if (!suivi) return false;
    if (estPrincipale(brut.principale) || estSecondaire(brut.secondaire)) {
      suivi.prochain = normaliserEquipement(brut, suivi.prochain);
      j.mainSuivante = "principale";
    } else {
      const alias = depuisAlias(brut.arme, suivi.prochain);
      if (!alias) return false;
      suivi.prochain = alias.equip;
      j.mainSuivante = alias.main;
    }
    j.armeSuivante = armeDuSlot(suivi.prochain, j.mainSuivante) ?? j.armeSuivante;
    // mort : la prochaine apparition est celle qui arrive, l'équipement est donc déjà le bon
    if (j.enJeu && !j.vivant) {
      j.equip = copierEquipement({ ...suivi.prochain, speciale: null });
      j.main = j.mainSuivante;
      j.arme = armeDuSlot(j.equip, j.main) ?? j.arme;
    }
    return true;
  }

  private rejoindre(j: JoueurSalle, msg: Extract<MessageClient, { t: "rejoindre" }>, maintenant: number): Sortie[] {
    this.choisir(j, msg);
    if (j.enJeu) return [];
    // la capacité ne porte que sur les joueurs EN ARÈNE (les spectateurs de la vue 3D n'occupent aucune place) ; le refus ne ferme pas la socket
    if (this.nombreEnJeu() >= JEU.joueursMax) return [{ a: j.id, m: { t: "refus", action: "rejoindre", raison: "plein" } }];
    j.enJeu = true;
    j.seq = -1; // §13.2.2 : le client repart de seq 0 à chaque entrée dans l'arène, sinon tous ses états seraient ignorés
    // Sortie récente : quitter puis rejoindre ne contourne ni le délai de réapparition d'un mort ni l'attente d'un vivant sous le feu.
    // Le joueur reste en attente (mort, `reapparitionT`) et `tic` le place à `reentreeT`.
    const sorties: Sortie[] = [];
    if (maintenant < j.reentreeT) {
      j.vivant = false;
      j.reapparitionT = j.reentreeT;
      sorties.push(this.presence());
    } else {
      sorties.push(this.placer(j, maintenant), this.presence());
    }
    // l'état d'Elsa et des sièges n'est pas dans `bienvenue` : le jeu est lancé après lui, il ne les a pas vus
    if (this.elsa) sorties.push(...this.elsa.synchro(j.id));
    if (this.vehicules) sorties.push(...this.vehicules.synchro(j.id));
    if (this.tigres) sorties.push(...this.tigres.synchro(j.id));
    if (this.evenements) sorties.push(...this.evenements.synchro(j.id));
    return sorties;
  }

  /**
   * `rejoindre` en zombies : refusé (`lobby`) tant que le joueur n'est pas admis à la partie ; sinon placé sur le point de départ le plus
   * éloigné des autres, équipement de départ imposé (le client ne choisit rien), sans règle de réentrée ni mémo de santé.
   */
  private rejoindreZombies(j: JoueurSalle, maintenant: number): Sortie[] {
    if (j.enJeu) return [];
    if (!this.zombies!.admis(j.id)) return [{ a: j.id, m: { t: "refus", action: "rejoindre", raison: "lobby" } }];
    if (this.nombreEnJeu() >= ZOMBIES.joueursMax) return [{ a: j.id, m: { t: "refus", action: "rejoindre", raison: "plein" } }];
    j.enJeu = true;
    j.memoSante = null;
    j.reentreeT = -Infinity;
    const d = departPour([...this.table.values()].filter((o) => o !== j && o.enJeu && o.vivant).map((o) => o.p));
    return [
      ...this.placerJoueur(j, d.p, d.lacet, { pv: JEU.pvMax, equip: copierEquipement(EQUIPEMENT_DEPART_ZOMBIES), main: MAIN_DEPART_ZOMBIES }, maintenant),
      this.presence(),
      ...this.zombies!.synchro(j.id),
    ];
  }

  /**
   * `rejoindre` en BR : refusé (`lobby`) tant que le joueur n'est pas admis à la partie (jusqu'à la fin du vol), `plein` au-delà de
   * `BR.joueursMax` ; sinon le service le place dans l'avion et lui envoie l'état, le butin et l'inventaire. La `presence` n'est PAS renvoyée à
   * toute la salle à chaque `rejoindre` (50 en rafale) : elle est levée et `tic` n'en émet qu'une.
   */
  private rejoindreBr(j: JoueurSalle, maintenant: number): Sortie[] {
    if (j.enJeu) return [];
    const br = this.br!;
    if (!br.admis(j.id)) return [{ a: j.id, m: { t: "refus", action: "rejoindre", raison: "lobby" } }];
    if (this.nombreEnJeu() >= BR.joueursMax) return [{ a: j.id, m: { t: "refus", action: "rejoindre", raison: "plein" } }];
    j.enJeu = true;
    const entree = br.entreeJoueur(j, maintenant);
    if (entree.length === 0) {
      // le service ne l'a pas placé (l'avion a fini son trajet entre l'admission et ce message ; un placement renvoie toujours son `apparition`) :
      // il reste en attente, jamais `enJeu` sans corps
      j.enJeu = false;
      return [{ a: j.id, m: { t: "refus", action: "rejoindre", raison: "lobby" } }];
    }
    j.memoSante = null;
    j.reentreeT = -Infinity;
    this.presenceSale = true;
    return [...entree, ...br.synchro(j.id)];
  }

  private quitter(j: JoueurSalle, maintenant: number): Sortie[] {
    if (!j.enJeu) return [];
    return [...this.retirerDeLArene(j, maintenant), this.presence()];
  }

  /**
   * Sortie de l'arène (départ volontaire ou éviction) : un joueur en vie garde sa santé 60 s (pas de soin gratuit en quittant puis
   * revenant), un mort repart à 100 PV ; le siège est libéré ; l'arme spéciale est perdue. Renvoie les messages de libération du siège.
   */
  private retirerDeLArene(j: JoueurSalle, maintenant: number): Sortie[] {
    if (this.zombies) {
      // zombies : pas de réentrée différée ni de mémo de santé ; le service repasse le joueur en attente (défaite s'il était le dernier debout)
      return [...this.retirerJoueur(j, maintenant), ...this.zombies.liberer(j, maintenant)];
    }
    if (this.br) {
      // BR : pas de réentrée différée ni de mémo de santé ; le service élimine le joueur s'il était en partie (victoire éventuelle).
      // Il est libéré AVANT `retirerJoueur`, qui efface l'arme spéciale : sinon elle ne tomberait pas avec le reste du butin.
      const sortieBr = this.br.liberer(j, maintenant);
      return [...this.retirerJoueur(j, maintenant), ...sortieBr];
    }
    j.memoSante = j.vivant ? memoriserSante(j, maintenant) : null;
    // un mort garde son délai de réapparition (sans le raccourcir en quittant) ; un vivant doit attendre le même délai avant de revenir
    j.reentreeT = j.vivant
      ? maintenant + JEU.delaiReapparitionMs
      : j.enJeu && j.reapparitionT !== null ? j.reapparitionT : -Infinity;
    const liberation = [...(this.vehicules ? this.vehicules.liberer(j, maintenant) : []), ...(this.evenements ? this.evenements.liberer(j, maintenant) : [])];
    j.enJeu = false;
    j.vivant = false;
    j.reapparitionT = null;
    j.histo = [];
    j.equip.speciale = null;
    j.munSpeciale = 0;
    j.accroupi = false;
    j.glisse = false;
    j.scoresOuvert = false;
    return liberation;
  }

  /** Changement d'arme en main : le slot doit porter une arme (la spéciale, des munitions) ; aucun tir ni recharge pendant `degainageMs`. */
  private changerMain(j: JoueurSalle, slot: unknown, maintenant: number): Sortie[] {
    if (!j.enJeu || !j.vivant || !estSlot(slot) || slot === j.main) return [];
    const arme = armeDuSlot(j.equip, slot);
    if (arme === null || (slot === "speciale" && j.munSpeciale <= 0)) return [];
    const suivi = this.suivi.get(j.id);
    if (suivi) suivi.precedent = j.main;
    j.main = slot;
    j.arme = arme;
    j.sortieJusqua = maintenant + JEU.degainageMs;
    this.br?.surDegats(j, "arme", maintenant); // BR : changer d'arme interrompt l'usage d'un soin
    return [];
  }

  /** État prédit par le client : accepté s'il reste dans les bornes et dans la vitesse permise. */
  private recevoirEtat(j: JoueurSalle, e: Extract<MessageClient, { t: "etat" }>, maintenant: number): void {
    if (!j.enJeu || !j.vivant || this.pilote(j.id)) return;
    // BR : à bord ou en chute, le serveur simule seul (les entrées arrivent par `chute`)
    if (this.br?.enVol(j.id)) return;
    if (!estNombre(e.seq) || e.seq <= j.seq) return;
    if (this.vehicules?.occupation(j.id)) {
      // occupant : la voiture fait foi pour p / v / posture / mur (service des véhicules) ; seul le regard est retenu
      if (!estNombre(e.lacet) || !estNombre(e.tangage)) return;
      j.seq = e.seq;
      j.etatT = maintenant;
      j.lacet = e.lacet;
      j.tangage = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e.tangage));
      return;
    }
    if (!estVec3(e.p) || !estVec3(e.v) || !estNombre(e.lacet) || !estNombre(e.tangage)) return;
    const b = this.monde.bornes;
    if (e.p[0] < b.x0 - MARGE_HORS_BORNES_M || e.p[0] > b.x1 + MARGE_HORS_BORNES_M) return;
    if (e.p[2] < b.z0 - MARGE_HORS_BORNES_M || e.p[2] > b.z1 + MARGE_HORS_BORNES_M) return;
    if (e.p[1] < -10 || e.p[1] > 400) return;
    // La référence (position, temps) ne bouge qu'à l'acceptation : après un refus, le temps écoulé
    // grandit et l'écart permis avec lui, comme pour un joueur réellement parti plus loin.
    const dt = Math.min(DT_MAX_S, Math.max(0, (maintenant - j.etatT) / 1000));
    const dh = Math.hypot(e.p[0] - j.p[0], e.p[2] - j.p[2]);
    if (dh > VITESSE_MAX_H_M_S * dt + 1) return;
    if (Math.abs(e.p[1] - j.p[1]) > VITESSE_MAX_V_M_S * dt + 1.5) return;
    j.seq = e.seq;
    j.etatT = maintenant;
    j.p = [e.p[0], e.p[1], e.p[2]];
    // vitesse bornée comme la position : un `v` gonflé agrandirait sa propre hitbox et sa tolérance d'œil
    const vh = Math.hypot(e.v[0], e.v[2]);
    const k = vh > VITESSE_DECLAREE_MAX_H_M_S ? VITESSE_DECLAREE_MAX_H_M_S / vh : 1;
    j.v = [e.v[0] * k, Math.max(-VITESSE_MAX_V_M_S, Math.min(VITESSE_MAX_V_M_S, e.v[1])), e.v[2] * k];
    j.lacet = e.lacet;
    j.tangage = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e.tangage));
    j.posture = e.posture === "sol" || e.posture === "mur" ? e.posture : "air";
    j.mur = e.mur === -1 || e.mur === 1 ? e.mur : 0;
    // accroupi seulement au sol (pas en l'air, pas en wall-run) ; se relever est toujours permis
    j.accroupi = j.posture === "sol" && e.accroupi === true;
    j.glisse = j.accroupi && e.glisse === true;
    j.histo.push({ t: maintenant, p: [e.p[0], e.p[1], e.p[2]], accroupi: j.accroupi });
    while (j.histo.length > 1 && maintenant - j.histo[0].t > this.historiqueMs) j.histo.shift();
  }

  /**
   * Positions candidates d'une cible pour valider une touche : la position courante puis, en
   * remontant jusqu'à `fenetreMs` (`REWIND_MAX_MS` pour un tir, `REWIND_MELEE_MS` pour le couteau), celles qu'elle occupait
   * quand le tireur l'a vue (il la voit avec ~200 ms de retard : sans cela, une cible qui s'arrête ou change de direction échappe à
   * des tirs pourtant justes). Chaque position porte la posture de l'époque (un joueur qui vient de s'accroupir se rejoue debout
   * là où le tireur le voyait debout) ; assis dans un véhicule, la silhouette est toujours accroupie. Les positions voisines
   * (< `REWIND_PAS_M`) de même posture ne sont gardées qu'une fois.
   */
  private positionsCible(c: JoueurSalle, maintenant: number, fenetreMs: number): PositionCible[] {
    const assis = this.vehicules?.occupation(c.id) != null;
    const r: PositionCible[] = [{ p: c.p, accroupi: c.accroupi || assis }];
    for (let i = c.histo.length - 1; i >= 0; i--) {
      const h = c.histo[i];
      if (maintenant - h.t > fenetreMs) break;
      const d = r[r.length - 1];
      const accroupi = h.accroupi || assis;
      if (accroupi !== d.accroupi || Math.hypot(h.p[0] - d.p[0], h.p[1] - d.p[1], h.p[2] - d.p[2]) >= REWIND_PAS_M) r.push({ p: h.p, accroupi });
    }
    return r;
  }

  /**
   * Œil déclaré (`o`) acceptable : à pied, près de l'œil connu (debout 1,95 m, accroupi 1,30 m) avec une tolérance proportionnelle
   * à la vitesse ; en véhicule, près d'un des yeux possibles du siège rejoués sur l'historique de la voiture (le passager voit sa
   * voiture avec retard : 3 à 4 m d'écart à 24 m/s avec l'état le plus récent).
   */
  private oeilAcceptable(j: JoueurSalle, o: Vec3, maintenant: number): boolean {
    const yeux = this.vehicules?.oeilsPossibles(j, maintenant, this.rewindMaxMs) ?? null;
    if (yeux) return yeux.some((e) => Math.hypot(o[0] - e[0], o[1] - e[1], o[2] - e[2]) <= ECART_OEIL_M);
    const oeil: Vec3 = [j.p[0], j.p[1] + oeilDe({ accroupi: j.accroupi }), j.p[2]];
    const ecart = Math.hypot(o[0] - oeil[0], o[1] - oeil[1], o[2] - oeil[2]);
    return ecart <= ECART_OEIL_M + TOLERANCE_OEIL_VITESSE * Math.hypot(j.v[0], j.v[1], j.v[2]);
  }

  /** Contrôles communs au tir et au coup de couteau : œil proche, directions de norme ≈ 1 orientées dans le sens de la visée. Renvoie les directions normalisées. */
  private validerVisee(j: JoueurSalle, o: Vec3, ds: readonly Vec3[], maintenant: number): Vec3[] | null {
    if (!this.oeilAcceptable(j, o, maintenant)) return null;
    const cosTangage = Math.cos(j.tangage);
    const visee: Vec3 = [-Math.sin(j.lacet) * cosTangage, Math.sin(j.tangage), -Math.cos(j.lacet) * cosTangage];
    const dirs: Vec3[] = [];
    for (const d of ds) {
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l < 0.95 || l > 1.05) return null;
      const n: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
      if (n[0] * visee[0] + n[1] * visee[1] + n[2] * visee[2] < COS_VISEE_MIN) return null;
      dirs.push(n);
    }
    return dirs;
  }

  /** Le slot en main est sorti (dégainage terminé, avec la tolérance de `TOLERANCE_DEGAINAGE`). */
  private sortie(j: JoueurSalle, maintenant: number): boolean {
    return maintenant >= j.sortieJusqua - (1 - TOLERANCE_DEGAINAGE) * JEU.degainageMs;
  }

  /**
   * Cadence par arme (un aller-retour d'arme ne contourne pas la cadence du sniper). 85 % de l'intervalle nominal ; crédit de rafale pour
   * la gigue réseau : un demi-intervalle (une fois), ou pour une arme automatique `max(3 intervalles, 200 ms)`. Vrai et cadence avancée si le tir passe.
   */
  private cadenceOk(j: JoueurSalle, arme: ArmeId, cadenceS: number, auto: boolean, maintenant: number): boolean {
    const intervalle = cadenceS * 1000 * TOLERANCE_CADENCE;
    const prochain = j.cadenceArme[arme] ?? -Infinity;
    if (maintenant < prochain) return false;
    const credit = auto ? Math.max(CREDIT_RAFALE_AUTO * intervalle, CREDIT_RAFALE_AUTO_MS) : CREDIT_RAFALE * intervalle;
    j.cadenceArme[arme] = Math.max(prochain, maintenant - credit) + intervalle;
    return true;
  }

  /** Un tir : validé (arme en main, dégainage, cadence, plombs, œil, angle, portée, ligne de vue) puis dégâts calculés ici. */
  private recevoirTir(j: JoueurSalle, tir: Extract<MessageClient, { t: "tir" }>, maintenant: number): Sortie[] {
    if (!j.enJeu || !j.vivant || this.phase !== "jeu" || this.pilote(j.id) || this.br?.enVol(j.id)) return [];
    if (j.main === "couteau" || j.arme === "couteau" || tir.arme !== j.arme) return [];
    if (!CONDUCTEUR_TIRE && this.vehicules?.estConducteur(j.id)) return [];
    if (!this.sortie(j, maintenant)) return [];
    if (j.main === "speciale" && j.munSpeciale <= 0) return [];
    const armeTiree: ArmeFeuId = j.arme;
    const arme = STATS[armeTiree];
    if (!estVec3(tir.o) || !Array.isArray(tir.d) || tir.d.length < 1 || tir.d.length > arme.plombs) return [];
    if (!tir.d.every(estVec3)) return [];
    const dirs = this.validerVisee(j, tir.o, tir.d, maintenant);
    if (!dirs) return [];
    // gerbe FIXE (§13.1) : les plombs d'un tir à plusieurs plombs sont ceux de `directionsTir` autour de l'axe, à 0,02 rad près
    if (!gerbeRespectee(armeTiree, dirs)) return [];
    // (v7, zombies) le Double Ristretto raccourcit l'intervalle entre deux tirs
    if (!this.cadenceOk(j, armeTiree, arme.cadenceS * (this.zombies?.cadence(j) ?? 1), arme.auto, maintenant)) return [];
    j.protegeJusqua = 0; // tirer annule la protection d'apparition
    j.tirs++;

    const sorties: Sortie[] = [{ a: "tous", sauf: j.id, m: { t: "tir", id: j.id, arme: armeTiree, o: tir.o, d: dirs } }];
    // arme spéciale : une munition de moins ; à 0, l'arme disparaît et le joueur retombe sur le slot précédent
    if (j.main === "speciale") sorties.push(...this.consommerSpeciale(j, maintenant));

    const touches = Array.isArray(tir.touches) ? tir.touches : [];
    const plombsVus = new Set<number>();
    const cumul = new Map<string, { degats: number; zone: Zone }>();
    /** touches sur des tigres, cumulées par tigre comme pour les joueurs (hors statistiques du tableau des scores) */
    const cumulTigres = new Map<string, { degats: number; zone: Zone }>();
    /** (v3) dégâts sur le tigre robot / le titan, zone et distance revérifiées sur la forme du monstre */
    const cumulMonstres = new Map<string, { degats: number; zone: Zone }>();
    /** (zombies) dégâts cumulés par tigre zombie sur ce tir (les plombs du pompe s'additionnent) */
    const cumulZombies = new Map<string, { degats: number; zone: Zone }>();
    /** (v7, zombies) une arme qui perce compte un même plomb sur plusieurs tigres ; dégâts sur le Truck, distance du premier tigre touché (souffle) */
    const perce = this.zombies?.perce(j, armeTiree) ?? false;
    let degatsTruck = 0;
    let premiereTouche: number | null = null;
    const vusZombies = new Set<string>();
    for (const t of touches) {
      if (!t || typeof t.cible !== "string" || !estZone(t.zone) || !Number.isInteger(t.plomb)) continue;
      if (t.plomb < 0 || t.plomb >= dirs.length) continue;
      if (plombsVus.has(t.plomb) && !(perce && estIdZombie(t.cible))) continue;
      if (this.tigres?.estTigre(t.cible)) {
        // positions du tigre rejouées sur son historique serveur, mêmes règles que pour un joueur
        const distance = this.tigres.validerTir(j, t.cible, tir.o, dirs[t.plomb], arme.portee, maintenant, this.rewindMaxMs);
        if (distance === null) continue;
        plombsVus.add(t.plomb);
        const degats = degatsPlomb(armeTiree, t.zone, distance);
        const cu = cumulTigres.get(t.cible);
        if (cu) { cu.degats += degats; if (t.zone === "tete") cu.zone = "tete"; }
        else cumulTigres.set(t.cible, { degats, zone: t.zone });
        continue;
      }
      if (t.cible === CIBLE_TIGRE || t.cible === CIBLE_TITAN) {
        const vu = this.evenements?.toucheMonstre(t.cible, tir.o, dirs[t.plomb], arme.portee) ?? null;
        if (!vu) continue;
        plombsVus.add(t.plomb);
        const dg = degatsPlomb(armeTiree, "corps", vu.distance);
        const cu = cumulMonstres.get(t.cible);
        if (cu) { cu.degats += dg; if (vu.zone === "tete") cu.zone = "tete"; }
        else cumulMonstres.set(t.cible, { degats: dg, zone: vu.zone });
        continue;
      }
      if (this.zombies) {
        // (v7) le Truck Muche d'une manche de livraison
        if (t.cible === CIBLE_LIVRAISON) {
          const dist = this.zombies.toucheTruck(tir.o, dirs[t.plomb], arme.portee);
          if (dist === null) continue;
          plombsVus.add(t.plomb);
          degatsTruck += this.zombies.degatsTir(j, armeTiree, "corps", dist, maintenant);
          continue;
        }
        // zombies : seuls les tigres sont des cibles (pas de tir allié), touche revérifiée sur leur forme avec rejeu de latence
        if (!estIdZombie(t.cible) || vusZombies.has(`${t.cible}|${t.plomb}`)) continue;
        const vu = this.zombies.toucheZombie(t.cible, tir.o, dirs[t.plomb], arme.portee, maintenant);
        if (!vu) continue;
        plombsVus.add(t.plomb);
        vusZombies.add(`${t.cible}|${t.plomb}`);
        if (t.plomb === 0 && (premiereTouche === null || vu.distance < premiereTouche)) premiereTouche = vu.distance;
        const dg = this.zombies.degatsTir(j, armeTiree, vu.zone, vu.distance, maintenant);
        const cu = cumulZombies.get(t.cible);
        if (cu) { cu.degats += dg; if (vu.zone === "tete") cu.zone = "tete"; }
        else cumulZombies.set(t.cible, { degats: dg, zone: vu.zone });
        continue;
      }
      const c = this.table.get(t.cible);
      if (!c || c.id === j.id || !c.enJeu || !c.vivant || maintenant < c.protegeJusqua) continue;
      const vitesseCible = Math.hypot(c.v[0], c.v[1], c.v[2]);
      const vue = this.positionsCible(c, maintenant, this.rewindMaxMs).find((pos) =>
        toucheVraisemblable(this.monde, tir.o, dirs[t.plomb], arme.portee, { id: c.id, p: pos.p, vivant: true, accroupi: pos.accroupi }, vitesseCible));
      if (!vue) continue;
      plombsVus.add(t.plomb);
      const distance = Math.hypot(vue.p[0] - tir.o[0], vue.p[1] + silhouetteDe(vue.accroupi).centreY - tir.o[1], vue.p[2] - tir.o[2]);
      const degats = degatsPlomb(armeTiree, t.zone, distance);
      const cu = cumul.get(c.id);
      if (cu) { cu.degats += degats; if (t.zone === "tete") cu.zone = "tete"; }
      else cumul.set(c.id, { degats, zone: t.zone });
    }

    // plombs arrêtés par une voiture (v3 §4) : dégâts de carrosserie, explosion éventuelle
    if (this.vehicules) sorties.push(...this.vehicules.tirVoitures(j, tir.o, dirs, tir.voitures, armeTiree, plombsVus, maintenant));

    if (cumul.size > 0 || cumulMonstres.size > 0 || cumulZombies.size > 0) {
      j.touches++;
      if ([...cumul.values(), ...cumulMonstres.values(), ...cumulZombies.values()].some((cu) => cu.zone === "tete")) j.tetes++;
    }
    for (const [cibleId, { degats, zone }] of cumulMonstres) sorties.push(...this.evenements!.blesserMonstre(cibleId, degats, j, zone, maintenant));
    // le gain d'une touche (+10 $) est unique par tir, quel que soit le nombre de tigres ou de plombs
    let premier = true;
    for (const [cibleId, { degats, zone }] of cumulZombies) {
      sorties.push(...this.zombies!.blesser(cibleId, degats, j, zone, maintenant, { arme: armeTiree, gain: premier }));
      premier = false;
    }
    if (this.zombies) {
      if (degatsTruck > 0) sorties.push(...this.zombies.blesserTruck(degatsTruck, j, maintenant));
      // (v7) arme explosive : souffle au premier tigre touché, sinon au premier mur ou au sol
      sorties.push(...this.zombies.explosionTir(j, armeTiree, tir.o, dirs[0], premiereTouche, arme.portee, maintenant));
    }
    let presence = false;
    for (const [cibleId, { degats, zone }] of cumul) {
      for (const s of this.infliger(this.table.get(cibleId)!, degats, j, "arme", zone, armeTiree, maintenant, tir.o)) {
        // un tir qui tue plusieurs cibles : une seule présence (la dernière, qui a tous les scores)
        if (s.m.t === "presence") { presence = true; continue; }
        sorties.push(s);
      }
    }
    if (presence) {
      // la fin de match éventuelle suit la présence, comme avec un seul mort
      const i = sorties.findIndex((s) => s.m.t === "match");
      sorties.splice(i < 0 ? sorties.length : i, 0, this.presence());
    }
    if (this.tigres && this.phase === "jeu") {
      for (const [id, { degats, zone }] of cumulTigres) sorties.push(...this.tigres.blesser(id, degats, j, zone, maintenant));
    }
    return sorties;
  }

  /** Une munition de l'arme spéciale tirée ; à 0 elle est retirée, retour au slot précédent et message `equipement` au joueur. */
  private consommerSpeciale(j: JoueurSalle, maintenant: number): Sortie[] {
    j.munSpeciale = Math.max(0, j.munSpeciale - 1);
    if (j.munSpeciale > 0) return [];
    j.equip.speciale = null;
    const precedent = this.suivi.get(j.id)?.precedent;
    // (zombies : sans arme principale, le repli est la secondaire)
    // (BR : sans principale ni secondaire, le repli est l'arme blanche)
    const retour: Slot = precedent && precedent !== "speciale" && armeDuSlot(j.equip, precedent) !== null ? precedent
      : armeDuSlot(j.equip, "principale") !== null ? "principale" : armeDuSlot(j.equip, "secondaire") !== null ? "secondaire" : "couteau";
    j.main = retour;
    j.arme = armeDuSlot(j.equip, retour) ?? j.equip.principale;
    j.sortieJusqua = maintenant + JEU.degainageMs;
    return [{ a: j.id, m: { t: "equipement", equip: copierEquipement(j.equip), main: j.main, munSpeciale: 0 } }];
  }

  /**
   * Un coup d'arme blanche (couteau ou épée) : mêmes contrôles anti-triche que le tir (arme blanche en main, dégainage, cadence de l'arme, œil,
   * direction, angle de visée), puis chaque cible déclarée (au plus `nbCiblesMax`, distinctes) est revalidée : joueur (positions rejouées sur
   * `REWIND_MELEE_MS`, `coupVraisemblable`) ou tigre zombie (`toucheMelee`). Dégâts de l'arme ; le couteau tue un joueur sans bouclier, l'épée aussi
   * et touche jusqu'à trois cibles. En zombies seuls les tigres sont des cibles. Le coup est diffusé aux autres même dans le vide.
   */
  private recevoirCoup(j: JoueurSalle, coup: Extract<MessageClient, { t: "coup" }>, maintenant: number): Sortie[] {
    if (!j.enJeu || !j.vivant || this.phase !== "jeu" || this.pilote(j.id) || this.br?.enVol(j.id)) return [];
    if (j.main !== "couteau" || !estMelee(j.arme)) return [];
    const arme: ArmeMeleeId = j.arme;
    const m = MELEE[arme];
    // BR : dégâts de mêlée propres au mode (3 coups de couteau, 2 d'épée), le couteau de l'arène tuerait en un coup
    const degatsCoup = this.br ? degatsMeleeBr(arme) : m.degats;
    if (!CONDUCTEUR_TIRE && this.vehicules?.estConducteur(j.id)) return [];
    if (!this.sortie(j, maintenant)) return [];
    if (!estVec3(coup.o) || !estVec3(coup.d)) return [];
    const dirs = this.validerVisee(j, coup.o, [coup.d], maintenant);
    if (!dirs) return [];
    if (!this.cadenceOk(j, arme, m.cadenceS, false, maintenant)) return [];
    j.protegeJusqua = 0;
    const d = dirs[0];
    const sorties: Sortie[] = [{ a: "tous", sauf: j.id, m: { t: "coup", id: j.id, o: coup.o, d, arme } }];
    // `cibles` vient du réseau : un tableau absent ou mal formé (ancien format `cible`, client truqué) vaut un coup dans le vide
    const ids = Array.isArray(coup.cibles)
      ? [...new Set(coup.cibles.filter((x): x is string => typeof x === "string"))].slice(0, m.nbCiblesMax)
      : [];
    let premierTigre = true;
    let presence = false;
    for (const id of ids) {
      if (this.phase !== "jeu") break; // un coup précédent de la salve a mis fin au match : la suite ne compte plus
      if (this.zombies) {
        if (!estIdZombie(id)) continue; // pas de coup allié
        const vu = this.zombies.toucheMelee(id, coup.o, d, m.portee + m.margePortee, m.cosCone, maintenant);
        if (!vu) continue;
        sorties.push(...this.zombies.blesser(id, this.zombies.degatsMelee(j, arme, maintenant), j, "corps", maintenant, { melee: true, arme, gain: premierTigre }));
        premierTigre = false;
        continue;
      }
      if (this.tigres?.estTigre(id)) {
        // tigre largué de l'arène : mêmes règles que pour un joueur (positions rejouées), portée et cône de l'arme en main
        if (this.tigres.validerCoup(j, id, coup.o, d, maintenant, REWIND_MELEE_MS, arme)) {
          sorties.push(...this.tigres.blesser(id, degatsCoup, j, "corps", maintenant));
        }
        continue;
      }
      const c = this.table.get(id);
      if (!c || c.id === j.id || !c.enJeu || !c.vivant || maintenant < c.protegeJusqua) continue;
      const vue = this.positionsCible(c, maintenant, REWIND_MELEE_MS).find((pos) =>
        coupVraisemblable(this.monde, coup.o, d, { id: c.id, p: pos.p, vivant: true, accroupi: pos.accroupi }, arme));
      if (!vue) continue;
      for (const s of this.infliger(c, degatsCoup, j, "arme", "corps", arme, maintenant, coup.o)) {
        // une épée qui tue plusieurs joueurs : une seule présence (la dernière, qui a tous les scores), avant la fin de match éventuelle
        if (s.m.t === "presence") { presence = true; continue; }
        sorties.push(s);
      }
    }
    if (presence) {
      const i = sorties.findIndex((s) => s.m.t === "match");
      sorties.splice(i < 0 ? sorties.length : i, 0, this.presence());
    }
    return sorties;
  }

  // ---------- tableau des scores ----------

  /**
   * Tab ouvert ou refermé. Le serveur ignore `vueScores` d'un client hors arène ; l'ouverture est suivie d'un `scores` IMMÉDIAT
   * (un par 250 ms au plus), puis d'un par seconde dans `tic`. Une ouverture trop rapprochée est seulement mémorisée : `tic` y répond
   * dès que 250 ms se sont écoulées.
   */
  private vueScores(j: JoueurSalle, ouvert: unknown, maintenant: number): Sortie[] {
    if (!j.enJeu || typeof ouvert !== "boolean") return [];
    j.scoresOuvert = ouvert;
    if (!ouvert) { j.scoresDemandeT = -Infinity; return []; }
    if (maintenant - j.scoresEnvoyeT >= SCORES_ANTI_RAFALE_MS) {
      j.scoresEnvoyeT = maintenant;
      j.scoresDemandeT = -Infinity;
      return [{ a: j.id, m: { t: "scores", lignes: this.lignesStats() } }];
    }
    j.scoresDemandeT = maintenant;
    return [];
  }

  private sortiesScores(maintenant: number): Sortie[] {
    const sorties: Sortie[] = [];
    let lignes: LigneStats[] | null = null;
    for (const j of this.table.values()) {
      if (!j.enJeu || !j.scoresOuvert) continue;
      const depuis = maintenant - j.scoresEnvoyeT;
      const enAttente = j.scoresDemandeT > -Infinity;
      if (depuis < SCORES_PERIODE_MS && !(enAttente && depuis >= SCORES_ANTI_RAFALE_MS)) continue;
      j.scoresEnvoyeT = maintenant;
      j.scoresDemandeT = -Infinity;
      lignes ??= this.lignesStats();
      sorties.push({ a: j.id, m: { t: "scores", lignes } });
    }
    return sorties;
  }

  // ---------- temps ----------

  tic(maintenant: number): Sortie[] {
    const dt = Math.max(0, (maintenant - this.dernierTicT) / 1000);
    this.dernierTicT = maintenant;
    const sorties: Sortie[] = [];
    // zombies et BR : pas de cycle de matchs (la partie est celle du service)
    if (!this.zombies && !this.br) {
      if (this.phase === "entracte" && this.prochain !== null && maintenant >= this.prochain) {
        sorties.push(...this.demarrerMatch(maintenant));
      } else if (this.phase === "jeu" && this.fin !== null && maintenant >= this.fin) {
        sorties.push(...this.terminer(maintenant));
      }
    }
    // régénération : +20 PV/s après 5 s sans dégât (le bouclier ne se régénère pas)
    // (v7, zombies : 60 PV/s après 3 s, jusqu'à 250 PV avec le Gratin) (v8, BR : aucune régénération)
    for (const j of this.table.values()) if (j.enJeu && j.vivant) regenerer(j, maintenant, dt, this.zombies?.sante(j) ?? (this.br ? REGLES_SANTE_BR : undefined));
    if (this.elsa) sorties.push(...this.elsa.tic(maintenant));
    if (this.vehicules) sorties.push(...this.vehicules.tic(maintenant));
    if (this.tigres) sorties.push(...this.tigres.tic(maintenant));
    if (this.evenements) sorties.push(...this.evenements.tic(maintenant));
    if (this.zombies) sorties.push(...this.zombies.tic(maintenant));
    if (this.br) sorties.push(...this.br.tic(maintenant));

    // Bus C3 express (arène seulement)
    const bus = this.busC3;
    const evtsBus = bus ? avancerBusC3(bus, maintenant, this.alea) : [];
    for (const eb of evtsBus) {
      if (eb.type === "annonce") {
        sorties.push({ a: "joueurs", m: { t: "busC3", evenement: "annonce" } });
      } else if (eb.type === "debutCourse") {
        sorties.push({ a: "joueurs", m: { t: "busC3", evenement: "passage", p: eb.p, cap: eb.cap, v: eb.v } });
      } else if (eb.type === "finCourse") {
        sorties.push({ a: "joueurs", m: { t: "busC3", evenement: "fin" } });
      }
    }

    if (bus && bus.phase === "course") {
      for (const j of this.table.values()) {
        if (!j.enJeu || !j.vivant) continue;
        if (estSurLeToit(j.p, bus.p, bus.cap)) {
          bus.passagers.add(j.id);
          j.v[0] = Math.sin(bus.cap) * bus.v;
          j.v[2] = -Math.cos(bus.cap) * bus.v;
          continue;
        } else {
          bus.passagers.delete(j.id);
        }

        const estDansVehicule = !!this.vehicules?.occupation(j.id);
        if (!estDansVehicule && ecraseParBus(j.p, bus.p, bus.cap)) {
          sorties.push(...this.tuer(j, null, "bus_c3", maintenant));
        }
      }
    }

    // Ramassage d'armes uniques larguées par le bus C3
    for (const j of bus ? this.table.values() : []) {
      if (!j.enJeu || !j.vivant) continue;
      const ramasse = ramasserArmeC3(bus!, j.p);
      if (ramasse) {
        j.equip.speciale = ramasse.arme;
        j.munSpeciale = ramasse.arme === "lance_grenades" ? 6 : ramasse.arme === "bazooka" ? 3 : 3;
        this.memoriserPrecedent(j);
        j.main = "speciale";
        j.arme = ramasse.arme;
        sorties.push(
          { a: j.id, m: { t: "equipement", equip: copierEquipement(j.equip), main: "speciale", munSpeciale: j.munSpeciale } },
          { a: "joueurs", m: { t: "ramassageArme", id: ramasse.id, par: j.pseudo, arme: ramasse.arme } }
        );
      }
    }

    // Frappes aériennes en cours
    for (const f of this.frappesEnCours) {
      const impacts = verifierImpactsFrappe(f, maintenant);
      for (const imp of impacts) {
        sorties.push({ a: "joueurs", m: { t: "explosionMonstre", p: imp.p, rayon: imp.rayonM } });
        const tireur = this.joueur(f.joueur) ?? null;
        for (const j of this.table.values()) {
          if (!j.enJeu || !j.vivant || j.id === f.joueur) continue;
          const d = Math.hypot(j.p[0] - imp.p[0], j.p[2] - imp.p[2]);
          if (d <= imp.rayonM) {
            const deg = degatsImpactFrappe(d);
            sorties.push(...this.infliger(j, deg, tireur, "frappe_aerienne", "corps", "bazooka", maintenant, imp.p));
          }
        }
      }
    }
    this.frappesEnCours = this.frappesEnCours.filter((f) => maintenant < f.finT);

    // Nuages de fumée expirés
    this.nuagesFumee = this.nuagesFumee.filter((n) => maintenant < n.finT);
    let evince = false;
    for (const j of this.table.values()) {
      if (j.enJeu && !j.vivant && j.reapparitionT !== null && maintenant >= j.reapparitionT) {
        sorties.push(this.placer(j, maintenant));
      } else if (j.enJeu && j.vivant && maintenant - j.etatT > (this.br ? BR.inactifMs : INACTIF_MS) && !this.br?.enVol(j.id)) {
        // plus aucun état accepté : onglet gelé ou connexion zombie. Sinon il resterait en cible immobile.
        // (BR : seulement hors vol, le service rafraîchit `etatT` à bord et en chute ; le joueur est éliminé par `liberer`)
        sorties.push(...this.retirerDeLArene(j, maintenant));
        evince = true;
      }
    }
    if (evince) {
      if (this.br) this.presenceSale = true;
      else sorties.push(this.presence());
    }
    // BR : une seule `presence` fusionnée par tic (entrées en rafale, morts, évictions)
    if (this.presenceSale) {
      this.presenceSale = false;
      sorties.push(this.presence());
    }
    if (maintenant >= this.prochainSnap) {
      const periode = 1000 / (this.br ? BR.snapHz : JEU.snapHz);
      this.prochainSnap += periode;
      if (this.prochainSnap <= maintenant) this.prochainSnap = maintenant + periode;
      if (this.nombreEnJeu() > 0) sorties.push(...this.sortiesSnap(maintenant));
    }
    sorties.push(...this.sortiesScores(maintenant));
    return sorties;
  }

  /**
   * Instantané : aux joueurs en arène à 20 Hz avec les véhicules et les tigres, aux spectateurs de la vue Palantir (inscrits hors arène) un sur deux
   * (10 Hz), sans véhicules, et seulement s'il y en a.
   */
  private sortiesSnap(maintenant: number): Sortie[] {
    const j = this.snap(maintenant);
    const vehicules = this.vehicules?.snap() ?? [];
    const tigres = this.tigres?.snap() ?? [];
    const monstresBase = this.evenements?.snap() ?? null;
    const zombies = this.zombies?.snap() ?? null;
    const bus = this.busC3;
    const monstres: MonstresSnap | null = bus
      ? {
        ...(monstresBase ?? {}),
        bus: busEnSnap(bus),
        armesLachees: armesEnSnap(bus),
        fumigenes: nuagesEnSnap(this.nuagesFumee),
        frappes: this.frappesEnCours.map((f) => ({ id: f.id, cible: f.cible, joueur: f.joueur, t0: f.t0, finT: f.finT })),
      }
      : monstresBase;
    const sorties: Sortie[] = [{
      a: "joueurs",
      m: {
        t: "snap", ts: maintenant, j, ...(vehicules.length ? { vehicules } : {}), ...(tigres.length ? { tigres } : {}),
        ...(monstres ? { monstres } : {}), ...(zombies ? { zombies } : {}),
      },
    }];
    // zombies : le lobby n'a rien à voir de la partie (ni joueurs ni tigres)
    if (!this.zombies && !this.br && this.rangSnap++ % 2 === 0 && this.nombreJoueurs() > this.nombreEnJeu()) {
      sorties.push({ a: "spectateurs", m: { t: "snap", ts: maintenant, j } });
    }
    return sorties;
  }

  /** Instantané sérialisé : p et v au centime, angles au milliradian ; `bouclier`, `accroupi`, `glisse` et `vehicule` seulement s'ils sont non nuls. */
  private snap(maintenant: number): EtatJoueurSnap[] {
    const r: EtatJoueurSnap[] = [];
    for (const j of this.table.values()) {
      if (!j.enJeu) continue;
      if (this.br) {
        // BR : un joueur à bord n'est ni dessiné ni touchable ; un mort sort du snap `retraitMortSnapMs` après sa mort (il reste dans `presence`)
        if (this.br.aBord(j.id)) continue;
        const mort = this.mortT.get(j.id);
        if (!j.vivant && mort !== undefined && maintenant - mort > BR.retraitMortSnapMs) continue;
      }
      const occupation = this.vehicules?.occupation(j.id) ?? null;
      const chute = this.br?.chute(j.id);
      r.push({
        id: j.id, p: cm(j.p), v: cm(j.v), lacet: mrad(j.lacet), tangage: mrad(j.tangage),
        posture: j.vivant ? j.posture : "mort", mur: j.mur, arme: j.arme, pv: j.pv,
        ...(j.bouclier > 0 ? { bouclier: j.bouclier } : {}),
        ...(j.accroupi ? { accroupi: true } : {}),
        ...(j.accroupi && j.glisse && j.vivant ? { glisse: true } : {}),
        ...(occupation ? { vehicule: { id: occupation.vehicule, siege: occupation.siege } } : {}),
        ...(this.pilote(j.id) ? { titan: true } : {}),
        ...(chute ? { chute } : {}),
        vivant: j.vivant,
        protege: j.vivant && maintenant < j.protegeJusqua,
      });
    }
    return r;
  }

  /** Fin du match (objectif atteint ou temps écoulé) : classement affiché pendant l'entracte. */
  private terminer(maintenant: number): Sortie[] {
    if (this.phase !== "jeu") return [];
    this.phase = "entracte";
    this.fin = null;
    this.prochain = maintenant + JEU.entracteMs;
    return [{ a: "tous", m: { t: "match", match: this.infoMatch(), classement: this.classement() } }];
  }

  /** Nouveau match : scores et statistiques à 0, Elsa et véhicules remis à zéro, tout le monde en jeu réapparaît. */
  private demarrerMatch(maintenant: number): Sortie[] {
    this.numero++;
    this.phase = "jeu";
    this.fin = maintenant + JEU.dureeMatchMs;
    this.prochain = null;
    const sorties: Sortie[] = [];
    this.elsa?.reinitialiser(maintenant);
    if (this.vehicules) sorties.push(...this.vehicules.reinitialiser(maintenant));
    if (this.tigres) sorties.push(...this.tigres.reinitialiser(maintenant));
    if (this.evenements) sorties.push(...this.evenements.reinitialiser(maintenant));
    this.frappesDisponibles.clear();
    this.frappesEnCours = [];
    this.nuagesFumee = [];
    this.dernierFumigene.clear();
    for (const j of this.table.values()) {
      j.kills = 0;
      j.morts = 0;
      j.tirs = 0;
      j.touches = 0;
      j.tetes = 0;
      j.degats = 0;
      j.serie = 0;
      j.serieMax = 0;
      j.killsParArme = {};
      j.memoSante = null;
      j.reentreeT = -Infinity; // nouveau match : plus d'attente en cours pour personne
      if (j.enJeu) { j.vivant = false; j.reapparitionT = null; }
    }
    sorties.push({ a: "tous", m: { t: "match", match: this.infoMatch(), classement: this.classement() } });
    for (const j of this.table.values()) if (j.enJeu) sorties.push(this.placer(j, maintenant));
    sorties.push(this.presence());
    return sorties;
  }

  // ---------- apparition ----------

  /**
   * Fait (ré)apparaître un joueur : point de la zone du rond-point (règle de bande, §2.10) ou, sans `zoneApparition`, le plus éloigné des
   * vivants (parmi les 6 meilleurs) ; équipement choisi (copie propre, sans spéciale) ; santé restaurée si le joueur revient dans les
   * 60 s d'une sortie en vie, sinon 100 PV et 0 bouclier.
   */
  private placer(j: JoueurSalle, maintenant: number): Sortie {
    const [x, z] = this.choisirApparition(j.id);
    let lacet: number;
    if (this.zone) {
      // regard vers le centre du rond-point, ± 0,6 rad (pas de face-à-face systématique)
      lacet = lacetVers([x, z], this.zone.centre) + (this.alea() * 2 - 1) * REGARD_ALEA_RAD;
    } else {
      // regard vers le centre de l'arène (lacet 0 = −z)
      const b = this.monde.bornes;
      lacet = Math.atan2(-((b.x0 + b.x1) / 2 - x), -((b.z0 + b.z1) / 2 - z));
    }
    const suivi = this.suivi.get(j.id);
    j.p = [x, 0, z];
    j.v = [0, 0, 0];
    j.lacet = lacet;
    j.tangage = 0;
    j.posture = "sol";
    j.mur = 0;
    j.accroupi = false;
    j.glisse = false;
    j.seq = -1; // §13.2.2 : le client repart de seq 0 (voir `rejoindre`)
    j.equip = copierEquipement({ ...(suivi?.prochain ?? EQUIPEMENT_DEFAUT), speciale: null });
    j.main = j.mainSuivante;
    j.arme = armeDuSlot(j.equip, j.main) ?? j.equip.secondaire;
    j.munSpeciale = 0;
    j.sortieJusqua = maintenant;
    j.cadenceArme = {};
    j.prochainTir = -Infinity;
    // une rentrée qui restaure la santé d'un joueur sorti en vie n'est pas une vraie réapparition : pas de protection (pas d'échappatoire)
    const restaure = restaurerSante(j, j.memoSante, maintenant);
    if (!restaure) reinitialiserSante(j, maintenant);
    j.memoSante = null;
    j.vivant = true;
    j.protegeJusqua = restaure ? 0 : maintenant + JEU.protectionMs;
    j.reapparitionT = null;
    j.etatT = maintenant;
    j.histo = [];
    if (suivi) suivi.precedent = j.main === "principale" ? "secondaire" : "principale";
    return {
      a: "tous",
      m: {
        t: "apparition", id: j.id, p: j.p, lacet, arme: j.arme, pv: j.pv, bouclier: j.bouclier,
        equip: copierEquipement(j.equip), main: j.main, munSpeciale: j.munSpeciale,
      },
    };
  }

  private choisirApparition(id: string): Vec2 {
    const points = this.apparitions;
    const vivants = [...this.table.values()].filter((o) => o.id !== id && o.enJeu && o.vivant);
    if (this.zone) {
      return choisirPointZone(points, vivants.map((o): Vec2 => [o.p[0], o.p[2]]), this.zone, this.alea);
    }
    if (!points.length) {
      const b = this.monde.bornes;
      return [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
    }
    if (!vivants.length) return points[Math.min(points.length - 1, Math.floor(this.alea() * points.length))];
    const notes = points.map((pt) => {
      let dmin = Infinity;
      for (const o of vivants) dmin = Math.min(dmin, (o.p[0] - pt[0]) ** 2 + (o.p[2] - pt[1]) ** 2);
      return { pt, dmin };
    });
    notes.sort((a, b) => b.dmin - a.dmin);
    const n = Math.min(APPARITIONS_CANDIDATES, notes.length);
    return notes[Math.min(n - 1, Math.floor(this.alea() * n))].pt;
  }

  presence(): Sortie {
    return { a: "tous", m: { t: "presence", joueurs: this.joueursPublics() } };
  }
}

/**
 * Couleur d'un joueur quand les 16 de `PALETTE` sont prises (50 joueurs en BR) : le premier rang de `couleurJoueur` à partir de 16 dont la
 * couleur est libre (une couleur rendue par un départ est réutilisée, jamais deux joueurs de la même couleur).
 */
function couleurAuDela(prises: ReadonlySet<string>): string {
  let rang = PALETTE.length;
  let couleur = couleurJoueur(rang);
  while (prises.has(couleur) && rang < PALETTE.length + 1000) couleur = couleurJoueur(++rang);
  return couleur;
}

/** Arme du plus grand nombre de kills du match (égalité : la première à avoir marqué) ; null sans kill à l'arme. */
function armeFavorite(j: JoueurSalle): ArmeId | null {
  let fav: ArmeId | null = null;
  let max = 0;
  for (const [arme, n] of Object.entries(j.killsParArme) as [ArmeId, number][]) {
    if (n > max) { max = n; fav = arme; }
  }
  return fav;
}
