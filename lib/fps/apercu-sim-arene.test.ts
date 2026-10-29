import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedans } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import type { ModeleApercu } from "./apercu-source";
import { creerSolLibre } from "./apercu-sol";
import { ARENE_SIM, creerSimArene } from "./apercu-sim-arene";
import { PAS_SIM, type ContexteSim } from "./apercu-sim";
import { bornesBr } from "./br-carte";
import { ROND_POINT } from "./zones";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const bornes = bornesBr(scene);
const ctx: ContexteSim = { data: scene, sol: creerSolLibre(scene, bornes), bornes };
const vide = (): ModeleApercu => ({ source: "simulation", mode: "arene", joueurs: [], tigres: [] });
const instantane = (m: ModeleApercu) => JSON.stringify(m.joueurs.map((j) => [j.id, j.pseudo, +j.p[0].toFixed(3), +j.p[2].toFixed(3), j.hors ?? ""]));
const dansBatiment = (x: number, z: number) => scene.buildings.some((b) => dedans(x, z, b.r));

function jouer(graine: number, secondes: number, aChaquePas?: (m: ModeleApercu, t: number) => void) {
  const sim = creerSimArene(graine, ctx);
  const m = vide();
  const evts: string[] = [];
  const n = Math.round(secondes / PAS_SIM);
  for (let i = 1; i <= n; i++) {
    sim.pas(PAS_SIM);
    if (aChaquePas) { sim.modele(m); aChaquePas(m, i * PAS_SIM); }
    evts.push(...sim.evenements());
  }
  sim.modele(m);
  return { sim, m, evts };
}

describe("simulation de l'arène", () => {
  it("déterminisme : même graine, même état après 900 pas ; graines différentes, positions différentes", () => {
    expect(instantane(jouer(7, 30).m)).toBe(instantane(jouer(7, 30).m));
    expect(instantane(jouer(7, 30).m)).not.toBe(instantane(jouer(8, 30).m));
  });

  it("invariants sur 10 graines × 120 s : positions finies, dans les bornes, jamais dans un bâtiment, 16 agents au plus, tous `sim`", () => {
    for (let g = 1; g <= 10; g++) {
      let violations = 0;
      jouer(g, 120, (m) => {
        if (m.source !== "simulation" || m.joueurs.length > 16 || m.joueurs.length < ARENE_SIM.agentsMin - 3) violations++;
        for (const j of m.joueurs) {
          if (!j.sim || !Number.isFinite(j.p[0] + j.p[2]) || j.p[0] < bornes.x0 || j.p[0] > bornes.x1 || j.p[2] < bornes.z0 || j.p[2] > bornes.z1) violations++;
        }
      });
      expect(violations).toBe(0);
    }
  });

  it("jamais dans un bâtiment (échantillonné toutes les secondes sur 5 graines)", () => {
    for (let g = 11; g <= 15; g++) {
      let k = 0;
      jouer(g, 120, (m) => { if (k++ % 30 === 0) for (const j of m.joueurs) expect(dansBatiment(j.p[0], j.p[2])).toBe(false); });
    }
  });

  it("restent dans le disque de jeu autour du rond-point (140 m + marge)", () => {
    jouer(3, 120, (m) => {
      for (const j of m.joueurs) expect(Math.hypot(j.p[0] - ROND_POINT.centre[0], j.p[2] - ROND_POINT.centre[1])).toBeLessThan(ARENE_SIM.rayonJeuM + 60);
    });
  });

  it("au moins un kill par 30 s en moyenne, et les morts réapparaissent (3 s plus tard)", () => {
    for (const g of [1, 2, 3, 4, 5]) {
      const { evts } = jouer(g, 120);
      const kills = evts.filter((e) => e.includes("a éliminé")).length;
      expect(kills).toBeGreaterThanOrEqual(2); // journal limité à 1 ligne / 2,5 s : la mesure est un plancher
    }
    let morts = 0, reapparus = 0;
    const suivi = new Map<string, boolean>();
    jouer(2, 120, (m) => {
      const mortsMaintenant = new Set(m.joueurs.filter((j) => j.hors === "mort").map((j) => j.id));
      for (const j of m.joueurs) {
        const etaitMort = suivi.get(j.id);
        if (etaitMort === undefined) suivi.set(j.id, mortsMaintenant.has(j.id));
        else if (!etaitMort && mortsMaintenant.has(j.id)) { morts++; suivi.set(j.id, true); }
        else if (etaitMort && !mortsMaintenant.has(j.id)) { reapparus++; suivi.set(j.id, false); }
      }
    });
    expect(morts).toBeGreaterThan(0);
    expect(reapparus).toBeGreaterThan(0);
  });

  it("un mort reste grisé 1,2 s puis disparaît du modèle", () => {
    let plusLong = 0;
    const courant = new Map<string, number>();
    jouer(2, 120, (m) => {
      const morts = new Set(m.joueurs.filter((j) => j.hors === "mort").map((j) => j.id));
      for (const id of morts) courant.set(id, (courant.get(id) ?? 0) + PAS_SIM);
      for (const [id, d] of courant) if (!morts.has(id)) { plusLong = Math.max(plusLong, d); courant.delete(id); }
    });
    expect(plusLong).toBeGreaterThan(0.5);
    expect(plusLong).toBeLessThan(ARENE_SIM.griseMortS + 0.2);
  });

  it("variété : 20 graines donnent au moins 4 effectifs distincts", () => {
    const tailles = new Set<number>();
    for (let g = 1; g <= 20; g++) tailles.add(jouer(g, 0.1).m.total ?? 0);
    expect(tailles.size).toBeGreaterThanOrEqual(4);
  });

  it("performance : 20 000 pas en moins de 1,5 s", () => {
    const sim = creerSimArene(1, ctx);
    const m = vide();
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) { sim.pas(PAS_SIM); if (i % 3 === 0) sim.modele(m); }
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("un dt énorme est borné (pas de rattrapage en rafale)", () => {
    const sim = creerSimArene(1, ctx);
    const m = vide();
    sim.pas(500);
    sim.modele(m);
    expect(m.joueurs.length).toBeGreaterThan(0);
  });
});
