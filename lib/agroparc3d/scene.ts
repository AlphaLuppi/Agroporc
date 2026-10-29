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
import { C, construireDecor, edgesOf, qualiteParDefaut } from "./decor";

export interface SceneCallbacks {
  onSelect(poi: Poi): void;
  onEvent(tag: string, text: string): void;
  /** Le tigre caché vient d'être débusqué dans la cachette `c`. */
  onTigre?(c: Cachette): void;
}

export interface OptionsScene {
  /** Cachettes du tigre (public/agroparc/cachettes.json) : sans elles, pas de chasse. */
  cachettes?: readonly Cachette[];
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

/** Joueur en jeu dans l'arène FPS, vu d'en haut par les spectateurs (position = pieds). */
export interface JoueurAerien {
  id: string;
  pseudo: string;
  /** "#rrggbb" attribuée par le serveur de l'arène */
  couleur: string;
  p: [number, number, number];
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

interface MarqueurJoueur { g: THREE.Group; el: HTMLDivElement; couleur: string; anchor: THREE.Vector3; materiaux: THREE.Material[] }
interface Marker { poi: Poi; el: HTMLDivElement; ring: THREE.LineLoop; beam: THREE.Line; anchor: THREE.Vector3; phase: number }
interface Car { g: THREE.Group; pts: THREE.Vector3[]; cum: number[]; len: number; oneway: boolean; s: number; dir: 1 | -1; v: number; lane: number }
/** Bus = voiture + arrêts (abscisses s le long de la voie), pause `wait` s à chaque arrêt franchi. */
interface Bus extends Car { stops: number[]; lastStop: number | null; wait: number }

export function createAgroparcScene(canvas: HTMLCanvasElement, labelsEl: HTMLElement, data: SceneData, cb: SceneCallbacks, opts: OptionsScene = {}): SceneHandle {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- renderer / camera / controls ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(C.ground, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(C.ground, 0.0011);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);
  const F = data.focus;
  const repos = { pos: new THREE.Vector3(F[0] + REST.dx, REST.y, F[1] + REST.dz), target: new THREE.Vector3(F[0], 0, F[1]) };
  const INTRO_FROM = new THREE.Vector3(F[0], 1400, F[1] + 1200);
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
  construireDecor(scene, data, { fantomes: true, detail: true, qualite: qualiteParDefaut(), eviter: opts.cachettes?.map((c): Vec2 => [c.x, c.z]) });

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
  const plane = new THREE.Group();
  const fus = new THREE.CylinderGeometry(1.4, 1.1, 26, 6); fus.rotateZ(Math.PI / 2);
  plane.add(edgesOf(fus, C.white));
  plane.add(edgesOf(new THREE.BoxGeometry(5, 0.4, 30), C.white));
  const tail = edgesOf(new THREE.BoxGeometry(3, 0.3, 10), C.white); tail.position.set(-11, 1, 0); plane.add(tail);
  const fin = edgesOf(new THREE.BoxGeometry(4, 6, 0.3), C.white); fin.position.set(-11.5, 3.5, 0); plane.add(fin);
  const navLight = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5a4a })); navLight.position.set(0, -1.6, 0); plane.add(navLight);
  const wingLight = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), new THREE.MeshBasicMaterial({ color: 0xbfffd0 })); wingLight.position.set(1, 0, 15); plane.add(wingLight);
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

  // ---------- joueurs de l'arène (spectateurs) ----------
  const joueursMarq = new Map<string, MarqueurJoueur>();
  const joueurRing = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 3.2, 24, Math.sin(a) * 3.2); }),
  );
  const joueurBeam = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 24, 0)]);
  function retirerJoueur(m: MarqueurJoueur) {
    scene.remove(m.g);
    m.materiaux.forEach((x) => x.dispose());
    m.el.remove();
  }
  function majJoueurs(liste: readonly JoueurAerien[]) {
    const vus = new Set<string>();
    for (const j of liste) {
      vus.add(j.id);
      let m = joueursMarq.get(j.id);
      if (m && m.couleur !== j.couleur) { retirerJoueur(m); joueursMarq.delete(j.id); m = undefined; }
      if (!m) {
        const beamMat = new THREE.LineBasicMaterial({ color: j.couleur, transparent: true, opacity: 0.85 });
        const ringMat = new THREE.LineBasicMaterial({ color: j.couleur, transparent: true, opacity: 1 });
        const g = new THREE.Group();
        g.add(new THREE.Line(joueurBeam, beamMat), new THREE.LineLoop(joueurRing, ringMat));
        const el = document.createElement("div");
        el.dataset.kind = "joueur";
        el.style.color = j.couleur;
        const name = document.createElement("span"); name.dataset.part = "name";
        el.append(name);
        labelsEl.appendChild(el);
        scene.add(g);
        m = { g, el, couleur: j.couleur, anchor: new THREE.Vector3(), materiaux: [beamMat, ringMat] };
        joueursMarq.set(j.id, m);
      }
      const nom = m.el.firstElementChild as HTMLElement;
      if (nom.textContent !== j.pseudo) nom.textContent = j.pseudo;
      m.g.position.set(j.p[0], j.p[1], j.p[2]);
      m.anchor.set(j.p[0], j.p[1] + 28, j.p[2]);
    }
    for (const [id, m] of joueursMarq) {
      if (vus.has(id)) continue;
      retirerJoueur(m);
      joueursMarq.delete(id);
    }
  }

  // ---------- tigre caché ----------
  const tigre: TigreCache | null = opts.cachettes?.length
    ? creerTigreCache({ scene, camera, canvas, cachettes: opts.cachettes, surDebusque: (c) => cb.onTigre?.(c) })
    : null;

  // ---------- post-processing ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.42, 0.24);
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
  let recentering: { t: number; p0: THREE.Vector3; c0: THREE.Vector3 } | null = null;
  const _off = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function applySpin(dt: number) {
    if (Math.abs(spinLeft) < 1e-4) return;
    const step = spinLeft * Math.min(1, dt * 6);
    spinLeft -= step;
    _off.copy(camera.position).sub(controls.target).applyAxisAngle(UP, step);
    camera.position.copy(controls.target).add(_off);
  }
  function applyRecenter(dt: number) {
    if (!recentering) return;
    recentering.t = Math.min(1, recentering.t + dt / 1.2);
    const k = ease(recentering.t);
    camera.position.lerpVectors(recentering.p0, repos.pos, k);
    controls.target.lerpVectors(recentering.c0, repos.target, k);
    if (recentering.t >= 1) recentering = null;
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
    } else if (!reduced && !figee && !recentering && performance.now() - idleSince > 9000) {
      controls.autoRotate = true;
    }
    applySpin(dt);
    applyRecenter(dt);
    controls.update();
    moveCars(dt);
    moveBuses(dt);
    tigre?.maj(dt);

    for (const m of markers) { const s = reduced ? 1 : 1 + 0.18 * Math.sin(t * 2.2 + m.phase); m.ring.scale.set(s, 1, s); }

    if (!reduced) {
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

    if (!TRUCK.arrived && truckPoi && t > TRUCK.start) {
      const k = Math.min((t - TRUCK.start) / TRUCK.dur, 1);
      placeTruck(ease(k) * truckLen);
      if (k >= 1 && truckMarker) {
        TRUCK.arrived = true;
        truckMarker.el.hidden = false; truckMarker.beam.visible = true; truckMarker.ring.visible = true;
        cb.onEvent("TRUCK", `Le Truck Muche est garé à l'est du bâtiment voisin de ${homePoi ? homePoi.name.split(" ")[0] : "la base"}`);
      }
    }

    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const m of markers) {
      if (m.el.hidden) continue;
      tmp.copy(m.anchor).project(camera);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      m.el.style.opacity = vis ? "1" : "0";
      if (vis) m.el.style.transform = `translate(-50%,-100%) translate(${(((tmp.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - tmp.y) / 2) * h).toFixed(1)}px)`;
    }
    for (const m of joueursMarq.values()) {
      tmp.copy(m.anchor).project(camera);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      m.el.style.opacity = vis ? "1" : "0";
      if (vis) m.el.style.transform = `translate(-50%,-100%) translate(${(((tmp.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - tmp.y) / 2) * h).toFixed(1)}px)`;
    }
    composer.render();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    spin(dir) { wake(); spinLeft += dir * (Math.PI / 4); },
    recenter() { wake(); recentering = { t: 0, p0: camera.position.clone(), c0: controls.target.clone() }; },
    joueurs: majJoueurs,
    cadrer(x, z, distance) {
      wake();
      figee = true;
      introDone = true;
      recentering = null;
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
    chasse: tigre && {
      cachette: () => tigre.cachette(),
      debusquer: () => tigre.debusquer(),
      placer: (c) => tigre.placer(c),
      viser(distance = controls.minDistance) {
        const centre = tigre.centre(new THREE.Vector3());
        if (!centre) return;
        wake();
        introDone = true;
        recentering = null;
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
