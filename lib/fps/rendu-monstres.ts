/**
 * Rendu des monstres des événements (three, v3) : Truck Muche fou (caisse orange, gyrophares), tigre robot géant (le VRAI tigre 3D du
 * thème Tigre, `public/tigre/tigre.glb`, à l'échelle `ECHELLE_TIGRE` : pelage rayé assombri en métal, maillage lumineux par-dessus, yeux
 * rouges incandescents, démarche du moteur `lib/tigre3d/corps.ts` via `tigre-geant.ts`, rugissement au coup de patte ; tant que le modèle
 * n'est pas chargé, ou s'il ne charge pas, un robot en boîtes le remplace), titan tigre (même tigre plus petit, aux couleurs du pilote), visée du laser
 * (rayon rouge qui se densifie, disque d'impact au sol) et explosions (sphères filaires qui gonflent). Même langage visuel que
 * `rendu-monde.ts` : arêtes lumineuses, faces sombres. Aucun test vitest (three) : les régressions se voient aux captures.
 * Repère : un monstre est un `Group` posé au sol, orienté par `rotation.y = cap`, avant local = −z.
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import * as THREE from "three";
import { chargerModele, creerTigre as creerTigre3D, type ModeleTigre, type Tigre } from "../tigre3d/modele";
import { squelette } from "../tigre3d/squelette";
import type { LaserAnnonce } from "./jeu-monstres";
import { ECHELLE_TIGRE, TITAN, TRUCK_FOU } from "./monstres";
import type { TigreSnap, TitanSnap, TruckSnap, Vec3 } from "./protocole";
import { creerAnimTigreGeant, type AnimTigreGeant } from "./tigre-geant";

export interface RenduMonstres {
  /** Pose les monstres interpolés ; `tS` = horloge locale (s), `tsServeur` = horloge serveur (ms) pour les lasers ; `piloteMoi` cache mon titan. */
  maj(m: { truck?: TruckSnap; tigre?: TigreSnap; titan?: TitanSnap }, lasers: readonly LaserAnnonce[], tS: number, tsServeur: number, dt: number, couleurTitan: string, piloteMoi: boolean): void;
  explosion(p: Vec3, rayon: number): void;
  dispose(): void;
}

const ORDRE = 5;
const COULEUR_TRUCK = 0xff8f2e;
const COULEUR_TIGRE = 0xff7b1c;
const COULEUR_RAYURES = 0x2b0d00;
const COULEUR_YEUX = 0xff2030;
const COULEUR_LASER = 0xff2a3a;
const COULEUR_EXPLOSION = 0xffb347;
const EXPLOSIONS = 8;
const DUREE_EXPLOSION_S = 0.9;

interface Mat { ligne: THREE.LineBasicMaterial; fond: THREE.MeshBasicMaterial }
function materiaux(couleur: number | string, aDisposer: { dispose(): void }[]): Mat {
  const c = new THREE.Color(couleur);
  const ligne = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthWrite: false });
  const fond = new THREE.MeshBasicMaterial({
    color: c.clone().multiplyScalar(0.09), transparent: true, opacity: 1, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
  });
  aDisposer.push(ligne, fond);
  return { ligne, fond };
}
/** Boîte filaire (faces sombres + arêtes) de centre (x, y, z) dans `parent`. */
function boite(parent: THREE.Object3D, m: Mat, w: number, h: number, d: number, x: number, y: number, z: number, aDisposer: { dispose(): void }[]): THREE.Group {
  const g = new THREE.BoxGeometry(w, h, d);
  const a = new THREE.EdgesGeometry(g);
  aDisposer.push(g, a);
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  const faces = new THREE.Mesh(g, m.fond);
  const aretes = new THREE.LineSegments(a, m.ligne);
  faces.renderOrder = ORDRE;
  aretes.renderOrder = ORDRE + 1;
  grp.add(faces, aretes);
  parent.add(grp);
  return grp;
}
/** Bloc lumineux plein (yeux, gyrophares) : sans faces sombres. */
function lumiere(parent: THREE.Object3D, couleur: number, w: number, h: number, d: number, x: number, y: number, z: number, aDisposer: { dispose(): void }[]): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: 1, depthWrite: false });
  aDisposer.push(g, mat);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(x, y, z);
  mesh.renderOrder = ORDRE + 2;
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Truck Muche
// ---------------------------------------------------------------------------------------------

function creerTruck(parent: THREE.Object3D, aDisposer: { dispose(): void }[]) {
  const group = new THREE.Group();
  group.visible = false;
  parent.add(group);
  const m = materiaux(COULEUR_TRUCK, aDisposer);
  const L = TRUCK_FOU.longueur, l = TRUCK_FOU.largeur, H = TRUCK_FOU.hauteur;
  // caisse de food truck (arrière) et cabine (avant, −z) plus basse
  boite(group, m, l, H - 0.6, L * 0.68, 0, 0.6 + (H - 0.6) / 2, L * 0.16, aDisposer);
  boite(group, m, l - 0.1, 1.6, L * 0.3, 0, 0.6 + 0.8, -L * 0.34, aDisposer);
  // comptoir et auvent (le côté droit du truck)
  boite(group, m, 0.15, 0.9, L * 0.4, l / 2 + 0.05, 1.9, L * 0.16, aDisposer);
  boite(group, m, 0.9, 0.08, L * 0.5, l / 2 + 0.45, 2.75, L * 0.16, aDisposer);
  // roues
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) boite(group, m, 0.35, 0.9, 0.9, sx * (l / 2 - 0.1), 0.45, sz * (L / 2 - 1.1), aDisposer);
  // gyrophares sur le toit
  const g1 = lumiere(group, 0xff2030, 0.5, 0.3, 0.5, -0.6, H + 0.15, -0.2, aDisposer);
  const g2 = lumiere(group, 0x2a7bff, 0.5, 0.3, 0.5, 0.6, H + 0.15, -0.2, aDisposer);
  // phares avant (rageurs)
  lumiere(group, 0xfff1a0, 0.5, 0.25, 0.1, -0.8, 1.0, -L / 2 - 0.02, aDisposer);
  lumiere(group, 0xfff1a0, 0.5, 0.25, 0.1, 0.8, 1.0, -L / 2 - 0.02, aDisposer);
  return {
    group,
    maj(s: TruckSnap | undefined, tS: number) {
      if (!s) { group.visible = false; return; }
      group.visible = true;
      group.position.set(s.p[0], s.p[1], s.p[2]);
      group.rotation.y = s.cap;
      // il tangue, il est fou
      group.rotation.z = Math.sin(tS * 17) * 0.03 * Math.min(1, Math.abs(s.v) / 10);
      const alt = Math.floor(tS * 6) % 2 === 0;
      g1.visible = alt;
      g2.visible = !alt;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Tigre robot (et titan)
// ---------------------------------------------------------------------------------------------

interface Patte { hanche: THREE.Group; genou: THREE.Group; phase: number; avant: boolean; droite: boolean }

/** Robot en boîtes : remplaçant du tigre 3D tant que son modèle n'est pas chargé (ou s'il ne charge pas). Taille d'origine : 11 m de long. */
function creerTigreBoites(parent: THREE.Object3D, couleur: number | string, aDisposer: { dispose(): void }[]) {
  const group = new THREE.Group();
  group.visible = false;
  parent.add(group);
  const corps = new THREE.Group();
  group.add(corps);
  const m = materiaux(couleur, aDisposer);
  const rayures = materiaux(COULEUR_RAYURES, aDisposer);
  // corps : avant local = −z (la forme de touche place la tête à +5,6 m « devant »)
  boite(corps, m, 3.2, 2.6, 7.6, 0, 4.5, 0.4, aDisposer);
  boite(corps, m, 2.8, 1.6, 2.6, 0, 4.9, -3.2, aDisposer); // poitrail
  // rayures : arceaux sombres sur le dos et les flancs
  for (let i = 0; i < 6; i++) boite(corps, rayures, 3.34, 0.18, 0.35, 0, 5.84, -2.4 + i * 1.15, aDisposer);
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) boite(corps, rayures, 0.08, 1.6, 0.3, sx * 1.64, 4.6, -2 + i * 1.2, aDisposer);
  // tête
  const tete = new THREE.Group();
  tete.position.set(0, 5.4, -5.6);
  corps.add(tete);
  boite(tete, m, 2.4, 2.0, 2.4, 0, 0, 0, aDisposer);
  boite(tete, m, 1.6, 0.8, 1.2, 0, -0.55, -1.6, aDisposer); // museau
  boite(tete, m, 1.4, 0.35, 1.0, 0, -1.15, -1.35, aDisposer); // mâchoire
  for (const sx of [-1, 1]) boite(tete, m, 0.6, 0.8, 0.3, sx * 0.85, 1.35, 0.3, aDisposer); // oreilles
  for (const sx of [-1, 1]) boite(tete, rayures, 0.12, 0.9, 1.5, sx * 1.22, 0.2, 0.1, aDisposer);
  const yeux = [lumiere(tete, COULEUR_YEUX, 0.5, 0.28, 0.12, -0.6, 0.35, -1.22, aDisposer), lumiere(tete, COULEUR_YEUX, 0.5, 0.28, 0.12, 0.6, 0.35, -1.22, aDisposer)];
  // pattes : hanche → cuisse → genou → tibia → pied
  const pattes: Patte[] = [];
  for (const [x, z, avant, phase] of [[-1.4, -3, true, 0], [1.4, -3, true, Math.PI], [-1.4, 3.4, false, Math.PI], [1.4, 3.4, false, 0]] as const) {
    const hanche = new THREE.Group();
    hanche.position.set(x, 3.8, z);
    corps.add(hanche);
    boite(hanche, m, 0.9, 2.0, 1.0, 0, -1.0, 0, aDisposer);
    const genou = new THREE.Group();
    genou.position.set(0, -2.0, 0);
    hanche.add(genou);
    boite(genou, m, 0.7, 1.7, 0.7, 0, -0.85, 0, aDisposer);
    boite(genou, m, 1.0, 0.25, 1.3, 0, -1.75, -0.2, aDisposer);
    pattes.push({ hanche, genou, phase, avant, droite: x > 0 });
  }
  // queue : chaîne de segments
  const queue: THREE.Group[] = [];
  let porteur: THREE.Object3D = corps;
  let qz = 4.3, qy = 5.3;
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Group();
    s.position.set(0, qy, qz);
    porteur.add(s);
    boite(s, i % 2 ? rayures : m, 0.45, 0.45, 1.1, 0, 0, 0.55, aDisposer);
    queue.push(s);
    porteur = s;
    qz = 1.1;
    qy = 0;
  }
  let phaseMarche = 0;
  let patteT = 0;
  return {
    group,
    couleur(c: string) {
      m.ligne.color.set(c);
      m.fond.color.set(c).multiplyScalar(0.09);
    },
    maj(s: { p: Vec3; cap: number; v: number; a?: "patte" | "saut" | "charge"; rage?: boolean } | undefined, echelle: number, tS: number, dt: number, laserProche: number) {
      if (!s) { group.visible = false; return; }
      group.visible = true;
      group.position.set(s.p[0], s.p[1], s.p[2]);
      group.rotation.y = s.cap;
      group.scale.setScalar(echelle);
      const v = Math.abs(s.v);
      // foulée de 4,5 m (à l'échelle) ; les pattes diagonales vont ensemble
      phaseMarche += (v * dt) / (4.5 * echelle) * Math.PI * 2;
      const k = Math.min(1, v / 3);
      for (const p of pattes) {
        const ph = phaseMarche + p.phase;
        p.hanche.rotation.x = Math.sin(ph) * 0.45 * k;
        p.genou.rotation.x = (p.avant ? -1 : 1) * Math.max(0, Math.cos(ph)) * 0.6 * k;
      }
      // coup de patte : la patte avant droite se lève puis s'abat
      patteT = s.a === "patte" ? Math.min(1, patteT + dt / 0.6) : Math.max(0, patteT - dt / 0.25);
      const pd = pattes.find((p) => p.avant && p.droite)!;
      if (patteT > 0) { pd.hanche.rotation.x = 1.3 * patteT; pd.genou.rotation.x = -0.9 * patteT; }
      // le corps oscille à la marche, la tête balaie
      corps.position.y = Math.abs(Math.sin(phaseMarche)) * 0.25 * k;
      corps.rotation.z = Math.sin(phaseMarche) * 0.03 * k;
      tete.rotation.y = Math.sin(tS * 0.9) * 0.25;
      tete.rotation.x = -0.15 * patteT;
      queue.forEach((q, i) => { q.rotation.x = 0.25 + Math.sin(tS * 2.2 - i * 0.7) * 0.18; q.rotation.y = Math.sin(tS * 1.6 - i * 0.6) * 0.25; });
      // les yeux s'embrasent quand le laser est armé
      for (const y of yeux) (y.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.12 + 0.6 * laserProche, 0.2 + 0.6 * laserProche);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Tigre robot géant : le vrai tigre 3D
// ---------------------------------------------------------------------------------------------

/** Pelage du tigre assombri (métal) : sous le seuil du halo, pour que seuls le maillage et les yeux brillent. */
const TEINTE_METAL = 0.32;
/** Opacité du maillage lumineux posé sur le corps. */
const OPACITE_MAILLAGE = 0.1;
/** Yeux en repère du modèle (museau +Z, gauche du tigre +X) et leur rayon (m du modèle). */
const YEUX_MODELE: readonly [number, number, number][] = [[0.037, 0.502, 0.428], [-0.037, 0.502, 0.428]];
const RAYON_OEIL = 0.016;

interface TigreRobot {
  /** groupe orienté (`rotation.y = cap + π/2`) et mis à l'échelle */
  group: THREE.Group;
  tigre: Tigre;
  anim: AnimTigreGeant;
  maillage: THREE.MeshBasicMaterial;
  metal: THREE.MeshBasicMaterial;
  yeux: THREE.MeshBasicMaterial;
  /** sphères des yeux (grossissent quand le laser est armé), `userData.base` = échelle de repos */
  oeils: THREE.Mesh[];
}

/**
 * Clone du tigre 3D en robot : copies propres du matériau, de la texture et de la géométrie (comme la chasse au tigre : sinon three
 * attache le renderer aux objets du modèle partagé et garde le contexte WebGL après la sortie de l'arène), maillage lumineux (même
 * géométrie, même squelette), yeux sur l'os de la tête.
 */
function creerTigreRobot(parent: THREE.Object3D, m: ModeleTigre, couleur: number | string, aDisposer: { dispose(): void }[]): TigreRobot {
  const tigre = creerTigre3D(m);
  aDisposer.push(tigre);
  const metal = new THREE.MeshBasicMaterial({ color: new THREE.Color(couleur).lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(TEINTE_METAL) });
  const maillage = new THREE.MeshBasicMaterial({ color: couleur, wireframe: true, transparent: true, opacity: OPACITE_MAILLAGE, depthWrite: false, blending: THREE.AdditiveBlending });
  aDisposer.push(metal, maillage);
  const vus = new Map<object, THREE.BufferGeometry>();
  const maillages: THREE.SkinnedMesh[] = [];
  tigre.groupe.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) maillages.push(o as THREE.SkinnedMesh); });
  for (const mesh of maillages) {
    const orig = mesh.material as THREE.MeshBasicMaterial;
    if (orig.map && !metal.map) { metal.map = orig.map.clone(); metal.map.needsUpdate = true; aDisposer.push(metal.map); }
    mesh.material = metal;
    let geo = vus.get(mesh.geometry);
    if (!geo) { geo = mesh.geometry.clone(); vus.set(mesh.geometry, geo); aDisposer.push(geo); }
    mesh.geometry = geo;
    // la main humaine du thème Tigre n'a rien à faire ici
    if (mesh.morphTargetInfluences?.length) mesh.morphTargetInfluences[0] = 0;
    const fil = new THREE.SkinnedMesh(geo, maillage);
    fil.bind(mesh.skeleton, mesh.bindMatrix);
    fil.frustumCulled = false;
    fil.renderOrder = ORDRE + 1;
    mesh.parent?.add(fil);
  }
  // pas d'ombre floue : le monstre est posé sur la grille de l'arène
  tigre.ombre.visible = false;
  // yeux : posés au repos en repère du modèle, puis rattachés à l'os de la tête (ils suivent ses mouvements)
  const yeux = new THREE.MeshBasicMaterial({ color: COULEUR_YEUX });
  const geoOeil = new THREE.SphereGeometry(RAYON_OEIL, 10, 8);
  aDisposer.push(yeux, geoOeil);
  tigre.groupe.updateMatrixWorld(true);
  const osTete = tigre.os[squelette().i.tete];
  const oeils: THREE.Mesh[] = [];
  // l'armature du GLB a sa propre échelle : la sphère, enfant de l'os, la compense pour garder son rayon en m du modèle
  const echelleOs = osTete.getWorldScale(new THREE.Vector3()).x / tigre.groupe.getWorldScale(new THREE.Vector3()).x;
  for (const [x, y, z] of YEUX_MODELE) {
    const oeil = new THREE.Mesh(geoOeil, yeux);
    const local = osTete.worldToLocal(tigre.groupe.localToWorld(new THREE.Vector3(x, y, z)));
    oeil.position.copy(local);
    oeil.scale.setScalar(1 / Math.max(echelleOs, 1e-6));
    oeil.userData.base = oeil.scale.x;
    oeils.push(oeil);
    oeil.renderOrder = ORDRE + 2;
    osTete.add(oeil);
  }
  const group = new THREE.Group();
  group.visible = false;
  group.add(tigre.groupe);
  parent.add(group);
  return { group, tigre, anim: creerAnimTigreGeant(), maillage, metal, yeux, oeils };
}

/** Tigre robot (boss ou titan) : le vrai tigre une fois le modèle chargé, le robot en boîtes avant. */
function creerTigre(parent: THREE.Object3D, couleur: number | string, aDisposer: { dispose(): void }[]) {
  const boites = creerTigreBoites(parent, couleur, aDisposer);
  let robot: TigreRobot | null = null;
  let couleurCourante: string | number = couleur;
  let rageAvant = false;
  let detruit = false;
  chargerModele().then((m) => {
    if (detruit) return;
    robot = creerTigreRobot(parent, m, couleurCourante, aDisposer);
  }).catch(() => { /* le robot en boîtes reste */ });
  return {
    couleur(c: string) {
      couleurCourante = c;
      boites.couleur(c);
      if (robot) {
        robot.maillage.color.set(c);
        robot.metal.color.set(c).lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(TEINTE_METAL);
      }
    },
    maj(s: { p: Vec3; cap: number; v: number; a?: "patte" | "saut" | "charge"; rage?: boolean } | undefined, echelle: number, tS: number, dt: number, laserProche: number) {
      if (!robot) { boites.maj(s, echelle / 10, tS, dt, laserProche); return; }
      boites.maj(undefined, 1, tS, dt, 0);
      const r = robot;
      if (!s) { r.group.visible = false; return; }
      r.group.visible = true;
      r.group.position.set(s.p[0], s.p[1], s.p[2]);
      // le corps marche le long de +x de son repère : +x devient l'avant (−sin cap, −cos cap)
      r.group.rotation.y = s.cap + Math.PI / 2;
      r.tigre.groupe.scale.setScalar(echelle);
      r.anim.maj(dt, s.v, echelle, s.a === "patte" || s.a === "charge" || s.a === "saut");
      r.tigre.appliquer(r.anim.pose(), r.anim.x());
      // les yeux s'embrasent quand le laser est armé ; le maillage pulse doucement
      r.yeux.color.setRGB(1, 0.1 + 0.25 * laserProche, 0.12 + 0.2 * laserProche);
      // enragé : le maillage vire au rouge
      if (s.rage !== rageAvant) { rageAvant = !!s.rage; r.maillage.color.set(s.rage ? 0xff2a2a : couleurCourante); }
      for (const o of r.oeils) o.scale.setScalar(o.userData.base * (1 + 0.8 * laserProche));
      r.maillage.opacity = OPACITE_MAILLAGE * (0.85 + 0.15 * Math.sin(tS * 3)) + 0.12 * laserProche;
    },
    detruire() { detruit = true; },
  };
}

// ---------------------------------------------------------------------------------------------
// Laser et explosions
// ---------------------------------------------------------------------------------------------

function creerLaser(parent: THREE.Object3D, aDisposer: { dispose(): void }[]) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  geo.translate(0, 0.5, 0);
  geo.rotateX(Math.PI / 2); // axe le long de +z, de 0 à 1
  const mat = new THREE.MeshBasicMaterial({ color: COULEUR_LASER, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const n = 48;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    pts.push(Math.cos(a), 0.08, Math.sin(a), Math.cos(b), 0.08, Math.sin(b));
  }
  const anneauGeo = new THREE.BufferGeometry();
  anneauGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const anneauMat = new THREE.LineBasicMaterial({ color: COULEUR_LASER, transparent: true, opacity: 0.9, depthWrite: false });
  aDisposer.push(geo, mat, anneauGeo, anneauMat);
  const rayons: THREE.Mesh[] = [];
  const anneaux: THREE.LineSegments[] = [];
  const obtenir = (i: number) => {
    while (rayons.length <= i) {
      const r = new THREE.Mesh(geo, mat.clone());
      r.renderOrder = ORDRE + 3;
      const an = new THREE.LineSegments(anneauGeo, anneauMat.clone());
      an.renderOrder = ORDRE + 3;
      aDisposer.push(r.material as THREE.Material, an.material as THREE.Material);
      parent.add(r, an);
      rayons.push(r);
      anneaux.push(an);
    }
    return { r: rayons[i], an: anneaux[i] };
  };
  const de = new THREE.Vector3(), vers = new THREE.Vector3();
  return {
    maj(lasers: readonly LaserAnnonce[], ts: number) {
      lasers.forEach((l, i) => {
        const { r, an } = obtenir(i);
        const avant = l.tirT - ts; // ms avant l'impact (négatif : éclair)
        const k = avant > 0 ? 1 - Math.min(1, avant / 1400) : 1;
        de.set(l.de[0], l.de[1], l.de[2]);
        vers.set(l.vers[0], l.vers[1] + 0.5, l.vers[2]);
        const longueur = de.distanceTo(vers);
        r.position.copy(de);
        r.lookAt(vers);
        const epaisseur = avant > 0 ? 0.05 + 0.18 * k : 0.9;
        r.scale.set(epaisseur, epaisseur, longueur);
        (r.material as THREE.MeshBasicMaterial).opacity = avant > 0 ? 0.25 + 0.5 * k : 0.95;
        // onde de choc : pas de rayon, seulement l'anneau au sol
        r.visible = !l.onde && longueur > 0.1;
        an.position.set(l.vers[0], 0, l.vers[2]);
        const pulse = 1 + 0.08 * Math.sin(ts / 60);
        an.scale.set(l.rayon * pulse, 1, l.rayon * pulse);
        an.visible = true;
      });
      for (let i = lasers.length; i < rayons.length; i++) { rayons[i].visible = false; anneaux[i].visible = false; }
    },
  };
}

function creerExplosions(parent: THREE.Object3D, aDisposer: { dispose(): void }[]) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const aretes = new THREE.EdgesGeometry(geo);
  aDisposer.push(geo, aretes);
  const pool = Array.from({ length: EXPLOSIONS }, () => {
    const mat = new THREE.LineBasicMaterial({ color: COULEUR_EXPLOSION, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    aDisposer.push(mat);
    const l = new THREE.LineSegments(aretes, mat);
    l.visible = false;
    l.renderOrder = ORDRE + 3;
    parent.add(l);
    return { l, mat, age: Infinity, rayon: 1 };
  });
  let prochain = 0;
  return {
    lancer(p: Vec3, rayon: number) {
      const e = pool[prochain++ % pool.length];
      e.l.position.set(p[0], p[1], p[2]);
      e.age = 0;
      e.rayon = rayon;
      e.l.visible = true;
    },
    maj(dt: number) {
      for (const e of pool) {
        if (e.age === Infinity) continue;
        e.age += dt;
        const k = e.age / DUREE_EXPLOSION_S;
        if (k >= 1) { e.age = Infinity; e.l.visible = false; continue; }
        const s = e.rayon * (0.3 + 0.9 * Math.sqrt(k));
        e.l.scale.setScalar(s);
        e.l.rotation.y += dt * 1.5;
        e.mat.opacity = 1 - k;
        e.mat.color.setRGB(1, 0.75 - 0.5 * k, 0.3 - 0.3 * k);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fabrique
// ---------------------------------------------------------------------------------------------

export function creerRenduMonstres(scene: THREE.Scene): RenduMonstres {
  const racine = new THREE.Group();
  racine.name = "monstres";
  scene.add(racine);
  const aDisposer: { dispose(): void }[] = [];
  const truck = creerTruck(racine, aDisposer);
  const tigre = creerTigre(racine, COULEUR_TIGRE, aDisposer);
  const titan = creerTigre(racine, "#9be9ff", aDisposer);
  const laser = creerLaser(racine, aDisposer);
  const explosions = creerExplosions(racine, aDisposer);
  let couleurTitan = "";
  return {
    maj(m, lasers, tS, tsServeur, dt, couleur, piloteMoi) {
      truck.maj(m.truck, tS);
      const proche = lasers.length ? Math.max(...lasers.map((l) => (l.tirT > tsServeur ? 1 - Math.min(1, (l.tirT - tsServeur) / 1400) : 0))) : 0;
      tigre.maj(m.tigre, ECHELLE_TIGRE, tS, dt, proche);
      if (couleur !== couleurTitan) { couleurTitan = couleur; titan.couleur(couleur); }
      // le pilote ne voit pas son propre titan (vue depuis la tête)
      titan.maj(piloteMoi ? undefined : m.titan, TITAN.echelle, tS, dt, 0);
      laser.maj(lasers, tsServeur);
      explosions.maj(dt);
    },
    explosion(p, rayon) {
      explosions.lancer(p, rayon);
    },
    dispose() {
      tigre.detruire();
      titan.detruire();
      scene.remove(racine);
      for (const x of aDisposer) x.dispose();
      aDisposer.length = 0;
    },
  };
}
