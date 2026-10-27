import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde, detruireBatiment, pointsApparition, resoudre } from "./collision";
import { TIGRE_ROBOT, pasTigre, pasTruck, type EtatMarcheur } from "./monstres";
import { DIST_INF, carteNavigation, champDistance, chemin, descente, invaliderNavigation, pointDeVisee, type CarteNav } from "./navigation";
import type { Vec3 } from "./protocole";
import type { EtatVehicule } from "./vehicule";
import { positionElsa, trouverRondPoint } from "./zones";
import { DEPARTS, FENETRES, construireMondeZombies } from "./zombies-carte";
import { ZOMBIES } from "./zombies-vagues";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const reel = construireMonde(scene);

describe("navigation", () => {
  it("chemin qui contourne un mur sans jamais passer à moins du rayon d'un bâtiment", () => {
    const monde = construireMonde({ ...scene, buildings: [rect(-100, -100, -99, -99), rect(99, 99, 100, 100), rect(-5, -40, 5, 40)], pois: [] } as SceneData);
    const c = carteNavigation(monde, 2);
    const ch = chemin(c, [-30, 0], [30, 0])!;
    expect(ch).not.toBeNull();
    for (const [x, z] of ch) expect(resoudre(monde, [x, 0, z], 2 - c.taille / 2, 8).contacts).toHaveLength(0);
    expect(Math.max(...ch.map((q) => Math.abs(q[1])))).toBeGreaterThan(40); // il passe par un bout du mur
    // le point visé depuis le départ est dégagé
    const v = pointDeVisee(monde, [-30, 0, 0], ch, 1)!;
    expect(v).not.toBeNull();
  });

  it("grille mise en cache par monde et par rayon", () => {
    expect(carteNavigation(reel, 3.3)).toBe(carteNavigation(reel, 3.3));
  });

  it("vraie carte : le Truck parti de chez Elsa rejoint des points d'apparition en moins de 25 s", () => {
    const c = carteNavigation(reel, 1.8);
    const [ex, ez] = positionElsa(scene);
    const cibles = pointsApparition(scene, reel).filter((_, i) => i % 50 === 0).slice(0, 8);
    let reussites = 0;
    for (const j of cibles) {
      let e: EtatVehicule = { p: [ex, 0, ez], cap: 0, v: 0 };
      let t = 0, ch: [number, number][] | null = null, chT = -9, recul = 0, bloque = 0;
      while (Math.hypot(e.p[0] - j[0], e.p[2] - j[1]) > 3 && t < 25) {
        if (t - chT > 1.2) { chT = t; ch = chemin(c, [e.p[0], e.p[2]], [j[0], j[1]]); }
        const vise: Vec3 = ch ? pointDeVisee(reel, e.p, ch, 1.3) ?? [j[0], 0, j[1]] : [j[0], 0, j[1]];
        e = pasTruck(e, vise, recul > 0, 1 / 60, reel);
        t += 1 / 60;
        if (recul > 0) recul -= 1 / 60;
        else if (Math.abs(e.v) < 3) { bloque += 1 / 60; if (bloque > 0.9) { recul = 1.1; bloque = 0; } } else bloque = 0;
      }
      if (t < 25) reussites++;
    }
    expect(reussites).toBeGreaterThanOrEqual(cibles.length - 1);
  }, 30_000);

  it("vraie carte : le tigre parti à 85 m du rond-point rejoint le rond-point", () => {
    const rp = trouverRondPoint(scene)!;
    const c = carteNavigation(reel, TIGRE_ROBOT.rayonCollision + 0.3);
    let essais = 0, reussites = 0;
    for (let a = 0; a < 8; a++) {
      const p: Vec3 = [rp.centre[0] + Math.cos((a * Math.PI) / 4) * 85, 0, rp.centre[1] + Math.sin((a * Math.PI) / 4) * 85];
      if (resoudre(reel, p, 4, 8).contacts.length) continue;
      essais++;
      let e: EtatMarcheur = { p, cap: 0, v: 0 };
      let t = 0, ch: [number, number][] | null = null, chT = -9;
      const cible: Vec3 = [rp.centre[0], 0, rp.centre[1] + rp.rayon + 6];
      while (Math.hypot(e.p[0] - cible[0], e.p[2] - cible[2]) > TIGRE_ROBOT.arret + 2 && t < 60) {
        if (t - chT > 1.2) { chT = t; ch = chemin(c, [e.p[0], e.p[2]], [cible[0], cible[2]]); }
        e = pasTigre(e, cible, 1 / 60, reel, ch ? pointDeVisee(reel, e.p, ch, TIGRE_ROBOT.rayonCollision) : null);
        t += 1 / 60;
      }
      if (t < 60) reussites++;
    }
    expect(essais).toBeGreaterThan(0);
    expect(reussites).toBe(essais);
  }, 30_000);
});


// ---------------------------------------------------------------------------------------------
// Taille de case, invalidation, champ de distance (zombies)
// ---------------------------------------------------------------------------------------------

describe("carteNavigation : options et invalidation", () => {
  it("clé de cache = rayon, taille et champs ignorés ; taille minimale 3 m par défaut", () => {
    const m = construireMonde({ ...scene, buildings: [rect(-100, -100, -99, -99), rect(99, 99, 100, 100)], pois: [] } as SceneData);
    const a = carteNavigation(m, 1);
    expect(a.taille).toBeGreaterThanOrEqual(3);
    expect(carteNavigation(m, 1)).toBe(a);
    const b = carteNavigation(m, 1, { taille: 1.5 });
    expect(b).not.toBe(a);
    expect(b.taille).toBeLessThan(a.taille);
    expect(carteNavigation(m, 1, { taille: 1.5 })).toBe(b);
    expect(carteNavigation(m, 1, { taille: 1.5, ignorerPasseTigre: true })).not.toBe(b);
    expect(carteNavigation(m, 2, { taille: 1.5 })).not.toBe(b);
  });

  it("grille de la carte zombies : cases de 1,5 m, 138 × 90", () => {
    const monde = construireMondeZombies(scene);
    const c = carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: true });
    expect([c.taille, c.nx, c.nz]).toEqual([1.5, 138, 90]);
  });

  it("invaliderNavigation après detruireBatiment : la grille est recalculée et le chemin s'ouvre", () => {
    // une enceinte fermée par une porte (le dernier rectangle), deux bâtiments lointains pour les bornes
    const enceinte = [rect(-12, -12, 12, -10), rect(-12, 10, 12, 12), rect(-12, -10, -10, 10), rect(10, -10, 12, -3), rect(10, 3, 12, 10), rect(10, -3, 12, 3)];
    const monde = construireMonde({ ...scene, buildings: [rect(-100, -100, -99, -99), rect(99, 99, 100, 100), ...enceinte], pois: [] } as SceneData);
    const opts = { taille: 1.5 };
    const avant = carteNavigation(monde, 0.7, opts);
    expect(chemin(avant, [0, 0], [40, 0])).toBeNull();
    detruireBatiment(monde, 7); // la porte
    expect(chemin(carteNavigation(monde, 0.7, opts), [0, 0], [40, 0])).toBeNull(); // cache non invalidé
    invaliderNavigation(monde);
    const apres = carteNavigation(monde, 0.7, opts);
    expect(apres).not.toBe(avant);
    expect(chemin(apres, [0, 0], [40, 0])).not.toBeNull();
    // et le champ de distance le voit aussi
    const champ = champDistance(apres, [[40, 0]]);
    const i = Math.floor((0 - apres.x0) / apres.taille), j = Math.floor((0 - apres.z0) / apres.taille);
    expect(champ[i + j * apres.nx]).toBeLessThan(DIST_INF);
  });

  it("taille 1,5 m / rayon 0,7 : une porte de 0,8 m est bloquée, une de 3 m laisse passer", () => {
    for (const [ouverture, passe] of [[0.8, false], [3, true]] as const) {
      const demi = ouverture / 2;
      const murs = [rect(-1, -130, 1, -demi), rect(-1, demi, 1, 130)];
      const monde = construireMonde({ ...scene, buildings: [rect(-100, -100, -99, -99), rect(99, 99, 100, 100), ...murs], pois: [] } as SceneData);
      const c = carteNavigation(monde, ZOMBIES.rayonNav, { taille: 1.5 });
      // le mur coupe la carte sauf l'ouverture ; deux côtés du mur
      const champ = champDistance(c, [[-20, 0]]);
      const i = Math.floor((20 - c.x0) / c.taille), j = Math.floor((0 - c.z0) / c.taille);
      expect(champ[i + j * c.nx] < DIST_INF, `ouverture ${ouverture} m`).toBe(passe);
    }
  });
});

describe("champDistance (file à seaux de Dial) et descente", () => {
  const monde = construireMondeZombies(scene);
  const carte = carteNavigation(monde, ZOMBIES.rayonNav, { taille: ZOMBIES.tailleCaseNav, ignorerPasseTigre: true });
  const idx = (x: number, z: number) => Math.floor((x - carte.x0) / carte.taille) + Math.floor((z - carte.z0) / carte.taille) * carte.nx;
  /** Une source dans une case libre (celle des coordonnées, sinon aucune : le test choisit des cases libres). */
  const libres = [...DEPARTS, ...FENETRES.flatMap((f) => f.points)].filter(([x, z]) => !carte.bloque[idx(x, z)]);

  /** Dijkstra de référence (tas binaire, mêmes poids entiers 10 / 14, coins non coupés). */
  function reference(c: CarteNav, sources: [number, number][]): Int32Array {
    const n = c.nx * c.nz;
    const d = new Int32Array(n).fill(DIST_INF);
    const tas: [number, number][] = [];
    const pousser = (p: number, k: number) => {
      tas.push([p, k]);
      let a = tas.length - 1;
      while (a > 0) { const q = (a - 1) >> 1; if (tas[q][0] <= tas[a][0]) break; [tas[q], tas[a]] = [tas[a], tas[q]]; a = q; }
    };
    const extraire = (): [number, number] => {
      const haut = tas[0], fin = tas.pop()!;
      if (tas.length) {
        tas[0] = fin;
        let a = 0;
        for (;;) {
          const g = 2 * a + 1, dd = g + 1;
          let m = a;
          if (g < tas.length && tas[g][0] < tas[m][0]) m = g;
          if (dd < tas.length && tas[dd][0] < tas[m][0]) m = dd;
          if (m === a) break;
          [tas[m], tas[a]] = [tas[a], tas[m]];
          a = m;
        }
      }
      return haut;
    };
    for (const [x, z] of sources) { const k = idx(x, z); d[k] = 0; pousser(0, k); }
    while (tas.length) {
      const [p, k] = extraire();
      if (p > d[k]) continue;
      const i = k % c.nx, j = (k - i) / c.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= c.nx || b >= c.nz || c.bloque[a + b * c.nx]) continue;
        if (di && dj && (c.bloque[i + di + j * c.nx] || c.bloque[i + (j + dj) * c.nx])) continue;
        const nd = p + (di && dj ? 14 : 10);
        if (nd < d[a + b * c.nx]) { d[a + b * c.nx] = nd; pousser(nd, a + b * c.nx); }
      }
    }
    return d;
  }

  it("identique à un Dijkstra de référence sur la grille zombies (plusieurs jeux de sources)", () => {
    expect(libres.length).toBeGreaterThan(10);
    const jeux: [number, number][][] = [[libres[0]], [libres[0], libres[1]], [libres[3], libres[8], libres[14]], libres.slice(0, 6)];
    for (const sources of jeux) {
      const attendu = reference(carte, sources);
      const obtenu = champDistance(carte, sources);
      expect(obtenu.length).toBe(attendu.length);
      let ecarts = 0;
      for (let k = 0; k < attendu.length; k++) if (attendu[k] !== obtenu[k]) ecarts++;
      expect(ecarts).toBe(0);
      expect(obtenu.some((v) => v > 0 && v < DIST_INF)).toBe(true);
    }
  });

  it("tableau de sortie réutilisable, sources bloquées ramenées à la case libre la plus proche", () => {
    const sortie = new Int32Array(carte.nx * carte.nz);
    const r = champDistance(carte, [libres[0]], { sortie });
    expect(r).toBe(sortie);
    expect(champDistance(carte, [libres[0]], { sortie })).toEqual(champDistance(carte, [libres[0]]));
    // une source en plein mur (cour d'un bâtiment) : le champ existe quand même
    const [bx, bz] = scene.buildings[70].c;
    const k = idx(bx, bz);
    expect(carte.bloque[k]).toBe(1);
    const c = champDistance(carte, [[bx, bz]]);
    expect(c.some((v) => v === 0)).toBe(true);
    expect(c[k]).toBeGreaterThan(0); // la case bloquée elle-même n'est jamais atteinte (DIST_INF)
    // aucune source : tout inaccessible
    expect(champDistance(carte, []).every((v) => v === DIST_INF)).toBe(true);
  });

  it("monotone : deux cases voisines accessibles diffèrent d'au plus le poids de leur arête", () => {
    const d = champDistance(carte, [libres[0], libres[5]]);
    let verifies = 0;
    for (let j = 0; j < carte.nz; j++) {
      for (let i = 0; i < carte.nx; i++) {
        const k = i + j * carte.nx;
        if (carte.bloque[k] || d[k] >= DIST_INF) continue;
        for (const [di, dj, w] of [[1, 0, 10], [0, 1, 10], [1, 1, 14], [1, -1, 14]] as const) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= carte.nx || b >= carte.nz) continue;
          const q = a + b * carte.nx;
          if (carte.bloque[q] || d[q] >= DIST_INF) continue;
          if (di && dj && (carte.bloque[i + di + j * carte.nx] || carte.bloque[i + (j + dj) * carte.nx])) continue;
          expect(Math.abs(d[k] - d[q])).toBeLessThanOrEqual(w);
          verifies++;
        }
      }
    }
    expect(verifies).toBeGreaterThan(5_000);
  });

  it("descente : chaque pas fait baisser la distance et atteint la source", () => {
    const source = libres[0];
    const champ = champDistance(carte, [source]);
    const loin = libres.filter(([x, z]) => champ[idx(x, z)] < DIST_INF && champ[idx(x, z)] > 100);
    expect(loin.length).toBeGreaterThan(3);
    for (const depart of loin.slice(0, 4)) {
      let [x, z] = depart;
      let d = champ[idx(x, z)];
      expect(d).toBeLessThan(DIST_INF);
      let pas = 0;
      for (let n = descente(carte, champ, x, z); n; n = descente(carte, champ, x, z)) {
        [x, z] = n;
        const dn = champ[idx(x, z)];
        expect(dn).toBeLessThan(d);
        d = dn;
        expect(++pas).toBeLessThan(2000);
      }
      expect(d).toBe(0);
      expect(Math.hypot(x - source[0], z - source[1])).toBeLessThanOrEqual(carte.taille);
    }
    // plusieurs pas d'un coup : plus loin sur le même chemin ; case inaccessible : null
    const [x, z] = loin[0];
    const un = descente(carte, champ, x, z)!, trois = descente(carte, champ, x, z, 3)!;
    expect(champ[idx(trois[0], trois[1])]).toBeLessThan(champ[idx(un[0], un[1])]);
    const mur = scene.buildings[70].c;
    expect(descente(carte, new Int32Array(carte.nx * carte.nz).fill(DIST_INF), mur[0], mur[1])).toBeNull();
    expect(descente(carte, champ, source[0], source[1], 4)).not.toBeUndefined();
  });

  it("arrêt anticipé : les cases demandées ont leur vraie distance, le reste est inaccessible au-delà de la marge", () => {
    const complet = champDistance(carte, [libres[0]]);
    const cibles: [number, number][] = [libres[1], libres[2]];
    const part = champDistance(carte, [libres[0]], { cases: cibles });
    for (const [x, z] of cibles) expect(part[idx(x, z)]).toBe(complet[idx(x, z)]);
    const limite = Math.max(...cibles.map(([x, z]) => complet[idx(x, z)]));
    for (let k = 0; k < complet.length; k++) {
      if (complet[k] <= limite) expect(part[k]).toBe(complet[k]);
      else expect(part[k] === complet[k] || part[k] === DIST_INF || part[k] > limite).toBe(true);
    }
    expect(part.filter((v) => v === DIST_INF).length).toBeGreaterThan(complet.filter((v) => v === DIST_INF).length);
    // avec une marge, les cases plus lointaines sont réglées aussi
    const marge = champDistance(carte, [libres[0]], { cases: cibles, marge: 100 });
    for (let k = 0; k < complet.length; k++) if (complet[k] <= limite + 100) expect(marge[k]).toBe(complet[k]);
    // l'appel suivant sans cases n'est pas perturbé par les marques de l'appel précédent
    expect(champDistance(carte, [libres[0]])).toEqual(complet);
  });

  it("performance : moins de 5 ms par champ en moyenne après échauffement", () => {
    const sortie = new Int32Array(carte.nx * carte.nz);
    const sources = [libres[0], libres[3]];
    for (let k = 0; k < 40; k++) champDistance(carte, sources, { sortie });
    // meilleure moyenne de cinq lots : insensible à une machine chargée (vitest en parallèle) qui gonfle un lot isolé
    const n = 30;
    let moyenne = Infinity;
    for (let lot = 0; lot < 5; lot++) {
      const t0 = performance.now();
      for (let k = 0; k < n; k++) champDistance(carte, sources, { sortie });
      moyenne = Math.min(moyenne, (performance.now() - t0) / n);
    }
    expect(moyenne).toBeLessThan(5);
  });
});
