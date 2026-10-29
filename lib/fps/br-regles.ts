/**
 * Règles de base du mode Battle Royale (PUR : constantes et fonctions, aucune horloge ni hasard). Les paliers de la zone vivent dans
 * `br-zone.ts`, l'avion et la chute dans `br-chute.ts`, les tables du butin dans `br-butin.ts`.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md
 */
import type { ClasseMunitions, Equipement, Slot } from "./protocole";

export const BR = {
  joueursMin: 2, joueursMax: 50, decompteMaxMs: 30_000, decompteMinMs: 3_000, finAffichageMs: 30_000,
  pvKill: 50, protectionAtterrissageMs: 5_000,
  /** dégâts de mêlée propres au BR (le couteau tuerait en un coup : aucune arme à feu au départ, 50 joueurs sur 0,36 km²) */
  melee: { couteau: 34, epee: 70 },
  /** une partie ne compte pour les stats que si au moins `atterrisMin` joueurs ont touché le sol et que `partieValideMinMs` se sont écoulées depuis le départ de l'avion */
  partieValideMinMs: 60_000, atterrisMin: 2, retraitMortSnapMs: 5_000,
  snapHz: 10, interpolationMs: 150, rewindMaxMs: 400, historiqueMs: 500,
  /** périodes minimales de `br{etat}` : lobby / décompte / fin (5 Hz) et vol / jeu (1 Hz hors changement) */
  periodeEtatMs: 200, periodeEtatJeuMs: 1_000,
  rayonRamassageM: 2.5, reserveChargeursDepart: 2, reserveChargeursMax: 6,
  /** un vivant sans `etat` depuis ce délai, hors vol, est retiré de la partie */
  inactifMs: 20_000,
  usage: { bandage: { ms: 3_000, pv: 20, plafondPv: 75, pile: 5 }, potion: { ms: 4_000, bouclier: 50, pile: 3 } },
} as const;

/** Dégâts d'un coup d'arme blanche en BR (3 coups de couteau, 2 coups d'épée). */
export const degatsMeleeBr = (id: "couteau" | "epee"): number => BR.melee[id];

/** Départ : aucun slot à feu (les valeurs `principale` / `secondaire` ne sont que du remplissage). Copie à prendre avec `copierEquipement`. */
export const EQUIPEMENT_DEPART_BR: Readonly<Equipement> = Object.freeze({
  principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true as const, sansSecondaire: true as const,
});
/** Slot en main au départ : le couteau. */
export const MAIN_DEPART_BR: Slot = "couteau";

/** Règles de santé passées à `regenerer` : 100 PV, délai infini, 0 PV/s : aucune régénération. */
export const REGLES_SANTE_BR: { pvMax: number; delaiMs: number; pvParS: number } = Object.freeze({ pvMax: 100, delaiMs: Infinity, pvParS: 0 });

const CLASSES_MUNITIONS: readonly ClasseMunitions[] = ["legeres", "moyennes", "cartouches"];
export const estClasseMunitions = (x: unknown): x is ClasseMunitions => (CLASSES_MUNITIONS as readonly unknown[]).includes(x);
