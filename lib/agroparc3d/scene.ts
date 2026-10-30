/**
 * Scène three.js « rayons X » d'Agroparc : bâtiments en fil de fer sur fond noir,
 * voirie, arbres, marqueurs cliquables, avion, food truck, circulation et bus.
 * Indépendant de React : `createAgroparcScene` dessine dans un canvas et pose les
 * libellés HTML dans `labelsEl` ; les interactions remontent via les callbacks.
 */
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { cumulativeLengths, pickBusRoutes, stopAbscissas } from "./bus";
import { decalages } from "./marqueurs";
import { trajetTruck } from "./truck";
import type { Poi, SceneData, Vec2 } from "./types";
import type { Cachette } from "./cachettes";
import { creerTigreCache, type TigreCache } from "./tigre";
import { placerEtiquette, rectEtiquette, type RectEtiquette } from "./etiquettes";
import { C, construireDecor, creerAvionFilaire, edgesOf, qualiteParDefaut } from "./decor";
import {
  CADRAGES, brouillardInterpole, dureeTransition, impulsionBloom, interpolerCadrage, leveDeTransition, poseCadrage, type Pose,
} from "../fps/apercu-cadrage";
import type { ApercuDirect, Bandeau, JoueurAerien, ModeleApercu } from "../fps/apercu-source";
import type { ModeSalle } from "../fps/protocole";
import type { RenduApercu } from "../fps/rendu-apercu";

export type { JoueurAerien } from "../fps/apercu-source";

export interface SceneCallbacks {
  onSelect(poi: Poi): void;
  onEvent(tag: string, text: string): void;
  /** Le tigre caché vient d'être débusqué dans la cachette `c`. */
  onTigre?(c: Cachette): void;
  /** Bandeau de l'aperçu par mode (simulation ou direct) ; `null` : plus d'aperçu (panneau fermé). Appelé seulement quand le texte change. */
  onApercu?(b: Bandeau | null): void;
}

export interface OptionsScene {
  /** Cachettes du tigre (public/agroparc/cachettes.json) : sans elles, pas de chasse. */
  cachettes?: readonly Cachette[];
  /**
   * Mode dont le cadrage et le décor sont ceux du départ (la scène recréée après une partie démarre sur celui du lobby) ; l'intro d'arrivée
   * vise ce cadrage. Défaut : l'arène.
   */
  modeInitial?: ModeSalle;
}

/** Aperçu par mode de la vue Palantir (décors des zombies et du Battle Royale, joueurs en direct ou simulés), chargé à la demande. */
export interface ApercuHandle {
  /** Panneau « Arène » ouvert : l'aperçu est actif. Faux : retour à l'arène, simulations et marqueurs détruits. */
  actif(b: boolean): void;
  /** Mode affiché : lance la transition de caméra (`immediat` : sans transition). Sans effet tant que l'aperçu n'est pas actif. */
  mode(m: ModeSalle, opts?: { immediat?: boolean }): void;
  /** Vraies données du mode affiché (null : pas de direct). */
  direct(d: ApercuDirect | null): void;
  /** Une partie est en cours dans le mode affiché d'après `salons` : sans aperçu en direct, le bandeau dit que le direct est indisponible. */
  partieEnCours(b: boolean): void;
  /** État pour le crochet de développement `window.__palantir.apercu()`. */
  etat(): EtatApercu;
  /** Crochet de développement : recrée la simulation avec une graine imposée. */
  graine(n: number): void;
  /** Crochet de développement : avance la simulation de `s` secondes (pas de 1/30 s). */
  avancer(s: number): void;
}

export interface EtatApercu {
  actif: boolean;
  /** mode du cadrage visé et mode dont le décor est affiché */
  mode: ModeSalle;
  modeDecor: ModeSalle;
  chargé: boolean;
  transition: { enCours: boolean; k: number; duree: number };
  camera: { pos: [number, number, number]; cible: [number, number, number] };
  /** repères posés dans la scène, dont `sim` fictifs */
  joueurs: number;
  sim: number;
  tigres: number;
  source: "direct" | "simulation" | null;
  /** appels de dessin de la dernière image (toutes passes du composer) */
  appelsDessin: number;
  /** moyenne glissante (ms) du JS de l'aperçu par image : simulation, repères, tigres, zone */
  msApercu: number;
  modele: ModeleApercu | null;
  /** durée (ms) de la plus longue étape de construction du décor de chaque mode (budget de la spec : 300 ms pour tout le décor) */
  dureesDecorMs: { zombies?: number; br?: number };
}

/** Chasse au tigre, pour l'hôte et le crochet de développement `window.__palantir`. */
export interface ChasseHandle {
  cachette(): Cachette | null;
  debusquer(): Cachette | null;
  placer(c: Cachette): void;
  /** Cadre la caméra sur le tigre, à `distance` m (au plus près permis par les contrôles). */
  viser(distance?: number): void;
  /** Position du tigre à l'écran (px du canvas), null s'il est caché ou hors champ. */
  ecran(): { x: number; y: number } | null;
}

export interface SceneHandle {
  /** pivote la caméra de 45° autour du point visé */
  spin(dir: 1 | -1): void;
  recenter(): void;
  /**
   * Joueurs de l'arène à afficher (marqueur lumineux à leur couleur + pseudo). La liste complète est
   * redonnée à chaque appel : les absents disparaissent. Liste vide = vue strictement inchangée.
   */
  joueurs(liste: readonly JoueurAerien[]): void;
  /** Chasse au tigre (null sans cachettes). */
  chasse: ChasseHandle | null;
  /**
   * Crochet de captures (`window.__palantir.cadrer`) : sans argument, la caméra au repos ; sinon elle regarde le point (x, z) à `distance` m,
   * dans l'azimut du repos, plongée de 40°. Fige la vue (ni intro, ni rotation automatique).
   */
  cadrer(x?: number, z?: number, distance?: number): void;
  /** Crochet de mesures (`window.__palantir.couches`) : montre ou cache des couches du décor (`userData.couche`) ; les absentes de `etat` ne changent pas. */
  couches(etat: Record<string, boolean>): void;
  /** Aperçu par mode (panneau « Arène » ouvert). */
  apercu: ApercuHandle;
  dispose(): void;
}

/**
 * Position de repos de la caméra, en décalage du point visé `data.focus` (m). Partagée avec
 * lib/agroparc3d/cachettes.ts, qui note les cachettes du tigre depuis cette position et ses
 * rotations de 45° (boutons « Pivoter »).
 */
export const REST = { dx: -30, y: 230, dz: 380 } as const;

const POI_LABEL: Record<Poi["type"], string> = { home: "Base", resto: "Restaurant", truck: "Food truck", shop: "Repère" };
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

interface MarqueurJoueur {
  g: THREE.Group; el: HTMLDivElement; cle: string; anchor: THREE.Vector3; materiaux: THREE.Material[];
  /** faisceau et anneau (le faisceau d'un joueur en chute descend jusqu'au sol) */
  beam: THREE.Line; ring: THREE.Line;
  /** position visée (m) : le repère s'en approche exponentiellement quand `lisser` */
  cible: THREE.Vector3; lisser: boolean; pose: boolean; etiquette: boolean; hauteurEtiquette: number; sim: boolean;
}
interface Marker { poi: Poi; el: HTMLDivElement; ring: THREE.LineLoop; beam: THREE.Line; anchor: THREE.Vector3; phase: number }

/** Réglages de `majJoueurs` (aperçu) : sans eux, le chemin historique de l'arène (position posée telle quelle, toutes les étiquettes). */
interface OptionsJoueurs { lisser?: boolean; etiquettesMax?: number }
/** Couleur du repère d'un joueur à terre ou mort (`--ag-ink-dim`). */
const GRIS_HORS = 0x93abb7;
/** Transition entre deux cadrages : `courbe` "legacy" = le recentrage historique (1,2 s, `ease`), "mode" = arc entrée-sortie. */
interface Transition {
  t: number; duree: number; de: Pose3; vers: Pose3; leve: number; courbe: "legacy" | "mode"; mode: ModeSalle | null; brouillardDe: number;
}
interface Pose3 { pos: THREE.Vector3; cible: THREE.Vector3 }
const versPose3 = (p: Pose): Pose3 => ({ pos: new THREE.Vector3(...p.pos), cible: new THREE.Vector3(...p.cible) });
interface Car { g: THREE.Group; pts: THREE.Vector3[]; cum: number[]; len: number; oneway: boolean; s: number; dir: 1 | -1; v: number; lane: number }
/** Bus = voiture + arrêts (abscisses s le long de la voie), pause `wait` s à chaque arrêt franchi. */
interface Bus extends Car { stops: number[]; lastStop: number | null; wait: number }

export function createAgroparcScene(canvas: HTMLCanvasElement, labelsEl: HTMLElement, data: SceneData, cb: SceneCallbacks, opts: OptionsScene = {}): SceneHandle {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- renderer / camera / controls ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(C.ground, 1);
  // les appels de dessin se comptent sur toute l'image (le composer enchaîne plusieurs passes) : remise à zéro à la main
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  const modeInitial: ModeSalle = opts.modeInitial ?? "arene";
  scene.fog = new THREE.FogExp2(C.ground, CADRAGES[modeInitial].brouillard);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);
  // position de repos du mode affiché (celle de l'arène : `REST`) ; change avec le mode (cf. `demanderMode`)
  const poseInitiale = versPose3(poseCadrage(modeInitial, data));
  const repos = { pos: poseInitiale.pos.clone(), target: poseInitiale.cible.clone() };
  const INTRO_FROM = new THREE.Vector3(repos.target.x, 1400, repos.target.z + 1200);
  camera.position.copy(INTRO_FROM);

  // OrbitControls pose un écouteur clavier sur `canvas.getRootNode()` (document) et le retire par le même
  // chemin à `dispose`. React retire le canvas du DOM AVANT le nettoyage de l'effet : son nœud racine est
  // alors le canvas lui-même et l'écouteur de `document` survivrait à chaque bascule vue aérienne ↔ arène.
  const racineDocument = canvas.getRootNode();
  const controls = new MapControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 40;
  controls.maxDistance = 1800;
  controls.screenSpacePanning = false;
  controls.autoRotateSpeed = 0.25;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.listenToKeyEvents(window);
  controls.keyPanSpeed = 25;
  controls.target.copy(repos.target);

  // ---------- décor (cf. decor.ts) ----------
  // Vue aérienne : à cette distance aucune façade n'est lisible ; en qualité « basse » (tactile, 4 cœurs ou moins), on garde les murs
  // en un quad sans nuanceur de façade (le coût fragment du détail ne se retire pas autrement).
  // Les bâtiments de l'arène sont dans un groupe : les aperçus des zombies et du Battle Royale posent leurs propres bâtiments à côté et
  // masquent celui-ci (le sol, les marquages, la végétation et le mobilier restent communs).
  const decorArene = new THREE.Group();
  scene.add(decorArene);
  const qualite = qualiteParDefaut();
  construireDecor(scene, data, { fantomes: true, detail: qualite !== "basse", qualite, eviter: opts.cachettes?.map((c): Vec2 => [c.x, c.z]), racineBatiments: decorArene });

  // ---------- POI markers + labels ----------
  const markers: Marker[] = [];
  const ringGeo = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6); }),
  );
  // Deux POI sur le même bâtiment : second surélevé, et écartés en x s'ils sont trop proches (cf. marqueurs.ts).
  const decal = decalages(data.pois);
  for (const p of data.pois) {
    const color = p.type === "home" ? C.white : p.type === "shop" ? C.shop : C.amber;
    const isTruck = p.type === "truck";
    const { dx, dy } = decal.get(p.id) ?? { dx: 0, dy: 0 };
    const top = isTruck ? 16 : p.bh + 42 + dy;
    const x = p.x + dx;
    const beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, isTruck ? 3.5 : p.bh + 0.5, p.z), new THREE.Vector3(x, top, p.z)]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: p.type === "shop" ? 0.35 : 0.8 }),
    );
    const ring = new THREE.LineLoop(ringGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    ring.position.set(x, top, p.z);
    const el = document.createElement("div");
    el.dataset.kind = p.type;
    const tag = document.createElement("span"); tag.dataset.part = "tag"; tag.textContent = POI_LABEL[p.type];
    const name = document.createElement("span"); name.dataset.part = "name"; name.textContent = p.name;
    el.append(tag, name);
    if (p.type === "resto" || isTruck) {
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.addEventListener("click", () => cb.onSelect(p));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cb.onSelect(p); } });
    }
    if (isTruck) { el.hidden = true; beam.visible = false; ring.visible = false; }
    labelsEl.appendChild(el);
    scene.add(beam, ring);
    markers.push({ poi: p, el, ring, beam, anchor: new THREE.Vector3(x, top + 4, p.z), phase: Math.random() * Math.PI * 2 });
  }

  // ---------- plane ----------
  const { groupe: plane, navLight, wingLight } = creerAvionFilaire();
  plane.visible = false;
  scene.add(plane);
  const FLIGHT = { from: new THREE.Vector3(-1100, 150, 760), to: new THREE.Vector3(1100, 190, -760), dur: 34, next: 5, t: -1 };
  plane.lookAt(FLIGHT.to.clone().sub(FLIGHT.from));
  plane.rotateY(-Math.PI / 2);

  // ---------- truck ----------
  const truck = new THREE.Group();
  const box = edgesOf(new THREE.BoxGeometry(6.2, 2.5, 2.4), C.amber); box.position.set(-0.8, 2.15, 0); truck.add(box);
  const cab = edgesOf(new THREE.BoxGeometry(2.2, 2.0, 2.4), C.amber); cab.position.set(3.4, 1.9, 0); truck.add(cab);
  for (const [x, z] of [[-2.4, 1.25], [-2.4, -1.25], [2.6, 1.25], [2.6, -1.25]]) {
    const wheel = new THREE.TorusGeometry(0.55, 0.14, 6, 10); wheel.rotateX(Math.PI / 2);
    const w = edgesOf(wheel, C.amber, 0.8); w.position.set(x, 0.55, z); truck.add(w);
  }
  const hatch = edgesOf(new THREE.BoxGeometry(3.2, 1.2, 0.1), C.amber, 0.6); hatch.position.set(-0.8, 3.2, 1.9); hatch.rotation.x = -Math.PI / 4; truck.add(hatch);
  truck.scale.setScalar(1.6);
  scene.add(truck);

  const truckPoi = data.pois.find((p) => p.id === "truck");
  const truckMarker = markers.find((m) => m.poi.id === "truck");
  // Trajet : le long de la voie d'arrivée puis tout droit vers la place (cf. truck.ts).
  const truckPath = trajetTruck(data.truckRoad, truckPoi ? [truckPoi.x, truckPoi.z] : [0, 0]).map(([x, z]) => new THREE.Vector3(x, 0, z));
  const truckCum = cumulativeLengths(truckPath.map((p): Vec2 => [p.x, p.z]));
  const truckLen = truckCum[truckCum.length - 1];
  const _td = new THREE.Vector3();
  /** Pose le truck à l'abscisse s du trajet, tourné dans le sens de la marche. */
  function placeTruck(s: number) {
    let i = 1;
    while (i < truckCum.length - 1 && truckCum[i] < s) i++;
    const a = truckPath[i - 1], b = truckPath[i];
    const u = (s - truckCum[i - 1]) / Math.max(truckCum[i] - truckCum[i - 1], 1e-6);
    truck.position.lerpVectors(a, b, THREE.MathUtils.clamp(u, 0, 1));
    _td.copy(b).sub(a);
    if (_td.lengthSq() > 1e-6) truck.rotation.y = Math.atan2(_td.x, _td.z) - Math.PI / 2;
  }
  placeTruck(0);
  const TRUCK = { start: 2.5, dur: 8, arrived: false };
  const homePoi = data.pois.find((p) => p.type === "home");

  // ---------- traffic ----------
  const cars: Car[] = [];
  const buses: Bus[] = [];
  if (!reduced) {
    const head = new THREE.MeshBasicMaterial({ color: 0xf4fbff }), tailM = new THREE.MeshBasicMaterial({ color: 0xff4a3a });
    const bulb = new THREE.SphereGeometry(0.28, 6, 6);
    /** Carrosserie fil de fer + 2 phares blancs à l'avant (+x), 2 feux rouges à l'arrière. */
    const vehicle = (body: THREE.BufferGeometry, mat: THREE.Material, halfLen: number, halfW: number, y: number) => {
      const g = new THREE.Group();
      g.add(new THREE.LineSegments(body, mat));
      const lights: [number, number, THREE.Material][] = [[halfLen, halfW, head], [halfLen, -halfW, head], [-halfLen, halfW, tailM], [-halfLen, -halfW, tailM]];
      for (const [x, z, m] of lights) { const l = new THREE.Mesh(bulb, m); l.position.set(x, y, z); g.add(l); }
      scene.add(g);
      return g;
    };
    const polyline = (p: Vec2[]) => {
      const pts = p.map(([x, z]) => new THREE.Vector3(x, 0, z));
      const cum = cumulativeLengths(p);
      return { pts, cum, len: cum[cum.length - 1] };
    };

    const carBody = new THREE.EdgesGeometry(new THREE.BoxGeometry(4.3, 1.45, 1.9), 10);
    const carMat = new THREE.LineBasicMaterial({ color: C.car, transparent: true, opacity: 0.85 });
    let spawned = 0;
    for (const r of data.routes) {
      const { pts, cum, len } = polyline(r.p);
      const n = Math.max(1, Math.round(len / 110));
      for (let i = 0; i < n && spawned < 22; i++, spawned++) {
        const g = vehicle(carBody, carMat, 2.15, 0.6, 0.55);
        cars.push({ g, pts, cum, len, oneway: r.oneway, s: Math.random() * len, dir: r.oneway || Math.random() < 0.5 ? 1 : -1, v: 7 + Math.random() * 6, lane: 2.1 });
      }
    }

    // Bus : un par voie principale retenue (celles qui desservent le plus d'arrêts OSM).
    const busRoutes = data.busRoutes ?? [], busStops = data.busStops ?? [];
    const busBody = new THREE.EdgesGeometry(new THREE.BoxGeometry(11, 3, 2.5), 10);
    busBody.translate(0, 1.6, 0);
    const busMat = new THREE.LineBasicMaterial({ color: C.bus, transparent: true, opacity: 0.9 });
    for (const idx of pickBusRoutes(busRoutes, busStops, 4)) {
      const r = busRoutes[idx];
      const { pts, cum, len } = polyline(r.p);
      const g = vehicle(busBody, busMat, 5.5, 0.8, 0.9);
      buses.push({
        g, pts, cum, len, oneway: r.oneway, s: Math.random() * len, dir: r.oneway || Math.random() < 0.5 ? 1 : -1, v: 7 + Math.random() * 2, lane: 2.6,
        stops: stopAbscissas(r.p, busStops, 12), lastStop: null, wait: 0,
      });
    }
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
  /** Pose le véhicule à l'abscisse c.s, décalé sur la voie de droite. */
  function placeOnRoute(c: Car, y: number) {
    let i = 1;
    while (i < c.cum.length - 1 && c.cum[i] < c.s) i++;
    const u = (c.s - c.cum[i - 1]) / Math.max(c.cum[i] - c.cum[i - 1], 1e-6);
    _a.copy(c.pts[i - 1]); _b.copy(c.pts[i]);
    _d.copy(_b).sub(_a).normalize().multiplyScalar(c.dir);
    c.g.position.lerpVectors(_a, _b, u);
    c.g.position.y = y;
    c.g.position.x += -_d.z * c.lane; // tenue de la voie de droite
    c.g.position.z += _d.x * c.lane;
    c.g.rotation.y = Math.atan2(_d.x, _d.z) - Math.PI / 2;
  }
  function wrapOrReverse(c: Car) {
    if (c.s > c.len || c.s < 0) {
      if (c.oneway) c.s = 0;
      else { c.dir = c.dir === 1 ? -1 : 1; c.s = THREE.MathUtils.clamp(c.s, 0, c.len); }
    }
  }
  function moveCars(dt: number) {
    for (const c of cars) {
      c.s += c.v * c.dir * dt;
      wrapOrReverse(c);
      placeOnRoute(c, 0.75);
    }
  }
  function moveBuses(dt: number) {
    for (const b of buses) {
      if (b.wait > 0) { b.wait -= dt; if (b.wait > 0) continue; b.wait = 0; }
      const prev = b.s;
      b.s += b.v * b.dir * dt;
      // Arrêt franchi pendant ce pas (dans le sens de marche) → on s'y cale 4 s.
      // `lastStop` évite de re-marquer l'arrêt qu'on vient de quitter.
      const lo = Math.min(prev, b.s), hi = Math.max(prev, b.s);
      for (let k = 0; k < b.stops.length; k++) {
        const st = b.stops[k];
        if (k !== b.lastStop && st >= lo && st <= hi) { b.s = st; b.lastStop = k; b.wait = 4; break; }
      }
      // L'arrêt redevient « actif » une fois qu'on s'en est éloigné de plus d'1 m
      // (couvre aussi le demi-tour en bout de ligne sans double arrêt).
      if (b.wait === 0 && b.lastStop !== null && Math.abs(b.s - b.stops[b.lastStop]) > 1) b.lastStop = null;
      wrapOrReverse(b);
      placeOnRoute(b, 0);
    }
  }

  // ---------- joueurs (spectateurs de l'arène, aperçus des autres modes) ----------
  const joueursMarq = new Map<string, MarqueurJoueur>();
  const joueurRing = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 3.2, 24, Math.sin(a) * 3.2); }),
  );
  const joueurBeam = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 24, 0)]);
  function retirerJoueur(m: MarqueurJoueur) {
    scene.remove(m.g);
    m.materiaux.forEach((x) => x.dispose());
    // l'anneau en pointillés d'un faux joueur a sa propre géométrie (distances cumulées)
    if (m.ring.geometry !== joueurRing) m.ring.geometry.dispose();
    m.el.remove();
  }
  /** Cherche la clé de style : tout ce qui change l'apparence du repère (couleur, fictif, à terre, mort). */
  const cleStyle = (j: JoueurAerien): string => `${j.couleur}|${j.sim ? 1 : 0}|${j.hors ?? ""}`;
  function creerMarqueur(j: JoueurAerien): MarqueurJoueur {
    const hors = j.hors !== undefined;
    const couleur = hors ? GRIS_HORS : new THREE.Color(j.couleur).getHex();
    const sim = j.sim === true;
    const beamMat = new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: hors ? 0 : sim ? 0.4 : 0.85 });
    const g = new THREE.Group();
    const beam = new THREE.Line(joueurBeam, beamMat);
    beam.visible = !hors;
    let ring: THREE.Line, ringMat: THREE.Material;
    if (sim) {
      // faux joueur : anneau en POINTILLÉS (jamais pris pour un vrai)
      const geo = joueurRing.clone();
      ringMat = new THREE.LineDashedMaterial({ color: couleur, transparent: true, opacity: hors ? 0.7 : 1, dashSize: 1.1, gapSize: 0.85 });
      ring = new THREE.Line(geo, ringMat);
      ring.computeLineDistances();
    } else {
      ringMat = new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: hors ? 0.7 : 1 });
      ring = new THREE.LineLoop(joueurRing, ringMat);
    }
    g.add(beam, ring);
    const el = document.createElement("div");
    el.dataset.kind = "joueur";
    if (sim) el.dataset.sim = "1";
    if (hors) el.dataset.hors = j.hors;
    el.style.color = hors ? "var(--ag-ink-dim)" : j.couleur;
    const name = document.createElement("span"); name.dataset.part = "name";
    el.append(name);
    labelsEl.appendChild(el);
    scene.add(g);
    return {
      g, el, cle: cleStyle(j), anchor: new THREE.Vector3(), materiaux: [beamMat, ringMat], beam, ring, cible: new THREE.Vector3(), lisser: false, pose: false,
      etiquette: true, hauteurEtiquette: 28, sim,
    };
  }
  /** Pose le repère à `p` (pieds ; en chute, le faisceau descend jusqu'au sol et l'anneau reste en l'air). */
  function poserMarqueur(m: MarqueurJoueur, p: [number, number, number], chute: boolean) {
    m.g.position.set(p[0], chute ? 0 : p[1], p[2]);
    if (chute) {
      m.ring.position.y = p[1] - 24;
      m.beam.scale.y = Math.max(0.01, p[1]) / 24;
      m.hauteurEtiquette = p[1] + 4;
    } else {
      m.ring.position.y = 0;
      m.beam.scale.y = 1;
      m.hauteurEtiquette = 28;
    }
    m.anchor.set(p[0], (chute ? 0 : p[1]) + m.hauteurEtiquette, p[2]);
  }
  /** Taille d'une étiquette, mesurée au plus une fois par seconde (lire la mise en page à chaque image la forcerait). */
  const taillesEtiquettes = new WeakMap<HTMLElement, { w: number; h: number; t: number }>();
  function tailleEtiquette(el: HTMLElement, maintenant: number): { w: number; h: number } {
    let q = taillesEtiquettes.get(el);
    if (!q || maintenant - q.t > 1000) { q = { w: el.offsetWidth || 90, h: el.offsetHeight || 24, t: maintenant }; taillesEtiquettes.set(el, q); }
    return q;
  }
  let prochainClassement = 0;
  const _q = new THREE.Vector3();
  function majJoueurs(liste: readonly JoueurAerien[], o: OptionsJoueurs = {}) {
    const vus = new Set<string>();
    for (const j of liste) {
      vus.add(j.id);
      let m = joueursMarq.get(j.id);
      if (m && m.cle !== cleStyle(j)) { retirerJoueur(m); joueursMarq.delete(j.id); m = undefined; }
      if (!m) { m = creerMarqueur(j); joueursMarq.set(j.id, m); }
      const nom = m.el.firstElementChild as HTMLElement;
      const texte = j.sim ? `◇ ${j.pseudo}` : j.pseudo;
      if (nom.textContent !== texte) nom.textContent = texte;
      const chute = j.chute !== undefined;
      m.g.userData.chute = chute;
      m.cible.set(j.p[0], j.p[1], j.p[2]);
      // chemin historique (pas de lissage) : posé tel quel ; sinon la boucle d'image s'approche de la cible, sauf à la première pose
      if (!o.lisser || !m.pose || !m.lisser) poserMarqueur(m, j.p, chute);
      m.lisser = !!o.lisser;
      m.pose = true;
    }
    for (const [id, m] of joueursMarq) {
      if (vus.has(id)) continue;
      retirerJoueur(m);
      joueursMarq.delete(id);
    }
    // étiquettes plafonnées : les `etiquettesMax` plus proches du point visé (recalcul à 2 Hz, les affichées gardent un léger avantage)
    const max = o.etiquettesMax;
    if (max === undefined || joueursMarq.size <= max) {
      for (const m of joueursMarq.values()) m.etiquette = true;
    } else if (performance.now() >= prochainClassement) {
      prochainClassement = performance.now() + 500;
      const cx = controls.target.x, cz = controls.target.z;
      const classes = [...joueursMarq.values()].map((m) => ({ m, d: Math.hypot(m.cible.x - cx, m.cible.z - cz) * (m.etiquette ? 0.85 : 1) }));
      classes.sort((a, b) => a.d - b.d);
      classes.forEach((c, i) => { c.m.etiquette = i < max; });
    }
  }
  /** Lissage exponentiel des repères en mode `lisser` (téléport au-delà de 12 m). */
  function lisserJoueurs(dt: number) {
    const a = 1 - Math.exp(-12 * dt);
    for (const m of joueursMarq.values()) {
      if (!m.lisser) continue;
      const chute = m.g.userData.chute === true;
      const px = m.g.position.x, pz = m.g.position.z;
      const py = chute ? m.ring.position.y + 24 : m.g.position.y;
      _q.set(m.cible.x - px, m.cible.y - py, m.cible.z - pz);
      if (_q.length() > 12) { poserMarqueur(m, [m.cible.x, m.cible.y, m.cible.z], chute); continue; }
      poserMarqueur(m, [px + _q.x * a, py + _q.y * a, pz + _q.z * a], chute);
    }
  }

  // ---------- tigre caché ----------
  const tigre: TigreCache | null = opts.cachettes?.length
    ? creerTigreCache({ scene, camera, canvas, cachettes: opts.cachettes, surDebusque: (c) => cb.onTigre?.(c) })
    : null;

  // ---------- post-processing ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.42, 0.24); // force : BLOOM_BASE
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // ---------- interaction / camera moves ----------
  let idleSince = performance.now();
  let figee = false;
  const wake = () => { idleSince = performance.now(); controls.autoRotate = false; };
  canvas.addEventListener("pointerdown", wake);
  canvas.addEventListener("wheel", wake, { passive: true });

  let spinLeft = 0;
  let transition: Transition | null = null;
  const _off = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function applySpin(dt: number) {
    if (Math.abs(spinLeft) < 1e-4) return;
    const step = spinLeft * Math.min(1, dt * 6);
    spinLeft -= step;
    _off.copy(camera.position).sub(controls.target).applyAxisAngle(UP, step);
    camera.position.copy(controls.target).add(_off);
  }
  /** Pose de la caméra et du point visé à la fraction `k` d'une transition (recentrage historique : lerp et `ease` ; mode : arc entrée-sortie). */
  function appliquerPose(tr: Transition, k: number) {
    if (tr.courbe === "legacy") {
      const e = ease(k);
      camera.position.lerpVectors(tr.de.pos, tr.vers.pos, e);
      controls.target.lerpVectors(tr.de.cible, tr.vers.cible, e);
      return;
    }
    const p = interpolerCadrage(
      { pos: [tr.de.pos.x, tr.de.pos.y, tr.de.pos.z], cible: [tr.de.cible.x, tr.de.cible.y, tr.de.cible.z] },
      { pos: [tr.vers.pos.x, tr.vers.pos.y, tr.vers.pos.z], cible: [tr.vers.cible.x, tr.vers.cible.y, tr.vers.cible.z] }, k, tr.leve,
    );
    camera.position.set(...p.pos);
    controls.target.set(...p.cible);
  }

  // ---------- aperçu par mode (cf. lib/fps/rendu-apercu.ts, chargé à la demande) ----------
  let apercuActif = false;
  let modeCamera: ModeSalle = modeInitial;
  /** mode dont le décor est affiché, et mode dont le décor doit l'être dès que la transition a passé son milieu et que le rendu est chargé */
  let modeDecor: ModeSalle = modeInitial;
  let decorVoulu: ModeSalle = modeInitial;
  let rendu: RenduApercu | null = null;
  let chargementRendu = false;
  /** le chargement ou la création du rendu a échoué : on ne réessaie pas (un import() réseau par image, sinon), la vue reste sur l'arène */
  let echecRendu = false;
  let modeVoulu: ModeSalle = modeInitial;
  let directVoulu: ApercuDirect | null = null;
  let partieVoulue = false;
  let apercuSource: "direct" | "simulation" | null = null;
  const BLOOM_BASE = 0.62;
  let msApercu = 0;
  let appelsImage = 0;
  let impulsionK = 0;
  /** durée de la dernière transition de mode (s), gardée après sa fin pour le crochet de développement */
  let derniereDuree = 0;

  /** Éléments propres à l'arène : POI et leurs étiquettes, voitures, bus, avion, Truck, tigre caché (masqués dans les autres modes). */
  function montrerArene(b: boolean) {
    for (const m of markers) {
      m.beam.visible = b && !(m.poi.type === "truck" && !TRUCK.arrived);
      m.ring.visible = m.beam.visible;
      m.el.style.display = b ? "" : "none";
    }
    for (const c of cars) c.g.visible = b;
    for (const c of buses) c.g.visible = b;
    truck.visible = b;
    plane.visible = b && FLIGHT.t >= 0;
    tigre?.afficher(b);
  }

  function chargerRendu() {
    if (rendu || chargementRendu || echecRendu) return;
    chargementRendu = true;
    import("../fps/rendu-apercu")
      .then(({ creerRenduApercu }) => {
        if (disposed) return;
        rendu = creerRenduApercu({
          scene, data, labelsEl, reduit: reduced, decorArene, joueurs: majJoueurs, cible: () => controls.target,
          surBandeau: (b) => cb.onApercu?.(b), surEvenement: (tag, texte) => cb.onEvent(tag, texte),
          surSource: (src) => { apercuSource = src; },
        });
        rendu.actif(apercuActif);
        rendu.mode(modeVoulu);
        rendu.direct(directVoulu);
        rendu.partieEnCours(partieVoulue);
        // le décor demandé avant la fin du chargement (mode initial après une partie, choix très rapide)
        if (decorVoulu !== modeDecor || modeDecor !== "arene") appliquerDecor(decorVoulu);
      })
      .catch(() => {
        chargementRendu = false;
        if (disposed) return;
        // échec définitif (réseau, chunk introuvable, exception à la création) : un seul essai, l'arène reste affichée
        echecRendu = true;
        try { rendu?.dispose(); } catch { /* déjà en échec */ }
        rendu = null;
        cb.onEvent("ERR", "aperçu des modes indisponible");
        modeVoulu = "arene";
        cb.onApercu?.(null);
        allerAuMode("arene");
      });
  }

  /** Échange du décor affiché (au milieu de la transition). Attend le chargement du rendu pour tout mode autre que l'arène. */
  function appliquerDecor(mode: ModeSalle): boolean {
    if (mode === "arene" && !rendu) {
      decorArene.visible = true;
      montrerArene(true);
      modeDecor = "arene";
      return true;
    }
    if (!rendu) { chargerRendu(); return false; }
    rendu.decor(mode);
    montrerArene(mode === "arene");
    modeDecor = mode;
    return true;
  }

  /** Lance la transition vers le cadrage de `cible` (coupure franche en mouvement réduit). */
  function allerAuMode(cible: ModeSalle, immediat = false) {
    // sans rendu (échec du chargement), seul le cadrage de l'arène a un décor : jamais de caméra vers un mode dont le décor ne viendra pas
    if (echecRendu && cible !== "arene") cible = "arene";
    if (cible === modeCamera && !transition) { decorVoulu = cible; return; }
    const vers = versPose3(poseCadrage(cible, data));
    const de: Pose3 = { pos: camera.position.clone(), cible: controls.target.clone() };
    const dePose: Pose = { pos: [de.pos.x, de.pos.y, de.pos.z], cible: [de.cible.x, de.cible.y, de.cible.z] };
    const versPoseT: Pose = { pos: [vers.pos.x, vers.pos.y, vers.pos.z], cible: [vers.cible.x, vers.cible.y, vers.cible.z] };
    modeCamera = cible;
    decorVoulu = cible;
    repos.pos.copy(vers.pos);
    repos.target.copy(vers.cible);
    introDone = true;
    spinLeft = 0;
    const duree = immediat ? 0 : dureeTransition(dePose, versPoseT, reduced);
    derniereDuree = duree;
    if (duree <= 0) {
      transition = null;
      camera.position.copy(vers.pos);
      controls.target.copy(vers.cible);
      (scene.fog as THREE.FogExp2).density = CADRAGES[cible].brouillard;
      appliquerDecor(cible);
      return;
    }
    transition = {
      t: 0, duree, de, vers, leve: leveDeTransition(dePose, versPoseT), courbe: "mode", mode: cible, brouillardDe: (scene.fog as THREE.FogExp2).density,
    };
  }
  function avancerTransition(dt: number) {
    if (!transition) {
      if (decorVoulu !== modeDecor) appliquerDecor(decorVoulu);
      return;
    }
    const tr = transition;
    tr.t = Math.min(1, tr.t + dt / tr.duree);
    appliquerPose(tr, tr.t);
    if (tr.courbe === "mode" && tr.mode) {
      (scene.fog as THREE.FogExp2).density = brouillardInterpole(tr.brouillardDe, CADRAGES[tr.mode].brouillard, tr.t);
      impulsionK = impulsionBloom(tr.t, tr.duree);
      // le décor est échangé au point haut, caché par l'impulsion de bloom
      if (tr.t >= 0.5 && decorVoulu !== modeDecor) appliquerDecor(decorVoulu);
    }
    if (tr.t >= 1) {
      transition = null;
      impulsionK = 0;
      if (decorVoulu !== modeDecor) appliquerDecor(decorVoulu);
    }
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  const INTRO = 3.2;
  let introDone = false;
  const tmp = new THREE.Vector3();
  let raf = 0;
  let disposed = false;
  cb.onEvent("DATA", `${data.buildings.length} bâtiments radiographiés`);

  function frame() {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    // Intro calée sur l'horloge murale (durée fixe quel que soit le framerate) ;
    // la dernière étape pose la caméra exactement au repos même si une image a sauté.
    if (!introDone) {
      const k = Math.min(t / INTRO, 1);
      camera.position.lerpVectors(INTRO_FROM, repos.pos, ease(k));
      if (k >= 1) introDone = true;
    } else if (!reduced && !figee && !transition && performance.now() - idleSince > 9000) {
      controls.autoRotate = true;
    }
    applySpin(dt);
    avancerTransition(dt);
    controls.update();
    // voitures, bus, avion et Truck n'existent que dans l'arène
    const enArene = modeDecor === "arene";
    if (enArene) { moveCars(dt); moveBuses(dt); }
    tigre?.maj(dt);
    const tApercu = performance.now();
    rendu?.maj(dt, t);
    lisserJoueurs(dt);
    msApercu += (performance.now() - tApercu - msApercu) * 0.05;
    bloom.strength = BLOOM_BASE + 0.45 * impulsionK;

    for (const m of markers) { const s = reduced ? 1 : 1 + 0.18 * Math.sin(t * 2.2 + m.phase); m.ring.scale.set(s, 1, s); }

    if (!reduced && enArene) {
      if (FLIGHT.t < 0 && t > FLIGHT.next) { FLIGHT.t = 0; plane.visible = true; }
      if (FLIGHT.t >= 0) {
        FLIGHT.t += dt;
        const k = FLIGHT.t / FLIGHT.dur;
        plane.position.lerpVectors(FLIGHT.from, FLIGHT.to, k);
        plane.position.y += Math.sin(k * Math.PI) * 25;
        navLight.visible = t % 1.1 < 0.12;
        wingLight.visible = t % 1.1 > 0.5 && t % 1.1 < 0.6;
        if (k >= 1) { FLIGHT.t = -1; plane.visible = false; FLIGHT.next = t + 38 + Math.random() * 20; }
      }
    }

    if (enArene && !TRUCK.arrived && truckPoi && t > TRUCK.start) {
      const k = Math.min((t - TRUCK.start) / TRUCK.dur, 1);
      placeTruck(ease(k) * truckLen);
      if (k >= 1 && truckMarker) {
        TRUCK.arrived = true;
        truckMarker.el.hidden = false; truckMarker.beam.visible = true; truckMarker.ring.visible = true;
        cb.onEvent("TRUCK", `Le Truck Muche est garé à l'est du bâtiment voisin de ${homePoi ? homePoi.name.split(" ")[0] : "la base"}`);
      }
    }

    const w = canvas.clientWidth, h = canvas.clientHeight;
    // les noms des restaurants d'abord (ils sont le sujet de la vue), puis les noms des repères de l'aperçu : un nom qui tomberait sur un autre est masqué
    const occupes: RectEtiquette[] = [];
    const maintenantMs = performance.now();
    for (const m of markers) {
      if (m.el.hidden || !enArene) continue;
      tmp.copy(m.anchor).project(camera);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      m.el.style.opacity = vis ? "1" : "0";
      if (vis) {
        const x = ((tmp.x + 1) / 2) * w, y = (1 - tmp.y) / 2 * h;
        m.el.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        if (m.el.style.display !== "none") { const q = tailleEtiquette(m.el, maintenantMs); placerEtiquette(occupes, rectEtiquette(x, y, q.w, q.h)); }
      }
    }
    for (const m of joueursMarq.values()) {
      tmp.copy(m.anchor).project(camera);
      let vis = m.etiquette && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      const x = ((tmp.x + 1) / 2) * w, y = (1 - tmp.y) / 2 * h;
      // chemin historique de l'arène (spectateurs d'une vraie partie) : inchangé ; seuls les repères de l'aperçu cèdent la place
      if (vis && m.lisser) { const q = tailleEtiquette(m.el, maintenantMs); vis = placerEtiquette(occupes, rectEtiquette(x, y, q.w, q.h)); }
      m.el.style.opacity = vis ? "1" : "0";
      if (vis) m.el.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    renderer.info.reset();
    composer.render();
    appelsImage = renderer.info.render.calls;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // scène recréée sur le cadrage d'un autre mode (après une partie) : son décor, tout de suite (le rendu se charge, l'arène reste masquée)
  if (modeInitial !== "arene") { decorArene.visible = false; montrerArene(false); chargerRendu(); }

  return {
    spin(dir) { wake(); spinLeft += dir * (Math.PI / 4); },
    recenter() {
      wake();
      // retour à la position de repos du mode affiché (1,2 s, comme avant)
      transition = {
        t: 0, duree: 1.2, de: { pos: camera.position.clone(), cible: controls.target.clone() }, vers: { pos: repos.pos.clone(), cible: repos.target.clone() },
        leve: 0, courbe: "legacy", mode: null, brouillardDe: 0,
      };
    },
    joueurs: (liste) => majJoueurs(liste),
    apercu: {
      actif(b) {
        apercuActif = b;
        if (b) chargerRendu();
        rendu?.actif(b);
        // panneau fermé : retour à l'arène (ou à son cadrage si on y est déjà)
        if (!b) { modeVoulu = "arene"; rendu?.mode("arene"); allerAuMode("arene"); apercuSource = null; cb.onApercu?.(null); }
        else allerAuMode(modeVoulu);
      },
      mode(m, o) {
        modeVoulu = m;
        if (!apercuActif) return;
        rendu?.mode(m);
        allerAuMode(m, o?.immediat);
      },
      direct(d) { directVoulu = d; rendu?.direct(d); },
      partieEnCours(b) { partieVoulue = b; rendu?.partieEnCours(b); },
      etat() {
        const sim = [...joueursMarq.values()].filter((m) => m.sim).length;
        return {
          actif: apercuActif, mode: modeCamera, modeDecor, chargé: !!rendu,
          transition: { enCours: !!transition && transition.courbe === "mode", k: transition?.t ?? 1, duree: derniereDuree },
          camera: { pos: [camera.position.x, camera.position.y, camera.position.z], cible: [controls.target.x, controls.target.y, controls.target.z] },
          joueurs: joueursMarq.size, sim, tigres: rendu?.etat().tigres ?? 0, source: apercuSource, appelsDessin: appelsImage, msApercu: +msApercu.toFixed(3),
          modele: rendu?.etat().modele ?? null,
          dureesDecorMs: rendu?.etat().dureesDecorMs ?? {},
        };
      },
      graine(n) { rendu?.graine(n); },
      avancer(secondes) { rendu?.avancer(secondes); },
    },
    cadrer(x, z, distance) {
      wake();
      figee = true;
      introDone = true;
      transition = null;
      spinLeft = 0;
      if (x === undefined || z === undefined) {
        controls.target.copy(repos.target);
        camera.position.copy(repos.pos);
      } else {
        // azimut du repos, plongée de 40°
        const az = Math.atan2(REST.dx, REST.dz), d = distance ?? 120, el = (40 * Math.PI) / 180;
        controls.target.set(x, 0, z);
        camera.position.set(x + Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, z + Math.cos(az) * Math.cos(el) * d);
      }
      controls.update();
    },
    couches(etat) {
      scene.traverse((o) => { const c = o.userData.couche as string | undefined; if (c && c in etat) o.visible = etat[c]; });
    },
    chasse: tigre && {
      cachette: () => tigre.cachette(),
      debusquer: () => tigre.debusquer(),
      placer: (c) => tigre.placer(c),
      viser(distance = controls.minDistance) {
        const centre = tigre.centre(new THREE.Vector3());
        if (!centre) return;
        wake();
        introDone = true;
        transition = null;
        spinLeft = 0;
        // Même azimut que la vue courante, plongée de 40°.
        const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
        const d = Math.max(distance, controls.minDistance), el = (40 * Math.PI) / 180;
        controls.target.copy(centre);
        camera.position.set(centre.x + Math.sin(az) * Math.cos(el) * d, centre.y + Math.sin(el) * d, centre.z + Math.cos(az) * Math.cos(el) * d);
        controls.update();
      },
      ecran() {
        const centre = tigre.centre(new THREE.Vector3());
        if (!centre) return null;
        centre.project(camera);
        if (centre.z > 1 || Math.abs(centre.x) > 1 || Math.abs(centre.y) > 1) return null;
        return { x: ((centre.x + 1) / 2) * canvas.clientWidth, y: ((1 - centre.y) / 2) * canvas.clientHeight };
      },
    },
    dispose() {
      disposed = true;
      rendu?.dispose();
      rendu = null;
      tigre?.dispose();
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", wake);
      canvas.removeEventListener("wheel", wake);
      canvas.getRootNode = () => racineDocument;
      controls.dispose();
      for (const m of markers) m.el.remove();
      for (const m of joueursMarq.values()) m.el.remove();
      joueursMarq.clear();
      joueurRing.dispose();
      joueurBeam.dispose();
      scene.traverse((o) => {
        const anyO = o as THREE.Mesh;
        if (anyO.geometry) anyO.geometry.dispose();
        const mat = anyO.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
      // Rend le contexte WebGL tout de suite, sans attendre le ramasse-miettes (comme tigre3d et
      // macron3d) : Chrome n'en garde que 16 actifs et perd d'office le plus ancien au-delà.
      renderer.forceContextLoss();
    },
  };
}
