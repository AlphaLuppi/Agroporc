/**
 * Bots du Battle Royale, câblage (PUR : l'horloge est passée à chaque appel, le hasard est injecté ; ne voit la salle que par `ContexteSalle`). Sous-service de
 * `match-br.ts` comme `match-br-vol.ts` et `match-br-butin.ts`. Un bot est un VRAI membre de la table (`ctx.ajouterBot`) : son cerveau (`bots-br.ts`)
 * décide, ce module traduit les consignes en messages de client (`rejoindre`, `sauter`, `chute`, `etat`, `main`, `tir`, `coup`, `ramasser`, `utiliser`) et les
 * passe à `ctx.recevoir`, donc par la même validation que ceux d'un humain : cadence, dégainage, œil, direction, rejeu de latence, dégâts, mort, butin.
 * Rien n'écrit `j.p` ni n'appelle `infliger` : la killcam, le journal des tirs (`tir{ts,o,d}`), `histo` et les compteurs restent exacts.
 *
 * Lot 3b : navigation (grille des tigres, un A* par tic pour tout le serveur, `nav-bots.ts`), perception (ligne de vue rafraîchie toutes les 150 ms), munitions
 * simulées PAR SLOT (le serveur ne suit que `munSpeciale`), butin et points d'atterrissage limités à la composante connexe du bot.
 *
 * Les `Sortie[]` renvoyées par chaque `ctx.recevoir` sont COLLECTÉES et rendues à l'appelant (`match-br.ts` puis `Salle.tic`) : sans cela les tirs, dégâts et
 * morts causés par les bots ne seraient jamais diffusés. Les cerveaux tournent sur une COPIE de la liste des bots (un message peut tuer et déclencher
 * `br.surMort` pendant l'itération). Un bot dont l'état est refusé (budget de distance, `seq`) se resynchronise sur `j.p` à sa prochaine décision.
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.3, §1.4, lot 3a)
 */
import { STATS, directionsTir } from "./armes";
import { classeMunitions, mulberry32 } from "./br-butin";
import { BR } from "./br-regles";
import {
  NIVEAUX_BOT, PORTEE_BUTIN_M, capVers, decider, memoireInitiale, nomsDeBots,
  type EntreeCerveau, type MemoireBot, type ParamsBot, type Percu,
} from "./bots-br";
import { visible } from "./collision";
import { armeDuSlot } from "./equipement";
import { BudgetNavigation, composanteDe, creerNavigateur, etiquetageDe } from "./nav-bots";
import { grilleNav } from "./tigre-arene";
import type { BotsBr, ButinBr, ContexteSalle, JoueurSalle, Sortie, VolBr } from "./match-contexte";
import { MELEE } from "./armes";
import { trouverCiblesMelee } from "./melee";
import { coteMurDe, etape, etatInitial, postureDe, type EtatMouvement } from "./mouvement";
import { copierEquipement, estMelee, type ArmeFeuId, type AvionBr, type ClasseMunitions, type MessageClient, type ObjetBr, type PointButin, type Slot, type Vec3 } from "./protocole";
import { tracer, type Cible } from "./tir";
import type { Difficulte } from "./zombies-vagues";

type Vec2 = [number, number];

/** Ce que le câblage demande au service BR : sa phase, son avion, sa zone, les points de butin. */
export interface AideBots {
  phase(): "lobby" | "decompte" | "vol" | "jeu" | "fin";
  avion(): AvionBr | null;
  /** cercle à rejoindre à l'instant `t` (le cercle visé pendant l'attente, le cercle courant sinon), null sans zone */
  zone(t: number): { centre: Vec2; rayon: number; courant?: { centre: Vec2; rayon: number }; palier?: number; phase?: string } | null;
  /** emplacements de butin possibles (les points `toit` sont écartés par le câblage) */
  points(): readonly PointButin[];
  vol: Pick<VolBr, "aBord" | "enVol">;
  butin: Pick<ButinBr, "objets" | "stock">;
}

export interface OptionsBotsBr {
  /** budget de recherches de chemin, partagé par toutes les salles BR du serveur (un A* par tic en tout) ; absent : un budget propre à la salle */
  budget?: BudgetNavigation;
  /** essai déterministe (`PDJ_FPS_BR_BOTS_ESSAI=agressif`) : graine fixe, les bots cherchent le joueur humain et reçoivent une mitraillette en atterrissant */
  essai?: "agressif";
}

/** Période du cerveau (ms) : 20 Hz, phase décalée par bot. */
const PERIODE_CERVEAU_MS = 50;
/** La ligne de vue vers un joueur perçu (le calcul coûteux de la perception) est refaite toutes les 150 ms ; positions et distances le sont à chaque décision. */
const PERIODE_LIGNE_DE_VUE_MS = 150;
/** Joueurs perçus au plus par décision (les plus proches) et portée de perception (m). */
const PERCUS_MAX = 5;
const PORTEE_PERCEPTION_M = 160;
const OEIL_DEBOUT = 1.95;
const POITRINE = 1.2;
const GRAINE_ESSAI = 0xb07b07;

interface Munis { arme: ArmeFeuId; charge: number; reserve: number }

/** Ce que le câblage retient d'un bot. */
interface Bot {
  id: string;
  rang: number;
  params: ParamsBot;
  memoire: MemoireBot;
  /** mouvement simulé (null avant l'atterrissage) et dernier `seq` envoyé */
  mouv: EtatMouvement | null;
  seq: number;
  /** dernière décision (ms) */
  derniereT: number;
  /** l'état envoyé a été refusé : la prochaine décision repart de `j.p` */
  desync: boolean;
  rejointEnvoye: boolean;
  /** munitions simulées PAR SLOT (le serveur ne suit que `munSpeciale`) ; une arme remplacée dans un slot repart chargeur plein, réserve de départ */
  munis: Partial<Record<Slot, Munis>>;
  /** recharge en cours : fin (ms) et slot */
  rechargeFinT: number;
  rechargeSlot: Slot | null;
  /** dernière ligne de vue calculée par joueur perçu */
  vues: Map<string, { t: number; visible: boolean }>;
  prochainTirT: number;
  prochainCoupT: number;
  /** a touché le sol : le premier `etat` repart de `j.p` avec `seq` 0 */
  auSol: boolean;
  equipeEssai: boolean;
}

const borne = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** Direction de visée (convention du jeu : avant = (−sin lacet, −cos lacet), tangage positif vers le haut). */
const visee = (lacet: number, tangage: number): Vec3 => {
  const c = Math.cos(tangage);
  return [-Math.sin(lacet) * c, Math.sin(tangage), -Math.cos(lacet) * c];
};

/** Numéro du service de bots (un par salle BR) : les ids `b<n>` se recoupent d'une salle à l'autre, la file du budget partagé est indexée par `<service>:<id>`. */
let compteurServicesBots = 0;

export function creerBotsBr(ctx: ContexteSalle, aide: AideBots, opts: OptionsBotsBr = {}): BotsBr {
  const prefixeBudget = `${++compteurServicesBots}:`;
  const agressif = opts.essai === "agressif";
  const budget = opts.budget ?? new BudgetNavigation();
  const alea: () => number = agressif ? mulberry32(GRAINE_ESSAI) : ctx.alea;
  const bots = new Map<string, Bot>();

  /**
   * L'arme à feu à utiliser : la première (principale, secondaire, spéciale) qui a encore des munitions ; si toutes sont à sec, la première portée (`vide`).
   * Les munitions de chaque slot sont suivies ici ; une arme neuve dans un slot repart chargeur plein et réserve de départ.
   */
  function armeUtilisee(b: Bot, j: JoueurSalle): { arme: ArmeFeuId; slot: Slot; mun: Munis; vide: boolean; classes: ClasseMunitions[] } | null {
    const portees: { arme: ArmeFeuId; slot: Slot; mun: Munis }[] = [];
    for (const slot of ["principale", "secondaire", "speciale"] as const) {
      if (slot === "principale" && j.equip.sansPrincipale) { delete b.munis[slot]; continue; }
      if (slot === "secondaire" && j.equip.sansSecondaire) { delete b.munis[slot]; continue; }
      const a = armeDuSlot(j.equip, slot);
      if (a === null || estMelee(a)) { delete b.munis[slot]; continue; }
      const arme = a as ArmeFeuId;
      let mun = b.munis[slot];
      if (!mun || mun.arme !== arme) {
        mun = { arme, charge: STATS[arme].chargeur, reserve: STATS[arme].chargeur * BR.reserveChargeursDepart };
        b.munis[slot] = mun;
        if (b.rechargeSlot === slot) { b.rechargeFinT = -Infinity; b.rechargeSlot = null; }
      }
      portees.push({ arme, slot, mun });
    }
    if (portees.length === 0) return null;
    const classes = [...new Set(portees.map((x) => classeMunitions(x.arme)).filter((x): x is ClasseMunitions => x !== null))];
    const bonne = portees.find((x) => x.mun.charge + x.mun.reserve > 0);
    return { ...(bonne ?? portees[0]), vide: !bonne, classes };
  }

  /** Fin d'une recharge : le chargeur du slot se remplit depuis la réserve. */
  function finRecharge(b: Bot, t: number): void {
    if (b.rechargeFinT === -Infinity || t < b.rechargeFinT) return;
    const mun = b.rechargeSlot ? b.munis[b.rechargeSlot] : undefined;
    if (mun) {
      const prend = Math.min(STATS[mun.arme].chargeur - mun.charge, mun.reserve);
      mun.charge += prend;
      mun.reserve -= prend;
    }
    b.rechargeFinT = -Infinity;
    b.rechargeSlot = null;
  }

  /** Munitions ramassées (`equipement.ajoutMunitions` adressé au bot) : la réserve de l'arme grandit, plafonnée à `BR.reserveChargeursMax` chargeurs. */
  function noterRamassage(b: Bot, sorties: readonly Sortie[]): void {
    for (const s of sorties) {
      if (s.a !== b.id || s.m.t !== "equipement" || !s.m.ajoutMunitions) continue;
      const { arme, chargeurs } = s.m.ajoutMunitions;
      for (const slot of ["principale", "secondaire", "speciale"] as const) {
        const mun = b.munis[slot];
        if (mun && mun.arme === arme) mun.reserve = Math.min(STATS[arme].chargeur * BR.reserveChargeursMax, mun.reserve + chargeurs * STATS[arme].chargeur);
      }
    }
  }

  /** Position de `c` telle que le bot la voyait il y a `reactionMs` (historique de positions acceptées). */
  function positionRetardee(c: JoueurSalle, t: number, reactionMs: number): Vec3 {
    const voulu = t - reactionMs;
    for (let i = c.histo.length - 1; i >= 0; i--) if (c.histo[i].t <= voulu) return c.histo[i].p;
    return c.histo.length > 0 ? c.histo[0].p : c.p;
  }

  /** Cibles possibles d'un tir ou d'un coup : les autres joueurs en vie, en jeu, ni à bord ni spectateurs. */
  function candidats(j: JoueurSalle): JoueurSalle[] {
    return ctx.joueursEnJeu().filter((o) => o.id !== j.id && o.vivant && !o.spectateur && !aide.vol.aBord(o.id));
  }

  function percevoir(j: JoueurSalle, b: Bot, t: number, autres: readonly JoueurSalle[]): Percu[] {
    const oeil: Vec3 = [j.p[0], j.p[1] + OEIL_DEBOUT, j.p[2]];
    const proches = autres
      .filter((o) => !aide.vol.enVol(o.id) && t >= o.protegeJusqua)
      .map((o) => ({ o, d: Math.hypot(o.p[0] - j.p[0], o.p[1] - j.p[1], o.p[2] - j.p[2]) }))
      .filter((x) => x.d <= PORTEE_PERCEPTION_M)
      .sort((a, c) => a.d - c.d)
      .slice(0, PERCUS_MAX);
    const vus = new Map<string, { t: number; visible: boolean }>();
    const percus = proches.map(({ o, d }) => {
      const p = positionRetardee(o, t, b.params.reactionMs);
      // la ligne de vue (le calcul coûteux) est refaite toutes les 150 ms seulement
      let vue = b.vues.get(o.id);
      if (!vue || t - vue.t >= PERIODE_LIGNE_DE_VUE_MS) vue = { t, visible: visible(ctx.monde, oeil, [p[0], p[1] + POITRINE, p[2]]) };
      vus.set(o.id, vue);
      return { id: o.id, p: [p[0], p[1], p[2]] as Vec3, vitesse: [o.v[0], o.v[1], o.v[2]] as Vec3, distance: d, visible: vue.visible };
    });
    b.vues = vus;
    return percus;
  }

  /** Envoie un message de client au nom du bot et collecte les sorties. */
  function envoyer(b: Bot, msg: MessageClient, t: number, sorties: Sortie[]): void {
    sorties.push(...ctx.recevoir(b.id, msg, t));
  }

  /** `etat` du bot (après `etape`), `seq` croissant ; un refus du serveur (le `seq` accepté est celui du joueur) force la resynchronisation. */
  function envoyerEtat(b: Bot, j: JoueurSalle, lacet: number, tangage: number, t: number, sorties: Sortie[]): void {
    if (!b.mouv) return;
    const seq = ++b.seq;
    envoyer(b, {
      t: "etat", seq, p: [b.mouv.p[0], b.mouv.p[1], b.mouv.p[2]], v: [b.mouv.v[0], b.mouv.v[1], b.mouv.v[2]], lacet, tangage,
      posture: postureDe(b.mouv), mur: coteMurDe(b.mouv), accroupi: false, glisse: false, vise: false, recharge: t < b.rechargeFinT,
    }, t, sorties);
    if (j.seq !== seq) b.desync = true;
  }

  /** Un tir : angles déjà envoyés par `etat`, plombs de la gerbe fixe de l'arme, touches calculées sur les positions ACTUELLES (le serveur revalide). */
  function tirer(b: Bot, j: JoueurSalle, arme: ArmeFeuId, mun: Munis, lacet: number, tangage: number, t: number, sorties: Sortie[]): void {
    const st = STATS[arme];
    const o: Vec3 = [j.p[0], j.p[1] + OEIL_DEBOUT, j.p[2]];
    const dirs = directionsTir(arme, visee(lacet, tangage));
    const cibles: Cible[] = candidats(j).map((c) => ({ id: c.id, p: c.p, vivant: true, accroupi: c.accroupi }));
    const touches: Extract<MessageClient, { t: "tir" }>["touches"] = [];
    dirs.forEach((d, plomb) => {
      const impact = tracer(ctx.monde, o, d, st.portee, cibles, j.id);
      if (impact.cible && impact.zone) touches.push({ cible: impact.cible, zone: impact.zone, plomb });
    });
    b.prochainTirT = t + st.cadenceS * 1000;
    mun.charge = Math.max(0, mun.charge - 1);
    envoyer(b, { t: "tir", arme, o, d: dirs, touches }, t, sorties);
  }

  /** Un coup de couteau (ou d'épée) sur les cibles à portée dans le cône. */
  function frapper(b: Bot, j: JoueurSalle, lacet: number, tangage: number, t: number, sorties: Sortie[]): void {
    const arme = estMelee(j.arme) ? j.arme : "couteau";
    const o: Vec3 = [j.p[0], j.p[1] + OEIL_DEBOUT, j.p[2]];
    const d = visee(lacet, tangage);
    const cibles = candidats(j).map((c) => ({ id: c.id, p: c.p, vivant: true, accroupi: c.accroupi }));
    const touchees = trouverCiblesMelee(ctx.monde, o, d, cibles, j.id, arme).map((x) => x.cible);
    b.prochainCoupT = t + MELEE[arme].cadenceS * 1000;
    envoyer(b, { t: "coup", o, d, cibles: touchees }, t, sorties);
  }

  /**
   * Essai « agressif » (tests de bout en bout seulement) : l'apparition est déterministe. Le bot attend qu'un humain soit au sol, puis réapparaît à 20-80 m de lui, en
   * vue autant que possible, avec une mitraillette (un bot qui atterrit avec son couteau, sans navigation, ne rejoindrait jamais l'humain). Faux tant qu'aucun humain n'est au sol.
   */
  function apparitionEssai(b: Bot, j: JoueurSalle, t: number, sorties: Sortie[]): boolean {
    const cibles = ctx.joueursEnJeu().filter((h) => !h.bot && h.vivant && !aide.vol.enVol(h.id));
    const humain = cibles[0];
    if (!humain) return false;
    b.equipeEssai = true;
    const oeil: Vec3 = [humain.p[0], humain.p[1] + OEIL_DEBOUT, humain.p[2]];
    // un point de butin (hors toit) en vue de l'humain, à 20-80 m ; à défaut le plus proche en vue jusqu'à 200 m, à défaut le plus proche tout court
    const avecDistance = aide.points().map((pt) => ({ pt, d: Math.hypot(pt.p[0] - humain.p[0], pt.p[2] - humain.p[2]) })).filter((x) => x.d >= 20);
    const enVue = avecDistance.filter((x) => x.d <= 200 && visible(ctx.monde, oeil, [x.pt.p[0], x.pt.p[1] + POITRINE, x.pt.p[2]]));
    const proches = enVue.filter((x) => x.d <= 80);
    const choix = proches.length > 0 ? proches[Math.min(proches.length - 1, Math.floor(alea() * proches.length))]
      : enVue.length > 0 ? enVue.reduce((a, c) => (c.d < a.d ? c : a))
        : avecDistance.length > 0 ? avecDistance.reduce((a, c) => (c.d < a.d ? c : a)) : null;
    const point = choix ? choix.pt.p : null;
    const equip = copierEquipement(j.equip);
    equip.principale = "mitraillette";
    delete equip.sansPrincipale;
    const lacet = point ? capVers(humain.p[0] - point[0], humain.p[2] - point[2]) : j.lacet;
    sorties.push(...ctx.placerJoueur(j, point ?? j.p, lacet, { pv: j.pv, equip, main: "principale", prive: true }, t));
    return true;
  }

  /** Composantes connexes de la grille de navigation (calculées une fois par grille, précalculées au démarrage du serveur). */
  const grille = () => grilleNav(ctx.monde);
  const composante = (x: number, z: number): number => { const g = grille(); return composanteDe(g, etiquetageDe(g), x, z); };
  /** Composante de chaque objet au sol (les objets ne bougent pas ; la clé est leur id). */
  const compObjets = new Map<number, number>();
  const compObjet = (o: ObjetBr): number => {
    let k = compObjets.get(o.id);
    if (k === undefined) { k = composante(o.p[0], o.p[2]); compObjets.set(o.id, k); }
    return k;
  };
  /** Points d'atterrissage de la composante principale (hors toits : déjà écartés), gardés tant que `aide.points()` est le même tableau. */
  let pointsPrincipaux: { source: readonly PointButin[]; points: Vec3[] } | null = null;
  const pointsAccessibles = (): Vec3[] => {
    const src = aide.points();
    if (!pointsPrincipaux || pointsPrincipaux.source !== src) {
      const g = grille(), e = etiquetageDe(g);
      const bons = src.filter((pt) => composanteDe(g, e, pt.p[0], pt.p[2]) === e.principale).map((pt) => pt.p);
      pointsPrincipaux = { source: src, points: bons.length > 0 ? bons : src.map((pt) => pt.p) };
    }
    return pointsPrincipaux.points;
  };

  function decisionAuSol(b: Bot, j: JoueurSalle, t: number, dtS: number, autres: readonly JoueurSalle[], sorties: Sortie[]): void {
    // premier pas au sol : le mouvement repart de la position d'atterrissage, `seq` de 0 (le serveur a remis `j.seq` à −1)
    if (!b.auSol) {
      if (agressif && !b.equipeEssai && !apparitionEssai(b, j, t, sorties)) return;
      b.auSol = true;
      b.mouv = etatInitial(j.p);
      b.seq = j.seq;
      // le premier état est la position d'atterrissage elle-même (jamais un saut) : `seq` 0 est le premier accepté
      envoyerEtat(b, j, j.lacet, 0, t, sorties);
      return;
    }
    if (b.desync || !b.mouv) { b.mouv = etatInitial(j.p); b.seq = Math.max(b.seq, j.seq); b.desync = false; }
    finRecharge(b, t);
    const arme = armeUtilisee(b, j);
    // essai « agressif » : les bots ne s'attaquent qu'aux humains (sinon ils s'entretuent à l'atterrissage et le test n'a plus de cible)
    const percus = percevoir(j, b, t, agressif ? autres.filter((o) => !o.bot) : autres);
    const zone = aide.zone(t);
    const humains = autres.filter((o) => !o.bot && !o.spectateur);
    let humainProche: Vec3 | null = null;
    let dMin = Infinity;
    for (const h of humains) {
      const d = Math.hypot(h.p[0] - j.p[0], h.p[2] - j.p[2]);
      if (d < dMin) { dMin = d; humainProche = h.p; }
    }
    const stock = aide.butin.stock(j.id);
    // le butin hors de la composante connexe du bot (un toit, une cour fermée) est écarté : un A* qui n'aboutit pas coûte cher
    const cb = composante(j.p[0], j.p[2]);
    const objets = [...aide.butin.objets().values()].filter((o) => Math.hypot(o.p[0] - j.p[0], o.p[2] - j.p[2]) <= PORTEE_BUTIN_M && (cb === 0 || compObjet(o) === cb));
    const mun = arme ? arme.mun : null;
    const entree: EntreeCerveau = {
      t, dtS, phase: aide.phase(),
      moi: {
        p: j.p, pv: j.pv, bandage: stock.bandage, potion: stock.potion, armeFeu: arme ? arme.arme : null, slotArme: arme ? arme.slot : null,
        bouclier: j.bouclier, classesMun: arme ? arme.classes : [], armeVide: arme ? arme.vide : false,
        lacet: j.lacet, tangage: j.tangage, aBord: false, enChute: false, arme: j.arme, sortie: t >= j.sortieJusqua,
      },
      munitions: { charge: mun ? mun.charge : 0, chargeur: arme ? STATS[arme.arme].chargeur : 0, reserve: mun ? mun.reserve : 0, recharge: t < b.rechargeFinT },
      avion: aide.avion(), zone, percus, objets,
      points: [], deja: [], agressif, humainProche,
      nav: creerNavigateur({ monde: ctx.monde, budget, id: prefixeBudget + b.id, t }),
    };
    const { m, c } = decider(b.memoire, entree, b.params, alea);
    b.memoire = m;

    // armes d'abord (le changement d'arme remet le dégainage à zéro côté serveur)
    if (c.changerArme && c.changerArme !== j.main) envoyer(b, { t: "main", slot: c.changerArme }, t, sorties);
    if (c.ramasser !== undefined) {
      const avant = sorties.length;
      envoyer(b, { t: "ramasser", id: c.ramasser }, t, sorties);
      noterRamassage(b, sorties.slice(avant));
    }
    if (c.utiliser) envoyer(b, { t: "utiliser", objet: c.utiliser }, t, sorties);
    if (c.recharger && arme && mun && b.rechargeFinT === -Infinity && mun.reserve > 0) { b.rechargeFinT = t + STATS[arme.arme].rechargeS * 1000; b.rechargeSlot = arme.slot; }

    // mouvement, puis l'état (angles de visée compris) AVANT le tir : le serveur valide la direction contre `j.lacet` / `j.tangage`
    b.mouv = etape(b.mouv, { ...c.entrees, lacet: c.lacet }, dtS, ctx.monde, 1);
    envoyerEtat(b, j, c.lacet, c.tangage, t, sorties);
    if (!j.vivant) return;
    if (c.tirer && arme && mun && j.arme === arme.arme && mun.charge > 0 && t >= b.prochainTirT && t >= b.rechargeFinT) {
      tirer(b, j, arme.arme, mun, c.lacet, c.tangage, t, sorties);
    } else if (c.coup && j.vivant && j.main === "couteau" && t >= b.prochainCoupT) {
      frapper(b, j, c.lacet, c.tangage, t, sorties);
    }
  }

  function decisionVol(b: Bot, j: JoueurSalle, t: number, sorties: Sortie[]): void {
    const aBord = aide.vol.aBord(j.id);
    const stock = aide.butin.stock(j.id);
    const entree: EntreeCerveau = {
      t, dtS: PERIODE_CERVEAU_MS / 1000, phase: aide.phase(),
      moi: {
        p: j.p, pv: j.pv, bandage: stock.bandage, potion: stock.potion, armeFeu: null, slotArme: null,
        lacet: j.lacet, tangage: j.tangage, aBord, enChute: !aBord, arme: j.arme, sortie: false,
      },
      munitions: { charge: 0, chargeur: 0, reserve: 0, recharge: false },
      avion: aide.avion(), zone: null, percus: [], objets: [],
      points: pointsAccessibles(), deja: [...bots.values()].filter((o) => o !== b && o.memoire.cibleAtt).map((o) => o.memoire.cibleAtt as Vec3),
      agressif, humainProche: plusProcheHumain(j),
    };
    const { m, c } = decider(b.memoire, entree, b.params, alea);
    b.memoire = m;
    if (c.quitterAvion) { envoyer(b, { t: "sauter" }, t, sorties); return; }
    if (!aBord) {
      envoyer(b, { t: "chute", lacet: c.lacet, tangage: c.tangage, avance: c.entrees.avant, lateral: c.entrees.droite, ouvrir: c.ouvrirParachute === true }, t, sorties);
    }
  }

  function plusProcheHumain(j: JoueurSalle): Vec3 | null {
    let meilleur: Vec3 | null = null, dMin = Infinity;
    for (const h of ctx.joueursEnJeu()) {
      if (h.bot || h.spectateur || !h.vivant) continue;
      const d = Math.hypot(h.p[0] - j.p[0], h.p[2] - j.p[2]);
      if (d < dMin) { dMin = d; meilleur = h.p; }
    }
    return meilleur;
  }

  return {
    creer(n: number, difficulte: Difficulte, t: number): JoueurSalle[] {
      compObjets.clear();
      const noms = nomsDeBots(n, ctx.joueurs().map((j) => j.pseudo), alea);
      const crees: JoueurSalle[] = [];
      for (let i = 0; i < n; i++) {
        const j = ctx.ajouterBot(noms[i] ?? `Bot ${i + 1}`, t);
        const rang = bots.size;
        bots.set(j.id, {
          id: j.id, rang, params: NIVEAUX_BOT[difficulte], memoire: memoireInitiale(), mouv: null, seq: -1,
          derniereT: t - PERIODE_CERVEAU_MS + (rang % 3) * (PERIODE_CERVEAU_MS / 3), desync: false, rejointEnvoye: false,
          munis: {}, rechargeFinT: -Infinity, rechargeSlot: null, vues: new Map(), prochainTirT: -Infinity, prochainCoupT: -Infinity, auSol: false, equipeEssai: false,
        });
        crees.push(j);
      }
      return crees;
    },

    tic(t: number): Sortie[] {
      const sorties: Sortie[] = [];
      const phase = aide.phase();
      if (phase !== "decompte" && phase !== "vol" && phase !== "jeu") return sorties;
      // une copie : un message d'un bot peut tuer et déclencher `br.surMort` pendant l'itération
      for (const b of [...bots.values()]) {
        const j = ctx.joueur(b.id);
        if (!j) continue;
        // décompte et premier tic : le bot monte à bord comme un client qui a chargé le jeu
        if (!j.enJeu) {
          if (!b.rejointEnvoye && (phase === "decompte" || phase === "vol")) { b.rejointEnvoye = true; envoyer(b, { t: "rejoindre" }, t, sorties); }
          continue;
        }
        if (phase === "decompte" || !j.vivant) continue;
        if (t - b.derniereT < PERIODE_CERVEAU_MS - 1e-6) continue;
        const dtS = Math.min(0.25, Math.max(0.001, (t - b.derniereT) / 1000));
        b.derniereT = t;
        if (aide.vol.enVol(j.id)) { decisionVol(b, j, t, sorties); continue; }
        decisionAuSol(b, j, t, dtS, candidats(j), sorties);
      }
      return sorties;
    },

    retirerTous(): void {
      for (const id of [...bots.keys()]) { budget.retirer(prefixeBudget + id); ctx.retirerBot(id); }
      bots.clear();
    },

    nombre: (): number => bots.size,
  };
}
