/**
 * Rendu du monde dynamique de l'arène (three) : voitures PNJ, voitures conduisibles (couleur du conducteur), Elsa (petit personnage
 * fil de fer ambre), caisse tournante et faisceau vertical de son cadeau. Aucun test vitest (three) : les régressions se voient aux captures.
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
import type { EtatElsaMsg, VehiculeSnap, Vec3 } from "./protocole";
import { VOITURE, type EtatVoiture } from "./circulation";
import { hauteurPlaquePx } from "./visibilite";

export interface MondeDynamique {
  /** Voitures PNJ (une entrée par voiture, dans l'ordre de `flotte`). */
  majVoituresPnj(etats: readonly EtatVoiture[]): void;
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
const COULEUR_ELSA = 0xffb35c;
const COULEUR_CADEAU_SOIN = 0x5cff9c;
const COULEUR_CADEAU_ARME = 0xffd24d;
/** Elsa : échelle (spec §2.7), hauteur de l'étiquette au-dessus du sol et de la tête (m, repère monde). */
const ECHELLE_ELSA = 0.8;
const Y_PSEUDO_ELSA = 1.85;
const Y_TETE_ELSA = 1.3;
/** Elsa regarde vers l'ouest (−x), côté du POI du Truck Muche. */
const CAP_ELSA = Math.PI / 2;
/** Le cadeau flotte devant Elsa (vers −x) et non dans son corps ; reste à moins de 2,5 m du point de ramassage. */
const DECALAGE_CADEAU_M = 1.1;
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
// Fabrique
// ---------------------------------------------------------------------------------------------

export function creerMondeDynamique(scene: THREE.Scene, o: { nbPnj: number; nbVehicules: number; elsa: [number, number] }): MondeDynamique {
  const racine = new THREE.Group();
  racine.name = "monde-dynamique";
  scene.add(racine);

  const aDisposer: { dispose(): void }[] = [];
  const suivre = <T extends { dispose(): void }>(x: T): T => { aDisposer.push(x); return x; };

  // ---- voitures ----
  const geoVoiture = enPiece(geometrieVoiture());
  const pnj: InstanceVoiture[] = [];
  const joueurs: InstanceVoiture[] = [];
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

  // ---- Elsa : petit personnage fil de fer ambre, échelle 0,8, tourné vers l'ouest ----
  const elsa = new THREE.Group();
  elsa.position.set(o.elsa[0], 0, o.elsa[1]);
  elsa.rotation.y = CAP_ELSA;
  racine.add(elsa);
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
  // enfant de la racine et non d'Elsa (elle tourne) ; la position suit Elsa dans `majElsa`
  racine.add(etiquette);

  // ---- cadeau : caisse tournante, faisceau additif de 60 m (profondeur testée), anneau de ramassage ----
  const cadeau = new THREE.Group();
  cadeau.visible = false;
  racine.add(cadeau);
  const mCadeau = creerMateriaux(new THREE.Color(COULEUR_CADEAU_ARME));
  suivre({ dispose: () => libererMateriaux(mCadeau) });
  const piecesCadeau = [
    enPiece(nu(boite(0.6, 0.6, 0.6))),
    enPiece(nu(boite(0.64, 0.64, 0.12))), // ruban
    enPiece(nu(boite(0.12, 0.64, 0.64))), // ruban croisé
  ];
  for (const p of piecesCadeau) suivre({ dispose: () => libererPiece(p) });
  const caisse = new THREE.Group();
  cadeau.add(caisse);
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

  // direction « devant Elsa » dans le monde (−x) : le cadeau y flotte
  const posCadeau = (x: number, z: number) => cadeau.position.set(x - DECALAGE_CADEAU_M, 0, z);

  const _pos = new THREE.Vector3();
  let elsaX = o.elsa[0], elsaZ = o.elsa[1];
  etiquette.position.set(elsaX, Y_PSEUDO_ELSA, elsaZ);
  posCadeau(elsaX, elsaZ);

  return {
    majVoituresPnj(etats) {
      for (let i = 0; i < etats.length; i++) poserVoiture(voiturePnj(i), etats[i].p, etats[i].cap);
      for (let i = etats.length; i < pnj.length; i++) pnj[i].group.visible = false;
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
      if (msg) {
        elsaX = msg.x;
        elsaZ = msg.z;
        elsa.position.set(elsaX, 0, elsaZ);
        etiquette.position.set(elsaX, Y_PSEUDO_ELSA, elsaZ);
        posCadeau(elsaX, elsaZ);
      }
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
      if (!offre) return;
      colorerCadeau(offre.genre);
      caisse.position.y = 1.1 + 0.12 * Math.sin(tS * 2.2);
      caisse.rotation.y = tS * 1.2;
      caisse.rotation.x = 0.18 * Math.sin(tS * 0.8);
      // le faisceau et l'anneau pulsent doucement ; le faisceau garde une largeur lisible de loin
      const pouls = 0.5 + 0.5 * Math.sin(tS * 3.4);
      matFaisceauInt.opacity = 0.75 + 0.25 * pouls;
      matFaisceauExt.opacity = 0.22 + 0.1 * pouls;
      matAnneau.opacity = 0.5 + 0.4 * pouls;
    },

    elsaTete() {
      _pos.set(elsaX, Y_TETE_ELSA, elsaZ);
      return [_pos.x, _pos.y, _pos.z];
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
      pnj.length = 0;
      joueurs.length = 0;
      rangVehicule.clear();
      libererPiece(geoVoiture);
      for (const x of aDisposer) x.dispose();
      aDisposer.length = 0;
    },
  };
}
