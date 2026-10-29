import { describe, expect, it } from "vitest";
import type { Boite } from "./collision";
import {
  PALIERS_ZONE, distanceAuBord, echelleDureeZone, etatDepuisZoneBr, etatZone, genererPlanZone, horsZone, rayonInitialPour,
  tirerCercleSuivant, zoneBrPublique, type Cercle, type PlanZone,
} from "./br-zone";

/** bornes réelles de la scène BR (142 bâtiments d'origine) */
const BORNES: Boite = { x0: -348.8, z0: -257.9, x1: 392.4, z1: 233.7 };
const CENTRE: [number, number] = [(BORNES.x0 + BORNES.x1) / 2, (BORNES.z0 + BORNES.z1) / 2];
const EPS = 1e-6;

/** générateur déterministe (mulberry32) */
function graine(s: number): () => number {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** vingt centres répartis dans les bornes, autour du milieu */
const CENTRES_20: [number, number][] = Array.from({ length: 20 }, (_, i) => [CENTRE[0] + ((i % 5) - 2) * 90, CENTRE[1] + (Math.floor(i / 5) - 1.5) * 80]);

const incluse = (a: Cercle, b: Cercle) => Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) + a.r <= b.r + EPS;

describe("paliers de la zone", () => {
  it("six paliers : rayons décroissants jusqu'à la fermeture, dégâts croissants, 535 s au total", () => {
    expect(PALIERS_ZONE).toHaveLength(6);
    expect(PALIERS_ZONE.map((p) => p.rayon)).toEqual([250, 150, 85, 45, 20, 0]);
    for (let i = 1; i < PALIERS_ZONE.length; i++) {
      expect(PALIERS_ZONE[i].rayon).toBeLessThan(PALIERS_ZONE[i - 1].rayon);
      expect(PALIERS_ZONE[i].degatsParS).toBeGreaterThan(PALIERS_ZONE[i - 1].degatsParS);
    }
    expect(PALIERS_ZONE.map((p) => p.degatsParS)).toEqual([1, 2, 4, 7, 10, 15]);
    const total = PALIERS_ZONE.reduce((s, p) => s + p.attenteMs + p.retreciMs, 0);
    expect(total).toBe(535_000);
  });
});

describe("rayon initial et échelle", () => {
  it("rayonInitialPour couvre les quatre coins des bornes réelles et vaut environ 455 m", () => {
    const r = rayonInitialPour(BORNES);
    expect(r).toBeGreaterThan(445);
    expect(r).toBeLessThan(460);
    for (const [x, z] of [[BORNES.x0, BORNES.z0], [BORNES.x0, BORNES.z1], [BORNES.x1, BORNES.z0], [BORNES.x1, BORNES.z1]]) {
      expect(Math.hypot(x - CENTRE[0], z - CENTRE[1])).toBeLessThanOrEqual(r - 9.99);
    }
  });

  it("le plan commence par un cercle centré sur les bornes, au rayon initial, ou à celui demandé", () => {
    const plan = genererPlanZone({ bornes: BORNES, debutT: 0, alea: graine(1) });
    expect(plan.cercles[0]).toEqual({ c: CENTRE, r: rayonInitialPour(BORNES) });
    expect(plan.cercles).toHaveLength(PALIERS_ZONE.length + 1);
    const petit = genererPlanZone({ bornes: BORNES, debutT: 0, alea: graine(1), rayonInitial: 300 });
    expect(petit.cercles[0].r).toBe(300);
  });

  it("echelleDureeZone : 0,6 / 0,8 / 1 et l'attente du palier 1 reste d'au moins 70 s", () => {
    for (const n of [0, 1, 2, 3, 4]) expect(echelleDureeZone(n)).toBe(0.6);
    for (const n of [5, 8, 10]) expect(echelleDureeZone(n)).toBe(0.8);
    for (const n of [11, 30, 50]) expect(echelleDureeZone(n)).toBe(1);
    for (let n = 2; n <= 50; n++) expect(echelleDureeZone(n) * 120).toBeGreaterThanOrEqual(70);
  });

  it("l'échelle multiplie les durées, jamais les rayons ni les dégâts", () => {
    const plan = genererPlanZone({ bornes: BORNES, debutT: 1000, alea: graine(3), echelle: 0.5 });
    expect(plan.paliers.map((p) => p.attenteMs)).toEqual(PALIERS_ZONE.map((p) => p.attenteMs * 0.5));
    expect(plan.paliers.map((p) => p.retreciMs)).toEqual(PALIERS_ZONE.map((p) => p.retreciMs * 0.5));
    expect(plan.paliers.map((p) => p.rayon)).toEqual(PALIERS_ZONE.map((p) => p.rayon));
    expect(plan.paliers.map((p) => p.degatsParS)).toEqual(PALIERS_ZONE.map((p) => p.degatsParS));
    // les constantes exportées ne sont pas modifiées
    expect(PALIERS_ZONE[0].attenteMs).toBe(120_000);
    expect(etatZone(plan, 1000 + 60_000 - 1).phase).toBe("attente");
    expect(etatZone(plan, 1000 + 60_000).phase).toBe("retrecit");
  });
});

describe("tirage des cercles", () => {
  it("inclusion et centre dans les bornes rétrécies, sur 2000 graines et tous les paliers", () => {
    for (let s = 1; s <= 2000; s++) {
      const plan = genererPlanZone({ bornes: BORNES, debutT: 0, alea: graine(s), centresBatiments: CENTRES_20 });
      for (let i = 1; i < plan.cercles.length; i++) {
        const prec = plan.cercles[i - 1];
        const c = plan.cercles[i];
        expect(c.r).toBe(PALIERS_ZONE[i - 1].rayon);
        expect(incluse(c, prec)).toBe(true);
        expect(c.c[0]).toBeGreaterThanOrEqual(BORNES.x0 + 0.5 * c.r - EPS);
        expect(c.c[0]).toBeLessThanOrEqual(BORNES.x1 - 0.5 * c.r + EPS);
        expect(c.c[1]).toBeGreaterThanOrEqual(BORNES.z0 + 0.5 * c.r - EPS);
        expect(c.c[1]).toBeLessThanOrEqual(BORNES.z1 - 0.5 * c.r + EPS);
      }
    }
  });

  it("sans bâtiments : même garanties (tirage uniforme)", () => {
    for (let s = 1; s <= 500; s++) {
      const plan = genererPlanZone({ bornes: BORNES, debutT: 0, alea: graine(s) });
      for (let i = 1; i < plan.cercles.length; i++) expect(incluse(plan.cercles[i], plan.cercles[i - 1])).toBe(true);
    }
  });

  it("déterminisme à graine fixe, et les graines différentes donnent des plans différents", () => {
    const a = genererPlanZone({ bornes: BORNES, debutT: 5, alea: graine(42), centresBatiments: CENTRES_20 });
    const b = genererPlanZone({ bornes: BORNES, debutT: 5, alea: graine(42), centresBatiments: CENTRES_20 });
    const c = genererPlanZone({ bornes: BORNES, debutT: 5, alea: graine(43), centresBatiments: CENTRES_20 });
    expect(b).toEqual(a);
    expect(c.cercles).not.toEqual(a.cercles);
  });

  it("repli : sans place dans le rectangle, le centre ne bouge pas ; rectangle vide : centre des bornes", () => {
    const etroit: Boite = { x0: 0, z0: 0, x1: 10, z1: 10 };
    const prec: Cercle = { c: [5, 5], r: 20 };
    // r1 = 15 : bornes rétrécies vides, seul le milieu convient
    const c = tirerCercleSuivant(prec, 15, etroit, graine(7));
    expect(c).toEqual({ c: [5, 5], r: 15 });
    // aucune marge de tirage (r1 = r0) : même centre
    expect(tirerCercleSuivant(prec, 20, etroit, graine(7))).toEqual({ c: [5, 5], r: 20 });
    // un rayon supérieur au précédent est plafonné
    expect(tirerCercleSuivant(prec, 50, etroit, graine(7)).r).toBe(20);
  });

  it("rayon 0 : le dernier cercle est un point inclus dans le précédent", () => {
    const prec: Cercle = { c: [10, 20], r: 20 };
    for (let s = 1; s <= 200; s++) {
      const c = tirerCercleSuivant(prec, 0, BORNES, graine(s), CENTRES_20);
      expect(c.r).toBe(0);
      expect(incluse(c, prec)).toBe(true);
    }
  });

  it("environ 60 % des cercles sont biaisés vers un bâtiment creux (bruit de 15 m)", () => {
    const centres: [number, number][] = [[CENTRE[0] - 90, CENTRE[1] + 40], [CENTRE[0] + 60, CENTRE[1] - 70], [CENTRE[0] + 20, CENTRE[1] + 100]];
    const prec: Cercle = { c: CENTRE, r: rayonInitialPour(BORNES) };
    const N = 2000;
    let proches = 0;
    for (let s = 1; s <= N; s++) {
      const c = tirerCercleSuivant(prec, 250, BORNES, graine(s), centres);
      if (centres.some(([x, z]) => Math.abs(c.c[0] - x) <= 15 + EPS && Math.abs(c.c[1] - z) <= 15 + EPS)) proches++;
    }
    // 60 % de tirages biaisés + une poignée de tirages uniformes qui tombent près d'un bâtiment (≈ 3 %)
    expect(proches / N).toBeGreaterThan(0.55);
    expect(proches / N).toBeLessThan(0.68);
  });

  it("un bâtiment hors de portée n'attire pas : le tirage reste uniforme et inclus", () => {
    const loin: [number, number][] = [[CENTRE[0] + 5000, CENTRE[1]]];
    const prec: Cercle = { c: CENTRE, r: 300 };
    for (let s = 1; s <= 200; s++) expect(incluse(tirerCercleSuivant(prec, 250, BORNES, graine(s), loin), prec)).toBe(true);
  });
});

describe("état de la zone dans le temps", () => {
  const debutT = 10_000;
  const plan = genererPlanZone({ bornes: BORNES, debutT, alea: graine(11), centresBatiments: CENTRES_20 });
  const p = plan.paliers;
  const finAttente1 = debutT + p[0].attenteMs;
  const finRetreci1 = finAttente1 + p[0].retreciMs;

  it("avant le départ : attente du palier 1 sur le cercle initial", () => {
    const e = etatZone(plan, 0);
    expect(e.palier).toBe(1);
    expect(e.phase).toBe("attente");
    expect(e.rayon).toBe(plan.cercles[0].r);
    expect(e.centre).toEqual(plan.cercles[0].c);
    expect(e.t0).toBe(debutT);
    expect(e.t1).toBe(finAttente1);
    expect(e.t2).toBe(finRetreci1);
    expect(e.cible).toEqual(plan.cercles[1]);
    expect(etatZone(plan, debutT)).toEqual({ ...e });
  });

  it("aux bornes des phases : fin d'attente exclue, fin de rétrécissement exclue", () => {
    expect(etatZone(plan, finAttente1 - 1).phase).toBe("attente");
    const debutRetreci = etatZone(plan, finAttente1);
    expect(debutRetreci.phase).toBe("retrecit");
    expect(debutRetreci.rayon).toBe(plan.cercles[0].r);
    expect(debutRetreci.centre).toEqual(plan.cercles[0].c);
    const suite = etatZone(plan, finRetreci1);
    expect(suite.palier).toBe(2);
    expect(suite.phase).toBe("attente");
    expect(suite.rayon).toBe(plan.cercles[1].r);
    expect(suite.centre).toEqual(plan.cercles[1].c);
    expect(suite.t0).toBe(finRetreci1);
    expect(suite.degatsParS).toBe(2);
    const presqueFin = etatZone(plan, finRetreci1 - 1);
    expect(presqueFin.phase).toBe("retrecit");
    expect(presqueFin.rayon).toBeCloseTo(plan.cercles[1].r, 1);
  });

  it("à mi-rétrécissement, le cercle est à mi-chemin", () => {
    const e = etatZone(plan, finAttente1 + p[0].retreciMs / 2);
    expect(e.rayon).toBeCloseTo((plan.cercles[0].r + plan.cercles[1].r) / 2, 9);
    expect(e.centre[0]).toBeCloseTo((plan.cercles[0].c[0] + plan.cercles[1].c[0]) / 2, 9);
    expect(e.centre[1]).toBeCloseTo((plan.cercles[0].c[1] + plan.cercles[1].c[1]) / 2, 9);
  });

  it("après le dernier palier : zone fermée au point final, dégâts du dernier palier, état stable", () => {
    const fin = debutT + p.reduce((s, x) => s + x.attenteMs + x.retreciMs, 0);
    const juste = etatZone(plan, fin - 1);
    expect(juste.phase).toBe("retrecit");
    expect(juste.palier).toBe(6);
    const f = etatZone(plan, fin);
    expect(f.phase).toBe("fermee");
    expect(f.palier).toBe(6);
    expect(f.rayon).toBe(0);
    expect(f.cible).toBeNull();
    expect(f.degatsParS).toBe(15);
    expect(f.centre).toEqual(plan.cercles[6].c);
    expect(etatZone(plan, fin + 1_000_000)).toEqual(f);
  });

  it("rayon décroissant sur toute la partie, dégâts croissants, inclusion à chaque instant", () => {
    for (let s = 1; s <= 100; s++) {
      const pl: PlanZone = genererPlanZone({ bornes: BORNES, debutT: 0, alea: graine(s), centresBatiments: CENTRES_20 });
      let rayonPrec = Infinity;
      let degatsPrec = 0;
      for (let t = 0; t <= 560_000; t += 500) {
        const e = etatZone(pl, t);
        expect(e.rayon).toBeLessThanOrEqual(rayonPrec + EPS);
        expect(e.degatsParS).toBeGreaterThanOrEqual(degatsPrec);
        // le cercle courant est toujours dans le cercle initial et dans celui du début du palier
        expect(incluse({ c: e.centre, r: e.rayon }, pl.cercles[0])).toBe(true);
        expect(incluse({ c: e.centre, r: e.rayon }, pl.cercles[e.palier - 1])).toBe(true);
        rayonPrec = e.rayon;
        degatsPrec = e.degatsParS;
      }
    }
    // 100 graines × 1 120 instants : lourd sous charge, d'où le délai large
  }, 30_000);

  it("horsZone et distanceAuBord : bord exclu, signe selon le côté", () => {
    const e = etatZone(plan, 0);
    const [cx, cz] = e.centre;
    expect(horsZone(e, cx, cz)).toBe(false);
    expect(horsZone(e, cx + e.rayon, cz)).toBe(false);
    expect(horsZone(e, cx + e.rayon + 0.01, cz)).toBe(true);
    expect(distanceAuBord(e, cx, cz)).toBeCloseTo(-e.rayon, 9);
    expect(distanceAuBord(e, cx + e.rayon + 5, cz)).toBeCloseTo(5, 9);
    expect(distanceAuBord(e, cx, cz + e.rayon)).toBeCloseTo(0, 9);
    // les quatre coins sont dans la zone au départ
    for (const [x, z] of [[BORNES.x0, BORNES.z0], [BORNES.x0, BORNES.z1], [BORNES.x1, BORNES.z0], [BORNES.x1, BORNES.z1]]) expect(horsZone(e, x, z)).toBe(false);
  });
});

describe("message public et parité client", () => {
  it("etatDepuisZoneBr(zoneBrPublique(plan, t), t) égale etatZone(plan, t), à tout instant", () => {
    for (let s = 1; s <= 30; s++) {
      const plan = genererPlanZone({ bornes: BORNES, debutT: 2_000, alea: graine(s), centresBatiments: CENTRES_20, echelle: s % 2 ? 1 : 0.6 });
      for (let t = 0; t <= 600_000; t += 1_700) {
        expect(etatDepuisZoneBr(zoneBrPublique(plan, t), t)).toEqual(etatZone(plan, t));
      }
      // aux bornes exactes des phases
      for (const p of [plan.paliers]) {
        let t0 = 2_000;
        for (const x of p) {
          for (const t of [t0, t0 + x.attenteMs - 1, t0 + x.attenteMs, t0 + x.attenteMs + x.retreciMs - 1]) {
            expect(etatDepuisZoneBr(zoneBrPublique(plan, t), t)).toEqual(etatZone(plan, t));
          }
          t0 += x.attenteMs + x.retreciMs;
        }
        expect(etatDepuisZoneBr(zoneBrPublique(plan, t0), t0)).toEqual(etatZone(plan, t0));
      }
    }
  });

  it("le message décrit le palier : cercle de départ, cercle visé, dégâts, nombre de paliers", () => {
    const plan = genererPlanZone({ bornes: BORNES, debutT: 0, alea: graine(5), centresBatiments: CENTRES_20 });
    const t = plan.paliers[0].attenteMs + plan.paliers[0].retreciMs + 5_000;
    const z = zoneBrPublique(plan, t);
    expect(z.palier).toBe(2);
    expect(z.nbPaliers).toBe(6);
    expect(z.phase).toBe("attente");
    expect(z.c0).toEqual(plan.cercles[1].c);
    expect(z.r0).toBe(plan.cercles[1].r);
    expect(z.c1).toEqual(plan.cercles[2].c);
    expect(z.r1).toBe(plan.cercles[2].r);
    expect(z.degats).toBe(2);
  });

  it("zone fermée : cercles confondus au point final", () => {
    const plan = genererPlanZone({ bornes: BORNES, debutT: 0, alea: graine(5) });
    const z = zoneBrPublique(plan, 10_000_000);
    expect(z.phase).toBe("fermee");
    expect(z.palier).toBe(6);
    expect(z.r0).toBe(0);
    expect(z.r1).toBe(0);
    expect(z.c0).toEqual(z.c1);
    expect(z.degats).toBe(15);
  });

  it("un message périmé (après la fin du rétrécissement) tient le cercle visé, sans cible", () => {
    const plan = genererPlanZone({ bornes: BORNES, debutT: 0, alea: graine(5) });
    const z = zoneBrPublique(plan, plan.paliers[0].attenteMs + 1);
    const e = etatDepuisZoneBr(z, z.t2 + 10);
    expect(e.rayon).toBe(z.r1);
    expect(e.centre).toEqual(z.c1);
    expect(e.cible).toBeNull();
  });
});
