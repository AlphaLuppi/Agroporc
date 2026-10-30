/**
 * Végétation du décor (three.js) : six silhouettes filaires (platane, pin, cyprès, olivier, feuillu, arbuste) en `InstancedMesh` à teinte par
 * instance, un seul LineSegments pour tous les troncs, haies (arêtes + faces translucides) et pelouses hachurées (un Mesh fusionné).
 * Tout reste fil de fer sous le seuil du bloom. Statique : aucun travail par image. Spec : docs/superpowers/specs/2026-10-29-da-palantir-design.md (D4).
 */
import * as THREE from "three";
import { Y } from "./decor-sol";
import type { ArbreClasse, TypeArbre } from "./vegetation";
import { HAIE_HAUTEUR_M, HAIE_TRONCON_M } from "./vegetation";

/** Couleurs de la végétation (recopiées de `C` par l'appelant). */
export interface CouleursVegetation {
  tree: number;
  platane: number;
  automne: number;
  cypres: number;
  olivier: number;
  pin: number;
  haie: number;
  pelouse: number;
}

/** Silhouette d'un type : géométrie de couronne (centrée sur son centre), hauteur du tronc et du centre de la couronne (m, avant échelle). */
interface Silhouette { geo: () => THREE.BufferGeometry; tronc: number; centre: number }

const SILHOUETTES: Record<TypeArbre, Silhouette> = {
  // ellipsoïde 4,2 × 3,6 sur tronc de 5 m
  platane: { geo: () => new THREE.IcosahedronGeometry(1, 1).scale(2.1, 1.8, 2.1), tronc: 5, centre: 6.4 },
  // disque aplati (cylindre à 8 faces, 4,5 m en haut et 3 m en bas, 1,8 m) sur tronc de 6 m
  pin: { geo: () => new THREE.CylinderGeometry(4.5, 3, 1.8, 8), tronc: 6, centre: 6.9 },
  // cône étroit de 7 m à 6 faces, posé sur le sol
  cypres: { geo: () => new THREE.ConeGeometry(1.1, 7, 6), tronc: 0.8, centre: 3.5 },
  // petit icosaèdre 1,6 × 0,8 × 1,6 sur tronc de 1,8 m
  olivier: { geo: () => new THREE.IcosahedronGeometry(1, 0).scale(1.6, 0.8, 1.6), tronc: 1.8, centre: 2.6 },
  // l'icosaèdre d'avant (rayon 2,4), tronc de 3,2 m
  feuillu: { geo: () => new THREE.IcosahedronGeometry(2.4, 0), tronc: 3.2, centre: 4.6 },
};

const TEINTE_DE: Record<TypeArbre, keyof CouleursVegetation> = { platane: "platane", pin: "pin", cypres: "cypres", olivier: "olivier", feuillu: "tree" };

/**
 * Arbres de `scene.trees` : un `InstancedMesh` filaire par type présent (≤ 5), un LineSegments pour tous les troncs et un `InstancedMesh`
 * d'arbustes. L'arbre planté dans un bâtiment (`visible` faux) n'est pas dessiné.
 */
export function ajouterVegetation(scene: THREE.Object3D, arbres: readonly ArbreClasse[], arbustes: readonly number[], c: CouleursVegetation): void {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), axe = new THREE.Vector3(0, 1, 0);
  const couleur = new THREE.Color();
  const troncs: number[] = [], couleursTroncs: number[] = [];
  for (const type of Object.keys(SILHOUETTES) as TypeArbre[]) {
    const liste = arbres.filter((a) => a.type === type && a.visible);
    if (!liste.length) continue;
    const sil = SILHOUETTES[type];
    const mesh = new THREE.InstancedMesh(
      sil.geo(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }),
      liste.length,
    );
    liste.forEach((a, i) => {
      q.setFromAxisAngle(axe, a.rot);
      m.compose(v.set(a.x, sil.centre * a.echelle, a.z), q, s.setScalar(a.echelle));
      mesh.setMatrixAt(i, m);
      couleur.set(a.automne ? c.automne : c[TEINTE_DE[type]]).multiplyScalar(a.teinte);
      mesh.setColorAt(i, couleur);
      troncs.push(a.x, 0, a.z, a.x, sil.tronc * a.echelle, a.z);
      couleursTroncs.push(couleur.r, couleur.g, couleur.b, couleur.r, couleur.g, couleur.b);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.couche = "arbres";
    scene.add(mesh);
  }
  if (troncs.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(troncs, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(couleursTroncs, 3));
    const troncsLignes = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }));
    troncsLignes.userData.couche = "arbres";
    scene.add(troncsLignes);
  }
  if (arbustes.length) {
    const n = arbustes.length / 2;
    const mesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.8, 0),
      new THREE.MeshBasicMaterial({ color: c.haie, wireframe: true, transparent: true, opacity: 0.5 }),
      n,
    );
    for (let i = 0; i < n; i++) {
      const k = 0.8 + ((i * 7919) % 100) / 250;
      m.compose(v.set(arbustes[i * 2], 0.7 * k, arbustes[i * 2 + 1]), q.identity(), s.setScalar(k));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.couche = "arbres";
    scene.add(mesh);
  }
}

/** Haies : arêtes (LineSegments) et faces translucides (Mesh) de tronçons de 0,9 m × 1,1 m, 0,7 m d'épaisseur. */
export function ajouterHaies(scene: THREE.Object3D, h: readonly number[], couleur: number): void {
  const n = h.length / 4;
  if (!n) return;
  const lignes = new Float32Array(n * 5 * 6), tris = new Float32Array(n * 18 * 3);
  let il = 0, it = 0;
  const L = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => { lignes[il++] = x1; lignes[il++] = y1; lignes[il++] = z1; lignes[il++] = x2; lignes[il++] = y2; lignes[il++] = z2; };
  const T = (a: readonly number[], b: readonly number[], c: readonly number[]) => { for (const p of [a, b, c]) { tris[it++] = p[0]; tris[it++] = p[1]; tris[it++] = p[2]; } };
  const hh = HAIE_HAUTEUR_M, demiL = HAIE_TRONCON_M / 2, demiE = 0.35;
  for (let i = 0; i < n; i++) {
    const x = h[i * 4], z = h[i * 4 + 1], ux = h[i * 4 + 2], uz = h[i * 4 + 3], nx = -uz, nz = ux;
    const p = (du: number, dn: number, y: number) => [x + ux * du + nx * dn, y, z + uz * du + nz * dn];
    const a0 = p(-demiL, demiE, 0), b0 = p(demiL, demiE, 0), c0 = p(demiL, -demiE, 0), d0 = p(-demiL, -demiE, 0);
    const a1 = p(-demiL, demiE, hh), b1 = p(demiL, demiE, hh), c1 = p(demiL, -demiE, hh), d1 = p(-demiL, -demiE, hh);
    // arêtes : deux lignes de faîte, un poteau de chaque côté et la traverse du haut
    L(...(a1 as [number, number, number]), ...(b1 as [number, number, number]));
    L(...(d1 as [number, number, number]), ...(c1 as [number, number, number]));
    L(...(a0 as [number, number, number]), ...(a1 as [number, number, number]));
    L(...(d0 as [number, number, number]), ...(d1 as [number, number, number]));
    L(...(a1 as [number, number, number]), ...(d1 as [number, number, number]));
    // faces : deux flancs et le dessus
    T(a0, b0, b1); T(a0, b1, a1);
    T(d0, c1, c0); T(d0, d1, c1);
    T(a1, b1, c1); T(a1, c1, d1);
  }
  const gl = new THREE.BufferGeometry();
  gl.setAttribute("position", new THREE.BufferAttribute(lignes, 3));
  const ls = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.7 }));
  const gm = new THREE.BufferGeometry();
  gm.setAttribute("position", new THREE.BufferAttribute(tris.subarray(0, it), 3));
  const mesh = new THREE.Mesh(gm, new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  mesh.renderOrder = -1;
  ls.userData.couche = mesh.userData.couche = "haies";
  scene.add(ls, mesh);
}

/** Pelouses : un seul Mesh à plat (y = 0,10), translucide, hachuré en diagonale par le nuanceur pour qu'une prairie se lise comme telle en fil de fer. */
export function ajouterPelouses(scene: THREE.Object3D, t: readonly number[], couleur: number): THREE.Mesh | null {
  const n = t.length / 2;
  if (!n) return null;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = t[i * 2]; pos[i * 3 + 1] = Y.pelouse; pos[i * 3 + 2] = t[i * 2 + 1]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = `varying vec2 vPelouse;\n${sh.vertexShader}`.replace("#include <begin_vertex>", () => "#include <begin_vertex>\nvPelouse = (modelMatrix * vec4(transformed, 1.0)).xz;");
    sh.fragmentShader = `varying vec2 vPelouse;\n${sh.fragmentShader}`.replace("#include <opaque_fragment>", () => `float sH = (vPelouse.x + vPelouse.y) * 0.5;
float fH = fract(sH);
float wH = fwidth(sH);
// les hachures s'effacent avec la distance (sinon le trait couvre tout le pixel et la prairie devient un aplat clair)
float trait = (1.0 - smoothstep(0.0, max(0.05, 1.5 * wH), min(fH, 1.0 - fH))) * (1.0 - smoothstep(0.12, 0.4, wH));
outgoingLight = mix(outgoingLight, vec3(0.018, 0.11, 0.075), trait);
diffuseColor.a = mix(diffuseColor.a, 0.7, trait);
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => "pelouse-hachuree-2";
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = -3;
  m.userData.couche = "pelouses";
  scene.add(m);
  return m;
}
