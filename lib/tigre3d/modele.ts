/**
 * Modèle 3D du tigre : le GLB public/tigre/tigre.glb (« Stylized Bengal Tiger with 4 animations »
 * de Jungle Jim, Sketchfab, CC BY 4.0 ; optimisé par scripts/tigre/optimiser_glb.sh : meshopt,
 * texture WebP 1024²), chargé une seule fois (promesse en cache) au premier passage. Chaque tigre
 * à l'écran (la mère, ses petits) est un clone (SkeletonUtils.clone) : géométrie, texture et
 * matériau sont partagés, seul le squelette est propre à chacun.
 *
 * Les clips du GLB sont convertis en clips d'images par rôle (lib/tigre3d/clips.ts) et mis au
 * registre au chargement ; la root motion d'« Attack jump » est extraite en `avance`.
 */
import * as THREE from "three";
import { clone as clonerSquelette } from "three/examples/jsm/utils/SkeletonUtils.js";
import { squelette, type PoseTigre } from "./squelette";
import { clipDepuisPistes, enregistrerClip } from "./clips";
import { construireMainHumaine, nuanceurMainHumaine } from "./main-humaine";
import { NOMS_OS } from "./os";

export const URL_GLB = "/tigre/tigre.glb";

export interface ModeleTigre {
  scene: THREE.Object3D;
  maillages: THREE.SkinnedMesh[];
  materiaux: THREE.Material[];
  textures: THREE.Texture[];
  geometries: THREE.BufferGeometry[];
}

let chargement: Promise<ModeleTigre> | null = null;
let modeleCharge: ModeleTigre | null = null;

/** Nom court d'un clip du GLB : « Armature|Attack jump » → « Attack jump ». */
const nomClip = (n: string) => n.replace(/^.*\|/, "");

/** Charge le GLB (une fois) ; une erreur réseau libère le cache pour réessayer au passage suivant. */
export function chargerModele(url = URL_GLB): Promise<ModeleTigre> {
  if (!chargement) {
    chargement = (async () => {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      const chargeur = new GLTFLoader();
      chargeur.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await chargeur.loadAsync(url);
      const sq = squelette();
      for (const clip of gltf.animations) {
        const nom = nomClip(clip.name);
        enregistrerClip(nom, clipDepuisPistes(nom, clip.duration, clip.tracks, sq, 30, /attack/i.test(nom)));
      }
      const maillages: THREE.SkinnedMesh[] = [];
      const materiaux = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>();
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        maillages.push(m);
        geometries.add(m.geometry);
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          materiaux.add(mat);
          const map = (mat as THREE.MeshBasicMaterial).map;
          if (map) { map.anisotropy = 4; textures.add(map); }
        }
        m.frustumCulled = false;
      });
      for (const m of maillages) preparerMainHumaine(m);
      modeleCharge = {
        scene: gltf.scene, maillages,
        materiaux: [...materiaux], textures: [...textures], geometries: [...geometries],
      };
      return modeleCharge;
    })();
    chargement.catch(() => { chargement = null; });
  }
  return chargement;
}

export function modelePret(): boolean { return modeleCharge !== null; }

/** Couleur de la paume de la main humaine (sRGB). */
const COULEUR_PEAU = "#dc9c7c";

/**
 * Main humaine (réaction « serre-main », lib/tigre3d/main-humaine.ts) : cible de déformation de la
 * patte avant droite ajoutée à la géométrie partagée (déplacements relatifs), attribut `mainHumaine`
 * (atténuation, q, w, e) et nuanceur du matériau qui mélange la texture à la couleur de peau sur
 * la paume et trace les sillons, en proportion du poids de la déformation. Chaque clone a son
 * propre tableau `morphTargetInfluences` : seule la mère reçoit un poids non nul, les petits n'ont
 * donc jamais de main ni de peau.
 */
function preparerMainHumaine(m: THREE.SkinnedMesh): void {
  const g = m.geometry;
  if (g.morphAttributes.position?.length) return;
  const k = m.skeleton.bones.findIndex((b) => b.name === NOMS_OS.mainD);
  const pos = g.getAttribute("position"), nor = g.getAttribute("normal");
  const idx = g.getAttribute("skinIndex"), poids = g.getAttribute("skinWeight");
  if (k < 0 || !pos || !nor || !idx || !poids) return;
  const n = pos.count;
  // getX… dénormalisent les attributs quantifiés (positions Int16, poids Uint8).
  const positions = new Float32Array(n * 3), normales = new Float32Array(n * 3), indicesOs = new Uint16Array(n * 4), poidsOs = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = pos.getX(i); positions[i * 3 + 1] = pos.getY(i); positions[i * 3 + 2] = pos.getZ(i);
    normales[i * 3] = nor.getX(i); normales[i * 3 + 1] = nor.getY(i); normales[i * 3 + 2] = nor.getZ(i);
    indicesOs[i * 4] = idx.getX(i); indicesOs[i * 4 + 1] = idx.getY(i); indicesOs[i * 4 + 2] = idx.getZ(i); indicesOs[i * 4 + 3] = idx.getW(i);
    poidsOs[i * 4] = poids.getX(i); poidsOs[i * 4 + 1] = poids.getY(i); poidsOs[i * 4 + 2] = poids.getZ(i); poidsOs[i * 4 + 3] = poids.getW(i);
  }
  const versOs = new THREE.Matrix4().multiplyMatrices(m.skeleton.boneInverses[k], m.bindMatrix);
  const { deplacements, reperes } = construireMainHumaine({
    positions, normales, indicesOs, poidsOs, osMain: k, versOs: versOs.elements, indices: g.index?.array,
  });
  g.morphAttributes.position = [new THREE.Float32BufferAttribute(deplacements, 3)];
  g.morphTargetsRelative = true;
  g.setAttribute("mainHumaine", new THREE.Float32BufferAttribute(reperes, 4));
  m.updateMorphTargets();
  const materiaux = Array.isArray(m.material) ? m.material : [m.material];
  const peau = new THREE.Color(COULEUR_PEAU);
  const code = nuanceurMainHumaine();
  for (const mat of materiaux) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.couleurPeau = { value: peau };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 mainHumaine;\nvarying vec4 vMainHumaine;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "vMainHumaine = mainHumaine;",
          "#ifdef USE_MORPHTARGETS",
          "vMainHumaine.x *= morphTargetInfluences[ 0 ];",
          "#else",
          "vMainHumaine.x = 0.0;",
          "#endif",
        ].join("\n"));
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 couleurPeau;\nvarying vec4 vMainHumaine;")
        .replace("#include <map_fragment>", `#include <map_fragment>\n${code}`);
    };
    mat.customProgramCacheKey = () => "tigre-main-humaine";
    mat.needsUpdate = true;
  }
}

export interface Tigre {
  /** Placé par la scène (position du centre du corps, échelle). */
  groupe: THREE.Group;
  /** Os du clone, dans l'ordre du squelette (lib/tigre3d/squelette.ts). */
  os: THREE.Bone[];
  /** Recopie la pose sur les os ; `origineX` = x du corps (repère sol) ramené à l'origine du groupe. */
  appliquer(pose: PoseTigre, origineX: number): void;
  /** Poids de la main humaine de ce tigre (0 = patte, 1 = main), cf. `preparerMainHumaine`. */
  mainHumaine(poids: number): void;
  dispose(): void;
}

/** Ombre portée : disque flou sous le corps (pose le tigre sur le sol). */
let texOmbre: THREE.CanvasTexture | null = null;
function textureOmbre(): THREE.CanvasTexture {
  if (texOmbre) return texOmbre;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.6, "rgba(0,0,0,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  texOmbre = new THREE.CanvasTexture(c);
  return texOmbre;
}

export function creerTigre(m: ModeleTigre): Tigre {
  const sq = squelette();
  const groupe = new THREE.Group();
  const decale = new THREE.Group();
  groupe.add(decale);
  const copie = clonerSquelette(m.scene) as THREE.Object3D;
  decale.add(copie);
  const parNom = new Map<string, THREE.Bone>();
  const maillages: THREE.SkinnedMesh[] = [];
  copie.traverse((o) => {
    if ((o as THREE.Bone).isBone) parNom.set(o.name, o as THREE.Bone);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) { o.frustumCulled = false; maillages.push(o as THREE.SkinnedMesh); }
  });
  const os = sq.noms.map((n) => {
    const b = parNom.get(n);
    if (!b) throw new Error(`tigre 3D : os ${n} absent du GLB`);
    return b;
  });
  const matOmbre = new THREE.MeshBasicMaterial({ map: textureOmbre(), transparent: true, depthWrite: false, opacity: 0.5 });
  const ombre = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.36), matOmbre);
  ombre.rotation.x = -Math.PI / 2;
  ombre.position.y = 0.002;
  ombre.renderOrder = -1;
  groupe.add(ombre);
  const racine = sq.i.racine;
  return {
    groupe, os,
    appliquer(pose, origineX) {
      decale.position.x = -origineX;
      for (let k = 0; k < os.length; k++) {
        os[k].quaternion.copy(pose.q[k]);
        os[k].position.copy(pose.t[k]);
      }
      // L'ombre suit le corps (il se cabre, se décale) et pâlit quand il saute.
      const p = os[racine].getWorldPosition(new THREE.Vector3());
      groupe.worldToLocal(p);
      ombre.position.x = p.x;
      ombre.position.z = p.z;
      const h = Math.max(0, p.y - 0.2625);
      matOmbre.opacity = 0.5 * Math.max(0.25, 1 - h * 4);
    },
    mainHumaine(poids) {
      for (const m of maillages) if (m.morphTargetInfluences?.length) m.morphTargetInfluences[0] = poids;
    },
    dispose() {
      ombre.geometry.dispose();
      matOmbre.dispose();
    },
  };
}

/** Libère géométrie, matériaux et textures partagés (démontage de la scène). */
export function libererModele(): void {
  if (!modeleCharge) return;
  for (const g of modeleCharge.geometries) g.dispose();
  for (const m of modeleCharge.materiaux) m.dispose();
  for (const t of modeleCharge.textures) t.dispose();
  modeleCharge = null;
  chargement = null;
  texOmbre?.dispose();
  texOmbre = null;
}
