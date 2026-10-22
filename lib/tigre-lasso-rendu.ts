/**
 * Rendu 3D du lasso (thème Tigre) : la corde et sa boucle en tubes three.js éclairés, texture de
 * chanvre torsadé, dans un canvas transparent plein écran posé au-dessus du tigre. Chargé à la
 * demande quand on prend le lasso, libéré quand on le range. Repère : px d'écran (y vers le bas,
 * z vers nous) ; la caméra en perspective voit le plan z = 0 pixel pour pixel, si bien qu'une boucle
 * qui tournoie à plat ou qui se présente face à nous a du relief.
 */
import * as THREE from "three";
import type { V3 } from "./tigre-lasso";

/** Rayon du fil (px). */
const RAYON_FIL = 2.8;
/** Distance caméra → plan de l'écran (px) : perspective douce. */
const RECUL = 1600;

/** Chanvre torsadé : bandes obliques claires et sombres, répétées le long du tube. */
export function textureCorde(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 32;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#c48d45";
  ctx.fillRect(0, 0, 64, 32);
  ctx.lineWidth = 7;
  for (let x = -64; x < 128; x += 16) {
    ctx.strokeStyle = "#8a5a24";
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 32, 32); ctx.stroke();
    ctx.strokeStyle = "#e3b56e";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 6, 0); ctx.lineTo(x + 38, 32); ctx.stroke();
    ctx.lineWidth = 7;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface RenduLasso {
  /** `corde` : de la main au nœud ; `boucle` : la boucle fermée (null : pas de boucle). */
  dessiner(corde: readonly V3[] | null, boucle: readonly V3[] | null): void;
  dispose(): void;
}

export function creerRenduLasso(canvas: HTMLCanvasElement): RenduLasso {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 10, RECUL * 3);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  scene.add(new THREE.HemisphereLight(0xfff2e0, 0x5a3a1a, 0.9));
  const soleil = new THREE.DirectionalLight(0xffffff, 2.2);
  soleil.position.set(-0.4, 1, 0.8);
  scene.add(soleil);

  const texCorde = textureCorde(), texBoucle = texCorde.clone();
  texBoucle.needsUpdate = true;
  const matCorde = new THREE.MeshStandardMaterial({ map: texCorde, roughness: 0.85, metalness: 0 });
  const matBoucle = new THREE.MeshStandardMaterial({ map: texBoucle, roughness: 0.85, metalness: 0 });
  const meshCorde = new THREE.Mesh(new THREE.BufferGeometry(), matCorde);
  const meshBoucle = new THREE.Mesh(new THREE.BufferGeometry(), matBoucle);
  scene.add(meshCorde, meshBoucle);

  let w = 0, h = 0;
  const caler = () => {
    if (w === window.innerWidth && h === window.innerHeight) return;
    w = window.innerWidth; h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = (2 * Math.atan(h / 2 / RECUL) * 180) / Math.PI;
    camera.position.set(w / 2, -h / 2, RECUL);
    camera.lookAt(w / 2, -h / 2, 0);
    camera.updateProjectionMatrix();
  };

  const versMonde = (p: V3) => new THREE.Vector3(p.x, -p.y, p.z);

  /** Remplace la géométrie d'un tube ; la texture se répète selon sa longueur (torsade régulière). */
  function tube(mesh: THREE.Mesh, tex: THREE.Texture, pts: readonly V3[] | null, ferme: boolean) {
    mesh.geometry.dispose();
    if (!pts || pts.length < 2) { mesh.geometry = new THREE.BufferGeometry(); return; }
    const courbe = new THREE.CatmullRomCurve3(pts.map(versMonde), ferme, "centripetal");
    const longueur = courbe.getLength();
    mesh.geometry = new THREE.TubeGeometry(courbe, Math.max(8, Math.min(220, Math.round(longueur / 4))), RAYON_FIL, 7, ferme);
    tex.repeat.set(longueur / 14, 1);
  }

  return {
    dessiner(corde, boucle) {
      caler();
      tube(meshCorde, texCorde, corde, false);
      tube(meshBoucle, texBoucle, boucle, true);
      renderer.render(scene, camera);
    },
    dispose() {
      meshCorde.geometry.dispose(); meshBoucle.geometry.dispose();
      matCorde.dispose(); matBoucle.dispose(); texCorde.dispose(); texBoucle.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
