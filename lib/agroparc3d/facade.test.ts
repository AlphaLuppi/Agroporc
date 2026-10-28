import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aireEmprise, colonnes, DIMENSIONS, estLisse, fenetreAllumee, murDePorte, mursDe, murLisse, nbEtages, PART_ALLUMEES, placementsToit,
  type Equipement,
} from "./facade";
import type { Building, SceneData, Vec2 } from "./types";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

function dedans(x: number, z: number, r: readonly Vec2[]): boolean {
  let d = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) d = !d;
  }
  return d;
}
function distAnneau(x: number, z: number, r: readonly Vec2[]): number {
  let m = Infinity;
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
    const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0;
    m = Math.min(m, Math.hypot(x - ax - t * ux, z - az - t * uz));
  }
  return m;
}
const carre = (x: number, z: number, c: number, h = 9): Building => ({ h, r: [[x, z], [x + c, z], [x + c, z + c], [x, z + c]], c: [x + c / 2, z + c / 2] });

describe("étages et colonnes", () => {
  it("nbEtages = max(1, round(h / 3,2))", () => {
    expect([1.4, 3, 4.7, 5, 6.4, 9.1, 16.1].map(nbEtages)).toEqual([1, 1, 1, 2, 2, 3, 5]);
    expect(nbEtages(0)).toBe(1);
  });

  it("colonnes : une fenêtre tous les ≈ 3 m, marges comprises, 0 si le mur ne tient pas une fenêtre", () => {
    expect([2, 3, 3.2, 3.4, 4, 6, 9, 12, 30].map(colonnes)).toEqual([0, 0, 0, 1, 1, 1, 2, 3, 9]);
    // jamais plus de colonnes que la place (fenêtre de 1,3 m + marges de 1 m)
    for (let L = 0; L < 80; L += 0.37) expect(colonnes(L) * 1.3).toBeLessThanOrEqual(Math.max(0, L - 2) + 1e-9);
  });
});

describe("bâtiments lisses", () => {
  it("lisse si plus bas que 3 m ou de moins de 40 m²", () => {
    expect(estLisse(carre(0, 0, 10, 2.9))).toBe(true);
    expect(estLisse(carre(0, 0, 6, 9))).toBe(true); // 36 m²
    expect(estLisse(carre(0, 0, 7, 9))).toBe(false); // 49 m²
    expect(estLisse(carre(0, 0, 10, 3))).toBe(false);
  });

  it("l'emprise retire les cours intérieures", () => {
    const b: Building = { ...carre(0, 0, 20), holes: [[[5, 5], [15, 5], [15, 15], [5, 15]]] };
    expect(aireEmprise(b)).toBeCloseTo(300, 6);
  });

  it("une arête de moins de 3 m est lisse", () => {
    expect(murLisse(2.99)).toBe(true);
    expect(murLisse(3)).toBe(false);
  });

  it("sur le vrai scene.json, quelques bâtiments seulement sont lisses", () => {
    const n = scene.buildings.filter(estLisse).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(scene.buildings.length / 2);
  });
});

describe("mursDe", () => {
  it("la face avant regarde vers l'extérieur du plein (vrai scene.json, anneaux dans les deux sens)", () => {
    let mal = 0, total = 0;
    for (const b of scene.buildings) {
      for (const m of mursDe(b)) {
        total++;
        const mx = (m.a[0] + m.b[0]) / 2, mz = (m.a[1] + m.b[1]) / 2;
        const dx = m.b[0] - m.a[0], dz = m.b[1] - m.a[1];
        // normale d'un quad (A bas, B bas, B haut) : (-dz, dx) ; elle doit être celle de la normale sortante
        if (-dz * m.nx + dx * m.nz <= 0) mal++;
        // un point 5 cm dehors n'est pas dans l'emprise (sauf mur dans une concavité rasante : tolérance d'un millième)
        if (dedans(mx + m.nx * 0.05, mz + m.nz * 0.05, b.r)) mal++;
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(mal).toBeLessThanOrEqual(Math.ceil(total / 1000));
  });

  it("une cour intérieure : murs tournés vers l'intérieur de la cour", () => {
    const cour: Vec2[] = [[5, 5], [15, 5], [15, 15], [5, 15]];
    const b: Building = { ...carre(0, 0, 20), holes: [cour] };
    const murs = mursDe(b);
    expect(murs).toHaveLength(8);
    for (const m of murs.filter((x) => x.trou)) {
      const mx = (m.a[0] + m.b[0]) / 2, mz = (m.a[1] + m.b[1]) / 2;
      expect(dedans(mx + m.nx * 0.05, mz + m.nz * 0.05, cour)).toBe(true);
    }
    for (const m of murs.filter((x) => !x.trou)) {
      const mx = (m.a[0] + m.b[0]) / 2, mz = (m.a[1] + m.b[1]) / 2;
      expect(dedans(mx + m.nx * 0.05, mz + m.nz * 0.05, b.r)).toBe(false);
    }
  });

  it("une seule porte, jamais sur une cour ; bâtiment lisse = murs lisses", () => {
    const b = carre(0, 0, 20);
    const murs = mursDe(b, 2);
    expect(murs.filter((m) => m.porte)).toHaveLength(1);
    expect(murs.find((m) => m.porte)?.arete).toBe(2);
    expect(mursDe(carre(0, 0, 5)).every((m) => m.lisse)).toBe(true);
    expect(mursDe(b).every((m) => !m.lisse)).toBe(true);
  });

  it("ignore les arêtes dégénérées", () => {
    const b: Building = { h: 9, r: [[0, 0], [10, 0], [10, 0], [10, 10], [0, 10]], c: [5, 5] };
    expect(mursDe(b)).toHaveLength(4);
  });
});

describe("murDePorte", () => {
  it("un mur long qui regarde la route : la route est au sud (z grand), la porte est sur la façade sud", () => {
    const b = carre(0, 0, 30);
    const i = murDePorte(b, [{ p: [[-50, 50], [80, 50]] }]);
    expect(i).not.toBeNull();
    const m = mursDe(b).find((x) => x.arete === i)!;
    expect(m.nz).toBeGreaterThan(0.99);
  });

  it("préfère le mur le plus long parmi ceux qui regardent la route", () => {
    // rectangle 40 × 10, route au sud-est : les murs sud (40) et est (10) la regardent, le plus long l'emporte
    const b: Building = { h: 9, r: [[0, 0], [40, 0], [40, 10], [0, 10]], c: [20, 5] };
    const i = murDePorte(b, [{ p: [[60, 40], [61, 41]] }]);
    const m = mursDe(b).find((x) => x.arete === i)!;
    expect(m.L).toBeCloseTo(40, 6);
  });

  it("sans route : le mur le plus long ; bâtiment lisse : null", () => {
    const b: Building = { h: 9, r: [[0, 0], [40, 0], [40, 10], [0, 10]], c: [20, 5] };
    const m = mursDe(b).find((x) => x.arete === murDePorte(b, []))!;
    expect(m.L).toBeCloseTo(40, 6);
    expect(murDePorte(carre(0, 0, 5), [])).toBeNull();
  });

  it("jamais null pour un bâtiment non lisse du vrai scene.json, mur assez long pour une porte", { timeout: 30000 }, () => {
    for (const b of scene.buildings) {
      const i = murDePorte(b, scene.roads);
      if (estLisse(b)) { expect(i).toBeNull(); continue; }
      expect(i).not.toBeNull();
      const m = mursDe(b).find((x) => x.arete === i && !x.trou)!;
      expect(m).toBeDefined();
      expect(m.L).toBeGreaterThanOrEqual(3);
    }
  });

  it("sur le vrai scene.json, la porte regarde la route la plus proche pour la grande majorité des bâtiments", { timeout: 30000 }, () => {
    let regardent = 0, n = 0;
    for (const b of scene.buildings) {
      const i = murDePorte(b, scene.roads);
      if (i === null) continue;
      const m = mursDe(b).find((x) => x.arete === i)!;
      let meilleur = { d: Infinity, x: 0, z: 0 };
      for (const r of scene.roads) for (let k = 0; k < r.p.length - 1; k++) {
        const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
        const mx = (m.a[0] + m.b[0]) / 2, mz = (m.a[1] + m.b[1]) / 2;
        const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz;
        const t = l2 ? Math.max(0, Math.min(1, ((mx - ax) * ux + (mz - az) * uz) / l2)) : 0;
        const d = Math.hypot(mx - ax - t * ux, mz - az - t * uz);
        if (d < meilleur.d) meilleur = { d, x: ax + t * ux, z: az + t * uz };
      }
      n++;
      if (m.nx * (meilleur.x - (m.a[0] + m.b[0]) / 2) + m.nz * (meilleur.z - (m.a[1] + m.b[1]) / 2) > 0) regardent++;
    }
    expect(regardent / n).toBeGreaterThan(0.85);
  });
});

describe("fenetreAllumee", () => {
  it("déterministe", () => {
    for (let i = 0; i < 50; i++) expect(fenetreAllumee(i, i % 5, i % 7, i)).toBe(fenetreAllumee(i, i % 5, i % 7, i));
  });

  it("≈ 25 % des fenêtres sont allumées (par bâtiment aussi), pas de motif répétitif d'un étage à l'autre", () => {
    let allumees = 0, total = 0;
    for (let bat = 0; bat < 160; bat++) for (let e = 0; e < 6; e++) for (let c = 0; c < 12; c++) { total++; if (fenetreAllumee(bat, e, c, 40)) allumees++; }
    expect(allumees / total).toBeGreaterThan(PART_ALLUMEES - 0.03);
    expect(allumees / total).toBeLessThan(PART_ALLUMEES + 0.03);
    const parBat: number[] = [];
    for (let bat = 0; bat < 160; bat++) { let k = 0; for (let e = 0; e < 6; e++) for (let c = 0; c < 12; c++) if (fenetreAllumee(bat, e, c, 40)) k++; parBat.push(k / 72); }
    expect(Math.min(...parBat)).toBeGreaterThan(0.08);
    expect(Math.max(...parBat)).toBeLessThan(0.45);
    // deux murs de longueurs différentes ne s'allument pas pareil
    let differents = 0;
    for (let c = 0; c < 40; c++) if (fenetreAllumee(7, 1, c, 80) !== fenetreAllumee(7, 1, c, 96)) differents++;
    expect(differents).toBeGreaterThan(5);
  });

  it("valeurs figées (le nuanceur recopie ce hachage : ne pas le changer sans lui)", () => {
    const vu = Array.from({ length: 16 }, (_, k) => (fenetreAllumee(114, k % 5, k, 240) ? 1 : 0)).join("");
    expect(vu).toBe(VALEURS_FIGEES);
  });
});

describe("placementsToit", () => {
  const equipements = scene.buildings.map((b, i) => ({ b, i, eq: placementsToit(b, i) }));

  it("déterministe", () => {
    for (const { b, i, eq } of equipements) expect(placementsToit(b, i)).toEqual(eq);
  });

  it("≈ 1 par 150 m² de toit, ≈ 300 au total sur la scène", () => {
    const total = equipements.reduce((s, x) => s + x.eq.length, 0);
    expect(total).toBeGreaterThan(220);
    expect(total).toBeLessThan(380);
    const grand = equipements.filter((x) => aireEmprise(x.b) > 1500);
    expect(grand.length).toBeGreaterThan(0);
    for (const x of grand) expect(x.eq.length).toBeGreaterThanOrEqual(Math.floor(aireEmprise(x.b) / 150 / 2));
  });

  it("dans l'emprise, hors du bord, hors des cours, sans chevauchement", () => {
    let dehors = 0, bord = 0, chevauche = 0;
    for (const { b, eq } of equipements) {
      eq.forEach((e: Equipement, k: number) => {
        if (!dedans(e.x, e.z, b.r)) dehors++;
        if (distAnneau(e.x, e.z, b.r) < Math.hypot(e.sx, e.sz) / 2 + 0.79) bord++;
        for (const o of eq.slice(k + 1)) if (Math.hypot(o.x - e.x, o.z - e.z) < 0.8) chevauche++;
      });
    }
    expect(dehors).toBe(0);
    expect(bord).toBe(0);
    expect(chevauche).toBe(0);
  });

  it("aucun équipement sur un bâtiment lisse, dimensions de la spec", () => {
    for (const { b, eq } of equipements) if (estLisse(b)) expect(eq).toEqual([]);
    expect(DIMENSIONS.clim).toEqual([1.5, 1, 1.2]);
    const types = new Set(equipements.flatMap((x) => x.eq.map((e) => e.type)));
    expect(types).toEqual(new Set(["clim", "edicule", "antenne"]));
  });

  it("évite les cours intérieures", () => {
    const b: Building = { ...carre(0, 0, 80), holes: [[[10, 10], [70, 10], [70, 70], [10, 70]]] };
    for (let g = 0; g < 20; g++) {
      for (const e of placementsToit(b, g)) expect(dedans(e.x, e.z, b.holes![0])).toBe(false);
    }
  });
});

const VALEURS_FIGEES = "0000000100000001";
