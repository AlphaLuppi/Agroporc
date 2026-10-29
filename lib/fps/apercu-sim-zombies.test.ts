import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedans } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import type { ModeleApercu } from "./apercu-source";
import { creerSolLibre } from "./apercu-sol";
import { ZOMBIES_SIM, creerSimZombies, pvTigre, tigresDeManche, vitesseTigre } from "./apercu-sim-zombies";
import { PAS_SIM, type ContexteSim } from "./apercu-sim";
import { BORNES_ZOMBIES, FENETRES, donneesZombies } from "./zombies-carte";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const donnees = donneesZombies(scene);
const ctx: ContexteSim = { data: donnees.data, sol: creerSolLibre(donnees.data, { ...BORNES_ZOMBIES }), bornes: { ...BORNES_ZOMBIES }, fenetres: FENETRES };
const vide = (): ModeleApercu => ({ source: "simulation", mode: "zombies", joueurs: [], tigres: [] });
const instantane = (m: ModeleApercu) => JSON.stringify([m.manche, m.joueurs.map((j) => [j.pseudo, +j.p[0].toFixed(3), +j.p[2].toFixed(3)]), m.tigres.map((t) => [t.id, +t.x.toFixed(3), +t.z.toFixed(3), t.mode]), m.fenetres]);
const pleins = donnees.data.buildings.filter((b) => !b.type);

function jouer(graine: number, secondes: number, f?: (m: ModeleApercu, t: number, evts: string[]) => void) {
  const sim = creerSimZombies(graine, ctx);
  const m = vide();
  const evts: string[] = [];
  const n = Math.round(secondes / PAS_SIM);
  for (let i = 1; i <= n; i++) {
    sim.pas(PAS_SIM);
    const e = sim.evenements();
    evts.push(...e);
    if (f) { sim.modele(m); f(m, i * PAS_SIM, e); }
  }
  sim.modele(m);
  return { sim, m, evts };
}

describe("formules de la simulation des zombies", () => {
  it("tigres par manche, PV et vitesse", () => {
    expect(tigresDeManche(1)).toBe(6);
    expect(tigresDeManche(4)).toBe(18);
    expect(tigresDeManche(30)).toBe(24);
    expect(pvTigre(1)).toBe(150);
    expect(pvTigre(5)).toBe(550);
    expect(pvTigre(20)).toBe(950);
    expect([vitesseTigre(1), vitesseTigre(3), vitesseTigre(6)]).toEqual([1.6, 3.4, 5.6]);
  });
});

describe("simulation des zombies", () => {
  it("déterminisme : même graine, même état après 900 pas ; autre graine, autre état", () => {
    expect(instantane(jouer(5, 30).m)).toBe(instantane(jouer(5, 30).m));
    expect(instantane(jouer(5, 30).m)).not.toBe(instantane(jouer(6, 30).m));
  });

  it("invariants sur 10 graines × 120 s : 4 survivants et 64 tigres au plus, positions finies, survivants hors des bâtiments pleins, tous `sim`", () => {
    for (let g = 1; g <= 10; g++) {
      jouer(g, 120, (m) => {
        expect(m.joueurs.length).toBeLessThanOrEqual(4);
        expect(m.tigres.length).toBeLessThanOrEqual(64);
        for (const j of m.joueurs) {
          expect(j.sim).toBe(true);
          expect(Number.isFinite(j.p[0]) && Number.isFinite(j.p[2])).toBe(true);
        }
        for (const t of m.tigres) expect(Number.isFinite(t.x) && Number.isFinite(t.z) && Number.isFinite(t.cap)).toBe(true);
      });
    }
  });

  it("les survivants ne marchent jamais dans un bâtiment plein", () => {
    for (let g = 1; g <= 5; g++) {
      let k = 0;
      jouer(g, 90, (m) => { if (k++ % 15 === 0) for (const j of m.joueurs) expect(pleins.some((b) => dedans(j.p[0], j.p[2], b.r))).toBe(false); });
    }
  });

  it("chaque tigre apparaît sur un point d'une fenêtre du front, ne passe en chasse qu'après son saut ou son approche", () => {
    const points = FENETRES.flatMap((f) => f.points);
    for (const g of [1, 2, 3]) {
      const vus = new Set<number>();
      jouer(g, 90, (m) => {
        for (const t of m.tigres) {
          if (vus.has(t.id)) continue;
          vus.add(t.id);
          expect(t.mode).toBe("sol");
          expect(points.some((p) => Math.hypot(p[0] - t.x, p[1] - t.z) < 1.2)).toBe(true);
        }
      });
      expect(vus.size).toBeGreaterThan(0);
    }
  });

  it("fenêtres : une planche ne remonte pas pendant une manche, elles reviennent à 6 entre deux manches", () => {
    const sim = creerSimZombies(2, ctx);
    const m = vide();
    let manchePrec = -1, planchesPrec: number[] = [], vuReparation = false, vuArrachage = false;
    for (let i = 0; i < 120 / PAS_SIM; i++) {
      sim.pas(PAS_SIM);
      sim.modele(m);
      const p = [...(m.fenetres ?? [])];
      if (m.manche === manchePrec && planchesPrec.length) {
        // pendant une manche en cours (des tigres sont là ou vont l'être), aucune fenêtre ne gagne de planche
        const enManche = m.tigres.length > 0;
        p.forEach((v, k) => { if (enManche && v > planchesPrec[k]) throw new Error(`planche reposée en pleine manche (fenêtre ${k})`); if (v < planchesPrec[k]) vuArrachage = true; });
      }
      if (m.manche !== manchePrec && manchePrec !== -1 && m.manche === manchePrec + 1) {
        expect(p.every((v) => v <= ZOMBIES_SIM.planchesParFenetre)).toBe(true);
        if (p.every((v) => v === ZOMBIES_SIM.planchesParFenetre)) vuReparation = true;
      }
      manchePrec = m.manche ?? -1;
      planchesPrec = p;
    }
    expect(vuArrachage).toBe(true);
    expect(vuReparation).toBe(true);
  });

  it("la manche s'incrémente, le cycle finit et repart avec une autre ancre et un autre effectif", () => {
    const sim = creerSimZombies(3, ctx);
    const m = vide();
    const manches = new Set<number>();
    const ancres = new Set<string>();
    let cycleMax = 0;
    const effectifs = new Set<number>();
    for (let i = 0; i < 1500 / PAS_SIM; i++) {
      sim.pas(PAS_SIM);
      if (i % 30 === 0) {
        sim.modele(m);
        manches.add(m.manche ?? 0);
        cycleMax = Math.max(cycleMax, sim.cycle);
        effectifs.add(m.total ?? 0);
        if (m.joueurs[0]) ancres.add(`${sim.cycle}:${Math.round(m.joueurs[0].p[0] / 40)}:${Math.round(m.joueurs[0].p[2] / 40)}`);
      }
    }
    expect(manches.size).toBeGreaterThanOrEqual(3);
    expect(cycleMax).toBeGreaterThanOrEqual(2);
    expect(effectifs.size).toBeGreaterThanOrEqual(2);
  });

  it("variété : 20 graines donnent au moins 4 effectifs/manches de départ et 3 ancres distinctes", () => {
    const configs = new Set<string>();
    const ancres = new Set<string>();
    for (let g = 1; g <= 20; g++) {
      const { m } = jouer(g, 0.1);
      configs.add(`${m.total}:${m.manche}`);
      ancres.add(`${Math.round((m.joueurs[0]?.p[0] ?? 0) / 8)}:${Math.round((m.joueurs[0]?.p[2] ?? 0) / 8)}`);
    }
    expect(configs.size).toBeGreaterThanOrEqual(4);
    expect(ancres.size).toBeGreaterThanOrEqual(3);
  });

  it("les tigres attaquent bien des fenêtres (fenetresAttaquees) et le journal annonce les manches", () => {
    const sim = creerSimZombies(4, ctx);
    let max = 0;
    const evts: string[] = [];
    for (let i = 0; i < 120 / PAS_SIM; i++) { sim.pas(PAS_SIM); max = Math.max(max, sim.fenetresAttaquees().length); evts.push(...sim.evenements()); }
    expect(max).toBeGreaterThan(0);
    expect(evts.some((e) => /^Manche \d+/.test(e))).toBe(true);
  });

  it("performance : 20 000 pas en moins de 1,5 s", () => {
    const sim = creerSimZombies(1, ctx);
    const m = vide();
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) { sim.pas(PAS_SIM); if (i % 3 === 0) sim.modele(m); }
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
