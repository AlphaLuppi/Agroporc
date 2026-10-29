import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { GRENADES, INTERVALLE_LANCER_MS, INVENTAIRE_GRENADES, type ExplosionGrenade } from "./grenades";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import type { ServiceZombies } from "./match-contexte";
import type { OptionsServiceZombies } from "./match-zombies";
import { SILHOUETTE, decoderZombies, type MessageServeur, type Vec3 } from "./protocole";
import { DEPARTS, construireMondeZombies } from "./zombies-carte";
import { gainKill } from "./zombies-vagues";

/**
 * Intégration des grenades (v8) dans une vraie `Salle` zombies : inventaire de BO1 par manche, validation du lancer (œil, visée, stock,
 * cadence), souffle à l'échéance (kill et points de BO1, lanceur légèrement blessé), tigre à remontoir, écouteurs d'explosion.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 5_000_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
const dernierEtat = (s: Sortie[]) => messages(s, "zombies").at(-1)?.etat;
const stock = (s: Sortie[], id: string) => dernierEtat(s)?.joueurs.find((x) => x.id === id);

function partie(ids: string[], zombies: Partial<OptionsServiceZombies> = {}): Salle {
  const options: OptionsSalle = { zombies: { pauseMs: 1000, degatsGriffe: 0, ...zombies } };
  const s = new Salle(construireMondeZombies(scene), DEPARTS.map((d) => [d[0], d[1]] as [number, number]), suite(), T0, options);
  ids.forEach((id) => s.connecter(id, `Agent ${id}`, T0));
  s.recevoir(ids[0], { t: "lancerPartie" }, T0);
  ids.forEach((id) => s.recevoir(id, { t: "rejoindre" }, T0));
  return s;
}
function avancer(s: Salle, t0: number, t1: number, pas = 50): Sortie[] {
  const out: Sortie[] = [];
  for (let t = t0; t <= t1; t += pas) {
    for (const x of s.joueurs()) if (x.enJeu) x.etatT = t;
    out.push(...s.tic(t));
  }
  return out;
}
function tigresDe(sorties: Sortie[]) {
  const snap = messages(sorties.filter((x) => x.a === "joueurs"), "snap").filter((m) => m.zombies).at(-1);
  return snap ? decoderZombies(snap.zombies!) : [];
}
/** Tourne le regard du joueur vers `point` et renvoie son œil et la direction. */
function regarder(s: Salle, id: string, point: Vec3): { o: Vec3; d: Vec3 } {
  const a = j(s, id);
  const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
  const v = [point[0] - o[0], point[1] - o[1], point[2] - o[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
  a.lacet = Math.atan2(-d[0], -d[2]);
  a.tangage = Math.asin(d[1]);
  return { o, d };
}
/** Lance une grenade vers `point` (le regard suit). */
function lancer(s: Salle, id: string, point: Vec3, t: number, genre: "frag" | "remontoir" = "frag", cuissonMs = 0): Sortie[] {
  const { o, d } = regarder(s, id, point);
  return s.recevoir(id, { t: "lancerGrenade", genre, o, d, cuissonMs }, t);
}
const serviceDe = (s: Salle) => (s as unknown as { zombies: ServiceZombies }).zombies;

describe("inventaire de BO1", () => {
  it("aucune grenade avant la manche 1, 2 au début de la manche 1 ; munitions max : 4", () => {
    const s = partie(["a"]);
    expect(serviceDe(s).etat().joueurs[0].grenades).toBeUndefined();
    avancer(s, T0 + 50, T0 + 1200);
    expect(serviceDe(s).etat()).toMatchObject({ phase: "manche", manche: 1 });
    expect(serviceDe(s).etat().joueurs[0].grenades).toBe(INVENTAIRE_GRENADES.fragParManche);
  });

  it("le tigre à remontoir n'existe qu'en poche (essais : `remontoirsDepart`)", () => {
    const s = partie(["a"], { remontoirsDepart: 1 });
    expect(serviceDe(s).etat().joueurs[0].remontoirs).toBe(1);
  });
});

describe("lancer", () => {
  it("`grenade` à tous les joueurs (lanceur compris) ; stock décompté ; une toutes les 0,5 s ; plus rien sans stock", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 1200);
    const t = T0 + 2000;
    const a = j(s, "a");
    const cible: Vec3 = [a.p[0] + 5, 0, a.p[2] - 5];
    const r1 = lancer(s, "a", cible, t);
    const g = messages(r1, "grenade")[0];
    expect(r1.find((x) => x.m.t === "grenade")!.a).toBe("joueurs");
    expect(g).toMatchObject({ id: 1, par: "a", genre: "frag", t0: t, explosionT: t + GRENADES.frag.mecheMs });
    expect(stock(r1, "a")!.grenades).toBe(1);
    // trop tôt : refusé
    expect(lancer(s, "a", cible, t + INTERVALLE_LANCER_MS - 10)).toEqual([]);
    const r2 = lancer(s, "a", cible, t + INTERVALLE_LANCER_MS, "frag", 1500);
    expect(messages(r2, "grenade")[0]).toMatchObject({ id: 2, explosionT: t + INTERVALLE_LANCER_MS + GRENADES.frag.mecheMs - 1500 });
    expect(stock(r2, "a")!.grenades).toBeUndefined();
    expect(lancer(s, "a", cible, t + 2 * INTERVALLE_LANCER_MS)).toEqual([]);
    expect(serviceDe(s).grenadesEnVol()).toBe(2);
    // sans remontoir : refusé
    expect(lancer(s, "b", cible, t, "remontoir")).toEqual([]);
  });

  it("refusé hors visée (direction opposée au regard), œil trop loin, dans le lobby ou à terre", () => {
    const s = partie(["a", "b"]);
    avancer(s, T0 + 50, T0 + 1200);
    const t = T0 + 2000;
    const a = j(s, "a");
    const { o, d } = regarder(s, "a", [a.p[0], 1, a.p[2] - 10]);
    expect(s.recevoir("a", { t: "lancerGrenade", genre: "frag", o, d: [-d[0], -d[1], -d[2]] }, t)).toEqual([]);
    expect(s.recevoir("a", { t: "lancerGrenade", genre: "frag", o: [o[0] + 8, o[1], o[2]], d }, t)).toEqual([]);
    expect(s.recevoir("a", { t: "lancerGrenade", genre: "frag", o, d: [Number.NaN, 0, 0] }, t)).toEqual([]);
    s.infliger(j(s, "b"), 1000, null, "tigre_zombie", "corps", "couteau", t);
    expect(lancer(s, "b", [0, 0, 0], t + 10)).toEqual([]);
    // l'arène (sans zombies) ignore le message
    const arene = new Salle(construireMondeZombies(scene), DEPARTS.map((x) => [x[0], x[1]] as [number, number]), suite(), T0, {});
    arene.connecter("c", "Cé", T0);
    arene.recevoir("c", { t: "rejoindre" }, T0);
    expect(arene.recevoir("c", { t: "lancerGrenade", genre: "frag", o, d }, T0 + 10)).toEqual([]);
  });
});

describe("souffle", () => {
  it("une grenade cuite aux pieds d'un tigre de la manche 1 le tue : zombieMort (explosion), +60 $ (BO1), lanceur un peu blessé, écouteurs", () => {
    const s = partie(["a"], { total1: 3 });
    const sorties = avancer(s, T0 + 50, T0 + 5000);
    const [z] = tigresDe(sorties.slice(-40));
    expect(z).toBeDefined();
    const a = j(s, "a");
    a.p = [z.x + 1.5, 0, z.z + 4.8];
    a.protegeJusqua = 0;
    const entendues: ExplosionGrenade[] = [];
    const retirer = serviceDe(s).ecouterExplosions((e) => { entendues.push(e); });
    const t = T0 + 5000;
    // grenade quasi cuite, lâchée vers le tigre : elle saute 150 ms plus tard, à ~3 m de lui
    const r = lancer(s, "a", [z.x, 0, z.z], t, "frag", GRENADES.frag.mecheMs - 150);
    const g = messages(r, "grenade")[0];
    expect(g.explosionT).toBe(t + 150);
    const apres = avancer(s, t + 50, t + 400);
    const evt = messages(apres, "zevt").map((m) => m.e).find((e) => e.e === "grenade");
    expect(evt).toMatchObject({ e: "grenade", id: g.id, genre: "frag", par: "a", rayon: GRENADES.frag.rayonM });
    const mort = messages(apres, "zombieMort").find((m) => m.id === `z${z.id}`);
    expect(mort).toMatchObject({ par: "a", cause: "explosion" });
    // (v8, ragdoll) le centre du souffle part avec la mort : le cadavre est projeté depuis la grenade
    expect(mort!.src).toBeDefined();
    expect(Math.hypot(mort!.src![0] - evt!.p[0], mort!.src![2] - evt!.p[2])).toBeLessThan(0.02);
    expect(messages(apres, "argent").filter((m) => m.motif === "kill").map((m) => m.delta)).toContain(gainKill({}));
    expect(a.kills).toBeGreaterThanOrEqual(1);
    // le lanceur (à ~2 m du centre) perd quelques PV, jamais de quoi tomber
    const blessure = messages(apres, "degats").find((m) => m.cible === "a");
    expect(blessure).toBeDefined();
    expect(blessure!.degats).toBeLessThanOrEqual(GRENADES.frag.degatsLanceurMax);
    expect(a.vivant).toBe(true);
    expect(entendues).toHaveLength(1);
    expect(entendues[0]).toMatchObject({ id: g.id, genre: "frag", par: "a", t: g.explosionT });
    expect(serviceDe(s).grenadesEnVol()).toBe(0);
    retirer();
  });

  it("tigre à remontoir : lancé, posé, il saute 8 s plus tard (attraction dans zombies.test.ts) ; le stock tombe à 0", () => {
    const s = partie(["a"], { remontoirsDepart: 1 });
    avancer(s, T0 + 50, T0 + 1200);
    const t = T0 + 2000;
    const a = j(s, "a");
    const r = lancer(s, "a", [a.p[0] + 4, 0, a.p[2] - 4], t, "remontoir");
    const g = messages(r, "grenade")[0];
    expect(g.genre).toBe("remontoir");
    expect(g.explosionT - t).toBeGreaterThan(GRENADES.remontoir.mecheMs);
    expect(stock(r, "a")!.remontoirs).toBeUndefined();
    const avant = avancer(s, t + 50, g.explosionT - 50);
    expect(messages(avant, "zevt").some((m) => m.e.e === "grenade")).toBe(false);
    const apres = avancer(s, g.explosionT, g.explosionT + 100);
    expect(messages(apres, "zevt").some((m) => m.e.e === "grenade" && m.e.genre === "remontoir")).toBe(true);
  });

  it("un joueur qui arrive voit les grenades en vol (synchro)", () => {
    const s = partie(["a"]);
    avancer(s, T0 + 50, T0 + 1200);
    const a = j(s, "a");
    lancer(s, "a", [a.p[0] + 4, 0, a.p[2] - 4], T0 + 2000);
    const synchro = serviceDe(s).synchro("a");
    expect(messages(synchro, "grenade")).toHaveLength(1);
  });
});
