import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { STATS, degatsPlomb, directionsTir } from "./armes";
import { construireMonde, pointsApparition } from "./collision";
import {
  COS_VISEE_MIN, PALETTE, PSEUDO_DEFAUT, Salle, VITESSE_DECLAREE_MAX_H_M_S, VITESSE_MAX_H_M_S, nettoyerPseudo, pseudoUnique,
  type JoueurSalle, type Sortie,
} from "./match";
import { EQUIPEMENT_DEFAUT, JEU, PLAFONDS, SILHOUETTE, type ArmeFeuId, type MessageClient, type MessageServeur, type Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

/** Arène réduite : un seul bâtiment (0..10 × 0..10, h = 12) ; bornes = centroïde (5, 5) ± 25 → [−20, 30]². */
const bat: Building = { h: 12, r: [[0, 0], [10, 0], [10, 10], [0, 10]], c: [5, 5] };
const petit = { ...scene, buildings: [bat], pois: [] } as SceneData;
const mondePetit = construireMonde(petit);
const POINTS: Vec2[] = [[-15, -15], [28, 28], [-15, 28], [28, -15]];
const T0 = 1_000_000;

function nouvelleSalle(alea: () => number = () => 0): Salle {
  return new Salle(mondePetit, POINTS, alea, T0);
}
/** Salle avec n joueurs "a", "b"… connectés ; chacun en jeu avec l'arme demandée. */
function salleEnJeu(armes: ArmeFeuId[], t = T0): Salle {
  const s = nouvelleSalle();
  armes.forEach((arme, i) => {
    const id = String.fromCharCode(97 + i);
    s.connecter(id, `Joueur${id}`, t);
    s.recevoir(id, { t: "rejoindre", arme }, t);
  });
  return s;
}
const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function placer(s: Salle, id: string, p: Vec3) { j(s, id).p = p; j(s, id).v = [0, 0, 0]; }
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}
/** Le tireur vise le centre de la cible (regard orienté pour passer la validation d'angle). */
function tirer(s: Salle, tireur: string, cible: string, t: number, opts: { plombs?: number; touches?: number[]; zone?: "tete" | "corps" } = {}): Sortie[] {
  const a = j(s, tireur), c = j(s, cible);
  const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
  const vx = c.p[0] - o[0], vy = c.p[1] + SILHOUETTE.centreY - o[1], vz = c.p[2] - o[2];
  const l = Math.hypot(vx, vy, vz);
  const d: Vec3 = [vx / l, vy / l, vz / l];
  a.lacet = Math.atan2(-d[0], -d[2]);
  a.tangage = Math.asin(d[1]);
  const n = opts.plombs ?? 1;
  const msg: MessageClient = {
    t: "tir", arme: a.arme as ArmeFeuId, o, d: Array.from({ length: n }, (_, i) => directionsTir(a.arme as ArmeFeuId, d)[i] ?? ([...d] as Vec3)),
    touches: (opts.touches ?? [0]).map((plomb) => ({ cible, zone: opts.zone ?? "corps", plomb })),
  };
  return s.recevoir(tireur, msg, t);
}
/** Deux joueurs en jeu face à face, à 20 m, ligne dégagée, protection d'apparition écoulée. */
function duel(armeA: ArmeFeuId = "pistolet", armeB: ArmeFeuId = "pistolet") {
  const t = T0 + JEU.protectionMs + 100;
  const s = salleEnJeu([armeA, armeB]);
  placer(s, "a", [-10, 0, 20]);
  placer(s, "b", [10, 0, 20]);
  return { s, t };
}

describe("pseudo", () => {
  it("nettoyé : balises, caractères de contrôle, espaces, longueur", () => {
    expect(nettoyerPseudo("  <b>Jo   hn</b>\u0000 ")).toBe("bJo hnb");
    expect(nettoyerPseudo("A".repeat(40))).toBe("A".repeat(16));
    expect(nettoyerPseudo("Élodie_92")).toBe("Élodie_92");
  });
  it("trop court ou inutilisable → Agent", () => {
    for (const brut of ["", " ", "x", "<>", 42, null, undefined]) expect(nettoyerPseudo(brut)).toBe(PSEUDO_DEFAUT);
  });
  it("dédoublonné sans tenir compte de la casse, suffixe dans les 16 caractères", () => {
    const s = nouvelleSalle();
    s.connecter("1", "Léa", T0);
    s.connecter("2", "léa", T0);
    s.connecter("3", "LÉA", T0);
    expect([1, 2, 3].map((i) => j(s, String(i)).pseudo)).toEqual(["Léa", "léa2", "LÉA3"]);
    const long = "B".repeat(16);
    expect(pseudoUnique(long, new Set([long.toLowerCase()]))).toBe("B".repeat(15) + "2");
  });
});

describe("connexion", () => {
  it("bienvenue au nouveau, présence aux autres, couleurs distinctes", () => {
    const s = nouvelleSalle();
    const a = s.connecter("a", "Alice", T0);
    expect(a).toHaveLength(2);
    const [bienvenue] = messages(a, "bienvenue");
    expect(bienvenue).toMatchObject({ id: "a", maintenant: T0 });
    expect(bienvenue.joueurs.map((x) => x.pseudo)).toEqual(["Alice"]);
    expect(bienvenue.match).toMatchObject({ numero: 1, phase: "jeu", fin: T0 + JEU.dureeMatchMs, objectif: JEU.objectifKills });
    expect(a[0].a).toBe("a");
    expect(a[1]).toMatchObject({ a: "tous", sauf: "a" });
    const b = s.connecter("b", "Bob", T0);
    expect(messages(b, "bienvenue")[0].joueurs.map((x) => x.pseudo)).toEqual(["Alice", "Bob"]);
    expect(j(s, "a").couleur).not.toBe(j(s, "b").couleur);
    expect(PALETTE).toContain(j(s, "b").couleur);
    expect(j(s, "a").enJeu).toBe(false);
  });
  it("16 couleurs distinctes pour 16 connectés", () => {
    const s = nouvelleSalle();
    for (let i = 0; i < JEU.joueursMax; i++) s.connecter(`j${i}`, `Agent${i}`, T0);
    expect(new Set([...Array(16).keys()].map((i) => j(s, `j${i}`).couleur)).size).toBe(16);
  });
  it("les spectateurs de la vue 3D n'occupent aucune place de l'arène (régression : 16 sockets bloquaient l'arène)", () => {
    const s = nouvelleSalle();
    for (let i = 0; i < 30; i++) s.connecter(`spec${i}`, `Spec${i}`, T0);
    expect(s.nombreJoueurs()).toBe(30);
    expect(s.nombreEnJeu()).toBe(0);
    // un vrai joueur peut encore entrer, et 16 au total
    for (let i = 0; i < JEU.joueursMax; i++) {
      const sorties = s.recevoir(`spec${i}`, { t: "rejoindre", arme: "pistolet" }, T0 + 10);
      expect(messages(sorties, "apparition")).toHaveLength(1);
    }
    expect(s.nombreEnJeu()).toBe(JEU.joueursMax);
  });
  it("le 17e joueur en arène reçoit un refus `plein` SANS erreur (la socket reste ouverte) et n'entre pas ; une place libérée lui sert", () => {
    const s = nouvelleSalle();
    for (let i = 0; i < JEU.joueursMax + 1; i++) s.connecter(`j${i}`, `Agent${i}`, T0);
    for (let i = 0; i < JEU.joueursMax; i++) s.recevoir(`j${i}`, { t: "rejoindre", arme: "pistolet" }, T0 + 10);
    const refus = s.recevoir("j16", { t: "rejoindre", arme: "pistolet" }, T0 + 20);
    expect(refus).toEqual([{ a: "j16", m: { t: "refus", action: "rejoindre", raison: "plein" } }]);
    expect(messages(refus, "erreur")).toEqual([]);
    expect(j(s, "j16").enJeu).toBe(false);
    expect(s.nombreEnJeu()).toBe(JEU.joueursMax);
    // le refusé reste connecté ; il entre dès qu'une place se libère
    s.recevoir("j0", { t: "quitter" }, T0 + 30);
    expect(messages(s.recevoir("j16", { t: "rejoindre", arme: "pistolet" }, T0 + 40), "apparition")).toHaveLength(1);
  });
  it("le serveur plafonne les connexions (64) : la suivante reçoit erreur plein et n'est pas enregistrée", () => {
    const s = nouvelleSalle();
    for (let i = 0; i < JEU.connexionsMax; i++) s.connecter(`c${i}`, `Agent${i}`, T0);
    const sorties = s.connecter("de-trop", "Trop", T0);
    expect(sorties).toEqual([{ a: "de-trop", m: expect.objectContaining({ t: "erreur", code: "plein" }) }]);
    expect(s.nombreJoueurs()).toBe(JEU.connexionsMax);
    expect(s.deconnecter("de-trop", T0)).toEqual([]);
  });
  it("déconnexion : présence pour tous, plus dans les instantanés", () => {
    const s = salleEnJeu(["pistolet", "pistolet"]);
    const sorties = s.deconnecter("a", T0 + 10);
    expect(sorties).toHaveLength(1);
    expect(messages(sorties, "presence")[0].joueurs.map((x) => x.id)).toEqual(["b"]);
    const snap = messages(s.tic(T0 + 100), "snap")[0];
    expect(snap.j.map((x) => x.id)).toEqual(["b"]);
    expect(s.recevoir("a", { t: "quitter" }, T0 + 200)).toEqual([]);
  });
  it("ping : pong avec l'horloge serveur ; messages d'un inconnu ou mal formés ignorés", () => {
    const s = nouvelleSalle();
    s.connecter("a", "Alice", T0);
    expect(s.recevoir("a", { t: "ping", t0: 123 }, T0 + 5)).toEqual([{ a: "a", m: { t: "pong", t0: 123, maintenant: T0 + 5 } }]);
    expect(s.recevoir("a", { t: "ping", t0: "x" } as unknown as MessageClient, T0)).toEqual([]);
    expect(s.recevoir("inconnu", { t: "quitter" }, T0)).toEqual([]);
    expect(s.recevoir("a", null as unknown as MessageClient, T0)).toEqual([]);
    s.majPing("a", 42.4);
    expect(j(s, "a").ping).toBe(42);
  });
});

describe("entrée dans l'arène", () => {
  it("apparition protégée à un point d'apparition, regard vers le centre, présence mise à jour", () => {
    const s = nouvelleSalle();
    s.connecter("a", "Alice", T0);
    const sorties = s.recevoir("a", { t: "rejoindre", arme: "sniper" }, T0 + 10);
    const [ap] = messages(sorties, "apparition");
    expect(ap).toMatchObject({ id: "a", arme: "sniper", pv: JEU.pvMax });
    expect(POINTS.some(([x, z]) => x === ap.p[0] && z === ap.p[2])).toBe(true);
    expect(ap.p[1]).toBe(0);
    // le centre de l'arène est (5, 5) : le regard (−sin ψ, −cos ψ) y va
    const [dx, dz] = [5 - ap.p[0], 5 - ap.p[2]], l = Math.hypot(dx, dz);
    expect(-Math.sin(ap.lacet)).toBeCloseTo(dx / l, 6);
    expect(-Math.cos(ap.lacet)).toBeCloseTo(dz / l, 6);
    expect(messages(sorties, "presence")[0].joueurs[0].enJeu).toBe(true);
    const snap = messages(s.tic(T0 + 20), "snap")[0];
    expect(snap.j[0]).toMatchObject({ id: "a", vivant: true, protege: true, arme: "sniper", pv: JEU.pvMax });
    expect(messages(s.tic(T0 + 10 + JEU.protectionMs + 100), "snap")[0].j[0].protege).toBe(false);
  });
  it("rejoindre deux fois ne refait pas apparaître ; arme invalide → arme précédente", () => {
    const s = nouvelleSalle();
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "rejoindre", arme: "pompe" }, T0);
    expect(s.recevoir("a", { t: "rejoindre", arme: "pompe" }, T0 + 1)).toEqual([]);
    s.connecter("b", "Bob", T0);
    s.recevoir("b", { t: "rejoindre", arme: "laser" as ArmeFeuId }, T0);
    expect(j(s, "b").arme).toBe("pistolet");
  });
  it("les points d'apparition suivants sont les plus loin des vivants", () => {
    const s = nouvelleSalle(() => 0); // alea = 0 → le meilleur des candidats
    s.connecter("a", "A", T0); s.connecter("b", "B", T0);
    s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0);
    const pa = j(s, "a").p;
    const [ap] = messages(s.recevoir("b", { t: "rejoindre", arme: "pistolet" }, T0), "apparition");
    const dist = (p: Vec3 | Vec2) => Math.hypot((p[0] as number) - pa[0], (p.length === 3 ? (p as Vec3)[2] : (p as Vec2)[1]) - pa[2]);
    expect(dist(ap.p)).toBeCloseTo(Math.max(...POINTS.map(dist)), 6);
  });
  it("quitter : redevient spectateur", () => {
    const s = salleEnJeu(["pistolet"]);
    const sorties = s.recevoir("a", { t: "quitter" }, T0 + 5);
    expect(messages(sorties, "presence")[0].joueurs[0].enJeu).toBe(false);
    expect(s.tic(T0 + 100).filter((x) => x.m.t === "snap")).toEqual([]);
  });
});

describe("états reçus", () => {
  const etat = (seq: number, p: Vec3, extra: Partial<Extract<MessageClient, { t: "etat" }>> = {}): MessageClient =>
    ({ t: "etat", seq, p, v: [3, 0, 0], lacet: 1, tangage: 0.2, posture: "sol", mur: 0, ...extra });

  it("état plausible accepté et diffusé dans l'instantané", () => {
    const s = salleEnJeu(["pistolet"]);
    const [x, , z] = j(s, "a").p;
    s.recevoir("a", etat(1, [x + 1, 0, z]), T0 + 100);
    expect(j(s, "a").p).toEqual([x + 1, 0, z]);
    const e = messages(s.tic(T0 + 120), "snap")[0].j[0];
    expect(e).toMatchObject({ lacet: 1, tangage: 0.2, posture: "sol", v: [3, 0, 0] });
  });
  it("téléportation refusée : la position serveur est gardée, puis un déplacement réaliste passe", () => {
    const s = salleEnJeu(["pistolet"]);
    const avant = [...j(s, "a").p];
    s.recevoir("a", etat(1, [avant[0] + 40, 0, avant[2]]), T0 + 100);
    expect(j(s, "a").p).toEqual(avant);
    s.recevoir("a", etat(2, [avant[0], 30, avant[2]]), T0 + 200); // chute verticale irréaliste
    expect(j(s, "a").p).toEqual(avant);
    // 14 m/s × 1 s + 1 m = 15 m : on peut avoir vraiment couru jusque-là depuis la dernière position acceptée
    s.recevoir("a", etat(3, [avant[0] + 14, 0, avant[2]]), T0 + 1000);
    expect(j(s, "a").p[0]).toBeCloseTo(avant[0] + 14, 6);
  });
  it("hors bornes, non fini, séquence ancienne, posture mort et spectateur ignorés ou corrigés", () => {
    const s = salleEnJeu(["pistolet"]);
    const ref = [...j(s, "a").p];
    s.recevoir("a", etat(1, [ref[0], 0, -60]), T0 + 5000); // hors bornes malgré le temps écoulé
    expect(j(s, "a").p).toEqual(ref);
    s.recevoir("a", etat(2, [Number.NaN, 0, 0]), T0 + 100);
    s.recevoir("a", { ...etat(3, [ref[0], 0, ref[2]]), lacet: "x" } as unknown as MessageClient, T0 + 100);
    expect(j(s, "a").seq).toBe(-1);
    s.recevoir("a", etat(5, [ref[0], 0, ref[2]], { posture: "mort", mur: 5 as 1 }), T0 + 100);
    expect(j(s, "a")).toMatchObject({ posture: "air", mur: 0, seq: 5 });
    s.recevoir("a", etat(4, [ref[0] + 1, 0, ref[2]]), T0 + 200);
    expect(j(s, "a").seq).toBe(5);
    s.connecter("spectateur", "Spec", T0);
    s.recevoir("spectateur", etat(1, [0, 0, 0]), T0 + 100);
    expect(j(s, "spectateur").seq).toBe(-1);
  });
});

describe("réentrée dans l'arène (§13.2.2)", () => {
  const etat = (seq: number, p: Vec3): MessageClient =>
    ({ t: "etat", seq, p, v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 });

  it("après quitter puis rejoindre sur la même connexion, les états repartant de seq 0 sont acceptés", () => {
    const s = salleEnJeu(["pistolet"]);
    const [x, , z] = j(s, "a").p;
    for (let seq = 0; seq < 6; seq++) s.recevoir("a", etat(seq, [x, 0, z]), T0 + 50 + seq * 33);
    expect(j(s, "a").seq).toBe(5);
    s.recevoir("a", { t: "quitter" }, T0 + 400);
    s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0 + 500);
    s.tic(T0 + 400 + JEU.delaiReapparitionMs); // le joueur sorti en vie attend le délai de réapparition avant de revenir
    // le client repart de seq 0 : sans la remise à -1, tous ces états seraient ignorés (et tous les tirs rejetés)
    expect(j(s, "a").seq).toBe(-1);
    const [x2, , z2] = j(s, "a").p;
    s.recevoir("a", etat(0, [x2 + 0.1, 0, z2]), T0 + 400 + JEU.delaiReapparitionMs + 30);
    expect(j(s, "a").seq).toBe(0);
    expect(j(s, "a").p[0]).toBeCloseTo(x2 + 0.1, 6);
  });

  it("une réapparition après la mort remet aussi la séquence à zéro", () => {
    const { s, t } = duel();
    s.recevoir("b", etat(40, [10, 0, 20]), t);
    expect(j(s, "b").seq).toBe(40);
    for (let i = 0; i < 4; i++) tirer(s, "a", "b", t + i * 250);
    expect(j(s, "b").vivant).toBe(false);
    s.tic(t + 750 + JEU.delaiReapparitionMs);
    expect(j(s, "b")).toMatchObject({ vivant: true, seq: -1 });
  });
});

describe("tirs", () => {
  it("touche validée : dégâts calculés par le serveur, tir diffusé aux autres seulement", () => {
    const { s, t } = duel();
    const sorties = tirer(s, "a", "b", t);
    const [tirMsg] = sorties.filter((x) => x.m.t === "tir");
    expect(tirMsg).toMatchObject({ a: "tous", sauf: "a" });
    const [deg] = messages(sorties, "degats");
    const dist = Math.hypot(20, SILHOUETTE.oeil - SILHOUETTE.centreY);
    expect(deg).toMatchObject({ cible: "b", par: "a", degats: degatsPlomb("pistolet", "corps", dist), zone: "corps" });
    expect(deg.degats).toBe(28);
    expect(deg.pv).toBe(JEU.pvMax - 28);
    expect(j(s, "b").pv).toBe(JEU.pvMax - 28);
  });
  it("tête : multiplicateur de l'arme", () => {
    const { s, t } = duel();
    const [deg] = messages(tirer(s, "a", "b", t, { zone: "tete" }), "degats");
    expect(deg).toMatchObject({ degats: 56, zone: "tete" });
  });
  it("cadence excessive refusée, cadence nominale acceptée", () => {
    const { s, t } = duel();
    expect(messages(tirer(s, "a", "b", t), "degats")).toHaveLength(1);
    expect(tirer(s, "a", "b", t + 10)).toEqual([]); // pistolet : 200 ms nominal
    expect(tirer(s, "a", "b", t + 60)).toEqual([]);
    expect(messages(tirer(s, "a", "b", t + 200), "degats")).toHaveLength(1);
    expect(messages(tirer(s, "a", "b", t + 400), "degats")).toHaveLength(1);
    expect(j(s, "b").pv).toBe(JEU.pvMax - 84);
  });
  it("mitraillette : rafale nominale (75 ms) et gigue réseau acceptées, flot à 20 ms refusé", () => {
    const { s, t } = duel("mitraillette", "pistolet");
    let acceptes = 0;
    for (let i = 0; i < 10; i++) acceptes += tirer(s, "a", "b", t + i * 75 + (i % 2 ? 25 : 0)).length > 0 ? 1 : 0;
    expect(acceptes).toBe(10);
    const t2 = t + 5000;
    acceptes = 0;
    for (let i = 0; i < 20; i++) acceptes += tirer(s, "a", "b", t2 + i * 20).length > 0 ? 1 : 0;
    expect(acceptes).toBeLessThanOrEqual(10); // 400 ms à 64 ms l'intervalle + crédit de rafale (max(3 intervalles, 200 ms) = 200 ms)
  });
  it("trop de plombs, arme qui n'est pas la sienne, œil loin du joueur, direction non normalisée ou dans le dos : refusés", () => {
    const { s, t } = duel();
    expect(tirer(s, "a", "b", t, { plombs: 2 })).toEqual([]);
    const a = j(s, "a");
    const base = { t: "tir" as const, arme: "pistolet" as ArmeFeuId, touches: [] };
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    const visee: Vec3 = [-Math.sin(a.lacet) * Math.cos(a.tangage), Math.sin(a.tangage), -Math.cos(a.lacet) * Math.cos(a.tangage)];
    expect(s.recevoir("a", { ...base, arme: "sniper", o, d: [visee] }, t + 1000)).toEqual([]);
    expect(s.recevoir("a", { ...base, o: [o[0] + 10, o[1], o[2]], d: [visee] }, t + 1000)).toEqual([]);
    expect(s.recevoir("a", { ...base, o, d: [[visee[0] * 3, visee[1] * 3, visee[2] * 3]] }, t + 1000)).toEqual([]);
    const dos = visee.map((x) => -x) as Vec3;
    expect(visee[0] * dos[0] + visee[1] * dos[1] + visee[2] * dos[2]).toBeLessThan(COS_VISEE_MIN);
    expect(s.recevoir("a", { ...base, o, d: [dos] }, t + 1000)).toEqual([]);
    expect(s.recevoir("a", { ...base, o, d: [visee] }, t + 1000)).toHaveLength(1); // tir à blanc valide : seulement diffusé
  });
  it("pompe : la gerbe fixe est vérifiée à 0,02 rad près (tous les plombs dans l'axe, ou un plomb déplacé : tir refusé)", () => {
    const { s, t } = duel("pompe", "pistolet");
    placer(s, "b", [-10 + 6, 0, 20]);
    const a = j(s, "a");
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    const c = j(s, "b");
    const v = [c.p[0] - o[0], c.p[1] + SILHOUETTE.centreY - o[1], c.p[2] - o[2]];
    const l = Math.hypot(v[0], v[1], v[2]);
    const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
    a.lacet = Math.atan2(-d[0], -d[2]);
    a.tangage = Math.asin(d[1]);
    const touches = [{ cible: "b", zone: "corps" as const, plomb: 0 }];
    const gerbe = directionsTir("pompe", d);
    // tous les plombs dans l'axe : un client qui supprime la gerbe est refusé (aucun tir diffusé)
    expect(s.recevoir("a", { t: "tir", arme: "pompe", o, d: Array.from({ length: 9 }, () => [...d] as Vec3), touches }, t)).toEqual([]);
    expect(a.tirs).toBe(0);
    // un plomb décalé de 0,06 rad
    const faux = gerbe.map((g, i) => (i === 3 ? ([g[0] + 0.06, g[1], g[2]] as Vec3) : g));
    expect(s.recevoir("a", { t: "tir", arme: "pompe", o, d: faux, touches }, t)).toEqual([]);
    // la vraie gerbe passe
    expect(messages(s.recevoir("a", { t: "tir", arme: "pompe", o, d: gerbe, touches }, t), "degats")).toHaveLength(1);
    expect(a.tirs).toBe(1);
  });
  it("ligne de vue : un bâtiment entre les deux, pas de dégâts", () => {
    const { s, t } = duel();
    placer(s, "a", [-10, 0, 5]);
    placer(s, "b", [20, 0, 5]); // le bâtiment (0..10 × 0..10) est entre les deux
    const sorties = tirer(s, "a", "b", t);
    expect(messages(sorties, "degats")).toEqual([]);
    expect(messages(sorties, "tir")).toHaveLength(1); // le tir est tout de même diffusé (traçante)
    expect(j(s, "b").pv).toBe(JEU.pvMax);
  });
  it("touche déclarée sur un joueur loin du rayon, mauvais plomb, doublon, soi-même, spectateur : sans effet", () => {
    const { s, t } = duel();
    s.connecter("c", "Spec", T0);
    placer(s, "b", [10, 0, 28]); // 8 m à côté du rayon visé
    const a = j(s, "a");
    const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
    const d: Vec3 = [1, 0, 0];
    a.lacet = -Math.PI / 2; a.tangage = 0;
    const touches = [
      { cible: "b", zone: "corps" as const, plomb: 0 },
      { cible: "a", zone: "corps" as const, plomb: 0 },
      { cible: "c", zone: "corps" as const, plomb: 0 },
      { cible: "b", zone: "corps" as const, plomb: 3 },
    ];
    const sorties = s.recevoir("a", { t: "tir", arme: "pistolet", o, d: [d], touches }, t);
    expect(messages(sorties, "degats")).toEqual([]);
  });
  it("pompe : les plombs d'un même tir sur une cible s'additionnent, un plomb ne compte qu'une fois", () => {
    const { s, t } = duel("pompe", "pistolet");
    placer(s, "b", [-10 + 12, 0, 20]); // 12 m
    const sorties = tirer(s, "a", "b", t, { plombs: 9, touches: [0, 1, 2, 3, 4, 4, 2] });
    const [deg] = messages(sorties, "degats");
    const dist = Math.hypot(12, SILHOUETTE.oeil - SILHOUETTE.centreY);
    expect(deg.degats).toBe(5 * degatsPlomb("pompe", "corps", dist));
    expect(deg.degats).toBeGreaterThan(STATS.pompe.degats);
    const tete = messages(tirer(s, "a", "b", t + 2000, { plombs: 9, touches: [0] , zone: "tete" }), "degats")[0];
    expect(tete.zone).toBe("tete");
  });
  it("protection d'apparition : aucun dégât ; tirer l'annule", () => {
    const s = salleEnJeu(["pistolet", "pistolet"]);
    placer(s, "a", [-10, 0, 20]); placer(s, "b", [10, 0, 20]);
    const t = T0 + 200; // dans les 1,5 s de protection
    expect(messages(tirer(s, "a", "b", t), "degats")).toEqual([]);
    expect(j(s, "b").pv).toBe(JEU.pvMax);
    expect(j(s, "a").protegeJusqua).toBe(0);
    expect(messages(s.tic(t + 10), "snap")[0].j.find((x) => x.id === "a")!.protege).toBe(false);
    expect(messages(tirer(s, "b", "a", t + 20), "degats")).toHaveLength(1); // a a tiré : plus protégé
    expect(j(s, "a").pv).toBe(JEU.pvMax - 28);
  });
  it("pas de tir pour un spectateur, un mort, ni pendant l'entracte", () => {
    const { s, t } = duel();
    s.connecter("c", "Spec", T0);
    const o: Vec3 = [0, 1.6, 20];
    expect(s.recevoir("c", { t: "tir", arme: "pistolet", o, d: [[1, 0, 0]], touches: [] }, t)).toEqual([]);
    j(s, "a").vivant = false;
    expect(tirer(s, "a", "b", t)).toEqual([]);
    j(s, "a").vivant = true;
    j(s, "a").kills = JEU.objectifKills - 1;
    tirer(s, "a", "b", t); // 28
    tirer(s, "a", "b", t + 300);
    tirer(s, "a", "b", t + 600);
    tirer(s, "a", "b", t + 900); // mort → objectif atteint → entracte
    expect(s.infoMatch().phase).toBe("entracte");
    const avant = j(s, "b").pv;
    expect(tirer(s, "a", "b", t + 1500)).toEqual([]);
    expect(j(s, "b").pv).toBe(avant);
  });
});

describe("mort, score, réapparition", () => {
  it("4 touches de pistolet tuent : mort, kills/morts, présence, puis réapparition après le délai", () => {
    const { s, t } = duel();
    for (let i = 0; i < 3; i++) tirer(s, "a", "b", t + i * 250);
    expect(j(s, "b").vivant).toBe(true);
    const sorties = tirer(s, "a", "b", t + 750);
    const [mort] = messages(sorties, "mort");
    expect(mort).toMatchObject({ t: "mort", cible: "b", par: "a", arme: "pistolet", zone: "corps", delai: JEU.delaiReapparitionMs });
    // v2 : cause de la mort et horodatage serveur (ancre de la killcam)
    expect(mort.cause).toBe("arme");
    expect(mort.ts).toBe(t + 750);
    const [deg] = messages(sorties, "degats");
    expect(deg.pv).toBe(0);
    const pres = messages(sorties, "presence")[0].joueurs;
    expect(pres.find((x) => x.id === "a")).toMatchObject({ kills: 1, morts: 0 });
    expect(pres.find((x) => x.id === "b")).toMatchObject({ kills: 0, morts: 1 });
    expect(messages(s.tic(t + 800), "snap")[0].j.find((x) => x.id === "b")).toMatchObject({ vivant: false, posture: "mort", pv: 0 });

    // pas de tir sur un mort, état ignoré
    expect(messages(tirer(s, "a", "b", t + 1000), "degats")).toEqual([]);
    s.recevoir("b", { t: "etat", seq: 9, p: [0, 0, 20], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, t + 1000);
    expect(j(s, "b").seq).toBe(-1);

    // arme choisie pendant la mort : appliquée à la réapparition (immédiate)
    s.recevoir("b", { t: "arme", arme: "sniper" }, t + 1200);
    expect(j(s, "b").arme).toBe("sniper");
    placer(s, "a", [-15, 0, -15]); // a près du point (−15, −15) → b réapparaît au plus loin, (28, 28)
    expect(messages(s.tic(t + 750 + JEU.delaiReapparitionMs - 20), "apparition")).toEqual([]);
    const retour = messages(s.tic(t + 750 + JEU.delaiReapparitionMs), "apparition");
    expect(retour).toHaveLength(1);
    expect(retour[0]).toMatchObject({ id: "b", arme: "sniper", pv: JEU.pvMax, p: [28, 0, 28] });
    expect(j(s, "b")).toMatchObject({ vivant: true, pv: JEU.pvMax });
    expect(j(s, "b").protegeJusqua).toBe(t + 750 + JEU.delaiReapparitionMs + JEU.protectionMs);
    // plus d'apparition au tic suivant
    expect(messages(s.tic(t + 750 + JEU.delaiReapparitionMs + 20), "apparition")).toEqual([]);
  });
  it("un tir de pompe peut tuer plusieurs cibles", () => {
    const s = salleEnJeu(["pompe", "pistolet", "pistolet"]);
    placer(s, "a", [-10, 0, 20]); placer(s, "b", [-3, 0, 20]); placer(s, "c", [-3, 0, 19.7]);
    for (const id of ["b", "c"]) j(s, id).pv = 20;
    const t = T0 + 2000;
    const o: Vec3 = [-10, SILHOUETTE.oeil, 20];
    const d: Vec3 = [(7) / Math.hypot(7, 0.72), -0.72 / Math.hypot(7, 0.72), 0];
    j(s, "a").lacet = -Math.PI / 2; j(s, "a").tangage = Math.asin(d[1]);
    const sorties = s.recevoir("a", {
      t: "tir", arme: "pompe", o, d: directionsTir("pompe", d).slice(0, 2),
      touches: [{ cible: "b", zone: "corps", plomb: 0 }, { cible: "c", zone: "corps", plomb: 1 }],
    }, t);
    expect(messages(sorties, "mort").map((m) => m.cible).sort()).toEqual(["b", "c"]);
    expect(j(s, "a").kills).toBe(2);
  });
});

describe("matchs", () => {
  it("objectif de kills atteint : entracte avec classement, puis nouveau match, scores à 0 et tout le monde réapparaît", () => {
    const { s, t } = duel();
    s.connecter("c", "Spec", T0); // spectateur : ne réapparaît pas
    j(s, "a").kills = JEU.objectifKills - 1;
    for (let i = 0; i < 3; i++) tirer(s, "a", "b", t + i * 250);
    const sorties = tirer(s, "a", "b", t + 750);
    const m = messages(sorties, "match");
    expect(m).toHaveLength(1);
    expect(m[0].match).toMatchObject({ numero: 1, phase: "entracte", fin: null, prochain: t + 750 + JEU.entracteMs });
    expect(m[0].classement.map((l) => [l.id, l.kills, l.morts])).toEqual([["a", JEU.objectifKills, 0], ["b", 0, 1]]);
    // la fin est annoncée avant l'éventuelle présence : l'ordre des messages importe peu, mais une seule fin
    expect(s.tic(t + 750 + JEU.entracteMs - 50).filter((x) => x.m.t === "match")).toEqual([]);
    const debut = s.tic(t + 750 + JEU.entracteMs);
    const nouveau = messages(debut, "match")[0];
    expect(nouveau.match).toMatchObject({ numero: 2, phase: "jeu", prochain: null, fin: t + 750 + JEU.entracteMs + JEU.dureeMatchMs });
    expect(nouveau.classement.every((l) => l.kills === 0 && l.morts === 0)).toBe(true);
    expect(messages(debut, "apparition").map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(messages(debut, "presence")[0].joueurs.every((x) => x.kills === 0 && x.morts === 0)).toBe(true);
    expect(j(s, "b")).toMatchObject({ vivant: true, pv: JEU.pvMax });
    expect(j(s, "b").protegeJusqua).toBe(t + 750 + JEU.entracteMs + JEU.protectionMs);
    expect(j(s, "c").enJeu).toBe(false);
    // on peut de nouveau tirer (face à face remis en place, protection écoulée)
    placer(s, "a", [-10, 0, 20]); placer(s, "b", [10, 0, 20]);
    expect(messages(tirer(s, "a", "b", t + 750 + JEU.entracteMs + JEU.protectionMs + 100), "degats")).toHaveLength(1);
  });
  it("durée écoulée : entracte, une seule fois", () => {
    const s = salleEnJeu(["pistolet", "pistolet"]);
    expect(s.tic(T0 + JEU.dureeMatchMs - 1).filter((x) => x.m.t === "match")).toEqual([]);
    const fin = s.tic(T0 + JEU.dureeMatchMs);
    expect(messages(fin, "match")[0].match.phase).toBe("entracte");
    expect(s.tic(T0 + JEU.dureeMatchMs + 20).filter((x) => x.m.t === "match")).toEqual([]);
  });
  it("un joueur qui rejoint pendant l'entracte apparaît tout de suite mais ne peut pas encore tirer", () => {
    const s = salleEnJeu(["pistolet"]);
    s.tic(T0 + JEU.dureeMatchMs);
    s.connecter("z", "Zed", T0 + JEU.dureeMatchMs);
    expect(messages(s.recevoir("z", { t: "rejoindre", arme: "pistolet" }, T0 + JEU.dureeMatchMs + 10), "apparition")).toHaveLength(1);
  });
});

describe("instantanés", () => {
  it("≈ 20 Hz même avec des tics à 60 Hz irréguliers, rien sans joueur en jeu", () => {
    const s = nouvelleSalle();
    s.connecter("a", "Alice", T0);
    expect(s.tic(T0 + 50).filter((x) => x.m.t === "snap")).toEqual([]);
    s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0 + 60);
    let n = 0, dernier = 0;
    for (let t = T0 + 100; t < T0 + 1100; t += 16 + (Math.floor(t / 16) % 3)) {
    // v2 : les spectateurs reçoivent un snap sur deux à part ; on compte ceux des joueurs (20 Hz)
    for (const sortie of s.tic(t)) if (sortie.m.t === "snap" && sortie.a === "joueurs") { n++; expect(sortie.m.ts).toBe(t); dernier = t; }
    }
    expect(dernier).toBeGreaterThan(0);
    expect(n).toBeGreaterThanOrEqual(17);
    expect(n).toBeLessThanOrEqual(21);
  });
});

describe("sur le vrai scene.json", () => {
  const monde = construireMonde(scene);
  const apparitions = pointsApparition(scene, monde);
  it("16 joueurs apparaissent dans les bornes, hors bâtiments, sans partager leur point", () => {
    let k = 0;
    const alea = () => ((k = (k * 1103515245 + 12345) % 2147483648) / 2147483648);
    const s = new Salle(monde, apparitions, alea, T0);
    for (let i = 0; i < 16; i++) {
      s.connecter(`j${i}`, `Agent${i}`, T0);
      s.recevoir(`j${i}`, { t: "rejoindre", arme: "mitraillette" }, T0 + i);
    }
    const b = monde.bornes;
    const points = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const p = j(s, `j${i}`).p;
      expect(p[0]).toBeGreaterThan(b.x0); expect(p[0]).toBeLessThan(b.x1);
      expect(p[2]).toBeGreaterThan(b.z0); expect(p[2]).toBeLessThan(b.z1);
      points.add(`${p[0].toFixed(2)},${p[2].toFixed(2)}`);
    }
    expect(points.size).toBeGreaterThanOrEqual(10);
  });
});

describe("changement de pseudo", () => {
  it("renomme sans reconnexion, nettoie, dédoublonne et diffuse la présence", () => {
    const s = nouvelleSalle();
    s.connecter("a", "Alice", T0);
    s.connecter("b", "Bob", T0);
    const sorties = s.recevoir("b", { t: "pseudo", pseudo: "  alice<script> " }, T0 + 2000);
    expect(j(s, "b").pseudo).toBe("alicescript");
    expect(messages(sorties, "presence")).toHaveLength(1);
    s.recevoir("b", { t: "pseudo", pseudo: "ALICE" }, T0 + 4000);
    expect(j(s, "b").pseudo).toBe("ALICE2");
  });

  it("garde son propre nom sans suffixe et limite la cadence", () => {
    const s = nouvelleSalle();
    s.connecter("a", "Alice", T0);
    expect(s.recevoir("a", { t: "pseudo", pseudo: "Alice" }, T0 + 2000)).toEqual([]);
    expect(j(s, "a").pseudo).toBe("Alice");
    for (let i = 0; i < 8; i++) s.recevoir("a", { t: "pseudo", pseudo: `Nom${i}` }, T0 + 2000 + i);
    expect(j(s, "a").pseudo).toBe("Nom7");
    expect(s.recevoir("a", { t: "pseudo", pseudo: "Yan" }, T0 + 2100)).toEqual([]);
    s.recevoir("a", { t: "pseudo", pseudo: "Yan" }, T0 + 12_100);
    expect(j(s, "a").pseudo).toBe("Yan");
  });
});

describe("socle v2 (lot 0, sans changement de comportement)", () => {
  it("les plafonds de vitesse du serveur suivent PLAFONDS", () => {
    expect(VITESSE_MAX_H_M_S).toBe(PLAFONDS.vitesseHorizontaleMax);
    expect(VITESSE_DECLAREE_MAX_H_M_S).toBe(PLAFONDS.vitesseDeclareeMax);
  });

  it("chaque joueur a sa propre copie de l'équipement (EQUIPEMENT_DEFAUT reste figé et intact)", () => {
    const s = salleEnJeu(["pistolet", "pistolet"]);
    expect(j(s, "a").equip).toEqual(EQUIPEMENT_DEFAUT);
    expect(j(s, "a").equip).not.toBe(EQUIPEMENT_DEFAUT);
    expect(j(s, "a").equip).not.toBe(j(s, "b").equip);
    j(s, "a").equip.speciale = "railgun";
    expect(j(s, "b").equip.speciale).toBeNull();
    expect(EQUIPEMENT_DEFAUT.speciale).toBeNull();
    expect(j(s, "a").main).toBe("secondaire");
    expect(j(s, "a").bouclier).toBe(0);
  });

  it("l'apparition, les dégâts et la mort portent les champs v2 (bouclier, équipement, cause, horodatage)", () => {
    const s = nouvelleSalle();
    s.connecter("a", "Alice", T0);
    const [apparition] = messages(s.recevoir("a", { t: "rejoindre", arme: "pistolet" }, T0), "apparition");
    expect(apparition).toMatchObject({ bouclier: 0, main: "secondaire", munSpeciale: 0, equip: EQUIPEMENT_DEFAUT });
    expect(apparition.equip).not.toBe(EQUIPEMENT_DEFAUT);
    const { s: duelle, t } = duel();
    const [degats] = messages(tirer(duelle, "a", "b", t), "degats");
    expect(degats.bouclier).toBe(0);
  });

  it("une arme du nouveau catalogue est acceptée à l'entrée, une arme inconnue non", () => {
    const s = nouvelleSalle();
    s.connecter("a", "Alice", T0);
    s.recevoir("a", { t: "rejoindre", arme: "revolver" }, T0);
    expect(j(s, "a").arme).toBe("revolver");
    s.connecter("b", "Bob", T0);
    s.recevoir("b", { t: "rejoindre", arme: "laser" as ArmeFeuId }, T0);
    expect(j(s, "b").arme).toBe("pistolet");
  });
});
