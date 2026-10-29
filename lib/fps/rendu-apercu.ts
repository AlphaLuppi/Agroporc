/**
 * Rendu des aperçus par mode de la vue Palantir (three, chargé à la demande par `lib/agroparc3d/scene.ts` au premier `actif(true)`).
 * Possède : les décors des zombies et du Battle Royale (groupes frères du décor de l'arène, construits à la demande), la source des repères
 * (DIRECT ou SIMULATION, jamais mélangés), les tigres (deux `InstancedMesh`), les barres de fenêtres, le contour du bâtiment attaqué, la
 * zone du Battle Royale (nuanceur), son avion, les traits de tir et le bandeau. Les repères des joueurs sont posés par `scene.ts` (`joueurs`).
 * Aucun test vitest (three, WebGL) : la logique est dans `apercu-*.ts`, les régressions se voient aux captures (`scripts/fps/captures_apercus.mjs`).
 * Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import * as THREE from "three";
import { C, ajouterBatiments, creerAvionFilaire } from "../agroparc3d/decor";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import {
  SuiviSource, choisirSource, libelleBandeau, type ApercuDirect, type Bandeau, type JoueurAerien, type ModeleApercu, type ResumeBandeau,
  type TigreAerien,
} from "./apercu-source";
import { creerSolLibre, type SolLibre } from "./apercu-sol";
import { PAS_SIM, type Simulation } from "./apercu-sim";
import { creerSimArene, type TraitTir } from "./apercu-sim-arene";
import { creerSimBr } from "./apercu-sim-br";
import { creerSimZombies } from "./apercu-sim-zombies";
import { batimentDesJoueurs, fenetresAttaquees } from "./apercu-zombies-vue";
import { bornesBr, centresBatimentsEligibles, donneesBr } from "./br-carte";
import { positionAvionBr } from "./br-chute";
import { etatDepuisZoneBr } from "./br-zone";
import type { ModeSalle } from "./protocole";
import { creerRenduInterieurs, type RenduInterieurs } from "./rendu-interieurs";
import { BATIMENTS_CREUX, BORNES_ZOMBIES, FENETRES, donneesZombies } from "./zombies-carte";

export interface ContexteRenduApercu {
  scene: THREE.Scene;
  data: SceneData;
  labelsEl: HTMLElement;
  reduit: boolean;
  decorArene: THREE.Object3D;
  joueurs(liste: readonly JoueurAerien[], o?: { lisser?: boolean; etiquettesMax?: number }): void;
  cible(): THREE.Vector3;
  surBandeau(b: Bandeau | null): void;
  surEvenement(tag: string, texte: string): void;
  surSource(src: "direct" | "simulation" | null): void;
}

export interface RenduApercu {
  /** Affiche le décor d'un mode (construit au besoin) et masque les autres ; les repères, la simulation et le bandeau passent à ce mode. */
  decor(mode: ModeSalle): void;
  actif(b: boolean): void;
  /** Mode voulu (la transition de caméra est celle de scene.ts) : prépare son décor à l'inactivité. */
  mode(m: ModeSalle): void;
  direct(d: ApercuDirect | null): void;
  /** Le serveur dit qu'une partie est en cours dans ce mode alors qu'aucun aperçu en direct n'arrive (ancien serveur). */
  partieEnCours(b: boolean): void;
  maj(dt: number, t: number): void;
  etat(): { tigres: number; modele: ModeleApercu | null };
  graine(n: number): void;
  avancer(s: number): void;
  dispose(): void;
}

const MAX_TIGRES = 64;
const MAX_TRAITS = 24;
const ETIQUETTES_BR = 12;
const TAU = Math.PI * 2;
const ROUGE = 0xff7a6b;
const ORANGE = 0xffb35c;
const VERT = 0x6ff0a8;

/** Style d'un type de tigre (0 tigre, 1 doré, 2 chef, 3 petit, 4 mini Truck Muche) : couleur et taille de la flèche. */
const STYLE_TIGRE: readonly { couleur: number; echelle: number }[] = [
  { couleur: 0xff8a3c, echelle: 1.5 }, { couleur: 0xffd34a, echelle: 1.8 }, { couleur: 0xff4d8d, echelle: 2.6 },
  { couleur: 0xffb085, echelle: 0.9 }, { couleur: 0x7fd8ff, echelle: 2.2 },
];

/** Graine d'une simulation : tirée à chaque ouverture, changement de mode et cycle (jamais dans les modules purs). */
function graineAleatoire(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 2 ** 32);
}

const modeleVide = (mode: ModeSalle, source: "direct" | "simulation"): ModeleApercu => ({ source, mode, joueurs: [], tigres: [] });

type SimAvecTraits = Simulation & { traits?(): readonly TraitTir[]; avion?(): unknown };

interface DecorMode { groupe: THREE.Group; interieurs: RenduInterieurs | null }

export function creerRenduApercu(ctx: ContexteRenduApercu): RenduApercu {
  const { scene, data } = ctx;
  const maintenant = (): number => Date.now();

  // ---------- données par mode (construites à la demande) ----------
  let dz: ReturnType<typeof donneesZombies> | null = null;
  let db: ReturnType<typeof donneesBr> | null = null;
  const donneesZ = () => (dz ??= donneesZombies(data));
  const donneesB = () => (db ??= donneesBr(data));
  const sols: Partial<Record<ModeSalle, SolLibre>> = {};
  function solDe(mode: ModeSalle): SolLibre {
    return (sols[mode] ??= mode === "zombies"
      ? creerSolLibre(donneesZ().data, { ...BORNES_ZOMBIES })
      : creerSolLibre(mode === "br" ? donneesB().data : data, bornesBr(data)));
  }

  // ---------- décors ----------
  const decors: Partial<Record<ModeSalle, DecorMode>> = {};
  function construireDecor(mode: "zombies" | "br"): DecorMode {
    const existant = decors[mode];
    if (existant) return existant;
    const groupe = new THREE.Group();
    groupe.name = `apercu-decor-${mode}`;
    groupe.visible = false;
    scene.add(groupe);
    let interieurs: RenduInterieurs | null = null;
    if (mode === "zombies") {
      const d = donneesZ();
      ajouterBatiments(groupe, d.data);
      interieurs = creerRenduInterieurs(groupe, d.data, d.pieces, { sansPlafond: true, courant: true });
    } else {
      const d = donneesB();
      ajouterBatiments(groupe, d.data);
      interieurs = creerRenduInterieurs(groupe, d.data, d.pieces, { sansPlafond: true, batiments: d.creux, courant: true });
    }
    return (decors[mode] = { groupe, interieurs });
  }
  /** Construit les décors un par créneau d'inactivité (jamais pendant le premier affichage). */
  let creneaux: number[] = [];
  function planifierDecors() {
    const file: ("zombies" | "br")[] = ["zombies", "br"];
    const suivant = () => {
      const m = file.shift();
      if (!m || disposed) return;
      if (!decors[m]) construireDecor(m);
      if (file.length) planifier(suivant);
    };
    planifier(suivant);
  }
  function planifier(f: () => void) {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) creneaux.push(w.requestIdleCallback(f, { timeout: 1500 }));
    else creneaux.push(window.setTimeout(f, 250));
  }

  // ---------- éléments d'aperçu (racine masquée hors aperçu) ----------
  const racine = new THREE.Group();
  racine.name = "apercu";
  racine.visible = false;
  scene.add(racine);
  const aDisposer: { dispose(): void }[] = [];

  // tigres : une flèche plate orientée par le cap et un anneau au sol (2 appels de dessin quel que soit leur nombre)
  const flecheGeo = new THREE.BufferGeometry();
  flecheGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 1.6, -0.95, 0, -1, 0, 0, -0.35, 0, 0, 1.6, 0, 0, -0.35, 0.95, 0, -1], 3));
  const anneauGeo = new THREE.RingGeometry(1.0, 1.28, 20); anneauGeo.rotateX(-Math.PI / 2);
  const matTigre = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const matAnneau = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
  const fleches = new THREE.InstancedMesh(flecheGeo, matTigre, MAX_TIGRES);
  const anneaux = new THREE.InstancedMesh(anneauGeo, matAnneau, MAX_TIGRES);
  for (const m of [fleches, anneaux]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 6; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); racine.add(m); }
  aDisposer.push(flecheGeo, anneauGeo, matTigre, matAnneau);

  // fenêtres : 13 barres (couleur = planches restantes) et un trait de chaque tigre qui attaque vers sa barre
  const barreGeo = new THREE.BoxGeometry(1, 1.2, 0.6);
  const matBarre = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  const barres = new THREE.InstancedMesh(barreGeo, matBarre, Math.max(1, FENETRES.length));
  barres.frustumCulled = false; barres.renderOrder = 5; barres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  racine.add(barres);
  aDisposer.push(barreGeo, matBarre);
  const liensGeo = new THREE.BufferGeometry();
  liensGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_TIGRES * 6), 3));
  liensGeo.setDrawRange(0, 0);
  const liens = new THREE.LineSegments(liensGeo, new THREE.LineBasicMaterial({ color: ROUGE, transparent: true, opacity: 0.8, depthTest: false }));
  liens.frustumCulled = false; liens.renderOrder = 5;
  racine.add(liens);
  aDisposer.push(liensGeo, liens.material as THREE.Material);

  // traits de tir (arène et zombies simulés)
  const traitsGeo = new THREE.BufferGeometry();
  traitsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_TRAITS * 6), 3));
  traitsGeo.setDrawRange(0, 0);
  const traitsMat = new THREE.LineBasicMaterial({ color: 0xf2f7fa, transparent: true, opacity: 0.85, depthTest: false });
  const traitsLignes = new THREE.LineSegments(traitsGeo, traitsMat);
  traitsLignes.frustumCulled = false; traitsLignes.renderOrder = 5;
  racine.add(traitsLignes);
  aDisposer.push(traitsGeo, traitsMat);

  // contour du bâtiment où se tiennent les survivants, rouge et pulsant tant qu'une fenêtre est attaquée
  const contourMat = new THREE.LineBasicMaterial({ color: ROUGE, transparent: true, opacity: 0, depthTest: false });
  const contour = new THREE.LineLoop(new THREE.BufferGeometry(), contourMat);
  contour.visible = false; contour.frustumCulled = false; contour.renderOrder = 4;
  racine.add(contour);
  aDisposer.push(contourMat);
  const contours = new Map<number, THREE.BufferGeometry>();
  let contourDe: number | null = null;

  // zone du Battle Royale : intérieur transparent, bord cyan lumineux, extérieur rouge pâle avec un balayage, cercle visé en pointillés
  const zoneUniformes = {
    uCentre: { value: new THREE.Vector2() }, uRayon: { value: 1e5 }, uCible: { value: new THREE.Vector2() }, uRayonCible: { value: 0 },
    uTemps: { value: 0 }, uCyan: { value: new THREE.Color(C.cyan) }, uDanger: { value: new THREE.Color(ROUGE) },
  };
  const zoneMat = new THREE.ShaderMaterial({
    uniforms: zoneUniformes, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: "varying vec2 vXZ; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `
      varying vec2 vXZ; uniform vec2 uCentre; uniform float uRayon; uniform vec2 uCible; uniform float uRayonCible; uniform float uTemps; uniform vec3 uCyan; uniform vec3 uDanger;
      void main(){
        float d = distance(vXZ, uCentre);
        float bord = 1.0 - smoothstep(0.0, 2.2, abs(d - uRayon));
        float dehors = step(uRayon, d);
        float balayage = 0.8 + 0.2 * sin((vXZ.x + vXZ.y) * 0.02 - uTemps * 0.9);
        vec3 col = uDanger * dehors * 0.14 * balayage + uCyan * bord;
        float a = 0.14 * dehors * balayage + bord * 0.95;
        float dc = distance(vXZ, uCible);
        float visee = (1.0 - smoothstep(0.0, 0.9, abs(dc - uRayonCible))) * step(0.5, fract(atan(vXZ.y - uCible.y, vXZ.x - uCible.x) * 14.0 / 6.2831853)) * step(1.0, uRayonCible);
        col += vec3(0.95, 0.97, 0.98) * visee; a = max(a, visee * 0.9);
        if (a < 0.004) discard;
        gl_FragColor = vec4(col / max(a, 0.001), a);
      }`,
  });
  const zoneGeo = new THREE.PlaneGeometry(6000, 6000); zoneGeo.rotateX(-Math.PI / 2);
  const zone = new THREE.Mesh(zoneGeo, zoneMat);
  zone.position.y = 0.6; zone.visible = false; zone.frustumCulled = false; zone.renderOrder = 1;
  racine.add(zone);
  aDisposer.push(zoneGeo, zoneMat);

  // avion du Battle Royale (le même fil de fer que celui de l'arène, grossi pour la plongée haute)
  const avionBr = creerAvionFilaire();
  avionBr.groupe.scale.setScalar(2.4);
  avionBr.groupe.visible = false;
  racine.add(avionBr.groupe);

  // ---------- état ----------
  let disposed = false;
  let estActif = false;
  /** mode dont le décor est affiché (change au point haut de la transition) */
  let modeModele: ModeSalle = "arene";
  let direct: ApercuDirect | null = null;
  let partieEnCoursFlag = false;
  const suivi = new SuiviSource();
  const sims: Partial<Record<ModeSalle, SimAvecTraits>> = {};
  let graineImposee: number | null = null;
  const modeleSim = modeleVide("arene", "simulation");
  const modeleDirect = modeleVide("arene", "direct");
  let courant: ModeleApercu = modeleSim;
  let sourceCourante: "direct" | "simulation" = "simulation";
  let dernierPush = -1;
  let dernierBandeau = 0;
  let texteBandeau = "";
  let tFlux = 0;
  const lissage = new Map<number, { x: number; z: number; cap: number }>();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  const _axe = new THREE.Vector3(0, 1, 0);
  // suivi des changements du direct pour le journal
  let mancheVue = -1, palierVu = -1, vivantsVus = -1;

  function creerSim(mode: ModeSalle): SimAvecTraits {
    const graine = graineImposee ?? graineAleatoire();
    const sol = solDe(mode);
    if (mode === "zombies") return creerSimZombies(graine, { data: donneesZ().data, sol, bornes: { ...BORNES_ZOMBIES }, fenetres: FENETRES });
    if (mode === "br") return creerSimBr(graine, { data: donneesB().data, sol, bornes: bornesBr(data), centresBatiments: centresBatimentsEligibles(data) });
    return creerSimArene(graine, { data, sol, bornes: bornesBr(data) });
  }
  const simDuMode = (): SimAvecTraits => (sims[modeModele] ??= creerSim(modeModele));
  function reinitialiserSims() {
    for (const k of Object.keys(sims) as ModeSalle[]) delete sims[k];
    lissage.clear();
    courant = modeleSim;
  }

  // ---------- décor ----------
  function decor(mode: ModeSalle) {
    ctx.decorArene.visible = mode === "arene";
    if (mode !== "arene") construireDecor(mode);
    for (const m of ["zombies", "br"] as const) { const d = decors[m]; if (d) d.groupe.visible = m === mode; }
    if (mode !== modeModele) {
      modeModele = mode;
      // une simulation neuve (nouvelle graine) à chaque changement de mode, et les repères de l'ancien mode disparaissent
      delete sims[mode];
      lissage.clear();
      suivi.reinitialiser();
      mancheVue = palierVu = vivantsVus = -1;
      ctx.joueurs([]);
      dernierPush = -1;
    }
    racine.visible = estActif;
  }

  // ---------- source et modèle ----------
  function remplirDirect(d: ApercuDirect) {
    modeleDirect.mode = d.mode;
    modeleDirect.joueurs = d.joueurs;
    modeleDirect.tigres = d.tigres;
    modeleDirect.fenetres = d.fenetres;
    modeleDirect.manche = d.manche;
    modeleDirect.zone = d.zone;
    modeleDirect.avion = d.avion;
    modeleDirect.vivants = d.vivants ?? d.joueurs.filter((j) => !j.hors).length;
    modeleDirect.total = d.total;
    modeleDirect.partie = d.partie;
    delete modeleDirect.tSim;
  }

  function horlogeMs(): number {
    return sourceCourante === "direct" && direct ? maintenant() + direct.decalageServeurMs : courant.tSim ?? 0;
  }

  function journalDirect() {
    const m = courant;
    if (m.mode === "zombies" && m.manche !== undefined && m.manche !== mancheVue) {
      if (mancheVue !== -1) ctx.surEvenement("LIVE", `Manche ${m.manche}`);
      mancheVue = m.manche;
    }
    if (m.mode === "br") {
      if (m.zone && m.zone.palier !== palierVu) {
        if (palierVu !== -1) ctx.surEvenement("LIVE", `Zone ${m.zone.palier} : ${Math.round(m.zone.r1)} m`);
        palierVu = m.zone.palier;
      }
      if (m.vivants !== undefined && m.vivants !== vivantsVus) {
        if (vivantsVus !== -1 && m.vivants < vivantsVus) ctx.surEvenement("LIVE", `${m.vivants} restants`);
        vivantsVus = m.vivants;
      }
    }
  }

  // ---------- rendu par image ----------
  function majTigres(dt: number, t: number) {
    const tigres = modeModele === "zombies" ? courant.tigres : [];
    const n = Math.min(MAX_TIGRES, tigres.length);
    const a = 1 - Math.exp(-12 * dt);
    const vus = new Set<number>();
    let k = 0;
    for (const tg of tigres) {
      if (k >= n) break;
      vus.add(tg.id);
      let l = lissage.get(tg.id);
      if (!l || Math.hypot(tg.x - l.x, tg.z - l.z) > 12) { l = { x: tg.x, z: tg.z, cap: tg.cap }; lissage.set(tg.id, l); }
      else {
        l.x += (tg.x - l.x) * a; l.z += (tg.z - l.z) * a;
        // cap lissé sur le plus court chemin
        let dc = tg.cap - l.cap; dc = Math.atan2(Math.sin(dc), Math.cos(dc));
        l.cap += dc * a;
      }
      poserTigre(k++, tg, l, t);
    }
    for (const id of lissage.keys()) if (!vus.has(id)) lissage.delete(id);
    fleches.count = anneaux.count = k;
    fleches.instanceMatrix.needsUpdate = anneaux.instanceMatrix.needsUpdate = true;
    if (fleches.instanceColor) fleches.instanceColor.needsUpdate = true;
    if (anneaux.instanceColor) anneaux.instanceColor.needsUpdate = true;
  }
  function poserTigre(i: number, tg: TigreAerien, l: { x: number; z: number; cap: number }, t: number) {
    const st = STYLE_TIGRE[tg.type] ?? STYLE_TIGRE[0];
    const mort = tg.pvPct <= 0;
    // la flèche regarde dans le sens du cap du protocole : avant = (−sin cap, −cos cap)
    _q.setFromAxisAngle(_axe, l.cap + Math.PI);
    const echelle = st.echelle * (tg.mode === "sol" ? 0.6 + 0.4 * Math.min(1, (t * 2) % 1.2) : 1) * (mort ? 0.5 : 1);
    _p.set(l.x, 1.4, l.z); _s.setScalar(echelle);
    _m.compose(_p, _q, _s);
    fleches.setMatrixAt(i, _m);
    _c.setHex(st.couleur);
    if (tg.mode === "fenetre") _c.lerp(_c.clone().setHex(ROUGE), 0.45 + 0.45 * Math.sin(t * 14));
    fleches.setColorAt(i, _c);
    // anneau : pulse à la sortie du sol, rouge qui clignote quand le tigre arrache les planches, discret sinon
    let r = st.echelle * 0.9, col = st.couleur;
    if (tg.mode === "sol") r = st.echelle * (1 + 1.4 * ((t * 1.4) % 1));
    else if (tg.mode === "fenetre") { r = st.echelle * (1.4 + 0.25 * Math.sin(t * 14)); col = Math.sin(t * 14) > 0 ? ROUGE : ORANGE; }
    else if (tg.mode === "saut") r = st.echelle * 1.6;
    _p.set(l.x, 0.9, l.z); _s.setScalar(r); _q.identity();
    _m.compose(_p, _q, _s);
    anneaux.setMatrixAt(i, _m);
    _c.setHex(col);
    anneaux.setColorAt(i, _c);
  }

  function majFenetres(t: number) {
    const planches = courant.fenetres;
    const attaquees = fenetresAttaquees(courant.tigres, FENETRES);
    FENETRES.forEach((f, i) => {
      const p = planches?.[i] ?? 6;
      const tx = -f.normale[1], tz = f.normale[0];
      _q.setFromAxisAngle(_axe, Math.atan2(-tz, tx));
      const attaquee = attaquees.includes(i);
      _p.set(f.milieu[0], 1.5, f.milieu[1]);
      _s.set(Math.max(1.6, f.largeur), attaquee ? 1 + 0.5 * Math.abs(Math.sin(t * 9)) : 1, 1);
      _m.compose(_p, _q, _s);
      barres.setMatrixAt(i, _m);
      _c.setHex(p >= 5 ? VERT : p >= 3 ? ORANGE : p >= 1 ? 0xff9a5c : ROUGE);
      barres.setColorAt(i, _c);
    });
    barres.count = FENETRES.length;
    barres.instanceMatrix.needsUpdate = true;
    if (barres.instanceColor) barres.instanceColor.needsUpdate = true;
    // un trait de chaque tigre qui arrache des planches vers sa barre
    const pos = liensGeo.getAttribute("position") as THREE.BufferAttribute;
    let n = 0;
    for (const tg of courant.tigres) {
      if (tg.mode !== "fenetre" || n >= MAX_TIGRES) continue;
      const l = lissage.get(tg.id) ?? tg;
      let best = -1, bd = 7;
      FENETRES.forEach((f, i) => { const d = Math.hypot(f.milieu[0] - l.x, f.milieu[1] - l.z); if (d < bd) { bd = d; best = i; } });
      if (best < 0) continue;
      pos.setXYZ(n * 2, l.x, 1.4, l.z);
      pos.setXYZ(n * 2 + 1, FENETRES[best].milieu[0], 1.5, FENETRES[best].milieu[1]);
      n++;
    }
    pos.needsUpdate = true;
    liensGeo.setDrawRange(0, n * 2);
    liens.visible = n > 0;
    return attaquees.length > 0;
  }

  /** Contour du bâtiment qui contient le plus de survivants : recalculé à 2 Hz, pulse en rouge tant qu'une fenêtre est attaquée. */
  let prochainContour = 0;
  function majContour(t: number, attaque: boolean) {
    if (t >= prochainContour) {
      prochainContour = t + 0.5;
      const survivants = courant.joueurs.filter((j) => !j.hors).map((j) => j.p);
      const b = survivants.length ? batimentDesJoueurs(donneesZ().data, BATIMENTS_CREUX, survivants) : null;
      if (b !== contourDe) {
        contourDe = b;
        if (b !== null) {
          let g = contours.get(b);
          if (!g) {
            const bat = donneesZ().data.buildings[b];
            g = new THREE.BufferGeometry().setFromPoints(bat.r.map(([x, z]: Vec2) => new THREE.Vector3(x, bat.h + 0.5, z)));
            contours.set(b, g);
          }
          contour.geometry = g;
        }
      }
    }
    contour.visible = contourDe !== null && attaque;
    contourMat.opacity = attaque ? 0.55 + 0.4 * Math.sin(t * 6) : 0;
  }

  function majTraits(sim: SimAvecTraits | null) {
    const traits = sim?.traits ? sim.traits() : [];
    const pos = traitsGeo.getAttribute("position") as THREE.BufferAttribute;
    let n = 0;
    for (const tr of traits) {
      if (n >= MAX_TRAITS) break;
      pos.setXYZ(n * 2, tr.x0, 1.6, tr.z0);
      pos.setXYZ(n * 2 + 1, tr.x1, 1.6, tr.z1);
      n++;
    }
    pos.needsUpdate = true;
    traitsGeo.setDrawRange(0, n * 2);
    traitsLignes.visible = n > 0;
  }

  function majBr(t: number) {
    const z = courant.zone;
    const horloge = horlogeMs();
    zone.visible = !!z;
    if (z) {
      const e = etatDepuisZoneBr(z, horloge);
      zoneUniformes.uCentre.value.set(e.centre[0], e.centre[1]);
      zoneUniformes.uRayon.value = e.rayon;
      zoneUniformes.uCible.value.set(e.cible ? e.cible.c[0] : e.centre[0], e.cible ? e.cible.c[1] : e.centre[1]);
      zoneUniformes.uRayonCible.value = e.cible ? e.cible.r : 0;
      zoneUniformes.uTemps.value = t;
    }
    const av = courant.avion;
    const visible = !!av && horloge >= av.debutT - 1000 && horloge <= av.finT + 2000;
    avionBr.groupe.visible = visible;
    if (visible && av) {
      const p = positionAvionBr(av, horloge);
      avionBr.groupe.position.set(p[0], p[1], p[2]);
      // nez le long de +x du modèle : tourné de θ = atan2(−dz, dx) vers la direction du trajet
      avionBr.groupe.rotation.y = Math.atan2(-(av.arrivee[1] - av.depart[1]), av.arrivee[0] - av.depart[0]);
      avionBr.navLight.visible = t % 1.1 < 0.12;
      avionBr.wingLight.visible = t % 1.1 > 0.5 && t % 1.1 < 0.6;
    }
  }

  function bandeau(t: number) {
    if (t - dernierBandeau < 0.5) return;
    dernierBandeau = t;
    const m = courant;
    const reste = m.joueurs.filter((j) => !j.hors);
    const e = m.zone ? etatDepuisZoneBr(m.zone, horlogeMs()) : null;
    const resume: ResumeBandeau = {
      joueurs: m.mode === "zombies" || m.mode === "br" ? reste.length : m.joueurs.length, tigres: m.tigres.length, manche: m.manche,
      vivants: m.vivants, total: m.total, palier: e?.palier, nbPaliers: m.zone?.nbPaliers, partie: m.partie,
      partieEnCours: sourceCourante === "simulation" && partieEnCoursFlag,
    };
    const b = libelleBandeau(sourceCourante, modeModele, resume);
    const texte = `${b.etat}|${b.titre}|${b.detail}`;
    if (texte !== texteBandeau) { texteBandeau = texte; ctx.surBandeau(b); }
  }

  /** Une image : source (direct ou simulation), simulation, repères, tigres, fenêtres, zone, avion, bandeau. */
  function maj(dt: number, t: number) {
    if (disposed) return;
    const d = decors[modeModele];
    if (d?.interieurs && d.groupe.visible) d.interieurs.maj(t, dt);
    if (!estActif) return;
    const candidate = choisirSource({ modeAffiche: modeModele, modeConfirme: modeModele, connecte: true, direct, maintenant: maintenant() });
    const src = suivi.maj(candidate, maintenant());
    // le direct ne vaut que s'il est de ce mode et récent : sinon la simulation, même pendant l'hystérésis (le dernier paquet n'est plus frais)
    const utiliseDirect = src === "direct" && direct !== null && direct.mode === modeModele;
    if (utiliseDirect !== (sourceCourante === "direct")) { ctx.joueurs([]); lissage.clear(); dernierPush = -1; mancheVue = palierVu = vivantsVus = -1; }
    sourceCourante = utiliseDirect ? "direct" : "simulation";
    ctx.surSource(sourceCourante);
    let sim: SimAvecTraits | null = null;
    if (utiliseDirect && direct) {
      if (direct.recuT !== tFlux) { tFlux = direct.recuT; remplirDirect(direct); journalDirect(); }
      courant = modeleDirect;
      // pas de simulation qui tourne en douce derrière un direct : elle repartira d'une graine neuve
      delete sims[modeModele];
    } else {
      sim = simDuMode();
      sim.pas(dt);
      sim.modele(modeleSim);
      for (const e of sim.evenements()) ctx.surEvenement("SIM", e);
      courant = modeleSim;
    }
    // repères des joueurs : 10 Hz, lissés par scene.ts entre deux envois
    if (t - dernierPush >= 0.1 || dernierPush < 0) {
      dernierPush = t;
      ctx.joueurs(courant.joueurs, { lisser: true, etiquettesMax: modeModele === "br" ? ETIQUETTES_BR : undefined });
    }
    majTigres(dt, t);
    const zom = modeModele === "zombies";
    barres.visible = zom; liens.visible = zom; fleches.visible = anneaux.visible = zom;
    contour.visible = false;
    if (zom) majContour(t, majFenetres(t)); else { liens.visible = false; }
    majTraits(sim);
    zone.visible = false; avionBr.groupe.visible = false;
    if (modeModele === "br") majBr(t);
    bandeau(t);
  }

  function forcerMaj(secondes: number) {
    const sim = simDuMode();
    for (let i = 0; i < Math.round(secondes / PAS_SIM); i++) { sim.pas(PAS_SIM); for (const e of sim.evenements()) ctx.surEvenement("SIM", e); }
    sim.modele(modeleSim);
    dernierPush = -1;
  }

  return {
    decor,
    actif(b) {
      if (b === estActif) return;
      estActif = b;
      racine.visible = b;
      if (b) {
        // chaque ouverture du panneau : simulation neuve (nouvelle graine), décors préparés à l'inactivité
        reinitialiserSims();
        suivi.reinitialiser();
        texteBandeau = "";
        dernierPush = -1;
        planifierDecors();
      } else {
        ctx.joueurs([]);
        lissage.clear();
        reinitialiserSims();
        courant = modeleSim;
        sourceCourante = "simulation";
        ctx.surSource(null);
        ctx.surBandeau(null);
        texteBandeau = "";
        fleches.count = anneaux.count = 0;
        zone.visible = false;
        avionBr.groupe.visible = false;
      }
    },
    mode(m) {
      // la transition de caméra et l'échange du décor sont ceux de scene.ts ; on prépare ici le décor voulu pour qu'il soit prêt au point haut
      if (estActif && m !== "arene" && !decors[m]) planifier(() => { if (!disposed && !decors[m]) construireDecor(m); });
    },
    direct(d) { direct = d; },
    partieEnCours(b) { partieEnCoursFlag = b; },
    maj,
    etat() { return { tigres: fleches.count, modele: estActif ? courant : null }; },
    graine(n) {
      graineImposee = n;
      delete sims[modeModele];
      dernierPush = -1;
    },
    avancer(s) { forcerMaj(s); },
    dispose() {
      disposed = true;
      for (const id of creneaux) { (window as Window & { cancelIdleCallback?: (i: number) => void }).cancelIdleCallback?.(id); window.clearTimeout(id); }
      creneaux = [];
      ctx.joueurs([]);
      ctx.decorArene.visible = true;
      scene.remove(racine);
      for (const m of ["zombies", "br"] as const) {
        const d = decors[m];
        if (!d) continue;
        d.interieurs?.dispose();
        scene.remove(d.groupe);
        d.groupe.traverse((o) => {
          const x = o as THREE.Mesh;
          x.geometry?.dispose();
          const mat = x.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((y) => y.dispose()); else mat?.dispose();
        });
      }
      for (const g of contours.values()) g.dispose();
      contour.geometry.dispose();
      fleches.dispose(); anneaux.dispose(); barres.dispose();
      for (const x of aDisposer) x.dispose();
    },
  };
}
