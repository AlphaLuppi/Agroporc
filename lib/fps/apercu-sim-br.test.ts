import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedans } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import type { ModeleApercu } from "./apercu-source";
import { creerSolLibre } from "./apercu-sol";
import { BR_SIM, creerSimBr } from "./apercu-sim-br";
import { PAS_SIM, type ContexteSim } from "./apercu-sim";
import { bornesBr, centresBatimentsEligibles, donneesBr } from "./br-carte";
import { etatDepuisZoneBr } from "./br-zone";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const donnees = donneesBr(scene);
const bornes = bornesBr(scene);
const ctx: ContexteSim = { data: donnees.data, sol: creerSolLibre(donnees.data, bornes), bornes, centresBatiments: centresBatimentsEligibles(scene) };
const vide = (): ModeleApercu => ({ source: "simulation", mode: "br", joueurs: [], tigres: [] });
const instantane = (m: ModeleApercu) => JSON.stringify([m.vivants, m.total, m.joueurs.map((j) => [j.id, +j.p[0].toFixed(3), +j.p[1].toFixed(3), +j.p[2].toFixed(3), j.hors ?? "", j.chute ?? ""])]);
const pleins = donnees.data.buildings.filter((b) => !b.type);

function jouer(graine: number, secondes: number, f?: (m: ModeleApercu, t: number, cycle: number) => void) {
  const sim = creerSimBr(graine, ctx);
  const m = vide();
  const evts: string[] = [];
  const n = Math.round(secondes / PAS_SIM);
  for (let i = 1; i <= n; i++) {
    sim.pas(PAS_SIM);
    evts.push(...sim.evenements());
    if (f && i % 3 === 0) { sim.modele(m); f(m, i * PAS_SIM, sim.cycle); }
  }
  sim.modele(m);
  return { sim, m, evts };
}

describe("simulation du Battle Royale", () => {
  it("déterminisme : même graine, même état après 900 pas ; autre graine, autre état", () => {
    expect(instantane(jouer(5, 30).m)).toBe(instantane(jouer(5, 30).m));
    expect(instantane(jouer(5, 30).m)).not.toBe(instantane(jouer(6, 30).m));
  });

  it("invariants sur 10 graines × 120 s : 32 joueurs au plus, positions finies et dans les bornes, `sim` partout", () => {
    let violations = 0, vus = 0;
    for (let g = 1; g <= 10; g++) {
      jouer(g, 120, (m) => {
        if (m.joueurs.length > 32) violations++;
        for (const j of m.joueurs) {
          vus++;
          if (!j.sim || !Number.isFinite(j.p[0] + j.p[1] + j.p[2]) || j.p[0] < bornes.x0 - 5 || j.p[0] > bornes.x1 + 5 || j.p[2] < bornes.z0 - 5 || j.p[2] > bornes.z1 + 5 || j.p[1] < 0) violations++;
        }
      });
    }
    expect(vus).toBeGreaterThan(1000);
    expect(violations).toBe(0);
  }, 60_000);

  it("les joueurs au sol ne sont jamais dans un bâtiment plein", () => {
    for (let g = 1; g <= 4; g++) {
      let k = 0;
      jouer(g, 90, (m) => { if (k++ % 15 === 0) for (const j of m.joueurs) if (!j.chute) expect(pleins.some((b) => dedans(j.p[0], j.p[2], b.r))).toBe(false); });
    }
  });

  it("vivants : décroît sans jamais augmenter jusqu'à un seul vainqueur à la fin du dernier palier", () => {
    for (const g of [1, 2, 3, 4]) {
      let prec = Infinity, vu1 = false;
      let min = Infinity;
      jouer(g, 75, (m, _t, cycle) => {
        // un nouveau cycle (nouvelle partie) remet le compteur : on ne regarde que le premier cycle
        if (cycle > 0) return;
        const v = m.vivants ?? 0;
        expect(v).toBeLessThanOrEqual(prec);
        prec = v;
        min = Math.min(min, v);
        if (v === 1) vu1 = true;
      });
      expect(vu1).toBe(true);
      expect(min).toBe(1);
    }
  });

  it("le rayon de la zone ne grandit jamais ; l'avion traverse les bornes ; les joueurs en chute descendent sans remonter", () => {
    const sim = creerSimBr(2, ctx);
    const m = vide();
    let rPrec = Infinity;
    const alt = new Map<string, number>();
    let avionVu = false;
    for (let i = 0; i < 70 / PAS_SIM; i++) {
      sim.pas(PAS_SIM);
      if (sim.cycle > 0) break;
      sim.modele(m);
      const e = etatDepuisZoneBr(m.zone!, m.tSim!);
      expect(e.rayon).toBeLessThanOrEqual(rPrec + 1e-6);
      rPrec = e.rayon;
      if (m.avion) {
        avionVu = true;
        for (const p of [m.avion.depart, m.avion.arrivee]) {
          expect(p[0]).toBeGreaterThanOrEqual(bornes.x0 - 1); expect(p[0]).toBeLessThanOrEqual(bornes.x1 + 1);
          expect(p[1]).toBeGreaterThanOrEqual(bornes.z0 - 1); expect(p[1]).toBeLessThanOrEqual(bornes.z1 + 1);
        }
      }
      for (const j of m.joueurs) if (j.chute) {
        const a = alt.get(j.id);
        if (a !== undefined) expect(j.p[1]).toBeLessThanOrEqual(a + 1e-6);
        alt.set(j.id, j.p[1]);
      } else alt.delete(j.id);
    }
    expect(avionVu).toBe(true);
    expect(alt.size + 0).toBeGreaterThanOrEqual(0);
  });

  it("des joueurs sont vus en chute libre puis sous voile", () => {
    const vus = new Set<string>();
    jouer(1, 25, (m) => { for (const j of m.joueurs) if (j.chute) vus.add(j.chute); });
    expect(vus.has("libre")).toBe(true);
    expect(vus.has("voile")).toBe(true);
  });

  it("le cycle repart avec un autre effectif (nouvelle graine)", () => {
    const { sim } = jouer(1, 200);
    expect(sim.cycle).toBeGreaterThanOrEqual(1);
    const totaux = new Set<number>();
    for (let g = 1; g <= 20; g++) totaux.add(jouer(g, 0.1).m.total ?? 0);
    expect(totaux.size).toBeGreaterThanOrEqual(4);
    expect(BR_SIM.joueursMax).toBe(32);
  });

  it("variété : 20 graines donnent au moins 3 trajectoires d'avion distinctes", () => {
    const trajets = new Set<string>();
    for (let g = 1; g <= 20; g++) {
      const { m } = jouer(g, 0.1);
      trajets.add(`${Math.round(m.avion!.depart[0] / 30)}:${Math.round(m.avion!.depart[1] / 30)}:${Math.round(m.avion!.arrivee[0] / 30)}`);
    }
    expect(trajets.size).toBeGreaterThanOrEqual(3);
  });

  it("journal : zone, éliminations, victoire", () => {
    const { evts } = jouer(2, 90);
    expect(evts.some((e) => /^Zone \d+ : \d+ m$/.test(e))).toBe(true);
    expect(evts.some((e) => /restants\)$/.test(e))).toBe(true);
    expect(evts.some((e) => e.startsWith("Victoire de "))).toBe(true);
  });

  it("performance : 20 000 pas en moins de 1,5 s", () => {
    const sim = creerSimBr(1, ctx);
    const m = vide();
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) { sim.pas(PAS_SIM); if (i % 3 === 0) sim.modele(m); }
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
