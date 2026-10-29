/**
 * Sol du décor (three.js) : chaussée en ruban, marquages (passages piétons, lignes d'arrêt, dents de requin, flèches), et les segments de bords,
 * trottoirs et axes pointillés que `ajouterReseauSol` (decor.ts) range dans son unique LineSegments à couleurs par sommet.
 * Couches : toutes `depthWrite: false`, ordre par `renderOrder` (chaussée −2, marquages 0), hauteurs distinctes d'au moins 5 cm.
 * Statique : aucun travail par image. Spec : docs/superpowers/specs/2026-10-29-da-palantir-design.md (D3).
 */
import * as THREE from "three";
import type { Voirie } from "./voirie";

/** Hauteurs des couches de sol (m). */
export const Y = { pelouse: 0.1, place: 0.27, chaussee: 0.3, trottoir: 0.4, marquage: 0.45, axe: 0.46 } as const;

/** Couleurs du sol, recopiées de `C` (decor.ts) par l'appelant : decor-sol.ts ne dépend pas de decor.ts (pas de cycle). */
export interface CouleursSol {
  chaussee: number;
  trottoir: number;
  marquage: number;
  roadM: number;
  roadR: number;
}

/** Triangles à plat [x, z, …] à la hauteur `y` → géométrie. */
function geometrieTriangles(t: readonly number[], y: number, couleurs?: readonly number[]): THREE.BufferGeometry {
  const n = t.length / 2;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = t[i * 2]; pos[i * 3 + 1] = y; pos[i * 3 + 2] = t[i * 2 + 1]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (couleurs) g.setAttribute("color", new THREE.Float32BufferAttribute(couleurs, 3));
  return g;
}

/** Chaussée M et R : un seul Mesh opaque en apparence (transparent à 1 pour suivre l'ordre de tri des autres couches), sans écriture de profondeur. */
export function ajouterChaussees(scene: THREE.Object3D, v: Voirie, couleur: number): THREE.Mesh | null {
  if (!v.ruban.length) return null;
  const m = new THREE.Mesh(
    geometrieTriangles(v.ruban, Y.chaussee),
    new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.renderOrder = -2;
  scene.add(m);
  return m;
}

/**
 * Marquages : passages piétons (55 %), lignes d'arrêt, dents de requin et flèches d'entrée du rond-point, UN seul Mesh à couleurs par sommet.
 * La brillance reste juste sous le seuil du bloom : pas de halo envahissant.
 */
export function ajouterMarquages(scene: THREE.Object3D, v: Voirie, couleur: number): THREE.Mesh | null {
  const parts: [readonly number[], number][] = [[v.zebras, 0.55], [v.lignesArret, 0.6], [v.dents, 0.55], [v.fleches, 0.5]];
  const tri: number[] = [], col: number[] = [];
  const c = new THREE.Color();
  for (const [t, k] of parts) {
    c.set(couleur).multiplyScalar(k);
    for (let i = 0; i < t.length; i += 2) { tri.push(t[i], t[i + 1]); col.push(c.r, c.g, c.b); }
  }
  if (!tri.length) return null;
  const m = new THREE.Mesh(
    geometrieTriangles(tri, Y.marquage, col),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.renderOrder = 0;
  scene.add(m);
  return m;
}

/**
 * Segments de sol de la voirie dérivée, avec leur couleur et leur hauteur, pour le LineSegments unique de `ajouterReseauSol`.
 * Bords à 80 % de la couleur de leur classe, trottoirs, axe pointillé des voies M à 70 % (au-dessus du seuil du bloom : il brille).
 */
export function segmentsVoirie(v: Voirie, c: CouleursSol): { seg: readonly number[]; y: number; hex: number; k: number }[] {
  return [
    { seg: v.bordsM, y: Y.marquage, hex: c.roadM, k: 0.8 },
    { seg: v.bordsR, y: Y.marquage, hex: c.roadR, k: 0.8 },
    { seg: v.trottoirs, y: Y.trottoir, hex: c.trottoir, k: 1 },
    { seg: v.ilotBord, y: Y.marquage, hex: c.trottoir, k: 1 },
    { seg: v.axes, y: Y.axe, hex: c.marquage, k: 0.7 },
  ];
}

/** Séparateurs de places de parking : un seul LineSegments (couleur de parking éclairci), sous les marquages. */
export function ajouterPlacesParking(scene: THREE.Object3D, places: readonly number[], couleur: number): THREE.LineSegments | null {
  if (!places.length) return null;
  const n = places.length / 2;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = places[i * 2]; pos[i * 3 + 1] = Y.place; pos[i * 3 + 2] = places[i * 2 + 1]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.9, depthWrite: false }));
  l.renderOrder = -1;
  scene.add(l);
  return l;
}
