import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import type { ContexteSalle, JoueurSalle, ServicePolice, Sortie } from "./match-contexte";
import { cheminPourPolice, creerServicePolice, type OptionsServicePolice } from "./match-police";
import { POLICE, choisirCibleBr } from "./police";
import { reglesArene, type ReglesPolice } from "./police-regles";
import type { CauseMort, MessageServeur, PoliceSnap, Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number, h = 10): Building => ({ h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const mondeAvec = (...b: Building[]) => construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000), ...b], pois: [] } as SceneData);
const vide = mondeAvec();
const PAS = 1000 / 60;
const ROUTE: Vec2[] = [];
for (let x = -600; x <= 600; x += 20) ROUTE.push([x, 0]);

/** Générateur à graine fixe (mulberry32) : aucun hasard global. */
function graine(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function joueur(id: string, p: Vec3, plus: Partial<JoueurSalle> = {}): JoueurSalle {
  return {
    id, pseudo: id, couleur: "#fff", enJeu: true, kills: 0, morts: 0, ping: 0, p: [...p], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0,
    arme: "pistolet", armeSuivante: "pistolet", pv: 100, vivant: true, protegeJusqua: 0, reapparitionT: null, degats: 0, ...plus,
  } as unknown as JoueurSalle;
}

interface Banc {
  svc: ServicePolice; joueurs: Map<string, JoueurSalle>; morts: { cible: string; par: string | null; cause: CauseMort }[];
  etat: { phaseJeu: boolean; sansCapacite: Set<string>; autre: boolean };
  sorties: Sortie[]; snaps: { t: number; s: PoliceSnap }[]; t: number;
  avancer(ms: number, chaque?: (t: number) => void): Sortie[];
}

function banc(opts: Partial<OptionsServicePolice> = {}, o: { monde?: ReturnType<typeof mondeAvec>; alea?: () => number; regles?: (ctx: ContexteSalle) => ReglesPolice } = {}): Banc {
  const joueurs = new Map<string, JoueurSalle>();
  const morts: Banc["morts"] = [];
  const etat = { phaseJeu: true, sansCapacite: new Set<string>(), autre: false };
  const ctx = {
    monde: o.monde ?? vide, alea: o.alea ?? graine(3),
    enPhaseJeu: () => etat.phaseJeu,
    joueur: (id: string) => joueurs.get(id),
    joueursEnJeu: () => [...joueurs.values()].filter((j) => j.enJeu),
    tuer: (cible: JoueurSalle, par: JoueurSalle | null, cause: CauseMort) => { cible.vivant = false; morts.push({ cible: cible.id, par: par?.id ?? null, cause }); return []; },
    supportePolice: (id: string) => !etat.sansCapacite.has(id),
  } as unknown as ContexteSalle;
  const svc = creerServicePolice(ctx, {
    mode: "arene", points: ROUTE, chemin: (_de, vers) => [vers], maintenant: 0,
    intervalle: { premier: { minMs: 1000, maxMs: 1000 }, entre: { minMs: 2000, maxMs: 2000 } },
    regles: (o.regles ?? ((c) => reglesArene(c, () => true, null)))(ctx), autreEvenementEnCours: () => etat.autre,
    ...opts,
  });
  const b: Banc = {
    svc, joueurs, morts, etat, sorties: [], snaps: [], t: 0,
    avancer(ms, chaque) {
      const sorties: Sortie[] = [];
      const fin = b.t + ms;
      while (b.t < fin) {
        b.t = Math.min(fin, b.t + PAS);
        chaque?.(b.t);
        const out = svc.tic(b.t);
        sorties.push(...out);
        const s = svc.snap();
        if (s) b.snaps.push({ t: b.t, s });
      }
      b.sorties.push(...sorties);
      return sorties;
    },
  };
  return b;
}
/** Route côté est seulement : la voiture naît toujours à l'est et arrive en ligne droite vers l'ouest. */
const ROUTE_EST = ROUTE.filter((p) => p[0] > 100);
/** Les joueurs partent loin de la route : la voiture ne les rattrape pas pendant la poursuite. */
const eloigner = (b: Banc) => { for (const j of b.joueurs.values()) j.p = [1500, 0, 1500]; };
/** Ils reviennent près de la route : une nouvelle descente trouve un point de départ. */
const rapprocher = (b: Banc) => { let k = 0; for (const j of b.joueurs.values()) j.p = [k++ * 10, 0, 150]; };
const police = (sorties: Sortie[]) => sorties.filter((x) => x.m.t === "police").map((x) => x.m as Extract<MessageServeur, { t: "police" }>);
const ajouter = (b: Banc, ...js: JoueurSalle[]) => { for (const j of js) b.joueurs.set(j.id, j); };

describe("armement et départ (arène)", () => {
  it("à 2 joueurs capables avec un kill, la descente part au bout du premier délai, sur le leader, après `debut`", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [10, 0, 10], { kills: 1 }));
    const avant = police(b.avancer(900));
    expect(avant).toEqual([]);
    const m = police(b.avancer(400));
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ phase: "debut", cible: "a" });
    expect(m[0].finT - m[0].debutT).toBe(POLICE.dureeMs);
    expect(b.svc.enCours()).toBe(true);
    expect(b.svc.descentes()).toBe(1);
    // la voiture naît à vitesse de croisière, jamais à l'arrêt, loin de tout le monde
    const s = b.svc.snap()!;
    expect(s.v).toBeGreaterThan(5);
    for (const j of b.joueurs.values()) expect(Math.hypot(s.p[0] - j.p[0], s.p[2] - j.p[2])).toBeGreaterThanOrEqual(60);
  });

  it("une salle à un seul joueur capable n'a jamais de descente", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }));
    expect(police(b.avancer(200_000))).toEqual([]);
    expect(b.svc.enCours()).toBe(false);
  });

  it("personne n'a de kill : elle attend `attendreLeaderMs` après l'échéance, puis se rabat sur le plus proche", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0]), joueur("b", [30, 0, 0]));
    // échéance à 1 s ; premier départ possible à 1 s + 60 s
    expect(police(b.avancer(POLICE.attendreLeaderMs + 500))).toEqual([]);
    const m = police(b.avancer(6_000));
    expect(m.map((x) => x.phase)).toEqual(["debut"]);
    expect(["a", "b"]).toContain(m[0].cible);
  });

  it("un premier kill pendant l'attente déclenche la descente sur son auteur", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0]), joueur("b", [30, 0, 0]));
    b.avancer(5_000);
    expect(b.svc.enCours()).toBe(false);
    b.joueurs.get("b")!.kills = 1;
    const m = police(b.avancer(6_000));
    expect(m[0]).toMatchObject({ phase: "debut", cible: "b" });
  });

  it("passage de 1 à 2 joueurs : le minuteur repart d'un `premier` (une salle restée vide ne lâche pas la voiture 45 s plus tard)", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 3 }));
    b.avancer(100_000); // minuteur échu depuis longtemps
    ajouter(b, joueur("b", [20, 0, 0], { kills: 1 }));
    const tAjout = b.t;
    expect(police(b.avancer(900))).toEqual([]);
    expect(police(b.avancer(600))).toHaveLength(1);
    expect(b.t - tAjout).toBeGreaterThanOrEqual(1000);
  });

  it("n'agit pas hors de la phase de jeu (entracte, podium) : ni départ ni écrasement", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [10, 0, 10], { kills: 1 }));
    b.etat.phaseJeu = false;
    expect(b.avancer(30_000)).toEqual([]);
    expect(b.svc.enCours()).toBe(false);
    b.etat.phaseJeu = true;
    expect(police(b.avancer(6_000)).map((x) => x.phase)).toEqual(["debut"]);
  });

  it("échec de départ en arène : trois essais, puis abandon et réarmement à la moitié d'un `entre`", () => {
    const b = banc({ points: [[0, 0]] });
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [10, 0, 10], { kills: 1 }));
    expect(police(b.avancer(40_000))).toEqual([]);
    expect(b.svc.enCours()).toBe(false);
  });
});

describe("poursuite et écrasement", () => {
  it("fonce sur sa cible immobile et l'écrase : mort `police`, aucun kill crédité (tueur null)", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [80, 0, 80], { kills: 1 }));
    b.avancer(2_000);
    b.avancer(POLICE.dureeMs);
    expect(b.morts.find((m) => m.cible === "a")).toEqual({ cible: "a", par: null, cause: "police" });
    expect(b.morts.every((m) => m.cause === "police" && m.par === null)).toBe(true);
    expect(b.joueurs.get("a")!.kills).toBe(5);
  });

  it("n'écrase pas un joueur sous protection d'apparition (la protection est vérifiée par le service : `tuer` l'ignore)", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5, protegeJusqua: 1e12 }), joueur("b", [10, 0, 10], { kills: 1, protegeJusqua: 1e12 }), joueur("c", [90, 0, 90]));
    b.avancer(80_000);
    expect(b.morts.filter((m) => m.cible === "a" || m.cible === "b")).toEqual([]);
  });

  it("un joueur dont le client ne sait pas la dessiner est immunisé, jamais ciblé, même arrivé en cours de descente", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [10, 0, 10], { kills: 1 }));
    b.avancer(2_000);
    expect(b.svc.enCours()).toBe(true);
    // un client v11 en cache entre en plein sur la route de la voiture : il n'est pas écrasé et n'est pas visé
    b.etat.sansCapacite.add("v");
    ajouter(b, joueur("v", [0, 0, 0], { kills: 99 }));
    b.joueurs.get("a")!.p = [500, 0, 500];
    b.joueurs.get("b")!.p = [510, 0, 500];
    b.avancer(POLICE.dureeMs + 500);
    expect(b.morts.find((m) => m.cible === "v")).toBeUndefined();
    expect(b.snaps.every((x) => x.s.cible !== "v")).toBe(true);
  });

  it("sans la capacité, le joueur ne compte pas dans `joueursMin` : un capable et un vieux client ne déclenchent rien", () => {
    const b = banc();
    b.etat.sansCapacite.add("v");
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("v", [10, 0, 10], { kills: 9 }));
    expect(police(b.avancer(150_000))).toEqual([]);
  });

  it("la cible est réévaluée : le leader meurt (ou passe en voiture), la voiture se rabat sur un autre", () => {
    const b = banc({ chemin: (_d, vers) => [vers] });
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [150, 0, 120], { kills: 1 }), joueur("c", [-150, 0, 120], { kills: 0 }));
    b.avancer(3_000);
    expect(b.svc.snap()!.cible).toBe("a");
    b.joueurs.get("a")!.vivant = false;
    b.avancer(POLICE.changementCibleMs + 200);
    expect(b.svc.snap()!.cible).toBe("b");
  });

  it("un leader dans une voiture (non éligible) est remplacé par le meilleur des joueurs à pied", () => {
    const enVoiture = new Set<string>(["a"]);
    const b = banc({}, { regles: (c) => reglesArene(c, (j) => !enVoiture.has(j.id), null) });
    ajouter(b, joueur("a", [0, 0, 0], { kills: 9 }), joueur("b", [40, 0, 40], { kills: 2 }), joueur("c", [-40, 0, 40], { kills: 1 }));
    b.avancer(2_000);
    expect(b.svc.snap()!.cible).toBe("b");
    enVoiture.delete("a");
    b.avancer(POLICE.changementCibleMs + 100);
    expect(b.svc.snap()!.cible).toBe("a");
  });

  it("un joueur sur un toit (pieds à plus de 2,2 m) n'est pas éligible", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 12, 0], { kills: 9 }), joueur("b", [40, 0, 40], { kills: 2 }));
    b.avancer(2_000);
    expect(b.svc.snap()!.cible).toBe("b");
  });

  it("une cible sans chemin (intérieur d'un bâtiment creux) est écartée 10 s ; la suivante est choisie", () => {
    const sansChemin = new Set<string>();
    const cibles: Vec2[] = [];
    const b = banc({ chemin: (_de, vers) => { cibles.push(vers); return sansChemin.has(`${vers[0]}`) ? null : [vers]; } });
    ajouter(b, joueur("a", [0, 0, 0], { kills: 9 }), joueur("b", [40, 0, 40], { kills: 2 }));
    sansChemin.add("0");
    b.avancer(3_000);
    expect(b.svc.snap()!.cible).toBe("b");
    expect(b.svc.snap()!.depart).toBeUndefined();
  });

  it("plus aucun candidat joignable depuis 3 s : la voiture se retire", () => {
    const b = banc({ chemin: () => null });
    ajouter(b, joueur("a", [0, 0, 0], { kills: 9 }), joueur("b", [40, 0, 40], { kills: 2 }));
    b.avancer(2_000);
    expect(b.svc.enCours()).toBe(true);
    b.avancer(POLICE.sansCibleMs + 1_000);
    expect(b.svc.snap()?.depart).toBe(true);
  });

  it("le budget de calcul du serveur refuse (\"attente\") : la voiture garde son chemin et redemande aussitôt", () => {
    let appels = 0, accorde = false;
    const b = banc({ chemin: (_d, vers) => { appels++; return accorde ? [vers] : "attente"; } });
    ajouter(b, joueur("a", [0, 0, 0], { kills: 9 }), joueur("b", [40, 0, 40], { kills: 2 }));
    b.avancer(2_000);
    expect(appels).toBeGreaterThan(3); // redemandé à chaque tic, pas toutes les 1,2 s
    expect(b.svc.enCours()).toBe(true);
    accorde = true;
    const n = appels;
    b.avancer(300);
    expect(appels - n).toBeLessThanOrEqual(2);
  });

  it("bloquée contre un mur, elle passe en marche arrière puis repart", () => {
    // un mur long entre la route et la cible ; le chemin factice vise tout droit
    const mur = mondeAvec(rect(40, -900, 70, 900));
    const b = banc({ points: ROUTE_EST }, { monde: mur });
    ajouter(b, joueur("a", [0, 0, 0], { kills: 9 }), joueur("b", [-300, 0, 0], { kills: 2 }));
    b.avancer(16_000);
    expect(b.snaps.some((x) => x.s.v < -1)).toBe(true);
  });
});

describe("retrait et fin", () => {
  it("à la fin de la poursuite elle se retire sans rien écraser, puis `fin` (temps) et le minuteur repart d'un `entre`", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 150], { kills: 5 }), joueur("b", [10, 0, 150], { kills: 1 }));
    b.avancer(2_000);
    expect(police(b.sorties).map((x) => x.phase)).toEqual(["debut"]);
    eloigner(b); // la cible reste hors d'atteinte : la poursuite dure jusqu'à `dureeMs`
    b.avancer(POLICE.dureeMs);
    expect(b.svc.snap()?.depart).toBe(true);
    // un joueur qui se met en travers pendant le retrait n'est pas écrasé
    const s = b.svc.snap()!;
    ajouter(b, joueur("x", [s.p[0], 0, s.p[2]]));
    b.avancer(300);
    expect(b.morts.find((m) => m.cible === "x")).toBeUndefined();
    const fin = police(b.avancer(POLICE.departMs + 1_500)).find((m) => m.phase === "fin")!;
    expect(fin).toMatchObject({ phase: "fin", raison: "temps" });
    expect(b.svc.snap()).toBeUndefined();
    expect(b.svc.enCours()).toBe(false);
    // la suivante : un `entre` (2 s en essai) plus tard
    rapprocher(b);
    expect(police(b.avancer(1_200))).toEqual([]);
    expect(police(b.avancer(6_000)).map((m) => m.phase)).toContain("debut");
    expect(b.svc.descentes()).toBe(2);
  });

  it("`reinitialiser(t, false)` : une descente en cours finit par `fin`, la cadence est gardée ; `true` : aucune descente dans la première minute", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 150], { kills: 5 }), joueur("b", [10, 0, 150], { kills: 1 }));
    b.avancer(2_000);
    eloigner(b);
    expect(b.svc.enCours()).toBe(true);
    const fin = police(b.svc.reinitialiser(b.t, false));
    expect(fin).toEqual([expect.objectContaining({ phase: "fin", raison: "temps" })]);
    expect(b.svc.enCours()).toBe(false);
    expect(b.svc.snap()).toBeUndefined();
    // sans effet hors descente : rien à terminer
    expect(b.svc.reinitialiser(b.t, false)).toEqual([]);
    // nouveau match : le minuteur est repoussé d'une minute
    rapprocher(b);
    b.svc.reinitialiser(b.t, true);
    const apres = b.t;
    expect(police(b.avancer(POLICE.premierMatchMs - 2_000))).toEqual([]);
    expect(police(b.avancer(10_000)).map((m) => m.phase)).toEqual(["debut"]);
    expect(b.t - apres).toBeGreaterThanOrEqual(POLICE.premierMatchMs - 2_000);
  });

  it("synchro : un arrivant en cours de descente en reçoit l'état, sinon rien", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [10, 0, 10], { kills: 1 }));
    expect(b.svc.synchro("z")).toEqual([]);
    b.avancer(2_000);
    const s = b.svc.synchro("z");
    expect(s).toHaveLength(1);
    expect(s[0].a).toBe("z");
    expect(s[0].m).toMatchObject({ t: "police", phase: "etat", cible: "a" });
  });

  it("liberer(id) : la cible partie est oubliée, la voiture en choisit une autre sans erreur", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [100, 0, 100], { kills: 1 }));
    b.avancer(2_000);
    b.joueurs.delete("a");
    b.svc.liberer("a");
    b.avancer(3_000);
    expect(b.svc.snap()?.cible).toBe("b");
  });
});

describe("exclusivité avec les autres événements (arène)", () => {
  it("ne démarre pas tant qu'un autre événement est en cours, ni dans les 20 s qui suivent sa fin", () => {
    const b = banc();
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [10, 0, 10], { kills: 1 }));
    b.etat.autre = true;
    expect(police(b.avancer(30_000))).toEqual([]);
    b.etat.autre = false;
    expect(police(b.avancer(POLICE.margeApresEvenementMs - 1_000))).toEqual([]);
    expect(police(b.avancer(10_000)).map((m) => m.phase)).toEqual(["debut"]);
  });
});

describe("destruction à coups de feu", () => {
  function pret(extra: Partial<OptionsServicePolice> = {}) {
    const b = banc({ pvMax: 300, ...extra });
    ajouter(b, joueur("a", [0, 0, 150], { kills: 5 }), joueur("b", [10, 0, 150], { kills: 1 }), joueur("t", [0, 0, 140]));
    b.avancer(2_000);
    eloigner(b);
    return b;
  }

  it("`blesser` : dégâts au tireur, fumée à 50 %, feu à 20 %, explosion + `fin` (détruite, par) à 0 PV, aucun kill, aucun souffle", () => {
    const b = pret();
    const tireur = b.joueurs.get("t")!;
    const r1 = b.svc.blesser(tireur, 100, b.t);
    expect(r1).toEqual([{ a: "t", m: expect.objectContaining({ t: "degats", cible: "police", par: "t", degats: 100, pv: 200, zone: "corps" }) }]);
    expect(b.svc.snap()!.etat).toBeUndefined();
    b.svc.blesser(tireur, 60, b.t);
    expect(b.svc.snap()!.etat).toBe("fumee");
    b.svc.blesser(tireur, 100, b.t);
    expect(b.svc.snap()!.etat).toBe("feu");
    const r = b.svc.blesser(tireur, 500, b.t);
    expect(r.map((x) => x.m.t)).toEqual(["degats", "explosionMonstre", "police"]);
    expect(police(r)[0]).toMatchObject({ phase: "fin", raison: "detruite", par: "t" });
    expect(tireur.degats).toBe(300);
    expect(tireur.kills).toBe(0);
    expect(b.svc.enCours()).toBe(false);
    expect(b.svc.snap()).toBeUndefined();
    expect(b.morts).toEqual([]);
    // plus rien à blesser
    expect(b.svc.blesser(tireur, 100, b.t)).toEqual([]);
  });

  it("une descente détruite en annonce une nouvelle plus tard (un `entre`), pas tout de suite", () => {
    const b = pret();
    b.svc.blesser(b.joueurs.get("t")!, 9999, b.t);
    rapprocher(b);
    expect(police(b.avancer(1_500))).toEqual([]);
    expect(police(b.avancer(8_000)).map((m) => m.phase)).toContain("debut");
  });

  it("n'accepte pas de dégâts nuls ni hors phase de jeu", () => {
    const b = pret();
    expect(b.svc.blesser(b.joueurs.get("t")!, 0, b.t)).toEqual([]);
    b.etat.phaseJeu = false;
    expect(b.svc.blesser(b.joueurs.get("t")!, 50, b.t)).toEqual([]);
  });
});

describe("rejeu de latence des tirs sur la voiture", () => {
  /** voiture lancée à pleine vitesse sur la route ; tireur placé de côté, vise le centre de la voiture là où elle était `retardMs` plus tôt */
  function visee(retardMs: number, fenetreMs: number): number | null {
    const b = banc({ points: ROUTE_EST }, {});
    ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [10, 0, 0], { kills: 1 }));
    b.avancer(2_000);
    b.avancer(4_000);
    const s = b.svc.snap()!;
    expect(Math.abs(s.v)).toBeGreaterThan(20);
    const passe = [...b.snaps].reverse().find((x) => b.t - x.t >= retardMs)!.s;
    const o: Vec3 = [s.p[0] - 5, 1, 40];
    const v = [passe.p[0] - o[0], 0.75 - o[1], passe.p[2] - o[2]];
    const l = Math.hypot(v[0], v[1], v[2]);
    return b.svc.toucher(o, [v[0] / l, v[1] / l, v[2] / l], 300, b.t, fenetreMs);
  }

  it("un plomb tiré sur la position d'il y a 200 ms touche (fenêtre de 300 ms) ; il y a 700 ms, non", () => {
    expect(visee(200, 300)).not.toBeNull();
    expect(visee(700, 300)).toBeNull();
  });

  it("une fenêtre plus large (BR : 400 ms) accepte un peu plus de retard ; une fenêtre nulle n'accepte que la position courante", () => {
    expect(visee(350, 400)).not.toBeNull();
    expect(visee(200, 0)).toBeNull();
  });

  it("aucun mur plus proche : un plomb dont le rayon traverse un bâtiment avant la voiture est refusé", () => {
    const course = (monde: ReturnType<typeof mondeAvec>) => {
      const b = banc({ points: ROUTE_EST }, { monde });
      ajouter(b, joueur("a", [0, 0, 0], { kills: 5 }), joueur("b", [10, 0, 0], { kills: 1 }));
      b.avancer(5_000);
      return b;
    };
    const s0 = course(vide).svc.snap()!;
    const [sx, sz] = [s0.p[0], s0.p[2]];
    // un bâtiment entre le tireur (z = 40) et la voiture, au droit de celle-ci
    const b = course(mondeAvec(rect(sx - 4, sz + 15, sx + 4, sz + 25)));
    expect(b.svc.snap()!.p[0]).toBeCloseTo(sx, 1);
    const dir = (o: Vec3): Vec3 => { const v = [sx - o[0], 0.75 - o[1], sz - o[2]]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const derriere: Vec3 = [sx, 1, sz + 40];
    expect(b.svc.toucher(derriere, dir(derriere), 300, b.t, 300)).toBeNull();
    // le même tir depuis un point dégagé touche
    const degage: Vec3 = [sx + 40, 1, sz + 40];
    expect(b.svc.toucher(degage, dir(degage), 300, b.t, 300)).not.toBeNull();
  });

  it("hors descente : rien à toucher", () => {
    const b = banc();
    expect(b.svc.toucher([0, 1, 0], [1, 0, 0], 300, 0, 300)).toBeNull();
  });
});

describe("Battle Royale : armement par le service BR", () => {
  /** règles du BR factices : tout est permis tant que `ok` */
  const ok = { permis: true, atterri: 0 as number | null };
  function brBanc(): Banc {
    return banc({ mode: "br", maintenant: undefined }, {
      regles: (c) => ({
        ecrasable: (j) => j.vivant && c.supportePolice(j.id),
        eligible: (j) => j.vivant && c.supportePolice(j.id),
        choisirCible: (cs, v) => { let m: string | null = null, d = Infinity; for (const x of cs) { const dd = Math.hypot(x.p[0] - v[0], x.p[2] - v[2]); if (dd < d) { d = dd; m = x.id; } } return m; },
        permis: () => ok.permis,
      }),
    });
  }

  it("jamais de descente sans `armer` ; `armer(t)` fixe le premier essai ; `armer(null)` : plus jamais", () => {
    const b = brBanc();
    ajouter(b, joueur("a", [0, 0, 0]), joueur("b", [10, 0, 0]));
    expect(police(b.avancer(100_000))).toEqual([]);
    b.svc.armer(b.t + 3_000);
    expect(police(b.avancer(2_500))).toEqual([]);
    expect(police(b.avancer(1_500)).map((m) => m.phase)).toEqual(["debut"]);
  });

  it("`permis` faux : réessai toutes les `reessaiMs`, sans consommer la descente ; `armer(null)` éteint", () => {
    const b = brBanc();
    ajouter(b, joueur("a", [0, 0, 0]));
    ok.permis = false;
    b.svc.armer(b.t + 500);
    expect(police(b.avancer(20_000))).toEqual([]);
    expect(b.svc.descentes()).toBe(0);
    ok.permis = true;
    expect(police(b.avancer(POLICE.reessaiMs + 500)).map((m) => m.phase)).toEqual(["debut"]);
    b.svc.reinitialiser(b.t, false);
    b.svc.armer(null);
    expect(police(b.avancer(200_000))).toEqual([]);
    expect(b.svc.descentes()).toBe(0);
  });

  it("après sa fin, plus aucune descente tant que le service BR ne réarme pas (la seconde est armée par lui)", () => {
    const b = brBanc();
    ajouter(b, joueur("a", [0, 0, 150]));
    ok.permis = true;
    b.svc.armer(b.t + 100);
    b.avancer(1_000);
    expect(b.svc.enCours()).toBe(true);
    eloigner(b);
    b.avancer(POLICE.dureeMs + POLICE.departMs + 3_000);
    expect(b.svc.enCours()).toBe(false);
    expect(b.svc.descentes()).toBe(1);
    rapprocher(b);
    expect(police(b.avancer(300_000))).toEqual([]);
    b.svc.armer(b.t + 100);
    expect(police(b.avancer(1_000)).map((m) => m.phase)).toEqual(["debut"]);
    expect(b.svc.descentes()).toBe(2);
  });

  it("la cible annoncée est la plus proche du point de départ choisi, pas du centre de la carte", () => {
    ok.permis = true;
    const b = banc({ mode: "br", maintenant: undefined, points: [[160, 0]] }, {
      regles: (c) => ({
        ecrasable: (j) => j.vivant && c.supportePolice(j.id), eligible: (j) => j.vivant && c.supportePolice(j.id),
        choisirCible: (cs, v) => choisirCibleBr(cs, v), permis: () => ok.permis,
      }),
    });
    // « a » est le plus proche du centre de la carte (0, 0), « b » du point de départ (160, 0) : la voiture vise « b » dès l'annonce
    ajouter(b, joueur("a", [0, 0, 30]), joueur("b", [260, 0, 30]));
    b.svc.armer(b.t + 100);
    const debut = police(b.avancer(1_000)).find((m) => m.phase === "debut")!;
    expect(debut.cible).toBe("b");
    expect(b.svc.snap()!.cible).toBe("b");
  });

  it("une cible sans chemin depuis la route est écartée AVANT la course ; la suivante est visée", () => {
    ok.permis = true;
    const sansChemin = new Set(["0"]);
    const b = banc({ mode: "br", maintenant: undefined, points: [[160, 0]], chemin: (_d, vers) => (sansChemin.has(`${vers[0]}`) ? null : [vers]) }, {
      regles: (c) => ({
        ecrasable: (j) => j.vivant && c.supportePolice(j.id), eligible: (j) => j.vivant && c.supportePolice(j.id),
        choisirCible: (cs, v) => choisirCibleBr(cs, v), permis: () => ok.permis,
      }),
    });
    ajouter(b, joueur("a", [0, 0, 30]), joueur("b", [-60, 0, 30]));
    b.svc.armer(b.t + 100);
    const debut = police(b.avancer(1_000)).find((m) => m.phase === "debut")!;
    expect(debut.cible).toBe("b");
  });

  it("aucun joueur joignable : la descente ne démarre pas, ne consomme pas son quota et réessaie", () => {
    ok.permis = true;
    let joignable = false;
    const b = banc({ mode: "br", maintenant: undefined, points: [[160, 0]], chemin: (_d, vers) => (joignable ? [vers] : null) }, {
      regles: (c) => ({
        ecrasable: (j) => j.vivant && c.supportePolice(j.id), eligible: (j) => j.vivant && c.supportePolice(j.id),
        choisirCible: (cs, v) => choisirCibleBr(cs, v), permis: () => ok.permis,
      }),
    });
    ajouter(b, joueur("a", [0, 0, 30]), joueur("b", [-60, 0, 30]));
    b.svc.armer(b.t + 100);
    expect(police(b.avancer(20_000))).toEqual([]);
    expect(b.svc.enCours()).toBe(false);
    expect(b.svc.descentes()).toBe(0);
    joignable = true;
    expect(police(b.avancer(POLICE.reessaiMs + POLICE.inaccessibleMs + 1_000)).map((m) => m.phase)).toEqual(["debut"]);
    expect(b.svc.descentes()).toBe(1);
  });

  it("`reinitialiser` (retour au lobby) arrête la voiture et remet les descentes à zéro", () => {
    const b = brBanc();
    ajouter(b, joueur("a", [0, 0, 150]));
    ok.permis = true;
    b.svc.armer(b.t + 100);
    b.avancer(1_000);
    expect(b.svc.enCours()).toBe(true);
    expect(police(b.svc.reinitialiser(b.t, false)).map((m) => m.phase)).toEqual(["fin"]);
    expect(b.svc.enCours()).toBe(false);
    expect(b.svc.descentes()).toBe(0);
  });
});

describe("cheminPourPolice", () => {
  it("passe par le budget de calcul : refusé ⇒ \"attente\", accordé ⇒ un chemin sur la grille de dégagement", () => {
    let ok = false;
    const ch = cheminPourPolice(vide, () => ok);
    expect(ch([0, 0], [100, 0], 0)).toBe("attente");
    ok = true;
    const r = ch([0, 0], [100, 0], 0);
    expect(Array.isArray(r) && r.length > 0).toBe(true);
  });
});
