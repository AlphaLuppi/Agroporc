/**
 * Feux, fumées et explosions des voitures de l'arène (three, v3 §4). Un seul nuage de particules additives (mêmes codes que le fil de fer
 * lumineux du reste : sur fond sombre, la fumée est une brume grise qui s'éteint, le feu un orange qui vire au rouge) et, par explosion,
 * un éclair (sphère additive qui gonfle et s'éteint) et une onde au sol. Aucun test vitest (three) : les régressions se voient aux captures.
 *
 * `maj(dt, sources)` à chaque image : chaque source (voiture qui fume, qui brûle, épave) émet selon son niveau ; `explosion(p)` lance la
 * gerbe. Les particules vivent dans un tampon fixe (les plus anciennes sont recyclées) : aucune allocation par image.
 */
import * as THREE from "three";
import type { Vec3 } from "./protocole";

export type NiveauFeu = "fumee" | "feu" | "epave";
export interface SourceFeu { p: Vec3; niveau: NiveauFeu }

export interface Feux {
  maj(dt: number, sources: readonly SourceFeu[]): void;
  explosion(p: Vec3): void;
  dispose(): void;
}

const MAX_PARTICULES = 900;
const MAX_ECLAIRS = 4;
/** Émissions par seconde et par source : [fumée, flammes]. */
const DEBITS: Record<NiveauFeu, [number, number]> = { fumee: [12, 0], feu: [16, 45], epave: [20, 30] };
/** Couleurs de départ (additif : plus c'est vif, plus ça brille). */
const C_FUMEE = new THREE.Color(0x5a5e64);
const C_FLAMME = new THREE.Color(0xffa53a);
const C_FLAMME_FIN = new THREE.Color(0x8a1a05);
const C_BRAISE = new THREE.Color(0xffe0a0);

/** Disque doux (dégradé radial) pour les points. */
function textureDisque(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Un système de points : une taille, des couleurs par particule qui s'éteignent vers le noir (additif). */
function systeme(racine: THREE.Object3D, tex: THREE.Texture, taille: number, n: number) {
  const pos = new Float32Array(n * 3).fill(-1e5);
  const col = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({
    size: taille, map: tex, vertexColors: true, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 15;
  racine.add(pts);
  // état par particule
  const vel = new Float32Array(n * 3), age = new Float32Array(n), vie = new Float32Array(n).fill(0);
  const debut = new Float32Array(n * 3), fin = new Float32Array(n * 3), gravite = new Float32Array(n);
  let suivante = 0;
  return {
    geo, mat,
    emettre(x: number, y: number, z: number, vx: number, vy: number, vz: number, duree: number, c0: THREE.Color, c1: THREE.Color, g = 0) {
      const i = suivante;
      suivante = (suivante + 1) % n;
      pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z;
      vel[3 * i] = vx; vel[3 * i + 1] = vy; vel[3 * i + 2] = vz;
      age[i] = 0; vie[i] = duree; gravite[i] = g;
      debut[3 * i] = c0.r; debut[3 * i + 1] = c0.g; debut[3 * i + 2] = c0.b;
      fin[3 * i] = c1.r; fin[3 * i + 1] = c1.g; fin[3 * i + 2] = c1.b;
    },
    maj(dt: number) {
      for (let i = 0; i < n; i++) {
        if (vie[i] <= 0) continue;
        age[i] += dt;
        const k = age[i] / vie[i];
        if (k >= 1) {
          vie[i] = 0;
          pos[3 * i + 1] = -1e5;
          col[3 * i] = col[3 * i + 1] = col[3 * i + 2] = 0;
          continue;
        }
        vel[3 * i + 1] -= gravite[i] * dt;
        // freinage de l'air (la fumée s'étale en ralentissant)
        const fr = Math.exp(-1.2 * dt);
        vel[3 * i] *= fr; vel[3 * i + 2] *= fr;
        pos[3 * i] += vel[3 * i] * dt;
        pos[3 * i + 1] = Math.max(0.05, pos[3 * i + 1] + vel[3 * i + 1] * dt);
        pos[3 * i + 2] += vel[3 * i + 2] * dt;
        // couleur : de `debut` vers `fin`, puis extinction (noir = invisible en additif) sur le dernier tiers
        const e = k < 0.66 ? 1 : 1 - (k - 0.66) / 0.34;
        const m = Math.min(1, k * 1.5);
        for (let c = 0; c < 3; c++) col[3 * i + c] = (debut[3 * i + c] + (fin[3 * i + c] - debut[3 * i + c]) * m) * e;
      }
      (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}

export function creerFeux(scene: THREE.Object3D): Feux {
  const racine = new THREE.Group();
  racine.name = "feux";
  scene.add(racine);
  const tex = textureDisque();
  const fumees = systeme(racine, tex, 3.2, Math.floor(MAX_PARTICULES * 0.5));
  const flammes = systeme(racine, tex, 1.7, Math.floor(MAX_PARTICULES * 0.5));
  /** reste fractionnaire d'émission par source (clé = indice dans la liste, la liste est stable d'une image à l'autre) */
  const restes: number[] = [];

  // éclairs : sphère additive + anneau au sol, recyclés
  const geoBoule = new THREE.SphereGeometry(1, 16, 12);
  const geoOnde = new THREE.RingGeometry(0.85, 1, 48);
  geoOnde.rotateX(-Math.PI / 2);
  const eclairs = Array.from({ length: MAX_ECLAIRS }, () => {
    const matB = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const matO = new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const boule = new THREE.Mesh(geoBoule, matB);
    const onde = new THREE.Mesh(geoOnde, matO);
    boule.visible = onde.visible = false;
    boule.renderOrder = onde.renderOrder = 16;
    racine.add(boule, onde);
    return { boule, onde, matB, matO, age: 1, actif: false };
  });
  let rangEclair = 0;
  const alea = (a: number, b: number) => a + Math.random() * (b - a);

  return {
    maj(dt, sources) {
      sources.forEach((s, i) => {
        const [df, dl] = DEBITS[s.niveau];
        restes[i] = (restes[i] ?? Math.random()) + (df + dl) * dt;
        while (restes[i] >= 1) {
          restes[i] -= 1;
          const [x, y, z] = s.p;
          if (Math.random() < df / (df + dl)) {
            fumees.emettre(x + alea(-0.6, 0.6), y + 1.3, z + alea(-1, 1), alea(-0.4, 0.4), alea(1.2, 2.2), alea(-0.4, 0.4), alea(1.8, 3), C_FUMEE, C_FUMEE);
          } else {
            flammes.emettre(x + alea(-0.7, 0.7), y + alea(0.9, 1.4), z + alea(-1.4, 1.4), alea(-0.3, 0.3), alea(1.6, 3), alea(-0.3, 0.3), alea(0.35, 0.7), C_FLAMME, C_FLAMME_FIN);
          }
        }
      });
      restes.length = sources.length;
      fumees.maj(dt);
      flammes.maj(dt);
      for (const e of eclairs) {
        if (!e.actif) continue;
        e.age += dt;
        const kB = e.age / 0.45, kO = e.age / 0.7;
        e.boule.scale.setScalar(1.5 + 5 * Math.min(1, kB));
        e.matB.opacity = Math.max(0, 1 - kB) * 0.9;
        e.onde.scale.setScalar(1 + 13 * Math.min(1, kO));
        e.matO.opacity = Math.max(0, 1 - kO) * 0.8;
        if (kB >= 1) e.boule.visible = false;
        if (kO >= 1) { e.onde.visible = false; e.actif = false; }
      }
    },

    explosion(p) {
      const [x, y, z] = p;
      const e = eclairs[rangEclair];
      rangEclair = (rangEclair + 1) % MAX_ECLAIRS;
      e.age = 0;
      e.actif = true;
      e.boule.position.set(x, y + 1, z);
      e.onde.position.set(x, y + 0.08, z);
      e.boule.visible = e.onde.visible = true;
      // boule de feu : flammes projetées dans toutes les directions, braises retombantes, panache de fumée
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2, el = alea(-0.2, 1.2), v = alea(4, 11);
        flammes.emettre(x, y + 1, z, Math.cos(a) * Math.cos(el) * v, Math.sin(el) * v, Math.sin(a) * Math.cos(el) * v, alea(0.4, 0.9), C_BRAISE, C_FLAMME_FIN);
      }
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, v = alea(5, 12);
        flammes.emettre(x, y + 1.2, z, Math.cos(a) * v * 0.6, alea(5, 10), Math.sin(a) * v * 0.6, alea(1, 1.6), C_BRAISE, C_FLAMME, 14);
      }
      for (let i = 0; i < 45; i++) {
        const a = Math.random() * Math.PI * 2, v = alea(1, 4);
        fumees.emettre(x + alea(-1, 1), y + alea(1, 3), z + alea(-1, 1), Math.cos(a) * v, alea(2, 4.5), Math.sin(a) * v, alea(2.5, 4), C_FUMEE, C_FUMEE);
      }
    },

    dispose() {
      racine.removeFromParent();
      fumees.geo.dispose(); fumees.mat.dispose();
      flammes.geo.dispose(); flammes.mat.dispose();
      tex.dispose();
      geoBoule.dispose();
      geoOnde.dispose();
      for (const e of eclairs) { e.matB.dispose(); e.matO.dispose(); }
    },
  };
}
