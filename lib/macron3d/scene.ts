/**
 * Scène three.js de l'easter egg « macron » : un renderer WebGL à fond transparent, créé au
 * déclenchement et entièrement libéré à la fin du passage (rAF arrêté, contexte rendu). Le
 * coureur (lib/macron3d/course.ts → pose.ts) court sur place au centre du canvas, que l'on
 * translate en CSS d'un bord de l'écran à l'autre (lib/macron3d/passage.ts).
 * Chargée par import dynamique depuis app/components/MacronEasterEgg.tsx : three et le GLB ne
 * pèsent rien tant que personne n'a tapé « macron ».
 *
 * Coup de batte du tigre (lib/rencontre.ts) : `frapper` remplace la course par la séquence de
 * lib/macron3d/ko.ts (chute, sol, relevé, reprise titubante), une seule fois par passage.
 */
import * as THREE from "three";
import { borne } from "../tigre3d/ressorts";
import { creerCourse, DEG, MESURES, type Course, type IntentionsCourse } from "./course";
import { appliquerPose, chargerModele, libererGPU, type ModeleMacron } from "./modele";
import { creerPoseur, type Poseur } from "./pose";
import { BULLE, CADRE_M, LACET_CAMERA, avancement, bulleVisible, gaucheCanvas, passageFini, planPassage, replanifier, type Ecran, type PlanPassage } from "./passage";
import { COTES, deCote, type Cote, type Role } from "./os";
import { textureCorde } from "../tigre-lasso-rendu";
import { INTERVALLE_REPLIQUE_S, REPLIQUES_MACRON, tirerReplique } from "../repliques-lasso";
import { BULLE_KO, creerKO, type KO, type PhaseKO } from "./ko";

/** Pas de temps maximal d'une image (s) : un onglet qui reprend la main ne téléporte pas le coureur. */
const DT_IMAGE_MAX = 0.05;
/** Hauteur (m) au-dessus du sol à laquelle l'ombre d'un pied a disparu. */
const OMBRE_PIED_H = 0.14;
/** Hauteur de l'os Toe_End au repos, pied à plat (m). */
const BOUT_PIED_Y = 0.032;

/** Lasso : rayon de la boucle serrée au poignet (m) et épaisseur du fil à l'écran (px). */
const RAYON_POIGNET_M = 0.048;
const FIL_COLLIER_PX = 2.8;
/** Lasso : durée de la dernière réplique, une fois relâché (s). */
const BULLE_APRES_S = 1.8;

/** Demi-épaisseur du buste (m) : la batte touche Macron à cette distance de son centre. */
const RAYON_M = 0.14;

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
  /** Texte de la bulle : « En marche ! », « En… marche… ? » pendant la reprise titubante, ou pris au lasso. */
  texteBulle: string;
  avancement: number;
  /** Boîte englobante du coureur (px, repère du canvas, décalée de `gauche` comme `tete`) : cible du lasso. */
  boite: { x: number; y: number; w: number; h: number };
  /** Centre du coureur dans la page (px), sens et vitesse d'avance (px/s) : publiés pour la rencontre. */
  centre: number;
  sens: 1 | -1;
  vitesse: number;
  /** Demi-épaisseur du corps (px) : la batte le touche à cette distance de son centre. */
  rayon: number;
  /** Déjà frappé pendant ce passage (ou pendu au lasso : la batte ne le vise pas). */
  frappe: boolean;
  /** Phase du coup de batte (null : il court normalement). */
  ko: PhaseKO | null;
  /** Étoiles au-dessus de la tête (px, repère du canvas), quand il est sonné. */
  etoiles: Point | null;
}

/** Lasso : position imposée (px du conteneur) au pivot du coureur attrapé, et rotation (rad). */
export interface Tenue { x: number; y: number; angle: number }

/** Lasso : repères au moment de la prise (px du conteneur), fixes pendant la capture. */
export interface Prise { centre: Point; cou: Point; noeud: Point; axe: Point; rayon: number }

export interface RappelsScene {
  image(i: InfosImage): void;
  /** Lasso : appelée à chaque image pendant une capture, avant le dessin. */
  tenue?(dt: number): Tenue | null;
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
  /** Lasso : attrape le coureur (il court dans le vide), null s'il n'est pas à l'écran. */
  attraper(): Prise | null;
  /** Lasso : nœud serré, le collier de corde apparaît. */
  serrer(): void;
  /** Lasso : retombé au sol, pivot en `x` (px du conteneur) : il repart vers le même bord. */
  relacher(x: number): void;
  /** Intentions courantes (crochet de développement, tests). */
  etat(): IntentionsCourse | null;
  /**
   * Coup de batte : la course s'arrête net et la séquence de chute commence. Refusé (false) hors
   * passage, pendant une chute ou s'il a déjà été frappé pendant ce passage.
   */
  frapper(): boolean;
  /** Rencontre annulée : au sol, il se relève tout de suite (cf. lib/macron3d/ko.ts). */
  annulerKO(): void;
  /** Phase du coup de batte (crochet de développement). */
  phaseKO(): PhaseKO | null;
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
  let ko: KO | null = null, frappe = false, graine = 1;
  let yeux = { lacet: 0, tangage: 0 };
  let raf = 0, dernier = 0, gele = false, libere = false;
  let largeur = 0, hauteur = 0;
  const v = new THREE.Vector3();
  // Lasso : pivot (canvas), position imposée, collier, et bulle qui dure encore un peu après.
  let prise: { centre: Point } | null = null;
  /** Bras levé (lasso au poignet) : côté tourné vers nous, part du geste et sa cible (0..1). */
  let brasCote: Cote = "D", brasPoids = 0, brasCible = 0;
  let tenue: Tenue | null = null;
  let serre = false;
  let horloge = 0, bulleJusque = -1;
  /** Réplique en cours (pris au lasso ou juste relâché) et quand il l'a dite. */
  let replique: string | null = null, tReplique = 0;
  const dire = (liste: readonly string[]) => { replique = tirerReplique(liste, Math.random(), replique); tReplique = horloge; };
  const texCollier = textureCorde();
  texCollier.repeat.set(10, 1);
  const matCollier = new THREE.MeshStandardMaterial({ map: texCollier, roughness: 0.85 });
  const collier = new THREE.Mesh(new THREE.BufferGeometry(), matCollier);
  collier.visible = false;
  scene.add(collier);
  const zAxe = new THREE.Vector3(0, 0, 1);

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

  /** Position d'un os dans le monde. */
  const mondeOs = (r: Role) => {
    if (!modele || !poseur) return new THREE.Vector3();
    const p = poseur.monde.p[modele.sq.i[r]];
    return decale.localToWorld(new THREE.Vector3(p.x, p.y, p.z));
  };
  /**
   * Boucle serrée au poignet du bras levé : autour de l'avant-bras, juste sous la main ; le nœud
   * (d'où part la corde) est au-dessus de la main, dans l'axe du bras. En monde.
   */
  function poserCollier() {
    const coude = mondeOs(deCote("avantBras", brasCote)), poignet = mondeOs(deCote("main", brasCote));
    const axe = poignet.clone().sub(coude).normalize();
    const centre = poignet.clone().addScaledVector(axe, -0.03);
    collier.position.copy(centre);
    collier.quaternion.setFromUnitVectors(zAxe, axe);
    return { centre, axe, nuque: poignet.clone().addScaledVector(axe, 0.05) };
  }
  /** Le bras levé suit sa cible (il se lève à la prise, retombe au relâcher). */
  const majBras = (dt: number) => { brasPoids += (brasCible - brasPoids) * (1 - Math.exp(-14 * dt)); };
  /** Boîte englobante (px du canvas) du coureur : tête, bassin, mains, pieds. */
  function boiteCoureur() {
    const pts = (["sommet", "bassin", "mainG", "mainD", "boutPiedG", "boutPiedD", "piedG", "piedD"] as Role[]).map((r) => projeter(mondeOs(r)));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const m = 0.08 * (plan?.pxm ?? 100);
    const x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m;
    return { x: x0, y: y0, w: Math.max(...xs) + m - x0, h: Math.max(...ys) + m - y0 };
  }

  function dessiner() {
    if (!course || !modele || !poseur || !plan) return;
    const it = ko ? ko.etat(course) : course.etat();
    intentions = it;
    poseur.poser(it, yeux, brasPoids > 0.002 ? { cote: brasCote, poids: brasPoids } : undefined);
    appliquerPose(modele, poseur.pose);
    decale.position.set(0, 0, -it.avance);
    // Pendu au lasso : plus d'ombres au sol, la boucle serrée au poignet.
    ombre.visible = !prise;
    for (const o of ombresPieds) o.m.visible = !prise;
    collier.visible = serre && !!prise;
    if (collier.visible) poserCollier();
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
    const sommet = poseur.monde.p[modele.sq.i.sommet];
    v.set(sommet.x, sommet.y + 0.12, sommet.z);
    const tete = projeter(decale.localToWorld(v));
    let boite = boiteCoureur();
    let gauche = gaucheCanvas(plan, it.avance);
    let teteVue = tete;
    if (prise && tenue) {
      // Attrapé : le canvas est déplacé et tourné autour du pivot ; repères ramenés au conteneur.
      const o = prise.centre, a = tenue.angle, c = Math.cos(a), sn = Math.sin(a);
      canvas.style.transformOrigin = `${o.x}px ${o.y}px`;
      canvas.style.transform = `translate3d(${tenue.x - o.x}px, ${tenue.y - o.y}px, 0) rotate(${a}rad)`;
      const placer = (p: Point): Point => ({ x: tenue!.x + (p.x - o.x) * c - (p.y - o.y) * sn, y: tenue!.y + (p.x - o.x) * sn + (p.y - o.y) * c });
      const coins = [[boite.x, boite.y], [boite.x + boite.w, boite.y], [boite.x, boite.y + boite.h], [boite.x + boite.w, boite.y + boite.h]].map(([x, y]) => placer({ x, y }));
      const xs = coins.map((p) => p.x), ys = coins.map((p) => p.y);
      boite = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      gauche = 0;
      // La bulle reste à sa tête (le bras levé dépasse au-dessus).
      teteVue = placer(tete);
    } else {
      canvas.style.transform = `translate3d(${gauche}px, 0, 0)`;
    }
    // Pendu, il enchaîne les répliques.
    if (prise && horloge - tReplique >= INTERVALLE_REPLIQUE_S) dire(REPLIQUES_MACRON.pris);
    const prisOuApres = !!prise || horloge < bulleJusque;
    // Étoiles : au-dessus du crâne, qu'il soit couché ou assis (os de la tête, pas le sommet).
    let etoiles: Point | null = null;
    if (ko?.etoiles) {
      const crane = poseur.monde.p[modele.sq.i.tete];
      v.set(crane.x, crane.y + 0.32, crane.z);
      etoiles = projeter(decale.localToWorld(v));
    }
    rappels?.image({
      gauche,
      tete: teteVue,
      // Après le coup, plus de « En marche ! » : seulement « En… marche… ? » pendant qu'il titube.
      bulle: prisOuApres || (ko ? ko.bulle : !frappe && bulleVisible(plan, it.avance)),
      texteBulle: prisOuApres && replique ? replique : ko ? BULLE_KO : BULLE.texte,
      avancement: avancement(plan, it.avance),
      boite,
      centre: prise ? boite.x + boite.w / 2 : gauche + largeur / 2,
      sens: plan.sens,
      // Immobile pendant la chute, au sol et au relevé, il court de nouveau dès la reprise : le tigre
      // qui attend devant lui (lib/tigre3d/embuscade.ts) repart à ce signal.
      vitesse: ko && ko.phase !== "reprise" ? 0 : it.vitesse * plan.pxParMetreAvance,
      rayon: RAYON_M * plan.pxm,
      frappe: frappe || !!prise,
      ko: ko?.phase ?? null,
      etoiles,
    });
  }

  /** Une image de temps : la course, ou la séquence du coup de batte (qui la fige puis la relance). */
  function avancerTemps(dt: number) {
    if (!course) return;
    if (!ko) { course.avancer(dt); return; }
    ko.avancer(dt, course);
    if (ko.phase === null) ko = null;
  }

  function image(now: number) {
    raf = 0;
    if (!course || !plan) return;
    const dt = borne((now - dernier) / 1000, 0, DT_IMAGE_MAX);
    dernier = now;
    horloge += dt;
    majBras(dt);
    avancerTemps(dt);
    if (prise) tenue = rappels?.tenue?.(dt) ?? null;
    dessiner();
    if (!prise && fini()) { terminer(); return; }
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
    prise = null;
    tenue = null;
    serre = false;
    brasCible = brasPoids = 0;
    ko = null;
    frappe = false;
    canvas.style.visibility = "hidden";
    canvas.style.transformOrigin = "";
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
      graine = p.graine ?? Math.random() * 1000;
      course = creerCourse({ graine, phase: Math.random() });
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
      horloge += dt;
      majBras(dt);
      avancerTemps(dt);
      if (prise) tenue = rappels?.tenue?.(dt) ?? null;
      dessiner();
      if (!prise && fini()) terminer();
    },
    attraper() {
      if (!course || !plan || !intentions || prise || !modele || !poseur) return null;
      const gauche = gaucheCanvas(plan, intentions.avance);
      // Le bras tourné vers nous se lève (il est pris par le poignet) : repères pris sur la pose
      // bras levé, que le geste rejoint pendant le serrage.
      brasCote = plan.sens === 1 ? "D" : "G";
      poseur.poser(intentions, yeux, { cote: brasCote, poids: 1 });
      const c = poserCollier();
      const cou = projeter(c.centre.clone()), noeud = projeter(c.nuque.clone()), main = projeter(c.centre.clone().add(c.axe));
      // Pivot du corps pendu : son centre de gravité, à peine au-dessus du bassin.
      const centre = projeter(mondeOs("bassin").lerp(mondeOs("dos3"), 0.25));
      const n = Math.hypot(main.x - cou.x, main.y - cou.y) || 1;
      brasCible = 1;
      // Pris pendant qu'il est sonné : le lasso l'emporte, plus de chute ni de relevé.
      ko = null;
      prise = { centre };
      tenue = null;
      serre = false;
      dire(REPLIQUES_MACRON.pris);
      collier.geometry.dispose();
      collier.geometry = new THREE.TorusGeometry(RAYON_POIGNET_M, FIL_COLLIER_PX / plan.pxm, 8, 32);
      const g = (p: Point): Point => ({ x: gauche + p.x, y: p.y });
      return {
        centre: g(centre), cou: g(cou), noeud: g(noeud),
        axe: { x: (main.x - cou.x) / n, y: (main.y - cou.y) / n },
        rayon: Math.max(4, Math.hypot(projeter(c.centre.clone().add(new THREE.Vector3(RAYON_POIGNET_M, 0, 0))).x - cou.x, 0)),
      };
    },
    serrer() { serre = true; },
    relacher(x) {
      if (!plan || !intentions || !prise) return;
      // Il repart de là où il est retombé, vers le même bord, et sort de l'écran.
      const depart = x - prise.centre.x;
      plan = { ...plan, depart, origine: intentions.avance, avanceTotale: Math.abs(plan.arrivee - depart) / plan.pxParMetreAvance };
      prise = null;
      tenue = null;
      serre = false;
      brasCible = 0;
      canvas.style.transformOrigin = "";
      bulleJusque = horloge + BULLE_APRES_S;
      dire(REPLIQUES_MACRON.libre);
    },
    etat: () => intentions,
    frapper() {
      if (!course || !plan || ko || frappe || prise) return false;
      ko = creerKO(course.etat(), graine);
      frappe = true;
      return true;
    },
    annulerKO() { ko?.annuler(); },
    phaseKO: () => ko?.phase ?? null,
    dispose() {
      libere = true;
      arreter();
      document.removeEventListener("visibilitychange", redemarrerHorloge);
      canvas.removeEventListener("webglcontextlost", surPerte);
      if (modele) { decale.remove(modele.scene); libererGPU(modele); }
      geoOmbre.dispose(); matOmbre.dispose(); texOmbre.dispose(); texOmbrePied.dispose();
      collier.geometry.dispose(); matCollier.dispose(); texCollier.dispose();
      for (const o of ombresPieds) o.mat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      modele = null;
      poseur = null;
    },
  };
}
