/**
 * Traces d'impact des balles sur les murs et les toits (three, v3) : petites brûlures orange posées à plat sur la surface touchée, qui
 * rougissent puis s'éteignent en `DUREE_S`. Optimisé : UN seul `InstancedMesh` (un appel de dessin) de `CAPACITE` traces en anneau (la plus
 * ancienne est réutilisée), couleurs d'instance mises à jour 4 fois par seconde seulement.
 */
import * as THREE from "three";
import type { Vec3 } from "./protocole";

const CAPACITE = 240;
const DUREE_S = 20;
const RAYON_M = 0.17;
/** Écart (m) à la surface : la trace ne doit pas scintiller avec le mur. */
const DECOLLEMENT_M = 0.025;
const PERIODE_COULEURS_S = 0.25;

export interface ImpactsBalles {
  /** Trace en `p`, à plat sur la surface de normale `n` (unitaire). */
  ajouter(p: Vec3, n: Vec3): void;
  maj(dt: number): void;
  vider(): void;
  dispose(): void;
}

export function creerImpactsBalles(scene: THREE.Scene): ImpactsBalles {
  const geo = new THREE.CircleGeometry(RAYON_M, 7);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, CAPACITE);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const couleurs = new Float32Array(CAPACITE * 3);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(couleurs, 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const ages = new Float32Array(CAPACITE).fill(Infinity);
  let prochain = 0;
  let accCouleurs = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1), un = new THREE.Vector3(1, 1, 1);
  const nul = new THREE.Matrix4().makeScale(0, 0, 0);

  const colorer = (i: number) => {
    // braise orange vif → rouge sombre → éteinte (en additif, le noir ne se voit pas)
    const k = Math.min(1, ages[i] / DUREE_S);
    const f = (1 - k) * (1 - k);
    couleurs[i * 3] = 1.0 * f;
    couleurs[i * 3 + 1] = 0.55 * f * (1 - 0.6 * k);
    couleurs[i * 3 + 2] = 0.18 * f * (1 - k);
  };

  return {
    ajouter(p, n) {
      const i = prochain;
      prochain = (prochain + 1) % CAPACITE;
      v.set(n[0], n[1], n[2]);
      q.setFromUnitVectors(z, v);
      m4.compose(new THREE.Vector3(p[0] + n[0] * DECOLLEMENT_M, p[1] + n[1] * DECOLLEMENT_M, p[2] + n[2] * DECOLLEMENT_M), q, un);
      mesh.setMatrixAt(i, m4);
      ages[i] = 0;
      colorer(i);
      mesh.count = Math.max(mesh.count, i + 1);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    },
    maj(dt) {
      if (mesh.count === 0) return;
      for (let i = 0; i < mesh.count; i++) if (ages[i] !== Infinity) ages[i] += dt;
      accCouleurs += dt;
      if (accCouleurs < PERIODE_COULEURS_S) return;
      accCouleurs = 0;
      let matrices = false;
      for (let i = 0; i < mesh.count; i++) {
        if (ages[i] === Infinity) continue;
        if (ages[i] >= DUREE_S) { ages[i] = Infinity; mesh.setMatrixAt(i, nul); matrices = true; continue; }
        colorer(i);
      }
      mesh.instanceColor!.needsUpdate = true;
      if (matrices) mesh.instanceMatrix.needsUpdate = true;
    },
    vider() {
      ages.fill(Infinity);
      mesh.count = 0;
      prochain = 0;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
