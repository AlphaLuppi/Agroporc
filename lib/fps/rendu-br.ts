/**
 * Rendu du Battle Royale (three) : avion en fil de fer, objets du butin, mur de la tempête et anneau de la prochaine zone. Le parachute des
 * avatars est dessiné par `creerAvatar` (rendu.ts) d'après `etat.chute`. Aucun test vitest du rendu lui-même (WebGL) : tout calcul est dans
 * `rendu-br-modele.ts` (PUR, testé) et les régressions se voient aux captures ; `rendu-br.test.ts` vérifie seulement ce que three permet
 * sans contexte WebGL (réutilisation des objets, libération).
 *
 *  - Avion : celui des tigres largués (`rendu-avion.ts`), à la position de `positionAvionBr`.
 *  - Butin : pool INDEXÉ PAR ID (modèle `majBonus` de rendu-objets-zombies.ts), jamais de `group.clear()` ni de géométrie recréée par image.
 *    Seuls les objets à moins de 60 m de l'œil (`objetsVisibles`) sont dessinés : une colonne de lumière et un halo au sol, instanciés
 *    (`InstancedMesh`, un seul appel de dessin chacun quelle que soit la quantité), de la couleur de la rareté ; les plus proches ont aussi
 *    leur modèle (arme de `creerModeleArmeMonde`, boîte de munitions, bandage, flacon), créé en entrant dans la portée et libéré en sortant.
 *    Les halos additifs passent par le bloom de l'arène : ils brillent.
 *  - Tempête : un cylindre ouvert d'UNE seule géométrie dont seule l'échelle varie avec le rayon de la zone, additif, sans halo (`sansHalo`,
 *    il est immense) ni écriture de profondeur ; un rideau bas et un cercle blanc au sol marquent la prochaine zone.
 *
 * Ressources : la géométrie unité, les matériaux et les modèles créés ici sont libérés par `dispose()`.
 *
 * Repère de protocole.ts : x est, z sud, y haut.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (§Rendu)
 */
import * as THREE from "three";
import { capAvionBr, positionAvionBr } from "./br-chute";
import type { ArmeId, AvionBr, ObjetBr, Vec3, ZoneBr } from "./protocole";
import { creerModeleArmeMonde, sansHalo } from "./rendu";
import { aretes, creerAvionFilDeFer } from "./rendu-avion";
import {
  BUTIN_RENDU, HAUTEUR_COLONNE, MUR_TEMPETE, anneauProchaineZone, avionVisible, cercleZone, couleurObjet, defilementMur, echelleMur,
  echelleQuantite, flotteObjet, intensiteMur, objetsVisibles, rareteObjet,
} from "./rendu-br-modele";

/** Ce que le rendu lit à chaque image. */
export interface EntreeRenduBr {
  /** horloge serveur (ms), pour l'avion et la zone */
  tsServeur: number;
  /** position de l'œil (caméra) : portée du butin, intensité du mur */
  oeil: Vec3;
  avion: AvionBr | null;
  zone: ZoneBr | null;
  /** objets au sol (`ButinClient.pourDessin()`) */
  butin: Iterable<ObjetBr>;
  /** faux (rejeu de la killcam) : tout est caché, rien du présent ne se superpose au passé */
  visible: boolean;
}

export interface RenduBr {
  maj(e: EntreeRenduBr, dt: number): void;
  /** Ce qui est dessiné à cette image (tests et captures). */
  etat(): { objets: number; modeles: number; avion: boolean; mur: { x: number; z: number; r: number } | null; anneau: { x: number; z: number; r: number } | null };
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Objets de butin
// ---------------------------------------------------------------------------------------------

const COULEUR_MUNITIONS = 0xffd479;
const COULEUR_BANDAGE = 0xf2f6fa;
const COULEUR_CROIX = 0xff6a5a;
const COULEUR_POTION = 0x6fd2ff;
/** Halo au sol d'un objet : rayon (m) du disque unité. */
const RAYON_HALO_M = 0.9;
/** Taille (m) d'un modèle d'arme posé : le modèle tenu en main est à l'échelle 1, on le pose un peu plus grand pour qu'il se lise à 10 m. */
const ECHELLE_ARME = 1.25;

interface ModeleObjet {
  groupe: THREE.Group;
  dispose(): void;
}

export function creerRenduBr(scene: THREE.Scene): RenduBr {
  const racine = new THREE.Group();
  racine.name = "br";
  scene.add(racine);
  let horloge = 0;
  const jetables: { dispose(): void }[] = [];
  const garder = <T extends { dispose(): void }>(x: T): T => { jetables.push(x); return x; };

  // ---- avion ----
  const avion = creerAvionFilDeFer();
  racine.add(avion.groupe);

  // ---- géométries et matériaux partagés des modèles de soins et de munitions ----
  const boite = (w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  };
  const geoMunitions = {
    legeres: garder(aretes(boite(0.3, 0.18, 0.2), 20)),
    moyennes: garder(aretes(boite(0.4, 0.22, 0.26), 20)),
    cartouches: garder(aretes(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 6), 20)),
  };
  const geoBandage = garder(aretes(boite(0.32, 0.12, 0.2), 20));
  const geoCroix = garder(aretes((() => {
    const a = boite(0.2, 0.01, 0.045, 0, 0.065, 0);
    const b = boite(0.045, 0.01, 0.2, 0, 0.065, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([...(a.getAttribute("position").array as Float32Array), ...(b.getAttribute("position").array as Float32Array)], 3));
    a.dispose(); b.dispose();
    return g;
  })(), 20));
  const geoFlacon = garder(aretes(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8), 20));
  const geoGoulot = garder(aretes(boite(0.06, 0.1, 0.06, 0, 0.16, 0), 20));
  const ligne = (hex: number) => garder(new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.95 }));
  const matMunitions = ligne(COULEUR_MUNITIONS), matBandage = ligne(COULEUR_BANDAGE), matCroix = ligne(COULEUR_CROIX), matPotion = ligne(COULEUR_POTION);

  /** Groupe d'un objet de butin : l'arme du registre, ou une petite forme en fil de fer pour les munitions et les soins. */
  function creerModele(o: ObjetBr): ModeleObjet {
    if (o.genre === "arme" && o.ref) {
      const m = creerModeleArmeMonde(o.ref as ArmeId, couleurObjet(o));
      m.group.scale.setScalar(ECHELLE_ARME);
      const groupe = new THREE.Group();
      groupe.add(m.group);
      return { groupe, dispose() { m.dispose(); groupe.removeFromParent(); } };
    }
    const groupe = new THREE.Group();
    const ajout = (geo: THREE.BufferGeometry, mat: THREE.LineBasicMaterial, y = 0) => {
      const l = new THREE.LineSegments(geo, mat);
      l.position.y = y;
      l.frustumCulled = false;
      groupe.add(l);
    };
    if (o.genre === "munitions") ajout(geoMunitions[o.ref === "moyennes" ? "moyennes" : o.ref === "cartouches" ? "cartouches" : "legeres"], matMunitions);
    else if (o.genre === "bandage") { ajout(geoBandage, matBandage); ajout(geoCroix, matCroix); }
    else { ajout(geoFlacon, matPotion); ajout(geoGoulot, matPotion); }
    groupe.scale.setScalar(echelleQuantite(o.qte));
    return { groupe, dispose() { groupe.removeFromParent(); } };
  }

  // ---- colonnes de lumière et halos au sol, instanciés ----
  const geoColonne = garder(new THREE.CylinderGeometry(0.06, 0.28, 1, 8, 1, true));
  geoColonne.translate(0, 0.5, 0);
  const matColonne = garder(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const colonnes = garder(new THREE.InstancedMesh(geoColonne, matColonne, BUTIN_RENDU.capacite));
  const geoHalo = garder(new THREE.CircleGeometry(RAYON_HALO_M, 24));
  geoHalo.rotateX(-Math.PI / 2);
  const matHalo = garder(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const halos = garder(new THREE.InstancedMesh(geoHalo, matHalo, BUTIN_RENDU.capacite));
  for (const im of [colonnes, halos]) {
    im.count = 0;
    im.frustumCulled = false; // la boîte englobante serait celle d'une seule instance à l'origine
    im.renderOrder = 4;
    racine.add(im);
  }

  /** modèle de chaque objet proche, par id (jamais recréé tant que l'objet reste à portée) */
  const modeles = new Map<number, ModeleObjet>();
  /** ids dessinés à l'image précédente (hystérésis de la portée) et ceux de l'image courante, échangés à chaque image */
  let visiblesAvant = new Set<number>();
  let visiblesMaintenant = new Set<number>();
  const modelesVus = new Set<number>();
  const mat = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), ech = new THREE.Vector3(), couleur = new THREE.Color();
  let nbObjets = 0;

  function majButin(butin: Iterable<ObjetBr>, oeil: Vec3): void {
    const vis = objetsVisibles(butin, oeil, visiblesAvant);
    visiblesMaintenant.clear();
    modelesVus.clear();
    for (let i = 0; i < vis.length; i++) {
      const o = vis[i];
      visiblesMaintenant.add(o.id);
      const rarete = rareteObjet(o);
      couleur.setHex(couleurObjet(o));
      pos.set(o.p[0], o.p[1] + 0.02, o.p[2]);
      ech.set(1, HAUTEUR_COLONNE[rarete], 1);
      mat.compose(pos, quat, ech);
      colonnes.setMatrixAt(i, mat);
      colonnes.setColorAt(i, couleur);
      ech.set(1, 1, 1);
      mat.compose(pos, quat, ech);
      halos.setMatrixAt(i, mat);
      halos.setColorAt(i, couleur);
      if (i >= BUTIN_RENDU.modelesMax) continue;
      // modèle : créé en entrant dans les `modelesMax` plus proches, posé et tourné à chaque image
      modelesVus.add(o.id);
      let m = modeles.get(o.id);
      if (!m) {
        m = creerModele(o);
        racine.add(m.groupe);
        modeles.set(o.id, m);
      }
      m.groupe.position.set(o.p[0], o.p[1] + flotteObjet(horloge, o.id), o.p[2]);
      m.groupe.rotation.y = horloge * 1.1 + o.id * 0.9;
    }
    nbObjets = vis.length;
    colonnes.count = halos.count = nbObjets;
    colonnes.instanceMatrix.needsUpdate = halos.instanceMatrix.needsUpdate = true;
    if (colonnes.instanceColor) colonnes.instanceColor.needsUpdate = true;
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    for (const [id, m] of modeles) {
      if (modelesVus.has(id)) continue;
      m.dispose();
      modeles.delete(id);
    }
    [visiblesAvant, visiblesMaintenant] = [visiblesMaintenant, visiblesAvant];
  }

  // ---- tempête ----
  // Cylindre unité (rayon 1, hauteur 1, base à y = 0) ouvert : l'unique géométrie du mur ET du rideau de l'anneau.
  const geoCylindre = garder(new THREE.CylinderGeometry(1, 1, 1, MUR_TEMPETE.segments, 1, true));
  geoCylindre.translate(0, 0.5, 0);
  const texMur = texturePluie();
  if (texMur) garder(texMur);
  const [r0, g0, b0] = [(MUR_TEMPETE.couleur >> 16) & 255, (MUR_TEMPETE.couleur >> 8) & 255, MUR_TEMPETE.couleur & 255].map((x) => x / 255);
  // Additif « un plus un » dont l'intensité vit dans la couleur : `sansHalo` écrit un alpha nul, qui annulerait un facteur SRC_ALPHA. Le canal
  // alpha du tampon est lui aussi mis à zéro (le filtre du bloom lit « pas de halo »). `transparent` ne sert qu'à l'ordre de dessin.
  const matMur = garder(new THREE.MeshBasicMaterial({
    color: new THREE.Color(r0, g0, b0), map: texMur, side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.ZeroFactor,
  }));
  sansHalo(matMur);
  const mur = new THREE.Mesh(geoCylindre, matMur);
  mur.frustumCulled = false;
  mur.renderOrder = 6;
  mur.visible = false;
  racine.add(mur);

  const matRideau = garder(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const rideau = new THREE.Mesh(geoCylindre, matRideau);
  rideau.frustumCulled = false;
  rideau.renderOrder = 5;
  rideau.visible = false;
  racine.add(rideau);
  const geoCercle = garder((() => {
    const pts: number[] = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(Math.cos(a), 0, Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  })());
  const matCercle = garder(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
  const cercle = new THREE.LineLoop(geoCercle, matCercle);
  cercle.frustumCulled = false;
  cercle.renderOrder = 5;
  cercle.visible = false;
  racine.add(cercle);

  let murEtat: { x: number; z: number; r: number } | null = null;
  let anneauEtat: { x: number; z: number; r: number } | null = null;

  function majTempete(zone: ZoneBr | null, t: number, oeil: Vec3): void {
    const c = cercleZone(zone, t);
    if (!c) {
      mur.visible = rideau.visible = cercle.visible = false;
      murEtat = anneauEtat = null;
      return;
    }
    const e = echelleMur(c.rayon);
    mur.visible = true;
    mur.position.set(c.centre[0], MUR_TEMPETE.base, c.centre[1]);
    mur.scale.set(e[0], e[1], e[2]);
    murEtat = { x: c.centre[0], z: c.centre[1], r: c.rayon };
    const d = Math.hypot(oeil[0] - c.centre[0], oeil[2] - c.centre[1]) - c.rayon;
    const i = intensiteMur(d);
    matMur.color.setRGB(r0 * i, g0 * i, b0 * i);
    const df = defilementMur(horloge);
    texMur?.offset.set(df.u, df.v);

    const a = anneauProchaineZone(zone, t);
    if (!a) {
      rideau.visible = cercle.visible = false;
      anneauEtat = null;
      return;
    }
    const ea = echelleMur(a.rayon, MUR_TEMPETE.rideauM);
    rideau.visible = true;
    rideau.position.set(a.centre[0], 0, a.centre[1]);
    rideau.scale.set(ea[0], ea[1], ea[2]);
    cercle.visible = true;
    cercle.position.set(a.centre[0], 0.4, a.centre[1]);
    cercle.scale.set(ea[0], 1, ea[2]);
    anneauEtat = { x: a.centre[0], z: a.centre[1], r: a.rayon };
  }

  return {
    maj(e, dt) {
      horloge += Math.min(Math.max(dt, 0), 0.1);
      racine.visible = e.visible;
      if (!e.visible) return;
      if (avionVisible(e.avion, e.tsServeur)) avion.poser(positionAvionBr(e.avion!, e.tsServeur), capAvionBr(e.avion!), horloge);
      else avion.masquer();
      majButin(e.butin, e.oeil);
      majTempete(e.zone, e.tsServeur, e.oeil);
    },

    etat() {
      return { objets: nbObjets, modeles: modeles.size, avion: avion.groupe.visible, mur: murEtat, anneau: anneauEtat };
    },

    dispose() {
      racine.removeFromParent();
      for (const m of modeles.values()) m.dispose();
      modeles.clear();
      avion.dispose();
      for (const x of jetables) x.dispose();
      jetables.length = 0;
    },
  };
}

/**
 * Motif du mur de tempête : traînées verticales claires sur fond noir (l'intensité est dans la couleur, le mélange est additif), qui se
 * répète et défile vers le haut. Null hors navigateur (tests) : le mur est alors uni.
 */
function texturePluie(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const tex = new THREE.CanvasTexture(dessinerPluie());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dessinerPluie(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = 128; cv.height = 256;
  const c = cv.getContext("2d");
  if (!c) return cv;
  c.fillStyle = "#1a1a1a";
  c.fillRect(0, 0, cv.width, cv.height);
  // générateur déterministe : le motif est le même à chaque partie
  let s = 0x9e3779b9;
  const alea = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 46; i++) {
    const x = alea() * cv.width, l = 40 + alea() * 170, y = alea() * cv.height, w = 1 + alea() * 3;
    const g = c.createLinearGradient(0, y, 0, y + l);
    const v = Math.round(110 + alea() * 145);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, `rgb(${v},${v},${v})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(x, y, w, l);
    c.fillRect(x, y - cv.height, w, l); // le motif se raccorde en haut et en bas
  }
  return cv;
}
