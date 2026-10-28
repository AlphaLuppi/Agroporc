/**
 * Rendu des intérieurs de la carte zombies v7 (three) : les quatre bâtiments creusés (72, 70, 62, 74) et leurs pièces `coque` / `cloison`
 * / `meuble` / `fenetre`, que le décor ne dessine pas. Murs en boîtes à deux faces (façade sombre à arêtes cyan dehors, enduit dedans avec
 * plinthe et cimaise), linteaux au-dessus des portes et des fenêtres, allèges sous les fenêtres, sol carrelé, faux plafond à dalles
 * lumineuses à `PLAFOND_M`, toit à la hauteur du bâtiment, mobilier par genre. Éclairage : secours rouge qui pulse tant que le courant est
 * coupé, lumière chaude une fois le disjoncteur réarmé (`majCourant`). Les portes payantes restent au décor (elles s'effondrent avec lui).
 * Aucun test vitest (three) : la géométrie vient de `zombies-carte.ts` (testée), les régressions se voient aux captures.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Carte « Service de midi » »)
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { shapeFrom } from "../agroparc3d/decor";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { BATIMENTS_CREUX, HAUTEUR_PLAFOND_ZOMBIES, HAUTEUR_PORTE_INTERIEURE, batimentDePiece, plafondZombies, type GenreMeuble, type PieceSynth } from "./zombies-carte";

/** Hauteur du faux plafond (m, solide aussi pour la tête du joueur : `construireMondeZombies`) et des fenêtres (allège, linteau). */
export const PLAFOND_M = HAUTEUR_PLAFOND_ZOMBIES;
export const FENETRE_BAS_M = 0.9;
export const FENETRE_HAUT_M = 2.3;

const C_FACADE = new THREE.Color(0x05080c);
const C_ENDUIT = new THREE.Color(0x1c2129);
const C_PLINTHE = new THREE.Color(0x2c333d);
const C_DESSUS = new THREE.Color(0x0a0d12);
const C_ARETES = 0x9be9ff;
const C_SECOURS = new THREE.Color(0xff2a1a);
const C_LUMIERE = new THREE.Color(0xffe3b0);

export interface RenduInterieurs {
  /** courant rétabli : passage progressif (≈ 1,5 s) du secours rouge à la lumière */
  majCourant(on: boolean): void;
  /** `t` : horloge (s), `dt` : pas (s) */
  maj(t: number, dt: number): void;
  dispose(): void;
}

/** Boîte orientée du rectangle d'une pièce, de `y0` à `y1`, à couleurs par face (intérieur si la face regarde `centre`). */
function boitePiece(p: PieceSynth, y0: number, y1: number, centre: Vec2 | null, pos: number[], col: number[]): void {
  const r = batimentDePiece(p).r;
  const faces: [number, number, number, number][] = [];
  const v = (i: number, y: number): [number, number, number] => [r[i][0], y, r[i][1]];
  const quad = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], couleur: THREE.Color) => {
    for (const q of [a, b, c, a, c, d]) { pos.push(q[0], q[1], q[2]); col.push(couleur.r, couleur.g, couleur.b); }
  };
  // côtés : i → i+1
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mx = (r[i][0] + r[j][0]) / 2, mz = (r[i][1] + r[j][1]) / 2;
    // normale sortante du rectangle
    const cx = (r[0][0] + r[2][0]) / 2, cz = (r[0][1] + r[2][1]) / 2;
    const nx = mx - cx, nz = mz - cz;
    const interieur = p.type === "cloison" || p.type === "meuble" || (centre !== null && (centre[0] - mx) * nx + (centre[1] - mz) * nz > 0);
    const c = interieur ? (p.type === "meuble" ? C_PLINTHE : C_ENDUIT) : C_FACADE;
    quad(v(i, y0), v(j, y0), v(j, y1), v(i, y1), c);
    faces.push([i, j, 0, 0]);
  }
  quad(v(0, y1), v(1, y1), v(2, y1), v(3, y1), C_DESSUS);
}

/** Géométrie à couleurs par sommet, faces visibles des deux côtés (l'ordre des sommets varie selon l'anneau). */
function geometrie(pos: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Mobilier : boîtes simples par genre, dans le repère du rectangle (u le long, v en travers), ajoutées en coordonnées de la carte. */
function meuble(p: PieceSynth, pos: number[], col: number[], led: number[]): void {
  const [px, pz] = p.p, [qx, qz] = p.q;
  const L = Math.hypot(qx - px, qz - pz) || 1;
  const ux = (qx - px) / L, uz = (qz - pz) / L, vx = -uz, vz = ux;
  const cx = (px + qx) / 2, cz = (pz + qz) / 2;
  const l = p.demi * 2;
  const b = (u0: number, u1: number, w0: number, w1: number, y0: number, y1: number, c: THREE.Color) => {
    const k = (u: number, w: number): Vec2 => [cx + ux * u + vx * w, cz + uz * u + vz * w];
    const coins = [k(u0, w0), k(u1, w0), k(u1, w1), k(u0, w1)];
    const quad = (a: number[], bb: number[], cc: number[], d: number[]) => { for (const q of [a, bb, cc, a, cc, d]) { pos.push(q[0], q[1], q[2]); col.push(c.r, c.g, c.b); } };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad([coins[i][0], y0, coins[i][1]], [coins[j][0], y0, coins[j][1]], [coins[j][0], y1, coins[j][1]], [coins[i][0], y1, coins[i][1]]);
    }
    quad([coins[0][0], y1, coins[0][1]], [coins[1][0], y1, coins[1][1]], [coins[2][0], y1, coins[2][1]], [coins[3][0], y1, coins[3][1]]);
  };
  const h = p.h;
  const bois = new THREE.Color(0x3a2a1c), metal = new THREE.Color(0x2a313a), sombre = new THREE.Color(0x12161c), tissu = new THREE.Color(0x3a2230);
  const ledAt = (u: number, w: number, y: number, c: THREE.Color) => led.push(cx + ux * u + vx * w, y, cz + uz * u + vz * w, c.r, c.g, c.b);
  switch (p.genre as GenreMeuble) {
    case "bureau":
      b(-L / 2, L / 2, -l / 2, l / 2, h - 0.05, h, bois);
      for (const su of [-1, 1]) for (const sw of [-1, 1]) b(su * L / 2 - su * 0.08 - 0.03, su * L / 2 - su * 0.08 + 0.03, sw * l / 2 - sw * 0.08 - 0.03, sw * l / 2 - sw * 0.08 + 0.03, 0, h - 0.05, metal);
      // deux écrans de part et d'autre de la séparation
      for (const u of [-L / 4, L / 4]) for (const w of [-l / 4, l / 4]) { b(u - 0.28, u + 0.28, w - 0.02, w + 0.02, h + 0.12, h + 0.46, sombre); ledAt(u, w, h + 0.3, new THREE.Color(0x3fd0ff)); }
      b(-L / 2, L / 2, -0.02, 0.02, h, h + 0.4, metal);
      break;
    case "table":
      b(-L / 2, L / 2, -l / 2, l / 2, h - 0.04, h, bois);
      b(-0.06, 0.06, -0.06, 0.06, 0, h - 0.04, metal);
      for (const u of [-L / 2 - 0.35, L / 2 + 0.35]) b(u - 0.2, u + 0.2, -0.2, 0.2, 0, 0.45, tissu);
      break;
    case "canape":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, 0.42, tissu);
      b(-L / 2, L / 2, l / 2 - 0.18, l / 2, 0.42, h, tissu);
      break;
    case "comptoir":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h - 0.05, metal);
      b(-L / 2 - 0.03, L / 2 + 0.03, -l / 2 - 0.03, l / 2 + 0.03, h - 0.05, h, new THREE.Color(0x46505c));
      break;
    case "piano":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h, metal);
      for (let k = 0; k < 4; k++) { const u = -L / 2 + (k + 0.5) * (L / 4); ledAt(u, 0, h + 0.02, new THREE.Color(0xff6a2a)); }
      break;
    case "etagere":
      for (const y of [0, 0.6, 1.2, h - 0.04]) b(-L / 2, L / 2, -l / 2, l / 2, y, y + 0.04, bois);
      for (const su of [-1, 1]) b(su * L / 2 - 0.03, su * L / 2 + 0.03, -l / 2, l / 2, 0, h, bois);
      break;
    case "rack":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h, sombre);
      for (let k = 0; k < 6; k++) ledAt(-L / 2 + 0.2 + (k % 3) * 0.3, l / 2 + 0.01, 0.4 + Math.floor(k / 3) * 0.9, new THREE.Color(k % 2 ? 0x3fff7a : 0xffb35c));
      break;
    case "paillasse":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h - 0.05, new THREE.Color(0x1f2a2a));
      b(-L / 2, L / 2, -l / 2, l / 2, h - 0.05, h, new THREE.Color(0x3a4a4a));
      for (const u of [-L / 3, 0, L / 3]) { b(u - 0.06, u + 0.06, -0.06, 0.06, h, h + 0.25, new THREE.Color(0x2a4a5a)); ledAt(u, 0, h + 0.2, new THREE.Color(0x5dff6a)); }
      break;
    case "cuve":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h, new THREE.Color(0x1a2836));
      ledAt(0, l / 2 + 0.01, h * 0.6, new THREE.Color(0x7fd8ff));
      break;
  }
}

export function creerRenduInterieurs(scene: THREE.Scene, data: SceneData, pieces: readonly PieceSynth[]): RenduInterieurs {
  const racine = new THREE.Group();
  racine.name = "interieurs";
  scene.add(racine);
  const aDisposer: { dispose(): void }[] = [];

  // ---- murs, linteaux, allèges, mobilier ----
  const pos: number[] = [], col: number[] = [];
  const posM: number[] = [], colM: number[] = [], leds: number[] = [];
  const centres = new Map<number, Vec2>();
  for (const b of BATIMENTS_CREUX) centres.set(b, data.buildings[b].c);
  for (const p of pieces) {
    if (p.batiment === undefined) continue;
    const h = data.buildings[p.batiment]?.h ?? p.h;
    const centre = centres.get(p.batiment) ?? null;
    if (p.type === "coque" || p.type === "cloison") boitePiece(p, 0, h, centre, pos, col);
    else if (p.type === "porte") boitePiece({ ...p, type: p.type }, HAUTEUR_PORTE_INTERIEURE, h, centre, pos, col);
    else if (p.type === "fenetre") { boitePiece(p, 0, FENETRE_BAS_M, centre, pos, col); boitePiece(p, FENETRE_HAUT_M, h, centre, pos, col); }
    else if (p.type === "meuble") meuble(p, posM, colM, leds);
  }
  const geoMurs = geometrie(pos, col);
  const matMurs = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  const uLumiere = { value: 0 };
  const uSecours = { value: 1 };
  // plinthe et cimaise sur l'enduit, lueur du plafond qui descend sur les murs (rouge de secours ou chaude)
  matMurs.onBeforeCompile = (sh) => {
    sh.uniforms.uLumiere = uLumiere;
    sh.uniforms.uSecours = uSecours;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeI;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMondeI = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeI;\nuniform float uLumiere;\nuniform float uSecours;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float enduit = step(0.06, diffuseColor.r);
        float y = vMondeI.y;
        float plinthe = 1.0 - smoothstep(0.1, 0.14, y);
        float cimaise = 1.0 - smoothstep(0.0, 0.025, abs(y - 1.05));
        float haut = smoothstep(1.2, ${PLAFOND_M.toFixed(2)}, y) * step(y, ${PLAFOND_M.toFixed(2)});
        vec3 lueur = mix(vec3(0.55, 0.05, 0.03) * uSecours, vec3(0.35, 0.3, 0.22), uLumiere);
        diffuseColor.rgb += enduit * (plinthe * 0.08 + cimaise * 0.12 + haut * 0.18) * vec3(0.6, 0.85, 1.0) * (0.4 + 0.6 * uLumiere);
        diffuseColor.rgb += enduit * lueur * (0.08 + 0.12 * haut);
      `);
  };
  matMurs.customProgramCacheKey = () => "pdj-interieurs-murs";
  const murs = new THREE.Mesh(geoMurs, matMurs);
  racine.add(murs);
  const aretes = new THREE.LineSegments(new THREE.EdgesGeometry(geoMurs, 20), new THREE.LineBasicMaterial({ color: C_ARETES, transparent: true, opacity: 0.32 }));
  racine.add(aretes);
  aDisposer.push(geoMurs, matMurs, aretes.geometry, aretes.material as THREE.Material);

  if (posM.length) {
    const geoMeubles = geometrie(posM, colM);
    const matMeubles = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    racine.add(new THREE.Mesh(geoMeubles, matMeubles));
    const aretesM = new THREE.LineSegments(new THREE.EdgesGeometry(geoMeubles, 20), new THREE.LineBasicMaterial({ color: 0xffd59a, transparent: true, opacity: 0.35 }));
    racine.add(aretesM);
    aDisposer.push(geoMeubles, matMeubles, aretesM.geometry, aretesM.material as THREE.Material);
  }
  // voyants des meubles (écrans, LED, brûleurs) : petits points lumineux, au-dessus du seuil du halo
  const nLed = leds.length / 6;
  if (nLed) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(nLed * 3), c = new Float32Array(nLed * 3);
    for (let i = 0; i < nLed; i++) { p.set(leds.slice(i * 6, i * 6 + 3), i * 3); c.set(leds.slice(i * 6 + 3, i * 6 + 6), i * 3); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const m = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    racine.add(new THREE.Points(g, m));
    aDisposer.push(g, m);
  }

  // ---- sols, plafonds, toits ----
  const uSol = { value: 0 };
  const geoSols: THREE.BufferGeometry[] = [], geoPlafonds: THREE.BufferGeometry[] = [], geoToits: THREE.BufferGeometry[] = [];
  for (const b of BATIMENTS_CREUX) {
    const bat = data.buildings[b];
    const forme = shapeFrom(bat.r, bat.holes);
    const sol = new THREE.ShapeGeometry(forme);
    sol.rotateX(-Math.PI / 2);
    sol.translate(0, 0.012, 0);
    geoSols.push(sol);
    const plafond = new THREE.ShapeGeometry(forme);
    plafond.rotateX(-Math.PI / 2);
    plafond.translate(0, plafondZombies(bat.h), 0);
    geoPlafonds.push(plafond);
    const toit = new THREE.ShapeGeometry(forme);
    toit.rotateX(-Math.PI / 2);
    toit.translate(0, bat.h, 0);
    geoToits.push(toit);
  }
  const fusion = (l: THREE.BufferGeometry[]) => { const g = mergeGeometries(l, false)!; for (const x of l) x.dispose(); aDisposer.push(g); return g; };
  const gSol = fusion(geoSols), gPlafond = fusion(geoPlafonds), gToit = fusion(geoToits);

  const matSol = new THREE.MeshBasicMaterial({ color: 0x0d1116, side: THREE.DoubleSide });
  matSol.onBeforeCompile = (sh) => {
    sh.uniforms.uLumiere = uSol;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeS;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMondeS = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeS;\nuniform float uLumiere;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec2 c = abs(fract(vMondeS.xz / 0.6) - 0.5);
        float joint = 1.0 - smoothstep(0.46, 0.49, max(c.x, c.y));
        vec2 dam = floor(vMondeS.xz / 0.6);
        float case_ = mod(dam.x + dam.y, 2.0);
        diffuseColor.rgb += vec3(0.02, 0.025, 0.03) * case_ * (0.6 + 0.8 * uLumiere);
        diffuseColor.rgb += (1.0 - joint) * vec3(0.05, 0.08, 0.1) * (0.5 + 0.5 * uLumiere);
      `);
  };
  matSol.customProgramCacheKey = () => "pdj-interieurs-sol";
  racine.add(new THREE.Mesh(gSol, matSol));

  // faux plafond : dalles de 0,6 m, une dalle lumineuse sur cinq ; lumière de secours rouge qui pulse tant que le courant est coupé
  const uPulse = { value: 0 };
  const matPlafond = new THREE.MeshBasicMaterial({ color: 0x0b0e12, side: THREE.DoubleSide });
  matPlafond.onBeforeCompile = (sh) => {
    sh.uniforms.uLumiere = uLumiere;
    sh.uniforms.uSecours = uSecours;
    sh.uniforms.uPulse = uPulse;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMondeP = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeP;\nuniform float uLumiere;\nuniform float uSecours;\nuniform float uPulse;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec2 g = vMondeP.xz / 0.6;
        vec2 c = abs(fract(g) - 0.5);
        float joint = 1.0 - smoothstep(0.45, 0.48, max(c.x, c.y));
        vec2 dalle = floor(g);
        float lum = step(0.5, fract(sin(dot(dalle, vec2(12.9898, 78.233))) * 43758.5453)) * step(mod(dalle.x + 2.0 * dalle.y, 5.0), 0.5);
        vec3 chaud = vec3(1.0, 0.92, 0.75) * 1.15;
        vec3 rouge = vec3(0.9, 0.08, 0.04) * (0.35 + 0.65 * uPulse) * uSecours;
        diffuseColor.rgb += (1.0 - joint) * 0.03;
        diffuseColor.rgb += lum * joint * mix(rouge * 0.6, chaud, uLumiere);
      `);
  };
  matPlafond.customProgramCacheKey = () => "pdj-interieurs-plafond";
  racine.add(new THREE.Mesh(gPlafond, matPlafond));

  const matToit = new THREE.MeshBasicMaterial({ color: C_FACADE, side: THREE.DoubleSide });
  racine.add(new THREE.Mesh(gToit, matToit));
  const aretesToit = new THREE.LineSegments(new THREE.EdgesGeometry(gToit, 20), new THREE.LineBasicMaterial({ color: C_ARETES, transparent: true, opacity: 0.55 }));
  racine.add(aretesToit);
  aDisposer.push(matSol, matPlafond, matToit, aretesToit.geometry, aretesToit.material as THREE.Material);

  // ---- éclairage ----
  let courant = false;
  let lumiere = 0;
  return {
    majCourant(on) { courant = on; },
    maj(t, dt) {
      const cible = courant ? 1 : 0;
      // le courant revient en clignotant (néons qui s'amorcent), puis tient
      lumiere += (cible - lumiere) * (1 - Math.exp(-dt * 2.2));
      const scintille = courant && lumiere < 0.92 ? (Math.sin(t * 47) > 0.2 ? 1 : 0.35) : 1;
      uLumiere.value = lumiere * scintille;
      uSecours.value = 1 - lumiere;
      uPulse.value = 0.5 + 0.5 * Math.sin(t * 3.1);
      uSol.value = lumiere;
      void C_SECOURS; void C_LUMIERE;
    },
    dispose() {
      scene.remove(racine);
      for (const x of aDisposer) x.dispose();
      aDisposer.length = 0;
    },
  };
}
