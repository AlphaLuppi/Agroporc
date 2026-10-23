/**
 * Logique serveur de l'arène FPS (PUR : aucune I/O, ni three ni DOM ; l'horloge `maintenant` est
 * passée à chaque appel et le hasard est injecté par `alea`). Une `Salle` gère les connectés
 * (spectateurs de la vue Palantir et joueurs en jeu), les pseudos, les couleurs, les états reçus
 * (bornage de vitesse), l'équipement et le changement d'arme, les tirs et les coups de couteau (cadence, plombs,
 * portée, ligne de vue, dégâts), le bouclier et la régénération, les morts, les réapparitions, la protection
 * d'apparition et le cycle des matchs (jeu → entracte → jeu). Chaque méthode renvoie les messages à émettre : le
 * serveur Node (`serveur-fps/`) ne fait que les router.
 *
 * Elsa et les véhicules / la circulation PNJ sont des services (`match-elsa.ts`, `match-vehicules.ts`) qui ne voient
 * la salle que par `ContexteSalle` (`match-contexte.ts`), implémenté ici.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§6.1, §13) et 2026-10-23-arene-hud-design.md (§3.5)
 */
import { COUTEAU, STATS, degatsPlomb, gerbeRespectee } from "./armes";
import { ecarterDesCircuits, type Circuit, type VoiturePnj } from "./circulation";
import type { Monde } from "./collision";
import type { IntervalleElsa } from "./elsa";
import { armeDuSlot, depuisAlias, estPrincipale, estSecondaire, estSlot, normaliserEquipement } from "./equipement";
import type { ContexteSalle, JoueurSalle, ServiceElsa, ServiceVehicules, Sortie } from "./match-contexte";
import { creerServiceElsa } from "./match-elsa";
import { creerServiceVehicules } from "./match-vehicules";
import { REWIND_MELEE_MS, coupVraisemblable } from "./melee";
import {
  EQUIPEMENT_DEFAUT, JEU, PLAFONDS, SLOT_DEFAUT, copierEquipement, oeilDe, silhouetteDe,
  type ArmeFeuId, type ArmeId, type CauseMort, type EtatJoueurSnap, type Equipement, type InfoMatch, type InfoTueur,
  type JoueurPublic, type LigneClassement, type LigneStats, type MessageClient, type SignalVoix, type Slot, type Vec3, type Zone,
} from "./protocole";
import { appliquerDegats, memoriserSante, regenerer, reinitialiserSante, restaurerSante, tuer as tuerSante } from "./sante";
import { toucheVraisemblable } from "./tir";
import { choisirPointZone, lacetVers, filtrerApparitions, type ZoneApparition } from "./zones";
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
  private readonly joueurs = new Map<string, JoueurSalle>();
  private readonly suivi = new Map<string, SuiviJoueur>();
  private readonly apparitions: Vec2[];
  private readonly zone: ZoneApparition | null;
  private readonly elsa: ServiceElsa | null;
  private readonly vehicules: ServiceVehicules | null;
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
    this.fin = maintenant + JEU.dureeMatchMs;
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
      ? creerServiceElsa(this, { ...options.elsa, maintenant, aPied: (j) => !this.vehicules?.occupation(j.id) })
      : null;
    this.vehicules = options.vehicules || options.circulation
      ? creerServiceVehicules(this, { vehicules: options.vehicules, circulation: options.circulation, maintenant })
      : null;
  }

  // ---------- ContexteSalle (vue de la salle pour les services) ----------

  enPhaseJeu(): boolean { return this.phase === "jeu"; }
  joueur(id: string): JoueurSalle | undefined { return this.joueurs.get(id); }
  joueursEnJeu(): JoueurSalle[] { return [...this.joueurs.values()].filter((j) => j.enJeu); }
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
    if (!cible.enJeu || !cible.vivant) return [];
    const r = appliquerDegats(cible, degats, maintenant);
    if (r.absorbe + r.subi <= 0) return [];
    if (par && par !== cible) par.degats += r.absorbe + r.subi;
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
    if (!cible.enJeu || !cible.vivant) return [];
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
    cible.vivant = false;
    cible.posture = "mort";
    cible.mur = 0;
    cible.accroupi = false;
    cible.glisse = false;
    cible.morts++;
    cible.serie = 0;
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
    }
    sorties.push(this.presence());
    if (tueur && tueur.kills >= JEU.objectifKills) sorties.push(...this.terminer(maintenant));
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

  // ---------- lecture ----------

  infoMatch(): InfoMatch {
    return { numero: this.numero, fin: this.fin, objectif: JEU.objectifKills, phase: this.phase, prochain: this.prochain };
  }
  nombreJoueurs(): number { return this.joueurs.size; }
  nombreEnJeu(): number { let n = 0; for (const j of this.joueurs.values()) if (j.enJeu) n++; return n; }
  /** État interne d'un joueur (lecture seule : tests et supervision). */
  inspecter(id: string): Readonly<JoueurSalle> | undefined { return this.joueurs.get(id); }
  /** Équipement de la prochaine apparition d'un joueur (tests et supervision) ; l'équipement en cours est `inspecter(id).equip`. */
  equipementProchain(id: string): Readonly<Equipement> | undefined { return this.suivi.get(id)?.prochain; }
  joueursPublics(): JoueurPublic[] {
    return [...this.joueurs.values()].map((j) => ({
      id: j.id, pseudo: j.pseudo, couleur: j.couleur, enJeu: j.enJeu, kills: j.kills, morts: j.morts, ping: j.ping,
      ...(j.serie > 0 ? { serie: j.serie } : {}),
      ...(j.voix ? { voix: true } : {}),
    }));
  }
  classement(): LigneClassement[] {
    return [...this.joueurs.values()]
      .filter((j) => j.enJeu || j.kills > 0 || j.morts > 0)
      .sort((a, b) => b.kills - a.kills || a.morts - b.morts || a.pseudo.localeCompare(b.pseudo, "fr"))
      .map((j) => ({
        id: j.id, pseudo: j.pseudo, couleur: j.couleur, kills: j.kills, morts: j.morts,
        serie: j.serie, serieMax: j.serieMax, tirs: j.tirs, touches: j.touches, tetes: j.tetes, degats: j.degats, armeFav: armeFavorite(j),
      }));
  }
  /** Statistiques du match de tous les joueurs du classement (message `scores`). */
  lignesStats(): LigneStats[] {
    return [...this.joueurs.values()]
      .filter((j) => j.enJeu || j.kills > 0 || j.morts > 0)
      .map((j) => ({
        id: j.id, serie: j.serie, serieMax: j.serieMax, tirs: j.tirs, touches: j.touches, tetes: j.tetes, degats: j.degats,
        armeFav: armeFavorite(j), vivant: j.enJeu && j.vivant, vehicule: this.vehicules?.occupation(j.id) != null,
      }));
  }
  /** Dernière mesure de latence (ms), mesurée par le serveur ; pas de diffusion immédiate. */
  majPing(id: string, ms: number): void {
    const j = this.joueurs.get(id);
    if (j && estNombre(ms) && ms >= 0) j.ping = Math.round(ms);
  }

  // ---------- connexion ----------

  connecter(id: string, pseudo: string, maintenant: number): Sortie[] {
    if (this.joueurs.has(id)) return [];
    // la capacité de JEU (16) se contrôle à `rejoindre` : les spectateurs de la vue 3D ne doivent pas la saturer
    if (this.joueurs.size >= JEU.connexionsMax) {
      return [{ a: id, m: { t: "erreur", code: "plein", message: "Le serveur de l'arène est saturé, réessayez plus tard." } }];
    }
    const pris = new Set([...this.joueurs.values()].map((j) => j.pseudo.toLocaleLowerCase("fr")));
    const couleursPrises = new Set([...this.joueurs.values()].map((j) => j.couleur));
    const couleur = PALETTE.find((c) => !couleursPrises.has(c)) ?? PALETTE[this.joueurs.size % PALETTE.length];
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
    this.joueurs.set(id, j);
    this.suivi.set(id, { prochain: copierEquipement(EQUIPEMENT_DEFAUT), precedent: "principale" });
    return [
      { a: id, m: { t: "bienvenue", id, couleur, joueurs: this.joueursPublics(), match: this.infoMatch(), maintenant } },
      { a: "tous", sauf: id, m: { t: "presence", joueurs: this.joueursPublics() } },
    ];
  }

  deconnecter(id: string, maintenant: number): Sortie[] {
    const j = this.joueurs.get(id);
    if (!j) return [];
    // le siège est libéré AVANT de retirer le joueur (voiture arrêtée, `sieges` diffusé)
    const liberation = j.enJeu && this.vehicules ? this.vehicules.liberer(j, maintenant) : [];
    this.joueurs.delete(id);
    this.suivi.delete(id);
    return [...liberation, this.presence()];
  }

  // ---------- messages des clients ----------

  recevoir(id: string, msg: MessageClient, maintenant: number): Sortie[] {
    const j = this.joueurs.get(id);
    if (!j || !msg || typeof msg !== "object") return [];
    switch (msg.t) {
      case "pseudo": return this.renommer(j, msg.pseudo, maintenant);
      case "rejoindre": return this.rejoindre(j, msg, maintenant);
      case "quitter": return this.quitter(j, maintenant);
      case "arme": this.choisir(j, { arme: msg.arme }); return [];
      case "equiper": this.choisir(j, msg); return [];
      case "main": return this.changerMain(j, msg.slot, maintenant);
      case "etat": this.recevoirEtat(j, msg, maintenant); return [];
      case "tir": return this.recevoirTir(j, msg, maintenant);
      case "coup": return this.recevoirCoup(j, msg, maintenant);
      case "monter": case "descendre": case "siege": case "conduite":
        return j.enJeu && this.vehicules ? this.vehicules.recevoir(j, msg, maintenant) : [];
      case "vueScores": return this.vueScores(j, msg.ouvert, maintenant);
      case "voixActif": return this.voixActif(j, msg.actif);
      case "voix": return this.relayerVoix(j, msg.a, msg.s);
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
    const dest = this.joueurs.get(a);
    if (!dest || !j.voix || !dest.voix || !j.enJeu || !dest.enJeu) return [];
    return [{ a, m: { t: "voix", de: j.id, s } }];
  }

  /** Au plus `RENOMMER_MAX` changements par fenêtre (chaque changement diffuse la présence à tous). */
  private renommer(j: JoueurSalle, brut: unknown, maintenant: number): Sortie[] {
    j.renommages = j.renommages.filter((t) => maintenant - t < RENOMMER_FENETRE_MS);
    if (j.renommages.length >= RENOMMER_MAX) return [];
    const base = nettoyerPseudo(brut);
    const pris = new Set([...this.joueurs.values()].filter((x) => x !== j).map((x) => x.pseudo.toLocaleLowerCase("fr")));
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
    return sorties;
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
    j.memoSante = j.vivant ? memoriserSante(j, maintenant) : null;
    // un mort garde son délai de réapparition (sans le raccourcir en quittant) ; un vivant doit attendre le même délai avant de revenir
    j.reentreeT = j.vivant
      ? maintenant + JEU.delaiReapparitionMs
      : j.enJeu && j.reapparitionT !== null ? j.reapparitionT : -Infinity;
    const liberation = this.vehicules ? this.vehicules.liberer(j, maintenant) : [];
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
    return [];
  }

  /** État prédit par le client : accepté s'il reste dans les bornes et dans la vitesse permise. */
  private recevoirEtat(j: JoueurSalle, e: Extract<MessageClient, { t: "etat" }>, maintenant: number): void {
    if (!j.enJeu || !j.vivant) return;
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
    while (j.histo.length > 1 && maintenant - j.histo[0].t > HISTORIQUE_MS) j.histo.shift();
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
    const yeux = this.vehicules?.oeilsPossibles(j, maintenant, REWIND_MAX_MS) ?? null;
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
    if (!j.enJeu || !j.vivant || this.phase !== "jeu") return [];
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
    if (!this.cadenceOk(j, armeTiree, arme.cadenceS, arme.auto, maintenant)) return [];
    j.protegeJusqua = 0; // tirer annule la protection d'apparition
    j.tirs++;

    const sorties: Sortie[] = [{ a: "tous", sauf: j.id, m: { t: "tir", id: j.id, arme: armeTiree, o: tir.o, d: dirs } }];
    // arme spéciale : une munition de moins ; à 0, l'arme disparaît et le joueur retombe sur le slot précédent
    if (j.main === "speciale") sorties.push(...this.consommerSpeciale(j, maintenant));

    const touches = Array.isArray(tir.touches) ? tir.touches : [];
    const plombsVus = new Set<number>();
    const cumul = new Map<string, { degats: number; zone: Zone }>();
    for (const t of touches) {
      if (!t || typeof t.cible !== "string" || !estZone(t.zone) || !Number.isInteger(t.plomb)) continue;
      if (t.plomb < 0 || t.plomb >= dirs.length || plombsVus.has(t.plomb)) continue;
      const c = this.joueurs.get(t.cible);
      if (!c || c.id === j.id || !c.enJeu || !c.vivant || maintenant < c.protegeJusqua) continue;
      const vitesseCible = Math.hypot(c.v[0], c.v[1], c.v[2]);
      const vue = this.positionsCible(c, maintenant, REWIND_MAX_MS).find((pos) =>
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

    if (cumul.size > 0) {
      j.touches++;
      if ([...cumul.values()].some((cu) => cu.zone === "tete")) j.tetes++;
    }
    let presence = false;
    for (const [cibleId, { degats, zone }] of cumul) {
      for (const s of this.infliger(this.joueurs.get(cibleId)!, degats, j, "arme", zone, armeTiree, maintenant, tir.o)) {
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
    return sorties;
  }

  /** Une munition de l'arme spéciale tirée ; à 0 elle est retirée, retour au slot précédent et message `equipement` au joueur. */
  private consommerSpeciale(j: JoueurSalle, maintenant: number): Sortie[] {
    j.munSpeciale = Math.max(0, j.munSpeciale - 1);
    if (j.munSpeciale > 0) return [];
    j.equip.speciale = null;
    const precedent = this.suivi.get(j.id)?.precedent;
    const retour: Slot = precedent && precedent !== "speciale" && armeDuSlot(j.equip, precedent) !== null ? precedent : "principale";
    j.main = retour;
    j.arme = armeDuSlot(j.equip, retour) ?? j.equip.principale;
    j.sortieJusqua = maintenant + JEU.degainageMs;
    return [{ a: j.id, m: { t: "equipement", equip: copierEquipement(j.equip), main: j.main, munSpeciale: 0 } }];
  }

  /**
   * Un coup de couteau : mêmes contrôles anti-triche que le tir (arme en main, dégainage, cadence 0,5 s, œil, direction, angle de visée),
   * puis `coupVraisemblable` (portée de surface + marge, cône, ligne de vue) sur les positions de la cible rejouées sur
   * `REWIND_MELEE_MS`. 100 dégâts : tue un joueur sans bouclier. Le coup est diffusé aux autres même dans le vide.
   */
  private recevoirCoup(j: JoueurSalle, coup: Extract<MessageClient, { t: "coup" }>, maintenant: number): Sortie[] {
    if (!j.enJeu || !j.vivant || this.phase !== "jeu") return [];
    if (j.main !== "couteau" || j.arme !== "couteau") return [];
    if (!CONDUCTEUR_TIRE && this.vehicules?.estConducteur(j.id)) return [];
    if (!this.sortie(j, maintenant)) return [];
    if (!estVec3(coup.o) || !estVec3(coup.d)) return [];
    const dirs = this.validerVisee(j, coup.o, [coup.d], maintenant);
    if (!dirs) return [];
    if (!this.cadenceOk(j, "couteau", COUTEAU.cadenceS, false, maintenant)) return [];
    j.protegeJusqua = 0;
    const d = dirs[0];
    const sorties: Sortie[] = [{ a: "tous", sauf: j.id, m: { t: "coup", id: j.id, o: coup.o, d } }];
    const c = typeof coup.cible === "string" ? this.joueurs.get(coup.cible) : undefined;
    if (!c || c.id === j.id || !c.enJeu || !c.vivant || maintenant < c.protegeJusqua) return sorties;
    const vitesseCible = Math.hypot(c.v[0], c.v[1], c.v[2]);
    const vue = this.positionsCible(c, maintenant, REWIND_MELEE_MS).find((pos) =>
      coupVraisemblable(this.monde, coup.o, d, { id: c.id, p: pos.p, vivant: true, accroupi: pos.accroupi }, vitesseCible));
    if (vue) sorties.push(...this.infliger(c, COUTEAU.degats, j, "arme", "corps", "couteau", maintenant, coup.o));
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
    for (const j of this.joueurs.values()) {
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
    if (this.phase === "entracte" && this.prochain !== null && maintenant >= this.prochain) {
      sorties.push(...this.demarrerMatch(maintenant));
    } else if (this.phase === "jeu" && this.fin !== null && maintenant >= this.fin) {
      sorties.push(...this.terminer(maintenant));
    }
    // régénération : +20 PV/s après 5 s sans dégât (le bouclier ne se régénère pas)
    for (const j of this.joueurs.values()) if (j.enJeu && j.vivant) regenerer(j, maintenant, dt);
    if (this.elsa) sorties.push(...this.elsa.tic(maintenant));
    if (this.vehicules) sorties.push(...this.vehicules.tic(maintenant));
    let evince = false;
    for (const j of this.joueurs.values()) {
      if (j.enJeu && !j.vivant && j.reapparitionT !== null && maintenant >= j.reapparitionT) {
        sorties.push(this.placer(j, maintenant));
      } else if (j.enJeu && j.vivant && maintenant - j.etatT > INACTIF_MS) {
        // plus aucun état accepté : onglet gelé ou connexion zombie. Sinon il resterait en cible immobile.
        sorties.push(...this.retirerDeLArene(j, maintenant));
        evince = true;
      }
    }
    if (evince) sorties.push(this.presence());
    if (maintenant >= this.prochainSnap) {
      const periode = 1000 / JEU.snapHz;
      this.prochainSnap += periode;
      if (this.prochainSnap <= maintenant) this.prochainSnap = maintenant + periode;
      if (this.nombreEnJeu() > 0) sorties.push(...this.sortiesSnap(maintenant));
    }
    sorties.push(...this.sortiesScores(maintenant));
    return sorties;
  }

  /**
   * Instantané : aux joueurs en arène à 20 Hz avec les véhicules ; aux spectateurs de la vue Palantir (inscrits hors arène) un sur deux
   * (10 Hz), sans véhicules, et seulement s'il y en a.
   */
  private sortiesSnap(maintenant: number): Sortie[] {
    const j = this.snap(maintenant);
    const vehicules = this.vehicules?.snap() ?? [];
    const sorties: Sortie[] = [{ a: "joueurs", m: { t: "snap", ts: maintenant, j, ...(vehicules.length ? { vehicules } : {}) } }];
    if (this.rangSnap++ % 2 === 0 && this.nombreJoueurs() > this.nombreEnJeu()) {
      sorties.push({ a: "spectateurs", m: { t: "snap", ts: maintenant, j } });
    }
    return sorties;
  }

  /** Instantané sérialisé : p et v au centime, angles au milliradian ; `bouclier`, `accroupi`, `glisse` et `vehicule` seulement s'ils sont non nuls. */
  private snap(maintenant: number): EtatJoueurSnap[] {
    const r: EtatJoueurSnap[] = [];
    for (const j of this.joueurs.values()) {
      if (!j.enJeu) continue;
      const occupation = this.vehicules?.occupation(j.id) ?? null;
      r.push({
        id: j.id, p: cm(j.p), v: cm(j.v), lacet: mrad(j.lacet), tangage: mrad(j.tangage),
        posture: j.vivant ? j.posture : "mort", mur: j.mur, arme: j.arme, pv: j.pv,
        ...(j.bouclier > 0 ? { bouclier: j.bouclier } : {}),
        ...(j.accroupi ? { accroupi: true } : {}),
        ...(j.accroupi && j.glisse && j.vivant ? { glisse: true } : {}),
        ...(occupation ? { vehicule: { id: occupation.vehicule, siege: occupation.siege } } : {}),
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
    for (const j of this.joueurs.values()) {
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
    for (const j of this.joueurs.values()) if (j.enJeu) sorties.push(this.placer(j, maintenant));
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
    const vivants = [...this.joueurs.values()].filter((o) => o.id !== id && o.enJeu && o.vivant);
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

  private presence(): Sortie {
    return { a: "tous", m: { t: "presence", joueurs: this.joueursPublics() } };
  }
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
