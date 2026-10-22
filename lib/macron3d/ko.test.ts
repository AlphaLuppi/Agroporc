/**
 * Macron frappé (lib/macron3d/ko.ts) sur le vrai squelette du GLB : chute en arrière jusqu'au sol
 * sans le traverser, au sol, relevé, reprise titubante, avance figée tant qu'il n'a pas repris sa
 * course, annulation sans saut.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Vector3 } from "three";
import { extraireSquelette } from "../tigre3d/extraction.mjs";
import { creerSquelette } from "./squelette";
import { creerPoseur } from "./pose";
import { creerCourse, DEG, REGLAGES } from "./course";
import { BULLE_KO, DUREES_KO, FONDU_REPRISE, VITESSE_REPRISE, creerKO, type PhaseKO } from "./ko";
import { avancement, passageFini, planPassage } from "./passage";
import type { Role } from "./os";

const sq = creerSquelette(extraireSquelette(readFileSync("public/macron/macron.glb")).os);
const DT = 1 / 60;
const CORPS: Role[] = ["bassin", "dos1", "dos2", "dos3", "cou1", "tete"];
const FIN_RELEVE = DUREES_KO.chute + DUREES_KO.sol + DUREES_KO.releve;

/** Coureur lancé puis frappé, `chaque` reçoit la phase, les intentions et le monde de chaque image. */
function sequence(duree: number, chaque: (phase: PhaseKO | null, t: number, it: ReturnType<ReturnType<typeof creerKO>["etat"]>, monde: Vector3[]) => void, graine = 11, avantImpact = 1.3) {
  const P = creerPoseur(sq);
  const course = creerCourse({ graine });
  course.avancer(avantImpact);
  const ko = creerKO(course.etat(), graine);
  for (let k = 0; k < Math.round(duree / DT); k++) {
    ko.avancer(DT, course);
    const it = ko.etat(course);
    P.poser(it);
    chaque(ko.phase, ko.t, it, P.monde.p);
  }
  return { ko, course };
}

describe("Macron frappé : chute, sol, relevé", () => {
  it("ne traverse jamais le sol (os du corps à l'épaisseur du corps, mains et pieds au-dessus)", () => {
    for (const graine of [11, 4, 27]) {
      for (const avantImpact of [1.3, 1.47, 1.61]) {
        let minTout = Infinity, minCorps = Infinity, ou = "";
        sequence(FIN_RELEVE, (_, t, ___, m) => {
          m.forEach((p, i) => { if (i > 0 && p.y < minTout) { minTout = p.y; ou = `${sq.noms[i]} à ${t.toFixed(2)} s`; } });
          for (const r of CORPS) minCorps = Math.min(minCorps, m[sq.i[r]].y);
        }, graine, avantImpact);
        expect(minTout, `graine ${graine}, impact ${avantImpact} : ${ou}`).toBeGreaterThan(0);
        expect(minCorps).toBeGreaterThan(0.08);
      }
    }
  });

  it("tombe en arrière, à plat sur le dos, puis se relève debout", () => {
    const mesures: Record<string, { bassin: Vector3; tete: Vector3 }> = {};
    const prendre = (cle: string, m: Vector3[]) => { mesures[cle] = { bassin: m[sq.i.bassin].clone(), tete: m[sq.i.tete].clone() }; };
    let depart: Vector3 | null = null;
    sequence(FIN_RELEVE + 0.1, (phase, t, _, m) => {
      depart ??= m[sq.i.bassin].clone();
      if (Math.abs(t - (DUREES_KO.chute + 0.7)) < DT / 2) prendre("sol", m);
      if (Math.abs(t - (FIN_RELEVE - DT)) < DT / 2) prendre("debout", m);
    });
    const { sol, debout } = mesures;
    // Au sol : bassin et tête près du sol, la tête derrière lui (il courait vers +Z).
    expect(sol.bassin.y).toBeLessThan(0.2);
    expect(sol.tete.y).toBeLessThan(0.3);
    expect(sol.tete.z).toBeLessThan(sol.bassin.z - 0.4);
    expect(sol.bassin.z).toBeLessThan(depart!.z);
    // Debout à la fin du relevé, à peu près là où il a été frappé.
    expect(debout.bassin.y).toBeGreaterThan(0.85);
    expect(debout.tete.y).toBeGreaterThan(1.45);
    expect(Math.abs(debout.bassin.z - depart!.z)).toBeLessThan(0.15);
  });

  it("aucun os ne saute d'une image à l'autre, impact et reprise compris", () => {
    let prec: Vector3[] | null = null, max = 0;
    sequence(FIN_RELEVE + DUREES_KO.reprise + 0.5, (_, __, ___, m) => {
      if (prec) m.forEach((p, i) => { max = Math.max(max, p.distanceTo(prec![i])); });
      prec = m.map((p) => p.clone());
    });
    // 0,2 m par image à 60 i/s : 12 m/s, la tête qui heurte le sol ou un pied lancé en course.
    expect(max).toBeLessThan(0.2);
  });

  it("l'avance ne bouge pas pendant la chute, au sol et pendant le relevé", () => {
    const plan = planPassage({ largeur: 1400, hauteur: 900 }, 1);
    const avances = new Set<number>();
    let fini = false;
    const { course } = sequence(FIN_RELEVE - DT, (_, __, it) => {
      avances.add(it.avance);
      fini ||= passageFini(plan, it.avance);
    });
    expect(avances.size).toBe(1);
    expect(course.etat().avance).toBe([...avances][0]);
    expect(fini).toBe(false);
    expect(avancement(plan, [...avances][0])).toBeLessThan(1);
  });
});

describe("Macron frappé : reprise titubante", () => {
  it("repart dans le même sens, de 60 % à 100 % de sa vitesse, rythme irrégulier", () => {
    const avances: Array<{ t: number; a: number }> = [];
    sequence(FIN_RELEVE + DUREES_KO.reprise + 1, (_, t, it) => avances.push({ t, a: it.avance }));
    const vitesse = (t0: number, t1: number) => {
      const a = avances.find((x) => x.t >= t0)!, b = avances.find((x) => x.t >= t1)!;
      return (b.a - a.a) / (b.t - a.t);
    };
    const debut = vitesse(FIN_RELEVE, FIN_RELEVE + 0.6) / REGLAGES.vitesse;
    const fin = vitesse(FIN_RELEVE + DUREES_KO.reprise + 0.2, FIN_RELEVE + DUREES_KO.reprise + 0.9) / REGLAGES.vitesse;
    expect(debut).toBeGreaterThan(VITESSE_REPRISE - 0.15);
    expect(debut).toBeLessThan(0.8);
    expect(fin).toBeGreaterThan(0.93);
    // Toujours vers l'avant.
    for (let i = 1; i < avances.length; i++) expect(avances[i].a).toBeGreaterThanOrEqual(avances[i - 1].a);
    // Rythme irrégulier : la vitesse sur des tranches de 0,25 s varie pendant la reprise.
    const tranches: number[] = [];
    for (let t = FIN_RELEVE + FONDU_REPRISE; t < FIN_RELEVE + 1.6; t += 0.25) tranches.push(vitesse(t, t + 0.25));
    expect(Math.max(...tranches) - Math.min(...tranches)).toBeGreaterThan(0.15);
  });

  it("bassin et tête roulent et oscillent de côté, puis plus rien à la fin", () => {
    const ecart = { debut: 0, fin: 0 };
    const course = creerCourse({ graine: 11 });
    course.avancer(1.3);
    const ko = creerKO(course.etat(), 11);
    for (let k = 0; k < Math.round((FIN_RELEVE + DUREES_KO.reprise + 0.5) / DT); k++) {
      ko.avancer(DT, course);
      const it = ko.etat(course), ref = course.etat();
      const tr = ko.t - FIN_RELEVE;
      const e = Math.abs(it.tete.roulis - ref.tete.roulis) + Math.abs(it.bassin.roulis - ref.bassin.roulis);
      if (tr > FONDU_REPRISE && tr < 1.5) ecart.debut = Math.max(ecart.debut, e);
      if (tr > DUREES_KO.reprise) ecart.fin = Math.max(ecart.fin, e);
    }
    expect(ecart.debut).toBeGreaterThan(8 * DEG);
    expect(ecart.fin).toBeLessThan(0.5 * DEG);
    expect(ko.phase).toBeNull();
  });

  it("étoiles au sol, bulle « En… marche… ? » pendant la reprise", () => {
    const vu: Record<string, Set<string>> = { etoiles: new Set(), bulle: new Set() };
    const course = creerCourse({ graine: 2 });
    course.avancer(1);
    const ko = creerKO(course.etat(), 2);
    for (let k = 0; k < Math.round((FIN_RELEVE + DUREES_KO.reprise + 0.5) / DT); k++) {
      ko.avancer(DT, course);
      if (ko.etoiles) vu.etoiles.add(ko.phase!);
      if (ko.bulle) vu.bulle.add(ko.phase!);
    }
    expect(vu.etoiles.has("sol")).toBe(true);
    expect(vu.etoiles.has("reprise")).toBe(false);
    expect([...vu.bulle]).toEqual(["reprise"]);
    expect(BULLE_KO).toBe("En… marche… ?");
  });
});

describe("Macron frappé : annulation de la rencontre", () => {
  it("au sol : il se relève aussitôt, sans saut de pose", () => {
    const P = creerPoseur(sq);
    const course = creerCourse({ graine: 5 });
    course.avancer(1.2);
    const ko = creerKO(course.etat(), 5);
    let prec: Vector3[] | null = null, max = 0, tAnnule = 0, tReleve = -1;
    for (let k = 0; k < Math.round(5 / DT); k++) {
      ko.avancer(DT, course);
      if (k === Math.round(1.0 / DT)) { ko.annuler(); tAnnule = ko.t; }
      if (tReleve < 0 && ko.phase === "releve") tReleve = ko.t;
      P.poser(ko.etat(course));
      if (prec) P.monde.p.forEach((p, i) => { max = Math.max(max, p.distanceTo(prec![i])); });
      prec = P.monde.p.map((p) => p.clone());
    }
    expect(tReleve - tAnnule).toBeLessThan(0.4);
    expect(tReleve).toBeLessThan(DUREES_KO.chute + DUREES_KO.sol);
    expect(max).toBeLessThan(0.2);
  });

  it("pendant la chute : il finit de tomber puis se relève presque tout de suite", () => {
    const course = creerCourse({ graine: 5 });
    course.avancer(1.2);
    const ko = creerKO(course.etat(), 5);
    ko.avancer(0.2, course);
    ko.annuler();
    expect(ko.phase).toBe("chute");
    let tReleve = -1;
    for (let k = 0; k < 120 && tReleve < 0; k++) { ko.avancer(DT, course); if (ko.phase === "releve") tReleve = ko.t; }
    expect(tReleve).toBeGreaterThan(DUREES_KO.chute);
    expect(tReleve).toBeLessThan(DUREES_KO.chute + 0.4);
  });
});
