/**
 * Viseurs choisis pour les armes à feu de l'arène et du Battle Royale (PUR : ni DOM ni three, stockage injecté). Un viseur se pose sur
 * l'arme par arme : aucun (la mire métallique), point rouge, holographique, lunette ×2 ou ×4 selon l'arme ; le sniper garde sa lunette
 * (3 niveaux, `STATS.sniper.zooms`) et n'a pas de choix. Le choix est un confort du JOUEUR qui tire : le serveur ne simule pas la visée
 * (tout part de l'axe du réticule, aucune dispersion nouvelle, `dispersionTir` ne dépend que de `hanche`, propre au sniper) et ne lit ni
 * `zooms` ni `viseur`. Aucun message, aucun champ de `Equipement` : mémorisé dans `localStorage` `pdj-fps-viseurs`, annoncé au jeu en cours
 * par l'événement `pdj-fps-viseurs` de `window`. Les autres joueurs ne voient pas le viseur (cosmétique local). En zombies, les armes gratinées
 * ont leur propre viseur (`Arme.zombie.ameliore.viseur`) : ce choix n'y est pas appliqué.
 * Le jeu relit ce choix par `avecViseur` (`statsMoi` de jeu.ts) : viseur, niveaux de zoom et zoom par défaut de `StatsTir` sont remplacés, le
 * reste (HUD du viseur optique, champ de visée, lunette plein écran, vignettage) est celui des viseurs des armes gratinées.
 */
import type { ArmeFeuId, ArmePrincipaleId, ArmeSecondaireId } from "./protocole";
import type { StatsTir } from "./armes";
import type { Stockage } from "./touches";

export const VISEURS = ["aucun", "point_rouge", "holo", "lunette_x2", "lunette_x4"] as const;
export type ViseurId = (typeof VISEURS)[number];
/** Un viseur par arme ; une arme absente (ou sans choix possible) garde sa mire métallique. */
export type ViseursChoisis = Partial<Record<ArmeFeuId, ViseurId>>;

export const CLE_VISEURS = "pdj-fps-viseurs";
/** Événement de `window` envoyé à chaque écriture : le jeu en cours relit le choix sans rechargement. */
export const EVENEMENT_VISEURS = "pdj-fps-viseurs";

/** Grossissement d'une lunette (×) ; 0 pour un viseur qui n'en est pas une. */
export function grossissement(v: ViseurId): number {
  return v === "lunette_x2" ? 2 : v === "lunette_x4" ? 4 : 0;
}

/** Champ horizontal (°) d'une lunette ×k depuis un champ normal de 90° : 2·atan(tan 45° / k), comme les niveaux du sniper. */
export function champLunette(k: number): number {
  return Math.round(2 * Math.atan(1 / k) * (180 / Math.PI) * 100) / 100;
}

const OPTIQUES: readonly ViseurId[] = ["aucun", "point_rouge", "holo"];
/** Viseurs proposés par arme (armes d'équipement de l'arène). Le sniper n'a pas de choix : sa lunette est intégrée. */
const DISPONIBLES: Partial<Record<ArmePrincipaleId | ArmeSecondaireId, readonly ViseurId[]>> = {
  pistolet: OPTIQUES,
  revolver: OPTIQUES,
  mini_uzi: OPTIQUES,
  pompe: OPTIQUES,
  mitraillette: [...OPTIQUES, "lunette_x2"],
  mitrailleuse: [...OPTIQUES, "lunette_x2"],
  fusil_assaut: [...OPTIQUES, "lunette_x2", "lunette_x4"],
};

/** Viseurs que l'on peut poser sur `arme`, « aucun » en tête ; vide si l'arme n'en reçoit pas (sniper, armes spéciales et uniques). */
export function viseursDisponibles(arme: ArmeFeuId): readonly ViseurId[] {
  return DISPONIBLES[arme as ArmePrincipaleId | ArmeSecondaireId] ?? [];
}

/** Armes qui acceptent un viseur, dans l'ordre d'affichage (principales puis secondaires). */
export const ARMES_A_VISEUR: readonly ArmeFeuId[] = ["mitraillette", "pompe", "fusil_assaut", "mitrailleuse", "pistolet", "revolver", "mini_uzi"];

/** Le viseur effectivement posé : le choix s'il est permis pour cette arme, sinon « aucun ». */
export function viseurChoisi(choix: Readonly<ViseursChoisis> | null | undefined, arme: ArmeFeuId): ViseurId {
  const v = choix?.[arme];
  return v !== undefined && viseursDisponibles(arme).includes(v) ? v : "aucun";
}

export const LIBELLES_VISEURS: Record<ViseurId, string> = {
  aucun: "Aucun",
  point_rouge: "Point rouge",
  holo: "Holo",
  lunette_x2: "Lunette ×2",
  lunette_x4: "Lunette ×4",
};

/**
 * Paramètres de visée d'un viseur choisi (ce que `StatsTir` remplace), null pour « aucun » ou une arme qui ne reçoit pas ce viseur.
 * La lunette a un seul niveau de zoom (×2 ou ×4) ; le point rouge et l'holographique resserrent un peu le champ (cf. `FOV_H_VISEE_OPTIQUE`).
 */
export function parametresVisee(arme: ArmeFeuId, id: ViseurId): { viseur: StatsTir["viseur"]; zooms: readonly number[]; zoomDefaut: number } | null {
  if (id === "aucun" || !viseursDisponibles(arme).includes(id)) return null;
  if (id === "point_rouge" || id === "holo") return { viseur: id, zooms: [], zoomDefaut: 0 };
  return { viseur: "lunette", zooms: [champLunette(grossissement(id))], zoomDefaut: 0 };
}

/** `StatsTir` de l'arme avec le viseur choisi (le même objet si rien ne change). */
export function avecViseur(st: StatsTir, arme: ArmeFeuId, id: ViseurId | undefined): StatsTir {
  const p = id === undefined ? null : parametresVisee(arme, id);
  return p ? { ...st, viseur: p.viseur, zooms: p.zooms, zoomDefaut: p.zoomDefaut } : st;
}

/** Choix valides d'un JSON quelconque : seules les armes à viseur et les viseurs permis restent, « aucun » n'est pas écrit. Ne jette jamais. */
export function normaliserViseurs(brut: unknown): ViseursChoisis {
  const res: ViseursChoisis = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return res;
  const src = brut as Record<string, unknown>;
  for (const arme of ARMES_A_VISEUR) {
    const v = src[arme];
    if (typeof v === "string" && v !== "aucun" && (viseursDisponibles(arme) as readonly string[]).includes(v)) res[arme] = v as ViseurId;
  }
  return res;
}

export function lireViseurs(stockage?: Pick<Stockage, "getItem"> | null): ViseursChoisis {
  try {
    const s = stockage?.getItem(CLE_VISEURS);
    return s ? normaliserViseurs(JSON.parse(s)) : {};
  } catch {
    return {};
  }
}

export function ecrireViseurs(choix: Readonly<ViseursChoisis>, stockage?: Pick<Stockage, "setItem"> | null): boolean {
  try {
    if (!stockage) return false;
    stockage.setItem(CLE_VISEURS, JSON.stringify(normaliserViseurs(choix)));
    return true;
  } catch {
    return false;
  }
}

/** Choix après avoir posé `id` sur `arme` (« aucun » ou un viseur interdit retire le choix) ; l'objet d'origine n'est pas modifié. */
export function avecChoix(choix: Readonly<ViseursChoisis>, arme: ArmeFeuId, id: ViseurId): ViseursChoisis {
  const res = { ...choix };
  if (id === "aucun" || !viseursDisponibles(arme).includes(id)) delete res[arme];
  else res[arme] = id;
  return res;
}
