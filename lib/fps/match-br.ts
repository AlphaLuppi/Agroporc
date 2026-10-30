/**
 * Service principal du Battle Royale (PUR : l'horloge `maintenant` est passée à chaque appel, le hasard est injecté par `alea` ; ne voit la
 * salle que par `ContexteSalle`). Machine d'états lobby → décompte → vol → jeu → fin, hôte, admission, zone (tempête), places, éliminations,
 * bilan, statistiques ; compose `VolBr` (match-br-vol.ts : avion et chute) et `ButinBr` (match-br-butin.ts : objets au sol, soins).
 *
 * Choix de conception :
 * - l'état de chaque membre (admis, monté dans l'avion, éliminé + instantané) vit dans une `Map` du service, jamais dans `JoueurSalle`
 *   (hors les compteurs de partie remis à zéro au lancement) : `deconnecter` retire le joueur de la table AVANT `liberer`, et le bilan doit
 *   encore compter les partis ;
 * - aucun message `mort` pour une mort au combat ou à la tempête (c'est `Salle.mourir`, qui appelle `surMort`) ; seul l'abandon (`liberer`)
 *   en émet un, la salle ne passant pas par `mourir` dans ce cas ;
 * - `br{etat}` part aux changements (≤ 5 Hz), tout de suite pour ceux qui comptent, et à 1 Hz en vol et en jeu ; la zone y est décrite par
 *   le cercle du palier courant et le cercle visé (le client en tire l'état avec `etatDepuisZoneBr`) ;
 * - la victoire se teste à chaque tic après toutes les morts du tic, jamais dans `surMort` ;
 * - l'avion est tracé au lancement (immobile pendant le décompte, pour que les joueurs montent dedans) puis retracé à l'identique, à la même
 *   graine, quand le décompte se termine : seul `debutT` change.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md
 */
import { centresBatimentsEligibles, pointsButin } from "./br-carte";
import { mulberry32, nbObjetsPour } from "./br-butin";
import { BR } from "./br-regles";
import { appliquerPartie, classementStats, cleStats, estPseudoCompte, nomDeBase, statsVides, type PersistanceBr, type ResultatPartieBr, type StatsBr } from "./br-stats";
import { echelleDureeZone, etatZone, genererPlanZone, horsZone, zoneBrPublique, type PlanZone } from "./br-zone";
import type { Monde } from "./collision";
import type { SceneData } from "../agroparc3d/types";
import type { AidePoliceBr, BotsBr, ButinBr, ContexteSalle, JoueurSalle, ResumeBr, ServiceBr, ServicePolice, Sortie, VolBr } from "./match-contexte";
import { creerBotsBr, type AideBots } from "./match-br-bots";
import type { BudgetNavigation } from "./nav-bots";
import { creerButinBr } from "./match-br-butin";
import { creerVolBr } from "./match-br-vol";
import { POLICE } from "./police";
import { estDifficulte } from "./zombies-vagues";
import {
  JEU, estIdBot, type AvionBr, type BilanBr, type CauseMort, type EtatPartieBr, type JoueurBr, type LigneBilanBr, type LigneStatsBr, type MessageClient,
  type PhaseBr, type PointButin, type Vec3,
} from "./protocole";

/** Persistance des statistiques (implémentée par serveur-fps) : voir br-stats.ts. */
export type { PersistanceBr } from "./br-stats";

export interface OptionsServiceBr {
  alea: () => number;
  /** pour `pointsButin` / les centres de la zone (le monde est `ctx.monde`, issu de `construireMondeBr`) */
  scene: SceneData;
  /** absent : statistiques en mémoire seulement */
  stats?: PersistanceBr;
  joueursMin?: number; decompteMaxMs?: number; decompteMinMs?: number; finAffichageMs?: number;
  /** essais : durée du trajet de l'avion (la vitesse en découle) */
  dureeVolMs?: number;
  altitude?: number; echelleZone?: number; nbObjets?: number;
  /** essais : durée minimale (ms) pour qu'une partie compte dans les statistiques (`BR.partieValideMinMs` par défaut) */
  partieValideMinMs?: number;
  /** injection (tests, ou salle qui précalcule) : sous-services à la place de `creerVolBr` / `creerButinBr` / `creerBotsBr` */
  vol?: VolBr;
  butin?: ButinBr;
  bots?: BotsBr;
  /**
   * (v11, bots) plafond de bots par partie (`BR.botsMax` par défaut, 0 = coupés : `lancerPartie.bots` est ignoré) et quota GLOBAL restant (toutes les parties
   * du serveur, `PDJ_FPS_BR_BOTS_TOTAL` moins les bots déjà en jeu ; absent = illimité). Essai déterministe : `agressif` (graine fixe, les bots cherchent l'humain).
   */
  botsMax?: number;
  botsRestants?: () => number;
  botsEssai?: "agressif";
  /** (lot 3b) budget de recherches de chemin partagé par toutes les salles BR du serveur (un A* par tic en tout) ; absent : un budget par salle */
  budgetNavigation?: BudgetNavigation;
  /** injection (tests) : emplacements du butin à la place de `pointsButin(scene, ctx.monde)` */
  points?: readonly PointButin[];
  /**
   * (2026-10-30) la descente de police de la salle (créée par `Salle`, qui la passe paresseusement : elle est construite après ce service) ; null ou
   * absent : pas de police (tests, serveur sans routes). Le service BR l'arme (`armer`), la remet à blanc et arme la seconde.
   */
  police?: () => ServicePolice | null;
  /** essais (`PDJ_FPS_BR_POLICE_MS`) : délai fixe du premier essai de descente après le départ de l'avion ; remplace aussi les 60 s après le premier atterrissage et les 4 vivants minimum */
  policeMs?: number;
}

/** Plus grand pas de temps (ms) donné à l'accumulateur de la tempête (un tic en retard ne tue pas d'un coup). */
const DT_MAX_MS = 1_000;
/** Délai minimal (ms) entre deux demandes de `statsBr` d'un même joueur. */
const STATS_PERIODE_MS = 2_000;
/** Lignes du palmarès renvoyées par `statsBr`. */
const STATS_LIGNES = 25;

/** Ce que le service retient d'un joueur au moment où il sort de la partie (mort ou départ) : le joueur peut disparaître de la table. */
interface Instantane {
  pseudo: string;
  couleur: string;
  kills: number;
  degats: number;
  tMort: number;
  /** distance (m) au centre de la zone à la mort : départage les morts simultanées (le plus proche du centre est mieux classé) */
  distZone: number;
}

/** Ce que le service retient d'un membre de la salle. */
interface Membre {
  id: string;
  /** dernière identité connue (le joueur peut partir) */
  pseudo: string;
  couleur: string;
  admis: boolean;
  /** a envoyé `rejoindre` : monté dans l'avion */
  monte: boolean;
  elimine: Instantane | null;
  /** place provisoire à la mort, définitive au bilan */
  place: number | null;
  /** reste fractionnaire des dégâts de tempête (PV) */
  reste: number;
}

// Les caches : les emplacements de butin et les centres de la zone ne dépendent que de la scène et du monde, qui ne changent pas en BR.
const cachePoints = new WeakMap<Monde, readonly PointButin[]>();
const cacheCentres = new WeakMap<SceneData, [number, number][]>();

export function creerServiceBr(ctx: ContexteSalle, opts: OptionsServiceBr): ServiceBr {
  const alea = opts.alea;
  const joueursMin = opts.joueursMin ?? BR.joueursMin;
  const decompteMaxMs = opts.decompteMaxMs ?? BR.decompteMaxMs;
  const decompteMinMs = opts.decompteMinMs ?? BR.decompteMinMs;
  const finAffichageMs = opts.finAffichageMs ?? BR.finAffichageMs;
  const partieValideMinMs = opts.partieValideMinMs ?? BR.partieValideMinMs;
  const vol: VolBr = opts.vol ?? creerVolBr(ctx);
  const butin: ButinBr = opts.butin ?? creerButinBr(ctx);
  const botsMax = Math.max(0, Math.floor(opts.botsMax ?? BR.botsMax));

  const membres = new Map<string, Membre>();
  const statsDemandeT = new Map<string, number>();
  let phase: PhaseBr = "lobby";
  let debutT = 0;
  let finT = 0;
  /** début du vol (départ de l'avion), référence des durées de survie et de la partie valide */
  let volDebutT = 0;
  let plan: PlanZone | null = null;
  let signatureZone = "";
  let graineVol = 0;
  let bilan: BilanBr | undefined;
  let annule = false;
  let nonComptee = false;
  let atterrisMax = 0;
  let dernierT = 0;
  let tempeteT = 0;
  // diffusion de br{etat}
  let immediat = false;
  let sale = false;
  let dernierEtatT = -Infinity;
  let signatureSalle = "";
  // statistiques
  let statsCourantes: StatsBr | null = null;
  // bots (v11) : la partie compte des bots (jamais comptée dans les statistiques) ; fin anticipée quand plus aucun humain n'est en vie
  let avecBots = false;
  let finSansHumainT: number | null = null;
  // descente de police (2026-10-30) : réglage de l'hôte, premier atterrissage d'un humain, seconde descente armée, joueurs au départ
  let policeVoulue = true;
  let premierAtterrissageHumainT: number | null = null;
  let secondeArmee = false;
  let nbJoueursDepart = 0;
  const police = (): ServicePolice | null => opts.police?.() ?? null;

  // ---------------------------------------------------------------------------------------------
  // membres, état
  // ---------------------------------------------------------------------------------------------

  function membre(j: { id: string; pseudo: string; couleur: string }): Membre {
    let m = membres.get(j.id);
    if (!m) {
      m = { id: j.id, pseudo: j.pseudo, couleur: j.couleur, admis: false, monte: false, elimine: null, place: null, reste: 0 };
      membres.set(j.id, m);
    }
    return m;
  }
  /** l'hôte est le premier HUMAIN arrivé (les bots n'existent qu'après le lancement, et ne le sont jamais) */
  const hote = (): string => ctx.joueurs().find((j) => !j.bot)?.id ?? "";
  const partants = (): Membre[] => [...membres.values()].filter((m) => m.admis);
  const vivants = (): number => partants().filter((m) => !m.elimine).length;
  const enVolOuJeu = (): boolean => phase === "vol" || phase === "jeu";

  /** Deux membres qui portent le même nom de base (pseudo sans chiffres finaux) : leurs statistiques se confondraient. */
  function conflitDeNoms(): boolean {
    const vus = new Set<string>();
    for (const j of ctx.joueurs()) {
      if (j.bot) continue;
      const base = nomDeBase(j.pseudo);
      if (vus.has(base)) return true;
      vus.add(base);
    }
    return false;
  }

  const distanceCentre = (p: Vec3, t: number): number => {
    if (!plan) return 0;
    const e = etatZone(plan, t);
    return Math.hypot(p[0] - e.centre[0], p[2] - e.centre[1]);
  };

  function etatA(t: number): EtatPartieBr {
    const enPartie = phase !== "lobby";
    const liste = phase === "lobby" || phase === "decompte" || phase === "fin";
    const parts = partants();
    const joueurs: JoueurBr[] | undefined = liste
      ? ctx.joueurs().map((j) => {
        const m = membres.get(j.id);
        return {
          id: j.id, pseudo: j.pseudo, couleur: j.couleur, admis: m?.admis ?? false, vivant: !!m && m.admis && !m.elimine, aBord: vol.aBord(j.id),
          kills: m?.elimine?.kills ?? j.kills, place: m?.place ?? null,
        };
      })
      : undefined;
    return {
      phase, hote: hote(), capacite: BR.joueursMax, minJoueurs: joueursMin, debutT, finT,
      avion: enPartie ? vol.avion() : null,
      zone: plan && enPartie ? zoneBrPublique(plan, t) : null,
      vivants: parts.filter((m) => !m.elimine).length, total: parts.length,
      ...(joueurs ? { joueurs } : {}),
      ...(bilan ? { bilan } : {}),
      ...(annule ? { annule: true as const } : {}),
      ...(phase === "lobby" && conflitDeNoms() ? { conflitNoms: true as const } : {}),
      ...(nonComptee && phase === "fin" ? { nonComptee: true as const } : {}),
      // le réglage de l'hôte n'arrive qu'avec `lancerPartie` : dans le lobby il est inconnu, ne pas publier la valeur par défaut
      ...(phase !== "lobby" ? { police: policeVoulue } : {}),
    };
  }

  const sortieEtat = (t: number): Sortie => ({ a: "tous", m: { t: "br", etat: etatA(t) } });

  /**
   * Ajoute `br{etat}` si un changement urgent est en attente, si un changement ordinaire attend depuis `periodeEtatMs`, ou (en vol et en jeu)
   * pour le battement de `periodeEtatJeuMs`. Seul `tic` déclenche les deux derniers cas.
   */
  function emettre(t: number, sorties: Sortie[], depuisTic = false): Sortie[] {
    const ecoule = t - dernierEtatT;
    const changement = depuisTic && sale && ecoule >= BR.periodeEtatMs;
    const battement = depuisTic && enVolOuJeu() && ecoule >= BR.periodeEtatJeuMs;
    if (immediat || changement || battement) {
      sorties.push(sortieEtat(t));
      immediat = false;
      sale = false;
      dernierEtatT = t;
    }
    return sorties;
  }

  // ---------------------------------------------------------------------------------------------
  // statistiques
  // ---------------------------------------------------------------------------------------------

  /** une écriture de la persistance a échoué : les statistiques de ce service vivent en mémoire jusqu'à la prochaine écriture réussie */
  let enMemoire = false;

  function stats(): StatsBr {
    // la persistance est partagée par toutes les parties du serveur (plusieurs salles BR) : la relire, une autre a pu enregistrer depuis
    if (opts.stats && !enMemoire) {
      try { statsCourantes = opts.stats.lire(); } catch { statsCourantes ??= statsVides(); }
    }
    statsCourantes ??= statsVides();
    return statsCourantes;
  }

  function enregistrer(partie: ResultatPartieBr): void {
    if (partie.lignes.length === 0) return;
    try {
      statsCourantes = opts.stats ? opts.stats.enregistrer(partie) : appliquerPartie(stats(), partie);
      enMemoire = false;
    } catch {
      // l'écriture a échoué : la partie n'est pas bloquée, les statistiques restent en mémoire
      statsCourantes = appliquerPartie(stats(), partie);
      enMemoire = true;
    }
  }

  function messageStats(pseudo: string): Sortie["m"] {
    const moi: LigneStatsBr | undefined = estPseudoCompte(pseudo) ? stats().joueurs[cleStats(pseudo)] : undefined;
    return { t: "statsBr", lignes: classementStats(stats(), STATS_LIGNES), ...(moi ? { moi } : {}) };
  }

  // ---------------------------------------------------------------------------------------------
  // lobby, lancement, décompte
  // ---------------------------------------------------------------------------------------------

  /** Compteurs de partie à zéro : `demarrerMatch` ne s'exécute jamais en BR, sans cela les kills s'additionneraient d'une partie à l'autre. */
  function remettreAZero(j: JoueurSalle): void {
    j.kills = 0; j.morts = 0; j.tirs = 0; j.touches = 0; j.tetes = 0; j.degats = 0; j.serie = 0; j.serieMax = 0; j.killsParArme = {};
  }

  /** Aléa à graine de l'avion : retracé à l'identique quand le décompte se termine. */
  const aleaVol = () => mulberry32(graineVol);
  const optionsVol = (): { dureeMs?: number; altitude?: number } => ({
    ...(opts.dureeVolMs !== undefined ? { dureeMs: opts.dureeVolMs } : {}),
    ...(opts.altitude !== undefined ? { altitude: opts.altitude } : {}),
  });

  function emplacements(): readonly PointButin[] {
    if (opts.points) return opts.points;
    let pts = cachePoints.get(ctx.monde);
    if (!pts) { pts = pointsButin(opts.scene, ctx.monde); cachePoints.set(ctx.monde, pts); }
    return pts;
  }
  function centres(): [number, number][] {
    let c = cacheCentres.get(opts.scene);
    if (!c) { c = centresBatimentsEligibles(opts.scene); cacheCentres.set(opts.scene, c); }
    return c;
  }

  // ---- bots (v11) ----
  /** points d'atterrissage des bots : les emplacements de butin hors toits (aucun toit n'est accessible à pied), mis en cache par tableau d'emplacements */
  let pointsAtt: { source: readonly PointButin[]; points: PointButin[] } | null = null;
  const pointsAtterrissage = (): readonly PointButin[] => {
    const src = emplacements();
    if (!pointsAtt || pointsAtt.source !== src) pointsAtt = { source: src, points: src.filter((p) => p.pool !== "toit") };
    return pointsAtt.points;
  };
  const aideBots: AideBots = {
    phase: () => phase, avion: () => vol.avion(), vol, butin,
    zone: (t) => {
      if (!plan) return null;
      const e = etatZone(plan, t);
      const courant = { centre: e.centre, rayon: e.rayon };
      return { ...(e.cible ? { centre: e.cible.c, rayon: e.cible.r } : courant), courant, palier: e.palier, phase: e.phase };
    },
    points: pointsAtterrissage,
  };
  const aidePolice: AidePoliceBr = {
    phase: () => phase,
    zone: (t) => {
      if (!plan) return null;
      const e = etatZone(plan, t);
      return { centre: e.centre, rayon: e.rayon };
    },
    vivants,
    premierAtterrissageT: () => premierAtterrissageHumainT,
    enVol: (id) => vol.enVol(id),
    estSpectateur: (id) => !!ctx.joueur(id)?.spectateur,
    nbJoueursDepart: () => nbJoueursDepart,
  };
  const bots: BotsBr = opts.bots ?? creerBotsBr(ctx, aideBots, { ...(opts.botsEssai ? { essai: opts.botsEssai } : {}), ...(opts.budgetNavigation ? { budget: opts.budgetNavigation } : {}) });
  const botsRestants = (): number => Math.max(0, Math.floor(opts.botsRestants ? opts.botsRestants() : Infinity));

  /** Retour au lobby : tous les joueurs sortent de l'arène, membres remis en attente, sous-services remis à blanc. */
  function retourLobby(t: number, avecAnnulation = false): Sortie[] {
    const sorties: Sortie[] = [];
    for (const j of ctx.joueurs()) if (j.enJeu) sorties.push(...ctx.retirerJoueur(j, t));
    // les bots n'existent que le temps d'une partie (le prochain lancement en recrée)
    bots.retirerTous();
    avecBots = false; finSansHumainT = null;
    // la voiture de police s'arrête (`police{fin}`), le réglage de l'hôte et l'état de la partie sont remis à blanc
    const pol = police();
    if (pol) sorties.push(...pol.reinitialiser(t, false));
    policeVoulue = true; premierAtterrissageHumainT = null; secondeArmee = false; nbJoueursDepart = 0;
    membres.clear();
    vol.reinitialiser();
    butin.reinitialiser();
    plan = null; signatureZone = ""; bilan = undefined; nonComptee = false; atterrisMax = 0;
    annule = avecAnnulation;
    phase = "lobby"; debutT = t; finT = 0; volDebutT = 0;
    signatureSalle = "";
    sorties.push(ctx.presence());
    immediat = true;
    return sorties;
  }

  /**
   * Lancement par l'hôte. Ordre : (1) comptes (humains + bots contre `joueursMin`, un humain au moins) : un refus est explicite, `refus{lancer}` ; (2) noms
   * en conflit parmi les humains ; (3) création des bots ; (4) la liste des membres est RELUE (les bots y sont) ; (5) admission ; (6) objets et durée de
   * zone calculés sur cette liste.
   * Bots : `msg.bots` (entier, sinon traité comme absent) borné par le plafond de la partie, par la place libre (`joueursMax` − humains − 1 : un arrivant
   * garde une place) et par le quota global restant ; absent avec un seul humain, `BR.botsSolo` ; `botsMax` à 0 les coupe.
   */
  function lancerPartie(j: JoueurSalle, msg: Extract<MessageClient, { t: "lancerPartie" }>, t: number): Sortie[] {
    if (phase !== "lobby" || hote() !== j.id) return [];
    const refus = (raison: "bots" | "limite"): Sortie[] => [{ a: j.id, m: { t: "refus", action: "lancer", raison } }];
    const humains = ctx.joueurs().filter((o) => !o.bot).length;
    const demande = typeof msg.bots === "number" && Number.isInteger(msg.bots) && msg.bots >= 0 ? msg.bots : undefined;
    const voulus = botsMax <= 0 ? 0 : demande ?? (humains === 1 ? BR.botsSolo : 0);
    const restants = botsRestants();
    if (voulus > 0 && restants <= 0) return refus("limite");
    const n = Math.max(0, Math.min(voulus, botsMax, BR.joueursMax - humains - 1, restants));
    if (humains + n < joueursMin) return refus("bots");
    if (conflitDeNoms()) { immediat = true; return []; }
    annule = false;
    // descente de police : activée sauf si l'hôte la décoche (une valeur qui n'est pas un booléen vaut « activée »)
    policeVoulue = typeof msg.police === "boolean" ? msg.police : true;
    if (n > 0) bots.creer(n, estDifficulte(msg.difficulte) ? msg.difficulte : "plat", t);
    avecBots = n > 0; finSansHumainT = null;
    // les bots sont dans la table : la liste est relue APRÈS leur création
    const salle = ctx.joueurs();
    for (const o of salle) {
      const m = membre(o);
      m.admis = true; m.monte = false; m.elimine = null; m.place = null; m.reste = 0;
      remettreAZero(o);
    }
    bilan = undefined; nonComptee = false; atterrisMax = 0; plan = null; signatureZone = "";
    butin.initialiser(emplacements(), Math.floor(alea() * 0x7fffffff), opts.nbObjets ?? nbObjetsPour(salle.length));
    graineVol = Math.floor(alea() * 0x7fffffff);
    // l'avion existe dès le décompte (immobile) : les joueurs y montent en envoyant `rejoindre`
    vol.demarrer([], ctx.monde.bornes, aleaVol(), t + decompteMaxMs, optionsVol());
    phase = "decompte"; debutT = t; finT = t + decompteMaxMs;
    immediat = true;
    return [ctx.presence()];
  }

  /** Le décompte se termine : tous les admis sont montés (au bout de `decompteMinMs` au moins) ou le plafond est atteint. */
  const decompteTermine = (t: number): boolean => {
    if (t >= finT) return true;
    return t - debutT >= decompteMinMs && partants().every((m) => m.monte);
  };

  function demarrerVol(t: number): Sortie[] {
    const bord = partants().filter((m) => m.monte).map((m) => ctx.joueur(m.id)).filter((j): j is JoueurSalle => !!j);
    // jamais de combat de bots sans humain : un humain au moins doit être monté (sinon la partie est annulée, il n'a pas fini de charger)
    if (bord.length < joueursMin || !bord.some((o) => !o.bot)) return retourLobby(t, true);
    const sorties: Sortie[] = [];
    // même trajectoire (même graine), départ à `t` : les joueurs déjà à bord suivent
    vol.demarrer(bord, ctx.monde.bornes, aleaVol(), t, optionsVol());
    phase = "vol"; debutT = t; finT = 0; volDebutT = t; tempeteT = t; atterrisMax = 0;
    premierAtterrissageHumainT = null; secondeArmee = false; nbJoueursDepart = bord.length;
    plan = genererPlanZone({
      bornes: ctx.monde.bornes, debutT: t, alea, centresBatiments: centres(), echelle: opts.echelleZone ?? echelleDureeZone(partants().length),
    });
    signatureZone = "";
    sorties.push(ctx.presence());
    immediat = true;
    return sorties;
  }

  /** Fin du vol : l'admission est close, les admis qui n'ont jamais rejoint repartent en attente. */
  function passerEnJeu(t: number): void {
    for (const m of [...membres.values()]) {
      if (!m.admis || m.monte) continue;
      m.admis = false;
      // un bot qui n'est jamais monté n'a rien à faire dans la salle
      if (estIdBot(m.id)) { ctx.retirerBot(m.id); membres.delete(m.id); }
    }
    phase = "jeu"; debutT = t;
    immediat = true;
    // descente de police : le premier essai est armé ici (les premiers joueurs ont déjà touché le sol pendant le vol) ; `permis` exige en plus 60 s après le
    // premier atterrissage d'un humain. Désactivée par l'hôte : plus jamais.
    const pol = police();
    if (pol) {
      if (!policeVoulue) pol.armer(null);
      else pol.armer(t + (opts.policeMs ?? POLICE.br.premierMinMs + alea() * (POLICE.br.premierMaxMs - POLICE.br.premierMinMs)));
    }
  }

  /** Seconde descente : seulement si la partie comptait `secondeJoueursMin` joueurs au départ (bots compris), 3 à 5 min après la FIN de la première ; jamais une troisième. */
  function armerSeconde(t: number): void {
    const pol = police();
    if (!pol || !policeVoulue || secondeArmee || pol.descentes() !== 1 || pol.enCours() || nbJoueursDepart < POLICE.br.secondeJoueursMin) return;
    secondeArmee = true;
    pol.armer(t + (opts.policeMs ?? POLICE.br.secondeMinMs + alea() * (POLICE.br.secondeMaxMs - POLICE.br.secondeMinMs)));
  }

  // ---------------------------------------------------------------------------------------------
  // tempête, éliminations, fin
  // ---------------------------------------------------------------------------------------------

  /** Garde le plus grand nombre d'atterris vu : `retirer` du sous-service pourrait décompter un joueur mort. */
  function echantillonnerAtterris(): void {
    atterrisMax = Math.max(atterrisMax, vol.atterris());
    // premier atterrissage d'un HUMAIN (les bots ne comptent pas) : un humain monté, en vie, ni à bord ni en chute a touché le sol
    if (premierAtterrissageHumainT === null && phase !== "lobby" && phase !== "decompte") {
      for (const m of membres.values()) {
        if (!m.admis || !m.monte || m.elimine || estIdBot(m.id) || vol.enVol(m.id)) continue;
        if (ctx.joueur(m.id)?.vivant) { premierAtterrissageHumainT = dernierT; break; }
      }
    }
  }

  /** Dégâts de la zone à chaque tic, accumulateur fractionnaire par joueur : les morts ont des instants distincts. */
  function tempete(t: number, sorties: Sortie[]): void {
    if (!plan || t < plan.debutT) return;
    const dt = Math.min(DT_MAX_MS, Math.max(0, t - tempeteT));
    tempeteT = t;
    const e = etatZone(plan, t);
    const sig = `${e.palier}${e.phase}`;
    if (sig !== signatureZone) { signatureZone = sig; sale = true; }
    const degats = (e.degatsParS * dt) / 1000;
    if (degats <= 0) return;
    for (const m of [...membres.values()]) {
      if (!m.admis || !m.monte || m.elimine) continue;
      const j = ctx.joueur(m.id);
      if (!j || !j.enJeu || !j.vivant || vol.aBord(m.id)) continue;
      if (!horsZone(e, j.p[0], j.p[2])) continue;
      m.reste += degats;
      const pv = Math.floor(m.reste);
      if (pv < 1) continue;
      m.reste -= pv;
      sorties.push(...ctx.infliger(j, pv, null, "tempete", "corps", "couteau", t));
    }
  }

  /** Marque le membre éliminé : instantané, place provisoire (vivants restants + 1), plus d'avion ni de chute. */
  function eliminer(m: Membre, j: JoueurSalle, t: number): void {
    echantillonnerAtterris();
    m.elimine = {
      pseudo: j.pseudo, couleur: j.couleur, kills: j.kills, degats: j.degats, tMort: t, distZone: distanceCentre(j.p, t),
    };
    m.pseudo = j.pseudo; m.couleur = j.couleur;
    m.place = vivants() + 1;
    m.reste = 0;
    vol.retirer(m.id);
    sale = true;
  }

  /** Dernier survivant, ou personne : partie terminée si un seul est vivant (parmi plusieurs partants) ou aucun. */
  function verifierVictoire(t: number, sorties: Sortie[]): void {
    if (!enVolOuJeu()) return;
    const restants = vivants();
    const nbPartants = partants().filter((m) => m.monte).length;
    if (restants === 0 || (restants <= 1 && nbPartants > 1)) sorties.push(...terminer(t));
  }

  /** Place définitive : instant de mort (le dernier debout d'abord), puis distance au centre de la zone, puis id. Les survivants passent devant. */
  function classer(t: number): { m: Membre; id: string; src: Instantane }[] {
    const lignes = partants().filter((m) => m.monte).map((m) => {
      const j = ctx.joueur(m.id);
      const src: Instantane = m.elimine ?? {
        pseudo: j?.pseudo ?? m.pseudo, couleur: j?.couleur ?? m.couleur, kills: j?.kills ?? 0, degats: j?.degats ?? 0,
        tMort: Infinity, distZone: j ? distanceCentre(j.p, t) : 0,
      };
      return { m, id: m.id, src };
    });
    return lignes.sort((a, b) => {
      if (a.src.tMort !== b.src.tMort) return a.src.tMort > b.src.tMort ? -1 : 1;
      if (a.src.distZone !== b.src.distZone) return a.src.distZone - b.src.distZone;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  /** Fin de la partie : places, bilan, statistiques (si la partie compte), `br{etat}` immédiat avec le bilan, puis `statsBr`. */
  function terminer(t: number): Sortie[] {
    if (!enVolOuJeu()) return [];
    echantillonnerAtterris();
    const classes = classer(t);
    const dureeMs = Math.max(0, t - volDebutT);
    const lignes: LigneBilanBr[] = classes.map(({ m, id, src }, i) => {
      const j = ctx.joueur(id);
      m.place = i + 1;
      return {
        id, pseudo: j?.pseudo ?? src.pseudo, couleur: j?.couleur ?? src.couleur, place: i + 1, kills: src.kills, degats: Math.round(src.degats),
        survieS: Math.round((Math.max(0, Math.min(src.tMort, t) - volDebutT)) / 100) / 10,
        ...(estIdBot(id) ? { bot: true as const } : {}),
      };
    });
    bilan = { vainqueurs: lignes.length > 0 ? [lignes[0].id] : [], dureeMs, lignes };
    // une partie avec des bots est de l'entraînement : jamais comptée
    const compte = !avecBots && atterrisMax >= BR.atterrisMin && dureeMs >= partieValideMinMs;
    nonComptee = !compte;
    if (compte) {
      enregistrer({ t, lignes: lignes.filter((l) => !l.bot && estPseudoCompte(l.pseudo)).map((l) => ({ pseudo: l.pseudo, place: l.place, kills: l.kills })) });
    }
    phase = "fin"; debutT = t; finT = t + finAffichageMs;
    // `br{etat}` avec le bilan part tout de suite (il remplace l'état en attente)
    const sorties: Sortie[] = [sortieEtat(t)];
    // la voiture de police ne roule pas sur l'écran de fin
    const pol = police();
    if (pol) sorties.push(...pol.reinitialiser(t, false));
    immediat = false; sale = false; dernierEtatT = t;
    // le palmarès à jour, chacun avec sa ligne (`moi`)
    for (const j of ctx.joueurs()) if (!j.bot) sorties.push({ a: j.id, m: messageStats(j.pseudo) });
    return sorties;
  }

  /**
   * Plus aucun humain en vie (tous éliminés, la place de chacun est fixée) : la partie ne se joue plus que pour les bots. Elle se termine
   * `BR.finSansHumainMs` après la dernière mort humaine (de quoi voir la killcam du dernier), avec bilan et places figées. Sans effet hors partie avec bots.
   */
  function verifierFinSansHumain(t: number, sorties: Sortie[]): void {
    if (!avecBots || !enVolOuJeu()) return;
    const humains = partants().filter((m) => m.monte && !estIdBot(m.id));
    if (humains.some((m) => !m.elimine)) { finSansHumainT = null; return; }
    if (finSansHumainT === null) finSansHumainT = (humains.length > 0 ? Math.max(...humains.map((m) => m.elimine!.tMort)) : t) + BR.finSansHumainMs;
    if (t >= finSansHumainT) sorties.push(...terminer(t));
  }

  // ---------------------------------------------------------------------------------------------
  // service
  // ---------------------------------------------------------------------------------------------

  return {
    tic(t) {
      dernierT = t;
      const sorties: Sortie[] = [];
      if (phase === "lobby") {
        if (membres.size > ctx.joueurs().length) {
          const presents = new Set(ctx.joueurs().map((j) => j.id));
          for (const id of membres.keys()) if (!presents.has(id)) membres.delete(id);
        }
        // un pseudo ou une couleur change sans prévenir le service : on le voit à la liste
        const sig = ctx.joueurs().map((j) => `${j.id}\u0000${j.pseudo}\u0000${j.couleur}`).join("\u0001");
        if (sig !== signatureSalle) { signatureSalle = sig; sale = true; }
        return emettre(t, sorties, true);
      }
      sorties.push(...vol.tic(t));
      if (phase === "fin") {
        if (t >= finT) sorties.push(...retourLobby(t));
        return emettre(t, sorties, true);
      }
      if (phase === "decompte") {
        // les bots montent à bord comme des clients qui ont fini de charger
        sorties.push(...bots.tic(t));
        if (decompteTermine(t)) sorties.push(...demarrerVol(t));
        return emettre(t, sorties, true);
      }
      // vol et jeu
      echantillonnerAtterris();
      const avion: AvionBr | null = vol.avion();
      if (phase === "vol" && avion && t >= avion.finT) passerEnJeu(t);
      // les cerveaux des bots (sur une copie de leur liste) : leurs sorties (tirs, dégâts, morts) sont rendues avec les autres
      sorties.push(...bots.tic(t));
      sorties.push(...butin.tic(t));
      tempete(t, sorties);
      verifierVictoire(t, sorties);
      verifierFinSansHumain(t, sorties);
      if (phase === "jeu") armerSeconde(t);
      return emettre(t, sorties, true);
    },

    reinitialiser(t) {
      dernierT = t;
      return emettre(t, retourLobby(t));
    },

    synchro(idDest) {
      const sorties: Sortie[] = [{ a: idDest, m: { t: "br", etat: etatA(dernierT) } }];
      if (phase !== "lobby") sorties.push(...butin.synchro(idDest));
      return sorties;
    },

    admis(id) {
      const m = membres.get(id);
      return !!m && m.admis && !m.elimine && (phase === "decompte" || phase === "vol");
    },

    entreeJoueur(j, t) {
      dernierT = Math.max(dernierT, t);
      const m = membres.get(j.id);
      if (!m || !m.admis || m.elimine || (phase !== "decompte" && phase !== "vol")) return [];
      const avion = vol.avion();
      if (phase === "vol" && avion && t >= avion.finT) return [];
      m.monte = true;
      m.pseudo = j.pseudo; m.couleur = j.couleur;
      sale = true;
      return vol.entrer(j, t);
    },

    aBord(id) {
      return vol.aBord(id);
    },

    enVol(id) {
      return vol.enVol(id);
    },

    chute(id) {
      return vol.chute(id);
    },

    recevoir(j, msg: MessageClient, t) {
      dernierT = Math.max(dernierT, t);
      switch (msg.t) {
        case "lancerPartie":
          return emettre(t, lancerPartie(j, msg, t));
        case "sauter": {
          const m = membres.get(j.id);
          if (phase !== "vol" || !m || !m.monte || m.elimine) return [];
          return vol.sauter(j, t);
        }
        case "chute": {
          const m = membres.get(j.id);
          if (!enVolOuJeu() || !m || !m.monte || m.elimine) return [];
          vol.recevoirChute(j, msg, t);
          return [];
        }
        case "ramasser":
        case "lacher":
        case "utiliser": {
          const m = membres.get(j.id);
          if (!enVolOuJeu() || !m || !m.monte || m.elimine) return [];
          return butin.recevoir(j, msg, t);
        }
        case "statsBr": {
          if (t - (statsDemandeT.get(j.id) ?? -Infinity) < STATS_PERIODE_MS) return [];
          statsDemandeT.set(j.id, t);
          return [{ a: j.id, m: messageStats(j.pseudo) }];
        }
        default:
          return [];
      }
    },

    surDegats(j, cause: CauseMort, t) {
      if (cause === "tempete") return;
      butin.surDegats(j, cause, t);
    },

    tueurValide(tueur, t) {
      const m = membres.get(tueur.id);
      if (!m || !m.admis || !m.monte) return false;
      return !m.elimine || m.elimine.tMort === t;
    },

    surMort(cible, tueur, _cause, t) {
      dernierT = Math.max(dernierT, t);
      const m = membres.get(cible.id);
      if (!enVolOuJeu() || !m || !m.admis || !m.monte || m.elimine) return [];
      const sorties: Sortie[] = [];
      eliminer(m, cible, t);
      if (tueur) {
        const mt = membres.get(tueur.id);
        if (mt?.elimine) {
          // kill croisé au même tic : le tueur est déjà mort, son instantané suit ses compteurs (et il n'est pas soigné)
          mt.elimine.kills = tueur.kills;
          mt.elimine.degats = tueur.degats;
        } else if (mt) {
          // +50 PV, plafonnés à 100 : le surplus est perdu (ni bouclier ni autre conversion)
          const avant = tueur.pv;
          tueur.pv = Math.min(JEU.pvMax, tueur.pv + BR.pvKill);
          if (tueur.pv !== avant) sorties.push({ a: tueur.id, m: { t: "soin", pv: tueur.pv, bouclier: tueur.bouclier, motif: "kill" } });
        }
      }
      // l'équipement est encore là : la salle efface l'arme spéciale APRÈS cet appel
      sorties.push(...butin.lacherALaMort(cible, t));
      return sorties;
    },

    liberer(j, t) {
      dernierT = Math.max(dernierT, t);
      statsDemandeT.delete(j.id);
      const m = membres.get(j.id);
      const sorties: Sortie[] = [];
      const humainsPartants = partants().filter((x) => x.id !== j.id && !estIdBot(x.id)).length;
      if (phase !== "lobby" && (ctx.nombreHumains() === 0 || (humainsPartants === 0 && partants().some((x) => estIdBot(x.id)) && !ctx.joueurs().some((o) => !o.bot && o.spectateur && o.id !== j.id)))) {
        // plus aucun humain (les bots ne comptent pas), ou plus aucun humain admis dans la partie alors qu'elle compte des bots (un visiteur du
        // Palantir ou du lobby ne garde pas en vie un combat de bots ; un spectateur venu regarder, si : la partie finit `finSansHumainMs` plus tard) : retour immédiat au lobby, bots retirés, personne à prévenir ni statistiques
        return retourLobby(t);
      }
      if (phase === "lobby" || phase === "fin" || !m) {
        if (phase === "lobby" || !m?.monte) membres.delete(j.id);
        immediat = true;
        return emettre(t, sorties);
      }
      if (phase === "decompte") {
        membres.delete(j.id);
        vol.retirer(j.id);
        immediat = true;
        return emettre(t, sorties);
      }
      // vol ou jeu
      if (!m.monte || !m.admis) {
        membres.delete(j.id);
        vol.retirer(j.id);
      } else if (!m.elimine) {
        // abandon : éliminé sans +50 PV pour personne ; ses armes tombent s'il avait touché le sol
        const auSol = !vol.enVol(j.id);
        eliminer(m, j, t);
        sorties.push({ a: "tous", m: { t: "mort", cible: j.id, par: "", arme: "couteau", cause: "abandon", zone: "corps", ts: t, delai: 0 } });
        if (auSol) sorties.push(...butin.lacherALaMort(j, t));
      }
      verifierVictoire(t, sorties);
      verifierFinSansHumain(t, sorties);
      immediat = true;
      return emettre(t, sorties);
    },

    arrivee(j, t) {
      dernierT = Math.max(dernierT, t);
      membre(j);
      if (phase === "lobby") annule = false;
      if (phase === "lobby" || phase === "decompte" || phase === "fin") {
        immediat = true;
        return emettre(t, []);
      }
      // partie en cours : le nouvel arrivant attend la suivante, il est seul à voir l'état
      return [{ a: j.id, m: { t: "br", etat: etatA(t) } }];
    },

    enCours() {
      return phase === "decompte" || phase === "vol" || phase === "jeu";
    },

    peutRegarder(id) {
      if (phase !== "decompte" && phase !== "vol" && phase !== "jeu") return false;
      const m = membres.get(id);
      // un admis encore en lice monte dans l'avion (`rejoindre`) : spectateur, il ferait attendre le décompte jusqu'au bout
      return !m || !m.admis || !!m.elimine;
    },

    etat() {
      return etatA(dernierT);
    },

    apercu() {
      const enPartie = phase !== "lobby";
      const parts = partants();
      return {
        phase, vivants: parts.filter((m) => !m.elimine).length, total: parts.length,
        zone: plan && enPartie ? zoneBrPublique(plan, dernierT) : null,
        avion: enPartie ? vol.avion() : null,
      };
    },

    aidePolice(): AidePoliceBr {
      return aidePolice;
    },

    resume(): ResumeBr {
      const palier = plan && enVolOuJeu() ? etatZone(plan, dernierT).palier : undefined;
      const h = ctx.joueurs().find((o) => !o.bot);
      const nb = bots.nombre();
      return {
        phase, joueurs: ctx.nombreHumains(), vivants: vivants(), ...(palier !== undefined ? { palier } : {}), ...(h ? { hote: h.pseudo } : {}),
        ...(nb > 0 ? { bots: nb } : {}),
        ...(opts.botsMax !== undefined ? { botsMax } : {}), ...(opts.botsRestants ? { botsRestants: botsRestants() } : {}),
      };
    },
  };
}
