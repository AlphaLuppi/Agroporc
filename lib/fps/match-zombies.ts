/**
 * Service « zombies tigres » de la salle (PUR : l'horloge `maintenant` est passée à chaque appel, le hasard est injecté par `alea` ; ne voit
 * la salle que par `ContexteSalle`). Machine d'états lobby → pause → manche → pause … → fin → lobby, hôte, join-in-progress, argent, achats
 * au mur, portes payantes, joueurs à terre, relève, élimination, bilan. Les tigres eux-mêmes sont simulés par `zombies.ts`.
 *
 * Choix de conception :
 * - l'argent, l'état (debout / à terre / éliminé / en attente), l'admission et les relèves de chaque joueur vivent dans une `Map` du service
 *   (aucun champ de `JoueurSalle`) ; `kills` / `morts` de `JoueurSalle` comptent les tigres tués et les mises à terre ;
 * - aucune dispersion, aucun message `mort` : la mise à terre passe par `surMort` (appelé par `Salle.mourir`) ;
 * - `zombies{etat}` est diffusé aux changements (≤ 5 Hz), tout de suite pour mise à terre / relève / élimination / porte / fin.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md
 */
import { STATS } from "./armes";
import { batimentsDetruits, detruireBatiment, releverBatiments, visible } from "./collision";
import { ARMES, copierEquipement, estIdZombie, JEU } from "./protocole";
import { armeDuSlot, meleeDe } from "./equipement";
import { munitionsOffertes } from "./elsa";
import type { ContexteSalle, JoueurSalle, ResumeZombies, ServiceZombies, Sortie } from "./match-contexte";
import { invaliderNavigation } from "./navigation";
import type {
  ArmeFeuId, ArmeSpecialeId, EtatPartieZombies, Equipement, JoueurZombies, MessageClient, PhaseZombies, RaisonAchat, Slot, Vec3, Zone,
} from "./protocole";
import { creerSimuZombies } from "./zombies";
import {
  DEPARTS, FENETRES, PIECES_SYNTH, PORTES_PAYANTES, achatDeId, distancePorte, idPrisme, lacetDepart, porteDeId,
  type Achat, type DonneesZombies, type Fenetre, type PorteId,
} from "./zombies-carte";
import {
  ZOMBIES, bonusFinManche, gainKill, gainTouche, intervalleApparition, plafondVivantsManche, typesManche, type TypeZombie,
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
/** Poids d'une arme spéciale dans le tirage de la boîte (les autres armes pèsent 1). */
export const POIDS_SPECIALE_BOITE = 0.4;
/** Plus grand pas de temps (s) donné à la simulation des tigres (un tic en retard ne téléporte pas les tigres). */
const DT_MAX_S = 0.25;
/** Hauteur (m) des points de visée pour la ligne de vue d'un achat. */
const HAUTEUR_ACHAT_M = 1.2;

export interface OptionsServiceZombies {
  /** hasard injecté, [0, 1[ */
  alea: () => number;
  /** données de la carte (fenêtres, départs) ; par défaut celles de `zombies-carte.ts` */
  donnees?: Pick<DonneesZombies, "fenetres" | "departs">;
  /** argent de départ ($), `PDJ_FPS_ZOMBIES_ARGENT` */
  argentDepart?: number;
  /** nombre de tigres de la manche 1 (essais), `PDJ_FPS_ZOMBIES_TOTAL` */
  total1?: number;
  /** durée du décompte de départ ET des pauses entre manches (ms, essais), `PDJ_FPS_ZOMBIES_PAUSE_MS` */
  pauseMs?: number;
  /** dégâts de griffe imposés (essais), `PDJ_FPS_ZOMBIES_GRIFFE` */
  degatsGriffe?: number;
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
  /** instant avant lequel le soin du membre n'est pas rachetable */
  soinPretT: number;
  /** instant de l'admission (attend son `rejoindre` au plus `attenteChargementMaxMs`) */
  admisT: number;
}

/** Relève en cours : `cible` maintenue par le relanceur depuis `debutT`. */
interface Releve { cible: string; debutT: number }

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
  const fenetresCarte: readonly Fenetre[] = opts.donnees?.fenetres ?? FENETRES;
  const departs: readonly Vec2[] = opts.donnees?.departs ?? DEPARTS;
  const argentDepart = opts.argentDepart ?? ZOMBIES.argentDepart;
  const pauseMs = opts.pauseMs ?? ZOMBIES.pauseMs;
  const decompteMs = opts.pauseMs ?? ZOMBIES.decompteDepartMs;
  const simu = creerSimuZombies({ monde: ctx.monde, alea, ...(opts.degatsGriffe !== undefined ? { degatsGriffe: opts.degatsGriffe } : {}) });

  const membres = new Map<string, Membre>();
  const ouvertes = new Set<PorteId>();
  const releves = new Map<string, Releve>();

  let phase: PhaseZombies = "lobby";
  let manche = 0;
  let debutT = 0;
  let finT = 0;
  let bilan: { manche: number; dureeMs: number } | undefined;
  let partieDebutT = 0;
  let dernierT = 0;
  // manche en cours
  let file: TypeZombie[] = [];
  let indexFile = 0;
  let plafond: number = ZOMBIES.plafondVivants;
  let debutApparitionT: number | null = null;
  let prochaineApparitionT = 0;
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
      m = { etat: "attente", admis: false, argent: 0, gagne: 0, reanimations: 0, soinPretT: 0, admisT: 0 };
      membres.set(id, m);
    }
    return m;
  }
  const hote = (): string => ctx.joueurs()[0]?.id ?? "";
  const restants = (): number => file.length - indexFile + simu.nbVivants();
  const peutJouer = (j: JoueurSalle): boolean => j.enJeu && j.vivant;

  function etat(): EtatPartieZombies {
    const joueurs: JoueurZombies[] = ctx.joueurs().map((j) => {
      const m = membre(j.id);
      return {
        id: j.id, pseudo: j.pseudo, couleur: j.couleur, etat: m.etat, admis: m.admis, kills: j.kills, gagne: m.gagne, reanimations: m.reanimations,
        ...(m.etat === "terre" && m.terreFinT !== undefined ? { terreFinT: m.terreFinT } : {}),
      };
    });
    return {
      phase, manche, hote: hote(), capacite: ZOMBIES.joueursMax, debutT, finT, joueurs,
      portes: PORTES_PAYANTES.map((p) => ({ id: p.id, ouverte: ouvertes.has(p.id) })),
      ...(bilan ? { bilan } : {}),
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

  function crediter(j: JoueurSalle, delta: number, motif: string): Sortie {
    const m = membre(j.id);
    m.argent += delta;
    m.gagne += delta;
    sale = true;
    return sortieArgent(j, delta, motif);
  }

  const debout = (): JoueurSalle[] => ctx.joueurs().filter((j) => peutJouer(j) && membre(j.id).etat === "debout");
  /** Membres admis restés debout (même s'ils n'ont pas encore rejoint) : la partie n'est perdue que si plus personne ne l'est. */
  const nbDebout = (): number => { let n = 0; for (const j of ctx.joueurs()) { const m = membre(j.id); if (m.admis && m.etat === "debout") n++; } return n; };

  /** Slot en main valide pour un équipement (le slot demandé, sinon la secondaire, la principale, l'arme blanche). */
  function mainValide(eq: Equipement, main: Slot): Slot {
    if (main !== "speciale" && armeDuSlot(eq, main) !== null) return main;
    for (const s of ["secondaire", "principale", "couteau"] as const) if (armeDuSlot(eq, s) !== null) return s;
    return "couteau";
  }

  // ---------------------------------------------------------------------------------------------
  // transitions
  // ---------------------------------------------------------------------------------------------

  function ouvrirBatimentsComplets(): Sortie {
    return { a: "tous", m: { t: "batiments", complet: true, detruits: batimentsDetruits(ctx.monde), breches: [] } };
  }

  /** Remet les portes en place (nouvelle partie, retour au lobby) : prismes relevés, navigation recalculée si une porte avait été ouverte. */
  function refermerPortes(): void {
    const avait = ouvertes.size > 0;
    ouvertes.clear();
    releverBatiments(ctx.monde);
    if (avait) {
      invaliderNavigation(ctx.monde);
      simu.rafraichirCarte();
    }
  }

  function remettreAZero(j: JoueurSalle): void {
    j.kills = 0; j.morts = 0; j.tirs = 0; j.touches = 0; j.tetes = 0; j.degats = 0; j.serie = 0; j.serieMax = 0; j.killsParArme = {};
  }

  /** Retour au lobby : tous les joueurs sortent de l'arène, portes refermées, tigres retirés, membres remis en attente. */
  function retourLobby(t: number): Sortie[] {
    const sorties: Sortie[] = [];
    for (const j of ctx.joueurs()) {
      if (j.enJeu) sorties.push(...ctx.retirerJoueur(j, t));
      const m = membre(j.id);
      m.etat = "attente"; m.admis = false; m.argent = 0; m.gagne = 0; m.reanimations = 0; m.terreFinT = undefined; m.soinPretT = 0;
    }
    releves.clear();
    simu.reinitialiser();
    file = []; indexFile = 0; debutApparitionT = null;
    refermerPortes();
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
    file = []; indexFile = 0; debutApparitionT = null;
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

  /** Relève d'un joueur à terre à sa position (PV 50, équipement conservé, apparition). */
  function relever(j: JoueurSalle, t: number): Sortie[] {
    const m = membre(j.id);
    m.etat = "debout";
    m.terreFinT = undefined;
    const equip = copierEquipement({ ...j.equip, speciale: null });
    const sorties = ctx.placerJoueur(j, [j.p[0], j.p[1], j.p[2]], j.lacet, { pv: ZOMBIES.reanimationPv, equip, main: mainValide(equip, j.main) }, t);
    for (const [par, r] of releves) if (r.cible === j.id) releves.delete(par);
    releves.delete(j.id);
    immediat = true;
    return sorties;
  }

  /** Début de la pause qui suit une manche (ou de la partie) : bonus, relèves, retours, admissions. */
  function entrerEnPause(t: number, numero: number, duree: number, avecBonus: boolean): Sortie[] {
    const sorties: Sortie[] = [];
    if (avecBonus) {
      const bonus = bonusFinManche(manche);
      for (const j of ctx.joueurs()) {
        if (membre(j.id).etat === "debout" && j.enJeu) sorties.push(crediter(j, bonus, "manche"));
      }
    }
    manche = numero;
    phase = "pause"; debutT = t; finT = t + duree;
    for (const j of ctx.joueurs()) {
      const m = membre(j.id);
      if (m.etat === "terre") {
        sorties.push(...relever(j, t));
      } else if (m.etat === "elimine") {
        m.etat = "debout"; m.terreFinT = undefined; m.argent = argentDepart; m.admisT = t;
        sorties.push(...remettreEnJeu(j, t, JEU.pvMax), sortieArgent(j, 0, "retour"));
      } else if (m.etat === "attente" && !m.admis) {
        m.etat = "debout"; m.admis = true; m.admisT = t; m.argent = argentDepart; m.gagne = 0; m.reanimations = 0; m.soinPretT = 0;
        remettreAZero(j);
        sorties.push(sortieArgent(j, 0, "depart"));
      }
    }
    releves.clear();
    immediat = true;
    return sorties;
  }

  function lancerPartie(j: JoueurSalle, t: number): Sortie[] {
    if (phase !== "lobby" || hote() !== j.id) return [];
    const membresSalle = ctx.joueurs();
    if (!membresSalle.length) return [];
    const sorties: Sortie[] = [];
    refermerPortes();
    simu.reinitialiser();
    file = []; indexFile = 0; debutApparitionT = null;
    releves.clear();
    partieDebutT = t;
    bilan = undefined;
    for (const o of membresSalle) {
      const m = membre(o.id);
      m.etat = "debout"; m.admis = true; m.admisT = t; m.argent = argentDepart; m.gagne = 0; m.reanimations = 0; m.terreFinT = undefined; m.soinPretT = 0;
      remettreAZero(o);
      sorties.push(sortieArgent(o, 0, "depart"));
    }
    manche = 1;
    phase = "pause"; debutT = t; finT = t + decompteMs;
    sorties.push(ouvrirBatimentsComplets(), ctx.presence());
    immediat = true;
    return sorties;
  }

  function debuterManche(t: number): void {
    const nJoueurs = Math.max(1, ctx.joueurs().filter((j) => membre(j.id).admis).length);
    let types = typesManche(manche, nJoueurs, alea);
    if (manche === 1 && opts.total1 !== undefined) {
      const total = Math.max(0, Math.round(opts.total1));
      types = types.slice(0, total);
      while (types.length < total) types.push(0);
    }
    file = types; indexFile = 0;
    plafond = plafondVivantsManche(manche, nJoueurs);
    phase = "manche"; debutT = t; finT = 0;
    // manche 1 : les apparitions attendent le chargement des clients (cf. `ticManche`) ; les suivantes partent tout de suite
    debutApparitionT = manche === 1 ? null : t;
    prochaineApparitionT = t;
    immediat = true;
  }

  // ---------------------------------------------------------------------------------------------
  // manche
  // ---------------------------------------------------------------------------------------------

  /** Point d'apparition : fenêtre active dont le joueur debout le plus proche est à ≥ 15 m (sinon n'importe laquelle), au hasard. */
  function choisirPoint(joueurs: readonly JoueurSalle[]): Vec2 | null {
    const actives = fenetresCarte.filter((f) => f.porte === null || ouvertes.has(f.porte));
    if (!actives.length) return null;
    const loin = actives.filter((f) => joueurs.every((j) => Math.hypot(j.p[0] - f.milieu[0], j.p[2] - f.milieu[1]) >= 15));
    const liste = loin.length ? loin : actives;
    const f = liste[Math.min(liste.length - 1, Math.floor(alea() * liste.length))];
    const k = Math.min(f.points.length - 1, Math.floor(alea() * f.points.length));
    // un point déjà occupé par un tigre (à moins de 1,4 m) est évité si un autre de la fenêtre est libre
    for (let i = 0; i < f.points.length; i++) {
      const p = f.points[(k + i) % f.points.length];
      if (!simu.liste().some((z) => Math.hypot(z.p[0] - p[0], z.p[2] - p[1]) < ZOMBIES.separationM)) return p;
    }
    return f.points[k];
  }

  function apparaitre(t: number): void {
    if (debutApparitionT === null || t < debutApparitionT || t < prochaineApparitionT) return;
    if (indexFile >= file.length || simu.nbVivants() >= plafond) return;
    const presents = debout();
    if (!presents.length) return;
    const point = choisirPoint(presents);
    if (!point) return;
    const id = simu.apparaitre(file[indexFile], point, manche, t);
    if (id === null) return;
    indexFile++;
    prochaineApparitionT = t + intervalleApparition(manche) * 1000;
    sale = true;
  }

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
    const cibles = membresSalle.filter((j) => peutJouer(j) && membre(j.id).etat === "debout").map((j) => ({ id: j.id, p: j.p, vivant: true }));
    for (const e of simu.tic(t, dt, cibles)) {
      if (phase !== "manche") break; // une griffe précédente a couché le dernier joueur debout : partie perdue, les suivantes ne comptent plus
      if (e.t !== "griffe") continue;
      const j = ctx.joueur(e.joueur);
      if (!j || !peutJouer(j) || t < j.protegeJusqua) continue;
      const z = simu.zombie(e.tigre);
      sorties.push(...ctx.infliger(j, e.degats, null, "tigre_zombie", "corps", "couteau", t, z ? [z.p[0], 1, z.p[2]] : undefined));
    }
    if (phase !== "manche") return; // une griffe a pu coucher le dernier joueur debout

    apparaitre(t);

    // relèves : le relanceur maintient E à portée, la cible est à terre
    for (const [parId, r] of [...releves]) {
      const par = ctx.joueur(parId), cible = ctx.joueur(r.cible);
      if (!par || !cible || !peutJouer(par) || membre(parId).etat !== "debout" || membre(r.cible).etat !== "terre"
        || Math.hypot(par.p[0] - cible.p[0], par.p[2] - cible.p[2]) > ZOMBIES.reanimationAnnulePortee) {
        releves.delete(parId);
        continue;
      }
      if (t - r.debutT >= ZOMBIES.reanimationS * 1000) {
        membre(parId).reanimations++;
        sorties.push(...relever(cible, t));
      }
    }

    // éliminations : 45 s à terre sans relève
    for (const j of membresSalle) {
      const m = membre(j.id);
      if (m.etat === "terre" && m.terreFinT !== undefined && t >= m.terreFinT) {
        m.etat = "elimine"; m.terreFinT = undefined;
        for (const [par, r] of releves) if (r.cible === j.id || par === j.id) releves.delete(par);
        immediat = true;
      }
    }
    verifierDefaite(t);
    if (phase !== "manche") return;

    // fin de manche : tous les tigres sont apparus ET morts
    if (debutApparitionT !== null && indexFile >= file.length && simu.nbVivants() === 0) {
      sorties.push(...entrerEnPause(t, manche + 1, pauseMs, true));
    }
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

  /** Point le plus proche du segment de la porte, ramené de 1 m vers le joueur (hors de l'épaisseur de la pièce). */
  function pointPorte(porte: (typeof PORTES_PAYANTES)[number], j: JoueurSalle): Vec2 {
    const [p, q] = segmentPorte(porte.prismes[0]);
    const ux = q[0] - p[0], uz = q[1] - p[1], l2 = ux * ux + uz * uz;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((j.p[0] - p[0]) * ux + (j.p[2] - p[1]) * uz) / l2)) : 0;
    const cx = p[0] + ux * k, cz = p[1] + uz * k;
    const dx = j.p[0] - cx, dz = j.p[2] - cz, d = Math.hypot(dx, dz);
    if (d <= 1) return [j.p[0], j.p[2]];
    return [cx + (dx / d) * 1, cz + (dz / d) * 1];
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
      if (distancePorte(porte, pos) > porte.portee) return refus(j, idTexte, "loin");
      if (ouvertes.has(porte.id)) return refus(j, idTexte, "deja");
      if (!aVue(j, pointPorte(porte, j))) return refus(j, idTexte, "loin");
      if (porte.prerequis && !ouvertes.has(porte.prerequis)) return refus(j, idTexte, "verrou");
    } else {
      if (Math.hypot(pos[0] - achat.position[0], pos[1] - achat.position[1]) > achat.rayon) return refus(j, idTexte, "loin");
      if (!aVue(j, achat.position)) return refus(j, idTexte, "loin");
    }
    switch (achat.genre) {
      case "porte": return acheterPorte(j, achat, m);
      case "mur": return acheterMur(j, achat, m, t);
      case "boite": return acheterBoite(j, achat, m, t);
      case "soin": return acheterSoin(j, achat, m, t);
    }
  }

  function payer(j: JoueurSalle, m: Membre, achat: Achat, prix: number): Sortie[] {
    m.argent -= prix;
    sale = true;
    return [{ a: j.id, m: { t: "achat", ok: true, id: achat.id } }, sortieArgent(j, -prix, "achat")];
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
    invaliderNavigation(ctx.monde);
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
      return [...payer(j, m, achat, achat.prix), ...ctx.equiper(j, equip, j.main, t)];
    }
    if (possede(j.equip, arme)) {
      // l'arme est déjà là : recharge de munitions à moitié prix
      if (achat.prixMunitions === undefined) return refus(j, achat.id, "deja");
      if (m.argent < achat.prixMunitions) return refus(j, achat.id, "argent");
      return [...payer(j, m, achat, achat.prixMunitions), ...ctx.equiper(j, copierEquipement(j.equip), j.main, t, arme)];
    }
    if (m.argent < achat.prix) return refus(j, achat.id, "argent");
    return [...payer(j, m, achat, achat.prix), ...equiperNouvelle(j, arme, t)];
  }

  /** L'arme à feu `arme` (non possédée) remplace celle de sa catégorie, passe en main, chargeurs pleins. */
  function equiperNouvelle(j: JoueurSalle, arme: ArmeFeuId, t: number): Sortie[] {
    const equip = copierEquipement(j.equip);
    const categorie = STATS[arme].categorie;
    ctx.memoriserPrecedent(j);
    delete j.cadenceArme[arme];
    if (categorie === "speciale") {
      equip.speciale = arme as ArmeSpecialeId;
      j.munSpeciale = munitionsOffertes(arme as ArmeSpecialeId);
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
    const candidates = ARMES.filter((a) => !possede(j.equip, a));
    if (!candidates.length) return refus(j, achat.id, "deja");
    if (m.argent < achat.prix) return refus(j, achat.id, "argent");
    const poids = candidates.map((a) => (STATS[a].categorie === "speciale" ? POIDS_SPECIALE_BOITE : 1));
    let r = alea() * poids.reduce((s, x) => s + x, 0);
    let k = 0;
    for (; k < candidates.length - 1; k++) { r -= poids[k]; if (r < 0) break; }
    return [...payer(j, m, achat, achat.prix), ...equiperNouvelle(j, candidates[k], t)];
  }

  function acheterSoin(j: JoueurSalle, achat: Achat, m: Membre, t: number): Sortie[] {
    if (t < m.soinPretT) return refus(j, achat.id, "deja");
    if (m.argent < achat.prix) return refus(j, achat.id, "argent");
    const sorties = payer(j, m, achat, achat.prix);
    m.soinPretT = t + ZOMBIES.soinRechargeS * 1000;
    j.pv = JEU.pvMax;
    j.regenAcc = 0;
    return sorties;
  }

  // ---------------------------------------------------------------------------------------------
  // service
  // ---------------------------------------------------------------------------------------------

  const numero = (id: string): number => Number(id.slice(1));

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
      if (phase === "pause" && t >= finT) debuterManche(t);
      if (phase === "manche") ticManche(t, dt, sorties);
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
      return phase === "lobby" ? null : simu.snap(restants(), dernierT);
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

    blesser(cible, degats, par, zone: Zone, t, o = {}) {
      if (!estIdZombie(cible) || !simu.zombie(numero(cible))) return [];
      const r = simu.blesser(numero(cible), degats, t);
      const melee = o.melee === true;
      const sorties: Sortie[] = [{ a: par.id, m: { t: "degats", cible, par: par.id, degats, pv: r.pvPct, bouclier: 0, zone } }];
      par.degats += degats;
      let gain = o.gain === false ? 0 : gainTouche(manche, { tete: zone === "tete", melee });
      if (r.mort) {
        gain += gainKill(manche, { tete: zone === "tete", melee });
        par.kills++;
        par.serie++;
        par.serieMax = Math.max(par.serieMax, par.serie);
        if (o.arme) par.killsParArme[o.arme] = (par.killsParArme[o.arme] ?? 0) + 1;
        sorties.push({ a: "joueurs", m: { t: "zombieMort", id: cible, p: r.p ?? [0, 0, 0], par: par.id, zone } });
      }
      if (gain > 0) sorties.push(crediter(par, gain, r.mort ? "kill" : "touche"));
      if (r.mort) sorties.push(ctx.presence());
      sale = true;
      return sorties;
    },

    recevoir(j, msg: MessageClient, t) {
      switch (msg.t) {
        case "lancerPartie":
          return emettre(t, lancerPartie(j, t));
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
          if (Math.hypot(j.p[0] - cible.p[0], j.p[2] - cible.p[2]) > ZOMBIES.reanimationPortee) return [];
          if (releves.get(j.id)?.cible !== cible.id) releves.set(j.id, { cible: cible.id, debutT: t });
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
        const m = membre(j.id);
        m.etat = "attente"; m.admis = false; m.argent = 0; m.gagne = 0; m.reanimations = 0; m.terreFinT = undefined;
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

    enCours() {
      return phase === "pause" || phase === "manche";
    },

    etat,

    resume(): ResumeZombies {
      return { phase, joueurs: ctx.joueurs().length, manche };
    },
  };
}

/** Extrémités du segment d'une pièce de la carte (porte payante : son premier prisme). */
function segmentPorte(idPiece: string): [Vec2, Vec2] {
  const piece = PIECES_SYNTH.find((x) => x.id === idPiece);
  if (!piece) throw new Error(`pièce inconnue : ${idPiece}`);
  return [piece.p, piece.q];
}
