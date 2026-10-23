/**
 * Rendu du monde dynamique de l'arène (three) : voitures PNJ, voitures conduisibles (couleur du conducteur), le Truck Muche garé (v3 §2) avec
 * Elsa (petit personnage fil de fer ambre) DEDANS, derrière le passe-plat, le cadeau posé sur le comptoir et le faisceau vertical au point de
 * service. Aucun test vitest (three) : les régressions se voient aux captures.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.7, §2.11, §2.12, §5.15)
 *
 * Même langage visuel que les avatars de `rendu.ts` : fil de fer lumineux, faces sombres qui masquent les arêtes cachées et sont elles-mêmes
 * masquées par les bâtiments (faces à l'ordre 5, arêtes à 6, après les bâtiments de decor.ts). Repère de protocole.ts : x est, z sud, y haut ;
 * une voiture ou Elsa est un `Group` dont l'origine est au sol et que l'on oriente par le cap (`rotation.y = cap`, avant local = −z, soit
 * `(−sin cap, −cos cap)` comme `etatVoiture` et `vehicule.ts`).
 *
 * Contrat d'intégration pour jeu-monde.ts :
 *  - les voitures PNJ sont dessinées d'après `etatsPnj(client.maintenantServeur())`, dans l'ordre de `flotte` (l'indice fixe la teinte, comme `flotte`) ;
 *  - `majVoituresJoueurs` cache les véhicules absents de la liste ; une voiture libre est grise, occupée elle prend la couleur du conducteur ;
 *  - `dispose()` retire tout de la scène et libère géométries, matériaux et texture : rien n'est partagé entre deux mondes.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EtatElsaMsg, EtatVoitureMsg, VehiculeSnap, Vec3 } from "./protocole";
import { VOITURE, type EtatVoiture } from "./circulation";
import { hauteurPlaquePx } from "./visibilite";
import { TRUCK, versMondeTruck, type PlaceTruck } from "./zones";

export interface MondeDynamique {
  /** Voitures PNJ (une entrée par voiture, dans l'ordre de `flotte`) ; `cachee(i)` : PNJ en épave, non dessinée (v3 §4). */
  majVoituresPnj(etats: readonly EtatVoiture[], cachee?: (i: number) => boolean): void;
  /** Épaves (v3 §4) : carcasses calcinées aux positions des explosions (les entrées `etat: "epave"`). */
  majEpaves(etats: Iterable<EtatVoitureMsg>): void;
  /** Voitures conduisibles (interpolées) ; `couleurs` : couleur du conducteur par id de véhicule si occupé. */
  majVoituresJoueurs(vehicules: readonly VehiculeSnap[], couleurs: ReadonlyMap<number, string>): void;
  /** Elsa (toujours là) + caisse et faisceau quand `elsa.offre` ; `tS` en secondes pour l'animation. */
  majElsa(elsa: EtatElsaMsg | null, tS: number): void;
  /** Étiquette « Elsa » : position monde de la tête (pour VisibilitePseudos) et réglage d'alpha. */
  elsaTete(): Vec3;
  afficherPseudoElsa(alpha: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

/** Ordre de dessin des faces ; les arêtes sont à +1 (comme les avatars : après les bâtiments, qui les occultent). */
const ORDRE_BASE = 5;
const ORDRE_FAISCEAU = 9;
const ORDRE_PSEUDO = 10;
/** Angle d'or (degrés) : mêmes teintes que `flotte` (circulation.ts) pour le même indice de voiture. */
const ANGLE_OR_DEG = 137.508;
/** Carrosserie d'une voiture conduisible LIBRE : grise, pour qu'elle se distingue des PNJ saturés et des joueurs colorés. */
const COULEUR_VOITURE_LIBRE = "#b9c4d0";
/** Carcasse calcinée d'une épave : rouille éteinte. */
const COULEUR_EPAVE = "#7a5a46";
const COULEUR_ELSA = 0xffb35c;
const COULEUR_CADEAU_SOIN = 0x5cff9c;
const COULEUR_CADEAU_ARME = 0xffd24d;
/** Elsa : échelle (spec §2.7), debout sur le plancher du truck. Étiquette au-dessus du toit (sinon le truck la cache). */
const ECHELLE_ELSA = 0.9;
const Y_PSEUDO_ELSA = TRUCK.hauteur + 1.1;
/**
 * Point de visibilité de l'étiquette (VisibilitePseudos) : dans l'ouverture du passe-plat, juste DEHORS (Elsa elle-même est dans le prisme
 * du truck, toujours « cachée » pour un rayon). Local (x hors du flanc, y au niveau de sa tête).
 */
const VISEE_ELSA_LOCAL = { x: TRUCK.largeur / 2 + 0.3, y: TRUCK.plancher + 1.55 };
/** Le cadeau tourne au-dessus du comptoir, côté extérieur. */
const CADEAU_LOCAL_X = TRUCK.largeur / 2 + 0.2;
/** Couleur du truck (ambre de la vue aérienne). */
const COULEUR_TRUCK = 0xffb35c;
const HAUTEUR_FAISCEAU_M = 60;
/** Rayon de ramassage (m) : l'anneau au sol le montre (elsa.ts : 2,5 m). */
const RAYON_ANNEAU_M = 2.5;

const borne = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------------------------------------
// Outils filaires
// ---------------------------------------------------------------------------------------------

/** Géométrie des faces + arêtes : un seul `Mesh` et un seul `LineSegments` par objet, même fusionné. */
interface GeoPiece { geo: THREE.BufferGeometry; aretes: THREE.BufferGeometry }

function enPiece(geo: THREE.BufferGeometry): GeoPiece {
  return { geo, aretes: new THREE.EdgesGeometry(geo, 12) };
}

function libererPiece(g: GeoPiece): void {
  g.geo.dispose();
  g.aretes.dispose();
}

/** Boîte w×h×d dont le centre est en (x, y, z). */
function boite(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Garde le seul attribut `position` (+ index) : tous les morceaux fusionnés doivent avoir les mêmes attributs. */
function nu(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  return g;
}

interface Materiaux { ligne: THREE.LineBasicMaterial; fond: THREE.MeshBasicMaterial }

/** Arêtes lumineuses + faces sombres (profondeur testée, les faces écrivent la profondeur : elles masquent les arêtes cachées). */
function creerMateriaux(couleur: THREE.Color): Materiaux {
  const ligne = new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.95, depthWrite: false });
  const fond = new THREE.MeshBasicMaterial({
    color: couleur.clone().multiplyScalar(0.09),
    transparent: true,
    opacity: 1,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
  return { ligne, fond };
}

function libererMateriaux(m: Materiaux): void {
  m.ligne.dispose();
  m.fond.dispose();
}

/** Pièce filaire (faces + arêtes) posée dans `parent`, avec les ordres de dessin des avatars. */
function piece(parent: THREE.Object3D, g: GeoPiece, m: Materiaux, x = 0, y = 0, z = 0): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  const faces = new THREE.Mesh(g.geo, m.fond);
  const aretes = new THREE.LineSegments(g.aretes, m.ligne);
  faces.renderOrder = ORDRE_BASE;
  aretes.renderOrder = ORDRE_BASE + 1;
  grp.add(faces, aretes);
  parent.add(grp);
  return grp;
}

// ---------------------------------------------------------------------------------------------
// Voitures
// ---------------------------------------------------------------------------------------------

/**
 * Silhouette d'une voiture (4,4 × 1,9 × 1,5 m, avant = −z) en un seul maillage : châssis, habitacle au pare-brise incliné et reculé,
 * quatre roues, deux phares. Fusionner garde deux appels de dessin par voiture (18 voitures en jeu).
 */
function geometrieVoiture(): THREE.BufferGeometry {
  const { longueur: L, largeur: l } = VOITURE;
  const morceaux: THREE.BufferGeometry[] = [];
  // châssis : de 0,28 à 0,88 m
  morceaux.push(nu(boite(l, 0.6, L, 0, 0.58, 0)));
  // habitacle : de 0,88 à 1,5 m ; pare-brise (avant, −z) très incliné, lunette arrière plus droite
  const cab = boite(l - 0.3, VOITURE.hauteur - 0.88, 2.4, 0, (0.88 + VOITURE.hauteur) / 2, 0.25);
  const pos = cab.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) <= 0.88 + 1e-6) continue;
    pos.setZ(i, pos.getZ(i) + (pos.getZ(i) < 0.25 ? 0.4 : -0.2));
  }
  pos.needsUpdate = true;
  morceaux.push(nu(cab));
  // roues : cylindres d'axe x
  const rayonRoue = 0.33;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const r = new THREE.CylinderGeometry(rayonRoue, rayonRoue, 0.24, 10, 1, false);
      r.rotateZ(Math.PI / 2);
      r.translate(sx * (l / 2 - 0.13), rayonRoue, sz * (L / 2 - 0.85));
      morceaux.push(nu(r));
    }
  }
  // phares : deux petits blocs à l'avant, ils disent où est l'avant
  for (const sx of [-1, 1]) morceaux.push(nu(boite(0.34, 0.14, 0.08, sx * 0.62, 0.68, -L / 2)));
  const fusion = mergeGeometries(morceaux, false);
  for (const g of morceaux) g.dispose();
  if (!fusion) throw new Error("rendu-monde : fusion de la voiture impossible");
  return fusion;
}

interface InstanceVoiture {
  group: THREE.Group;
  m: Materiaux;
  /** couleur actuellement appliquée (évite de recolorer à chaque image) */
  couleur: string;
}

function creerInstanceVoiture(parent: THREE.Object3D, g: GeoPiece, couleur: string): InstanceVoiture {
  const col = new THREE.Color(couleur);
  const m = creerMateriaux(col);
  const group = piece(parent, g, m);
  group.visible = false;
  return { group, m, couleur };
}

function colorer(v: InstanceVoiture, couleur: string): void {
  if (v.couleur === couleur) return;
  v.couleur = couleur;
  v.m.ligne.color.set(couleur);
  v.m.fond.color.set(couleur).multiplyScalar(0.09);
}

function poserVoiture(v: InstanceVoiture, p: Vec3, cap: number): void {
  v.group.position.set(p[0], p[1], p[2]);
  v.group.rotation.y = cap;
  v.group.visible = true;
}

/** Teinte HSL de la voiture PNJ d'indice `i` : celle de `flotte` (angle d'or), saturée et lumineuse sur fond noir. */
function couleurPnj(i: number): string {
  return `#${new THREE.Color().setHSL(((i * ANGLE_OR_DEG) % 360) / 360, 0.85, 0.55).getHexString()}`;
}

// ---------------------------------------------------------------------------------------------
// Elsa
// ---------------------------------------------------------------------------------------------

/** Plaque « Elsa » : sombre, bordée et écrite de la couleur d'Elsa (même style que les pseudos des avatars). */
function texturePseudoElsa(): { tex: THREE.CanvasTexture | null; ratio: number } {
  const L = 384, H = 72;
  const ratio = L / H;
  // pas de canevas hors navigateur (tests de fumée sous Node) : l'étiquette reste sans texture
  if (typeof document === "undefined") return { tex: null, ratio };
  const cv = document.createElement("canvas");
  cv.width = L;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const css = `#${new THREE.Color(COULEUR_ELSA).getHexString()}`;
  if (ctx) {
    ctx.fillStyle = "rgba(4, 6, 10, 0.78)";
    ctx.beginPath();
    ctx.roundRect(3, 3, L - 6, H - 6, 12);
    ctx.fill();
    ctx.strokeStyle = css;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = `600 40px "Chakra Petch", "IBM Plex Mono", ui-monospace, system-ui, sans-serif`;
    ctx.fillStyle = css;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Elsa", L / 2, H / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, ratio };
}

/** Faisceau vertical : cylindre ouvert, dégradé de luminosité du sol (vif) vers le haut (éteint) par couleurs de sommets, mélange additif. */
function geometrieFaisceau(rayon: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rayon, rayon, HAUTEUR_FAISCEAU_M, 12, 1, true);
  g.translate(0, HAUTEUR_FAISCEAU_M / 2, 0);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const couleurs = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - 0.85 * borne(pos.getY(i) / HAUTEUR_FAISCEAU_M);
    couleurs[3 * i] = k;
    couleurs[3 * i + 1] = k;
    couleurs[3 * i + 2] = k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(couleurs, 3));
  return g;
}

/** Anneau au sol (cercle de `RAYON_ANNEAU_M`) : montre jusqu'où il faut s'approcher. */
function geometrieAnneau(): THREE.BufferGeometry {
  const n = 48;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    pts.push(Math.cos(a) * RAYON_ANNEAU_M, 0.06, Math.sin(a) * RAYON_ANNEAU_M, Math.cos(b) * RAYON_ANNEAU_M, 0.06, Math.sin(b) * RAYON_ANNEAU_M);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Truck Muche (v3 §2)
// ---------------------------------------------------------------------------------------------

/**
 * Le Truck Muche en repère local (avant = −z, droite = +x, origine au sol au centre) : châssis, cabine, caisse en PANNEAUX minces (on voit
 * dedans par le passe-plat ouvert du flanc droit), comptoir, volet relevé en auvent, roues et enseigne. Un seul maillage fusionné.
 */
function geometrieTruck(): THREE.BufferGeometry {
  const { longueur: L, largeur: l, hauteur: H, cabine, hauteurCabine, plancher, comptoir, linteau, fenetreZ, fenetreLargeur } = TRUCK;
  const e = 0.06; // épaisseur des panneaux
  const z0 = -L / 2 + cabine, z1 = L / 2; // caisse
  const zc = (z0 + z1) / 2, lc = z1 - z0;
  const f0 = fenetreZ - fenetreLargeur / 2, f1 = fenetreZ + fenetreLargeur / 2;
  const m: THREE.BufferGeometry[] = [];
  const b = (w: number, h: number, d: number, x: number, y: number, z: number) => m.push(nu(boite(w, h, d, x, y, z)));
  // châssis plein sous le plancher, cabine
  b(l, plancher - 0.35, L, 0, (plancher + 0.35) / 2, 0);
  b(l, hauteurCabine - plancher, cabine, 0, (plancher + hauteurCabine) / 2, -L / 2 + cabine / 2);
  // caisse : toit, flanc gauche, cloison avant, porte arrière
  b(l, e, lc, 0, H - e / 2, zc);
  b(e, H - plancher, lc, -l / 2 + e / 2, (plancher + H) / 2, zc);
  b(l, H - plancher, e, 0, (plancher + H) / 2, z0 + e / 2);
  b(l, H - plancher, e, 0, (plancher + H) / 2, z1 - e / 2);
  // flanc droit autour du passe-plat : allège, bandeau, deux montants
  const xd = l / 2 - e / 2;
  b(e, comptoir - plancher, lc, xd, (plancher + comptoir) / 2, zc);
  b(e, H - linteau, lc, xd, (linteau + H) / 2, zc);
  b(e, linteau - comptoir, f0 - z0, xd, (comptoir + linteau) / 2, (z0 + f0) / 2);
  b(e, linteau - comptoir, z1 - f1, xd, (comptoir + linteau) / 2, (f1 + z1) / 2);
  // comptoir en saillie
  b(0.42, 0.06, fenetreLargeur, l / 2 + 0.15, comptoir, fenetreZ);
  // volet relevé en auvent, articulé au linteau
  const volet = boite(1.25, 0.05, fenetreLargeur + 0.2, 0.625, 0, 0);
  volet.rotateZ(0.42);
  volet.translate(l / 2, linteau + 0.04, fenetreZ);
  m.push(nu(volet));
  // enseigne sur le toit, côté passe-plat
  b(0.08, 0.55, 3.6, l / 2 - 0.25, H + 0.35, fenetreZ);
  // roues (avant sous la cabine, arrière sous la caisse)
  for (const sx of [-1, 1]) {
    for (const z of [-L / 2 + 1, L / 2 - 1.3]) {
      const r = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12, 1, false);
      r.rotateZ(Math.PI / 2);
      r.translate(sx * (l / 2 - 0.12), 0.45, z);
      m.push(nu(r));
    }
  }
  // pare-brise : un cadre incliné à l'avant de la cabine
  const pb = boite(l - 0.3, 0.9, 0.05, 0, 0, 0);
  pb.rotateX(-0.35);
  pb.translate(0, hauteurCabine - 0.55, -L / 2 - 0.08);
  m.push(nu(pb));
  const fusion = mergeGeometries(m, false);
  for (const g of m) g.dispose();
  if (!fusion) throw new Error("rendu-monde : fusion du truck impossible");
  return fusion;
}

/** Texture de l'enseigne « LE TRUCK MUCHE » (null hors navigateur). */
function textureEnseigne(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 80;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#06080c";
    ctx.fillRect(0, 0, 512, 80);
    ctx.font = `700 46px "Chakra Petch", "IBM Plex Mono", ui-monospace, system-ui, sans-serif`;
    ctx.fillStyle = `#${new THREE.Color(COULEUR_TRUCK).getHexString()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LE TRUCK MUCHE", 256, 43);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Fabrique
// ---------------------------------------------------------------------------------------------

export function creerMondeDynamique(scene: THREE.Scene, o: { nbPnj: number; nbVehicules: number; truck: PlaceTruck }): MondeDynamique {
  const racine = new THREE.Group();
  racine.name = "monde-dynamique";
  scene.add(racine);

  const aDisposer: { dispose(): void }[] = [];
  const suivre = <T extends { dispose(): void }>(x: T): T => { aDisposer.push(x); return x; };

  // ---- voitures ----
  const geoVoiture = enPiece(geometrieVoiture());
  const pnj: InstanceVoiture[] = [];
  const joueurs: InstanceVoiture[] = [];
  const epaves: InstanceVoiture[] = [];
  /** id de véhicule → rang d'instance : un véhicule garde le même maillage tant que le monde vit */
  const rangVehicule = new Map<number, number>();
  const voiturePnj = (i: number) => {
    while (pnj.length <= i) pnj.push(creerInstanceVoiture(racine, geoVoiture, couleurPnj(pnj.length)));
    return pnj[i];
  };
  const voitureJoueur = (id: number) => {
    let rang = rangVehicule.get(id);
    if (rang === undefined) {
      rang = rangVehicule.size;
      rangVehicule.set(id, rang);
    }
    while (joueurs.length <= rang) joueurs.push(creerInstanceVoiture(racine, geoVoiture, COULEUR_VOITURE_LIBRE));
    return joueurs[rang];
  };
  for (let i = 0; i < o.nbPnj; i++) voiturePnj(i);
  for (let i = 0; i < o.nbVehicules; i++) joueurs.push(creerInstanceVoiture(racine, geoVoiture, COULEUR_VOITURE_LIBRE));

  // ---- Truck Muche garé : Elsa est dedans, le cadeau et l'étiquette s'y placent en repère local ----
  const truck = new THREE.Group();
  truck.position.set(o.truck.x, 0, o.truck.z);
  truck.rotation.y = o.truck.cap;
  racine.add(truck);
  const geoTruck = enPiece(geometrieTruck());
  suivre({ dispose: () => libererPiece(geoTruck) });
  const mTruck = creerMateriaux(new THREE.Color(COULEUR_TRUCK));
  suivre({ dispose: () => libererMateriaux(mTruck) });
  piece(truck, geoTruck, mTruck);
  const texEnseigne = textureEnseigne();
  if (texEnseigne) {
    suivre(texEnseigne);
    const matEnseigne = suivre(new THREE.MeshBasicMaterial({ map: texEnseigne, toneMapped: false }));
    const geoEnseigne = suivre(new THREE.PlaneGeometry(3.4, 0.5));
    const enseigne = new THREE.Mesh(geoEnseigne, matEnseigne);
    enseigne.rotation.y = Math.PI / 2; // face au flanc droit (+x local)
    enseigne.position.set(TRUCK.largeur / 2 - 0.2, TRUCK.hauteur + 0.35, TRUCK.fenetreZ);
    enseigne.renderOrder = ORDRE_BASE + 1;
    truck.add(enseigne);
  }

  // ---- Elsa : petit personnage fil de fer ambre, debout sur le plancher, face au passe-plat ----
  const elsa = new THREE.Group();
  elsa.position.set(TRUCK.largeur / 2 - TRUCK.retraitElsa, TRUCK.plancher, TRUCK.fenetreZ);
  // l'avant d'Elsa est −z : un quart de tour la tourne vers +x (le passe-plat)
  elsa.rotation.y = -Math.PI / 2;
  truck.add(elsa);
  const corpsElsa = new THREE.Group();
  corpsElsa.scale.setScalar(ECHELLE_ELSA);
  elsa.add(corpsElsa);

  const mElsa = creerMateriaux(new THREE.Color(COULEUR_ELSA));
  const piecesElsa = {
    bassin: enPiece(nu(boite(0.38, 0.18, 0.24))),
    cuisse: enPiece(nu(boite(0.15, 0.43, 0.16, 0, -0.215, 0))),
    mollet: enPiece(nu(boite(0.12, 0.43, 0.13, 0, -0.215, 0))),
    pied: enPiece(nu(boite(0.12, 0.07, 0.26))),
    torse: enPiece(nu(boite(0.46, 0.48, 0.26, 0, 0.24, 0))),
    tete: enPiece(new THREE.IcosahedronGeometry(0.18, 1)),
    visiere: enPiece(nu(boite(0.2, 0.05, 0.05))),
    toque: enPiece(nu(new THREE.CylinderGeometry(0.15, 0.12, 0.24, 8, 1, false))),
    brasHaut: enPiece(nu(boite(0.1, 0.35, 0.1, 0, -0.175, 0))),
    brasBas: enPiece(nu(boite(0.08, 0.35, 0.08, 0, -0.175, 0))),
    main: enPiece(nu(boite(0.09, 0.09, 0.09))),
    queue: enPiece(nu(boite(0.07, 0.22, 0.07, 0, -0.11, 0))),
  };
  for (const p of Object.values(piecesElsa)) suivre({ dispose: () => libererPiece(p) });
  suivre({ dispose: () => libererMateriaux(mElsa) });

  const corps = new THREE.Group(); // hanches à 0,9 m
  corps.position.y = 0.9;
  corpsElsa.add(corps);
  piece(corps, piecesElsa.bassin, mElsa);
  for (const x of [-0.1, 0.1]) {
    const hanche = new THREE.Group();
    hanche.position.set(x, 0, 0);
    corps.add(hanche);
    piece(hanche, piecesElsa.cuisse, mElsa);
    const genou = new THREE.Group();
    genou.position.y = -0.43;
    hanche.add(genou);
    piece(genou, piecesElsa.mollet, mElsa);
    piece(genou, piecesElsa.pied, mElsa, 0, -0.43, -0.06);
  }
  const torse = new THREE.Group();
  torse.position.y = 0.08;
  corps.add(torse);
  piece(torse, piecesElsa.torse, mElsa, 0, 0, 0);
  const tete = new THREE.Group();
  tete.position.y = 0.46;
  torse.add(tete);
  piece(tete, piecesElsa.tete, mElsa, 0, 0.17, 0);
  piece(tete, piecesElsa.visiere, mElsa, 0, 0.19, -0.17);
  piece(tete, piecesElsa.toque, mElsa, 0, 0.45, 0); // toque de cuisinière : c'est la cuisine du Truck Muche
  piece(tete, piecesElsa.queue, mElsa, 0, 0.28, 0.2); // couette
  const bras = (cote: number) => {
    const epaule = new THREE.Group();
    epaule.position.set(cote * 0.27, 0.42, 0);
    torse.add(epaule);
    piece(epaule, piecesElsa.brasHaut, mElsa);
    const coude = new THREE.Group();
    coude.position.y = -0.35;
    epaule.add(coude);
    piece(coude, piecesElsa.brasBas, mElsa);
    piece(coude, piecesElsa.main, mElsa, 0, -0.38, 0);
    return { epaule, coude };
  };
  const brasD = bras(1), brasG = bras(-1);

  // Étiquette : sprite à taille constante à l'écran, masquée par les bâtiments, alpha réglé par la visibilité (VisibilitePseudos).
  const { tex, ratio } = texturePseudoElsa();
  if (tex) suivre(tex);
  const matPseudo = suivre(new THREE.SpriteMaterial({ map: tex ?? undefined, transparent: true, opacity: 0, depthWrite: false, depthTest: true, toneMapped: false }));
  const etiquette = new THREE.Sprite(matPseudo);
  etiquette.position.y = Y_PSEUDO_ELSA;
  etiquette.renderOrder = ORDRE_PSEUDO;
  etiquette.frustumCulled = false;
  etiquette.visible = false;
  const _pw = new THREE.Vector3(), _pc = new THREE.Vector3();
  etiquette.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    etiquette.getWorldPosition(_pw);
    _pc.setFromMatrixPosition(cam.matrixWorld);
    const d = Math.max(_pw.distanceTo(_pc), 0.5);
    const hPx = (renderer.domElement as HTMLCanvasElement).clientHeight || 800;
    const h = (hauteurPlaquePx(d) / hPx) * 2 * d * Math.tan(((cam.fov || 90) * Math.PI) / 360);
    etiquette.scale.set(h * ratio, h, 1);
    etiquette.updateMatrixWorld();
  };
  // enfant du truck et non d'Elsa (elle tourne) : au-dessus du toit, à l'aplomb d'Elsa
  etiquette.position.set(TRUCK.largeur / 2 - TRUCK.retraitElsa, Y_PSEUDO_ELSA, TRUCK.fenetreZ);
  truck.add(etiquette);

  // ---- cadeau : caisse tournante sur le comptoir ; faisceau additif de 60 m (profondeur testée) et anneau de ramassage au point de service ----
  const cadeau = new THREE.Group();
  cadeau.visible = false;
  racine.add(cadeau);
  const caisseComptoir = new THREE.Group();
  caisseComptoir.position.set(CADEAU_LOCAL_X, 0, TRUCK.fenetreZ);
  caisseComptoir.visible = false;
  truck.add(caisseComptoir);
  const mCadeau = creerMateriaux(new THREE.Color(COULEUR_CADEAU_ARME));
  suivre({ dispose: () => libererMateriaux(mCadeau) });
  const piecesCadeau = [
    enPiece(nu(boite(0.6, 0.6, 0.6))),
    enPiece(nu(boite(0.64, 0.64, 0.12))), // ruban
    enPiece(nu(boite(0.12, 0.64, 0.64))), // ruban croisé
  ];
  for (const p of piecesCadeau) suivre({ dispose: () => libererPiece(p) });
  const caisse = new THREE.Group();
  caisse.scale.setScalar(0.75);
  caisseComptoir.add(caisse);
  for (const p of piecesCadeau) piece(caisse, p, mCadeau);

  const geoFaisceauInt = suivre(geometrieFaisceau(0.12));
  const geoFaisceauExt = suivre(geometrieFaisceau(0.5));
  const geoAnneau = suivre(geometrieAnneau());
  const matFaisceau = (opacite: number) => new THREE.MeshBasicMaterial({
    color: COULEUR_CADEAU_ARME, vertexColors: true, transparent: true, opacity: opacite,
    blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const matFaisceauInt = suivre(matFaisceau(0.9));
  const matFaisceauExt = suivre(matFaisceau(0.28));
  const matAnneau = suivre(new THREE.LineBasicMaterial({
    color: COULEUR_CADEAU_ARME, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false,
  }));
  const faisceauInt = new THREE.Mesh(geoFaisceauInt, matFaisceauInt);
  const faisceauExt = new THREE.Mesh(geoFaisceauExt, matFaisceauExt);
  const anneau = new THREE.LineSegments(geoAnneau, matAnneau);
  for (const f of [faisceauInt, faisceauExt, anneau]) {
    f.renderOrder = ORDRE_FAISCEAU;
    f.frustumCulled = false; // la boîte englobante de 60 m ne doit pas faire disparaître le faisceau quand le pied sort du champ
    cadeau.add(f);
  }
  /** genre de l'offre dont la couleur est appliquée (évite de recolorer à chaque image) */
  let genreApplique: "soin" | "arme" | null = null;
  const colorerCadeau = (genre: "soin" | "arme") => {
    if (genre === genreApplique) return;
    genreApplique = genre;
    const c = genre === "soin" ? COULEUR_CADEAU_SOIN : COULEUR_CADEAU_ARME;
    mCadeau.ligne.color.set(c);
    mCadeau.fond.color.set(c).multiplyScalar(0.09);
    matFaisceauInt.color.set(c);
    matFaisceauExt.color.set(c);
    matAnneau.color.set(c);
  };

  // faisceau et anneau au point de service (là où le serveur fait ramasser)
  cadeau.position.set(o.truck.service[0], 0, o.truck.service[1]);
  const [viseeX, viseeZ] = versMondeTruck(o.truck, VISEE_ELSA_LOCAL.x, TRUCK.fenetreZ);

  return {
    majVoituresPnj(etats, cachee) {
      for (let i = 0; i < etats.length; i++) {
        if (cachee?.(i)) voiturePnj(i).group.visible = false;
        else poserVoiture(voiturePnj(i), etats[i].p, etats[i].cap);
      }
      for (let i = etats.length; i < pnj.length; i++) pnj[i].group.visible = false;
    },

    majEpaves(etats) {
      let n = 0;
      for (const e of etats) {
        if (e.etat !== "epave" || !e.p) continue;
        while (epaves.length <= n) {
          const v = creerInstanceVoiture(racine, geoVoiture, COULEUR_EPAVE);
          // affaissée et de travers : elle a sauté
          v.group.scale.set(1, 0.72, 1);
          v.group.rotation.order = "YXZ";
          v.group.rotation.x = 0.05;
          v.group.rotation.z = 0.09;
          epaves.push(v);
        }
        poserVoiture(epaves[n], e.p, e.cap ?? 0);
        n++;
      }
      for (let i = n; i < epaves.length; i++) epaves[i].group.visible = false;
    },

    majVoituresJoueurs(vehicules, couleurs) {
      // tout est caché puis les véhicules listés sont posés : un véhicule disparu du snapshot ne reste pas figé
      for (const v of joueurs) v.group.visible = false;
      for (const s of vehicules) {
        const v = voitureJoueur(s.id);
        colorer(v, couleurs.get(s.id) ?? COULEUR_VOITURE_LIBRE);
        poserVoiture(v, s.p, s.cap);
      }
    },

    majElsa(msg, tS) {
      // Elsa et son truck ne bougent pas (la position du message est le point de service, déjà connu)
      const offre = msg?.offre ?? null;

      // Elsa respire, tourne la tête et, quand elle a un cadeau, salue du bras droit.
      corps.position.y = 0.9 + 0.012 * Math.sin(tS * 1.7);
      tete.rotation.y = 0.35 * Math.sin(tS * 0.55);
      tete.rotation.x = 0.04 * Math.sin(tS * 0.9);
      brasG.epaule.rotation.z = -0.08 - 0.03 * Math.sin(tS * 1.3);
      brasG.coude.rotation.x = -0.1;
      if (offre) {
        brasD.epaule.rotation.z = 2.75 + 0.12 * Math.sin(tS * 3.1);
        brasD.coude.rotation.z = 0.45 * Math.sin(tS * 7);
        brasD.coude.rotation.x = 0;
      } else {
        brasD.epaule.rotation.z = 0.08 + 0.03 * Math.sin(tS * 1.3 + 1);
        brasD.coude.rotation.z = 0;
        brasD.coude.rotation.x = -0.1;
      }

      cadeau.visible = !!offre;
      caisseComptoir.visible = !!offre;
      if (!offre) return;
      colorerCadeau(offre.genre);
      caisse.position.y = TRUCK.comptoir + 0.32 + 0.06 * Math.sin(tS * 2.2);
      caisse.rotation.y = tS * 1.2;
      caisse.rotation.x = 0.18 * Math.sin(tS * 0.8);
      // le faisceau et l'anneau pulsent doucement ; le faisceau garde une largeur lisible de loin
      const pouls = 0.5 + 0.5 * Math.sin(tS * 3.4);
      matFaisceauInt.opacity = 0.75 + 0.25 * pouls;
      matFaisceauExt.opacity = 0.22 + 0.1 * pouls;
      matAnneau.opacity = 0.5 + 0.4 * pouls;
    },

    elsaTete() {
      return [viseeX, VISEE_ELSA_LOCAL.y, viseeZ];
    },

    afficherPseudoElsa(alpha) {
      const a = borne(alpha);
      matPseudo.opacity = a;
      etiquette.visible = a > 0.01;
    },

    dispose() {
      racine.removeFromParent();
      for (const v of pnj) libererMateriaux(v.m);
      for (const v of joueurs) libererMateriaux(v.m);
      for (const v of epaves) libererMateriaux(v.m);
      epaves.length = 0;
      pnj.length = 0;
      joueurs.length = 0;
      rangVehicule.clear();
      libererPiece(geoVoiture);
      for (const x of aDisposer) x.dispose();
      aDisposer.length = 0;
    },
  };
}
