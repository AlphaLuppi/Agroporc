/**
 * Service « zombies tigres » de la salle, façon Black Ops 1 (PUR : l'horloge `maintenant` est passée à chaque appel, le hasard est injecté
 * par `alea` ; ne voit la salle que par `ContexteSalle`). Machine d'états lobby → pause → manche → pause … → fin → lobby, hôte, difficulté,
 * join-in-progress, argent et points de BO1, apparitions par le gestionnaire de zones (fenêtres à planches et sorties du sol des zones
 * occupées et voisines), barricades (arrachées par les tigres, reposées par les joueurs), bonus (seuil de BO1, tigre doré, paquet mélangé),
 * atouts, Pack-a-Punch, boîte mystère qui déménage (peluche), manches du Truck Muche (les chiens de BO1), courant, Recette ultime, joueurs
 * à terre, relève, auto-relève de la Pause Café, élimination, bilan. Les tigres eux-mêmes sont simulés par `zombies.ts`.
 *
 * Choix de conception :
 * - l'argent, les atouts, l'état (debout / à terre / éliminé / en attente), l'admission et les relèves de chaque joueur vivent dans une `Map`
 *   du service (aucun champ de `JoueurSalle`) ; `kills` / `morts` de `JoueurSalle` comptent les tigres tués et les mises à terre ;
 * - aucun message `mort` : la mise à terre passe par `surMort` (appelé par `Salle.mourir`) ;
 * - `zombies{etat}` est diffusé aux changements (≤ 5 Hz), tout de suite pour les changements qui comptent ; les effets ponctuels partent en `zevt`.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md
 */
import { MELEE, STATS, chargeurZombie, degatsExplosion, degatsZombie, profilZombie } from "./armes";
import { batimentsDetruits, detruireBatiment, lancerRayon, releverBatiments, visible } from "./collision";
import { ARMES, CIBLE_LIVRAISON, copierEquipement, estIdZombie, estMelee, idZombie } from "./protocole";
import { armeDuSlot, meleeDe } from "./equipement";
import type { ContexteSalle, JoueurSalle, ResumeZombies, ServiceZombies, Sortie } from "./match-contexte";
import { instantaneNavigation, majNavigation, restaurerNavigation } from "./navigation";
import { capVers } from "./monstres";
import type {
  ArmeFeuId, ArmeId, ArmeSpecialeId, AtoutId, BonusSol, EffetsZombies, EtatBoite, EtatPap, EtatPartieZombies, Equipement, EvenementZombies,
  JoueurZombies, MessageClient, PhaseZombies, QueteZombies, RaisonAchat, Slot, TruckZombies, Vec3, Zone,
} from "./protocole";
import { creerSimuZombies, type ArriveeZombie, type SpecZombie } from "./zombies";
import {
  ACHATS, ATOUTS, ATOUTS_LISTE, DEPARTS, EMPLACEMENTS_DEPART_BOITE, FENETRES, INGREDIENTS_LISTE, NB_EMPLACEMENTS_BOITE, PORTES_PAYANTES,
  PRIX_BOITE, PRIX_BOITE_SOLDES, PRIX_MUNITIONS_AMELIOREE, QUAIS, TRUCK, achatDeId, rayonTruck, distancePorte, estAtout, etiqueterZones, fenetreDeId, fenetresDesZones,
  idPrisme, lacetDepart, pieceDe, porteDeId, sortiesDuSol, zoneEn, zonesActives, zonesOuvertes,
  type Achat, type CarteZones, type DonneesZombies, type Fenetre, type IngredientId, type PorteId, type ZoneId,
} from "./zombies-carte";
import {
  GAIN_CHEF, GAIN_MENUISIER, GAIN_NUKE, GAIN_PLANCHE, GAIN_TRUCK, ZOMBIES, allureTiree, degatsGriffe, delaiApparition, estDifficulte, gainKill,
  gainTouche, mancheTruckSuivante, paquetBonus, plafondPlanches, premiereMancheTruck, pvTruck, pvZombie, rechargeGriffe, seuilBonusInitial,
  totalTruck, typesManche, vitesseAllure, type Difficulte, type GenreBonus, type TypeZombie,
} from "./zombies-vagues";
import type { Vec2 } from "../agroparc3d/types";

/** Équipement de départ (copie à prendre avec `copierEquipement`) : pistolet et couteau seulement, pas d'arme principale. */
export const EQUIPEMENT_DEPART_ZOMBIES: Readonly<Equipement> = Object.freeze({
  principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true as const,
});
/** Slot en main au départ. */
export const MAIN_DEPART_ZOMBIES: Slot = "secondaire";

/** Période minimale (ms) entre deux `zombies{etat}` qui ne sont pas urgents (≤ 5 Hz). */
export const PERIODE_ETAT_MS = 200;
/** Plus grand pas de temps (s) donné à la simulation des tigres (un tic en retard ne téléporte pas les tigres). */
const DT_MAX_S = 0.25;
/** Hauteur (m) des points de visée pour la ligne de vue d'un achat. */
const HAUTEUR_ACHAT_M = 1.2;
/** Boîte : durée du tirage, de l'offre, de l'envol (ms) ; armes qui n'en sortent jamais. */
export const TIRAGE_BOITE_MS = 4_000;
export const OFFRE_BOITE_MS = 12_000;
export const ENVOL_BOITE_MS = 5_000;
const HORS_BOITE: ReadonlySet<ArmeFeuId> = new Set(["pistolet", "mini_uzi"]);
/** Pack-a-Punch : durée de la cuisson (ms). */
export const CUISSON_PAP_MS = 3_500;
/** Recette ultime : durée de la cuisson (ms), apparitions deux fois plus rapides pendant ce temps. */
export const CUISSON_RECETTE_MS = 30_000;
/** Pause Café en solo : auto-relève au bout de ce délai (ms), 3 fois par partie. */
export const AUTO_RELEVE_MS = 4_000;
export const AUTO_RELEVES_MAX = 3;
/** Sorties du sol entre ces distances (m) du joueur debout le plus proche. */
const SOL_DISTANCE_MIN = 8;
const SOL_DISTANCE_MAX = 35;
/** Part des apparitions par une fenêtre quand une sortie du sol est aussi possible. */
const PART_FENETRES = 0.6;
/** Rampant : un souffle non mortel qui ôte au moins cette part des PV a cette probabilité de couper les pattes arrière. */
const RAMPANT_PART_PV = 0.25;
const RAMPANT_PROBA = 0.35;
/** Plus grande marge de latence ajoutée à une portée (m). */
const MARGE_LATENCE_MAX_M = 1.5;
/** Dégâts « tue à coup sûr » de l'insta-kill. */
const INSTAKILL = 10_000_000;

export interface OptionsServiceZombies {
  /** hasard injecté, [0, 1[ */
  alea: () => number;
  /** données de la carte (départs) ; par défaut celles de `zombies-carte.ts` */
  donnees?: Pick<DonneesZombies, "departs">;
  /** argent de départ ($), `PDJ_FPS_ZOMBIES_ARGENT` */
  argentDepart?: number;
  /** nombre de tigres de la manche 1 (essais), `PDJ_FPS_ZOMBIES_TOTAL` */
  total1?: number;
  /** durée du décompte de départ ET des pauses entre manches (ms, essais), `PDJ_FPS_ZOMBIES_PAUSE_MS` */
  pauseMs?: number;
  /** dégâts de griffe imposés (essais), `PDJ_FPS_ZOMBIES_GRIFFE` */
  degatsGriffe?: number;
  /** première manche du Truck Muche imposée (essais), `PDJ_FPS_ZOMBIES_TRUCK` ; 0 = jamais */
  mancheTruck?: number;
  /** courant rétabli dès le départ (essais), `PDJ_FPS_ZOMBIES_COURANT` */
  courant?: boolean;
}

type EtatMembre = JoueurZombies["etat"];

/** Ce que le service retient d'un membre de la salle. */
interface Membre {
  etat: EtatMembre;
  admis: boolean;
  argent: number;
  gagne: number;
  reanimations: number;
  terreFinT?: number;
  /** instant de l'admission (attend son `rejoindre` au plus `attenteChargementMaxMs`) */
  admisT: number;
  atouts: Set<AtoutId>;
  /** Pause Café en solo : auto-relèves restantes, instant de la prochaine (à terre) */
  autoReleves: number;
  autoReleveT: number | null;
  /** argent gagné aux planches pendant la manche (plafond `plafondPlanches`) */
  planchesManche: number;
  /** repose de planches en cours : fenêtre, prochaine planche */
  reparation: { fenetre: string; prochainT: number } | null;
}

/** Relève en cours : `cible` maintenue par le relanceur depuis `debutT`. */
interface Releve { cible: string; debutT: number }

/** Truck Muche d'une manche de livraison (serveur). */
interface Truck {
  quai: number; phase: TruckZombies["phase"]; debutT: number; finT: number; pv: number; pvMax: number;
  p: Vec2; cap: number; aLacher: number; prochainLacherT: number;
}

/**
 * Point de départ et lacet d'un joueur qui entre : le départ le plus éloigné des autres joueurs (`autres` : leurs positions), le premier
 * si personne n'est là. Sert à `Salle.rejoindre` et au retour des éliminés.
 */
export function departPour(autres: readonly Vec3[], departs: readonly Vec2[] = DEPARTS): { p: Vec3; lacet: number; index: number } {
  let meilleur = 0, dMeilleur = -1;
  departs.forEach((d, i) => {
    let dmin = Infinity;
    for (const o of autres) dmin = Math.min(dmin, Math.hypot(o[0] - d[0], o[2] - d[1]));
    if (dmin > dMeilleur) { dMeilleur = dmin; meilleur = i; }
  });
  const d = departs[meilleur];
  return { p: [d[0], 0, d[1]], lacet: lacetDepart(meilleur), index: meilleur };
}

export function creerServiceZombies(ctx: ContexteSalle, opts: OptionsServiceZombies): ServiceZombies {
  const alea = opts.alea;
  const departs: readonly Vec2[] = opts.donnees?.departs ?? DEPARTS;
  const argentDepart = opts.argentDepart ?? ZOMBIES.argentDepart;
  const pauseMs = opts.pauseMs ?? ZOMBIES.pauseMs;
  const decompteMs = opts.pauseMs ?? ZOMBIES.decompteDepartMs;

  const planches = new Map<string, number>(FENETRES.map((f) => [f.id, ZOMBIES.planches]));
  const simu = creerSimuZombies({
    monde: ctx.monde, alea,
    barricades: {
      planches: (f) => planches.get(f) ?? 0,
      arracher: (f) => {
        const n = planches.get(f) ?? 0;
        if (n <= 0) return;
        planches.set(f, n - 1);
        sale = true;
        evenementsTic.push({ a: "joueurs", m: { t: "zevt", e: { e: "planche", fenetre: f, arrachee: true } } });
      },
    },
  });
  // grilles de navigation des tigres toutes portes fermées (calculées par `creerSimuZombies`) : remises telles quelles au retour au lobby
  // et à chaque nouvelle partie, au lieu d'un recalcul complet de 40 à 80 ms qui gelait tout le serveur
  const navigationFermee = instantaneNavigation(ctx.monde);
  // étiquettes des zones au sol et sorties du sol : calculées une fois, toutes portes fermées (le monde est neuf à la création)
  const carteZones: CarteZones = etiqueterZones(ctx.monde);
  const sorties = sortiesDuSol(carteZones);

  const membres = new Map<string, Membre>();
  const ouvertes = new Set<PorteId>();
  const releves = new Map<string, Releve>();
  /** sorties produites pendant `simu.tic` (planches arrachées), vidées dans le tic */
  let evenementsTic: Sortie[] = [];

  let phase: PhaseZombies = "lobby";
  let manche = 0;
  let debutT = 0;
  let finT = 0;
  let bilan: { manche: number; dureeMs: number } | undefined;
  let partieDebutT = 0;
  let dernierT = 0;
  let difficulte: Difficulte = "plat";
  // manche en cours
  let file: TypeZombie[] = [];
  let indexFile = 0;
  let debutApparitionT: number | null = null;
  let prochaineApparitionT = 0;
  let dernierSprinte = false;
  // Truck Muche
  let prochaineMancheTruck = 0;
  let numeroTruck = 0;
  let mancheTruck = false;
  let truck: Truck | null = null;
  // objets de la partie
  let courant = false;
  const murs = new Set<string>();
  let boite: EtatBoite = { emplacement: 0, etat: "fermee", finT: 0, utilisations: 0 };
  let demenagements = 0;
  let prixPaye = PRIX_BOITE;
  let pap: EtatPap = { etat: "libre" };
  let bonus: BonusSol[] = [];
  let bonusId = 1;
  let paquet: GenreBonus[] = [];
  let bonusManche = 0;
  let scoreTotal = 0;
  let increment: number = ZOMBIES.incrementBonus;
  let seuilBonus = 0;
  let lacherBonus = false;
  const effets: EffetsZombies = { instakillFinT: 0, doubleFinT: 0, soldesFinT: 0 };
  const quete: QueteZombies = { ingredients: [], cuissonFinT: 0, faite: false };
  // diffusion de zombies{etat}
  let immediat = false;
  let sale = false;
  let dernierEtatT = -Infinity;

  // ---------------------------------------------------------------------------------------------
  // membres, état
  // ---------------------------------------------------------------------------------------------

  function membre(id: string): Membre {
    let m = membres.get(id);
    if (!m) {
      m = {
        etat: "attente", admis: false, argent: 0, gagne: 0, reanimations: 0, admisT: 0, atouts: new Set(), autoReleves: AUTO_RELEVES_MAX,
        autoReleveT: null, planchesManche: 0, reparation: null,
      };
      membres.set(id, m);
    }
    return m;
  }
  const hote = (): string => ctx.joueurs()[0]?.id ?? "";
  const restants = (): number => (mancheTruck ? (truck?.aLacher ?? 0) : file.length - indexFile) + simu.nbVivants();
  const peutJouer = (j: JoueurSalle): boolean => j.enJeu && j.vivant;
  /**
   * (v8) Marge (m) des portées jugées sur la position serveur (relève, planches, achats) : ce que le joueur parcourt pendant la demi-latence
   * (sa position serveur a ce retard sur celle de son écran), au plus `MARGE_LATENCE_MAX_M`.
   */
  const margeLatence = (j: JoueurSalle): number => Math.min(MARGE_LATENCE_MAX_M, (Math.hypot(j.v[0], j.v[2]) * Math.min(j.ping, 300)) / 2000);
  const nbAdmis =(): number => Math.max(1, ctx.joueurs().filter((j) => membre(j.id).admis).length);
  const solo = (): boolean => nbAdmis() === 1;
  const doublePoints = (t: number): boolean => t < effets.doubleFinT;
  const zev = (e: EvenementZombies): Sortie => ({ a: "joueurs", m: { t: "zevt", e } });

  function etat(): EtatPartieZombies {
    const joueurs: JoueurZombies[] = ctx.joueurs().map((j) => {
      const m = membre(j.id);
      return {
        id: j.id, pseudo: j.pseudo, couleur: j.couleur, etat: m.etat, admis: m.admis, kills: j.kills, gagne: m.gagne, reanimations: m.reanimations,
        ...(m.etat === "terre" && m.terreFinT !== undefined ? { terreFinT: m.terreFinT } : {}),
        atouts: ATOUTS_LISTE.filter((a) => m.atouts.has(a)), autoReleves: m.autoReleves,
      };
    });
    return {
      phase, manche, hote: hote(), capacite: ZOMBIES.joueursMax, debutT, finT, joueurs,
      portes: PORTES_PAYANTES.map((p) => ({ id: p.id, ouverte: ouvertes.has(p.id) })),
      ...(bilan ? { bilan } : {}),
      difficulte, courant, boite: { ...boite }, pap: { ...pap }, fenetres: FENETRES.map((f) => planches.get(f.id) ?? 0),
      bonus: bonus.map((b) => ({ ...b, p: [b.p[0], b.p[1], b.p[2]] as Vec3 })), effets: { ...effets },
      quete: { ingredients: [...quete.ingredients], cuissonFinT: quete.cuissonFinT, faite: quete.faite },
      mancheTruck, truck: truck ? { phase: truck.phase, quai: truck.quai, finT: truck.finT } : null, murs: [...murs],
    };
  }

  const sortieEtat = (): Sortie => ({ a: "tous", m: { t: "zombies", etat: etat() } });

  /** Ajoute `zombies{etat}` si un changement urgent est en attente (ou, depuis `tic`, un changement ordinaire hors période de repos). */
  function emettre(t: number, sorties: Sortie[], depuisTic = false): Sortie[] {
    if (immediat || (depuisTic && sale && t - dernierEtatT >= PERIODE_ETAT_MS)) {
      sorties.push(sortieEtat());
      immediat = false;
      sale = false;
      dernierEtatT = t;
    }
    return sorties;
  }

  function sortieArgent(j: JoueurSalle, delta: number, motif: string): Sortie {
    return { a: j.id, m: { t: "argent", solde: membre(j.id).argent, delta, motif } };
  }

  /** Crédite `j` ; tout gain compte pour le seuil de bonus de BO1 (le prochain kill lâche un bonus quand le total gagné le dépasse). */
  function crediter(j: JoueurSalle, delta: number, motif: string): Sortie {
    const m = membre(j.id);
    m.argent += delta;
    m.gagne += delta;
    scoreTotal += delta;
    if (scoreTotal > seuilBonus) {
      increment *= ZOMBIES.facteurIncrement;
      seuilBonus = scoreTotal + increment;
      lacherBonus = true;
    }
    sale = true;
    return sortieArgent(j, delta, motif);
  }

  const debout = (): JoueurSalle[] => ctx.joueurs().filter((j) => peutJouer(j) && membre(j.id).etat === "debout");
  /**
   * Membres admis restés debout (même s'ils n'ont pas encore rejoint), plus ceux qui vont se relever seuls (Pause Café en solo) : la
   * partie n'est perdue que si plus personne ne l'est.
   */
  const nbDebout = (): number => {
    let n = 0;
    for (const j of ctx.joueurs()) { const m = membre(j.id); if (m.admis && (m.etat === "debout" || m.autoReleveT !== null)) n++; }
    return n;
  };

  /** Slot en main valide pour un équipement (le slot demandé, sinon la secondaire, la principale, l'arme blanche). */
  function mainValide(eq: Equipement, main: Slot): Slot {
    if (main !== "speciale" && armeDuSlot(eq, main) !== null) return main;
    for (const s of ["secondaire", "principale", "couteau"] as const) if (armeDuSlot(eq, s) !== null) return s;
    return "couteau";
  }

  const estAmelioree = (eq: Equipement, a: ArmeFeuId): boolean => eq.ameliorees?.includes(a) ?? false;
  /** Munitions totales d'une spéciale en zombies (améliorée ou non). */
  const munSpecialeDe = (eq: Equipement): number => (eq.speciale ? chargeurZombie(eq.speciale, estAmelioree(eq, eq.speciale)) : 0);

  /** Zone de chaque joueur debout (gestionnaire de zones). */
  function zonesOccupees(): (ZoneId | null)[] {
    return debout().map((j) => zoneEn(carteZones, j.p[0], j.p[2]));
  }

  // ---------------------------------------------------------------------------------------------
  // transitions
  // ---------------------------------------------------------------------------------------------

  function ouvrirBatimentsComplets(): Sortie {
    return { a: "tous", m: { t: "batiments", complet: true, detruits: batimentsDetruits(ctx.monde), breches: [] } };
  }

  /** Remet les portes en place (nouvelle partie, retour au lobby) : prismes relevés, grilles « portes fermées » restaurées si une porte était ouverte. */
  function refermerPortes(): void {
    const avait = ouvertes.size > 0;
    ouvertes.clear();
    releverBatiments(ctx.monde);
    if (avait) {
      restaurerNavigation(ctx.monde, navigationFermee);
      simu.rafraichirCarte();
    }
  }

  function remettreAZero(j: JoueurSalle): void {
    j.kills = 0; j.morts = 0; j.tirs = 0; j.touches = 0; j.tetes = 0; j.degats = 0; j.serie = 0; j.serieMax = 0; j.killsParArme = {};
  }

  function remettreMembre(m: Membre): void {
    m.etat = "attente"; m.admis = false; m.argent = 0; m.gagne = 0; m.reanimations = 0; m.terreFinT = undefined;
    m.atouts.clear(); m.autoReleves = AUTO_RELEVES_MAX; m.autoReleveT = null; m.planchesManche = 0; m.reparation = null;
  }

  /** Objets de la carte remis comme au départ (nouvelle partie, retour au lobby). */
  function remettreCarte(): void {
    for (const f of FENETRES) planches.set(f.id, ZOMBIES.planches);
    courant = opts.courant === true;
    murs.clear();
    boite = { emplacement: EMPLACEMENTS_DEPART_BOITE[Math.min(EMPLACEMENTS_DEPART_BOITE.length - 1, Math.floor(alea() * EMPLACEMENTS_DEPART_BOITE.length))], etat: "fermee", finT: 0, utilisations: 0 };
    demenagements = 0;
    pap = { etat: "libre" };
    bonus = []; paquet = []; bonusManche = 0; scoreTotal = 0; increment = ZOMBIES.incrementBonus; lacherBonus = false;
    seuilBonus = seuilBonusInitial(nbAdmis());
    effets.instakillFinT = 0; effets.doubleFinT = 0; effets.soldesFinT = 0;
    quete.ingredients = []; quete.cuissonFinT = 0; quete.faite = false;
    truck = null; mancheTruck = false; numeroTruck = 0;
    prochaineMancheTruck = opts.mancheTruck !== undefined ? opts.mancheTruck : premiereMancheTruck(alea());
  }

  /** Retour au lobby : tous les joueurs sortent de l'arène, portes refermées, tigres retirés, membres remis en attente. */
  function retourLobby(t: number): Sortie[] {
    const sorties: Sortie[] = [];
    for (const j of ctx.joueurs()) {
      if (j.enJeu) sorties.push(...ctx.retirerJoueur(j, t));
      remettreMembre(membre(j.id));
    }
    releves.clear();
    simu.reinitialiser();
    file = []; indexFile = 0; debutApparitionT = null;
    refermerPortes();
    remettreCarte();
    phase = "lobby"; manche = 0; debutT = t; finT = 0; bilan = undefined;
    sorties.push(ouvrirBatimentsComplets(), ctx.presence());
    immediat = true;
    return sorties;
  }

  /** Défaite : bilan affiché `finAffichageMs`, tigres retirés. Sans effet hors pause / manche. */
  function perdre(t: number): void {
    if (phase !== "pause" && phase !== "manche") return;
    bilan = { manche: Math.max(0, phase === "pause" ? manche - 1 : manche), dureeMs: Math.max(0, t - partieDebutT) };
    phase = "fin"; debutT = t; finT = t + ZOMBIES.finAffichageMs;
    simu.reinitialiser();
    file = []; indexFile = 0; debutApparitionT = null; truck = null;
    releves.clear();
    immediat = true;
  }

  /** Plus personne de debout : partie perdue. */
  function verifierDefaite(t: number): void {
    if ((phase === "pause" || phase === "manche") && nbDebout() === 0) perdre(t);
  }

  /** Équipement d'un joueur qui (re)part : celui du départ, 100 PV, sur un point de départ éloigné des autres. */
  function remettreEnJeu(j: JoueurSalle, t: number, pv: number): Sortie[] {
    const autres = ctx.joueurs().filter((o) => o !== j && peutJouer(o)).map((o) => o.p);
    const d = departPour(autres, departs);
    return ctx.placerJoueur(j, d.p, d.lacet, { pv, equip: copierEquipement(EQUIPEMENT_DEPART_ZOMBIES), main: MAIN_DEPART_ZOMBIES }, t);
  }

  /**
   * Relève d'un joueur à terre là où il est (PV 50, équipement conservé sans la spéciale) : `apparition{garder}`, sans téléportation (sa
   * position serveur a suivi son corps à terre, le client garde la sienne).
   */
  function relever(j: JoueurSalle, t: number): Sortie[] {
    const m = membre(j.id);
    m.etat = "debout";
    m.terreFinT = undefined;
    m.autoReleveT = null;
    const equip = copierEquipement({ ...j.equip, speciale: null });
    const sorties = ctx.placerJoueur(j, j.p, j.lacet, { pv: ZOMBIES.reanimationPv, equip, main: mainValide(equip, j.main), garder: true }, t);
    for (const [par, r] of releves) if (r.cible === j.id) releves.delete(par);
    releves.delete(j.id);
    immediat = true;
    return sorties;
  }

  /** Début de la pause qui suit une manche (ou de la partie) : relèves, retours, admissions. Pas de bonus de fin de manche (BO1). */
  function entrerEnPause(t: number, numero: number, duree: number): Sortie[] {
    const sorties: Sortie[] = [];
    manche = numero;
    phase = "pause"; debutT = t; finT = t + duree;
    mancheTruck = prochaineMancheTruck > 0 && manche === prochaineMancheTruck;
    for (const j of ctx.joueurs()) {
      const m = membre(j.id);
      if (m.etat === "terre") {
        sorties.push(...relever(j, t));
      } else if (m.etat === "elimine") {
        m.etat = "debout"; m.terreFinT = undefined; m.argent = argentDepart; m.admisT = t; m.atouts.clear();
        sorties.push(...remettreEnJeu(j, t, ZOMBIES.pvMax), sortieArgent(j, 0, "retour"));
      } else if (m.etat === "attente" && !m.admis) {
        m.etat = "debout"; m.admis = true; m.admisT = t; m.argent = argentDepart; m.gagne = 0; m.reanimations = 0; m.atouts.clear();
        remettreAZero(j);
        sorties.push(sortieArgent(j, 0, "depart"));
      }
    }
    releves.clear();
    immediat = true;
    return sorties;
  }

  function lancerPartie(j: JoueurSalle, t: number, diff: unknown): Sortie[] {
    if (phase !== "lobby" || hote() !== j.id) return [];
    const membresSalle = ctx.joueurs();
    if (!membresSalle.length) return [];
    const sorties: Sortie[] = [];
    difficulte = estDifficulte(diff) ? diff : "plat";
    refermerPortes();
    simu.reinitialiser();
    file = []; indexFile = 0; debutApparitionT = null;
    releves.clear();
    partieDebutT = t;
    bilan = undefined;
    for (const o of membresSalle) {
      const m = membre(o.id);
      remettreMembre(m);
      m.etat = "debout"; m.admis = true; m.admisT = t; m.argent = argentDepart;
      remettreAZero(o);
      sorties.push(sortieArgent(o, 0, "depart"));
    }
    remettreCarte();
    manche = 1;
    phase = "pause"; debutT = t; finT = t + decompteMs;
    mancheTruck = prochaineMancheTruck === 1;
    sorties.push(ouvrirBatimentsComplets(), ctx.presence());
    immediat = true;
    return sorties;
  }

  function debuterManche(t: number, sorties: Sortie[]): void {
    const nJoueurs = nbAdmis();
    bonusManche = 0;
    dernierSprinte = false;
    for (const m of membres.values()) m.planchesManche = 0;
    if (mancheTruck) {
      numeroTruck++;
      prochaineMancheTruck = mancheTruckSuivante(manche, alea());
      file = []; indexFile = 0;
      truck = null;
      // le Truck arrive au quai le plus proche des joueurs, 2 s après le début (le klaxon le précède)
      const total = manche === 1 && opts.total1 !== undefined ? Math.max(1, Math.round(opts.total1)) : totalTruck(numeroTruck, nJoueurs);
      demarrerTruck(t + 2_000, total);
    } else {
      let types = typesManche(manche, nJoueurs, alea);
      if (manche === 1 && opts.total1 !== undefined) {
        const total = Math.max(0, Math.round(opts.total1));
        types = types.slice(0, total);
        while (types.length < total) types.push(0);
      }
      file = types; indexFile = 0;
    }
    phase = "manche"; debutT = t; finT = 0;
    // manche 1 : les apparitions attendent le chargement des clients (cf. `ticManche`) ; les suivantes partent tout de suite
    debutApparitionT = manche === 1 ? null : t;
    prochaineApparitionT = t;
    sorties.push(zev({ e: "manche", numero: manche, truck: mancheTruck }));
    immediat = true;
  }

  // ---------------------------------------------------------------------------------------------
  // apparitions (gestionnaire de zones de BO1)
  // ---------------------------------------------------------------------------------------------

  function specPour(type: TypeZombie): SpecZombie {
    const allure = allureTiree(manche, alea(), difficulte, type);
    return {
      type, manche, pv: pvZombie(manche, type, difficulte, numeroTruck), allure, vitesse: vitesseAllure(allure, alea(), type),
      degats: opts.degatsGriffe ?? degatsGriffe(type, difficulte), rechargeGriffeS: rechargeGriffe(type),
    };
  }

  /** Point libre (aucun tigre à moins de 1,4 m) parmi les points d'une fenêtre, en partant d'un tirage. */
  function pointLibre(points: readonly Vec2[]): Vec2 {
    const k = Math.min(points.length - 1, Math.floor(alea() * points.length));
    for (let i = 0; i < points.length; i++) {
      const p = points[(k + i) % points.length];
      if (!simu.liste().some((z) => Math.hypot(z.p[0] - p[0], z.p[2] - p[1]) < ZOMBIES.separationM)) return p;
    }
    return points[k];
  }

  /** Où apparaît le prochain tigre : une fenêtre ou une sortie du sol des zones actives (occupées et voisines). */
  function choisirArrivee(joueurs: readonly JoueurSalle[]): { point: Vec2; arrivee: ArriveeZombie } | null {
    const actives = zonesActives(zonesOccupees(), ouvertes);
    const fenetres = fenetresDesZones(actives);
    const sols = sorties.filter((s) => {
      if (!actives.has(s.zone)) return false;
      let d = Infinity;
      for (const j of joueurs) d = Math.min(d, Math.hypot(j.p[0] - s.p[0], j.p[2] - s.p[1]));
      return d >= SOL_DISTANCE_MIN && d <= SOL_DISTANCE_MAX;
    });
    if (!fenetres.length && !sols.length) {
      // personne de localisé : la première fenêtre de la zone de départ
      const f = FENETRES[0];
      return { point: pointLibre(f.points), arrivee: { mode: "fenetre", fenetre: f } };
    }
    if (fenetres.length && (!sols.length || alea() < PART_FENETRES)) {
      const f = fenetres[Math.min(fenetres.length - 1, Math.floor(alea() * fenetres.length))];
      return { point: pointLibre(f.points), arrivee: { mode: "fenetre", fenetre: f } };
    }
    const s = sols[Math.min(sols.length - 1, Math.floor(alea() * sols.length))];
    return { point: s.p, arrivee: { mode: "sol" } };
  }

  function apparaitre(t: number): void {
    if (debutApparitionT === null || t < debutApparitionT || t < prochaineApparitionT) return;
    if (indexFile >= file.length || simu.nbVivants() >= ZOMBIES.plafondVivants) return;
    const presents = debout();
    if (!presents.length) return;
    const choix = choisirArrivee(presents);
    if (!choix) return;
    const id = simu.apparaitre(specPour(file[indexFile]), choix.point, choix.arrivee, t);
    if (id === null) return;
    indexFile++;
    const k = quete.cuissonFinT > t ? 0.5 : 1;
    prochaineApparitionT = t + delaiApparition(manche) * 1000 * k;
    sale = true;
  }

  // ---------------------------------------------------------------------------------------------
  // Truck Muche
  // ---------------------------------------------------------------------------------------------

  function demarrerTruck(t: number, total: number): void {
    const joueurs = debout();
    let meilleur = QUAIS[0], dMin = Infinity;
    for (const q of QUAIS) {
      // un quai dont la fenêtre donne sur une zone ouverte, le plus proche des joueurs
      const f = fenetreDeId(q.fenetre)!;
      if (!zonesOuvertes(ouvertes).has(f.zone)) continue;
      for (const j of joueurs) {
        const d = Math.hypot(j.p[0] - q.p[0], j.p[2] - q.p[1]);
        if (d < dMin) { dMin = d; meilleur = q; }
      }
    }
    const pv = pvTruck(numeroTruck);
    truck = {
      quai: meilleur.id, phase: "arrivee", debutT: t, finT: t + TRUCK.arriveeMs, pv, pvMax: pv, p: [meilleur.depart[0], meilleur.depart[1]],
      cap: meilleur.cap, aLacher: total, prochainLacherT: 0,
    };
  }

  /** Avance le Truck (arrivée en marche arrière, livraison, départ) et lâche les petits par l'arrière. */
  function ticTruck(t: number, sorties: Sortie[]): void {
    if (!truck) return;
    const q = QUAIS[truck.quai];
    const f = fenetreDeId(q.fenetre)!;
    if (t < truck.debutT) return;
    if (truck.phase === "arrivee") {
      const k = Math.min(1, (t - truck.debutT) / TRUCK.arriveeMs);
      truck.p = [q.depart[0] + (q.p[0] - q.depart[0]) * k, q.depart[1] + (q.p[1] - q.depart[1]) * k];
      if (k >= 1) {
        truck.phase = "livraison"; truck.debutT = t; truck.finT = 0; truck.prochainLacherT = t + 800;
        sorties.push(zev({ e: "truck", quoi: "porte", p: [truck.p[0], 0, truck.p[1]] }));
        immediat = true;
      }
    }
    if ((truck.phase === "livraison" || truck.phase === "epave") && truck.aLacher > 0 && t >= truck.prochainLacherT && debutApparitionT !== null && t >= debutApparitionT) {
      const vivants = simu.liste().filter((z) => z.type === 3).length;
      for (let k = 0; k < 2 && truck.aLacher > 0 && vivants + k < ZOMBIES.plafondPetits; k++) {
        // l'arrière du Truck regarde la fenêtre : les petits sautent entre le Truck et la fenêtre, puis la franchissent d'un bond
        const recul = TRUCK.demiLongueur + 1.2;
        const x = truck.p[0] + f.normale[0] * recul + (k ? 1 : -1) * f.normale[1] * 0.8;
        const z = truck.p[1] + f.normale[1] * recul - (k ? 1 : -1) * f.normale[0] * 0.8;
        if (simu.apparaitre(specPour(3), [x, z], { mode: "chasse" }, t, capVers(x, z, f.milieu[0], f.milieu[1])) !== null) truck.aLacher--;
      }
      truck.prochainLacherT = t + TRUCK.lacherMs;
      sale = true;
    }
    if (truck.phase === "livraison" && truck.aLacher <= 0) {
      truck.phase = "depart"; truck.debutT = t; truck.finT = t + TRUCK.departMs;
      sorties.push(zev({ e: "truck", quoi: "klaxon", p: [truck.p[0], 0, truck.p[1]] }));
      immediat = true;
    }
    if (truck.phase === "depart") {
      const k = Math.min(1, (t - truck.debutT) / TRUCK.departMs);
      const av: Vec2 = [-Math.sin(truck.cap), -Math.cos(truck.cap)];
      truck.p = [q.p[0] + av[0] * 25 * k * k, q.p[1] + av[1] * 25 * k * k];
      if (k >= 1) { truck = null; immediat = true; }
    } else if (truck.phase === "epave" && truck.aLacher <= 0 && t >= truck.finT) {
      truck = null; immediat = true;
    }
  }

  /** Le Truck est criblé : à 0 il explose (souffle sur les petits, +500 $ à chaque joueur), les petits restants sortent de l'épave. */
  function blesserTruck(degats: number, par: JoueurSalle, t: number): Sortie[] {
    if (!truck || truck.phase === "epave") return [];
    truck.pv = Math.max(0, truck.pv - Math.max(0, degats));
    const sorties: Sortie[] = [{ a: par.id, m: { t: "degats", cible: CIBLE_LIVRAISON, par: par.id, degats, pv: Math.round((100 * truck.pv) / truck.pvMax), bouclier: 0, zone: "corps" } }];
    sale = true;
    if (truck.pv > 0) return sorties;
    truck.phase = "epave"; truck.debutT = t; truck.finT = t + TRUCK.epaveMs; truck.prochainLacherT = t + 1_500;
    const p: Vec3 = [truck.p[0], 1, truck.p[1]];
    sorties.push(zev({ e: "truck", quoi: "explosion", p }));
    for (const z of [...simu.liste()]) {
      if (Math.hypot(z.p[0] - p[0], z.p[2] - p[2]) > TRUCK.souffleM) continue;
      sorties.push(...tuerTigre(z.id, par, t, "explosion", false));
    }
    for (const j of ctx.joueurs()) if (membre(j.id).admis && j.enJeu) sorties.push(crediter(j, GAIN_TRUCK, "truck"));
    immediat = true;
    return sorties;
  }

  // ---------------------------------------------------------------------------------------------
  // bonus
  // ---------------------------------------------------------------------------------------------

  function tirerBonus(): GenreBonus {
    if (!paquet.length) paquet = paquetBonus(alea);
    return paquet.shift()!;
  }

  function lacher(genre: GenreBonus, p: Vec3, t: number, sorties: Sortie[]): void {
    const b: BonusSol = { id: bonusId++, genre, p: [p[0], 0, p[2]], finT: t + ZOMBIES.bonusSolideMs + ZOMBIES.bonusClignoteMs };
    bonus.push(b);
    sorties.push(zev({ e: "bonusLache", id: b.id, genre, p: b.p }));
    immediat = true;
  }

  /** Un tigre est mort en `p` (hors nuke) : bonus du tigre doré, du dernier petit, du seuil de BO1 ou du hasard (2 %). */
  function lacherApresKill(type: TypeZombie | undefined, p: Vec3, t: number, sorties: Sortie[]): void {
    if (phase !== "manche") return;
    if (zoneEn(carteZones, p[0], p[2]) === null) return; // jamais hors de la zone de jeu (un tigre abattu dehors)
    if (type === 1) { lacher(tirerBonus(), p, t, sorties); return; }
    if (mancheTruck && type === 3 && (truck?.aLacher ?? 0) === 0 && simu.nbVivants() === 0) { lacher("munitions", p, t, sorties); return; }
    if (bonusManche >= ZOMBIES.bonusParManche) return;
    if (lacherBonus || alea() < ZOMBIES.probaBonusHasard) {
      lacherBonus = false;
      bonusManche++;
      lacher(tirerBonus(), p, t, sorties);
    }
  }

  /** Munitions max : toutes les armes de tous les joueurs en jeu sont pleines, spéciale comprise. */
  function munitionsMax(t: number): Sortie[] {
    const sorties: Sortie[] = [];
    for (const j of ctx.joueurs()) {
      if (!j.enJeu || !membre(j.id).admis) continue;
      if (j.equip.speciale) j.munSpeciale = munSpecialeDe(j.equip);
      sorties.push(...ctx.equiper(j, copierEquipement(j.equip), j.main, t, "tout"));
    }
    return sorties;
  }

  function appliquerBonus(b: BonusSol, par: JoueurSalle, t: number): Sortie[] {
    const sorties: Sortie[] = [zev({ e: "bonus", genre: b.genre, par: par.id, p: b.p })];
    switch (b.genre) {
      case "munitions": sorties.push(...munitionsMax(t)); break;
      case "instakill": effets.instakillFinT = t + ZOMBIES.bonusDureeMs; break;
      case "double": effets.doubleFinT = t + ZOMBIES.bonusDureeMs; break;
      case "soldes": effets.soldesFinT = t + ZOMBIES.bonusDureeMs; break;
      case "nuke": {
        sorties.push(zev({ e: "nuke", p: b.p }));
        // BO1 : la nuke tue tout ce qui est vivant (le Truck excepté) sans rapporter de points, puis +400 à chacun
        for (const z of [...simu.liste()]) sorties.push(...tuerTigre(z.id, par, t, "nuke", false));
        for (const j of ctx.joueurs()) if (membre(j.id).admis && j.enJeu) sorties.push(crediter(j, GAIN_NUKE, "nuke"));
        break;
      }
      case "menuisier": {
        for (const f of FENETRES) planches.set(f.id, ZOMBIES.planches);
        for (const j of ctx.joueurs()) if (membre(j.id).admis && j.enJeu) sorties.push(crediter(j, GAIN_MENUISIER, "menuisier"));
        break;
      }
    }
    immediat = true;
    return sorties;
  }

  function ticBonus(t: number, sorties: Sortie[]): void {
    if (!bonus.length) return;
    const presents = debout();
    const restent: BonusSol[] = [];
    for (const b of bonus) {
      if (t >= b.finT) { sale = true; continue; }
      const par = presents.find((j) => Math.hypot(j.p[0] - b.p[0], j.p[2] - b.p[2]) <= ZOMBIES.bonusRayon);
      if (par) { sorties.push(...appliquerBonus(b, par, t)); continue; }
      restent.push(b);
    }
    bonus = restent;
  }

  // ---------------------------------------------------------------------------------------------
  // tigres tués, dégâts
  // ---------------------------------------------------------------------------------------------

  /**
   * Tue le tigre `id` (nuke, souffle du Truck) : `zombieMort` (cause), kill crédité à `par` ; `points` : gain de kill au tueur (jamais pour la
   * nuke) ; bonus éventuel sauf pour la nuke.
   */
  function tuerTigre(id: number, par: JoueurSalle, t: number, cause: "explosion" | "nuke", points: boolean): Sortie[] {
    const r = simu.blesser(id, INSTAKILL, t);
    if (!r.mort) return [];
    const sorties: Sortie[] = [{ a: "joueurs", m: { t: "zombieMort", id: idZombie(id), p: r.p ?? [0, 0, 0], par: par.id, zone: "corps", cause } }];
    par.kills++;
    if (points) sorties.push(crediter(par, gainKill({ double: doublePoints(t) }), "kill"));
    if (cause !== "nuke") lacherApresKill(r.type, r.p ?? [0, 0, 0], t, sorties);
    sale = true;
    return sorties;
  }

  // ---------------------------------------------------------------------------------------------
  // manche
  // ---------------------------------------------------------------------------------------------

  function ticManche(t: number, dt: number, sorties: Sortie[]): void {
    const membresSalle = ctx.joueurs();
    // un admis dont le client n'a jamais rejoint (chargement échoué, onglet fermé) repasse en attente au bout de 15 s : il ne bloque pas la partie
    for (const j of membresSalle) {
      const m = membre(j.id);
      if (m.admis && m.etat === "debout" && !j.enJeu && t - m.admisT >= ZOMBIES.attenteChargementMaxMs) {
        m.admis = false; m.etat = "attente"; m.argent = 0; immediat = true;
      }
    }
    // manche 1 : les apparitions attendent que tous les admis soient en jeu (15 s au plus depuis le lancement), puis 3 s de grâce
    if (debutApparitionT === null) {
      const admis = membresSalle.filter((j) => membre(j.id).admis);
      if (admis.every((j) => j.enJeu) || t - partieDebutT >= ZOMBIES.attenteChargementMaxMs) debutApparitionT = t + ZOMBIES.graceApresChargementMs;
    }

    // simulation des tigres : cibles = joueurs en jeu et debout
    // (v8) la griffe attend l'aller-retour du joueur visé avant d'être jugée une seconde fois (en sa faveur, cf. GRIFFE_DELAI_MAX_MS)
    const cibles = membresSalle.filter((j) => peutJouer(j) && membre(j.id).etat === "debout").map((j) => ({ id: j.id, p: j.p, vivant: true, delaiMs: j.ping }));
    evenementsTic = [];
    const evenements = simu.tic(t, dt, cibles);
    sorties.push(...evenementsTic);
    evenementsTic = [];
    for (const e of evenements) {
      if (phase !== "manche") break; // une griffe précédente a couché le dernier joueur debout : partie perdue, les suivantes ne comptent plus
      if (e.t === "bloque") {
        // failsafe de BO1 : le tigre coincé est retiré et remis dans la file (il réapparaîtra ailleurs)
        const z = simu.zombie(e.tigre);
        if (z && z.type !== 3) { simu.retirer(e.tigre); file.splice(indexFile, 0, z.type); }
        continue;
      }
      if (e.t !== "griffe") continue;
      const j = ctx.joueur(e.joueur);
      if (!j || !peutJouer(j) || t < j.protegeJusqua) continue;
      const z = simu.zombie(e.tigre);
      sorties.push(...ctx.infliger(j, e.degats, null, "tigre_zombie", "corps", "couteau", t, z ? [z.p[0], 1, z.p[2]] : undefined));
    }
    if (phase !== "manche") return; // une griffe a pu coucher le dernier joueur debout

    if (mancheTruck) ticTruck(t, sorties);
    else apparaitre(t);

    // le dernier tigre sprinte (BO1 `zombie_speed_up`, à partir de la manche 4)
    if (!mancheTruck && !dernierSprinte && manche >= 4 && indexFile >= file.length && simu.nbVivants() === 1) {
      const z = simu.liste()[0];
      if (z.allure < 2) simu.changerAllure(z.id, 2, ZOMBIES.vitesses[2]);
      dernierSprinte = true;
    }

    ticCommun(t, sorties);
    if (phase !== "manche") return;

    // fin de manche : tous les tigres sont apparus ET morts (manche du Truck : il a tout lâché et les petits sont morts)
    const finie = debutApparitionT !== null && simu.nbVivants() === 0
      && (mancheTruck ? (truck?.aLacher ?? 0) <= 0 : indexFile >= file.length);
    if (finie) {
      truck = null;
      mancheTruck = false;
      sorties.push(...entrerEnPause(t, manche + 1, pauseMs));
    }
  }

  /** Ce qui avance en manche ET en pause : relèves, éliminations, bonus, planches, boîte, Pack-a-Punch, recette, auto-relèves. */
  function ticCommun(t: number, sorties: Sortie[]): void {
    const membresSalle = ctx.joueurs();
    // relèves : le relanceur maintient E à portée, la cible est à terre (1,5 s avec la Pause Café)
    for (const [parId, r] of [...releves]) {
      const par = ctx.joueur(parId), cible = ctx.joueur(r.cible);
      if (!par || !cible || !peutJouer(par) || membre(parId).etat !== "debout" || membre(r.cible).etat !== "terre"
        || Math.hypot(par.p[0] - cible.p[0], par.p[2] - cible.p[2]) > ZOMBIES.reanimationAnnulePortee + margeLatence(par)) {
        releves.delete(parId);
        continue;
      }
      const duree = membre(parId).atouts.has("pausecafe") ? ZOMBIES.reanimationS / 2 : ZOMBIES.reanimationS;
      if (t - r.debutT >= duree * 1000) {
        membre(parId).reanimations++;
        sorties.push(...relever(cible, t));
      }
    }

    // auto-relève de la Pause Café (solo) ; éliminations : 45 s à terre sans relève
    for (const j of membresSalle) {
      const m = membre(j.id);
      if (m.etat === "terre" && m.autoReleveT !== null && t >= m.autoReleveT) {
        sorties.push(...relever(j, t), zev({ e: "autoReleve", joueur: j.id }));
        continue;
      }
      if (m.etat === "terre" && m.terreFinT !== undefined && t >= m.terreFinT) {
        m.etat = "elimine"; m.terreFinT = undefined;
        for (const [par, r] of releves) if (r.cible === j.id || par === j.id) releves.delete(par);
        immediat = true;
      }
    }
    verifierDefaite(t);
    if (phase !== "manche" && phase !== "pause") return;

    ticBonus(t, sorties);
    ticPlanches(t, sorties);
    ticBoite(t, sorties);
    ticPap(t, sorties);
    ticRecette(t, sorties);
  }

  // ---------------------------------------------------------------------------------------------
  // planches, boîte, Pack-a-Punch, recette
  // ---------------------------------------------------------------------------------------------

  function ticPlanches(t: number, sorties: Sortie[]): void {
    for (const j of ctx.joueurs()) {
      const m = membre(j.id);
      const r = m.reparation;
      if (!r) continue;
      const f = fenetreDeId(r.fenetre);
      const n = planches.get(r.fenetre) ?? 0;
      if (!f || !peutJouer(j) || m.etat !== "debout" || n >= ZOMBIES.planches
        || Math.hypot(j.p[0] - f.dedans[0], j.p[2] - f.dedans[1]) > ZOMBIES.reposePortee + 0.6 + margeLatence(j)) {
        m.reparation = null;
        continue;
      }
      if (t < r.prochainT) continue;
      planches.set(r.fenetre, n + 1);
      r.prochainT = t + ZOMBIES.reposeS * 1000;
      sorties.push(zev({ e: "planche", fenetre: r.fenetre, arrachee: false }));
      sale = true;
      const plafond = plafondPlanches(manche);
      if (m.planchesManche < plafond) {
        const gain = Math.min(GAIN_PLANCHE, plafond - m.planchesManche);
        m.planchesManche += gain;
        sorties.push(crediter(j, gain, "planche"));
      }
    }
  }

  /** Armes que la boîte peut donner à `eq` (BO1 : jamais l'arme de départ ni une arme déjà portée). */
  function armesBoite(eq: Equipement): ArmeFeuId[] {
    return ARMES.filter((a) => !HORS_BOITE.has(a) && STATS[a].categorie !== "unique" && !possede(eq, a));
  }

  /** La peluche de BO1 (`treasure_chest_think`) : jamais avant 4 utilisations ; 15 % de 4 à 7 ; 8ᵉ forcée sans déménagement ; ensuite 30 % puis 50 %. */
  function peluche(utilisations: number): boolean {
    if (utilisations < 4) return false;
    const r = alea() * 100;
    if (demenagements === 0) {
      if (utilisations >= 8) return true;
      return r < 15;
    }
    if (utilisations < 8) return r < 15;
    if (utilisations < 13) return r < 30;
    return r < 50;
  }

  function ticBoite(t: number, sorties: Sortie[]): void {
    if (boite.etat === "fermee" || t < boite.finT) return;
    if (boite.etat === "tirage") {
      if (boite.arme === "peluche") {
        // la peluche rembourse et la boîte s'envole
        const j = boite.pour ? ctx.joueur(boite.pour) : undefined;
        if (j && membre(j.id).admis) { const m = membre(j.id); m.argent += prixPaye; sorties.push(sortieArgent(j, prixPaye, "peluche")); }
        boite = { ...boite, etat: "envol", finT: t + ENVOL_BOITE_MS };
        sorties.push(zev({ e: "peluche", de: boite.emplacement }));
      } else {
        boite = { ...boite, etat: "offre", finT: t + OFFRE_BOITE_MS };
      }
    } else if (boite.etat === "offre") {
      boite = { emplacement: boite.emplacement, etat: "fermee", finT: 0, utilisations: boite.utilisations };
    } else if (boite.etat === "envol") {
      const autres = Array.from({ length: NB_EMPLACEMENTS_BOITE }, (_, i) => i).filter((i) => i !== boite.emplacement);
      const vers = autres[Math.min(autres.length - 1, Math.floor(alea() * autres.length))];
      demenagements++;
      boite = { emplacement: vers, etat: "fermee", finT: 0, utilisations: 0 };
    }
    immediat = true;
  }

  function ticPap(t: number, sorties: Sortie[]): void {
    if (pap.etat !== "cuisson" || t < (pap.finT ?? 0)) return;
    const j = pap.joueur ? ctx.joueur(pap.joueur) : undefined;
    const arme = pap.arme!;
    pap = { etat: "libre" };
    immediat = true;
    if (!j || !membre(j.id).admis || !possede(j.equip, arme)) return;
    const equip = copierEquipement(j.equip);
    equip.ameliorees = [...new Set([...(equip.ameliorees ?? []), arme])];
    if (equip.speciale === arme) j.munSpeciale = chargeurZombie(arme, true);
    sorties.push(...ctx.equiper(j, equip, j.main, t, arme), zev({ e: "pap", joueur: j.id, arme, pret: true }));
  }

  function ticRecette(t: number, sorties: Sortie[]): void {
    if (!quete.cuissonFinT || t < quete.cuissonFinT) return;
    quete.cuissonFinT = 0;
    quete.faite = true;
    sorties.push(zev({ e: "cuisson", fin: true }));
    // chaque joueur debout reçoit le Rayon Goulaf et un atout qu'il n'a pas
    for (const j of debout()) {
      const m = membre(j.id);
      const equip = copierEquipement(j.equip);
      equip.secondaire = "rayon";
      equip.ameliorees = [...new Set([...(equip.ameliorees ?? []).filter((a) => a !== "rayon"), "rayon" as ArmeFeuId])];
      ctx.memoriserPrecedent(j);
      delete j.cadenceArme.rayon;
      sorties.push(...ctx.equiper(j, equip, "secondaire", t, "rayon"));
      const manque = ATOUTS_LISTE.filter((a) => !m.atouts.has(a));
      if (manque.length) donnerAtout(j, manque[Math.min(manque.length - 1, Math.floor(alea() * manque.length))], t, sorties);
    }
    immediat = true;
  }

  function donnerAtout(j: JoueurSalle, a: AtoutId, t: number, sorties: Sortie[]): void {
    const m = membre(j.id);
    m.atouts.add(a);
    if (a === "gratin") j.pv = ZOMBIES.pvMaxGratin;
    sorties.push(zev({ e: "atout", joueur: j.id, atout: a }));
    immediat = true;
    void t;
  }

  // ---------------------------------------------------------------------------------------------
  // achats
  // ---------------------------------------------------------------------------------------------

  const possede = (eq: Equipement, a: ArmeFeuId): boolean => (!eq.sansPrincipale && eq.principale === a) || eq.secondaire === a || eq.speciale === a;

  const refus = (j: JoueurSalle, id: string, raison: RaisonAchat): Sortie[] => [{ a: j.id, m: { t: "achat", ok: false, id, raison } }];

  /** Ligne de vue du joueur au point d'achat (pas d'achat à travers un mur) ; une porte se vise sur sa face tournée vers le joueur. */
  function aVue(j: JoueurSalle, cible: Vec2): boolean {
    const dx = j.p[0] - cible[0], dz = j.p[2] - cible[1];
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return true;
    return visible(ctx.monde, [j.p[0], j.p[1] + HAUTEUR_ACHAT_M, j.p[2]], [cible[0], j.p[1] + HAUTEUR_ACHAT_M, cible[1]]);
  }

  /** Point le plus proche du segment de la porte, ramené de `recul` m vers le joueur (hors de l'épaisseur de la pièce). */
  function pointPorte(idPiece: string, j: JoueurSalle): Vec2 {
    const piece = pieceDe(idPiece);
    const [p, q] = [piece.p, piece.q];
    const ux = q[0] - p[0], uz = q[1] - p[1], l2 = ux * ux + uz * uz;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((j.p[0] - p[0]) * ux + (j.p[2] - p[1]) * uz) / l2)) : 0;
    const cx = p[0] + ux * k, cz = p[1] + uz * k;
    const dx = j.p[0] - cx, dz = j.p[2] - cz, d = Math.hypot(dx, dz);
    const recul = piece.demi + 0.2;
    if (d <= recul) return [j.p[0], j.p[2]];
    return [cx + (dx / d) * recul, cz + (dz / d) * recul];
  }

  function acheter(j: JoueurSalle, id: unknown, t: number): Sortie[] {
    const idTexte = typeof id === "string" ? id : "";
    const m = membre(j.id);
    if ((phase !== "pause" && phase !== "manche") || !m.admis || m.etat !== "debout" || !peutJouer(j)) return refus(j, idTexte, "partie");
    const achat = achatDeId(idTexte);
    if (!achat) return refus(j, idTexte, "loin");
    const pos: Vec2 = [j.p[0], j.p[2]];
    const porte = achat.genre === "porte" && achat.porte ? porteDeId(achat.porte) : null;
    // portée (2,5 m ; 3 m du segment d'une porte) puis ligne de vue
    if (porte) {
      if (distancePorte(porte, pos) > porte.portee + margeLatence(j)) return refus(j, idTexte, "loin");
      if (ouvertes.has(porte.id)) return refus(j, idTexte, "deja");
      if (!aVue(j, pointPorte(porte.prismes[0], j))) return refus(j, idTexte, "loin");
      const accessibles = zonesOuvertes(ouvertes);
      if (!accessibles.has(porte.zones[0]) && !accessibles.has(porte.zones[1])) return refus(j, idTexte, "verrou");
    } else {
      if (Math.hypot(pos[0] - achat.position[0], pos[1] - achat.position[1]) > achat.rayon + margeLatence(j)) return refus(j, idTexte, "loin");
      if (!aVue(j, achat.position)) return refus(j, idTexte, "loin");
    }
    switch (achat.genre) {
      case "porte": return acheterPorte(j, achat, m);
      case "mur": return acheterMur(j, achat, m, t);
      case "boite": return acheterBoite(j, achat, m, t);
      case "atout": return acheterAtout(j, achat, m, t);
      case "pap": return acheterPap(j, achat, m, t);
      case "courant": return activerCourant(j, achat);
      case "ingredient": return ramasserIngredient(j, achat);
      case "four": return lancerRecette(j, achat, t);
    }
  }

  function payer(j: JoueurSalle, m: Membre, achat: Achat, prix: number): Sortie[] {
    m.argent -= prix;
    sale = true;
    return [{ a: j.id, m: { t: "achat", ok: true, id: achat.id } }, ...(prix ? [sortieArgent(j, -prix, "achat")] : [])];
  }

  function acheterPorte(j: JoueurSalle, achat: Achat, m: Membre): Sortie[] {
    const porte = porteDeId(achat.porte!)!;
    if (m.argent < porte.prix) return refus(j, achat.id, "argent");
    const sorties = payer(j, m, achat, porte.prix);
    const detruits: number[] = [];
    for (const piece of porte.prismes) {
      const index = idPrisme(piece);
      if (detruireBatiment(ctx.monde, index)) detruits.push(index);
    }
    ouvertes.add(porte.id);
    // seules les cases autour des pièces de la porte changent (< 5 ms au lieu de 40 à 80 ms pour les deux grilles)
    majNavigation(ctx.monde, detruits.map((i) => ctx.monde.prismes[i].boite));
    simu.rafraichirCarte();
    sorties.push({ a: "tous", m: { t: "batiments", complet: false, detruits, breches: [] } });
    immediat = true;
    return sorties;
  }

  function acheterMur(j: JoueurSalle, achat: Achat, m: Membre, t: number): Sortie[] {
    const arme = achat.arme!;
    if (arme === "epee") {
      if (meleeDe(j.equip) === "epee") return refus(j, achat.id, "deja");
      if (m.argent < achat.prix) return refus(j, achat.id, "argent");
      const equip = copierEquipement(j.equip);
      equip.melee = "epee";
      murs.add(achat.id);
      return [...payer(j, m, achat, achat.prix), ...ctx.equiper(j, equip, j.main, t)];
    }
    if (possede(j.equip, arme)) {
      // l'arme est déjà là : recharge de munitions à moitié prix (2 500 $ pour une arme améliorée)
      if (achat.prixMunitions === undefined) return refus(j, achat.id, "deja");
      const prix = estAmelioree(j.equip, arme) ? PRIX_MUNITIONS_AMELIOREE : achat.prixMunitions;
      if (m.argent < prix) return refus(j, achat.id, "argent");
      return [...payer(j, m, achat, prix), ...ctx.equiper(j, copierEquipement(j.equip), j.main, t, arme)];
    }
    if (m.argent < achat.prix) return refus(j, achat.id, "argent");
    murs.add(achat.id);
    immediat = true;
    return [...payer(j, m, achat, achat.prix), ...equiperNouvelle(j, arme, t)];
  }

  /** L'arme à feu `arme` (non possédée) remplace celle de sa catégorie, passe en main, chargeurs pleins ; l'ancienne perd son amélioration. */
  function equiperNouvelle(j: JoueurSalle, arme: ArmeFeuId, t: number, amelioree = false): Sortie[] {
    const equip = copierEquipement(j.equip);
    const categorie = STATS[arme].categorie;
    ctx.memoriserPrecedent(j);
    delete j.cadenceArme[arme];
    const remplacee = categorie === "speciale" || categorie === "unique" ? equip.speciale : categorie === "principale" ? (equip.sansPrincipale ? null : equip.principale) : equip.secondaire;
    let ameliorees = (equip.ameliorees ?? []).filter((a) => a !== remplacee && a !== arme);
    if (amelioree) ameliorees = [...ameliorees, arme];
    if (ameliorees.length) equip.ameliorees = ameliorees; else delete equip.ameliorees;
    if (categorie === "speciale" || categorie === "unique") {
      equip.speciale = arme as ArmeSpecialeId;
      j.munSpeciale = chargeurZombie(arme, amelioree);
      return ctx.equiper(j, equip, "speciale", t);
    }
    if (categorie === "principale") {
      equip.principale = arme as Equipement["principale"];
      delete equip.sansPrincipale;
    } else {
      equip.secondaire = arme as Equipement["secondaire"];
    }
    return ctx.equiper(j, equip, categorie, t, arme);
  }

  function acheterBoite(j: JoueurSalle, achat: Achat, m: Membre, t: number): Sortie[] {
    if (achat.emplacement !== boite.emplacement) return refus(j, achat.id, "loin");
    if (boite.etat === "offre") {
      // prendre l'arme offerte (seul celui qui a payé)
      if (boite.pour !== j.id) return refus(j, achat.id, "occupe");
      const arme = boite.arme as ArmeFeuId;
      boite = { emplacement: boite.emplacement, etat: "fermee", finT: 0, utilisations: boite.utilisations };
      immediat = true;
      return [{ a: j.id, m: { t: "achat", ok: true, id: achat.id } }, ...equiperNouvelle(j, arme, t)];
    }
    if (boite.etat !== "fermee") return refus(j, achat.id, "occupe");
    const prix = t < effets.soldesFinT ? PRIX_BOITE_SOLDES : PRIX_BOITE;
    if (m.argent < prix) return refus(j, achat.id, "argent");
    const candidates = armesBoite(j.equip);
    if (!candidates.length) return refus(j, achat.id, "deja");
    const utilisations = boite.utilisations + 1;
    const arme: ArmeFeuId | "peluche" = peluche(utilisations) ? "peluche" : candidates[Math.min(candidates.length - 1, Math.floor(alea() * candidates.length))];
    prixPaye = prix;
    boite = { emplacement: boite.emplacement, etat: "tirage", arme, pour: j.id, finT: t + TIRAGE_BOITE_MS, utilisations };
    immediat = true;
    return payer(j, m, achat, prix);
  }

  function acheterAtout(j: JoueurSalle, achat: Achat, m: Membre, t: number): Sortie[] {
    const a = achat.atout!;
    if (!estAtout(a)) return refus(j, achat.id, "loin");
    if (a !== "pausecafe" && !courant) return refus(j, achat.id, "courant");
    if (m.atouts.has(a)) return refus(j, achat.id, "deja");
    // seul, la Pause Café disparaît après 3 auto-relèves
    if (a === "pausecafe" && solo() && m.autoReleves <= 0) return refus(j, achat.id, "deja");
    const prix = a === "pausecafe" && solo() ? ATOUTS.pausecafe.prixSolo! : ATOUTS[a].prix;
    if (m.argent < prix) return refus(j, achat.id, "argent");
    const sorties = payer(j, m, achat, prix);
    donnerAtout(j, a, t, sorties);
    return sorties;
  }

  function acheterPap(j: JoueurSalle, achat: Achat, m: Membre, t: number): Sortie[] {
    if (!courant) return refus(j, achat.id, "courant");
    if (pap.etat !== "libre") return refus(j, achat.id, "occupe");
    const arme = j.arme;
    if (estMelee(arme) || !possede(j.equip, arme)) return refus(j, achat.id, "deja");
    if (estAmelioree(j.equip, arme)) return refus(j, achat.id, "deja");
    if (m.argent < achat.prix) return refus(j, achat.id, "argent");
    pap = { etat: "cuisson", joueur: j.id, arme, finT: t + CUISSON_PAP_MS };
    immediat = true;
    return [...payer(j, m, achat, achat.prix), zev({ e: "pap", joueur: j.id, arme, pret: false })];
  }

  function activerCourant(j: JoueurSalle, achat: Achat): Sortie[] {
    if (courant) return refus(j, achat.id, "deja");
    courant = true;
    immediat = true;
    return [{ a: j.id, m: { t: "achat", ok: true, id: achat.id } }, zev({ e: "courant" })];
  }

  function ramasserIngredient(j: JoueurSalle, achat: Achat): Sortie[] {
    const id = achat.ingredient as IngredientId;
    if (!INGREDIENTS_LISTE.includes(id) || quete.ingredients.includes(id)) return refus(j, achat.id, "deja");
    if (id === "truffe" && !courant) return refus(j, achat.id, "courant");
    quete.ingredients.push(id);
    immediat = true;
    return [{ a: j.id, m: { t: "achat", ok: true, id: achat.id } }, zev({ e: "ingredient", id, par: j.id })];
  }

  function lancerRecette(j: JoueurSalle, achat: Achat, t: number): Sortie[] {
    if (quete.faite || quete.cuissonFinT) return refus(j, achat.id, "deja");
    if (!courant) return refus(j, achat.id, "courant");
    if (quete.ingredients.length < INGREDIENTS_LISTE.length) return refus(j, achat.id, "quete");
    quete.cuissonFinT = t + CUISSON_RECETTE_MS;
    immediat = true;
    return [{ a: j.id, m: { t: "achat", ok: true, id: achat.id } }, zev({ e: "cuisson", fin: false })];
  }

  // ---------------------------------------------------------------------------------------------
  // service
  // ---------------------------------------------------------------------------------------------

  const numero = (id: string): number => Number(id.slice(1));
  const etatTruck = (): number[] | undefined => {
    if (!truck) return undefined;
    const ph = { arrivee: 0, livraison: 1, depart: 2, epave: 3 }[truck.phase];
    return [Math.round(truck.p[0] * 100), Math.round(truck.p[1] * 100), Math.round(truck.cap * 1000), ph, Math.round((100 * truck.pv) / truck.pvMax)];
  };

  return {
    tic(t) {
      const sorties: Sortie[] = [];
      const dt = Math.min(DT_MAX_S, Math.max(0, (t - dernierT) / 1000));
      dernierT = t;
      if (phase === "lobby") return emettre(t, sorties, true);
      if (membres.size > ctx.joueurs().length) {
        const presents = new Set(ctx.joueurs().map((j) => j.id));
        for (const id of membres.keys()) if (!presents.has(id)) membres.delete(id);
      }
      if (phase === "fin") {
        if (t >= finT) sorties.push(...retourLobby(t));
        return emettre(t, sorties, true);
      }
      if (phase === "pause" && t >= finT) debuterManche(t, sorties);
      if (phase === "manche") ticManche(t, dt, sorties);
      else if (phase === "pause") ticCommun(t, sorties);
      return emettre(t, sorties, true);
    },

    reinitialiser(t) {
      return emettre(t, retourLobby(t));
    },

    synchro(idDest) {
      const sorties: Sortie[] = [
        { a: idDest, m: { t: "zombies", etat: etat() } },
        { a: idDest, m: { t: "batiments", complet: true, detruits: batimentsDetruits(ctx.monde), breches: [] } },
      ];
      const m = membres.get(idDest);
      if (m?.admis) sorties.push({ a: idDest, m: { t: "argent", solde: m.argent, delta: 0, motif: "synchro" } });
      return sorties;
    },

    snap() {
      return phase === "lobby" ? null : simu.snap(restants(), dernierT, etatTruck());
    },

    possede(id) {
      return estIdZombie(id) && simu.zombie(numero(id)) !== undefined;
    },

    admis(id) {
      return membres.get(id)?.admis ?? false;
    },

    toucheZombie(cible, o, d, portee, t) {
      return estIdZombie(cible) ? simu.toucheZombie(numero(cible), o, d, portee, t) : null;
    },

    toucheMelee(cible, o, d, portee, cosCone, t) {
      return estIdZombie(cible) ? simu.toucheMelee(numero(cible), o, d, portee, cosCone, t) : null;
    },

    degatsTir(j, arme, zone, distance, t) {
      if (t < effets.instakillFinT) return INSTAKILL;
      return degatsZombie(arme, zone, distance, estAmelioree(j.equip, arme));
    },

    degatsMelee(_j, arme, t) {
      return t < effets.instakillFinT ? INSTAKILL : MELEE[arme].degatsZombie;
    },

    perce(j, arme) {
      return profilZombie(arme, estAmelioree(j.equip, arme)).perce === true;
    },

    cadence(j) {
      return membre(j.id).atouts.has("ristretto") ? 1 / 1.33 : 1;
    },

    sante(j) {
      return { pvMax: membre(j.id).atouts.has("gratin") ? ZOMBIES.pvMaxGratin : ZOMBIES.pvMax, delaiMs: ZOMBIES.regenDelaiMs, pvParS: ZOMBIES.regenPvParS };
    },

    toucheTruck(o, d, portee) {
      if (!truck || truck.phase === "epave") return null;
      return rayonTruck(o, d, truck.p, truck.cap, portee);
    },

    blesserTruck(degats, par, t) {
      return emettre(t, blesserTruck(degats, par, t));
    },

    explosionTir(j, arme, o, d, distanceTouche, portee, t) {
      const ameliore = estAmelioree(j.equip, arme);
      const e = profilZombie(arme, ameliore).explosion;
      if (!e) return [];
      // le souffle part du premier obstacle : le tigre touché, sinon le mur ou le sol
      let dist = distanceTouche ?? lancerRayon(ctx.monde, o, d, portee);
      if (d[1] < -1e-3) dist = Math.min(dist, (o[1] - 0.05) / -d[1]);
      if (!Number.isFinite(dist) || dist > portee) return [];
      const c: Vec3 = [o[0] + d[0] * dist, o[1] + d[1] * dist, o[2] + d[2] * dist];
      const sorties: Sortie[] = [{ a: "joueurs", sauf: j.id, m: { t: "zevt", e: { e: "explosion", p: c, rayon: e.rayon, par: j.id } } }];
      let premier = true;
      for (const z of [...simu.liste()]) {
        const dz = Math.hypot(z.p[0] - c[0], 0.8 * z.echelle / 2.7 - c[1], z.p[2] - c[2]);
        const degats = t < effets.instakillFinT ? INSTAKILL : degatsExplosion(e, Math.max(0, dz - 0.6));
        if (degats <= 0) continue;
        const pvAvant = z.pv, pvMax = z.pvMax, type = z.type, id = z.id;
        sorties.push(...this.blesser(idZombie(id), degats, j, "corps", t, { arme, gain: premier, cause: "explosion" }));
        premier = false;
        // un souffle qui ne tue pas peut couper les pattes arrière (rampant)
        const apres = simu.zombie(id);
        if (apres && type === 0 && (pvAvant - apres.pv) >= RAMPANT_PART_PV * pvMax && apres.allure !== 3 && alea() < RAMPANT_PROBA) {
          simu.changerAllure(id, 3, ZOMBIES.vitesses[3]);
        }
      }
      return sorties;
    },

    blesser(cible, degats, par, zone: Zone, t, o = {}) {
      if (!estIdZombie(cible) || !simu.zombie(numero(cible))) return [];
      const r = simu.blesser(numero(cible), degats, t);
      const melee = o.melee === true;
      const double = doublePoints(t);
      const sorties: Sortie[] = [{ a: par.id, m: { t: "degats", cible, par: par.id, degats: Math.min(degats, 99_999), pv: r.pvPct, bouclier: 0, zone } }];
      par.degats += Math.min(degats, 99_999);
      let gain = 0;
      if (r.mort) {
        gain += gainKill({ tete: zone === "tete", melee, double });
        if (r.type === 2) gain += GAIN_CHEF;
        par.kills++;
        par.serie++;
        par.serieMax = Math.max(par.serieMax, par.serie);
        if (o.arme) par.killsParArme[o.arme] = (par.killsParArme[o.arme] ?? 0) + 1;
        sorties.push({ a: "joueurs", m: { t: "zombieMort", id: cible, p: r.p ?? [0, 0, 0], par: par.id, zone, ...(o.cause ? { cause: o.cause } : melee ? { cause: "melee" as const } : {}) } });
      } else if (o.gain !== false) {
        gain += gainTouche({ double });
      }
      if (gain > 0) sorties.push(crediter(par, gain, r.mort ? "kill" : "touche"));
      if (r.mort) {
        lacherApresKill(r.type, r.p ?? [0, 0, 0], t, sorties);
        sorties.push(ctx.presence());
      }
      sale = true;
      return sorties;
    },

    recevoir(j, msg: MessageClient, t) {
      switch (msg.t) {
        case "lancerPartie":
          return emettre(t, lancerPartie(j, t, msg.difficulte));
        case "acheter": {
          const sorties = acheter(j, msg.id, t);
          return emettre(t, sorties);
        }
        case "reanimer": {
          if (typeof msg.cible !== "string") { releves.delete(j.id); return []; }
          const m = membre(j.id);
          if ((phase !== "manche" && phase !== "pause") || !peutJouer(j) || m.etat !== "debout" || msg.cible === j.id) return [];
          const cible = ctx.joueur(msg.cible);
          if (!cible || membre(cible.id).etat !== "terre") return [];
          if (Math.hypot(j.p[0] - cible.p[0], j.p[2] - cible.p[2]) > ZOMBIES.reanimationPortee + margeLatence(j)) return [];
          if (releves.get(j.id)?.cible !== cible.id) releves.set(j.id, { cible: cible.id, debutT: t });
          return [];
        }
        case "reparer": {
          const m = membre(j.id);
          if (typeof msg.fenetre !== "string") { m.reparation = null; return []; }
          if ((phase !== "manche" && phase !== "pause") || !peutJouer(j) || m.etat !== "debout") return [];
          const f: Fenetre | null = fenetreDeId(msg.fenetre);
          if (!f || (planches.get(f.id) ?? 0) >= ZOMBIES.planches) return [];
          if (Math.hypot(j.p[0] - f.dedans[0], j.p[2] - f.dedans[1]) > ZOMBIES.reposePortee + margeLatence(j)) return [];
          if (m.reparation?.fenetre !== f.id) m.reparation = { fenetre: f.id, prochainT: t + ZOMBIES.reposeS * 1000 };
          return [];
        }
        default:
          return [];
      }
    },

    surMort(j, t) {
      const m = membre(j.id);
      m.etat = "terre";
      m.terreFinT = t + ZOMBIES.terreMs;
      m.reparation = null;
      // BO1 : on perd ses atouts en tombant ; seul avec la Pause Café, on se relève tout seul (3 fois)
      const pauseCafe = m.atouts.has("pausecafe");
      m.atouts.clear();
      if (pauseCafe && solo() && m.autoReleves > 0) { m.autoReleves--; m.autoReleveT = t + AUTO_RELEVE_MS; }
      for (const [par, r] of releves) if (r.cible === j.id || par === j.id) releves.delete(par);
      immediat = true;
      verifierDefaite(t);
      return [...emettre(t, []), ctx.presence()];
    },

    liberer(j, t) {
      for (const [par, r] of releves) if (r.cible === j.id || par === j.id) releves.delete(par);
      if (!ctx.joueur(j.id)) {
        membres.delete(j.id);
      } else {
        remettreMembre(membre(j.id));
      }
      immediat = true;
      const sorties: Sortie[] = [];
      if (ctx.joueurs().length === 0 && phase !== "lobby") {
        // salle vide : retour immédiat au lobby, personne à prévenir
        sorties.push(...retourLobby(t));
      } else {
        verifierDefaite(t);
      }
      return emettre(t, sorties);
    },

    arrivee(j, t) {
      membre(j.id);
      immediat = true;
      return emettre(t, []);
    },

    aTerre(id) {
      return membres.get(id)?.etat === "terre";
    },

    enCours() {
      return phase === "pause" || phase === "manche";
    },

    etat,

    resume(): ResumeZombies {
      return { phase, joueurs: ctx.joueurs().length, manche };
    },
  };
}

/** Liste des achats (réexport pour les essais). */
export { ACHATS };
export type { ArmeId };
