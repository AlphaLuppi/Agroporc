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
 * v7 : quatre teintes (tigre, doré qui luit, chef coiffé d'une toque, petit), sortie du sol, arrachage des planches, saut par la fenêtre,
 * rampant, recul à l'impact et trois morts (de côté, en avant à la tête, projeté par une explosion) : le cadavre garde son emplacement
 * `DUREE_CADAVRE_S` puis s'enfonce.
 * Aucun test vitest (three, WebGL) : la logique est dans `jeu-zombies.ts` et `zombies-anim.ts`, les régressions se voient aux captures.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Rendu et performances côté client »), 2026-10-28-zombies-bo1-design.md (« Animations »)
 */
import * as THREE from "three";
import { chargerModele, creerTigre, type ModeleTigre, type Tigre } from "../tigre3d/modele";
import { animerCetteImage, tigreAffiche, type ZombieVue } from "./jeu-zombies";
import { JEU, type Vec3 } from "./protocole";
import { creerAnimZombie, type AnimZombie } from "./zombies-anim";
import { ZOMBIES } from "./zombies-vagues";

/** Taille du pool (= plafond de tigres vivants) et nombre de clones créés par image. */
export const TAILLE_POOL = ZOMBIES.plafondVivants;
export const CREATIONS_PAR_IMAGE = 2;
/** Teintes multipliées à la texture du pelage : tigre brun sombre, doré, chef rouge sombre, petit plus clair. */
export const TEINTES_ZOMBIES: readonly number[] = [0x6e5442, 0xffd25a, 0x8c2a24, 0xc49a74];
/** Un cadavre reste à l'écran cette durée (s), dont la dernière seconde à s'enfoncer. */
export const DUREE_CADAVRE_S = 2.6;
/** Profondeur (m) d'où sort un tigre qui émerge du sol. */
const PROFONDEUR_SOL_M = 1.7;
/** Façon de mourir (cause du message `zombieMort`). */
export type MortZombie = "corps" | "tete" | "explosion" | "nuke" | "melee";
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
  /** (v7) le tigre `id` vient de mourir : son emplacement joue la mort puis s'enfonce */
  mort(id: number, cause: MortZombie): void;
  /** (v7) le tigre `id` est touché (recul : la tête à la tête, l'épaule au corps) */
  touche(id: number, tete: boolean): void;
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
  /** drapeau « griffe armée » de l'image précédente (front montant du son, indépendant du culling et du LOD) */
  griffePrec: boolean;
  /** (v7) instant local (s) du début du mode courant (sortie du sol, saut), recul à l'impact, mort en cours */
  mode: string;
  modeT: number;
  recul: number;
  reculSens: number;
  mortT: number;
  mortCause: MortZombie | null;
  /** dernière pose connue (le cadavre se fige là) */
  x: number; z: number; cap: number; echelle: number;
  /** prochain coup de patte sur les planches (s, horloge locale) */
  arracheT: number;
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
  /** horloge locale (s) du rendu des tigres */
  let tempsLocal = 0;
  /** numéro de l'image du `maj` précédent */
  let imagePrec = -1;
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
    const e: Emplacement = {
      tigre, groupe, anim: creerAnimZombie(emplacements.length + 1), maillages, id: 0, type: 0, dtAcc: 0, vuImage: -1, griffePrec: false,
      mode: "chasse", modeT: 0, recul: 0, reculSens: 1, mortT: -1, mortCause: null, x: 0, z: 0, cap: 0, echelle: 1, arracheT: 0,
    };
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
    for (const e of emplacements) if (e.id === 0 && e.mortCause === null) return e;
    // pool plein : le plus vieux cadavre cède sa place
    let vieux: Emplacement | null = null;
    for (const e of emplacements) if (e.mortCause !== null && (!vieux || e.mortT < vieux.mortT)) vieux = e;
    if (vieux) { vieux.mortCause = null; vieux.groupe.visible = false; vieux.id = 0; }
    return vieux;
  }

  // ---- lueur du tigre doré, toque du chef ----
  const texLueur = (() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (!g) return null;
    const d = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    d.addColorStop(0, "rgba(255,220,120,0.85)"); d.addColorStop(1, "rgba(255,180,60,0)");
    g.fillStyle = d; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    aDisposer.push(t);
    return t;
  })();
  const lueurs: THREE.Sprite[] = [];
  const matLueur = new THREE.SpriteMaterial({ map: texLueur, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  aDisposer.push(matLueur);
  const geoToque = new THREE.CylinderGeometry(0.16, 0.13, 0.28, 12);
  const geoBouffant = new THREE.SphereGeometry(0.22, 12, 8);
  const matToque = new THREE.MeshBasicMaterial({ color: 0xf2f2ec });
  aDisposer.push(geoToque, geoBouffant, matToque);
  const toques: THREE.Group[] = [];
  let nLueurs = 0, nToques = 0;
  const _tete = new THREE.Vector3();
  function lueurSuivante(): THREE.Sprite {
    let l = lueurs[nLueurs];
    if (!l) { l = new THREE.Sprite(matLueur); racine.add(l); lueurs.push(l); }
    nLueurs++;
    l.visible = true;
    return l;
  }
  function toqueSuivante(): THREE.Group {
    let g = toques[nToques];
    if (!g) {
      g = new THREE.Group();
      const c = new THREE.Mesh(geoToque, matToque);
      const b = new THREE.Mesh(geoBouffant, matToque);
      b.position.y = 0.2; b.scale.set(1, 0.6, 1);
      g.add(c, b);
      racine.add(g);
      toques.push(g);
    }
    nToques++;
    g.visible = true;
    return g;
  }
  const osTete = new WeakMap<Emplacement, THREE.Bone | null>();
  function tete(e: Emplacement): THREE.Bone | null {
    if (!osTete.has(e)) osTete.set(e, e.tigre.os.find((o) => o.name.startsWith("Bone017")) ?? null);
    return osTete.get(e) ?? null;
  }

  /** Pose du groupe selon le mode (sortie du sol, saut, rampant), le recul et la mort. */
  function poser(e: Emplacement, v: { x: number; z: number; cap: number; echelle: number; mode: string; allure: number }, tLocal: number, dt: number): void {
    e.recul *= Math.exp(-dt * 9);
    let y = 0, tangage = 0;
    if (v.mode === "sol") {
      const k = Math.min(1, (tLocal - e.modeT) / 1.6);
      y = -PROFONDEUR_SOL_M * (1 - k) * (1 - k);
      tangage = -0.5 * (1 - k);
    } else if (v.mode === "saut") {
      const k = Math.min(1, (tLocal - e.modeT) / 1.0);
      y = 1.3 * Math.sin(Math.PI * k);
      tangage = -0.35 * Math.cos(Math.PI * k);
    } else if (v.allure === 3) {
      // rampant : l'arrière-train traîne au sol
      y = -0.18 * v.echelle / 2.7;
      tangage = 0.22;
    }
    e.groupe.position.set(v.x, y, v.z);
    e.groupe.rotation.set(0, v.cap + Math.PI / 2, tangage + e.recul * 0.25);
    e.groupe.rotation.x = e.recul * e.reculSens * 0.18;
  }

  /** Mort en cours : de côté, en avant (tête), projeté (explosion) ; s'enfonce la dernière seconde. */
  function poserMort(e: Emplacement, tLocal: number): boolean {
    const u = tLocal - e.mortT;
    if (u >= DUREE_CADAVRE_S) { e.mortCause = null; e.groupe.visible = false; e.id = 0; return false; }
    const k = Math.min(1, u / 0.45);
    const s = 1 - (1 - k) * (1 - k);
    const enfonce = Math.max(0, u - (DUREE_CADAVRE_S - 1)) * 0.9;
    let y = -enfonce, rx = 0, rz = 0;
    switch (e.mortCause) {
      case "tete": rz = -1.1 * s; y -= 0.15 * s; break;
      case "explosion": case "nuke": {
        const v = Math.min(u, 0.9);
        y += Math.max(0, 4 * v - 9.8 * v * v) ; rx = 2.6 * s; rz = 0.8 * s; break;
      }
      default: rx = (e.id % 2 ? 1 : -1) * 1.45 * s; y -= 0.2 * s; break;
    }
    e.groupe.visible = true;
    e.groupe.position.set(e.x, y, e.z);
    e.groupe.rotation.set(rx, e.cap + Math.PI / 2, rz);
    return true;
  }

  return {
    maj(zombies, n, cam, regardX, regardZ, dt, image, rappels) {
      nAffiches = 0;
      // création étalée du pool : 2 clones par image
      if (modele && !echec) {
        for (let k = 0; k < CREATIONS_PAR_IMAGE && emplacements.length < TAILLE_POOL; k++) creerEmplacement(modele);
      }
      const prets = modele !== null && emplacements.length > 0;
      // rend les emplacements des tigres absents de l'image précédente (ceux qu'elle a vus gardent leur emplacement, donc leur animation :
      // comparer à l'image courante les rendait tous à chaque image, et chaque tigre repartait de la pose de repos)
      for (const [id, e] of parId) {
        if (e.vuImage === imagePrec || e.vuImage === image) continue;
        parId.delete(id);
        // un tigre mort garde son emplacement (cadavre) ; les autres disparus le rendent
        if (e.mortCause === null) { e.id = 0; e.groupe.visible = false; }
      }
      tempsLocal += dt;
      for (const e of emplacements) if (e.mortCause !== null && !parId.has(e.id)) poserMort(e, tempsLocal);
      for (let k = 0; k < nLueurs; k++) lueurs[k].visible = false;
      for (let k = 0; k < nToques; k++) toques[k].visible = false;
      nLueurs = 0; nToques = 0;
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
          e.mortCause = null;
          e.mode = v.mode;
          e.modeT = tempsLocal;
          e.recul = 0;
          // l'emplacement a servi à un autre tigre : pose, foulée et geste repartent de zéro (graine propre au tigre)
          e.anim = creerAnimZombie(v.id);
          e.griffePrec = v.griffe;
          parId.set(v.id, e);
          teinter(e, v.type);
        }
        e.vuImage = image;
        // le son de la griffe part au front montant du drapeau, même si le tigre n'est pas dessiné (culling) ou animé cette image (LOD)
        if (v.griffe && !e.griffePrec) rappels?.surGriffe(v);
        e.griffePrec = v.griffe;
        e.dtAcc = Math.min(0.25, e.dtAcc + dt);
        if (v.type !== e.type) teinter(e, v.type);
        if (v.mode !== e.mode) { e.mode = v.mode; e.modeT = tempsLocal; }
        e.x = v.x; e.z = v.z; e.cap = v.cap; e.echelle = v.echelle;
        e.groupe.visible = affiche;
        if (!affiche) continue;
        nAffiches++;
        poser(e, v, tempsLocal, dt);
        e.tigre.groupe.scale.setScalar(v.echelle);
        // à la fenêtre et immobile : il arrache les planches à coups de patte
        let griffe = v.griffe;
        if (v.mode === "fenetre" && v.vitesse < 0.3) {
          if (tempsLocal >= e.arracheT) e.arracheT = tempsLocal + 1.1;
          griffe = griffe || tempsLocal > e.arracheT - 0.55;
        }
        if (animerCetteImage(d, image, v.id)) {
          e.anim.maj(e.dtAcc, v.mode === "sol" ? 0 : v.vitesse * (v.allure === 3 ? 0.6 : 1), v.echelle, griffe, JEU.interpolationMs / 1000);
          e.dtAcc = 0;
          e.tigre.appliquer(e.anim.pose(), e.anim.x());
        }
        if (v.type === 1) {
          const l = lueurSuivante();
          l.position.set(v.x, 1.0 * v.echelle / 2.7 + e.groupe.position.y, v.z);
          l.scale.setScalar(3.2 + 0.4 * Math.sin(tempsLocal * 6 + v.id));
        } else if (v.type === 2) {
          const os = tete(e);
          if (os) {
            os.getWorldPosition(_tete);
            const t = toqueSuivante();
            t.position.set(_tete.x, _tete.y + 0.28 * v.echelle / 2.7, _tete.z);
            t.scale.setScalar(v.echelle / 2.7);
          }
        }
      }
      imagePrec = image;
    },
    pret() {
      return modele !== null && emplacements.length >= TAILLE_POOL;
    },
    mort(id, cause) {
      const e = parId.get(id);
      if (!e) return;
      parId.delete(id);
      e.mortCause = cause;
      e.mortT = tempsLocal;
    },
    touche(id, tete) {
      const e = parId.get(id);
      if (!e) return;
      e.recul = Math.min(1.6, e.recul + (tete ? 1.2 : 0.7));
      e.reculSens = tete ? -1 : (id % 2 ? 1 : -1);
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
