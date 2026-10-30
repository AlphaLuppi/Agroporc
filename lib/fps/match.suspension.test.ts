import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import type { ServiceZombies } from "./match-contexte";
import type { OptionsServiceZombies } from "./match-zombies";
import { SILHOUETTE, decoderZombies, type MessageClient, type MessageServeur, type Vec3 } from "./protocole";
import { PASSE_EN_SUSPENSION, type OptionsSuspension } from "./suspension";
import { ACHATS, DEPARTS, FENETRES, construireMondeZombies, etiqueterZones, zoneEn } from "./zombies-carte";
import { ZOMBIES } from "./zombies-vagues";

/**
 * Suspension de la partie de zombies par un joueur (v11) sur une vraie `Salle` : horloge virtuelle, rien ne tourne pendant la pause, liste blanche des
 * messages, refus, levée d'office, arrivées et reprises réseau pendant la suspension, comparaison à une salle témoin jamais suspendue.
 * Les règles de la machine à compte à rebours sont dans suspension.test.ts.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 5_000_000;
const ZONES_SOL = etiqueterZones(construireMondeZombies(scene));
const MIN10 = 600_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function salleZ(zombies: Partial<OptionsServiceZombies>, suspension: Partial<OptionsSuspension>): Salle {
  const options: OptionsSalle = { zombies, suspension };
  return new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, options);
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
const serviceDe = (s: Salle) => (s as unknown as { zombies: ServiceZombies }).zombies;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const types = (s: Sortie[]) => s.map((x) => x.m.t);

/** Partie lancée à T0 par le premier, tous rejoignent. `compteMs: 0` : levée immédiate ; sans plafond de durée ni de pause cumulée. */
function partie(ids: string[], suspension: Partial<OptionsSuspension> = {}, zombies: Partial<OptionsServiceZombies> = {}): Salle {
  const s = salleZ({ pauseMs: 1000, degatsGriffe: 0, total1: 6, ...zombies }, { maxMs: 100_000_000, totalMs: 100_000_000, compteMs: 0, ...suspension });
  ids.forEach((id) => s.connecter(id, `Agent ${id}`, T0));
  s.recevoir(ids[0], { t: "lancerPartie" }, T0);
  ids.forEach((id) => s.recevoir(id, { t: "rejoindre" }, T0));
  return s;
}
/** Avance de `t0` à `t1` (horloge réelle de l'appel) ; garde les joueurs « actifs » (le serveur n'évince pas, mais `etatT` sert aux snaps). */
function avancer(s: Salle, t0: number, t1: number, pas = 50): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) {
    for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
    out.push(...s.tic(t));
  }
  return out;
}
const dernierSnap = (sorties: Sortie[]) => messages(sorties.filter((x) => x.a === "joueurs"), "snap").at(-1);
const zpauses = (sorties: Sortie[]) => messages(sorties, "zpause");

describe("suspension : demande et diffusion", () => {
  it("`pauseZ{true}` : snap final à l'horloge gelée, puis `zpause{actif:true, par, pseudo, maintenant}` à tous", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 3000);
    const sorties = s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3050);
    expect(types(sorties)).toEqual(["snap", "zpause"]);
    expect(zpauses(sorties)[0]).toEqual({ t: "zpause", actif: true, par: "a", pseudo: "Agent a", maintenant: T0 + 3050 });
    expect(sorties.at(-1)!.a).toBe("tous");
    expect(s.suspendue()).toBe(true);
    expect(s.resumeZombies()).toMatchObject({ phase: expect.any(String), suspendue: true });
    // idempotent
    expect(s.recevoir("b", { t: "pauseZ", actif: true }, T0 + 3100)).toEqual([]);
  });

  it("levée par un autre joueur : `zpause{actif:false, maintenant: V}` à tous, l'horloge repart de V", () => {
    const s = partie(["a", "b"]);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3000);
    const sorties = s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 3000 + 120_000);
    expect(zpauses(sorties)).toEqual([{ t: "zpause", actif: false, maintenant: T0 + 3000 }]);
    expect(s.suspendue()).toBe(false);
    // pong à l'horloge virtuelle
    const pong = s.recevoir("b", { t: "ping", t0: 1 }, T0 + 3000 + 120_000 + 1000);
    expect(messages(pong, "pong")[0].maintenant).toBe(T0 + 4000);
    // idempotent
    expect(s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 3000 + 120_000 + 1100)).toEqual([]);
  });

  it("compte à rebours : le jeu reste figé, `zpause` porte `compte`, puis `zpause{actif:false}` à son terme (via tic)", () => {
    const s = partie(["a", "b"], { compteMs: 3000 });
    avancer(s, T0 + 50, T0 + 2000);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 2050);
    const sorties = s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 10_000);
    expect(zpauses(sorties)).toEqual([{ t: "zpause", actif: true, par: "a", pseudo: "Agent a", maintenant: T0 + 2050, compte: 3000 }]);
    expect(s.tic(T0 + 12_900)).toEqual([]);
    expect(s.suspendue()).toBe(true);
    const fin = s.tic(T0 + 13_000);
    expect(zpauses(fin)).toEqual([{ t: "zpause", actif: false, maintenant: T0 + 2050 }]);
    expect(s.suspendue()).toBe(false);
  });

  it("annulation du compte à rebours par un `pauseZ{true}` : retour à la suspension pleine, une seule fois", () => {
    const s = partie(["a", "b", "c"], { compteMs: 3000, cooldownMs: 0 });
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 2000);
    s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 5000);
    const annul = s.recevoir("c", { t: "pauseZ", actif: true }, T0 + 6000);
    expect(zpauses(annul)).toEqual([{ t: "zpause", actif: true, par: "a", pseudo: "Agent a", maintenant: T0 + 2000 }]); // sans `compte`
    s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 7000);
    expect(s.recevoir("c", { t: "pauseZ", actif: true }, T0 + 8000)).toEqual([]); // plus d'annulation
    expect(zpauses(s.tic(T0 + 10_000))).toEqual([{ t: "zpause", actif: false, maintenant: T0 + 2000 }]);
  });
});

describe("suspension : refus", () => {
  it("hors partie (lobby) : `refus{pause, lobby}` ; levée d'une salle non suspendue : sans effet", () => {
    const s = salleZ({}, {});
    s.connecter("a", "Alice", T0);
    expect(s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 10)).toEqual([{ a: "a", m: { t: "refus", action: "pause", raison: "lobby" } }]);
    expect(s.recevoir("a", { t: "pauseZ", actif: false }, T0 + 20)).toEqual([]);
  });

  it("avant la fin du chargement d'un admis : `refus{pause, lobby}`", () => {
    const s = salleZ({ pauseMs: 1000, degatsGriffe: 0 }, {});
    s.connecter("a", "Alice", T0); s.connecter("b", "Bob", T0);
    s.recevoir("a", { t: "lancerPartie" }, T0);
    s.recevoir("a", { t: "rejoindre" }, T0); // Bob est admis mais n'a pas fini de charger
    expect(s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 100)).toEqual([{ a: "a", m: { t: "refus", action: "pause", raison: "lobby" } }]);
    s.recevoir("b", { t: "rejoindre" }, T0 + 200);
    expect(types(s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 300))).toContain("zpause");
  });

  it("joueur non admis (arrivé en cours de partie) : `refus{pause, inconnu}`", () => {
    const s = partie(["a", "b"]);
    s.connecter("c", "Cora", T0 + 100);
    expect(s.recevoir("c", { t: "pauseZ", actif: true }, T0 + 200)).toEqual([{ a: "c", m: { t: "refus", action: "pause", raison: "inconnu" } }]);
    expect(s.suspendue()).toBe(false);
  });

  it("délai entre deux suspensions d'un même joueur (plusieurs humains) : `refus{pause, limite}`", () => {
    const s = partie(["a", "b"]);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 2000);
    s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 3000);
    expect(s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 5000)).toEqual([{ a: "a", m: { t: "refus", action: "pause", raison: "limite" } }]);
    expect(types(s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 20_000))).toContain("zpause");
  });

  it("seul admis : exempté du délai, levée immédiate même avec un compte à rebours configuré", () => {
    const s = partie(["a"], { compteMs: 3000 });
    for (let i = 0; i < 4; i++) {
      const t = T0 + 2000 + i * 100;
      expect(types(s.recevoir("a", { t: "pauseZ", actif: true }, t))).toContain("zpause");
      expect(zpauses(s.recevoir("a", { t: "pauseZ", actif: false }, t + 50))).toEqual([expect.objectContaining({ actif: false })]);
    }
  });

  it("`pauseZ` hors zombies : `refus{pause, lobby}` (arène)", () => {
    const s = new Salle(construireMondeZombies(scene), [[0, 0]], suite(), T0, {});
    s.connecter("a", "Alice", T0);
    expect(s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 10)).toEqual([{ a: "a", m: { t: "refus", action: "pause", raison: "lobby" } }]);
  });
});

describe("suspension : tout est figé", () => {
  it("une salle suspendue 10 minutes est identique à une salle témoin : tigres, états, protections, positions", () => {
    const A = partie(["a", "b"]);
    const W = partie(["a", "b"]);
    const dt = 50;
    avancer(A, T0 + dt, T0 + 7000); avancer(W, T0 + dt, T0 + 7000);
    const avant = dernierSnap(avancer(W, T0 + 7000 + dt, T0 + 7000 + dt));
    expect(decoderZombies(avant!.zombies!).length).toBeGreaterThan(0); // des tigres vivent bel et bien
    avancer(A, T0 + 7000 + dt, T0 + 7000 + dt);
    // suspendue 10 minutes : on tique à l'horloge réelle
    A.recevoir("a", { t: "pauseZ", actif: true }, T0 + 7000 + dt);
    const pendant = avancer(A, T0 + 7000 + 2 * dt, T0 + 7000 + dt + MIN10);
    expect(pendant.filter((x) => x.m.t === "snap" || x.m.t === "zombies" || x.m.t === "zevt")).toEqual([]); // rien n'est émis pendant la pause
    A.recevoir("b", { t: "pauseZ", actif: false }, T0 + 7000 + dt + MIN10);
    // reprise : l'horloge réelle a avancé de 10 min de plus, l'horloge virtuelle de rien
    const decalage = MIN10;
    let sa: Sortie[] = [], sw: Sortie[] = [];
    for (let k = 2; k <= 60; k++) {
      const v = T0 + 7000 + k * dt;
      for (const x of A.joueurs()) x.etatT = v + decalage;
      for (const x of W.joueurs()) x.etatT = v;
      sa = A.tic(v + decalage); sw = W.tic(v);
    }
    const snapA = dernierSnap(sa)!, snapW = dernierSnap(sw)!;
    expect(snapA).toBeDefined();
    expect(JSON.stringify(snapA)).toBe(JSON.stringify(snapW));
    for (const id of ["a", "b"]) {
      expect(j(A, id).p).toEqual(j(W, id).p);
      expect(j(A, id).pv).toBe(j(W, id).pv);
      expect(j(A, id).protegeJusqua).toBe(j(W, id).protegeJusqua);
    }
    expect(JSON.stringify(A.resumeZombies())).toBe(JSON.stringify(W.resumeZombies()));
    expect(A.suspendue()).toBe(false);
  });

  /**
   * Salle de trois joueurs avec, au moment de la suspension : un bonus ramassé (double points, `finT` de l'effet) et un autre au sol, un joueur
   * à terre (`terreFinT`), le Micro-ondes en cuisson, une grenade en vol, le grand secret en cours (pendules remontées). Même salle, même hasard,
   * mêmes appels : deux appels donnent deux salles identiques.
   */
  function monter(): { s: Salle; t: number } {
    const s = partie(["a", "b", "c"], {}, {
      argentDepart: 20_000, courant: true, total1: 400, bonus: ["double", "instakill"], secret: { etape: 5, periodeMidiMs: 20_000 },
    });
    const a = j(s, "a");
    let t = T0 + 50;
    const tuerTout = (): void => {
      // seuls les tigres entrés dans une zone lâchent un bonus (BO1) : on laisse les autres passer leur fenêtre
      for (const z of decoderZombies(serviceDe(s).snap() ?? { r: 0, z: [] })) if (zoneEn(ZONES_SOL, z.x, z.z)) serviceDe(s).blesser(`z${z.id}`, 100_000, a, "tete", t);
    };
    const tic = (): void => { for (const x of s.joueurs()) if (x.enJeu) x.etatT = t; s.tic(t); };
    let ramasse = false;
    for (; t < T0 + 400_000; t += 100) {
      tic();
      const sol = serviceDe(s).etat().bonus[0];
      if (sol && !ramasse) { a.p = [sol.p[0], 0, sol.p[2]]; t += 50; tic(); ramasse = true; continue; }
      if (sol && ramasse) break;
      tuerTout();
    }
    const e0 = serviceDe(s).etat();
    expect(e0.effets.doubleFinT).toBeGreaterThan(t);
    expect(e0.bonus).toHaveLength(1);
    // Micro-ondes (5 000 $), joueur à terre, grenade lancée par « b »
    const pap = ACHATS.find((x) => x.id === "pap")!;
    a.p = [pap.position[0], 0, pap.position[1]];
    t += 100;
    s.recevoir("a", { t: "acheter", id: "pap" }, t);
    expect(serviceDe(s).etat().pap.etat).toBe("cuisson");
    s.infliger(j(s, "c"), 1000, null, "tigre_zombie", "corps", "couteau", t);
    const b = j(s, "b");
    const o: Vec3 = [b.p[0], b.p[1] + SILHOUETTE.oeil, b.p[2]];
    s.recevoir("b", { t: "lancerGrenade", genre: "frag", o, d: [0, 0.2, -0.98] }, t);
    for (let k = 0; k < 5; k++) { t += 100; tic(); }
    expect(serviceDe(s).grenadesEnVol()).toBe(1);
    expect(serviceDe(s).etat().pap.etat).toBe("cuisson");
    expect(serviceDe(s).etat().joueurs.find((x) => x.id === "c")!.etat).toBe("terre");
    return { s, t };
  }

  it("suspendue 10 minutes, la salle reste identique à une salle témoin : effets, bonus, joueur à terre, Micro-ondes, grenade, secret, bilan", () => {
    const A = monter(), W = monter();
    expect(A.t).toBe(W.t);
    const t = A.t;
    expect(JSON.stringify(serviceDe(A.s).etat())).toBe(JSON.stringify(serviceDe(W.s).etat()));
    A.s.recevoir("a", { t: "pauseZ", actif: true }, t);
    avancer(A.s, t + 50, t + MIN10, 1000);
    A.s.recevoir("b", { t: "pauseZ", actif: false }, t + MIN10);
    // juste après la levée : rien n'a bougé, ni les `finT`, ni le secret, ni la grenade
    expect(JSON.stringify(serviceDe(A.s).etat())).toBe(JSON.stringify(serviceDe(W.s).etat()));
    expect(serviceDe(A.s).grenadesEnVol()).toBe(1);
    const dt = 100;
    for (let k = 1; k <= 80; k++) {
      const v = t + k * dt;
      for (const x of A.s.joueurs()) x.etatT = v + MIN10;
      for (const x of W.s.joueurs()) x.etatT = v;
      A.s.tic(v + MIN10); W.s.tic(v);
    }
    const eA = serviceDe(A.s).etat(), eW = serviceDe(W.s).etat();
    expect(eA.effets).toEqual(eW.effets);
    expect(eA.bonus).toEqual(eW.bonus);
    expect(eA.boite).toEqual(eW.boite);
    expect(eA.pap).toEqual(eW.pap);
    expect(eA.pap.etat).toBe("pret"); // la cuisson de 4 s a bien eu lieu, sans les 10 minutes
    expect(eA.secret).toEqual(eW.secret);
    expect(eA.joueurs.find((x) => x.id === "c")).toEqual(eW.joueurs.find((x) => x.id === "c"));
    expect(serviceDe(A.s).grenadesEnVol()).toBe(serviceDe(W.s).grenadesEnVol());
    expect(serviceDe(A.s).grenadesEnVol()).toBe(0); // la mèche (3,5 s) s'est consumée en temps de jeu
    expect(JSON.stringify(eA)).toBe(JSON.stringify(eW));
    // fin de partie : la durée du bilan ne compte pas la pause
    const v = t + 81 * dt;
    for (const [salle, decalage] of [[A.s, MIN10], [W.s, 0]] as const) {
      for (const id of ["a", "b", "c"]) salle.infliger(j(salle, id), 1e6, null, "tigre_zombie", "corps", "couteau", v); // API interne : horloge virtuelle
      for (let k = 0; k < 5; k++) { for (const x of salle.joueurs()) x.etatT = v + decalage + k * 100; salle.tic(v + decalage + k * 100); }
    }
    expect(serviceDe(W.s).etat().bilan).toBeDefined();
    expect(serviceDe(A.s).etat().bilan).toEqual(serviceDe(W.s).etat().bilan);
    expect(serviceDe(A.s).etat().bilan!.dureeMs).toBeLessThan(MIN10);
  });

  it("un joueur qui part pendant la suspension (changement de mode : `deconnecter` de la salle) : même état qu'une salle témoin où il est parti à l'instant gelé", () => {
    const A = partie(["a", "b", "c"]), W = partie(["a", "b", "c"]);
    avancer(A, T0 + 50, T0 + 3000); avancer(W, T0 + 50, T0 + 3000);
    A.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3000);
    const sortiesA = A.deconnecter("c", T0 + 3000 + 20_000); // le départ arrive dix secondes après, salle figée
    const sortiesW = W.deconnecter("c", T0 + 3000);
    expect(types(sortiesA)).toEqual(types(sortiesW));
    expect(A.suspendue()).toBe(true);
    A.recevoir("b", { t: "pauseZ", actif: false }, T0 + 3000 + MIN10);
    for (let k = 1; k <= 40; k++) {
      const v = T0 + 3000 + k * 50;
      for (const x of A.joueurs()) x.etatT = v + MIN10;
      for (const x of W.joueurs()) x.etatT = v;
      A.tic(v + MIN10); W.tic(v);
    }
    expect(A.joueurs().map((x) => x.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(serviceDe(A).etat())).toBe(JSON.stringify(serviceDe(W).etat()));
    expect(JSON.stringify(A.resumeZombies())).toBe(JSON.stringify(W.resumeZombies()));
  });

  it("un `tir`, un `coup`, un `acheter` et un `etat` envoyés pendant la suspension sont jetés", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 3000);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3050);
    const a = j(s, "a");
    const p = [...a.p];
    const seq = a.seq;
    expect(s.recevoir("a", { t: "tir", o: [a.p[0], a.p[1] + 1.6, a.p[2]], d: [[0, 0, -1]], touches: [] } as unknown as MessageClient, T0 + 4000)).toEqual([]);
    expect(s.recevoir("a", { t: "acheter", id: "mur:pompe" }, T0 + 4000)).toEqual([]);
    expect(s.recevoir("a", { t: "etat", seq: seq + 1, p: [p[0] + 3, p[1], p[2]], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, T0 + 4000)).toEqual([]);
    expect(a.p).toEqual(p);
    expect(a.seq).toBe(seq);
  });

  it("parcours exhaustif : un message de chaque type hors liste blanche n'a aucun effet salle suspendue", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 3000);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3050);
    const refus = Object.entries(PASSE_EN_SUSPENSION).filter(([, v]) => !v).map(([t]) => t);
    expect(refus.length).toBeGreaterThan(20);
    const avant = JSON.stringify([s.resumeZombies(), s.joueurs().map((x) => [x.p, x.pv, x.equip, x.main])]);
    for (const t of refus) expect(s.recevoir("a", { t } as unknown as MessageClient, T0 + 9000), t).toEqual([]);
    expect(JSON.stringify([s.resumeZombies(), s.joueurs().map((x) => [x.p, x.pv, x.equip, x.main])])).toBe(avant);
    // la liste blanche, elle, passe : un ping répond avec l'horloge gelée
    expect(messages(s.recevoir("a", { t: "ping", t0: 5 }, T0 + 9000), "pong")[0].maintenant).toBe(T0 + 3050);
  });

  it("le budget de distance repart plein à la levée mais une téléportation reste impossible", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 3000);
    const a = j(s, "a");
    s.recevoir("a", { t: "etat", seq: 1, p: [a.p[0], a.p[1], a.p[2]], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, T0 + 3000);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3050);
    s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 303_050);
    const p = [...a.p];
    s.recevoir("a", { t: "etat", seq: 2, p: [p[0] + 300, p[1], p[2]], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, T0 + 303_100);
    expect(Math.hypot(a.p[0] - p[0], a.p[2] - p[2])).toBeLessThan(25); // au plus le budget d'une seconde, jamais les 300 m
    // un état normal juste après la reprise n'est pas refusé
    const q = [...a.p];
    s.recevoir("a", { t: "etat", seq: 3, p: [q[0] + 1, q[1], q[2]], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, T0 + 303_150);
    expect(a.seq).toBe(3);
  });
});

describe("suspension : maintiens de E (relève, planches) relâchés par le client en suspendant", () => {
  /** Relève : « a » tient E sur « b » à terre (3 s de maintien), la suspension tombe 300 ms plus tard. `arret` : le client relâche pendant la suspension. */
  function releveSuspendue(arret: boolean): { s: Salle; t: number } {
    const s = partie(["a", "b"]);
    const t = T0 + 2000;
    avancer(s, T0 + 50, t - 50);
    const b = j(s, "b");
    s.infliger(b, 1000, null, "tigre_zombie", "corps", "couteau", t);
    j(s, "a").p = [b.p[0] + 1, 0, b.p[2]];
    s.recevoir("a", { t: "reanimer", cible: "b" }, t + 200);
    // la suspension tombe : le client reçoit `zpause{actif:true}` et relâche E (`toutRelacher`), salle déjà suspendue
    s.recevoir("a", { t: "pauseZ", actif: true }, t + 500);
    if (arret) expect(s.recevoir("a", { t: "reanimer", cible: null }, t + 520)).toEqual([]);
    avancer(s, t + 550, t + 550 + MIN10, 5000); // 10 minutes de suspension : le service ne tourne pas
    expect(serviceDe(s).etat().joueurs.find((x) => x.id === "b")!.etat).toBe("terre");
    s.recevoir("b", { t: "pauseZ", actif: false }, t + 550 + MIN10);
    return { s, t: t + 550 + MIN10 };
  }

  it("`reanimer{cible:null}` envoyé pendant la suspension passe : à la levée, personne n'est relevé sans nouveau maintien de E", () => {
    const { s, t } = releveSuspendue(true);
    avancer(s, t + 50, t + ZOMBIES.reanimationS * 1000 + 1000);
    expect(serviceDe(s).etat().joueurs.find((x) => x.id === "b")!.etat).toBe("terre");
  });

  it("témoin : sans ce message d'arrêt, la relève tenue avant la suspension s'achève à la levée (le test ci-dessus est bien sensible)", () => {
    const { s, t } = releveSuspendue(false);
    avancer(s, t + 50, t + ZOMBIES.reanimationS * 1000 + 1000);
    expect(serviceDe(s).etat().joueurs.find((x) => x.id === "b")!.etat).toBe("debout");
  });

  /** Planches : « a » est devant une fenêtre arrachée, E tenue juste avant la suspension. */
  function planchesSuspendues(arret: boolean): { s: Salle; reposees: number } {
    const s = partie(["a"], {}, { total1: 40 });
    const a = j(s, "a");
    const f = FENETRES.find((x) => x.id === "F1")!;
    const i = FENETRES.indexOf(f);
    a.p = [f.dedans[0], 0, f.dedans[1]];
    a.pv = 1e9;
    let t = T0 + 50;
    for (; t < T0 + 180_000 && serviceDe(s).etat().fenetres[i] > 3; t += 50) { a.etatT = t; s.tic(t); }
    expect(serviceDe(s).etat().fenetres[i]).toBeLessThanOrEqual(3);
    a.p = [f.dedans[0], 0, f.dedans[1]];
    s.recevoir("a", { t: "reparer", fenetre: "F1" }, t); // la première planche suit l'appui de 0,2 s
    s.recevoir("a", { t: "pauseZ", actif: true }, t + 50);
    if (arret) expect(s.recevoir("a", { t: "reparer", fenetre: null }, t + 70)).toEqual([]);
    avancer(s, t + 100, t + 100 + MIN10, 5000);
    s.recevoir("a", { t: "pauseZ", actif: false }, t + 100 + MIN10);
    const apres = avancer(s, t + 150 + MIN10, t + 150 + MIN10 + 2_000);
    return { s, reposees: messages(apres, "zevt").filter((m) => m.e.e === "planche" && m.e.fenetre === "F1" && !m.e.arrachee).length };
  }

  it("`reparer{fenetre:null}` envoyé pendant la suspension passe : à la levée, aucune planche n'est reposée sans nouveau maintien de E", () => {
    expect(planchesSuspendues(true).reposees).toBe(0);
  });

  it("témoin : sans ce message d'arrêt, la repose tenue avant la suspension reprend à la levée", () => {
    expect(planchesSuspendues(false).reposees).toBeGreaterThanOrEqual(1);
  });

  it("seuls les ARRÊTS passent : `reanimer` / `reparer` avec une cible ou une fenêtre sont toujours jetés", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 3000);
    s.infliger(j(s, "b"), 1000, null, "tigre_zombie", "corps", "couteau", T0 + 3000);
    j(s, "a").p = [j(s, "b").p[0] + 1, 0, j(s, "b").p[2]];
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3050);
    s.recevoir("a", { t: "reanimer", cible: "b" }, T0 + 3100);
    s.recevoir("a", { t: "reparer", fenetre: "F1" }, T0 + 3100);
    s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 3100 + MIN10);
    avancer(s, T0 + 3200 + MIN10, T0 + 3200 + MIN10 + ZOMBIES.reanimationS * 1000 + 1000);
    expect(serviceDe(s).etat().joueurs.find((x) => x.id === "b")!.etat).toBe("terre");
  });
});

describe("suspension : fin de partie, départs, arrivées, reprise réseau", () => {
  it("levée d'office quand la partie n'est plus en cours (tout le monde quitte) : `zpause{actif:false}` dans les sorties du départ", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 3000);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3050);
    s.recevoir("b", { t: "quitter" }, T0 + 4000);
    expect(s.suspendue()).toBe(true);
    const sorties = s.recevoir("a", { t: "quitter" }, T0 + 5000);
    expect(s.resumeZombies()!.phase).not.toBe("manche");
    expect(s.suspendue()).toBe(false);
    expect(zpauses(sorties).at(-1)).toMatchObject({ actif: false, maintenant: T0 + 3050 });
  });

  it("le suspendeur qui part (déconnexion) : la suspension reste, un autre la lève", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 3000);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3050);
    s.deconnecter("a", T0 + 5000);
    expect(s.suspendue()).toBe(true);
    expect(zpauses(s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 6000))).toEqual([{ t: "zpause", actif: false, maintenant: T0 + 3050 }]);
  });

  it("une connexion pendant la suspension reçoit `bienvenue` (horloge virtuelle) PUIS `zpause{actif:true}` ; salle non suspendue : `zpause{actif:false}`", () => {
    const s = partie(["a", "b"]);
    const libre = s.connecter("c", "Cora", T0 + 500);
    expect(types(libre.filter((x) => x.a === "c"))).toEqual(["bienvenue", "zpause"]);
    expect(zpauses(libre)[0]).toMatchObject({ actif: false });
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3000);
    const sorties = s.connecter("d", "Dora", T0 + 90_000);
    const siens = sorties.filter((x) => x.a === "d");
    expect(siens[0].m).toMatchObject({ t: "bienvenue", maintenant: T0 + 3000 });
    expect(siens.map((x) => x.m.t)).toContain("zpause");
    expect(zpauses(siens)[0]).toMatchObject({ actif: true, par: "a", maintenant: T0 + 3000 });
  });

  it("reprise réseau pendant la suspension : `bienvenue{reprise}`, `zpause{actif:true}` ET un snap ciblé ; après la levée : `zpause{actif:false}`", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 3000);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 3050);
    const pendant = s.reprendre("a", T0 + 60_000);
    expect(types(pendant)).toContain("bienvenue");
    expect(pendant.every((x) => x.a === "a")).toBe(true);
    expect(messages(pendant, "bienvenue")[0]).toMatchObject({ reprise: true, maintenant: T0 + 3050 });
    expect(zpauses(pendant)[0]).toMatchObject({ actif: true, par: "a" });
    const iBienvenue = types(pendant).indexOf("bienvenue"), iZ = types(pendant).indexOf("zpause");
    expect(iZ).toBeGreaterThan(iBienvenue);
    expect(messages(pendant, "snap")).toHaveLength(1);
    // B lève pendant que A est « coupé » : à son retour, A est dégelé
    s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 70_000);
    const apres = s.reprendre("a", T0 + 71_000);
    expect(zpauses(apres)).toEqual([{ t: "zpause", actif: false, maintenant: T0 + 3050 + 1000 }]);
  });

  it("deux parties de suite dans la même salle : la pause cumulée est remise à zéro", () => {
    const s = partie(["a", "b"], { totalMs: 5000, cooldownMs: 0 });
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 2000);
    s.recevoir("b", { t: "pauseZ", actif: false }, T0 + 2000 + 4000);
    s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 2000 + 4100);
    // plafond cumulé de 5 s atteint à 5 s de pause au total : levée forcée par tic
    expect(zpauses(s.tic(T0 + 2000 + 4100 + 2000)).at(-1)).toMatchObject({ actif: false });
    expect(s.recevoir("a", { t: "pauseZ", actif: true }, T0 + 20_000)).toEqual([{ a: "a", m: { t: "refus", action: "pause", raison: "limite" } }]);
    // fin de partie (tous quittent), nouvelle partie : le plafond est remis à zéro
    s.recevoir("a", { t: "quitter" }, T0 + 21_000); s.recevoir("b", { t: "quitter" }, T0 + 21_000);
    s.tic(T0 + 200_000); // le bilan s'efface, retour au lobby
    expect(s.resumeZombies()!.phase).toBe("lobby");
    const T1 = T0 + 210_000;
    s.recevoir("a", { t: "lancerPartie" }, T1);
    s.recevoir("a", { t: "rejoindre" }, T1); s.recevoir("b", { t: "rejoindre" }, T1);
    expect(types(s.recevoir("a", { t: "pauseZ", actif: true }, T1 + 1000))).toContain("zpause");
  });
});
