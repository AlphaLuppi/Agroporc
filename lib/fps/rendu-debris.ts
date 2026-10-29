/**
 * Débris des bâtiments arrachés (three, v3) : blocs de béton projetés par une brèche ou un effondrement, qui retombent, rebondissent une
 * fois et restent au sol un moment. Optimisé : UN seul `InstancedMesh` (un appel de dessin) de `CAPACITE` blocs en anneau ; seuls les
 * blocs en vol ou en train de disparaître sont recalculés. Le matériau dessine les arêtes de chaque bloc (coordonnées de texture de la
 * boîte) : même allure fil de fer que les bâtiments, sans géométrie de lignes.
 * (v8) Durée de vie bornée (`debris-vie.ts`) : un bloc vit `vie` s puis rétrécit et s'enfonce dans le sol (35 s pour les gravats de
 * l'arène, 2,2 s pour les éclats d'une porte des zombies, `lancer`).
 */
import * as THREE from "three";
import { VIE_DEBRIS, etatVieDebris } from "./debris-vie";
import type { Eclat } from "./ouverture-portes";

const CAPACITE = 420;
const GRAVITE = 22;
/** Les blocs immobiles depuis tant de secondes ne sont plus recalculés. */
const REPOS_S = 0.25;

export interface Debris {
  /**
   * Projette `n` blocs depuis le disque (x, z, r) jusqu'à la hauteur `h` (m), vers l'extérieur du centre (`ex`, `ez` : point d'où vient le
   * choc, les blocs s'en éloignent).
   */
  projeter(x: number, z: number, r: number, h: number, n: number, ex?: number, ez?: number): void;
  /** (v8) Lance des éclats donnés (position, vitesse, taille) qui vivent `vie` s puis s'effacent en `fondu` s (portes des zombies). */
  lancer(eclats: readonly Eclat[], vie?: number, fondu?: number): void;
  maj(dt: number): void;
  vider(): void;
  dispose(): void;
}

export function creerDebris(scene: THREE.Scene, couleurArete: number): Debris {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0x0a1016 });
  const arete = new THREE.Color(couleurArete);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uArete = { value: arete };
    sh.vertexShader = `varying vec2 vUvD;\n${sh.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nvUvD = uv;");
    sh.fragmentShader = `uniform vec3 uArete;\nvarying vec2 vUvD;\n${sh.fragmentShader}`.replace(
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
vec2 bD = min(vUvD, 1.0 - vUvD) / fwidth(vUvD);
float aD = 1.0 - smoothstep(0.6, 1.6, min(bD.x, bD.y));
gl_FragColor.rgb = mix(gl_FragColor.rgb, uArete, aD);`,
    );
  };
  mat.customProgramCacheKey = () => "debris-aretes";
  const mesh = new THREE.InstancedMesh(geo, mat, CAPACITE);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  // état par bloc : position, vitesse, rotation (axe-angle), vitesse angulaire, taille, temps au repos
  const P = new Float32Array(CAPACITE * 3), V = new Float32Array(CAPACITE * 3);
  const A = new Float32Array(CAPACITE * 3), W = new Float32Array(CAPACITE), ANG = new Float32Array(CAPACITE);
  const S = new Float32Array(CAPACITE * 3), repos = new Float32Array(CAPACITE).fill(Infinity);
  // âge (s), durée de vie et fondu (s) ; `fini` : le bloc a disparu (échelle nulle)
  const AGE = new Float32Array(CAPACITE), VIE = new Float32Array(CAPACITE).fill(Infinity), FONDU = new Float32Array(CAPACITE);
  const fini = new Uint8Array(CAPACITE).fill(1);
  let prochain = 0;
  let vivants = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), ech = new THREE.Vector3(), axe = new THREE.Vector3();

  const poser = (i: number, echelle = 1, enfoncement = 0) => {
    axe.set(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]);
    q.setFromAxisAngle(axe, ANG[i]);
    pos.set(P[i * 3], P[i * 3 + 1] - enfoncement * S[i * 3 + 1], P[i * 3 + 2]);
    ech.set(S[i * 3] * echelle, S[i * 3 + 1] * echelle, S[i * 3 + 2] * echelle);
    mesh.setMatrixAt(i, m4.compose(pos, q, ech));
  };
  /** Prend la place suivante de l'anneau pour un bloc neuf (âge 0, vie et fondu donnés). */
  const prendre = (vie: number, fondu: number): number => {
    const i = prochain;
    prochain = (prochain + 1) % CAPACITE;
    if (fini[i]) vivants++;
    fini[i] = 0; AGE[i] = 0; VIE[i] = vie; FONDU[i] = fondu;
    return i;
  };

  return {
    projeter(x, z, r, h, n, ex, ez) {
      for (let k = 0; k < n; k++) {
        const i = prendre(VIE_DEBRIS.effondrement.vie, VIE_DEBRIS.effondrement.fondu);
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        P[i * 3] = px; P[i * 3 + 1] = 0.5 + Math.random() * Math.max(1, h); P[i * 3 + 2] = pz;
        // vers l'extérieur du choc, un peu vers le haut
        let ox = px - (ex ?? x), oz = pz - (ez ?? z);
        const l = Math.hypot(ox, oz) || 1;
        ox /= l; oz /= l;
        const vh = 3 + Math.random() * 9;
        V[i * 3] = ox * vh + (Math.random() - 0.5) * 3;
        V[i * 3 + 1] = 2 + Math.random() * 9;
        V[i * 3 + 2] = oz * vh + (Math.random() - 0.5) * 3;
        const ax = Math.random() - 0.5, ay = Math.random() - 0.5, az = Math.random() - 0.5, la = Math.hypot(ax, ay, az) || 1;
        A[i * 3] = ax / la; A[i * 3 + 1] = ay / la; A[i * 3 + 2] = az / la;
        ANG[i] = Math.random() * Math.PI;
        W[i] = (Math.random() - 0.5) * 10;
        const t = 0.5 + Math.random() * Math.random() * 2.6;
        S[i * 3] = t; S[i * 3 + 1] = t * (0.4 + Math.random() * 0.6); S[i * 3 + 2] = t * (0.5 + Math.random() * 0.8);
        repos[i] = 0;
        poser(i);
        mesh.count = Math.max(mesh.count, i + 1);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    lancer(eclats, vie = VIE_DEBRIS.porte.vie, fondu = VIE_DEBRIS.porte.fondu) {
      for (const e of eclats) {
        const i = prendre(vie, fondu);
        P[i * 3] = e.p[0]; P[i * 3 + 1] = e.p[1]; P[i * 3 + 2] = e.p[2];
        V[i * 3] = e.v[0]; V[i * 3 + 1] = e.v[1]; V[i * 3 + 2] = e.v[2];
        const ax = Math.random() - 0.5, ay = Math.random() - 0.5, az = Math.random() - 0.5, la = Math.hypot(ax, ay, az) || 1;
        A[i * 3] = ax / la; A[i * 3 + 1] = ay / la; A[i * 3 + 2] = az / la;
        ANG[i] = Math.random() * Math.PI;
        W[i] = (Math.random() - 0.5) * 6;
        S[i * 3] = e.taille[0]; S[i * 3 + 1] = e.taille[1]; S[i * 3 + 2] = e.taille[2];
        repos[i] = 0;
        poser(i);
        mesh.count = Math.max(mesh.count, i + 1);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    maj(dt) {
      if (mesh.count === 0) return;
      const pas = Math.min(dt, 0.05);
      let change = false;
      for (let i = 0; i < mesh.count; i++) {
        if (fini[i]) continue;
        // vieillissement : passé sa vie, le bloc rétrécit et s'enfonce, puis disparaît (sa place resservira)
        AGE[i] += dt;
        const v = etatVieDebris(AGE[i], VIE[i], FONDU[i]);
        if (v.fini) {
          fini[i] = 1; vivants--;
          poser(i, 0, 1);
          change = true;
          continue;
        }
        if (v.echelle < 1) { poser(i, v.echelle, v.enfoncement); change = true; continue; }
        if (repos[i] > REPOS_S) continue;
        const b = i * 3;
        V[b + 1] -= GRAVITE * pas;
        P[b] += V[b] * pas; P[b + 1] += V[b + 1] * pas; P[b + 2] += V[b + 2] * pas;
        ANG[i] += W[i] * pas;
        const sol = S[b + 1] * 0.5;
        if (P[b + 1] <= sol) {
          P[b + 1] = sol;
          if (Math.abs(V[b + 1]) > 3) {
            // un rebond amorti, le bloc glisse et freine
            V[b + 1] = -V[b + 1] * 0.3; V[b] *= 0.5; V[b + 2] *= 0.5; W[i] *= 0.4;
          } else {
            V[b] = V[b + 1] = V[b + 2] = 0; W[i] = 0;
            repos[i] += pas;
          }
        }
        poser(i);
        change = true;
      }
      if (change) mesh.instanceMatrix.needsUpdate = true;
      // plus rien de vivant : l'anneau repart de zéro, plus aucun bloc dessiné
      if (vivants <= 0) { vivants = 0; mesh.count = 0; prochain = 0; }
    },
    vider() {
      mesh.count = 0;
      prochain = 0;
      vivants = 0;
      repos.fill(Infinity);
      fini.fill(1);
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
