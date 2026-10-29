import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { COUTEAU, STATS, directionsTir } from "./armes";
import { construireCircuits, distanceAuxCircuits } from "./circulation";
import { construireMonde, pointsApparition } from "./collision";
import type { ContexteSalle, JoueurSalle, Sortie } from "./match-contexte";
import {
  CREDIT_RAFALE_AUTO_MS, Salle, SCORES_ANTI_RAFALE_MS, SCORES_PERIODE_MS, TOLERANCE_DEGAINAGE, type OptionsSalle,
} from "./match";
import {
  EQUIPEMENT_DEFAUT, JEU, SILHOUETTE, SILHOUETTE_ACCROUPIE, VERSION_PROTOCOLE,
  type ArmeFeuId, type MessageClient, type MessageServeur, type Slot, type Vec3,
} from "./protocole";
import { ROND_POINT, ZONE_APPARITION, lacetVers, trouverRondPoint } from "./zones";

/**
 * Lot S1 (v2 §6.1 et §7) : équipement, couteau, bouclier, régénération, accroupi, apparitions, snaps, tableau des scores.
 * Elsa et les véhicules sont des services du lot S2 : ils sont remplacés ici par des FAUX qui n'implémentent que leur interface
 * (`match-contexte.ts`), pour tester ce que la salle leur demande et ce qu'elle fait de leurs réponses.
 */

const fakes = vi.hoisted(() => ({
  ctxElsa: null as unknown,
  optsElsa: null as unknown,
  ctxVeh: null as unknown,
  optsVeh: null as unknown,
  appels: [] as string[],
  occupations: new Map<string, { vehicule: number; siege: number }>(),
  conducteurs: new Set<string>(),
  yeux: new Map<string, number[][]>(),
  snapVehicules: [] as unknown[],
  recus: [] as string[],
}));

vi.mock("./match-elsa", () => ({
  creerServiceElsa: (ctx: unknown, opts: unknown) => {
    fakes.ctxElsa = ctx;
    fakes.optsElsa = opts;
    return {
      tic: () => { fakes.appels.push("elsa.tic"); return []; },
      reinitialiser: () => { fakes.appels.push("elsa.reinitialiser"); },
      synchro: (id: string) => [{ a: id, m: { t: "elsa", evenement: "etat", elsa: { x: -120, z: 39, offre: null } } }],
    };
  },
}));

vi.mock("./match-vehicules", () => ({
  creerServiceVehicules: (ctx: ContexteSalle, opts: unknown) => {
    fakes.ctxVeh = ctx;
    fakes.optsVeh = opts;
    const sieges = (): Sortie => ({ a: "tous", m: { t: "sieges", vehicules: [{ id: 0, sieges: [null, null, null, null] }] } });
    return {
      recevoir: (j: JoueurSalle, m: MessageClient) => { fakes.recus.push(`${j.id}:${m.t}`); return []; },
      occupation: (id: string) => fakes.occupations.get(id) ?? null,
      liberer: (j: JoueurSalle) => {
        fakes.appels.push(`liberer:${j.id}:${ctx.joueur(j.id) ? "present" : "absent"}`);
        return fakes.occupations.delete(j.id) ? [sieges()] : [];
      },
      tic: () => { fakes.appels.push("vehicules.tic"); return []; },
      reinitialiser: () => { fakes.appels.push("vehicules.reinitialiser"); return []; },
      synchro: (id: string) => [{ a: id, m: { t: "sieges", vehicules: [{ id: 0, sieges: [null, null, null, null] }] } }],
      snap: () => fakes.snapVehicules,
      oeilsPossibles: (j: JoueurSalle) => fakes.yeux.get(j.id) ?? null,
      estConducteur: (id: string) => fakes.conducteurs.has(id),
      tirVoitures: () => [],
    };
  },
}));

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
/** Arène réduite : un seul bâtiment (0..10 × 0..10, h = 12) ; bornes = centroïde (5, 5) ± 25 → [−20, 30]². */
const bat: Building = { h: 12, r: [[0, 0], [10, 0], [10, 10], [0, 10]], c: [5, 5] };
const mondePetit = construireMonde({ ...scene, buildings: [bat], pois: [] } as SceneData);
const POINTS: Vec2[] = [[-15, -15], [28, 28], [-15, 28], [28, -15]];
const T0 = 1_000_000;
/** Protection d'apparition écoulée. */
const T1 = T0 + JEU.protectionMs + 100;

beforeEach(() => {
  fakes.ctxElsa = fakes.ctxVeh = fakes.optsElsa = fakes.optsVeh = null;
  fakes.appels.length = 0;
  fakes.recus.length = 0;
  fakes.occupations.clear();
  fakes.conducteurs.clear();
  fakes.yeux.clear();
  fakes.snapVehicules.length = 0;
});

const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
function nouvelleSalle(options?: OptionsSalle, alea: () => number = () => 0): Salle {
  return new Salle(mondePetit, POINTS, alea, T0, options);
}
/** Salle avec des joueurs "a", "b"… en jeu ; `rejoindre` selon l'argument (alias `arme` ou équipement). */
function salleEnJeu(rejoindre: Partial<Extract<MessageClient, { t: "rejoindre" }>>[], options?: OptionsSalle): Salle {
  const s = nouvelleSalle(options);
  rejoindre.forEach((r, i) => {
    const id = String.fromCharCode(97 + i);
    s.connecter(id, `Joueur${id}`, T0);
    s.recevoir(id, { t: "rejoindre", ...r }, T0);
  });
  return s;
}
function placer(s: Salle, id: string, p: Vec3, accroupi = false) { j(s, id).p = p; j(s, id).v = [0, 0, 0]; j(s, id).accroupi = accroupi; }
const oeilDe = (s: Salle, id: string): Vec3 => [j(s, id).p[0], j(s, id).p[1] + (j(s, id).accroupi ? SILHOUETTE_ACCROUPIE.oeil : SILHOUETTE.oeil), j(s, id).p[2]];
/** Oriente le regard du joueur vers `point` et renvoie la direction normalisée. */
function regarder(s: Salle, id: string, point: Vec3): { o: Vec3; d: Vec3 } {
  const a = j(s, id);
  const o = oeilDe(s, id);
  const v = [point[0] - o[0], point[1] - o[1], point[2] - o[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
  a.lacet = Math.atan2(-d[0], -d[2]);
  a.tangage = Math.asin(d[1]);
  return { o, d };
}
/** Tir de l'arme en main de `tireur` sur `cible` (centre de la silhouette de la cible, ou `hauteur` si donnée), touche déclarée. */
function tirer(s: Salle, tireur: string, cible: string, t: number, opts: { hauteur?: number; zone?: "tete" | "corps"; declarer?: boolean } = {}): Sortie[] {
  const c = j(s, cible);
  const haut = opts.hauteur ?? (c.accroupi ? SILHOUETTE_ACCROUPIE.centreY : SILHOUETTE.centreY);
  const { o, d } = regarder(s, tireur, [c.p[0], c.p[1] + haut, c.p[2]]);
  return s.recevoir(tireur, {
    t: "tir", arme: j(s, tireur).arme as ArmeFeuId, o, d: [d],
    touches: opts.declarer === false ? [] : [{ cible, zone: opts.zone ?? "corps", plomb: 0 }],
  }, t);
}
function coup(s: Salle, tireur: string, cible: string | null, t: number, point?: Vec3): Sortie[] {
  const c = cible ? j(s, cible) : null;
  const { o, d } = regarder(s, tireur, point ?? [c!.p[0], c!.p[1] + SILHOUETTE.centreY, c!.p[2]]);
  return s.recevoir(tireur, { t: "coup", o, d, cibles: cible ? [cible] : [] }, t);
}
/** Deux joueurs face à face à 20 m (pistolet en main), protection écoulée. */
function duel(options?: OptionsSalle, a: Partial<Extract<MessageClient, { t: "rejoindre" }>> = { arme: "pistolet" }, b: Partial<Extract<MessageClient, { t: "rejoindre" }>> = { arme: "pistolet" }) {
  const s = salleEnJeu([a, b], options);
  placer(s, "a", [-10, 0, 20]);
  placer(s, "b", [10, 0, 20]);
  return { s, t: T1 };
}
/** Joueur "a" dans un duel, couteau en main et sorti, b collé à 1,5 m. */
function duelCouteau() {
  const { s, t } = duel();
  placer(s, "b", [-8.5, 0, 20]);
  s.recevoir("a", { t: "main", slot: "couteau" }, t);
  return { s, t: t + JEU.degainageMs + 20 };
}
const etat = (seq: number, p: Vec3, extra: Partial<Extract<MessageClient, { t: "etat" }>> = {}): MessageClient =>
  ({ t: "etat", seq, p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0, ...extra });

// ---------- équipement et changement d'arme ----------

describe("équipement", () => {
  it("alias v1 : une principale est rangée dans sa catégorie et devient l'arme en main, une secondaire aussi", () => {
    const s = salleEnJeu([{ arme: "sniper" }, { arme: "pistolet" }, { arme: "revolver" }]);
    expect(j(s, "a")).toMatchObject({ arme: "sniper", main: "principale" });
    expect(j(s, "a").equip).toEqual({ ...EQUIPEMENT_DEFAUT, principale: "sniper" });
    expect(j(s, "b")).toMatchObject({ arme: "pistolet", main: "secondaire" });
    expect(j(s, "c")).toMatchObject({ arme: "revolver", main: "secondaire" });
    expect(j(s, "c").equip.secondaire).toBe("revolver");
  });

  it("une arme spéciale ou invalide en alias est ignorée (équipement par défaut, pistolet en main)", () => {
    const s = salleEnJeu([{ arme: "railgun" }, { arme: "laser" as ArmeFeuId }]);
    for (const id of ["a", "b"]) {
      expect(j(s, id)).toMatchObject({ arme: "pistolet", main: "secondaire" });
      expect(j(s, id).equip.speciale).toBeNull();
    }
  });

  it("rejoindre avec principale et secondaire : équipement choisi, principale en main", () => {
    const s = salleEnJeu([{ principale: "pompe", secondaire: "mini_uzi" }]);
    expect(j(s, "a").equip).toEqual({ principale: "pompe", secondaire: "mini_uzi", speciale: null });
    expect(j(s, "a")).toMatchObject({ main: "principale", arme: "pompe" });
    s.recevoir("a", { t: "quitter" }, T0 + 1);
    s.recevoir("a", { t: "rejoindre", principale: "sniper", secondaire: "pistolet" }, T0 + 2);
    const [ap] = messages(s.tic(T0 + 1 + JEU.delaiReapparitionMs), "apparition");
    expect(ap).toMatchObject({ arme: "sniper", main: "principale", equip: { principale: "sniper", secondaire: "pistolet", speciale: null } });
  });

  it("equiper en vie ne change rien tout de suite (prochaine apparition) ; mort, c'est appliqué aussitôt", () => {
    const { s, t } = duel();
    s.recevoir("b", { t: "equiper", principale: "sniper", secondaire: "revolver" }, t);
    expect(j(s, "b")).toMatchObject({ arme: "pistolet", main: "secondaire" });
    expect(j(s, "b").equip).toEqual(EQUIPEMENT_DEFAUT);
    expect(s.equipementProchain("b")).toEqual({ principale: "sniper", secondaire: "revolver", speciale: null });
    j(s, "b").vivant = false; j(s, "b").reapparitionT = t + 4000;
    s.recevoir("b", { t: "equiper", principale: "pompe", secondaire: "revolver" }, t + 1);
    expect(j(s, "b")).toMatchObject({ arme: "pompe", main: "principale" });
    const retour = messages(s.tic(t + 4000), "apparition").find((m) => m.id === "b")!;
    expect(retour).toMatchObject({ arme: "pompe", main: "principale", equip: { principale: "pompe", secondaire: "revolver" } });
  });

  it("equiper : valeurs invalides ignorées champ par champ", () => {
    const { s, t } = duel();
    s.recevoir("b", { t: "equiper", principale: "railgun" as never, secondaire: "revolver" }, t);
    expect(s.equipementProchain("b")).toEqual({ principale: "mitraillette", secondaire: "revolver", speciale: null });
    s.recevoir("b", { t: "equiper", principale: "x" as never, secondaire: "y" as never }, t);
    expect(s.equipementProchain("b")).toEqual({ principale: "mitraillette", secondaire: "revolver", speciale: null });
  });

  it("main : change l'arme en main si le slot en porte une, refuse un slot vide ou inconnu", () => {
    const { s, t } = duel({}, { principale: "sniper", secondaire: "pistolet" });
    expect(j(s, "a")).toMatchObject({ main: "principale", arme: "sniper" });
    s.recevoir("a", { t: "main", slot: "secondaire" }, t);
    expect(j(s, "a")).toMatchObject({ main: "secondaire", arme: "pistolet", sortieJusqua: t + JEU.degainageMs });
    s.recevoir("a", { t: "main", slot: "couteau" }, t + 1);
    expect(j(s, "a")).toMatchObject({ main: "couteau", arme: "couteau" });
    s.recevoir("a", { t: "main", slot: "speciale" }, t + 2); // aucune spéciale
    s.recevoir("a", { t: "main", slot: "chapeau" as Slot }, t + 3);
    expect(j(s, "a").main).toBe("couteau");
    j(s, "a").equip.speciale = "railgun"; // portée mais sans munition
    s.recevoir("a", { t: "main", slot: "speciale" }, t + 4);
    expect(j(s, "a").main).toBe("couteau");
    j(s, "a").munSpeciale = 6;
    s.recevoir("a", { t: "main", slot: "speciale" }, t + 5);
    expect(j(s, "a")).toMatchObject({ main: "speciale", arme: "railgun" });
  });

  it("main : ignoré hors arène et pour un mort", () => {
    const { s, t } = duel();
    s.connecter("z", "Zed", T0);
    expect(s.recevoir("z", { t: "main", slot: "couteau" }, t)).toEqual([]);
    expect(j(s, "z").main).toBe("secondaire");
    j(s, "b").vivant = false;
    s.recevoir("b", { t: "main", slot: "couteau" }, t);
    expect(j(s, "b").main).toBe("secondaire");
  });

  it("EQUIPEMENT_DEFAUT n'est jamais muté : deux joueurs, l'un perd sa spéciale, l'autre la garde", () => {
    const { s, t } = duel({ elsa: { x: 0, z: 0 } });
    const ctx = fakes.ctxElsa as ContexteSalle;
    j(s, "a").equip.speciale = "minigun"; j(s, "a").munSpeciale = 150;
    j(s, "b").equip.speciale = "railgun"; j(s, "b").munSpeciale = 6;
    const tuer = ctx.infliger(j(s, "b"), 1000, j(s, "a"), "arme", "corps", "pistolet", t);
    expect(messages(tuer, "mort")).toHaveLength(1);
    expect(j(s, "b").equip.speciale).toBeNull();
    expect(j(s, "b").munSpeciale).toBe(0);
    expect(j(s, "a").equip.speciale).toBe("minigun");
    expect(EQUIPEMENT_DEFAUT.speciale).toBeNull();
    expect(Object.isFrozen(EQUIPEMENT_DEFAUT)).toBe(true);
    // la réapparition donne une copie neuve, sans spéciale
    const [ap] = messages(s.tic(t + JEU.delaiReapparitionMs), "apparition");
    expect(ap.equip.speciale).toBeNull();
    expect(ap.equip).not.toBe(EQUIPEMENT_DEFAUT);
    expect(j(s, "b").equip).not.toBe(EQUIPEMENT_DEFAUT);
  });

  it("tir d'une arme qui n'est pas en main refusé (même si elle est dans l'équipement)", () => {
    const { s, t } = duel({}, { principale: "sniper", secondaire: "pistolet" });
    // a tient le sniper : un tir déclaré « pistolet » est refusé, le sniper est accepté
    const { o, d } = regarder(s, "a", [10, 1, 20]);
    expect(s.recevoir("a", { t: "tir", arme: "pistolet", o, d: [d], touches: [] }, t)).toEqual([]);
    expect(s.recevoir("a", { t: "tir", arme: "sniper", o, d: [d], touches: [] }, t)).toHaveLength(1);
  });

  it("dégainage de 350 ms avec 30 % de tolérance : un tir à 260 ms est accepté, à 200 ms refusé", () => {
    expect(TOLERANCE_DEGAINAGE).toBe(0.7);
    const { s, t } = duel({}, { principale: "sniper", secondaire: "pistolet" });
    s.recevoir("a", { t: "main", slot: "secondaire" }, t);
    expect(tirer(s, "a", "b", t + 200)).toEqual([]);
    expect(messages(tirer(s, "a", "b", t + 260), "degats")).toHaveLength(1);
    // l'apparition elle-même n'impose aucun délai
    const nouveau = duel();
    expect(messages(tirer(nouveau.s, "a", "b", nouveau.t), "degats")).toHaveLength(1);
  });

  it("cadence par arme : un aller-retour d'arme ne contourne pas la cadence du sniper", () => {
    const { s, t } = duel({}, { principale: "sniper", secondaire: "pistolet" });
    const accepte = (tt: number) => tirer(s, "a", "b", tt, { declarer: false }).length > 0;
    expect(accepte(t)).toBe(true);
    s.recevoir("a", { t: "main", slot: "secondaire" }, t + 10);
    s.recevoir("a", { t: "main", slot: "principale" }, t + 20);
    // sniper : 1,35 s × 0,85 ≈ 1,15 s ; 400 ms plus tard (dégainage écoulé) c'est trop tôt
    expect(accepte(t + 420)).toBe(false);
    expect(accepte(t + 1200)).toBe(true);
    // le pistolet, lui, a gardé sa propre cadence (jamais tiré)
    s.recevoir("a", { t: "main", slot: "secondaire" }, t + 1300);
    expect(accepte(t + 1700)).toBe(true);
  });

  it("le crédit de rafale d'une arme automatique est de 200 ms au moins (minigun : 6 tirs d'un coup, pas un de plus)", () => {
    expect(CREDIT_RAFALE_AUTO_MS).toBe(200);
    const { s, t } = duel();
    j(s, "a").equip.speciale = "minigun"; j(s, "a").munSpeciale = STATS.minigun.chargeur;
    s.recevoir("a", { t: "main", slot: "speciale" }, t);
    const tt = t + JEU.degainageMs + 50;
    const intervalle = STATS.minigun.cadenceS * 1000 * 0.85;
    const attendus = Math.floor(CREDIT_RAFALE_AUTO_MS / intervalle) + 1;
    let acceptes = 0;
    for (let i = 0; i < 12; i++) acceptes += tirer(s, "a", "b", tt, { declarer: false }).length > 0 ? 1 : 0;
    expect(acceptes).toBe(attendus);
    expect(attendus).toBeGreaterThan(3); // l'ancien crédit (3 intervalles = 102 ms) n'en donnait que 4
    // puis la cadence nominale tient : 25 tirs/s
    let suite = 0;
    for (let i = 1; i <= 100; i++) suite += tirer(s, "a", "b", tt + i * 10, { declarer: false }).length > 0 ? 1 : 0;
    expect(suite).toBeGreaterThanOrEqual(28);
    expect(suite).toBeLessThanOrEqual(31);
  });

  it("arme spéciale : une munition par tir, à 0 elle disparaît, retour au slot précédent et `equipement` au tireur", () => {
    const { s, t } = duel();
    j(s, "a").equip.speciale = "railgun"; j(s, "a").munSpeciale = 2;
    s.recevoir("a", { t: "main", slot: "speciale" }, t);
    const tt = t + JEU.degainageMs;
    const premier = tirer(s, "a", "b", tt, { declarer: false });
    expect(messages(premier, "equipement")).toEqual([]);
    expect(j(s, "a").munSpeciale).toBe(1);
    const dernier = tirer(s, "a", "b", tt + 1500, { declarer: false });
    const eq = dernier.find((x) => x.m.t === "equipement")!;
    expect(eq.a).toBe("a");
    expect(eq.m).toMatchObject({ t: "equipement", main: "secondaire", munSpeciale: 0, equip: { speciale: null } });
    expect(j(s, "a")).toMatchObject({ main: "secondaire", arme: "pistolet", munSpeciale: 0 });
    expect(j(s, "a").equip.speciale).toBeNull();
    // plus de tir railgun possible
    expect(s.recevoir("a", { t: "tir", arme: "railgun", o: oeilDe(s, "a"), d: [[1, 0, 0]], touches: [] }, tt + 4000)).toEqual([]);
  });
});

// ---------- couteau ----------

describe("couteau", () => {
  it("tue à 100 PV, créditée au tueur, `coup` diffusé aux autres, mort avec cause et arme", () => {
    const { s, t } = duelCouteau();
    const sorties = coup(s, "a", "b", t);
    expect(sorties[0]).toMatchObject({ a: "tous", sauf: "a", m: { t: "coup", id: "a" } });
    const [deg] = messages(sorties, "degats");
    expect(deg).toMatchObject({ cible: "b", par: "a", degats: COUTEAU.degats, pv: 0, zone: "corps" });
    const [mort] = messages(sorties, "mort");
    expect(mort).toMatchObject({ cible: "b", par: "a", arme: "couteau", cause: "arme", ts: t });
    expect(j(s, "a").kills).toBe(1);
    expect(j(s, "b")).toMatchObject({ vivant: false, morts: 1 });
  });

  it("avec 100 de bouclier il en faut deux (la cadence de 0,5 s est tenue)", () => {
    const { s, t } = duelCouteau();
    j(s, "b").bouclier = 100;
    const [premier] = messages(coup(s, "a", "b", t), "degats");
    expect(premier).toMatchObject({ pv: 100, bouclier: 0, absorbe: 100 });
    expect(coup(s, "a", "b", t + 100)).toEqual([]);
    const second = coup(s, "a", "b", t + 450);
    expect(messages(second, "mort")).toHaveLength(1);
  });

  it("hors portée : le coup part dans le vide (diffusé) sans dégâts ; portée mesurée de la surface", () => {
    const { s, t } = duelCouteau();
    placer(s, "b", [-10 + 4, 0, 20]); // 4 m de l'axe, 3,5 m de la surface
    const loin = coup(s, "a", "b", t);
    expect(messages(loin, "coup")).toHaveLength(1);
    expect(messages(loin, "degats")).toEqual([]);
    // 2,5 m de l'axe = 2,0 m de la surface : dans la portée annoncée (2,2 m)
    placer(s, "b", [-10 + 2.5, 0, 20]);
    expect(messages(coup(s, "a", "b", t + 600), "degats")).toHaveLength(1);
    // 3,0 m de l'axe = 2,5 m de la surface : dans la marge du serveur (2,2 + 0,6 m)
    Object.assign(j(s, "b"), { pv: 100, vivant: true });
    placer(s, "b", [-10 + 3.0, 0, 20]);
    expect(messages(coup(s, "a", "b", t + 1200), "degats")).toHaveLength(1);
  });

  it("coup dans le vide sans cible : diffusé, aucun dégât", () => {
    const { s, t } = duelCouteau();
    const sorties = coup(s, "a", null, t, [-10, 1, 30]);
    expect(sorties).toHaveLength(1);
    expect(sorties[0].m.t).toBe("coup");
    expect(j(s, "b").pv).toBe(JEU.pvMax);
  });

  it("`cibles` absent ou mal formé (ancien format `cible`, client truqué) : coup dans le vide, sans exception ni dégât", () => {
    const formes: unknown[] = [undefined, null, "b", 42, { 0: "b" }, [null], [42], [{ id: "b" }]];
    formes.forEach((cibles, i) => {
      const { s, t } = duelCouteau();
      const { o, d } = regarder(s, "a", [-8.5, 1, 20]);
      const msg = { t: "coup", o, d, cibles } as unknown as MessageClient;
      const sorties = s.recevoir("a", msg, t + i);
      expect(sorties).toHaveLength(1);
      expect(sorties[0].m).toMatchObject({ t: "coup", id: "a", arme: "couteau" });
      expect(j(s, "b").pv).toBe(JEU.pvMax);
    });
    const { s, t } = duelCouteau();
    const { o, d } = regarder(s, "a", [-8.5, 1, 20]);
    expect(s.recevoir("a", { t: "coup", o, d, cible: "b" } as unknown as MessageClient, t)).toHaveLength(1);
    expect(j(s, "b").pv).toBe(JEU.pvMax);
  });

  it("cadence : un deuxième coup trop tôt est refusé, refusé aussi pendant le dégainage et sans couteau en main", () => {
    const { s, t } = duelCouteau();
    j(s, "b").bouclier = 100; // pour survivre au premier coup
    expect(coup(s, "a", "b", t).length).toBeGreaterThan(0);
    expect(coup(s, "a", "b", t + 200)).toEqual([]);
    expect(coup(s, "a", "b", t + 480).length).toBeGreaterThan(0);
    // pas de couteau en main
    const autre = duel();
    placer(autre.s, "b", [-8.5, 0, 20]);
    expect(coup(autre.s, "a", "b", autre.t)).toEqual([]);
    // dégainage : 200 ms après `main` refusé, 260 ms accepté
    autre.s.recevoir("a", { t: "main", slot: "couteau" }, autre.t);
    expect(coup(autre.s, "a", "b", autre.t + 200)).toEqual([]);
    expect(coup(autre.s, "a", "b", autre.t + 260).length).toBeGreaterThan(0);
  });

  it("le couteau n'utilise pas `tir` et le pistolet pas `coup`", () => {
    const { s, t } = duelCouteau();
    const { o, d } = regarder(s, "a", [-8.5, 1, 20]);
    expect(s.recevoir("a", { t: "tir", arme: "pistolet", o, d: [d], touches: [] }, t)).toEqual([]);
  });

  it("fenêtre de rejeu de 200 ms : une cible qui vient de s'éloigner reste touchable 180 ms après, plus 210 ms après", () => {
    const scenario = () => {
      const { s, t } = duelCouteau();
      placer(s, "b", [-7.5, 0, 20]); // 2,5 m de l'axe, 2,0 m de la surface
      let seq = 0;
      const bouge = (x: number, tt: number) => s.recevoir("b", etat(++seq, [x, 0, 20]), tt);
      bouge(-7.5, t);
      bouge(-7.5, t + 100);
      bouge(-6.0, t + 200); // 4,0 m de l'axe, 3,5 m de la surface : hors de la portée du serveur (2,8 m)
      return { s, t };
    };
    const vu = scenario();
    expect(messages(coup(vu.s, "a", "b", vu.t + 280), "degats")).toHaveLength(1); // le dernier état proche a 180 ms
    const trop = scenario();
    expect(messages(coup(trop.s, "a", "b", trop.t + 310), "degats")).toEqual([]); // 210 ms
  });

  it("anti-triche : `o` loin de l'œil connu, `d` non normalisé, visée de travers, `o` non fini : refusés", () => {
    const { s, t } = duelCouteau();
    const a = j(s, "a");
    const { o, d } = regarder(s, "a", [-8.5, 1, 20]);
    const base = { t: "coup" as const, cibles: ["b"] };
    expect(s.recevoir("a", { ...base, o: [o[0] + 10, o[1], o[2]], d }, t)).toEqual([]);
    expect(s.recevoir("a", { ...base, o, d: [d[0] * 3, d[1] * 3, d[2] * 3] }, t)).toEqual([]);
    const dos: Vec3 = [-d[0], -d[1], -d[2]];
    expect(s.recevoir("a", { ...base, o, d: dos }, t)).toEqual([]);
    expect(s.recevoir("a", { ...base, o: [Number.NaN, 0, 0], d }, t)).toEqual([]);
    expect(s.recevoir("a", { ...base, o: [1, 2] as unknown as Vec3, d }, t)).toEqual([]);
    expect(j(s, "b").pv).toBe(JEU.pvMax);
    // le coup valide passe ensuite (rien n'a consommé la cadence)
    expect(s.recevoir("a", { ...base, o, d }, t + 10).length).toBeGreaterThan(0);
    expect(a.cadenceArme.couteau).toBeDefined();
  });

  it("pas de dégâts sur un joueur protégé, un mort ou soi-même ; un coup annule la protection d'apparition", () => {
    const { s, t } = duelCouteau();
    j(s, "b").protegeJusqua = t + 1000;
    expect(messages(coup(s, "a", "b", t), "degats")).toEqual([]);
    j(s, "b").protegeJusqua = 0;
    j(s, "a").protegeJusqua = t + 5000;
    expect(messages(coup(s, "a", "b", t + 600), "degats")).toHaveLength(1);
    expect(j(s, "a").protegeJusqua).toBe(0);
    expect(messages(coup(s, "a", "a", t + 1200, [-10, 1, 25]), "degats")).toEqual([]);
  });

  it("un coup de couteau ne compte pas dans les tirs du tableau des scores mais ses dégâts et son kill si", () => {
    const { s, t } = duelCouteau();
    coup(s, "a", "b", t);
    expect(j(s, "a")).toMatchObject({ tirs: 0, touches: 0, degats: 100, kills: 1, serie: 1, killsParArme: { couteau: 1 } });
  });
});

// ---------- épée (v5) ----------

describe("épée", () => {
  const EPEE = { principale: "mitraillette", secondaire: "pistolet", melee: "epee" } as const;
  /** Joueur « a » avec l'épée en main et sortie, face à des cibles à 1,5 m (b) ; t après le dégainage. */
  function duelEpee(extra: Partial<Extract<MessageClient, { t: "rejoindre" }>>[] = [{ ...EPEE }]) {
    const s = salleEnJeu([{ ...EPEE }, ...extra]);
    placer(s, "a", [-10, 0, 20]);
    extra.forEach((_, i) => placer(s, String.fromCharCode(98 + i), [-8.5, 0, 20]));
    s.recevoir("a", { t: "main", slot: "couteau" }, T1);
    return { s, t: T1 + JEU.degainageMs + 20 };
  }
  const rejoindreVide: Partial<Extract<MessageClient, { t: "rejoindre" }>> = { arme: "pistolet" };

  it("l'équipement `melee: epee` met l'épée dans le slot couteau (arme en main `epee`), diffusée comme `coup` avec son arme", () => {
    const { s, t } = duelEpee([rejoindreVide]);
    expect(j(s, "a").equip.melee).toBe("epee");
    expect(j(s, "a")).toMatchObject({ main: "couteau", arme: "epee" });
    expect(j(s, "b").equip.melee).toBeUndefined(); // sans choix : couteau
    const sorties = coup(s, "a", "b", t);
    expect(sorties[0]).toMatchObject({ a: "tous", sauf: "a", m: { t: "coup", id: "a", arme: "epee" } });
  });

  it("tue en un coup (140 dégâts, 100 PV), kill et arme `epee` au tableau, mort avec l'arme `epee`", () => {
    const { s, t } = duelEpee([rejoindreVide]);
    const sorties = coup(s, "a", "b", t);
    const [deg] = messages(sorties, "degats");
    expect(deg).toMatchObject({ cible: "b", par: "a", degats: 140, pv: 0, zone: "corps" });
    expect(messages(sorties, "mort")[0]).toMatchObject({ cible: "b", par: "a", arme: "epee", cause: "arme" });
    expect(j(s, "a")).toMatchObject({ kills: 1, serie: 1, killsParArme: { epee: 1 }, degats: 100, tirs: 0, touches: 0 });
  });

  it("avec 100 de bouclier la cible survit au premier coup (140 < 200) et tombe au second", () => {
    const { s, t } = duelEpee([rejoindreVide]);
    j(s, "b").bouclier = 100;
    const [premier] = messages(coup(s, "a", "b", t), "degats");
    expect(premier).toMatchObject({ pv: 60, bouclier: 0, absorbe: 100 });
    expect(messages(coup(s, "a", "b", t + 800), "mort")).toHaveLength(1);
  });

  it("cadence 0,85 s (85 % toléré, un demi-intervalle de crédit) : plus lente que le couteau", () => {
    const { s, t } = duelEpee([rejoindreVide]);
    j(s, "b").bouclier = 200;
    expect(coup(s, "a", "b", t).length).toBeGreaterThan(0);
    expect(coup(s, "a", "b", t + 200)).toEqual([]); // le couteau accepterait déjà un coup à +480
    expect(coup(s, "a", "b", t + 350)).toEqual([]);
    expect(coup(s, "a", "b", t + 365).length).toBeGreaterThan(0); // le crédit de rafale (0,36 s) n'est consommé qu'une fois
    expect(coup(s, "a", "b", t + 700)).toEqual([]);
    expect(coup(s, "a", "b", t + 1000)).toEqual([]);
    expect(coup(s, "a", "b", t + 1100).length).toBeGreaterThan(0);
    expect(j(s, "a").cadenceArme.epee).toBeDefined();
    expect(j(s, "a").cadenceArme.couteau).toBeUndefined();
  });

  it("portée 2,6 m de la surface (+ 0,7 m de marge pour le serveur) : une cible à 3,5 m de l'axe est touchée, à 4 m non ; le couteau ne l'atteint pas", () => {
    const { s, t } = duelEpee([rejoindreVide]);
    placer(s, "b", [-10 + 4.0, 0, 20]); // ≈ 3,5 m de la surface
    const loin = coup(s, "a", "b", t);
    expect(messages(loin, "coup")).toHaveLength(1);
    expect(messages(loin, "degats")).toEqual([]);
    placer(s, "b", [-10 + 3.5, 0, 20]); // ≈ 3,0 m de la surface : dans la marge
    expect(messages(coup(s, "a", "b", t + 1000), "degats")).toHaveLength(1);
    // le même écart avec le couteau est hors de sa portée (2,2 + 0,6 m)
    const c = duel();
    placer(c.s, "b", [-10 + 3.5, 0, 20]);
    c.s.recevoir("a", { t: "main", slot: "couteau" }, c.t);
    expect(messages(coup(c.s, "a", "b", c.t + 400), "degats")).toEqual([]);
  });

  it("jusqu'à 3 cibles par coup : un 4e joueur déclaré est épargné, les doublons ne comptent qu'une fois", () => {
    const { s, t } = duelEpee([rejoindreVide, rejoindreVide, rejoindreVide, rejoindreVide]);
    placer(s, "b", [-8.5, 0, 19]); placer(s, "c", [-8.5, 0, 20]); placer(s, "d", [-8.5, 0, 21]); placer(s, "e", [-8.0, 0, 20]);
    const { o, d } = regarder(s, "a", [-8.5, 1, 20]);
    const sorties = s.recevoir("a", { t: "coup", o, d, cibles: ["b", "c", "d", "e"] }, t);
    expect(messages(sorties, "degats").map((m) => m.cible).sort()).toEqual(["b", "c", "d"]);
    expect(messages(sorties, "mort")).toHaveLength(3);
    expect(messages(sorties, "presence")).toHaveLength(1); // une seule présence pour trois morts, comme un tir de pompe
    expect(j(s, "e").pv).toBe(JEU.pvMax);
    expect(j(s, "a")).toMatchObject({ kills: 3, serie: 3, killsParArme: { epee: 3 } });
    // doublons : « b, b, b, c » = deux cibles distinctes
    const autre = duelEpee([rejoindreVide, rejoindreVide, rejoindreVide]);
    placer(autre.s, "c", [-8.5, 0, 21]); placer(autre.s, "d", [-8.5, 0, 19]);
    j(autre.s, "b").bouclier = 100;
    const v = regarder(autre.s, "a", [-8.5, 1, 20]);
    const dbl = autre.s.recevoir("a", { t: "coup", o: v.o, d: v.d, cibles: ["b", "b", "b", "c"] }, autre.t);
    expect(messages(dbl, "degats").map((m) => m.cible).sort()).toEqual(["b", "c"]);
    expect(j(autre.s, "d").pv).toBe(JEU.pvMax);
  });

  it("le premier mort d'une salve qui atteint l'objectif met fin au match : présence avant `match`, les autres cibles ne sont plus frappées", () => {
    const { s, t } = duelEpee([rejoindreVide, rejoindreVide, rejoindreVide]);
    placer(s, "b", [-8.5, 0, 19]); placer(s, "c", [-8.5, 0, 20]); placer(s, "d", [-8.5, 0, 21]);
    j(s, "a").kills = JEU.objectifKills - 1;
    const { o, d } = regarder(s, "a", [-8.5, 1, 20]);
    const sorties = s.recevoir("a", { t: "coup", o, d, cibles: ["b", "c", "d"] }, t);
    expect(messages(sorties, "mort")).toHaveLength(1);
    expect(j(s, "c").pv).toBe(JEU.pvMax);
    expect(j(s, "d").pv).toBe(JEU.pvMax);
    const ts = sorties.map((x) => x.m.t);
    expect(ts.filter((x) => x === "presence")).toHaveLength(1);
    expect(ts.indexOf("presence")).toBeLessThan(ts.indexOf("match"));
  });

  it("une cible hors du cône de 140° n'est pas touchée (dos tourné), même à portée", () => {
    const { s, t } = duelEpee([rejoindreVide, rejoindreVide]);
    placer(s, "b", [-8.5, 0, 20]); // devant
    placer(s, "c", [-11.5, 0, 20]); // derrière
    const { o, d } = regarder(s, "a", [-8.5, 1, 20]);
    const sorties = s.recevoir("a", { t: "coup", o, d, cibles: ["b", "c"] }, t);
    expect(messages(sorties, "degats").map((m) => m.cible)).toEqual(["b"]);
  });

  it("anti-triche comme au couteau : œil loin, direction non normalisée, visée de travers, cible mal formée refusés ; pas d'épée en main : refusé", () => {
    const { s, t } = duelEpee([rejoindreVide]);
    const { o, d } = regarder(s, "a", [-8.5, 1, 20]);
    const base = { t: "coup" as const, cibles: ["b"] };
    expect(s.recevoir("a", { ...base, o: [o[0] + 10, o[1], o[2]], d }, t)).toEqual([]);
    expect(s.recevoir("a", { ...base, o, d: [d[0] * 3, d[1] * 3, d[2] * 3] }, t)).toEqual([]);
    expect(s.recevoir("a", { ...base, o, d: [-d[0], -d[1], -d[2]] }, t)).toEqual([]);
    expect(s.recevoir("a", { ...base, o: [Number.NaN, 0, 0], d }, t)).toEqual([]);
    expect(j(s, "b").pv).toBe(JEU.pvMax);
    expect(s.recevoir("a", { t: "coup", o, d, cibles: [42, null, { id: "b" }] as unknown as string[] }, t + 10).length).toBe(1);
    expect(j(s, "b").pv).toBe(JEU.pvMax);
    // arme à feu en main : pas de coup
    s.recevoir("a", { t: "main", slot: "secondaire" }, t + 100);
    expect(s.recevoir("a", { ...base, o, d }, t + 1500)).toEqual([]);
  });

  it("vitesse : sprint de l'épée (12,5 × 1,2) sous le plafond de vitesse que le serveur accepte", () => {
    expect(12.5 * 1.2).toBeLessThanOrEqual(19);
  });
});

// ---------- bouclier et régénération ----------

describe("bouclier et régénération", () => {
  it("le bouclier absorbe d'abord ; `degats` porte le bouclier restant et la part absorbée", () => {
    const { s, t } = duel();
    j(s, "b").bouclier = 50;
    const [deg] = messages(tirer(s, "a", "b", t), "degats");
    expect(deg).toMatchObject({ degats: 28, pv: 100, bouclier: 22, absorbe: 28 });
    j(s, "b").bouclier = 10;
    const [deg2] = messages(tirer(s, "a", "b", t + 300), "degats");
    expect(deg2).toMatchObject({ degats: 28, pv: 82, bouclier: 0, absorbe: 10 });
  });

  it("`absorbe` est absent quand le bouclier n'absorbe rien", () => {
    const { s, t } = duel();
    const [deg] = messages(tirer(s, "a", "b", t), "degats");
    expect(deg).not.toHaveProperty("absorbe");
    expect(deg.bouclier).toBe(0);
  });

  it("régénération : rien avant 5 s, +20 PV/s après (100 PV à 8 s), le bouclier ne se régénère pas", () => {
    const { s, t } = duel();
    j(s, "b").bouclier = 30;
    tirer(s, "a", "b", t);
    tirer(s, "a", "b", t + 300);
    tirer(s, "a", "b", t + 600);
    // bouclier 30 : le 1er tir (28) l'entame, les suivants prennent les PV
    expect(j(s, "b").bouclier).toBe(0);
    const pv0 = j(s, "b").pv;
    expect(pv0).toBeLessThan(100);
    let tt = t + 600;
    const garder = (a: string) => { s.recevoir(a, etat(Math.floor(tt) + 1000, j(s, a).p), tt); };
    for (; tt < t + 600 + 3000; tt += 100) { s.tic(tt); garder("a"); garder("b"); }
    expect(j(s, "b").pv).toBe(pv0); // 3 s : inchangé
    for (; tt <= t + 600 + 8000; tt += 100) { s.tic(tt); garder("a"); garder("b"); }
    expect(j(s, "b").pv).toBe(100);
    expect(j(s, "b").bouclier).toBe(0);
  });

  it("un nouveau dégât repousse la régénération de 5 s", () => {
    const { s, t } = duel();
    tirer(s, "a", "b", t);
    const pv = j(s, "b").pv;
    let seq = 0;
    for (let tt = t; tt <= t + 4900; tt += 100) { s.tic(tt); s.recevoir("a", etat(++seq, j(s, "a").p), tt); s.recevoir("b", etat(++seq, j(s, "b").p), tt); }
    expect(j(s, "b").pv).toBe(pv);
    tirer(s, "a", "b", t + 4900); // 56 PV perdus au total
    for (let tt = t + 4900; tt <= t + 9700; tt += 100) { s.tic(tt); s.recevoir("a", etat(++seq, j(s, "a").p), tt); s.recevoir("b", etat(++seq, j(s, "b").p), tt); }
    expect(j(s, "b").pv).toBe(pv - 28);
  });
});

// ---------- quitter / rejoindre : santé mémorisée ----------

describe("quitter puis rejoindre", () => {
  it("jamais refusé, mais le retour attend le délai de réapparition ; PV et bouclier restaurés sans protection ; après 61 s : 100 PV", () => {
    const { s, t } = duel();
    j(s, "b").pv = 35; j(s, "b").bouclier = 20;
    s.recevoir("b", { t: "quitter" }, t + 1000);
    expect(j(s, "b").memoSante).toMatchObject({ pv: 35, bouclier: 20 });
    // +100 ms : accepté (jamais de refus) mais pas d'apparition immédiate ni de téléportation
    const tot = s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 1100);
    expect(messages(tot, "apparition")).toHaveLength(0);
    expect(messages(tot, "refus")).toHaveLength(0);
    expect(j(s, "b")).toMatchObject({ enJeu: true, vivant: false, reapparitionT: t + 1000 + JEU.delaiReapparitionMs });
    expect(s.tic(t + 1000 + JEU.delaiReapparitionMs - 1).filter((x) => x.m.t === "apparition")).toEqual([]);
    const retour = messages(s.tic(t + 1000 + JEU.delaiReapparitionMs), "apparition");
    expect(retour).toHaveLength(1);
    expect(retour[0]).toMatchObject({ pv: 35, bouclier: 20 });
    expect(j(s, "b").memoSante).toBeNull();
    // la santé est restaurée : pas de protection d'apparition en prime (pas d'échappatoire)
    expect(j(s, "b").protegeJusqua).toBe(0);
    // revenir après le délai : apparition immédiate
    s.recevoir("b", { t: "quitter" }, t + 10_000);
    const direct = messages(s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 10_000 + JEU.delaiReapparitionMs), "apparition");
    expect(direct).toHaveLength(1);
    // 61 s dehors : santé neuve et protection d'une vraie apparition
    s.recevoir("b", { t: "quitter" }, t + 20_000);
    const tard = messages(s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 20_000 + JEU.memoSanteMs + 1000), "apparition");
    expect(tard[0]).toMatchObject({ pv: 100, bouclier: 0 });
    expect(j(s, "b").protegeJusqua).toBeGreaterThan(t + 20_000 + JEU.memoSanteMs);
  });

  it("mort puis quitter puis rejoindre : le délai de réapparition de 4 s n'est pas contourné (régression), puis 100 PV", () => {
    const { s, t } = duel();
    // a tue b : b attend `delaiReapparitionMs`
    const tueur = j(s, "a");
    tueur.arme = "pistolet";
    j(s, "b").pv = 1;
    tirer(s, "a", "b", t);
    expect(j(s, "b")).toMatchObject({ vivant: false, reapparitionT: t + JEU.delaiReapparitionMs });
    // quitter (100 ms) puis rejoindre (200 ms) : toujours en attente, aucune apparition, aucun mémo de santé
    s.recevoir("b", { t: "quitter" }, t + 100);
    expect(j(s, "b").memoSante).toBeNull();
    expect(j(s, "b").enJeu).toBe(false);
    const sorties = s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 200);
    expect(messages(sorties, "apparition")).toEqual([]);
    expect(j(s, "b")).toMatchObject({ enJeu: true, vivant: false, reapparitionT: t + JEU.delaiReapparitionMs });
    // la répétition n'accélère rien
    s.recevoir("b", { t: "quitter" }, t + 300);
    s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 400);
    expect(messages(s.tic(t + JEU.delaiReapparitionMs - 1), "apparition")).toEqual([]);
    expect(messages(s.tic(t + JEU.delaiReapparitionMs), "apparition")[0]).toMatchObject({ id: "b", pv: 100, bouclier: 0 });
    // quitter pendant la mort, revenir après le délai : apparition immédiate
    j(s, "b").pv = 1;
    placer(s, "b", [10, 0, 20]);
    j(s, "b").protegeJusqua = 0;
    j(s, "a").prochainTir = -Infinity; j(s, "a").cadenceArme = {};
    tirer(s, "a", "b", t + 6000);
    expect(j(s, "b").vivant).toBe(false);
    s.recevoir("b", { t: "quitter" }, t + 6100);
    expect(messages(s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 6000 + JEU.delaiReapparitionMs + 10), "apparition")).toHaveLength(1);
  });

  it("équipement choisi en revenant : appliqué à la vraie apparition seulement, pas pendant la vie en cours", () => {
    const { s, t } = duel();
    s.recevoir("b", { t: "quitter" }, t);
    s.recevoir("b", { t: "rejoindre", principale: "sniper", secondaire: "revolver" }, t + 200);
    expect(j(s, "b").equip).toEqual(EQUIPEMENT_DEFAUT); // rien n'a changé en cours de vie : il attend
    const [ap] = messages(s.tic(t + JEU.delaiReapparitionMs), "apparition");
    expect(ap).toMatchObject({ arme: "sniper", main: "principale", equip: { principale: "sniper", secondaire: "revolver" } });
  });

  it("le temps passé dehors ne compte pas pour la régénération", () => {
    const { s, t } = duel();
    j(s, "b").pv = 40;
    j(s, "b").dernierDegatT = t - 1000;
    s.recevoir("b", { t: "quitter" }, t);
    s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, t + 30_000);
    expect(j(s, "b").dernierDegatT).toBe(t + 30_000 - 1000);
  });

  it("la spéciale est perdue en quittant, l'historique est vidé, le siège est libéré", () => {
    const { s, t } = duel({ vehicules: [{ p: [0, 0], cap: 0 }] });
    j(s, "b").equip.speciale = "minigun";
    j(s, "b").histo = [{ t, p: [10, 0, 20], accroupi: false }];
    fakes.occupations.set("b", { vehicule: 0, siege: 1 });
    const sorties = s.recevoir("b", { t: "quitter" }, t + 10);
    expect(j(s, "b").equip.speciale).toBeNull();
    expect(j(s, "b").histo).toEqual([]);
    expect(messages(sorties, "sieges")).toHaveLength(1);
    expect(fakes.occupations.has("b")).toBe(false);
  });

  it("l'éviction pour inactivité mémorise aussi la santé (le `reentrer` immédiat ne soigne pas)", () => {
    const { s, t } = duel();
    j(s, "a").pv = 55;
    j(s, "a").dernierDegatT = t + 24_900; // pas de régénération pendant l'attente
    let seq = 0;
    for (let k = 1; k <= 8; k++) s.recevoir("b", etat(++seq, [10, 0, 20]), t + k * 3000);
    s.tic(t + 25_000);
    expect(j(s, "a").enJeu).toBe(false);
    s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, t + 25_100);
    expect(j(s, "a").pv).toBe(55);
  });
});

// ---------- accroupi ----------

describe("accroupi", () => {
  it("accepté au sol seulement : refusé en l'air et pendant un wall-run ; se relever toujours possible", () => {
    const { s, t } = duel();
    s.recevoir("a", etat(1, [-10, 0, 20], { accroupi: true }), t);
    expect(j(s, "a").accroupi).toBe(true);
    s.recevoir("a", etat(2, [-10, 0, 20], { accroupi: true, posture: "air" }), t + 33);
    expect(j(s, "a").accroupi).toBe(false);
    s.recevoir("a", etat(3, [-10, 0, 20], { accroupi: true, posture: "mur", mur: 1 }), t + 66);
    expect(j(s, "a").accroupi).toBe(false);
    s.recevoir("a", etat(4, [-10, 0, 20], { accroupi: true }), t + 99);
    s.recevoir("a", etat(5, [-10, 0, 20]), t + 132);
    expect(j(s, "a").accroupi).toBe(false);
  });

  it("`histo` porte l'accroupi de chaque état", () => {
    const { s, t } = duel();
    s.recevoir("b", etat(1, [10, 0, 20]), t);
    s.recevoir("b", etat(2, [10, 0, 20], { accroupi: true }), t + 33);
    expect(j(s, "b").histo.map((h) => h.accroupi)).toEqual([false, true]);
  });

  it("l'instantané porte `accroupi` seulement quand c'est vrai", () => {
    const { s, t } = duel();
    s.recevoir("b", etat(1, [10, 0, 20], { accroupi: true }), t);
    const snap = messages(s.tic(t + 60), "snap")[0];
    expect(snap.j.find((x) => x.id === "b")).toMatchObject({ accroupi: true });
    expect(snap.j.find((x) => x.id === "a")).not.toHaveProperty("accroupi");
  });

  it("glissade déclarée : `glisse` dans le snap seulement accroupi et vrai (fiable pour la pose des avatars)", () => {
    const { s, t } = duel();
    s.recevoir("b", etat(1, [10, 0, 20], { accroupi: true, glisse: true }), t);
    expect(j(s, "b").glisse).toBe(true);
    const snap = messages(s.tic(t + 60), "snap")[0];
    expect(snap.j.find((x) => x.id === "b")).toMatchObject({ accroupi: true, glisse: true });
    expect(snap.j.find((x) => x.id === "a")).not.toHaveProperty("glisse");
    // `glisse` sans `accroupi` (client incohérent) ou en l'air : ignoré
    s.recevoir("b", etat(2, [10, 0, 20], { glisse: true }), t + 33);
    expect(j(s, "b").glisse).toBe(false);
    s.recevoir("b", etat(3, [10, 0, 20], { accroupi: true, glisse: true, posture: "air" }), t + 66);
    expect(j(s, "b").glisse).toBe(false);
    s.recevoir("b", etat(4, [10, 0, 20], { accroupi: true, glisse: true }), t + 99);
    s.recevoir("b", etat(5, [10, 0, 20], { accroupi: true }), t + 132);
    expect(messages(s.tic(t + 200), "snap")[0].j.find((x) => x.id === "b")).not.toHaveProperty("glisse");
  });

  it("hitbox accroupie : un tir qui passe 0,9 m au-dessus de la tête accroupie touche le joueur debout, pas l'accroupi", () => {
    const haut = (accroupi: boolean) => {
      const { s, t } = duel();
      if (accroupi) s.recevoir("b", etat(1, [10, 0, 20], { accroupi: true }), t - 50);
      return messages(tirer(s, "a", "b", t, { hauteur: 2.9 }), "degats");
    };
    expect(haut(false)).toHaveLength(1);
    expect(haut(true)).toEqual([]);
  });

  it("rejeu : un joueur qui vient de s'accroupir reste touchable debout là où le tireur le voyait debout", () => {
    const { s, t } = duel();
    s.recevoir("b", etat(1, [10, 0, 20]), t - 150);
    s.recevoir("b", etat(2, [10, 0, 20], { accroupi: true }), t - 20);
    expect(j(s, "b").accroupi).toBe(true);
    expect(messages(tirer(s, "a", "b", t, { hauteur: 2.9 }), "degats")).toHaveLength(1);
    // 300 ms plus tard, plus aucune position debout dans la fenêtre : manqué
    const { s: s2, t: t2 } = duel();
    s2.recevoir("b", etat(1, [10, 0, 20]), t2 - 600);
    s2.recevoir("b", etat(2, [10, 0, 20], { accroupi: true }), t2 - 500);
    expect(messages(tirer(s2, "a", "b", t2, { hauteur: 2.9 }), "degats")).toEqual([]);
  });

  it("l'œil abaissé d'un tireur accroupi est accepté ; un œil trop haut ne l'est pas", () => {
    const { s, t } = duel();
    s.recevoir("a", etat(1, [-10, 0, 20], { accroupi: true }), t - 50);
    expect(j(s, "a").accroupi).toBe(true);
    expect(messages(tirer(s, "a", "b", t), "degats")).toHaveLength(1); // œil à 1,30 m
    const a = j(s, "a");
    const { d } = regarder(s, "a", [10, 1, 20]);
    expect(s.recevoir("a", { t: "tir", arme: "pistolet", o: [a.p[0], a.p[1] + 4, a.p[2]], d: [d], touches: [] }, t + 1000)).toEqual([]);
  });
});

// ---------- mort ----------

describe("mort", () => {
  it("le message `mort` porte `ts`, `cause` et la photographie du tueur", () => {
    const { s, t } = duel();
    j(s, "a").pv = 77;
    for (let i = 0; i < 3; i++) tirer(s, "a", "b", t + i * 250);
    const [mort] = messages(tirer(s, "a", "b", t + 750), "mort");
    expect(mort).toMatchObject({ cible: "b", par: "a", arme: "pistolet", cause: "arme", ts: t + 750, delai: JEU.delaiReapparitionMs });
    expect(mort.tueur).toMatchObject({ id: "a", pseudo: "Joueura", couleur: j(s, "a").couleur, arme: "pistolet", pv: 77, bouclier: 0 });
    expect(mort.tueur!.distance).toBeCloseTo(20, 6);
    expect(mort.tueur!.p).toEqual([-10, 0, 20]);
  });

  it("circulation PNJ : `ctx.tuer(…, null, \"ecrase_pnj\")` tue sans kill, bouclier ignoré, `par` vide, pas de tueur", () => {
    const { s, t } = duel({ circulation: { circuits: construireCircuits(), voitures: [] } });
    const ctx = fakes.ctxVeh as ContexteSalle;
    j(s, "b").bouclier = 100;
    j(s, "a").serie = 3;
    const sorties = ctx.tuer(j(s, "b"), null, "ecrase_pnj", t);
    const [mort] = messages(sorties, "mort");
    expect(mort).toMatchObject({ cible: "b", par: "", cause: "ecrase_pnj", arme: "couteau", ts: t });
    expect(mort.tueur).toBeUndefined();
    expect(j(s, "b")).toMatchObject({ vivant: false, pv: 0, bouclier: 0, morts: 1 });
    expect(j(s, "a").kills).toBe(0);
    expect(j(s, "a").serie).toBe(3);
    expect(messages(sorties, "presence")).toHaveLength(1);
    // pas deux fois
    expect(ctx.tuer(j(s, "b"), null, "ecrase_pnj", t + 1)).toEqual([]);
  });

  it("renversement : `ctx.tuer(…, conducteur, \"ecrase_vehicule\")` crédite le kill au conducteur", () => {
    const { s, t } = duel({ vehicules: [{ p: [0, 0], cap: 0 }] });
    const ctx = fakes.ctxVeh as ContexteSalle;
    const sorties = ctx.tuer(j(s, "b"), j(s, "a"), "ecrase_vehicule", t);
    expect(messages(sorties, "mort")[0]).toMatchObject({ par: "a", cause: "ecrase_vehicule" });
    expect(messages(sorties, "mort")[0].tueur).toMatchObject({ id: "a" });
    expect(j(s, "a")).toMatchObject({ kills: 1, serie: 1 });
    expect(j(s, "a").killsParArme).toEqual({}); // pas d'arme
  });

  it("la mort libère le siège (service des véhicules) et `sieges` suit `mort`", () => {
    const { s, t } = duel({ vehicules: [{ p: [0, 0], cap: 0 }] });
    fakes.occupations.set("b", { vehicule: 0, siege: 2 });
    const sorties = (fakes.ctxVeh as ContexteSalle).infliger(j(s, "b"), 500, j(s, "a"), "arme", "corps", "pistolet", t);
    const types = sorties.map((x) => x.m.t);
    expect(types.indexOf("sieges")).toBeGreaterThan(types.indexOf("mort"));
    expect(fakes.occupations.has("b")).toBe(false);
  });

  it("l'objectif de kills atteint par un couteau ou un renversement termine le match", () => {
    const { s, t } = duel({ vehicules: [{ p: [0, 0], cap: 0 }] });
    j(s, "a").kills = JEU.objectifKills - 1;
    const sorties = (fakes.ctxVeh as ContexteSalle).tuer(j(s, "b"), j(s, "a"), "ecrase_vehicule", t);
    expect(messages(sorties, "match")[0].match.phase).toBe("entracte");
  });
});

// ---------- occupants de véhicules ----------

describe("occupants de véhicules", () => {
  const options: OptionsSalle = { vehicules: [{ p: [0, 0], cap: 0 }] };

  it("le conducteur ne tire pas, un passager tire avec l'œil du siège rejoué sur l'historique de la voiture", () => {
    const { s, t } = duel(options);
    fakes.occupations.set("a", { vehicule: 0, siege: 1 });
    // la voiture roule à 24 m/s : l'œil déclaré est à 4 m de la position connue de la salle, mais près d'un œil possible
    j(s, "a").p = [-14, 0, 20];
    const { o, d } = regarder(s, "a", [10, 1, 20]);
    const loin: Vec3 = [o[0] + 4, o[1], o[2]];
    expect(s.recevoir("a", { t: "tir", arme: "pistolet", o: loin, d: [d], touches: [] }, t)).toEqual([]); // sans yeux possibles : l'œil à pied
    fakes.yeux.set("a", [[o[0] + 3.5, o[1], o[2]], [o[0] + 4.2, o[1], o[2]]]);
    expect(s.recevoir("a", { t: "tir", arme: "pistolet", o: loin, d: [d], touches: [] }, t + 300)).toHaveLength(1);
    // le conducteur : refusé
    fakes.conducteurs.add("a");
    expect(s.recevoir("a", { t: "tir", arme: "pistolet", o: loin, d: [d], touches: [] }, t + 900)).toEqual([]);
  });

  it("un occupant n'envoie plus que son regard : `p`, `v` et la posture restent ceux de la voiture", () => {
    const { s, t } = duel(options);
    fakes.occupations.set("b", { vehicule: 0, siege: 1 });
    j(s, "b").p = [3, 0, 3]; j(s, "b").v = [20, 0, 0];
    s.recevoir("b", { t: "etat", seq: 7, p: [9999, 0, 0], v: [0, 0, 0], lacet: 1.2, tangage: 0.3, posture: "air", mur: 0 }, t);
    expect(j(s, "b")).toMatchObject({ p: [3, 0, 3], v: [20, 0, 0], lacet: 1.2, tangage: 0.3, seq: 7, etatT: t, posture: "sol" });
  });

  it("l'instantané porte `vehicule` pour un occupant et `vehicules` aux joueurs seulement", () => {
    const { s, t } = duel(options);
    s.connecter("spec", "Spec", T0);
    fakes.occupations.set("b", { vehicule: 3, siege: 2 });
    fakes.snapVehicules.push({ id: 3, p: [1, 0, 2], cap: 0.5, v: 4 });
    const sorties = s.tic(t + 50);
    const joueurs = sorties.find((x) => x.m.t === "snap" && x.a === "joueurs")!.m as Extract<MessageServeur, { t: "snap" }>;
    expect(joueurs.j.find((x) => x.id === "b")).toMatchObject({ vehicule: { id: 3, siege: 2 } });
    expect(joueurs.j.find((x) => x.id === "a")).not.toHaveProperty("vehicule");
    expect(joueurs.vehicules).toEqual([{ id: 3, p: [1, 0, 2], cap: 0.5, v: 4 }]);
    const spec = sorties.find((x) => x.m.t === "snap" && x.a === "spectateurs")!.m as Extract<MessageServeur, { t: "snap" }>;
    expect(spec).not.toHaveProperty("vehicules");
  });

  it("les messages de véhicule sont transmis au service pour un joueur en arène seulement", () => {
    const { s, t } = duel(options);
    s.connecter("spec", "Spec", T0);
    s.recevoir("a", { t: "monter", vehicule: 0 }, t);
    s.recevoir("a", { t: "descendre" }, t);
    s.recevoir("a", { t: "siege", siege: 1 }, t);
    s.recevoir("a", { t: "conduite", seq: 1, vehicule: 0, p: [0, 0, 0], cap: 0, v: 0, lacet: 0, tangage: 0 }, t);
    s.recevoir("spec", { t: "monter", vehicule: 0 }, t);
    expect(fakes.recus).toEqual(["a:monter", "a:descendre", "a:siege", "a:conduite"]);
  });

  it("deconnecter d'un occupant libère le siège AVANT de retirer le joueur et diffuse `sieges`", () => {
    const { s } = duel(options);
    fakes.occupations.set("a", { vehicule: 0, siege: 0 });
    const sorties = s.deconnecter("a", T0 + 10);
    expect(fakes.appels).toContain("liberer:a:present");
    expect(messages(sorties, "sieges")).toHaveLength(1);
    expect(messages(sorties, "presence")[0].joueurs.map((x) => x.id)).toEqual(["b"]);
    expect(s.inspecter("a")).toBeUndefined();
  });
});

// ---------- services : branchement ----------

describe("services Elsa et véhicules", () => {
  it("sans options, aucun service n'est créé ; avec options, les services reçoivent le contexte et leurs réglages", () => {
    nouvelleSalle();
    expect(fakes.ctxElsa).toBeNull();
    expect(fakes.ctxVeh).toBeNull();
    const intervalle = { minMs: 1000, maxMs: 2000 };
    const s = nouvelleSalle({ elsa: { x: -120, z: 39, intervalle }, vehicules: [{ p: [1, 2], cap: 0.3 }] });
    expect(fakes.ctxElsa).toBe(s);
    expect(fakes.optsElsa).toMatchObject({ x: -120, z: 39, intervalle, maintenant: T0 });
    expect(fakes.ctxVeh).toBe(s);
    expect(fakes.optsVeh).toMatchObject({ vehicules: [{ p: [1, 2], cap: 0.3 }], maintenant: T0 });
    const seul = nouvelleSalle({ circulation: { circuits: construireCircuits(), voitures: [] } });
    expect(fakes.ctxVeh).toBe(seul);
  });

  it("le contexte expose la phase, les joueurs et les joueurs en jeu", () => {
    const s = salleEnJeu([{ arme: "pistolet" }], { elsa: { x: 0, z: 0 } });
    s.connecter("z", "Zed", T0);
    const ctx = fakes.ctxElsa as ContexteSalle;
    expect(ctx.enPhaseJeu()).toBe(true);
    expect(ctx.joueur("z")).toBe(j(s, "z"));
    expect(ctx.joueursEnJeu().map((x) => x.id)).toEqual(["a"]);
    s.tic(T0 + JEU.dureeMatchMs);
    expect(ctx.enPhaseJeu()).toBe(false);
  });

  it("tic : régénération, puis Elsa, puis véhicules ; démarrage de match : Elsa et véhicules réinitialisés", () => {
    const s = salleEnJeu([{ arme: "pistolet" }], { elsa: { x: 0, z: 0 }, vehicules: [{ p: [0, 0], cap: 0 }] });
    s.tic(T0 + 100);
    expect(fakes.appels).toEqual(["elsa.tic", "vehicules.tic"]);
    fakes.appels.length = 0;
    s.tic(T0 + JEU.dureeMatchMs);
    s.tic(T0 + JEU.dureeMatchMs + JEU.entracteMs);
    expect(fakes.appels).toContain("elsa.reinitialiser");
    expect(fakes.appels).toContain("vehicules.reinitialiser");
  });

  it("rejoindre : apparition, présence, puis `elsa{etat}` et `sieges` au seul demandeur", () => {
    const s = nouvelleSalle({ elsa: { x: -120, z: 39 }, vehicules: [{ p: [0, 0], cap: 0 }] });
    s.connecter("a", "Alice", T0);
    const sorties = s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0 + 10);
    expect(sorties.map((x) => x.m.t)).toEqual(["apparition", "presence", "elsa", "sieges"]);
    expect(sorties[0].a).toBe("tous");
    expect(sorties[1].a).toBe("tous");
    expect(sorties[2].a).toBe("a");
    expect(sorties[3].a).toBe("a");
    expect(messages(sorties, "elsa")[0]).toMatchObject({ evenement: "etat" });
  });

  it("bienvenue inchangé (ni Elsa ni sièges)", () => {
    const s = nouvelleSalle({ elsa: { x: 0, z: 0 }, vehicules: [{ p: [0, 0], cap: 0 }] });
    const [bienvenue] = messages(s.connecter("a", "Alice", T0), "bienvenue");
    expect(Object.keys(bienvenue).sort()).toEqual(["couleur", "id", "joueurs", "maintenant", "match", "t"]);
    expect(VERSION_PROTOCOLE).toBe(10);
  });
});

// ---------- apparitions ----------

describe("apparitions près du rond-point", () => {
  const monde = construireMonde(scene);
  const reservoir = pointsApparition(scene, monde);
  const rond = trouverRondPoint(scene) ?? ROND_POINT;
  const zone = { centre: rond.centre, ...ZONE_APPARITION };
  const lcg = (graine: number) => { let k = graine; return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648; };
  const distRond = (p: Vec3) => Math.hypot(p[0] - zone.centre[0], p[2] - zone.centre[1]);
  const ecartAngle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const nouvelle = (options: OptionsSalle, graine = 7) => new Salle(monde, reservoir, lcg(graine), T0, options);

  function reapparaitre(s: Salle, id: string, fois: number): Vec3[] {
    const points: Vec3[] = [];
    for (let i = 0; i < fois; i++) {
      j(s, id).vivant = false;
      j(s, id).reapparitionT = T0;
      s.tic(T0 + 100 + i);
      points.push([...j(s, id).p]);
    }
    return points;
  }

  it("tous les points tirés sont dans l'anneau 25–140 m du rond-point, et regardent vers lui à ± 0,6 rad", () => {
    const s = nouvelle({ zoneApparition: zone });
    s.connecter("a", "A", T0);
    s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0);
    for (const p of reapparaitre(s, "a", 150)) {
      expect(distRond(p)).toBeGreaterThanOrEqual(ZONE_APPARITION.rMin - 1e-9);
      expect(distRond(p)).toBeLessThanOrEqual(ZONE_APPARITION.rMax + 1e-9);
    }
    const lacets: number[] = [];
    for (let i = 0; i < 50; i++) {
      j(s, "a").vivant = false; j(s, "a").reapparitionT = T0; s.tic(T0 + 500 + i);
      const p = j(s, "a").p;
      expect(ecartAngle(j(s, "a").lacet, lacetVers([p[0], p[2]], zone.centre))).toBeLessThanOrEqual(0.6 + 1e-9);
      lacets.push(j(s, "a").lacet - lacetVers([p[0], p[2]], zone.centre));
    }
    expect(new Set(lacets.map((l) => l.toFixed(3))).size).toBeGreaterThan(10); // l'écart est bien aléatoire
  });

  it("distance médiane à l'ennemi ≤ 100 m à 2 joueurs", () => {
    const s = nouvelle({ zoneApparition: zone });
    s.connecter("a", "A", T0); s.connecter("b", "B", T0);
    s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0);
    s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, T0);
    const distances: number[] = [];
    const anneau = reservoir.filter(([x, z]) => Math.hypot(x - zone.centre[0], z - zone.centre[1]) <= 140);
    for (let i = 0; i < 300; i++) {
      // l'ennemi est ailleurs dans l'anneau à chaque tirage
      const ennemi = anneau[(i * 37) % anneau.length];
      j(s, "b").p = [ennemi[0], 0, ennemi[1]];
      j(s, "b").vivant = true;
      j(s, "a").vivant = false; j(s, "a").reapparitionT = T0; s.tic(T0 + 100 + i);
      distances.push(Math.hypot(j(s, "a").p[0] - ennemi[0], j(s, "a").p[2] - ennemi[1]));
    }
    distances.sort((x, y) => x - y);
    expect(distances[Math.floor(distances.length / 2)]).toBeLessThanOrEqual(100);
  });

  it("avec `circulation`, aucun point d'apparition à moins de 4 m d'un circuit PNJ ; sans, il y en a", () => {
    const circuits = construireCircuits();
    const avec = nouvelle({ zoneApparition: zone, circulation: { circuits, voitures: [] } });
    avec.connecter("a", "A", T0);
    avec.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0);
    for (const p of reapparaitre(avec, "a", 200)) expect(distanceAuxCircuits(circuits, p[0], p[2])).toBeGreaterThanOrEqual(4 - 1e-9);
    const sans = nouvelle({ zoneApparition: zone });
    sans.connecter("a", "A", T0);
    sans.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0);
    expect(reapparaitre(sans, "a", 200).some((p) => distanceAuxCircuits(circuits, p[0], p[2]) < 4)).toBe(true);
  });

  it("sans `zoneApparition` la règle v1 est inchangée : regard exact vers le centre de l'arène, 6 points les plus éloignés", () => {
    const s = nouvelleSalle();
    s.connecter("a", "A", T0);
    const [ap] = messages(s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0), "apparition");
    const [dx, dz] = [5 - ap.p[0], 5 - ap.p[2]], l = Math.hypot(dx, dz);
    expect(-Math.sin(ap.lacet)).toBeCloseTo(dx / l, 6);
    expect(-Math.cos(ap.lacet)).toBeCloseTo(dz / l, 6);
  });

  it("un anneau vide (carte réduite) retombe sur les points fournis", () => {
    const s = nouvelleSalle({ zoneApparition: { ...zone, centre: [5000, 5000] } });
    s.connecter("a", "A", T0);
    const [ap] = messages(s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0), "apparition");
    expect(POINTS.some(([x, z]) => x === ap.p[0] && z === ap.p[2])).toBe(true);
  });
});

// ---------- instantanés ----------

describe("instantanés v2", () => {
  it("arrondis à la sérialisation (p, v au centime, angles au milliradian), jamais dans l'état interne", () => {
    const { s, t } = duel();
    j(s, "b").p = [10.123456, 0.005, 20.987654];
    j(s, "b").v = [1.23456, -0.0049, 3.33333];
    j(s, "b").lacet = 1.234567; j(s, "b").tangage = -0.0004;
    const e = messages(s.tic(t + 60), "snap")[0].j.find((x) => x.id === "b")!;
    expect(e.p).toEqual([10.12, 0.01, 20.99]);
    expect(e.v).toEqual([1.23, -0, 3.33]);
    expect(e.lacet).toBe(1.235);
    expect(e.tangage).toBeCloseTo(0, 6);
    expect(j(s, "b").p).toEqual([10.123456, 0.005, 20.987654]);
    expect(j(s, "b").lacet).toBe(1.234567);
  });

  it("`bouclier`, `accroupi` et `vehicule` sont absents quand ils sont nuls, présents sinon", () => {
    const { s, t } = duel();
    const nul = messages(s.tic(t + 60), "snap")[0].j[0];
    for (const cle of ["bouclier", "accroupi", "glisse", "vehicule"]) expect(nul).not.toHaveProperty(cle);
    j(s, "a").bouclier = 40;
    const plein = messages(s.tic(t + 120), "snap")[0].j.find((x) => x.id === "a")!;
    expect(plein.bouclier).toBe(40);
  });

  it("joueurs à 20 Hz avec les véhicules ; spectateurs : un snap sur deux, sans véhicules, et seulement s'il y en a", () => {
    const { s, t } = duel({ vehicules: [{ p: [0, 0], cap: 0 }] });
    fakes.snapVehicules.push({ id: 0, p: [1, 0, 1], cap: 0, v: 0 });
    let joueurs = 0, spectateurs = 0;
    const compter = (debut: number, n: number) => {
      for (let k = 0; k < n; k++) {
        for (const x of s.tic(debut + k * 50)) {
          if (x.m.t !== "snap") continue;
          if (x.a === "joueurs") { joueurs++; expect(x.m.vehicules).toHaveLength(1); }
          else if (x.a === "spectateurs") { spectateurs++; expect(x.m).not.toHaveProperty("vehicules"); }
        }
      }
    };
    compter(t, 20); // personne hors arène
    expect(joueurs).toBe(20);
    expect(spectateurs).toBe(0);
    s.connecter("spec", "Spec", T0);
    joueurs = 0;
    compter(t + 2000, 20);
    expect(joueurs).toBe(20);
    expect(spectateurs).toBe(10);
  });

  it("aucun snap quand personne n'est en jeu", () => {
    const s = nouvelleSalle();
    s.connecter("spec", "Spec", T0);
    expect(s.tic(T0 + 100).filter((x) => x.m.t === "snap")).toEqual([]);
  });

  it("le snap de 16 joueurs reste compact", () => {
    const s = nouvelleSalle();
    for (let i = 0; i < 16; i++) {
      s.connecter(`j${i.toString(36)}`, `Agent${i}`, T0);
      s.recevoir(`j${i.toString(36)}`, { t: "rejoindre", arme: "mitraillette" }, T0);
      j(s, `j${i.toString(36)}`).p = [i * 1.23456, 0, i * 0.654321];
      j(s, `j${i.toString(36)}`).v = [3.14159, 0, -2.71828];
    }
    const snap = messages(s.tic(T0 + 100), "snap")[0];
    expect(JSON.stringify(snap).length).toBeLessThan(4200);
  });
});

// ---------- tableau des scores (HUD §3.5) ----------

describe("compteurs et tableau des scores", () => {
  it("tirs, touches, têtes, dégâts, série, armeFav : un tir de pompe compte pour un tir et une touche", () => {
    const { s, t } = duel({}, { arme: "pompe" }, { arme: "pistolet" });
    placer(s, "b", [-10 + 6, 0, 20]);
    const { o, d } = regarder(s, "a", [-4, 1.05, 20]);
    const dirs = directionsTir("pompe", d);
    s.recevoir("a", {
      t: "tir", arme: "pompe", o, d: dirs,
      touches: [0, 1, 2, 3].map((plomb) => ({ cible: "b", zone: plomb === 3 ? "tete" as const : "corps" as const, plomb })),
    }, t);
    expect(j(s, "a")).toMatchObject({ tirs: 1, touches: 1, tetes: 1 });
    expect(j(s, "a").degats).toBe(100 - j(s, "b").pv - j(s, "b").bouclier);
    expect(tirer(s, "a", "b", t + 3000, { declarer: false }).length).toBeGreaterThan(0);
    expect(j(s, "a")).toMatchObject({ tirs: 2, touches: 1 });
    expect(tirer(s, "a", "b", t + 3000).length).toBe(0); // cadence
    expect(j(s, "a").tirs).toBe(2);
  });

  it("un tir refusé (cadence, arme, œil) ne compte pas", () => {
    const { s, t } = duel();
    tirer(s, "a", "b", t);
    tirer(s, "a", "b", t + 10);
    expect(j(s, "a").tirs).toBe(1);
  });

  it("série : +1 par kill sans mourir, remise à 0 à la mort, `serieMax` retient le meilleur ; diffusée dans la présence", () => {
    const { s, t } = duel({ elsa: { x: 0, z: 0 } });
    const c = fakes.ctxElsa as ContexteSalle;
    const A = j(s, "a"), B = j(s, "b");
    c.infliger(B, 1000, A, "arme", "corps", "pistolet", t);
    expect(A).toMatchObject({ serie: 1, serieMax: 1, kills: 1 });
    B.vivant = true; B.pv = 100; B.enJeu = true;
    const sorties = c.infliger(B, 1000, A, "arme", "corps", "mitraillette", t + 10);
    expect(A).toMatchObject({ serie: 2, serieMax: 2, killsParArme: { pistolet: 1, mitraillette: 1 } });
    expect(messages(sorties, "presence")[0].joueurs.find((x) => x.id === "a")).toMatchObject({ kills: 2, serie: 2 });
    expect(messages(sorties, "presence")[0].joueurs.find((x) => x.id === "b")).not.toHaveProperty("serie");
    A.vivant = true; A.pv = 100;
    c.infliger(A, 1000, B, "arme", "corps", "pistolet", t + 20);
    expect(A).toMatchObject({ serie: 0, serieMax: 2 });
  });

  it("armeFav : l'arme du plus grand nombre de kills (égalité : la première), null sans kill", () => {
    const { s, t } = duel({ elsa: { x: 0, z: 0 } });
    const ctx = fakes.ctxElsa as ContexteSalle;
    const A = j(s, "a"), B = j(s, "b");
    expect(s.lignesStats().find((l) => l.id === "a")!.armeFav).toBeNull();
    const tuer = (arme: ArmeFeuId, dt: number) => { B.vivant = true; B.pv = 100; ctx.infliger(B, 1000, A, "arme", "corps", arme, t + dt); };
    tuer("sniper", 0);
    tuer("pistolet", 10);
    expect(s.lignesStats().find((l) => l.id === "a")!.armeFav).toBe("sniper");
    tuer("pistolet", 20);
    expect(s.lignesStats().find((l) => l.id === "a")!.armeFav).toBe("pistolet");
  });

  it("le classement de fin porte toutes les statistiques", () => {
    const { s, t } = duel();
    tirer(s, "a", "b", t);
    const classement = s.classement();
    expect(classement[0]).toMatchObject({ id: "a", serie: 0, serieMax: 0, tirs: 1, touches: 1, tetes: 0, degats: 28, armeFav: null });
    expect(Object.keys(classement[0]).sort()).toEqual(
      ["armeFav", "couleur", "degats", "id", "kills", "morts", "pseudo", "serie", "serieMax", "tetes", "tirs", "touches"]);
  });

  it("remise à zéro à chaque match (kills, morts, statistiques) ; la santé mémorisée est oubliée", () => {
    const { s, t } = duel();
    tirer(s, "a", "b", t);
    j(s, "a").serie = 4; j(s, "a").serieMax = 4; j(s, "a").killsParArme = { pistolet: 3 };
    s.tic(t + JEU.dureeMatchMs);
    const debut = s.tic(t + JEU.dureeMatchMs + JEU.entracteMs);
    expect(messages(debut, "match")[0].classement.every((l) => l.tirs === 0 && l.touches === 0 && l.degats === 0 && l.serieMax === 0)).toBe(true);
    expect(j(s, "a")).toMatchObject({ tirs: 0, touches: 0, tetes: 0, degats: 0, serie: 0, serieMax: 0, killsParArme: {} });
  });

  it("vueScores : réponse immédiate à l'ouverture, puis 1 Hz, et rien aux clients fermés", () => {
    const { s, t } = duel();
    const reponse = s.recevoir("a", { t: "vueScores", ouvert: true }, t);
    expect(reponse).toHaveLength(1);
    expect(reponse[0].a).toBe("a");
    const scores = messages(reponse, "scores")[0];
    expect(scores.lignes.map((l) => l.id).sort()).toEqual(["a", "b"]);
    expect(scores.lignes[0]).toMatchObject({ serie: 0, serieMax: 0, tirs: 0, touches: 0, tetes: 0, degats: 0, armeFav: null, vivant: true, vehicule: false });
    let recus = 0, vers = new Set<string>();
    for (let tt = t + 16; tt <= t + 5000; tt += 16) {
      for (const x of s.tic(tt)) if (x.m.t === "scores") { recus++; vers.add(x.a); }
    }
    expect(recus).toBe(4); // à t + 1, 2, 3 et 4 s
    expect([...vers]).toEqual(["a"]);
    // refermé : plus rien
    s.recevoir("a", { t: "vueScores", ouvert: false }, t + 5100);
    for (let tt = t + 5116; tt <= t + 9000; tt += 16) expect(s.tic(tt).filter((x) => x.m.t === "scores")).toEqual([]);
  });

  it("vueScores : anti-rafale (un immédiat par 250 ms), et la dernière ouverture est servie dès que possible", () => {
    expect(SCORES_ANTI_RAFALE_MS).toBe(250);
    expect(SCORES_PERIODE_MS).toBe(1000);
    const { s, t } = duel();
    expect(s.recevoir("a", { t: "vueScores", ouvert: true }, t)).toHaveLength(1);
    s.recevoir("a", { t: "vueScores", ouvert: false }, t + 50);
    expect(s.recevoir("a", { t: "vueScores", ouvert: true }, t + 100)).toEqual([]); // trop tôt, mais l'état est ouvert
    expect(j(s, "a").scoresOuvert).toBe(true);
    expect(s.tic(t + 200).filter((x) => x.m.t === "scores")).toEqual([]);
    expect(s.tic(t + 260).filter((x) => x.m.t === "scores")).toHaveLength(1);
    expect(s.tic(t + 300).filter((x) => x.m.t === "scores")).toEqual([]);
    // flot d'ouvertures : au plus 4 réponses par seconde
    let reponses = 0;
    for (let k = 0; k < 90; k++) {
      reponses += s.recevoir("a", { t: "vueScores", ouvert: k % 2 === 0 }, t + 1000 + k * 11).filter((x) => x.m.t === "scores").length;
    }
    expect(reponses).toBeLessThanOrEqual(4);
  });

  it("vueScores d'un client hors arène ou mal formé : ignoré ; l'état « ouvert » est oublié à la sortie", () => {
    const { s, t } = duel();
    s.connecter("spec", "Spec", T0);
    expect(s.recevoir("spec", { t: "vueScores", ouvert: true }, t)).toEqual([]);
    expect(j(s, "spec").scoresOuvert).toBe(false);
    expect(s.recevoir("a", { t: "vueScores", ouvert: "oui" as unknown as boolean }, t)).toEqual([]);
    s.recevoir("a", { t: "vueScores", ouvert: true }, t);
    s.recevoir("a", { t: "quitter" }, t + 10);
    expect(j(s, "a").scoresOuvert).toBe(false);
    expect(s.tic(t + 3000).filter((x) => x.m.t === "scores")).toEqual([]);
  });

  it("`scores` signale les vivants et les occupants de véhicule", () => {
    const { s, t } = duel({ vehicules: [{ p: [0, 0], cap: 0 }] });
    j(s, "b").vivant = false;
    fakes.occupations.set("a", { vehicule: 1, siege: 0 });
    const lignes = messages(s.recevoir("a", { t: "vueScores", ouvert: true }, t), "scores")[0].lignes;
    expect(lignes.find((l) => l.id === "a")).toMatchObject({ vivant: true, vehicule: true });
    expect(lignes.find((l) => l.id === "b")).toMatchObject({ vivant: false, vehicule: false });
  });
});

// ---------- débit ----------

describe("débit par client", () => {
  it("minigun 25 tirs/s + `etat` 30 Hz + ping reste sous les 90 messages/s tolérés par le serveur", () => {
    const rafale = 1 / STATS.minigun.cadenceS;
    expect(rafale).toBeCloseTo(25, 6);
    expect(rafale + JEU.etatHz + 1).toBeLessThan(90);
    // scénario complet sur une seconde simulée, messages envoyés par le client « a » (minigun en main)
    const { s, t } = duel();
    j(s, "a").equip.speciale = "minigun"; j(s, "a").munSpeciale = 150;
    s.recevoir("a", { t: "main", slot: "speciale" }, t);
    const tt = t + JEU.degainageMs + 50;
    let envoyes = 0, acceptes = 0, seq = 0;
    for (let ms = 0; ms < 1000; ms++) {
      if (ms % 33 === 0) { s.recevoir("a", etat(++seq, [-10, 0, 20]), tt + ms); envoyes++; }
      if (ms % 40 === 0) { envoyes++; acceptes += tirer(s, "a", "b", tt + ms, { declarer: false }).length > 0 ? 1 : 0; }
      if (ms === 500) { s.recevoir("a", { t: "ping", t0: ms }, tt + ms); envoyes++; }
    }
    expect(envoyes).toBeLessThan(90);
    expect(acceptes).toBeGreaterThanOrEqual(24); // aucun tir de la rafale n'est perdu
  });
});
