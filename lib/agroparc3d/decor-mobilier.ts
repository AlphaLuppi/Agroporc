/**
 * Mobilier du décor (three.js) : mâts, poteaux et arêtes dans UN LineSegments à couleurs par sommet, plaques de panneaux, têtes de mâts et sièges
 * dans UN Mesh fusionné, taches de lumière au sol dans UN InstancedMesh (mélange additif, intensité 0,10 : sans bloom). Trois draw calls, statique.
 * Les têtes de mâts sont au-dessus du seuil du bloom (accents, pas des surfaces) ; les plaques restent en dessous.
 * Spec : docs/superpowers/specs/2026-10-29-da-palantir-design.md (D5).
 */
import * as THREE from "three";
import { MAT_BRAS_M, MAT_HAUTEUR_M, type Mobilier } from "./mobilier";

export interface CouleursMobilier {
  lampe: number;
  stop: number;
  amber: number;
  info: number;
  bus: number;
  trottoir: number;
  cyan: number;
}

/** Rayon de la tache de lumière au sol (m) et intensité (part de la couleur de la lampe). */
export const TACHE_RAYON_M = 3.5;
export const TACHE_INTENSITE = 0.1;
/** Les plaques de panneaux restent sous le seuil du bloom. */
const PLAQUE_K = 0.55;

class Lignes {
  pos: number[] = [];
  col: number[] = [];
  segment(a: readonly number[], b: readonly number[], c: THREE.Color): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    this.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  boite(cx: number, cz: number, ux: number, uz: number, l: number, h: number, w: number, c: THREE.Color, y0 = 0): void {
    const nx = -uz, nz = ux;
    const pt = (du: number, dn: number, y: number): number[] => [cx + ux * du + nx * dn, y, cz + uz * du + nz * dn];
    const bas = [pt(-l / 2, -w / 2, y0), pt(l / 2, -w / 2, y0), pt(l / 2, w / 2, y0), pt(-l / 2, w / 2, y0)];
    const haut = [pt(-l / 2, -w / 2, y0 + h), pt(l / 2, -w / 2, y0 + h), pt(l / 2, w / 2, y0 + h), pt(-l / 2, w / 2, y0 + h)];
    for (let i = 0; i < 4; i++) { this.segment(bas[i], bas[(i + 1) % 4], c); this.segment(haut[i], haut[(i + 1) % 4], c); this.segment(bas[i], haut[i], c); }
  }
}

class Faces {
  pos: number[] = [];
  col: number[] = [];
  tri(a: readonly number[], b: readonly number[], c: readonly number[], k: THREE.Color): void {
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(k.r, k.g, k.b); }
  }
  quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], k: THREE.Color): void { this.tri(a, b, c, k); this.tri(a, c, d, k); }
}

/** Plaque verticale de forme `genre`, centrée en (x, y, z), qui fait face au sens opposé à (ux, uz). */
function plaque(f: Faces, genre: "stop" | "cedez" | "passage" | "bus", x: number, y: number, z: number, ux: number, uz: number, k: THREE.Color): void {
  // axe horizontal de la plaque : perpendiculaire au sens d'arrivée
  const hx = -uz, hz = ux;
  const P = (dh: number, dy: number): number[] => [x + hx * dh, y + dy, z + hz * dh];
  if (genre === "stop") {
    const pts = Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * 2 * Math.PI + Math.PI / 8; return P(Math.cos(a) * 0.4, Math.sin(a) * 0.4); });
    for (let i = 0; i < 8; i++) f.tri(P(0, 0), pts[i], pts[(i + 1) % 8], k);
  } else if (genre === "cedez") {
    f.tri(P(-0.45, 0.35), P(0.45, 0.35), P(0, -0.4), k);
  } else if (genre === "passage") {
    f.quad(P(-0.3, -0.3), P(0.3, -0.3), P(0.3, 0.3), P(-0.3, 0.3), k);
  } else {
    f.quad(P(-0.25, -0.4), P(0.25, -0.4), P(0.25, 0.4), P(-0.25, 0.4), k);
  }
}

/** Mobilier de la scène : un LineSegments, un Mesh, et (sauf `taches` faux) un InstancedMesh de taches de lumière. */
export function ajouterMobilier(scene: THREE.Object3D, m: Mobilier, c: CouleursMobilier, taches: boolean): void {
  const L = new Lignes(), F = new Faces();
  const cMat = new THREE.Color(c.trottoir).multiplyScalar(2.2);
  const cLampe = new THREE.Color(c.lampe);
  const cCyan = new THREE.Color(c.cyan).multiplyScalar(0.3);
  const cBus = new THREE.Color(c.bus).multiplyScalar(0.35);
  const plaques: Record<string, THREE.Color> = {
    stop: new THREE.Color(c.stop).multiplyScalar(PLAQUE_K), cedez: new THREE.Color(c.amber).multiplyScalar(PLAQUE_K),
    passage: new THREE.Color(c.info).multiplyScalar(PLAQUE_K), bus: new THREE.Color(c.bus).multiplyScalar(PLAQUE_K),
  };

  // ---- lampadaires : mât, bras et tête émissive (petit octaèdre)
  const centres: number[] = [];
  for (const l of m.lampadaires) {
    const hx = l.x + l.ax * MAT_BRAS_M, hz = l.z + l.az * MAT_BRAS_M;
    L.segment([l.x, 0, l.z], [l.x, MAT_HAUTEUR_M, l.z], cMat);
    L.segment([l.x, MAT_HAUTEUR_M, l.z], [hx, MAT_HAUTEUR_M, hz], cMat);
    const t = MAT_HAUTEUR_M, r = 0.28;
    const top = [hx, t + r, hz], bas = [hx, t - r, hz];
    const eq = [[hx + r, t, hz], [hx, t, hz + r], [hx - r, t, hz], [hx, t, hz - r]];
    for (let i = 0; i < 4; i++) { F.tri(top, eq[i], eq[(i + 1) % 4], cLampe); F.tri(bas, eq[(i + 1) % 4], eq[i], cLampe); }
    centres.push(hx, hz);
  }
  // ---- panneaux : poteau et plaque
  for (const p of m.panneaux) {
    const h = p.genre === "bus" ? 2.6 : 2.2;
    L.segment([p.x, 0, p.z], [p.x, h, p.z], cMat);
    plaque(F, p.genre, p.x, h + 0.2, p.z, p.ux, p.uz, plaques[p.genre]);
  }
  // ---- abris de bus : boîte filaire 3 × 1,6 × 2,5 m et toit
  for (const a of m.abris) {
    L.boite(a.x, a.z, a.ux, a.uz, 3, 2.5, 1.6, cBus);
    const nx = -a.uz, nz = a.ux;
    const pt = (du: number, dn: number): number[] => [a.x + a.ux * du + nx * dn, 2.5, a.z + a.uz * du + nz * dn];
    F.quad(pt(-1.6, -0.9), pt(1.6, -0.9), pt(1.6, 0.9), pt(-1.6, 0.9), cBus.clone().multiplyScalar(0.3));
  }
  // ---- bancs 1,6 × 0,45 × 0,5 m, corbeilles, racks à vélos, portails
  for (const b of m.bancs) {
    L.boite(b.x, b.z, b.ux, b.uz, 1.6, 0.5, 0.45, cCyan);
    const nx = -b.uz, nz = b.ux;
    F.quad([b.x - b.ux * 0.8 - nx * 0.22, 0.5, b.z - b.uz * 0.8 - nz * 0.22], [b.x + b.ux * 0.8 - nx * 0.22, 0.5, b.z + b.uz * 0.8 - nz * 0.22], [b.x + b.ux * 0.8 + nx * 0.22, 0.5, b.z + b.uz * 0.8 + nz * 0.22], [b.x - b.ux * 0.8 + nx * 0.22, 0.5, b.z - b.uz * 0.8 + nz * 0.22], cCyan.clone().multiplyScalar(0.5));
  }
  for (const k of m.corbeilles) {
    const n = 6, r = 0.25, h = 0.8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
      L.segment([k.x + Math.cos(a) * r, 0, k.z + Math.sin(a) * r], [k.x + Math.cos(a) * r, h, k.z + Math.sin(a) * r], cCyan);
      L.segment([k.x + Math.cos(a) * r, h, k.z + Math.sin(a) * r], [k.x + Math.cos(b) * r, h, k.z + Math.sin(b) * r], cCyan);
    }
  }
  for (const v of m.velos) {
    const nx = -v.uz, nz = v.ux;
    for (const d of [-0.4, 0, 0.4]) {
      const a = [v.x + v.ux * d - nx * 0.3, 0, v.z + v.uz * d - nz * 0.3], b = [v.x + v.ux * d - nx * 0.3, 0.8, v.z + v.uz * d - nz * 0.3];
      const c2 = [v.x + v.ux * d + nx * 0.3, 0.8, v.z + v.uz * d + nz * 0.3], e = [v.x + v.ux * d + nx * 0.3, 0, v.z + v.uz * d + nz * 0.3];
      L.segment(a, b, cCyan); L.segment(b, c2, cCyan); L.segment(c2, e, cCyan);
    }
  }
  for (const p of m.portails) {
    const nx = -p.uz, nz = p.ux;
    // deux montants de part et d'autre de la voie d'accès (à ±2 m), une barre
    const a = [p.x + nx * 2, 0, p.z + nz * 2], b = [p.x - nx * 2, 0, p.z - nz * 2];
    L.segment(a, [a[0], 1.6, a[2]], cMat); L.segment(b, [b[0], 1.6, b[2]], cMat);
    L.segment([a[0], 1.4, a[2]], [b[0], 1.4, b[2]], cMat);
  }

  if (L.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(L.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(L.col, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })));
  }
  if (F.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(F.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(F.col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }
  // ---- taches de lumière : disque à dégradé radial (sommets : centre clair, bord noir), mélange additif, une instance par lampadaire
  if (taches && centres.length) {
    const seg = 16, pos: number[] = [], col: number[] = [];
    const clair = new THREE.Color(c.lampe).multiplyScalar(TACHE_INTENSITE);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * 2 * Math.PI, b = ((i + 1) / seg) * 2 * Math.PI;
      pos.push(0, 0, 0, Math.cos(a) * TACHE_RAYON_M, 0, Math.sin(a) * TACHE_RAYON_M, Math.cos(b) * TACHE_RAYON_M, 0, Math.sin(b) * TACHE_RAYON_M);
      col.push(clair.r, clair.g, clair.b, 0, 0, 0, 0, 0, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const n = centres.length / 2;
    const im = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }), n);
    const mat = new THREE.Matrix4();
    for (let i = 0; i < n; i++) im.setMatrixAt(i, mat.makeTranslation(centres[i * 2], 0.42, centres[i * 2 + 1]));
    im.instanceMatrix.needsUpdate = true;
    im.renderOrder = 1;
    im.frustumCulled = false;
    scene.add(im);
  }
}
