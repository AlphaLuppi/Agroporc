/**
 * Éclairs des manches du Truck Muche (three, mode zombies) : la foudre qui annonce et fait naître chaque petit ou mini Truck (zevt `eclair`,
 * comme les chiens de BO1) et les éclairs d'ambiance. Un éclair annoncé crépite d'abord au sol (lueur bleue qui pulse, `dans` secondes),
 * puis frappe : tronc et branches en zigzag (`tracerEclair` de `ambiance-zombies.ts`) en lignes additives, doublées d'un halo plus large,
 * lueur d'impact, et éclat global (`flashEclair`) que `jeu.ts` reporte sur le brouillard, le fond, le bloom et les intérieurs. Rien n'est
 * soumis au brouillard (`fog: false`) : la foudre perce la purée de pois. Tampons fixes (`MAX_ECLAIRS`), aucune allocation par image.
 * Aucun test vitest (three) : la logique est dans `ambiance-zombies.ts`, les régressions se voient aux captures.
 */
import * as THREE from "three";
import { AMBIANCE, DUREE_FLASH_S, flashEclair, porteeFlash, tracerEclair } from "./ambiance-zombies";
import type { Vec3 } from "./protocole";

/** Éclairs tenus à la fois (au-delà, le plus ancien est recyclé). */
const MAX_ECLAIRS = 6;
/** Générations du zigzag : 2^5 + 1 points pour le tronc, deux branches de 2^3 + 1 points. */
const GENERATIONS = 5;
const SEGMENTS_MAX = 2 ** GENERATIONS + 2 * 2 ** (GENERATIONS - 2);
/** Le tracé reste visible (en scintillant) cette durée (s) après la frappe. */
const VIE_TRACE_S = 0.32;
const C_ECLAIR = 0xd8e6ff;
const C_HALO = 0x6f8cff;

export interface RenduEclairs {
  /** Un éclair frappera `p` (au sol) dans `dansS` secondes (0 : tout de suite) ; `hauteur` : départ de la décharge (m). */
  eclair(p: Vec3, dansS: number, hauteur?: number, ambiance?: boolean): void;
  /**
   * Avance de `dt` s ; `cam` : position de la caméra (éclat selon la distance) ; `surFrappe` : appelé à l'instant où un éclair frappe (le
   * jeu y joue le tonnerre). Renvoie l'éclat global (0..1) de l'image.
   */
  maj(dt: number, cam: Vec3, surFrappe?: (p: Vec3, ambiance: boolean) => void): number;
  /** Plus aucun éclair (retour au lobby). */
  vider(): void;
  dispose(): void;
}

interface Eclair {
  actif: boolean;
  p: Vec3;
  hauteur: number;
  ambiance: boolean;
  /** temps (s) jusqu'à la frappe (négatif : depuis la frappe) */
  reste: number;
  frappe: boolean;
  graine: number;
  lignes: THREE.LineSegments;
  halo: THREE.LineSegments;
  lueur: THREE.Sprite;
  pos: Float32Array;
}

/** Disque doux pour la lueur d'impact. */
function textureLueur(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(190,210,255,0.6)");
    g.addColorStop(1, "rgba(120,150,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Générateur déterministe (graine) pour le tracé : un éclair garde sa forme tant qu'il vit. */
function lcg(graine: number): () => number {
  let k = (graine >>> 0) || 1;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

export function creerRenduEclairs(scene: THREE.Scene): RenduEclairs {
  const racine = new THREE.Group();
  racine.name = "eclairs";
  scene.add(racine);
  const tex = textureLueur();
  const matLignes = new THREE.LineBasicMaterial({
    color: C_ECLAIR, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  });
  const matHalo = new THREE.LineBasicMaterial({
    color: C_HALO, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  });
  const eclairs: Eclair[] = [];
  for (let i = 0; i < MAX_ECLAIRS; i++) {
    const pos = new Float32Array(SEGMENTS_MAX * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const lignes = new THREE.LineSegments(geo, matLignes.clone());
    // le halo : la même géométrie, décalée d'un rien (deux traits côte à côte font un éclair plus épais que le pixel de WebGL)
    const halo = new THREE.LineSegments(geo, matHalo.clone());
    halo.position.set(0.12, 0, 0.12);
    lignes.frustumCulled = halo.frustumCulled = false;
    lignes.renderOrder = halo.renderOrder = 16;
    const lueur = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    lueur.renderOrder = 16;
    lignes.visible = halo.visible = lueur.visible = false;
    racine.add(lignes, halo, lueur);
    eclairs.push({ actif: false, p: [0, 0, 0], hauteur: AMBIANCE.hauteurM, ambiance: false, reste: 0, frappe: false, graine: 1, lignes, halo, lueur, pos });
  }
  let graine = 1;
  let temps = 0;

  /** Écrit le tracé de l'éclair `e` dans sa géométrie (segments du tronc puis des branches). */
  function tracer(e: Eclair): void {
    const t = tracerEclair(e.p, e.hauteur, lcg(e.graine), GENERATIONS);
    let k = 0;
    const segs = (pts: Vec3[]) => {
      for (let i = 0; i + 1 < pts.length && k + 6 <= e.pos.length; i++) {
        e.pos[k++] = pts[i][0]; e.pos[k++] = pts[i][1]; e.pos[k++] = pts[i][2];
        e.pos[k++] = pts[i + 1][0]; e.pos[k++] = pts[i + 1][1]; e.pos[k++] = pts[i + 1][2];
      }
    };
    segs(t.tronc);
    for (const b of t.branches) segs(b);
    const geo = e.lignes.geometry;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, k / 3);
  }

  function cacher(e: Eclair): void {
    e.actif = false;
    e.lignes.visible = e.halo.visible = e.lueur.visible = false;
  }

  return {
    eclair(p, dansS, hauteur = AMBIANCE.hauteurM, ambiance = false) {
      // un emplacement libre, sinon le plus avancé
      let e = eclairs.find((x) => !x.actif);
      if (!e) e = eclairs.reduce((a, b) => (a.reste < b.reste ? a : b));
      e.actif = true;
      e.p = [p[0], p[1], p[2]];
      e.hauteur = hauteur;
      e.ambiance = ambiance;
      e.reste = Math.max(0, dansS);
      e.frappe = false;
      e.graine = graine++ * 7919;
      e.lignes.visible = e.halo.visible = false;
      e.lueur.visible = !ambiance; // l'éclair d'ambiance ne crépite pas au sol avant de frapper
      e.lueur.position.set(p[0], p[1] + 0.4, p[2]);
      e.lueur.scale.setScalar(0.1);
    },
    maj(dt, cam, surFrappe) {
      temps += dt;
      let eclat = 0;
      for (const e of eclairs) {
        if (!e.actif) continue;
        e.reste -= dt;
        if (e.reste > 0) {
          // annonce : la lueur bleue grandit et crépite là où la foudre va tomber
          const k = 1 - Math.min(1, e.reste / 0.6);
          const m = e.lueur.material as THREE.SpriteMaterial;
          m.opacity = (0.25 + 0.55 * k) * (0.6 + 0.4 * Math.sin(temps * 61 + e.graine));
          e.lueur.scale.setScalar(0.8 + 2.4 * k);
          continue;
        }
        if (!e.frappe) {
          e.frappe = true;
          tracer(e);
          e.lueur.visible = true;
          surFrappe?.(e.p, e.ambiance);
        }
        const depuis = -e.reste;
        if (depuis > Math.max(DUREE_FLASH_S, VIE_TRACE_S + 0.3)) { cacher(e); continue; }
        const f = flashEclair(depuis);
        const d = Math.hypot(e.p[0] - cam[0], e.p[2] - cam[2]);
        // les éclairs d'apparition (un par ennemi) éclairent moins que ceux, plus rares, de l'orage
        eclat = Math.max(eclat, f * porteeFlash(d) * (e.ambiance ? 0.8 : 0.6));
        // le tracé scintille avec le flash, puis s'éteint
        const visible = depuis < VIE_TRACE_S && f > 0.05;
        e.lignes.visible = e.halo.visible = visible;
        (e.lignes.material as THREE.LineBasicMaterial).opacity = Math.min(1, 0.25 + f);
        (e.halo.material as THREE.LineBasicMaterial).opacity = 0.55 * f;
        const m = e.lueur.material as THREE.SpriteMaterial;
        m.opacity = Math.min(0.85, 0.1 + 0.75 * f) * Math.max(0, 1 - depuis / (VIE_TRACE_S + 0.3));
        e.lueur.scale.setScalar(1.4 + 2.2 * f);
      }
      return Math.min(1, eclat);
    },
    vider() {
      for (const e of eclairs) cacher(e);
    },
    dispose() {
      scene.remove(racine);
      for (const e of eclairs) {
        e.lignes.geometry.dispose();
        (e.lignes.material as THREE.Material).dispose();
        (e.halo.material as THREE.Material).dispose();
        (e.lueur.material as THREE.Material).dispose();
      }
      matLignes.dispose(); matHalo.dispose(); tex.dispose();
    },
  };
}
