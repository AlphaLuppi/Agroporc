/**
 * Rendu des tigres zombies (three, mode zombies) : un pool de 24 clones du VRAI tigre 3D du thème Tigre (`public/tigre/tigre.glb`,
 * `chargerModele` / `creerTigre` de `lib/tigre3d/modele.ts`), créés 2 par image pour étaler le coût, qui se partagent UNE copie privée de la
 * géométrie, du matériau et de la texture du modèle (jamais `libererModele()` : le modèle appartient au thème Tigre ; sans copie privée, three
 * attacherait le renderer aux objets partagés et garderait le contexte WebGL après la sortie de l'arène). Trois matériaux teintés (rôdeur brun
 * sombre, sprinteur plus clair, brute rouge sombre), sans maillage filaire, sans ombre, sans yeux : 1 draw call skinné par tigre.
 *
 * Culling manuel (devant la caméra et à moins de 140 m), LOD d'animation (pose recalculée chaque image à moins de 40 m, une sur deux jusqu'à
 * 80 m, une sur quatre au-delà, cf. `animerCetteImage`), animation par `zombies-anim.ts` (allure selon la vitesse mesurée, griffe au drapeau).
 * Tant que le GLB n'est pas prêt (ou s'il ne charge pas), les tigres sont de simples silhouettes en boîtes. Orientation : le corps marche
 * le long de +x de son repère, le groupe est donc tourné de `cap + π/2` (comme `rendu-monstres.ts`).
 * Aucun test vitest (three, WebGL) : la logique est dans `jeu-zombies.ts` et `zombies-anim.ts`, les régressions se voient aux captures.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Rendu et performances côté client »)
 */
import * as THREE from "three";
import { chargerModele, creerTigre, type ModeleTigre, type Tigre } from "../tigre3d/modele";
import { animerCetteImage, tigreAffiche, type ZombieVue } from "./jeu-zombies";
import type { Vec3 } from "./protocole";
import { creerAnimZombie, type AnimZombie } from "./zombies-anim";
import { ZOMBIES } from "./zombies-vagues";

/** Taille du pool (= plafond de tigres vivants) et nombre de clones créés par image. */
export const TAILLE_POOL = ZOMBIES.plafondVivants;
export const CREATIONS_PAR_IMAGE = 2;
/** Teintes multipliées à la texture du pelage : rôdeur brun sombre, sprinteur plus clair, brute rouge sombre. */
export const TEINTES_ZOMBIES: readonly number[] = [0x5e4636, 0xb48f6c, 0x8c2a24];
/** Silhouette de remplacement (m) : long, haut, large, avant la fin du chargement du modèle. */
const BOITE = { l: 1.1, h: 0.55, w: 0.3 } as const;

export interface RappelsZombies {
  /** Un tigre vient d'armer sa griffe (front montant du drapeau du snap) : le jeu y joue le son. */
  surGriffe(v: ZombieVue): void;
}

export interface RenduZombies {
  /**
   * Pose les `n` premiers tigres de `zombies` (interpolés) : `cam` et `regard` (x, z) servent au culling, `dt` en secondes,
   * `image` = numéro d'image (phases du LOD).
   */
  maj(zombies: readonly ZombieVue[], n: number, cam: Vec3, regardX: number, regardZ: number, dt: number, image: number, rappels?: RappelsZombies): void;
  /** Le modèle est chargé et tous les clones du pool sont créés. */
  pret(): boolean;
  /** Tigres dessinés à la dernière image (essais). */
  affiches(): number;
  dispose(): void;
}

interface Emplacement {
  tigre: Tigre;
  groupe: THREE.Group;
  anim: AnimZombie;
  maillages: THREE.SkinnedMesh[];
  /** tigre qui l'occupe (0 = libre), type de la teinte courante, dt accumulé depuis la dernière pose, dernière image où il a servi */
  id: number;
  type: number;
  dtAcc: number;
  vuImage: number;
}

export function creerRenduZombies(scene: THREE.Scene): RenduZombies {
  const racine = new THREE.Group();
  racine.name = "zombies";
  scene.add(racine);
  const aDisposer: { dispose(): void }[] = [];

  // ---- silhouettes en boîtes (modèle pas encore prêt) ----
  const geoBoite = new THREE.BoxGeometry(BOITE.w, BOITE.h, BOITE.l);
  geoBoite.translate(0, BOITE.h / 2, 0);
  aDisposer.push(geoBoite);
  const matBoites = TEINTES_ZOMBIES.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  aDisposer.push(...matBoites);
  const boites: THREE.Mesh[] = [];
  for (let i = 0; i < TAILLE_POOL; i++) {
    const b = new THREE.Mesh(geoBoite, matBoites[0]);
    b.visible = false;
    racine.add(b);
    boites.push(b);
  }

  // ---- pool de tigres 3D ----
  const emplacements: Emplacement[] = [];
  const parId = new Map<number, Emplacement>();
  let modele: ModeleTigre | null = null;
  let echec = false;
  let detruit = false;
  let matPrives: THREE.MeshBasicMaterial[] = [];
  let nAffiches = 0;
  const geosPrivees = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();

  chargerModele().then((m) => {
    if (detruit) return;
    modele = m;
    // UNE copie privée de la texture (partagée par les trois matériaux) ; la géométrie est copiée à la création du premier clone
    const origine = m.maillages[0]?.material as THREE.MeshBasicMaterial | undefined;
    let carte: THREE.Texture | null = null;
    if (origine?.map) { carte = origine.map.clone(); carte.needsUpdate = true; aDisposer.push(carte); }
    matPrives = TEINTES_ZOMBIES.map((c) => {
      const mat = new THREE.MeshBasicMaterial({ color: c });
      if (carte) mat.map = carte;
      aDisposer.push(mat);
      return mat;
    });
  }).catch(() => { echec = true; });

  function geometriePrivee(orig: THREE.BufferGeometry): THREE.BufferGeometry {
    let g = geosPrivees.get(orig);
    if (!g) {
      g = orig.clone();
      // la main humaine du thème Tigre n'a rien à faire ici : ni cibles de déformation, ni attribut dédié
      g.morphAttributes = {};
      g.morphTargetsRelative = false;
      if (g.getAttribute("mainHumaine")) g.deleteAttribute("mainHumaine");
      geosPrivees.set(orig, g);
      aDisposer.push(g);
    }
    return g;
  }

  function creerEmplacement(m: ModeleTigre): Emplacement {
    const tigre = creerTigre(m);
    const maillages: THREE.SkinnedMesh[] = [];
    tigre.groupe.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) maillages.push(o as THREE.SkinnedMesh); });
    for (const mesh of maillages) {
      mesh.geometry = geometriePrivee(mesh.geometry);
      mesh.material = matPrives[0];
      if (mesh.morphTargetInfluences?.length) mesh.morphTargetInfluences[0] = 0;
      mesh.frustumCulled = false;
    }
    tigre.ombre.visible = false;
    const groupe = new THREE.Group();
    groupe.visible = false;
    groupe.add(tigre.groupe);
    racine.add(groupe);
    const e: Emplacement = { tigre, groupe, anim: creerAnimZombie(emplacements.length + 1), maillages, id: 0, type: 0, dtAcc: 0, vuImage: -1 };
    emplacements.push(e);
    return e;
  }

  function teinter(e: Emplacement, type: number): void {
    if (e.type === type) return;
    e.type = type;
    const mat = matPrives[Math.min(type, matPrives.length - 1)];
    for (const mesh of e.maillages) mesh.material = mat;
  }

  function emplacementLibre(): Emplacement | null {
    for (const e of emplacements) if (e.id === 0) return e;
    return null;
  }

  return {
    maj(zombies, n, cam, regardX, regardZ, dt, image, rappels) {
      nAffiches = 0;
      // création étalée du pool : 2 clones par image
      if (modele && !echec) {
        for (let k = 0; k < CREATIONS_PAR_IMAGE && emplacements.length < TAILLE_POOL; k++) creerEmplacement(modele);
      }
      const prets = modele !== null && emplacements.length > 0;
      // rend les emplacements des tigres disparus
      for (const [id, e] of parId) {
        if (e.vuImage === image) continue;
        parId.delete(id);
        e.id = 0;
        e.groupe.visible = false;
      }
      for (let i = 0; i < TAILLE_POOL; i++) boites[i].visible = false;

      for (let i = 0; i < n; i++) {
        const v = zombies[i];
        const d = Math.hypot(v.x - cam[0], v.z - cam[2]);
        const affiche = tigreAffiche(cam, regardX, regardZ, v.x, v.z);
        if (!prets) {
          // modèle pas prêt : silhouette en boîte (jamais plus de 24, le serveur plafonne)
          if (!affiche || i >= boites.length) continue;
          const b = boites[i];
          b.visible = true;
          b.material = matBoites[v.type];
          b.position.set(v.x, 0, v.z);
          b.rotation.y = v.cap;
          b.scale.setScalar(v.echelle);
          nAffiches++;
          continue;
        }
        let e = parId.get(v.id);
        if (!e) {
          e = emplacementLibre() ?? undefined;
          if (!e) continue; // pool pas encore entièrement créé : il apparaîtra dans quelques images
          e.id = v.id;
          e.dtAcc = 0;
          parId.set(v.id, e);
          teinter(e, v.type);
        }
        e.vuImage = image;
        e.dtAcc = Math.min(0.25, e.dtAcc + dt);
        if (v.type !== e.type) teinter(e, v.type);
        e.groupe.visible = affiche;
        if (!affiche) continue;
        nAffiches++;
        e.groupe.position.set(v.x, 0, v.z);
        e.groupe.rotation.y = v.cap + Math.PI / 2;
        e.tigre.groupe.scale.setScalar(v.echelle);
        if (animerCetteImage(d, image, v.id)) {
          const lancee = e.anim.maj(e.dtAcc, v.vitesse, v.echelle, v.griffe);
          e.dtAcc = 0;
          e.tigre.appliquer(e.anim.pose(), e.anim.x());
          if (lancee) rappels?.surGriffe(v);
        }
      }
    },
    pret() {
      return modele !== null && emplacements.length >= TAILLE_POOL;
    },
    affiches() {
      return nAffiches;
    },
    dispose() {
      detruit = true;
      scene.remove(racine);
      for (const e of emplacements) {
        for (const mesh of e.maillages) mesh.skeleton.dispose();
        e.tigre.dispose();
      }
      emplacements.length = 0;
      parId.clear();
      for (const x of aDisposer) x.dispose();
      aDisposer.length = 0;
    },
  };
}
