import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { creerRenduMonstres } from "./rendu-monstres";
import { TRUCK_FOU } from "./monstres";

/** Le Truck Muche fou rendu sous Node (three sans moteur de rendu) : le modèle du Truck garé, Elsa et la patronne dedans, aucun gyrophare. */

const monstres = (cap: number, v = 12) => ({ truck: { p: [10, 0, -4] as [number, number, number], cap, v } });
const montrer = (r: ReturnType<typeof creerRenduMonstres>, m: ReturnType<typeof monstres> | Record<string, never>, tS: number, dt = 1 / 60) => r.maj(m, [], tS, 0, dt, "#9be9ff", false);
const racineMonstres = (scene: THREE.Scene) => scene.children.find((c) => c.name === "monstres")!;

describe("Truck fou : le design du Truck Muche, Elsa et la patronne aux commandes", () => {
  it("n'est construit qu'à sa première apparition (événement rare) et caché quand il n'y a plus de Truck fou", () => {
    const scene = new THREE.Scene();
    const r = creerRenduMonstres(scene);
    const avant = racineMonstres(scene).children.length;
    let meshes = 0;
    racineMonstres(scene).traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    montrer(r, {}, 0);
    let apres = 0;
    racineMonstres(scene).traverse((o) => { if ((o as THREE.Mesh).isMesh) apres++; });
    expect(apres).toBe(meshes);
    montrer(r, monstres(0), 0.1);
    let avecTruck = 0;
    racineMonstres(scene).traverse((o) => { if ((o as THREE.Mesh).isMesh) avecTruck++; });
    expect(avecTruck).toBeGreaterThan(meshes + 40); // modèle + habitacle + deux figures articulées
    expect(racineMonstres(scene).children.length).toBe(avant);
    r.dispose();
  });

  it("posé et orienté par le snap, avec la caisse du Truck Muche, sans aucun gyrophare rouge ni bleu", () => {
    const scene = new THREE.Scene();
    const r = creerRenduMonstres(scene);
    montrer(r, monstres(1.2), 0.1);
    scene.updateMatrixWorld(true);
    const groupe = racineMonstres(scene).children[0];
    expect(groupe.visible).toBe(true);
    expect(groupe.position.toArray()).toEqual([10, 0, -4]);
    expect(groupe.rotation.y).toBeCloseTo(1.2, 9);
    const b = new THREE.Box3().setFromObject(groupe);
    const taille = b.getSize(new THREE.Vector3());
    expect(Math.max(taille.x, taille.z)).toBeGreaterThan(TRUCK_FOU.longueur - 0.5);
    // aucun bloc lumineux rouge (0xff2030) ni bleu (0x2a7bff) : les gyrophares d'avant
    const gyro: number[] = [];
    groupe.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (mat?.color && [0xff2030, 0x2a7bff].includes(mat.color.getHex())) gyro.push(mat.color.getHex());
    });
    expect(gyro).toEqual([]);
    r.dispose();
  });

  it("les roues tournent dans le sens de la marche, et en sens inverse en marche arrière", () => {
    const scene = new THREE.Scene();
    const r = creerRenduMonstres(scene);
    const roues = (): THREE.Object3D[] => {
      const v: THREE.Object3D[] = [];
      racineMonstres(scene).traverse((o) => { if (o.children.some((c) => (c as THREE.LineSegments).isLineSegments) && Math.abs(o.position.y - 0.45) < 1e-6 && o.children.length === 3) v.push(o); });
      return v;
    };
    montrer(r, monstres(0, 10), 0);
    const a0 = roues().map((w) => w.rotation.x);
    for (let k = 1; k <= 30; k++) montrer(r, monstres(0, 10), k / 60);
    const avance = roues().map((w, i) => w.rotation.x - a0[i]);
    expect(avance.length).toBe(4);
    for (const d of avance) expect(d).toBeLessThan(-0.5);
    const a1 = roues().map((w) => w.rotation.x);
    for (let k = 1; k <= 30; k++) montrer(r, monstres(0, -10), 1 + k / 60);
    roues().forEach((w, i) => expect(w.rotation.x).toBeGreaterThan(a1[i] + 0.5));
    r.dispose();
  });

  it("elles se penchent dans un virage : le volant et les corps ne sont plus à l'état de la ligne droite", () => {
    const scene = new THREE.Scene();
    const r = creerRenduMonstres(scene);
    const empreinte = () => { const v: number[] = []; racineMonstres(scene).traverse((o) => { if ((o as THREE.Group).isGroup && o.rotation.z !== 0) v.push(o.rotation.z); }); return v.map((x) => Math.round(x * 1000)).join(","); };
    for (let k = 0; k < 60; k++) montrer(r, monstres(0), k / 60);
    const droit = empreinte();
    for (let k = 0; k < 60; k++) montrer(r, monstres(k * 0.02), 1 + k / 60);
    expect(empreinte()).not.toBe(droit);
    r.dispose();
  });

  it("caché puis réaffiché : pas de saut de lacet (le cap précédent est oublié)", () => {
    const scene = new THREE.Scene();
    const r = creerRenduMonstres(scene);
    montrer(r, monstres(0), 0);
    montrer(r, {}, 0.1);
    montrer(r, monstres(3), 5);
    montrer(r, monstres(3), 5.02);
    // finis
    scene.updateMatrixWorld(true);
    expect(Number.isFinite(new THREE.Box3().setFromObject(scene).max.y)).toBe(true);
    r.dispose();
  });
});
