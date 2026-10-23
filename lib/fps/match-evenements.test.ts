import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import type { JoueurSalle, Sortie } from "./match-contexte";
import { Salle, type OptionsSalle } from "./match";
import { ECHELLE_TIGRE, EVENEMENTS, TIGRE_ROBOT, TITAN, TRUCK_FOU, oeilTitan, pointLocal } from "./monstres";
import { CIBLE_TIGRE, CIBLE_TITAN, JEU, SILHOUETTE, type MessageServeur, type MonstresSnap, type Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
/** Monde vide : deux bâtiments minuscules très loin fixent les bornes à ±2 km. */
const vide = construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000)], pois: [] } as SceneData);
const POINTS: Vec2[] = [[-300, -300], [300, 300], [-300, 300], [300, -300]];
const T0 = 1_000_000;
const PAS = 1000 / 60;

const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function salle(opts: Partial<NonNullable<OptionsSalle["evenements"]>>, joueurs: string[], principale: "sniper" | "fusil_assaut" = "sniper"): Salle {
  const s = new Salle(vide, POINTS, () => 0.5, T0, {
    evenements: { truck: { x: -60, z: 0 }, centre: { x: 0, z: 0 }, rayonApparition: 60, premier: { minMs: 0, maxMs: 0 }, intervalle: { minMs: 1000, maxMs: 1000 }, ...opts },
  });
  for (const id of joueurs) {
    s.connecter(id, `Joueur${id}`, T0);
    s.recevoir(id, { t: "rejoindre", principale, secondaire: "pistolet" }, T0);
  }
  return s;
}
/** Avance la salle de `de` à `a` (ms) par tics de 60 Hz ; renvoie toutes les sorties et le dernier instant. */
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
function dernierMonstres(sorties: Sortie[]): MonstresSnap | null {
  const snaps = messages(sorties, "snap");
  return snaps.length ? snaps[snaps.length - 1].monstres ?? null : null;
}
/** Garde un joueur « vivant côté réseau » (sinon la salle l'évince au bout de 20 s sans état) et immobile en `p`. */
function tenir(s: Salle, id: string, p: Vec3) {
  const a = j(s, id);
  a.p = [p[0], p[1], p[2]];
  a.v = [0, 0, 0];
}
function rafraichir(s: Salle, ids: string[], t: number) {
  for (const id of ids) j(s, id).etatT = t;
}
/** Tir déclaré sur un point du monstre (centre du corps), regard aligné, arme en main. */
function tirerSur(s: Salle, id: string, cible: string, point: Vec3, t: number): Sortie[] {
  const a = j(s, id);
  const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
  const v = [point[0] - o[0], point[1] - o[1], point[2] - o[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
  a.lacet = Math.atan2(-d[0], -d[2]);
  a.tangage = Math.asin(d[1]);
  return s.recevoir(id, { t: "tir", arme: a.arme as "sniper", o, d: [d], touches: [{ cible, zone: "corps", plomb: 0 }] }, t);
}

describe("cohabitation avec les tigres largués", () => {
  const service = (s: Salle) => (s as unknown as { evenements: { tigreGeantEnCours(): boolean } }).evenements;

  it("le tigre géant attend tant que `tigrePermis` est faux (avion ou tigre sauvage largué), puis est annoncé au plus 5 s après", () => {
    const permis = { ok: false };
    const s = salle({ forcerType: "tigre", tigrePermis: () => permis.ok }, ["a"]);
    tenir(s, "a", [200, 0, 200]);
    const r1 = avancer(s, T0, T0 + 12_000, (t) => rafraichir(s, ["a"], t));
    expect(messages(r1.sorties, "evenement")).toEqual([]);
    expect(service(s).tigreGeantEnCours()).toBe(false);
    permis.ok = true;
    const r2 = avancer(s, r1.t, r1.t + 5_100, (t) => rafraichir(s, ["a"], t));
    expect(messages(r2.sorties, "evenement")).toEqual([expect.objectContaining({ type: "tigre", phase: "annonce" })]);
    expect(service(s).tigreGeantEnCours()).toBe(true);
    const r3 = avancer(s, r2.t, r2.t + EVENEMENTS.annonceMs + 200, (t) => rafraichir(s, ["a"], t));
    expect(messages(r3.sorties, "evenement").map((e) => e.phase)).toEqual(["debut"]);
    expect(service(s).tigreGeantEnCours()).toBe(true);
  });

  it("le Truck Muche fou ne dépend pas des tigres largués", () => {
    const s = salle({ forcerType: "truck", tigrePermis: () => false }, ["a"]);
    tenir(s, "a", [200, 0, 200]);
    const r = avancer(s, T0, T0 + 100, (t) => rafraichir(s, ["a"], t));
    expect(messages(r.sorties, "evenement")).toEqual([expect.objectContaining({ type: "truck", phase: "annonce" })]);
    expect(service(s).tigreGeantEnCours()).toBe(false);
  });
});

describe("événements : minuteur et annonces", () => {
  it("annonce l'événement à tous, le démarre `annonceMs` plus tard, le diffuse dans le snap puis le termine", () => {
    const s = salle({ forcerType: "truck" }, ["a"]);
    tenir(s, "a", [200, 0, 200]);
    const r1 = avancer(s, T0, T0 + 100, (t) => rafraichir(s, ["a"], t));
    const annonce = messages(r1.sorties, "evenement");
    expect(annonce).toHaveLength(1);
    expect(annonce[0]).toMatchObject({ type: "truck", phase: "annonce" });
    expect(annonce[0].debutT).toBeGreaterThan(T0);
    expect(annonce[0].finT - annonce[0].debutT).toBe(TRUCK_FOU.dureeMs);
    const r2 = avancer(s, r1.t, T0 + EVENEMENTS.annonceMs + 200, (t) => rafraichir(s, ["a"], t));
    expect(messages(r2.sorties, "evenement").map((e) => e.phase)).toEqual(["debut"]);
    expect(dernierMonstres(r2.sorties)?.truck).toBeTruthy();
    const r3 = avancer(s, r2.t, T0 + EVENEMENTS.annonceMs + TRUCK_FOU.dureeMs + 500, (t) => { tenir(s, "a", [400, 0, 400]); rafraichir(s, ["a"], t); });
    const fin = messages(r3.sorties, "evenement").find((e) => e.phase === "fin");
    expect(fin).toMatchObject({ type: "truck", raison: "temps" });
    expect(dernierMonstres(r3.sorties)?.truck).toBeUndefined();
  });

  it("alterne Truck et tigre, et n'annonce rien dans une arène vide", () => {
    const s = new Salle(vide, POINTS, () => 0.2, T0, { evenements: { truck: { x: -60, z: 0 }, centre: { x: 0, z: 0 }, premier: { minMs: 0, maxMs: 0 } } });
    expect(messages(avancer(s, T0, T0 + 2000).sorties, "evenement")).toHaveLength(0);
  });

  it("un joueur qui rejoint pendant l'événement en reçoit l'état", () => {
    const s = salle({ forcerType: "tigre" }, ["a"]);
    tenir(s, "a", [300, 0, 300]);
    avancer(s, T0, T0 + EVENEMENTS.annonceMs + 500, (t) => rafraichir(s, ["a"], t));
    s.connecter("b", "Bob", T0 + 5000);
    const r = s.recevoir("b", { t: "rejoindre" }, T0 + 5000);
    expect(messages(r, "evenement")).toEqual([expect.objectContaining({ type: "tigre", phase: "etat" })]);
  });
});

describe("Truck Muche fou", () => {
  it("fonce sur le joueur le plus proche et l'écrase (cause truck_fou, aucun tueur)", () => {
    const s = salle({ forcerType: "truck" }, ["a"]);
    tenir(s, "a", [10, 0, 6]);
    const r = avancer(s, T0, T0 + EVENEMENTS.annonceMs + 12_000, (t) => { if (j(s, "a").vivant) tenir(s, "a", [10, 0, 6]); rafraichir(s, ["a"], t); });
    const morts = messages(r.sorties, "mort");
    expect(morts.length).toBeGreaterThanOrEqual(1);
    expect(morts[0]).toMatchObject({ cible: "a", par: "", cause: "truck_fou" });
  });
});

describe("tigre robot géant et titan tigre", () => {
  it("le tigre écrase les bâtiments sur son passage (message batiments), relevés au match suivant", () => {
    // un bâtiment sur la route du tigre, entre son point d'apparition et le joueur
    const decor = construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000), rect(-6, -6, 6, 6)], pois: [] } as SceneData);
    const s = new Salle(decor, POINTS, () => 0.5, T0, {
      evenements: { truck: { x: -60, z: 0 }, centre: { x: 0, z: 0 }, rayonApparition: 60, premier: { minMs: 0, maxMs: 0 }, forcerType: "tigre", pvTigre: 99_999 },
    });
    s.connecter("a", "A", T0);
    s.recevoir("a", { t: "rejoindre" }, T0);
    const r = avancer(s, T0, T0 + 20_000, (x) => { if (j(s, "a").vivant) tenir(s, "a", [80, 0, 0]); rafraichir(s, ["a"], x); });
    const b = messages(r.sorties, "batiments");
    expect(b.length).toBeGreaterThan(0);
    expect(b[0].complet).toBe(false);
    expect(b.some((x) => x.detruits.includes(2) || x.breches.some((y) => y[0] === 2))).toBe(true);
    // brèche qui grandit sous ses pas, puis effondrement complet
    expect(decor.prismes[2].h).toBe(0);
    expect(b.some((x) => x.detruits.includes(2))).toBe(true);
    expect(b.some((x) => x.breches.some((y) => y[0] === 2))).toBe(true);
  });

  it("saut du tigre : onde de choc annoncée ; au sol on est touché, en l'air on l'esquive", () => {
    const s = salle({ forcerType: "tigre", pvTigre: 99_999, attaqueTigre: "saut", premiereAttaqueMs: 0 }, ["a", "b"]);
    tenir(s, "a", [300, 0, 300]);
    tenir(s, "b", [300, 0, -300]);
    const r0 = avancer(s, T0, T0 + EVENEMENTS.annonceMs + 100, (x) => rafraichir(s, ["a", "b"], x));
    const tg = dernierMonstres(r0.sorties)!.tigre!;
    // a au sol près du tigre, b « en l'air » près aussi : le tigre finit par sauter (attaques tirées au hasard)
    const pres = (dx: number): Vec3 => [tg.p[0] + dx, 0, tg.p[2] + 6];
    let onde: Extract<MessageServeur, { t: "onde" }> | undefined;
    const r = avancer(s, r0.t, r0.t + 2_000, (x) => {
      if (j(s, "a").vivant) { tenir(s, "a", pres(4)); j(s, "a").posture = "sol"; }
      if (j(s, "b").vivant) { tenir(s, "b", pres(-4)); j(s, "b").posture = "air"; j(s, "b").p = [pres(-4)[0], 5, pres(-4)[2]]; }
      rafraichir(s, ["a", "b"], x);
    });
    onde = messages(r.sorties, "onde")[0];
    expect(onde).toBeDefined();
    expect(onde!.rayon).toBe(TIGRE_ROBOT.saut.rayon);
    const degats = messages(r.sorties, "degats").filter((d) => d.par === "");
    expect(degats.find((d) => d.cible === "a")?.degats).toBe(TIGRE_ROBOT.saut.degats);
    // b était en l'air à l'atterrissage du premier saut : épargné par l'onde (le premier dégât de a arrive avant tout dégât de b)
    const iA = degats.findIndex((d) => d.cible === "a"), iB = degats.findIndex((d) => d.cible === "b");
    expect(iB === -1 || iB > iA).toBe(true);
  });

  /** Tigre apparu (PV réduits), `a` à 45 m de lui, hors de portée du coup de patte. */
  function avecTigre(pvTigre = 120, pvTitan?: number) {
    const s = salle({ forcerType: "tigre", pvTigre, pvTitan }, ["a", "b"]);
    tenir(s, "a", [0, 0, 0]);
    tenir(s, "b", [300, 0, -300]);
    const r = avancer(s, T0, T0 + EVENEMENTS.annonceMs + 100, (t) => rafraichir(s, ["a", "b"], t));
    const tigre = dernierMonstres(r.sorties)!.tigre!;
    expect(tigre.pv).toBe(pvTigre);
    return { s, t: r.t, tigre };
  }

  it("encaisse les tirs (degats au tireur avec les PV restants), meurt, et son tueur pilote le titan", () => {
    const { s, t, tigre } = avecTigre(200);
    const centre = pointLocal(tigre.p, tigre.cap, ECHELLE_TIGRE, 0, 0.33, -0.03);
    const r1 = tirerSur(s, "a", CIBLE_TIGRE, centre, t + 2000);
    const dg = messages(r1, "degats");
    expect(dg).toHaveLength(1);
    expect(dg[0]).toMatchObject({ cible: CIBLE_TIGRE, par: "a" });
    // sniper : 95 au corps, ×1,5 à la tête (143) ; les PV restants suivent
    expect(dg[0].degats).toBe(dg[0].zone === "tete" ? 143 : 95);
    expect(dg[0].pv).toBe(200 - dg[0].degats);
    // deuxième tir (cadence du sniper respectée) : le tigre tombe
    let r2: Sortie[] = [];
    let tt = t + 2000;
    while (!messages(r2, "titan").length && tt < t + 20_000) { tt += 1600; r2 = tirerSur(s, "a", CIBLE_TIGRE, centre, tt); }
    expect(messages(r2, "evenement")).toEqual([expect.objectContaining({ type: "tigre", phase: "fin", raison: "vaincu", par: "a" })]);
    expect(messages(r2, "titan")).toEqual([expect.objectContaining({ phase: "debut", pilote: "a" })]);
    expect(messages(r2, "explosionMonstre").length).toBeGreaterThanOrEqual(1);
    // le pilote est marqué dans le snap et invulnérable
    const r3 = avancer(s, tt, tt + 200, (x) => rafraichir(s, ["a", "b"], x));
    const snapA = messages(r3.sorties, "snap").pop()!.j.find((x) => x.id === "a")!;
    expect(snapA.titan).toBe(true);
    expect(s.tuer(j(s, "a"), null, "truck_fou", tt + 300)).toEqual([]);
    // un tir à côté du tigre ne compte pas
    expect(messages(tirerSur(s, "b", CIBLE_TIGRE, [500, 1, 500], tt + 400), "degats")).toHaveLength(0);
  });

  it("un tir déclaré sur le tigre mais qui le manque n'enlève rien", () => {
    const { s, t, tigre } = avecTigre(500);
    const loin: Vec3 = [tigre.p[0] + 40, 4, tigre.p[2] + 40];
    expect(messages(tirerSur(s, "a", CIBLE_TIGRE, loin, t + 2000), "degats")).toHaveLength(0);
  });

  it("titan : pilotage borné en vitesse, canon qui tue, destruction qui rend le pilote à pied", () => {
    const { s, t, tigre } = avecTigre(1, 60);
    const centre = pointLocal(tigre.p, tigre.cap, ECHELLE_TIGRE, 0, 0.33, -0.03);
    const r = tirerSur(s, "a", CIBLE_TIGRE, centre, t + 2000);
    const debut = messages(r, "titan")[0];
    expect(debut.pilote).toBe("a");
    let tt = t + 2000;
    // un pilotage trop rapide est refusé, un pas normal accepté
    const p0 = debut.p;
    s.recevoir("a", { t: "pilotage", seq: 1, p: [p0[0] + 50, 0, p0[2]], cap: 0, lacet: 0, tangage: 0 }, tt + 100);
    expect(j(s, "a").p[0]).toBeCloseTo(p0[0], 1);
    s.recevoir("a", { t: "pilotage", seq: 2, p: [p0[0] + 1, 0, p0[2]], cap: 0, lacet: 0, tangage: 0 }, tt + 200);
    expect(j(s, "a").p[0]).toBeCloseTo(p0[0] + 1, 1);
    tt += 200;
    // canon : b à 25 m devant le titan, regard du pilote dans l'axe
    const titanP: Vec3 = [p0[0] + 1, 0, p0[2]];
    tenir(s, "b", [titanP[0], 0, titanP[2] - 25]);
    j(s, "b").protegeJusqua = 0;
    const o = oeilTitan(titanP);
    const cible: Vec3 = [titanP[0], 1, titanP[2] - 25];
    const v = [cible[0] - o[0], cible[1] - o[1], cible[2] - o[2]];
    const l = Math.hypot(v[0], v[1], v[2]);
    const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
    s.recevoir("a", { t: "pilotage", seq: 3, p: titanP, cap: 0, lacet: Math.atan2(-d[0], -d[2]), tangage: Math.asin(d[1]) }, tt + 10);
    let morts: Extract<MessageServeur, { t: "mort" }>[] = [];
    for (let k = 0; k < 12 && !morts.length; k++) {
      tt += 150;
      morts = messages(s.recevoir("a", { t: "canon", o, d, touches: [{ cible: "b", zone: "corps" }] }, tt), "mort");
    }
    expect(morts[0]).toMatchObject({ cible: "b", par: "a", cause: "titan" });
    // b (réapparu) détruit le titan (60 PV ici)
    const r4 = avancer(s, tt, tt + JEU.delaiReapparitionMs + 500, (x) => { rafraichir(s, ["a", "b"], x); s.recevoir("a", { t: "pilotage", seq: 4 + Math.floor(x), p: titanP, cap: 0, lacet: 0, tangage: 0 }, x); });
    tt = r4.t;
    j(s, "b").protegeJusqua = 0;
    tenir(s, "b", [titanP[0] + 30, 0, titanP[2]]);
    const centreTitan = pointLocal(titanP, 0, TITAN.echelle, 0, 0.33, -0.03);
    let fin: Extract<MessageServeur, { t: "titan" }> | undefined;
    for (let k = 0; k < 6 && !fin; k++) {
      tt += 1600;
      fin = messages(tirerSur(s, "b", CIBLE_TITAN, centreTitan, tt), "titan")[0];
    }
    expect(fin).toMatchObject({ phase: "fin", pilote: "a", raison: "detruit", par: "b" });
    expect(s.tuer(j(s, "a"), null, "truck_fou", tt + 10).length).toBeGreaterThan(0); // de nouveau vulnérable
  });

  it("le pilote qui quitte l'arène éteint le titan", () => {
    const { s, t, tigre } = avecTigre(1);
    const r = tirerSur(s, "a", CIBLE_TIGRE, pointLocal(tigre.p, tigre.cap, ECHELLE_TIGRE, 0, 0.33, -0.03), t + 2000);
    expect(messages(r, "titan")[0].pilote).toBe("a");
    const q = s.recevoir("a", { t: "quitter" }, t + 2500);
    expect(messages(q, "titan")).toEqual([expect.objectContaining({ phase: "fin", raison: "depart" })]);
  });

  it("titan : retomber d'un saut écrase les joueurs au sol autour", () => {
    const { s, t, tigre } = avecTigre(1);
    const r = tirerSur(s, "a", CIBLE_TIGRE, pointLocal(tigre.p, tigre.cap, ECHELLE_TIGRE, 0, 0.33, -0.03), t + 2000);
    const p0 = messages(r, "titan")[0].p;
    let tt = t + 2100;
    tenir(s, "b", [p0[0] + 5, 0, p0[2]]);
    j(s, "b").protegeJusqua = 0;
    // monte à 8 m puis redescend au sol
    let seq = 1;
    for (const y of [3, 6, 8, 6, 3, 0]) {
      tt += 150;
      const sorties = s.recevoir("a", { t: "pilotage", seq: seq++, p: [p0[0], y, p0[2]], cap: 0, lacet: 0, tangage: 0 }, tt);
      if (y === 0) expect(messages(sorties, "mort")[0]).toMatchObject({ cible: "b", par: "a", cause: "titan" });
    }
  });

  it("le coup de patte tue un joueur planté devant le tigre", () => {
    const s = salle({ forcerType: "tigre", pvTigre: 5000 }, ["a"]);
    tenir(s, "a", [0, 0, 0]);
    const r0 = avancer(s, T0, T0 + EVENEMENTS.annonceMs + 100, (t) => rafraichir(s, ["a"], t));
    const tigre = dernierMonstres(r0.sorties)!.tigre!;
    // le joueur se place juste devant le museau
    const devant = pointLocal(tigre.p, tigre.cap, ECHELLE_TIGRE, 0, 0, 0.6);
    const r = avancer(s, r0.t, r0.t + 4000, (t) => { if (j(s, "a").vivant) tenir(s, "a", [devant[0], 0, devant[2]]); rafraichir(s, ["a"], t); });
    expect(messages(r.sorties, "mort")[0]).toMatchObject({ cible: "a", cause: "tigre_robot", par: "" });
    void TIGRE_ROBOT;
  });
});
