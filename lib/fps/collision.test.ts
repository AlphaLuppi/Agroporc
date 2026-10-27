import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aleaGraine, dedans, distSegment } from "../agroparc3d/cachettes";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde, lancerRayon, pointsApparition, resoudre, solSous, visible, MARGE_BORNES_M } from "./collision";
import type { Vec3 } from "./protocole";
import { SILHOUETTE } from "./protocole";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMonde(scene);
const R = SILHOUETTE.rayon, H = SILHOUETTE.hauteur;

/** CBA : le bâtiment qui contient le point intérieur connu. */
const iCba = scene.buildings.findIndex((b) => dedans(-162.8, -12.7, b.r));
const cba = scene.buildings[iCba];

/** Scène réduite à quelques bâtiments (le reste de scene.json sert de décor vide). */
function sceneAvec(buildings: Building[]): SceneData {
  return { ...scene, buildings, pois: [] };
}
function rect(x0: number, z0: number, x1: number, z1: number, h: number, holes?: Vec2[][]): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2], holes };
}
function distBatiment(x: number, z: number, b: Building): number {
  let d = Infinity;
  for (let i = 0, j = b.r.length - 1; i < b.r.length; j = i++) d = Math.min(d, distSegment(x, z, b.r[j][0], b.r[j][1], b.r[i][0], b.r[i][1]));
  return d;
}

/** Milieu de la plus longue arête de CBA et sa normale sortante. */
function murCba() {
  let meilleure = { l: 0, mx: 0, mz: 0, nx: 0, nz: 0 };
  for (let i = 0, j = cba.r.length - 1; i < cba.r.length; j = i++) {
    const [ax, az] = cba.r[j], [bx, bz] = cba.r[i];
    const l = Math.hypot(bx - ax, bz - az);
    if (l <= meilleure.l) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = (bz - az) / l, nz = -(bx - ax) / l;
    if (dedans(mx + nx * 0.05, mz + nz * 0.05, cba.r)) { nx = -nx; nz = -nz; }
    meilleure = { l, mx, mz, nx, nz };
  }
  return meilleure;
}
const mur = murCba();

describe("monde (vrai scene.json)", () => {
  it("indexe les 142 bâtiments + le Truck Muche garé, bornes = centroïdes + 25 m", () => {
    expect(monde.prismes.length).toBe(scene.buildings.length + 1);
    // le truck (v3 §2) : dernier prisme, 3,2 m de haut, on ne traverse pas sa caisse
    const truck = monde.prismes[monde.prismes.length - 1];
    expect(truck.h).toBe(3.2);
    expect(dedans(-125, 39, truck.anneau)).toBe(true);
    const xs = scene.buildings.map((b) => b.c[0]), zs = scene.buildings.map((b) => b.c[1]);
    expect(monde.bornes.x0).toBeCloseTo(Math.min(...xs) - MARGE_BORNES_M, 6);
    expect(monde.bornes.x1).toBeCloseTo(Math.max(...xs) + MARGE_BORNES_M, 6);
    expect(monde.bornes.z0).toBeCloseTo(Math.min(...zs) - MARGE_BORNES_M, 6);
    expect(monde.bornes.z1).toBeCloseTo(Math.max(...zs) + MARGE_BORNES_M, 6);
    expect(cba.h).toBeCloseTo(16.1, 1);
  });
});

describe("solSous", () => {
  it("toit de CBA sous les pieds, sol ailleurs, tolérance de marche", () => {
    expect(solSous(monde, -162.8, -12.7, 16.1)).toBeCloseTo(cba.h, 6);
    expect(solSous(monde, -162.8, -12.7, 30)).toBeCloseTo(cba.h, 6);
    // Sous le toit (dans le bâtiment) : le toit n'est pas atteignable.
    expect(solSous(monde, -162.8, -12.7, 5)).toBe(0);
    // Pieds juste sous le niveau du toit : dans la tolérance de marche.
    expect(solSous(monde, -162.8, -12.7, cba.h - 0.1)).toBeCloseTo(cba.h, 6);
    expect(solSous(monde, -162.8, -12.7, cba.h - 1, 0.3)).toBe(0);
    // Dehors.
    expect(solSous(monde, mur.mx + mur.nx * 3, mur.mz + mur.nz * 3, 0)).toBe(0);
  });
});

describe("resoudre", () => {
  it("pousse hors d'un bâtiment connu (CBA) et renvoie la normale sortante", () => {
    const { p, contacts } = resoudre(monde, [-162.8, 0, -12.7], R, H);
    expect(dedans(p[0], p[2], cba.r)).toBe(false);
    expect(distBatiment(p[0], p[2], cba)).toBeGreaterThan(R - 1e-6);
    expect(p[1]).toBe(0);
    const c = contacts.find((k) => k.prisme === iCba);
    expect(c).toBeDefined();
    expect(Math.hypot(c!.nx, c!.nz)).toBeCloseTo(1, 6);
    // La normale pointe du mur vers le joueur.
    expect(c!.nx * (p[0] + 162.8) + c!.nz * (p[2] + 12.7)).toBeGreaterThan(0);
    expect(c!.profondeur).toBeGreaterThan(R);
  });

  it("contre le mur : position à un rayon du mur, normale = normale du mur", () => {
    for (const decalage of [-0.2, 0.15, 0.39]) {
      const { p, contacts } = resoudre(monde, [mur.mx + mur.nx * decalage, 0, mur.mz + mur.nz * decalage], R, H);
      expect(p[0]).toBeCloseTo(mur.mx + mur.nx * R, 5);
      expect(p[2]).toBeCloseTo(mur.mz + mur.nz * R, 5);
      expect(contacts.length).toBe(1);
      expect(contacts[0].prisme).toBe(iCba);
      expect(contacts[0].nx).toBeCloseTo(mur.nx, 5);
      expect(contacts[0].nz).toBeCloseTo(mur.nz, 5);
      expect(contacts[0].profondeur).toBeCloseTo(R - decalage, 5);
    }
  });

  it("ne touche à rien hors de portée d'un mur", () => {
    const depart: Vec3 = [mur.mx + mur.nx * 1.5, 0, mur.mz + mur.nz * 1.5];
    const { p, contacts } = resoudre(monde, depart, R, H);
    expect(p).toEqual(depart);
    expect(contacts).toEqual([]);
  });

  it("marche sur un toit : aucune poussée au-dessus du toit, mur en dessous", () => {
    const sur = resoudre(monde, [-162.8, cba.h, -12.7], R, H);
    expect(sur.p).toEqual([-162.8, cba.h, -12.7]);
    expect(sur.contacts).toEqual([]);
    // Pieds à 4 cm sous le toit : on marche encore dessus (marge de 5 cm).
    expect(resoudre(monde, [-162.8, cba.h - 0.04, -12.7], R, H).contacts).toEqual([]);
    // Plus bas : mur.
    expect(resoudre(monde, [-162.8, cba.h - 0.5, -12.7], R, H).contacts.length).toBeGreaterThan(0);
    // Joueur à hauteur d'épaule au-dessus du toit en bordure : pas de contact.
    const bord = resoudre(monde, [mur.mx - mur.nx * 0.1, cba.h + 0.5, mur.mz - mur.nz * 0.1], R, H);
    expect(bord.contacts).toEqual([]);
  });

  it("garde le joueur dans les bornes (contact prisme −1, normale vers l'intérieur)", () => {
    const b = monde.bornes;
    const { p, contacts } = resoudre(monde, [b.x0 - 10, 0, (b.z0 + b.z1) / 2], R, H);
    expect(p[0]).toBeCloseTo(b.x0 + R, 6);
    const c = contacts.find((k) => k.prisme === -1);
    expect(c).toBeDefined();
    expect(c!.nx).toBe(1);
    expect(c!.profondeur).toBeCloseTo(10 + R, 6);
    const coin = resoudre(monde, [b.x1 + 3, 0, b.z1 + 3], R, H);
    expect(coin.p[0]).toBeCloseTo(b.x1 - R, 6);
    expect(coin.p[2]).toBeCloseTo(b.z1 - R, 6);
  });

  it("un joueur en mouvement le long d'un mur glisse : la normale reste celle du mur", () => {
    let p: Vec3 = [mur.mx + mur.nx * 1, 0, mur.mz + mur.nz * 1];
    const tx = -mur.nz, tz = mur.nx;
    for (let k = 0; k < 20; k++) {
      // Vers le mur et le long du mur.
      p = resoudre(monde, [p[0] - mur.nx * 0.1 + tx * 0.05, 0, p[2] - mur.nz * 0.1 + tz * 0.05], R, H).p;
    }
    expect(distBatiment(p[0], p[2], cba)).toBeGreaterThan(R - 1e-6);
    expect(distBatiment(p[0], p[2], cba)).toBeLessThan(R + 0.2);
  });

  it("une marche aléatoire à 30 m/s (pas de 0,25 m) depuis les points d'apparition n'entre jamais dans un bâtiment", () => {
    const alea = aleaGraine(7);
    const departs = pointsApparition(scene, monde);
    let dans = 0, pas = 0;
    for (const [x0, z0] of departs) {
      let p: Vec3 = [x0, 0, z0];
      let cap = alea() * Math.PI * 2;
      for (let k = 0; k < 200; k++) {
        if (alea() < 0.1) cap = alea() * Math.PI * 2;
        p = resoudre(monde, [p[0] + Math.sin(cap) * 0.25, 0, p[2] - Math.cos(cap) * 0.25], R, H).p;
        pas++;
        if (monde.prismes.some((pr) => p[0] >= pr.boite.x0 && p[0] <= pr.boite.x1 && p[2] >= pr.boite.z0 && p[2] <= pr.boite.z1 && dedans(p[0], p[2], pr.anneau))) dans++;
      }
    }
    // Bâtiments accolés : une fente de moins de 80 cm peut coincer, jamais une dérive.
    expect(dans / pas).toBeLessThan(0.001);
  });
});

describe("mur fin et grands déplacements", () => {
  const mince = construireMonde(sceneAvec([rect(-1, -10, -0.7, 10, 5), rect(30, 30, 40, 40, 3)]));

  it("centre DANS le polygone : sortie par l'arête la plus proche, pas de l'autre côté", () => {
    const ouest = resoudre(mince, [-0.9, 0, 0], R, H);
    expect(ouest.p[0]).toBeCloseTo(-1 - R, 6);
    expect(ouest.contacts[0].nx).toBeCloseTo(-1, 6);
    const est = resoudre(mince, [-0.8, 0, 0], R, H);
    expect(est.p[0]).toBeCloseTo(-0.7 + R, 6);
    expect(est.contacts[0].nx).toBeCloseTo(1, 6);
  });

  it("à 30 m/s sous-découpé en pas de 1/120 s, le joueur ne traverse pas un mur de 30 cm", () => {
    for (const sens of [1, -1]) {
      let p: Vec3 = [sens > 0 ? -6 : 5.7, 0, 0];
      for (let k = 0; k < 400; k++) {
        p = resoudre(mince, [p[0] + sens * 0.25, 0, p[2]], R, H).p;
      }
      if (sens > 0) expect(p[0]).toBeLessThanOrEqual(-1 - R + 1e-6);
      else expect(p[0]).toBeGreaterThanOrEqual(-0.7 + R - 1e-6);
    }
  });

  it("rayon et visibilité à travers le mur fin", () => {
    expect(lancerRayon(mince, [-5, 1, 0], [1, 0, 0], 20)).toBeCloseTo(4, 6);
    expect(visible(mince, [-5, 1, 0], [5, 1, 0])).toBe(false);
    expect(visible(mince, [-5, 6, 0], [5, 6, 0])).toBe(true);
  });
});

describe("cours (holes)", () => {
  const cour: Vec2[] = [[-4, -4], [4, -4], [4, 4], [-4, 4]];
  const m = construireMonde(sceneAvec([rect(-10, -10, 10, 10, 10, [cour])]));

  it("on circule dans la cour, on ne traverse pas ses murs", () => {
    const centre = resoudre(m, [0, 0, 0], R, H);
    expect(centre.p).toEqual([0, 0, 0]);
    expect(centre.contacts).toEqual([]);
    // Près du mur de la cour, côté cour : poussé vers le centre de la cour.
    const bord = resoudre(m, [3.8, 0, 0], R, H);
    expect(bord.p[0]).toBeCloseTo(4 - R, 6);
    expect(bord.contacts[0].nx).toBeCloseTo(-1, 6);
    // Centre dans le plein : sortie par la cour (arête la plus proche).
    const plein = resoudre(m, [5, 0, 0], R, H);
    expect(plein.p[0]).toBeCloseTo(4 - R, 6);
    // Et de l'autre côté du plein, sortie par l'extérieur.
    const ext = resoudre(m, [9, 0, 0], R, H);
    expect(ext.p[0]).toBeCloseTo(10 + R, 6);
  });

  it("toit au-dessus des murs de la cour et sol sous la cour", () => {
    expect(solSous(m, 0, 0, 0)).toBe(0);
    expect(solSous(m, 0, 0, 12)).toBe(0);
    expect(solSous(m, 7, 0, 12)).toBe(10);
  });

  it("rayons : le mur de la cour arrête, le toit du plein aussi, la cour est vide", () => {
    expect(lancerRayon(m, [0, 1, 0], [1, 0, 0], 50)).toBeCloseTo(4, 6);
    expect(lancerRayon(m, [0, 12, 0], [0, -1, 0], 50)).toBe(Infinity);
    expect(lancerRayon(m, [7, 12, 0], [0, -1, 0], 50)).toBeCloseTo(2, 6);
    expect(visible(m, [0, 1, 0], [3, 1, 3])).toBe(true);
    expect(visible(m, [0, 1, 0], [7, 1, 0])).toBe(false);
  });
});

describe("lancerRayon (vrai scene.json)", () => {
  const seul = construireMonde(sceneAvec([cba]));

  it("touche un mur à la bonne distance", () => {
    const o: Vec3 = [mur.mx + mur.nx * 3, 1.5, mur.mz + mur.nz * 3];
    expect(lancerRayon(seul, o, [-mur.nx, 0, -mur.nz], 20)).toBeCloseTo(3, 6);
    expect(lancerRayon(monde, o, [-mur.nx, 0, -mur.nz], 20)).toBeCloseTo(3, 6);
    // Portée trop courte.
    expect(lancerRayon(seul, o, [-mur.nx, 0, -mur.nz], 2.9)).toBe(Infinity);
    // En biais, vers le haut : le mur est atteint à 3 / cos(a) tant que la hauteur reste sous le toit.
    const a = 0.5;
    const d: Vec3 = [-mur.nx * Math.cos(a), Math.sin(a), -mur.nz * Math.cos(a)];
    expect(lancerRayon(seul, o, d, 20)).toBeCloseTo(3 / Math.cos(a), 6);
  });

  it("passe au-dessus d'un toit, le touche par au-dessus, ne voit pas dans le dos", () => {
    const haut = cba.h + 2;
    const o: Vec3 = [mur.mx + mur.nx * 10, haut, mur.mz + mur.nz * 10];
    expect(lancerRayon(seul, o, [-mur.nx, 0, -mur.nz], 60)).toBe(Infinity);
    expect(lancerRayon(seul, [-162.8, haut, -12.7], [0, -1, 0], 60)).toBeCloseTo(2, 6);
    // Rayon qui part du mur vers l'extérieur.
    expect(lancerRayon(seul, [mur.mx + mur.nx * 0.5, 1.5, mur.mz + mur.nz * 0.5], [mur.nx, 0, mur.nz], 60)).toBe(Infinity);
    // Origine dans le bâtiment, sous le toit.
    expect(lancerRayon(seul, [-162.8, 3, -12.7], [1, 0, 0], 60)).toBe(0);
  });

  it("visible : à travers CBA non, par-dessus oui, court et dégagé oui", () => {
    const a: Vec3 = [mur.mx + mur.nx * 4, 1.6, mur.mz + mur.nz * 4];
    const b: Vec3 = [mur.mx - mur.nx * 60, 1.6, mur.mz - mur.nz * 60];
    expect(visible(seul, a, b)).toBe(false);
    expect(visible(seul, [a[0], cba.h + 3, a[2]], [b[0], cba.h + 3, b[2]])).toBe(true);
    expect(visible(seul, a, [a[0] + 1, 1.6, a[2]])).toBe(true);
    expect(visible(seul, a, a)).toBe(true);
  });

  it("concorde avec un échantillonnage brut sur des rayons aléatoires", () => {
    const alea = aleaGraine(42);
    const b = monde.bornes;
    const boites = scene.buildings.map((bat) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of bat.r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      return { x0, z0, x1, z1 };
    });
    const touche = (x: number, y: number, z: number) => {
      for (let i = 0; i < scene.buildings.length; i++) {
        const bb = boites[i];
        if (y < 0 || y >= scene.buildings[i].h || x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue;
        if (dedans(x, z, scene.buildings[i].r)) return true;
      }
      return false;
    };
    const PAS = 0.1, MAX = 80;
    let ecarts = 0, touches = 0;
    const n = 400;
    for (let k = 0; k < n; k++) {
      const o: Vec3 = [b.x0 + alea() * (b.x1 - b.x0), 0.5 + alea() * 30, b.z0 + alea() * (b.z1 - b.z0)];
      if (touche(o[0], o[1], o[2])) continue;
      const lacet = alea() * Math.PI * 2, tang = (alea() - 0.6) * 1.2;
      const d: Vec3 = [Math.sin(lacet) * Math.cos(tang), Math.sin(tang), -Math.cos(lacet) * Math.cos(tang)];
      let brut = Infinity;
      for (let t = 0; t <= MAX; t += PAS) if (touche(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t)) { brut = t; break; }
      const exact = lancerRayon(monde, o, d, MAX);
      if (exact !== Infinity) touches++;
      if (!(Math.abs(exact - brut) <= PAS + 1e-6 || (exact === Infinity && brut === Infinity))) ecarts++;
    }
    expect(touches).toBeGreaterThan(20);
    // Les rayons rasants (un coin traversé entre deux échantillons) peuvent différer.
    expect(ecarts / n).toBeLessThan(0.02);
  });
});

describe("pointsApparition", () => {
  const pts = pointsApparition(scene, monde);

  it("au moins 30 points, tous hors bâtiments (≥ 2 m) et dans les bornes", () => {
    expect(pts.length).toBeGreaterThanOrEqual(30);
    const b = monde.bornes;
    let dedansBat = 0, dMin = Infinity, hors = 0;
    for (const [x, z] of pts) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) hors++;
      for (const bat of scene.buildings) {
        if (dedans(x, z, bat.r)) dedansBat++;
        dMin = Math.min(dMin, distBatiment(x, z, bat));
      }
    }
    expect(hors).toBe(0);
    expect(dedansBat).toBe(0);
    expect(dMin).toBeGreaterThanOrEqual(2 - 1e-9);
  });

  it("espacés d'au moins 12 m et posés sur une voie M/R/S", () => {
    let dMin = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) dMin = Math.min(dMin, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    expect(dMin).toBeGreaterThanOrEqual(12 - 1e-9);
    let loin = 0;
    for (const [x, z] of pts) {
      let d = Infinity;
      for (const r of scene.roads) {
        if (r.c === "F") continue;
        for (let i = 0; i < r.p.length - 1; i++) d = Math.min(d, distSegment(x, z, r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1]));
      }
      if (d > 0.01) loin++;
    }
    expect(loin).toBe(0);
  });

  it("déterministes, et praticables (resoudre ne les déplace pas)", () => {
    expect(pointsApparition(scene, monde)).toEqual(pts);
    let deplaces = 0;
    for (const [x, z] of pts) {
      const { p } = resoudre(monde, [x, 0, z], R, H);
      if (Math.hypot(p[0] - x, p[2] - z) > 1e-9) deplaces++;
    }
    expect(deplaces).toBe(0);
  });
});

describe("prismes passe-tigres (carte zombies)", () => {
  const champ: Building = { ...rect(-1, -10, 1, 10, 6), type: "champ" };
  const mur: Building = rect(10, -10, 12, 10, 6);
  const m = construireMonde(sceneAvec([champ, mur]));

  it("construireMonde pose passeTigre pour les seuls bâtiments de type champ", () => {
    expect(m.prismes[0].passeTigre).toBe(true);
    expect("passeTigre" in m.prismes[1]).toBe(false);
    expect(monde.prismes.some((p) => p.passeTigre)).toBe(false);
  });

  it("resoudre bloque le joueur sur un champ, pas avec ignorerPasseTigre ; un mur ordinaire bloque toujours", () => {
    const dedansChamp: Vec3 = [0.2, 0, 0];
    const normal = resoudre(m, dedansChamp, 0.4, 1.8);
    expect(normal.contacts.length).toBeGreaterThan(0);
    expect(normal.p[0]).not.toBeCloseTo(0.2, 3);
    const tigre = resoudre(m, dedansChamp, 0.6, 2, true);
    expect(tigre.contacts).toHaveLength(0);
    expect(tigre.p).toEqual(dedansChamp);
    // le mur ordinaire arrête aussi le tigre
    expect(resoudre(m, [10.2, 0, 0], 0.6, 2, true).contacts.length).toBeGreaterThan(0);
    // marche d'un tigre à travers le champ : rien ne l'arrête (pas de 0,1 m)
    let p: Vec3 = [-4, 0, 0];
    for (let k = 0; k < 80; k++) p = resoudre(m, [p[0] + 0.1, 0, p[2]], 0.6, 2, true).p;
    expect(p[0]).toBeCloseTo(4, 6);
    // le joueur, lui, reste de son côté
    p = [-4, 0, 0];
    for (let k = 0; k < 80; k++) p = resoudre(m, [p[0] + 0.1, 0, p[2]], 0.4, 1.8).p;
    expect(p[0]).toBeLessThan(-1);
  });

  it("lancerRayon et visible traversent un champ mais pas un mur", () => {
    expect(lancerRayon(m, [-5, 1, 0], [1, 0, 0], 30)).toBeCloseTo(15, 6); // le champ est ignoré, le mur est à x = 10
    expect(lancerRayon(m, [-5, 1, 0], [1, 0, 0], 8)).toBe(Infinity);
    expect(visible(m, [-5, 1, 0], [5, 1, 0])).toBe(true);
    expect(visible(m, [5, 1, 0], [15, 1, 0])).toBe(false);
    // origine DANS le champ : pas de touche à 0
    expect(lancerRayon(m, [0, 1, 0], [1, 0, 0], 30)).toBeCloseTo(10, 6);
    // sans champ (même géométrie, type absent), le rayon s'arrête au champ
    const sans = construireMonde(sceneAvec([{ ...champ, type: undefined }, mur]));
    expect(lancerRayon(sans, [-5, 1, 0], [1, 0, 0], 30)).toBeCloseTo(4, 6);
    expect(visible(sans, [-5, 1, 0], [5, 1, 0])).toBe(false);
  });
});

describe("performance", () => {
  it("resoudre : moins de 0,05 ms par appel en moyenne", () => {
    const alea = aleaGraine(3);
    const b = monde.bornes;
    // Positions autour des bâtiments (le cas le plus coûteux) : centroïdes + bruit de quelques mètres.
    const entrees: Vec3[] = [];
    for (let k = 0; k < 2000; k++) {
      const c = scene.buildings[Math.floor(alea() * scene.buildings.length)].c;
      entrees.push([Math.max(b.x0, Math.min(b.x1, c[0] + (alea() - 0.5) * 40)), 0, Math.max(b.z0, Math.min(b.z1, c[1] + (alea() - 0.5) * 40))]);
    }
    for (let k = 0; k < 4000; k++) resoudre(monde, entrees[k % entrees.length], R, H); // échauffement
    const n = 100_000;
    const t0 = performance.now();
    let somme = 0;
    for (let k = 0; k < n; k++) somme += resoudre(monde, entrees[k % entrees.length], R, H).contacts.length;
    const moyenneMs = (performance.now() - t0) / n;
    console.log(`resoudre : ${(moyenneMs * 1000).toFixed(2)} µs/appel (${somme} contacts)`);
    expect(moyenneMs).toBeLessThan(0.05);
  });

  it("lancerRayon : moins de 0,05 ms par rayon en moyenne", () => {
    const alea = aleaGraine(5);
    const b = monde.bornes;
    const rayons: Array<[Vec3, Vec3]> = [];
    for (let k = 0; k < 2000; k++) {
      const lacet = alea() * Math.PI * 2, tang = (alea() - 0.5) * 0.4;
      rayons.push([[b.x0 + alea() * (b.x1 - b.x0), 1.6, b.z0 + alea() * (b.z1 - b.z0)],
        [Math.sin(lacet) * Math.cos(tang), Math.sin(tang), -Math.cos(lacet) * Math.cos(tang)]]);
    }
    for (let k = 0; k < 2000; k++) lancerRayon(monde, rayons[k][0], rayons[k][1], 120);
    const n = 50_000;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) lancerRayon(monde, rayons[k % rayons.length][0], rayons[k % rayons.length][1], 120);
    const moyenneMs = (performance.now() - t0) / n;
    console.log(`lancerRayon : ${(moyenneMs * 1000).toFixed(2)} µs/rayon`);
    expect(moyenneMs).toBeLessThan(0.05);
  });
});
