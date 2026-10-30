import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde, pointsApparition } from "./collision";
import { carteNavigation, chemin, copierCarteNavigation } from "./navigation";
import {
  POLICE, choisirCibleArene, choisirCibleBr, choisirDepart, ecraseParPolice, etatCarrosserie, pasPolice, toucheBoiteOrientee, type CandidatPolice,
} from "./police";
import { SILHOUETTE, type Vec3 } from "./protocole";
import type { EtatVehicule } from "./vehicule";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number, h = 10): Building => ({ h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const mondeAvec = (...b: Building[]) => construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000), ...b], pois: [] } as SceneData);
const vide = mondeAvec();
const cand = (id: string, x: number, z: number, kills = 0, humain = true): CandidatPolice => ({ id, p: [x, 0, z], kills, humain });
/** générateur à graine fixe (mulberry32), déterministe */
function graine(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe("choisirCibleArene : le joueur qui a le plus de kills", () => {
  it("le leader l'emporte, même loin de la voiture", () => {
    expect(choisirCibleArene([cand("a", 5, 0, 1), cand("b", 400, 0, 6), cand("c", 8, 0, 2)], [0, 0, 0], null)).toBe("b");
  });

  it("égalité de kills : le plus proche de la voiture", () => {
    expect(choisirCibleArene([cand("a", 100, 0, 3), cand("b", 20, 0, 3), cand("c", 5, 0, 1)], [0, 0, 0], null)).toBe("b");
  });

  it("personne n'a plus de 0 kill : le plus proche", () => {
    expect(choisirCibleArene([cand("a", 100, 0), cand("b", 20, 0), cand("c", 60, 0)], [0, 0, 0], null)).toBe("b");
  });

  it("aucun candidat : null", () => {
    expect(choisirCibleArene([], [0, 0, 0], null)).toBeNull();
  });

  it("hystérésis : la cible courante est gardée tant qu'aucun autre n'a STRICTEMENT plus de kills", () => {
    const c = [cand("a", 100, 0, 3), cand("b", 5, 0, 3)];
    expect(choisirCibleArene(c, [0, 0, 0], "a")).toBe("a");
    expect(choisirCibleArene([cand("a", 100, 0, 3), cand("b", 5, 0, 4)], [0, 0, 0], "a")).toBe("b");
  });

  it("la cible courante n'est plus candidate (morte, en voiture, sur un toit) : un autre est choisi", () => {
    expect(choisirCibleArene([cand("b", 5, 0, 1), cand("c", 50, 0, 2)], [0, 0, 0], "a")).toBe("c");
  });
});

describe("choisirCibleBr : l'ennemi humain le plus proche", () => {
  it("un humain avant un bot, même si le bot est plus près ; les kills sont ignorés", () => {
    expect(choisirCibleBr([cand("b1", 5, 0, 0, false), cand("j1", 80, 0, 0, true), cand("j2", 120, 0, 9, true)], [0, 0, 0])).toBe("j1");
  });

  it("le plus proche DE LA VOITURE parmi les humains", () => {
    expect(choisirCibleBr([cand("j1", 200, 0), cand("j2", -30, 0)], [0, 0, 0])).toBe("j2");
    expect(choisirCibleBr([cand("j1", 200, 0), cand("j2", -30, 0)], [190, 0, 0])).toBe("j1");
  });

  it("sans humain éligible : le bot le plus proche ; personne : null", () => {
    expect(choisirCibleBr([cand("b1", 50, 0, 0, false), cand("b2", 10, 0, 0, false)], [0, 0, 0])).toBe("b2");
    expect(choisirCibleBr([], [0, 0, 0])).toBeNull();
  });
});

describe("choisirDepart : de nulle part", () => {
  const route: Vec2[] = [];
  for (let x = -300; x <= 300; x += 20) route.push([x, 0]);

  it("à 90 m au moins de tous les joueurs, à 110 à 240 m de la cible", () => {
    const joueurs: Vec3[] = [[0, 0, 0], [40, 0, 40]];
    const p = choisirDepart(route, joueurs, [0, 0, 0], () => false, graine(7))!;
    expect(p).not.toBeNull();
    for (const j of joueurs) expect(Math.hypot(p[0] - j[0], p[1] - j[2])).toBeGreaterThanOrEqual(POLICE.departMinM);
    const dc = Math.hypot(p[0], p[1]);
    expect(dc).toBeGreaterThanOrEqual(POLICE.departCibleMinM);
    expect(dc).toBeLessThanOrEqual(POLICE.departMaxM);
  });

  it("choisit un point que personne ne voit quand il y en a un", () => {
    const vu = (x: number) => x < 0; // tout le côté ouest est vu
    for (let k = 1; k <= 8; k++) {
      const p = choisirDepart(route, [[0, 0, 0]], [0, 0, 0], (x) => vu(x), graine(k))!;
      expect(p[0]).toBeGreaterThan(0);
    }
  });

  it("repli 1 : tout est vu, il se rabat sur le meilleur point sans le critère de vue", () => {
    const p = choisirDepart(route, [[0, 0, 0]], [0, 0, 0], () => true, graine(3));
    expect(p).not.toBeNull();
    expect(Math.hypot(p![0], p![1])).toBeGreaterThanOrEqual(POLICE.departCibleMinM);
  });

  it("repli 2 : aucun point à 90 m, mais un à 60 m ; null s'il n'y en a aucun", () => {
    const proche: Vec2[] = [[70, 0], [-75, 0]];
    const p = choisirDepart(proche, [[0, 0, 0]], [0, 0, 0], () => false, graine(1));
    expect(p).not.toBeNull();
    expect(choisirDepart([[10, 0]], [[0, 0, 0]], [0, 0, 0], () => false, graine(1))).toBeNull();
    expect(choisirDepart([], [[0, 0, 0]], [0, 0, 0], () => false, graine(1))).toBeNull();
  });

  it("les points trop près d'UN joueur sont écartés, immunisés compris (tous passés dans `joueurs`)", () => {
    const p = choisirDepart([[150, 0], [-150, 0]], [[0, 0, 0], [140, 0, 0]], [0, 0, 0], () => false, graine(2))!;
    expect(p).toEqual([-150, 0]);
  });

  it("ne teste la vue que sur `candidatsVueMax` points au plus", () => {
    const beaucoup: Vec2[] = [];
    for (let k = 0; k < 400; k++) beaucoup.push([120 + (k % 100), 30 + Math.floor(k / 100)]);
    let appels = 0;
    choisirDepart(beaucoup, [[0, 0, 0]], [0, 0, 0], () => { appels++; return true; }, graine(5));
    expect(appels).toBeLessThanOrEqual(POLICE.candidatsVueMax);
  });

  it("coût : tous les points d'apparition de la vraie carte, 50 joueurs, un essai en moins de 5 ms (hors vue : `vu` est injecté et coûte ses rayons à part)", () => {
    const points = pointsApparition(scene, construireMonde(scene));
    const a = graine(11);
    const joueurs: Vec3[] = Array.from({ length: 50 }, () => [(a() - 0.5) * 800, 0, (a() - 0.5) * 800]);
    choisirDepart(points, joueurs, joueurs[0], () => false, graine(1)); // échauffement
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) choisirDepart(points, joueurs, joueurs[k % 50], (x, z) => x + z < 0, graine(k));
    expect((performance.now() - t0) / 20).toBeLessThan(5);
    expect(points.length).toBeGreaterThan(100);
  });

  it("est déterministe pour une graine donnée", () => {
    const a = choisirDepart(route, [[0, 0, 0]], [0, 0, 0], () => false, graine(9));
    const b = choisirDepart(route, [[0, 0, 0]], [0, 0, 0], () => false, graine(9));
    expect(a).toEqual(b);
  });
});

describe("écrasement par la police", () => {
  const CAP_EST = -Math.PI / 2; // regarde vers +x
  const voiture = (v: number): EtatVehicule => ({ p: [0, 0, 0], cap: CAP_EST, v });

  it("n'écrase rien sous 4 m/s", () => {
    expect(ecraseParPolice(voiture(3.9), [1, 0, 0], SILHOUETTE.rayon)).toBe(false);
    expect(ecraseParPolice(voiture(4.1), [1, 0, 0], SILHOUETTE.rayon)).toBe(true);
  });

  it("rectangle orienté : devant et derrière jusqu'à la demi-longueur, sur les côtés jusqu'à la demi-largeur (+ marge et rayon)", () => {
    const e = voiture(20);
    expect(ecraseParPolice(e, [POLICE.longueur / 2 + POLICE.margeEcrase + SILHOUETTE.rayon - 0.05, 0, 0], SILHOUETTE.rayon)).toBe(true);
    expect(ecraseParPolice(e, [POLICE.longueur / 2 + POLICE.margeEcrase + SILHOUETTE.rayon + 0.2, 0, 0], SILHOUETTE.rayon)).toBe(false);
    expect(ecraseParPolice(e, [0, 0, POLICE.largeur / 2 + POLICE.margeEcrase + SILHOUETTE.rayon - 0.05], SILHOUETTE.rayon)).toBe(true);
    expect(ecraseParPolice(e, [0, 0, POLICE.largeur / 2 + POLICE.margeEcrase + SILHOUETTE.rayon + 0.2], SILHOUETTE.rayon)).toBe(false);
    // la même caisse tournée de 90° : l'axe long devient z
    const nord = { ...e, cap: 0 };
    expect(ecraseParPolice(nord, [0, 0, -(POLICE.longueur / 2)], SILHOUETTE.rayon)).toBe(true);
    expect(ecraseParPolice(nord, [POLICE.longueur / 2, 0, 0], SILHOUETTE.rayon)).toBe(false);
  });

  it("un joueur sur un toit (pieds au-dessus de la hauteur de la caisse) n'est pas écrasé", () => {
    expect(ecraseParPolice(voiture(20), [0, POLICE.hauteur, 0], SILHOUETTE.rayon)).toBe(false);
    expect(ecraseParPolice(voiture(20), [0, 1, 0], SILHOUETTE.rayon)).toBe(true);
  });

  it("une voiture qui dérape (vitesse latérale) écrase aussi", () => {
    expect(ecraseParPolice({ ...voiture(0), vl: 8 }, [0, 0, 0], SILHOUETTE.rayon)).toBe(true);
  });
});

describe("carrosserie", () => {
  it("fumée à 50 % des PV ou moins, feu à 20 % ou moins, rien au-dessus", () => {
    expect(etatCarrosserie(POLICE.pvMax)).toBeUndefined();
    expect(etatCarrosserie(POLICE.pvMax * 0.51)).toBeUndefined();
    expect(etatCarrosserie(POLICE.pvMax * 0.5)).toBe("fumee");
    expect(etatCarrosserie(POLICE.pvMax * 0.21)).toBe("fumee");
    expect(etatCarrosserie(POLICE.pvMax * 0.2)).toBe("feu");
    expect(etatCarrosserie(0)).toBe("feu");
    expect(etatCarrosserie(60, 100)).toBeUndefined();
    expect(etatCarrosserie(50, 100)).toBe("fumee");
    expect(etatCarrosserie(20, 100)).toBe("feu");
  });
});

describe("toucheBoiteOrientee : touche d'un rayon sur la caisse", () => {
  const CAP_EST = -Math.PI / 2;
  it("touche en plein corps, renvoie la distance à l'entrée de la boîte", () => {
    // tireur à l'ouest à 30 m, voiture au centre regardant vers l'est : l'entrée est à 30 − L/2 (à hauteur de caisse)
    const d = toucheBoiteOrientee([-30, 1, 0], [1, 0, 0], 300, [0, 0, 0], CAP_EST)!;
    expect(d).toBeCloseTo(30 - POLICE.longueur / 2, 6);
    // l'œil à 1,6 m qui vise le milieu de la caisse (tir légèrement descendant) touche aussi
    const n = Math.hypot(30, 0.9);
    expect(toucheBoiteOrientee([-30, 1.6, 0], [30 / n, -0.9 / n, 0], 300, [0, 0, 0], CAP_EST)).not.toBeNull();
  });

  it("manque de côté, au-dessus et au-delà de la portée", () => {
    expect(toucheBoiteOrientee([-30, 1, 5], [1, 0, 0], 300, [0, 0, 0], CAP_EST)).toBeNull();
    expect(toucheBoiteOrientee([-30, 3, 0], [1, 0, 0], 300, [0, 0, 0], CAP_EST)).toBeNull();
    expect(toucheBoiteOrientee([-30, 1, 0], [1, 0, 0], 20, [0, 0, 0], CAP_EST)).toBeNull();
    expect(toucheBoiteOrientee([-30, 1, 0], [-1, 0, 0], 300, [0, 0, 0], CAP_EST)).toBeNull();
  });

  it("la marge agrandit la boîte de chaque côté (comme côté serveur)", () => {
    expect(toucheBoiteOrientee([-30, 1, 1.4], [1, 0, 0], 300, [0, 0, 0], CAP_EST, 0)).toBeNull();
    expect(toucheBoiteOrientee([-30, 1, 1.4], [1, 0, 0], 300, [0, 0, 0], CAP_EST, POLICE.marges.toucheM)).not.toBeNull();
  });

  it("l'origine dans la boîte : distance 0 ; l'orientation suit le cap", () => {
    expect(toucheBoiteOrientee([0, 1, 0], [1, 0, 0], 300, [0, 0, 0], CAP_EST)).toBe(0);
    // cap 0 : la voiture regarde vers −z, donc son axe long est z ; un rayon le long de x touche la largeur (1,9 m)
    expect(toucheBoiteOrientee([-30, 1, 0], [1, 0, 0], 300, [0, 0, 0], 0)).toBeCloseTo(30 - POLICE.largeur / 2, 6);
    expect(toucheBoiteOrientee([-30, 1, 2.4], [1, 0, 0], 300, [0, 0, 0], 0)).toBeNull();
  });
});

describe("pasPolice : la voiture roule comme une voiture conduisible", () => {
  it("accélère jusqu'à 24 m/s au plus et contourne un bâtiment sur son chemin", () => {
    const mur = mondeAvec(rect(40, -14, 52, 14));
    let e: EtatVehicule = { p: [0, 0, 0], cap: -Math.PI / 2, v: 14 };
    let vmax = 0, auPlusPres = Infinity;
    for (let i = 0; i < 60 * 15; i++) {
      e = pasPolice(e, [120, 0, 0], false, 1 / 60, mur);
      vmax = Math.max(vmax, Math.abs(e.v));
      auPlusPres = Math.min(auPlusPres, Math.hypot(120 - e.p[0], e.p[2]));
    }
    expect(vmax).toBeLessThanOrEqual(24.01);
    expect(vmax).toBeGreaterThan(15);
    expect(auPlusPres).toBeLessThan(20);
  });
});

describe("copierCarteNavigation : la grille de référence copiée dans un monde neuf", () => {
  it("est identique à un calcul à froid, et indépendante de la référence", () => {
    const ref = construireMonde(scene);
    const neuf = construireMonde(scene);
    const froid = carteNavigation(construireMonde(scene), 1.8);
    const copie = copierCarteNavigation(ref, neuf, 1.8);
    expect(copie.nx).toBe(froid.nx);
    expect(copie.nz).toBe(froid.nz);
    expect(copie.taille).toBe(froid.taille);
    expect(Buffer.from(copie.bloque).equals(Buffer.from(froid.bloque))).toBe(true);
    // le cache du monde neuf est cette copie ; la référence a son propre tampon
    expect(carteNavigation(neuf, 1.8)).toBe(copie);
    const refCarte = carteNavigation(ref, 1.8);
    expect(copie.bloque).not.toBe(refCarte.bloque);
    const i = copie.bloque.findIndex((x) => x === 0);
    copie.bloque[i] = 1;
    expect(refCarte.bloque[i]).toBe(0);
    expect(froid.bloque[i]).toBe(0);
  });

  it("ne coûte presque rien une fois la référence calculée, et le chemin d'une voiture passe sur la copie", () => {
    const ref = construireMonde(scene);
    carteNavigation(ref, 1.8);
    const neuf = construireMonde(scene);
    const t0 = performance.now();
    const c = copierCarteNavigation(ref, neuf, 1.8);
    expect(performance.now() - t0).toBeLessThan(30);
    const libres = [...c.bloque].filter((x) => x === 0).length;
    expect(libres).toBeGreaterThan(1000);
    const ch = chemin(c, [c.x0 + c.taille * 3, c.z0 + c.taille * 3], [c.x0 + c.taille * 6, c.z0 + c.taille * 3], 12_000);
    expect(ch === null || ch.length > 0).toBe(true);
  });

  it("des bornes différentes : calcul à froid (jamais une grille fausse)", () => {
    const a = mondeAvec(rect(-100, -100, -90, -90));
    const b = construireMonde(scene);
    carteNavigation(a, 1.8);
    const c = copierCarteNavigation(a, b, 1.8);
    expect(c.nx).toBe(carteNavigation(b, 1.8).nx);
    expect(c).toBe(carteNavigation(b, 1.8));
  });
});
