/**
 * Format d'un geste du tigre 3D (pur). Un geste = un module `lib/tigre3d/gestes/<nom>.ts` qui
 * exporte un `Geste` : durée, événements (bulle, particules, secousse) à des instants donnés, et
 * `echantillonner(t, ctx)` qui rend une `PoseGeste` à l'instant t (secondes depuis le début du
 * geste, une fois le tigre arrêté et tourné si `immobile`).
 *
 * Une `PoseGeste` ne remplace pas le tigre : elle se pose PAR-DESSUS la locomotion, groupe d'os
 * par groupe d'os (cf. `Groupe` dans lib/tigre3d/os.ts), avec un poids qui suit sa cible par un
 * ressort (entrée et sortie sans cassure). Ce qui n'est pas touché par le geste continue de vivre
 * (queue, oreilles, respiration, pattes plantées par l'IK).
 *
 * Repères :
 * - « repère du modèle au repos » : museau +Z, haut +Y, gauche du tigre +X, mètres du modèle
 *   (1,104 m du museau au bout de la queue) ; positions de repos dans lib/tigre3d/donnees/squelette.json
 *   (ou `reposDe(squelette(), role)`).
 * - « repère du corps » : le même, mais qui suit la racine posée (position, cap, tangage du corps
 *   APRÈS `corps`). Une cible de patte à la position de repos du poignet = patte à sa place.
 */
import type { Groupe, Patte, Role } from "../os";
import type { GenreParticule, HumeurRegard } from "../../tigre-reactions";

export type Vec3 = readonly [number, number, number];
/** Quaternion [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

export interface PoseGeste {
  /**
   * Corps entier, AVANT l'IK (les pattes en appui restent plantées) : `dy` / `dz` = décalage
   * (m, vertical / vers l'avant du tigre), `tangage` (rad, > 0 = cabré, museau vers le haut),
   * `roulis` (rad, > 0 = penché sur sa droite), `lacet` (rad, > 0 = vers sa gauche), autour de
   * `pivot` (défaut : la racine, au milieu du corps ; « hanches » pour se cabrer, « epaules »
   * pour lever l'arrière-train).
   */
  corps?: { dy?: number; dz?: number; tangage?: number; roulis?: number; lacet?: number; pivot?: "centre" | "hanches" | "epaules" };
  /** Rotations ajoutées (rad, [x, y, z] appliqués dans cet ordre) en repère du modèle au repos. */
  deltas?: Partial<Record<Role, Vec3>>;
  /** Rotations LOCALES absolues (quaternions, repère du parent) : clips d'images issus du GLB. */
  os?: Partial<Record<Role, Quat>>;
  /** Translations LOCALES absolues (unités de l'armature) : clips du GLB seulement. */
  t?: Partial<Record<Role, Vec3>>;
  /**
   * Patte levée : `cible` = position du poignet (avant) ou de la cheville (arrière) en repère du
   * corps ; `extremite` = rotation ajoutée de la main / du pied (rad, repère du modèle au repos).
   * Une patte dont le groupe a un poids > 0 n'est plus en appui (la locomotion la lâche).
   */
  pattes?: Partial<Record<Patte, { cible: Vec3; extremite?: Vec3 }>>;
  /** Le tigre regarde la caméra (0..1) : tête et cou tournés vers nous, quel que soit le cap. */
  regard?: number;
  /** Avance cumulée depuis le début du geste (m, vers l'avant du tigre) : le saut avance la troupe. */
  avance?: number;
  /**
   * Pose capturée (clip de mocap) : le moteur n'y ajoute pas son bruit lent de tête ni le balancement
   * de queue, au prorata du poids des groupes tête / queue (la capture est rendue telle quelle).
   */
  brut?: boolean;
  /** Poids par groupe (0..1) ; défaut : 1 pour chaque groupe touché par la pose. */
  poids?: Partial<Record<Groupe, number>>;
}

export type EvenementGeste =
  /** Bulle : `texte` / `duree` (s) propres à l'événement, sinon le texte tiré pour la réaction, jusqu'à la fin du geste. */
  | { t: number; type: "bulle"; texte?: string; duree?: number }
  | { t: number; type: "particules"; genre: GenreParticule; nombre: number }
  | { t: number; type: "secousse"; duree: number }
  /**
   * Volte-face (sursaut) : à cet instant, le lacet que le geste a donné au corps (`corps.lacet`,
   * tour sur lui-même en l'air) est reporté sur les caps du corps et le sens de course s'inverse ;
   * dès cet instant le geste doit rendre `corps.lacet` = 0 (rien ne bouge à l'écran). Le tigre
   * retombe ainsi déjà tourné, prêt à fuir, sans piétiner un demi-tour.
   */
  | { t: number; type: "volteface" }
  /** Coup de batte : la batte touche Macron (l'animateur émet l'événement « impact »). */
  | { t: number; type: "impact" };

/** Clip d'images : une pose par image, interpolée (cf. lib/tigre3d/clips.ts). */
export interface ClipImages {
  nom: string;
  /** Images par seconde. */
  fps: number;
  images: PoseGeste[];
}

export interface ContexteGeste {
  /** Sens de course : 1 = vers la droite de l'écran, -1 = vers la gauche. */
  sens: 1 | -1;
  /**
   * Tape : instant (s depuis le début du geste) du second clic (« Clap ! ») ou de l'abandon (vexé).
   * Batte : instant du signal de frappe (`tClap`) ou de l'abandon de l'embuscade (`tVexe`).
   */
  tClap: number | null;
  tVexe: number | null;
  humeur: HumeurRegard;
  /** Clip nommé (GLB : « Curious », « Trick », « Attack jump », « Walking » ; ou clips/*.json), null s'il n'est pas chargé. */
  clip(nom: string): ClipImages | null;
  /** Horloge globale de l'animateur (s) : bruit, variations. */
  temps: number;
}

export interface Geste {
  /** Durée (s) ; la tape la prolonge selon le clic (gérée par l'animateur). */
  duree: number;
  /** Le tigre s'arrête (et se tourne vers nous) avant de jouer le geste. */
  immobile: boolean;
  /** Le tigre freine pendant le geste, sans attendre d'être arrêté pour le commencer (sursaut). */
  freine?: boolean;
  /**
   * Cap pendant le geste (rad, 0 = face à la caméra, sens·π/2 = profil dans le sens de course) ;
   * défaut : légèrement de trois quarts (sens · 0,25).
   */
  cap?(sens: 1 | -1): number;
  /**
   * La bulle vient dès que le tigre s'est arrêté, sans attendre qu'il ait fini de se tourner vers
   * nous (le texte nous répond : « Quoi ? », « Coucou ! », « Tope là ! ») : retour rapide au clic.
   * La bulle du geste la prolonge ensuite au lieu de la rouvrir.
   */
  bulleTot?: boolean;
  /** Instants (s depuis le début du geste) des événements ; défaut : la bulle à DELAI_BULLE. */
  evenements?: readonly EvenementGeste[];
  /**
   * Événements datés depuis le SIGNAL du geste (`ctx.tClap`, posé par l'animateur : coup de batte
   * lancé par la rencontre), émis une fois le signal reçu. La bulle y porte son propre texte.
   */
  evenementsSignal?: readonly EvenementGeste[];
  /** Signal accepté à partir de cet instant (s depuis le début du geste : batte armée). */
  pret?: number;
  /** Fin du geste après le signal (s) et après une interruption (s). */
  dureeApresSignal?: number;
  dureeInterruption?: number;
  echantillonner(t: number, ctx: ContexteGeste): PoseGeste;
}
