import { describe, expect, it } from "vitest";
import { ControleurReplayFin } from "./jeu-replay-fin";
import { REPLAY_FIN } from "./replay-fin";
import type { EtatJoueurSnap, InfoTueur, MessageServeur, VehiculeSnap } from "./protocole";
import { JEU } from "./protocole";

const T0 = 2_000_000;
const PAS = 50;
type Mort = Extract<MessageServeur, { t: "mort" }>;

const etat = (id: string, x: number, extra: Partial<EtatJoueurSnap> = {}): EtatJoueurSnap => ({
  id, p: [x, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0, arme: "pistolet", pv: 100, vivant: true, protege: false, ...extra,
});
/** Alice avance de 1 m/s le long de x, Bob est en 10, Cora en 30. */
const joueursA = (ts: number): EtatJoueurSnap[] => [etat("a", (ts - T0) / 1000), etat("b", 10), etat("c", 30)];
const voitureA = (ts: number): VehiculeSnap[] => [{ id: 1, p: [50 + (ts - T0) / 100, 0, 8], cap: 0, v: 0 }];
const PSEUDOS: Record<string, string> = { a: "Alice", b: "Bob", c: "Cora" };

const INFO: InfoTueur = { id: "a", pseudo: "Alice", couleur: "#f00", p: [0, 0, 0], lacet: 0, tangage: 0, arme: "sniper", pv: 100, bouclier: 0, distance: 95 };
const mort = (ts: number, extra: Partial<Mort> = {}): Mort => ({
  t: "mort", cible: "b", par: "a", arme: "sniper", cause: "arme", zone: "tete", ts, delai: JEU.delaiReapparitionMs, tueur: INFO, ...extra,
});

/** Un match : snaps de T0 à `fin`, une mort aux instants demandés (le message arrive à l'instant de la mort). */
function jouerMatch(rf: ControleurReplayFin, morts: Mort[], fin: number): void {
  let i = 0;
  for (let ts = T0; ts <= fin; ts += PAS) {
    rf.alimenter(ts, joueursA(ts), voitureA(ts));
    while (i < morts.length && morts[i].ts <= ts) rf.surMort(morts[i++]);
  }
}

const nouveau = () => new ControleurReplayFin({ pseudo: (id) => PSEUDOS[id] ?? id });

/** Avance jusqu'à ce que la condition soit vraie (par pas de 50 ms), au plus `maxS` secondes. */
function jusqua(rf: ControleurReplayFin, cond: () => boolean, maxS = 60): number {
  let n = 0;
  while (!cond() && n * PAS < maxS * 1000) { rf.maj(PAS / 1000); n++; }
  return (n * PAS) / 1000;
}

describe("sans élimination", () => {
  it("rien à montrer : aucune phase, l'écran de fin reste le podium", () => {
    const rf = nouveau();
    jouerMatch(rf, [], T0 + 20_000);
    rf.finDeMatch();
    expect(rf.phase()).toBe("");
    expect(rf.disponible()).toBe(false);
    rf.maj(1);
    expect(rf.hud().phase).toBe("");
    expect(rf.camera()).toBeNull();
    expect(rf.joueurs().size).toBe(0);
    expect(rf.evenementsAJouer()).toEqual([]);
  });
});

describe("cycle complet", () => {
  function pret(): ControleurReplayFin {
    const rf = nouveau();
    jouerMatch(rf, [mort(T0 + 10_000), mort(T0 + 40_000, { cible: "c", arme: "couteau", zone: "corps", tueur: { ...INFO, arme: "couteau", distance: 2 } })], T0 + 41_000);
    return rf;
  }

  it("attend la clôture de la dernière fenêtre puis passe en lecture du premier moment", () => {
    const rf = pret();
    rf.finDeMatch();
    expect(rf.phase()).toBe("attente");
    expect(rf.hud().phase).toBe("attente");
    expect(rf.actif()).toBe(false);
    expect(rf.camera()).toBeNull();
    // des snaps arrivent encore pendant l'entracte et ferment la fenêtre du dernier kill
    for (let ts = T0 + 41_050; ts <= T0 + 42_400; ts += PAS) rf.alimenter(ts, joueursA(ts), voitureA(ts));
    rf.maj(0.05);
    expect(rf.phase()).toBe("lecture");
    expect(rf.actif()).toBe(true);
    const h = rf.hud();
    expect(h).toMatchObject({ phase: "lecture", index: 1, total: 2 });
    expect(h.titre).toBe("Tir à 95 m · Alice");
    expect(h.detail).toContain("Alice → Bob");
  });

  it("n'attend pas indéfiniment une fenêtre qui ne se ferme jamais", () => {
    const rf = pret();
    rf.finDeMatch();
    const s = jusqua(rf, () => rf.phase() === "lecture", 10);
    expect(rf.phase()).toBe("lecture");
    expect(s).toBeLessThanOrEqual(REPLAY_FIN.attenteMaxMs / 1000 + 0.2);
  });

  it("rejoue les moments dans l'ordre : joueurs, voitures, caméra et horloge du clip", () => {
    const rf = pret();
    rf.finDeMatch();
    jusqua(rf, () => rf.actif());
    const c = rf.lesMoments()[0];
    // au premier instant : début du clip
    expect(rf.tempsServeur()).toBe(c.debut);
    expect(rf.joueurs().has("a") && rf.joueurs().has("b") && rf.joueurs().has("c")).toBe(true);
    expect(rf.vehicules().has(1)).toBe(true);
    expect(rf.camera()).not.toBeNull();
    expect(rf.acteurs()).toEqual({ tueur: "a", cible: "b" });
    // Alice avance de 1 m/s : à t, elle est en (t − T0)/1000
    rf.maj(2);
    const t = rf.tempsServeur()!;
    expect(t).toBeCloseTo(c.debut + 2000, -1);
    expect(rf.joueurs().get("a")!.p[0]).toBeCloseTo((t - T0) / 1000, 1);
    // la progression et le compteur avancent
    expect(rf.hud().progression).toBeGreaterThan(0.3);
    expect(rf.hud().index).toBe(1);
    // puis le second moment
    jusqua(rf, () => rf.hud().index === 2);
    expect(rf.hud().titre).toBe("Kill au couteau · Alice");
    expect(rf.acteurs().cible).toBe("c");
  });

  it("la pose de la caméra change au fil du moment (orbite), reste près de l'action", () => {
    const rf = pret();
    rf.finDeMatch();
    jusqua(rf, () => rf.actif());
    const a = rf.camera()!;
    rf.maj(3);
    const b = rf.camera()!;
    expect(Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2])).toBeGreaterThan(0.5);
    const bob = rf.joueurs().get("b")!.p;
    expect(Math.hypot(b.pos[0] - bob[0], b.pos[2] - bob[2])).toBeLessThan(25);
  });

  it("à la fin du dernier moment, le replay est « fini » ; « passer » le revoit depuis le début", () => {
    const rf = pret();
    rf.finDeMatch();
    jusqua(rf, () => rf.actif());
    jusqua(rf, () => rf.phase() === "fini");
    expect(rf.phase()).toBe("fini");
    expect(rf.actif()).toBe(false);
    expect(rf.disponible()).toBe(true);
    expect(rf.camera()).toBeNull();
    expect(rf.joueurs().size).toBe(0);
    expect(rf.hud()).toMatchObject({ phase: "fini", total: 2, index: 0 });
    rf.suivant();
    expect(rf.phase()).toBe("lecture");
    expect(rf.hud().index).toBe(1);
  });

  it("« passer » saute au moment suivant, puis finit le replay au dernier", () => {
    const rf = pret();
    rf.finDeMatch();
    jusqua(rf, () => rf.actif());
    rf.suivant();
    expect(rf.hud().index).toBe(2);
    rf.suivant();
    expect(rf.phase()).toBe("fini");
  });

  it("« passer » ne fait rien tant que les fenêtres de fin ne sont pas closes", () => {
    const rf = pret();
    rf.finDeMatch();
    rf.suivant();
    expect(rf.phase()).toBe("attente");
  });

  it("arreter oublie tout (nouveau match) et on peut réenregistrer", () => {
    const rf = pret();
    rf.finDeMatch();
    jusqua(rf, () => rf.actif());
    rf.arreter();
    expect(rf.phase()).toBe("");
    expect(rf.lesMoments()).toHaveLength(0);
    expect(rf.enreg.aDuContenu()).toBe(false);
    jouerMatch(rf, [mort(T0 + 10_000)], T0 + 12_000);
    expect(rf.enreg.aDuContenu()).toBe(true);
  });

  it("n'enregistre plus rien pendant la lecture (les snaps de l'entracte ne gonflent pas la mémoire)", () => {
    const rf = pret();
    rf.finDeMatch();
    jusqua(rf, () => rf.actif());
    const avant = rf.enreg.tailleAnneau();
    for (let ts = T0 + 50_000; ts < T0 + 53_000; ts += PAS) rf.alimenter(ts, joueursA(ts), voitureA(ts));
    rf.surMort(mort(T0 + 52_000));
    expect(rf.enreg.tailleAnneau()).toBe(avant);
  });

  it("une durée de lecture qui tient dans l'entracte (4 moments au plus, attente comprise)", () => {
    const rf = nouveau();
    const morts = Array.from({ length: 8 }, (_, i) => mort(T0 + 10_000 + i * 15_000, { cible: i % 2 ? "c" : "b" }));
    jouerMatch(rf, morts, T0 + 10_000 + 8 * 15_000);
    rf.finDeMatch();
    const attente = jusqua(rf, () => rf.actif());
    const lecture = jusqua(rf, () => rf.phase() === "fini");
    expect(rf.lesMoments().length).toBeLessThanOrEqual(REPLAY_FIN.momentsMax);
    expect((attente + lecture) * 1000).toBeLessThan(JEU.entracteMs);
  });
});

describe("événements rejoués", () => {
  it("chaque tir, coup ou dégât du clip est rendu une seule fois, à son instant", () => {
    const rf = nouveau();
    // le tir part 1 s après le début du clip, les dégâts 3,5 s après
    for (let ts = T0; ts <= T0 + 10_000; ts += PAS) {
      rf.alimenter(ts, joueursA(ts));
      if (ts === T0 + 6000) rf.evenement({ genre: "tir", ts: T0 + 6000, id: "a", arme: "sniper", o: [6, 1.6, 0], d: [[1, 0, 0]] });
      if (ts === T0 + 9500) rf.evenement({ genre: "degats", ts: T0 + 9500, cible: "b", par: "a", degats: 100, pv: 0, zone: "tete" });
    }
    rf.surMort(mort(T0 + 10_000));
    for (let ts = T0 + 10_050; ts <= T0 + 11_400; ts += PAS) rf.alimenter(ts, joueursA(ts));
    rf.finDeMatch();
    jusqua(rf, () => rf.actif());
    const vus: string[] = [];
    let derniereT = -1;
    while (rf.phase() === "lecture" && rf.hud().index === 1) {
      for (const e of rf.evenementsAJouer()) {
        vus.push(e.genre);
        expect(e.ts).toBeLessThanOrEqual(rf.tempsServeur()!);
        expect(e.ts).toBeGreaterThan(derniereT);
        derniereT = e.ts;
      }
      rf.maj(PAS / 1000);
    }
    expect(vus).toEqual(["tir", "degats"]);
  });
});
