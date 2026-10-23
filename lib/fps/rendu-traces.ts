/**
 * Traces de pneus au sol (three, v3) : quand une voiture ou le Truck Muche fou dérape, ses roues arrière laissent deux traînées. Chaque
 * véhicule glissant pose des segments de gomme entre deux positions successives de ses roues. Optimisé : UN seul `InstancedMesh` (un
 * appel de dessin) de `CAPACITE` segments en anneau, qui assombrissent le sol (mélange multiplicatif : visibles quelle que soit sa teinte)
 * puis s'effacent en `DUREE_S` (couleurs mises à jour 2 fois par seconde).
 * La détection du dérapage est pure (`glissementLateral`, testée) : vitesse perpendiculaire au cap, mesurée sur les positions.
 */
import * as THREE from "three";
import type { Vec3 } from "./protocole";

const CAPACITE = 700;
const DUREE_S = 25;
const LARGEUR_M = 0.3;
/** Un segment n'est posé qu'après ce déplacement de la roue (m) : peu de segments, même à 60 images/s. */
const PAS_MIN_M = 0.6;
/** Au-delà de ce saut (m) entre deux images, la traînée est coupée (téléportation, nouvelle voiture). */
const SAUT_MAX_M = 6;
const PERIODE_COULEURS_S = 0.5;
/** Assombrissement du sol par la gomme (mélange multiplicatif : 1 = rien), qui s'efface jusqu'à 1. */
const GOMME = 0.22;

/**
 * Glissement latéral (m/s) d'un véhicule de cap `cap` (convention lacet : avant = (−sin, −cos), droite = (cos, −sin)) qui s'est déplacé
 * de (dx, dz) pendant `dt` : la composante de sa vitesse perpendiculaire à son axe.
 */
export function glissementLateral(cap: number, dx: number, dz: number, dt: number): number {
  if (!(dt > 0)) return 0;
  return Math.abs((dx * Math.cos(cap) - dz * Math.sin(cap)) / dt);
}

/** Positions (xz) des deux roues arrière d'un véhicule : `demiVoie` de part et d'autre de l'axe, `recul` m derrière le centre. */
export function rouesArriere(p: Vec3, cap: number, demiVoie: number, recul: number): [[number, number], [number, number]] {
  const fx = -Math.sin(cap), fz = -Math.cos(cap), rx = Math.cos(cap), rz = -Math.sin(cap);
  const bx = p[0] - fx * recul, bz = p[2] - fz * recul;
  return [[bx - rx * demiVoie, bz - rz * demiVoie], [bx + rx * demiVoie, bz + rz * demiVoie]];
}

export interface TracesPneus {
  /**
   * Une image d'un véhicule `cle` : s'il `glisse`, ses roues arrière laissent un segment depuis leur dernière position (au-delà de
   * `PAS_MIN_M`). Appelé à chaque image pour chaque véhicule suivi ; `glisse` faux coupe la traînée.
   */
  roues(cle: string, roues: [[number, number], [number, number]], glisse: boolean): void;
  maj(dt: number): void;
  /** Segments posés encore visibles (essais). */
  nombre(): number;
  vider(): void;
  dispose(): void;
}

export function creerTracesPneus(scene: THREE.Scene): TracesPneus {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    // résultat = sol × couleur de la trace
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, CAPACITE);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const couleurs = new Float32Array(CAPACITE * 3);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(couleurs, 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const ages = new Float32Array(CAPACITE).fill(Infinity);
  let prochain = 0;
  let acc = 0;
  /** dernière position posée de chaque roue (null : traînée coupée) */
  const dernieres = new Map<string, [[number, number], [number, number]] | null>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), ech = new THREE.Vector3(), axeY = new THREE.Vector3(0, 1, 0);
  const nul = new THREE.Matrix4().makeScale(0, 0, 0);

  const colorer = (i: number) => {
    const k = Math.min(1, ages[i] / DUREE_S);
    const v = GOMME + (1 - GOMME) * k * k;
    couleurs[i * 3] = v; couleurs[i * 3 + 1] = v; couleurs[i * 3 + 2] = v;
  };
  const segment = (x0: number, z0: number, x1: number, z1: number) => {
    const i = prochain;
    prochain = (prochain + 1) % CAPACITE;
    const dx = x1 - x0, dz = z1 - z0;
    pos.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2);
    q.setFromAxisAngle(axeY, Math.atan2(-dz, dx));
    ech.set(Math.hypot(dx, dz) + 0.05, 1, LARGEUR_M);
    m4.compose(pos, q, ech);
    mesh.setMatrixAt(i, m4);
    ages[i] = 0;
    colorer(i);
    mesh.count = Math.max(mesh.count, i + 1);
  };

  return {
    roues(cle, roues, glisse) {
      const avant = dernieres.get(cle) ?? null;
      if (!glisse) { if (avant !== null) dernieres.set(cle, null); return; }
      if (!avant) { dernieres.set(cle, [[roues[0][0], roues[0][1]], [roues[1][0], roues[1][1]]]); return; }
      const d = Math.hypot(roues[0][0] - avant[0][0], roues[0][1] - avant[0][1]);
      if (d > SAUT_MAX_M) { dernieres.set(cle, [[roues[0][0], roues[0][1]], [roues[1][0], roues[1][1]]]); return; }
      if (d < PAS_MIN_M) return;
      for (let k = 0; k < 2; k++) segment(avant[k][0], avant[k][1], roues[k][0], roues[k][1]);
      dernieres.set(cle, [[roues[0][0], roues[0][1]], [roues[1][0], roues[1][1]]]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    },
    maj(dt) {
      if (mesh.count === 0) return;
      for (let i = 0; i < mesh.count; i++) if (ages[i] !== Infinity) ages[i] += dt;
      acc += dt;
      if (acc < PERIODE_COULEURS_S) return;
      acc = 0;
      let matrices = false;
      for (let i = 0; i < mesh.count; i++) {
        if (ages[i] === Infinity) continue;
        if (ages[i] >= DUREE_S) { ages[i] = Infinity; mesh.setMatrixAt(i, nul); matrices = true; continue; }
        colorer(i);
      }
      mesh.instanceColor!.needsUpdate = true;
      if (matrices) mesh.instanceMatrix.needsUpdate = true;
    },
    nombre() {
      let n = 0;
      for (let i = 0; i < mesh.count; i++) if (ages[i] !== Infinity) n++;
      return n;
    },
    vider() {
      ages.fill(Infinity);
      mesh.count = 0;
      prochain = 0;
      dernieres.clear();
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
