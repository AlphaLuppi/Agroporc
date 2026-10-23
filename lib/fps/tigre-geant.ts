/**
 * Animation du tigre robot géant et du titan (sans three ni DOM) : le moteur de locomotion du tigre 3D (`lib/tigre3d/corps.ts` : pieds
 * plantés au sol, allures continues, queue et oreilles à ressort) piloté par la vitesse du monstre, et par-dessus des gestes choisis
 * selon ce qu'il fait :
 * - coup de patte : « rugir » (il se ramasse puis se projette, gueule ouverte) ;
 * - saut : le bond du tigre 3D (pattes du clip « Attack jump »), étiré sur la durée du saut du serveur ;
 * - charge : il se ramasse, tête basse, queue qui fouette, puis galope (la locomotion suit la vitesse) ;
 * - laser armé : cabré, tête levée, gueule ouverte, il tremble ;
 * - à l'arrêt : il regarde autour, s'étire, se lèche, ronronne ou rugit, au hasard (jamais deux fois le même d'affilée) ;
 * - enragé : il grelotte et fouette de la queue en marchant.
 * Le corps marche de profil le long de +x de son propre repère (cap π/2 : museau du modèle, +Z, tourné vers +x) ; le rendu tourne le groupe
 * de `cap + π/2` pour que +x devienne l'avant du monstre dans l'arène.
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import { avancerCorps, creerCorps, GROUPES, type Corps, type Couche } from "../tigre3d/corps";
import { clipNomme } from "../tigre3d/clips";
import { etirement } from "../tigre3d/gestes/etirement";
import { lecher } from "../tigre3d/gestes/lecher";
import { gueule, oreilles, queue, tete } from "../tigre3d/gestes/outils";
import { regard } from "../tigre3d/gestes/regard";
import { ronron } from "../tigre3d/gestes/ronron";
import { rugir } from "../tigre3d/gestes/rugir";
import { saut } from "../tigre3d/gestes/saut";
import type { ContexteGeste, Geste, PoseGeste } from "../tigre3d/gestes/types";
import type { Groupe } from "../tigre3d/os";
import type { PoseTigre } from "../tigre3d/squelette";

/** Vitesse de montée / de descente du poids d'un geste (1/s). */
const MONTEE_GESTE = 6;
const DESCENTE_GESTE = 3;
/** Le corps ne suit pas des vitesses du modèle au-delà (m/s du modèle) : au-delà, il galoperait sur place. */
const VITESSE_MODELE_MAX = 3.2;
/** Durée (s) du saut côté serveur (`TIGRE_ROBOT.saut`) : le bond du tigre 3D (1 s) est étiré dessus. */
const DUREE_SAUT_S = 1.3;
/** Arrêt (s) avant un geste de repos, puis attente entre deux gestes (s, min + hasard). */
const REPOS_AVANT_S = 1.2;
const PAUSE_REPOS_S = { min: 1.2, plus: 2.5 } as const;
const GESTES_REPOS: readonly Geste[] = [regard, etirement, lecher, ronron, rugir];
/** Groupes du haut du corps (les poses maison ne touchent pas aux pattes : elles restent plantées). */
const HAUT: readonly Groupe[] = ["corps", "colonne", "cou", "tete", "machoire", "oreilles", "queue"];

export interface EtatAnimTigre {
  /** Attaque en cours (`TigreSnap.a`). */
  attaque?: "patte" | "saut" | "charge";
  /** Laser armé (0..1, 1 au tir). */
  laser: number;
  rage?: boolean;
}

export interface AnimTigreGeant {
  /** `vitesse` du monstre (m/s, signée) et `echelle` (m de l'arène par m du modèle). */
  maj(dt: number, vitesse: number, echelle: number, etat: EtatAnimTigre): void;
  pose(): PoseTigre;
  /** x du corps (repère du sol du modèle) à ramener à l'origine du groupe (`Tigre.appliquer`). */
  x(): number;
  /** Geste en cours (essais), null sinon. */
  geste(): Geste | null;
}

const lisser = (v: number, cible: number, dt: number, vitesse: number) =>
  v < cible ? Math.min(cible, v + vitesse * dt) : Math.max(cible, v - vitesse * dt);

const poidsHaut = (k: number) => Object.fromEntries(GROUPES.map((g) => [g, HAUT.includes(g) ? k : 0])) as Record<Groupe, number>;

/** Laser armé : cabré sur les hanches, tête levée, gueule ouverte, oreilles plaquées, il tremble de plus en plus. */
function poseLaser(k: number, t: number): PoseGeste {
  const deltas: NonNullable<PoseGeste["deltas"]> = {};
  const tremble = 0.02 * k * Math.sin(t * 47);
  tete(deltas, 0.05 * Math.sin(t * 2.3), tremble, -0.45 * k);
  gueule(deltas, 0.5 * k + tremble);
  oreilles(deltas, -0.7 * k);
  queue(deltas, 0.5 * k, 0, 0.2 * Math.sin(t * 6));
  return { corps: { tangage: 0.16 * k, dy: 0.02 * k, roulis: tremble, pivot: "hanches" }, deltas };
}

/** Charge, avant la ruée : il se ramasse, tête basse, croupe haute, queue qui fouette. */
function poseRamasse(k: number, t: number): PoseGeste {
  const deltas: NonNullable<PoseGeste["deltas"]> = {};
  tete(deltas, 0, 0, 0.4 * k);
  gueule(deltas, 0.18 * k);
  oreilles(deltas, -0.8 * k);
  queue(deltas, 0.35 * k, 0.6 * k * Math.sin(t * 9), 0.3 * k * Math.sin(t * 13));
  return { corps: { dy: -0.08 * k, tangage: -0.12 * k, dz: -0.03 * k, pivot: "epaules" }, deltas };
}

/** Rage : grelottement de tout le corps, queue nerveuse. */
function poseRage(k: number, t: number): PoseGeste {
  const deltas: NonNullable<PoseGeste["deltas"]> = {};
  const g = Math.sin(t * 31) * Math.sin(t * 7.3);
  tete(deltas, 0.12 * Math.sin(t * 1.7), 0.04 * g, 0.12);
  gueule(deltas, 0.12 + 0.08 * Math.max(0, Math.sin(t * 2.1)));
  queue(deltas, 0.2, 0.5 * Math.sin(t * 5), 0.25 * Math.sin(t * 11));
  return { corps: { roulis: 0.025 * g * k, dy: 0.008 * g * k }, deltas };
}

export function creerAnimTigreGeant(graine = 11): AnimTigreGeant {
  const corps: Corps = creerCorps({ cap: Math.PI / 2, graine });
  let t = 0;
  let geste: Geste | null = null;
  let tGeste = 0;
  let gesteActif = false;
  let poidsGeste = 0;
  let attaqueAvant: EtatAnimTigre["attaque"];
  /** temps passé à l'arrêt sans rien faire (négatif : pause après un geste de repos) */
  let repos = 0;
  let dernierRepos: Geste | null = null;
  let laserK = 0, ramasseK = 0, rageK = 0;
  // hasard propre (déterministe à graine égale)
  let h = graine * 9301 + 49297;
  const hasard = () => { h = (h * 9301 + 49297) % 233280; return h / 233280; };
  const ctx: ContexteGeste = { sens: 1, tClap: null, tVexe: null, humeur: "grognon", clip: clipNomme, temps: 0 };

  const lancer = (g: Geste) => { geste = g; tGeste = 0; gesteActif = true; };

  return {
    maj(dt, vitesse, echelle, e) {
      if (!(dt > 0)) return;
      t += dt;
      ctx.temps = t;
      const bouge = Math.abs(vitesse) > 0.6;
      // une nouvelle attaque lance son geste depuis le début
      if (e.attaque !== attaqueAvant) {
        if (e.attaque === "patte") lancer(rugir);
        else if (e.attaque === "saut") lancer(saut);
        attaqueAvant = e.attaque;
      }
      // geste de repos interrompu dès qu'il repart, attaque ou vise
      if (gesteActif && geste && geste.immobile && (bouge || e.attaque || e.laser > 0.05) && geste !== rugir) gesteActif = false;
      if (!e.attaque && !bouge && e.laser < 0.05) repos += dt; else repos = Math.min(repos, 0);
      if (!gesteActif && poidsGeste < 0.05 && repos > REPOS_AVANT_S) {
        const choix = GESTES_REPOS.filter((g) => g !== dernierRepos);
        const g = choix[Math.floor(hasard() * choix.length) % choix.length];
        dernierRepos = g;
        lancer(g);
        repos = -(g.duree + PAUSE_REPOS_S.min + hasard() * PAUSE_REPOS_S.plus);
      }
      if (gesteActif && geste) {
        tGeste += dt * (geste === saut ? saut.duree / DUREE_SAUT_S : 1);
        if (tGeste >= geste.duree) gesteActif = false;
      }
      poidsGeste = gesteActif ? Math.min(1, poidsGeste + MONTEE_GESTE * dt) : Math.max(0, poidsGeste - DESCENTE_GESTE * dt);
      laserK = lisser(laserK, e.laser > 0.05 ? Math.min(1, 0.4 + e.laser) : 0, dt, 4);
      ramasseK = lisser(ramasseK, e.attaque === "charge" && !bouge ? 1 : 0, dt, 5);
      rageK = lisser(rageK, e.rage ? 1 : 0, dt, 1);

      const couches: Couche[] = [];
      if (geste && poidsGeste > 0.001) {
        const p = geste.echantillonner(Math.min(tGeste, geste.duree), ctx);
        const poids = Object.fromEntries(GROUPES.map((g) => [g, poidsGeste * (p.poids?.[g] ?? 1)])) as Record<Groupe, number>;
        couches.push({ pose: p, poids });
      }
      if (laserK > 0.001) couches.push({ pose: poseLaser(laserK, t), poids: poidsHaut(laserK) });
      if (ramasseK > 0.001) couches.push({ pose: poseRamasse(ramasseK, t), poids: poidsHaut(ramasseK) });
      if (rageK > 0.001 && poidsGeste < 0.5) couches.push({ pose: poseRage(rageK, t), poids: poidsHaut(rageK * 0.8) });
      const vModele = Math.min(VITESSE_MODELE_MAX, Math.abs(vitesse) / Math.max(echelle, 1e-6));
      avancerCorps(corps, dt, { vitesse: vModele, sens: vitesse < -0.05 ? -1 : 1, cap: Math.PI / 2, regard: 0, couches });
    },
    pose: () => corps.pose,
    x: () => corps.x,
    geste: () => (gesteActif ? geste : null),
  };
}
