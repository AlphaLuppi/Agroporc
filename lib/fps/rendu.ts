/**
 * Rendu three.js de l'arène FPS (avatars, armes en main, effets, post-traitement).
 * Même langage visuel que la vue aérienne (lib/agroparc3d/scene.ts) : fil de fer lumineux sur fond
 * noir, faces sombres qui masquent les arêtes cachées, bloom. Rien ici n'est testé en vitest (three
 * + canvas) ; la logique pure vit dans collision / mouvement / armes / tir / traceurs / visibilite.
 *
 * Repère et angles : ceux de protocole.ts (x est, z sud, y haut, `lacet` 0 = regard vers −z). Un
 * avatar est un `Group` dont l'origine est aux PIEDS du joueur et que `maj` oriente par le lacet ; son
 * contenu est agrandi de `ECHELLE_AVATAR` autour des pieds (la hitbox de tir l'est à l'identique).
 *
 * Contrat d'intégration pour jeu.ts :
 *  - `scene.add(camera)` avant `camera.add(armeEnMain.group)` (l'arme en main est un enfant de la caméra) ;
 *  - l'arme en main se dessine par-dessus le décor (test de profondeur coupé) : elle ne rentre jamais
 *    dans un mur ; pour le sniper en visée elle se cache d'elle-même (la lunette est dans le HUD) ;
 *  - les avatars et les effets sont de simples enfants de la scène ; le décor vient de
 *    lib/agroparc3d/decor.ts (`construireDecor(scene, data, { fantomes: false })`) ;
 *  - les avatars écrivent la profondeur après les bâtiments (ordre de dessin 5 et 6) : un mur les masque,
 *    plaque de pseudo et silhouette lointaine comprises ;
 *  - rubans de traçantes, arêtes d'avatar (`LineSegments2`) et plaques de pseudo se règlent eux-mêmes à
 *    chaque dessin (`onBeforeRender`) d'après le renderer et la caméra COURANTS (vue du joueur ou killcam) ;
 *  - tout `dispose()` libère ce que l'objet a créé ; les géométries partagées (cache de ce module)
 *    sont minuscules et restent en mémoire.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { ECHELLE_AVATAR, silhouetteDe, type ArmeFeuId, type ArmeId, type EtatJoueurSnap, type Vec3 } from "./protocole";
import { LARGEUR_MIN_M, TRACEURS, dureeVie, etatTraceur, instantImpact, largeurMonde, type ParamsTraceur } from "./traceurs";
import { hauteurPlaquePx } from "./visibilite";

// ---------------------------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------------------------

/** Couleur acceptée partout : "#rrggbb" (celle du serveur) ou entier 0xrrggbb. */
export type CouleurEntree = string | number;
/** Point accepté partout : tuple du protocole ou vecteur three. */
export type Pt = Vec3 | { x: number; y: number; z: number };

export interface AvatarJoueur {
  /** Origine aux pieds ; à ajouter à la scène. */
  group: THREE.Group;
  /**
   * Applique un instantané (position, lacet, tangage, posture, arme, `accroupi`, `vehicule`) et avance les animations de `dt` s.
   * Pose accroupie si `accroupi`, assise si `vehicule` (alors `p` est la position du siège), glissade déduite d'un accroupi rapide
   * (le protocole ne transmet pas la glissade aux distants).
   */
  maj(etat: EtatJoueurSnap, dt: number): void;
  /** Le joueur vient de tirer : flash de bouche et recul de l'arme. */
  tirer(): void;
  /** Le joueur vient de donner un coup (couteau) : fente de l'arme et du bras. */
  coup(): void;
  /** Le joueur vient d'être touché : bref éclat blanc. */
  toucher(): void;
  /**
   * Pilote la plaque de pseudo (`VisibilitePseudos`) : `alpha` 0 = cachée, `distance` = œil→joueur (m), qui règle la hauteur de la
   * plaque (`hauteurPlaquePx`). Tant que cette méthode n'a jamais été appelée, la plaque reste visible et se règle d'après la caméra
   * (comportement de la v1) ; mort, elle est toujours cachée.
   */
  afficherPseudo(alpha: number, distance: number): void;
  /** Position monde de la bouche de l'arme en main (départ des traçantes d'un tir distant) ; pointe de la lame pour le couteau. */
  positionBouche(): Vec3;
  dispose(): void;
}

export interface ContexteArmeEnMain {
  /** vitesse horizontale du joueur (m/s) */
  vitesseH: number;
  auSol: boolean;
  /** clic droit maintenu */
  vise: boolean;
}

export interface ArmeEnMain {
  /** Enfant de la caméra (cf. en-tête). */
  group: THREE.Group;
  tirer(): void;
  /** Coup de couteau : fente de l'arme (sans flash ni recul). */
  coup(): void;
  /** Remplace l'arme en main (modèle, placement, bras) ; ne fait rien si c'est déjà elle. */
  changer(arme: ArmeId): void;
  /** Lance l'animation de rechargement sur `dureeS` secondes. */
  recharger(dureeS: number): void;
  maj(dt: number, ctx: ContexteArmeEnMain): void;
  /** Avancement du rechargement : 0 = rien, ]0,1[ = en cours. */
  readonly progresRecharge: number;
  /** Bouche du canon en coordonnées monde (pour une traçante partant de l'arme) ; pointe de la lame pour le couteau. */
  positionBouche(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export interface Effets {
  /**
   * Traçante qui VOYAGE de `o` (bouche) vers `fin` (impact) à la vitesse visuelle de l'arme (le tir reste hitscan : les dégâts sont
   * instantanés), en ruban orienté caméra (`traceurs.ts` : vitesse, longueur, épaisseur, couleur et persistance de l'arme). Un `impact`
   * demandé à ce même point dans les instants qui suivent est différé à l'arrivée de la tête du ruban.
   * Une couleur ("#rrggbb" ou entier) est tolérée à la place de l'arme (ancien appel) : traçante ordinaire de cette couleur.
   */
  traçante(o: Pt, fin: Pt, arme: ArmeFeuId | CouleurEntree): void;
  /** Étincelles, anneau et poussière sur un bâtiment ; `normale` = normale de la surface touchée. Différé si une traçante arrive à ce point. */
  impact(point: Pt, normale: Pt, couleur?: CouleurEntree): void;
  /** Éclaboussure de la couleur du joueur touché. */
  eclaboussure(point: Pt, couleur: CouleurEntree): void;
  maj(dt: number): void;
  dispose(): void;
}

export interface PostTraitement {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  redimensionner(largeur: number, hauteur: number): void;
  rendre(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

const borne = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lisse = (x: number) => { const u = borne(x); return u * u * (3 - 2 * u); };
/** Marche lissée 0→1 entre a et b. */
const rampe = (t: number, a: number, b: number) => lisse((t - a) / (b - a));
/** Impulsion : montée en `m` s, descente en `d` s, 0 avant et après. */
const pulsation = (t: number, m: number, d: number) => (t < 0 ? 0 : t < m ? t / m : t < m + d ? 1 - (t - m) / d : 0);
const melange = (a: number, b: number, k: number) => a + (b - a) * k;
/** Écart angulaire signé le plus court de `de` vers `vers`. */
const ecartAngle = (de: number, vers: number) => {
  let d = (vers - de) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

function lirePt(p: Pt, out: THREE.Vector3): THREE.Vector3 {
  if (Array.isArray(p)) return out.set(p[0], p[1], p[2]);
  return out.set(p.x, p.y, p.z);
}

const BAS = new THREE.Vector3(0, -1, 0);
const BLANC = new THREE.Color(0xffffff);

// ---------------------------------------------------------------------------------------------
// Pièces filaires (géométries partagées, matériaux par instance)
// ---------------------------------------------------------------------------------------------

interface GeoPiece {
  geo: THREE.BufferGeometry;
  aretes: THREE.EdgesGeometry;
  /** arêtes épaisses (`LineSegments2`), créées à la première pièce d'avatar */
  aretes2?: LineSegmentsGeometry;
}
const cacheGeo = new Map<string, GeoPiece>();

function enCache(cle: string, fabrique: () => THREE.BufferGeometry): GeoPiece {
  let g = cacheGeo.get(cle);
  if (!g) {
    const geo = fabrique();
    g = { geo, aretes: new THREE.EdgesGeometry(geo, 12) };
    cacheGeo.set(cle, g);
  }
  return g;
}

/** Boîte w×h×d ; `oy` décale le centre en y (pivot en haut d'un membre : oy = −h/2). */
const geoBoite = (w: number, h: number, d: number, oy = 0) =>
  enCache(`b${w},${h},${d},${oy}`, () => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, oy, 0); return g; });
/** Cylindre d'axe z (canons, lunettes), centré. */
const geoCyl = (r: number, len: number, seg = 8) =>
  enCache(`c${r},${len},${seg}`, () => { const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false); g.rotateX(Math.PI / 2); return g; });
const geoIco = (r: number, detail = 1) => enCache(`i${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail));

/** Arêtes en lignes de 2 px (`LineMaterial`) pour les avatars, en lignes de 1 px (`LineBasicMaterial`) pour l'arme en main. */
type MateriauLigne = THREE.LineBasicMaterial | LineMaterial;
interface Materiaux {
  ligne: MateriauLigne;
  fond: THREE.MeshBasicMaterial;
  /** règle `LineMaterial.resolution` d'après le renderer courant (seulement pour les arêtes épaisses) */
  avantRendu?: (renderer: THREE.WebGLRenderer) => void;
}

/** Largeur des arêtes des avatars (px du tampon de dessin). */
const LARGEUR_ARETES_PX = 2;
/** Part de la couleur du joueur dans ses faces : 24 % pour un avatar (lisibilité à distance), 9 % pour l'arme en main. */
const FACES_AVATAR = 0.24;
const FACES_ARME = 0.09;

/**
 * `devant` = dessiné par-dessus tout (arme en main) : test de profondeur coupé, l'ordre de dessin
 * est celui de l'arbre (cf. `ordonner`). Sinon les faces sombres du joueur masquent ses arêtes
 * cachées, et les murs masquent le joueur (rendu après les bâtiments, cf. `ordonner`).
 * `epais` (avatars) : arêtes en `LineSegments2` de `LARGEUR_ARETES_PX` px et faces à 24 % de la couleur.
 */
function creerMateriaux(couleur: THREE.Color, devant: boolean, epais = false): Materiaux {
  let ligne: MateriauLigne;
  let avantRendu: Materiaux["avantRendu"];
  if (epais) {
    const lm = new LineMaterial({ color: couleur.getHex(), linewidth: LARGEUR_ARETES_PX, transparent: true, opacity: 0.95, depthTest: !devant, depthWrite: false });
    ligne = lm;
    const taille = new THREE.Vector2();
    avantRendu = (renderer) => {
      renderer.getDrawingBufferSize(taille);
      if (lm.resolution.x !== taille.x || lm.resolution.y !== taille.y) lm.resolution.copy(taille);
    };
  } else {
    ligne = new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.95, depthTest: !devant, depthWrite: false });
  }
  const fond = new THREE.MeshBasicMaterial({
    color: couleur.clone().multiplyScalar(epais ? FACES_AVATAR : FACES_ARME),
    transparent: true,
    opacity: 1,
    depthTest: !devant,
    depthWrite: !devant,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
  return { ligne, fond, avantRendu };
}

const libererMateriaux = (m: Materiaux) => { m.ligne.dispose(); m.fond.dispose(); };

/** Pièce filaire (faces sombres + arêtes) posée dans `parent`. */
function piece(parent: THREE.Object3D, g: GeoPiece, m: Materiaux, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.set(rx, ry, rz);
  grp.add(new THREE.Mesh(g.geo, m.fond));
  if (m.ligne instanceof LineMaterial) {
    g.aretes2 ??= new LineSegmentsGeometry().fromEdgesGeometry(g.aretes);
    const l2 = new LineSegments2(g.aretes2, m.ligne);
    const maj = m.avantRendu;
    if (maj) l2.onBeforeRender = (renderer) => maj(renderer);
    grp.add(l2);
  } else grp.add(new THREE.LineSegments(g.aretes, m.ligne));
  parent.add(grp);
  return grp;
}

/**
 * Fixe l'ordre de dessin d'un sous-arbre. Non `devant` : faces à `base`, arêtes à `base + 1`, donc
 * après les bâtiments (ordre 1 et 2 dans decor.ts) qui occultent alors le joueur. `devant` : chaque
 * pièce a son rang dans l'arbre (la dernière dessinée est au-dessus). Les objets marqués
 * `userData.ordreFixe` (flash) gardent le leur. Un `LineSegments2` est un `Mesh` pour three mais compte comme une arête.
 */
function ordonner(racine: THREE.Object3D, devant: boolean, base: number): void {
  let rang = 0;
  racine.traverse((o) => {
    if (o.userData.ordreFixe) return;
    const mesh = o as THREE.Mesh, ligne = o as THREE.LineSegments;
    if ((o as LineSegments2).isLineSegments2 || ligne.isLineSegments) { o.renderOrder = devant ? base + 2 * rang + 1 : base + 1; rang++; }
    else if (mesh.isMesh) o.renderOrder = devant ? base + 2 * rang : base;
  });
}

// ---------------------------------------------------------------------------------------------
// Modèles d'armes (fil de fer, canon vers −z, origine à la poignée)
// ---------------------------------------------------------------------------------------------

interface ModeleArme {
  group: THREE.Group;
  /** main arrière (poignée), main avant (garde-main ; bouge avec la pompe), bouche : repère de l'arme */
  prise: THREE.Vector3;
  garde: THREE.Vector3;
  bouche: THREE.Vector3;
  /** position de l'arme dans le repère du buste d'un avatar */
  porte: THREE.Vector3;
  progres: number;
  /** avancement du coup en cours (0 à 1), 0 si aucun : l'avatar en déduit la fente du bras */
  coupU: number;
  tirer(): void;
  coup(): void;
  recharger(dureeS: number): void;
  maj(dt: number): void;
  dispose(): void;
}

let geoFlashCache: THREE.BufferGeometry | null = null;
/** Étoile de flash de bouche : rayons dans le plan xy + pointes vers l'avant (−z). */
function geoFlash(): THREE.BufferGeometry {
  if (geoFlashCache) return geoFlashCache;
  const p: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const r1 = i % 2 ? 0.05 : 0.095;
    p.push(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0, Math.cos(a) * r1, Math.sin(a) * r1, -0.01);
  }
  p.push(0, 0, 0, 0, 0, -0.2);
  for (const [x, y] of [[0.035, 0], [-0.035, 0], [0, 0.035], [0, -0.035]]) p.push(0, 0, 0, x, y, -0.13);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  geoFlashCache = g;
  return g;
}

/** Durée (s) du coup de couteau. */
const DUREE_COUP_S = 0.4;

/**
 * Modèle d'une arme : un `case` par arme, qui pose les pièces, les points de prise (`prise`, `garde`), la bouche et la position portée par un avatar,
 * puis une fonction `anim(tTir, p, dt)` qui déplace les pièces mobiles (culasse, chargeur, pompe, barillet…). Ajouter une arme = ajouter son `case`
 * (le `switch` est exhaustif sur `ArmeId` : tsc refuse l'oubli).
 */
function creerModeleArme(id: ArmeId, m: Materiaux, devant: boolean): ModeleArme {
  const group = new THREE.Group();
  const inner = new THREE.Group(); // reçoit l'inclinaison du rechargement et le coup
  group.add(inner);
  const prise = new THREE.Vector3(), garde = new THREE.Vector3(), bouche = new THREE.Vector3(), porte = new THREE.Vector3();
  let echelleFlash = 1;
  let inclinaison = 0.4;
  /** Pose les pièces mobiles : tTir = s depuis le dernier tir, p = avancement du rechargement (0 si rien), dt = pas de temps. */
  let anim: (tTir: number, p: number, dt: number) => void = () => {};
  /** Tir : réaction propre à l'arme en plus du flash (rotation du fût du minigun…). */
  let surTir: () => void = () => {};

  switch (id) {
    case "pistolet": {
      const glissiere = piece(inner, geoBoite(0.032, 0.036, 0.19), m, 0, 0.03, -0.07);
      piece(inner, geoBoite(0.03, 0.022, 0.17), m, 0, 0, -0.06);
      piece(inner, geoCyl(0.009, 0.03), m, 0, 0.03, -0.177);
      piece(inner, geoBoite(0.03, 0.095, 0.045), m, 0, -0.065, 0, -0.2);
      piece(inner, geoBoite(0.018, 0.004, 0.045), m, 0, -0.016, -0.04);
      piece(inner, geoBoite(0.006, 0.01, 0.01), m, 0, 0.053, -0.145);
      piece(inner, geoBoite(0.016, 0.008, 0.01), m, 0, 0.053, 0.012);
      const chargeur = piece(inner, geoBoite(0.026, 0.04, 0.036), m, 0, -0.115, 0.012, -0.2);
      prise.set(0, -0.045, 0);
      garde.set(-0.02, -0.075, 0.005);
      bouche.set(0, 0.03, -0.195);
      porte.set(0.1, -0.25, -0.42);
      echelleFlash = 0.9;
      inclinaison = 0.35;
      const zG = glissiere.position.z, yC = chargeur.position.y;
      anim = (t, p) => {
        glissiere.position.z = zG + 0.035 * pulsation(t, 0.03, 0.09) + 0.03 * pulsation(p - 0.86, 0.04, 0.06);
        chargeur.position.y = yC - 0.12 * (rampe(p, 0.1, 0.28) - rampe(p, 0.55, 0.72));
        chargeur.visible = !(p > 0.3 && p < 0.52);
      };
      break;
    }
    case "mitraillette": {
      piece(inner, geoBoite(0.05, 0.075, 0.32), m, 0, 0, -0.15);
      piece(inner, geoBoite(0.046, 0.05, 0.14), m, 0, -0.015, -0.31);
      piece(inner, geoCyl(0.02, 0.12), m, 0, 0.012, -0.4);
      piece(inner, geoCyl(0.009, 0.05), m, 0, 0.012, -0.47);
      piece(inner, geoBoite(0.014, 0.016, 0.22), m, 0, 0.046, -0.14);
      piece(inner, geoBoite(0.006, 0.014, 0.01), m, 0, 0.058, -0.4);
      piece(inner, geoBoite(0.034, 0.1, 0.04), m, 0, -0.085, 0, -0.2);
      piece(inner, geoBoite(0.018, 0.004, 0.05), m, 0, -0.04, -0.06);
      const chargeur = piece(inner, geoBoite(0.03, 0.15, 0.045), m, 0, -0.12, -0.14, 0.12);
      const culasse = piece(inner, geoBoite(0.012, 0.014, 0.05), m, 0.03, 0.03, -0.04);
      piece(inner, geoBoite(0.02, 0.02, 0.2), m, 0, 0.012, 0.2);
      piece(inner, geoBoite(0.025, 0.085, 0.02), m, 0, -0.02, 0.3);
      prise.set(0, -0.09, 0);
      garde.set(0, -0.03, -0.31);
      bouche.set(0, 0.012, -0.497);
      porte.set(0.12, -0.22, -0.2);
      echelleFlash = 0.8;
      inclinaison = 0.4;
      const zC = culasse.position.z, yC = chargeur.position.y;
      anim = (t, p) => {
        culasse.position.z = zC + 0.035 * pulsation(t, 0.015, 0.035) + 0.05 * pulsation(p - 0.86, 0.04, 0.08);
        chargeur.position.y = yC - 0.15 * (rampe(p, 0.1, 0.3) - rampe(p, 0.6, 0.78));
        chargeur.visible = !(p > 0.32 && p < 0.58);
      };
      break;
    }
    case "pompe": {
      piece(inner, geoBoite(0.045, 0.07, 0.16), m, 0, 0, -0.05);
      piece(inner, geoCyl(0.014, 0.62), m, 0, 0.022, -0.45);
      piece(inner, geoCyl(0.013, 0.45), m, 0, -0.03, -0.38);
      piece(inner, geoBoite(0.006, 0.012, 0.01), m, 0, 0.042, -0.76);
      piece(inner, geoBoite(0.04, 0.09, 0.3), m, 0, -0.02, 0.23, -0.1);
      piece(inner, geoBoite(0.03, 0.08, 0.035), m, 0, -0.07, 0.07, -0.15);
      piece(inner, geoBoite(0.018, 0.004, 0.05), m, 0, -0.04, -0.01);
      const pompe = new THREE.Group();
      pompe.position.set(0, -0.035, -0.37);
      inner.add(pompe);
      piece(pompe, geoBoite(0.052, 0.046, 0.15), m);
      for (const z of [-0.04, 0, 0.04]) piece(pompe, geoBoite(0.057, 0.051, 0.008), m, 0, 0, z);
      const cartouche = piece(inner, geoCyl(0.01, 0.05, 6), m, 0, -0.14, -0.05);
      cartouche.visible = false;
      prise.set(0, -0.07, 0.07);
      garde.set(0, -0.065, pompe.position.z);
      bouche.set(0, 0.022, -0.762);
      porte.set(0.12, -0.2, -0.12);
      echelleFlash = 1.6;
      inclinaison = 0.7;
      const zP = pompe.position.z;
      anim = (t, p) => {
        const tir = rampe(t, 0.2, 0.38) - rampe(t, 0.44, 0.62);
        const rech = rampe(p, 0.82, 0.89) - rampe(p, 0.91, 0.98);
        pompe.position.z = zP + 0.13 * Math.max(tir, rech);
        garde.z = pompe.position.z;
        if (p > 0.08 && p < 0.8) {
          const u = ((p - 0.08) / 0.72) * 5, f = u - Math.floor(u);
          cartouche.visible = f < 0.8;
          cartouche.position.y = -0.14 + 0.1 * lisse(f / 0.8);
        } else cartouche.visible = false;
      };
      break;
    }
    case "sniper": {
      piece(inner, geoBoite(0.046, 0.072, 0.28), m, 0, 0, -0.09);
      piece(inner, geoCyl(0.011, 0.62), m, 0, 0.015, -0.6);
      piece(inner, geoCyl(0.019, 0.06), m, 0, 0.015, -0.93);
      piece(inner, geoBoite(0.04, 0.045, 0.26), m, 0, -0.01, -0.42);
      piece(inner, geoCyl(0.026, 0.3), m, 0, 0.085, -0.12);
      piece(inner, geoCyl(0.034, 0.06), m, 0, 0.085, -0.29);
      piece(inner, geoCyl(0.03, 0.05), m, 0, 0.085, 0.065);
      piece(inner, geoBoite(0.012, 0.04, 0.016), m, 0, 0.058, -0.03);
      piece(inner, geoBoite(0.012, 0.04, 0.016), m, 0, 0.058, -0.2);
      piece(inner, geoBoite(0.012, 0.012, 0.02), m, 0, 0.117, -0.12);
      piece(inner, geoBoite(0.044, 0.1, 0.3), m, 0, -0.025, 0.3, -0.06);
      piece(inner, geoBoite(0.04, 0.04, 0.14), m, 0, 0.045, 0.3);
      piece(inner, geoBoite(0.03, 0.09, 0.04), m, 0, -0.08, 0.1, -0.25);
      piece(inner, geoBoite(0.018, 0.004, 0.05), m, 0, -0.045, 0.03);
      piece(inner, geoBoite(0.006, 0.16, 0.006), m, 0.035, -0.09, -0.6, 0, 0, 0.25);
      piece(inner, geoBoite(0.006, 0.16, 0.006), m, -0.035, -0.09, -0.6, 0, 0, -0.25);
      const chargeur = piece(inner, geoBoite(0.03, 0.06, 0.075), m, 0, -0.06, -0.03);
      const culasse = new THREE.Group();
      culasse.position.set(0.035, 0.02, 0.01);
      inner.add(culasse);
      piece(culasse, geoBoite(0.05, 0.008, 0.008), m, 0.025, 0, 0);
      piece(culasse, geoIco(0.012, 0), m, 0.054, 0, 0);
      prise.set(0, -0.085, 0.1);
      garde.set(0, -0.04, -0.34);
      bouche.set(0, 0.015, -0.965);
      porte.set(0.12, -0.2, -0.1);
      echelleFlash = 1.7;
      inclinaison = 0.4;
      const zB = culasse.position.z, yC = chargeur.position.y;
      /** Cycle de culasse sur ~0,8 s : relève, recul, avance, abaisse. */
      const levier = (t: number) => rampe(t, 0, 0.12) - rampe(t, 0.55, 0.68);
      const recul = (t: number) => rampe(t, 0.12, 0.28) - rampe(t, 0.32, 0.5);
      anim = (t, p) => {
        const tf = t - 0.22, tr = (p - 0.8) * 4;
        culasse.rotation.z = 1.3 * Math.max(levier(tf), levier(tr));
        culasse.position.z = zB + 0.09 * Math.max(recul(tf), recul(tr));
        chargeur.position.y = yC - 0.1 * (rampe(p, 0.1, 0.28) - rampe(p, 0.5, 0.68));
        chargeur.visible = !(p > 0.3 && p < 0.5);
      };
      break;
    }
    case "fusil_assaut": {
      // Carabine d'assaut : carter, garde-main, canon à frein de bouche, rail de transport, chargeur COURBE (se penche vers l'avant), crosse pleine.
      piece(inner, geoBoite(0.05, 0.08, 0.3), m, 0, 0, -0.13);
      piece(inner, geoBoite(0.046, 0.05, 0.2), m, 0, -0.012, -0.38);
      piece(inner, geoCyl(0.011, 0.16), m, 0, 0.012, -0.58);
      piece(inner, geoCyl(0.017, 0.045, 6), m, 0, 0.012, -0.68);
      piece(inner, geoBoite(0.014, 0.03, 0.014), m, 0, 0.045, -0.54);
      piece(inner, geoBoite(0.02, 0.024, 0.2), m, 0, 0.052, -0.12);
      piece(inner, geoBoite(0.012, 0.016, 0.014), m, 0, 0.075, 0);
      piece(inner, geoBoite(0.034, 0.1, 0.04), m, 0, -0.085, 0.005, -0.2);
      piece(inner, geoBoite(0.018, 0.004, 0.05), m, 0, -0.04, -0.055);
      const chargeur = piece(inner, geoBoite(0.03, 0.16, 0.05), m, 0, -0.13, -0.14, 0.3);
      const culasse = piece(inner, geoBoite(0.012, 0.016, 0.06), m, 0.03, 0.03, -0.1);
      piece(inner, geoBoite(0.04, 0.085, 0.26), m, 0, -0.01, 0.27, -0.06);
      piece(inner, geoBoite(0.046, 0.1, 0.02), m, 0, -0.01, 0.4);
      prise.set(0, -0.09, 0);
      garde.set(0, -0.03, -0.38);
      bouche.set(0, 0.012, -0.703);
      porte.set(0.12, -0.21, -0.2);
      echelleFlash = 1.0;
      inclinaison = 0.4;
      const zC = culasse.position.z, yC = chargeur.position.y;
      anim = (t, p) => {
        culasse.position.z = zC + 0.04 * pulsation(t, 0.015, 0.04) + 0.06 * pulsation(p - 0.86, 0.04, 0.08);
        chargeur.position.y = yC - 0.16 * (rampe(p, 0.1, 0.3) - rampe(p, 0.6, 0.78));
        chargeur.visible = !(p > 0.32 && p < 0.58);
      };
      break;
    }
    case "mitrailleuse": {
      // Mitrailleuse légère : long carter, manchon de canon, bipied replié, poignée de transport, BOÎTE de bande sous l'arme, capot qui s'ouvre au rechargement.
      piece(inner, geoBoite(0.056, 0.09, 0.4), m, 0, 0, -0.15);
      piece(inner, geoCyl(0.026, 0.34), m, 0, 0.01, -0.5);
      piece(inner, geoCyl(0.012, 0.18), m, 0, 0.01, -0.76);
      piece(inner, geoCyl(0.02, 0.05, 6), m, 0, 0.01, -0.865);
      piece(inner, geoBoite(0.01, 0.1, 0.01), m, 0.045, -0.07, -0.62, 0, 0, 0.45);
      piece(inner, geoBoite(0.01, 0.1, 0.01), m, -0.045, -0.07, -0.62, 0, 0, -0.45);
      piece(inner, geoBoite(0.016, 0.05, 0.2), m, 0, 0.07, -0.18);
      piece(inner, geoBoite(0.012, 0.016, 0.014), m, 0, 0.1, -0.5);
      piece(inner, geoBoite(0.034, 0.1, 0.04), m, 0, -0.085, 0.04, -0.2);
      piece(inner, geoBoite(0.018, 0.004, 0.05), m, 0, -0.045, -0.02);
      piece(inner, geoBoite(0.045, 0.095, 0.3), m, 0, -0.02, 0.38, -0.08);
      const boite = piece(inner, geoBoite(0.09, 0.11, 0.15), m, 0.005, -0.115, -0.1);
      piece(boite, geoBoite(0.02, 0.02, 0.1), m, -0.045, 0.06, 0);
      const capot = new THREE.Group();
      capot.position.set(0, 0.047, -0.03);
      inner.add(capot);
      piece(capot, geoBoite(0.05, 0.012, 0.2), m, 0, 0.006, -0.1);
      const culasse = piece(inner, geoBoite(0.012, 0.014, 0.05), m, 0.032, 0.03, -0.02);
      prise.set(0, -0.09, 0.04);
      garde.set(0, -0.02, -0.5);
      bouche.set(0, 0.01, -0.89);
      porte.set(0.12, -0.22, -0.15);
      echelleFlash = 1.3;
      inclinaison = 0.5;
      const zC = culasse.position.z, yB = boite.position.y;
      anim = (t, p) => {
        culasse.position.z = zC + 0.05 * pulsation(t, 0.02, 0.05);
        capot.rotation.x = 1.1 * (rampe(p, 0.08, 0.2) - rampe(p, 0.8, 0.92));
        boite.position.y = yB - 0.16 * (rampe(p, 0.2, 0.38) - rampe(p, 0.55, 0.72));
        boite.visible = !(p > 0.4 && p < 0.52);
      };
      break;
    }
    case "revolver":
    case "magnum_dore": {
      // Revolver à six coups ; le magnum doré est le même gabarit en plus grand, canon long ventilé et compensateur. Le barillet sort sur le côté au rechargement.
      const gros = id === "magnum_dore";
      const k = gros ? 1.2 : 1;
      const lc = gros ? 0.3 : 0.2; // longueur du canon
      piece(inner, geoBoite(0.03 * k, 0.06 * k, 0.16 * k), m, 0, 0.012, -0.06);
      const barillet = new THREE.Group();
      barillet.position.set(0, 0.02 * k, -0.1 * k);
      inner.add(barillet);
      piece(barillet, geoCyl(0.032 * k, 0.07 * k, 6), m);
      piece(inner, geoCyl(0.011 * k, lc), m, 0, 0.032 * k, -0.1 * k - lc / 2 - 0.02);
      piece(inner, geoBoite(0.012, 0.012, lc + 0.02), m, 0, 0.05 * k, -0.1 * k - lc / 2 - 0.01);
      piece(inner, geoBoite(0.014, 0.022, lc * 0.6), m, 0, 0.0, -0.1 * k - lc * 0.35);
      if (gros) {
        for (const u of [0.3, 0.5, 0.7]) piece(inner, geoBoite(0.02, 0.006, 0.012), m, 0, 0.058 * k, -0.1 * k - lc * u);
        piece(inner, geoBoite(0.026, 0.024, 0.05), m, 0, 0.036 * k, -0.1 * k - lc - 0.03);
      }
      piece(inner, geoBoite(0.006, 0.014, 0.01), m, 0, 0.056 * k, -0.1 * k - lc - 0.01);
      const chien = piece(inner, geoBoite(0.01, 0.03, 0.014), m, 0, 0.062 * k, 0.025, 0.4);
      piece(inner, geoBoite(0.034 * k, 0.11 * k, 0.05 * k), m, 0, -0.075 * k, 0.03, -0.3);
      piece(inner, geoBoite(0.018, 0.004, 0.045), m, 0, -0.016, -0.04);
      prise.set(0, -0.045, 0.01);
      garde.set(-0.02, -0.075, 0.03);
      bouche.set(0, 0.032 * k, -0.1 * k - lc - 0.035);
      porte.set(0.1, -0.25, gros ? -0.46 : -0.42);
      echelleFlash = gros ? 1.3 : 1.1;
      inclinaison = 0.35;
      const xB = barillet.position.x;
      anim = (t, p) => {
        chien.rotation.x = 0.4 + 0.5 * pulsation(t, 0.02, 0.1);
        // Rechargement : le barillet sort (gauche du tireur), tourne pendant qu'on le garnit, rentre.
        const sorti = rampe(p, 0.1, 0.22) - rampe(p, 0.86, 0.95);
        barillet.position.x = xB - 0.07 * sorti;
        barillet.rotation.x = 0.35 * sorti;
        barillet.rotation.z = (p > 0.25 && p < 0.8 ? ((p - 0.25) / 0.55) * Math.PI * 2 : 0);
      };
      break;
    }
    case "mini_uzi": {
      // Pistolet-mitrailleur compact : boîtier court, chargeur long dans la poignée, crosse filaire repliée, canon court sous manchon.
      piece(inner, geoBoite(0.042, 0.07, 0.17), m, 0, 0, -0.06);
      piece(inner, geoCyl(0.016, 0.05), m, 0, 0.012, -0.16);
      piece(inner, geoCyl(0.009, 0.05), m, 0, 0.012, -0.2);
      piece(inner, geoBoite(0.032, 0.09, 0.044), m, 0, -0.075, -0.01, -0.12);
      const chargeur = piece(inner, geoBoite(0.024, 0.09, 0.034), m, 0, -0.165, -0.005, -0.12);
      piece(inner, geoBoite(0.018, 0.004, 0.045), m, 0, -0.04, -0.07);
      piece(inner, geoBoite(0.006, 0.014, 0.01), m, 0, 0.042, -0.15);
      piece(inner, geoBoite(0.014, 0.016, 0.01), m, 0, 0.042, 0.02);
      piece(inner, geoBoite(0.005, 0.005, 0.16), m, 0.022, 0.0, 0.16);
      piece(inner, geoBoite(0.005, 0.005, 0.16), m, -0.022, 0.0, 0.16);
      piece(inner, geoBoite(0.05, 0.005, 0.005), m, 0, 0.0, 0.24);
      const culasse = piece(inner, geoBoite(0.01, 0.012, 0.04), m, 0.024, 0.026, -0.03);
      prise.set(0, -0.075, 0);
      garde.set(0, -0.05, -0.11);
      bouche.set(0, 0.012, -0.226);
      porte.set(0.11, -0.24, -0.36);
      echelleFlash = 0.7;
      inclinaison = 0.35;
      const zC = culasse.position.z, yC = chargeur.position.y;
      anim = (t, p) => {
        culasse.position.z = zC + 0.03 * pulsation(t, 0.01, 0.03) + 0.04 * pulsation(p - 0.82, 0.04, 0.08);
        chargeur.position.y = yC - 0.13 * (rampe(p, 0.1, 0.3) - rampe(p, 0.55, 0.75));
        chargeur.visible = !(p > 0.32 && p < 0.52);
      };
      break;
    }
    case "railgun": {
      // Fusil à rails : deux rails parallèles, bobines d'accélération en anneaux (elles gonflent au tir), noyau, radiateur dorsal. Pas de rechargement.
      piece(inner, geoBoite(0.06, 0.09, 0.3), m, 0, 0, -0.1);
      for (const x of [-0.034, 0.034]) piece(inner, geoBoite(0.012, 0.03, 0.72), m, x, 0.005, -0.6);
      const bobines = new THREE.Group();
      inner.add(bobines);
      for (const z of [-0.38, -0.55, -0.72, -0.89]) piece(bobines, geoCyl(0.052, 0.035, 10), m, 0, 0.005, z);
      piece(inner, geoCyl(0.012, 0.62), m, 0, 0.005, -0.62);
      piece(inner, geoBoite(0.04, 0.03, 0.18), m, 0, 0.065, -0.05);
      piece(inner, geoBoite(0.03, 0.09, 0.04), m, 0, -0.08, 0.05, -0.2);
      piece(inner, geoBoite(0.018, 0.004, 0.05), m, 0, -0.04, -0.01);
      piece(inner, geoBoite(0.045, 0.1, 0.28), m, 0, -0.02, 0.27, -0.06);
      prise.set(0, -0.085, 0.05);
      garde.set(0, -0.04, -0.4);
      bouche.set(0, 0.005, -1.0);
      porte.set(0.12, -0.2, -0.1);
      echelleFlash = 2.0;
      inclinaison = 0.3;
      anim = (t) => {
        const g = 1 + 0.35 * pulsation(t, 0.03, 0.35);
        bobines.scale.set(g, g, 1);
      };
      break;
    }
    case "minigun": {
      // Minigun : six canons autour d'un axe (le fût tourne à chaque tir et ralentit), disques de maintien, poignées avant et arrière, boîte de bande sur le côté.
      piece(inner, geoBoite(0.1, 0.1, 0.22), m, 0, 0, -0.02);
      const fut = new THREE.Group();
      fut.position.set(0, 0, -0.36);
      inner.add(fut);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        piece(fut, geoCyl(0.011, 0.55), m, Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0);
      }
      for (const z of [-0.26, -0.02, 0.2]) piece(fut, geoCyl(0.055, 0.012, 12), m, 0, 0, z);
      piece(inner, geoBoite(0.02, 0.05, 0.15), m, 0, 0.09, -0.03);
      piece(inner, geoBoite(0.03, 0.1, 0.04), m, 0, -0.09, 0.08, -0.15);
      piece(inner, geoBoite(0.03, 0.09, 0.035), m, 0, -0.095, -0.22);
      piece(inner, geoBoite(0.12, 0.14, 0.16), m, 0.11, -0.08, 0);
      piece(inner, geoBoite(0.025, 0.025, 0.1), m, 0.065, -0.02, -0.04, 0, 0.4);
      prise.set(0, -0.1, 0.08);
      garde.set(0, -0.1, -0.22);
      bouche.set(0, 0, -0.66);
      porte.set(0.1, -0.22, -0.18);
      echelleFlash = 1.1;
      inclinaison = 0.3;
      let vitesseRot = 0;
      surTir = () => { vitesseRot = Math.min(vitesseRot + 10, 45); };
      anim = (_t, _p, dt) => {
        fut.rotation.z += vitesseRot * dt;
        vitesseRot *= Math.exp(-dt * 2.2);
      };
      break;
    }
    case "lance_grenades": {
      piece(inner, geoCyl(0.042, 0.38), m, 0, 0.02, -0.22);
      piece(inner, geoCyl(0.065, 0.16), m, 0, 0, -0.04);
      piece(inner, geoBoite(0.035, 0.11, 0.05), m, 0, -0.08, 0.08, -0.2);
      piece(inner, geoBoite(0.03, 0.08, 0.035), m, 0, -0.07, -0.25);
      prise.set(0, -0.06, 0.08);
      garde.set(0, -0.06, -0.25);
      bouche.set(0, 0.02, -0.42);
      porte.set(0.12, -0.22, -0.38);
      echelleFlash = 1.6;
      inclinaison = 0.35;
      break;
    }
    case "bazooka": {
      piece(inner, geoCyl(0.06, 0.95), m, 0, 0.05, -0.15);
      piece(inner, geoCyl(0.075, 0.08), m, 0, 0.05, -0.63);
      piece(inner, geoCyl(0.08, 0.12), m, 0, 0.05, 0.34);
      piece(inner, geoBoite(0.035, 0.12, 0.05), m, 0, -0.05, -0.12, -0.15);
      piece(inner, geoBoite(0.04, 0.06, 0.08), m, -0.06, 0.11, -0.25);
      prise.set(0, -0.05, -0.12);
      garde.set(0, 0.02, -0.35);
      bouche.set(0, 0.05, -0.65);
      porte.set(0.18, -0.15, -0.2);
      echelleFlash = 2.2;
      inclinaison = 0.2;
      break;
    }
    case "fumigene": {
      piece(inner, geoCyl(0.032, 0.14), m, 0, 0, -0.1);
      piece(inner, geoBoite(0.015, 0.03, 0.04), m, 0, 0.08, -0.1);
      piece(inner, geoCyl(0.012, 0.02), m, 0.02, 0.07, -0.1);
      prise.set(0, -0.02, -0.08);
      garde.set(-0.2, -0.2, 0.3);
      bouche.set(0, 0, -0.2);
      porte.set(0.1, -0.2, -0.28);
      echelleFlash = 0.5;
      inclinaison = 0.1;
      break;
    }
    case "couteau": {
      // Couteau de combat : lame verticale (tranchant vers le bas), garde, manche et pommeau ; la lame est relevée de 0,25 rad. Pas de flash ni de recul.
      const lame = new THREE.Group();
      lame.rotation.x = 0.25;
      inner.add(lame);
      piece(lame, geoBoite(0.008, 0.034, 0.17), m, 0, 0.006, -0.14);
      piece(lame, geoBoite(0.008, 0.024, 0.024), m, 0, 0.012, -0.238, 0.785);
      piece(lame, geoBoite(0.012, 0.008, 0.17), m, 0, 0.026, -0.14);
      piece(lame, geoBoite(0.014, 0.07, 0.016), m, 0, 0, -0.045);
      piece(lame, geoBoite(0.026, 0.034, 0.11), m, 0, 0, 0.02);
      piece(lame, geoBoite(0.03, 0.04, 0.02), m, 0, 0, 0.085);
      prise.set(0, 0, 0.02);
      garde.set(-0.3, -0.3, 0.4); // la main libre pend le long du corps
      bouche.set(0, 0.073, -0.239); // pointe de la lame (repère de `inner`, lame relevée de 0,25 rad)
      porte.set(0.1, -0.22, -0.28);
      echelleFlash = 0;
      inclinaison = 0;
      break;
    }
  }

  // Flash de bouche (le couteau n'en a pas).
  const matFlash = new THREE.LineBasicMaterial({ color: 0xffd890, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: !devant });
  const flash = new THREE.LineSegments(geoFlash(), matFlash);
  flash.position.copy(bouche);
  flash.visible = false;
  flash.userData.ordreFixe = true;
  flash.renderOrder = devant ? 3000 : 7;
  inner.add(flash);

  let tTir = 99, tRech = -1, dureeRech = 1, flashT = 0, tCoup = -1;

  const modele: ModeleArme = {
    group, prise, garde, bouche, porte,
    progres: 0,
    coupU: 0,
    tirer() {
      tTir = 0;
      surTir();
      if (echelleFlash <= 0) return;
      flashT = 0.045;
      flash.visible = true;
      flash.rotation.z = Math.random() * Math.PI * 2;
      flash.scale.setScalar(echelleFlash * (0.75 + Math.random() * 0.5));
    },
    coup() { tCoup = 0; },
    recharger(dureeS) {
      dureeRech = Math.max(dureeS, 0.3);
      tRech = 0;
    },
    maj(dt) {
      tTir += dt;
      if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.visible = false; }
      if (tRech >= 0) { tRech += dt; if (tRech >= dureeRech) tRech = -1; }
      const p = tRech < 0 ? 0 : tRech / dureeRech;
      modele.progres = p;
      const inc = rampe(p, 0.04, 0.18) - rampe(p, 0.86, 0.98);
      inner.rotation.z = -inclinaison * inc;
      inner.rotation.x = -0.5 * inclinaison * inc;
      inner.position.set(0, 0, 0);
      // Coup : armé en arrière et en l'air (0 à 0,25), balayé de droite à gauche vers l'avant (0,25 à 0,55), ramené (0,6 à 1).
      if (tCoup >= 0) {
        tCoup += dt;
        const u = tCoup / DUREE_COUP_S;
        if (u >= 1) { tCoup = -1; modele.coupU = 0; }
        else {
          modele.coupU = u;
          const s1 = rampe(u, 0, 0.25), s2 = rampe(u, 0.25, 0.55), s3 = rampe(u, 0.6, 1);
          const arme = s1 - s2, frappe = s2 - s3;
          inner.rotation.z += 0.7 * arme - 1.1 * frappe;
          inner.rotation.x += 0.4 * arme - 0.5 * frappe;
          inner.position.set(0.06 * arme - 0.12 * frappe, 0, 0.06 * arme - 0.18 * frappe);
        }
      }
      anim(tTir, p, dt);
    },
    dispose() { matFlash.dispose(); group.removeFromParent(); },
  };
  return modele;
}

// ---------------------------------------------------------------------------------------------
// Arme en main (première personne)
// ---------------------------------------------------------------------------------------------

interface PlacementArme {
  /** position de repos et de visée (repère caméra), lacet de repos, recul (m) et cabrage (rad) par tir */
  repos: [number, number, number];
  vise: [number, number, number];
  lacet: number;
  reculZ: number;
  reculRot: number;
}

const PLACEMENT_PISTOLET: PlacementArme = { repos: [0.16, -0.17, -0.36], vise: [0, -0.07, -0.3], lacet: 0.05, reculZ: 0.045, reculRot: 0.13 };
const PLACEMENT_MITRAILLETTE: PlacementArme = { repos: [0.17, -0.18, -0.26], vise: [0, -0.07, -0.22], lacet: 0.04, reculZ: 0.022, reculRot: 0.05 };
const PLACEMENT_SNIPER: PlacementArme = { repos: [0.18, -0.21, -0.1], vise: [0, -0.1, -0.1], lacet: 0.04, reculZ: 0.12, reculRot: 0.28 };
const PLACEMENT_REVOLVER: PlacementArme = { repos: [0.16, -0.17, -0.34], vise: [0, -0.075, -0.28], lacet: 0.05, reculZ: 0.06, reculRot: 0.22 };
/** Une entrée par arme (et le couteau) : `Record` exhaustif, une arme oubliée casse la compilation (voulu). */
const PLACEMENT: Record<ArmeId, PlacementArme> = {
  pistolet: PLACEMENT_PISTOLET,
  mitraillette: PLACEMENT_MITRAILLETTE,
  pompe: { repos: [0.17, -0.2, -0.17], vise: [0, -0.06, -0.15], lacet: 0.05, reculZ: 0.09, reculRot: 0.2 },
  sniper: PLACEMENT_SNIPER,
  fusil_assaut: { repos: [0.17, -0.19, -0.25], vise: [0, -0.085, -0.2], lacet: 0.04, reculZ: 0.028, reculRot: 0.06 },
  mitrailleuse: { repos: [0.19, -0.21, -0.18], vise: [0, -0.095, -0.15], lacet: 0.04, reculZ: 0.035, reculRot: 0.06 },
  revolver: PLACEMENT_REVOLVER,
  mini_uzi: { repos: [0.15, -0.16, -0.3], vise: [0, -0.065, -0.25], lacet: 0.05, reculZ: 0.02, reculRot: 0.05 },
  railgun: { repos: [0.19, -0.21, -0.12], vise: [0, -0.09, -0.1], lacet: 0.04, reculZ: 0.1, reculRot: 0.22 },
  minigun: { repos: [0.2, -0.24, -0.14], vise: [0, -0.1, -0.1], lacet: 0.04, reculZ: 0.015, reculRot: 0.03 },
  magnum_dore: { repos: [0.17, -0.18, -0.36], vise: [0, -0.08, -0.3], lacet: 0.05, reculZ: 0.08, reculRot: 0.26 },
  lance_grenades: { repos: [0.18, -0.20, -0.22], vise: [0, -0.08, -0.18], lacet: 0.04, reculZ: 0.08, reculRot: 0.16 },
  bazooka: { repos: [0.22, -0.18, -0.05], vise: [0.08, -0.06, -0.05], lacet: 0.03, reculZ: 0.12, reculRot: 0.18 },
  fumigene: { repos: [0.18, -0.18, -0.32], vise: [0, -0.08, -0.28], lacet: 0.05, reculZ: 0.03, reculRot: 0.08 },
  couteau: { repos: [0.2, -0.2, -0.36], vise: [0.2, -0.2, -0.36], lacet: -0.05, reculZ: 0, reculRot: 0 },
};

const COULEUR_ARME_PAR_DEFAUT = 0xbfefff;

export function creerArmeEnMain(idInitial: ArmeId, couleur: CouleurEntree = COULEUR_ARME_PAR_DEFAUT): ArmeEnMain {
  const col = new THREE.Color(couleur);
  const m = creerMateriaux(col, true);
  let id: ArmeId = idInitial;
  let pl = PLACEMENT[id];
  const group = new THREE.Group();
  group.position.set(...pl.repos);
  group.rotation.y = pl.lacet;

  // Avant-bras : posés d'abord, donc dessinés sous l'arme. La main avant suit la garde (pompe).
  const brasD = new THREE.Group(), brasG = new THREE.Group();
  for (const b of [brasD, brasG]) {
    piece(b, geoBoite(0.075, 0.55, 0.075, -0.275), m);
    piece(b, geoBoite(0.09, 0.09, 0.1), m, 0, -0.03, 0);
    group.add(b);
  }
  let modele = creerModeleArme(id, m, true);
  group.add(modele.group);
  ordonner(group, true, 1000);

  const coudeD = new THREE.Vector3(0.2, -0.34, 0.5), coudeG = new THREE.Vector3(-0.25, -0.3, 0.5);
  const _dir = new THREE.Vector3();
  const orienterBras = (b: THREE.Group, main: THREE.Vector3, coude: THREE.Vector3) => {
    b.position.copy(main);
    _dir.copy(coude).sub(main).normalize();
    b.quaternion.setFromUnitVectors(BAS, _dir);
  };
  orienterBras(brasD, modele.prise, coudeD);
  orienterBras(brasG, modele.garde, coudeG);

  // Ressort amorti du recul.
  let recul = 0, reculV = 0, ads = 0, phase = 0, amp = 0, air = 0, tAcc = 0;
  const RAIDEUR = 260, AMORTISSEMENT = 21;
  const _bouche = new THREE.Vector3();

  return {
    group,
    get progresRecharge() { return modele.progres; },
    tirer() {
      modele.tirer();
      recul = Math.min(recul + 0.6, 1.3);
    },
    coup() { modele.coup(); },
    changer(arme) {
      if (arme === id) return;
      modele.dispose();
      id = arme;
      pl = PLACEMENT[id];
      modele = creerModeleArme(id, m, true);
      group.add(modele.group);
      ordonner(group, true, 1000);
      orienterBras(brasD, modele.prise, coudeD);
      orienterBras(brasG, modele.garde, coudeG);
      recul = 0;
      reculV = 0;
    },
    recharger(dureeS) { modele.recharger(dureeS); },
    maj(dt, ctx) {
      dt = borne(dt, 0, 0.1);
      tAcc += dt;
      modele.maj(dt);
      orienterBras(brasD, modele.prise, coudeD);
      orienterBras(brasG, modele.garde, coudeG);

      ads += ((ctx.vise ? 1 : 0) - ads) * (1 - Math.exp(-dt * (id === "sniper" ? 14 : 12)));
      const vit = ctx.auSol ? ctx.vitesseH : 0;
      if (vit > 0.5) phase += dt * (6 + vit * 0.9);
      amp += (borne(vit / 9) * (1 - 0.85 * ads) - amp) * (1 - Math.exp(-dt * 8));
      air += ((ctx.auSol ? 0 : 1) - air) * (1 - Math.exp(-dt * 8));
      // Sous-pas ≤ 1/120 s : à très faible fréquence d'images (GPU logiciel), un seul pas de 0,1 s
      // ferait osciller le ressort jusqu'à sortir l'arme de l'écran.
      const pas = Math.max(1, Math.ceil(dt * 120));
      const h = dt / pas;
      for (let k = 0; k < pas; k++) {
        reculV += (-RAIDEUR * recul - AMORTISSEMENT * reculV) * h;
        recul += reculV * h;
      }

      const p = modele.progres;
      const plongee = p > 0 ? Math.pow(Math.sin(Math.PI * Math.min(p, 1)), 0.7) : 0;
      const bx = Math.sin(phase) * 0.012 * amp;
      const by = -Math.abs(Math.cos(phase)) * 0.014 * amp + Math.sin(tAcc * 1.7) * 0.0015 * (1 - ads) + 0.02 * air * (1 - ads);
      group.position.set(
        melange(pl.repos[0], pl.vise[0], ads) + bx,
        melange(pl.repos[1], pl.vise[1], ads) + by - 0.1 * plongee,
        melange(pl.repos[2], pl.vise[2], ads) + recul * pl.reculZ,
      );
      group.rotation.set(recul * pl.reculRot + 0.15 * plongee, pl.lacet * (1 - ads), Math.sin(phase) * 0.015 * amp - 0.25 * plongee);
      // La lunette du sniper remplit l'écran (HUD) : l'arme s'efface quand on vise.
      group.visible = id !== "sniper" || ads < 0.85;
    },
    positionBouche(out) {
      group.updateWorldMatrix(true, true);
      _bouche.copy(modele.bouche);
      modele.group.localToWorld(_bouche);
      return out.copy(_bouche);
    },
    dispose() {
      modele.dispose();
      group.removeFromParent();
      libererMateriaux(m);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Avatars (autres joueurs)
// ---------------------------------------------------------------------------------------------

const SEG_BRAS = 0.35;
/** Hauteur de la plaque du pseudo au-dessus des pieds (m) : debout, et accroupi ou assis (tête de la hitbox + 0,5 m). */
const Y_PSEUDO = silhouetteDe(false).tete.y + 0.5;
const Y_PSEUDO_BAS = silhouetteDe(true).tete.y + 0.5;
/** Silhouette lointaine (§2.1) : barre additive 0,5 × 2,2 m (1,4 m accroupi), 35 % de la couleur, qui apparaît entre 45 et 50 m. */
const SILHOUETTE_LOIN = { largeur: 0.5, hauteur: 2.2, hauteurBas: 1.4, opacite: 0.35, debutM: 45, pleinM: 50 };

/** Plaque du pseudo : sombre, bordée et écrite de la couleur du joueur. */
export function texturePseudo(pseudo: string, couleur: THREE.Color): { tex: THREE.CanvasTexture; ratio: number } {
  const L = 384, H = 72;
  const cv = document.createElement("canvas");
  cv.width = L;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const css = `#${couleur.getHexString()}`;
  if (ctx) {
    ctx.fillStyle = "rgba(4, 6, 10, 0.78)";
    ctx.beginPath();
    ctx.roundRect(3, 3, L - 6, H - 6, 12);
    ctx.fill();
    ctx.strokeStyle = css;
    ctx.lineWidth = 3;
    ctx.stroke();
    let taille = 40;
    const police = (t: number) => `600 ${t}px "Chakra Petch", "IBM Plex Mono", ui-monospace, system-ui, sans-serif`;
    ctx.font = police(taille);
    while (taille > 16 && ctx.measureText(pseudo).width > L - 36) { taille -= 2; ctx.font = police(taille); }
    ctx.fillStyle = css;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pseudo, L / 2, H / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, ratio: L / H };
}

interface Jambe { hanche: THREE.Group; genou: THREE.Group }
interface Bras { epaule: THREE.Group; coude: THREE.Group }

/**
 * Poses des jambes (angles de hanche et de genou, rad ; hanche > 0 = cuisse vers l'avant, genou < 0 = jambe repliée vers l'arrière), hauteur du bassin
 * (m, avant échelle) et inclinaison du buste (rad, < 0 vers l'avant). Les pieds restent sous le bassin : accroupi, 2 × 0,43 × cos 1,1 + semelle ≈ 0,43 m.
 */
const POSE_ACCROUPI = { hancheG: 1.15, hancheD: 1.05, genouG: -2.25, genouD: -2.1, bassin: 0.43, buste: -0.42 };
/** Glissade : assis au ras du sol, une jambe repliée sous soi, l'autre tendue devant, buste rejeté en arrière. */
const POSE_GLISSADE = { hancheG: 1.35, hancheD: 1.45, genouG: -2.65, genouD: -0.15, bassin: 0.22, buste: 0.5 };
/** Assis dans un véhicule : cuisses à l'horizontale, jambes verticales, buste droit. */
const POSE_ASSIS = { hancheG: 1.45, hancheD: 1.45, genouG: -1.45, genouD: -1.45, bassin: 0.4, buste: 0 };
const BASSIN_DEBOUT = 0.9;
/** Mains posées sur le volant, repère du buste (la pose assise ne tient aucune arme). */
const MAIN_VOLANT_G = new THREE.Vector3(-0.13, -0.3, -0.42);
const MAIN_VOLANT_D = new THREE.Vector3(0.13, -0.3, -0.42);

export function creerAvatar(couleur: CouleurEntree, pseudo: string): AvatarJoueur {
  const col = new THREE.Color(couleur);
  const m = creerMateriaux(col, false, true);

  const racine = new THREE.Group();
  const contenu = new THREE.Group(); // agrandi de ECHELLE_AVATAR autour des pieds
  contenu.scale.setScalar(ECHELLE_AVATAR);
  const chute = new THREE.Group(); // bascule à la mort, pivot aux pieds
  const corps = new THREE.Group(); // hanches
  corps.position.y = BASSIN_DEBOUT;
  racine.add(contenu);
  contenu.add(chute);
  chute.add(corps);

  piece(corps, geoBoite(0.38, 0.18, 0.24), m);
  const jambes = new THREE.Group();
  corps.add(jambes);
  const jambe = (x: number): Jambe => {
    const hanche = new THREE.Group();
    hanche.position.set(x, 0, 0);
    jambes.add(hanche);
    piece(hanche, geoBoite(0.15, 0.43, 0.16, -0.215), m);
    const genou = new THREE.Group();
    genou.position.y = -0.43;
    hanche.add(genou);
    piece(genou, geoBoite(0.12, 0.43, 0.13, -0.215), m);
    piece(genou, geoBoite(0.12, 0.07, 0.26), m, 0, -0.43, -0.06);
    return { hanche, genou };
  };
  const jG = jambe(-0.1), jD = jambe(0.1);

  const torse = new THREE.Group();
  torse.position.y = 0.08;
  corps.add(torse);
  piece(torse, geoBoite(0.46, 0.48, 0.26), m, 0, 0.24, 0);
  const tete = new THREE.Group();
  tete.position.y = 0.46;
  torse.add(tete);
  piece(tete, geoIco(0.2, 1), m, 0, 0.19, 0);
  piece(tete, geoBoite(0.22, 0.055, 0.055), m, 0, 0.21, -0.19); // visière : montre où il regarde

  const visee = new THREE.Group(); // épaules : pivote avec le tangage
  visee.position.y = 0.42;
  torse.add(visee);
  const bras = (cote: number): Bras => {
    const epaule = new THREE.Group();
    epaule.position.set(cote * 0.27, 0, 0);
    visee.add(epaule);
    piece(epaule, geoBoite(0.1, SEG_BRAS, 0.1, -SEG_BRAS / 2), m);
    const coude = new THREE.Group();
    coude.position.y = -SEG_BRAS;
    epaule.add(coude);
    piece(coude, geoBoite(0.08, SEG_BRAS, 0.08, -SEG_BRAS / 2), m);
    piece(coude, geoBoite(0.09, 0.09, 0.09), m, 0, -SEG_BRAS - 0.03, 0);
    return { epaule, coude };
  };
  const bD = bras(1), bG = bras(-1);

  // Bouclier de la protection d'apparition (dans le contenu : il suit l'échelle de l'avatar).
  const matBouclier = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
  const bouclier = new THREE.LineSegments(geoIco(0.95, 1).aretes, matBouclier);
  bouclier.position.y = 0.95;
  bouclier.visible = false;
  contenu.add(bouclier);

  ordonner(racine, false, 5);

  // Silhouette lointaine : barre additive qui garde l'avatar repérable quand ses arêtes se fondent dans le décor. Masquée par les bâtiments.
  const matSilhouette = new THREE.SpriteMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false });
  const silhouette = new THREE.Sprite(matSilhouette);
  silhouette.scale.set(SILHOUETTE_LOIN.largeur, SILHOUETTE_LOIN.hauteur, 1);
  silhouette.position.y = SILHOUETTE_LOIN.hauteur / 2;
  silhouette.renderOrder = 9;
  silhouette.userData.ordreFixe = true;
  silhouette.frustumCulled = false;
  const _pw = new THREE.Vector3(), _pc = new THREE.Vector3();
  silhouette.onBeforeRender = (_renderer, _scene, camera) => {
    silhouette.getWorldPosition(_pw);
    _pc.setFromMatrixPosition(camera.matrixWorld);
    matSilhouette.opacity = SILHOUETTE_LOIN.opacite * rampe(_pw.distanceTo(_pc), SILHOUETTE_LOIN.debutM, SILHOUETTE_LOIN.pleinM);
  };
  racine.add(silhouette);

  // Pseudo : sprite masqué par les bâtiments, de hauteur écran réglée par la distance (`hauteurPlaquePx`), allumé par `afficherPseudo`.
  const { tex, ratio } = texturePseudo(pseudo, col);
  const matPseudo = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, toneMapped: false });
  const etiquette = new THREE.Sprite(matPseudo);
  etiquette.position.y = Y_PSEUDO;
  etiquette.renderOrder = 10;
  etiquette.frustumCulled = false;
  /** Pilotage par `VisibilitePseudos` : tant que `afficherPseudo` n'a jamais été appelé, la plaque reste visible (v1) et sa distance vient de la caméra. */
  let pilote = false;
  let alphaPseudo = 1;
  let distancePseudo = 0;
  let mort = false;
  etiquette.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    etiquette.getWorldPosition(_pw);
    _pc.setFromMatrixPosition(cam.matrixWorld);
    const d = Math.max(_pw.distanceTo(_pc), 0.5);
    const hPx = (renderer.domElement as HTMLCanvasElement).clientHeight || 800;
    const px = hauteurPlaquePx(pilote ? distancePseudo : d);
    const h = (px / hPx) * 2 * d * Math.tan(((cam.fov || 90) * Math.PI) / 360);
    etiquette.scale.set(h * ratio, h, 1);
    etiquette.updateMatrixWorld();
  };
  racine.add(etiquette);

  // Armes : créées à la demande, une seule visible, portée par le buste et visée par les deux bras.
  const armes = new Map<ArmeId, ModeleArme>();
  let armeCourante: ModeleArme | null = null;
  let idCourant: ArmeId | null = null;
  const choisirArme = (a: ArmeId) => {
    if (armeCourante) armeCourante.group.visible = false;
    let mod = armes.get(a);
    if (!mod) {
      mod = creerModeleArme(a, m, false);
      mod.group.position.copy(mod.porte);
      visee.add(mod.group);
      ordonner(mod.group, false, 5);
      armes.set(a, mod);
    }
    mod.group.visible = true;
    armeCourante = mod;
    idCourant = a;
  };

  const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _u = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _c = new THREE.Vector3();
  const _bw = new THREE.Vector3();
  const qHaut = new THREE.Quaternion(), qBas = new THREE.Quaternion();
  /** Cinématique inverse à deux os : l'épaule `b` attrape `cible` (repère du buste), coude vers le bas et l'extérieur. */
  const attraper = (b: Bras, cote: number, cible: THREE.Vector3) => {
    _d.copy(cible).sub(b.epaule.position);
    let dist = _d.length();
    if (dist < 1e-4) return;
    _d.divideScalar(dist);
    dist = Math.min(dist, 2 * SEG_BRAS - 0.004);
    const a = Math.acos(borne(dist / (2 * SEG_BRAS), -1, 1));
    _p.set(cote * 0.6, -1, 0.25);
    _p.addScaledVector(_d, -_p.dot(_d));
    if (_p.lengthSq() < 1e-6) _p.set(0, 0, 1);
    _p.normalize();
    _u.copy(_d).multiplyScalar(Math.cos(a)).addScaledVector(_p, Math.sin(a));
    _e.copy(b.epaule.position).addScaledVector(_u, SEG_BRAS);
    _f.copy(_d).multiplyScalar(dist).add(b.epaule.position).sub(_e).normalize();
    qHaut.setFromUnitVectors(BAS, _u);
    qBas.setFromUnitVectors(BAS, _f);
    b.epaule.quaternion.copy(qHaut);
    b.coude.quaternion.copy(qHaut).invert().multiply(qBas);
  };

  let t = 0, phase = 0, amp = 0, bAir = 0, bMur = 0, coteMur = 1, tMort = 0, eclat = 0, opaciteLigne = 0.95, enEclat = false, etaitMort = false;
  /** poids lissés (0..1) des poses accroupie, glissade et assise */
  let bAcc = 0, bGli = 0, bAssis = 0;
  const ECLAT_S = 0.14;

  return {
    group: racine,
    tirer() { armeCourante?.tirer(); },
    coup() { armeCourante?.coup(); },
    toucher() { eclat = ECLAT_S; },
    afficherPseudo(alpha, distance) {
      pilote = true;
      alphaPseudo = borne(alpha);
      distancePseudo = Math.max(distance, 0);
      matPseudo.opacity = alphaPseudo;
      etiquette.visible = alphaPseudo > 0.01 && !mort;
    },
    positionBouche() {
      if (!armeCourante) return [racine.position.x, racine.position.y + 1.4, racine.position.z];
      armeCourante.group.updateWorldMatrix(true, false);
      _bw.copy(armeCourante.bouche);
      armeCourante.group.localToWorld(_bw);
      return [_bw.x, _bw.y, _bw.z];
    },
    maj(etat, dt) {
      dt = borne(dt, 0, 0.1);
      t += dt;
      racine.position.set(etat.p[0], etat.p[1], etat.p[2]);
      racine.rotation.y = etat.lacet;
      if (etat.arme !== idCourant) choisirArme(etat.arme);
      mort = !etat.vivant || etat.posture === "mort";
      if (mort !== etaitMort) { tMort = 0; etaitMort = mort; }
      const assis = !!etat.vehicule && !mort;
      const accroupi = !!etat.accroupi && !assis && !mort && etat.posture === "sol";

      // Vitesse dans le repère du joueur (avant, droite).
      const vx = etat.v[0], vz = etat.v[2];
      const vitH = Math.hypot(vx, vz);
      const s = Math.sin(etat.lacet), c = Math.cos(etat.lacet);
      const vf = -vx * s - vz * c, vr = vx * c - vz * s;
      const kb = 1 - Math.exp(-dt * 12);
      bAir += ((etat.posture === "air" ? 1 : 0) - bAir) * kb;
      bMur += ((etat.posture === "mur" ? 1 : 0) - bMur) * kb;
      amp += (Math.min(vitH / 9, 1.1) - amp) * kb;
      if (etat.mur !== 0) coteMur = etat.mur;
      // Postures : montée rapide, retour un peu plus lent. La glissade est celle que le joueur déclare (`glisse` du snap, fiable : une
      // marche accroupie rapide, un élan de saut ou un lag ne la simulent plus).
      const glisse = accroupi && !!etat.glisse;
      bAcc += ((accroupi ? 1 : 0) - bAcc) * kb;
      bGli += ((glisse ? 1 : 0) - bGli) * (1 - Math.exp(-dt * (glisse ? 16 : 4)));
      bAssis += ((assis ? 1 : 0) - bAssis) * kb;

      // Les jambes courent dans la direction du déplacement (pas de moonwalk : au-delà de 90°, elles courent à reculons).
      let sens = 1;
      if (vitH > 0.6 && bAssis < 0.5 && bGli < 0.5) {
        let phi = Math.atan2(vr, vf);
        if (Math.abs(phi) > Math.PI / 2) { phi += phi > 0 ? -Math.PI : Math.PI; sens = -1; }
        jambes.rotation.y += ecartAngle(jambes.rotation.y, -phi) * (1 - Math.exp(-dt * 14));
      } else {
        jambes.rotation.y += ecartAngle(jambes.rotation.y, 0) * (1 - Math.exp(-dt * 8));
      }
      if (bAir < 0.5 && bAssis < 0.5) phase += sens * dt * ((Math.PI * 2 * vitH) / 3);

      // Cycle de course / pose en l'air, puis fondu vers les poses accroupie, glissade et assise (les pieds restent sous le bassin).
      const sol = 1 - bAir;
      const balan = 0.9 * amp * sol;
      const plie = (ph: number) => amp * sol * (0.18 + 1.15 * Math.max(0, Math.cos(ph)));
      let hG = melange(balan * Math.sin(phase), 0.75, bAir);
      let hD = melange(balan * Math.sin(phase + Math.PI), -0.2, bAir);
      let gG = -melange(plie(phase), 1.1, bAir);
      let gD = -melange(plie(phase + Math.PI), 0.55, bAir);
      let bassin = BASSIN_DEBOUT - 0.05 * amp * sol + 0.035 * amp * sol * Math.abs(Math.sin(phase));
      let buste = -0.14 * borne(vf / 9, -1, 1);
      // Accroupi : le cycle de marche garde une amplitude réduite autour de la pose basse.
      const marcheBasse = Math.min(amp, 0.8);
      const cible = (pose: typeof POSE_ACCROUPI, w: number, cycle: number) => {
        hG = melange(hG, pose.hancheG + 0.35 * cycle * Math.sin(phase), w);
        hD = melange(hD, pose.hancheD + 0.35 * cycle * Math.sin(phase + Math.PI), w);
        gG = melange(gG, pose.genouG - 0.25 * cycle * Math.max(0, Math.cos(phase)), w);
        gD = melange(gD, pose.genouD - 0.25 * cycle * Math.max(0, Math.cos(phase + Math.PI)), w);
        bassin = melange(bassin, pose.bassin + 0.02 * cycle * Math.abs(Math.sin(phase)), w);
        buste = melange(buste, pose.buste, w);
      };
      if (bAcc > 0.001) cible(POSE_ACCROUPI, bAcc, marcheBasse);
      if (bGli > 0.001) cible(POSE_GLISSADE, bGli, 0);
      if (bAssis > 0.001) cible(POSE_ASSIS, bAssis, 0);
      jG.hanche.rotation.x = hG;
      jD.hanche.rotation.x = hD;
      jG.genou.rotation.x = gG;
      jD.genou.rotation.x = gD;
      corps.position.y = bassin;
      corps.rotation.x = buste;
      corps.rotation.z = coteMur * 0.38 * bMur; // tête à l'opposé du mur, pieds contre lui

      // Visée (assis, le buste regarde droit devant).
      const tang = borne(etat.tangage, -1.3, 1.3) * (1 - bAssis);
      visee.rotation.x = tang * 0.85;
      tete.rotation.x = tang * 0.7;

      // Bras vers la poignée et le garde-main de l'arme ; assis, l'arme est rangée et les mains tiennent le volant.
      if (armeCourante) {
        armeCourante.group.visible = bAssis < 0.5;
        armeCourante.maj(dt);
        if (bAssis < 0.5) {
          _c.copy(armeCourante.porte).add(armeCourante.prise);
          const fente = Math.sin(Math.PI * Math.min(armeCourante.coupU * 1.15, 1));
          if (fente > 0) _c.z -= 0.2 * fente; // le bras part avec le coup
          attraper(bD, 1, _c);
          attraper(bG, -1, _c.copy(armeCourante.porte).add(armeCourante.garde));
        } else {
          attraper(bD, 1, MAIN_VOLANT_D);
          attraper(bG, -1, MAIN_VOLANT_G);
        }
      }

      // Plaque du pseudo à la hauteur de la tête, silhouette lointaine à la taille du joueur.
      const bas = Math.max(bAcc, bAssis);
      etiquette.position.y = melange(Y_PSEUDO, Y_PSEUDO_BAS, bas);
      const hauteurSil = melange(SILHOUETTE_LOIN.hauteur, SILHOUETTE_LOIN.hauteurBas, bas);
      silhouette.scale.y = hauteurSil;
      silhouette.position.y = hauteurSil / 2;

      // Mort : bascule en arrière, arêtes atténuées, ni pseudo ni bouclier ni silhouette.
      if (mort) tMort = Math.min(tMort + dt, 1);
      const k = 1 - Math.pow(1 - Math.min(tMort / 0.45, 1), 3);
      chute.rotation.x = mort ? k * 1.5 : 0;
      chute.position.y = mort ? 0.12 * k : 0;
      etiquette.visible = !mort && (!pilote || alphaPseudo > 0.01);
      silhouette.visible = !mort;
      bouclier.visible = etat.protege && !mort;
      if (bouclier.visible) matBouclier.opacity = 0.22 + 0.18 * Math.sin(t * 14);

      // Éclat blanc quand on est touché ; opacité des arêtes.
      const opacite = mort ? 0.5 : 0.95;
      if (opacite !== opaciteLigne) { opaciteLigne = opacite; m.ligne.opacity = opacite; }
      if (eclat > 0) {
        eclat = Math.max(eclat - dt, 0);
        m.ligne.color.copy(col).lerp(BLANC, eclat / ECLAT_S);
        enEclat = true;
      } else if (enEclat) {
        m.ligne.color.copy(col);
        enEclat = false;
      }
    },
    dispose() {
      racine.removeFromParent();
      for (const a of armes.values()) a.dispose();
      armes.clear();
      libererMateriaux(m);
      matBouclier.dispose();
      matPseudo.dispose();
      matSilhouette.dispose();
      tex.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Effets (traçantes, impacts, éclaboussures) : pools préalloués, aucune allocation par image
// ---------------------------------------------------------------------------------------------

/** Rubans de traçantes simultanés (le pompe en consomme 9 par tir). */
const TRACANTES = 96;
const RAFALES = 40;
/** Étincelles d'un impact (14), d'une éclaboussure (jusqu'à 14 aussi). */
const ETINCELLES = 14;
/** Brins de la bouffée de poussière d'un impact. */
const POUSSIERES = 8;
const COULEUR_IMPACT = 0xffc77a;
const COULEUR_POUSSIERE = 0xc9c1b2;
/** Durées de vie (s) des éléments d'un impact : étincelles, anneau (0,9 m de côté à la fin), poussière. */
const VIE_ETINCELLES_S = 0.35;
const VIE_ANNEAU_S = 0.35;
const VIE_POUSSIERE_S = 0.5;
/** Demi-côté final de l'anneau d'impact (m) : 0,9 m de côté. */
const DEMI_ANNEAU_M = 0.45;
/** Une traçante dont l'arrivée est à moins de ce rayon (m) du point d'un `impact()` reçu dans la foulée le différé jusqu'à l'arrivée de sa tête. */
const RAYON_APPARIEMENT_M = 0.05;
/** Âge (s) maximal d'une traçante pour recevoir un impact différé : l'impact suit toujours le tir dans la même image. */
const AGE_APPARIEMENT_S = 0.05;
/** Couleur et paramètres d'une traçante demandée avec une couleur plutôt qu'une arme (ancien appel de jeu.ts). */
const PARAMS_TRACANTE_COULEUR: ParamsTraceur = { ...TRACEURS.pistolet, couleur: "#fff1b8" };
/** Coins de l'anneau d'impact, en (u, v) unitaires. */
const COINS = [1, 1, -1, 1, -1, -1, 1, -1];

interface Tracante {
  ruban: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  depart: THREE.Vector3;
  fin: THREE.Vector3;
  /** extrémités du ruban à l'image courante (lues par `onBeforeRender`) */
  tete: THREE.Vector3;
  queue: THREE.Vector3;
  params: ParamsTraceur;
  /** largeurs monde (m) du ruban à la queue et à la tête, recalculées à chaque dessin pour garder `epaisseurPx` à l'écran sur toute la longueur */
  largeurs: { value: THREE.Vector2 };
  age: number;
  vie: number;
  tImpact: number;
  actif: boolean;
  /** impact en attente de l'arrivée de la tête (demandé par `impact()` dans la foulée du tir) */
  impactAttente: boolean;
  nrm: THREE.Vector3;
  couleurImpact: THREE.Color;
}

interface Rafale {
  etincelles: THREE.LineSegments;
  anneau: THREE.LineLoop;
  poussiere: THREE.LineSegments;
  matE: THREE.LineBasicMaterial;
  matA: THREE.LineBasicMaterial;
  matP: THREE.LineBasicMaterial;
  posE: THREE.BufferAttribute;
  posA: THREE.BufferAttribute;
  posP: THREE.BufferAttribute;
  pts: Float32Array;
  vel: Float32Array;
  /** directions des brins de poussière (dans le plan de la surface, légèrement relevées) */
  dirsP: Float32Array;
  n: number;
  age: number;
  vieE: number;
  vieA: number;
  vieP: number;
  /** base du plan de l'anneau + centre + normale */
  u: THREE.Vector3;
  v: THREE.Vector3;
  c: THREE.Vector3;
  nrm: THREE.Vector3;
  anneauActif: boolean;
  poussiereActive: boolean;
  actif: boolean;
}

/**
 * Quadrilatère unitaire du ruban : x de 0 (queue, transparente) à 1 (tête, vive), y de −0,5 à 0,5 ; le vertex shader (cf. `creerEffets`) règle
 * la largeur de chaque extrémité. Une seule géométrie pour tous les rubans.
 */
function geoRuban(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
  // RGBA : la couleur de l'arme vient du matériau, le dégradé d'opacité de la queue vers la tête ici.
  g.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1, 0.08, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.08], 4));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * Demi-largeur monde d'une extrémité de ruban : `largeurMonde` (≥ `epaisseurPx` à l'écran, plancher 0,04 m), plafonnée à 2 × `epaisseurPx` à l'écran.
 * Le plancher de 0,04 m ne vaut que dans les ~14 premiers mètres ; sans ce plafond, la queue d'un ruban qui part de la bouche (à 0,6 m de l'œil)
 * serait un coin de 60 px de large.
 */
function demiLargeurRuban(distanceCamera: number, epaisseurPx: number, fovDeg: number, hauteurPx: number): number {
  const metresParPixel = (2 * Math.max(distanceCamera, 0) * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(hauteurPx, 1);
  return Math.min(largeurMonde(distanceCamera, epaisseurPx, fovDeg, hauteurPx), epaisseurPx * metresParPixel);
}

export function creerEffets(scene: THREE.Object3D): Effets {
  const racine = new THREE.Group();
  scene.add(racine);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  const geoR = geoRuban();
  geos.push(geoR);
  const tracantes: Tracante[] = [];
  const _cam = new THREE.Vector3(), _mid = new THREE.Vector3(), _dir = new THREE.Vector3(), _lat = new THREE.Vector3(), _nor = new THREE.Vector3();
  for (let i = 0; i < TRACANTES; i++) {
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const largeurs = { value: new THREE.Vector2(LARGEUR_MIN_M * 2, LARGEUR_MIN_M * 2) };
    // Largeur propre à chaque extrémité : un ruban long partant près de la caméra serait sinon énorme côté tireur et filiforme côté cible.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uLargeurs = largeurs;
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "uniform vec2 uLargeurs;\nvoid main() {")
        .replace("#include <begin_vertex>", "vec3 transformed = vec3( position.x, position.y * mix( uLargeurs.x, uLargeurs.y, position.x ), position.z );");
    };
    mat.customProgramCacheKey = () => "ruban-traçante";
    const ruban = new THREE.Mesh(geoR, mat);
    ruban.frustumCulled = false;
    ruban.visible = false;
    ruban.renderOrder = 20;
    ruban.matrixAutoUpdate = false;
    const tr: Tracante = {
      ruban, mat, largeurs,
      depart: new THREE.Vector3(), fin: new THREE.Vector3(), tete: new THREE.Vector3(), queue: new THREE.Vector3(),
      params: TRACEURS.pistolet, age: 0, vie: 0, tImpact: 0, actif: false,
      impactAttente: false, nrm: new THREE.Vector3(0, 1, 0), couleurImpact: new THREE.Color(COULEUR_IMPACT),
    };
    // Le ruban est orienté vers la caméra COURANTE (vue du joueur ou killcam) juste avant le dessin, comme la plaque de pseudo :
    // sa matrice est posée ici, après la mise à jour de la scène et avant le calcul de la matrice modèle-vue, et ses largeurs (uniform) avant l'envoi au GPU.
    ruban.onBeforeRender = (renderer, _s, camera) => {
      const cam = camera as THREE.PerspectiveCamera;
      _dir.subVectors(tr.tete, tr.queue);
      const longueur = _dir.length();
      if (longueur < 1e-4) { ruban.matrixWorld.makeScale(0, 0, 0); return; }
      _dir.divideScalar(longueur);
      _mid.addVectors(tr.tete, tr.queue).multiplyScalar(0.5);
      _cam.setFromMatrixPosition(cam.matrixWorld);
      _nor.subVectors(_cam, _mid);
      _lat.crossVectors(_dir, _nor);
      // Vu de bout (la caméra est dans l'axe du tir) : n'importe quel latéral convient.
      if (_lat.lengthSq() < 1e-10) _lat.set(0, 1, 0).cross(_dir);
      if (_lat.lengthSq() < 1e-10) _lat.set(1, 0, 0).cross(_dir);
      _lat.normalize();
      _nor.crossVectors(_dir, _lat);
      const hPx = (renderer.domElement as HTMLCanvasElement).clientHeight || 800;
      const fov = cam.fov || 90;
      largeurs.value.set(
        2 * demiLargeurRuban(_cam.distanceTo(tr.queue), tr.params.epaisseurPx, fov, hPx),
        2 * demiLargeurRuban(_cam.distanceTo(tr.tete), tr.params.epaisseurPx, fov, hPx),
      );
      ruban.matrixWorld.makeBasis(_dir.multiplyScalar(longueur), _lat, _nor).setPosition(tr.queue);
      ruban.matrix.copy(ruban.matrixWorld);
    };
    racine.add(ruban);
    mats.push(mat);
    tracantes.push(tr);
  }

  const rafales: Rafale[] = [];
  for (let i = 0; i < RAFALES; i++) {
    const gE = new THREE.BufferGeometry();
    const posE = new THREE.BufferAttribute(new Float32Array(ETINCELLES * 6), 3);
    posE.setUsage(THREE.DynamicDrawUsage);
    gE.setAttribute("position", posE);
    const matE = new THREE.LineBasicMaterial({ color: COULEUR_IMPACT, transparent: true, opacity: 1, depthWrite: false });
    const etincelles = new THREE.LineSegments(gE, matE);
    const gA = new THREE.BufferGeometry();
    const posA = new THREE.BufferAttribute(new Float32Array(12), 3);
    posA.setUsage(THREE.DynamicDrawUsage);
    gA.setAttribute("position", posA);
    const matA = new THREE.LineBasicMaterial({ color: COULEUR_IMPACT, transparent: true, opacity: 1, depthWrite: false });
    const anneau = new THREE.LineLoop(gA, matA);
    const gP = new THREE.BufferGeometry();
    const posP = new THREE.BufferAttribute(new Float32Array(POUSSIERES * 6), 3);
    posP.setUsage(THREE.DynamicDrawUsage);
    gP.setAttribute("position", posP);
    const matP = new THREE.LineBasicMaterial({ color: COULEUR_POUSSIERE, transparent: true, opacity: 1, depthWrite: false });
    const poussiere = new THREE.LineSegments(gP, matP);
    for (const o of [etincelles, anneau, poussiere]) { o.frustumCulled = false; o.visible = false; o.renderOrder = 21; racine.add(o); }
    geos.push(gE, gA, gP);
    mats.push(matE, matA, matP);
    rafales.push({
      etincelles, anneau, poussiere, matE, matA, matP, posE, posA, posP,
      pts: new Float32Array(ETINCELLES * 3), vel: new Float32Array(ETINCELLES * 3), dirsP: new Float32Array(POUSSIERES * 3),
      n: 0, age: 0, vieE: VIE_ETINCELLES_S, vieA: VIE_ANNEAU_S, vieP: VIE_POUSSIERE_S,
      u: new THREE.Vector3(), v: new THREE.Vector3(), c: new THREE.Vector3(), nrm: new THREE.Vector3(),
      anneauActif: false, poussiereActive: false, actif: false,
    });
  }

  let iTrac = 0, iRaf = 0;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _col = new THREE.Color();

  /**
   * Départ d'une rafale d'étincelles en `c`, éjectées autour de `nrm`. `impact` ajoute l'anneau (0,9 m) et la bouffée de poussière (0,5 s) ;
   * une éclaboussure n'a que des étincelles.
   */
  function lancerRafale(c: THREE.Vector3, nrm: THREE.Vector3, couleur: number | string | THREE.Color, n: number, vitesse: number, vie: number, impact: boolean) {
    const r = rafales[iRaf];
    iRaf = (iRaf + 1) % RAFALES;
    r.actif = true;
    r.age = 0;
    r.vieE = vie;
    r.vieA = impact ? VIE_ANNEAU_S : 0;
    r.vieP = impact ? VIE_POUSSIERE_S : 0;
    r.n = Math.min(n, ETINCELLES);
    r.c.copy(c);
    r.nrm.copy(nrm);
    for (let i = 0; i < r.n; i++) {
      const rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
      const f = 0.4 + Math.random() * 0.9;
      r.pts[i * 3] = c.x; r.pts[i * 3 + 1] = c.y; r.pts[i * 3 + 2] = c.z;
      r.vel[i * 3] = (nrm.x * f * 1.4 + rx * 0.9) * vitesse;
      r.vel[i * 3 + 1] = (nrm.y * f * 1.4 + ry * 0.9) * vitesse;
      r.vel[i * 3 + 2] = (nrm.z * f * 1.4 + rz * 0.9) * vitesse;
    }
    _col.set(couleur);
    r.matE.color.copy(_col);
    r.matA.color.copy(_col);
    r.etincelles.visible = true;
    r.anneauActif = impact;
    r.poussiereActive = impact;
    r.anneau.visible = impact;
    r.poussiere.visible = impact;
    if (impact) {
      // Base orthonormée du plan de la surface.
      if (Math.abs(nrm.y) < 0.9) _a.set(0, 1, 0); else _a.set(1, 0, 0);
      r.u.crossVectors(nrm, _a).normalize();
      r.v.crossVectors(nrm, r.u).normalize();
      // Brins de poussière : répartis autour de la normale, un peu relevés.
      for (let i = 0; i < POUSSIERES; i++) {
        const a = ((i + Math.random() * 0.6) / POUSSIERES) * Math.PI * 2;
        const cu = Math.cos(a), cv = Math.sin(a);
        r.dirsP[i * 3] = r.u.x * cu + r.v.x * cv + nrm.x * 0.35;
        r.dirsP[i * 3 + 1] = r.u.y * cu + r.v.y * cv + nrm.y * 0.35;
        r.dirsP[i * 3 + 2] = r.u.z * cu + r.v.z * cv + nrm.z * 0.35;
      }
    }
    majRafale(r, 0);
  }

  function majRafale(r: Rafale, dt: number) {
    r.age += dt;
    const vieTotale = Math.max(r.vieE, r.vieA, r.vieP);
    if (r.age >= vieTotale) {
      r.actif = false;
      r.etincelles.visible = false;
      r.anneau.visible = false;
      r.poussiere.visible = false;
      return;
    }
    const uE = r.age / r.vieE;
    r.etincelles.visible = uE < 1;
    if (uE < 1) {
      const a = r.posE.array as Float32Array;
      for (let i = 0; i < ETINCELLES; i++) {
        if (i >= r.n) { for (let k = 0; k < 6; k++) a[i * 6 + k] = r.c.getComponent(k % 3); continue; }
        r.vel[i * 3 + 1] -= 9 * dt;
        const x = (r.pts[i * 3] += r.vel[i * 3] * dt), y = (r.pts[i * 3 + 1] += r.vel[i * 3 + 1] * dt), z = (r.pts[i * 3 + 2] += r.vel[i * 3 + 2] * dt);
        a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z;
        a[i * 6 + 3] = x - r.vel[i * 3] * 0.03; a[i * 6 + 4] = y - r.vel[i * 3 + 1] * 0.03; a[i * 6 + 5] = z - r.vel[i * 3 + 2] * 0.03;
      }
      r.posE.needsUpdate = true;
      r.matE.opacity = 1 - uE;
    }
    if (r.anneauActif) {
      const uA = r.age / r.vieA;
      r.anneau.visible = uA < 1;
      if (uA < 1) {
        const s = 0.1 + (DEMI_ANNEAU_M - 0.1) * (1 - Math.pow(1 - uA, 2));
        const b = r.posA.array as Float32Array;
        const cx = r.c.x + r.nrm.x * 0.03, cy = r.c.y + r.nrm.y * 0.03, cz = r.c.z + r.nrm.z * 0.03;
        for (let i = 0; i < 4; i++) {
          const su = COINS[i * 2], sv = COINS[i * 2 + 1];
          b[i * 3] = cx + (r.u.x * su + r.v.x * sv) * s;
          b[i * 3 + 1] = cy + (r.u.y * su + r.v.y * sv) * s;
          b[i * 3 + 2] = cz + (r.u.z * su + r.v.z * sv) * s;
        }
        r.posA.needsUpdate = true;
        r.matA.opacity = 0.8 * (1 - uA);
      }
    }
    if (r.poussiereActive) {
      const uP = r.age / r.vieP;
      r.poussiere.visible = uP < 1;
      if (uP < 1) {
        // Les brins s'écartent vite puis ralentissent, s'allongent et s'estompent : une petite bouffée grise au pied de l'impact.
        const e = 1 - Math.pow(1 - uP, 2);
        const b = r.posP.array as Float32Array;
        for (let i = 0; i < POUSSIERES; i++) {
          const dx = r.dirsP[i * 3], dy = r.dirsP[i * 3 + 1], dz = r.dirsP[i * 3 + 2];
          const rayon = 0.08 + 0.5 * e, queue = rayon + 0.06 + 0.1 * e;
          b[i * 6] = r.c.x + dx * rayon; b[i * 6 + 1] = r.c.y + dy * rayon + 0.15 * uP; b[i * 6 + 2] = r.c.z + dz * rayon;
          b[i * 6 + 3] = r.c.x + dx * queue; b[i * 6 + 4] = r.c.y + dy * queue + 0.15 * uP; b[i * 6 + 5] = r.c.z + dz * queue;
        }
        r.posP.needsUpdate = true;
        r.matP.opacity = 0.6 * (1 - uP);
      }
    }
  }

  /** Impact immédiat (aucune traçante ne l'attend). */
  const lancerImpact = (c: THREE.Vector3, nrm: THREE.Vector3, couleur: number | string | THREE.Color) =>
    lancerRafale(c, nrm, couleur, ETINCELLES, 3.6, VIE_ETINCELLES_S, true);

  return {
    traçante(o, fin, arme) {
      const tr = tracantes[iTrac];
      iTrac = (iTrac + 1) % TRACANTES;
      const connue = typeof arme === "string" && Object.hasOwn(TRACEURS, arme);
      const params = connue ? TRACEURS[arme as ArmeFeuId] : PARAMS_TRACANTE_COULEUR;
      lirePt(o, tr.depart);
      lirePt(fin, tr.fin);
      const d: Vec3 = [tr.depart.x, tr.depart.y, tr.depart.z], f: Vec3 = [tr.fin.x, tr.fin.y, tr.fin.z];
      tr.params = params;
      tr.vie = dureeVie(d, f, params);
      tr.tImpact = instantImpact(d, f, params);
      tr.age = 0;
      tr.actif = true;
      tr.impactAttente = false;
      tr.tete.copy(tr.depart);
      tr.queue.copy(tr.depart);
      // Additif : la couleur de l'arme, un peu poussée pour que le bloom la capte.
      tr.mat.color.set(connue ? params.couleur : arme).multiplyScalar(1.4);
      tr.mat.opacity = 1;
      tr.ruban.visible = true;
    },
    impact(point, normale, couleur = COULEUR_IMPACT) {
      lirePt(point, _a);
      lirePt(normale, _n);
      if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
      _n.normalize();
      // Une traçante vient de partir vers ce point : l'impact attend l'arrivée visuelle de sa tête (les dégâts, eux, restent instantanés).
      for (let k = 1; k <= 24; k++) {
        const tr = tracantes[(iTrac - k + TRACANTES * 2) % TRACANTES];
        if (!tr.actif || tr.impactAttente || tr.age > AGE_APPARIEMENT_S || tr.tImpact <= 0) continue;
        if (tr.fin.distanceToSquared(_a) > RAYON_APPARIEMENT_M * RAYON_APPARIEMENT_M) continue;
        tr.impactAttente = true;
        tr.nrm.copy(_n);
        tr.couleurImpact.set(couleur);
        return;
      }
      lancerImpact(_a, _n, couleur);
    },
    eclaboussure(point, couleur) {
      lirePt(point, _a);
      _n.set(0, 0.4, 0).normalize();
      lancerRafale(_a, _n, couleur, ETINCELLES, 3.6, 0.42, false);
    },
    maj(dt) {
      dt = borne(dt, 0, 0.1);
      for (const tr of tracantes) {
        if (!tr.actif) continue;
        tr.age += dt;
        const e = etatTraceur([tr.depart.x, tr.depart.y, tr.depart.z], [tr.fin.x, tr.fin.y, tr.fin.z], tr.params, tr.age);
        if (tr.impactAttente && e.arrive) {
          tr.impactAttente = false;
          lancerImpact(tr.fin, tr.nrm, tr.couleurImpact);
        }
        if (e.fini) {
          // Un impact encore attendu (image très longue) part quand même : on ne perd jamais l'impact d'un tir.
          if (tr.impactAttente) { tr.impactAttente = false; lancerImpact(tr.fin, tr.nrm, tr.couleurImpact); }
          tr.actif = false;
          tr.ruban.visible = false;
          continue;
        }
        tr.tete.set(e.tete[0], e.tete[1], e.tete[2]);
        tr.queue.set(e.queue[0], e.queue[1], e.queue[2]);
        tr.mat.opacity = e.alpha;
      }
      for (const r of rafales) if (r.actif) majRafale(r, dt);
    },
    dispose() {
      racine.removeFromParent();
      for (const g of geos) g.dispose();
      for (const x of mats) x.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Post-traitement (bloom de la vue aérienne)
// ---------------------------------------------------------------------------------------------

/** Le filtre de luminosité du bloom ignore un pixel d'alpha nul (cf. `sansHalo`), alpha borné à 1 (le mélange additif le dépasse). */
const FILTRE_HALO_D_ORIGINE = "gl_FragColor = mix( outputColor, texel, alpha );";
const FILTRE_HALO_SELECTIF = "gl_FragColor = mix( outputColor, texel, alpha * clamp( texel.a, 0.0, 1.0 ) );";

/**
 * Exclut un matériau OPAQUE du halo du bloom de l'arène (`creerPostTraitement`) : il écrit un alpha nul, que le filtre de luminosité
 * lit comme « pas de halo ». Sans effet sur sa couleur (la toile de l'arène n'a pas de canal alpha). Le matériau ne doit pas être
 * transparent : un mélange normal recalculerait l'alpha.
 */
export function sansHalo(m: THREE.Material): void {
  const avant = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    avant.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n\tgl_FragColor.a = 0.0;");
  };
  const cle = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${cle()}|sans-halo`;
}

/**
 * Compositeur RenderPass → bloom → OutputPass, réglé comme scene.ts. Un matériau qui écrit un alpha nul (opaque, donc sans mélange)
 * est exclu du halo : le tigre de l'arène, texture claire et pleine lumière, saturait l'écran en aplat jaune dès qu'il s'approchait de la
 * caméra (seuil de luminosité de 0,24). Tout le reste de la scène garde un alpha de 1 (fond effacé à 1, mélanges normal et additif).
 */
export function creerPostTraitement(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): PostTraitement {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.42, 0.24);
  const filtre = bloom.materialHighPassFilter;
  // filtre de three changé (mise à jour) : le halo redevient global, signalé en console plutôt que de casser l'arène
  if (filtre.fragmentShader.includes(FILTRE_HALO_D_ORIGINE)) {
    filtre.fragmentShader = filtre.fragmentShader.replace(FILTRE_HALO_D_ORIGINE, FILTRE_HALO_SELECTIF);
    filtre.needsUpdate = true;
  } else console.warn("arène : filtre de luminosité du bloom inattendu, halo du tigre non exclu");
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    composer,
    bloom,
    redimensionner(w, h) { composer.setSize(w, h); },
    rendre() { composer.render(); },
    dispose() { bloom.dispose(); composer.dispose(); },
  };
}
