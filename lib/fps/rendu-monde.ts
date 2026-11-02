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
import { ORDRE_BASE, boite, creerMateriaux, enPiece, libererMateriaux, libererPiece, nu, piece, type GeoPiece, type Materiaux } from "./rendu-filaire";
import { hauteurPlaquePx } from "./visibilite";
import { CABINE, DUREE_OFFRE_MS, ligneActive, poseComptoir, scenarioOffre, type EtatComptoir, type LigneVendeuse, type VendeuseId } from "./vendeuses";
import { COULEURS_VENDEUSES, creerFigure } from "./rendu-vendeuses";
import { TRUCK, versMondeTruck, type PlaceTruck } from "./zones";

export interface MondeDynamique {
  /** Voitures PNJ (une entrée par voiture, dans l'ordre de `flotte`) ; `cachee(i)` : PNJ en épave, non dessinée (v3 §4). */
  majVoituresPnj(etats: readonly EtatVoiture[], cachee?: (i: number) => boolean): void;
  /** Épaves (v3 §4) : carcasses calcinées aux positions des explosions (les entrées `etat: "epave"`). */
  majEpaves(etats: Iterable<EtatVoitureMsg>): void;
  /** Voitures conduisibles (interpolées) ; `couleurs` : couleur du conducteur par id de véhicule si occupé. */
  majVoituresJoueurs(vehicules: readonly VehiculeSnap[], couleurs: ReadonlyMap<number, string>): void;
  /** Les deux vendeuses (toujours là) + caisse et faisceau quand `elsa.offre` ; `tS` en secondes pour l'animation, `tsServeur` (ms) date les répliques de l'offre ; `enTournee` : le Truck fou roule avec elles, le passe-plat est vide. */
  majElsa(elsa: EtatElsaMsg | null, tS: number, tsServeur?: number, enTournee?: boolean): void;
  /** Étiquette « Elsa » : position monde de la tête (pour VisibilitePseudos) et réglage d'alpha. */
  elsaTete(): Vec3;
  afficherPseudoElsa(alpha: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

const ORDRE_FAISCEAU = 9;
const ORDRE_PSEUDO = 10;
/** Angle d'or (degrés) : mêmes teintes que `flotte` (circulation.ts) pour le même indice de voiture. */
const ANGLE_OR_DEG = 137.508;
/** Carrosserie d'une voiture conduisible LIBRE : grise, pour qu'elle se distingue des PNJ saturés et des joueurs colorés. */
const COULEUR_VOITURE_LIBRE = "#b9c4d0";
/** Carcasse calcinée d'une épave : rouille éteinte. */
const COULEUR_EPAVE = "#7a5a46";
const COULEUR_CADEAU_SOIN = 0x5cff9c;
const COULEUR_CADEAU_ARME = 0xffd24d;
/** la formule du jour de la patronne : la couleur de la patronne */
const COULEUR_CADEAU_FORMULE = 0xff7fb0;
/** Elsa : échelle (spec §2.7), debout sur le plancher du truck. Étiquette au-dessus du toit (sinon le truck la cache). */
const ECHELLE_ELSA = 0.9;
const Y_PSEUDO_ELSA = TRUCK.hauteur + 1.1;
/** Les deux vendeuses se tiennent de part et d'autre du centre du passe-plat (m), le cadeau entre elles. */
const ECART_VENDEUSES_M = 0.55;
/** Distance (m) sous laquelle les bulles de répliques s'affichent. */
const PORTEE_BULLE_M = 45;
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

// ---------------------------------------------------------------------------------------------
// Voitures
// ---------------------------------------------------------------------------------------------

/**
 * Silhouette d'une voiture (4,4 × 1,9 × 1,5 m, avant = −z) en un seul maillage : châssis, habitacle au pare-brise incliné et reculé,
 * quatre roues, deux phares. Fusionner garde deux appels de dessin par voiture (18 voitures en jeu).
 */
export function geometrieVoiture(): THREE.BufferGeometry {
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

/** Plaque d'une vendeuse (« Elsa », « Patronne ») : sombre, bordée et écrite de sa couleur (même style que les pseudos des avatars). */
function texturePseudo(nom: string, couleur: number): { tex: THREE.CanvasTexture | null; ratio: number } {
  const L = 384, H = 72;
  const ratio = L / H;
  // pas de canevas hors navigateur (tests de fumée sous Node) : l'étiquette reste sans texture
  if (typeof document === "undefined") return { tex: null, ratio };
  const cv = document.createElement("canvas");
  cv.width = L;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const css = `#${new THREE.Color(couleur).getHexString()}`;
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
    ctx.fillText(nom, L / 2, H / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, ratio };
}

/**
 * Bulle de réplique d'une vendeuse : une plaque sombre bordée de sa couleur, texte sur une ou deux lignes (retour à la ligne au dernier espace avant 26
 * caractères). La texture est redessinée à chaque nouvelle réplique (`ecrire`). Hors navigateur (tests sous Node), aucune texture.
 */
function creerBulle(couleur: number): { tex: THREE.CanvasTexture | null; ratio: number; ecrire(texte: string): void } {
  const L = 560, H = 120;
  const ratio = L / H;
  if (typeof document === "undefined") return { tex: null, ratio, ecrire() {} };
  const cv = document.createElement("canvas");
  cv.width = L;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const css = `#${new THREE.Color(couleur).getHexString()}`;
  let ecrite = "";
  return {
    tex, ratio,
    ecrire(texte) {
      if (!ctx || texte === ecrite) return;
      ecrite = texte;
      ctx.clearRect(0, 0, L, H);
      ctx.fillStyle = "rgba(4, 6, 10, 0.82)";
      ctx.beginPath();
      ctx.roundRect(3, 3, L - 6, H - 6, 16);
      ctx.fill();
      ctx.strokeStyle = css;
      ctx.lineWidth = 3;
      ctx.stroke();
      // une ou deux lignes
      const mots = texte.split(" ");
      const lignes: string[] = [];
      let courante = "";
      for (const mot of mots) {
        if (courante && (courante + " " + mot).length > 26) { lignes.push(courante); courante = mot; } else courante = courante ? `${courante} ${mot}` : mot;
      }
      if (courante) lignes.push(courante);
      ctx.font = `600 ${lignes.length > 1 ? 34 : 40}px "Chakra Petch", "IBM Plex Mono", ui-monospace, system-ui, sans-serif`;
      ctx.fillStyle = "#f2f6fa";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      lignes.slice(0, 2).forEach((l, i, a) => ctx.fillText(l, L / 2, H / 2 + (i - (a.length - 1) / 2) * 42 + 2));
      tex.needsUpdate = true;
    },
  };
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
 * `cabineOuverte` (le Truck fou) : la cabine n'est plus un bloc plein mais un habitacle — toit, tableau de bord, bas de portières, montants — dont le
 * pare-brise et les vitres sont vides : on voit Elsa et la patronne conduire.
 */
function geometrieTruck(avecRoues = true, cabineOuverte = false): THREE.BufferGeometry {
  const { longueur: L, largeur: l, hauteur: H, cabine, hauteurCabine, plancher, comptoir, linteau, fenetreZ, fenetreLargeur } = TRUCK;
  const e = 0.06; // épaisseur des panneaux
  const z0 = -L / 2 + cabine, z1 = L / 2; // caisse
  const zc = (z0 + z1) / 2, lc = z1 - z0;
  const f0 = fenetreZ - fenetreLargeur / 2, f1 = fenetreZ + fenetreLargeur / 2;
  const m: THREE.BufferGeometry[] = [];
  const b = (w: number, h: number, d: number, x: number, y: number, z: number) => m.push(nu(boite(w, h, d, x, y, z)));
  // châssis plein sous le plancher, cabine
  b(l, plancher - 0.35, L, 0, (plancher + 0.35) / 2, 0);
  if (!cabineOuverte) b(l, hauteurCabine - plancher, cabine, 0, (plancher + hauteurCabine) / 2, -L / 2 + cabine / 2);
  else {
    const zc0 = -L / 2, yBas = 1.45, yDash = CABINE.tableauY;
    // toit, tableau de bord (jusqu'à 1,5 m, sous le pare-brise), bas des portières, montants avant et arrière
    b(l, e, cabine, 0, hauteurCabine - e / 2, zc0 + cabine / 2);
    b(l, yDash - plancher, 0.5, 0, (plancher + yDash) / 2, zc0 + 0.25);
    for (const sx of [-1, 1]) {
      b(e, yBas - plancher, cabine, sx * (l / 2 - e / 2), (plancher + yBas) / 2, zc0 + cabine / 2);
      b(0.12, hauteurCabine - yDash, 0.12, sx * (l / 2 - 0.06), (yDash + hauteurCabine) / 2, zc0 + 0.06);
      b(0.12, hauteurCabine - yBas, 0.12, sx * (l / 2 - 0.06), (yBas + hauteurCabine) / 2, zc0 + cabine - 0.06);
    }
  }
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
  // roues (avant sous la cabine, arrière sous la caisse) ; (v8) le mini Truck des zombies a les siennes, à part, qui tournent
  for (const sx of avecRoues ? [-1, 1] : []) {
    for (const z of [-L / 2 + 1, L / 2 - 1.3]) {
      const r = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12, 1, false);
      r.rotateZ(Math.PI / 2);
      r.translate(sx * (l / 2 - 0.12), 0.45, z);
      m.push(nu(r));
    }
  }
  // pare-brise : un cadre incliné à l'avant de la cabine (cabine ouverte : vitre vide, on voit à travers)
  if (!cabineOuverte) {
    const pb = boite(l - 0.3, 0.9, 0.05, 0, 0, 0);
    pb.rotateX(-0.35);
    pb.translate(0, hauteurCabine - 0.55, -L / 2 - 0.08);
    m.push(nu(pb));
  }
  const fusion = mergeGeometries(m, false);
  for (const g of m) g.dispose();
  if (!fusion) throw new Error("rendu-monde : fusion du truck impossible");
  return fusion;
}

/** (v8, zombies) Options du Truck Muche seul : roues à part qui tournent, phares rouges qui percent le brouillard, couleur, enseigne. */
export interface OptionsModeleTruck {
  /** roues séparées (`roues`), à faire tourner par l'appelant autour de x */
  roues?: boolean;
  /** phares rouges : deux lueurs et deux faisceaux additifs, hors brouillard */
  phares?: boolean;
  /** couleur du fil de fer (0xffb35c, celle du Truck garé, par défaut) */
  couleur?: number;
  /** enseigne « LE TRUCK MUCHE » (par défaut) */
  enseigne?: boolean;
  /** longueur (m, du repère du modèle) des faisceaux des phares */
  longueurFaisceau?: number;
  /** cabine ouverte (pare-brise et vitres vides) : le Truck fou, où les vendeuses conduisent */
  cabineOuverte?: boolean;
}
/** Le Truck Muche seul (`creerModeleTruckMuche`) : groupe, matériaux, roues (vides sans l'option) et rayon d'une roue, phares. */
export interface ModeleTruckMuche {
  group: THREE.Group;
  materiaux: { ligne: THREE.LineBasicMaterial; fond: THREE.MeshBasicMaterial };
  roues: THREE.Object3D[];
  rayonRoue: number;
  /** groupe des phares (null sans l'option) : `intensite` règle leur éclat (klaxon, mèche), 0..1+ */
  phares: { groupe: THREE.Group; intensite(k: number): void } | null;
  dispose(): void;
}

const RAYON_ROUE_TRUCK = 0.45;
const COULEUR_PHARES = 0xff2418;

/** Disque doux (lueur d'un phare). */
function textureHalo(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * (v7, zombies) Le Truck Muche seul (manches de livraison) : la même géométrie que le Truck garé de l'arène, enseigne comprise ; avant = −z
 * de son repère, origine au sol au centre. (v8) Options : roues à part qui tournent (le mini Truck Muche, réduit à 0,3 par l'appelant),
 * phares rouges qui percent le brouillard, couleur. À libérer avec `dispose`.
 */
export function creerModeleTruckMuche(o: OptionsModeleTruck = {}): ModeleTruckMuche {
  const group = new THREE.Group();
  const aLiberer: { dispose(): void }[] = [];
  const geo = enPiece(geometrieTruck(!o.roues, !!o.cabineOuverte));
  const m = creerMateriaux(new THREE.Color(o.couleur ?? COULEUR_TRUCK));
  group.add(new THREE.Mesh(geo.geo, m.fond), new THREE.LineSegments(geo.aretes, m.ligne));
  const tex = o.enseigne === false ? null : textureEnseigne();
  let enseigne: THREE.Mesh | null = null;
  if (tex) {
    enseigne = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    enseigne.position.set(TRUCK.largeur / 2 - 0.2, TRUCK.hauteur + 0.35, TRUCK.fenetreZ);
    enseigne.rotation.y = Math.PI / 2;
    group.add(enseigne);
  }
  // roues à part : un cylindre d'axe x et une croix de rayons, pour qu'on les voie tourner
  const roues: THREE.Object3D[] = [];
  if (o.roues) {
    const { longueur: L, largeur: l } = TRUCK;
    const cyl = new THREE.CylinderGeometry(RAYON_ROUE_TRUCK, RAYON_ROUE_TRUCK, 0.3, 12, 1, false);
    cyl.rotateZ(Math.PI / 2);
    const rayons = mergeGeometries([boite(0.32, 0.08, RAYON_ROUE_TRUCK * 1.9), boite(0.32, RAYON_ROUE_TRUCK * 1.9, 0.08)], false)!;
    const gRoue = enPiece(cyl), gRayons = enPiece(rayons);
    aLiberer.push({ dispose: () => { libererPiece(gRoue); libererPiece(gRayons); } });
    for (const sx of [-1, 1]) {
      for (const z of [-L / 2 + 1, L / 2 - 1.3]) {
        const r = new THREE.Group();
        r.position.set(sx * (l / 2 - 0.12), RAYON_ROUE_TRUCK, z);
        r.add(new THREE.Mesh(gRoue.geo, m.fond), new THREE.LineSegments(gRoue.aretes, m.ligne), new THREE.LineSegments(gRayons.aretes, m.ligne));
        group.add(r);
        roues.push(r);
      }
    }
  }
  // phares rouges : deux lueurs à l'avant de la cabine, deux faisceaux en cône vers l'avant (additifs, sans brouillard)
  let phares: ModeleTruckMuche["phares"] = null;
  if (o.phares) {
    const groupe = new THREE.Group();
    const texHalo = textureHalo();
    const matHalo = new THREE.SpriteMaterial({ map: texHalo, color: COULEUR_PHARES, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    const lf = o.longueurFaisceau ?? 16;
    const cone = new THREE.ConeGeometry(lf * 0.15, lf, 16, 1, true);
    // pointe au phare, ouverture vers l'avant (−z)
    cone.translate(0, -lf / 2, 0);
    cone.rotateX(Math.PI / 2);
    const matCone = new THREE.MeshBasicMaterial({
      color: COULEUR_PHARES, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
    });
    aLiberer.push(texHalo, matHalo, cone, matCone);
    const halos: THREE.Sprite[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * (TRUCK.largeur / 2 - 0.4), y = 1.05, z = -TRUCK.longueur / 2 - 0.05;
      const h = new THREE.Sprite(matHalo);
      h.position.set(x, y, z);
      h.scale.setScalar(1.1);
      h.renderOrder = ORDRE_BASE + 3;
      const c = new THREE.Mesh(cone, matCone);
      c.position.set(x, y, z);
      c.rotation.x = -0.08; // un peu vers le sol
      c.renderOrder = ORDRE_BASE + 3;
      groupe.add(h, c);
      halos.push(h);
    }
    group.add(groupe);
    phares = {
      groupe,
      intensite(k) {
        matCone.opacity = 0.07 * Math.max(0, k);
        matHalo.opacity = Math.min(1, 0.6 + 0.4 * k);
        for (const h of halos) h.scale.setScalar(1.1 * (0.8 + 0.5 * k));
      },
    };
  }
  return {
    group, materiaux: m, roues, rayonRoue: RAYON_ROUE_TRUCK, phares,
    dispose() {
      libererPiece(geo);
      m.ligne.dispose(); m.fond.dispose();
      if (enseigne) { enseigne.geometry.dispose(); (enseigne.material as THREE.Material).dispose(); }
      tex?.dispose();
      for (const x of aLiberer) x.dispose();
      group.removeFromParent();
    },
  };
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
  const corpsTruck = piece(truck, geoTruck, mTruck);
  let enseigneTruck: THREE.Mesh | null = null;
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
    enseigneTruck = enseigne;
  }

  // ---- les deux vendeuses, DEDANS, face au passe-plat : Elsa (côté porte arrière) et la patronne (côté cabine) ----
  // Le comptoir est à +x du truck ; une figure regarde −z, un quart de tour la tourne vers +x. La patronne est à gauche d'Elsa, Elsa à sa droite (voisine = ±1 pour la tête).
  const xFigures = TRUCK.largeur / 2 - TRUCK.retraitElsa;
  const zElsa = TRUCK.fenetreZ + ECART_VENDEUSES_M, zPatronne = TRUCK.fenetreZ - ECART_VENDEUSES_M;
  const figures = { elsa: creerFigure(truck, { vendeuse: "elsa", echelle: ECHELLE_ELSA }), patronne: creerFigure(truck, { vendeuse: "patronne", echelle: ECHELLE_ELSA }) };
  figures.elsa.racine.position.set(xFigures, TRUCK.plancher, zElsa);
  figures.patronne.racine.position.set(xFigures, TRUCK.plancher, zPatronne);
  for (const f of Object.values(figures)) f.racine.rotation.y = -Math.PI / 2;
  suivre({ dispose: () => { figures.elsa.dispose(); figures.patronne.dispose(); } });

  // Étiquettes : sprites à taille constante à l'écran, masqués par les bâtiments, alpha réglé par la visibilité (VisibilitePseudos).
  // Enfants du truck et non des figures (elles tournent) : au-dessus du toit, à l'aplomb de chacune.
  const _pw = new THREE.Vector3(), _pc = new THREE.Vector3();
  /** sprite de taille constante à l'écran : `facteur` × la hauteur de plaque des pseudos ; au-delà de `porteeM` il s'efface (échelle nulle) */
  const creerSprite = (tex: THREE.CanvasTexture | null, ratio: number, x: number, y: number, z: number, facteur: number, porteeM: number) => {
    if (tex) suivre(tex);
    const mat = suivre(new THREE.SpriteMaterial({ map: tex ?? undefined, transparent: true, opacity: 0, depthWrite: false, depthTest: true, toneMapped: false }));
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.renderOrder = ORDRE_PSEUDO;
    sprite.frustumCulled = false;
    sprite.visible = false;
    sprite.onBeforeRender = (renderer, _scene, camera) => {
      const cam = camera as THREE.PerspectiveCamera;
      sprite.getWorldPosition(_pw);
      _pc.setFromMatrixPosition(cam.matrixWorld);
      const d = Math.max(_pw.distanceTo(_pc), 0.5);
      const hPx = (renderer.domElement as HTMLCanvasElement).clientHeight || 800;
      const h = d > porteeM ? 1e-4 : (hauteurPlaquePx(d) * facteur / hPx) * 2 * d * Math.tan(((cam.fov || 90) * Math.PI) / 360);
      sprite.scale.set(h * ratio, h, 1);
      sprite.updateMatrixWorld();
    };
    truck.add(sprite);
    return { sprite, mat };
  };
  const etiquettes = (["elsa", "patronne"] as const).map((qui) => {
    const { tex, ratio } = texturePseudo(qui === "elsa" ? "Elsa" : "Patronne", COULEURS_VENDEUSES[qui]);
    return creerSprite(tex, ratio, xFigures, Y_PSEUDO_ELSA, qui === "elsa" ? zElsa : zPatronne, 1, Infinity);
  });
  // Bulles de répliques (une par vendeuse, au-dessus de son étiquette), visibles à moins de PORTEE_BULLE_M
  const bulles = (["elsa", "patronne"] as const).map((qui) => {
    const b = creerBulle(COULEURS_VENDEUSES[qui]);
    const sp = creerSprite(b.tex, b.ratio, xFigures, Y_PSEUDO_ELSA + 0.95, qui === "elsa" ? zElsa : zPatronne, 3.1, PORTEE_BULLE_M);
    sp.mat.opacity = 1;
    return { ecrire: b.ecrire, sprite: sp.sprite };
  });
  const bulleDe = { elsa: bulles[0], patronne: bulles[1] };
  /** scénario de l'offre affichée (le même chez tous les clients) */
  let scenario: { id: number; lignes: LigneVendeuse[] } | null = null;
  /** le Truck fou roule avec Elsa et la patronne : le passe-plat est vide */
  let tournee = false;

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
  /** genre de l'offre dont la couleur est appliquée (évite de recolorer à chaque image) ; la formule de la patronne a sa couleur */
  let genreApplique: "soin" | "arme" | "formule" | null = null;
  const colorerCadeau = (genre: "soin" | "arme" | "formule") => {
    if (genre === genreApplique) return;
    genreApplique = genre;
    const c = genre === "soin" ? COULEUR_CADEAU_SOIN : genre === "formule" ? COULEUR_CADEAU_FORMULE : COULEUR_CADEAU_ARME;
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

    majElsa(msg, tS, tsServeur, enTournee = false) {
      // le truck ne bouge pas (la position du message est le point de service, déjà connu)
      tournee = enTournee;
      figures.elsa.racine.visible = figures.patronne.racine.visible = !enTournee;
      // le Truck fou part du stand avec le même modèle : le Truck garé s'efface (sinon deux camions superposés qui scintillent, puis un double resté sur place)
      corpsTruck.visible = !enTournee;
      if (enseigneTruck) enseigneTruck.visible = !enTournee;
      const offre = msg?.offre ?? null;
      const vendeuse: VendeuseId | null = offre ? offre.vendeuse ?? "elsa" : null;
      // scénario de l'offre : le même chez tous les clients (graine = identifiant), daté depuis son apparition
      if (!offre) scenario = null;
      else if (scenario?.id !== offre.id) scenario = { id: offre.id, lignes: scenarioOffre(offre.id, vendeuse!) };
      const age = offre && tsServeur !== undefined ? tsServeur - (offre.finT - DUREE_OFFRE_MS) : null;
      const ligne = scenario && age !== null ? ligneActive(scenario.lignes, age) : null;
      const etat: EtatComptoir = { parle: ligne?.qui ?? null, sert: vendeuse, offre: !!offre };
      figures.elsa.appliquer(poseComptoir("elsa", etat, tS, -1));
      figures.patronne.appliquer(poseComptoir("patronne", etat, tS, 1));
      for (const qui of ["elsa", "patronne"] as const) {
        const b = bulleDe[qui];
        const dit = ligne?.qui === qui;
        if (dit) b.ecrire(ligne.texte);
        b.sprite.visible = dit && !enTournee;
      }

      cadeau.visible = !!offre;
      caisseComptoir.visible = !!offre;
      if (!offre) return;
      colorerCadeau(vendeuse === "patronne" ? "formule" : offre.genre);
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
      const a = tournee ? 0 : borne(alpha);
      for (const e of etiquettes) {
        e.mat.opacity = a;
        e.sprite.visible = a > 0.01;
      }
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
