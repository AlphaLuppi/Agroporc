/**
 * Rendu de Rocket Muche sous Node : three s'importe sans contexte WebGL, on vérifie donc la construction, le budget de dessin, la pose
 * des objets, la réaction aux événements et la libération — pas les pixels (les régressions visuelles se voient aux captures).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  BALLE, DEFAUT_CONFIG, PLOTS, SITE, STADE, VOITURE, creerRng,
  type Arene, type Equipe, type EtatVoiture, type EvenementMatch, type MondeRocket,
} from "./contrat";
import { creerArene } from "./arene";
import { compterAppels, creerRenduRocket } from "./rendu";
import { PROFIL, creerContour, distancePrisme, pointCoque, RAYON_COQUE } from "./rendu-modele";
import { baseDepuisCap, copierBase } from "./vec";
import type { Vec3 } from "./vec";

/** Arène plate de repli : le sol à y = 0 (le rendu n'appelle que `lancerRayon` et `normale`). */
const arenePlate: Arene = {
  sd: (p) => p[1],
  normale: () => [0, 1, 0],
  sdNormale: (p, n) => { n[0] = 0; n[1] = 1; n[2] = 0; return p[1]; },
  butMarque: () => null,
  dansCage: () => null,
  lancerRayon: (o, d, max) => (d[1] < 0 && o[1] / -d[1] <= max ? o[1] / -d[1] : null),
  surfaceProche: (p) => ({ point: [p[0], 0, p[2]], normale: [0, 1, 0], distance: p[1] }),
};

function voiture(id: number, equipe: Equipe, slot: number, p: Vec3, cap: number, humain = false): EtatVoiture {
  return {
    id, equipe, slot, humain, nom: humain ? "Agent" : `Bot ${id}`, p, v: [0, 0, 0], w: [0, 0, 0], base: baseDepuisCap(cap), boost: 33, rouesContact: 4,
    normaleSurface: [0, 1, 0], auSol: true, saut: { aSaute: false, temps: 0, tenue: false, secondUtilise: false, tempsEnLAir: 0, depuisFinSaut: 0 },
    flip: { actif: false, temps: 0, dir: [0, 0], stall: false, verrouTangage: 0 }, redressement: { actif: false, temps: 0 }, supersonique: false,
    boostActif: false, boostDepuis: 0, derapage: false, demolie: false, reapparitionDans: 0, figee: false, dernierContactBalleTick: -1000,
    dernierBumpTick: -1000, sautPrecedent: false,
    stats: { buts: 0, passes: 0, arrets: 0, tirs: 0, demolitions: 0, demolie: 0, touches: 0, points: 0 },
  };
}

function monde(n: 1 | 2 | 3 = 3, arene: Arene = arenePlate): MondeRocket {
  const voitures: EtatVoiture[] = [];
  for (const eq of ["bleue", "orange"] as const) {
    for (let s = 0; s < n; s++) {
      const id = voitures.length;
      voitures.push(voiture(id, eq, s, [-10 + 10 * s, VOITURE.hauteurRepos, eq === "bleue" ? -20 : 20], eq === "bleue" ? 0 : Math.PI, id === 0));
    }
  }
  return {
    config: { ...DEFAUT_CONFIG(), format: `${n}v${n}` as "1v1" },
    arene, tick: 0, temps: 0, phase: "enJeu", tempsPhase: 0, tempsRestant: 300, prolongation: false, attenteSolBalle: false,
    score: { bleue: 1, orange: 2 }, dernierBut: null, voitures, idHumain: 0,
    balle: { p: [0, BALLE.hauteurEngagement, 0], v: [0, 0, 0], w: [0, 0, 0], dernierToucheur: null, avantDernierToucheur: null },
    plots: PLOTS.map((p) => ({ id: p.id, actif: true, recharge: 0 })),
    rng: creerRng(1),
    precedent: { voitures: voitures.map((v) => ({ p: [...v.p] as Vec3, base: copierBase(v.base) })), balle: { p: [0, BALLE.hauteurEngagement, 0] } },
    vainqueur: null,
  };
}
const OPTS = { qualite: "haute" as const, mouvementReduit: false, nomsEquipes: { bleue: "Les Trèfles", orange: "Les Tigres" } };

function toutesLesRessources(o: THREE.Object3D): { geos: Set<THREE.BufferGeometry>; mats: Set<THREE.Material> } {
  const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    // la géométrie d'un Sprite est un singleton de three, partagé par tous les sprites de la page : jamais à libérer
    if (m.geometry && !(x as THREE.Sprite).isSprite) geos.add(m.geometry);
    if (m.material) for (const k of Array.isArray(m.material) ? m.material : [m.material]) mats.add(k);
  });
  return { geos, mats };
}

describe("racine posée sur Agroparc", () => {
  it("porte la transformation du site : position, cap, hauteur du sol", () => {
    const r = creerRenduRocket(monde(), OPTS);
    expect(r.racine.position.x).toBe(SITE.centre[0]);
    expect(r.racine.position.z).toBe(SITE.centre[1]);
    expect(r.racine.position.y).toBe(SITE.hauteurSol);
    expect(r.racine.rotation.y).toBe(SITE.cap);
    // le +Z local pointe vers (sin cap, cos cap) en (x, z) de la scène
    r.racine.updateMatrixWorld(true);
    const v = new THREE.Vector3(0, 0, 1).transformDirection(r.racine.matrixWorld);
    expect(v.x).toBeCloseTo(Math.sin(SITE.cap), 9);
    expect(v.z).toBeCloseTo(Math.cos(SITE.cap), 9);
    r.dispose();
  });
});

describe("budget de dessin", () => {
  it("3v3 en haute qualité : au plus 60 appels de dessin (stade, voitures, effets)", () => {
    const m = monde(3);
    const r = creerRenduRocket(m, OPTS);
    r.synchroniser(m, 1, 1 / 60);
    const n = compterAppels(r.racine);
    expect(n).toBeLessThanOrEqual(60);
    expect(n).toBeGreaterThan(30);
    r.dispose();
  });
  it("la basse qualité dessine moins (ni public ni Truck)", () => {
    const m = monde(3);
    const h = creerRenduRocket(m, OPTS), b = creerRenduRocket(m, { ...OPTS, qualite: "basse" });
    h.synchroniser(m, 1, 1 / 60); b.synchroniser(m, 1, 1 / 60);
    expect(compterAppels(b.racine)).toBeLessThan(compterAppels(h.racine));
    h.dispose(); b.dispose();
  });
  it("après un but (particules, anneaux, plaques) le budget tient", () => {
    const m = monde(3);
    const r = creerRenduRocket(m, OPTS);
    r.evenement({ t: "but", equipe: "bleue", idMarqueur: 0, idPasse: null, vitesseKmh: 80 }, m);
    r.synchroniser(m, 0.5, 1 / 60);
    expect(compterAppels(r.racine)).toBeLessThanOrEqual(60);
    r.dispose();
  });
});

describe("synchronisation", () => {
  it("place les voitures et la balle sans NaN, interpole entre deux pas", () => {
    const m = monde(2);
    const r = creerRenduRocket(m, OPTS);
    m.voitures[0].v = [0, 0, 15];
    m.precedent.voitures[0].p = [0, VOITURE.hauteurRepos, -21];
    m.voitures[0].p = [0, VOITURE.hauteurRepos, -20];
    r.synchroniser(m, 0.5, 1 / 60);
    const g = r.racine.children.filter((c) => (c as THREE.Group).isGroup && c.children.length === 3 && (c.children[0] as THREE.Mesh).isMesh);
    expect(g.length).toBe(4);
    expect(g[0].position.z).toBeCloseTo(-20.5, 6);
    r.racine.updateMatrixWorld(true);
    r.racine.traverse((o) => { for (const e of o.matrix.elements) expect(Number.isFinite(e)).toBe(true); });
    r.dispose();
  });
  it("une téléportation (coup d'envoi) n'est pas interpolée", () => {
    const m = monde(1);
    const r = creerRenduRocket(m, OPTS);
    m.precedent.voitures[1].p = [30, VOITURE.hauteurRepos, 40];
    r.synchroniser(m, 0.5, 1 / 60);
    const g = r.racine.children.filter((c) => (c as THREE.Group).isGroup && c.children.length === 3 && (c.children[0] as THREE.Mesh).isMesh);
    expect(g[1].position.z).toBeCloseTo(m.voitures[1].p[2], 9);
    r.dispose();
  });
  it("les roues tournent avec la vitesse et se braquent", () => {
    const m = monde(1);
    const r = creerRenduRocket(m, OPTS);
    const roues = () => {
      const v = r.racine.children.find((c) => (c as THREE.Group).isGroup && c.children.length === 3) as THREE.Group;
      return Float32Array.from(((v.children[2] as THREE.LineSegments).geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array);
    };
    m.voitures[0].v = [0, 0, 20];
    r.synchroniser(m, 1, 0.05);
    const a = roues();
    r.synchroniser(m, 1, 0.05);
    const b = roues();
    expect(a.some((x, i) => Math.abs(x - b[i]) > 1e-4)).toBe(true);
    for (const x of b) expect(Number.isFinite(x)).toBe(true);
    // un braquage à droite (lacet négatif) déplace les points de la roue avant
    m.voitures[0].w = [0, -1.5, 0];
    for (let i = 0; i < 40; i++) r.synchroniser(m, 1, 0.05);
    const c = roues();
    expect(c.some((x, i) => Math.abs(x - b[i]) > 1e-2)).toBe(true);
    r.dispose();
  });
  it("une voiture démolie disparaît, puis réapparaît en grossissant", () => {
    const m = monde(1);
    const r = creerRenduRocket(m, OPTS);
    const groupe = () => r.racine.children.find((c) => (c as THREE.Group).isGroup && c.children.length === 3 && (c.children[0] as THREE.Mesh).isMesh) as THREE.Group;
    m.voitures[0].demolie = true;
    r.synchroniser(m, 1, 1 / 60);
    expect(groupe().visible).toBe(false);
    m.voitures[0].demolie = false;
    r.evenement({ t: "reapparition", idVoiture: 0 }, m);
    r.synchroniser(m, 1, 1 / 60);
    expect(groupe().visible).toBe(true);
    expect(groupe().scale.x).toBeLessThan(0.6);
    for (let i = 0; i < 40; i++) r.synchroniser(m, 1, 1 / 60);
    expect(groupe().scale.x).toBe(1);
    r.dispose();
  });
  it("la flamme du boost suit boostActif et le tableau de score ne plante pas", () => {
    const m = monde(1);
    const r = creerRenduRocket(m, OPTS);
    const flammes = r.racine.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.InstancedMesh).count === m.voitures.length) as THREE.InstancedMesh;
    expect(flammes).toBeTruthy();
    const echelle = (i: number) => { const mm = new THREE.Matrix4(); flammes.getMatrixAt(i, mm); return new THREE.Vector3().setFromMatrixScale(mm).z; };
    r.synchroniser(m, 1, 1 / 60);
    expect(echelle(0)).toBe(0);
    m.voitures[0].boostActif = true;
    for (let i = 0; i < 10; i++) r.synchroniser(m, 1, 1 / 60);
    expect(echelle(0)).toBeGreaterThan(0.3);
    m.voitures[0].boostActif = false;
    for (let i = 0; i < 30; i++) r.synchroniser(m, 1, 1 / 60);
    expect(echelle(0)).toBe(0);
    m.score = { bleue: 3, orange: 2 };
    r.synchroniser(m, 1, 1 / 60);
    r.dispose();
  });
  it("la balle tourne selon sa vitesse angulaire et prend la couleur de la dernière équipe", () => {
    const m = monde(1);
    const r = creerRenduRocket(m, OPTS);
    const balle = r.racine.children.find((c) => (c as THREE.Group).isGroup && c.children.length === 2 && (c.children[0] as THREE.LineSegments).isLineSegments) as THREE.Group;
    const q0 = balle.quaternion.clone();
    m.balle.w = [0, 5, 0];
    m.balle.dernierToucheur = { idVoiture: 0, equipe: "orange", temps: 0 };
    for (let i = 0; i < 10; i++) r.synchroniser(m, 1, 1 / 60);
    expect(balle.quaternion.angleTo(q0)).toBeGreaterThan(0.5);
    const mat = (balle.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;
    expect(mat.color.r).toBeGreaterThan(mat.color.b);
    r.dispose();
  });
  it("sans méthode d'arène (monde jouet), l'ombre reste à plat sans lever d'erreur", () => {
    const m = monde(1);
    (m as { arene: unknown }).arene = {};
    const r = creerRenduRocket(m, OPTS);
    expect(() => r.synchroniser(m, 1, 1 / 60)).not.toThrow();
    r.dispose();
  });
});

describe("événements", () => {
  const tous = (m: MondeRocket): EvenementMatch[] => [
    { t: "decompte", n: 3 }, { t: "coupDEnvoi" },
    { t: "toucheBalle", idVoiture: 0, force: 30 }, { t: "balleDecor", vitesse: 25, point: [0, 5, 51] },
    { t: "but", equipe: "bleue", idMarqueur: 0, idPasse: null, vitesseKmh: 90 },
    { t: "demolition", victime: 1, auteur: 0, p: [3, 0.5, 4] }, { t: "reapparition", idVoiture: 1 }, { t: "bump", idVoiture: 0, autre: 1, vitesse: 8 },
    { t: "plot", idVoiture: 0, idPlot: 0, gros: true, gain: 100 }, { t: "plot", idVoiture: 0, idPlot: 3, gros: false, gain: 12 }, { t: "plotRecharge", idPlot: 0 },
    { t: "saut", idVoiture: 0 }, { t: "doubleSaut", idVoiture: 0 }, { t: "flip", idVoiture: 0, dir: [1, 0], stall: false },
    { t: "atterrissage", idVoiture: 0, vitesse: 6 }, { t: "choc", idVoiture: 0, vitesse: 9 }, { t: "boost", idVoiture: 0, actif: true },
    { t: "supersonique", idVoiture: 0, actif: true }, { t: "arret", idVoiture: 0 }, { t: "klaxon", idVoiture: 0 }, { t: "prolongation" },
    { t: "chronoZero" }, { t: "fin", vainqueur: "bleue" },
  ].map((e) => e as EvenementMatch).filter(() => m.voitures.length > 1);
  it("accepte chaque type d'événement sans erreur et produit des particules", () => {
    const m = monde(1);
    const r = creerRenduRocket(m, OPTS);
    for (const e of tous(m)) expect(() => r.evenement(e, m)).not.toThrow();
    expect(() => { for (let i = 0; i < 120; i++) r.synchroniser(m, 1, 1 / 60); }).not.toThrow();
    r.dispose();
  });
  it("les particules ne survivent pas à leur durée de vie", () => {
    const m = monde(1);
    const r = creerRenduRocket(m, OPTS);
    r.evenement({ t: "but", equipe: "orange", idMarqueur: 1, idPasse: null, vitesseKmh: 70 }, m);
    const points = () => r.racine.children.filter((c) => (c as THREE.Points).isPoints) as THREE.Points[];
    r.synchroniser(m, 1, 1 / 60);
    const dessinees = points().reduce((a, p) => a + p.geometry.drawRange.count, 0);
    expect(dessinees).toBeGreaterThan(50);
    for (let i = 0; i < 400; i++) r.synchroniser(m, 1, 1 / 60); // 6,7 s
    expect(points().reduce((a, p) => a + (p.geometry.drawRange.count === Infinity ? 1e6 : p.geometry.drawRange.count), 0)).toBe(0);
    r.dispose();
  });
  it("mouvement réduit : moins de particules, aucune pulsation des murs", () => {
    const compter = (reduit: boolean) => {
      const m = monde(1);
      const r = creerRenduRocket(m, { ...OPTS, mouvementReduit: reduit });
      r.evenement({ t: "but", equipe: "bleue", idMarqueur: 0, idPasse: null, vitesseKmh: 70 }, m);
      r.synchroniser(m, 1, 1 / 60);
      const n = (r.racine.children.filter((c) => (c as THREE.Points).isPoints) as THREE.Points[]).reduce((a, p) => a + p.geometry.drawRange.count, 0);
      const hex = r.racine.getObjectByName("stade")!.children.find((c) => (c as THREE.LineSegments).isLineSegments && ((c as THREE.LineSegments).material as THREE.LineBasicMaterial).blending === THREE.AdditiveBlending && (c as THREE.LineSegments).geometry.getAttribute("position").count > 20000) as THREE.LineSegments;
      const echelle = ((hex.material as THREE.LineBasicMaterial).color.r);
      r.dispose();
      return { n, echelle };
    };
    const normal = compter(false), reduit = compter(true);
    expect(reduit.n).toBeLessThan(normal.n);
    expect(reduit.echelle).toBe(1);
    expect(normal.echelle).toBeGreaterThan(1.3);
  });
});

describe("plots", () => {
  it("un plot ramassé s'éteint et se rallume à la recharge", () => {
    const m = monde(1);
    const r = creerRenduRocket(m, OPTS);
    const stade = r.racine.getObjectByName("stade")!;
    const anneaux = stade.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.InstancedMesh).count === PLOTS.length) as THREE.InstancedMesh[];
    expect(anneaux.length).toBe(2);
    const couleur = (i: number) => { const c = new THREE.Color(); anneaux[0].getColorAt(i, c); return c.r + c.g + c.b; };
    r.synchroniser(m, 1, 1 / 60);
    const actif = couleur(0);
    m.plots[0] = { id: 0, actif: false, recharge: 9 };
    r.synchroniser(m, 1, 1 / 60);
    expect(couleur(0)).toBeLessThan(actif / 5);
    m.plots[0] = { id: 0, actif: true, recharge: 0 };
    r.synchroniser(m, 1, 1 / 60);
    expect(couleur(0)).toBeCloseTo(actif, 6);
    r.dispose();
  });
});

describe("libération", () => {
  it("dispose libère toutes les géométries et tous les matériaux et détache la racine", () => {
    const m = monde(3);
    const scene = new THREE.Scene();
    const r = creerRenduRocket(m, OPTS);
    scene.add(r.racine);
    for (const e of [{ t: "but", equipe: "bleue", idMarqueur: 0, idPasse: null, vitesseKmh: 80 }, { t: "demolition", victime: 1, auteur: 0, p: [0, 1, 0] }] as EvenementMatch[]) r.evenement(e, m);
    r.synchroniser(m, 1, 1 / 60);
    const { geos, mats } = toutesLesRessources(r.racine);
    expect(geos.size).toBeGreaterThan(10);
    const liberes = new Set<unknown>();
    for (const g of geos) g.addEventListener("dispose", () => liberes.add(g));
    for (const k of mats) k.addEventListener("dispose", () => liberes.add(k));
    r.dispose();
    expect(r.racine.parent).toBeNull();
    expect(r.racine.children).toHaveLength(0);
    const oublies = [...geos, ...mats].filter((x) => !liberes.has(x));
    expect(oublies).toHaveLength(0);
  });
});

describe("la coque dessinée est celle de la SDF", () => {
  const arene = creerArene();
  const contour = creerContour();
  it("les points de la coque sont sur la surface de la SDF d'Arène (|sd| < 1 cm hors des cages)", () => {
    let testes = 0;
    for (let i = 0; i < 600; i++) {
      const u = contour.longueur * ((i * 0.6180339) % 1), v = PROFIL.longueur * ((i * 0.4142135) % 1);
      const p = pointCoque(contour, u, v);
      // loin des cages (la réunion douce et le recouvrement de 1,2 m y changent la surface)
      if (Math.abs(p[2]) > 44 && Math.abs(p[0]) < 18 && p[1] < 9) continue;
      testes++;
      expect(Math.abs(arene.sd(p))).toBeLessThan(0.01);
      expect(distancePrisme(p[0], p[1], p[2])).toBeCloseTo(RAYON_COQUE, 6);
    }
    expect(testes).toBeGreaterThan(400);
  });
  it("le sol plat et le plafond sont à y = 0 et 20,44", () => {
    expect(arene.sd([5, 0, 5])).toBeCloseTo(0, 6);
    expect(arene.sd([5, STADE.hauteur, 5])).toBeCloseTo(0, 6);
  });
});
