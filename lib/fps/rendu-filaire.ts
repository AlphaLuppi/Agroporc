/**
 * Outils filaires communs aux rendus du monde (voitures, Truck Muche, vendeuses, monstres) : une pièce = faces sombres (qui masquent les arêtes cachées) +
 * arêtes lumineuses, aux ordres de dessin des avatars. Aucun test vitest (three) : les régressions se voient aux captures.
 */
import * as THREE from "three";

/** Ordre de dessin des faces ; les arêtes sont à +1 (comme les avatars : après les bâtiments, qui les occultent). */
export const ORDRE_BASE = 5;

/** Géométrie des faces + arêtes : un seul `Mesh` et un seul `LineSegments` par objet, même fusionné. */
export interface GeoPiece { geo: THREE.BufferGeometry; aretes: THREE.BufferGeometry }

export function enPiece(geo: THREE.BufferGeometry): GeoPiece {
  return { geo, aretes: new THREE.EdgesGeometry(geo, 12) };
}

export function libererPiece(g: GeoPiece): void {
  g.geo.dispose();
  g.aretes.dispose();
}

/** Boîte w×h×d dont le centre est en (x, y, z). */
export function boite(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Garde le seul attribut `position` (+ index) : tous les morceaux fusionnés doivent avoir les mêmes attributs. */
export function nu(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  return g;
}

export interface Materiaux { ligne: THREE.LineBasicMaterial; fond: THREE.MeshBasicMaterial }

/** Arêtes lumineuses + faces sombres (profondeur testée, les faces écrivent la profondeur : elles masquent les arêtes cachées). */
export function creerMateriaux(couleur: THREE.Color): Materiaux {
  const ligne = new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.95, depthWrite: false });
  const fond = new THREE.MeshBasicMaterial({
    color: couleur.clone().multiplyScalar(0.09),
    transparent: true,
    opacity: 1,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
  return { ligne, fond };
}

export function libererMateriaux(m: Materiaux): void {
  m.ligne.dispose();
  m.fond.dispose();
}

/** Pièce filaire (faces + arêtes) posée dans `parent`, avec les ordres de dessin des avatars. */
export function piece(parent: THREE.Object3D, g: GeoPiece, m: Materiaux, x = 0, y = 0, z = 0): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  const faces = new THREE.Mesh(g.geo, m.fond);
  const aretes = new THREE.LineSegments(g.aretes, m.ligne);
  faces.renderOrder = ORDRE_BASE;
  aretes.renderOrder = ORDRE_BASE + 1;
  grp.add(faces, aretes);
  parent.add(grp);
  return grp;
}

