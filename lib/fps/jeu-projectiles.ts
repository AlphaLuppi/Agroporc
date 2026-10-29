/**
 * Projectiles d'arme côté client (PUR, testé : ni three, ni DOM, ni réseau), v8 : grenades de Moutarde & Sally, pique de la Brochette.
 *
 * Le mien est prédit dès le tir (même trajectoire que le serveur sans les tigres, `preparerProjectile` de effets-armes.ts), puis remplacé
 * par celui du serveur à la réception de `projectile` (o, v, t0, impactT, impact, explosionT font foi) ; ceux des autres arrivent par
 * `projectile`. Un projectile planté dans un tigre suit ce tigre (`cible`) tant que le tigre est affiché. Il disparaît à son
 * `zevt{projectile}` (ou, faute de message, 1,5 s après son échéance ; une prédiction jamais confirmée, 1,5 s après le tir).
 * Instants en ms de l'horloge du SERVEUR (`client.maintenantServeur()`).
 */
import type { Monde } from "./collision";
import { positionProjectile, preparerProjectile, trajectoireProjectile } from "./effets-armes";
import type { Plafond, Trajectoire } from "./grenades";
import type { ArmeFeuId, MessageServeur, Vec3 } from "./protocole";

/** Une prédiction non confirmée au bout de ce délai (ms) est abandonnée (tir refusé). */
export const PREDICTION_PROJECTILE_MAX_MS = 1_500;
/** Un projectile dont l'explosion n'est jamais annoncée disparaît ce délai (ms) après son échéance. */
export const EXPLOSION_PROJECTILE_MAX_MS = 1_500;

export interface ProjectileVue {
  /** id serveur, ou négatif pour une prédiction locale */
  id: number;
  arme: ArmeFeuId;
  ameliore: boolean;
  par: string;
  t0: number;
  impactT: number;
  explosionT: number;
  traj: Trajectoire;
  impact?: Vec3;
  /** tigre où il est planté (numéro, sans le « z ») */
  cible?: number;
  predit: boolean;
}

/** Ce qu'il faut dessiner d'un projectile. */
export interface ProjectileAffiche {
  id: number;
  arme: ArmeFeuId;
  ameliore: boolean;
  p: Vec3;
  /** direction du vol (normalisée), gardée une fois planté */
  dir: Vec3;
  plante: boolean;
  /** 0..1 entre l'impact et l'explosion (le carreau qui clignote), 0 en vol */
  attente: number;
  /** tigre où il est planté */
  cible?: number;
}

export interface ControleurProjectiles {
  predire(arme: ArmeFeuId, ameliore: boolean, o: Vec3, d: Vec3, tServeur: number, moi: string): ProjectileVue | null;
  recevoir(m: Extract<MessageServeur, { t: "projectile" }>, moi: string): ProjectileVue | null;
  exploser(id: number): ProjectileVue | undefined;
  /** projectiles à dessiner à l'instant serveur `t` ; `positionTigre` : où est affiché un tigre (null s'il ne l'est plus) */
  affiches(t: number, positionTigre?: (id: number) => Vec3 | null): ProjectileAffiche[];
  vider(): void;
}

const normer = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function creerControleurProjectiles(monde: Monde, plafond?: Plafond): ControleurProjectiles {
  const vues: ProjectileVue[] = [];
  let idPredit = 0;

  return {
    predire(arme, ameliore, o, d, tServeur, moi) {
      const tir = preparerProjectile(monde, arme, ameliore, o, d, tServeur, { plafond });
      if (!tir) return null;
      const v: ProjectileVue = {
        id: -(++idPredit), arme, ameliore, par: moi, t0: tir.t0, impactT: tir.impactT, explosionT: tir.explosionT, traj: tir.traj, predit: true,
      };
      vues.push(v);
      return v;
    },

    recevoir(m, moi) {
      if (m.par === moi) {
        const i = vues.findIndex((x) => x.predit && x.arme === m.arme);
        if (i >= 0) vues.splice(i, 1);
      }
      const existant = vues.findIndex((x) => !x.predit && x.id === m.id);
      if (existant >= 0) vues.splice(existant, 1);
      const traj = trajectoireProjectile(monde, m, { plafond });
      if (!traj) return null;
      const cible = m.cible && /^z\d+$/.test(m.cible) ? Number(m.cible.slice(1)) : undefined;
      const v: ProjectileVue = {
        id: m.id, arme: m.arme, ameliore: m.ameliore === true, par: m.par, t0: m.t0, impactT: m.impactT, explosionT: m.explosionT, traj,
        impact: m.impact, ...(cible !== undefined ? { cible } : {}), predit: false,
      };
      vues.push(v);
      return v;
    },

    exploser(id) {
      const i = vues.findIndex((x) => !x.predit && x.id === id);
      return i < 0 ? undefined : vues.splice(i, 1)[0];
    },

    affiches(t, positionTigre) {
      for (let i = vues.length - 1; i >= 0; i--) {
        const v = vues[i];
        if ((v.predit && t - v.t0 > PREDICTION_PROJECTILE_MAX_MS) || t - v.explosionT > EXPLOSION_PROJECTILE_MAX_MS) vues.splice(i, 1);
      }
      return vues.map((v) => {
        const plante = t >= v.impactT;
        const tv = Math.min(t, v.impactT);
        let p = positionProjectile(v.traj, v.t0, v.impactT, t, v.impact);
        const avant = positionProjectile(v.traj, v.t0, v.impactT, Math.max(v.t0, tv - 30));
        const apres = positionProjectile(v.traj, v.t0, v.impactT, tv);
        let dir = normer([apres[0] - avant[0], apres[1] - avant[1], apres[2] - avant[2]]);
        if (!Number.isFinite(dir[0]) || (dir[0] === 0 && dir[1] === 0 && dir[2] === 0)) dir = [0, 0, -1];
        if (plante && v.cible !== undefined && positionTigre) {
          const q = positionTigre(v.cible);
          if (q && v.impact) p = [q[0], v.impact[1], q[2]];
        }
        const duree = v.explosionT - v.impactT;
        const attente = plante && duree > 0 ? Math.min(1, (t - v.impactT) / duree) : 0;
        return { id: v.id, arme: v.arme, ameliore: v.ameliore, p, dir, plante, attente, ...(v.cible !== undefined ? { cible: v.cible } : {}) };
      });
    },

    vider() { vues.length = 0; },
  };
}
