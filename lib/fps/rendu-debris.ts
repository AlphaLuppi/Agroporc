/**
 * Débris des bâtiments arrachés (three, v3) : blocs de béton projetés par une brèche ou un effondrement, qui retombent, rebondissent une
 * fois et restent au sol jusqu'au match suivant. Optimisé : UN seul `InstancedMesh` (un appel de dessin) de `CAPACITE` blocs en anneau ;
 * seuls les blocs en vol sont recalculés. Le matériau dessine les arêtes de chaque bloc (coordonnées de texture de la boîte) : même
 * allure fil de fer que les bâtiments, sans géométrie de lignes.
 */
import * as THREE from "three";

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
  let prochain = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), ech = new THREE.Vector3(), axe = new THREE.Vector3();

  const poser = (i: number) => {
    axe.set(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]);
    q.setFromAxisAngle(axe, ANG[i]);
    pos.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    ech.set(S[i * 3], S[i * 3 + 1], S[i * 3 + 2]);
    mesh.setMatrixAt(i, m4.compose(pos, q, ech));
  };

  return {
    projeter(x, z, r, h, n, ex, ez) {
      for (let k = 0; k < n; k++) {
        const i = prochain;
        prochain = (prochain + 1) % CAPACITE;
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
    maj(dt) {
      if (mesh.count === 0) return;
      const pas = Math.min(dt, 0.05);
      let change = false;
      for (let i = 0; i < mesh.count; i++) {
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
    },
    vider() {
      mesh.count = 0;
      prochain = 0;
      repos.fill(Infinity);
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
