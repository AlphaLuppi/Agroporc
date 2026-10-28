import { describe, expect, it } from "vitest";
import { construireMonde } from "./collision";
import { InterpolateurTigres, MondeTigres, coupDeMonTigre, tracerTigres, trouverTigreCouteau, type TigreClient } from "./jeu-tigres";
import type { PassageAvion, TigreLargueSnap, Vec3 } from "./protocole";
import { SILHOUETTES_TIGRE } from "./tigre-arene";
import type { SceneData } from "../agroparc3d/types";

function tg(id: string, x: number, extra: Partial<TigreLargueSnap> = {}): TigreLargueSnap {
  return { id, genre: "sauvage", p: [x, 0, 0], cap: 0, etat: "attaque", pose: "debout", pv: 2500, ...extra };
}

/** Monde vide (aucun bâtiment) pour les lignes de vue. */
const mondeVide = construireMonde({ buildings: [], roads: [], pois: [], trees: [] } as unknown as SceneData);

const passage: PassageAvion = { id: 1, depart: [-600, 0], arrivee: [600, 0], altitude: 120, vitesse: 60, debutT: 10_000, finT: 30_000, largageT: 20_000 };

describe("InterpolateurTigres", () => {
  it("interpole position et cap, prend les champs discrets du snap le plus proche et mesure la vitesse", () => {
    const it = new InterpolateurTigres();
    it.ajouter(1000, [tg("t1", 0, { cap: 0.2, etat: "alerte" })]);
    it.ajouter(1050, [tg("t1", 0.5, { cap: 0.6, etat: "attaque" })]);
    const a = it.echantillon(1020).get("t1")!;
    expect(a.p[0]).toBeCloseTo(0.2, 10);
    expect(a.cap).toBeCloseTo(0.36, 10);
    expect(a.etat).toBe("alerte");
    expect(a.v).toBeCloseTo(10, 6);
    expect(it.echantillon(1040).get("t1")!.etat).toBe("attaque");
  });

  it("extrapole le déplacement mesuré, borné à 150 ms", () => {
    const it = new InterpolateurTigres();
    it.ajouter(1000, [tg("t1", 0)]);
    it.ajouter(1050, [tg("t1", 0.5)]);
    expect(it.echantillon(1100).get("t1")!.p[0]).toBeCloseTo(1, 9);
    expect(it.echantillon(5000).get("t1")!.p[0]).toBeCloseTo(0.5 + 1.5, 9);
  });

  it("un saut (tigre allié qui rejoint son lanceur) n'est pas interpolé", () => {
    const it = new InterpolateurTigres();
    it.ajouter(1000, [tg("t1", 0)]);
    it.ajouter(1050, [tg("t1", 40)]);
    expect(it.echantillon(1010).get("t1")!.p[0]).toBe(40);
  });

  it("un snap sans `tigres` vaut aucun tigre, et un tigre retiré disparaît tout de suite", () => {
    const it = new InterpolateurTigres();
    it.ajouter(1000, [tg("t1", 0), tg("t2", 5)]);
    it.ajouter(1050, [tg("t1", 0), tg("t2", 5)]);
    it.retirer("t2");
    expect([...it.echantillon(1020).keys()]).toEqual(["t1"]);
    it.ajouter(1100, undefined);
    expect(it.echantillon(1110).size).toBe(0);
  });
});

describe("MondeTigres", () => {
  it("le sort : gagné, lancé, perdu, seulement pour moi", () => {
    const m = new MondeTigres();
    expect(m.recevoir({ t: "sort", evenement: "gagne", joueur: "autre" }, "moi")).toBe(false);
    expect(m.aCharge()).toBe(false);
    expect(m.recevoir({ t: "sort", evenement: "gagne", joueur: "moi" }, "moi")).toBe(true);
    expect(m.aCharge()).toBe(true);
    m.recevoir({ t: "sort", evenement: "lance", joueur: "moi", tigre: "t3" }, "moi");
    expect(m.aCharge()).toBe(false);
    m.recevoir({ t: "sort", evenement: "gagne", joueur: "moi" }, "moi");
    m.recevoir({ t: "sort", evenement: "perdu", joueur: "moi", raison: "mort" }, "moi");
    expect(m.aCharge()).toBe(false);
  });

  it("évincé de l'arène : la charge tombe sans message, l'avion en cours reste", () => {
    const m = new MondeTigres();
    m.recevoir({ t: "avion", evenement: "passage", avion: passage }, "moi");
    m.recevoir({ t: "sort", evenement: "gagne", joueur: "moi" }, "moi");
    m.perdreCharge();
    expect(m.aCharge()).toBe(false);
    expect(m.avionA(20_000)).not.toBeNull();
  });

  it("l'avion n'existe que de `debutT` à `finT`, même sans message de fin", () => {
    const m = new MondeTigres();
    m.recevoir({ t: "avion", evenement: "passage", avion: passage }, "moi");
    expect(m.avionA(9_999)).toBeNull();
    const a = m.avionA(20_000)!;
    expect(a.p).toEqual([0, 120, 0]);
    // vers +x (est) : cap −π/2 en convention lacet
    expect(a.cap).toBeCloseTo(-Math.PI / 2, 9);
    expect(m.avionA(30_001)).toBeNull();
    m.recevoir({ t: "avion", evenement: "etat", avion: null }, "moi");
    expect(m.avionA(20_000)).toBeNull();
  });

  it("mes tigres alliés ne sont jamais des cibles, ni un tigre mort", () => {
    const m = new MondeTigres();
    m.alimenter(1000, [tg("t1", 5), tg("t2", 8, { genre: "allie", lanceur: "moi" }), tg("t3", 9, { genre: "allie", lanceur: "autre" }), tg("t4", 3, { pv: 0 })]);
    const ids = m.cibles(m.tigresA(1000), "moi").map((c) => c.id).sort();
    expect(ids).toEqual(["t1", "t3"]);
  });

  it("sons : une action nouvelle (bond annoncé, coup de patte) donne un son, une seule fois, jamais au premier regard", () => {
    const m = new MondeTigres();
    const vue = (extra: Partial<TigreLargueSnap>) => new Map<string, TigreClient>([["t1", { ...tg("t1", 0, extra), v: 0 }]]);
    expect(m.sons(vue({ action: "patte", actionT: 100 }))).toEqual([]);
    expect(m.sons(vue({ action: "patte", actionT: 100 }))).toEqual([]);
    expect(m.sons(vue({ action: "patte", actionT: 1300 })).map((s) => s.son)).toEqual(["patte"]);
    expect(m.sons(vue({}))).toEqual([]);
    expect(m.sons(vue({ action: "ramasse", actionT: 2000 })).map((s) => s.son)).toEqual(["rugissement"]);
    expect(m.sons(vue({ action: "bond", actionT: 2600 }))).toEqual([]);
  });

  it("un tigre mort ou parti est retiré avant le snap suivant", () => {
    const m = new MondeTigres();
    m.alimenter(1000, [tg("t1", 5)]);
    m.recevoir({ t: "tigre", evenement: "mort", id: "t1", genre: "sauvage", p: [5, 0, 0], par: "moi" }, "moi");
    expect(m.tigresA(1000).size).toBe(0);
  });
});

describe("visée des tigres", () => {
  const o: Vec3 = [0, 1.6, 10];
  const vers = (x: number, y: number, z: number): Vec3 => {
    const l = Math.hypot(x - o[0], y - o[1], z - o[2]);
    return [(x - o[0]) / l, (y - o[1]) / l, (z - o[2]) / l];
  };

  it("le rayon touche le tigre le plus proche, la tête prime sur le corps", () => {
    const cibles = [{ id: "loin", p: [0, 0, -10] as Vec3, cap: 0, pose: "debout" as const }, { id: "pres", p: [0, 0, 0] as Vec3, cap: 0, pose: "debout" as const }];
    const S = SILHOUETTES_TIGRE.debout;
    const t = tracerTigres(o, vers(0, S.corps.y, 0), 100, cibles)!;
    expect(t.id).toBe("pres");
    expect(t.zone).toBe("corps");
    // cap 0 : la tête est devant (vers −z)
    const tete = tracerTigres(o, vers(0, S.tete.y, -S.tete.avance), 100, cibles)!;
    expect(tete.zone).toBe("tete");
    expect(tracerTigres(o, vers(5, S.corps.y, 0), 100, cibles)).toBeNull();
    expect(tracerTigres(o, vers(0, S.corps.y, 0), 5, cibles)).toBeNull();
  });

  it("couteau : à portée, dans le cône, sinon rien", () => {
    const cible = [{ id: "t1", p: [0, 0, 8.6] as Vec3, cap: Math.PI / 2, pose: "debout" as const }];
    expect(trouverTigreCouteau(mondeVide, o, [0, -0.3, -0.954], cible)?.id).toBe("t1");
    // dos tourné : hors du cône
    expect(trouverTigreCouteau(mondeVide, o, [0, 0, 1], cible)).toBeNull();
    const loin = [{ id: "t1", p: [0, 0, 4] as Vec3, cap: Math.PI / 2, pose: "debout" as const }];
    expect(trouverTigreCouteau(mondeVide, o, vers(0, 1.1, 4), loin)).toBeNull();
  });

  it("reconnaît le coup de patte de mon tigre (source près de lui, loin de mon œil)", () => {
    const tigres = new Map<string, TigreClient>([["t2", { ...tg("t2", 20, { genre: "allie", lanceur: "moi" }), v: 0 }]]);
    expect(coupDeMonTigre([20.5, 0.8, 0], [0, 1.6, 0], tigres, "moi")).toBe(true);
    // mon propre tir : source = mon œil
    expect(coupDeMonTigre([0, 1.6, 0], [0, 1.6, 0], tigres, "moi")).toBe(false);
    expect(coupDeMonTigre([20.5, 0.8, 0], [0, 1.6, 0], tigres, "autre")).toBe(false);
    expect(coupDeMonTigre(undefined, [0, 1.6, 0], tigres, "moi")).toBe(false);
  });
});
