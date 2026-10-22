/**
 * Décor three.js d'Agroparc : palette, bâtiments en fil de fer, réseau au sol, grille et arbres.
 * Extrait de scene.ts pour que la vue aérienne (scene.ts) et la vue à la première personne de
 * l'arène FPS (lib/fps/jeu.ts) dessinent exactement le même monde. Indépendant de React.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Building, Poi, SceneData, Vec2 } from "./types";

export const C = {
  ground: 0x04060a,
  cyan: 0x9be9ff,
  amber: 0xffb35c,
  white: 0xf2f7fa,
  shop: 0x6f8a96,
  roadM: 0x2f7f99,
  roadR: 0x246279,
  roadS: 0x1b4a5c,
  roadF: 0x0f2e3a,
  park: 0x12303c,
  water: 0x1a4f80,
  tree: 0x1d5a4a,
  grid: 0x0a161e,
  car: 0x6fc3de,
  bus: 0xbfe7d6,
};

export function shapeFrom(ring: Vec2[], holes?: Vec2[][]): THREE.Shape {
  const s = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  (holes || []).forEach((h) => s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z)))));
  return s;
}

export function extrude(b: Building): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeFrom(b.r, b.holes), { depth: b.h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Groupe fil de fer : arêtes cachées en fantôme, faces sombres, arêtes visibles lumineuses.
 * `ghostOpacity` à 0 supprime les arêtes cachées (à la première personne, elles dévoileraient
 * les joueurs et les couloirs derrière les murs).
 */
export function buildingGroup(list: Building[], edgeColor: number, faceColor: number, faceOpacity: number, ghostOpacity: number): THREE.Group {
  const faces: THREE.BufferGeometry[] = [];
  const edges: THREE.BufferGeometry[] = [];
  for (const b of list) {
    const g = extrude(b);
    edges.push(new THREE.EdgesGeometry(g, 12));
    const f = new THREE.BufferGeometry();
    f.setAttribute("position", g.getAttribute("position"));
    faces.push(f);
    g.dispose();
  }
  const grp = new THREE.Group();
  const faceGeo = mergeGeometries(faces, false);
  const edgeGeo = mergeGeometries(edges, false);
  if (!faceGeo || !edgeGeo) return grp;
  const mesh = new THREE.Mesh(
    faceGeo,
    new THREE.MeshBasicMaterial({ color: faceColor, transparent: true, opacity: faceOpacity, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }),
  );
  mesh.renderOrder = 1;
  const bright = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.95 }));
  bright.renderOrder = 2;
  if (ghostOpacity > 0) {
    const ghost = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: ghostOpacity, depthTest: false, depthWrite: false }));
    ghost.renderOrder = 0;
    grp.add(ghost);
  }
  grp.add(mesh, bright);
  return grp;
}

/** Arêtes lumineuses d'une géométrie (la géométrie source est libérée). */
export function edgesOf(geo: THREE.BufferGeometry, color: number, opacity = 0.95): THREE.LineSegments {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 10), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  geo.dispose();
  return e;
}

export interface OptionsDecor {
  /** Arêtes cachées en fantôme à travers les murs (vue aérienne : oui, défaut ; arène FPS : non). */
  fantomes?: boolean;
}

/** Bâtiments ordinaires (cyan), base (blanc) et restaurants (ambre). */
export function ajouterBatiments(scene: THREE.Object3D, data: SceneData, opts: OptionsDecor = {}): void {
  const fantomes = opts.fantomes !== false;
  const special = new Map<number, Poi["type"]>();
  for (const p of data.pois) if (p.type === "home" || p.type === "resto") special.set(p.b, p.type);
  scene.add(buildingGroup(data.buildings.filter((_, i) => !special.has(i)), C.cyan, 0x05080c, 0.82, fantomes ? 0.16 : 0));
  scene.add(buildingGroup(data.buildings.filter((_, i) => special.get(i) === "home"), C.white, 0x0c141a, 0.9, fantomes ? 0.35 : 0));
  scene.add(buildingGroup(data.buildings.filter((_, i) => special.get(i) === "resto"), C.amber, 0x120e08, 0.9, fantomes ? 0.3 : 0));
}

/** Voirie, parkings, eau : un seul LineSegments à couleurs par sommet. */
export function ajouterReseauSol(scene: THREE.Object3D, data: SceneData): void {
  const pos: number[] = [], col: number[] = [];
  const push = (pts: Vec2[], y: number, hex: number) => {
    const c = new THREE.Color(hex);
    for (let i = 0; i < pts.length - 1; i++) {
      pos.push(pts[i][0], y, pts[i][1], pts[i + 1][0], y, pts[i + 1][1]);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  };
  const roadColor = { M: C.roadM, R: C.roadR, S: C.roadS, F: C.roadF };
  for (const r of data.roads) push(r.p, 0.4, roadColor[r.c] ?? C.roadS);
  for (const p of data.parkings) push([...p, p[0]], 0.25, C.park);
  for (const w of data.water) push([...w, w[0]], 0.2, C.water);
  for (const w of data.wlines) push(w, 0.2, C.water);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 })));
}

/** Grille de fond (4 km, pas de 20 m). */
export function ajouterGrille(scene: THREE.Object3D): void {
  const grid = new THREE.GridHelper(4000, 200, C.grid, C.grid);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  grid.position.y = -0.05;
  scene.add(grid);
}

/** Arbres : couronnes en icosaèdres filaires instanciés + troncs. */
export function ajouterArbres(scene: THREE.Object3D, data: SceneData): void {
  const n = data.trees.length;
  const crown = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(2.4, 0),
    new THREE.MeshBasicMaterial({ color: C.tree, wireframe: true, transparent: true, opacity: 0.5 }),
    Math.max(n, 1),
  );
  crown.count = n;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const trunk: number[] = [];
  data.trees.forEach(([x, z], i) => {
    const k = 0.75 + ((((x * 7 + z * 13) % 10) + 10) % 10) / 18;
    v.set(x, 4.6 * k, z);
    s.setScalar(k);
    m.compose(v, q, s);
    crown.setMatrixAt(i, m);
    trunk.push(x, 0, z, x, 3.2 * k, z);
  });
  scene.add(crown);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.Float32BufferAttribute(trunk, 3));
  scene.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: C.tree, transparent: true, opacity: 0.45 })));
}

/** Tout le décor fixe, dans l'ordre de la vue aérienne : bâtiments, réseau au sol, grille, arbres. */
export function construireDecor(scene: THREE.Object3D, data: SceneData, opts: OptionsDecor = {}): void {
  ajouterBatiments(scene, data, opts);
  ajouterReseauSol(scene, data);
  ajouterGrille(scene);
  ajouterArbres(scene, data);
}
