import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { MELEE } from "./armes";
import type { Vec3 } from "./protocole";
import { INTERACTIONS_SECRET, SECRET_CARTE, construireMondeZombies, etiqueterZones, local, zoneEn, type ObjetSecret } from "./zombies-carte";
import {
  ETAPES_SECRET, SECRET, SECRET_SERVI, besoinBillot, besoinMarmite, coupsSonnes, creerSecret, dansMidi, dernierMidi, etapeDe, heurePendules,
  morseAllume, objetTouche, rayonSphere, sequenceMorse, type ContexteSecret, type EffetSecret, type Secret,
} from "./zombies-secret";

/**
 * Grand secret « Le Menu fantôme » : chaque étape seule (déclencheur juste, faux, trop tôt), les échecs et la reprise, sur le vrai monde de la
 * carte « Service de midi » (tirs et coups visés depuis des positions de joueur réelles). L'enchaînement complet par le service de la salle est
 * dans match-zombies.test.ts. Solution : docs/superpowers/specs/2026-10-29-zombies-secret-SOLUTION.md
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMondeZombies(scene);
const T = 1_000_000;

function suite(graine = 3): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}
const ctx = (o: Partial<ContexteSecret> = {}): ContexteSecret => ({
  t: T, phase: "manche", courant: true, mancheTruck: false, numeroTruck: 0, truck: null, joueurs: 1, ...o,
});
const nouveau = (etapeDepart?: number, periodeMidiMs?: number): Secret => {
  const s = creerSecret({ monde, alea: suite(), ...(etapeDepart !== undefined ? { etapeDepart } : {}), ...(periodeMidiMs ? { periodeMidiMs } : {}) });
  s.reinitialiser(T);
  return s;
};
const quoi = (e: EffetSecret[]) => e.map((x) => x.quoi);
const norme = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
/** Œil d'un joueur debout en (x, z) et direction vers le centre de l'objet. */
const visee = (pos: Vec2, ob: ObjetSecret): { o: Vec3; d: Vec3 } => {
  const o: Vec3 = [pos[0], 1.62, pos[1]];
  return { o, d: norme([ob.c[0] - o[0], ob.c[1] - o[1], ob.c[2] - o[2]]) };
};
const C = SECRET_CARTE;
const COUTEAU = MELEE.couteau;
/** Point de tir dans la cuisine, à l'ouest du piano (les casseroles pendent au-dessus). */
const EN_CUISINE: Vec2 = local(70, -9.5, -9.5);
/** Point de tir dans l'open space, entre les îlots de bureaux. */
const EN_OPEN: Vec2 = local(72, -11, -5.4);

describe("pendules et midi", () => {
  it("arrêtées sur 11 h 58 ; remontées, midi sonne 2 minutes de cadran plus tard, puis à chaque tour du cadran des heures", () => {
    const P = SECRET.periodeMidiMs;
    expect(heurePendules(0, P, T)).toBe(718);
    expect(heurePendules(T, P, T)).toBe(718);
    const premier = T + (2 * P) / 720;
    expect(dernierMidi(T, P, premier - 1)).toBeNull();
    expect(dernierMidi(T, P, premier)).toBeCloseTo(premier);
    expect(heurePendules(T, P, premier)).toBeCloseTo(0, 6);
    expect(dernierMidi(T, P, premier + 2.5 * P)).toBeCloseTo(premier + 2 * P);
    expect(dansMidi(T, P, premier + 100)).toBe(true);
    expect(dansMidi(T, P, premier + SECRET.fenetreMidiMs + 1)).toBe(false);
    expect(dansMidi(T, P, premier + P + 10)).toBe(true);
    expect(dansMidi(0, P, premier)).toBe(false);
    // douze coups, un toutes les 0,6 s
    expect(coupsSonnes(T, P, premier + 10)).toBe(1);
    expect(coupsSonnes(T, P, premier + 11 * SECRET.coupMidiMs + 10)).toBe(12);
    expect(coupsSonnes(T, P, premier + 12 * SECRET.coupMidiMs + 10)).toBe(0);
  });

  it("morse : MIDI = -- .. -.. .. ; un chiffre = cinq signes ; l'ampoule suit l'horloge serveur", () => {
    const s = sequenceMorse("MIDI");
    expect(s.allume.map(([a, b]) => b - a)).toEqual([3, 3, 1, 1, 3, 1, 1, 1, 1]);
    // trois unités entre deux lettres, une entre deux signes
    expect(s.allume[2][0] - s.allume[1][1]).toBe(3);
    expect(s.allume[1][0] - s.allume[0][1]).toBe(1);
    expect(sequenceMorse("5").allume).toHaveLength(5);
    expect(sequenceMorse("8").allume.map(([a, b]) => b - a)).toEqual([3, 3, 3, 1, 1]);
    expect(morseAllume("MIDI", 0)).toBe(true);
    expect(morseAllume("MIDI", 3.5 * 280)).toBe(false);
    expect(morseAllume("MIDI", s.cycle * 280 + 10)).toBe(true);
  });
});

describe("géométrie", () => {
  it("rayon et sphère : entrée, manqué, au-delà de la portée, œil dedans", () => {
    expect(rayonSphere([0, 0, 0], [1, 0, 0], [5, 0, 0], 1, 10)).toBeCloseTo(4);
    expect(rayonSphere([0, 0, 0], [0, 1, 0], [5, 0, 0], 1, 10)).toBeNull();
    expect(rayonSphere([0, 0, 0], [1, 0, 0], [5, 0, 0], 1, 3)).toBeNull();
    expect(rayonSphere([5, 0, 0], [1, 0, 0], [5, 0, 0], 1, 3)).toBe(0);
  });

  it("chaque objet du secret est dans sa zone, et tout objet à viser se voit depuis un point de sa zone (aucun mur entre)", () => {
    const zones = etiqueterZones(monde);
    // (les casseroles pendent au-dessus du piano : leur zone est celle d'où on les vise, testée plus bas)
    const tous = [...C.pendules, C.marmite, ...C.cuves, C.four, C.billot, C.cloche, ...C.ecrans];
    for (const ob of tous) expect(zoneEn(zones, ob.position[0], ob.position[1]), ob.id).toBe(ob.zone);
    for (const it of INTERACTIONS_SECRET) expect(zoneEn(zones, it.position[0], it.position[1]), it.id).not.toBeNull();
    for (const ob of C.casseroles) expect(objetTouche(monde, visee(EN_CUISINE, ob).o, [visee(EN_CUISINE, ob).d], [ob], 100), ob.id).not.toBeNull();
    for (const ob of C.ecrans) expect(objetTouche(monde, visee(EN_OPEN, ob).o, [visee(EN_OPEN, ob).d], [ob], 100), ob.id).not.toBeNull();
    // à travers un mur : la casserole ne se touche pas depuis la Cour Centre
    const dehors: Vec2 = local(70, -16, -9.5);
    expect(objetTouche(monde, visee(dehors, C.casseroles[0]).o, [visee(dehors, C.casseroles[0]).d], [C.casseroles[0]], 100)).toBeNull();
  });
});

describe("étapes", () => {
  it("1. pendules : rien sans courant ; un coup de couteau sur chacune des quatre pendules arrêtées les fait repartir ensemble", () => {
    const s = nouveau();
    const p0 = C.pendules[0];
    const v = visee(p0.position, p0);
    expect(s.coup("a", v.o, v.d, COUTEAU.portee, COUTEAU.cosCone, ctx({ courant: false }))).toEqual([]);
    // trop loin (5 m) : rien
    const loin = visee([p0.position[0] + (p0.facade!.normale[0] * 4), p0.position[1] + (p0.facade!.normale[1] * 4)], p0);
    expect(s.coup("a", loin.o, loin.d, COUTEAU.portee, COUTEAU.cosCone, ctx())).toEqual([]);
    // le couteau tourné à 90° : rien
    expect(s.coup("a", v.o, [v.d[2], 0, -v.d[0]], COUTEAU.portee, COUTEAU.cosCone, ctx())).toEqual([]);
    for (let i = 0; i < 4; i++) {
      const ob = C.pendules[i];
      const w = visee(ob.position, ob);
      const e = s.coup("a", w.o, w.d, COUTEAU.portee, COUTEAU.cosCone, ctx({ t: T + i * 1000 }));
      expect(e[0], ob.id).toMatchObject({ quoi: "pendule", i });
      // la même pendule ne compte qu'une fois
      expect(s.coup("a", w.o, w.d, COUTEAU.portee, COUTEAU.cosCone, ctx({ t: T + i * 1000 + 10 }))).toEqual([]);
      if (i < 3) expect(s.etat().pendulesT).toBe(0);
      else expect(quoi(e)).toEqual(["pendule", "pendules"]);
    }
    expect(s.etape()).toBe(etapeDe("casseroles"));
    expect(s.etat()).toMatchObject({ pendules: 15, pendulesT: T + 3000 });
    // la pendule du Local technique n'en fait pas partie
    const loc = C.pendules[4];
    const w = visee(loc.position, loc);
    expect(nouveau().coup("a", w.o, w.d, COUTEAU.portee, COUTEAU.cosCone, ctx())).toEqual([]);
  });

  it("2. casseroles : dans l'ordre de l'ardoise (tiré à chaque partie) ; une fausse note remet à zéro ; rien avant les pendules", () => {
    const avant = nouveau();
    const v0 = visee(EN_CUISINE, C.casseroles[0]);
    expect(avant.tir("a", v0.o, [v0.d], 100, ctx())).toEqual([]);
    const s = nouveau(etapeDe("casseroles"));
    const ordre = s.etat().ardoise;
    expect([...ordre].sort()).toEqual([0, 1, 2, 3]);
    const tirer = (i: number) => { const v = visee(EN_CUISINE, C.casseroles[i]); return s.tir("a", v.o, [v.d], 100, ctx()); };
    expect(tirer(ordre[0])[0]).toMatchObject({ quoi: "casserole", i: ordre[0], k: 0.25 });
    expect(tirer(ordre[1])[0]).toMatchObject({ quoi: "casserole", k: 0.5 });
    expect(tirer(ordre[3])[0]).toMatchObject({ quoi: "casseroles_rate", i: ordre[3] });
    expect(s.etat().casseroles).toBe(0);
    for (const i of ordre.slice(0, 3)) tirer(i);
    expect(quoi(tirer(ordre[3]))).toEqual(["casserole", "casseroles"]);
    expect(s.etape()).toBe(etapeDe("marmite"));
    // le pompe : le plomb le plus proche décide, une seule fois par tir
    const t = nouveau(etapeDe("casseroles"));
    const o = t.etat().ardoise;
    const a = visee(EN_CUISINE, C.casseroles[o[0]]);
    expect(t.tir("a", a.o, [a.d, [a.d[0] + 0.01, a.d[1], a.d[2]], [-a.d[0], a.d[1], -a.d[2]]], 100, ctx())).toHaveLength(1);
    expect(t.etat().casseroles).toBe(1);
    expect(zoneEn(etiqueterZones(monde), EN_CUISINE[0], EN_CUISINE[1])).toBe("cuisine");
  });

  it("3. marmite : seuls les tigres tués autour d'elle PENDANT une livraison comptent ; la manche finie, elle se vide", () => {
    const s = nouveau(etapeDe("marmite"));
    const pres: Vec3 = [C.marmite.c[0] + 3, 0, C.marmite.c[2] + 2];
    expect(s.kill(pres, false, ctx())).toEqual([]);
    const livraison = ctx({ mancheTruck: true, numeroTruck: 1, truck: "livraison" });
    expect(s.kill([C.marmite.c[0] + 8, 0, C.marmite.c[2]], false, livraison)).toEqual([]);
    expect(s.kill(pres, false, livraison)[0]).toMatchObject({ quoi: "marmite", k: 1 / besoinMarmite(1) });
    expect(quoi(s.finManche(livraison))).toEqual(["marmite_vide"]);
    expect(s.etat().marmite).toBe(0);
    let e: EffetSecret[] = [];
    for (let k = 0; k < besoinMarmite(1); k++) e = s.kill(pres, false, livraison);
    expect(quoi(e)).toEqual(["marmite_pleine"]);
    expect(s.etape()).toBe(etapeDe("congelateur"));
    // plus il y a de joueurs, plus il en faut (une livraison à quatre en lâche 32 à 44)
    expect([1, 2, 4].map(besoinMarmite)).toEqual([6, 10, 18]);
  });

  it("4. cuve n° 3 : une grenade qui saute à son pied (courant rétabli) ; ni la cuve n° 2, ni sans courant", () => {
    const s = nouveau(etapeDe("congelateur"));
    const c3 = C.cuves[2].c, c2 = C.cuves[1].c;
    expect(s.explosion([c2[0], 0.1, c2[2] + 1], ctx())).toEqual([]);
    expect(s.explosion([c3[0] + 1, 0.1, c3[2] + 1], ctx({ courant: false }))).toEqual([]);
    expect(s.explosion([c3[0] + 3, 0.1, c3[2]], ctx())).toEqual([]);
    expect(quoi(s.explosion([c3[0] + 1.2, 0.1, c3[2] + 1], ctx()))).toEqual(["congelateur"]);
    expect(s.etape()).toBe(etapeDe("truffe"));
  });

  it("5. truffe : prise à la cuve, posée au four par son porteur en moins de 30 s ; fondue (temps, porteur à terre) : retour à la cuve fermée", () => {
    const pos = (id: string) => INTERACTIONS_SECRET.find((x) => x.id === id)!.position;
    const s = nouveau(etapeDe("truffe"));
    // de loin : rien
    expect(s.interagir("a", "truffe", [pos("truffe")[0] + 6, pos("truffe")[1]], ctx())).toEqual([]);
    expect(quoi(s.interagir("a", "truffe", pos("truffe"), ctx()))).toEqual(["truffe_prise"]);
    expect(s.etat().truffe).toEqual({ porteur: "a", finT: T + SECRET.truffeMs });
    // un seul porteur ; un autre ne la pose pas
    expect(s.interagir("b", "truffe", pos("truffe"), ctx())).toEqual([]);
    expect(s.interagir("b", "four", pos("four"), ctx())).toEqual([]);
    expect(s.tic(ctx({ t: T + SECRET.truffeMs - 1 }))).toEqual([]);
    expect(quoi(s.interagir("a", "four", pos("four"), ctx({ t: T + 20_000 })))).toEqual(["truffe_servie"]);
    expect(s.etape()).toBe(etapeDe("midi"));
    expect(s.etat().truffe).toBeUndefined();

    const f = nouveau(etapeDe("truffe"));
    f.interagir("a", "truffe", pos("truffe"), ctx());
    expect(quoi(f.tic(ctx({ t: T + SECRET.truffeMs + 1 })))).toEqual(["truffe_fondue"]);
    expect(f.etape()).toBe(etapeDe("congelateur"));
    const g = nouveau(etapeDe("truffe"));
    g.interagir("a", "truffe", pos("truffe"), ctx());
    expect(g.joueurTombe("b", ctx())).toEqual([]);
    expect(quoi(g.joueurTombe("a", ctx()))).toEqual(["truffe_fondue"]);
    expect(g.etape()).toBe(etapeDe("congelateur"));
    const h = nouveau(etapeDe("truffe"));
    h.interagir("a", "truffe", pos("truffe"), ctx());
    expect(quoi(h.joueurParti("a", ctx()))).toEqual(["truffe_fondue"]);
  });

  it("6. midi : une arme déposée au Micro-ondes pendant les douze coups ; ni avant, ni après", () => {
    const s = nouveau(etapeDe("midi"));
    const P = SECRET.periodeMidiMs;
    const midi = T + (2 * P) / 720 + P;
    expect(s.pap("a", ctx({ t: midi - 2000 }))).toEqual([]);
    expect(s.pap("a", ctx({ t: midi + SECRET.fenetreMidiMs + 500 }))).toEqual([]);
    expect(s.etat().code).toBeUndefined();
    expect(quoi(s.pap("a", ctx({ t: midi + 3000 })))).toEqual(["midi"]);
    expect(s.etape()).toBe(etapeDe("postits"));
    // le code apparaît (ampoule du Local technique) : quatre chiffres distincts parmi les post-it
    const code = s.etat().code!;
    expect(new Set(code).size).toBe(4);
    for (const n of code) expect(s.etat().postits).toContain(n);
  });

  it("7. post-it : les écrans dont le post-it porte le code, dans l'ordre et en 15 s ; une erreur ou le temps : on reprend", () => {
    const s = nouveau(etapeDe("postits"));
    const { postits, code } = s.etat() as { postits: number[]; code: number[] };
    const ecranDe = (n: number) => postits.indexOf(n);
    const tirer = (i: number, t = T) => { const v = visee(EN_OPEN, C.ecrans[i]); return s.tir("a", v.o, [v.d], 100, ctx({ t })); };
    expect(tirer(ecranDe(code[0]))[0]).toMatchObject({ quoi: "ecran", k: 0.25 });
    const faux = postits.findIndex((n) => !code.includes(n));
    expect(tirer(faux)[0]).toMatchObject({ quoi: "ecrans_rate" });
    tirer(ecranDe(code[0]), T + 100);
    tirer(ecranDe(code[1]), T + 200);
    expect(quoi(s.tic(ctx({ t: T + 100 + SECRET.ecransMs + 1 })))).toEqual(["ecrans_rate"]);
    expect(s.etat().ecrans).toBe(0);
    let e: EffetSecret[] = [];
    code.forEach((n, k) => { e = tirer(ecranDe(n), T + 20_000 + k * 500); });
    expect(quoi(e)).toEqual(["ecran", "ecrans"]);
    expect(s.etape()).toBe(etapeDe("hachoir"));
    expect(s.etat().code).toBeUndefined();
  });

  it("8. billot : des tigres achevés à l'arme blanche près de lui, pas au fusil ni loin", () => {
    const s = nouveau(etapeDe("hachoir"));
    const pres: Vec3 = [C.billot.c[0] + 2, 0, C.billot.c[2]];
    expect(s.kill(pres, false, ctx())).toEqual([]);
    expect(s.kill([C.billot.c[0] + 7, 0, C.billot.c[2]], true, ctx())).toEqual([]);
    expect(s.kill(pres, true, ctx({ phase: "pause" }))).toEqual([]);
    let e: EffetSecret[] = [];
    for (let k = 0; k < besoinBillot(2); k++) e = s.kill(pres, true, ctx({ joueurs: 2 }));
    expect(quoi(e)).toEqual(["billot_plein"]);
    expect(s.etape()).toBe(etapeDe("service"));
  });

  it("9. service : au four pendant la 3e livraison (ou plus), le Truck encore là ; tenu si le Truck saute avant de repartir et que personne ne tombe", () => {
    const four = INTERACTIONS_SECRET.find((x) => x.id === "four")!.position;
    const s = nouveau(etapeDe("service"));
    const livr = (n: number, truck: ContexteSecret["truck"] = "livraison") => ctx({ mancheTruck: true, numeroTruck: n, truck });
    expect(s.interagir("a", "four", four, ctx())).toEqual([]);
    expect(s.interagir("a", "four", four, livr(2))).toEqual([]);
    expect(s.interagir("a", "four", four, livr(3, "depart"))).toEqual([]);
    expect(quoi(s.interagir("a", "four", four, livr(3)))).toEqual(["service"]);
    expect(s.etat().service).toBe(T);
    expect(quoi(s.truck("parti", livr(3)))).toEqual(["service_rate"]);
    s.interagir("a", "four", four, livr(4, "arrivee"));
    expect(quoi(s.joueurTombe("b", livr(4)))).toEqual(["service_rate"]);
    s.interagir("a", "four", four, livr(4));
    expect(quoi(s.finManche(livr(4)))).toEqual(["service_rate"]);
    expect(s.etape()).toBe(etapeDe("service"));
    s.interagir("a", "four", four, livr(5));
    expect(quoi(s.truck("detruit", livr(5)))).toEqual(["servi"]);
    expect(s.etape()).toBe(SECRET_SERVI);
    // la cloche finit la partie, une fois
    const cloche = INTERACTIONS_SECRET.find((x) => x.id === "cloche")!.position;
    expect(quoi(s.interagir("a", "cloche", cloche, ctx({ phase: "pause" })))).toEqual(["victoire"]);
    expect(s.interagir("a", "cloche", cloche, ctx())).toEqual([]);
  });
});

describe("partie", () => {
  it("chaque partie tire de nouveaux ordres ; l'étape de départ des essais considère les précédentes faites", () => {
    const s = creerSecret({ monde, alea: suite(5) });
    s.reinitialiser(T);
    const a = s.etat();
    s.reinitialiser(T + 1);
    const b = s.etat();
    expect([a.ardoise, a.postits].join("|")).not.toBe([b.ardoise, b.postits].join("|"));
    expect([...b.postits].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(b).toMatchObject({ etape: 0, pendules: 0, pendulesT: 0, casseroles: 0, marmite: 0, billot: 0, ecrans: 0 });
    const e = nouveau(etapeDe("midi"));
    expect(e.etat()).toMatchObject({ etape: 5, pendules: 15, pendulesT: T });
    expect(ETAPES_SECRET).toHaveLength(9);
    // sans hasard injecté (la salle) : générateur propre, semé par l'instant du lancement (même instant, mêmes ordres)
    const propre = creerSecret({ monde });
    const ordres = (t: number) => { propre.reinitialiser(t); const e = propre.etat(); return [e.ardoise, e.postits].join("|"); };
    expect(ordres(T)).toBe(ordres(T));
    expect(new Set([T, T + 1, T + 777, T + 54_321].map(ordres)).size).toBeGreaterThan(1);
  });

  it("aucun raccourci : chaque déclencheur est sans effet à une autre étape", () => {
    const pos = (id: string) => INTERACTIONS_SECRET.find((x) => x.id === id)!.position;
    for (let n = 0; n <= SECRET_SERVI; n++) {
      const s = nouveau(n);
      const v = visee(EN_CUISINE, C.casseroles[0]);
      const w = visee(EN_OPEN, C.ecrans[0]);
      const p = C.pendules[0];
      const pv = visee(p.position, p);
      const effets = [
        ...(n !== etapeDe("pendules") ? s.coup("a", pv.o, pv.d, COUTEAU.portee, COUTEAU.cosCone, ctx()) : []),
        ...(n !== etapeDe("casseroles") ? s.tir("a", v.o, [v.d], 100, ctx()) : []),
        ...(n !== etapeDe("postits") ? s.tir("a", w.o, [w.d], 100, ctx()) : []),
        ...(n !== etapeDe("congelateur") ? s.explosion([C.cuves[2].c[0] + 1, 0.1, C.cuves[2].c[2] + 1], ctx()) : []),
        ...(n !== etapeDe("marmite") && n !== etapeDe("hachoir") ? s.kill([C.marmite.c[0], 0, C.marmite.c[2]], true, ctx({ mancheTruck: true })) : []),
        ...(n !== etapeDe("hachoir") && n !== etapeDe("marmite") ? s.kill([C.billot.c[0], 0, C.billot.c[2]], true, ctx()) : []),
        ...(n !== etapeDe("truffe") ? s.interagir("a", "truffe", pos("truffe"), ctx()) : []),
        ...(n !== etapeDe("midi") ? s.pap("a", ctx({ t: T + 1000 })) : []),
        ...(n !== SECRET_SERVI ? s.interagir("a", "cloche", pos("cloche"), ctx()) : []),
      ];
      expect(effets, ETAPES_SECRET[n] ?? "servi").toEqual([]);
      expect(s.etape()).toBe(n);
    }
  });
});
