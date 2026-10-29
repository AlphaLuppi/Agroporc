/**
 * Rendu des tigres de l'arène et de l'avion qui les largue (three). Aucun test vitest (three) : les régressions se voient aux captures.
 * Spec : docs/superpowers/specs/2026-10-23-arene-tigres-design.md (Rendu, Avion et largage, Sort d'invocation)
 *
 *  - Tigres : le GLB du thème Tigre (`chargerModele` de lib/tigre3d/modele.ts, cache PARTAGÉ avec le thème Tigre et la chasse de la vue
 *    Palantir), un clone par tigre, texture gardée telle quelle (pas d'assombrissement) et exclue du halo du bloom (`sansHalo` de
 *    rendu.ts) : sa fourrure claire saturait l'écran en aplat jaune au contact. Clips du GLB lus dans le registre de lib/tigre3d/clips.ts :
 *    « Walking » pour la marche (vitesse de lecture proportionnelle à la vitesse mesurée), « Attack jump » pour le bond annoncé puis le
 *    bond (et, raccourci, pour le coup de patte), « Curious » pour l'alerte, pose tapie (`poseTapie` de lib/agroparc3d/tigre.ts) dans la
 *    cachette. Au-delà de ce que « Walking » suit sans glisser, le galop du moteur du corps, pieds plantés (`course-tigre.ts`). Chaque
 *    image, la pose courante rejoint la pose visée par un ressort : les changements de clip se font sans cassure.
 *  - Tigre allié : liseré de la couleur du lanceur, une coque inversée (maillage animé par le même squelette, faces arrière, sommets
 *    poussés le long de la normale) qui dessine le contour du tigre, et qui seule garde le halo. La couleur ne suffit pas (un lanceur
 *    orange sur une fourrure orange) : une plaque « Tigre · pseudo du lanceur », au style des pseudos des joueurs, flotte au-dessus.
 *  - Avion : silhouette en fil de fer de l'avion de la vue aérienne (lib/agroparc3d/scene.ts), feux de position. Parachute : voilure et
 *    suspentes en fil de fer au-dessus du tigre en descente. Ces formes vivent dans `rendu-avion.ts`, aussi utilisé par le Battle Royale.
 *  - Tant que le GLB n'est pas chargé (ou s'il ne se charge pas), un tigre est dessiné en silhouette fil de fer à la taille de sa hitbox.
 *
 * Ressources : ce module ne libère JAMAIS le modèle partagé (`libererModele`). Comme lib/agroparc3d/tigre.ts, il dessine des COPIES de la
 * géométrie, du matériau et de la texture du modèle (un renderer qui dessine un objet y attache un écouteur « dispose » qui retient son
 * contexte WebGL : sur les objets partagés, jamais libérés, chaque arène laisserait un contexte retenu). Les copies, les squelettes des
 * clones et tout ce que ce module crée sont libérés par `dispose()`. L'ombre portée de `creerTigre` (texture partagée du module modele.ts)
 * est masquée, donc jamais dessinée.
 *
 * Repère de protocole.ts : x est, z sud, y haut, cap en convention lacet (0 = vers −z, avant = (−sin cap, −cos cap)). Le museau du modèle
 * est vers +z : `rotation.y = cap + π`. L'avion de la vue aérienne a le nez vers +x : `rotation.y = cap + π/2`.
 */
import * as THREE from "three";
import { poseTapie } from "../agroparc3d/tigre";
import { clipNomme, dureeClip, echantillonnerClip } from "../tigre3d/clips";
import type { PoseGeste } from "../tigre3d/gestes/types";
import { chargerModele, creerTigre, type ModeleTigre, type Tigre as Tigre3D } from "../tigre3d/modele";
import type { Role } from "../tigre3d/os";
import { nouvellePose, squelette, type PoseTigre } from "../tigre3d/squelette";
import { ECHELLE_MODELE } from "../tigre3d/troupe";
import type { Corps } from "../tigre3d/corps";
import { avancerCourse, creerCourse } from "./course-tigre";
import type { AvionClient, TigreClient } from "./jeu-tigres";
import type { Vec3 } from "./protocole";
import { sansHalo, texturePseudo } from "./rendu";
import { PARACHUTE, aretes, balancementVoile, creerAvionFilDeFer, geometriesParachute } from "./rendu-avion";
import { SILHOUETTES_TIGRE, TIGRE } from "./tigre-arene";
import { hauteurPlaquePx } from "./visibilite";

export interface RenduTigres {
  /**
   * Tigres à dessiner (interpolés) et avion en cours, à l'horloge serveur `tsServeur` (ms), `dt` en s. `couleurDe` et `pseudoDe` donnent
   * la couleur et le pseudo du lanceur d'un tigre allié. `visible` faux (rejeu de la killcam) cache tout : rien du présent ne se superpose
   * au passé.
   */
  maj(
    tigres: ReadonlyMap<string, TigreClient>, avion: AvionClient | null, tsServeur: number, dt: number,
    couleurDe: (id: string) => string, pseudoDe: (id: string) => string, visible: boolean,
  ): void;
  /** Le tigre `id` vient de mourir : il s'effondre sur place puis disparaît. */
  mourir(id: string): void;
  /** Bouffée de fumée (apparition du tigre allié). */
  fumee(p: Vec3): void;
  /** Le GLB est-il chargé ? (tests et captures) */
  modeleCharge(): boolean;
  /**
   * Mesures du tigre dessiné (crochet de test, calcul coûteux à la demande) : boîte englobante du maillage animé au monde, positions monde
   * de la tête (os `tete` et bout du museau) et de la croupe. Null si le tigre n'est pas dessiné avec le GLB.
   */
  mesures(id: string): { min: Vec3; max: Vec3; tete: Vec3; museau: Vec3; croupe: Vec3 } | null;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

/**
 * Échelle du modèle (1,104 m du museau au bout de la queue) : celle du thème Tigre, 3,75 m queue comprise, soit environ 2,5 m du museau
 * à la croupe (`SILHOUETTES_TIGRE` de tigre-arene.ts, hitbox de 2,7 m tête comprise).
 */
const ECHELLE = ECHELLE_MODELE;
/** Vitesse au sol (m/s du monde) du clip « Walking » lu à vitesse normale, à cette échelle. */
const VITESSE_CLIP_MARCHE = 1.6;
/** Vitesse de lecture maximale de la marche (au-delà, les pattes deviennent illisibles en course à 10,5 m/s). */
const LECTURE_MAX = 4.5;
/**
 * Galop du moteur du corps (`course-tigre.ts`) : au-dessus de `entre` m/s, et jusqu'à ce que la vitesse redescende sous `quitte` (pas de
 * va-et-vient autour du seuil). « Walking » lu à `LECTURE_MAX` suit le sol jusqu'à 7,2 m/s, le moteur prend le relais avant.
 */
const GALOP = { entre: 6, quitte: 5 };
/** Sous cette vitesse (m/s), le tigre est arrêté. */
const ARRET_M_S = 0.4;
/**
 * Raideur (1/s) du ressort qui mène la pose courante vers la pose visée, et durée (s) du fondu après un changement de source de pose
 * (clip ou moteur du galop) : le ressort ne sert qu'au fondu, puis la pose visée est suivie exactement. Un ressort permanent (83 ms de
 * retard) amortirait de 40 % une foulée de 2 à 3 Hz et la déphaserait : les pieds glisseraient au sol.
 */
const RAIDEUR_POSE = 12;
const FONDU_S = 0.3;
/** Plage du clip « Attack jump » (s du clip) : élan (bond annoncé), vol (bond), et durée de vol visée (s) d'un bond de 6 à 10 m à 18 m/s. */
const SAUT = { elanFin: 0.62, volFin: 1.95, dureeVol: 0.5 };
/** Coup de patte : le début du vol d'« Attack jump », joué pendant l'armement du coup. */
const PATTE = { debut: 0.3, fin: 0.95, dureeS: TIGRE.patte.armeMs / 1000 };
/**
 * Lecture de « Curious » à l'alerte (s du clip, accéléré comme le regard du thème Tigre) : seulement la tête, le cou et les oreilles, posés
 * sur le tigre debout (le clip entier l'assoit, tête à 2,5 m, loin de sa silhouette de touche).
 */
const CURIEUX = { debut: 1.4, vitesse: 1.75, os: ["cou", "tete", "machoire", "oreilleG", "oreilleD", "oreille_boutG", "oreille_boutD"] as readonly Role[] };
/** Liseré du tigre allié : épaisseur (m du modèle, environ 8 cm au monde). */
const EPAISSEUR_LISERE = 0.025;
/**
 * Plaque du tigre allié : hauteur de son ancre au-dessus des pieds (m, au-dessus de la tête debout), ancre au BAS de la plaque, relevée de
 * `releve` fois sa hauteur, et texte. Celle d'un joueur est CENTRÉE sur son ancre (`Y_PSEUDO` de rendu.ts, 2,5 m debout, la même que celle du tigre) : à toute distance,
 * la plaque du tigre reste au-dessus de celle de son lanceur quand l'un passe derrière l'autre (même hauteur à l'écran, elles se masquaient).
 */
const PLAQUE = { y: 2.5, releve: 0.6, texte: (pseudo: string) => `Tigre · ${pseudo}` };
/** Mort : bascule sur le flanc en 0,6 s, reste 0,9 s, disparaît. */
const MORT = { basculeS: 0.6, finS: 1.5 };
const COULEUR_REPLI = 0xffa040;
/** Fumée de l'apparition du tigre allié. */
const FUMEE = { dureeS: 0.8, rayon: 1.6, couleur: 0xc8d2dc };

const sq = squelette();

// ---------------------------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------------------------

/** Pose complète depuis une image de clip : le repos, puis les rotations et translations locales que l'image porte. */
function poseDepuisImage(img: PoseGeste, sortie: PoseTigre): PoseTigre {
  for (let k = 0; k < sq.n; k++) {
    sortie.q[k].copy(sq.qRepos[k]);
    sortie.t[k].copy(sq.tRepos[k]);
  }
  if (img.os) {
    for (const [r, q] of Object.entries(img.os) as [Role, readonly number[]][]) {
      const k = sq.i[r];
      if (k !== undefined && q) sortie.q[k].set(q[0], q[1], q[2], q[3]);
    }
  }
  if (img.t) {
    for (const [r, t] of Object.entries(img.t) as [Role, readonly number[]][]) {
      const k = sq.i[r];
      if (k !== undefined && t) sortie.t[k].set(t[0], t[1], t[2]);
    }
  }
  return sortie;
}

/** Rapproche `courante` de `cible` (slerp et lerp de facteur `k`). */
function rapprocher(courante: PoseTigre, cible: PoseTigre, k: number): void {
  for (let i = 0; i < courante.q.length; i++) {
    courante.q[i].slerp(cible.q[i], k);
    courante.t[i].lerp(cible.t[i], k);
  }
}

let tapieCache: { pose: PoseTigre; x: number } | null = null;
/** Pose tapie (moteur du corps à l'arrêt), calculée une fois pour toutes les arènes de la page. */
function tapie(): { pose: PoseTigre; x: number } {
  return (tapieCache ??= poseTapie());
}

// ---------------------------------------------------------------------------------------------
// Fil de fer : silhouette de repli (l'avion et le parachute sont dans rendu-avion.ts)
// ---------------------------------------------------------------------------------------------

/** Silhouette de repli (GLB absent) : la hitbox debout en fil de fer, museau vers +z comme le modèle. */
function geometrieRepli(): THREE.BufferGeometry {
  const s = SILHOUETTES_TIGRE.debout;
  const corps = new THREE.CapsuleGeometry(s.corps.rayon, s.corps.demiLongueur * 2, 3, 8);
  corps.rotateX(Math.PI / 2);
  corps.translate(0, s.corps.y, 0);
  const tete = new THREE.IcosahedronGeometry(s.tete.rayon, 1);
  tete.translate(0, s.tete.y, s.tete.avance);
  const ec = aretes(corps, 20), et = aretes(tete, 20);
  const pos = [...(ec.getAttribute("position").array as Float32Array), ...(et.getAttribute("position").array as Float32Array)];
  ec.dispose();
  et.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------------------------

interface Instance {
  id: string;
  /** groupe posé au monde (position des pieds, cap) */
  racine: THREE.Group;
  /** clone du GLB (null tant que le modèle n'est pas chargé) */
  t3d: Tigre3D | null;
  squelettes: THREE.Skeleton[];
  /** coque du liseré (tigre allié) */
  contours: THREE.SkinnedMesh[];
  couleurLisere: string | null;
  repli: THREE.LineSegments;
  parachute: THREE.Group | null;
  /** plaque du tigre allié (null pour un sauvage) et la clé de sa texture (`couleur|pseudo`) */
  plaque: THREE.Sprite | null;
  clePlaque: string | null;
  /** moteur du corps du galop (créé au premier galop) et galop en cours */
  corps: Corps | null;
  galop: boolean;
  /** source de la pose visée (clip ou moteur, cf. `viser`) et temps écoulé depuis qu'elle a changé (s) */
  source: string;
  sourceS: number;
  pose: PoseTigre;
  cible: PoseTigre;
  origineX: number;
  /** la pose courante a déjà été posée (sinon elle part de la pose visée, sans ressort depuis le repos) */
  posee: boolean;
  /** phase de lecture de « Walking » (s du clip) */
  phaseMarche: number;
  /** instant (s, horloge du rendu) de l'entrée en alerte, null hors alerte */
  alerteT: number | null;
  /** temps depuis la mort (s), null vivant */
  mortS: number | null;
  vu: boolean;
}

export function creerRenduTigres(scene: THREE.Scene): RenduTigres {
  const racine = new THREE.Group();
  racine.name = "tigres";
  scene.add(racine);
  let horloge = 0;
  let detruit = false;
  let modele: ModeleTigre | null = null;

  /** copies du modèle partagé, propres à cette arène (cf. en-tête), clé = objet d'origine */
  const copies = new Map<object, THREE.Material | THREE.BufferGeometry | THREE.Texture>();
  const materiauxLisere = new Map<string, THREE.MeshBasicMaterial>();
  /** textures des plaques des tigres alliés, clé `couleur|pseudo` */
  const plaques = new Map<string, { mat: THREE.SpriteMaterial; ratio: number }>();
  const instances = new Map<string, Instance>();
  const mourants: Instance[] = [];

  // ---- avion (rendu-avion.ts) ----
  const avion = creerAvionFilDeFer();
  racine.add(avion.groupe);

  // ---- parachute, repli, fumée : géométries partagées par les instances ----
  const geoPara = geometriesParachute();
  const matPara = new THREE.LineBasicMaterial({ color: PARACHUTE.couleur, transparent: true, opacity: 0.9 });
  const matSuspentes = new THREE.LineBasicMaterial({ color: PARACHUTE.couleur, transparent: true, opacity: 0.55 });
  const geoRepli = geometrieRepli();
  const matRepli = new THREE.LineBasicMaterial({ color: COULEUR_REPLI, transparent: true, opacity: 0.95 });
  const geoFumee = aretes(new THREE.IcosahedronGeometry(1, 1), 1);
  const fumees: { obj: THREE.LineSegments; mat: THREE.LineBasicMaterial; t: number }[] = [];

  chargerModele().then((m) => {
    if (detruit) return;
    modele = m;
    for (const inst of instances.values()) habiller(inst);
  }).catch(() => { /* GLB indisponible : les tigres restent en silhouette de repli */ });

  /** Copie (unique pour cette arène) d'un matériau ou d'une géométrie du modèle partagé, texture du matériau comprise. */
  function copie<T extends THREE.Material | THREE.BufferGeometry>(orig: T): T {
    let c = copies.get(orig) as T | undefined;
    if (!c) {
      c = orig.clone() as T;
      // fourrure : texture intacte, mais hors du halo du bloom (cf. en-tête)
      if ((c as unknown as THREE.Material).isMaterial) sansHalo(c as unknown as THREE.Material);
      const map = (orig as unknown as THREE.MeshBasicMaterial).map;
      if (map) {
        let mc = copies.get(map) as THREE.Texture | undefined;
        if (!mc) { mc = map.clone(); copies.set(map, mc); }
        (c as unknown as THREE.MeshBasicMaterial).map = mc;
      }
      copies.set(orig, c);
    }
    return c;
  }

  function materiauLisere(couleur: string): THREE.MeshBasicMaterial {
    let m = materiauxLisere.get(couleur);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: couleur, side: THREE.BackSide, toneMapped: false });
      // coque inversée : chaque sommet est poussé le long de sa normale (repère de liaison, avant le skinning)
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\ntransformed += normalize( normal ) * ${EPAISSEUR_LISERE.toFixed(4)};`,
        );
      };
      m.customProgramCacheKey = () => "tigre-lisere";
      materiauxLisere.set(couleur, m);
    }
    return m;
  }

  /** Clone du GLB pour une instance (dès que le modèle est là) : la silhouette de repli disparaît. */
  function habiller(inst: Instance): void {
    if (!modele || inst.t3d) return;
    const t = creerTigre(modele);
    t.groupe.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.material = copie(mesh.material as THREE.Material);
      mesh.geometry = copie(mesh.geometry);
      inst.squelettes.push(mesh.skeleton);
    });
    // ombre portée masquée : sa texture est partagée par le module modele.ts (cf. en-tête)
    t.ombre.visible = false;
    t.groupe.scale.setScalar(ECHELLE);
    inst.racine.add(t.groupe);
    inst.t3d = t;
    inst.repli.visible = false;
  }

  /** Liseré de la couleur du lanceur (tigre allié) : une coque par maillage animé, liée au même squelette. */
  function lisere(inst: Instance, couleur: string | null): void {
    if (!inst.t3d || inst.couleurLisere === couleur) return;
    inst.couleurLisere = couleur;
    if (!couleur) {
      for (const c of inst.contours) c.removeFromParent();
      inst.contours = [];
      return;
    }
    const mat = materiauLisere(couleur);
    if (inst.contours.length) {
      for (const c of inst.contours) c.material = mat;
      return;
    }
    const maillages: THREE.SkinnedMesh[] = [];
    inst.t3d.groupe.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) maillages.push(o as THREE.SkinnedMesh); });
    for (const m of maillages) {
      const c = new THREE.SkinnedMesh(m.geometry, mat);
      c.bind(m.skeleton, m.bindMatrix);
      c.frustumCulled = false;
      c.position.copy(m.position);
      c.quaternion.copy(m.quaternion);
      c.scale.copy(m.scale);
      m.parent?.add(c);
      inst.contours.push(c);
    }
  }

  function materiauPlaque(couleur: string, pseudo: string): { mat: THREE.SpriteMaterial; ratio: number } {
    const cle = `${couleur}|${pseudo}`;
    let p = plaques.get(cle);
    if (!p) {
      const { tex, ratio } = texturePseudo(PLAQUE.texte(pseudo), new THREE.Color(couleur));
      p = { mat: new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, toneMapped: false }), ratio };
      plaques.set(cle, p);
    }
    return p;
  }

  /**
   * Plaque « Tigre · pseudo » du tigre allié, de la couleur du lanceur : masquée par les bâtiments, de hauteur écran réglée par la distance
   * comme celle des joueurs (`hauteurPlaquePx`). Retirée pour un sauvage.
   */
  function plaque(inst: Instance, couleur: string | null, pseudo: string): void {
    const cle = couleur ? `${couleur}|${pseudo}` : null;
    if (inst.clePlaque === cle) return;
    inst.clePlaque = cle;
    if (!couleur) {
      inst.plaque?.removeFromParent();
      inst.plaque = null;
      return;
    }
    const { mat, ratio } = materiauPlaque(couleur, pseudo);
    if (!inst.plaque) {
      const s = new THREE.Sprite(mat);
      s.position.y = PLAQUE.y;
      s.center.set(0.5, -PLAQUE.releve);
      s.renderOrder = 10;
      s.frustumCulled = false;
      const pw = new THREE.Vector3(), pc = new THREE.Vector3();
      s.onBeforeRender = (renderer, _scene, camera) => {
        const cam = camera as THREE.PerspectiveCamera;
        s.getWorldPosition(pw);
        pc.setFromMatrixPosition(cam.matrixWorld);
        const d = Math.max(pw.distanceTo(pc), 0.5);
        const hPx = (renderer.domElement as HTMLCanvasElement).clientHeight || 800;
        const h = (hauteurPlaquePx(d) / hPx) * 2 * d * Math.tan(((cam.fov || 90) * Math.PI) / 360);
        s.scale.set(h * (s.userData.ratio as number), h, 1);
        s.updateMatrixWorld();
      };
      inst.racine.add(s);
      inst.plaque = s;
    }
    inst.plaque.material = mat;
    inst.plaque.userData.ratio = ratio;
  }

  function creerInstance(t: TigreClient): Instance {
    const r = new THREE.Group();
    racine.add(r);
    const repli = new THREE.LineSegments(geoRepli, matRepli);
    repli.frustumCulled = false;
    r.add(repli);
    const inst: Instance = {
      id: t.id, racine: r, t3d: null, squelettes: [], contours: [], couleurLisere: null, repli, parachute: null, plaque: null, clePlaque: null,
      corps: null, galop: false, source: "", sourceS: 0,
      pose: nouvellePose(sq), cible: nouvellePose(sq), origineX: 0, posee: false, phaseMarche: Math.random() * 2, alerteT: null,
      mortS: null, vu: true,
    };
    instances.set(t.id, inst);
    habiller(inst);
    return inst;
  }

  function libererInstance(inst: Instance): void {
    inst.racine.removeFromParent();
    for (const c of inst.contours) c.removeFromParent();
    inst.contours = [];
    inst.t3d?.dispose();
    for (const s of inst.squelettes) s.dispose();
    inst.squelettes = [];
    inst.t3d = null;
  }

  /**
   * Pose visée d'un tigre vivant à cet instant, l'abscisse du corps à ramener à l'origine (cf. `Tigre.appliquer`) et la source de la pose
   * (clip ou moteur) : un changement de source ouvre un fondu (`FONDU_S`).
   */
  function viser(inst: Instance, t: TigreClient, tsServeur: number, dt: number): { pose: PoseTigre; x: number; source: string } {
    const depuisAction = t.action && t.actionT !== undefined ? Math.max(0, (tsServeur - t.actionT) / 1000) : 0;
    const saut = clipNomme("Attack jump");
    if (saut && (t.action === "ramasse" || t.action === "bond" || t.action === "patte")) {
      let u: number;
      if (t.action === "ramasse") u = Math.min(SAUT.elanFin, depuisAction * (SAUT.elanFin / (TIGRE.bond.annonceMs / 1000)));
      else if (t.action === "bond") u = Math.min(dureeClip(saut), SAUT.elanFin + depuisAction * ((SAUT.volFin - SAUT.elanFin) / SAUT.dureeVol));
      else u = PATTE.debut + (PATTE.fin - PATTE.debut) * Math.min(1, depuisAction / PATTE.dureeS);
      return { pose: poseDepuisImage(echantillonnerClip(saut, u), inst.cible), x: 0, source: "saut" };
    }
    const marche = clipNomme("Walking");
    if (t.etat === "alerte") {
      inst.alerteT ??= horloge;
      const curieux = clipNomme("Curious");
      if (curieux && marche) {
        poseDepuisImage(echantillonnerClip(marche, inst.phaseMarche, true), inst.cible);
        const img = echantillonnerClip(curieux, CURIEUX.debut + (horloge - inst.alerteT) * CURIEUX.vitesse, true);
        for (const r of CURIEUX.os) {
          const q = img.os?.[r];
          if (q) inst.cible.q[sq.i[r]].set(q[0], q[1], q[2], q[3]);
        }
        return { pose: inst.cible, x: 0, source: "alerte" };
      }
    } else inst.alerteT = null;
    if (((t.etat === "tapi" || t.etat === "repos") && t.v < ARRET_M_S) || !marche) return { ...tapie(), source: "tapie" };
    if (t.etat === "descente") return { pose: poseDepuisImage(echantillonnerClip(marche, 0), inst.cible), x: 0, source: "descente" };
    // course : galop du moteur du corps, pieds plantés (sa vitesse est celle du tigre dessiné)
    inst.galop = t.v > (inst.galop ? GALOP.quitte : GALOP.entre);
    if (inst.galop) {
      inst.corps ??= creerCourse();
      return { pose: avancerCourse(inst.corps, t.v, dt, inst.cible), x: 0, source: "galop" };
    }
    // vitesse de lecture proportionnelle à la vitesse au sol, arrêté la marche se fige sur l'image courante
    const lecture = t.v < ARRET_M_S ? 0 : Math.min(LECTURE_MAX, t.v / VITESSE_CLIP_MARCHE);
    inst.phaseMarche = (inst.phaseMarche + dt * lecture) % Math.max(0.001, dureeClip(marche));
    return { pose: poseDepuisImage(echantillonnerClip(marche, inst.phaseMarche, true), inst.cible), x: 0, source: "marche" };
  }

  function parachute(inst: Instance, descente: boolean): void {
    if (!descente) {
      if (inst.parachute) inst.parachute.visible = false;
      return;
    }
    if (!inst.parachute) {
      const g = new THREE.Group();
      const v = new THREE.LineSegments(geoPara.voilure, matPara);
      const s = new THREE.LineSegments(geoPara.suspentes, matSuspentes);
      v.frustumCulled = false;
      s.frustumCulled = false;
      g.add(v, s);
      g.position.y = PARACHUTE.attache;
      inst.racine.add(g);
      inst.parachute = g;
    }
    inst.parachute.visible = true;
    // la voilure se balance doucement
    const b = balancementVoile(horloge);
    inst.parachute.rotation.z = b.z;
    inst.parachute.rotation.x = b.x;
  }

  return {
    maj(tigres, av, tsServeur, dt, couleurDe, pseudoDe, visible) {
      horloge += dt;
      racine.visible = visible;

      if (av) avion.poser(av.p, av.cap, horloge);
      else avion.masquer();

      for (const inst of instances.values()) inst.vu = false;
      const ressort = 1 - Math.exp(-RAIDEUR_POSE * dt);
      for (const t of tigres.values()) {
        const inst = instances.get(t.id) ?? creerInstance(t);
        inst.vu = true;
        inst.racine.position.set(t.p[0], t.p[1], t.p[2]);
        inst.racine.rotation.set(0, t.cap + Math.PI, 0);
        parachute(inst, t.etat === "descente");
        const lanceur = t.genre === "allie" && t.lanceur ? t.lanceur : null;
        lisere(inst, lanceur ? couleurDe(lanceur) : null);
        plaque(inst, lanceur ? couleurDe(lanceur) : null, lanceur ? pseudoDe(lanceur) : "");
        if (!inst.t3d) continue;
        const v = viser(inst, t, tsServeur, dt);
        if (!inst.posee) {
          for (let i = 0; i < inst.pose.q.length; i++) { inst.pose.q[i].copy(v.pose.q[i]); inst.pose.t[i].copy(v.pose.t[i]); }
          inst.origineX = v.x;
          inst.source = v.source;
          inst.posee = true;
        } else {
          // ressort pendant le fondu qui suit un changement de source, puis pose visée suivie exactement (pieds plantés du galop)
          if (v.source !== inst.source) { inst.source = v.source; inst.sourceS = 0; } else inst.sourceS += dt;
          const k = inst.sourceS >= FONDU_S ? 1 : Math.max(ressort, inst.sourceS / FONDU_S);
          rapprocher(inst.pose, v.pose, k);
          inst.origineX += (v.x - inst.origineX) * k;
        }
        inst.t3d.appliquer(inst.pose, inst.origineX);
      }
      // tigres disparus du snap sans `mourir` (départ, fin de match) : retirés
      for (const inst of [...instances.values()]) {
        if (inst.vu) continue;
        instances.delete(inst.id);
        libererInstance(inst);
      }

      // tigres morts : ils basculent sur le flanc, puis disparaissent
      for (let i = mourants.length - 1; i >= 0; i--) {
        const inst = mourants[i];
        inst.mortS = (inst.mortS ?? 0) + dt;
        const u = Math.min(1, inst.mortS / MORT.basculeS);
        inst.racine.rotation.z = (Math.PI / 2) * u * u;
        if (inst.parachute) inst.parachute.visible = false;
        if (inst.mortS >= MORT.finS) {
          mourants.splice(i, 1);
          libererInstance(inst);
        }
      }

      for (let i = fumees.length - 1; i >= 0; i--) {
        const f = fumees[i];
        f.t += dt;
        const u = Math.max(0, f.t) / FUMEE.dureeS;
        f.obj.scale.setScalar(FUMEE.rayon * (0.4 + u));
        f.obj.rotation.y += dt * 1.5;
        f.mat.opacity = Math.max(0, 0.8 * (1 - u));
        if (u >= 1) {
          f.obj.removeFromParent();
          f.mat.dispose();
          fumees.splice(i, 1);
        }
      }
    },

    mourir(id) {
      const inst = instances.get(id);
      if (!inst) return;
      instances.delete(id);
      inst.mortS = 0;
      if (inst.plaque) inst.plaque.visible = false;
      mourants.push(inst);
    },

    fumee(p) {
      for (let i = 0; i < 3; i++) {
        const mat = new THREE.LineBasicMaterial({ color: FUMEE.couleur, transparent: true, opacity: 0.8, depthWrite: false });
        const obj = new THREE.LineSegments(geoFumee, mat);
        obj.position.set(p[0] + (i - 1) * 0.6, p[1] + 0.8 + i * 0.3, p[2] + (i % 2) * 0.5);
        obj.frustumCulled = false;
        racine.add(obj);
        fumees.push({ obj, mat, t: -i * 0.08 });
      }
    },

    modeleCharge: () => modele !== null,

    mesures(id) {
      const inst = instances.get(id);
      if (!inst?.t3d) return null;
      inst.racine.updateWorldMatrix(true, true);
      const boite = new THREE.Box3();
      inst.t3d.groupe.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh || inst.contours.includes(m)) return;
        m.computeBoundingBox();
        if (m.boundingBox) boite.union(m.boundingBox.clone().applyMatrix4(m.matrixWorld));
      });
      const monde = (r: Role): Vec3 => {
        const v = inst.t3d!.os[sq.i[r]].getWorldPosition(new THREE.Vector3());
        return [v.x, v.y, v.z];
      };
      return { min: [boite.min.x, boite.min.y, boite.min.z], max: [boite.max.x, boite.max.y, boite.max.z], tete: monde("tete"), museau: monde("bout_tete"), croupe: monde("queue1") };
    },

    dispose() {
      detruit = true;
      racine.removeFromParent();
      for (const inst of instances.values()) libererInstance(inst);
      instances.clear();
      for (const inst of mourants) libererInstance(inst);
      mourants.length = 0;
      for (const f of fumees) f.mat.dispose();
      fumees.length = 0;
      for (const c of copies.values()) c.dispose();
      copies.clear();
      for (const m of materiauxLisere.values()) m.dispose();
      materiauxLisere.clear();
      for (const p of plaques.values()) { p.mat.map?.dispose(); p.mat.dispose(); }
      plaques.clear();
      avion.dispose();
      for (const x of [geoPara.voilure, geoPara.suspentes, matPara, matSuspentes, geoRepli, matRepli, geoFumee]) x.dispose();
    },
  };
}
