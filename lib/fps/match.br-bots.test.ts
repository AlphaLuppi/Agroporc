import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { construireMondeBr } from "./br-carte";
import { BR } from "./br-regles";
import { appliquerPartie, statsVides, type PersistanceBr, type ResultatPartieBr, type StatsBr } from "./br-stats";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import type { OptionsServiceBr } from "./match-br";
import type { ServiceBr } from "./match-contexte";
import { resoudre, visible } from "./collision";
import { estIdBot, type EtatPartieBr, type MessageClient, type MessageServeur, type Vec3 } from "./protocole";
import { ciblesVoixBr, LiensVoixKillcam } from "./voix";
import { BudgetNavigation, NOEUDS_MAX_BOT, PERIODE_BUDGET_MS } from "./nav-bots";
import { etatDepuisZoneBr } from "./br-zone";

/**
 * Bots du Battle Royale (lot 3a) sur une vraie `Salle` BR et le vrai monde : lancement (solo, bornes, refus explicites, quota, capacité), vol, atterrissage,
 * ramassage, tirs validés par le serveur, kill crédité + 50 PV, killcam, fin sans humain, statistiques, nettoyage. Aucune horloge ni aucun hasard globaux :
 * `T0` et un LCG. Les fonctions pures du cerveau sont dans `bots-br.test.ts`.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMondeBr(scene);
const T0 = 9_000_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function persistance(): PersistanceBr & { parties: ResultatPartieBr[]; courant(): StatsBr } {
  let stats = statsVides();
  const parties: ResultatPartieBr[] = [];
  return {
    parties, courant: () => stats, lire: () => stats,
    enregistrer(p) { parties.push(p); stats = appliquerPartie(stats, p); return stats; },
  };
}

type Plus = Partial<Omit<OptionsServiceBr, "alea" | "scene">>;
const NOMS = ["Alice", "Bob", "Cora", "Dan"];

interface Banc { s: Salle; t: number; log: Sortie[]; stats: ReturnType<typeof persistance> }

function banc(plus: Plus = {}, options: OptionsSalle = {}, graine = 3): Banc {
  const depart: [number, number] = [(monde.bornes.x0 + monde.bornes.x1) / 2, (monde.bornes.z0 + monde.bornes.z1) / 2];
  const stats = persistance();
  const s = new Salle(monde, [depart], suite(graine), T0, {
    br: { scene, dureeVolMs: 10_000, nbObjets: 400, echelleZone: 1, partieValideMinMs: 1_000, finAffichageMs: 5_000, stats, ...plus }, ...options,
  });
  return { s, t: T0, log: [], stats };
}

const j = (b: Banc, id: string) => b.s.inspecter(id) as JoueurSalle;
const service = (b: Banc): ServiceBr => (b.s as unknown as { br: ServiceBr }).br;
const etat = (b: Banc): EtatPartieBr => service(b).etat();
const phase = (b: Banc) => etat(b).phase;
const bots = (b: Banc): JoueurSalle[] => b.s.joueurs().filter((x) => x.bot);
const humains = (b: Banc): JoueurSalle[] => b.s.joueurs().filter((x) => !x.bot);
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}

function arriver(b: Banc, n: number): string[] {
  const ids = Array.from({ length: n }, (_, i) => `j${i + 1}`);
  ids.forEach((id, i) => b.log.push(...b.s.connecter(id, NOMS[i] ?? `Joueur${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, b.t)));
  return ids;
}
function envoyer(b: Banc, id: string, m: MessageClient): Sortie[] {
  const out = b.s.recevoir(id, m, b.t);
  b.log.push(...out);
  return out;
}
/** Avance de `ms` (tics de 50 ms) ; les humains « actifs » ne sont pas évincés pour inactivité. */
function avancer(b: Banc, ms: number, parPas?: (t: number) => void): Sortie[] {
  const out: Sortie[] = [];
  const fin = b.t + ms;
  while (b.t < fin) {
    b.t = Math.min(fin, b.t + 50);
    for (const x of b.s.joueurs()) if (!x.bot && x.enJeu) x.etatT = b.t;
    parPas?.(b.t);
    out.push(...b.s.tic(b.t));
  }
  b.log.push(...out);
  return out;
}
function avancerJusque(b: Banc, fait: () => boolean, maxMs: number, parPas?: (t: number) => void): Sortie[] {
  const out: Sortie[] = [];
  const limite = b.t + maxMs;
  while (!fait()) {
    if (b.t >= limite) throw new Error(`condition non atteinte en ${maxMs} ms (phase ${phase(b)})`);
    out.push(...avancer(b, 50, parPas));
  }
  return out;
}

/** Humain seul, partie lancée avec `msg` : décompte en cours, l'humain à bord. */
function lancer(b: Banc, ids: string[], msg: Extract<MessageClient, { t: "lancerPartie" }> = { t: "lancerPartie" }): Sortie[] {
  const out = envoyer(b, ids[0], msg);
  b.t += 100;
  for (const id of ids) envoyer(b, id, { t: "rejoindre" });
  return out;
}

/** Humain seul avec bots : l'avion est parti. */
function enVol(plus: Plus = {}, msg: Extract<MessageClient, { t: "lancerPartie" }> = { t: "lancerPartie" }, graine = 3): { b: Banc; id: string } {
  const b = banc(plus, {}, graine);
  const [id] = arriver(b, 1);
  lancer(b, [id], msg);
  avancerJusque(b, () => phase(b) === "vol", 40_000);
  return { b, id };
}

/** L'humain saute, atterrit ; tous les bots ont atterri ; la partie est en jeu. */
function enJeu(plus: Plus = {}, msg: Extract<MessageClient, { t: "lancerPartie" }> = { t: "lancerPartie" }, graine = 3): { b: Banc; id: string } {
  const { b, id } = enVol(plus, msg, graine);
  envoyer(b, id, { t: "sauter" });
  const saut = b.t;
  avancerJusque(b, () => j(b, id).posture === "sol" && phase(b) === "jeu" && bots(b).every((x) => !x.vivant || x.posture === "sol"), 120_000, (t) => {
    b.s.recevoir(id, { t: "chute", lacet: 0, tangage: -1.1, avance: 1, lateral: 0, ouvrir: t - saut >= 1_500 }, t);
  });
  return { b, id };
}

// =================================================================================================
describe("lancement avec des bots", () => {
  it("seul, `bots` absent : BR.botsSolo bots, ids b<n> décimaux, drapeau dans la présence, hôte humain", () => {
    const b = banc();
    const [id] = arriver(b, 1);
    const sorties = envoyer(b, id, { t: "lancerPartie" });
    expect(bots(b)).toHaveLength(BR.botsSolo);
    expect(bots(b).map((x) => x.id)).toEqual(Array.from({ length: BR.botsSolo }, (_, i) => `b${i + 1}`));
    expect(bots(b).every((x) => /^b\d+$/.test(x.id) && estIdBot(x.id))).toBe(true);
    expect(estIdBot("br1")).toBe(false);
    expect(new Set(b.s.joueurs().map((x) => x.pseudo.toLocaleLowerCase("fr"))).size).toBe(BR.botsSolo + 1);
    expect(phase(b)).toBe("decompte");
    expect(etat(b)).toMatchObject({ hote: id, total: BR.botsSolo + 1, vivants: BR.botsSolo + 1 });
    // la présence annonce les bots
    const presence = messages(sorties, "presence").at(-1)!;
    expect(presence.joueurs.filter((x) => x.bot)).toHaveLength(BR.botsSolo);
    expect(presence.joueurs.find((x) => x.id === id)?.bot).toBeUndefined();
    // humains seulement dans le résumé ; bots publiés à part
    expect(b.s.resumeBr()).toMatchObject({ joueurs: 1, bots: BR.botsSolo, hote: "Alice" });
    expect(b.s.nombreHumains()).toBe(1);
    expect(b.s.nombreBots()).toBe(BR.botsSolo);
    // un bot est un vrai membre de la table, avec son suivi (`recevoirEtat` le lit toujours)
    expect(b.s.equipementProchain(bots(b)[0].id)).toBeDefined();
  });

  it("`bots` explicite pris tel quel (borné) ; entier seulement, sinon traité comme absent", () => {
    const essai = (bots: unknown, humainsN = 1): number => {
      const b = banc();
      const ids = arriver(b, humainsN);
      envoyer(b, ids[0], { t: "lancerPartie", bots } as unknown as MessageClient & { t: "lancerPartie" });
      return b.s.nombreBots();
    };
    expect(essai(3)).toBe(3);
    expect(essai(1)).toBe(1);
    expect(essai(500)).toBe(BR.botsMax);
    // non entiers : traités comme absents (solo : remplissage automatique)
    expect(essai(2.5)).toBe(BR.botsSolo);
    expect(essai("3")).toBe(BR.botsSolo);
    expect(essai(Number.NaN)).toBe(BR.botsSolo);
    expect(essai(-4)).toBe(BR.botsSolo);
    // à deux humains, `bots` absent : aucun bot (le remplissage automatique est réservé au solo)
    expect(essai(undefined, 2)).toBe(0);
    expect(essai(4, 2)).toBe(4);
  });

  it("`bots: 0` en solo : refus explicite `lancer / bots`, rien n'est créé", () => {
    const b = banc();
    const [id] = arriver(b, 1);
    const sorties = envoyer(b, id, { t: "lancerPartie", bots: 0 });
    expect(sorties).toEqual([{ a: id, m: { t: "refus", action: "lancer", raison: "bots" } }]);
    expect(b.s.nombreBots()).toBe(0);
    expect(phase(b)).toBe("lobby");
  });

  it("quota global épuisé : `lancer / limite` ; entamé : borné au restant", () => {
    const b0 = banc({ botsRestants: () => 0 });
    const [id0] = arriver(b0, 1);
    expect(envoyer(b0, id0, { t: "lancerPartie" })).toEqual([{ a: id0, m: { t: "refus", action: "lancer", raison: "limite" } }]);
    expect(phase(b0)).toBe("lobby");
    const b1 = banc({ botsRestants: () => 4 });
    const [id1] = arriver(b1, 1);
    envoyer(b1, id1, { t: "lancerPartie" });
    expect(b1.s.nombreBots()).toBe(4);
    expect(b1.s.resumeBr()).toMatchObject({ bots: 4, botsRestants: 4 });
    // deux humains qui n'ont rien demandé n'ont pas besoin du quota
    const b2 = banc({ botsRestants: () => 0 });
    const ids = arriver(b2, 2);
    envoyer(b2, ids[0], { t: "lancerPartie" });
    expect(phase(b2)).toBe("decompte");
  });

  it("`PDJ_FPS_BR_BOTS_MAX = 0` : `bots` ignoré, le solo est refusé", () => {
    const b = banc({ botsMax: 0 });
    const [id] = arriver(b, 1);
    expect(envoyer(b, id, { t: "lancerPartie", bots: 5 })).toEqual([{ a: id, m: { t: "refus", action: "lancer", raison: "bots" } }]);
    expect(b.s.nombreBots()).toBe(0);
    expect(b.s.resumeBr()).toMatchObject({ botsMax: 0 });
    // à deux humains, la partie se lance sans bots
    const c = banc({ botsMax: 0 });
    const ids = arriver(c, 2);
    envoyer(c, ids[0], { t: "lancerPartie", bots: 5 });
    expect(c.s.nombreBots()).toBe(0);
    expect(phase(c)).toBe("decompte");
  });

  it("capacité : humains + bots ≤ 50, une place reste libre pour un arrivant ; jamais d'`erreur plein` pour le 50e", () => {
    const b = banc();
    const ids = arriver(b, 40);
    envoyer(b, ids[0], { t: "lancerPartie", bots: 20 });
    // min(20, 50 − 40 − 1) = 9 bots : 49 membres
    expect(b.s.nombreBots()).toBe(9);
    expect(b.s.nombreJoueurs()).toBe(49);
    const arrivant = b.s.connecter("zz", "Zoe", b.t);
    expect(messages(arrivant, "erreur")).toHaveLength(0);
    expect(b.s.nombreJoueurs()).toBe(50);
    // le 51e (jamais routé par le serveur : `refus{plein}` en amont) est refusé par la salle
    expect(messages(b.s.connecter("zzz", "Yann", b.t), "erreur")[0]).toMatchObject({ code: "plein" });
    // 49 humains : aucune place pour un bot
    const c = banc();
    const tous = arriver(c, 49);
    envoyer(c, tous[0], { t: "lancerPartie", bots: 5 });
    expect(c.s.nombreBots()).toBe(0);
    expect(phase(c)).toBe("decompte");
  });

  it("le niveau suit la difficulté (Entrée / Plat du jour / Goulaf), Plat du jour par défaut ; la difficulté invalide est ignorée", () => {
    const essai = (difficulte: unknown) => {
      const b = banc();
      const [id] = arriver(b, 1);
      envoyer(b, id, { t: "lancerPartie", bots: 1, difficulte } as unknown as MessageClient & { t: "lancerPartie" });
      return phase(b);
    };
    expect(essai("goulaf")).toBe("decompte");
    expect(essai("n'importe quoi")).toBe("decompte");
  });

  it("l'hôte reste l'humain même quand un autre humain arrive après ; les noms de bots ne créent pas de conflit", () => {
    const b = banc();
    const ids = arriver(b, 2);
    envoyer(b, ids[0], { t: "lancerPartie", bots: 6 });
    expect(etat(b).hote).toBe(ids[0]);
    expect(etat(b).conflitNoms).toBeUndefined();
    // les bots sont derrière les humains dans la table
    expect(b.s.joueurs().slice(0, 2).every((x) => !x.bot)).toBe(true);
  });
});

// =================================================================================================
describe("les bots dans la partie", () => {
  it("rejoignent l'avion, sautent, atterrissent, ramassent une arme ; aucune coupure d'inactivité", () => {
    const { b, id } = enJeu();
    expect(bots(b).length).toBe(BR.botsSolo);
    // tous les bots ont rejoint la partie et sont au sol, vivants
    // (des bots ont pu s'entretuer à l'atterrissage : les morts restent en jeu, couchés)
    for (const x of bots(b)) {
      expect(x.enJeu).toBe(true);
      if (x.vivant) expect(x.posture).toBe("sol");
    }
    expect(j(b, id).posture).toBe("sol");
    // 90 s de partie : les bots vivants restent en jeu (jamais évincés pour inactivité, BR.inactifMs = 20 s) et certains ont une arme à feu
    avancer(b, 90_000);
    const vivants = bots(b).filter((x) => x.vivant);
    expect(vivants.length).toBeGreaterThan(0);
    for (const x of vivants) expect(x.enJeu).toBe(true);
    expect(bots(b).some((x) => !x.equip.sansPrincipale || !x.equip.sansSecondaire || x.equip.speciale !== null)).toBe(true);
  });

  it("aucun état d'un bot n'est refusé (budget de distance, seq) : 60 s au sol", () => {
    const { b } = enJeu();
    let envoyes = 0, refuses = 0;
    const recevoir = b.s.recevoir.bind(b.s);
    b.s.recevoir = (id: string, m: MessageClient, t: number): Sortie[] => {
      const bot = b.s.inspecter(id)?.bot === true;
      const avantSeq = b.s.inspecter(id)?.seq;
      const sorties = recevoir(id, m, t);
      if (bot && m.t === "etat") {
        envoyes++;
        if (b.s.inspecter(id)?.seq !== m.seq && b.s.inspecter(id)?.vivant && avantSeq !== undefined) refuses++;
      }
      return sorties;
    };
    avancer(b, 60_000);
    expect(envoyes).toBeGreaterThan(500);
    expect(refuses).toBe(0);
  });
});

describe("IA des bots (lot 3b) : navigation, zone, combat entre bots", () => {
  /** L'humain, immobile et hors de vue des bots (protégé), ne gêne pas : on observe les bots entre eux. */
  const cacher = (b: Banc, id: string) => (): void => { const h = j(b, id); if (h.posture === "sol") h.protegeJusqua = Infinity; };

  it("un seul A* par tic pour tout le serveur, 3 000 nœuds au plus, les bots se déplacent vraiment", () => {
    const budget = new BudgetNavigation();
    const { b, id } = enJeu({ budgetNavigation: budget, echelleZone: 0.6 });
    const vivants = () => bots(b).filter((x) => x.vivant);
    const depart = new Map(vivants().map((x) => [x.id, [...x.p] as Vec3]));
    const t0 = b.t;
    avancer(b, 60_000, cacher(b, id));
    expect(budget.recherches).toBeGreaterThan(5);
    expect(budget.noeudsMax).toBeLessThanOrEqual(NOEUDS_MAX_BOT);
    // une recherche par période au plus : jamais plus que le temps écoulé le permet
    expect(budget.recherches).toBeLessThanOrEqual(Math.ceil((b.t - t0) / PERIODE_BUDGET_MS));
    // les bots encore en vie ont bougé (butin, zone, combat) : la plupart de plus de 20 m
    const bouges = vivants().filter((x) => depart.has(x.id) && Math.hypot(x.p[0] - depart.get(x.id)![0], x.p[2] - depart.get(x.id)![2]) > 20);
    expect(bouges.length).toBeGreaterThanOrEqual(Math.ceil(vivants().length * 0.6));
  }, 60_000);

  it("les bots s'arment, se battent entre eux (kills crédités, +50 PV, butin lâché) et se regroupent dans la zone qui rétrécit", () => {
    const { b, id } = enJeu({ echelleZone: 0.6 });
    const bilan: { vivants: number; dedans: number; palier: number }[] = [];
    // la partie se termine quand il ne reste qu'un joueur : on note ce qui se passe en route
    const armes = new Set<string>(), morts = new Set<string>();
    let kills = 0;
    avancer(b, 200_000, (t) => {
      cacher(b, id)();
      for (const x of bots(b)) {
        if (!x.equip.sansPrincipale || !x.equip.sansSecondaire || x.equip.speciale !== null) armes.add(x.id);
        if (!x.vivant) morts.add(x.id);
      }
      kills = Math.max(kills, bots(b).reduce((n, x) => n + x.kills, 0));
      if (Math.round(t / 50) % 400 !== 0) return;
      const z = etat(b).zone;
      if (!z) return;
      const e = etatDepuisZoneBr(z, t);
      const vivants = bots(b).filter((x) => x.vivant);
      bilan.push({ vivants: vivants.length, dedans: vivants.filter((x) => Math.hypot(x.p[0] - e.centre[0], x.p[2] - e.centre[1]) <= e.rayon + 5).length, palier: z.palier });
    });
    expect(armes.size).toBeGreaterThanOrEqual(6);
    // des morts, dont au moins une par un tir de bot (kill crédité)
    expect(morts.size).toBeGreaterThanOrEqual(2);
    expect(kills).toBeGreaterThanOrEqual(1);
    // la majorité des survivants est dans le cercle courant à chaque relevé (les autres sont en train de le rejoindre ou meurent de la tempête)
    const releves = bilan.filter((x) => x.vivants >= 3);
    expect(releves.length).toBeGreaterThan(3);
    const part = releves.reduce((n, x) => n + x.dedans / x.vivants, 0) / releves.length;
    expect(part).toBeGreaterThan(0.6);
  }, 90_000);
});

describe("budget de navigation partagé entre deux parties (ids de bots homonymes)", () => {
  /** Budget qui note les clés demandées et retirées. */
  class BudgetEspion extends BudgetNavigation {
    demandees = new Set<string>();
    retirees: string[] = [];
    override demander(id: string, t: number): boolean { this.demandees.add(id); return super.demander(id, t); }
    override retirer(id: string): void { this.retirees.push(id); super.retirer(id); }
  }
  const cacher = (b: Banc, id: string) => (): void => { const h = j(b, id); if (h.posture === "sol") h.protegeJusqua = Infinity; };

  it("les bots b1…bN de deux salles ont des clés distinctes dans la file, et retirerTous d'une salle ne purge pas celle de l'autre", () => {
    const budget = new BudgetEspion();
    const A = enJeu({ budgetNavigation: budget, echelleZone: 0.6 });
    avancer(A.b, 20_000, cacher(A.b, A.id));
    const cleA = new Set(budget.demandees);
    expect(cleA.size).toBeGreaterThan(0);
    const B = enJeu({ budgetNavigation: budget, echelleZone: 0.6 }, { t: "lancerPartie" }, 5);
    avancer(B.b, 20_000, cacher(B.b, B.id));
    const cleB = new Set([...budget.demandees].filter((k) => !cleA.has(k)));
    expect(cleB.size).toBeGreaterThan(0);
    // même suite d'ids de bots dans les deux salles, mais jamais la même clé
    expect(bots(A.b).map((x) => x.id)).toEqual(bots(B.b).map((x) => x.id));
    for (const k of budget.demandees) expect(k).toMatch(/^\d+:b\d+$/);
    expect([...cleA].filter((k) => cleB.has(k))).toEqual([]);

    // une troisième salle, annulée (l'humain ne charge jamais) : ses bots quittent la file sous SES clés seulement
    const C = banc({ budgetNavigation: budget });
    const [idC] = arriver(C, 1);
    envoyer(C, idC, { t: "lancerPartie", bots: 5 });
    avancer(C, BR.decompteMaxMs + 400);
    expect(phase(C)).toBe("lobby");
    expect(budget.retirees).toHaveLength(5);
    expect(budget.retirees.filter((k) => cleA.has(k) || cleB.has(k))).toEqual([]);
  }, 120_000);
});

describe("essai déterministe `agressif`", () => {
  const agressif: Plus = { botsEssai: "agressif" };

  it("les bots tirent sur l'humain : sorties `tir` et `degats` collectées, mort créditée à un bot avec killcam, +50 PV, fin 15 s plus tard sans statistique", () => {
    const { b, id } = enJeu(agressif, { t: "lancerPartie", bots: 6, difficulte: "goulaf" }, 5);
    const humain = j(b, id);
    const depart = b.t;
    const tirs: Extract<MessageServeur, { t: "tir" }>[] = [];
    const degats: Extract<MessageServeur, { t: "degats" }>[] = [];
    let mort: Extract<MessageServeur, { t: "mort" }> | undefined;
    let tMort = 0;
    avancerJusque(b, () => !humain.vivant, 240_000).forEach((x) => {
      if (x.m.t === "tir") tirs.push(x.m);
      if (x.m.t === "degats" && x.m.cible === id) degats.push(x.m);
      if (x.m.t === "mort" && x.m.cible === id) { mort = x.m; tMort = b.t; }
    });
    expect(tirs.length).toBeGreaterThan(0);
    expect(tirs.every((x) => estIdBot(x.id) && typeof x.ts === "number")).toBe(true);
    expect(degats.length).toBeGreaterThan(0);
    expect(degats.every((x) => estIdBot(x.par))).toBe(true);
    // la mort : tueur-bot, killcam (la photographie du tueur), délai nul (mort définitive)
    expect(mort).toBeDefined();
    expect(estIdBot(mort!.par)).toBe(true);
    expect(mort!.tueur).toMatchObject({ id: mort!.par });
    const tueur = j(b, mort!.par);
    expect(tueur.kills).toBeGreaterThanOrEqual(1);
    expect(humain.morts).toBe(1);
    expect(b.t).toBeGreaterThan(depart);
    // la partie se termine `BR.finSansHumainMs` après la dernière mort humaine, avec bilan, places figées et le drapeau BOT
    const avant = avancer(b, BR.finSansHumainMs - 500);
    expect(phase(b)).toBe("jeu");
    expect(messages(avant, "br").every((x) => x.etat.phase !== "fin")).toBe(true);
    avancerJusque(b, () => phase(b) === "fin", 2_000);
    expect(b.t - tMort).toBeGreaterThanOrEqual(BR.finSansHumainMs - 100);
    expect(b.t - tMort).toBeLessThanOrEqual(BR.finSansHumainMs + 1_000);
    const bilan = etat(b).bilan!;
    expect(bilan.lignes.find((l) => l.id === id)?.bot).toBeUndefined();
    expect(bilan.lignes.filter((l) => l.bot)).toHaveLength(6);
    expect(bilan.lignes.every((l) => l.bot || l.id === id)).toBe(true);
    // l'humain est mort avant les survivants : il est classé derrière eux
    expect(bilan.lignes.find((l) => l.id === id)!.place).toBeGreaterThan(bilan.lignes.filter((l) => l.bot).length - 5);
    expect(etat(b).nonComptee).toBe(true);
    expect(b.stats.parties).toHaveLength(0);
  }, 60_000);

  it("le dernier humain qui part referme la partie, retire les bots, sans statistique ; l'hôte suivant est humain", () => {
    const { b, id } = enJeu(agressif, { t: "lancerPartie", bots: 3 });
    expect(b.s.nombreBots()).toBe(3);
    const sorties = b.s.deconnecter(id, b.t);
    void sorties;
    expect(b.s.nombreJoueurs()).toBe(0);
    expect(b.s.nombreBots()).toBe(0);
    expect(phase(b)).toBe("lobby");
    expect(b.stats.parties).toHaveLength(0);
    // le compteur d'ids repart à zéro pour la partie suivante
    const [nouveau] = arriver(b, 1);
    envoyer(b, nouveau, { t: "lancerPartie", bots: 2 });
    expect(bots(b).map((x) => x.id)).toEqual(["b1", "b2"]);
  });
});

describe("annulation, retour au lobby, nettoyage", () => {
  it("un spectateur venu regarder garde la salle ouverte quand le dernier joueur humain part ; la partie des bots seuls finit 15 s après", () => {
    const { b, id } = enJeu({ botsEssai: "agressif" }, { t: "lancerPartie", bots: 3 });
    b.s.connecter("spec", "Zoe", b.t);
    expect(messages(envoyer(b, "spec", { t: "regarder" }), "spectateur")).toHaveLength(1);
    expect(b.s.nombreHumains()).toBe(2);
    const depart = b.t;
    b.s.deconnecter(id, b.t);
    // le spectateur est un membre humain : la salle n'est pas refermée, les bots sont toujours là
    expect(b.s.nombreHumains()).toBe(1);
    expect(b.s.nombreBots()).toBe(3);
    expect(phase(b)).toBe("jeu");
    avancer(b, BR.finSansHumainMs - 500);
    expect(phase(b)).toBe("jeu");
    avancerJusque(b, () => phase(b) === "fin", 2_000);
    expect(b.t - depart).toBeGreaterThanOrEqual(BR.finSansHumainMs - 100);
    expect(etat(b).bilan!.lignes.every((l) => l.bot === true || l.id === id)).toBe(true);
    expect(b.stats.parties).toHaveLength(0);
    // la fin ramène tout le monde au lobby, bots retirés, le spectateur reste membre
    avancerJusque(b, () => phase(b) === "lobby", 10_000);
    expect(b.s.nombreBots()).toBe(0);
    expect(humains(b).map((x) => x.id)).toEqual(["spec"]);
  }, 60_000);

  it("l'humain n'est pas monté au bout de 30 s : retour au lobby annulé, bots retirés (jamais de combat de bots sans humain)", () => {
    const b = banc();
    const [id] = arriver(b, 1);
    envoyer(b, id, { t: "lancerPartie", bots: 5 });
    // les bots montent, l'humain ne charge jamais
    avancer(b, BR.decompteMaxMs - 200);
    expect(phase(b)).toBe("decompte");
    expect(bots(b).every((x) => x.enJeu)).toBe(true);
    avancer(b, 400);
    expect(phase(b)).toBe("lobby");
    expect(etat(b).annule).toBe(true);
    expect(b.s.nombreBots()).toBe(0);
    expect(b.s.nombreJoueurs()).toBe(1);
    expect(j(b, id).enJeu).toBe(false);
  });

  it("le bilan ramène au lobby : bots retirés, l'humain peut relancer", () => {
    const { b, id } = enJeu({ botsEssai: "agressif", finAffichageMs: 3_000 }, { t: "lancerPartie", bots: 3, difficulte: "goulaf" }, 5);
    // l'humain quitte la partie en cours : éliminé, puis la partie des bots seuls se termine
    envoyer(b, id, { t: "quitter" });
    expect(j(b, id).enJeu).toBe(false);
    avancerJusque(b, () => phase(b) === "fin", BR.finSansHumainMs + 5_000);
    avancerJusque(b, () => phase(b) === "lobby", 10_000);
    expect(b.s.nombreBots()).toBe(0);
    expect(humains(b)).toHaveLength(1);
    envoyer(b, id, { t: "lancerPartie", bots: 2 });
    expect(phase(b)).toBe("decompte");
    expect(b.s.nombreBots()).toBe(2);
  }, 60_000);

  it("retirerBot nettoie la table et le suivi, et laisse un humain intact", () => {
    const b = banc();
    const [id] = arriver(b, 1);
    const bot = b.s.ajouterBot("Rayure", b.t);
    expect(bot.bot).toBe(true);
    expect(bot.id).toBe("b1");
    expect(b.s.equipementProchain("b1")).toBeDefined();
    expect(b.s.nombreHumains()).toBe(1);
    b.s.retirerBot(id);
    expect(b.s.inspecter(id)).toBeDefined();
    b.s.retirerBot("b1");
    expect(b.s.inspecter("b1")).toBeUndefined();
    expect(b.s.equipementProchain("b1")).toBeUndefined();
    expect(b.s.nouvelIdBot()).toBe("b1");
  });
});

describe("humain contre bot, voix, statistiques", () => {
  it("un humain tue un bot (tir validé par le serveur, rejeu de latence) : kill crédité, butin lâché, bot hors du snap", () => {
    const { b, id } = enJeu({}, { t: "lancerPartie", bots: 3 });
    const humain = j(b, id);
    const cible = bots(b).find((x) => x.vivant)!;
    // l'humain se place à 6 m du bot, en vue et hors des murs, pistolet en main, dégainé ; le bot est blessé et sort de sa protection d'atterrissage
    const place = Array.from({ length: 16 }, (_, i): Vec3 => [cible.p[0] + 6 * Math.cos((i * Math.PI) / 8), cible.p[1], cible.p[2] + 6 * Math.sin((i * Math.PI) / 8)])
      .find((p) => {
        const r = resoudre(monde, p, 0.4, 1.8).p;
        return Math.hypot(r[0] - p[0], r[2] - p[2]) < 1e-6 && visible(monde, [p[0], p[1] + 1.95, p[2]], [cible.p[0], cible.p[1] + 1.2, cible.p[2]]);
      });
    if (!place) throw new Error("aucune place en vue du bot");
    humain.p = place;
    humain.histo = [{ t: b.t, p: [...humain.p] as Vec3, accroupi: false }];
    humain.equip = { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true };
    humain.main = "secondaire";
    humain.arme = "pistolet";
    humain.sortieJusqua = -Infinity;
    cible.protegeJusqua = 0;
    cible.pv = 50;
    let tue: Extract<MessageServeur, { t: "mort" }> | undefined;
    for (let k = 0; k < 8 && cible.vivant; k++) {
      avancer(b, 300);
      if (!cible.vivant) break;
      const o: Vec3 = [humain.p[0], humain.p[1] + 1.95, humain.p[2]];
      const v: Vec3 = [cible.p[0] - o[0], cible.p[1] + 1.2 - o[1], cible.p[2] - o[2]];
      const l = Math.hypot(...v);
      const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
      envoyer(b, id, { t: "etat", seq: 100 + k, p: humain.p, v: [0, 0, 0], lacet: Math.atan2(-d[0], -d[2]), tangage: Math.asin(d[1]), posture: "sol", mur: 0 });
      const out = envoyer(b, id, { t: "tir", arme: "pistolet", o, d: [d], touches: [{ cible: cible.id, zone: "corps", plomb: 0 }] });
      const m = messages(out, "mort").find((x) => x.cible === cible.id);
      if (m) tue = m;
    }
    expect(cible.vivant).toBe(false);
    expect(tue).toBeDefined();
    expect(tue!.par).toBe(id);
    expect(humain.kills).toBe(1);
    // +50 PV plafonnés à 100 (déjà plein : rien à ajouter), le bot sort de la liste des vivants
    expect(humain.pv).toBeLessThanOrEqual(100);
    expect(service(b).resume().vivants).toBeLessThan(4);
    // les bots morts ne sont plus pilotés (aucun état envoyé)
    const seq = cible.seq;
    avancer(b, 2_000);
    expect(cible.seq).toBe(seq);
  });

  it("voix : ciblesVoixBr n'inclut aucun bot, le tueur-bot n'ouvre aucun lien de killcam", () => {
    const moi = { id: "j1", voix: true, spectateur: false, p: [0, 0, 0] as Vec3 };
    const autres = [
      { id: "b1", voix: true, spectateur: false, p: [3, 0, 0] as Vec3 },
      { id: "b12", voix: true, spectateur: true, p: null },
      { id: "j2", voix: true, spectateur: false, p: [10, 0, 0] as Vec3 },
    ];
    expect(ciblesVoixBr(moi, autres, ["b1", "j2"]).voulus).toEqual(["j2"]);
    expect(ciblesVoixBr({ ...moi, spectateur: true, p: null }, autres, []).voulus).toEqual([]);
    const liens = new LiensVoixKillcam();
    expect(liens.surMort("j1", "j1", "b4", 1_000)).toBe(false);
    expect(liens.surMort("j1", "b4", "j1", 1_000)).toBe(false);
    expect(liens.actifs(1_000)).toEqual([]);
    expect(liens.surMort("j1", "j1", "j2", 1_000)).toBe(true);
    expect(liens.actifs(1_001)).toEqual(["j2"]);
  });

  it("côté serveur, le kill d'un bot n'ouvre pas de lien vocal de killcam", () => {
    const b = banc();
    const [id] = arriver(b, 1);
    const bot = b.s.ajouterBot("Rayure", b.t);
    b.s.connecter("j2", "Bob", b.t);
    for (const x of [j(b, id), bot, j(b, "j2")]) { x.enJeu = true; x.vivant = true; }
    // la mort d'un humain sous les balles d'un bot (hors partie : sans service actif, `mourirBr` passe par `infliger`)
    expect(() => b.s.infliger(j(b, "j2"), 500, bot, "arme", "corps", "pistolet", b.t)).not.toThrow();
    const liens = (b.s as unknown as { liensVoix: Map<string, number> }).liensVoix;
    expect([...liens.keys()].some((k) => k.includes("b1"))).toBe(false);
  });
});
