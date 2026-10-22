/**
 * Batte de baseball du tigre (geste « batte », lib/tigre3d/gestes/batte.ts) : un maillage construit
 * dans le code, cylindre effilé couleur bois, poignée et pommeau sombres, d'environ 1 m à l'échelle
 * du tigre. Elle est rattachée à l'os `mainD` de la mère (enfant de l'os, au milieu de la patte,
 * décalée vers la caméra pour passer devant le corps) : à chaque image, la scène lui donne
 * l'échelle et l'angle que le geste calcule en pur (`etatBatte`), et l'oriente dans le plan
 * sagittal du tigre, de profil face à Macron.
 */
import * as THREE from "three";
import type { Animateur } from "./animateur";
import type { Tigre } from "./modele";
import { etatBatte, LONGUEUR_BATTE_M, POIGNEE_BATTE, POINT_CONTACT } from "./gestes/batte";
import { squelette } from "./squelette";

/** Longueur de la batte (m de scène, tigre adulte) et décalage vers la caméra (m de scène). */
const LONGUEUR_M = LONGUEUR_BATTE_M;
const VERS_CAMERA_M = 0.5;

/**
 * Profil de révolution (rayon, hauteur), du pommeau au bout du fût, en mètres de scène. La batte
 * est un peu plus épaisse qu'une vraie pour rester lisible à 40 px par mètre (téléphone).
 */
const PROFIL: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.04, 0.004], [0.045, 0.018], [0.036, 0.032], [0.023, 0.045], [0.022, 0.33], [0.03, 0.45],
  [0.052, 0.62], [0.068, 0.8], [0.074, 0.93], [0.066, 0.975], [0.042, 0.995], [0, 1],
];
/** Fin de la poignée sombre (part de la longueur). */
const FIN_POIGNEE = 0.36;

/**
 * Couleurs (linéaires) : la scène du tigre éclaire fort (le tigre est sans éclairage, ambiance 2,1 et
 * soleil 2,6), on part donc de teintes sombres pour arriver à un bois clair, sans brûler. Bois de
 * frêne pâle, presque crème : un bois orangé se confondait avec le pelage quand la batte passe
 * devant la tête.
 */
const BOIS = new THREE.Color().setRGB(0.2, 0.155, 0.08);
const POIGNEE = new THREE.Color().setRGB(0.012, 0.008, 0.006);

export interface BatteTigre {
  /**
   * Place la batte sur la mère pour l'image courante (os déjà posés), cachée hors du geste.
   * Retourne le point de contact (monde) quand elle est visible.
   */
  maj(mere: Tigre, anim: Animateur): THREE.Vector3 | null;
  dispose(): void;
}

export function creerBatte(): BatteTigre {
  const geo = new THREE.LatheGeometry(PROFIL.map(([r, y]) => new THREE.Vector2(r, y - POIGNEE_BATTE)), 18);
  // Couleur par sommet : poignée et pommeau sombres, fût en bois.
  const pos = geo.getAttribute("position");
  const couleurs = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) + POIGNEE_BATTE < FIN_POIGNEE ? POIGNEE : BOIS;
    couleurs.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(couleurs, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "batte";
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  mesh.frustumCulled = false;

  const sq = squelette();
  const vMain = new THREE.Vector3(), vBout = new THREE.Vector3(), dir = new THREE.Vector3();
  const q = new THREE.Quaternion(), m = new THREE.Matrix4(), inv = new THREE.Matrix4(), echelle = new THREE.Vector3();
  const contact = new THREE.Vector3();
  const HAUT = new THREE.Vector3(0, 1, 0);

  return {
    maj(mere, anim) {
      const r = anim.reaction;
      const e = r && r.nom === "batte" && r.tGeste != null ? etatBatte(anim.t - r.tGeste, r) : null;
      if (!e || e.echelle < 1e-3) { mesh.visible = false; return null; }
      const os = mere.os[sq.i.mainD];
      if (mesh.parent !== os) os.add(mesh);
      mesh.visible = true;
      // Poignée : au milieu de la patte (poignet, bout des doigts), un peu vers la caméra.
      mere.groupe.updateMatrixWorld(true);
      os.getWorldPosition(vMain);
      mere.os[sq.i.bout_mainD].getWorldPosition(vBout);
      // Mètres de scène par mètre de tigre adulte (1 pour la mère).
      const s = mere.groupe.scale.x / (3.75 / 1.104);
      vMain.lerp(vBout, 0.5);
      vMain.z += VERS_CAMERA_M * s;
      // Direction dans le plan sagittal : cap des épaules (ψ, 0 = vers la caméra), angle du geste.
      const psi = anim.corps.psiE.x;
      dir.set(Math.sin(psi) * Math.cos(e.angle), Math.sin(e.angle), Math.cos(psi) * Math.cos(e.angle));
      q.setFromUnitVectors(HAUT, dir);
      const l = LONGUEUR_M * s * e.echelle;
      m.compose(vMain, q, echelle.set(l, l, l));
      // Enfant de l'os : matrice locale = (monde de l'os)⁻¹ · monde voulu.
      inv.copy(os.matrixWorld).invert();
      mesh.matrix.multiplyMatrices(inv, m);
      mesh.matrixWorldNeedsUpdate = true;
      return contact.copy(vMain).addScaledVector(dir, (POINT_CONTACT - POIGNEE_BATTE) * LONGUEUR_M * s);
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
    },
  };
}
