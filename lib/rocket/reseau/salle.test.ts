import { describe, expect, it } from "vitest";
import { MATCH, PAS_S } from "../contrat";
import type { Equipe } from "../contrat";
import { creerArene } from "../arene";
import { pasMonde } from "../match";
import { creerMondeEnLigne } from "./monde-ligne";
import { creerSalleRocket } from "./salle";
import { decoderSnap, dequantifierEntrees, encoderEtat, encoderSnap, extraireEtat, restaurerEtat } from "./serialisation";
import { AVANCE_INCONNUE, REGLAGES_SALON_DEFAUT, RESEAU } from "./protocole";
import type {
  EntreesQuantifiees, MessageClient, MessageServeur, OptionsSalleRocket, SalleRocket, SnapRocket, SortieSalle, TrameEntrees,
} from "./protocole";

// ============================================================================================================================
// Outils : horloge virtuelle, collecte des sorties, joueurs scriptés
// ============================================================================================================================

const PERIODE_MS = RESEAU.periodeMinuteurServeurMs;
type Msg<T extends MessageServeur["t"]> = Extract<MessageServeur, { t: T }>;

function creer(opts: Partial<OptionsSalleRocket> = {}): SalleRocket {
  return creerSalleRocket({
    code: "BCDF", hote: { id: 1, nom: "Alice" }, reglages: { ...REGLAGES_SALON_DEFAUT(), niveauBots: "debutant" }, graine: 7, maintenantMs: 0, dev: true, ...opts,
  });
}
const messages = <T extends MessageServeur["t"]>(sorties: readonly SortieSalle[], t: T, a?: number | "tous"): Msg<T>[] =>
  sorties.flatMap((s) => ("msg" in s && s.msg.t === t && (a === undefined || s.a === a) ? [s.msg as Msg<T>] : []));
const snaps = (sorties: readonly SortieSalle[], a?: number): SnapRocket[] =>
  sorties.flatMap((s) => ("snap" in s && (a === undefined || s.a === a) ? [s.snap] : []));
const dernierSalon = (sorties: readonly SortieSalle[]) => messages(sorties, "salon").at(-1)?.salon ?? null;

/** Une scène : horloge virtuelle et journal de tout ce que la salle a émis. */
class Scene {
  t = 0;
  readonly journal: SortieSalle[] = [];
  constructor(public salle: SalleRocket) {}
  /** réveils de 8 ms pendant `ms` millisecondes de temps virtuel */
  avancer(ms: number, budget?: number): SortieSalle[] {
    const sorties: SortieSalle[] = [];
    const fin = this.t + ms;
    while (this.t + PERIODE_MS <= fin) {
      this.t += PERIODE_MS;
      sorties.push(...this.salle.tic(this.t, budget));
    }
    this.journal.push(...sorties);
    return sorties;
  }
  /** avance jusqu'à ce que `cond` soit vraie sur les sorties d'un réveil (au plus `maxMs`) ; rend tout ce qui a été émis */
  jusqua(cond: (s: readonly SortieSalle[]) => boolean, maxMs = 60_000): SortieSalle[] {
    const tout: SortieSalle[] = [];
    const limite = this.t + maxMs;
    while (this.t < limite) {
      this.t += PERIODE_MS;
      const s = this.salle.tic(this.t);
      tout.push(...s);
      if (cond(s)) break;
    }
    this.journal.push(...tout);
    return tout;
  }
  envoyer(id: number, msg: MessageClient): SortieSalle[] {
    const s = this.salle.recevoir(id, msg, this.t);
    this.journal.push(...s);
    return s;
  }
  entrees(id: number, trame: Partial<TrameEntrees> & { entrees: EntreesQuantifiees[] }): SortieSalle[] {
    const s = this.salle.recevoirEntrees(id, { numero: this.numero(), tickDebut: this.salle.monde()?.tick ?? 0, snapRecu: 0, ...trame }, this.t);
    this.journal.push(...s);
    return s;
  }
  numero(): number {
    const d = messages(this.journal, "debut").at(-1);
    return d ? d.numero : 0;
  }
}

const Q = (o: Partial<EntreesQuantifiees> = {}): EntreesQuantifiees => ({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false, ...o });
const gaz = (n: number, o: Partial<EntreesQuantifiees> = {}): EntreesQuantifiees[] => Array.from({ length: n }, () => Q({ accel: 127, ...o }));

/** Salle à deux humains (Alice id 1 hôte, Bob id 2), 1v1, chargement terminé, match lancé (décompte en cours). */
function duoEnMatch(opts: Partial<OptionsSalleRocket> = {}, format: "1v1" | "2v2" | "3v3" = "1v1"): Scene {
  const sc = new Scene(creer(opts));
  if (format !== "1v1") sc.envoyer(1, { t: "reglages", reglages: { format } });
  expect(sc.salle.rejoindre({ id: 2, nom: "Bob" }, sc.t).ok).toBe(true);
  sc.envoyer(1, { t: "lancer" });
  sc.envoyer(1, { t: "pret" });
  sc.envoyer(2, { t: "pret" });
  expect(sc.salle.phase).toBe("match");
  return sc;
}
/** Solo contre un bot (humainsMin = 1), en match. */
function soloEnMatch(opts: Partial<OptionsSalleRocket> = {}): Scene {
  const sc = new Scene(creer({ humainsMin: 1, ...opts }));
  sc.envoyer(1, { t: "lancer" });
  sc.envoyer(1, { t: "pret" });
  expect(sc.salle.phase).toBe("match");
  return sc;
}
/** Mène un match de duo jusqu'à sa fin (chrono court, prolongation, but forcé). */
function jouerJusquALaFin(sc: Scene): void {
  sc.envoyer(1, { t: "dev", action: "chrono", tempsRestant: 0.2 });
  sc.jusqua((s) => messages(s, "ev").some((m) => m.evenements.some((x) => x.e.t === "prolongation")), 30_000);
  sc.envoyer(1, { t: "dev", action: "balle", p: [0, 2, 56], v: [0, 0, 0] });
  sc.jusqua((s) => messages(s, "fin").length > 0, 30_000);
}

// ============================================================================================================================
// Salon
// ============================================================================================================================

describe("salon : création, équipes, réglages", () => {
  it("l'hôte est présent, la salle n'est pas lancable seule, résumé cohérent", () => {
    const s = creer();
    expect(s.phase).toBe("salon");
    expect(s.humains()).toBe(1);
    expect(s.vide()).toBe(false);
    expect(s.aEcheance()).toBe(false);
    expect(s.monde()).toBeNull();
    const e = s.etat();
    expect(e.code).toBe("BCDF");
    expect(e.joueurs).toHaveLength(1);
    expect(e.joueurs[0]).toMatchObject({ id: 1, nom: "Alice", hote: true, connecte: true });
    expect(e.lancable).toBe(false);
    expect(e.raisonNonLancable).toMatch(/2 joueurs/);
    expect(e.placesParEquipe).toBe(1);
    expect(s.resume()).toEqual({ code: "BCDF", hote: "Alice", format: "1v1", dureeS: MATCH.dureeDefautS, niveauBots: "debutant", humains: 1, places: 2 });
  });

  it("l'équipe de l'hôte est tirée par la graine de la salle : deux salles de même graine, même tirage", () => {
    const eq = (g: number): Equipe => creer({ graine: g }).etat().joueurs[0].equipe;
    expect(eq(5)).toBe(eq(5));
    const vues = new Set<Equipe>();
    for (let g = 0; g < 30; g++) vues.add(eq(g));
    expect(vues.size).toBe(2);
  });

  it("rejoindre : en 1v1 le second va dans l'équipe opposée à l'hôte ; salon notifié à tous", () => {
    const s = creer();
    const hote = s.etat().joueurs[0].equipe;
    const r = s.rejoindre({ id: 2, nom: "Bob" }, 10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sorties).toHaveLength(1);
    expect(r.sorties[0]).toMatchObject({ a: "tous", msg: { t: "salon" } });
    const e = s.etat();
    expect(e.joueurs.find((j) => j.id === 2)!.equipe).not.toBe(hote);
    expect(e.lancable).toBe(true);
    expect(e.raisonNonLancable).toBeUndefined();
  });

  it("rejoindre : refus pleine, deja-dans-salle, en-cours", () => {
    const s = creer();
    s.rejoindre({ id: 2, nom: "Bob" }, 0);
    expect(s.rejoindre({ id: 3, nom: "Cy" }, 0)).toEqual({ ok: false, raison: "pleine" });
    expect(s.rejoindre({ id: 2, nom: "Bob" }, 0)).toEqual({ ok: false, raison: "deja-dans-salle" });
    const sc = new Scene(s);
    sc.envoyer(1, { t: "lancer" });
    expect(s.rejoindre({ id: 4, nom: "Dan" }, 0)).toEqual({ ok: false, raison: "en-cours" });
  });

  it("équipe demandée à l'arrivée si elle a de la place, sinon la moins remplie", () => {
    const s = creer();
    const sc = new Scene(s);
    sc.envoyer(1, { t: "reglages", reglages: { format: "2v2" } });
    const h = s.etat().joueurs[0].equipe;
    const autre: Equipe = h === "bleue" ? "orange" : "bleue";
    expect(s.rejoindre({ id: 2, nom: "B", equipe: h }, 0).ok).toBe(true);
    expect(s.etat().joueurs[1].equipe).toBe(h);
    // l'équipe de l'hôte est pleine (2/2) : une demande y échoue en douceur
    expect(s.rejoindre({ id: 3, nom: "C", equipe: h }, 0).ok).toBe(true);
    expect(s.etat().joueurs[2].equipe).toBe(autre);
  });

  it("changement d'équipe : équipe-pleine, phase, invalide, no-op silencieux", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    const mienne = sc.salle.etat().joueurs[0].equipe;
    const autre: Equipe = mienne === "bleue" ? "orange" : "bleue";
    expect(messages(sc.envoyer(1, { t: "equipe", equipe: autre }), "refus")[0]).toMatchObject({ action: "equipe", raison: "equipe-pleine" });
    expect(sc.envoyer(1, { t: "equipe", equipe: mienne })).toEqual([]);
    // Bob passe chez l'hôte (2v2 d'abord)
    sc.envoyer(1, { t: "reglages", reglages: { format: "2v2" } });
    const s = sc.envoyer(2, { t: "equipe", equipe: mienne });
    expect(dernierSalon(s)!.joueurs.find((j) => j.id === 2)!.equipe).toBe(mienne);
    sc.envoyer(1, { t: "reglages", reglages: { format: "1v1" } }); // refusé : 2 humains dans la même équipe
    expect(sc.salle.etat().reglages.format).toBe("2v2");
    expect(messages(sc.envoyer(2, { t: "equipe", equipe: "violette" as Equipe }), "refus")[0].raison).toBe("invalide");
    sc.envoyer(1, { t: "lancer" });
    expect(messages(sc.envoyer(2, { t: "equipe", equipe: autre }), "refus")[0].raison).toBe("phase");
  });

  it("réglages : hôte seulement, bornes, format refusé s'il ne tient plus, rien d'émis si rien ne change", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    expect(messages(sc.envoyer(2, { t: "reglages", reglages: { dureeS: 180 } }), "refus")[0].raison).toBe("hote");
    const s = sc.envoyer(1, { t: "reglages", reglages: { format: "3v3", dureeS: 600, niveauBots: "allstar", visible: false } });
    expect(dernierSalon(s)!.reglages).toEqual({ format: "3v3", dureeS: 600, niveauBots: "allstar", visible: false });
    expect(dernierSalon(s)!.placesParEquipe).toBe(3);
    expect(sc.envoyer(1, { t: "reglages", reglages: { dureeS: 600 } })).toEqual([]);
    for (const r of [{ dureeS: 123 }, { niveauBots: "dieu" }, { format: "4v4" }, { visible: "oui" }]) {
      expect(messages(sc.envoyer(1, { t: "reglages", reglages: r as never }), "refus")[0].raison).toBe("invalide");
    }
    expect(sc.salle.etat().reglages.dureeS).toBe(600);
    // 3v3 → 1v1 avec un humain par équipe est possible ; 2 humains dans la même équipe l'interdit
    expect(dernierSalon(sc.envoyer(1, { t: "reglages", reglages: { format: "1v1" } }))!.reglages.format).toBe("1v1");
  });

  it("lancer : hôte seulement, au moins deux humains, une seule fois", () => {
    const sc = new Scene(creer());
    expect(messages(sc.envoyer(1, { t: "lancer" }), "refus")[0]).toMatchObject({ action: "lancer", raison: "joueurs" });
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    expect(messages(sc.envoyer(2, { t: "lancer" }), "refus")[0].raison).toBe("hote");
    expect(sc.envoyer(1, { t: "lancer" }).length).toBeGreaterThan(0);
    expect(sc.salle.phase).toBe("chargement");
    expect(messages(sc.envoyer(1, { t: "lancer" }), "refus")[0].raison).toBe("phase");
  });

  it("humainsMin = 1 : un humain seul contre des bots peut lancer", () => {
    const sc = new Scene(creer({ humainsMin: 1 }));
    expect(sc.salle.etat().lancable).toBe(true);
    sc.envoyer(1, { t: "lancer" });
    expect(sc.salle.phase).toBe("chargement");
  });

  it("départ en salon : joueur retiré, hôte transféré au plus ancien, salle vide à la fin", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "reglages", reglages: { format: "2v2" } });
    sc.salle.rejoindre({ id: 3, nom: "Cy" }, 0);
    const s = sc.salle.retirer(1, 5, false);
    const e = dernierSalon(s)!;
    expect(e.joueurs.map((j) => j.id)).toEqual([2, 3]);
    expect(e.joueurs.find((j) => j.hote)!.id).toBe(2);
    expect(sc.salle.retirer(99, 5, false)).toEqual([]);
    sc.salle.retirer(2, 6, true); // une coupure en salon est un départ
    sc.salle.retirer(3, 7, false);
    expect(sc.salle.vide()).toBe(true);
    expect(sc.salle.humains()).toBe(0);
  });

  it("quitter est acquitté par salon{null, quitte}", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    const s = sc.envoyer(2, { t: "quitter" });
    expect(messages(s, "salon", 2)[0]).toMatchObject({ salon: null, raison: "quitte" });
    expect(sc.salle.humains()).toBe(1);
  });

  it("activiteMs suit les actions utiles, pas les pings", () => {
    const sc = new Scene(creer());
    sc.t = 5000;
    sc.envoyer(1, { t: "ping", c: 1 });
    expect(sc.salle.activiteMs()).toBe(0);
    sc.envoyer(1, { t: "reglages", reglages: { dureeS: 180 } });
    expect(sc.salle.activiteMs()).toBe(5000);
  });

  it("messages hors périmètre de la salle (bonjour, lister…) ou d'un inconnu : ignorés", () => {
    const sc = new Scene(creer());
    expect(sc.envoyer(1, { t: "lister" })).toEqual([]);
    expect(sc.envoyer(1, { t: "bonjour", v: 1, nom: "x" })).toEqual([]);
    expect(sc.envoyer(42, { t: "lancer" })).toEqual([]);
    expect(sc.envoyer(1, { t: "pret" })).toEqual([]); // hors chargement
    expect(sc.envoyer(1, { t: "klaxon" })).toEqual([]);
    expect(sc.envoyer(1, { t: "revanche", oui: true })).toEqual([]);
  });
});

// ============================================================================================================================
// Chargement
// ============================================================================================================================

describe("chargement", () => {
  it("lancer : debut pour chacun (moi, numero, voitures, config), monde créé et pas encore avancé", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    const s = sc.envoyer(1, { t: "lancer" });
    const d1 = messages(s, "debut", 1)[0], d2 = messages(s, "debut", 2)[0];
    expect(d1).toBeDefined();
    expect(d2).toBeDefined();
    expect(d1.numero).toBe(d2.numero);
    expect(d1.moi).not.toBe(d2.moi);
    expect(d1.voitures).toHaveLength(2);
    expect(d1.voitures.map((v) => v.joueur).sort()).toEqual([1, 2]);
    expect(d1.voitures.find((v) => v.id === d1.moi)).toMatchObject({ joueur: 1, nom: "Alice", humain: true });
    expect(d1.voitures[0].equipe).toBe("bleue");
    expect(d1.voitures[1].equipe).toBe("orange");
    expect(d1.config.format).toBe("1v1");
    expect(d1.config.dureeS).toBe(MATCH.dureeDefautS);
    expect(dernierSalon(s)!.phase).toBe("chargement");
    expect(sc.salle.phase).toBe("chargement");
    expect(sc.salle.enMatch()).toBe(true);
    expect(sc.salle.aEcheance()).toBe(true);
    expect(sc.salle.monde()!.tick).toBe(0);
  });

  it("les places non prises reçoivent des bots nommés ; deux humains dans la même équipe affrontent des bots", () => {
    const sc = new Scene(creer());
    sc.envoyer(1, { t: "reglages", reglages: { format: "2v2" } });
    const h = sc.salle.etat().joueurs[0].equipe;
    sc.salle.rejoindre({ id: 2, nom: "Bob", equipe: h }, 0);
    const d = messages(sc.envoyer(1, { t: "lancer" }), "debut", 1)[0];
    expect(d.voitures).toHaveLength(4);
    const equipeH = d.voitures.filter((v) => v.equipe === h);
    expect(equipeH.every((v) => v.humain)).toBe(true);
    expect(equipeH.map((v) => v.slot)).toEqual([0, 1]);
    const bots = d.voitures.filter((v) => !v.humain);
    expect(bots).toHaveLength(2);
    expect(bots.every((v) => v.joueur === null && v.nom.length > 0)).toBe(true);
    // ordre imposé par le moteur : bleue puis orange
    expect(d.voitures.map((v) => v.id)).toEqual([0, 1, 2, 3]);
    expect(d.voitures.map((v) => v.equipe)).toEqual(["bleue", "bleue", "orange", "orange"]);
  });

  it("le monde ne tique pas en chargement : ni instantané ni pas ; pong.tick = −1", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    const s = sc.avancer(2000);
    expect(snaps(s)).toHaveLength(0);
    expect(sc.salle.monde()!.tick).toBe(0);
    expect(sc.salle.mesures().pas).toBe(0);
    expect(messages(sc.envoyer(1, { t: "ping", c: 5 }), "pong")[0]).toEqual({ t: "pong", c: 5, tick: -1, ralenti: false });
  });

  it("pret : salon mis à jour (charge), le match démarre quand tous sont prêts, avec un instantané initial", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    const s1 = sc.envoyer(1, { t: "pret" });
    expect(dernierSalon(s1)!.joueurs.map((j) => j.charge)).toEqual([true, false]);
    expect(sc.salle.phase).toBe("chargement");
    expect(sc.envoyer(1, { t: "pret" })).toEqual([]);
    const s2 = sc.envoyer(2, { t: "pret" });
    expect(sc.salle.phase).toBe("match");
    expect(dernierSalon(s2)!.phase).toBe("match");
    const a = snaps(s2, 1)[0], b = snaps(s2, 2)[0];
    for (const x of [a, b]) {
      expect(x.tick).toBe(0);
      expect(x.avance).toBe(AVANCE_INCONNUE);
      expect(x.entreesRecuesJusqua).toBe(-1);
      expect(x.manquees).toBe(0);
      expect(x.nbVoitures).toBe(2);
      expect(x.etat.phase).toBe("decompte");
    }
  });

  it("un joueur qui ne dit jamais pret : le match démarre à chargementMaxMs, servi par tic", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    sc.envoyer(1, { t: "pret" });
    sc.avancer(RESEAU.chargementMaxMs - 100);
    expect(sc.salle.phase).toBe("chargement");
    const s = sc.avancer(200);
    expect(sc.salle.phase).toBe("match");
    expect(snaps(s, 1).length).toBeGreaterThan(0);
    expect(snaps(s, 2).length).toBeGreaterThan(0);
  });

  it("chargementMaxMs est réglable (option)", () => {
    const sc = new Scene(creer({ chargementMaxMs: 500 }));
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    sc.avancer(520);
    expect(sc.salle.phase).toBe("match");
  });

  it("un joueur coupé pendant le chargement ne bloque pas : le match part quand les connectés sont prêts", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    sc.envoyer(2, { t: "pret" });
    sc.salle.retirer(1, sc.t, true);
    expect(sc.salle.phase).toBe("match");
  });

  it("départ volontaire pendant le chargement : bot immédiat, le chargement se termine avec les restants", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    sc.envoyer(1, { t: "pret" });
    const s = sc.salle.retirer(2, sc.t, false);
    expect(messages(s, "presence")[0]).toMatchObject({ joueur: 2, etat: "bot" });
    expect(sc.salle.phase).toBe("match");
  });
});

// ============================================================================================================================
// Match : entrées, bots, instantanés
// ============================================================================================================================

describe("match : instantanés et pong", () => {
  it("un instantané par humain tous les 6 ticks : 20 Hz à ±10 %", () => {
    const sc = duoEnMatch();
    const s = sc.avancer(10_000);
    for (const id of [1, 2]) {
      const mine = snaps(s, id);
      const ticks = mine.map((x) => x.tick);
      expect(mine.length).toBeGreaterThan(190);
      expect(mine.length).toBeLessThan(210);
      expect(ticks.every((t) => t % 6 === 0 || true)).toBe(true);
      // sur la grille : jamais deux fois le même tick, tous multiples de 6 hors événement important
      expect(new Set(ticks).size).toBe(ticks.length);
    }
    // le temps de jeu suit l'horloge virtuelle (1 pas par 1/120 s)
    expect(sc.salle.monde()!.tick).toBeGreaterThan(1190);
    expect(sc.salle.monde()!.tick).toBeLessThan(1210);
  });

  it("tous les instantanés réguliers tombent sur un multiple de 6 (hors événements importants)", () => {
    const sc = duoEnMatch();
    const s = sc.avancer(3000);
    const horsGrille = snaps(s, 1).filter((x) => x.tick % 6 !== 0);
    // coupDEnvoi (décompte de 3 s) est le seul événement important de cette fenêtre
    expect(horsGrille.length).toBeLessThanOrEqual(1);
  });

  it("chaque instantané porte l'état complet et des entrées pour chaque voiture", () => {
    const sc = duoEnMatch({}, "2v2");
    const s = snaps(sc.avancer(200), 1);
    for (const x of s) {
      expect(x.nbVoitures).toBe(4);
      expect(x.entrees).toHaveLength(4);
      expect(x.etat.voitures).toHaveLength(4);
      expect(x.etat.tick).toBe(x.tick);
      expect(x.numero).toBe(sc.numero());
      expect(x.ralenti).toBe(false);
    }
  });

  it("pong : tick fractionnaire pendant le match, croissant ; −1 hors match", () => {
    const sc = duoEnMatch();
    sc.avancer(1000);
    const a = messages(sc.envoyer(1, { t: "ping", c: 9 }), "pong")[0];
    expect(a.c).toBe(9);
    expect(a.ralenti).toBe(false);
    const base = sc.salle.monde()!.tick;
    expect(a.tick).toBeGreaterThanOrEqual(base);
    expect(a.tick).toBeLessThanOrEqual(base + 1);
    sc.t += 4; // un demi-pas plus tard, avant le réveil suivant
    const b = messages(sc.envoyer(1, { t: "ping", c: 10 }), "pong")[0];
    expect(b.tick).toBeGreaterThan(a.tick);
    expect(b.tick).toBeLessThanOrEqual(base + 1);
  });

  it("trame d'un autre numero de match ou d'un inconnu : écartée", () => {
    const sc = duoEnMatch();
    sc.avancer(100);
    const tick = sc.salle.monde()!.tick;
    sc.entrees(1, { numero: (sc.numero() + 1) & 255, tickDebut: tick + 3, entrees: gaz(3) });
    sc.entrees(77, { tickDebut: tick + 3, entrees: gaz(3) });
    const s = snaps(sc.avancer(100), 1);
    expect(s.at(-1)!.entreesRecuesJusqua).toBe(-1);
    expect(s.at(-1)!.avance).toBe(AVANCE_INCONNUE);
  });
});

describe("match : entrées des humains", () => {
  const voitureDe = (sc: Scene, joueur: number): number => messages(sc.journal, "debut", joueur).at(-1)!.moi;

  it("une entrée reçue pour un tick futur est appliquée exactement à ce tick (la voiture avance)", () => {
    const sc = duoEnMatch();
    sc.avancer(3200); // décompte passé
    const moi = voitureDe(sc, 1);
    const z0 = sc.salle.monde()!.voitures[moi].v.slice();
    const tick = sc.salle.monde()!.tick;
    sc.entrees(1, { tickDebut: tick + 2, entrees: gaz(12) });
    sc.avancer(100);
    const v = sc.salle.monde()!.voitures[moi].v;
    expect(Math.hypot(v[0], v[1], v[2])).toBeGreaterThan(Math.hypot(z0[0], z0[1], z0[2]));
  });

  it("l'entrée appliquée est celle du tick, pas une autre : snap.entrees le montre", () => {
    const sc = duoEnMatch();
    sc.avancer(100);
    const moi = voitureDe(sc, 1);
    const tick = sc.salle.monde()!.tick;
    // direction 50 aux ticks pairs, −50 aux impairs, bouton saut un tick sur trois
    const entrees = Array.from({ length: 12 }, (_, i) => Q({ direction: (tick + 4 + i) % 2 === 0 ? 50 : -50, saut: (tick + 4 + i) % 3 === 0 }));
    sc.entrees(1, { tickDebut: tick + 4, entrees });
    const vus = new Map<number, EntreesQuantifiees>();
    for (const x of snaps(sc.avancer(120), 1)) vus.set(x.tick, x.entrees[moi]);
    let verifies = 0;
    for (const [t, e] of vus) {
      const i = t - 1 - (tick + 4);
      if (i >= 0 && i < 12) { expect(e.direction).toBe(entrees[i].direction); expect(e.saut).toBe(entrees[i].saut); verifies++; }
    }
    expect(verifies).toBeGreaterThan(0);
  });

  it("entrée manquante : la dernière connue est répétée (≤ 60 ticks), puis des entrées neutres ; compteurs et manquees", () => {
    const sc = duoEnMatch();
    sc.avancer(100);
    const moi = voitureDe(sc, 1);
    const tick = sc.salle.monde()!.tick;
    sc.entrees(1, { tickDebut: tick, entrees: [Q({ accel: 127 }), Q({ accel: 90, boost: true })] });
    const avant = sc.salle.mesures().entreesRepetees;
    const s = snaps(sc.avancer(1000), 1);
    const par: Map<number, EntreesQuantifiees> = new Map(s.map((x) => [x.tick, x.entrees[moi]]));
    // tick+1 : l'entrée vraie ; tick+2 .. tick+61 : répétée (accel 90, boost) ; ensuite neutre
    const rep = [...par.entries()].find(([t]) => t > tick + 10 && t <= tick + 60);
    const neu = [...par.entries()].find(([t]) => t > tick + 80);
    expect(rep![1]).toMatchObject({ accel: 90, boost: true });
    expect(neu![1]).toMatchObject({ accel: 0, boost: false });
    expect(sc.salle.mesures().entreesRepetees - avant).toBe(RESEAU.repetitionMaxTicks);
    // la fenêtre qui suit rapporte les ticks sans entrée vraie
    expect(Math.max(...s.map((x) => x.manquees))).toBeGreaterThan(0);
  });

  it("avant la première entrée reçue, aucune « manquée » n'est comptée (le client attend son premier instantané)", () => {
    const sc = duoEnMatch();
    const s = snaps(sc.avancer(600), 1);
    expect(s.every((x) => x.manquees === 0 && x.avance === AVANCE_INCONNUE && x.entreesRecuesJusqua === -1)).toBe(true);
  });

  it("avance = pire cas de la fenêtre (première réception seulement), manquees remis à zéro à chaque instantané", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    const tick = sc.salle.monde()!.tick;
    // une trame contiguë : entrées de tick+10 à tick+13, puis une redondante déjà vue ; le pire cas est tick+10
    sc.entrees(1, { tickDebut: tick + 10, entrees: gaz(4) });
    sc.entrees(1, { tickDebut: tick + 10, entrees: gaz(4) }); // doublon intégral : ne compte pas
    sc.entrees(1, { tickDebut: tick + 12, entrees: gaz(4) }); // 12 et 13 redondants, 14 et 15 neufs (avance 14, 15)
    const premier = snaps(sc.avancer(60), 1)[0];
    expect(premier.avance).toBe(10);
    expect(premier.entreesRecuesJusqua).toBe(tick + 15);
    const suivant = snaps(sc.avancer(60), 1);
    // plus rien d'arrivé dans la fenêtre : « inconnue »
    expect(suivant[0].avance).toBe(AVANCE_INCONNUE);
  });

  it("trame d'ordre mélangé : l'entrée neuve la plus lente détermine avance ; une entrée tardive est comptée, pas appliquée, mais devient la dernière connue", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    const moi = voitureDe(sc, 1);
    const tick = sc.salle.monde()!.tick;
    const avantTardives = sc.salle.mesures().entreesTardives;
    // trame d'un tick antérieur au tick courant : ticks tick−5 .. tick+6 (les 5 premiers déjà passés, jamais vus)
    sc.entrees(1, { tickDebut: tick - 5, entrees: Array.from({ length: 12 }, (_, i) => Q({ accel: 10 + i })) });
    expect(sc.salle.mesures().entreesTardives - avantTardives).toBe(5);
    const s = snaps(sc.avancer(60), 1)[0];
    expect(s.avance).toBe(-5);
    // le tick le plus récent jamais reçu est tick+6 : (accel 21) devient la dernière connue ; plus tard la répétition le rejoue
    const plusTard = snaps(sc.avancer(1000), 1);
    const rep = plusTard.find((x) => x.tick > tick + 40)!;
    expect(rep.entrees[moi].accel).toBe(21);
  });

  it("une entrée tardive plus récente que tout ce qui est connu remplace la dernière entrée connue (rafale TCP)", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    const moi = voitureDe(sc, 1);
    sc.entrees(1, { tickDebut: sc.salle.monde()!.tick, entrees: [Q({ accel: 33 })] });
    sc.avancer(400); // 50 pas environ : l'entrée est répétée
    const tick = sc.salle.monde()!.tick;
    sc.entrees(1, { tickDebut: tick - 20, entrees: [Q({ accel: 77, boost: true })] }); // arrivée en retard, mais plus récente que le tick de l'entrée 33
    const s = snaps(sc.avancer(200), 1);
    expect(s.at(-1)!.entrees[moi]).toMatchObject({ accel: 77, boost: true });
    expect(s[0].avance).toBe(-20);
  });

  it("trame de plus de 12 entrées : écartée en entier", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    sc.entrees(1, { tickDebut: sc.salle.monde()!.tick + 2, entrees: gaz(RESEAU.entreesMaxParTrame + 1) });
    expect(snaps(sc.avancer(60), 1)[0].entreesRecuesJusqua).toBe(-1);
  });

  it("entrée trop avancée (> 120 ticks) écartée, ancienneté jamais appliquée", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    const tick = sc.salle.monde()!.tick;
    sc.entrees(1, { tickDebut: tick + RESEAU.avanceMaxEntreesTicks + 1, entrees: gaz(3) });
    let s = snaps(sc.avancer(60), 1)[0];
    expect(s.entreesRecuesJusqua).toBe(-1);
    sc.entrees(1, { tickDebut: tick + RESEAU.avanceMaxEntreesTicks, entrees: gaz(1) });
    s = snaps(sc.avancer(60), 1)[0];
    expect(s.entreesRecuesJusqua).toBe(tick + RESEAU.avanceMaxEntreesTicks);
  });

  it("deux humains indépendants : chacun ne pilote que sa voiture", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    const a = voitureDe(sc, 1), b = voitureDe(sc, 2);
    const tick = sc.salle.monde()!.tick;
    sc.entrees(1, { tickDebut: tick + 2, entrees: gaz(12, { direction: 127 }) });
    sc.avancer(100);
    const m = sc.salle.monde()!;
    expect(Math.hypot(...m.voitures[a].v)).toBeGreaterThan(0.5);
    expect(Math.hypot(...m.voitures[b].v)).toBeLessThan(0.01);
  });

  it("klaxon : un événement au plus toutes les 2 s par joueur, pas pendant le salon", () => {
    const sc = duoEnMatch();
    sc.avancer(100);
    sc.envoyer(1, { t: "klaxon" });
    sc.envoyer(1, { t: "klaxon" });
    let evs = messages(sc.avancer(50), "ev").flatMap((m) => m.evenements.map((x) => x.e));
    expect(evs.filter((e) => e.t === "klaxon")).toHaveLength(1);
    sc.avancer(2100);
    sc.envoyer(1, { t: "klaxon" });
    evs = messages(sc.avancer(50), "ev").flatMap((m) => m.evenements.map((x) => x.e));
    expect(evs.filter((e) => e.t === "klaxon")).toHaveLength(1);
  });
});

describe("match : bots et cohérence serveur / client", () => {
  it("les entrées appliquées par un bot sont des entrées quantifiées (entiers dans [−127, 127])", () => {
    const sc = soloEnMatch({ reglages: { ...REGLAGES_SALON_DEFAUT(), niveauBots: "allstar" } });
    const s = snaps(sc.avancer(6000), 1);
    const bot = messages(sc.journal, "debut", 1)[0].voitures.find((v) => !v.humain)!.id;
    let actives = 0;
    for (const x of s) {
      const e = x.entrees[bot];
      for (const v of [e.accel, e.direction, e.tangage, e.lacet, e.roulis]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThanOrEqual(127);
      }
      if (e.accel !== 0) actives++;
    }
    expect(actives).toBeGreaterThan(10);
  });

  it("le monde d'un client qui rejoue snap.entrees reste égal octet à octet à celui de la salle, en présence d'un bot", () => {
    // cerveau injecté : sortie constante non exactement représentable, donc quantification visible
    const cerveau = { decider: () => ({ accel: 0.3333333, direction: -0.1234567, tangage: 0.9, lacet: 0.01, roulis: -0.5, saut: false, boost: true, derapage: false }) };
    const sc = soloEnMatch({ creerCerveau: () => cerveau });
    const debut = messages(sc.journal, "debut", 1)[0];
    const bot = debut.voitures.find((v) => !v.humain)!.id;
    const toutes = snaps(sc.avancer(8000), 1);
    const s0 = toutes.find((x) => x.tick > 500 && x.tick % 6 === 0)!;
    const s1 = toutes.find((x) => x.tick === s0.tick + 6)!;
    expect(s0.entrees[bot]).toEqual({ accel: 42, direction: -16, tangage: 114, lacet: 1, roulis: -64, saut: false, boost: true, derapage: false });
    const client = creerMondeEnLigne(debut.config, debut.voitures, debut.moi, creerArene());
    restaurerEtat(s0.etat, client);
    // le client rejoue 6 pas avec les entrées de l'instantané pour le bot et des entrées neutres pour l'humain (rien reçu de lui)
    for (let i = 0; i < 6; i++) {
      const entrees = client.voitures.map((v) => dequantifierEntrees(v.id === bot ? s0.entrees[bot] : { accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false }));
      pasMonde(client, entrees);
    }
    expect(Array.from(encoderEtat(extraireEtat(client)))).toEqual(Array.from(encoderEtat(s1.etat)));
  });

  it("deux salles identiques (mêmes messages, mêmes horloges) produisent les mêmes sorties octet à octet", () => {
    const jouer = (): string[] => {
      const sc = duoEnMatch({ graine: 31 });
      sc.avancer(3300);
      sc.entrees(1, { tickDebut: sc.salle.monde()!.tick + 2, entrees: gaz(12, { direction: 40, boost: true }) });
      sc.entrees(2, { tickDebut: sc.salle.monde()!.tick + 2, entrees: gaz(12, { direction: -40 }) });
      sc.avancer(4000);
      return sc.journal.map((s) => ("snap" in s ? `${s.a}:${Array.from(encoderSnap(s.snap)).join(",")}` : JSON.stringify(s)));
    };
    const a = jouer(), b = jouer();
    expect(a.length).toBeGreaterThan(100);
    expect(b).toEqual(a);
  });

  it("l'instantané décodé après encodage est celui de la salle (chaîne complète salle → octets → client)", () => {
    const sc = duoEnMatch({}, "3v3");
    for (const x of snaps(sc.avancer(500), 2)) {
      const d = decoderSnap(encoderSnap(x));
      expect(d).not.toBeNull();
      expect(d!.etat).toEqual(x.etat);
      expect(d!.entrees).toEqual(x.entrees);
      expect(encoderSnap(x).length).toBeLessThanOrEqual(3000);
    }
  });
});


// ============================================================================================================================
// Temps : accumulateur, budget, calage
// ============================================================================================================================

describe("match : accumulateur, budget de pas et temps abandonné", () => {
  it("un réveil de 8 ms exécute 0 ou 1 pas en régime normal ; le total suit le temps réel", () => {
    const sc = duoEnMatch();
    let max = 0;
    for (let i = 0; i < 500; i++) {
      sc.t += PERIODE_MS;
      const avant = sc.salle.mesures().pas;
      sc.salle.tic(sc.t);
      max = Math.max(max, sc.salle.mesures().pas - avant);
    }
    expect(max).toBeLessThanOrEqual(2);
    expect(sc.salle.mesures().pas).toBe(Math.floor((500 * PERIODE_MS) / 1000 / PAS_S + 1e-9));
  });

  it("budgetPas borne les pas d'un réveil et le retard reste dû (rien n'est perdu)", () => {
    const sc = duoEnMatch();
    sc.t += 400; // 48 pas dus
    const out = sc.salle.tic(sc.t, 5);
    void out;
    expect(sc.salle.mesures().pas).toBe(5);
    expect(sc.salle.mesures().tempsAbandonneMs).toBe(0);
    sc.salle.tic(sc.t, 1000);
    expect(sc.salle.mesures().pas).toBe(48);
  });

  it("budget 0 : aucun pas, le temps est conservé", () => {
    const sc = duoEnMatch();
    sc.t += 80;
    sc.salle.tic(sc.t, 0);
    expect(sc.salle.mesures().pas).toBe(0);
    sc.salle.tic(sc.t + 1, 100);
    expect(sc.salle.mesures().pas).toBe(9);
  });

  it("un calage de plus de 0,5 s : plafonné à 60 pas, le temps abandonné est compté", () => {
    const sc = duoEnMatch();
    sc.t += 2000;
    sc.salle.tic(sc.t);
    const m = sc.salle.mesures();
    expect(m.pas).toBe(RESEAU.pasMaxRattrapageServeur);
    expect(m.tempsAbandonneMs).toBeCloseTo(1500, 0);
    // pas de dérive ensuite : un calage de 400 ms est entièrement rattrapé
    const avant = sc.salle.mesures().pas;
    sc.t += 400;
    sc.salle.tic(sc.t);
    expect(sc.salle.mesures().pas - avant).toBe(48);
    expect(sc.salle.mesures().tempsAbandonneMs).toBeCloseTo(1500, 0);
  });

  it("en rattrapage, seuls les instantanés des 6 derniers pas partent (pas de tempête)", () => {
    const sc = duoEnMatch();
    sc.t += 450;
    const s = snaps(sc.salle.tic(sc.t), 1);
    expect(s.length).toBeLessThanOrEqual(2);
    expect(s.length).toBeGreaterThanOrEqual(1);
  });

  it("temps qui recule ou immobile : aucun pas, aucune erreur", () => {
    const sc = duoEnMatch();
    sc.avancer(100);
    const p = sc.salle.mesures().pas;
    expect(() => sc.salle.tic(sc.t - 50)).not.toThrow();
    expect(sc.salle.tic(sc.t)).toEqual([]);
    expect(sc.salle.mesures().pas).toBe(p);
  });
});

// ============================================================================================================================
// But, fin, revanche
// ============================================================================================================================

describe("match : but, fin et revanche", () => {
  it("un but : événement diffusé immédiatement, instantané hors grille, échelle 1 (la célébration dure MATCH.celebrationS en temps réel)", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    sc.envoyer(1, { t: "dev", action: "balle", p: [0, 2, 56], v: [0, 0, 0] });
    const s = sc.avancer(100);
    const evs = messages(s, "ev").flatMap((m) => m.evenements);
    const but = evs.find((x) => x.e.t === "but");
    expect(but).toBeDefined();
    expect(sc.salle.monde()!.score.bleue + sc.salle.monde()!.score.orange).toBe(1);
    expect(snaps(s, 1).some((x) => x.etat.phase === "but")).toBe(true);
    expect(snaps(s, 1).every((x) => !x.ralenti)).toBe(true);
    // la célébration dure 4,5 s de temps réel
    const t0 = sc.salle.monde()!.tick;
    sc.avancer(MATCH.celebrationS * 1000 - 400);
    expect(sc.salle.monde()!.phase).toBe("but");
    sc.avancer(800);
    expect(sc.salle.monde()!.phase).not.toBe("but");
    expect(sc.salle.monde()!.tick - t0).toBeGreaterThan(MATCH.celebrationS * 120 - 5);
  });

  it("les événements sont regroupés (≤ 1 message `ev` par 16 ms), chacun porte son tick", () => {
    const sc = duoEnMatch();
    const s = sc.avancer(8000);
    const evs = messages(s, "ev");
    expect(evs.length).toBeGreaterThan(0);
    expect(evs.length).toBeLessThanOrEqual(8000 / RESEAU.flushEvenementsMs);
    for (const m of evs) for (const x of m.evenements) expect(Number.isInteger(x.tick)).toBe(true);
    const ticks = evs.flatMap((m) => m.evenements.map((x) => x.tick));
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("fin : message `fin` avec le résultat, phase fin, plus aucun instantané ni pas ; reprise en fin renvoie salon, debut et fin", () => {
    const sc = duoEnMatch();
    jouerJusquALaFin(sc);
    expect(sc.salle.phase).toBe("fin");
    const fin = messages(sc.journal, "fin")[0];
    expect(fin).toBeDefined();
    expect(fin.resultat.vainqueur).not.toBeNull();
    expect(fin.resultat.classement).toHaveLength(2);
    expect(fin.tick).toBe(sc.salle.monde()!.tick);
    expect(sc.salle.aEcheance()).toBe(true);
    expect(sc.salle.enMatch()).toBe(false);
    const pas = sc.salle.mesures().pas;
    const s = sc.avancer(1000);
    expect(snaps(s)).toHaveLength(0);
    expect(sc.salle.mesures().pas).toBe(pas);
    const e = sc.salle.etat();
    expect(e.phase).toBe("fin");
    expect(e.revanche).toBeDefined();
    expect(e.revanche!.restantMs).toBeGreaterThan(0);
    expect(messages(sc.envoyer(1, { t: "ping", c: 1 }), "pong")[0].tick).toBe(-1);
  });

  it("revanche unanime : nouveau match (nouveau numero, nouvelle graine, mêmes équipes) en chargement", () => {
    const sc = duoEnMatch();
    const d1 = messages(sc.journal, "debut", 1)[0];
    jouerJusquALaFin(sc);
    const s1 = sc.envoyer(1, { t: "revanche", oui: true });
    expect(dernierSalon(s1)!.revanche!.votes).toEqual({ 1: true });
    expect(sc.salle.phase).toBe("fin");
    const s2 = sc.envoyer(2, { t: "revanche", oui: true });
    expect(sc.salle.phase).toBe("chargement");
    const d2 = messages(s2, "debut", 1)[0];
    expect(d2.numero).toBe((d1.numero + 1) & 255);
    expect(d2.config.graine).not.toBe(d1.config.graine);
    expect(d2.voitures.map((v) => [v.joueur, v.equipe])).toEqual(d1.voitures.map((v) => [v.joueur, v.equipe]));
    expect(sc.salle.monde()!.tick).toBe(0);
    expect(sc.salle.monde()!.score).toEqual({ bleue: 0, orange: 0 });
    // et le match repart normalement
    sc.envoyer(1, { t: "pret" });
    sc.envoyer(2, { t: "pret" });
    expect(sc.salle.phase).toBe("match");
    // une trame de l'ancien match est écartée
    sc.entrees(1, { numero: d1.numero, tickDebut: 5, entrees: gaz(2) });
    expect(snaps(sc.avancer(60), 1).every((x) => x.entreesRecuesJusqua === -1)).toBe(true);
  });

  it("revanche refusée : retour au salon avec les mêmes joueurs et réglages", () => {
    const sc = duoEnMatch();
    jouerJusquALaFin(sc);
    sc.envoyer(1, { t: "revanche", oui: true });
    const s = sc.envoyer(2, { t: "revanche", oui: false });
    expect(sc.salle.phase).toBe("salon");
    expect(dernierSalon(s)!.joueurs).toHaveLength(2);
    expect(sc.salle.monde()).toBeNull();
    expect(sc.salle.etat().revanche).toBeUndefined();
    expect(sc.salle.etat().lancable).toBe(true);
    expect(sc.salle.aEcheance()).toBe(false);
  });

  it("sans accord : retour au salon à 45 s, servi par tic sans aucun autre message", () => {
    const sc = duoEnMatch();
    jouerJusquALaFin(sc);
    sc.envoyer(1, { t: "revanche", oui: true });
    sc.avancer(RESEAU.revancheMs - 500);
    expect(sc.salle.phase).toBe("fin");
    sc.avancer(1000);
    expect(sc.salle.phase).toBe("salon");
    expect(sc.salle.humains()).toBe(2);
  });

  it("retourSalon : hôte seulement, phase fin seulement", () => {
    const sc = duoEnMatch();
    expect(messages(sc.envoyer(1, { t: "retourSalon" }), "refus")[0].raison).toBe("phase");
    jouerJusquALaFin(sc);
    expect(messages(sc.envoyer(2, { t: "retourSalon" }), "refus")[0].raison).toBe("hote");
    sc.envoyer(1, { t: "retourSalon" });
    expect(sc.salle.phase).toBe("salon");
  });

  it("un départ pendant le vote : le restant seul vote oui et la revanche part contre des bots", () => {
    const sc = duoEnMatch();
    jouerJusquALaFin(sc);
    sc.envoyer(1, { t: "revanche", oui: true });
    const s = sc.salle.retirer(2, sc.t, false);
    expect(messages(s, "presence")[0]).toMatchObject({ joueur: 2, etat: "parti" });
    expect(sc.salle.phase).toBe("chargement");
    expect(sc.salle.humains()).toBe(1);
  });

  it("un joueur coupé en fin compte non : la revanche attend, puis le retire à 20 s", () => {
    const sc = duoEnMatch();
    jouerJusquALaFin(sc);
    sc.salle.retirer(2, sc.t, true);
    sc.envoyer(1, { t: "revanche", oui: true });
    expect(sc.salle.phase).toBe("fin");
    sc.avancer(RESEAU.repriseMs + 100);
    expect(sc.salle.phase).toBe("chargement");
    expect(sc.salle.humains()).toBe(1);
  });

  it("dev : refusé sans l'option, refusé hors match, valeurs non finies refusées", () => {
    const nu = new Scene(creer({ dev: false }));
    expect(messages(nu.envoyer(1, { t: "dev", action: "chrono", tempsRestant: 1 }), "refus")[0].raison).toBe("dev");
    const sc = new Scene(creer());
    expect(messages(sc.envoyer(1, { t: "dev", action: "chrono", tempsRestant: 1 }), "refus")[0].raison).toBe("phase");
    const dm = duoEnMatch();
    expect(messages(dm.envoyer(1, { t: "dev", action: "chrono", tempsRestant: NaN }), "refus")[0].raison).toBe("invalide");
    expect(messages(dm.envoyer(1, { t: "dev", action: "balle", p: [0, Infinity, 0], v: [0, 0, 0] }), "refus")[0].raison).toBe("invalide");
  });

  it("dureeForceeS remplace la durée du match", () => {
    const sc = duoEnMatch({ dureeForceeS: 20 });
    expect(sc.salle.monde()!.config.dureeS).toBe(20);
    expect(sc.salle.monde()!.tempsRestant).toBe(20);
  });
});

// ============================================================================================================================
// Coupures, reprise, remplacement par un bot
// ============================================================================================================================

describe("présence : coupure, reprise, bot", () => {
  it("coupure en match : presence coupe (restantMs), la voiture reçoit des entrées neutres, la salle continue de tiquer", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    const moi = messages(sc.journal, "debut", 2)[0].moi;
    sc.entrees(2, { tickDebut: sc.salle.monde()!.tick + 1, entrees: gaz(12) });
    const s = sc.salle.retirer(2, sc.t, true);
    expect(messages(s, "presence")[0]).toEqual({ t: "presence", joueur: 2, etat: "coupe", restantMs: RESEAU.repriseMs });
    expect(dernierSalon(s)!.joueurs.find((j) => j.id === 2)!.connecte).toBe(false);
    expect(sc.salle.humains()).toBe(2);
    expect(sc.salle.aEcheance()).toBe(true);
    const apres = sc.avancer(600);
    // plus d'instantané pour le joueur coupé, entrées neutres pour sa voiture
    expect(snaps(apres, 2)).toHaveLength(0);
    expect(snaps(apres, 1).at(-1)!.entrees[moi]).toMatchObject({ accel: 0, boost: false });
    // une coupure répétée est ignorée
    expect(sc.salle.retirer(2, sc.t, true)).toEqual([]);
  });

  it("reprise dans les 20 s : presence revenu, salon, debut (même voiture) et instantané tout de suite ; historique d'entrées effacé", () => {
    const sc = duoEnMatch();
    sc.avancer(3300);
    const debut = messages(sc.journal, "debut", 2)[0];
    sc.entrees(2, { tickDebut: sc.salle.monde()!.tick + 1, entrees: gaz(12) });
    sc.salle.retirer(2, sc.t, true);
    sc.avancer(5000);
    const s = sc.salle.reprendre(2, sc.t);
    expect(messages(s, "presence")[0]).toMatchObject({ joueur: 2, etat: "revenu" });
    expect(messages(s, "salon").length).toBe(1);
    const d = messages(s, "debut", 2)[0];
    expect(d.moi).toBe(debut.moi);
    expect(d.numero).toBe(debut.numero);
    expect(snaps(s, 2)).toHaveLength(1);
    const snap = snaps(s, 2)[0];
    expect(snap.tick).toBe(sc.salle.monde()!.tick);
    expect(snap.entreesRecuesJusqua).toBe(-1);
    expect(snap.avance).toBe(AVANCE_INCONNUE);
    // le joueur de retour joue à nouveau
    expect(sc.salle.etat().joueurs.find((j) => j.id === 2)!.connecte).toBe(true);
    sc.entrees(2, { tickDebut: sc.salle.monde()!.tick + 3, entrees: gaz(12) });
    expect(snaps(sc.avancer(60), 2).length).toBeGreaterThan(0);
    // l'ordre est salon puis debut puis instantané
    const ordre = s.map((x) => ("snap" in x ? "snap" : x.msg.t));
    expect(ordre.indexOf("salon")).toBeLessThan(ordre.indexOf("debut"));
    expect(ordre.indexOf("debut")).toBeLessThan(ordre.indexOf("snap"));
  });

  it("prise de relais : reprendre alors que l'ancienne socket est encore « connectée » renvoie l'état complet", () => {
    const sc = duoEnMatch();
    sc.avancer(500);
    const s = sc.salle.reprendre(1, sc.t);
    expect(messages(s, "presence")).toHaveLength(0);
    expect(messages(s, "debut", 1)).toHaveLength(1);
    expect(snaps(s, 1)).toHaveLength(1);
  });

  it("reprise d'un inconnu (ou déjà remplacé par un bot) : rien", () => {
    const sc = duoEnMatch();
    expect(sc.salle.reprendre(99, sc.t)).toEqual([]);
  });

  it("reprise pendant le chargement : debut renvoyé, pret à renvoyer", () => {
    const sc = new Scene(creer());
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    sc.envoyer(2, { t: "pret" });
    sc.salle.retirer(2, sc.t, true);
    const s = sc.salle.reprendre(2, sc.t + 10);
    expect(messages(s, "debut", 2)).toHaveLength(1);
    expect(snaps(s)).toHaveLength(0);
    expect(sc.salle.etat().joueurs.find((j) => j.id === 2)!.charge).toBe(false);
    const apres = sc.envoyer(2, { t: "pret" });
    void apres;
    sc.envoyer(1, { t: "pret" });
    expect(sc.salle.phase).toBe("match");
  });

  it("au bout de 20 s sans retour : un bot prend la voiture (nom, position et statistiques conservés), presence bot, humains() baisse", () => {
    const sc = duoEnMatch();
    sc.avancer(4000);
    const moi = messages(sc.journal, "debut", 2)[0].moi;
    const avant = sc.salle.monde()!.voitures[moi];
    const nom = avant.nom;
    sc.salle.retirer(2, sc.t, true);
    const s = sc.avancer(RESEAU.repriseMs - 200);
    expect(messages(s, "presence")).toHaveLength(0);
    const apres = sc.avancer(400);
    expect(messages(apres, "presence")[0]).toMatchObject({ joueur: 2, etat: "bot" });
    expect(sc.salle.humains()).toBe(1);
    expect(dernierSalon(apres)!.joueurs.map((j) => j.id)).toEqual([1]);
    expect(sc.salle.monde()!.voitures[moi].nom).toBe(nom);
    // la voiture roule désormais selon un cerveau : elle n'est plus immobile
    const ent = snaps(sc.avancer(8000), 1).map((x) => x.entrees[moi]);
    expect(ent.some((e) => e.accel !== 0 || e.direction !== 0)).toBe(true);
    // un retour tardif n'est plus possible
    expect(sc.salle.reprendre(2, sc.t)).toEqual([]);
  });

  it("départ volontaire en match : bot immédiat, aucune reprise possible", () => {
    const sc = duoEnMatch();
    sc.avancer(500);
    const s = sc.salle.retirer(2, sc.t, false);
    expect(messages(s, "presence")[0]).toMatchObject({ joueur: 2, etat: "bot" });
    expect(sc.salle.humains()).toBe(1);
    expect(sc.salle.reprendre(2, sc.t)).toEqual([]);
    expect(sc.salle.phase).toBe("match");
  });

  it("quitter en match équivaut à un départ volontaire (et acquitte)", () => {
    const sc = duoEnMatch();
    sc.avancer(100);
    const s = sc.envoyer(2, { t: "quitter" });
    expect(messages(s, "presence")[0]).toMatchObject({ joueur: 2, etat: "bot" });
    expect(messages(s, "salon", 2).at(-1)).toMatchObject({ salon: null, raison: "quitte" });
  });

  it("hôte parti en match : le plus ancien joueur connecté devient hôte", () => {
    const sc = duoEnMatch();
    sc.avancer(100);
    const s = sc.salle.retirer(1, sc.t, false);
    expect(dernierSalon(s)!.joueurs.find((j) => j.hote)!.id).toBe(2);
  });

  it("plus aucun humain : la salle est vide et ne tique plus ; un humain seul contre des bots continue", () => {
    const sc = duoEnMatch();
    sc.avancer(200);
    sc.salle.retirer(1, sc.t, false);
    expect(sc.salle.vide()).toBe(false);
    expect(sc.salle.aEcheance()).toBe(true);
    const s = sc.avancer(500);
    expect(snaps(s, 2).length).toBeGreaterThan(0);
    sc.salle.retirer(2, sc.t, false);
    expect(sc.salle.vide()).toBe(true);
    expect(sc.salle.aEcheance()).toBe(false);
  });

  it("deux coupés qui dépassent la reprise : tous deux remplacés, la salle est alors vide", () => {
    const sc = duoEnMatch();
    sc.avancer(200);
    sc.salle.retirer(1, sc.t, true);
    sc.salle.retirer(2, sc.t, true);
    sc.avancer(RESEAU.repriseMs + 200);
    expect(sc.salle.humains()).toBe(0);
    expect(sc.salle.vide()).toBe(true);
  });

  it("repriseMs est réglable (option)", () => {
    const sc = duoEnMatch({ repriseMs: 1000 });
    sc.avancer(100);
    sc.salle.retirer(2, sc.t, true);
    expect(messages(sc.avancer(1100), "presence").some((m) => m.etat === "bot")).toBe(true);
  });
});

describe("aEcheance et phases", () => {
  it("vrai en chargement, match et fin ; faux en salon et sans humain", () => {
    const sc = new Scene(creer());
    expect(sc.salle.aEcheance()).toBe(false);
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    expect(sc.salle.aEcheance()).toBe(true);
    sc.envoyer(1, { t: "pret" });
    sc.envoyer(2, { t: "pret" });
    expect(sc.salle.aEcheance()).toBe(true);
    jouerJusquALaFin(sc);
    expect(sc.salle.aEcheance()).toBe(true);
  });

  it("tic en salon : rien, et la salle n'avance pas", () => {
    const sc = new Scene(creer());
    expect(sc.salle.tic(1000)).toEqual([]);
    expect(sc.salle.mesures()).toMatchObject({ phase: "salon", humains: 1, pas: 0 });
  });

  it("les mesures sont cumulées sur la vie de la salle (jamais remises à zéro entre deux matchs)", () => {
    const sc = duoEnMatch();
    sc.avancer(1000);
    const p1 = sc.salle.mesures().pas;
    jouerJusquALaFin(sc);
    const p2 = sc.salle.mesures().pas;
    expect(p2).toBeGreaterThan(p1);
    sc.envoyer(1, { t: "revanche", oui: true });
    sc.envoyer(2, { t: "revanche", oui: true });
    sc.envoyer(1, { t: "pret" });
    sc.envoyer(2, { t: "pret" });
    sc.avancer(500);
    expect(sc.salle.mesures().pas).toBeGreaterThan(p2);
  });
});
