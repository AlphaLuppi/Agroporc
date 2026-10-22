/**
 * Tigre caché de la vue Palantir : le GLB du thème Tigre (chargerModele de lib/tigre3d/modele.ts,
 * cache partagé), cloné, posé en grandeur réelle dans une cachette tirée par
 * lib/agroparc3d/cachettes.ts. Un clic (moins de 6 px de glissement entre l'appui et le
 * relâchement) sur une sphère invisible de 2,5 m autour de lui le débusque. Il disparaît puis
 * revient 1,5 s plus tard dans une autre cachette.
 *
 * Ce module ne libère jamais le modèle partagé (libererModele) : le tigre du thème Tigre s'en sert
 * peut-être sous la vue. Il ne libère que ce qu'il crée (copie assombrie du matériau, sphère).
 */
import * as THREE from "three";
import { chargerModele, creerTigre, type Tigre } from "../tigre3d/modele";
import { ECHELLE_MODELE } from "../tigre3d/troupe";
import type { PoseTigre } from "../tigre3d/squelette";
import { avancerCorps, creerCorps, GROUPES } from "../tigre3d/corps";
import { tete } from "../tigre3d/gestes/outils";
import type { PoseGeste } from "../tigre3d/gestes/types";
import type { Groupe } from "../tigre3d/os";
import { aleaGraine, tirerCachette, type Cachette } from "./cachettes";

/** Rayon (m) de la sphère de clic, centrée sur le corps. */
export const RAYON_CLIC_M = 2.5;
/** Glissement maximal (px) entre l'appui et le relâchement pour compter un clic. */
export const SEUIL_CLIC_PX = 6;
/** Délai (s) avant le retour du tigre dans une autre cachette. */
export const DELAI_RETOUR_S = 1.5;
/**
 * Teinte multipliée à la texture : le matériau du GLB est sans éclairage, un pelage blanc à 0,2
 * reste sous le seuil du halo (UnrealBloomPass, 0,24) et ne brille pas sur le fond noir.
 */
const TEINTE = 0.2;
/** Le tigre se tapit : corps abaissé (m du modèle, pattes repliées par l'IK), museau vers le sol, tête basse. */
const TAPI = { dy: -0.09, tangage: -0.03, baisseTete: 0.3 };

/**
 * Pose tapie, sans animation : le moteur du tigre (lib/tigre3d/corps.ts) à l'arrêt, pattes au
 * sol, avec une couche « corps abaissé, tête basse ». Quelques secondes simulées laissent les
 * ressorts se poser. Calculée une fois par tigre.
 */
function poseTapie(): { pose: PoseTigre; x: number } {
  const corps = creerCorps({ cap: 0, graine: 7 });
  const deltas: NonNullable<PoseGeste["deltas"]> = {};
  tete(deltas, 0, 0, TAPI.baisseTete);
  const poids = Object.fromEntries(GROUPES.map((x) => [x, 0])) as Record<Groupe, number>;
  poids.corps = 1; poids.cou = 1; poids.tete = 1;
  const couche = { pose: { corps: { dy: TAPI.dy, tangage: TAPI.tangage, pivot: "hanches" as const }, deltas }, poids };
  for (let i = 0; i < 120; i++) avancerCorps(corps, 1 / 30, { vitesse: 0, sens: 1, cap: 0, regard: 0, couches: [couche] });
  return { pose: corps.pose, x: corps.x };
}

/** Cachettes récentes, gardées d'une ouverture de la vue à l'autre (règle des 80 m). */
const precedentes: Cachette[] = [];

export interface TigreCache {
  /** Cachette où le tigre est posé (null pendant l'absence de 1,5 s ou avant le chargement). */
  cachette(): Cachette | null;
  /** Le tigre est débusqué (clic ou crochet de développement) : rend la cachette trouvée. */
  debusquer(): Cachette | null;
  /** Pose le tigre dans une cachette donnée (crochet de développement). */
  placer(c: Cachette): void;
  /** Position monde du corps (pour viser la caméra). */
  centre(sortie: THREE.Vector3): THREE.Vector3 | null;
  maj(dt: number): void;
  dispose(): void;
}

export interface OptionsTigre {
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  cachettes: readonly Cachette[];
  /** Le joueur a trouvé le tigre. */
  surDebusque(c: Cachette): void;
  /** Le modèle n'a pas pu se charger : pas de chasse, sans bruit. */
  surEchec?(e: unknown): void;
  alea?: () => number;
}

export function creerTigreCache(o: OptionsTigre): TigreCache {
  const alea = o.alea ?? aleaGraine((Math.random() * 2 ** 31) | 0);
  const conteneur = new THREE.Group();
  conteneur.visible = false;
  o.scene.add(conteneur);

  // Sphère de clic : invisible (jamais dessinée), mais le raycaster de three l'atteint quand même.
  const geoClic = new THREE.SphereGeometry(RAYON_CLIC_M, 12, 8);
  const matClic = new THREE.MeshBasicMaterial();
  const sphere = new THREE.Mesh(geoClic, matClic);
  sphere.visible = false;
  sphere.position.y = 0.8;
  conteneur.add(sphere);

  let tigre: Tigre | null = null;
  let matsSombres: THREE.Material[] = [];
  let courante: Cachette | null = null;
  let retourDans = -1;
  let detruit = false;
  let pose: PoseTigre | null = null;

  function placer(c: Cachette) {
    courante = c;
    precedentes.push(c);
    if (precedentes.length > 5) precedentes.shift();
    conteneur.position.set(c.x, 0, c.z);
    conteneur.rotation.y = c.cap;
    conteneur.visible = !!tigre;
    retourDans = -1;
  }
  function tirer() {
    const c = tirerCachette(o.cachettes, precedentes, alea);
    if (c) placer(c);
  }

  chargerModele().then((m) => {
    if (detruit) return;
    const t = creerTigre(m);
    // Copie assombrie du matériau, sur ce clone seulement : le tigre du thème Tigre garde l'original.
    const vus = new Map<THREE.Material, THREE.Material>();
    t.groupe.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const orig = mesh.material as THREE.MeshBasicMaterial;
      let copie = vus.get(orig);
      if (!copie) {
        const c = orig.clone();
        c.color.multiplyScalar(TEINTE);
        vus.set(orig, c);
        copie = c;
      }
      mesh.material = copie;
    });
    matsSombres = [...vus.values()];
    t.groupe.scale.setScalar(ECHELLE_MODELE);
    // Pas d'ombre portée : son disque gris sur le fond noir trahirait la cachette.
    t.groupe.children.filter((c) => (c as THREE.Mesh).isMesh && !(c as THREE.SkinnedMesh).isSkinnedMesh).forEach((c) => { c.visible = false; });
    conteneur.add(t.groupe);
    tigre = t;
    poser();
    if (courante) conteneur.visible = true;
    else tirer();
  }).catch((e) => { if (!detruit) o.surEchec?.(e); });

  /** Pose fixe, calculée une fois (le tigre ne bouge pas, cf. `poseTapie`). */
  function poser() {
    if (!tigre || pose) return;
    const tapie = poseTapie();
    pose = tapie.pose;
    tigre.appliquer(pose, tapie.x);
  }

  // Clic : appui et relâchement du même pointeur, moins de 6 px entre les deux, un seul doigt.
  const appuis = new Map<number, { x: number; y: number }>();
  let multi = false;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const surAppui = (e: PointerEvent) => {
    appuis.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (appuis.size > 1) multi = true;
  };
  const surRelache = (e: PointerEvent) => {
    const a = appuis.get(e.pointerId);
    appuis.delete(e.pointerId);
    const clic = a && !multi && Math.hypot(e.clientX - a.x, e.clientY - a.y) < SEUIL_CLIC_PX;
    if (appuis.size === 0) multi = false;
    if (!clic || !courante || !conteneur.visible) return;
    const r = o.canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, o.camera);
    // Uniquement la sphère : three teste un maillage animé dans sa pose de repos.
    if (raycaster.intersectObject(sphere, false).length) debusquer();
  };
  const surAnnule = (e: PointerEvent) => { appuis.delete(e.pointerId); if (appuis.size === 0) multi = false; };
  o.canvas.addEventListener("pointerdown", surAppui);
  o.canvas.addEventListener("pointerup", surRelache);
  o.canvas.addEventListener("pointercancel", surAnnule);

  function debusquer(): Cachette | null {
    const c = courante;
    if (!c) return null;
    courante = null;
    conteneur.visible = false;
    retourDans = DELAI_RETOUR_S;
    o.surDebusque(c);
    return c;
  }

  return {
    cachette: () => courante,
    debusquer,
    placer,
    centre(sortie) {
      if (!courante) return null;
      return sortie.set(courante.x, 0.8, courante.z);
    },
    maj(dt) {
      if (retourDans > 0) {
        retourDans -= dt;
        if (retourDans <= 0) tirer();
      }
    },
    dispose() {
      detruit = true;
      o.canvas.removeEventListener("pointerdown", surAppui);
      o.canvas.removeEventListener("pointerup", surRelache);
      o.canvas.removeEventListener("pointercancel", surAnnule);
      // Retiré de la scène AVANT que scene.ts ne libère tout ce qu'elle contient : la géométrie et
      // la texture du clone sont celles du modèle partagé.
      o.scene.remove(conteneur);
      tigre?.dispose();
      matsSombres.forEach((m) => m.dispose());
      geoClic.dispose();
      matClic.dispose();
    },
  };
}
