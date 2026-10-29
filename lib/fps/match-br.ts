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
import type { ButinBr, ContexteSalle, JoueurSalle, ResumeBr, ServiceBr, Sortie, VolBr } from "./match-contexte";
import { creerButinBr } from "./match-br-butin";
import { creerVolBr } from "./match-br-vol";
import {
  JEU, type AvionBr, type BilanBr, type CauseMort, type EtatPartieBr, type JoueurBr, type LigneBilanBr, type LigneStatsBr, type MessageClient,
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
  /** injection (tests, ou salle qui précalcule) : sous-services à la place de `creerVolBr` / `creerButinBr` */
  vol?: VolBr;
  butin?: ButinBr;
  /** injection (tests) : emplacements du butin à la place de `pointsButin(scene, ctx.monde)` */
  points?: readonly PointButin[];
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
  const hote = (): string => ctx.joueurs()[0]?.id ?? "";
  const partants = (): Membre[] => [...membres.values()].filter((m) => m.admis);
  const vivants = (): number => partants().filter((m) => !m.elimine).length;
  const enVolOuJeu = (): boolean => phase === "vol" || phase === "jeu";

  /** Deux membres qui portent le même nom de base (pseudo sans chiffres finaux) : leurs statistiques se confondraient. */
  function conflitDeNoms(): boolean {
    const vus = new Set<string>();
    for (const j of ctx.joueurs()) {
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

  /** Retour au lobby : tous les joueurs sortent de l'arène, membres remis en attente, sous-services remis à blanc. */
  function retourLobby(t: number, avecAnnulation = false): Sortie[] {
    const sorties: Sortie[] = [];
    for (const j of ctx.joueurs()) if (j.enJeu) sorties.push(...ctx.retirerJoueur(j, t));
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

  function lancerPartie(j: JoueurSalle, t: number): Sortie[] {
    if (phase !== "lobby" || hote() !== j.id) return [];
    const salle = ctx.joueurs();
    if (salle.length < joueursMin) return [];
    if (conflitDeNoms()) { immediat = true; return []; }
    annule = false;
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
    if (bord.length < joueursMin) return retourLobby(t, true);
    const sorties: Sortie[] = [];
    // même trajectoire (même graine), départ à `t` : les joueurs déjà à bord suivent
    vol.demarrer(bord, ctx.monde.bornes, aleaVol(), t, optionsVol());
    phase = "vol"; debutT = t; finT = 0; volDebutT = t; tempeteT = t; atterrisMax = 0;
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
    for (const m of membres.values()) if (m.admis && !m.monte) m.admis = false;
    phase = "jeu"; debutT = t;
    immediat = true;
  }

  // ---------------------------------------------------------------------------------------------
  // tempête, éliminations, fin
  // ---------------------------------------------------------------------------------------------

  /** Garde le plus grand nombre d'atterris vu : `retirer` du sous-service pourrait décompter un joueur mort. */
  function echantillonnerAtterris(): void {
    atterrisMax = Math.max(atterrisMax, vol.atterris());
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
      };
    });
    bilan = { vainqueurs: lignes.length > 0 ? [lignes[0].id] : [], dureeMs, lignes };
    const compte = atterrisMax >= BR.atterrisMin && dureeMs >= partieValideMinMs;
    nonComptee = !compte;
    if (compte) {
      enregistrer({ t, lignes: lignes.filter((l) => estPseudoCompte(l.pseudo)).map((l) => ({ pseudo: l.pseudo, place: l.place, kills: l.kills })) });
    }
    phase = "fin"; debutT = t; finT = t + finAffichageMs;
    // `br{etat}` avec le bilan part tout de suite (il remplace l'état en attente)
    const sorties: Sortie[] = [sortieEtat(t)];
    immediat = false; sale = false; dernierEtatT = t;
    // le palmarès à jour, chacun avec sa ligne (`moi`)
    for (const j of ctx.joueurs()) sorties.push({ a: j.id, m: messageStats(j.pseudo) });
    return sorties;
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
        if (decompteTermine(t)) sorties.push(...demarrerVol(t));
        return emettre(t, sorties, true);
      }
      // vol et jeu
      echantillonnerAtterris();
      const avion: AvionBr | null = vol.avion();
      if (phase === "vol" && avion && t >= avion.finT) passerEnJeu(t);
      sorties.push(...butin.tic(t));
      tempete(t, sorties);
      verifierVictoire(t, sorties);
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
          return emettre(t, lancerPartie(j, t));
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
      if (ctx.joueurs().length === 0 && phase !== "lobby") {
        // salle vide : retour immédiat au lobby, personne à prévenir ni statistiques (le serveur saute le tic d'une salle vide)
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

    resume(): ResumeBr {
      const palier = plan && enVolOuJeu() ? etatZone(plan, dernierT).palier : undefined;
      const h = ctx.joueurs()[0];
      return { phase, joueurs: ctx.joueurs().length, vivants: vivants(), ...(palier !== undefined ? { palier } : {}), ...(h ? { hote: h.pseudo } : {}) };
    },
  };
}
