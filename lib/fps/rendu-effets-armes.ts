/**
 * Rendu des effets des armes du mode zombies (three, v8) : projectiles en vol ou plantés (grenade de moutarde de Moutarde & Sally, pique de
 * la Brochette qui clignote avant de sauter), arcs électriques en zigzag qui s'éteignent (Grille-pain, armes électriques), bourrasque de la
 * Soufflerie (stries d'air qui filent dans le cône), givre des tigres gelés. Réserves fixes (aucune allocation par image), tout est libéré
 * par `dispose`. Les flammes des tigres en feu passent par `rendu-feux.ts` (sources de feu), les explosions par `feux.explosion`.
 * Aucun test vitest (three) : la logique (positions, trajectoires) est dans jeu-projectiles.ts et effets-armes.ts.
 */
import * as THREE from "three";
import type { ProjectileAffiche } from "./jeu-projectiles";
import type { Vec3 } from "./protocole";
import { sansHalo } from "./rendu";

/** Projectiles dessinés au plus, arcs et bourrasques en même temps au plus. */
export const RESERVE_PROJECTILES = 16;
const MAX_ARCS = 6;
const POINTS_ARC = 64;
const MAX_SOUFFLES = 3;
const STRIES = 36;
const MAX_GIVRES = 24;
/** Durées de vie (s) d'un arc et d'une bourrasque. */
const VIE_ARC_S = 0.32;
const VIE_SOUFFLE_S = 0.55;

export interface RenduEffetsArmes {
  /** projectiles de l'image (`t` : horloge locale en s, pour les clignotements) */
  majProjectiles(liste: readonly ProjectileAffiche[], t: number): void;
  /** un arc électrique passe par ces points (dos des tigres) */
  arc(points: readonly Vec3[], couleur?: number): void;
  /** bourrasque de la Soufflerie tirée de `o` vers `d` sur `portee` m */
  souffle(o: Vec3, d: Vec3, portee: number): void;
  /** givre sur les tigres gelés de l'image (positions au sol) */
  majGivre(positions: readonly Vec3[], t: number): void;
  maj(dt: number): void;
  dispose(): void;
}

interface Arc { ligne: THREE.LineSegments; pos: Float32Array; vie: number; mat: THREE.LineBasicMaterial }
interface Souffle { strie: THREE.LineSegments; pos: Float32Array; base: Float32Array; vie: number; mat: THREE.LineBasicMaterial }

export function creerRenduEffetsArmes(scene: THREE.Object3D): RenduEffetsArmes {
  const racine = new THREE.Group();
  racine.name = "effets-armes";
  scene.add(racine);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  // ---- projectiles ----
  const geoBoule = new THREE.SphereGeometry(0.07, 10, 8);
  const geoPique = new THREE.CylinderGeometry(0.008, 0.008, 0.5, 5);
  geoPique.rotateX(Math.PI / 2);
  const geoMorceau = new THREE.BoxGeometry(0.045, 0.045, 0.05);
  geos.push(geoBoule, geoPique, geoMorceau);
  const matMoutarde = new THREE.MeshBasicMaterial({ color: 0xffd23a });
  const matBois = new THREE.MeshBasicMaterial({ color: 0xc89a5c });
  const matViande = new THREE.MeshBasicMaterial({ color: 0x8a3a24 });
  const matVoyant = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  sansHalo(matBois); sansHalo(matViande);
  mats.push(matMoutarde, matBois, matViande, matVoyant);
  const pool: { g: THREE.Group; boule: THREE.Mesh; pique: THREE.Group; voyant: THREE.Mesh }[] = [];
  for (let i = 0; i < RESERVE_PROJECTILES; i++) {
    const g = new THREE.Group();
    g.visible = false;
    const boule = new THREE.Mesh(geoBoule, matMoutarde);
    const pique = new THREE.Group();
    pique.add(new THREE.Mesh(geoPique, matBois));
    for (const z of [-0.12, -0.04, 0.04]) { const mo = new THREE.Mesh(geoMorceau, matViande); mo.position.z = z; pique.add(mo); }
    const voyant = new THREE.Mesh(geoBoule, matVoyant);
    voyant.scale.setScalar(0.45);
    voyant.position.z = 0.2;
    pique.add(voyant);
    g.add(boule, pique);
    racine.add(g);
    pool.push({ g, boule, pique, voyant });
  }
  const _cible = new THREE.Vector3();

  // ---- arcs ----
  const arcs: Arc[] = [];
  for (let i = 0; i < MAX_ARCS; i++) {
    const pos = new Float32Array(POINTS_ARC * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const ligne = new THREE.LineSegments(geo, mat);
    ligne.frustumCulled = false;
    ligne.visible = false;
    ligne.renderOrder = 16;
    racine.add(ligne);
    geos.push(geo); mats.push(mat);
    arcs.push({ ligne, pos, vie: 0, mat });
  }
  let arcSuivant = 0;

  // ---- bourrasques ----
  const souffles: Souffle[] = [];
  for (let i = 0; i < MAX_SOUFFLES; i++) {
    const pos = new Float32Array(STRIES * 2 * 3);
    const base = new Float32Array(STRIES * 7);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const strie = new THREE.LineSegments(geo, mat);
    strie.frustumCulled = false;
    strie.visible = false;
    strie.renderOrder = 16;
    racine.add(strie);
    geos.push(geo); mats.push(mat);
    souffles.push({ strie, pos, base, vie: 0, mat });
  }
  let souffleSuivant = 0;

  // ---- givre ----
  const geoGivre = new THREE.OctahedronGeometry(0.12, 0);
  const matGivre = new THREE.MeshBasicMaterial({ color: 0xb8ecff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  geos.push(geoGivre); mats.push(matGivre);
  const givres: THREE.Group[] = [];
  for (let i = 0; i < MAX_GIVRES; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const c = new THREE.Mesh(geoGivre, matGivre);
      const a = (k / 5) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.45, 0.5 + 0.25 * (k % 2), Math.sin(a) * 0.45);
      c.scale.set(0.6, 1.4, 0.6);
      g.add(c);
    }
    g.visible = false;
    racine.add(g);
    givres.push(g);
  }

  /** Graine déterministe d'un zigzag (pas de Math.random dans la géométrie : l'arc garde sa forme le temps de sa vie). */
  let graine = 1;
  const alea = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 4294967296; };

  return {
    majProjectiles(liste, t) {
      let n = 0;
      for (const p of liste) {
        const e = pool[n];
        if (!e) break;
        n++;
        e.g.visible = true;
        e.g.position.set(p.p[0], p.p[1], p.p[2]);
        _cible.set(p.p[0] + p.dir[0], p.p[1] + p.dir[1], p.p[2] + p.dir[2]);
        e.g.lookAt(_cible);
        e.g.rotateY(Math.PI); // le pique pointe vers −z de son repère : la pointe devant
        const brochette = p.arme === "brochette";
        e.boule.visible = !brochette;
        e.pique.visible = brochette;
        if (!brochette) e.boule.scale.setScalar(p.ameliore ? 1.2 : 1);
        // le carreau planté clignote de plus en plus vite jusqu'à l'explosion
        e.voyant.visible = brochette && p.plante && Math.sin(t * (8 + 30 * p.attente)) > 0;
      }
      for (let i = n; i < pool.length; i++) { if (!pool[i].g.visible) break; pool[i].g.visible = false; }
    },

    arc(points, couleur = 0x9fe8ff) {
      if (points.length < 1) return;
      const a = arcs[arcSuivant];
      arcSuivant = (arcSuivant + 1) % arcs.length;
      graine = (graine + 7919) >>> 0;
      let k = 0;
      const pousser = (x: number, y: number, z: number) => { a.pos[k++] = x; a.pos[k++] = y; a.pos[k++] = z; };
      // un seul tigre touché : petite étoile d'étincelles sur lui ; sinon des zigzags d'un tigre à l'autre
      const segs = points.length === 1 ? [[points[0], [points[0][0], points[0][1] + 0.9, points[0][2]] as Vec3]] : points.slice(1).map((q, i) => [points[i], q]);
      const parSeg = Math.max(2, Math.floor(POINTS_ARC / Math.max(1, segs.length)));
      for (const [p, q] of segs) {
        let px = p[0], py = p[1], pz = p[2];
        for (let s = 1; s <= parSeg && k < a.pos.length - 6; s++) {
          const u = s / parSeg;
          const amp = s === parSeg ? 0 : 0.35;
          const x = p[0] + (q[0] - p[0]) * u + (alea() - 0.5) * amp;
          const y = p[1] + (q[1] - p[1]) * u + (alea() - 0.5) * amp;
          const z = p[2] + (q[2] - p[2]) * u + (alea() - 0.5) * amp;
          pousser(px, py, pz); pousser(x, y, z);
          px = x; py = y; pz = z;
        }
      }
      const geo = a.ligne.geometry;
      (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      geo.setDrawRange(0, k / 3);
      a.mat.color.setHex(couleur);
      a.mat.opacity = 1;
      a.vie = VIE_ARC_S;
      a.ligne.visible = true;
    },

    souffle(o, d, portee) {
      const s = souffles[souffleSuivant];
      souffleSuivant = (souffleSuivant + 1) % souffles.length;
      // base orthonormée autour de d
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const f = [d[0] / l, d[1] / l, d[2] / l];
      const u = Math.abs(f[1]) > 0.99 ? [1, 0, 0] : [f[2], 0, -f[0]];
      const lu = Math.hypot(u[0], u[1], u[2]) || 1;
      u[0] /= lu; u[1] /= lu; u[2] /= lu;
      const w = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
      for (let i = 0; i < STRIES; i++) {
        const ang = alea() * Math.PI * 2, r = 0.2 + alea() * 0.9;
        const b = i * 7;
        // départ près de la bouche, direction écartée dans le cône, vitesse
        s.base[b] = o[0] + f[0] * 0.6; s.base[b + 1] = o[1] - 0.15 + f[1] * 0.6; s.base[b + 2] = o[2] + f[2] * 0.6;
        s.base[b + 3] = f[0] + (u[0] * Math.cos(ang) + w[0] * Math.sin(ang)) * r * 0.25;
        s.base[b + 4] = f[1] + (u[1] * Math.cos(ang) + w[1] * Math.sin(ang)) * r * 0.25;
        s.base[b + 5] = f[2] + (u[2] * Math.cos(ang) + w[2] * Math.sin(ang)) * r * 0.25;
        s.base[b + 6] = portee * (0.7 + 0.5 * alea()) / VIE_SOUFFLE_S;
      }
      s.vie = VIE_SOUFFLE_S;
      s.strie.visible = true;
    },

    majGivre(positions, t) {
      let n = 0;
      for (const p of positions) {
        const g = givres[n];
        if (!g) break;
        n++;
        g.visible = true;
        g.position.set(p[0], 0, p[2]);
        g.rotation.y = t * 0.8 + n;
      }
      for (let i = n; i < givres.length; i++) { if (!givres[i].visible) break; givres[i].visible = false; }
    },

    maj(dt) {
      for (const a of arcs) {
        if (!a.ligne.visible) continue;
        a.vie -= dt;
        if (a.vie <= 0) { a.ligne.visible = false; continue; }
        // scintillement : l'arc clignote en s'éteignant
        a.mat.opacity = (a.vie / VIE_ARC_S) * (0.6 + 0.4 * Math.sin(a.vie * 90));
      }
      for (const s of souffles) {
        if (!s.strie.visible) continue;
        s.vie -= dt;
        if (s.vie <= 0) { s.strie.visible = false; continue; }
        const age = VIE_SOUFFLE_S - s.vie;
        for (let i = 0; i < STRIES; i++) {
          const b = i * 7, k = i * 6;
          const dist = s.base[b + 6] * age;
          const x = s.base[b] + s.base[b + 3] * dist, y = s.base[b + 1] + s.base[b + 4] * dist, z = s.base[b + 2] + s.base[b + 5] * dist;
          const lg = 1.2;
          s.pos[k] = x; s.pos[k + 1] = y; s.pos[k + 2] = z;
          s.pos[k + 3] = x - s.base[b + 3] * lg; s.pos[k + 4] = y - s.base[b + 4] * lg; s.pos[k + 5] = z - s.base[b + 5] * lg;
        }
        (s.strie.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        s.mat.opacity = 0.85 * (s.vie / VIE_SOUFFLE_S);
      }
    },

    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      racine.removeFromParent();
    },
  };
}
