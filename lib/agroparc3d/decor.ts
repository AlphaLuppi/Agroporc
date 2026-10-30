/**
 * Décor three.js d'Agroparc : palette, bâtiments en fil de fer, réseau au sol, grille et arbres.
 * Extrait de scene.ts pour que la vue aérienne (scene.ts) et la vue à la première personne de
 * l'arène FPS (lib/fps/jeu.ts) dessinent exactement le même monde. Indépendant de React.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LUM_VITRINE, SEUIL_ALLUMEES, FENETRE_H_M, FENETRE_L_M, PAS_COLONNE_M, MARGE_COLONNE_M, PORTE_H_M, PORTE_L_M, ENSEIGNE_H_M, ENSEIGNE_L_M, ENSEIGNE_Y_M, INDUSTRIEL_PORTE_H_M, INDUSTRIEL_PORTE_L_M, MUR_RIDEAU_CELLULE_M, VITRINE_BAS_M, VITRINE_HAUT_M, acrotere, codeFacade, murDePorte, mursDe, nbEtages, placementsSolaires, placementsToit } from "./facade";
import { deriverDecor, type DecorDerive, type OptionsDerivation } from "./decor-donnees";
import { ajouterMobilier } from "./decor-mobilier";
import { ajouterHaies, ajouterPelouses, ajouterVegetation } from "./decor-vegetation";
import { ajouterChaussees, ajouterMarquages, ajouterPlacesParking, segmentsVoirie } from "./decor-sol";
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
  parkPlace: 0x1c4a5a,
  water: 0x1a4f80,
  tree: 0x1d5a4a,
  grid: 0x0a161e,
  car: 0x6fc3de,
  bus: 0xbfe7d6,
  // rework de la DA (issue #83) : sol, végétation, mobilier. Tout reste sous 0,24 de luminosité (seuil du bloom) sauf marquage, lampes et enseignes.
  chaussee: 0x070f16,
  trottoir: 0x14323d,
  marquage: 0xdbeef5,
  pelouse: 0x0b2a22,
  haie: 0x1f6f55,
  platane: 0x2c7a52,
  automne: 0x5a4318,
  cypres: 0x174d3b,
  olivier: 0x5f8f78,
  pin: 0x2a6b52,
  lampe: 0xffd9a0,
  stop: 0xff4a3a,
  info: 0x4cc3ff,
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

/** Style d'une pièce de la carte zombies (`Building.type`) : porte payante, barricade, champ passe-tigres. */
export type StylePiece = "porte" | "barricade" | "champ";

export interface OptionsGroupe {
  /** numéro de chaque bâtiment de la liste dans `scene.json` (attribut `aBat`, posé avec la destruction ou le détail) */
  indices?: readonly number[];
  /** état de destruction partagé : le nuanceur écrase les bâtiments et découpe les brèches */
  etat?: EtatDestruction;
  /** façades détaillées : murs en quads (étages, fenêtres, corniche, porte) ; `portes[k]` = arête de porte du bâtiment k, `styles[k]` = `codeFacade` du bâtiment k */
  detail?: { portes: readonly (number | null)[]; styles?: readonly number[] };
  /** style d'une pièce de la carte zombies (matériau et motif propres) */
  style?: StylePiece;
}

/** Murs en quads d'un bâtiment + toit repris de l'extrusion : attributs `aBat`, `aMur` = (u, L, nEtages, porte), `aHaut` et `aStyle` (style de façade + drapeau restaurant, cf. `codeFacade`). */
function facesDetaillees(g: THREE.BufferGeometry, b: Building, id: number, porte: number | null, style: number): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute("position");
  const pos: number[] = [];
  const mur: number[] = [];
  // toit : triangles du couvercle haut (y = h)
  for (let i = 0; i + 2 < p.count; i += 3) {
    if (p.getY(i) > b.h / 2 && p.getY(i + 1) > b.h / 2 && p.getY(i + 2) > b.h / 2) {
      for (let k = 0; k < 3; k++) { pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k)); mur.push(0, 0, 0, 0); }
    }
  }
  if (src !== g) src.dispose();
  const n = nbEtages(b.h);
  for (const m of mursDe(b, porte)) {
    const [ax, az] = m.a, [bx, bz] = m.b;
    const lisse = m.lisse ? 0 : n;
    const coin = (x: number, z: number, y: number, u: number) => { pos.push(x, y, z); mur.push(u, m.L, lisse, m.porte ? 1 : 0); };
    // A bas, B bas, B haut puis A bas, B haut, A haut : face avant du côté de la normale sortante
    coin(ax, az, 0, 0); coin(bx, bz, 0, m.L); coin(bx, bz, b.h, m.L);
    coin(ax, az, 0, 0); coin(bx, bz, b.h, m.L); coin(ax, az, b.h, 0);
  }
  const nb = pos.length / 3;
  const f = new THREE.BufferGeometry();
  f.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  f.setAttribute("aBat", new THREE.Float32BufferAttribute(new Float32Array(nb).fill(id), 1));
  f.setAttribute("aMur", new THREE.Float32BufferAttribute(mur, 4));
  f.setAttribute("aHaut", new THREE.Float32BufferAttribute(new Float32Array(nb).fill(b.h), 1));
  f.setAttribute("aStyle", new THREE.Float32BufferAttribute(new Float32Array(nb).fill(style), 1));
  return f;
}

/**
 * Groupe fil de fer : arêtes cachées en fantôme, faces sombres, arêtes visibles lumineuses.
 * `ghostOpacity` à 0 supprime les arêtes cachées (à la première personne, elles dévoileraient
 * les joueurs et les couloirs derrière les murs).
 */
export function buildingGroup(
  list: Building[], edgeColor: number, faceColor: number, faceOpacity: number, ghostOpacity: number,
  opts: OptionsGroupe = {},
): THREE.Group {
  const { indices, etat, detail, style } = opts;
  if (!list.length) return new THREE.Group();
  const faces: THREE.BufferGeometry[] = [];
  const edges: THREE.BufferGeometry[] = [];
  list.forEach((b, k) => {
    const g = extrude(b);
    let e: THREE.BufferGeometry = new THREE.EdgesGeometry(g, 12);
    const id = indices ? indices[k] : 0;
    if (detail) {
      // acrotère : liseré intérieur du toit, à 0,5 m du bord (mêmes arêtes que le reste : même matériau, même nuanceur)
      const ac = acrotere(b);
      if (ac.length) {
        const pos = new Float32Array((ac.length / 4) * 6);
        for (let i = 0; i < ac.length; i += 4) pos.set([ac[i], b.h, ac[i + 1], ac[i + 2], b.h, ac[i + 3]], (i / 4) * 6);
        const lis = new THREE.BufferGeometry();
        lis.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const fus = mergeGeometries([e, lis], false);
        if (fus) { e.dispose(); lis.dispose(); e = fus; }
      }
    }
    let f: THREE.BufferGeometry;
    if (detail) {
      f = facesDetaillees(g, b, id, detail.portes[k] ?? null, detail.styles?.[k] ?? 0);
    } else {
      f = new THREE.BufferGeometry();
      f.setAttribute("position", g.getAttribute("position"));
      if (etat) f.setAttribute("aBat", new THREE.Float32BufferAttribute(new Float32Array(f.getAttribute("position").count).fill(id), 1));
    }
    // numéro du bâtiment (index de scene.json) sur chaque sommet : le nuanceur l'écrase selon l'état de destruction
    if (etat) e.setAttribute("aBat", new THREE.Float32BufferAttribute(new Float32Array(e.getAttribute("position").count).fill(id), 1));
    edges.push(e);
    faces.push(f);
    g.dispose();
  });
  const grp = new THREE.Group();
  const faceGeo = mergeGeometries(faces, false);
  const edgeGeo = mergeGeometries(edges, false);
  if (!faceGeo || !edgeGeo) return grp;
  const champ = style === "champ";
  const mesh = new THREE.Mesh(
    faceGeo,
    new THREE.MeshBasicMaterial({
      color: faceColor, transparent: style === "porte" || style === "barricade" ? false : true, opacity: style === "porte" || style === "barricade" ? 1 : faceOpacity,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
      ...(champ ? { depthWrite: false, side: THREE.DoubleSide } : {}),
    }),
  );
  mesh.renderOrder = champ ? 3 : 1;
  const bright = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: champ ? 0.5 : 0.95 }));
  bright.renderOrder = champ ? 4 : 2;
  const motif = style === "barricade" || style === "champ" ? style : undefined;
  if (etat || detail || motif) {
    brancherShader(mesh.material as THREE.Material, { etat, facade: !!detail, motif });
    if (etat) brancherShader(bright.material as THREE.Material, { etat });
  }
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
  /** `construireDecor` : groupe qui reçoit les bâtiments (vue aérienne : masqué dans l'aperçu des zombies et du BR). Défaut : la racine. */
  racineBatiments?: THREE.Object3D;
  /** Arêtes cachées en fantôme à travers les murs (vue aérienne : oui, défaut ; arène FPS : non). */
  fantomes?: boolean;
  /** Bâtiments effondrables (arène FPS) : état partagé, cf. `creerEtatDestruction`. */
  destruction?: EtatDestruction;
  /**
   * Bâtiments détaillés : étages, fenêtres, corniche, porte, équipements de toit (cf. facade.ts). Défaut : vrai quand `destruction`
   * est fourni (arène, zombies), faux sinon (vue aérienne, visuellement inchangée).
   */
  detail?: boolean;
  /** Ambiance du mode : "zombies" ne pose ni mobilier, ni haies, ni pelouses, ni arbustes dans la boîte des zombies (`exclure`). Défaut : "complete". */
  ambiance?: OptionsDerivation["ambiance"];
  /** "basse" (tactile, peu de cœurs) : sans taches de lumière, haies ni arbustes, façades simplifiées. Défaut : "haute". */
  qualite?: OptionsDerivation["qualite"];
  /** Boîtes où rien du décor secondaire n'est posé (carte des zombies). */
  exclure?: OptionsDerivation["exclure"];
  /** Positions à dégager de tout mobilier (cachettes du tigre). */
  eviter?: OptionsDerivation["eviter"];
}

/**
 * Destruction des bâtiments (arène, v3) : une texture de flottants d'une ligne, un texel par bâtiment (index de scene.json) :
 * R = avancement de l'effondrement complet (0 debout, 1 à terre), GBA = brèche (centre x, z et rayon en m ; rayon 0 = intacte).
 * Le nuanceur de sommets écrase la hauteur selon l'avancement ; le nuanceur de fragments découpe la brèche : vide dans le cercle, parois
 * en pente déchiquetée autour, liseré incandescent sur la cassure. Aucune géométrie à reconstruire, une lecture de texture par sommet.
 */
export interface EtatDestruction {
  texture: THREE.DataTexture;
  /** Avancement (0..1) du bâtiment `id` ; la texture n'est envoyée qu'au rendu suivant. */
  poser(id: number, avancement: number): void;
  /** (v8) Efface le bâtiment `id` sans gravats (porte ouverte des zombies) : il passe sous le sol ; `poser(id, 0)` le relève. */
  effacer(id: number): void;
  /** Brèche du bâtiment `id` (rayon 0 : aucune). */
  breche(id: number, x: number, z: number, r: number): void;
  dispose(): void;
}

/** Hauteur gardée par un bâtiment à terre (part de sa hauteur) : un tas de gravats. */
const RESTE_RUINE = 0.05;
/** Avancement réservé d'un bâtiment effacé (`effacer`) : le nuanceur le pose sous le sol. */
const EFFACE = 2;

export function creerEtatDestruction(n: number): EtatDestruction {
  const nb = Math.max(1, n);
  const data = new Float32Array(nb * 4);
  const texture = new THREE.DataTexture(data, nb, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return {
    texture,
    poser(id, avancement) {
      if (id < 0 || id >= nb) return;
      const v = Math.min(1, Math.max(0, avancement));
      if (data[id * 4] === v) return;
      data[id * 4] = v;
      texture.needsUpdate = true;
    },
    effacer(id) {
      if (id < 0 || id >= nb || data[id * 4] === EFFACE) return;
      data[id * 4] = EFFACE;
      texture.needsUpdate = true;
    },
    breche(id, x, z, r) {
      if (id < 0 || id >= nb) return;
      const k = id * 4;
      if (data[k + 1] === x && data[k + 2] === z && data[k + 3] === r) return;
      data[k + 1] = x; data[k + 2] = z; data[k + 3] = r;
      texture.needsUpdate = true;
    },
    dispose() { texture.dispose(); },
  };
}

/** Options du nuanceur des bâtiments (faces, arêtes, équipements de toit). */
interface OptionsShader {
  /** destruction : écrasement par `aBat` et brèches */
  etat?: EtatDestruction;
  /** façades : lit `aMur` / `aHaut` (faces détaillées de `facesDetaillees`) */
  facade?: boolean;
  /** matériau d'un InstancedMesh : l'écrasement se fait après la matrice d'instance */
  instance?: boolean;
  /** motif d'une pièce de la carte zombies */
  motif?: "barricade" | "champ";
}

/** Fonctions GLSL du hachage des fenêtres allumées (miroir de `fenetreAllumee` de facade.ts : mêmes constantes, produits modulo 2^32). */
const GLSL_HACHAGE = `uint hachageB(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
`;

/**
 * Façade d'un mur (étages, fenêtres, corniche, porte), insérée avant `opaque_fragment`. `vMondeB.y` est la hauteur NON écrasée :
 * le motif suit l'effondrement. Le détail s'estompe avec la distance (`fwidth`, relevé en tête de `main` : les dérivées restent
 * valides même quand un `discard` de brèche suit) pour éviter le moiré. Les teintes restent sous le seuil du bloom (0,24) sauf les
 * fenêtres allumées. Constantes recopiées de facade.ts.
 */
const GLSL_FACADE = `
if (vMur.z > 0.5) {
  float L = vMur.y;
  float u = vMur.x;
  float nE = floor(vMur.z + 0.5);
  float y = vMondeB.y;
  float hE = vHaut / nE;
  float fy = clamp(y / hE, 0.0, nE - 0.001);
  float et = floor(fy);
  float ty = (fy - et) * hE;
  float px = max(max(fwuB, fwyB), 0.002);
  float estompe = smoothstep(0.18, 0.5, px);
  float aa = px * 0.75;
  float restoF = vStyle > 7.5 ? 1.0 : 0.0;
  float sty = floor(vStyle - 8.0 * restoF + 0.5);
  uint teinteB = hachageB(uint(vBatF + 0.5) * 0x9e3779b1u ^ 0x1b873593u) % 3u;
  vec3 cy = (restoF > 0.5 || teinteB == 0u) ? vec3(0.33, 0.81, 1.0) : (teinteB == 1u ? vec3(0.30, 0.85, 0.74) : vec3(0.52, 0.68, 0.85));
  vec3 chaud = vec3(0.62, 0.38, 0.16);
  vec3 c0 = outgoingLight;
  vec3 moyen = c0 * 0.9 + cy * 0.025 + chaud * 0.04;
  float ddp = abs(u - 0.5 * L);
  bool murPorte = vMur.w > 0.5;
  float demiPorte = sty > 2.5 ? ${(INDUSTRIEL_PORTE_L_M / 2).toFixed(1)} : ${(PORTE_L_M / 2).toFixed(1)};
  float hautPorte = sty > 2.5 ? ${INDUSTRIEL_PORTE_H_M.toFixed(1)} : ${PORTE_H_M.toFixed(1)};
  // enseigne néon des restaurants : barre ambre au-dessus de la porte (visible de loin)
  float enseigne = 0.0;
  if (murPorte && restoF > 0.5) enseigne = 1.0 - smoothstep(-aa, aa, max(ddp - ${(ENSEIGNE_L_M / 2).toFixed(1)}, abs(y - ${ENSEIGNE_Y_M.toFixed(2)}) - ${(ENSEIGNE_H_M / 2).toFixed(2)}));
  float forme = 0.0;
  // de loin (détail estompé à plus de 99,5 %), la couleur moyenne suffit : on saute tout le calcul de façade
  if (estompe > 0.995) {
    outgoingLight = moyen;
  } else {
  float yh = vHaut - y;
  float socle = 1.0 - smoothstep(0.6 - aa, 0.6 + aa, y);
  float pil = 1.0 - smoothstep(0.45 - aa, 0.45 + aa, min(u, L - u));
  float plancher = et > 0.5 ? 1.0 - smoothstep(0.16 - aa, 0.16 + aa, ty) : 0.0;
  float corniche = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, yh);
  float levre = 1.0 - smoothstep(0.08 - aa, 0.08 + aa, yh);
  float xu = L - ${(2 * MARGE_COLONNE_M).toFixed(1)};
  float nCol = xu < ${FENETRE_L_M.toFixed(1)} ? 0.0 : max(1.0, floor(xu / ${PAS_COLONNE_M.toFixed(1)} + 0.5));
  float fen = 0.0;
  float verre = 0.0;
  float allumee = 0.0;
  float lumVerre = 1.0;
  float bardage = 0.0;
  float reflet = 0.0;
  float pasCol = nCol > 0.5 ? xu / nCol : 1.0;
  float col = nCol > 0.5 ? clamp(floor((u - ${MARGE_COLONNE_M.toFixed(1)}) / pasCol), 0.0, nCol - 1.0) : 0.0;
  uint cle = (uint(vBatF + 0.5) * 73856093u) ^ (uint(et) * 19349663u) ^ (uint(col) * 83492791u) ^ (uint(L * 8.0 + 0.5) * 2654435761u);
  uint hc = hachageB(cle) & 0xffffu;
  float wb = (hE - ${FENETRE_H_M.toFixed(1)}) * 0.55;
  if (sty < 0.5) {
    // façade percée : une fenêtre par colonne ; rez-de-chaussée vitré sur le mur de la porte (vitrine continue de part et d'autre)
    if (nCol > 0.5 && !(murPorte && et < 0.5)) {
      float du = abs(u - (${MARGE_COLONNE_M.toFixed(1)} + (col + 0.5) * pasCol));
      float dv = abs(ty - (wb + ${(FENETRE_H_M / 2).toFixed(1)}));
      float d = max(du - ${(FENETRE_L_M / 2).toFixed(2)}, dv - ${(FENETRE_H_M / 2).toFixed(1)});
      fen = (1.0 - smoothstep(-aa, aa, d)) * (1.0 - corniche);
      verre = (1.0 - smoothstep(-0.08 - aa, -0.08 + aa, d)) * (1.0 - corniche);
      allumee = hc < ${SEUIL_ALLUMEES}u ? 1.0 : 0.0;
    } else if (nCol > 0.5) {
      float uu = u - ${MARGE_COLONNE_M.toFixed(1)};
      float d = max(max(-uu, uu - xu), max(${VITRINE_BAS_M.toFixed(2)} - y, y - ${VITRINE_HAUT_M.toFixed(1)}));
      float meneau = 1.0 - smoothstep(0.05 - aa, 0.05 + aa, min(fract(uu / pasCol), 1.0 - fract(uu / pasCol)) * pasCol);
      fen = 1.0 - smoothstep(-aa, aa, d);
      verre = (1.0 - smoothstep(-0.08 - aa, -0.08 + aa, d)) * (1.0 - meneau);
      // allumée par travée (hachage par colonne, comme les étages), jamais en bande continue : sinon le bloom sature un aplat jaune
      // qui noie l'enseigne. Un peu plus de travées allumées chez un restaurant (50 % contre 40 %), mais pas toutes.
      allumee = hc < (restoF > 0.5 ? ${2 * SEUIL_ALLUMEES}u : ${Math.round(1.6 * SEUIL_ALLUMEES)}u) ? 1.0 : 0.0;
      // vitrine plus douce que les fenêtres d'étage (sous le seuil du bloom) : la lumière large du rez-de-chaussée ne doit pas écraser l'enseigne
      lumVerre = ${LUM_VITRINE.toFixed(2)};
    }
  } else if (sty < 1.5) {
    // bandeau : fenêtre continue par étage, meneaux tous les 3 m, allège pleine
    if (nCol > 0.5 && !(murPorte && et < 0.5 && ddp < ${(PORTE_L_M / 2 + 0.65).toFixed(2)})) {
      float uu = u - ${MARGE_COLONNE_M.toFixed(1)};
      float dv = abs(ty - (wb + ${(FENETRE_H_M / 2).toFixed(1)}));
      float d = max(max(-uu, uu - xu), dv - ${(FENETRE_H_M / 2).toFixed(1)});
      float meneau = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, min(fract(uu / pasCol), 1.0 - fract(uu / pasCol)) * pasCol);
      fen = (1.0 - smoothstep(-aa, aa, d)) * (1.0 - corniche);
      verre = (1.0 - smoothstep(-0.08 - aa, -0.08 + aa, d)) * (1.0 - corniche) * (1.0 - meneau);
      allumee = hc < ${SEUIL_ALLUMEES}u ? 1.0 : 0.0;
    }
  } else if (sty < 2.5) {
    // mur rideau : grille fine de meneaux (1,5 m × hauteur d'étage), verre sombre, reflet cyan en diagonale
    float uu = u - 0.4;
    float wC = L - 0.8;
    if (wC > 1.0 && !(murPorte && et < 0.5 && ddp < ${(PORTE_L_M / 2 + 0.65).toFixed(2)})) {
      float k = uu / ${MUR_RIDEAU_CELLULE_M.toFixed(1)};
      float dmu = min(fract(k), 1.0 - fract(k)) * ${MUR_RIDEAU_CELLULE_M.toFixed(1)};
      float dmv = min(ty, hE - ty);
      float cadre = max(1.0 - smoothstep(0.04 - aa, 0.04 + aa, dmu), 1.0 - smoothstep(0.1 - aa, 0.1 + aa, dmv));
      float dedans = (uu > 0.0 && uu < wC ? 1.0 : 0.0) * (1.0 - corniche) * (y > 0.6 ? 1.0 : 0.0);
      fen = dedans;
      verre = dedans * (1.0 - cadre);
      reflet = smoothstep(0.55, 1.0, sin((u + y) * 0.35));
      uint cleR = (uint(vBatF + 0.5) * 73856093u) ^ (uint(et) * 19349663u) ^ (uint(floor(k)) * 83492791u);
      allumee = (hachageB(cleR) & 0xffffu) < ${Math.round(SEUIL_ALLUMEES / 2)}u ? 1.0 : 0.0;
    }
  } else {
    // industriel : bardage vertical, quelques fenêtres hautes, porte sectionnelle de 4 m
    bardage = 1.0 - smoothstep(0.012 - aa, 0.012 + aa, min(fract(u / 0.6), 1.0 - fract(u / 0.6)) * 0.6);
    float dwin = max(abs(mod(u + 3.0, 6.0) - 3.0) - 1.4, abs(y - (vHaut - 1.7)) - 0.4);
    if (L > 8.0 && u > 1.5 && u < L - 1.5 && vHaut > 4.5) {
      fen = (1.0 - smoothstep(-aa, aa, dwin)) * (1.0 - corniche);
      verre = (1.0 - smoothstep(-0.08 - aa, -0.08 + aa, dwin)) * (1.0 - corniche);
      allumee = hc < ${SEUIL_ALLUMEES}u ? 1.0 : 0.0;
    }
  }
  float porte = 0.0;
  float interP = 0.0;
  if (murPorte) {
    float dP = max(ddp - demiPorte, y - hautPorte);
    porte = 1.0 - smoothstep(-aa, aa, dP);
    interP = 1.0 - smoothstep(-0.1 - aa, -0.1 + aa, dP);
  }
  vec3 c = mix(c0, c0 * 0.3, socle);
  c += cy * 0.03 * pil;
  c += cy * 0.06 * plancher;
  c += cy * 0.07 * corniche + cy * 0.2 * levre;
  c += cy * 0.05 * bardage;
  c = mix(c, vec3(0.002, 0.008, 0.014), verre);
  c += cy * 0.05 * reflet * verre * (1.0 - allumee);
  c = mix(c, chaud * lumVerre, verre * allumee);
  c += cy * 0.2 * (fen - verre) * (1.0 - 0.6 * allumee);
  c = mix(c, vec3(0.006, 0.02, 0.028), interP);
  c += cy * 0.28 * (porte - interP);
  outgoingLight = mix(c, moyen, estompe);
  forme = max(max(fen, porte), corniche * 0.6);
  }
  outgoingLight = mix(outgoingLight, vec3(1.0, 0.66, 0.28), enseigne * (1.0 - 0.5 * estompe));
  diffuseColor.a = mix(diffuseColor.a, 0.95, max(forme, enseigne) * (1.0 - estompe));
}
`;

/** Motifs des pièces de la carte zombies. */
const GLSL_MOTIF = {
  // bandes obliques ambre et sombres : « barrée »
  barricade: `
float bandeB = step(0.5, fract((vMondeB.x + vMondeB.z + vMondeB.y) * 0.8));
outgoingLight = mix(outgoingLight * 0.35, vec3(0.42, 0.22, 0.03), bandeB);
`,
  // champ d'énergie translucide : traits horizontaux tous les mètres
  champ: `
diffuseColor.a *= 0.6 + 0.8 * step(0.5, fract(vMondeB.y * 0.5));
`,
} as const;

/**
 * Branche sur un matériau de bâtiment (faces, arêtes ou équipements) : l'écrasement par la destruction, les brèches, le motif des
 * façades et celui des pièces de la carte zombies. Le programme est identifié par ses options (`customProgramCacheKey`).
 */
function brancherShader(mat: THREE.Material, o: OptionsShader): void {
  const etat = o.etat;
  const n = etat ? etat.texture.image.width : 0;
  mat.onBeforeCompile = (sh) => {
    if (etat) sh.uniforms.uDetruits = { value: etat.texture };
    // ---- sommets
    const declV = ["varying vec3 vMondeB;"];
    if (etat) declV.push("attribute float aBat;", "uniform sampler2D uDetruits;", "varying vec4 vBreche;");
    else if (o.facade) declV.push("attribute float aBat;");
    if (o.facade) declV.push("attribute vec4 aMur;", "attribute float aHaut;", "attribute float aStyle;", "varying vec4 vMur;", "varying float vHaut;", "varying float vBatF;", "varying float vStyle;");
    let debut = "#include <begin_vertex>\n";
    if (etat) debut += `vec4 etatB = texture2D(uDetruits, vec2((aBat + 0.5) / ${n.toFixed(1)}, 0.5));\nvBreche = etatB;\n`;
    debut += `vMondeB = (${o.instance ? "modelMatrix * instanceMatrix" : "modelMatrix"} * vec4(transformed, 1.0)).xyz;\n`;
    if (o.facade) debut += "vMur = aMur;\nvHaut = aHaut;\nvBatF = aBat;\nvStyle = aStyle;\n";
    // effacé (R > 1,5) : tout le bâtiment passe juste sous le sol, sans tas de gravats
    if (etat && !o.instance) debut += `transformed.y = etatB.r > 1.5 ? -0.05 : transformed.y * mix(1.0, ${RESTE_RUINE.toFixed(2)}, etatB.r);\n`;
    sh.vertexShader = `${declV.join("\n")}\n${sh.vertexShader}`.replace("#include <begin_vertex>", () => debut);
    if (etat && o.instance) {
      // l'instance pose le bâtiment sur son toit : l'écrasement s'applique au monde, après la matrice d'instance
      sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", () => `vec4 mvPosition = vec4(transformed, 1.0);
mvPosition = instanceMatrix * mvPosition;
mvPosition.y = etatB.r > 1.5 ? -0.05 : mvPosition.y * mix(1.0, ${RESTE_RUINE.toFixed(2)}, etatB.r);
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
    }
    // ---- fragments
    const declF = ["varying vec3 vMondeB;"];
    if (etat) declF.push("varying vec4 vBreche;");
    if (o.facade) declF.push("varying vec4 vMur;", "varying float vHaut;", "varying float vBatF;", "varying float vStyle;", GLSL_HACHAGE);
    let main = "void main() {\n";
    if (o.facade) main += "float fwuB = fwidth(vMur.x);\nfloat fwyB = fwidth(vMondeB.y);\n";
    if (etat) {
      // (v8) bâtiment effacé : rien n'est dessiné (une porte ouverte des zombies ne laisse ni seuil ni arête)
      main += `if (vBreche.x > 1.5) discard;
float bordB = 0.0;
if (vBreche.w > 0.0) {
  vec2 dB = vMondeB.xz - vBreche.yz;
  float aB = atan(dB.y, dB.x);
  // paroi en pente autour du vide, déchiquetée (bruit sur l'angle et la hauteur)
  float coupe = (length(dB) - vBreche.w) * 1.15 + 1.6 * sin(aB * 9.0 + vBreche.w) + 0.9 * sin(aB * 23.0 + vMondeB.y * 0.9);
  if (vMondeB.y > coupe) discard;
  bordB = 1.0 - smoothstep(0.0, 0.9, coupe - vMondeB.y);
}`;
    }
    let fin = "";
    if (o.facade) fin += GLSL_FACADE;
    if (o.motif) fin += GLSL_MOTIF[o.motif];
    fin += "#include <opaque_fragment>\n";
    if (etat) fin += "gl_FragColor = mix(gl_FragColor, vec4(1.0, 0.42, 0.12, 0.9), bordB * 0.85);";
    sh.fragmentShader = `${declF.join("\n")}\n${sh.fragmentShader}`
      .replace("void main() {", () => main)
      .replace("#include <opaque_fragment>", () => fin);
  };
  mat.customProgramCacheKey = () => `batiment-effondrable-5-${n}-${etat ? "d" : "-"}${o.facade ? "f" : "-"}${o.instance ? "i" : "-"}${o.motif ?? "-"}`;
}

/** Équipements de toit : une boîte unitaire instanciée (clim, édicules, antennes) et ses arêtes, un tirage par bâtiment. */
function ajouterEquipementsToit(scene: THREE.Object3D, data: SceneData, etat?: EtatDestruction): void {
  const liste: { id: number; h: number; e: ReturnType<typeof placementsToit>[number] }[] = [];
  data.buildings.forEach((b, id) => {
    if (b.type && b.type !== "mur") return;
    for (const e of placementsToit(b, id)) liste.push({ id, h: b.h, e });
    // panneaux solaires : tirage à part, ajouté en fin de liste (les positions de `placementsToit` ne bougent pas)
    for (const e of placementsSolaires(b, id)) liste.push({ id, h: b.h, e });
  });
  if (!liste.length) return;
  const n = liste.length;
  const boite = new THREE.BoxGeometry(1, 1, 1);
  boite.translate(0, 0.5, 0);
  const ids = new Float32Array(n);
  const matrices: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), qi = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), axe = new THREE.Vector3(0, 1, 0), axeX = new THREE.Vector3(1, 0, 0);
  liste.forEach(({ id, h, e }, i) => {
    q.setFromAxisAngle(axe, e.rot);
    // un panneau solaire est incliné (son bord bas reste sur le toit)
    if (e.incl) q.multiply(qi.setFromAxisAngle(axeX, e.incl));
    matrices.push(new THREE.Matrix4().compose(p.set(e.x, h + (e.incl ? 0.4 : 0), e.z), q, sc.set(e.sx, e.sy, e.sz)));
    ids[i] = id;
  });
  if (etat) boite.setAttribute("aBat", new THREE.InstancedBufferAttribute(ids, 1));
  const mesh = new THREE.InstancedMesh(boite, new THREE.MeshBasicMaterial({ color: 0x0b1820, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }), n);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = 1;
  // arêtes : les 12 arêtes de chaque boîte, posées en coordonnées du monde (même nuanceur que les arêtes des bâtiments)
  const coins: THREE.Vector3[] = [];
  for (let k = 0; k < 8; k++) coins.push(new THREE.Vector3((k & 1 ? 0.5 : -0.5), (k & 2 ? 1 : 0), (k & 4 ? 0.5 : -0.5)));
  const paires = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const pos = new Float32Array(n * paires.length * 6);
  const aBat = new Float32Array(n * paires.length * 2);
  const v = new THREE.Vector3();
  let o = 0, ob = 0;
  matrices.forEach((m, i) => {
    for (const [a, b] of paires) {
      v.copy(coins[a]).applyMatrix4(m); pos[o++] = v.x; pos[o++] = v.y; pos[o++] = v.z;
      v.copy(coins[b]).applyMatrix4(m); pos[o++] = v.x; pos[o++] = v.y; pos[o++] = v.z;
      aBat[ob++] = ids[i]; aBat[ob++] = ids[i];
    }
  });
  const gl = new THREE.BufferGeometry();
  gl.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (etat) gl.setAttribute("aBat", new THREE.BufferAttribute(aBat, 1));
  const aretes = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.55 }));
  aretes.renderOrder = 2;
  if (etat) {
    brancherShader(mesh.material as THREE.Material, { etat, instance: true });
    brancherShader(aretes.material as THREE.Material, { etat });
  }
  scene.add(mesh, aretes);
}

/** Types de pièces de la carte zombies v7 dessinés par le rendu des intérieurs (`lib/fps/rendu-interieurs.ts`), jamais par le décor. */
const SANS_DECOR: ReadonlySet<string> = new Set(["fenetre", "coque", "cloison", "meuble", "creux"]);

/** Bâtiments ordinaires (cyan), base (blanc), restaurants (ambre) et pièces de la carte zombies (ambre, par style). */
export function ajouterBatiments(scene: THREE.Object3D, data: SceneData, opts: OptionsDecor = {}): void {
  const fantomes = opts.fantomes !== false;
  const detail = opts.detail ?? opts.destruction !== undefined;
  const special = new Map<number, Poi["type"]>();
  for (const p of data.pois) if (p.type === "home" || p.type === "resto") special.set(p.b, p.type);
  const stylePiece = (i: number): StylePiece | undefined => {
    const t = data.buildings[i].type;
    return t === "porte" || t === "barricade" || t === "champ" ? t : undefined;
  };
  const groupe = (garder: (i: number) => boolean, arete: number, face: number, opacite: number, fantome: number, style?: StylePiece) => {
    const indices = data.buildings.map((_, i) => i).filter((i) => !SANS_DECOR.has(data.buildings[i].type ?? "") && garder(i));
    if (style && !indices.length) return;
    const liste = indices.map((i) => data.buildings[i]);
    scene.add(buildingGroup(liste, arete, face, opacite, fantomes ? fantome : 0, {
      indices, etat: opts.destruction, style,
      detail: detail && !style ? { portes: liste.map((b) => murDePorte(b, data.roads)), styles: indices.map((i, k) => codeFacade(liste[k], i, special.get(i), opts.qualite === "basse")) } : undefined,
    }));
  };
  groupe((i) => !special.has(i) && !stylePiece(i), C.cyan, 0x05080c, 0.82, 0.16);
  groupe((i) => special.get(i) === "home", C.white, 0x0c141a, 0.9, 0.35);
  groupe((i) => special.get(i) === "resto", C.amber, 0x120e08, 0.9, 0.3);
  groupe((i) => stylePiece(i) === "porte", C.amber, 0x8a5a1c, 1, 0.3, "porte");
  groupe((i) => stylePiece(i) === "barricade", C.amber, 0x2a1a08, 1, 0.3, "barricade");
  groupe((i) => stylePiece(i) === "champ", C.amber, C.amber, 0.16, 0, "champ");
  if (detail) ajouterEquipementsToit(scene, data, opts.destruction);
}

/**
 * Voirie, parkings, eau : un seul LineSegments à couleurs par sommet. Avec `derive` (rework de la DA), les voies M et R perdent leur trait
 * d'axe plein au profit des bords, des trottoirs et de l'axe pointillé (cf. voirie.ts) ; R et S gardent un trait fin.
 */
export function ajouterReseauSol(scene: THREE.Object3D, data: SceneData, derive?: DecorDerive): void {
  const pos: number[] = [], col: number[] = [];
  const push = (pts: readonly Vec2[], y: number, hex: number, k = 1) => {
    const c = new THREE.Color(hex).multiplyScalar(k);
    for (let i = 0; i < pts.length - 1; i++) {
      pos.push(pts[i][0], y, pts[i][1], pts[i + 1][0], y, pts[i + 1][1]);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  };
  const roadColor = { M: C.roadM, R: C.roadR, S: C.roadS, F: C.roadF };
  for (const r of data.roads) {
    if (derive && r.c === "M") continue;
    push(r.p, 0.4, roadColor[r.c] ?? C.roadS, derive && r.c === "R" ? 0.4 : 1);
  }
  for (const p of data.parkings) push([...p, p[0]], 0.25, C.park);
  for (const w of data.water) push([...w, w[0]], 0.2, C.water);
  for (const w of data.wlines) push(w, 0.2, C.water);
  if (derive) {
    for (const { seg, y, hex, k } of segmentsVoirie(derive.voirie, C)) {
      const c = new THREE.Color(hex).multiplyScalar(k);
      for (let i = 0; i < seg.length; i += 4) {
        pos.push(seg[i], y, seg[i + 1], seg[i + 2], y, seg[i + 3]);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const reseau = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
  reseau.userData.couche = "reseau";
  scene.add(reseau);
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

/** Qualité du décor selon l'appareil : "basse" au tactile ou avec 4 cœurs ou moins (cf. spec D7). */
export function qualiteParDefaut(): "haute" | "basse" {
  const grossier = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const coeurs = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  return grossier || (coeurs !== undefined && coeurs <= 4) ? "basse" : "haute";
}

/**
 * Tout le décor fixe, dans l'ordre de la vue aérienne : bâtiments, chaussée, réseau au sol, marquages, grille, arbres. Les données dérivées
 * (`deriverDecor`) sont calculées une fois (déterministes, mémoïsées par `data.roads`).
 */
export function construireDecor(scene: THREE.Object3D, data: SceneData, opts: OptionsDecor = {}): void {
  ajouterBatiments(opts.racineBatiments ?? scene, data, opts);
  const derive = deriverDecor(data, opts);
  ajouterChaussees(scene, derive.voirie, C.chaussee);
  ajouterReseauSol(scene, data, derive);
  ajouterPlacesParking(scene, derive.places, C.parkPlace);
  ajouterMarquages(scene, derive.voirie, C.marquage);
  ajouterGrille(scene);
  ajouterPelouses(scene, derive.pelouses, C.pelouse);
  ajouterHaies(scene, derive.haies, C.haie);
  ajouterVegetation(scene, derive.arbres, derive.arbustes, C);
  ajouterMobilier(scene, derive.mobilier, C, opts.qualite !== "basse" && opts.ambiance !== "zombies");
}

/** Avion filaire de la vue aérienne (fuselage, aile, queue, dérive et deux feux de position), partagé avec l'aperçu du Battle Royale. */
export interface AvionFilaire { groupe: THREE.Group; navLight: THREE.Mesh; wingLight: THREE.Mesh }
export function creerAvionFilaire(): AvionFilaire {
  const groupe = new THREE.Group();
  const fus = new THREE.CylinderGeometry(1.4, 1.1, 26, 6); fus.rotateZ(Math.PI / 2);
  groupe.add(edgesOf(fus, C.white));
  groupe.add(edgesOf(new THREE.BoxGeometry(5, 0.4, 30), C.white));
  const tail = edgesOf(new THREE.BoxGeometry(3, 0.3, 10), C.white); tail.position.set(-11, 1, 0); groupe.add(tail);
  const fin = edgesOf(new THREE.BoxGeometry(4, 6, 0.3), C.white); fin.position.set(-11.5, 3.5, 0); groupe.add(fin);
  const navLight = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5a4a })); navLight.position.set(0, -1.6, 0); groupe.add(navLight);
  const wingLight = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), new THREE.MeshBasicMaterial({ color: 0xbfffd0 })); wingLight.position.set(1, 0, 15); groupe.add(wingLight);
  return { groupe, navLight, wingLight };
}
