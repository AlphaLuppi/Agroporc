import { describe, expect, it } from "vitest";
import {
  PATROUILLE, aleaPatrouille, delaiEntrePatrouilles, lueurPatrouille, patrouillePermise, planPatrouille, positionPatrouille, teinteLueur,
  vitesseRadialePatrouille, type EtatPatrouille, type PlanPatrouille,
} from "./patrouille-zombies";
import { BORNES_ZOMBIES } from "./zombies-carte";

/** Patrouille de police des zombies (PUR) : trajet, position, Doppler, lueur, conditions de départ. */

const base: EtatPatrouille = {
  phase: "manche", manche: 3, mancheTruck: false, t: 100_000, dernierEclairT: -Infinity, lancees: 0, prochaineT: 50_000, finT: 0,
};

describe("planPatrouille", () => {
  it("un segment parallèle à un bord, hors de la carte, plus long de 2 × le débord, durée = longueur / vitesse", () => {
    const alea = aleaPatrouille(12345);
    for (let i = 0; i < 40; i++) {
      const pl = planPatrouille(BORNES_ZOMBIES, alea);
      const horizontal = pl.p0[2] === pl.p1[2];
      const vertical = pl.p0[0] === pl.p1[0];
      expect(horizontal !== vertical).toBe(true);
      const longueur = Math.hypot(pl.p1[0] - pl.p0[0], pl.p1[2] - pl.p0[2]);
      const bord = horizontal ? BORNES_ZOMBIES.x1 - BORNES_ZOMBIES.x0 : BORNES_ZOMBIES.z1 - BORNES_ZOMBIES.z0;
      expect(longueur).toBeCloseTo(bord + 2 * PATROUILLE.debordM, 6);
      expect(pl.dureeMs).toBe(Math.round((longueur / PATROUILLE.vitesse) * 1000));
      // jamais sur la carte : à `ecartM` du bord, en dehors
      const { x0, x1, z0, z1 } = BORNES_ZOMBIES;
      const dehors = horizontal
        ? pl.p0[2] <= z0 - PATROUILLE.ecartM + 1e-9 || pl.p0[2] >= z1 + PATROUILLE.ecartM - 1e-9
        : pl.p0[0] <= x0 - PATROUILLE.ecartM + 1e-9 || pl.p0[0] >= x1 + PATROUILLE.ecartM - 1e-9;
      expect(dehors).toBe(true);
    }
  });

  it("les quatre bords et les deux sens sortent, et le plan est déterministe pour une graine", () => {
    const alea = aleaPatrouille(7);
    const vus = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pl = planPatrouille(BORNES_ZOMBIES, alea);
      vus.add(`${pl.p0[0].toFixed(0)},${pl.p0[2].toFixed(0)}`);
    }
    expect(vus.size).toBe(8);
    expect(planPatrouille(BORNES_ZOMBIES, aleaPatrouille(99))).toEqual(planPatrouille(BORNES_ZOMBIES, aleaPatrouille(99)));
  });
});

describe("positionPatrouille", () => {
  const plan: PlanPatrouille = { p0: [0, 0, 0], p1: [200, 0, 0], t0: 10_000, finT: 20_000 };
  it("interpole à vitesse constante entre le départ et l'arrivée, null avant et après", () => {
    expect(positionPatrouille(plan, 9_999)).toBeNull();
    expect(positionPatrouille(plan, 10_000)).toEqual([0, 0, 0]);
    expect(positionPatrouille(plan, 15_000)).toEqual([100, 0, 0]);
    expect(positionPatrouille(plan, 20_000)).toEqual([200, 0, 0]);
    expect(positionPatrouille(plan, 20_001)).toBeNull();
  });
  it("un plan de durée nulle ou une horloge non numérique ne donnent rien", () => {
    expect(positionPatrouille({ ...plan, finT: plan.t0 }, plan.t0)).toBeNull();
    expect(positionPatrouille(plan, Number.NaN)).toBeNull();
  });
});

describe("vitesseRadialePatrouille", () => {
  const plan: PlanPatrouille = { p0: [0, 0, 0], p1: [200, 0, 0], t0: 0, finT: 10_000 };
  it("positive quand la voiture s'éloigne, négative quand elle approche, nulle hors trajet", () => {
    // écouteur en x = 100 : avant le passage la voiture approche, après elle s'éloigne ; à 20 m/s
    expect(vitesseRadialePatrouille(plan, [100, 0, 30], 2_000)).toBeLessThan(0);
    expect(vitesseRadialePatrouille(plan, [100, 0, 30], 8_000)).toBeGreaterThan(0);
    expect(vitesseRadialePatrouille(plan, [100, 0, 30], 12_000)).toBe(0);
  });
  it("jamais plus que la vitesse de la voiture", () => {
    for (let t = 0; t <= 10_000; t += 500) expect(Math.abs(vitesseRadialePatrouille(plan, [50, 0, 5], t))).toBeLessThanOrEqual(20 + 1e-9);
  });
});

describe("lueurPatrouille", () => {
  it("nulle au-delà de la distance de lueur et pour une distance invalide", () => {
    expect(lueurPatrouille(PATROUILLE.distanceLueurM, 0.1)).toEqual({ bleu: 0, rouge: 0 });
    expect(lueurPatrouille(500, 0.1)).toEqual({ bleu: 0, rouge: 0 });
    expect(lueurPatrouille(Number.NaN, 0.1)).toEqual({ bleu: 0, rouge: 0 });
  });
  it("jamais plus de 12 % et jamais bleu ET rouge ensemble ; les deux couleurs alternent", () => {
    let bleu = 0, rouge = 0;
    for (let d = 0; d < PATROUILLE.distanceLueurM; d += 7) {
      for (let t = 0; t < 4; t += 0.01) {
        const l = lueurPatrouille(d, t);
        expect(l.bleu).toBeGreaterThanOrEqual(0);
        expect(l.rouge).toBeGreaterThanOrEqual(0);
        expect(Math.max(l.bleu, l.rouge)).toBeLessThanOrEqual(PATROUILLE.lueurMax + 1e-12);
        expect(l.bleu === 0 || l.rouge === 0).toBe(true);
        if (l.bleu > 0) bleu++;
        if (l.rouge > 0) rouge++;
      }
    }
    expect(bleu).toBeGreaterThan(0);
    expect(rouge).toBeGreaterThan(0);
  });
  it("plus forte près de la voiture qu'au loin, à l'instant du maximum de l'alternance", () => {
    const t = 1 / PATROUILLE.alternancesParS / 2;
    const proche = lueurPatrouille(5, t), loin = lueurPatrouille(80, t);
    expect(proche.bleu).toBeGreaterThan(loin.bleu);
  });
  it("la teinte du brouillard tire vers le rouge ou vers le bleu, jamais au-delà de la lueur", () => {
    const r = teinteLueur({ bleu: 0, rouge: 0.1 }), b = teinteLueur({ bleu: 0.1, rouge: 0 });
    expect(r[0]).toBeGreaterThan(r[2]);
    expect(b[2]).toBeGreaterThan(b[0]);
    for (const c of [...r, ...b]) expect(c).toBeLessThanOrEqual(0.1);
  });
});

describe("patrouillePermise", () => {
  it("part en manche éligible, minuteur échu, rien en cours", () => {
    expect(patrouillePermise(base)).toBe(true);
  });
  it("jamais hors manche (lobby, pause entre manches, fin)", () => {
    for (const phase of ["lobby", "pause", "fin"] as const) expect(patrouillePermise({ ...base, phase })).toBe(false);
  });
  it("jamais avant la manche 3 (réglable), jamais en manche du Truck Muche", () => {
    expect(patrouillePermise({ ...base, manche: 2 })).toBe(false);
    expect(patrouillePermise({ ...base, manche: 2, mancheMin: 2 })).toBe(true);
    expect(patrouillePermise({ ...base, mancheTruck: true })).toBe(false);
  });
  it("deux au plus par partie", () => {
    expect(patrouillePermise({ ...base, lancees: 1 })).toBe(true);
    expect(patrouillePermise({ ...base, lancees: PATROUILLE.max })).toBe(false);
  });
  it("attend le minuteur armé, et la fin de la précédente", () => {
    expect(patrouillePermise({ ...base, prochaineT: null })).toBe(false);
    expect(patrouillePermise({ ...base, prochaineT: base.t + 1 })).toBe(false);
    expect(patrouillePermise({ ...base, finT: base.t + 1 })).toBe(false);
  });
  it("jamais dans les 20 s qui suivent un éclair d'orage", () => {
    expect(patrouillePermise({ ...base, dernierEclairT: base.t - 5_000 })).toBe(false);
    expect(patrouillePermise({ ...base, dernierEclairT: base.t - PATROUILLE.calmeEclairMs })).toBe(true);
  });
});

describe("délais et générateur", () => {
  it("le délai entre deux passages est tiré dans la plage (4 à 7 min)", () => {
    expect(delaiEntrePatrouilles(() => 0)).toBe(PATROUILLE.entreMinMs);
    expect(delaiEntrePatrouilles(() => 0.999999)).toBeLessThanOrEqual(PATROUILLE.entreMaxMs);
    expect(delaiEntrePatrouilles(() => 0.5)).toBe((PATROUILLE.entreMinMs + PATROUILLE.entreMaxMs) / 2);
  });
  it("le générateur est déterministe, dans [0, 1[ et n'est jamais figé sur une graine nulle ou négative", () => {
    const a = aleaPatrouille(5), b = aleaPatrouille(5);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(aleaPatrouille(0)()).toBeGreaterThan(0);
    expect(aleaPatrouille(-8)()).toBe(aleaPatrouille(8)());
  });
});
