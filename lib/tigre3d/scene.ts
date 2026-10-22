/**
 * Scène three.js du tigre 3D : un seul renderer WebGL à fond transparent, réutilisé d'un passage
 * à l'autre, qui dessine la troupe (lib/tigre3d/troupe.ts) dans un canvas que l'on translate en
 * CSS. Chargée à la demande depuis `TigreCourant` (thème Tigre seulement) : three n'alourdit pas
 * les autres thèmes, et le GLB du tigre (≈ 0,5 Mo) n'est téléchargé qu'au premier passage
 * (`precharger`, `pret`). La boucle requestAnimationFrame ne tourne que pendant un passage.
 */
import * as THREE from "three";
import { chargerModele, creerTigre, libererModele, type ModeleTigre, type Tigre } from "./modele";
import { creerTroupe, etendueTroupe, ECHELLE_MODELE, type Troupe } from "./troupe";
import { borne } from "./ressorts";
import { squelette } from "./squelette";
import type { Role } from "./os";
import type { EvenementTigre } from "./animateur";
import { PETITS_MAX, petitsPourEvenement, type Evenement } from "../tigre-courant";
import { poidsMainHumaine } from "./gestes/serre-main";

/** Hauteur de la fenêtre de vue en mètres de tigre : fixe l'échelle (px par mètre = hauteur du canvas / VUE_M). */
export const VUE_M = 3.86;
/**
 * Marge au-dessus de la vue (m de tigre) : debout (serre-main), en l'air (saut, sursaut), les
 * oreilles dépassaient du haut du canvas. Le canvas est plus haut de cette marge, la caméra et
 * l'échelle ne changent pas (setViewOffset : on étend le cadre vers le haut seulement).
 */
export const MARGE_HAUT_M = 0.85;
/** Un tigre adulte (museau → bout de la queue) mesure 3,75 m. */
export const LONGUEUR_TIGRE_M = 3.75;
/** Pas de temps maximal d'une image (s) : un onglet qui reprend la main ne fait pas sauter la course. */
const DT_IMAGE_MAX = 0.05;

export interface Point { x: number; y: number }
export interface Zone { x: number; y: number; w: number; h: number }

/** Ce que la scène apprend à l'hôte à chaque image : de quoi placer zones de clic, bulle et particules. */
export interface InfosImage {
  /** Une zone de clic par tigre (la mère en premier), en px dans le repère du canvas. */
  zones: Zone[];
  /** Au-dessus de la tête de la mère : pied de la bulle. */
  bulle: Point;
  tete: Point;
  /** Patte avant levée (tope là) de la mère. */
  patte: Point;
  /** Bord gauche du canvas dans la page. */
  gauche: number;
  /** Horloge de la mère (s) : l'hôte y cale la durée des bulles, qui suit ainsi le temps de la scène (pause comprise). */
  temps: number;
}

export interface RappelsScene {
  evenement(e: EvenementTigre): void;
  image(i: InfosImage): void;
  /** Tous les tigres ont quitté l'écran. */
  fin(): void;
}

export interface ParamsPassage {
  evenement: Evenement;
  petits: number;
  sens: 1 | -1;
  /** Vitesse en largeurs de tigre par seconde. */
  vitesse: number;
  largeurEcran: number;
  /** Largeur d'un tigre adulte à l'écran (px) : fixe l'échelle et l'unité de vitesse. */
  largeurTigrePx: number;
}

export interface Scene3D {
  /** Le modèle est chargé : un passage peut partir. */
  pret(): boolean;
  /** Lance le chargement du modèle (une fois) ; rejetée si le GLB ne se charge pas. */
  precharger(): Promise<void>;
  /** Démarre un passage (le modèle doit être prêt) ; retourne la taille du canvas (px CSS). */
  lancer(p: ParamsPassage, rappels: RappelsScene): { largeur: number; hauteur: number };
  clic(): "lancer" | "taper" | "ignorer";
  /** Réaction précise (tests, crochet de développement). */
  forcer(nom: Parameters<Troupe["mere"]["anim"]["clic"]>[0]): "lancer" | "taper" | "ignorer";
  /** Arrête la boucle et cache le canvas (fin de passage ou démontage). */
  arreter(): void;
  /** Gèle ou relance la boucle (tests visuels) ; gelée, `avancer` fait avancer le temps à la main. */
  geler(gele: boolean): void;
  avancer(dt: number): void;
  troupe(): Troupe | null;
  dispose(): void;
}

export interface OptionsScene {
  dprMax?: number;
  /** Le contexte WebGL est perdu : l'hôte bascule sur le sprite. */
  surPerte?(): void;
  /** URL du GLB (défaut : /tigre/tigre.glb, servi depuis public/) ; une page autonome passe un blob. */
  urlModele?: string;
}

/** Texture de la traînée : dégradé orange vers transparent (opaque à droite) et traits sombres horizontaux. */
function texturetraine(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, "rgba(255,140,0,0)");
  g.addColorStop(0.75, "rgba(255,140,0,0.8)");
  g.addColorStop(1, "rgba(255,140,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 64);
  ctx.globalCompositeOperation = "destination-out";
  // Stries : des traits transparents donnent l'effet de lignes de vitesse.
  for (let y = 12; y < 54; y += 9) {
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(0, y, 256, 2.5);
  }
  // Bords haut et bas estompés.
  ctx.globalCompositeOperation = "destination-in";
  const v = ctx.createLinearGradient(0, 0, 0, 64);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.3, "rgba(0,0,0,1)");
  v.addColorStop(0.7, "rgba(0,0,0,1)"); v.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function creerScene(canvas: HTMLCanvasElement, opts: OptionsScene = {}): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(opts.dprMax ?? 2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const surPerte = (e: Event) => { e.preventDefault(); opts.surPerte?.(); };
  canvas.addEventListener("webglcontextlost", surPerte);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  // Légère plongée (~11°) : on voit le dessus du dos et le sol, jamais un profil parfaitement plat.
  camera.position.set(0, 2.05, 7.2);
  camera.lookAt(0, 1.35, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  scene.add(new THREE.HemisphereLight(0xfff2e0, 0x8a5a3a, 1.0));
  const soleil = new THREE.DirectionalLight(0xffffff, 2.6);
  soleil.position.set(-2.5, 5, 6);
  scene.add(soleil);

  // Traînée de l'éclair : bande orange striée de sombre, plus opaque côté tigre (droite de la texture).
  const texTraine = texturetraine();
  const matTraine = new THREE.MeshBasicMaterial({
    map: texTraine, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const traine = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.8), matTraine);
  traine.renderOrder = -1;
  traine.visible = false;
  scene.add(traine);

  const tigres: Tigre[] = [];
  let modele: ModeleTigre | null = null;
  let chargement: Promise<void> | null = null;
  const tigre = (i: number): Tigre => {
    if (!modele) throw new Error("tigre 3D : modèle pas encore chargé");
    while (tigres.length <= i) {
      const t = creerTigre(modele);
      t.groupe.visible = false;
      scene.add(t.groupe);
      tigres.push(t);
    }
    return tigres[i];
  };
  const precharger = () => {
    chargement ??= chargerModele(opts.urlModele).then((m) => {
      modele = m;
      tigre(0);
      renderer.compile(scene, camera);
    });
    chargement.catch(() => { chargement = null; });
    return chargement;
  };
  const sq = squelette();
  let troupe: Troupe | null = null;
  let rappels: RappelsScene | null = null;
  let largeurCanvas = 0, hauteurCanvas = 0, pxm = 1;
  let raf = 0, dernier = 0, secousse = 0, gele = false;
  const v = new THREE.Vector3();

  /** Point du monde → px dans le canvas. */
  const projeter = (p: THREE.Vector3): Point => {
    v.copy(p).project(camera);
    return { x: (v.x * 0.5 + 0.5) * largeurCanvas, y: (-v.y * 0.5 + 0.5) * hauteurCanvas };
  };
  const monde = (os: THREE.Object3D, dy = 0): Point => {
    os.getWorldPosition(v);
    v.y += dy;
    return projeter(v.clone());
  };

  const os = (t: Tigre, r: Role) => t.os[sq.i[r]];
  const ZONE_OS: Role[] = [
    "bout_tete", "oreille_pointeG", "oreille_pointeD", "thorax", "lombaires", "queue2",
    "bout_mainG", "bout_mainD", "mainG", "mainD", "bout_piedG", "bout_piedD",
  ];
  /** Zone de clic d'un tigre : boîte englobante (écran) de quelques os, élargie pour le doigt. */
  function zoneTigre(t: Tigre, echelle: number): Zone {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const nom of ZONE_OS) {
      const p = monde(os(t, nom));
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    // Marge : la patte levée (tope là), dont le coussinet dépasse l'os du bout de la patte, reste dedans.
    const marge = Math.max(14, 0.24 * pxm * echelle);
    x0 -= marge; x1 += marge; y0 -= marge * 0.5; y1 += marge * 0.4;
    // Jamais plus petite qu'un doigt (44 px).
    const w = Math.max(44, x1 - x0), h = Math.max(44, y1 - y0);
    return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
  }

  /** Pied de la bulle : au-dessus des oreilles et de la truffe, mais aussi du dos et de la queue dressée. */
  function pointBulle(t: Tigre, echelle: number): Point {
    const tete = monde(os(t, "bout_tete"));
    const marge = 0.12 * pxm * echelle;
    let haut = Math.min(tete.y, monde(os(t, "oreille_pointeG")).y, monde(os(t, "oreille_pointeD")).y);
    haut = Math.min(haut, monde(os(t, "lombaires")).y, monde(os(t, "thorax")).y) - marge;
    // Queue dressée : si son bout passe sous la bulle, la bulle monte au-dessus (poids continu).
    const bout = monde(os(t, "bout_queue"));
    const poids = borne(1 - (Math.abs(bout.x - tete.x) - 60) / 60, 0, 1);
    haut = Math.min(haut, haut + (bout.y - 14 - haut) * poids);
    const oreilles = (monde(os(t, "oreille_pointeG")).x + monde(os(t, "oreille_pointeD")).x) / 2;
    return { x: (tete.x + oreilles) / 2, y: haut };
  }

  /** Patte levée (tope là) : la main la plus haute. */
  function patteLevee(t: Tigre): Point {
    const g = os(t, "bout_mainG").getWorldPosition(v).y, d = os(t, "bout_mainD").getWorldPosition(v).y;
    return monde(os(t, g > d ? "bout_mainG" : "bout_mainD"));
  }

  function dessiner() {
    if (!troupe) return;
    const centre = troupe.centre();
    troupe.membres.forEach((m, i) => {
      const t = tigre(i);
      t.groupe.visible = true;
      t.groupe.scale.setScalar(ECHELLE_MODELE * m.echelle);
      t.groupe.position.set((m.x - centre) / pxm, 0, m.z);
      t.appliquer(m.anim.pose, m.anim.corps.x);
      // Main humaine : la mère seulement, pendant la poignée de main de « serre-main ».
      const r = m.anim.reaction;
      t.mainHumaine(i === 0 && r?.nom === "serre-main" && r.tGeste != null ? poidsMainHumaine(m.anim.t - r.tGeste) : 0);
    });
    const m0 = troupe.mere;
    const eclair = m0.anim.mode === "eclair" && m0.anim.reaction === null && m0.anim.facteurVitesse > 0.5;
    traine.visible = eclair;
    if (eclair) {
      traine.position.set((m0.x - centre) / pxm - m0.anim.sens * 2.3, 0.85, -0.1);
      traine.scale.x = m0.anim.sens;
      matTraine.opacity = Math.min(1, (m0.anim.facteurVitesse - 0.5) * 2);
    }
    renderer.render(scene, camera);
    const gauche = centre - largeurCanvas / 2;
    const dx = secousse > 0 ? (Math.random() - 0.5) * 6 * secousse : 0;
    const dy = secousse > 0 ? (Math.random() - 0.5) * 4 * secousse : 0;
    canvas.style.transform = `translate3d(${gauche + dx}px, ${dy}px, 0)`;
    if (!rappels) return;
    const mere = tigre(0);
    rappels.image({
      gauche,
      temps: troupe.mere.anim.t,
      zones: troupe.membres.map((m, i) => zoneTigre(tigre(i), m.echelle)),
      tete: monde(os(mere, "bout_tete")),
      bulle: pointBulle(mere, 1),
      patte: patteLevee(mere),
    });
  }

  function image(now: number) {
    raf = 0;
    if (!troupe) return;
    const dt = borne((now - dernier) / 1000, 0, DT_IMAGE_MAX);
    dernier = now;
    if (secousse > 0) secousse = Math.max(0, secousse - dt / 0.9);
    troupe.maj(dt);
    dessiner();
    if (troupe.termine) { terminer(); return; }
    if (!gele) raf = requestAnimationFrame(image);
  }

  function terminer() {
    const r = rappels;
    arreter();
    r?.fin();
  }

  function arreter() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    troupe = null;
    rappels = null;
    secousse = 0;
    canvas.style.visibility = "hidden";
    for (const t of tigres) t.groupe.visible = false;
  }

  const redemarrerHorloge = () => { dernier = performance.now(); };
  document.addEventListener("visibilitychange", redemarrerHorloge);

  return {
    pret: () => modele !== null,
    precharger,
    lancer(p, r) {
      arreter();
      if (!modele) { void precharger(); return { largeur: 0, hauteur: 0 }; }
      rappels = r;
      pxm = p.largeurTigrePx / LONGUEUR_TIGRE_M;
      const petits = petitsPourEvenement(p.evenement, Math.min(p.petits, PETITS_MAX));
      const { devant, derriere } = etendueTroupe(petits);
      largeurCanvas = Math.round(Math.max(6.4, derriere + devant + 1.4) * pxm);
      const hauteurVue = Math.round(VUE_M * pxm), marge = Math.round(MARGE_HAUT_M * pxm);
      hauteurCanvas = hauteurVue + marge;
      renderer.setSize(largeurCanvas, hauteurCanvas, true);
      camera.aspect = largeurCanvas / hauteurVue;
      camera.setViewOffset(largeurCanvas, hauteurVue, 0, -marge, largeurCanvas, hauteurCanvas);
      camera.updateProjectionMatrix();
      troupe = creerTroupe({
        evenement: p.evenement, petits, sens: p.sens, vitesse: p.vitesse,
        largeurEcran: p.largeurEcran, largeurTigrePx: p.largeurTigrePx, pxParMetre: pxm,
      });
      troupe.sur((e) => {
        if (e.type === "secousse") secousse = 1;
        rappels?.evenement(e);
      });
      troupe.membres.forEach((_, i) => tigre(i));
      redemarrerHorloge();
      dessiner();
      canvas.style.visibility = "visible";
      if (!gele) raf = requestAnimationFrame(image);
      return { largeur: largeurCanvas, hauteur: hauteurCanvas };
    },
    clic: () => troupe?.clic() ?? "ignorer",
    forcer: (nom) => troupe?.mere.anim.clic(nom) ?? "ignorer",
    arreter,
    geler(v) {
      gele = v;
      if (v && raf) { cancelAnimationFrame(raf); raf = 0; }
      else if (!v && troupe && !raf) { redemarrerHorloge(); raf = requestAnimationFrame(image); }
    },
    avancer(dt) {
      if (!troupe) return;
      troupe.maj(dt);
      dessiner();
    },
    troupe: () => troupe,
    dispose() {
      arreter();
      document.removeEventListener("visibilitychange", redemarrerHorloge);
      canvas.removeEventListener("webglcontextlost", surPerte);
      for (const t of tigres) { scene.remove(t.groupe); t.dispose(); }
      traine.geometry.dispose(); matTraine.dispose(); texTraine.dispose();
      tigres.length = 0;
      libererModele();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
