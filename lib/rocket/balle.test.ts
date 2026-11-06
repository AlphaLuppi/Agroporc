import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BALLE, GRAVITE, PAS_S, creerRng, tirer, type Arene, type EtatBalle, type Vec3 } from "./contrat";
import { creerBalle, pasBalle, predireBalle } from "./balle";

const R = BALLE.rayon;

/**
 * Arène de repli du test (sol, quatre murs plans et plafond, sans cage) : boîte [-X, X] × [0, H] × [-Z, Z]. N'est PAS le stade :
 * elle ne sert qu'à vérifier la physique de la balle indépendamment de `arene.ts`.
 */
function boite(X = 40, H = 20, Z = 50): Arene {
  const sd = (p: Readonly<Vec3>): number => Math.min(p[0] + X, X - p[0], p[1], H - p[1], p[2] + Z, Z - p[2]);
  const normale = (p: Readonly<Vec3>): Vec3 => {
    const e = 0.01;
    const g: Vec3 = [
      sd([p[0] + e, p[1], p[2]]) - sd([p[0] - e, p[1], p[2]]),
      sd([p[0], p[1] + e, p[2]]) - sd([p[0], p[1] - e, p[2]]),
      sd([p[0], p[1], p[2] + e]) - sd([p[0], p[1], p[2] - e]),
    ];
    const n = Math.hypot(g[0], g[1], g[2]) || 1;
    return [g[0] / n, g[1] / n, g[2] / n];
  };
  return {
    sd,
    normale,
    sdNormale(p, n) {
      const r = normale(p);
      n[0] = r[0]; n[1] = r[1]; n[2] = r[2];
      return sd(p);
    },
    butMarque: () => null,
    dansCage: () => null,
    lancerRayon: () => null,
    surfaceProche: (p) => ({ point: [p[0], p[1], p[2]], normale: normale(p), distance: sd(p) }),
  };
}

function balle(p: Vec3, v: Vec3 = [0, 0, 0], w: Vec3 = [0, 0, 0]): EtatBalle {
  const b = creerBalle(p);
  b.v = [...v] as Vec3;
  b.w = [...w] as Vec3;
  return b;
}
const norme = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

function simuler(a: Arene, b: EtatBalle, secondes: number, surPas?: (i: number) => void): void {
  const n = Math.round(secondes / PAS_S);
  for (let i = 0; i < n; i++) { pasBalle(a, b, PAS_S); surPas?.(i); }
}

describe("creerBalle", () => {
  it("pose la balle au centre à la hauteur d'engagement, au repos, sans toucheur", () => {
    const b = creerBalle();
    expect(b.p).toEqual([0, BALLE.hauteurEngagement, 0]);
    expect(b.v).toEqual([0, 0, 0]);
    expect(b.w).toEqual([0, 0, 0]);
    expect(b.dernierToucheur).toBeNull();
    expect(b.avantDernierToucheur).toBeNull();
  });
  it("copie la position donnée (pas d'alias)", () => {
    const p: Vec3 = [1, 2, 3];
    const b = creerBalle(p);
    b.p[0] = 9;
    expect(p[0]).toBe(1);
  });
});

describe("gravité et vol libre", () => {
  it("chute libre : la vitesse verticale suit g·t à l'amortissement près", () => {
    const a = boite();
    const b = balle([0, 15, 0]);
    simuler(a, b, 1);
    // v(t) = -(g/k)(1 - e^{-k t}), k = -ln(0,97) ≈ 0,0305
    const k = -Math.log(1 - BALLE.amortissementLineaire);
    const attendu = -(GRAVITE / k) * (1 - Math.exp(-k * 1));
    expect(b.v[1]).toBeCloseTo(attendu, 1);
    expect(b.p[1]).toBeLessThan(15 - 0.5 * GRAVITE * 0.9);
    expect(b.p[1]).toBeGreaterThan(15 - 0.5 * GRAVITE * 1.05);
  });
  it("l'amortissement linéaire réduit une vitesse horizontale de 3 % par seconde", () => {
    const a = boite(1000, 1000, 1000);
    const b = balle([0, 500, 0], [10, 0, 0]);
    simuler(a, b, 1);
    expect(b.v[0]).toBeCloseTo(10 * (1 - BALLE.amortissementLineaire), 2);
  });
  it("l'amortissement angulaire réduit le spin de 3 % par seconde en vol", () => {
    const a = boite(1000, 1000, 1000);
    const b = balle([0, 500, 0], [0, 0, 0], [0, 4, 0]);
    simuler(a, b, 1);
    expect(b.w[1]).toBeCloseTo(4 * (1 - BALLE.amortissementAngulaire), 3);
  });
  it("ne fait rien pour dt ≤ 0", () => {
    const a = boite();
    const b = balle([0, 10, 0], [1, 2, 3]);
    expect(pasBalle(a, b, 0)).toBeNull();
    expect(b.p).toEqual([0, 10, 0]);
    expect(b.v).toEqual([1, 2, 3]);
  });
});

describe("rebonds", () => {
  it("rebonds successifs strictement décroissants, ratio de hauteur ≈ 0,36 au premier", () => {
    const a = boite();
    const hauteurChute = 5; // centre de la balle de R+5 à R
    const b = balle([0, R + hauteurChute, 0]);
    const sommets: number[] = [];
    let vyPrec = 0, enMontee = false;
    simuler(a, b, 14, () => {
      if (enMontee && vyPrec > 0 && b.v[1] <= 0) sommets.push(b.p[1] - R);
      enMontee = b.v[1] > 0;
      vyPrec = b.v[1];
    });
    expect(sommets.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < sommets.length; i++) expect(sommets[i]).toBeLessThan(sommets[i - 1]);
    // e² = 0,36, moins la traînée de 3 %/s sur ~2 s de vol
    expect(sommets[0] / hauteurChute).toBeGreaterThan(0.3);
    expect(sommets[0] / hauteurChute).toBeLessThan(0.37);
    // et chaque rebond garde ≈ e² de la hauteur du précédent
    expect(sommets[1] / sommets[0]).toBeGreaterThan(0.3);
    expect(sommets[1] / sommets[0]).toBeLessThan(0.37);
  });

  it("la vitesse normale ressortante vaut 0,6 × la vitesse d'impact et l'impact est rapporté", () => {
    const a = boite();
    const b = balle([0, 6, 0]);
    const impacts: number[] = [];
    let vyAvant = 0, vyApres = 0;
    for (let i = 0; i < 400; i++) {
      vyAvant = b.v[1];
      const imp = pasBalle(a, b, PAS_S);
      if (imp) {
        impacts.push(imp.vitesse);
        vyApres = b.v[1];
        expect(imp.normale[1]).toBeCloseTo(1, 5);
        expect(imp.point[1]).toBeCloseTo(0, 1);
        break;
      }
    }
    expect(impacts).toHaveLength(1);
    // la vitesse d'impact est celle du sous-pas de contact (≈ la vitesse avant le pas + g·dt)
    expect(impacts[0]).toBeGreaterThan(-vyAvant - 0.05);
    expect(impacts[0]).toBeLessThan(-vyAvant + GRAVITE * PAS_S + 0.05);
    expect(vyApres / impacts[0]).toBeCloseTo(BALLE.restitution, 1);
  });

  it("en vol libre, aucun impact n'est rapporté", () => {
    const a = boite();
    const b = balle([0, 10, 0], [3, 2, 1]);
    for (let i = 0; i < 60; i++) expect(pasBalle(a, b, PAS_S)).toBeNull();
  });

  it("rebondit sur un mur latéral et sur le plafond", () => {
    const a = boite();
    const mur = balle([39, 5, 0], [20, 0, 0]);
    let imp = null;
    for (let i = 0; i < 20 && !imp; i++) imp = pasBalle(a, mur, PAS_S);
    expect(imp).not.toBeNull();
    expect(imp!.normale[0]).toBeCloseTo(-1, 3);
    expect(mur.v[0]).toBeLessThan(0);
    expect(Math.abs(mur.v[0])).toBeCloseTo(20 * BALLE.restitution, 0);

    const plafond = balle([0, 18, 0], [0, 25, 0]);
    imp = null;
    for (let i = 0; i < 30 && !imp; i++) imp = pasBalle(a, plafond, PAS_S);
    expect(imp).not.toBeNull();
    expect(imp!.normale[1]).toBeCloseTo(-1, 3);
    expect(plafond.v[1]).toBeLessThan(0);
  });

  it("finit par se poser : plus de rebond sous le seuil, la balle repose sur le sol", () => {
    const a = boite();
    const b = balle([3, 8, 4]);
    simuler(a, b, 30);
    expect(b.p[1]).toBeCloseTo(R, 1);
    expect(Math.abs(b.v[1])).toBeLessThan(0.1);
  });
});

describe("repos et roulement", () => {
  it("au repos sur le sol, |v| < 0,05 après 3 s et la balle ne s'enfonce pas", () => {
    const a = boite();
    const b = balle([0, R, 0]);
    simuler(a, b, 3);
    expect(norme(b.v)).toBeLessThan(0.05);
    expect(b.p[1]).toBeGreaterThan(R - 0.01);
    expect(b.p[1]).toBeLessThan(R + 0.01);
  });

  it("une balle qui roule conserve l'essentiel de sa vitesse et reste collée au sol", () => {
    const a = boite(1000, 100, 1000);
    const v = 5;
    const b = balle([0, R, 0], [v, 0, 0], [0, 0, -v / R]);
    let yMax = 0;
    simuler(a, b, 1, () => { yMax = Math.max(yMax, b.p[1] - R); });
    expect(b.v[0]).toBeGreaterThan(v * 0.9);
    expect(b.v[0]).toBeLessThan(v);
    expect(yMax).toBeLessThan(0.02);
    // roulement sans glissement : w ≈ v / R
    expect(Math.abs(b.w[2]) * R / b.v[0]).toBeGreaterThan(0.9);
    expect(Math.abs(b.w[2]) * R / b.v[0]).toBeLessThan(1.1);
  });

  it("une balle glissante prend un spin de roulement cohérent (w ≈ v / R) jusqu'à saturation", () => {
    const a = boite(1000, 100, 1000);
    const b = balle([0, R, 0], [4, 0, 0]);
    simuler(a, b, 3);
    // glissement → roulement : v diminue, w_z négatif (balle qui avance en +X roule vers l'avant)
    expect(b.w[2]).toBeLessThan(0);
    expect(Math.abs(b.w[2]) * R / b.v[0]).toBeGreaterThan(0.85);
    expect(Math.abs(b.w[2]) * R / b.v[0]).toBeLessThan(1.15);
    expect(b.v[0]).toBeLessThan(4);
    // la glissade s'arrête quand v = w·R : la conservation du moment cinétique au contact donne 4 / 1,4 ≈ 2,86 m/s avant les pertes
    expect(b.v[0]).toBeGreaterThan(1.5);
  });

  it("très vite (spin saturé à 6 rad/s), la balle ralentit mais jamais plus que le frottement de Coulomb ne le permet", () => {
    const a = boite(1000, 100, 1000);
    const b = balle([0, R, 0], [30, 0, 0]);
    let vPrec = b.v[0];
    simuler(a, b, 2, () => {
      expect(b.v[0]).toBeLessThanOrEqual(vPrec + 1e-9);
      vPrec = b.v[0];
    });
    const decel = (30 - b.v[0]) / 2;
    expect(decel).toBeLessThan(BALLE.frottement * GRAVITE + 0.1 + 30 * 0.031);
    expect(decel).toBeGreaterThan(0);
  });
});

describe("spin après un contact oblique", () => {
  it("rebond oblique sur le sol : le spin apparaît avec le bon signe et la glissade de contact diminue", () => {
    const a = boite(1000, 100, 1000);
    const b = balle([0, R + 0.2, 0], [12, -6, 0]);
    let imp = null;
    for (let i = 0; i < 40 && !imp; i++) imp = pasBalle(a, b, PAS_S);
    expect(imp).not.toBeNull();
    // balle qui avance en +X avec le bas freiné : spin autour de -Z (comme une balle qui roule en avant)
    expect(b.w[2]).toBeLessThan(-0.3);
    expect(Math.abs(b.w[0])).toBeLessThan(1e-6);
    expect(Math.abs(b.w[1])).toBeLessThan(1e-6);
    // vitesse de glissement au point de contact : r = (0,-R,0) → vx + w_z·R (w_z < 0) ; elle est devenue plus petite que 12 m/s
    const glisseApres = Math.abs(b.v[0] + b.w[2] * R);
    expect(glisseApres).toBeLessThan(12);
    expect(b.v[0]).toBeLessThan(12);
    expect(b.v[1]).toBeGreaterThan(0);
  });

  it("le frottement respecte Coulomb : Δv tangentiel ≤ μ × Δv normal", () => {
    const a = boite(1000, 100, 1000);
    const b = balle([0, R + 0.05, 0], [20, -10, 0]);
    const vx0 = b.v[0];
    let imp = null;
    for (let i = 0; i < 20 && !imp; i++) imp = pasBalle(a, b, PAS_S);
    expect(imp).not.toBeNull();
    const dvn = b.v[1] - -10; // ≈ (1 + e) × 10 ... à la traînée près
    expect(Math.abs(vx0 - b.v[0])).toBeLessThanOrEqual(BALLE.frottement * dvn + 0.3);
  });

  it("le spin d'une balle qui tourne dans le vide est transféré à la vitesse au contact (effet)", () => {
    const a = boite(1000, 100, 1000);
    // spin arrière (backspin) : w_z > 0 avec v_x > 0 → au contact, le point bas va vers l'avant... la balle accélère vers l'avant
    const b = balle([0, R + 0.1, 0], [5, -5, 0], [0, 0, 6]);
    for (let i = 0; i < 20; i++) pasBalle(a, b, PAS_S);
    const sans = balle([0, R + 0.1, 0], [5, -5, 0]);
    for (let i = 0; i < 20; i++) pasBalle(a, sans, PAS_S);
    expect(b.v[0]).not.toBeCloseTo(sans.v[0], 2);
    expect(b.v[0]).toBeLessThan(sans.v[0]);
  });

  it("sur un mur, le frottement agit dans le plan tangent (spin autour de l'axe de roulement du mur)", () => {
    const a = boite(1000, 100, 1000);
    // balle lancée vers le mur x = +1000 avec une vitesse montante
    const b = balle([1000 - R - 0.5, 50, 0], [10, 8, 0]);
    let imp = null;
    for (let i = 0; i < 20 && !imp; i++) imp = pasBalle(a, b, PAS_S);
    expect(imp).not.toBeNull();
    expect(imp!.normale[0]).toBeCloseTo(-1, 3);
    // la vitesse verticale a été freinée par le frottement du mur, le spin est autour de Z
    expect(b.v[1]).toBeLessThan(8);
    expect(Math.abs(b.w[2])).toBeGreaterThan(0.1);
    expect(Math.abs(b.w[0])).toBeLessThan(1e-6);
  });
});

describe("bornes de vitesse", () => {
  it("plafonne la vitesse linéaire à 60 m/s", () => {
    const a = boite(1000, 1000, 1000);
    const b = balle([0, 500, 0], [0, 0, 100]);
    pasBalle(a, b, PAS_S);
    expect(norme(b.v)).toBeLessThanOrEqual(BALLE.vitesseMax + 1e-9);
    expect(norme(b.v)).toBeGreaterThan(BALLE.vitesseMax * 0.99);
  });
  it("plafonne la vitesse angulaire à 6 rad/s", () => {
    const a = boite(1000, 1000, 1000);
    const b = balle([0, 500, 0], [0, 0, 0], [30, 40, 0]);
    pasBalle(a, b, PAS_S);
    expect(norme(b.w)).toBeLessThanOrEqual(BALLE.vitesseAngMax + 1e-9);
  });
  it("tout spin créé par un contact reste sous le plafond", () => {
    const a = boite();
    const b = balle([0, 10, 0], [40, -20, 15]);
    simuler(a, b, 10, () => {
      expect(norme(b.w)).toBeLessThanOrEqual(BALLE.vitesseAngMax + 1e-9);
      expect(norme(b.v)).toBeLessThanOrEqual(BALLE.vitesseMax + 1e-9);
    });
  });
});

describe("jamais à travers un mur", () => {
  it("à 60 m/s droit sur chaque mur, le sol et le plafond, la balle ne traverse pas", () => {
    const a = boite();
    const dirs: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
    for (const d of dirs) {
      const b = balle([0, 10, 0], [d[0] * 60, d[1] * 60, d[2] * 60]);
      simuler(a, b, 4, () => {
        expect(a.sd(b.p)).toBeGreaterThan(R - 0.5 * R - 1e-6); // pénétration jamais plus d'un demi-rayon après le sous-pas
        expect(b.p[0]).toBeGreaterThan(-40);
        expect(b.p[0]).toBeLessThan(40);
        expect(b.p[1]).toBeGreaterThan(0);
        expect(b.p[1]).toBeLessThan(20);
        expect(b.p[2]).toBeGreaterThan(-50);
        expect(b.p[2]).toBeLessThan(50);
      });
    }
  });

  it("10 000 pas à vitesses aléatoires jusqu'à 60 m/s : la balle reste dans la boîte, y compris dans les coins", () => {
    const a = boite();
    const r = creerRng(2026);
    for (let essai = 0; essai < 5; essai++) {
      const b = balle(
        [(tirer(r) - 0.5) * 70, 2 + tirer(r) * 16, (tirer(r) - 0.5) * 90],
        [(tirer(r) - 0.5) * 120, (tirer(r) - 0.5) * 120, (tirer(r) - 0.5) * 120],
      );
      for (let i = 0; i < 2000; i++) {
        pasBalle(a, b, PAS_S);
        // une balle dans les coins peut toucher deux murs : on tolère la pénétration résiduelle d'un 1/2 rayon max
        expect(a.sd(b.p)).toBeGreaterThan(0);
        expect(norme(b.v)).toBeLessThanOrEqual(BALLE.vitesseMax + 1e-9);
        expect(Number.isFinite(b.p[0] + b.p[1] + b.p[2])).toBe(true);
      }
    }
  });

  it("un grand dt (30 Hz) est découpé en sous-pas et ne traverse pas non plus", () => {
    const a = boite();
    const b = balle([30, 10, 0], [60, 5, 20]);
    for (let i = 0; i < 600; i++) {
      pasBalle(a, b, 1 / 30);
      expect(a.sd(b.p)).toBeGreaterThan(0);
    }
  });
});

describe("déterminisme et immutabilité", () => {
  it("deux simulations identiques donnent exactement le même état", () => {
    const a = boite();
    const b1 = balle([1, 7, -3], [11, 2, 9], [0, 1, 0]);
    const b2 = balle([1, 7, -3], [11, 2, 9], [0, 1, 0]);
    simuler(a, b1, 5);
    simuler(a, b2, 5);
    expect(b1.p).toEqual(b2.p);
    expect(b1.v).toEqual(b2.v);
    expect(b1.w).toEqual(b2.w);
  });
  it("ne modifie pas les champs de toucheur", () => {
    const a = boite();
    const b = balle([0, 3, 0]);
    b.dernierToucheur = { idVoiture: 2, equipe: "orange", temps: 1.5 };
    simuler(a, b, 2);
    expect(b.dernierToucheur).toEqual({ idVoiture: 2, equipe: "orange", temps: 1.5 });
  });
});

describe("predireBalle", () => {
  it("ne modifie pas la balle d'entrée et rend 91 échantillons pour 3 s à 30 Hz", () => {
    const a = boite();
    const b = balle([2, 6, 1], [8, 3, -4], [0, 1, 0]);
    const avant = JSON.stringify(b);
    const traj = predireBalle(a, b, 3);
    expect(JSON.stringify(b)).toBe(avant);
    expect(traj).toHaveLength(91);
    expect(traj[0].t).toBe(0);
    expect(traj[0].p).toEqual(b.p);
    expect(traj[0].v).toEqual(b.v);
    expect(traj[1].t).toBeCloseTo(1 / 30, 10);
    expect(traj[90].t).toBeCloseTo(3, 9);
  });
  it("coïncide exactement avec l'intégration pas à pas", () => {
    const a = boite();
    const b = balle([2, 6, 1], [8, 3, -4]);
    const traj = predireBalle(a, b, 2, 0.1);
    const ref = balle([2, 6, 1], [8, 3, -4]);
    for (let i = 0; i < 240; i++) pasBalle(a, ref, PAS_S);
    const dernier = traj[traj.length - 1];
    expect(dernier.t).toBeCloseTo(2, 9);
    expect(dernier.p).toEqual(ref.p);
    expect(dernier.v).toEqual(ref.v);
  });
  it("indépendante de l'appelant : deux appels donnent la même trajectoire, durée nulle = un échantillon", () => {
    const a = boite();
    const b = balle([0, 5, 0], [3, 3, 3]);
    expect(predireBalle(a, b, 1)).toEqual(predireBalle(a, b, 1));
    expect(predireBalle(a, b, 0)).toHaveLength(1);
  });
  it("prévoit le rebond au sol", () => {
    const a = boite();
    const b = balle([0, 5, 0]);
    const traj = predireBalle(a, b, 3);
    expect(Math.min(...traj.map((e) => e.p[1]))).toBeGreaterThanOrEqual(R - 0.5 * R);
    expect(traj.some((e) => e.v[1] > 0)).toBe(true);
  });
});

describe("performance (indicatif)", () => {
  it("un pas de balle reste très largement sous 0,1 ms en moyenne", () => {
    const a = boite();
    const b = balle([0, 10, 0], [20, 5, 15]);
    const n = 20000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) pasBalle(a, b, PAS_S);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
    expect(ms).toBeLessThan(0.1);
  });
});

// ------------------------------------------------------------------------------------------------------------------------
// Sur le vrai stade, quand `arene.ts` existe : mêmes garanties sur la SDF continue (coins arrondis, cages).
// ------------------------------------------------------------------------------------------------------------------------
const areneDispo = existsSync(new URL("./arene.ts", import.meta.url));
describe.skipIf(!areneDispo)("sur le vrai stade (arene.ts)", () => {
  const charger = async (): Promise<Arene> => {
    const chemin = "./arene";
    const mod = (await import(/* @vite-ignore */ chemin)) as { creerArene: () => Arene };
    return mod.creerArene();
  };

  it("10 000 pas à 60 m/s depuis le centre : jamais dans la matière, jamais au-dessus du plafond", async () => {
    const a = await charger();
    const r = creerRng(7);
    for (let essai = 0; essai < 5; essai++) {
      const b = balle([0, 5, 0], [(tirer(r) - 0.5) * 120, (tirer(r) - 0.5) * 60, (tirer(r) - 0.5) * 120]);
      for (let i = 0; i < 2000; i++) {
        pasBalle(a, b, PAS_S);
        expect(a.sd(b.p)).toBeGreaterThan(0);
        expect(b.p[1]).toBeLessThan(20.44);
      }
    }
  });

  it("un tir à 30 m/s dans le but : butMarque vrai, la balle reste dans la cage", async () => {
    const a = await charger();
    const b = balle([0, 3, 40], [0, 0.5, 30]);
    let marque = false;
    for (let i = 0; i < 600 && !marque; i++) {
      pasBalle(a, b, PAS_S);
      marque = a.butMarque(b.p, R) === "bleue" || a.butMarque(b.p, R) === "orange";
    }
    expect(marque).toBe(true);
    // après le but la balle rebondit sur le fond de la cage (elle peut en ressortir, comme dans RL) mais ne traverse jamais le filet
    let zMax = 0;
    for (let i = 0; i < 600; i++) {
      pasBalle(a, b, PAS_S);
      zMax = Math.max(zMax, Math.abs(b.p[2]));
      expect(a.sd(b.p)).toBeGreaterThan(0);
    }
    expect(zMax).toBeLessThan(60 - R + 0.1);
    expect(zMax).toBeGreaterThan(51.2);
  });

  it("chute de 5 m sur le sol du stade : premier rebond ≈ 0,36 × la hauteur", async () => {
    const a = await charger();
    const b = balle([0, R + 5, 0]);
    let sommet = 0, vyPrec = 0, enMontee = false;
    for (let i = 0; i < 12 * 120 && sommet === 0; i++) {
      pasBalle(a, b, PAS_S);
      if (enMontee && vyPrec > 0 && b.v[1] <= 0) sommet = b.p[1] - R;
      enMontee = b.v[1] > 0;
      vyPrec = b.v[1];
    }
    expect(sommet / 5).toBeGreaterThan(0.3);
    expect(sommet / 5).toBeLessThan(0.38);
  });
});
