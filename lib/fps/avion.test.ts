import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lireCachettes, type FichierCachettes } from "../agroparc3d/cachettes";
import type { Vec2 } from "../agroparc3d/types";
import {
  AVION, avancerAvion, cachettesDansAnneau, choisirCachetteLargage, creerAvion, ecartTrajectoire, intervalleAvion, positionAvion,
  rearmerAvion, tracerPassage, type ConditionsAvion, type EvenementAvion,
} from "./avion";
import type { Boite } from "./collision";
import type { CachetteTigre } from "./tigre-arene";
import { ROND_POINT, ZONE_APPARITION } from "./zones";

const BORNES: Boite = { x0: -300, z0: -250, x1: 350, z1: 200 };
const CACHETTES: CachetteTigre[] = [{ x: 60, z: 10, cap: 0 }, { x: -50, z: 40, cap: 0 }, { x: 10, z: -90, cap: 0 }];
const T0 = 1_000_000;
const INTERVALLE = { minMs: 1000, maxMs: 1000 };
const suite = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
const ok = (vivants: Vec2[] = [[200, 150], [-250, -200]]): ConditionsAvion => ({ phaseJeu: true, enArene: 2, vivants, tigreSauvage: false });
const types = (ev: EvenementAvion[]) => ev.map((e) => e.type);

describe("fréquence et conditions", () => {
  it("intervalle par défaut 90 à 180 s", () => {
    expect(intervalleAvion(() => 0)).toBe(90_000);
    expect(intervalleAvion(() => 1)).toBe(180_000);
    expect(creerAvion(T0, () => 0.5).prochaineT).toBe(T0 + 135_000);
  });

  it("le passage part à l'échéance, pas avant", () => {
    const e = creerAvion(T0, () => 0, INTERVALLE);
    expect(avancerAvion(e, T0 + 999, () => 0.3, ok(), CACHETTES, BORNES, INTERVALLE)).toEqual([]);
    const ev = avancerAvion(e, T0 + 1000, () => 0.3, ok(), CACHETTES, BORNES, INTERVALLE);
    expect(types(ev)).toEqual(["passage"]);
    expect(e.prochaineT).toBe(Infinity);
  });

  it("moins de 2 joueurs en arène, ou hors phase de jeu : pas de passage, échéance repoussée d'un intervalle", () => {
    for (const cond of [{ ...ok(), enArene: 1 }, { ...ok(), phaseJeu: false }]) {
      const e = creerAvion(T0, () => 0, INTERVALLE);
      expect(avancerAvion(e, T0 + 1000, () => 0.3, cond, CACHETTES, BORNES, INTERVALLE)).toEqual([]);
      expect(e.passage).toBeNull();
      expect(e.prochaineT).toBe(T0 + 2000);
    }
  });

  it("un seul tigre sauvage à la fois : aucun passage tant qu'il vit, même à l'échéance", () => {
    const e = creerAvion(T0, () => 0, INTERVALLE);
    expect(avancerAvion(e, T0 + 5000, () => 0.3, { ...ok(), tigreSauvage: true }, CACHETTES, BORNES, INTERVALLE)).toEqual([]);
    expect(e.passage).toBeNull();
  });

  it("aucune cachette à plus de 30 m des joueurs : pas de passage, échéance repoussée", () => {
    const e = creerAvion(T0, () => 0, INTERVALLE);
    const partout: Vec2[] = CACHETTES.map((c) => [c.x + 5, c.z]);
    expect(avancerAvion(e, T0 + 1000, () => 0.3, ok(partout), CACHETTES, BORNES, INTERVALLE)).toEqual([]);
    expect(e.prochaineT).toBe(T0 + 2000);
  });

  it("cycle complet : passage, largage, fin. Le minuteur attend la fin du tigre, puis repart d'un intervalle", () => {
    const e = creerAvion(T0, () => 0, INTERVALLE);
    const [p] = avancerAvion(e, T0 + 1000, () => 0.3, ok(), CACHETTES, BORNES, INTERVALLE) as [Extract<EvenementAvion, { type: "passage" }>];
    const passage = p.passage;
    expect(avancerAvion(e, passage.largageT - 1, () => 0.3, ok(), CACHETTES, BORNES, INTERVALLE)).toEqual([]);
    const largage = avancerAvion(e, passage.largageT, () => 0.3, ok(), CACHETTES, BORNES, INTERVALLE);
    expect(types(largage)).toEqual(["largage"]);
    expect(types(avancerAvion(e, passage.finT, () => 0.3, { ...ok(), tigreSauvage: true }, CACHETTES, BORNES, INTERVALLE))).toEqual(["fin"]);
    expect(e.passage).toBeNull();
    expect(e.prochaineT).toBe(Infinity);
    expect(avancerAvion(e, passage.finT + 10 * 60_000, () => 0.3, ok(), CACHETTES, BORNES, INTERVALLE)).toEqual([]);
    rearmerAvion(e, passage.finT + 20_000, () => 0, INTERVALLE);
    expect(e.prochaineT).toBe(passage.finT + 21_000);
    expect(types(avancerAvion(e, passage.finT + 21_000, () => 0.3, ok(), CACHETTES, BORNES, INTERVALLE))).toEqual(["passage"]);
    expect(e.compteur).toBe(2);
  });
});

describe("trajectoire et largage", () => {
  it("ligne droite d'un bord à l'autre, à 120 m et 60 m/s, à moins de 60 m de la cachette, largage au point le plus proche", () => {
    for (const graine of [0.05, 0.2, 0.45, 0.7, 0.95]) {
      const c = CACHETTES[1];
      const p = tracerPassage(7, c, BORNES, T0, suite(graine, 1 - graine))!;
      expect(p).not.toBeNull();
      expect(p).toMatchObject({ id: 7, altitude: 120, vitesse: 60, debutT: T0 });
      expect(ecartTrajectoire(p, c.x, c.z)).toBeLessThan(AVION.ecartMaxM);
      // départ et arrivée sur le bord de la zone de jeu
      for (const [x, z] of [p.depart, p.arrivee]) {
        const bord = Math.min(Math.abs(x - BORNES.x0), Math.abs(x - BORNES.x1), Math.abs(z - BORNES.z0), Math.abs(z - BORNES.z1));
        expect(bord).toBeLessThan(1e-6);
      }
      const longueur = Math.hypot(p.arrivee[0] - p.depart[0], p.arrivee[1] - p.depart[1]);
      expect(p.finT - p.debutT).toBeCloseTo((longueur / 60) * 1000, 3);
      // au largage, l'avion est au point de la trajectoire le plus proche de la cachette
      const l = positionAvion(p, p.largageT);
      expect(l[1]).toBe(120);
      expect(Math.hypot(l[0] - c.x, l[2] - c.z)).toBeCloseTo(ecartTrajectoire(p, c.x, c.z), 3);
      expect(p.largageT).toBeGreaterThanOrEqual(p.debutT);
      expect(p.largageT).toBeLessThanOrEqual(p.finT);
    }
  });

  it("la cachette tirée est à plus de 30 m de tout joueur vivant", () => {
    const vivants: Vec2[] = [[60, 20], [-50, 60]];
    for (const a of [0, 0.4, 0.99]) expect(choisirCachetteLargage(CACHETTES, vivants, () => a)).toEqual(CACHETTES[2]);
    expect(choisirCachetteLargage(CACHETTES, [[60, 10], [-50, 40], [10, -90]], () => 0)).toBeNull();
  });

  it("au largage, une cachette devenue trop proche d'un joueur est remplacée par une cachette à plus de 30 m", () => {
    const e = creerAvion(T0, () => 0, INTERVALLE);
    avancerAvion(e, T0 + 1000, suite(0, 0.3, 0.6), ok(), CACHETTES, BORNES, INTERVALLE);
    expect(e.cachette).toEqual(CACHETTES[0]);
    const vivants: Vec2[] = [[62, 12]];
    const [ev] = avancerAvion(e, e.passage!.largageT, () => 0, ok(vivants), CACHETTES, BORNES, INTERVALLE);
    if (ev.type !== "largage") throw new Error("largage attendu");
    expect(ev.cachette).not.toEqual(CACHETTES[0]);
    expect(Math.hypot(ev.cachette!.x - 62, ev.cachette!.z - 12)).toBeGreaterThan(30);
    expect(ev.point[1]).toBe(AVION.altitude);
  });

  it("largage annulé si plus aucune cachette n'est libre : pas de tigre, le minuteur repart tout de suite après le passage", () => {
    const e = creerAvion(T0, () => 0, INTERVALLE);
    avancerAvion(e, T0 + 1000, () => 0.3, ok(), CACHETTES, BORNES, INTERVALLE);
    const partout: Vec2[] = CACHETTES.map((c) => [c.x, c.z]);
    const [ev] = avancerAvion(e, e.passage!.largageT, () => 0, ok(partout), CACHETTES, BORNES, INTERVALLE);
    expect(ev).toMatchObject({ type: "largage", cachette: null });
    const fin = e.passage!.finT;
    avancerAvion(e, fin, () => 0, ok(), CACHETTES, BORNES, INTERVALLE);
    expect(e.prochaineT).toBe(fin + 1000);
  });
});

describe("cachettes réelles", () => {
  const fichier = JSON.parse(readFileSync("public/agroparc/cachettes.json", "utf8")) as FichierCachettes;
  const toutes = lireCachettes(fichier).map((c) => ({ x: c.x, z: c.z, cap: c.cap }));
  const anneau = cachettesDansAnneau(toutes, { centre: ROND_POINT.centre, rMin: ZONE_APPARITION.rMin, rMax: ZONE_APPARITION.rMax });

  it("l'anneau de 25 à 140 m du rond-point en contient plusieurs dizaines, toutes dans l'anneau", () => {
    expect(anneau.length).toBeGreaterThanOrEqual(20);
    for (const c of anneau) {
      const d = Math.hypot(c.x - ROND_POINT.centre[0], c.z - ROND_POINT.centre[1]);
      expect(d).toBeGreaterThanOrEqual(25);
      expect(d).toBeLessThanOrEqual(140);
    }
  });
});
