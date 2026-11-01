import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { creerModeleTruckMuche, creerMondeDynamique } from "./rendu-monde";
import { COULEURS_VENDEUSES, creerFigure, creerHabitacle, poserAssise } from "./rendu-vendeuses";
import { TRUCK, versMondeTruck } from "./zones";
import {
  CABINE, DUREE_OFFRE_MS, FIGURE, ikBras, scenarioOffre, poseComptoir, poseConducteuse, posePatronne, versRepereTorse, epaule, type PoseFigure, type V3,
} from "./vendeuses";

/** three sans rendu : les figures, le modèle du Truck et l'habitacle se construisent et se posent sous Node (pas de canvas, donc ni enseigne ni texture). */

const REACH = FIGURE.brasHaut + FIGURE.brasBas;
const monde = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());

describe("figures filaires : les mains arrivent où la pose les veut", () => {
  it("debout, torse droit : la main est à la cible (repère du torse), pour des cibles à portée", () => {
    const parent = new THREE.Group();
    const f = creerFigure(parent, { vendeuse: "elsa", echelle: 1 });
    const pose: PoseFigure = { assise: false, torse: [0, 0, 0], tete: [0, 0, 0], mains: [[-0.2, 0.1, -0.5], [0.3, -0.1, -0.35]] };
    f.appliquer(pose);
    parent.updateMatrixWorld(true);
    const torse = FIGURE.hanches + FIGURE.torseDepuisHanches;
    for (const cote of [0, 1] as const) {
      const attendu = new THREE.Vector3(pose.mains[cote][0], torse + pose.mains[cote][1], pose.mains[cote][2]);
      expect(monde(f.mains[cote]).distanceTo(attendu)).toBeLessThan(1e-6);
    }
    f.dispose();
  });

  it("torse penché et tourné : la main reste à la même place du monde (la cible est ramenée dans le repère du torse)", () => {
    const parent = new THREE.Group();
    const f = creerFigure(parent, { vendeuse: "patronne", echelle: 1 });
    const mains: [V3, V3] = [[-0.2, 0.0, -0.45], [0.25, 0.1, -0.5]];
    for (const torse of [[-0.15, 0, 0], [-0.1, 0, 0.2], [0.05, 0.1, -0.15]] as V3[]) {
      f.appliquer({ assise: false, torse, tete: [0, 0, 0], mains });
      parent.updateMatrixWorld(true);
      const base = FIGURE.hanches + FIGURE.torseDepuisHanches;
      for (const cote of [0, 1] as const) {
        // atteignable depuis l'épaule du torse penché ?
        const local = versRepereTorse(mains[cote], torse);
        const e = epaule(cote);
        if (Math.hypot(local[0] - e[0], local[1] - e[1], local[2] - e[2]) > REACH - 1e-3) continue;
        const attendu = new THREE.Vector3(mains[cote][0], base + mains[cote][1], mains[cote][2]);
        expect(monde(f.mains[cote]).distanceTo(attendu)).toBeLessThan(1e-5);
      }
    }
    f.dispose();
  });

  it("hors de portée : le bras se tend vers la cible sans la dépasser", () => {
    const parent = new THREE.Group();
    const f = creerFigure(parent, { vendeuse: "elsa", echelle: 1 });
    f.appliquer({ assise: false, torse: [0, 0, 0], tete: [0, 0, 0], mains: [[0, 0, -3], [0, 0, -3]] });
    parent.updateMatrixWorld(true);
    const epauleMonde = new THREE.Vector3(FIGURE.epauleX, FIGURE.hanches + FIGURE.torseDepuisHanches + FIGURE.epauleY, 0);
    expect(monde(f.mains[1]).distanceTo(epauleMonde)).toBeLessThanOrEqual(REACH + 1e-6);
    expect(monde(f.mains[1]).z).toBeLessThan(-0.5);
    f.dispose();
  });

  it("assise : les genoux sont devant le bassin, les pieds retombent sous les genoux", () => {
    const parent = new THREE.Group();
    const f = creerFigure(parent, { vendeuse: "elsa", echelle: 1 });
    f.appliquer({ assise: true, torse: [0, 0, 0], tete: [0, 0, 0], mains: [[-0.3, -0.7, 0], [0.3, -0.7, 0]] });
    parent.updateMatrixWorld(true);
    const boite = new THREE.Box3().setFromObject(f.racine);
    // cuisses horizontales vers l'avant (−z) : la figure s'étend sur au moins 0,43 m devant le bassin, et les pieds sont à ~0,5 m du sol
    expect(boite.min.z).toBeLessThan(-FIGURE.cuisse);
    expect(boite.min.y).toBeGreaterThan(FIGURE.hanches - FIGURE.mollet - 0.2);
    f.dispose();
  });

  it("dispose retire la figure de son parent", () => {
    const parent = new THREE.Group();
    const f = creerFigure(parent, { vendeuse: "patronne", echelle: 0.9 });
    expect(parent.children).toContain(f.racine);
    f.dispose();
    expect(parent.children).not.toContain(f.racine);
  });

  it("deux vendeuses, deux couleurs", () => {
    expect(COULEURS_VENDEUSES.elsa).not.toBe(COULEURS_VENDEUSES.patronne);
  });
});

describe("Truck fou : la cabine ouverte contient Elsa et la patronne aux commandes", () => {
  const monter = () => {
    const modele = creerModeleTruckMuche({ roues: true, cabineOuverte: true });
    const habitacle = creerHabitacle(modele.group, COULEURS_VENDEUSES.elsa);
    const elsa = creerFigure(modele.group, { vendeuse: "elsa", echelle: CABINE.echelle });
    const patronne = creerFigure(modele.group, { vendeuse: "patronne", echelle: CABINE.echelle });
    poserAssise(elsa, CABINE.volant.x);
    poserAssise(patronne, CABINE.assise.x);
    return { modele, habitacle, elsa, patronne };
  };

  it("le modèle a les dimensions du Truck Muche garé (et ses quatre roues séparées)", () => {
    const { modele } = monter();
    modele.group.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(modele.group);
    const t = b.getSize(new THREE.Vector3());
    // largeur et longueur du Truck (les roues dépassent à peine ; l'enseigne et le comptoir en saillie sur le flanc droit)
    expect(t.z).toBeCloseTo(TRUCK.longueur, 0);
    expect(t.x).toBeGreaterThanOrEqual(TRUCK.largeur);
    expect(t.x).toBeLessThan(TRUCK.largeur + 1.5); // le volet relevé en auvent dépasse du flanc droit
    expect(modele.roues).toHaveLength(4);
  });

  it("les deux conductrices sont DANS la cabine : sous le toit, entre le pare-brise et la cloison, de part et d'autre de l'axe", () => {
    const { modele, elsa, patronne } = monter();
    for (const [f, cote] of [[elsa, -1], [patronne, 1]] as const) {
      f.appliquer(cote === -1 ? poseConducteuse({ v: 15, lacet: 0.6, tS: 2 }) : posePatronne({ v: 15, lacet: 0.6, tS: 2 }));
      modele.group.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(f.racine);
      const zAvant = -TRUCK.longueur / 2, zArriere = zAvant + TRUCK.cabine;
      expect(b.max.y).toBeLessThan(TRUCK.hauteurCabine);
      expect(b.min.y).toBeGreaterThan(TRUCK.plancher - 0.05);
      expect(b.min.z).toBeGreaterThan(zAvant);
      expect(b.max.z).toBeLessThan(zArriere);
      expect(Math.abs(b.min.x)).toBeLessThan(TRUCK.largeur / 2);
      expect(Math.abs(b.max.x)).toBeLessThan(TRUCK.largeur / 2);
      expect(Math.sign((b.min.x + b.max.x) / 2)).toBe(cote);
    }
  });

  it("les mains d'Elsa sont sur le volant (dans l'anneau, à quelques centimètres), à tout braquage", () => {
    const { modele, elsa } = monter();
    const centre = new THREE.Vector3(CABINE.volant.x, CABINE.volant.y, CABINE.volant.z);
    for (const lacet of [-1.5, -0.5, 0, 0.5, 1.5]) {
      elsa.appliquer(poseConducteuse({ v: 12, lacet, tS: 0 }));
      modele.group.updateMatrixWorld(true);
      for (const cote of [0, 1] as const) {
        const d = monde(elsa.mains[cote]).distanceTo(centre);
        // sur la couronne du volant (rayon 0,19 m), à la tolérance d'un bras presque tendu près
        expect(d).toBeGreaterThan(CABINE.volant.rayon - 0.08);
        expect(d).toBeLessThan(CABINE.volant.rayon + 0.08);
      }
    }
  });

  it("le volant tourne : la même pose à deux braquages ne met pas la main au même endroit", () => {
    const { modele, elsa } = monter();
    elsa.appliquer(poseConducteuse({ v: 12, lacet: 0.8, tS: 0 }));
    modele.group.updateMatrixWorld(true);
    const a = monde(elsa.mains[1]).clone();
    elsa.appliquer(poseConducteuse({ v: 12, lacet: -0.8, tS: 0 }));
    modele.group.updateMatrixWorld(true);
    expect(a.distanceTo(monde(elsa.mains[1]))).toBeGreaterThan(0.1);
  });

  it("l'habitacle braque et se libère", () => {
    const { modele, habitacle } = monter();
    const n = modele.group.children.length;
    habitacle.braquer(0.4);
    habitacle.dispose();
    expect(modele.group.children.length).toBe(n - 1);
    modele.dispose();
  });

  it("la cabine fermée du Truck garé reste un bloc plein : la cabine ouverte a une géométrie différente", () => {
    const pleine = creerModeleTruckMuche({ roues: true });
    const ouverte = creerModeleTruckMuche({ roues: true, cabineOuverte: true });
    const sommets = (m: ReturnType<typeof creerModeleTruckMuche>) => {
      let n = 0;
      m.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.attributes.position) n += (o as THREE.Mesh).geometry.attributes.position.count; });
      return n;
    };
    expect(sommets(ouverte)).not.toBe(sommets(pleine));
    pleine.dispose();
    ouverte.dispose();
  });

  it("poses du comptoir appliquées aux figures du Truck garé : aucune main ne part dans le décor (positions finies)", () => {
    const parent = new THREE.Group();
    const f = creerFigure(parent, { vendeuse: "elsa", echelle: 0.9 });
    for (let t = 0; t < 6; t += 0.5) {
      f.appliquer(poseComptoir("elsa", { parle: "patronne", sert: "elsa", offre: true }, t, -1));
      parent.updateMatrixWorld(true);
      for (const c of [0, 1] as const) expect(Number.isFinite(monde(f.mains[c]).length())).toBe(true);
    }
    f.dispose();
  });

  it("ikBras est bien celui du rig : directions unitaires, longueurs des segments conservées", () => {
    const r = ikBras([0.1, -0.3, -0.5]);
    expect(Math.hypot(...r.haut)).toBeCloseTo(1, 9);
    expect(Math.hypot(...r.bas)).toBeCloseTo(1, 9);
  });
});

describe("Truck garé : les deux vendeuses et leurs bulles", () => {
  const place = { x: 10, z: -5, cap: 0.3, service: [0, 0] as [number, number], elsa: [0, 0] as [number, number] };
  const monter = () => {
    const scene = new THREE.Scene();
    const dyn = creerMondeDynamique(scene, { nbPnj: 0, nbVehicules: 0, truck: { ...place, service: versMondeTruck(place, TRUCK.largeur / 2 + TRUCK.avanceService, TRUCK.fenetreZ), elsa: versMondeTruck(place, 0.45, TRUCK.fenetreZ) } });
    const sprites = () => { const v: THREE.Sprite[] = []; scene.traverse((o) => { if ((o as THREE.Sprite).isSprite) v.push(o as THREE.Sprite); }); return v; };
    return { scene, dyn, sprites };
  };
  const offre = (id: number, vendeuse?: "patronne") => ({ x: 0, z: 0, offre: { id, genre: "arme" as const, arme: "railgun" as const, finT: 100_000, ...(vendeuse ? { vendeuse } : {}) } });

  it("deux figures, deux étiquettes (Elsa et Patronne) et deux bulles, toutes cachées au départ", () => {
    const { dyn, sprites } = monter();
    expect(sprites()).toHaveLength(4);
    expect(sprites().filter((s) => s.visible)).toHaveLength(0);
    dyn.afficherPseudoElsa(1);
    expect(sprites().filter((s) => s.visible)).toHaveLength(2);
    dyn.afficherPseudoElsa(0);
    expect(sprites().filter((s) => s.visible)).toHaveLength(0);
    dyn.dispose();
  });

  it("la bulle de la vendeuse qui parle est visible pendant sa réplique seulement, d'après l'horloge du serveur", () => {
    for (const [id, vendeuse] of [[1, undefined], [2, "patronne"]] as const) {
      const { dyn, sprites } = monter();
      const sc = scenarioOffre(id, vendeuse ?? "elsa");
      const debut = 100_000 - DUREE_OFFRE_MS;
      dyn.majElsa(offre(id, vendeuse), 1, debut);
      expect(sprites().filter((s) => s.visible)).toHaveLength(0);
      dyn.majElsa(offre(id, vendeuse), 1, debut + sc[0].t + 100);
      expect(sprites().filter((s) => s.visible)).toHaveLength(1);
      // fin de la bulle : plus rien
      dyn.majElsa(offre(id, vendeuse), 1, debut + sc[0].t + 3_300);
      expect(sprites().filter((s) => s.visible)).toHaveLength(0);
      dyn.dispose();
    }
  });

  it("sans horloge du serveur, pas de bulle (jamais d'âge inventé) ; sans offre, personne ne parle", () => {
    const { dyn, sprites } = monter();
    dyn.majElsa(offre(2, "patronne"), 1);
    expect(sprites().filter((s) => s.visible)).toHaveLength(0);
    dyn.majElsa(null, 1, 50_000);
    expect(sprites().filter((s) => s.visible)).toHaveLength(0);
    dyn.dispose();
  });

  it("le Truck fou parti en tournée : plus de vendeuses au passe-plat, plus de bulle ni d'étiquette", () => {
    const { scene, dyn, sprites } = monter();
    const sc = scenarioOffre(2, "patronne");
    const debut = 100_000 - DUREE_OFFRE_MS;
    dyn.majElsa(offre(2, "patronne"), 1, debut + sc[0].t + 100, true);
    dyn.afficherPseudoElsa(1);
    expect(sprites().filter((s) => s.visible)).toHaveLength(0);
    // les pièces des deux figures (hors camion) disparaissent avec elles : visibilité effective des maillages
    const maillagesVisibles = () => { let n = 0; scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { let v = true; for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) v = false; if (v) n++; } }); return n; };
    const enTournee = maillagesVisibles();
    // de retour : tout revient
    dyn.majElsa(offre(2, "patronne"), 1, debut + sc[0].t + 100, false);
    dyn.afficherPseudoElsa(1);
    expect(sprites().filter((s) => s.visible)).toHaveLength(3);
    expect(maillagesVisibles()).toBeGreaterThan(enTournee + 20);
    dyn.dispose();
  });

  it("les poses restent finies sur toute la durée d'une offre de la patronne", () => {
    const { scene, dyn } = monter();
    const debut = 100_000 - DUREE_OFFRE_MS;
    for (let age = 0; age <= DUREE_OFFRE_MS; age += 500) dyn.majElsa(offre(5, "patronne"), age / 1000, debut + age);
    scene.updateMatrixWorld(true);
    const boite = new THREE.Box3().setFromObject(scene);
    expect(Number.isFinite(boite.min.x) && Number.isFinite(boite.max.y)).toBe(true);
    dyn.dispose();
  });
});
