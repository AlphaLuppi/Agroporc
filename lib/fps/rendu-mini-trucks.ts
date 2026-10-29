/**
 * Mini Trucks Muche des manches de livraison (three, mode zombies) : les ennemis de type 4, qui foncent sur les joueurs et sautent (les chiens
 * de feu de BO1). Chacun est le Truck Muche de `creerModeleTruckMuche` réduit à `ECHELLE_MODELE` (2,2 m de long, la forme de touche
 * `FORME_MINI_TRUCK` et le corps `capsuleTigre` à l'échelle 3), roues qui tournent selon la vitesse mesurée, phares rouges qui percent le
 * brouillard, caisse qui tressaute, et, mèche allumée (drapeau « griffe » du snap), phares qui clignotent et caisse qui tremble. Pool créé à
 * la demande (un modèle par image au plus), jamais plus que le plafond de 24 ennemis. Les sons (klaxon aigu, mèche) passent par les rappels.
 * Aucun test vitest (three) : la logique est dans `zombies.ts` et `jeu-zombies.ts`, les régressions se voient aux captures.
 */
import * as THREE from "three";
import { tigreAffiche, type ZombieVue } from "./jeu-zombies";
import type { Vec3 } from "./protocole";
import { creerModeleTruckMuche, type ModeleTruckMuche } from "./rendu-monde";
import { ZOMBIES } from "./zombies-vagues";

/** Le Truck Muche (7,4 m) réduit à 2,2 m. */
export const ECHELLE_MODELE = 0.3;
/** Fil de fer rouge vif : enragé, et distinct du Truck (ambre). */
const COULEUR_MINI = 0xff4a2e;
/** Klaxon d'un mini Truck lancé : toutes les 1,4 à 3,2 s (au hasard, pour qu'ils ne klaxonnent pas en chœur). */
const KLAXON_MIN_S = 1.4;
const KLAXON_MAX_S = 3.2;
/** Apparition sous l'éclair : il grandit en ce temps (s). */
const APPARITION_S = 0.22;

export interface RappelsMiniTrucks {
  /** Un mini Truck klaxonne (en fonçant) ou allume sa mèche (front montant du drapeau) : le jeu joue le klaxon aigu. */
  klaxon(v: ZombieVue, meche: boolean): void;
}

export interface RenduMiniTrucks {
  /** Pose les mini Trucks parmi les `n` premiers ennemis interpolés ; `cam`, `regard` : culling ; `dt` en secondes. */
  maj(zombies: readonly ZombieVue[], n: number, cam: Vec3, regardX: number, regardZ: number, dt: number, rappels?: RappelsMiniTrucks): void;
  /** Le mini Truck `id` vient de sauter ou d'être abattu : il disparaît (l'explosion est jouée par le jeu). */
  mort(id: number): void;
  /** Mini Trucks dessinés à la dernière image (essais). */
  affiches(): number;
  dispose(): void;
}

interface Emplacement {
  modele: ModeleTruckMuche;
  id: number;
  vu: boolean;
  age: number;
  klaxonDans: number;
  mechePrec: boolean;
  phase: number;
}

export function creerRenduMiniTrucks(scene: THREE.Scene): RenduMiniTrucks {
  const racine = new THREE.Group();
  racine.name = "mini-trucks";
  scene.add(racine);
  const pool: Emplacement[] = [];
  const parId = new Map<number, Emplacement>();
  const morts = new Map<number, number>();
  let temps = 0;
  let nAffiches = 0;

  function creer(): Emplacement {
    // faisceaux de 16 m à l'échelle du monde : 53 m du modèle réduit
    const modele = creerModeleTruckMuche({ roues: true, phares: true, couleur: COULEUR_MINI, longueurFaisceau: 9 / ECHELLE_MODELE });
    modele.group.scale.setScalar(ECHELLE_MODELE);
    modele.group.visible = false;
    racine.add(modele.group);
    const e: Emplacement = { modele, id: 0, vu: false, age: 0, klaxonDans: 0, mechePrec: false, phase: Math.random() * 10 };
    pool.push(e);
    return e;
  }

  return {
    maj(zombies, n, cam, regardX, regardZ, dt, rappels) {
      temps += dt;
      nAffiches = 0;
      for (const e of pool) e.vu = false;
      for (const [id, t] of morts) if (temps - t > 3) morts.delete(id);
      let crees = 0;
      for (let i = 0; i < n; i++) {
        const v = zombies[i];
        if (v.type !== 4 || morts.has(v.id)) continue;
        let e = parId.get(v.id);
        if (!e) {
          e = pool.find((x) => x.id === 0) ?? (crees++ < 1 && pool.length < ZOMBIES.plafondVivants ? creer() : undefined);
          if (!e) continue;
          e.id = v.id;
          e.age = 0;
          e.klaxonDans = 0.3 + Math.random() * KLAXON_MIN_S;
          e.mechePrec = v.griffe;
          parId.set(v.id, e);
        }
        e.vu = true;
        e.age += dt;
        // sons : klaxon en fonçant, coups pressés à la mèche (même hors champ)
        if (v.griffe && !e.mechePrec) rappels?.klaxon(v, true);
        e.mechePrec = v.griffe;
        e.klaxonDans -= dt;
        if (e.klaxonDans <= 0 && !v.griffe) {
          e.klaxonDans = KLAXON_MIN_S + Math.random() * (KLAXON_MAX_S - KLAXON_MIN_S);
          rappels?.klaxon(v, false);
        }
        const g = e.modele.group;
        const affiche = tigreAffiche(cam, regardX, regardZ, v.x, v.z);
        g.visible = affiche;
        if (!affiche) continue;
        nAffiches++;
        // caisse qui tressaute sur ses amortisseurs, tremble mèche allumée ; il grandit sous l'éclair
        const k = Math.min(1, e.age / APPARITION_S);
        const tremble = v.griffe ? 0.05 : 0;
        g.position.set(v.x + (Math.random() - 0.5) * tremble, 0.03 * Math.abs(Math.sin(temps * 17 + e.phase)) * Math.min(1, v.vitesse / 6), v.z + (Math.random() - 0.5) * tremble);
        g.rotation.set(Math.sin(temps * 13 + e.phase) * 0.025 * Math.min(1, v.vitesse / 6), v.cap, Math.sin(temps * 9 + e.phase) * 0.03);
        g.scale.setScalar(ECHELLE_MODELE * (0.3 + 0.7 * k));
        // roues : avance / rayon (à l'échelle du modèle)
        const rot = (v.vitesse * dt) / (e.modele.rayonRoue * ECHELLE_MODELE);
        for (const r of e.modele.roues) r.rotation.x -= rot;
        // phares : mèche allumée, ils clignotent à 12 Hz
        e.modele.phares?.intensite(v.griffe ? (Math.sin(temps * 75) > 0 ? 2.2 : 0.3) : 1);
      }
      // ceux qui ne sont plus dans les snaps rendent leur emplacement
      for (const e of pool) {
        if (e.vu || e.id === 0) continue;
        parId.delete(e.id);
        e.id = 0;
        e.modele.group.visible = false;
      }
    },
    mort(id) {
      morts.set(id, temps);
      const e = parId.get(id);
      if (!e) return;
      parId.delete(id);
      e.id = 0;
      e.modele.group.visible = false;
    },
    affiches() {
      return nAffiches;
    },
    dispose() {
      scene.remove(racine);
      for (const e of pool) e.modele.dispose();
      pool.length = 0;
      parId.clear();
    },
  };
}
