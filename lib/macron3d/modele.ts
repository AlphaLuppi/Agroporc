/**
 * Modèle 3D du coureur : public/macron/macron.glb (« Emmanuel M. » de jamray747, Sketchfab,
 * CC BY 4.0 ; allégé par scripts/macron/optimiser_glb.sh : meshopt, textures WebP, ≈ 0,7 Mo),
 * téléchargé au premier « macron » seulement (three et le décodeur meshopt aussi : imports
 * dynamiques). La promesse reste en cache : un second passage ne retélécharge rien ; une
 * erreur réseau libère le cache pour réessayer.
 *
 * Le squelette de repos (lib/macron3d/squelette.ts) est relevé sur les os une fois, au
 * chargement, avant toute pose.
 */
import type * as THREE from "three";
import { creerSquelette, type DonneesOs, type Pose, type Squelette } from "./squelette";

export const URL_GLB = "/macron/macron.glb";

export interface ModeleMacron {
  scene: THREE.Object3D;
  /** Os dans l'ordre du squelette. */
  os: THREE.Bone[];
  sq: Squelette;
  maillages: THREE.SkinnedMesh[];
}

let chargement: Promise<ModeleMacron> | null = null;

/** Squelette de repos lu sur les os three (parcours en profondeur : parents avant enfants). */
export function squeletteDepuisOs(racine: THREE.Object3D): { sq: Squelette; os: THREE.Bone[] } {
  const os: THREE.Bone[] = [];
  racine.traverse((o) => { if ((o as THREE.Bone).isBone) os.push(o as THREE.Bone); });
  const index = new Map(os.map((b, k) => [b, k]));
  const donnees: DonneesOs[] = os.map((b) => ({
    nom: b.name,
    parent: index.get(b.parent as THREE.Bone) ?? -1,
    t: b.position.toArray(),
    q: b.quaternion.toArray(),
  }));
  return { sq: creerSquelette(donnees), os };
}

export function chargerModele(url = URL_GLB): Promise<ModeleMacron> {
  if (!chargement) {
    chargement = (async () => {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      const chargeur = new GLTFLoader();
      chargeur.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await chargeur.loadAsync(url);
      const maillages: THREE.SkinnedMesh[] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        // La boîte de repos (T-pose) ne contient pas le coureur en mouvement.
        m.frustumCulled = false;
        maillages.push(m);
      });
      const { sq, os } = squeletteDepuisOs(gltf.scene);
      return { scene: gltf.scene, os, sq, maillages };
    })();
    chargement.catch(() => { chargement = null; });
  }
  return chargement;
}

/** Recopie une pose (lib/macron3d/pose.ts) sur les os three. */
export function appliquerPose(m: ModeleMacron, pose: Pose): void {
  for (let k = 0; k < m.os.length; k++) {
    m.os[k].quaternion.copy(pose.q[k]);
    m.os[k].position.copy(pose.t[k]);
  }
}

/**
 * Libère géométries, matériaux et textures côté GPU (fin de passage). Les objets restent en
 * cache côté JS : au passage suivant, le nouveau renderer les renvoie au GPU.
 */
export function libererGPU(m: ModeleMacron): void {
  const vus = new Set<{ dispose(): void }>();
  m.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    vus.add(mesh.geometry);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      vus.add(mat);
      for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) vus.add(v as THREE.Texture);
    }
  });
  for (const r of vus) r.dispose();
}
