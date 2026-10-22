/**
 * Arène FPS de la vue Palantir : types partagés client ↔ serveur (PUR, aucun import three ni DOM).
 * Messages JSON sur WebSocket, champ `t` = type. Repère de scene.json : x vers l'est, z vers le
 * sud, y vers le haut, en mètres. Une position de joueur = ses PIEDS. Angles en radians :
 * `lacet` (yaw) autour de y, 0 = regard vers −z (convention three : caméra.rotation.y),
 * `tangage` (pitch) dans [−π/2, π/2], positif = regard vers le haut.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md
 */

export const VERSION_PROTOCOLE = 1;

export type Vec3 = [number, number, number];

export type ArmeId = "pistolet" | "mitraillette" | "pompe" | "sniper";
export const ARMES: readonly ArmeId[] = ["pistolet", "mitraillette", "pompe", "sniper"];

/** Zone touchée : la tête multiplie les dégâts (cf. lib/fps/armes.ts). */
export type Zone = "tete" | "corps";

/** Posture transmise pour l'animation des avatars distants. */
export type Posture = "sol" | "air" | "mur" | "mort";

/** Côté du mur pendant un wall-run (pour pencher l'avatar distant). */
export type CoteMur = -1 | 0 | 1;

/** Joueur tel que vu par tout le monde (présence + tableau des scores). */
export interface JoueurPublic {
  id: string;
  pseudo: string;
  /** couleur hex "#rrggbb" attribuée par le serveur */
  couleur: string;
  /** dans l'arène (sinon simple spectateur de la vue Palantir) */
  enJeu: boolean;
  kills: number;
  morts: number;
  /** ms, dernière mesure */
  ping: number;
}

/** État d'un joueur en jeu dans un instantané (≈ 20 Hz). */
export interface EtatJoueurSnap {
  id: string;
  p: Vec3;
  v: Vec3;
  lacet: number;
  tangage: number;
  posture: Posture;
  mur: CoteMur;
  arme: ArmeId;
  pv: number;
  vivant: boolean;
  /** invulnérable (protection d'apparition) */
  protege: boolean;
}

export interface InfoMatch {
  /** identifiant croissant du match */
  numero: number;
  /** horodatage serveur (ms epoch) de fin prévue ; null pendant l'entracte */
  fin: number | null;
  /** kills pour gagner */
  objectif: number;
  /** "jeu" ou "entracte" (classement affiché, nouveau match à `prochain`) */
  phase: "jeu" | "entracte";
  /** horodatage serveur du prochain match pendant l'entracte */
  prochain: number | null;
}

export interface LigneClassement { id: string; pseudo: string; couleur: string; kills: number; morts: number }

// ---------- client → serveur ----------

export type MessageClient =
  /** Premier message obligatoire : présence dans la vue Palantir (spectateur). */
  | { t: "bonjour"; v: number; pseudo: string }
  /** Entrer dans l'arène avec une arme. */
  | { t: "rejoindre"; arme: ArmeId }
  /** Changer de pseudo (lobby ou en pleine partie) : le serveur le nettoie, le dédoublonne et renvoie la présence. */
  | { t: "pseudo"; pseudo: string }
  /** Sortir de l'arène (redevient spectateur). */
  | { t: "quitter" }
  /** Arme pour la prochaine apparition (immédiate si mort). */
  | { t: "arme"; arme: ArmeId }
  /** État prédit localement, ≈ 30 Hz. `seq` croissant. */
  | { t: "etat"; seq: number; p: Vec3; v: Vec3; lacet: number; tangage: number; posture: Posture; mur: CoteMur }
  /**
   * Un tir (une pression de détente ; plusieurs plombs pour le fusil à pompe).
   * `o` = œil du tireur, `d` = direction normalisée de chaque plomb (1 pour les autres armes),
   * `touches` = plombs qui ont touché un joueur selon le client (index dans `d`).
   */
  | { t: "tir"; arme: ArmeId; o: Vec3; d: Vec3[]; touches: { cible: string; zone: Zone; plomb: number }[] }
  | { t: "ping"; t0: number };

// ---------- serveur → client ----------

export type MessageServeur =
  | { t: "bienvenue"; id: string; couleur: string; joueurs: JoueurPublic[]; match: InfoMatch; maintenant: number }
  /** Liste complète des connectés, renvoyée à chaque changement (arrivée, départ, score, entrée/sortie d'arène). */
  | { t: "presence"; joueurs: JoueurPublic[] }
  /** Instantané des joueurs en jeu ; `ts` = horodatage serveur ms. */
  | { t: "snap"; ts: number; j: EtatJoueurSnap[] }
  /** Apparition (ou réapparition) d'un joueur : le client concerné SE TÉLÉPORTE à `p`. */
  | { t: "apparition"; id: string; p: Vec3; lacet: number; arme: ArmeId; pv: number }
  /** Tir d'un autre joueur, pour les traçantes et le son (pas renvoyé au tireur). */
  | { t: "tir"; id: string; arme: ArmeId; o: Vec3; d: Vec3[] }
  | { t: "degats"; cible: string; par: string; degats: number; pv: number; zone: Zone }
  | { t: "mort"; cible: string; par: string; arme: ArmeId; zone: Zone; /** ms avant réapparition */ delai: number }
  | { t: "match"; match: InfoMatch; classement: LigneClassement[] }
  | { t: "pong"; t0: number; maintenant: number }
  | { t: "erreur"; code: "plein" | "version" | "pseudo" | "flood"; message: string };

/** Constantes de jeu partagées client/serveur. */
export const JEU = {
  pvMax: 100,
  delaiReapparitionMs: 3000,
  protectionMs: 1500,
  dureeMatchMs: 8 * 60_000,
  objectifKills: 25,
  entracteMs: 12_000,
  joueursMax: 16,
  /** fréquence des instantanés serveur */
  snapHz: 20,
  /** fréquence d'envoi de l'état client */
  etatHz: 30,
  /** retard d'interpolation des joueurs distants */
  interpolationMs: 110,
} as const;

/** Silhouette (hitbox) partagée : pieds en p, tête = sphère, corps = capsule verticale. */
export const SILHOUETTE = {
  rayon: 0.4,
  hauteur: 1.8,
  oeil: 1.62,
  tete: { y: 1.6, rayon: 0.24 },
  corps: { y0: 0.15, y1: 1.38, rayon: 0.38 },
} as const;
