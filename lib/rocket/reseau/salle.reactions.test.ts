import { describe, expect, it } from "vitest";
import type { Equipe } from "../contrat";
import { ANTI_SPAM, REACTIONS, reactionParId } from "../reactions";
import { creerSalleRocket } from "./salle";
import { extraireEtat } from "./serialisation";
import { REGLAGES_SALON_DEFAUT, RESEAU } from "./protocole";
import type { MessageClient, MessageServeur, OptionsSalleRocket, SalleRocket, SortieSalle } from "./protocole";

/** Réactions rapides côté salle : validation, anti-spam, diffusion (tous / équipe), bots. */

const PERIODE_MS = RESEAU.periodeMinuteurServeurMs;
type Reaction = Extract<MessageServeur, { t: "reaction" }>;
type Refus = Extract<MessageServeur, { t: "refus" }>;

class Scene {
  t = 0;
  readonly journal: SortieSalle[] = [];
  constructor(public salle: SalleRocket) {}
  avancer(ms: number): SortieSalle[] {
    const sorties: SortieSalle[] = [];
    const fin = this.t + ms;
    while (this.t + PERIODE_MS <= fin) { this.t += PERIODE_MS; sorties.push(...this.salle.tic(this.t)); }
    this.journal.push(...sorties);
    return sorties;
  }
  envoyer(id: number, msg: MessageClient): SortieSalle[] {
    const s = this.salle.recevoir(id, msg, this.t);
    this.journal.push(...s);
    return s;
  }
}
function creer(opts: Partial<OptionsSalleRocket> = {}): SalleRocket {
  return creerSalleRocket({ code: "BCDF", hote: { id: 1, nom: "Alice" }, reglages: { ...REGLAGES_SALON_DEFAUT(), niveauBots: "debutant" }, graine: 7, maintenantMs: 0, dev: true, ...opts });
}
const reactions = (s: readonly SortieSalle[], a?: number): { a: number | "tous"; m: Reaction }[] =>
  s.flatMap((x) => ("msg" in x && x.msg.t === "reaction" && (a === undefined || x.a === a) ? [{ a: x.a, m: x.msg }] : []));
const refus = (s: readonly SortieSalle[]): Refus[] => s.flatMap((x) => ("msg" in x && x.msg.t === "refus" ? [x.msg] : []));
const voitureDe = (sc: Scene, joueur: number): number =>
  sc.journal.flatMap((x) => ("msg" in x && x.msg.t === "debut" && x.a === joueur ? [x.msg.moi] : [])).at(-1)!;
const equipeDe = (sc: Scene, id: number): Equipe => sc.salle.etat().joueurs.find((j) => j.id === id)!.equipe;

/** Alice (1) et Bob (2) en match ; `memeEquipe` : en 2v2, dans la même équipe. */
function duo(memeEquipe: boolean): Scene {
  const sc = new Scene(creer());
  if (memeEquipe) sc.envoyer(1, { t: "reglages", reglages: { format: "2v2" } });
  expect(sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0).ok).toBe(true);
  if (memeEquipe) sc.envoyer(2, { t: "equipe", equipe: equipeDe(sc, 1) });
  sc.envoyer(1, { t: "lancer" });
  sc.envoyer(1, { t: "pret" });
  sc.envoyer(2, { t: "pret" });
  expect(sc.salle.phase).toBe("match");
  sc.avancer(100);
  return sc;
}

describe("réaction rapide d'un humain", () => {
  it("une réaction libre est relayée à tous, l'émetteur compris, avec l'id de sa voiture", () => {
    const sc = duo(false);
    const out = sc.envoyer(1, { t: "reaction", id: "tie-un-tigre" });
    const r = reactions(out);
    expect(r.map((x) => x.a).sort()).toEqual([1, 2]);
    for (const x of r) expect(x.m).toEqual({ t: "reaction", voiture: voitureDe(sc, 1), id: "tie-un-tigre" });
  });
  it("une info d'équipe n'est relayée qu'à l'équipe de l'émetteur (l'écho de l'émetteur compris), jamais à l'adversaire", () => {
    const adverses = duo(false);
    expect(reactions(adverses.envoyer(1, { t: "reaction", id: "balle" })).map((x) => x.a)).toEqual([1]);
    const coequipiers = duo(true);
    expect(reactions(coequipiers.envoyer(1, { t: "reaction", id: "balle" })).map((x) => x.a).sort()).toEqual([1, 2]);
  });
  it("chacune des 16 réactions du catalogue passe, avec la bonne portée", () => {
    for (const r of REACTIONS) {
      const sc = duo(false);
      const dest = reactions(sc.envoyer(1, { t: "reaction", id: r.id })).map((x) => x.a).sort();
      expect(dest, r.id).toEqual(r.equipeSeule ? [1] : [1, 2]);
    }
  });
  it("un identifiant inconnu est refusé `invalide`, rien n'est relayé", () => {
    const sc = duo(false);
    const out = sc.envoyer(1, { t: "reaction", id: "inconnue" });
    expect(reactions(out)).toEqual([]);
    expect(refus(out)).toEqual([{ t: "refus", action: "reaction", raison: "invalide" }]);
    expect(refus(sc.envoyer(1, { t: "reaction", id: "constructor" }))[0]?.raison).toBe("invalide");
  });
  it("hors match (salon, chargement) : refusé `phase`", () => {
    const sc = new Scene(creer());
    expect(refus(sc.envoyer(1, { t: "reaction", id: "balle" }))[0]?.raison).toBe("phase");
    sc.salle.rejoindre({ id: 2, nom: "Bob" }, 0);
    sc.envoyer(1, { t: "lancer" });
    expect(sc.salle.phase).toBe("chargement");
    expect(refus(sc.envoyer(1, { t: "reaction", id: "balle" }))[0]?.raison).toBe("phase");
  });
  it("anti-spam serveur : le cinquième message d'affilée est refusé `limite`, puis le chat se rouvre", () => {
    const sc = duo(false);
    for (let i = 0; i < ANTI_SPAM.messages; i++) {
      expect(reactions(sc.envoyer(1, { t: "reaction", id: "rugissement" })).length, `message ${i}`).toBeGreaterThan(0);
      sc.avancer(200);
    }
    const bloque = sc.envoyer(1, { t: "reaction", id: "rugissement" });
    expect(reactions(bloque)).toEqual([]);
    expect(refus(bloque)).toEqual([{ t: "refus", action: "reaction", raison: "limite" }]);
    sc.avancer(ANTI_SPAM.blocageMs - 500);
    expect(refus(sc.envoyer(1, { t: "reaction", id: "rugissement" }))[0]?.raison).toBe("limite");
    sc.avancer(ANTI_SPAM.blocageMs);
    expect(reactions(sc.envoyer(1, { t: "reaction", id: "rugissement" })).length).toBeGreaterThan(0);
  });
  it("le blocage d'un joueur ne gêne pas l'autre", () => {
    const sc = duo(false);
    for (let i = 0; i < 6; i++) sc.envoyer(1, { t: "reaction", id: "rugissement" });
    expect(reactions(sc.envoyer(2, { t: "reaction", id: "trefle" })).length).toBe(2);
  });
  it("un joueur coupé ne reçoit rien, et ne peut rien envoyer qu'il ne soit revenu", () => {
    const sc = duo(false);
    sc.salle.retirer(2, sc.t, true);
    expect(reactions(sc.envoyer(1, { t: "reaction", id: "trefle" })).map((x) => x.a)).toEqual([1]);
  });
  it("un autre match remet l'anti-spam à zéro", () => {
    const sc = duo(false);
    for (let i = 0; i < 6; i++) sc.envoyer(1, { t: "reaction", id: "rugissement" });
    expect(refus(sc.envoyer(1, { t: "reaction", id: "rugissement" }))[0]?.raison).toBe("limite");
    // fin du match puis revanche
    sc.envoyer(1, { t: "dev", action: "chrono", tempsRestant: 0.2 });
    sc.avancer(1500);
    sc.envoyer(1, { t: "dev", action: "balle", p: [0, 2, 56], v: [0, 0, 0] });
    sc.avancer(8000);
    expect(sc.salle.phase).toBe("fin");
    sc.envoyer(1, { t: "revanche", oui: true });
    sc.envoyer(2, { t: "revanche", oui: true });
    sc.envoyer(1, { t: "pret" });
    sc.envoyer(2, { t: "pret" });
    expect(sc.salle.phase).toBe("match");
    expect(reactions(sc.envoyer(1, { t: "reaction", id: "rugissement" })).length).toBeGreaterThan(0);
  });
});

describe("réactions des bots de la salle", () => {
  /** Solo contre un bot : un but forcé au bout de 3,5 s, puis 6 s de jeu. Rend ce que le serveur a envoyé à Alice. */
  function soloBut(graine: number): { sc: Scene; vues: Reaction[] } {
    const sc = new Scene(creer({ humainsMin: 1, graine }));
    sc.envoyer(1, { t: "lancer" });
    sc.envoyer(1, { t: "pret" });
    sc.avancer(3500);
    sc.envoyer(1, { t: "dev", action: "balle", p: [0, 2, 56], v: [0, 0, 0] });
    const sorties = sc.avancer(6000);
    return { sc, vues: reactions(sorties, 1).map((x) => x.m) };
  }
  it("après un but, un bot finit par réagir : réaction du catalogue, voiture du bot, jamais celle d'Alice", () => {
    let total = 0;
    for (let g = 1; g <= 40; g++) {
      const { sc, vues } = soloBut(g);
      const alice = voitureDe(sc, 1);
      for (const v of vues) {
        total++;
        expect(reactionParId(v.id), v.id).toBeDefined();
        expect(v.voiture).not.toBe(alice);
        expect(sc.salle.monde()!.voitures[v.voiture].humain).toBe(false);
      }
    }
    expect(total).toBeGreaterThan(5);
  });
  it("les infos d'équipe d'un bot adverse ne sont jamais envoyées à Alice", () => {
    for (let g = 1; g <= 40; g++) {
      const { sc, vues } = soloBut(g);
      const equipeAlice = equipeDe(sc, 1);
      for (const v of vues) {
        if (reactionParId(v.id)?.equipeSeule) expect(sc.salle.monde()!.voitures[v.voiture].equipe, v.id).toBe(equipeAlice);
      }
    }
  });
  it("la physique ne dépend pas des réactions : même graine, avec ou sans réactions humaines, monde identique à l'octet", () => {
    const jouer = (parler: boolean): string => {
      const sc = new Scene(creer({ humainsMin: 1, graine: 5 }));
      sc.envoyer(1, { t: "lancer" });
      sc.envoyer(1, { t: "pret" });
      for (let k = 0; k < 20; k++) {
        if (parler && k % 3 === 0) sc.envoyer(1, { t: "reaction", id: "trefle" });
        sc.avancer(400);
      }
      return JSON.stringify(extraireEtat(sc.salle.monde()!));
    };
    expect(jouer(true)).toBe(jouer(false));
  });
});
