/**
 * Scène three.js de l'easter egg « macron » : un renderer WebGL à fond transparent, créé au
 * déclenchement et entièrement libéré à la fin du passage (rAF arrêté, contexte rendu). Le
 * coureur (lib/macron3d/course.ts → pose.ts) court sur place au centre du canvas, que l'on
 * translate en CSS d'un bord de l'écran à l'autre (lib/macron3d/passage.ts).
 * Chargée par import dynamique depuis app/components/MacronEasterEgg.tsx : three et le GLB ne
 * pèsent rien tant que personne n'a tapé « macron ».
 */
import * as THREE from "three";
import { borne } from "../tigre3d/ressorts";
import { creerCourse, DEG, MESURES, type Course, type IntentionsCourse } from "./course";
import { appliquerPose, chargerModele, libererGPU, type ModeleMacron } from "./modele";
import { creerPoseur, type Poseur } from "./pose";
import { CADRE_M, LACET_CAMERA, avancement, bulleVisible, gaucheCanvas, passageFini, planPassage, replanifier, type Ecran, type PlanPassage } from "./passage";
import { COTES, deCote } from "./os";

/** Pas de temps maximal d'une image (s) : un onglet qui reprend la main ne téléporte pas le coureur. */
const DT_IMAGE_MAX = 0.05;
/** Hauteur (m) au-dessus du sol à laquelle l'ombre d'un pied a disparu. */
const OMBRE_PIED_H = 0.14;
/** Hauteur de l'os Toe_End au repos, pied à plat (m). */
const BOUT_PIED_Y = 0.032;

/** Champ vertical de la caméra (°) et plongée (°) : presque à hauteur d'homme. */
const CHAMP = 22;
const PLONGEE = 4;

export interface Point { x: number; y: number }

export interface InfosImage {
  /** Bord gauche du canvas dans la page (px). */
  gauche: number;
  /** Au-dessus de la tête (px, repère du canvas) : pied de la bulle. */
  tete: Point;
  bulle: boolean;
  avancement: number;
}

export interface RappelsScene {
  image(i: InfosImage): void;
  /** Le coureur est sorti de l'écran. */
  fin(): void;
}

export interface ParamsPassage {
  ecran: Ecran;
  sens: 1 | -1;
  graine?: number;
}

export interface SceneMacron {
  /** Charge three, le GLB et compile les shaders ; rejetée si le GLB ne se charge pas. */
  precharger(): Promise<void>;
  pret(): boolean;
  /** Démarre le passage (modèle prêt) ; retourne la taille du canvas (px CSS). */
  lancer(p: ParamsPassage, rappels: RappelsScene): { largeur: number; hauteur: number };
  /** Fenêtre redimensionnée en plein passage : même part du trajet, nouvelle taille (px CSS). */
  redimensionner(ecran: Ecran): { largeur: number; hauteur: number } | null;
  /** Gèle ou relance la boucle (captures) ; gelée, `avancer` fait avancer le temps à la main. */
  geler(gele: boolean): void;
  avancer(dt: number): void;
  /** Intentions courantes (crochet de développement, tests). */
  etat(): IntentionsCourse | null;
  dispose(): void;
}

export interface OptionsScene {
  dprMax?: number;
  urlModele?: string;
  /** Contexte WebGL perdu : l'hôte abandonne le passage, sans bruit. */
  surPerte?(): void;
}

/**
 * Ombres portées (disques flous) : une large et pâle sous le bassin, une petite et nette sous
 * chaque pied, qui s'efface quand le pied quitte le sol : la phase de vol se lit à l'écran.
 */
function textureOmbre(centre = 0.5): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(0,0,0,${centre})`);
  g.addColorStop(0.55, `rgba(0,0,0,${centre * 0.45})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function creerScene(canvas: HTMLCanvasElement, opts: OptionsScene = {}): SceneMacron {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(opts.dprMax ?? 2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const surPerte = (e: Event) => { e.preventDefault(); opts.surPerte?.(); };
  canvas.addEventListener("webglcontextlost", surPerte);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CHAMP, 1, 0.1, 60);
  // Matériaux PBR (non métalliques) : ciel / sol doux + une lumière principale côté caméra.
  scene.add(new THREE.HemisphereLight(0xfff6ec, 0x5a5048, 1.5));
  const soleil = new THREE.DirectionalLight(0xffffff, 2.4);
  soleil.position.set(-2.5, 4.5, 6);
  scene.add(soleil);
  // Contre-jour : liseré clair sur la silhouette (le costume noir se détache des thèmes sombres).
  const contre = new THREE.DirectionalLight(0xdfe8ff, 1.8);
  contre.position.set(2, 3.5, -5);
  scene.add(contre);

  // Coureur : groupe tourné dans le sens de la course (et un peu vers nous) > décalage de l'avance > modèle.
  const groupe = new THREE.Group();
  const decale = new THREE.Group();
  groupe.add(decale);
  scene.add(groupe);
  const texOmbre = textureOmbre();
  const matOmbre = new THREE.MeshBasicMaterial({ map: texOmbre, transparent: true, depthWrite: false });
  const geoOmbre = new THREE.PlaneGeometry(1, 1);
  const ombre = new THREE.Mesh(geoOmbre, matOmbre);
  ombre.rotation.x = -Math.PI / 2;
  ombre.scale.set(0.75, 0.42, 1);
  ombre.renderOrder = -2;
  decale.add(ombre);
  // Ombres des pieds plus denses : vues presque à hauteur du sol, elles sont très aplaties.
  const texOmbrePied = textureOmbre(0.85);
  const ombresPieds = COTES.map(() => {
    const mat = new THREE.MeshBasicMaterial({ map: texOmbrePied, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(geoOmbre, mat);
    m.rotation.order = "YXZ";
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = -1;
    decale.add(m);
    return { m, mat };
  });

  let modele: ModeleMacron | null = null;
  let poseur: Poseur | null = null;
  let chargement: Promise<void> | null = null;
  let course: Course | null = null;
  let plan: PlanPassage | null = null;
  let rappels: RappelsScene | null = null;
  let intentions: IntentionsCourse | null = null;
  let yeux = { lacet: 0, tangage: 0 };
  let raf = 0, dernier = 0, gele = false, libere = false;
  let largeur = 0, hauteur = 0;
  const v = new THREE.Vector3();

  const precharger = () => {
    chargement ??= chargerModele(opts.urlModele).then((m) => {
      if (libere) return;
      modele = m;
      poseur = creerPoseur(m.sq);
      decale.add(m.scene);
      renderer.compile(scene, camera);
    });
    chargement.catch(() => { chargement = null; });
    return chargement;
  };

  function projeter(p: THREE.Vector3): Point {
    v.copy(p).project(camera);
    return { x: (v.x * 0.5 + 0.5) * largeur, y: (-v.y * 0.5 + 0.5) * hauteur };
  }

  function dessiner() {
    if (!course || !modele || !poseur || !plan) return;
    const it = course.etat();
    intentions = it;
    poseur.poser(it, yeux);
    appliquerPose(modele, poseur.pose);
    decale.position.set(0, 0, -it.avance);
    // Ombre sous le bassin, pâle, plus petite quand il monte (phase de vol).
    const b = it.bassin.p;
    ombre.position.set(b.x, 0.002, b.z + 0.05);
    const h = borne((b.y - 0.87) / 0.06, 0, 1);
    matOmbre.opacity = 0.32 - 0.12 * h;
    ombre.scale.set(0.75 * (1 - 0.12 * h), 0.42 * (1 - 0.12 * h), 1);
    // Ombre de contact de chaque pied : nette au sol, elle pâlit et rétrécit quand il décolle.
    const mp = poseur.monde.p, iOs = modele.sq.i;
    COTES.forEach((c, n) => {
      const ch = mp[iOs[deCote("pied", c)]], pl = mp[iOs[deCote("orteils", c)]], bo = mp[iOs[deCote("boutPied", c)]];
      // Hauteur du dessous du pied : cheville et plante ramenées à leur hauteur au repos.
      const hp = Math.max(0, Math.min(ch.y - MESURES.cheville, pl.y - (MESURES.cheville - MESURES.plante.bas), bo.y - BOUT_PIED_Y));
      const k = 1 - borne(hp / OMBRE_PIED_H, 0, 1);
      const o = ombresPieds[n];
      o.m.position.set((ch.x + bo.x) / 2, 0.003, (ch.z + bo.z) / 2);
      o.m.rotation.y = Math.atan2(bo.x - ch.x, bo.z - ch.z);
      const e = 0.5 + 0.5 * k;
      o.m.scale.set(0.24 * e, 0.36 * e, 1);
      o.mat.opacity = 0.9 * Math.pow(k, 1.5);
    });
    renderer.render(scene, camera);
    const gauche = gaucheCanvas(plan, it.avance);
    canvas.style.transform = `translate3d(${gauche}px, 0, 0)`;
    const sommet = poseur.monde.p[modele.sq.i.sommet];
    v.set(sommet.x, sommet.y + 0.12, sommet.z);
    rappels?.image({
      gauche,
      tete: projeter(decale.localToWorld(v)),
      bulle: bulleVisible(plan, it.avance),
      avancement: avancement(plan, it.avance),
    });
  }

  function image(now: number) {
    raf = 0;
    if (!course || !plan) return;
    const dt = borne((now - dernier) / 1000, 0, DT_IMAGE_MAX);
    dernier = now;
    course.avancer(dt);
    dessiner();
    if (fini()) { terminer(); return; }
    if (!gele) raf = requestAnimationFrame(image);
  }

  /** Le canvas est sorti de l'écran. */
  const fini = () => !!plan && !!intentions && passageFini(plan, intentions.avance);

  function terminer() {
    const r = rappels;
    arreter();
    r?.fin();
  }

  function arreter() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    course = null;
    plan = null;
    rappels = null;
    canvas.style.visibility = "hidden";
  }

  /** Taille du canvas et caméra pour un plan (au lancement ou après un redimensionnement). */
  function appliquerPlan(p: PlanPassage) {
    plan = p;
    largeur = p.largeurCanvas;
    hauteur = p.hauteurCanvas;
    renderer.setSize(largeur, hauteur, true);
    // Caméra : cadre CADRE_M (sol un peu au-dessus du bas du canvas), à peine plongeante.
    camera.aspect = largeur / hauteur;
    camera.updateProjectionMatrix();
    const centreY = CADRE_M.hauteur / 2 - CADRE_M.sousLeSol;
    const d = CADRE_M.hauteur / 2 / Math.tan((CHAMP / 2) * DEG);
    camera.position.set(0, centreY + d * Math.sin(PLONGEE * DEG), d * Math.cos(PLONGEE * DEG));
    camera.lookAt(0, centreY, 0);
  }

  const redemarrerHorloge = () => { dernier = performance.now(); };
  document.addEventListener("visibilitychange", redemarrerHorloge);

  return {
    precharger,
    pret: () => modele !== null,
    lancer(p, r) {
      arreter();
      if (!modele) { void precharger(); return { largeur: 0, hauteur: 0 }; }
      rappels = r;
      appliquerPlan(planPassage(p.ecran, p.sens));
      // Le coureur regarde dans le sens de la course, tourné de LACET_CAMERA vers nous.
      const lacet = Math.atan2(p.sens * Math.cos(LACET_CAMERA), Math.sin(LACET_CAMERA));
      groupe.rotation.y = lacet;
      // Vers la caméra (repère du modèle) : la tête s'y tourne un peu, les yeux un peu plus.
      const versCamera = -lacet;
      course = creerCourse({ graine: p.graine ?? Math.random() * 1000, phase: Math.random() });
      course.regarder(borne(versCamera, -1, 1) * 0.16);
      yeux = { lacet: Math.sign(versCamera) * 12 * DEG, tangage: -2 * DEG };
      redemarrerHorloge();
      dessiner();
      canvas.style.visibility = "visible";
      if (!gele) raf = requestAnimationFrame(image);
      return { largeur, hauteur };
    },
    redimensionner(ecran) {
      if (!plan || !intentions) return null;
      appliquerPlan(replanifier(plan, ecran, intentions.avance));
      dessiner();
      return { largeur, hauteur };
    },
    geler(g) {
      gele = g;
      if (g && raf) { cancelAnimationFrame(raf); raf = 0; }
      else if (!g && course && !raf) { redemarrerHorloge(); raf = requestAnimationFrame(image); }
    },
    avancer(dt) {
      if (!course || !plan) return;
      course.avancer(dt);
      dessiner();
      if (fini()) terminer();
    },
    etat: () => intentions,
    dispose() {
      libere = true;
      arreter();
      document.removeEventListener("visibilitychange", redemarrerHorloge);
      canvas.removeEventListener("webglcontextlost", surPerte);
      if (modele) { decale.remove(modele.scene); libererGPU(modele); }
      geoOmbre.dispose(); matOmbre.dispose(); texOmbre.dispose(); texOmbrePied.dispose();
      for (const o of ombresPieds) o.mat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      modele = null;
      poseur = null;
    },
  };
}
