/**
 * Rocket Muche, effets visuels (three) : particules additives (deux réserves : fines étincelles et grosses braises), anneaux (ondes de choc,
 * onde supersonique, éclat de plot) en un seul `InstancedMesh`, et traînées de lignes (balle, voitures supersoniques) en un seul
 * `LineSegments` dynamique. Tout est préalloué : aucune allocation par image. Total : 4 draw calls (2 réserves, 1 anneaux, 1 traînée).
 * Les décisions (combien, à quelle vitesse, de quelle couleur) viennent de `rendu-modele.ts`.
 */
import * as THREE from "three";
import type { RGB } from "./rendu-modele";
import type { Vec3 } from "./vec";

// ============================================================================================================================
// Particules
// ============================================================================================================================

interface ParamsPool { capacite: number; taille: number }

/** Réserve circulaire de particules additives : une particule morte est simplement noire (aucune réorganisation). */
class Pool {
  readonly points: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.PointsMaterial;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly base: Float32Array;
  private readonly age: Float32Array;
  private readonly vie: Float32Array;
  private readonly grav: Float32Array;
  private prochain = 0;
  private utilise = 0;

  constructor(readonly p: ParamsPool) {
    const n = p.capacite;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(Infinity);
    this.vie = new Float32Array(n).fill(1);
    this.grav = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3), ca = new THREE.BufferAttribute(this.col, 3);
    pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", pa);
    this.geo.setAttribute("color", ca);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.PointsMaterial({ size: p.taille, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
  }

  emettre(p: Readonly<Vec3>, v: Readonly<Vec3>, c: Readonly<RGB>, vie: number, gravite: number): void {
    const i = this.prochain;
    this.prochain = (i + 1) % this.p.capacite;
    const k = i * 3;
    this.pos[k] = p[0]; this.pos[k + 1] = p[1]; this.pos[k + 2] = p[2];
    this.vel[k] = v[0]; this.vel[k + 1] = v[1]; this.vel[k + 2] = v[2];
    this.base[k] = c[0]; this.base[k + 1] = c[1]; this.base[k + 2] = c[2];
    this.col[k] = c[0]; this.col[k + 1] = c[1]; this.col[k + 2] = c[2];
    this.age[i] = 0; this.vie[i] = Math.max(0.05, vie); this.grav[i] = gravite;
    this.utilise = Math.max(this.utilise, i + 1);
  }

  maj(dt: number): void {
    if (this.utilise === 0) return;
    let dernier = 0;
    for (let i = 0; i < this.utilise; i++) {
      if (this.age[i] === Infinity) continue;
      this.age[i] += dt;
      const k = i * 3;
      if (this.age[i] >= this.vie[i]) { this.age[i] = Infinity; this.col[k] = this.col[k + 1] = this.col[k + 2] = 0; continue; }
      this.vel[k + 1] -= this.grav[i] * dt;
      const frein = Math.exp(-1.2 * dt);
      this.vel[k] *= frein; this.vel[k + 2] *= frein;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] = Math.max(0.02, this.pos[k + 1] + this.vel[k + 1] * dt); this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = 1 - this.age[i] / this.vie[i];
      const e = f * f;
      this.col[k] = this.base[k] * e; this.col[k + 1] = this.base[k + 1] * e; this.col[k + 2] = this.base[k + 2] * e;
      dernier = i + 1;
    }
    this.geo.setDrawRange(0, this.utilise);
    if (dernier === 0) { this.utilise = 0; this.geo.setDrawRange(0, 0); }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  vivantes(): number {
    let n = 0;
    for (let i = 0; i < this.utilise; i++) if (this.age[i] !== Infinity) n++;
    return n;
  }

  vider(): void { this.age.fill(Infinity); this.col.fill(0); this.utilise = 0; this.prochain = 0; this.geo.setDrawRange(0, 0); }

  dispose(): void { this.points.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}

// ============================================================================================================================
// Effets : particules + anneaux
// ============================================================================================================================

export interface EmissionParticules {
  /** point d'émission */
  p: Readonly<Vec3>;
  /** directions unitaires, une particule par direction */
  directions: readonly Vec3[];
  vitesse: number;
  vie: number;
  gravite: number;
  couleur: Readonly<RGB>;
  /** si vrai, les particules vont dans la réserve des grosses braises (explosions) */
  grosses?: boolean;
  /** direction principale facultative : mélangée à chaque direction (étincelles d'impact) */
  biais?: Readonly<Vec3>;
  dispersionVitesse?: number;
}
export interface DemandeAnneau {
  p: Readonly<Vec3>;
  /** normale du plan de l'anneau (unitaire) */
  normale: Readonly<Vec3>;
  rayonFinal: number;
  dureeS: number;
  couleur: Readonly<RGB>;
}

export interface Effets {
  emettre(e: EmissionParticules): void;
  anneau(a: DemandeAnneau): void;
  maj(dt: number): void;
  vider(): void;
  /** particules vivantes (essais) */
  vivantes(): number;
  anneauxVivants(): number;
  dispose(): void;
}

const CAPACITE_ANNEAUX = 16;

export function creerEffets(parent: THREE.Object3D): Effets {
  const fines = new Pool({ capacite: 700, taille: 0.16 });
  const grosses = new Pool({ capacite: 300, taille: 0.5 });
  parent.add(fines.points, grosses.points);

  const geoAnneau = new THREE.RingGeometry(0.93, 1, 48);
  const matAnneau = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const anneaux = new THREE.InstancedMesh(geoAnneau, matAnneau, CAPACITE_ANNEAUX);
  anneaux.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  anneaux.frustumCulled = false;
  anneaux.renderOrder = 8;
  const a = {
    age: new Float32Array(CAPACITE_ANNEAUX).fill(Infinity),
    duree: new Float32Array(CAPACITE_ANNEAUX).fill(1),
    rayon: new Float32Array(CAPACITE_ANNEAUX),
    base: new Float32Array(CAPACITE_ANNEAUX * 3),
    pos: new Float32Array(CAPACITE_ANNEAUX * 3),
    q: Array.from({ length: CAPACITE_ANNEAUX }, () => new THREE.Quaternion()),
  };
  const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), colT = new THREE.Color(), zPlus = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3();
  const nul = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < CAPACITE_ANNEAUX; i++) { anneaux.setMatrixAt(i, nul); anneaux.setColorAt(i, colT.setRGB(0, 0, 0)); }
  parent.add(anneaux);
  let prochainAnneau = 0;
  let vivantsAnneaux = 0;

  return {
    emettre(e) {
      const pool = e.grosses ? grosses : fines;
      const disp = e.dispersionVitesse ?? 0.5;
      const tmp: Vec3 = [0, 0, 0];
      for (let i = 0; i < e.directions.length; i++) {
        const d = e.directions[i];
        // vitesse variable mais déterministe (pas de hasard global) : motif fixe selon l'indice
        const k = 1 - disp + disp * (0.5 + 0.5 * Math.sin(i * 12.9898));
        let dx = d[0], dy = d[1], dz = d[2];
        if (e.biais) { dx = dx * 0.6 + e.biais[0]; dy = dy * 0.6 + e.biais[1]; dz = dz * 0.6 + e.biais[2]; }
        tmp[0] = dx * e.vitesse * k; tmp[1] = dy * e.vitesse * k; tmp[2] = dz * e.vitesse * k;
        pool.emettre(e.p, tmp, e.couleur, e.vie * (0.7 + 0.3 * k), e.gravite);
      }
    },
    anneau(d) {
      const i = prochainAnneau;
      prochainAnneau = (i + 1) % CAPACITE_ANNEAUX;
      a.age[i] = 0; a.duree[i] = Math.max(0.05, d.dureeS); a.rayon[i] = d.rayonFinal;
      a.base[i * 3] = d.couleur[0]; a.base[i * 3 + 1] = d.couleur[1]; a.base[i * 3 + 2] = d.couleur[2];
      a.pos[i * 3] = d.p[0]; a.pos[i * 3 + 1] = d.p[1]; a.pos[i * 3 + 2] = d.p[2];
      nrm.set(d.normale[0], d.normale[1], d.normale[2]).normalize();
      a.q[i].setFromUnitVectors(zPlus, nrm);
    },
    maj(dt) {
      fines.maj(dt);
      grosses.maj(dt);
      let vivants = 0;
      let maj = false;
      for (let i = 0; i < CAPACITE_ANNEAUX; i++) {
        if (a.age[i] === Infinity) continue;
        a.age[i] += dt;
        maj = true;
        const t = a.age[i] / a.duree[i];
        if (t >= 1) {
          a.age[i] = Infinity;
          anneaux.setMatrixAt(i, nul);
          anneaux.setColorAt(i, colT.setRGB(0, 0, 0));
          continue;
        }
        vivants++;
        const ease = 1 - (1 - t) * (1 - t);
        const r = Math.max(0.01, a.rayon[i] * ease);
        v3.set(a.pos[i * 3], a.pos[i * 3 + 1], a.pos[i * 3 + 2]);
        s3.set(r, r, r);
        anneaux.setMatrixAt(i, m4.compose(v3, a.q[i], s3));
        const f = (1 - t) * (1 - t);
        anneaux.setColorAt(i, colT.setRGB(a.base[i * 3] * f, a.base[i * 3 + 1] * f, a.base[i * 3 + 2] * f));
      }
      vivantsAnneaux = vivants;
      if (maj) {
        anneaux.instanceMatrix.needsUpdate = true;
        if (anneaux.instanceColor) anneaux.instanceColor.needsUpdate = true;
      }
    },
    vider() {
      fines.vider(); grosses.vider();
      for (let i = 0; i < CAPACITE_ANNEAUX; i++) { a.age[i] = Infinity; anneaux.setMatrixAt(i, nul); anneaux.setColorAt(i, colT.setRGB(0, 0, 0)); }
      anneaux.instanceMatrix.needsUpdate = true;
      if (anneaux.instanceColor) anneaux.instanceColor.needsUpdate = true;
      vivantsAnneaux = 0;
    },
    vivantes: () => fines.vivantes() + grosses.vivantes(),
    anneauxVivants: () => vivantsAnneaux,
    dispose() {
      fines.dispose(); grosses.dispose();
      anneaux.removeFromParent();
      anneaux.dispose();
      geoAnneau.dispose();
      matAnneau.dispose();
    },
  };
}

// ============================================================================================================================
// Traînées de lignes
// ============================================================================================================================

export interface Trainees {
  /**
   * Une image de l'émetteur `id` : `points` = un point par brin (voiture : deux coins arrière ; balle : le centre). Le point est inscrit
   * dans l'historique au plus tous les 1/50 s ; `intensite` ∈ [0, 1] règle la luminosité de CE point (la traînée s'éteint toute seule).
   */
  pousser(id: number, points: readonly Readonly<Vec3>[], couleur: Readonly<RGB>, intensite: number, dt: number): void;
  /** efface l'historique de `id` (téléportation, coup d'envoi) */
  reinitialiser(id: number): void;
  /** écrit positions et couleurs dans les tampons (à appeler une fois par image) */
  maj(): void;
  dispose(): void;
  readonly lignes: THREE.LineSegments;
}

/**
 * `emetteurs` émetteurs de `brins` brins chacun, `longueur` points d'historique par brin. Le tampon est écrit en entier à chaque `maj`
 * (quelques centaines de segments).
 */
export function creerTrainees(parent: THREE.Object3D, emetteurs: number, brins: number, longueur: number): Trainees {
  const nSeg = emetteurs * brins * (longueur - 1);
  const pos = new Float32Array(nSeg * 6), col = new Float32Array(nSeg * 6);
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3), ca = new THREE.BufferAttribute(col, 3);
  pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pa); geo.setAttribute("color", ca);
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const lignes = new THREE.LineSegments(geo, mat);
  lignes.frustumCulled = false;
  lignes.renderOrder = 7;
  parent.add(lignes);
  // historique : [émetteur][brin][point] → xyz + intensité ; couleur de l'émetteur
  const hist = new Float32Array(emetteurs * brins * longueur * 4);
  const couleurs = new Float32Array(emetteurs * 3);
  const acc = new Float32Array(emetteurs);
  const vide = new Uint8Array(emetteurs).fill(1);
  const idx = (e: number, b: number, k: number) => ((e * brins + b) * longueur + k) * 4;

  return {
    lignes,
    pousser(id, points, couleur, intensite, dt) {
      couleurs[id * 3] = couleur[0]; couleurs[id * 3 + 1] = couleur[1]; couleurs[id * 3 + 2] = couleur[2];
      if (vide[id]) {
        for (let b = 0; b < brins; b++) for (let k = 0; k < longueur; k++) {
          const j = idx(id, b, k);
          hist[j] = points[b][0]; hist[j + 1] = points[b][1]; hist[j + 2] = points[b][2]; hist[j + 3] = 0;
        }
        vide[id] = 0; acc[id] = 0;
      }
      acc[id] += dt;
      if (acc[id] < 1 / 50) {
        // pas de nouveau point : la tête suit l'émetteur
        for (let b = 0; b < brins; b++) {
          const j = idx(id, b, 0);
          hist[j] = points[b][0]; hist[j + 1] = points[b][1]; hist[j + 2] = points[b][2]; hist[j + 3] = intensite;
        }
        return;
      }
      acc[id] = 0;
      for (let b = 0; b < brins; b++) {
        for (let k = longueur - 1; k >= 1; k--) {
          const j = idx(id, b, k), s = idx(id, b, k - 1);
          hist[j] = hist[s]; hist[j + 1] = hist[s + 1]; hist[j + 2] = hist[s + 2]; hist[j + 3] = hist[s + 3];
        }
        const j = idx(id, b, 0);
        hist[j] = points[b][0]; hist[j + 1] = points[b][1]; hist[j + 2] = points[b][2]; hist[j + 3] = intensite;
      }
    },
    reinitialiser(id) { vide[id] = 1; },
    maj() {
      let o = 0;
      for (let e = 0; e < emetteurs; e++) {
        for (let b = 0; b < brins; b++) {
          for (let k = 0; k < longueur - 1; k++) {
            const j0 = idx(e, b, k), j1 = idx(e, b, k + 1);
            const f0 = (1 - k / (longueur - 1)), f1 = (1 - (k + 1) / (longueur - 1));
            const i0 = hist[j0 + 3] * f0 * f0, i1 = hist[j1 + 3] * f1 * f1;
            pos[o] = hist[j0]; pos[o + 1] = hist[j0 + 1]; pos[o + 2] = hist[j0 + 2];
            pos[o + 3] = hist[j1]; pos[o + 4] = hist[j1 + 1]; pos[o + 5] = hist[j1 + 2];
            col[o] = couleurs[e * 3] * i0; col[o + 1] = couleurs[e * 3 + 1] * i0; col[o + 2] = couleurs[e * 3 + 2] * i0;
            col[o + 3] = couleurs[e * 3] * i1; col[o + 4] = couleurs[e * 3 + 1] * i1; col[o + 5] = couleurs[e * 3 + 2] * i1;
            o += 6;
          }
        }
      }
      pa.needsUpdate = true; ca.needsUpdate = true;
    },
    dispose() { lignes.removeFromParent(); geo.dispose(); mat.dispose(); },
  };
}
