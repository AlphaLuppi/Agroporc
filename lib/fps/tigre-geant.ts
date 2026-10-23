/**
 * Animation du tigre robot géant et du titan (sans three ni DOM) : le moteur de locomotion du tigre 3D (`lib/tigre3d/corps.ts` : pieds
 * plantés au sol, allures continues, queue et oreilles à ressort) piloté par la vitesse du monstre, plus le geste « rugir »
 * (`lib/tigre3d/gestes/rugir.ts` : il se ramasse puis se projette, gueule ouverte) pendant le coup de patte et à son apparition.
 * Le corps marche de profil le long de +x de son propre repère (cap π/2 : museau du modèle, +Z, tourné vers +x) ; le rendu tourne le groupe
 * de `cap + π/2` pour que +x devienne l'avant du monstre dans l'arène.
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import { avancerCorps, creerCorps, GROUPES, type Corps, type Couche } from "../tigre3d/corps";
import { clipNomme } from "../tigre3d/clips";
import { rugir } from "../tigre3d/gestes/rugir";
import type { ContexteGeste, PoseGeste } from "../tigre3d/gestes/types";
import type { Groupe } from "../tigre3d/os";
import type { PoseTigre } from "../tigre3d/squelette";

/** Vitesse de montée / de descente du poids du geste (1/s). */
const MONTEE_GESTE = 6;
const DESCENTE_GESTE = 3;
/** Le corps ne suit pas des vitesses du modèle au-delà (m/s du modèle) : au-delà, il galoperait sur place. */
const VITESSE_MODELE_MAX = 3.2;

export interface AnimTigreGeant {
  /** `vitesse` du monstre (m/s, signée) et `echelle` (m de l'arène par m du modèle) ; `rugit` : coup de patte / cri en cours. */
  maj(dt: number, vitesse: number, echelle: number, rugit: boolean): void;
  pose(): PoseTigre;
  /** x du corps (repère du sol du modèle) à ramener à l'origine du groupe (`Tigre.appliquer`). */
  x(): number;
}

export function creerAnimTigreGeant(graine = 11): AnimTigreGeant {
  const corps: Corps = creerCorps({ cap: Math.PI / 2, graine });
  let t = 0;
  let t0Geste = -Infinity;
  let poidsGeste = 0;
  let rugitAvant = false;
  const ctx: ContexteGeste = { sens: 1, tClap: null, tVexe: null, humeur: "grognon", clip: clipNomme, temps: 0 };

  return {
    maj(dt, vitesse, echelle, rugit) {
      if (!(dt > 0)) return;
      t += dt;
      ctx.temps = t;
      // un nouveau cri relance le geste depuis le début
      if (rugit && !rugitAvant) t0Geste = t;
      rugitAvant = rugit;
      const tg = t - t0Geste;
      const actif = tg < rugir.duree;
      poidsGeste = actif
        ? Math.min(1, poidsGeste + MONTEE_GESTE * dt)
        : Math.max(0, poidsGeste - DESCENTE_GESTE * dt);
      const couches: Couche[] = [];
      if (poidsGeste > 0.001) {
        const p: PoseGeste = rugir.echantillonner(Math.min(tg, rugir.duree), ctx);
        const poids = Object.fromEntries(GROUPES.map((g) => [g, poidsGeste * (p.poids?.[g] ?? 1)])) as Record<Groupe, number>;
        couches.push({ pose: p, poids });
      }
      const vModele = Math.min(VITESSE_MODELE_MAX, Math.abs(vitesse) / Math.max(echelle, 1e-6));
      avancerCorps(corps, dt, { vitesse: vModele, sens: vitesse < -0.05 ? -1 : 1, cap: Math.PI / 2, regard: 0, couches });
    },
    pose: () => corps.pose,
    x: () => corps.x,
  };
}
