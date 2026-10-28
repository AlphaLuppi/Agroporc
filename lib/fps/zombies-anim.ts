/**
 * Animation d'un tigre zombie (sans three ni DOM) : le moteur de locomotion du tigre 3D (`lib/tigre3d/corps.ts` : pieds plantés au sol,
 * allure marche / trot / galop continue selon la vitesse) piloté par la vitesse mesurée du tigre, plus le geste court « griffe »
 * (`lib/tigre3d/gestes/griffe.ts`, 0,55 s) joué quand le drapeau « griffe armée » du snap passe à 1.
 *
 * Le corps marche de profil le long de +x de son propre repère (cap π/2) ; le rendu tourne le groupe de `cap + π/2` pour que +x devienne
 * l'avant du tigre dans l'arène (même convention que `tigre-geant.ts`). La vitesse du modèle est `min(3,2 ; v / échelle)` : au-delà, le
 * corps galoperait sur place.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Animation »)
 */
import { avancerCorps, creerCorps, GROUPES, type Corps, type Couche } from "../tigre3d/corps";
import { CONTACT_GRIFFE, griffe } from "../tigre3d/gestes/griffe";
import type { ContexteGeste, Geste } from "../tigre3d/gestes/types";
import { clipNomme } from "../tigre3d/clips";
import type { Groupe } from "../tigre3d/os";
import type { PoseTigre } from "../tigre3d/squelette";

/** Le corps ne suit pas des vitesses du modèle au-delà (m/s du modèle). */
export const VITESSE_MODELE_MAX = 3.2;
/** Vitesse de montée / de descente du poids du geste (1/s). */
const MONTEE_GESTE = 14;
const DESCENTE_GESTE = 7;

export interface AnimZombie {
  /**
   * Avance de `dt` secondes avec la vitesse mesurée `vitesse` (m/s de l'arène), l'échelle du modèle `echelle` et le drapeau de griffe armée.
   * Renvoie vrai à l'image où la griffe vient d'être lancée (front montant du drapeau : le rendu y joue le son).
   */
  maj(dt: number, vitesse: number, echelle: number, griffeArmee: boolean, avance?: number): boolean;
  pose(): PoseTigre;
  /** x du corps (repère du sol du modèle) à ramener à l'origine du groupe (`Tigre.appliquer`). */
  x(): number;
  /** Geste en cours (essais), null sinon. */
  geste(): Geste | null;
  /** Vitesse du modèle appliquée à la dernière image (m/s du modèle, essais). */
  vitesseModele(): number;
  /** Corps du moteur (essais : positions monde des os). */
  corps(): Corps;
}

/** Vitesse de marche du modèle (m/s) pour un tigre de l'arène à la vitesse `v` (m/s) et à l'échelle `echelle`. */
export function vitesseModele(v: number, echelle: number): number {
  return Math.min(VITESSE_MODELE_MAX, Math.abs(v) / Math.max(echelle, 1e-6));
}

const GROUPES_GRIFFE: ReadonlySet<Groupe> = new Set<Groupe>(["corps", "avD", "cou", "tete", "machoire", "oreilles", "queue"]);

export function creerAnimZombie(graine = 1): AnimZombie {
  const corps: Corps = creerCorps({ cap: Math.PI / 2, graine });
  const ctx: ContexteGeste = { sens: 1, tClap: null, tVexe: null, humeur: "grognon", clip: clipNomme, temps: 0 };
  let t = 0;
  let tGeste = 0;
  let gesteActif = false;
  let poidsGeste = 0;
  let drapeauAvant = false;
  let vModele = 0;

  return {
    maj(dt, vitesse, echelle, griffeArmee, avance = 0) {
      if (!(dt > 0)) return false;
      t += dt;
      ctx.temps = t;
      const lancee = griffeArmee && !drapeauAvant;
      drapeauAvant = griffeArmee;
      // `avance` : retard (s) de l'affichage des tigres sur le serveur (interpolation) ; le geste part d'autant plus loin pour que la patte
      // claque à l'écran quand le serveur touche (jamais au-delà de la moitié de l'armement : il reste lisible)
      if (lancee) { gesteActif = true; tGeste = Math.max(0, Math.min(avance, CONTACT_GRIFFE / 2)); }
      if (gesteActif) {
        tGeste += dt;
        if (tGeste >= griffe.duree) gesteActif = false;
      }
      poidsGeste = gesteActif ? Math.min(1, poidsGeste + MONTEE_GESTE * dt) : Math.max(0, poidsGeste - DESCENTE_GESTE * dt);
      const couches: Couche[] = [];
      if (poidsGeste > 0.001) {
        const p = griffe.echantillonner(Math.min(tGeste, griffe.duree), ctx);
        const poids = Object.fromEntries(GROUPES.map((g) => [g, GROUPES_GRIFFE.has(g) ? poidsGeste * (p.poids?.[g] ?? 1) : 0])) as Record<Groupe, number>;
        couches.push({ pose: p, poids });
      }
      vModele = vitesseModele(vitesse, echelle);
      avancerCorps(corps, dt, { vitesse: vModele, sens: 1, cap: Math.PI / 2, regard: 0, couches });
      return lancee;
    },
    pose: () => corps.pose,
    x: () => corps.x,
    geste: () => (gesteActif ? griffe : null),
    vitesseModele: () => vModele,
    corps: () => corps,
  };
}
