import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import type { Building, SceneData } from "../agroparc3d/types";
import {
  AVION_BR, CHUTE_BR, capAvionBr, etatChuteInitial, hauteurAuSol, pasChute, pasDuTemps, positionAvionBr, tracerVolBr, vitesseAvionBr,
  type AvionBr, type EntreesChute, type EtatChute,
} from "./br-chute";
import { construireMonde, type Boite, type Monde } from "./collision";
import type { Vec3 } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const DT = CHUTE_BR.pas;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
/** Bornes de la carte BR : x −348,8 à 392,4, z −257,9 à 233,7 (741 × 492 m), soit les centres de deux bâtiments minuscules ± 25 m. */
const BORNES: Boite = { x0: -348.8, z0: -257.9, x1: 392.4, z1: 233.7 };
function mondeDe(...batiments: Building[]): Monde {
  const coins = [rect(-323.9, -233, -323.7, -232.8, 3), rect(367.3, 208.6, 367.5, 208.8, 3)];
  const m = construireMonde({ ...scene, buildings: [...coins, ...batiments], pois: [] });
  // les centres des coins donnent les bornes de la carte (à 0,1 m près)
  expect(m.bornes.x0).toBeCloseTo(BORNES.x0, 0);
  expect(m.bornes.z1).toBeCloseTo(BORNES.z1, 0);
  return m;
}
const vide = mondeDe();

const LIBRE: EntreesChute = { lacet: 0, tangage: 0, avance: 0, lateral: 0, ouvrir: false };

function courir(e: EtatChute, n: number, en: EntreesChute | ((k: number, e: EtatChute) => EntreesChute), m: Monde): EtatChute {
  for (let k = 0; k < n; k++) e = pasChute(e, typeof en === "function" ? en(k, e) : en, m);
  return e;
}

describe("tracerVolBr", () => {
  it("trace un trajet d'au moins 450 m, coupé aux bornes, sur 300 graines", () => {
    for (let g = 1; g <= 300; g++) {
      const a = tracerVolBr(BORNES, aleaGraine(g), 1000);
      const l = Math.hypot(a.arrivee[0] - a.depart[0], a.arrivee[1] - a.depart[1]);
      expect(l).toBeGreaterThanOrEqual(AVION_BR.longueurMinM - 1e-6);
      for (const [x, z] of [a.depart, a.arrivee]) {
        expect(x).toBeGreaterThanOrEqual(BORNES.x0 - 1e-6); expect(x).toBeLessThanOrEqual(BORNES.x1 + 1e-6);
        expect(z).toBeGreaterThanOrEqual(BORNES.z0 - 1e-6); expect(z).toBeLessThanOrEqual(BORNES.z1 + 1e-6);
      }
      // coupé aux bornes : chaque extrémité est sur un bord
      for (const [x, z] of [a.depart, a.arrivee]) {
        const surBord = Math.abs(x - BORNES.x0) < 1e-6 || Math.abs(x - BORNES.x1) < 1e-6 || Math.abs(z - BORNES.z0) < 1e-6 || Math.abs(z - BORNES.z1) < 1e-6;
        expect(surBord).toBe(true);
      }
      expect(a.altitude).toBe(AVION_BR.altitude);
      expect(a.vitesse).toBe(AVION_BR.vitesse);
      expect(a.debutT).toBe(1000);
      expect(a.finT - a.debutT).toBeCloseTo((l / AVION_BR.vitesse) * 1000, 6);
      // 15 s pour 450 m, jusqu'à 30 s pour la diagonale (≈ 890 m)
      expect((a.finT - a.debutT) / 1000).toBeGreaterThanOrEqual(15 - 1e-6);
      expect((a.finT - a.debutT) / 1000).toBeLessThanOrEqual(30);
    }
  });

  it("la droite passe à moins de 110 m du centre des bornes", () => {
    const cx = (BORNES.x0 + BORNES.x1) / 2, cz = (BORNES.z0 + BORNES.z1) / 2;
    for (let g = 1; g <= 200; g++) {
      const a = tracerVolBr(BORNES, aleaGraine(g), 0);
      const dx = a.arrivee[0] - a.depart[0], dz = a.arrivee[1] - a.depart[1], l = Math.hypot(dx, dz);
      const ecart = Math.abs((cx - a.depart[0]) * dz - (cz - a.depart[1]) * dx) / l;
      expect(ecart).toBeLessThanOrEqual(AVION_BR.rayonDecalageM + 1e-6);
    }
  });

  it("est déterministe à graine fixe et varie d'une graine à l'autre", () => {
    expect(tracerVolBr(BORNES, aleaGraine(7), 5)).toEqual(tracerVolBr(BORNES, aleaGraine(7), 5));
    const caps = new Set(Array.from({ length: 30 }, (_, g) => capAvionBr(tracerVolBr(BORNES, aleaGraine(g + 1), 0)).toFixed(3)));
    expect(caps.size).toBeGreaterThan(20);
  });

  it("couvre tous les caps (aucun secteur de 45° vide sur 400 graines)", () => {
    const secteurs = new Set<number>();
    for (let g = 1; g <= 400; g++) {
      const c = capAvionBr(tracerVolBr(BORNES, aleaGraine(g), 0));
      secteurs.add(Math.floor(((c + Math.PI) / (2 * Math.PI)) * 8) % 8);
    }
    expect(secteurs.size).toBe(8);
  });

  it("applique la durée et l'altitude d'essai", () => {
    const a = tracerVolBr(BORNES, aleaGraine(3), 2000, { dureeMs: 12_000, altitude: 140 });
    expect(a.finT - a.debutT).toBeCloseTo(12_000, 6);
    expect(a.altitude).toBe(140);
    const l = Math.hypot(a.arrivee[0] - a.depart[0], a.arrivee[1] - a.depart[1]);
    expect(a.vitesse).toBeCloseTo(l / 12, 9);
  });

  it("se replie sur l'axe long de la carte quand aucun trajet n'atteint 450 m", () => {
    const petite: Boite = { x0: 0, z0: 0, x1: 300, z1: 100 };
    const a = tracerVolBr(petite, aleaGraine(1), 0);
    expect(a.depart).toEqual([0, 50]);
    expect(a.arrivee).toEqual([300, 50]);
    const haute: Boite = { x0: 0, z0: 0, x1: 100, z1: 300 };
    const b = tracerVolBr(haute, aleaGraine(1), 0);
    expect(b.depart).toEqual([50, 0]);
    expect(b.arrivee).toEqual([50, 300]);
  });
});

describe("position, cap et vitesse de l'avion", () => {
  const a: AvionBr = { depart: [0, 0], arrivee: [300, 400], altitude: 350, vitesse: 30, debutT: 1000, finT: 1000 + (500 / 30) * 1000 };
  it("est immobile au départ avant debutT, à l'arrivée après finT, au milieu à mi-vol", () => {
    expect(positionAvionBr(a, 0)).toEqual([0, 350, 0]);
    expect(positionAvionBr(a, 1000)).toEqual([0, 350, 0]);
    const m = positionAvionBr(a, (a.debutT + a.finT) / 2);
    expect(m[0]).toBeCloseTo(150, 6); expect(m[2]).toBeCloseTo(200, 6);
    expect(positionAvionBr(a, a.finT + 99_999)).toEqual([300, 350, 400]);
  });
  it("avance à la vitesse annoncée", () => {
    const p0 = positionAvionBr(a, 5000), p1 = positionAvionBr(a, 6000);
    expect(Math.hypot(p1[0] - p0[0], p1[2] - p0[2])).toBeCloseTo(30, 6);
    const v = vitesseAvionBr(a);
    expect(v[0]).toBeCloseTo(18, 9); expect(v[1]).toBe(0); expect(v[2]).toBeCloseTo(24, 9);
  });
  it("donne un lacet dont l'avant (−sin, −cos) suit la vitesse", () => {
    for (const arrivee of [[300, 400], [-300, 400], [-300, -400], [300, -400], [500, 0], [0, -500]] as [number, number][]) {
      const b: AvionBr = { ...a, arrivee };
      const c = capAvionBr(b), v = vitesseAvionBr(b);
      expect(-Math.sin(c) * 30).toBeCloseTo(v[0], 9);
      expect(-Math.cos(c) * 30).toBeCloseTo(v[2], 9);
    }
  });
  it("a une vitesse nulle sur un trajet nul", () => {
    expect(vitesseAvionBr({ ...a, arrivee: [0, 0] })).toEqual([0, 0, 0]);
  });
});

describe("etatChuteInitial", () => {
  it("arrondit au centimètre", () => {
    const e = etatChuteInitial([1.234567, 350.004, -2.5551], [29.99499, 0, 0.0049]);
    expect(e.p).toEqual([1.23, 350, -2.56]);
    expect(e.v).toEqual([29.99, 0, 0]);
    expect(e).toMatchObject({ voile: false, tVoile: 0, tLibre: 0, atterri: false });
  });
});

describe("chute libre", () => {
  it("atteint −35 m/s à l'horizon et −55 m/s en piqué (regard à −60° ou plus bas)", () => {
    const haut = etatChuteInitial([0, 5000, 0], [0, 0, 0]);
    const horizon = courir(haut, 360, { ...LIBRE, tangage: 0 }, vide);
    expect(horizon.v[1]).toBeCloseTo(-35, 6);
    expect(horizon.voile).toBe(false);
    for (const tangage of [-Math.PI / 3, -Math.PI / 2, -3]) {
      expect(courir(haut, 360, { ...LIBRE, tangage }, vide).v[1]).toBeCloseTo(-55, 6);
    }
    // regard vers le haut : comme l'horizon
    expect(courir(haut, 360, { ...LIBRE, tangage: 1 }, vide).v[1]).toBeCloseTo(-35, 6);
    // entre les deux : interpolé (−30° = moitié)
    expect(courir(haut, 360, { ...LIBRE, tangage: -Math.PI / 6 }, vide).v[1]).toBeCloseTo(-45, 6);
  });

  it("accélère à 20 m/s² vers la vitesse cible", () => {
    const e = courir(etatChuteInitial([0, 5000, 0], [0, 0, 0]), 30, LIBRE, vide);
    expect(e.v[1]).toBeCloseTo(-10, 6);
    expect(e.tLibre).toBeCloseTo(0.5, 9);
  });

  it("garde 30 m/s horizontaux à l'horizon (avance), 6 m/s en piqué", () => {
    const depart = etatChuteInitial([0, 5000, 0], [0, 0, 0]);
    // lacet 0 : l'avant est −z
    const h = courir(depart, 240, { ...LIBRE, avance: 1 }, vide);
    expect(h.v[0]).toBeCloseTo(0, 9); expect(h.v[2]).toBeCloseTo(-30, 6);
    const p = courir(depart, 240, { ...LIBRE, avance: 1, tangage: -Math.PI / 3 }, vide);
    expect(Math.hypot(p.v[0], p.v[2])).toBeCloseTo(6, 6);
  });

  it("garde l'élan de l'avion puis freine à 14 m/s² sans entrée", () => {
    const e0 = etatChuteInitial([0, 5000, 0], [30, 0, 0]);
    const e1 = courir(e0, 30, LIBRE, vide);
    expect(e1.v[0]).toBeCloseTo(30 - 14 * 0.5, 6);
    expect(courir(e0, 180, LIBRE, vide).v[0]).toBeCloseTo(0, 9);
  });

  it("normalise la diagonale (norme ≤ 1) et suit le lacet", () => {
    const depart = etatChuteInitial([0, 5000, 0], [0, 0, 0]);
    const diag = courir(depart, 240, { ...LIBRE, avance: 1, lateral: 1 }, vide);
    expect(Math.hypot(diag.v[0], diag.v[2])).toBeCloseTo(30, 6);
    // lacet −π/2 : l'avant est +x, la droite +z
    const est = courir(depart, 240, { ...LIBRE, lacet: -Math.PI / 2, avance: 1 }, vide);
    expect(est.v[0]).toBeCloseTo(30, 6); expect(est.v[2]).toBeCloseTo(0, 6);
    const droite = courir(depart, 240, { ...LIBRE, lacet: -Math.PI / 2, lateral: 1 }, vide);
    expect(droite.v[0]).toBeCloseTo(0, 6); expect(droite.v[2]).toBeCloseTo(30, 6);
    // entrées démesurées bornées à 1
    const trop = courir(depart, 240, { ...LIBRE, avance: 50 }, vide);
    expect(trop.v[2]).toBeCloseTo(-30, 6);
  });

  it("tolère des entrées non finies", () => {
    const e = courir(etatChuteInitial([0, 5000, 0], [0, 0, 0]), 10, { lacet: NaN, tangage: NaN, avance: Infinity, lateral: NaN, ouvrir: false }, vide);
    expect(e.p.every(Number.isFinite)).toBe(true);
    expect(e.v.every(Number.isFinite)).toBe(true);
  });
});

describe("parachute", () => {
  it("refuse l'ouverture manuelle avant 1 s, l'accepte ensuite", () => {
    let e = etatChuteInitial([0, 5000, 0], [0, 0, 0]);
    const ouverture: number[] = [];
    for (let k = 0; k < 120; k++) {
      e = pasChute(e, { ...LIBRE, ouvrir: true }, vide);
      if (e.voile && !ouverture.length) ouverture.push(k);
    }
    // k = 0 est le premier pas après le saut : l'ouverture a lieu au pas 60, soit une seconde plus tard
    expect(ouverture).toEqual([60]);
  });

  it("ne s'ouvre pas sans demande en haute altitude, ne se referme jamais", () => {
    let e = courir(etatChuteInitial([0, 5000, 0], [0, 0, 0]), 300, LIBRE, vide);
    expect(e.voile).toBe(false);
    e = courir(e, 70, { ...LIBRE, ouvrir: true }, vide);
    expect(e.voile).toBe(true);
    e = courir(e, 600, { ...LIBRE, ouvrir: false }, vide);
    expect(e.voile).toBe(true);
  });

  it("s'ouvre seul sous 90 m au-dessus du sol", () => {
    let e = etatChuteInitial([0, 350, 0], [0, 0, 30]);
    let avant = e, avantAvant = e;
    while (!e.voile) { avantAvant = avant; avant = e; e = pasChute(e, LIBRE, vide); }
    // l'ouverture est décidée au début du pas : l'état d'avant est sous 90 m, celui d'encore avant ne l'est pas
    expect(avant.p[1]).toBeLessThan(CHUTE_BR.hauteurOuvertureAutoM);
    expect(avantAvant.p[1]).toBeGreaterThanOrEqual(CHUTE_BR.hauteurOuvertureAutoM);
    expect(e.tVoile).toBeCloseTo(DT, 9);
  });

  it("un toit compte comme sol pour l'ouverture automatique", () => {
    const m = mondeDe(rect(-20, -20, 20, 20, 50));
    expect(hauteurAuSol(m, [0, 200, 0])).toBeCloseTo(150, 9);
    expect(hauteurAuSol(m, [100, 200, 100])).toBeCloseTo(200, 9);
    let e = etatChuteInitial([0, 350, 0], [0, 0, 0]);
    while (!e.voile) e = pasChute(e, LIBRE, m);
    // 90 m au-dessus du toit de 50 m
    expect(e.p[1]).toBeGreaterThan(137); expect(e.p[1]).toBeLessThan(141);
  });

  it("descend à −6,5 m/s, rattrape depuis −55 m/s en moins de 1,25 s, et limite à 14 m/s horizontaux", () => {
    let e: EtatChute = { ...etatChuteInitial([0, 5000, 0], [0, -55, 0]), voile: true };
    e = courir(e, 75, { ...LIBRE, avance: 1 }, vide);
    expect(e.v[1]).toBeCloseTo(-6.5, 6);
    expect(Math.hypot(e.v[0], e.v[2])).toBeLessThanOrEqual(14 + 1e-9);
    e = courir(e, 120, { ...LIBRE, avance: 1 }, vide);
    expect(Math.hypot(e.v[0], e.v[2])).toBeCloseTo(14, 6);
    expect(e.v[1]).toBeCloseTo(-6.5, 9);
    // 48,5 m/s de rattrapage à 40 m/s² : un peu plus de 1,2 s
    expect(CHUTE_BR.voile.ouvertureMs).toBe(1200);
    expect((55 - 6.5) / CHUTE_BR.voile.accV).toBeLessThanOrEqual(CHUTE_BR.voile.ouvertureMs / 1000 + 0.02);
  });

  it("freine l'élan à 8 m/s² sous voile", () => {
    const e = courir({ ...etatChuteInitial([0, 5000, 0], [30, -6.5, 0]), voile: true }, 30, LIBRE, vide);
    expect(e.v[0]).toBeCloseTo(30 - 8 * 0.5, 6);
  });
});

describe("atterrissage", () => {
  it("se pose au sol : atterri, y = 0, vitesse nulle, sans dégât", () => {
    let e = etatChuteInitial([10, 350, 20], [0, 0, 30]);
    let k = 0;
    while (!e.atterri && k++ < 5000) e = pasChute(e, { ...LIBRE, avance: 1 }, vide);
    expect(e.atterri).toBe(true);
    expect(e.p[1]).toBe(0);
    expect(e.v).toEqual([0, 0, 0]);
    expect(e.voile).toBe(true);
    // 350 m : environ 8 s de chute libre puis 14 s sous voile
    expect(k * DT).toBeGreaterThan(18); expect(k * DT).toBeLessThan(26);
  });

  it("reste posé et immobile ensuite", () => {
    let e = etatChuteInitial([0, 1, 0], [10, 0, 0]);
    e = courir(e, 120, { ...LIBRE, avance: 1 }, vide);
    expect(e.atterri).toBe(true);
    const p = [...e.p];
    expect(courir(e, 10, { ...LIBRE, avance: 1 }, vide).p).toEqual(p);
  });

  it("se pose sur un toit, même à 55 m/s (le pas fait près d'un mètre)", () => {
    const m = mondeDe(rect(-10, -10, 10, 10, 12));
    for (let d = 0; d < 20; d++) {
      const y0 = 12 + 0.1 + d * 0.035;
      let e: EtatChute = { ...etatChuteInitial([0, y0, 0], [0, -55, 0]), voile: true };
      e = pasChute(e, LIBRE, m);
      expect(e.atterri).toBe(true);
      expect(e.p[1]).toBe(12);
    }
    // depuis très haut, sans toucher à rien
    let e = etatChuteInitial([0, 300, 0], [0, 0, 0]);
    e = courir(e, 6000, LIBRE, m);
    expect(e.atterri).toBe(true);
    expect(e.p[1]).toBe(12);
  });

  it("passe au-dessus d'un bâtiment sans le traverser puis se pose sur son toit", () => {
    const m = mondeDe(rect(10, -10, 30, 10, 30));
    // lacet −π/2 : l'avant est +x
    let e: EtatChute = { ...etatChuteInitial([0, 40, 0], [14, -6.5, 0]), voile: true };
    e = courir(e, 600, { ...LIBRE, lacet: -Math.PI / 2, avance: 1 }, m);
    expect(e.atterri).toBe(true);
    expect(e.p[1]).toBe(30);
    expect(e.p[0]).toBeGreaterThan(10);
    expect(e.p[0]).toBeLessThan(30);
  });

  it("est arrêté par un mur sous le toit et tombe à son pied", () => {
    const m = mondeDe(rect(10, -10, 30, 10, 30));
    let e: EtatChute = { ...etatChuteInitial([0, 20, 0], [14, -6.5, 0]), voile: true };
    let xMax = -Infinity;
    for (let k = 0; k < 600 && !e.atterri; k++) {
      e = pasChute(e, { ...LIBRE, lacet: -Math.PI / 2, avance: 1 }, m);
      xMax = Math.max(xMax, e.p[0]);
    }
    expect(e.atterri).toBe(true);
    expect(e.p[1]).toBe(0);
    expect(xMax).toBeLessThanOrEqual(10 - CHUTE_BR.rayon + 1e-6);
    expect(xMax).toBeGreaterThan(10 - CHUTE_BR.rayon - 0.1);
  });

  it("ne sort pas des bornes de la carte", () => {
    let e = etatChuteInitial([BORNES.x1 - 5, 200, 0], [30, 0, 0]);
    e = courir(e, 2000, { ...LIBRE, lacet: -Math.PI / 2, avance: 1 }, vide);
    expect(e.p[0]).toBeLessThanOrEqual(BORNES.x1 - CHUTE_BR.rayon + 1e-6);
  });

  it("traverse un bâtiment creux (hauteur 0) jusqu'au sol intérieur", () => {
    const m = mondeDe(rect(-10, -10, 10, 10, 0));
    const e = courir(etatChuteInitial([0, 100, 0], [0, 0, 0]), 3000, LIBRE, m);
    expect(e.atterri).toBe(true);
    expect(e.p[1]).toBe(0);
  });

  it("ne modifie pas son argument", () => {
    const e = etatChuteInitial([0, 200, 0], [3, 0, 4]);
    const copie = JSON.stringify(e);
    pasChute(e, { ...LIBRE, avance: 1 }, vide);
    expect(JSON.stringify(e)).toBe(copie);
  });
});

describe("pasDuTemps", () => {
  const unPas = DT * 1000;
  it("convertit le temps écoulé en pas fixes et garde le reste", () => {
    expect(pasDuTemps(0, 0)).toEqual({ pas: 0, reste: 0 });
    expect(pasDuTemps(10, 0).pas).toBe(0);
    expect(pasDuTemps(10, 0).reste).toBeCloseTo(10, 9);
    const r = pasDuTemps(10, 10);
    expect(r.pas).toBe(1);
    expect(r.reste).toBeCloseTo(20 - unPas, 9);
    expect(pasDuTemps(unPas, 0).pas).toBe(1);
  });
  it("donne exactement 60 pas pour 1000 ms de tics irréguliers", () => {
    const dts = [16, 17, 33, 5, 16.6667, 50, 100, 8, 8, 1, 3, 40];
    let reste = 0, pas = 0, t = 0;
    for (let i = 0; t < 1000; i++) {
      const dt = Math.min(dts[i % dts.length], 1000 - t);
      const r = pasDuTemps(dt, reste);
      pas += r.pas; reste = r.reste; t += dt;
    }
    expect(pas === 59 || pas === 60).toBe(true);
    expect(pas * unPas + reste).toBeCloseTo(1000, 6);
  });
  it("plafonne à 6 pas et perd le retard au-delà, sans rafale ensuite", () => {
    const r = pasDuTemps(1000, 0);
    expect(r.pas).toBe(CHUTE_BR.pasMaxParAppel);
    expect(r.pas).toBe(6);
    expect(r.reste).toBeGreaterThanOrEqual(0);
    expect(r.reste).toBeLessThan(unPas);
    expect(pasDuTemps(0, r.reste).pas).toBe(0);
  });
  it("ignore les durées négatives ou non finies", () => {
    expect(pasDuTemps(-50, 0).pas).toBe(0);
    expect(pasDuTemps(NaN, 5)).toEqual({ pas: 0, reste: 5 });
    expect(pasDuTemps(10, NaN).pas).toBe(0);
  });
});

describe("rejeu", () => {
  /** Flux d'entrées fonction du numéro de pas (le serveur n'a que les dernières entrées reçues). */
  const entreesDuPas = (k: number): EntreesChute => ({
    lacet: Math.sin(k / 70) * 3, tangage: -Math.abs(Math.sin(k / 130)) * 1.2, avance: k % 250 < 200 ? 1 : 0.3, lateral: Math.cos(k / 50), ouvrir: k > 400,
  });
  const m = mondeDe(rect(40, -60, 90, 60, 25), rect(-120, 30, -60, 80, 18));

  function rejouer(chunks: number[], total: number): EtatChute {
    let e = etatChuteInitial([0, 350, 0], [0, 0, 30]);
    let reste = 0, k = 0, i = 0;
    while (k < total) {
      const r = pasDuTemps(chunks[i++ % chunks.length], reste);
      reste = r.reste;
      for (let j = 0; j < r.pas && k < total; j++, k++) e = pasChute(e, entreesDuPas(k), m);
    }
    return e;
  }

  it("deux découpages du même flux d'entrées donnent le même état (même moteur JavaScript)", () => {
    const a = rejouer([100, 100, 100], 900);
    const b = rejouer([16, 17, 16, 33, 5, 29, 16.5], 900);
    const c = rejouer([50], 900);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("ne s'arrête jamais en l'air sans raison : 900 pas suffisent pour atterrir depuis 350 m", () => {
    expect(rejouer([100], 1500).atterri).toBe(true);
  });
});

describe("portée", () => {
  /** Meilleure approche (m) de la cible en volant droit vers elle depuis un saut en (px, pz) à la vitesse de l'avion. */
  function meilleureApproche(saut: Vec3, v: Vec3, cible: [number, number]): number {
    let e = etatChuteInitial(saut, v);
    let meilleur = Infinity;
    for (let k = 0; k < 4000 && !e.atterri; k++) {
      const lacet = Math.atan2(-(cible[0] - e.p[0]), -(cible[1] - e.p[2]));
      e = pasChute(e, { lacet, tangage: 0, avance: 1, lateral: 0, ouvrir: false }, vide);
      meilleur = Math.min(meilleur, Math.hypot(cible[0] - e.p[0], cible[1] - e.p[2]));
    }
    return meilleur;
  }
  const COINS: [number, number][] = [[BORNES.x0, BORNES.z0], [BORNES.x1, BORNES.z0], [BORNES.x0, BORNES.z1], [BORNES.x1, BORNES.z1]];
  /** Les quatre coins sont-ils à moins de 10 m d'un atterrissage possible depuis un point de la droite de l'avion ? */
  function coinsAtteignables(avion: AvionBr): boolean[] {
    const v = vitesseAvionBr(avion);
    const l = Math.hypot(avion.arrivee[0] - avion.depart[0], avion.arrivee[1] - avion.depart[1]);
    const pts: Vec3[] = [];
    for (let s = 0; s <= l; s += 20) {
      const k = s / l;
      pts.push([avion.depart[0] + (avion.arrivee[0] - avion.depart[0]) * k, avion.altitude, avion.depart[1] + (avion.arrivee[1] - avion.depart[1]) * k]);
    }
    return COINS.map((coin) => pts.some((p) => meilleureApproche(p, v, coin) <= 10));
  }
  const cx = (BORNES.x0 + BORNES.x1) / 2, cz = (BORNES.z0 + BORNES.z1) / 2;
  const avionLe = (depart: [number, number], arrivee: [number, number]): AvionBr => ({ depart, arrivee, altitude: 350, vitesse: 30, debutT: 0, finT: 20_000 });

  it("la portée latérale d'une chute à l'horizon est de 330 à 430 m (l'estimation de la spec)", () => {
    // saut de l'avion qui vole le long de z, cible droit à l'est : la distance atteinte se mesure sur la cible
    let max = 0;
    for (let d = 300; d <= 460; d += 5) {
      if (meilleureApproche([0, 350, 0], [0, 0, 30], [d, 0]) <= 10) max = d;
    }
    expect(max).toBeGreaterThanOrEqual(330);
    expect(max).toBeLessThanOrEqual(430);
  });

  it("avion sur l'axe court par le centre : les quatre coins sont atteignables", () => {
    for (const [depart, arrivee] of [
      [[cx, BORNES.z0], [cx, BORNES.z1]],
      [[cx, BORNES.z1], [cx, BORNES.z0]],
    ] as [[number, number], [number, number]][]) {
      expect(coinsAtteignables(avionLe(depart, arrivee))).toEqual([true, true, true, true]);
    }
  });

  it("avion sur l'axe long décalé de 110 m : les quatre coins sont atteignables", () => {
    for (const dz of [-110, 110]) {
      expect(coinsAtteignables(avionLe([BORNES.x0, cz + dz], [BORNES.x1, cz + dz]))).toEqual([true, true, true, true]);
      expect(coinsAtteignables(avionLe([BORNES.x1, cz + dz], [BORNES.x0, cz + dz]))).toEqual([true, true, true, true]);
    }
  });

  it("avion sur l'axe court décalé de 110 m (cas pire) : le coin le plus éloigné dépasse la portée (écart à la spec)", () => {
    // le coin opposé est à 370 + 110 = 480 m de la droite : au-delà de la portée mesurée (≈ 390 m), l'autre côté reste atteignable
    const r = coinsAtteignables(avionLe([cx + 110, BORNES.z0], [cx + 110, BORNES.z1]));
    expect(r).toEqual([false, true, false, true]);
  });
});
