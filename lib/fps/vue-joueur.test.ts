import { describe, expect, it } from "vitest";
import type { EtatJoueurSnap, MessageServeur, Vec3 } from "./protocole";
import { SILHOUETTE } from "./protocole";
import { Interpolateur } from "./reseau";
import { directionRegard } from "./vue";
import {
  EchantillonsImage, JournalEvenements, VUE_JOUEUR, VueJoueur, decalageVue, evenementVue, instantPourSujet, poseCubique, poseDuTir, viseeCorrigee,
  type EvenementVue, type PoseVue,
} from "./vue-joueur";

const T0 = 1_000_000;

function etat(id: string, x: number, extra: Partial<EtatJoueurSnap> = {}): EtatJoueurSnap {
  return { id, p: [x, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0, arme: "fusil_assaut", pv: 100, vivant: true, protege: false, ...extra };
}

const tir = (ts: number, id: string, o: Vec3, d: Vec3): EvenementVue => ({ genre: "tir", ts, id, arme: "fusil_assaut", o, d: [d] });
const degats = (ts: number, cible: string, par: string): EvenementVue => ({ genre: "degats", ts, cible, par, degats: 30, pv: 70, zone: "corps" });

describe("evenementVue", () => {
  it("garde le `ts` du serveur, sinon l'instant estimé de réception ; ignore les autres messages", () => {
    const m: MessageServeur = { t: "tir", id: "a", arme: "fusil_assaut", o: [0, 1, 0], d: [[0, 0, -1]], ts: 42 };
    expect(evenementVue(m, 99)).toMatchObject({ genre: "tir", ts: 42, id: "a" });
    const sansTs: MessageServeur = { t: "coup", id: "a", o: [0, 1, 0], d: [0, 0, -1], arme: "couteau" };
    expect(evenementVue(sansTs, 99)).toMatchObject({ genre: "coup", ts: 99 });
    const mort: MessageServeur = { t: "mort", cible: "b", par: "a", arme: "fusil_assaut", cause: "arme", zone: "tete", ts: 7, delai: 4000 };
    expect(evenementVue(mort, 99)).toMatchObject({ genre: "mort", ts: 7, cible: "b", par: "a", zone: "tete" });
    expect(evenementVue({ t: "match", match: { phase: "jeu", fin: 0, objectif: 25 } as never, classement: [] }, 1)).toBeNull();
  });
});

describe("decalageVue et instantPourSujet", () => {
  it("le sujet voyait les autres son ping (borné) plus son interpolation plus tôt", () => {
    expect(decalageVue(60, 110)).toBe(170);
    expect(decalageVue(undefined, 110)).toBe(110);
    expect(decalageVue(-5, 110)).toBe(110);
    expect(decalageVue(5000, 150)).toBe(VUE_JOUEUR.pingMaxMs + 150);
  });

  it("ses propres tirs et coups à leur instant ; le reste (tirs des autres, dégâts, morts) un aller-retour plus tard", () => {
    expect(instantPourSujet(tir(100, "s", [0, 0, 0], [0, 0, -1]), "s", 80)).toBe(100);
    expect(instantPourSujet(tir(100, "x", [0, 0, 0], [0, 0, -1]), "s", 80)).toBe(180);
    expect(instantPourSujet(degats(100, "x", "s"), "s", 80)).toBe(180);
  });
});

describe("JournalEvenements", () => {
  it("trié par instant même si les messages arrivent dans le désordre, purgé derrière le plus récent", () => {
    const j = new JournalEvenements(1000);
    j.ajouter(degats(500, "b", "a"));
    j.ajouter(degats(100, "b", "a"));
    j.ajouter(degats(300, "b", "a"));
    expect(j.entre(0, 1000).map((e) => e.ts)).toEqual([100, 300, 500]);
    expect(j.entre(200, 400).map((e) => e.ts)).toEqual([300]);
    j.ajouter(degats(1400, "b", "a"));
    // plus récent 1400 → tout ce qui a plus de 1000 ms de retard part
    expect(j.entre(0, 2000).map((e) => e.ts)).toEqual([500, 1400]);
    j.ajouter({ ...degats(0, "b", "a"), ts: Number.NaN });
    expect(j.taille).toBe(2);
    j.vider();
    expect(j.taille).toBe(0);
  });
});

describe("viseeCorrigee", () => {
  /** base : le sujet regarde droit devant (lacet 0, tangage 0), œil en (t/1000, 1.6, 0) */
  const base = (ts: number): PoseVue => ({ pos: [ts / 1000, 1.6, 0], lacet: 0, tangage: 0 });
  const pose = (lacet: number, tangage: number, x: number): PoseVue => ({ pos: [x, 1.6, 0], lacet, tangage });

  it("sans tir : la pose des snaps", () => {
    expect(viseeCorrigee(base, [], 500, 50)).toEqual(base(500));
  });

  it("à l'instant du tir la caméra est EXACTEMENT sur l'œil et l'axe du tir, l'écart s'efface en `largeurMs`", () => {
    const tirs = [{ ts: 1000, pose: pose(0.3, -0.1, 1.2) }];
    const a = viseeCorrigee(base, tirs, 1000, 50)!;
    expect(a.lacet).toBeCloseTo(0.3, 10);
    expect(a.tangage).toBeCloseTo(-0.1, 10);
    expect(a.pos[0]).toBeCloseTo(1.2, 10);
    // à mi-chemin : la moitié de l'écart
    const m = viseeCorrigee(base, tirs, 1025, 50)!;
    expect(m.lacet).toBeCloseTo(0.15, 10);
    expect(viseeCorrigee(base, tirs, 975, 50)!.lacet).toBeCloseTo(0.15, 10);
    // au-delà : les snaps
    expect(viseeCorrigee(base, tirs, 1060, 50)!.lacet).toBeCloseTo(0, 10);
    expect(viseeCorrigee(base, tirs, 940, 50)!.lacet).toBeCloseTo(0, 10);
  });

  it("rafale : entre deux tirs rapprochés, l'écart passe de l'un à l'autre (jamais de retour aux snaps entre deux balles)", () => {
    const tirs = [{ ts: 1000, pose: pose(0.2, 0, 1) }, { ts: 1080, pose: pose(0.4, 0, 1.08) }];
    expect(viseeCorrigee(base, tirs, 1000, 50)!.lacet).toBeCloseTo(0.2, 10);
    expect(viseeCorrigee(base, tirs, 1040, 50)!.lacet).toBeCloseTo(0.3, 10);
    expect(viseeCorrigee(base, tirs, 1080, 50)!.lacet).toBeCloseTo(0.4, 10);
  });

  it("lacet : l'écart passe par le plus court chemin autour de ±π", () => {
    const b = (): PoseVue => ({ pos: [0, 1.6, 0], lacet: Math.PI - 0.05, tangage: 0 });
    const r = viseeCorrigee(b, [{ ts: 0, pose: { pos: [0, 1.6, 0], lacet: -Math.PI + 0.05, tangage: 0 } }], 0, 50)!;
    expect(Math.cos(r.lacet)).toBeCloseTo(Math.cos(-Math.PI + 0.05), 10);
    expect(Math.abs(r.lacet - (Math.PI - 0.05))).toBeCloseTo(0.1, 10);
  });

  it("sujet absent : null", () => {
    expect(viseeCorrigee(() => null, [], 0, 50)).toBeNull();
  });
});

describe("poseDuTir", () => {
  it("l'œil et les angles de la direction du premier plomb", () => {
    const d = directionRegard(0.7, -0.2);
    const p = poseDuTir({ genre: "tir", ts: 0, id: "a", arme: "fusil_assaut", o: [1, 2, 3], d: [d] })!;
    expect(p.pos).toEqual([1, 2, 3]);
    expect(p.lacet).toBeCloseTo(0.7, 10);
    expect(p.tangage).toBeCloseTo(-0.2, 10);
    expect(poseDuTir({ genre: "tir", ts: 0, id: "a", arme: "fusil_assaut", o: [0, 0, 0], d: [[0, 0, 0]] })).toBeNull();
  });
});

describe("VueJoueur", () => {
  /** Le sujet S immobile en x = 0, regard lacet 0 ; la cible C court de 1 m/s le long de x depuis x = 10 à T0. 20 Hz. */
  function source(): Interpolateur {
    const it = new Interpolateur(5000);
    for (let ts = T0 - 3000; ts <= T0 + 1000; ts += 50) it.ajouter({ ts, j: [etat("S", 0), etat("C", 10 + (ts - T0) / 1000)] });
    return it;
  }

  it("caméra : l'œil du sujet, recalée sur son tir du journal", () => {
    const src = source();
    const j = new JournalEvenements();
    const v = new VueJoueur(50);
    const sansTir = v.camera(src, j, "S", T0)!;
    expect(sansTir.pos[1]).toBeCloseTo(SILHOUETTE.oeil, 10);
    expect(sansTir.lacet).toBeCloseTo(0, 10);
    // il a tiré à T0 vers la droite (lacet −0,4) : à T0 la caméra regarde là
    j.ajouter(tir(T0, "S", [0, SILHOUETTE.oeil, 0], directionRegard(-0.4, 0.05)));
    const c = v.camera(src, j, "S", T0)!;
    expect(c.lacet).toBeCloseTo(-0.4, 10);
    expect(c.tangage).toBeCloseTo(0.05, 10);
    // le tir d'un autre ne bouge pas la caméra
    const j2 = new JournalEvenements();
    j2.ajouter(tir(T0, "C", [0, SILHOUETTE.oeil, 0], directionRegard(-0.4, 0)));
    expect(v.camera(src, j2, "S", T0)!.lacet).toBeCloseTo(0, 10);
    expect(v.camera(src, j, "absent", T0)).toBeNull();
  });

  it("autres : les joueurs à l'instant où le sujet les voyait, sans le sujet", () => {
    const v = new VueJoueur(50);
    const m = v.autres(source(), "S", T0, 200);
    expect(m.has("S")).toBe(false);
    expect(m.get("C")!.p[0]).toBeCloseTo(9.8, 6);
  });

  it("aJouer : chaque événement une seule fois, à l'instant où le sujet l'a vécu, rien d'avant le début de la vue", () => {
    const j = new JournalEvenements();
    const v = new VueJoueur(50);
    j.ajouter(tir(T0 - 500, "S", [0, 1.6, 0], [0, 0, -1])); // avant la vue
    j.ajouter(tir(T0 + 100, "S", [0, 1.6, 0], [0, 0, -1]));
    j.ajouter(degats(T0 + 100, "C", "S")); // confirmation : un aller-retour (80 ms) plus tard pour S
    j.ajouter(tir(T0 + 150, "C", [10, 1.6, 0], [-1, 0, 0]));
    v.repartir(T0);
    expect(v.aJouer(j, "S", 80, T0 + 50)).toEqual([]);
    const a = v.aJouer(j, "S", 80, T0 + 150);
    expect(a.map((e) => `${e.genre}:${e.ts}`)).toEqual(["tir:" + (T0 + 100)]);
    const b = v.aJouer(j, "S", 80, T0 + 250);
    // dégâts vécus à T0 + 180, tir de C à T0 + 230 : dans l'ordre où S les a vus
    expect(b.map((e) => `${e.genre}:${e.ts}`)).toEqual(["degats:" + (T0 + 100), "tir:" + (T0 + 150)]);
    expect(v.aJouer(j, "S", 80, T0 + 400)).toEqual([]);
  });

  it("aJouer : un message arrivé en retard dans le journal est rattrapé (une fois), un trop vieux jamais", () => {
    const j = new JournalEvenements();
    const v = new VueJoueur(50);
    v.repartir(T0);
    expect(v.aJouer(j, "S", 0, T0 + 200)).toEqual([]);
    j.ajouter(tir(T0 + 150, "S", [0, 1.6, 0], [0, 0, -1]));
    expect(v.aJouer(j, "S", 0, T0 + 220)).toHaveLength(1);
    expect(v.aJouer(j, "S", 0, T0 + 240)).toHaveLength(0);
    expect(v.aJouer(j, "S", 0, T0 + 1000)).toHaveLength(0);
    // 990 ms de retard sur le curseur : au-delà du rattrapage (400 ms), jamais joué
    j.ajouter(tir(T0 + 10, "S", [0, 1.6, 0], [0, 0, -1]));
    expect(v.aJouer(j, "S", 0, T0 + 1020)).toHaveLength(0);
  });

  it("repartir : un nouveau sujet ne rejoue pas le passé", () => {
    const j = new JournalEvenements();
    const v = new VueJoueur(50);
    j.ajouter(tir(T0, "S", [0, 1.6, 0], [0, 0, -1]));
    v.repartir(T0 + 10);
    expect(v.aJouer(j, "S", 0, T0 + 100)).toEqual([]);
  });
});

describe("poseCubique (caméra fluide entre les snaps)", () => {
  /** Snaps à 10 Hz d'un joueur qui tourne à vitesse constante (1 rad/s) et court à 5 m/s le long de x. */
  function tampon(): Interpolateur {
    const it = new Interpolateur(5000);
    for (let ts = T0; ts <= T0 + 2000; ts += 100) {
      const s = (ts - T0) / 1000;
      it.ajouter({ ts, j: [etat("S", 5 * s, { v: [5, 0, 0], lacet: s, tangage: 0.1 * Math.sin(3 * s) })] });
    }
    return it;
  }

  it("voisins : les snaps qui encadrent l'instant (2 avant, 2 après), rien hors du tampon", () => {
    const it = tampon();
    expect(it.voisins(T0 + 1050, "S").map((x) => x.ts)).toEqual([T0 + 900, T0 + 1000, T0 + 1100, T0 + 1200]);
    expect(it.voisins(T0 + 50, "S").map((x) => x.ts)).toEqual([T0, T0 + 100, T0 + 200]);
    expect(it.voisins(T0 + 2000, "S")).toEqual([]);
    expect(it.voisins(T0 - 1, "S")).toEqual([]);
    expect(it.voisins(T0 + 1050, "absent")).toEqual([]);
  });

  it("passe exactement par les snaps et suit la vraie trajectoire entre eux (vitesse du snap pour la position)", () => {
    const it = tampon();
    for (const t of [T0 + 1000, T0 + 1030, T0 + 1050, T0 + 1080]) {
      const p = poseCubique(it.voisins(t, "S"), t)!;
      const s = (t - T0) / 1000;
      expect(p.pos[0]).toBeCloseTo(5 * s, 6);
      expect(p.pos[1]).toBeCloseTo(SILHOUETTE.oeil, 6);
      // rotation uniforme : Catmull-Rom la reproduit exactement
      expect(p.lacet).toBeCloseTo(s, 6);
    }
  });

  it("plus lisse que la ligne brisée : la vitesse angulaire ne saute pas au passage d'un snap", () => {
    const it = new Interpolateur(5000);
    // le joueur accélère sa rotation : lacet = s²
    for (let ts = T0; ts <= T0 + 2000; ts += 100) { const s = (ts - T0) / 1000; it.ajouter({ ts, j: [etat("S", 0, { lacet: s * s })] }); }
    const lac = (t: number) => poseCubique(it.voisins(t, "S"), t)!.lacet;
    const lin = (t: number) => it.echantillon(t).get("S")!.lacet;
    const saut = (f: (t: number) => number) => Math.abs((f(T0 + 1001) - f(T0 + 1000)) - (f(T0 + 1000) - f(T0 + 999)));
    expect(saut(lac)).toBeLessThan(saut(lin) / 5);
  });

  it("téléportation ou mort : pas de courbe (null), lacet déroulé autour de ±π", () => {
    const tele = [
      { ts: 0, e: etat("S", 0) }, { ts: 100, e: etat("S", 50) },
    ];
    expect(poseCubique(tele, 50)).toBeNull();
    const mort = [{ ts: 0, e: etat("S", 0) }, { ts: 100, e: etat("S", 1, { vivant: false }) }];
    expect(poseCubique(mort, 50)).toBeNull();
    const pi = [{ ts: 0, e: etat("S", 0, { lacet: Math.PI - 0.1 }) }, { ts: 100, e: etat("S", 0, { lacet: -Math.PI + 0.1 }) }];
    const p = poseCubique(pi, 50)!;
    expect(Math.cos(p.lacet)).toBeCloseTo(-1, 4);
  });

  it("EchantillonsImage : un seul calcul par instant et par image", () => {
    let n = 0;
    const it = tampon();
    const c = new EchantillonsImage({ echantillon: (ts) => { n++; return it.echantillon(ts); }, voisins: (ts, id) => it.voisins(ts, id) });
    c.echantillon(T0 + 500);
    c.echantillon(T0 + 500);
    expect(n).toBe(1);
    // les autres d'une vue ne touchent pas la Map partagée
    new VueJoueur(100).autres(c, "S", T0 + 500, 0);
    expect(c.echantillon(T0 + 500).has("S")).toBe(true);
    c.vider();
    c.echantillon(T0 + 500);
    expect(n).toBe(2);
    expect(c.voisins(T0 + 550, "S")).toHaveLength(4);
  });
});
