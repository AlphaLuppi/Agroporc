/**
 * Os du tigre 3D par rôle : le GLB (public/tigre/tigre.glb, « Stylized Bengal Tiger » de Jungle
 * Jim, CC BY 4.0) a des noms d'os génériques (Bone004_019…) ; tout le reste du code passe par ces
 * rôles. Pur (aucune dépendance) ; lib/tigre3d/squelette.test.ts vérifie que chaque nom existe
 * dans le GLB.
 *
 * Repère du modèle : museau vers +Z, haut +Y, gauche DU TIGRE = +X ; pieds à y = 0 ; mètres.
 * G / D = côté du tigre (sa gauche est à droite de l'image quand il nous fait face).
 */

/** Rôle → nom de l'os dans three (GLTFLoader retire les points des noms glTF). */
export const NOMS_OS = {
  racine: "_rootJoint",
  thorax: "Bone_01",
  lombaires: "Bone001_02",
  hancheG: "Bone005_03", cuisseG: "Bone006_04", jarretG: "Bone007_05", piedG: "Bone008_06", bout_piedG: "Bone008_end_029",
  hancheD: "Bone025_013", cuisseD: "Bone026_014", jarretD: "Bone027_015", piedD: "Bone028_016", bout_piedD: "Bone028_end_031",
  queue1: "Bone009_07", queue2: "Bone010_08", queue3: "Bone011_09", queue4: "Bone012_010", queue5: "Bone013_011",
  queue6: "Bone014_012", bout_queue: "Bone014_end_030",
  epauleG: "Bone002_017", brasG: "Bone003_018", mainG: "Bone004_019", bout_mainG: "Bone004_end_032",
  epauleD: "Bone022_026", brasD: "Bone023_027", mainD: "Bone024_028", bout_mainD: "Bone024_end_037",
  cou: "Bone015_020",
  tete: "Bone017_00", bout_tete: "Bone017_end_034",
  machoire: "Bone016_021", bout_machoire: "Bone016_end_033",
  oreilleG: "Bone018_022", oreille_boutG: "Bone019_023", oreille_pointeG: "Bone019_end_035",
  oreilleD: "Bone020_024", oreille_boutD: "Bone021_025", oreille_pointeD: "Bone021_end_036",
} as const;

export type Role = keyof typeof NOMS_OS;
export const ROLES = Object.keys(NOMS_OS) as Role[];

/** Les quatre pattes : av = avant, ar = arrière. */
export type Patte = "avG" | "avD" | "arG" | "arD";
export const PATTES: readonly Patte[] = ["avG", "avD", "arG", "arD"];

export interface DefPatte {
  avant: boolean;
  /** +1 à gauche (x > 0), -1 à droite. */
  cote: 1 | -1;
  /** Chaîne IK à 2 os : racine de la chaîne, os du milieu. */
  haut: Role;
  bas: Role;
  /** Os posé au sol (main / pied) et son extrémité (bout des doigts / orteils). */
  extremite: Role;
  bout: Role;
}

/**
 * Patte avant : `epaule` (rachis → articulation de l'épaule) + `bras` (épaule → poignet, un seul
 * os, pas de coude) + `main` à plat. Patte arrière : `cuisse` + `jarret` + `pied` à plat (la
 * `hanche`, du rachis à la hanche, ne bouge qu'avec le bassin).
 */
export const DEF_PATTES: Record<Patte, DefPatte> = {
  avG: { avant: true, cote: 1, haut: "epauleG", bas: "brasG", extremite: "mainG", bout: "bout_mainG" },
  avD: { avant: true, cote: -1, haut: "epauleD", bas: "brasD", extremite: "mainD", bout: "bout_mainD" },
  arG: { avant: false, cote: 1, haut: "cuisseG", bas: "jarretG", extremite: "piedG", bout: "bout_piedG" },
  arD: { avant: false, cote: -1, haut: "cuisseD", bas: "jarretD", extremite: "piedD", bout: "bout_piedD" },
};

/** Os de la tête : pas d'os parent commun, quatre frères au même pivot, enfants du cou. */
export const OS_TETE: readonly Role[] = ["tete", "machoire", "oreilleG", "oreilleD"];
export const OS_QUEUE: readonly Role[] = ["queue1", "queue2", "queue3", "queue4", "queue5", "queue6"];

/**
 * Groupes d'os : chaque couche de pose (geste, clip) a un poids par groupe, qui suit sa cible par
 * un ressort de raideur propre (tête vive, corps lent, queue très lente).
 */
export type Groupe = "corps" | "colonne" | "cou" | "tete" | "machoire" | "oreilles" | "queue" | Patte;
export const GROUPES: readonly Groupe[] = ["corps", "colonne", "cou", "tete", "machoire", "oreilles", "queue", "avG", "avD", "arG", "arD"];

export const GROUPE_DE: Record<Role, Groupe> = {
  racine: "corps",
  thorax: "colonne", lombaires: "colonne",
  hancheG: "arG", cuisseG: "arG", jarretG: "arG", piedG: "arG", bout_piedG: "arG",
  hancheD: "arD", cuisseD: "arD", jarretD: "arD", piedD: "arD", bout_piedD: "arD",
  queue1: "queue", queue2: "queue", queue3: "queue", queue4: "queue", queue5: "queue", queue6: "queue", bout_queue: "queue",
  epauleG: "avG", brasG: "avG", mainG: "avG", bout_mainG: "avG",
  epauleD: "avD", brasD: "avD", mainD: "avD", bout_mainD: "avD",
  cou: "cou",
  tete: "tete", bout_tete: "tete",
  machoire: "machoire", bout_machoire: "machoire",
  oreilleG: "oreilles", oreille_boutG: "oreilles", oreille_pointeG: "oreilles",
  oreilleD: "oreilles", oreille_boutD: "oreilles", oreille_pointeD: "oreilles",
};

/** Rôle symétrique (G ↔ D), pour écrire un geste d'un côté et le jouer de l'autre. */
export function miroir(r: Role): Role {
  if (r.endsWith("G")) return (r.slice(0, -1) + "D") as Role;
  if (r.endsWith("D")) return (r.slice(0, -1) + "G") as Role;
  return r;
}
export function patteMiroir(p: Patte): Patte {
  return (p.slice(0, 2) + (p.endsWith("G") ? "D" : "G")) as Patte;
}

/** Longueur du modèle (museau → bout de la queue, m) : un tigre « adulte » de 3,75 m = ×3,397. */
export const LONGUEUR_MODELE_M = 1.104;
