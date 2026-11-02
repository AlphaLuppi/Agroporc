/**
 * Vitrine 3D de la barre des armes (écran de mort, entracte) : UN canvas three partagé par toutes les tuiles. Chaque tuile est un élément HTML
 * (un bouton) ; à chaque image on lit son rectangle et on dessine son arme dans ce rectangle (viewport + scissor, technique « plusieurs vues, un
 * renderer »). Les modèles sont ceux des bots (`creerArmeBot` de rendu.ts : fil de fer lumineux, arêtes de 2 px), créés à la demande et libérés
 * avec la vitrine. Rien ici n'est testé en vitest (three + canvas) : la logique pure vit dans `barre-armes.ts`.
 * Chargé à la demande par `BarreArmes.tsx` (`import()`), jamais dans le premier chargement de la page du menu.
 */
import * as THREE from "three";
import { creerArmeBot, type ArmeBotRendu } from "./rendu";
import type { ArmeId } from "./protocole";
import {
  ETAT_TUILE_INITIAL, VITRINE, aspectTuile, cadrageGl, distanceCameraTuile, lacetTuile, pasTuile, rectVisible, tailleRelative, type EtatTuile, type Rect,
} from "./barre-armes";

/** Une tuile suivie par la vitrine : l'élément qui donne le rectangle, et son état d'interaction. */
export interface TuileVitrine {
  id: ArmeId;
  el: HTMLElement;
  actif: boolean;
  choisie: boolean;
}

export interface Vitrine {
  /** remplace la liste des tuiles (appelée à chaque rendu React) */
  definir(tuiles: readonly TuileVitrine[]): void;
  /** dessine une image maintenant (changement de taille, de choix) */
  dessiner(): void;
  /** démarre / arrête la boucle d'animation */
  animer(on: boolean): void;
  dispose(): void;
}

interface Modele {
  arme: ArmeBotRendu;
  pivot: THREE.Group;
  rayon: number;
  longueur: number;
  /** demi-diagonale de l'emprise au sol (rayon de rotation autour de l'axe vertical) et demi-hauteur, en unités du modèle */
  rayonH: number;
  demiY: number;
}

const FOV = 28;

/** Couleur CSS d'un jeton `--ag-*` lu sur le conteneur (repli : cyan de l'arène). */
function couleurJeton(el: Element, jeton: string, repli: number): THREE.Color {
  try {
    const v = getComputedStyle(el).getPropertyValue(jeton).trim();
    if (v) return new THREE.Color(v);
  } catch { /* couleur illisible : repli */ }
  return new THREE.Color(repli);
}

/**
 * Boîte englobante des FACES visibles de l'arme (repère du monde, groupe posé à l'origine) : les arêtes épaisses (`LineSegments2`) ont un maillage de
 * rubans propre, et l'éclair de bouche caché ne doit pas gonfler la boîte.
 */
export function boiteDesFaces(racine: THREE.Object3D): THREE.Box3 {
  racine.updateWorldMatrix(true, true);
  const boite = new THREE.Box3(), part = new THREE.Box3();
  racine.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as unknown as { isLineSegments2?: boolean }).isLineSegments2 || !mesh.geometry?.attributes?.position) return;
    for (let p: THREE.Object3D | null = o; p && p !== racine.parent; p = p.parent) if (!p.visible) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    part.copy(mesh.geometry.boundingBox!).applyMatrix4(o.matrixWorld);
    boite.union(part);
  });
  return boite.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1)) : boite;
}

export function creerVitrine(canvas: HTMLCanvasElement, conteneur: HTMLElement, o: { mouvementReduit: boolean }): Vitrine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  // Les arêtes épaisses (`LineMaterial`) règlent leur épaisseur d'après la taille du tampon du renderer ; ici chaque tuile n'est qu'un viewport du
  // canvas partagé : la taille « du tampon » est celle de la tuile en cours de dessin, sinon les traits sont trop fins et anisotropes.
  let tailleTuile: [number, number] | null = null;
  const tailleNative = renderer.getDrawingBufferSize.bind(renderer);
  renderer.getDrawingBufferSize = (cible: THREE.Vector2) => (tailleTuile ? cible.set(tailleTuile[0], tailleTuile[1]) : tailleNative(cible));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);
  const cyan = couleurJeton(conteneur, "--ag-cyan", 0x9be9ff);
  const ambre = couleurJeton(conteneur, "--ag-amber", 0xffb35c);

  const modeles = new Map<string, Modele>();
  const etats = new Map<string, EtatTuile>();
  let tuiles: readonly TuileVitrine[] = [];
  let longueurMax = 0;
  let raf = 0;
  let precedent = 0;
  let mort = false;

  /** Construit le modèle d'une arme (centré sur sa boîte englobante, canon vers −z) la première fois qu'on en a besoin. */
  const modele = (id: ArmeId, choisie: boolean): Modele => {
    const cle = `${id}:${choisie ? "c" : "n"}`;
    let m = modeles.get(cle);
    if (m) return m;
    const arme = creerArmeBot(id, (choisie ? ambre : cyan).getHex());
    const pivot = new THREE.Group();
    pivot.add(arme.group);
    const boite = boiteDesFaces(arme.group);
    const centre = boite.getCenter(new THREE.Vector3());
    const taille = boite.getSize(new THREE.Vector3());
    arme.group.position.sub(centre);
    pivot.visible = false;
    scene.add(pivot);
    const longueur = Math.max(taille.x, taille.y, taille.z, 0.05);
    // rayon de la sphère englobante : la diagonale tient dans la tuile quel que soit l'angle
    m = { arme, pivot, rayon: Math.max(taille.length() / 2, 0.05), longueur, rayonH: Math.max(Math.hypot(taille.x, taille.z) / 2, 0.05), demiY: Math.max(taille.y / 2, 0.01) };
    modeles.set(cle, m);
    longueurMax = Math.max(longueurMax, longueur);
    return m;
  };

  const rectDe = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

  const dessiner = (dt: number) => {
    if (mort) return;
    const boiteCanvas = rectDe(canvas);
    if (boiteCanvas.w < 2 || boiteCanvas.h < 2) return;
    const zone = rectDe(conteneur);
    const wPx = Math.round(boiteCanvas.w), hPx = Math.round(boiteCanvas.h);
    const taille = renderer.getSize(new THREE.Vector2());
    if (taille.x !== wPx || taille.y !== hPx) renderer.setSize(wPx, hPx, false);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    // tous les modèles d'abord : la taille relative d'une arme dépend de la plus longue de la rangée
    for (const t of tuiles) modele(t.id, t.choisie);
    let rang = 0;
    for (const t of tuiles) {
      const rect = rectDe(t.el);
      const visible = rectVisible(rect, zone);
      rang++;
      if (!visible) continue;
      const cleEtat = `${t.id}`;
      const e = pasTuile(etats.get(cleEtat) ?? ETAT_TUILE_INITIAL, dt, { actif: t.actif, choisie: t.choisie, mouvementReduit: o.mouvementReduit });
      etats.set(cleEtat, e);
      const m = modele(t.id, t.choisie);
      for (const autre of modeles.values()) autre.pivot.visible = false;
      m.pivot.visible = true;
      m.pivot.rotation.set(VITRINE.tangage, lacetTuile(e, rang * VITRINE.dephasage), 0, "YXZ");
      // l'emprise au sol de l'arme tient dans la largeur de la tuile (rayon horizontal 0,5 × sa taille relative), sa hauteur dans la hauteur
      const rel = tailleRelative(m.longueur, longueurMax);
      const echelle = (0.5 * rel) / m.rayonH;
      m.pivot.scale.setScalar(e.echelle * echelle);
      const g = cadrageGl(rect, visible, boiteCanvas);
      camera.aspect = aspectTuile(rect);
      camera.updateProjectionMatrix();
      camera.position.set(0, 0, distanceCameraTuile(0.5 * rel, m.demiY * echelle, FOV, camera.aspect, VITRINE.tangage));
      camera.lookAt(0, 0, 0);
      renderer.setViewport(g.viewport.x, g.viewport.y, g.viewport.w, g.viewport.h);
      renderer.setScissor(g.scissor.x, g.scissor.y, g.scissor.w, g.scissor.h);
      const pr = renderer.getPixelRatio();
      tailleTuile = [Math.max(1, rect.w * pr), Math.max(1, rect.h * pr)];
      renderer.render(scene, camera);
    }
    tailleTuile = null;
  };

  const boucle = (maintenant: number) => {
    raf = 0;
    if (mort) return;
    const dt = precedent ? (maintenant - precedent) / 1000 : 0.016;
    precedent = maintenant;
    dessiner(dt);
    raf = requestAnimationFrame(boucle);
  };

  return {
    definir(liste) { tuiles = liste; },
    dessiner() { dessiner(o.mouvementReduit ? 0.25 : 0); },
    animer(on) {
      if (mort) return;
      if (on && !raf) { precedent = 0; raf = requestAnimationFrame(boucle); }
      if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
    },
    dispose() {
      mort = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const m of modeles.values()) { m.arme.dispose(); m.pivot.removeFromParent(); }
      modeles.clear();
      renderer.dispose();
      // libère le contexte tout de suite (sinon le navigateur le garde jusqu'au ramasse-miettes)
      try { renderer.forceContextLoss(); } catch { /* déjà perdu */ }
    },
  };
}
