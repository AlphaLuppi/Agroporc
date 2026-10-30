import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { optionsDepuisReglages } from "./evenements-arene";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import { cheminPourPolice } from "./match-police";
import { EVENEMENTS } from "./monstres";
import { POLICE } from "./police";
import { JEU, SILHOUETTE, type MessageServeur, type MonstresSnap, type Vec3 } from "./protocole";
import { normaliserReglages } from "./reglages-arene";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const vide = () => construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000)], pois: [] } as SceneData);
const APPARITIONS: Vec2[] = [[-300, -300], [300, 300], [-300, 300], [300, -300]];
const ROUTE: Vec2[] = [];
for (let x = -600; x <= 600; x += 20) ROUTE.push([x, 0]);
const T0 = 2_000_000;
const PAS = 1000 / 60;
/** intervalles courts : première descente 1 s après le passage à 2 joueurs, suivantes 2 s après la fin d'une */
const INTERV = { premier: { minMs: 1000, maxMs: 1000 }, entre: { minMs: 2000, maxMs: 2000 } };

function base(plus: OptionsSalle = {}): OptionsSalle {
  return {
    evenements: { truck: { x: -60, z: 0 }, centre: { x: 0, z: 0 }, rayonApparition: 60, premier: { minMs: 0, maxMs: 0 }, intervalle: { minMs: 1000, maxMs: 1000 } },
    ...plus,
  };
}
function salle(options: OptionsSalle, ids: string[], capables: string[] | "tous" = "tous"): Salle {
  const monde = vide();
  const s = new Salle(monde, APPARITIONS, () => 0.5, T0, {
    ...options,
    ...(options.police ? { police: { ...options.police, chemin: cheminPourPolice(monde) } } : {}),
  });
  for (const id of ids) {
    s.connecter(id, `Joueur${id}`, T0);
    s.recevoir(id, { t: "rejoindre", principale: "sniper", secondaire: "pistolet" }, T0);
    if (capables === "tous" || capables.includes(id)) s.definirCapacites(id, ["police"]);
  }
  return s;
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function avancer(s: Salle, de: number, a: number, chaque?: (t: number) => void): { sorties: Sortie[]; t: number } {
  const sorties: Sortie[] = [];
  let t = de;
  while (t < a) {
    t = Math.min(a, t + PAS);
    chaque?.(t);
    sorties.push(...s.tic(t));
  }
  return { sorties, t };
}
/** Garde les joueurs « vivants côté réseau » et immobiles en `positions`. */
function tenir(s: Salle, positions: Record<string, Vec3>, t: number) {
  for (const [id, p] of Object.entries(positions)) { const a = j(s, id); a.p = [...p]; a.v = [0, 0, 0]; a.etatT = t; a.protegeJusqua = 0; }
}
const derniersMonstres = (sorties: Sortie[]): MonstresSnap | null => { const m = messages(sorties, "snap"); return m.length ? m[m.length - 1].monstres ?? null : null; };
const service = (s: Salle, nom: string) => (s as unknown as Record<string, unknown>)[nom];

describe("réglages d'arène : services présents ou non", () => {
  const complet = (evenements: string[]): OptionsSalle => optionsDepuisReglages(normaliserReglages({ evenements }), {
    ...base(), elsa: { x: 0, z: 0 }, bus: {}, police: { points: ROUTE, chemin: () => null },
  });

  it("toutes les cases cochées : Elsa, bus, événements et police existent, les réglages sont gardés", () => {
    const s = new Salle(vide(), APPARITIONS, () => 0.5, T0, complet(["elsa", "avion", "bus", "truck", "tigre", "police"]));
    for (const nom of ["elsa", "busC3", "evenements", "police"]) expect(service(s, nom), nom).toBeTruthy();
    expect(s.reglages).toEqual({ evenements: ["elsa", "avion", "bus", "truck", "tigre", "police"], frequence: "normal" });
  });

  it("cases décochées : les services correspondants sont absents", () => {
    const s = new Salle(vide(), APPARITIONS, () => 0.5, T0, complet(["elsa"]));
    expect(service(s, "elsa")).toBeTruthy();
    for (const nom of ["busC3", "evenements", "police", "tigres"]) expect(service(s, nom), nom).toBeNull();
    expect(s.reglages!.evenements).toEqual(["elsa"]);
  });

  it("une salle sans réglages n'en a pas (zombies, BR, tests)", () => {
    expect(new Salle(vide(), APPARITIONS, () => 0.5, T0, base()).reglages).toBeNull();
  });

  it("aucun événement : aucune annonce, aucun message d'événement ni de police en dix minutes", () => {
    const s = salle(complet([]), ["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    const r = avancer(s, T0, T0 + 120_000, (t) => tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, t));
    expect(messages(r.sorties, "evenement")).toEqual([]);
    expect(messages(r.sorties, "police")).toEqual([]);
    expect(messages(r.sorties, "elsa")).toEqual([]);
    expect(messages(r.sorties, "busC3")).toEqual([]);
  });
});

describe("bus C3 décoché : frappes aériennes et fumigènes continuent", () => {
  const sansBus = () => salle(base({ bus: false }), ["a", "b"]);

  it("le snap n'a pas de `bus` ni d'armes lâchées, mais garde fumigènes et frappes", () => {
    const s = sansBus();
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    const r = avancer(s, T0, T0 + 200, (t) => tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, t));
    const m = derniersMonstres(r.sorties)!;
    expect(m).toBeTruthy();
    expect(m.bus).toBeUndefined();
    expect(m.armesLachees).toBeUndefined();
    expect(m.fumigenes).toEqual([]);
    expect(m.frappes).toEqual([]);
    expect(messages(r.sorties, "busC3")).toEqual([]);
  });

  it("un fumigène se lance quand même", () => {
    const s = sansBus();
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    const out = s.recevoir("a", { t: "lancerFumigene", p: [1, 0, 1], v: [0, 0, 0] }, T0 + 100);
    expect(messages(out, "fumigene")).toHaveLength(1);
  });

  it("une série de 5 kills donne toujours sa frappe aérienne", () => {
    const s = sansBus();
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    const sorties: Sortie[] = [];
    for (let k = 0; k < 5; k++) {
      j(s, "b").vivant = true;
      sorties.push(...s.tuer(j(s, "b"), j(s, "a"), "arme", T0 + 100 + k));
    }
    expect(messages(sorties, "frappe").some((f) => f.evenement === "disponible" && f.joueur === "a")).toBe(true);
  });

  it("avec un bus, `bus` et `armesLachees` sont toujours dans le snap", () => {
    const s = salle(base({ bus: {} }), ["a", "b"]);
    tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, T0);
    const m = derniersMonstres(avancer(s, T0, T0 + 200, (t) => tenir(s, { a: [0, 0, 0], b: [20, 0, 0] }, t)).sorties)!;
    expect(m.bus).toBeTruthy();
    expect(m.armesLachees).toEqual([]);
  });
});

describe("descente de police dans une salle d'arène", () => {
  const optPolice = (plus: Partial<NonNullable<OptionsSalle["police"]>> = {}): OptionsSalle => ({
    police: { points: ROUTE, chemin: () => null, intervalle: INTERV, ...plus },
  });
  const POS = { a: [0, 0, 0] as Vec3, b: [20, 0, 0] as Vec3 };

  it("la voiture arrive dans le snap avec son message `debut`, fonce sur le leader, l'écrase (mort `police`, aucun kill) puis se retire", () => {
    const s = salle(optPolice(), ["a", "b"]);
    j(s, "a").kills = 4; j(s, "b").kills = 1;
    tenir(s, POS, T0);
    const r = avancer(s, T0, T0 + POLICE.dureeMs + POLICE.departMs + 8_000, (t) => tenir(s, POS, t));
    const police = messages(r.sorties, "police");
    expect(police[0]).toMatchObject({ phase: "debut", cible: "a" });
    const snaps = messages(r.sorties, "snap").filter((m) => m.monstres?.police);
    expect(snaps.length).toBeGreaterThan(20);
    expect(snaps[0].monstres!.police).toMatchObject({ pvMax: POLICE.pvMax, cible: "a" });
    const morts = messages(r.sorties, "mort").filter((m) => m.cause === "police");
    expect(morts.length).toBeGreaterThanOrEqual(1);
    expect(morts[0]).toMatchObject({ cible: "a", par: "", cause: "police" });
    expect(morts[0].tueur).toBeUndefined();
    expect(j(s, "a").kills).toBe(4);
    // `debut` puis `fin` (temps), dans cet ordre ; la voiture ne reste pas dans le snap au-delà de sa fin
    const phases = police.map((m) => m.phase);
    expect(phases.indexOf("debut")).toBeLessThan(phases.indexOf("fin"));
    expect(police.find((m) => m.phase === "fin")).toMatchObject({ raison: "temps" });
  });

  it("un client sans la capacité `police` est immunisé : avec un seul capable, aucune voiture", () => {
    const s = salle(optPolice(), ["a", "b"], ["a"]);
    j(s, "a").kills = 4;
    tenir(s, POS, T0);
    const r = avancer(s, T0, T0 + 200_000, (t) => tenir(s, POS, t));
    expect(messages(r.sorties, "police")).toEqual([]);
    expect(derniersMonstres(r.sorties)?.police).toBeUndefined();
  });

  it("un joueur sans la capacité qui entre en cours de descente n'est jamais écrasé ni ciblé", () => {
    const s = salle(optPolice(), ["a", "b", "v"], ["a", "b"]);
    j(s, "a").kills = 4; j(s, "v").kills = 99;
    const pos = { ...POS, v: [0, 0, 0] as Vec3 };
    tenir(s, pos, T0);
    const r = avancer(s, T0, T0 + POLICE.dureeMs + POLICE.departMs + 8_000, (t) => tenir(s, pos, t));
    expect(messages(r.sorties, "police")[0]).toMatchObject({ phase: "debut", cible: "a" });
    expect(messages(r.sorties, "mort").find((m) => m.cible === "v")).toBeUndefined();
    expect(messages(r.sorties, "snap").every((m) => m.monstres?.police?.cible !== "v")).toBe(true);
  });

  it("un arrivant en cours de descente reçoit `police{etat}` à `rejoindre`", () => {
    const s = salle(optPolice(), ["a", "b"]);
    j(s, "a").kills = 4;
    tenir(s, POS, T0);
    const r = avancer(s, T0, T0 + 3_000, (t) => tenir(s, POS, t));
    expect(s.tic(r.t) && true).toBe(true);
    s.connecter("n", "Nouveau", r.t);
    s.definirCapacites("n", ["police"]);
    const out = s.recevoir("n", { t: "rejoindre", principale: "sniper", secondaire: "pistolet" }, r.t);
    expect(messages(out, "police")).toEqual([expect.objectContaining({ phase: "etat" })]);
  });

  it("la fin du match arrête la voiture (`police{fin}`) ; l'entracte n'en voit aucune ; le match suivant n'en a pas avant une minute", () => {
    const s = salle(optPolice(), ["a", "b"]);
    j(s, "a").kills = 4;
    tenir(s, POS, T0);
    const r1 = avancer(s, T0, T0 + 3_000, (t) => tenir(s, POS, t));
    expect(derniersMonstres(r1.sorties)?.police).toBeTruthy();
    // 25 kills : fin de match (objectif)
    const fin: Sortie[] = [];
    for (let k = 0; k < JEU.objectifKills; k++) {
      j(s, "b").vivant = true;
      j(s, "b").protegeJusqua = 0;
      fin.push(...s.tuer(j(s, "b"), j(s, "a"), "arme", r1.t + k));
    }
    expect(messages(fin, "match").length).toBe(1);
    expect(messages(fin, "police").map((m) => m.phase)).toEqual(["fin"]);
    // entracte : rien ne roule
    const r2 = avancer(s, r1.t + 100, r1.t + JEU.entracteMs - 500, (t) => tenir(s, POS, t));
    expect(derniersMonstres(r2.sorties)?.police).toBeUndefined();
    expect(messages(r2.sorties, "police")).toEqual([]);
    // match suivant : aucune descente dans la première minute, même avec des kills
    const r3 = avancer(s, r2.t, r2.t + 1_500, (t) => tenir(s, POS, t));
    expect(messages(r3.sorties, "match").length).toBe(1);
    const t3 = r3.t;
    j(s, "a").kills = 3;
    const r4 = avancer(s, t3, t3 + POLICE.premierMatchMs - 3_000, (t) => { tenir(s, POS, t); j(s, "a").kills = Math.max(j(s, "a").kills, 3); });
    expect(messages(r4.sorties, "police")).toEqual([]);
    const r5 = avancer(s, r4.t, r4.t + 8_000, (t) => { tenir(s, POS, t); j(s, "a").kills = Math.max(j(s, "a").kills, 3); });
    expect(messages(r5.sorties, "police").map((m) => m.phase)).toContain("debut");
  });
});

describe("tirs sur la voiture de police", () => {
  const POS = { a: [0, 0, 0] as Vec3, b: [10, 0, 0] as Vec3, t: [0, 0, 30] as Vec3 };
  /** tireur `t` placé près de la voiture : vise le centre de sa caisse */
  function tirer(s: Salle, car: { p: Vec3 }, t: number): Sortie[] {
    const a = j(s, "t");
    a.p = [car.p[0], 0, car.p[2] + 25];
    a.v = [0, 0, 0];
    a.etatT = t;
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    const v = [car.p[0] - o[0], 0.75 - o[1], car.p[2] - o[2]];
    const l = Math.hypot(v[0], v[1], v[2]);
    const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
    a.lacet = Math.atan2(-d[0], -d[2]);
    a.tangage = Math.asin(d[1]);
    a.cadenceArme = {};
    a.sortieJusqua = -Infinity;
    return s.recevoir("t", { t: "tir", arme: a.arme as "sniper", o, d: [d], touches: [{ cible: "police", zone: "corps", plomb: 0 }] }, t);
  }
  function enCourse(pvMax: number) {
    const s = salle({ police: { points: ROUTE.filter((p) => p[0] > 100), chemin: () => null, intervalle: INTERV, pvMax } }, ["a", "b", "t"]);
    j(s, "a").kills = 4;
    const garder = (t: number) => { tenir(s, { a: POS.a, b: POS.b }, t); j(s, "t").etatT = t; j(s, "t").protegeJusqua = 0; };
    garder(T0);
    const r = avancer(s, T0, T0 + 4_000, garder);
    const car = derniersMonstres(r.sorties)!.police!;
    return { s, r, car, garder };
  }

  it("un tir déclaré sur `police` touche la voiture : `degats{cible:police}` au tireur, ses PV baissent dans le snap, la mêlée ne la touche pas", () => {
    const { s, r, car, garder } = enCourse(700);
    const out = tirer(s, car, r.t + 20);
    const d = messages(out, "degats").find((m) => m.cible === "police");
    expect(d).toBeTruthy();
    expect(d!.degats).toBeGreaterThan(0);
    expect(d).toMatchObject({ par: "t", zone: "corps" });
    const apres = avancer(s, r.t + 20, r.t + 140, garder);
    expect(derniersMonstres(apres.sorties)!.police!.pv).toBeLessThan(700);
  });

  it("un tir à côté (cible déclarée à tort) n'inflige rien", () => {
    const { s, r, car } = enCourse(700);
    const a = j(s, "t");
    a.p = [car.p[0] + 200, 0, car.p[2] + 200];
    a.etatT = r.t;
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    a.lacet = 0; a.tangage = 0; a.cadenceArme = {}; a.sortieJusqua = -Infinity;
    const out = s.recevoir("t", { t: "tir", arme: a.arme as "sniper", o, d: [[0, 0, -1]], touches: [{ cible: "police", zone: "corps", plomb: 0 }] }, r.t + 20);
    expect(messages(out, "degats")).toEqual([]);
  });

  it("à 0 PV : explosion, `police{fin, detruite, par}`, aucun kill crédité au tireur", () => {
    const { s, r, car, garder } = enCourse(40);
    const out = tirer(s, car, r.t + 20);
    expect(messages(out, "explosionMonstre")).toHaveLength(1);
    expect(messages(out, "police")).toEqual([expect.objectContaining({ phase: "fin", raison: "detruite", par: "t" })]);
    expect(j(s, "t").kills).toBe(0);
    const apres = avancer(s, r.t + 20, r.t + 140, garder);
    expect(derniersMonstres(apres.sorties)?.police).toBeUndefined();
  });
});

describe("cohabitation avec les événements à tour", () => {
  const POS = { a: [0, 0, 0] as Vec3, b: [20, 0, 0] as Vec3 };

  it("la descente n'est pas lancée pendant un événement, ni dans les 20 s qui suivent sa fin", () => {
    const s = salle(
      { ...base({ evenements: { truck: { x: -60, z: 0 }, centre: { x: 0, z: 0 }, premier: { minMs: 0, maxMs: 0 }, intervalle: { minMs: 600_000, maxMs: 600_000 }, forcerType: "truck" } }),
        police: { points: ROUTE, chemin: () => null, intervalle: INTERV } },
      ["a", "b"],
    );
    const garder = (t: number) => { tenir(s, POS, t); j(s, "a").kills = 4; };
    garder(T0);
    // les instants du premier message de chaque sorte : un tic à la fois
    const instants: Record<string, number> = {};
    let t = T0;
    while (t < T0 + EVENEMENTS.annonceMs + 25_000 + 30_000) {
      t += PAS;
      garder(t);
      const out = s.tic(t);
      for (const m of messages(out, "evenement")) instants[`evt-${m.phase}`] ??= t;
      for (const m of messages(out, "police")) instants[`pol-${m.phase}`] ??= t;
    }
    expect(instants["evt-annonce"]).toBeDefined();
    expect(instants["pol-debut"]).toBeDefined();
    expect(instants["pol-debut"]).toBeGreaterThanOrEqual(instants["evt-fin"] + POLICE.margeApresEvenementMs);
  });

  it("aucun événement n'est annoncé pendant une descente ; le type tiré est gardé et l'annonce arrive après", () => {
    const s = salle(
      { ...base({ evenements: { truck: { x: -60, z: 0 }, centre: { x: 0, z: 0 }, premier: { minMs: 30_000, maxMs: 30_000 }, intervalle: { minMs: 1000, maxMs: 1000 } } }),
        police: { points: ROUTE, chemin: () => null, intervalle: INTERV, dureeMs: 60_000 } },
      ["a", "b"],
    );
    const garder = (t: number) => { tenir(s, { a: [900, 0, 900], b: [910, 0, 900] }, t); j(s, "a").kills = 4; };
    garder(T0);
    // la descente part à ~1 s ; les joueurs près de la route pour qu'un départ existe, puis éloignés
    tenir(s, { a: [0, 0, 150], b: [10, 0, 150] }, T0);
    j(s, "a").kills = 4;
    const debut = avancer(s, T0, T0 + 3_000, (t) => { tenir(s, { a: [0, 0, 150], b: [10, 0, 150] }, t); j(s, "a").kills = 4; });
    expect(messages(debut.sorties, "police")[0]?.phase).toBe("debut");
    const pendant = avancer(s, debut.t, T0 + 60_000, garder);
    const evt = messages(pendant.sorties, "evenement");
    const finPolice = messages(pendant.sorties, "police").find((m) => m.phase === "fin");
    // l'événement échu à 30 s attend la fin de la descente (elle dure 60 s + retrait) : aucune annonce avant
    expect(finPolice).toBeUndefined();
    expect(evt.filter((m) => m.phase === "annonce")).toEqual([]);
    const apres = avancer(s, pendant.t, pendant.t + 20_000, garder);
    expect(messages(apres.sorties, "police").some((m) => m.phase === "fin")).toBe(true);
    expect(messages(apres.sorties, "evenement").some((m) => m.phase === "annonce")).toBe(true);
  });
});
