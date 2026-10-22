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
import { creerBatte } from "./batte-maillage";
import { textureCorde } from "../tigre-lasso-rendu";

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
  /** Coup de batte : point de la batte qui touche Macron (éclats de l'impact), null sans batte. */
  batte: Point | null;
}

/**
 * Lasso : position imposée au tigre attrapé, en px du conteneur. `x`, `y` = centre du corps,
 * `angle` = rotation à l'écran (rad, sens horaire) autour de ce centre.
 */
export interface Tenue { x: number; y: number; angle: number }

/** Le tigre vient d'être attrapé : ses repères (px du conteneur), fixes pendant toute la capture. */
export interface Prise {
  /** Centre du corps, pivot de la rotation. */
  centre: Point;
  /** Centre du collier de corde, autour du cou : là où la corde le tient. */
  cou: Point;
  /** Nœud du collier, sur la nuque : la corde en part. */
  noeud: Point;
  /** Axe du cou à l'écran (unitaire, vers la tête) et rayon du collier (px). */
  axe: Point;
  rayon: number;
}

/** Rayon du collier de corde autour du cou (m de scène, tigre de 3,75 m) et épaisseur du fil. */
const RAYON_COLLIER_M = 0.56;
const FIL_COLLIER_PX = 2.8;

export interface RappelsScene {
  evenement(e: EvenementTigre): void;
  /** Lasso : appelée à chaque image avant le dessin, pendant une capture ; null = position naturelle. */
  tenue?(dt: number): Tenue | null;
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
  /** Lasso : attrape la mère (passage d'un tigre seul en cours), null sinon. */
  attraper(): Prise | null;
  /** Lasso : le nœud coulant est serré, le collier de corde apparaît autour du cou (ou disparaît). */
  serrer(v: boolean): void;
  /** Lasso : retombé au sol, centre du corps en `x` (px du conteneur) : il se relève et file. */
  relacher(x: number): void;
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

  // Collier de corde du lasso : un tore texturé posé chaque image autour du cou (le cou le cache
  // derrière lui : la corde entoure vraiment le tigre).
  const texCollier = textureCorde();
  texCollier.repeat.set(16, 1);
  const matCollier = new THREE.MeshStandardMaterial({ map: texCollier, roughness: 0.85 });
  let geoCollier: THREE.TorusGeometry | null = null;
  const collier = new THREE.Mesh(new THREE.BufferGeometry(), matCollier);
  collier.visible = false;
  scene.add(collier);
  let serre = false;

  const tigres: Tigre[] = [];
  // Batte du geste « batte », rattachée à la main droite de la mère (lib/tigre3d/batte-maillage.ts).
  const batte = creerBatte();
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
  /** Capture au lasso : pivot (centre du corps) dans le canvas, et position imposée de l'image. */
  let prise: { centre: Point; cou: Point } | null = null;
  let tenue: Tenue | null = null;
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

  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vHaut = new THREE.Vector3();
  const zAxe = new THREE.Vector3(0, 0, 1);
  /** Collier autour du cou de la mère : centre, axe du cou (vers la tête), haut (nuque), en monde. */
  function poserCollier(t: Tigre) {
    os(t, "cou").getWorldPosition(vA);
    os(t, "tete").getWorldPosition(vB);
    const axe = vB.clone().sub(vA).normalize();
    const centre = vA.clone().lerp(vB, 0.75);
    vHaut.set(0, 1, 0).addScaledVector(axe, -axe.y).normalize();
    collier.position.copy(centre);
    collier.quaternion.setFromUnitVectors(zAxe, axe);
    return { centre, axe, haut: vHaut.clone() };
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
    const mere = tigre(0);
    const contactBatte = batte.maj(mere, m0.anim);
    collier.visible = serre && prise != null;
    // Attrapé, il quitte le sol : plus d'ombre portée (elle tournerait avec lui).
    mere.ombre.visible = prise == null;
    if (collier.visible) poserCollier(mere);
    renderer.render(scene, camera);
    if (prise && tenue) {
      // Attrapé : le canvas est déplacé et tourné autour du centre du corps ; les repères envoyés à
      // l'hôte sont déjà dans le repère du conteneur (gauche = 0).
      const o = prise.centre, a = tenue.angle;
      canvas.style.transformOrigin = `${o.x}px ${o.y}px`;
      canvas.style.transform = `translate3d(${tenue.x - o.x}px, ${tenue.y - o.y}px, 0) rotate(${a}rad)`;
      const c = Math.cos(a), sn = Math.sin(a);
      const placer = (p: Point): Point => ({
        x: tenue!.x + (p.x - o.x) * c - (p.y - o.y) * sn,
        y: tenue!.y + (p.x - o.x) * sn + (p.y - o.y) * c,
      });
      const z = zoneTigre(mere, 1);
      const coins = [[z.x, z.y], [z.x + z.w, z.y], [z.x, z.y + z.h], [z.x + z.w, z.y + z.h]].map(([x, y]) => placer({ x, y }));
      const xs = coins.map((p) => p.x), ys = coins.map((p) => p.y);
      const boite = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      rappels?.image({
        gauche: 0,
        temps: troupe.mere.anim.t,
        zones: [boite],
        tete: placer(monde(os(mere, "bout_tete"))),
        // Tourné, il n'a plus de « dessus de tête » : la bulle se pose au-dessus de sa boîte.
        bulle: { x: boite.x + boite.w / 2, y: boite.y },
        patte: placer(patteLevee(mere)),
        batte: null,
      });
      return;
    }
    const gauche = centre - largeurCanvas / 2;
    const dx = secousse > 0 ? (Math.random() - 0.5) * 6 * secousse : 0;
    const dy = secousse > 0 ? (Math.random() - 0.5) * 4 * secousse : 0;
    canvas.style.transform = `translate3d(${gauche + dx}px, ${dy}px, 0)`;
    if (!rappels) return;
    rappels.image({
      gauche,
      temps: troupe.mere.anim.t,
      zones: troupe.membres.map((m, i) => zoneTigre(tigre(i), m.echelle)),
      tete: monde(os(mere, "bout_tete")),
      bulle: pointBulle(mere, 1),
      patte: patteLevee(mere),
      batte: contactBatte ? projeter(contactBatte.clone()) : null,
    });
  }

  function image(now: number) {
    raf = 0;
    if (!troupe) return;
    const dt = borne((now - dernier) / 1000, 0, DT_IMAGE_MAX);
    dernier = now;
    if (secousse > 0) secousse = Math.max(0, secousse - dt / 0.9);
    troupe.maj(dt);
    if (prise) tenue = rappels?.tenue?.(dt) ?? null;
    dessiner();
    if (troupe.termine && !prise) { terminer(); return; }
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
    prise = null;
    tenue = null;
    serre = false;
    collier.visible = false;
    canvas.style.visibility = "hidden";
    canvas.style.transformOrigin = "";
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
    clic: () => (prise ? "ignorer" : troupe?.clic() ?? "ignorer"),
    attraper() {
      // Une famille ne se laisse pas attraper : la boucle passe à côté (un seul canvas pour tous).
      if (!troupe || prise || troupe.membres.length > 1) return null;
      const t = tigre(0);
      const gauche = troupe.centre() - largeurCanvas / 2;
      const a = monde(os(t, "thorax")), b = monde(os(t, "lombaires"));
      const c = poserCollier(t);
      const cou = projeter(c.centre.clone());
      const noeud = projeter(c.centre.clone().addScaledVector(c.haut, RAYON_COLLIER_M));
      const tete = projeter(c.centre.clone().add(c.axe));
      const n = Math.hypot(tete.x - cou.x, tete.y - cou.y) || 1;
      // Pivot du tigre pendu (son centre de gravité, à l'œil) : vers les hanches, à mi-hauteur du
      // dos. Tenu par la nuque, il pend ainsi corps et pattes arrière vers le bas.
      prise = { centre: { x: b.x + (b.x - a.x) * 0.3, y: (a.y + b.y) / 2 }, cou };
      tenue = null;
      serre = false;
      // Fil du collier : même épaisseur à l'écran que la corde du lasso.
      geoCollier?.dispose();
      geoCollier = new THREE.TorusGeometry(RAYON_COLLIER_M, FIL_COLLIER_PX / pxm, 8, 48);
      collier.geometry = geoCollier;
      troupe.mere.anim.attraper();
      const g = (p: Point): Point => ({ x: gauche + p.x, y: p.y });
      return {
        centre: g(prise.centre), cou: g(cou), noeud: g(noeud),
        axe: { x: (tete.x - cou.x) / n, y: (tete.y - cou.y) / n },
        rayon: Math.hypot(noeud.x - cou.x, noeud.y - cou.y),
      };
    },
    serrer(v) { serre = v; },
    relacher(x) {
      if (!troupe || !prise) return;
      // Le centre du corps retombe en x : la troupe y place la mère (le canvas, centré sur elle,
      // reprend sa position naturelle sans saut).
      troupe.mere.x += x - (troupe.centre() - largeurCanvas / 2 + prise.centre.x);
      prise = null;
      tenue = null;
      serre = false;
      canvas.style.transformOrigin = "";
      troupe.mere.anim.relacher();
    },
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
      if (prise) tenue = rappels?.tenue?.(dt) ?? null;
      dessiner();
    },
    troupe: () => troupe,
    dispose() {
      arreter();
      document.removeEventListener("visibilitychange", redemarrerHorloge);
      canvas.removeEventListener("webglcontextlost", surPerte);
      for (const t of tigres) { scene.remove(t.groupe); t.dispose(); }
      traine.geometry.dispose(); matTraine.dispose(); texTraine.dispose();
      batte.dispose();
      geoCollier?.dispose(); matCollier.dispose(); texCollier.dispose();
      tigres.length = 0;
      libererModele();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
