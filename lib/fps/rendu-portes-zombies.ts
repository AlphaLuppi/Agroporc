/**
 * Ouverture des portes payantes du mode zombies (three) : la porte achetée se soulève et s'efface (fantôme ambre de la pièce, le vrai
 * prisme est déjà écrasé), un petit nuage de poussière monte à son pied ; les éclats de bois passent par `Debris.lancer` (durée de vie
 * courte). Plan et chronologie : `ouverture-portes.ts` (pur, testé).
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (portes payantes)
 */
import * as THREE from "three";
import { DUREE_OUVERTURE_S, etatOuverture, type PlanOuverture } from "./ouverture-portes";

/** Durée (s) d'une bouffée de poussière, taille de départ et d'arrivée (m). */
const DUREE_POUSSIERE_S = 1.6;
const POUSSIERE_T0 = 0.8, POUSSIERE_T1 = 2.6;

export interface RenduPortesZombies {
  /** joue l'ouverture d'une porte (plan de `planOuverture`) */
  ouvrir(plan: PlanOuverture): void;
  maj(dt: number): void;
  /** retire tout ce qui est en cours (nouvelle partie) */
  vider(): void;
  dispose(): void;
}

interface Fantome { g: THREE.Group; mat: THREE.MeshBasicMaterial; ligne: THREE.LineBasicMaterial; hauteur: number; t: number }
interface Bouffee { s: THREE.Sprite; t: number; vy: number; derive: [number, number] }

export function creerRenduPortesZombies(scene: THREE.Scene, couleurArete: number, couleurFond: number): RenduPortesZombies {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const aretes = new THREE.EdgesGeometry(geo);
  let texPoussiere: THREE.CanvasTexture | null = null;
  if (typeof document !== "undefined") {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const c = cv.getContext("2d");
    if (c) {
      const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
      g.addColorStop(0, "rgba(200,184,160,0.55)"); g.addColorStop(0.6, "rgba(170,156,136,0.22)"); g.addColorStop(1, "rgba(150,140,120,0)");
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      texPoussiere = new THREE.CanvasTexture(cv);
    }
  }
  const fantomes: Fantome[] = [];
  const bouffees: Bouffee[] = [];

  const retirerFantome = (f: Fantome) => { f.g.removeFromParent(); f.mat.dispose(); f.ligne.dispose(); };
  const retirerBouffee = (b: Bouffee) => { b.s.removeFromParent(); (b.s.material as THREE.SpriteMaterial).dispose(); };

  return {
    ouvrir(plan) {
      const g = new THREE.Group();
      g.position.set(plan.centre[0], plan.hauteur / 2, plan.centre[2]);
      g.rotation.y = plan.lacet;
      g.scale.set(plan.longueur, plan.hauteur, plan.epaisseur);
      const mat = new THREE.MeshBasicMaterial({ color: couleurFond, transparent: true, opacity: 1, depthWrite: false });
      const ligne = new THREE.LineBasicMaterial({ color: couleurArete, transparent: true, opacity: 1, depthWrite: false });
      g.add(new THREE.Mesh(geo, mat), new THREE.LineSegments(aretes, ligne));
      scene.add(g);
      fantomes.push({ g, mat, ligne, hauteur: plan.hauteur, t: 0 });
      for (const p of plan.poussiere) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texPoussiere, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
        s.position.set(p[0], p[1], p[2]);
        s.scale.setScalar(POUSSIERE_T0);
        scene.add(s);
        bouffees.push({ s, t: -Math.random() * 0.25, vy: 0.5 + Math.random() * 0.5, derive: [(Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6] });
      }
    },
    maj(dt) {
      for (let i = fantomes.length - 1; i >= 0; i--) {
        const f = fantomes[i];
        f.t += dt;
        const e = etatOuverture(f.t, f.hauteur);
        if (e.finie || f.t > DUREE_OUVERTURE_S) { retirerFantome(f); fantomes.splice(i, 1); continue; }
        f.g.position.y = f.hauteur / 2 + e.levee;
        f.mat.opacity = e.opacite;
        f.ligne.opacity = e.opacite;
      }
      for (let i = bouffees.length - 1; i >= 0; i--) {
        const b = bouffees[i];
        b.t += dt;
        if (b.t < 0) { b.s.visible = false; continue; }
        const k = b.t / DUREE_POUSSIERE_S;
        if (k >= 1) { retirerBouffee(b); bouffees.splice(i, 1); continue; }
        b.s.visible = true;
        b.s.position.y += b.vy * dt * (1 - k);
        b.s.position.x += b.derive[0] * dt;
        b.s.position.z += b.derive[1] * dt;
        b.s.scale.setScalar(POUSSIERE_T0 + (POUSSIERE_T1 - POUSSIERE_T0) * (1 - (1 - k) ** 2));
        (b.s.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - k);
      }
    },
    vider() {
      for (const f of fantomes) retirerFantome(f);
      for (const b of bouffees) retirerBouffee(b);
      fantomes.length = 0;
      bouffees.length = 0;
    },
    dispose() {
      this.vider();
      geo.dispose();
      aretes.dispose();
      texPoussiere?.dispose();
    },
  };
}
