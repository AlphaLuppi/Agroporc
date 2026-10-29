/**
 * Avion et parachute en fil de fer (three), communs aux tigres largués (`rendu-tigres.ts`), au Battle Royale (`rendu-br.ts`) et aux avatars
 * qui descendent sous voile (`rendu.ts`). Extraits de rendu-tigres.ts sans changement de forme : la silhouette est celle de l'avion de la
 * vue aérienne (lib/agroparc3d/scene.ts), nez vers +x.
 * Les calculs sans three (cap du modèle, clignotement des feux, balancement de la voilure) sont purs et testés dans `rendu-avion.test.ts`.
 *
 * Repère de protocole.ts : x est, z sud, y haut, cap en convention lacet (0 = vers −z, avant = (−sin cap, −cos cap)). Le nez du modèle est
 * vers +x : `rotation.y = cap + π/2`.
 */
import * as THREE from "three";
import type { Vec3 } from "./protocole";

/** Parachute : hauteur de la voilure au-dessus de l'attache (m), rayon, hauteur de l'attache sur le dos d'un tigre, couleur. */
export const PARACHUTE = { hauteur: 6.5, rayon: 4.2, attache: 1.2, couleur: 0xe8f4ff };
export const COULEUR_AVION = 0xdfefff;

/** Rotation en lacet du groupe de l'avion pour qu'il vole dans le sens du cap (le nez du modèle est vers +x). */
export const rotationAvion = (cap: number): number => cap + Math.PI / 2;

/** Feu à éclats du ventre de l'avion : allumé un peu plus de la moitié du temps, 7 rad/s (`horloge` en s). */
export const feuAEclats = (horloge: number): boolean => Math.sin(horloge * 7) > 0.2;

/** Balancement doux de la voilure (rad autour de z et de x) à l'instant `horloge` (s), décalé par `phase` pour que deux voiles ne battent pas ensemble. */
export function balancementVoile(horloge: number, phase = 0): { z: number; x: number } {
  return { z: 0.06 * Math.sin(horloge * 1.3 + phase), x: 0.05 * Math.sin(horloge * 0.9 + 1 + phase) };
}

/** Arêtes d'une géométrie (la géométrie d'origine est libérée). */
export function aretes(geo: THREE.BufferGeometry, seuil = 10): THREE.EdgesGeometry {
  const e = new THREE.EdgesGeometry(geo, seuil);
  geo.dispose();
  return e;
}

/** Avion de la vue aérienne (lib/agroparc3d/scene.ts) : fuselage, ailes, empennage, dérive, nez vers +x, plus deux moteurs. */
export function geometriesAvion(): THREE.BufferGeometry[] {
  const fus = new THREE.CylinderGeometry(1.4, 1.1, 26, 6);
  fus.rotateZ(Math.PI / 2);
  const ailes = new THREE.BoxGeometry(5, 0.4, 30);
  const queue = new THREE.BoxGeometry(3, 0.3, 10);
  queue.translate(-11, 1, 0);
  const derive = new THREE.BoxGeometry(4, 6, 0.3);
  derive.translate(-11.5, 3.5, 0);
  // deux moteurs sous les ailes : l'avion qui largue est un cargo
  const moteurs = [-7, 7].map((z) => {
    const m = new THREE.CylinderGeometry(0.7, 0.7, 3.6, 8);
    m.rotateZ(Math.PI / 2);
    m.translate(1.6, -0.6, z);
    return m;
  });
  return [fus, ailes, queue, derive, ...moteurs].map((g) => aretes(g));
}

/** Voilure (calotte de sphère ouverte) et suspentes, origine au point d'attache. */
export function geometriesParachute(): { voilure: THREE.BufferGeometry; suspentes: THREE.BufferGeometry } {
  const { hauteur, rayon } = PARACHUTE;
  const ouverture = 1.0;
  const R = rayon / Math.sin(ouverture);
  const calotte = new THREE.SphereGeometry(R, 12, 4, 0, Math.PI * 2, 0, ouverture);
  // la sphère est centrée sur son centre : le bord de la calotte est à R cos(ouverture) au-dessus, on le pose à `hauteur`
  calotte.translate(0, hauteur - R * Math.cos(ouverture), 0);
  const voilure = aretes(calotte, 1);
  const pts: number[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(0, 0, 0, Math.cos(a) * rayon, hauteur, Math.sin(a) * rayon);
  }
  const suspentes = new THREE.BufferGeometry();
  suspentes.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return { voilure, suspentes };
}

// ---------------------------------------------------------------------------------------------
// Avion complet
// ---------------------------------------------------------------------------------------------

export interface AvionFilDeFer {
  /** Groupe à ajouter à la scène (masqué à la création). */
  groupe: THREE.Group;
  /** Pose l'avion à `p` (m), au cap `cap` (lacet du jeu), et le montre ; `horloge` (s) fait clignoter le feu du ventre. */
  poser(p: Vec3, cap: number, horloge: number): void;
  masquer(): void;
  dispose(): void;
}

/** Avion en fil de fer avec ses feux de position (rouge à gauche, vert à droite) et son feu à éclats. */
export function creerAvionFilDeFer(): AvionFilDeFer {
  const geos = geometriesAvion();
  const matAvion = new THREE.LineBasicMaterial({ color: COULEUR_AVION, transparent: true, opacity: 0.95 });
  const groupe = new THREE.Group();
  for (const g of geos) groupe.add(new THREE.LineSegments(g, matAvion));
  const geoFeu = new THREE.SphereGeometry(0.6, 8, 6);
  const matFeuRouge = new THREE.MeshBasicMaterial({ color: 0xff5a4a });
  const matFeuVert = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
  const feuBas = new THREE.Mesh(geoFeu, matFeuRouge);
  feuBas.position.set(0, -1.6, 0);
  const feuG = new THREE.Mesh(geoFeu, matFeuRouge);
  feuG.position.set(1, 0, -15);
  const feuD = new THREE.Mesh(geoFeu, matFeuVert);
  feuD.position.set(1, 0, 15);
  groupe.add(feuBas, feuG, feuD);
  groupe.visible = false;
  for (const o of groupe.children) o.frustumCulled = false;
  return {
    groupe,
    poser(p, cap, horloge) {
      groupe.visible = true;
      groupe.position.set(p[0], p[1], p[2]);
      groupe.rotation.set(0, rotationAvion(cap), 0);
      feuBas.visible = feuAEclats(horloge);
    },
    masquer() { groupe.visible = false; },
    dispose() {
      groupe.removeFromParent();
      for (const g of geos) g.dispose();
      for (const x of [matAvion, geoFeu, matFeuRouge, matFeuVert]) x.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Parachute d'un avatar (géométrie partagée, comptée en références)
// ---------------------------------------------------------------------------------------------

export interface ParachuteFilDeFer {
  /** Groupe à ajouter à l'avatar ; son origine est le point d'attache. */
  groupe: THREE.Group;
  /** Balancement de la voilure (`horloge` en s, `phase` propre à chaque joueur). */
  balancer(horloge: number, phase?: number): void;
  dispose(): void;
}

/**
 * Géométries et matériaux des parachutes d'avatars : jusqu'à 49 joueurs descendent en même temps, une seule copie sert à tous. Libérée
 * quand le dernier parachute l'est.
 */
let partage: { voilure: THREE.BufferGeometry; suspentes: THREE.BufferGeometry; matVoilure: THREE.LineBasicMaterial; matSuspentes: THREE.LineBasicMaterial; refs: number } | null = null;

/** Nombre de parachutes d'avatars vivants (tests : tout est libéré à la fin). */
export const parachutesVivants = (): number => partage?.refs ?? 0;

/** Parachute ouvert au-dessus d'un avatar, attaché à `attache` m au-dessus de ses pieds. */
export function creerParachute(attache = PARACHUTE.attache): ParachuteFilDeFer {
  if (!partage) {
    const { voilure, suspentes } = geometriesParachute();
    partage = {
      voilure, suspentes, refs: 0,
      matVoilure: new THREE.LineBasicMaterial({ color: PARACHUTE.couleur, transparent: true, opacity: 0.9 }),
      matSuspentes: new THREE.LineBasicMaterial({ color: PARACHUTE.couleur, transparent: true, opacity: 0.55 }),
    };
  }
  const p = partage;
  p.refs++;
  const groupe = new THREE.Group();
  const v = new THREE.LineSegments(p.voilure, p.matVoilure);
  const s = new THREE.LineSegments(p.suspentes, p.matSuspentes);
  v.frustumCulled = false;
  s.frustumCulled = false;
  groupe.add(v, s);
  groupe.position.y = attache;
  let libre = false;
  return {
    groupe,
    balancer(horloge, phase = 0) {
      const b = balancementVoile(horloge, phase);
      groupe.rotation.z = b.z;
      groupe.rotation.x = b.x;
    },
    dispose() {
      if (libre) return;
      libre = true;
      groupe.removeFromParent();
      p.refs--;
      if (p.refs <= 0 && partage === p) {
        p.voilure.dispose();
        p.suspentes.dispose();
        p.matVoilure.dispose();
        p.matSuspentes.dispose();
        partage = null;
      }
    },
  };
}
