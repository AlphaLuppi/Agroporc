/**
 * Socle commun des simulations de l'aperçu (vue Palantir) : types, pas fixe, graine de cycle. PUR : ni `Math.random`, ni horloge, ni three.
 * Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import type { SceneData, Vec2 } from "../agroparc3d/types";
import type { Boite } from "./collision";
import type { ModeleApercu } from "./apercu-source";
import type { SolLibre } from "./apercu-sol";
import type { Fenetre } from "./zombies-carte";

/** Pas interne fixe de toute simulation (s). */
export const PAS_SIM = 1 / 30;
/** Un `dt` plus long est ramené à ceci (onglet resté en arrière-plan : pas de rattrapage en rafale). */
export const DT_MAX_SIM = 0.1;

export interface ContexteSim {
  data: SceneData;
  sol: SolLibre;
  bornes: Boite;
  /** zombies : les fenêtres de la carte (`FENETRES`) */
  fenetres?: readonly Fenetre[];
  /** Battle Royale : centres des bâtiments creux (`centresBatimentsEligibles`) */
  centresBatiments?: readonly Vec2[];
}

/** Une simulation d'aperçu : faux joueurs qui jouent ensemble ou s'affrontent, déterministe pour une graine donnée. */
export interface Simulation {
  /** avance de `dt` secondes (pas interne fixe de 1/30 s) */
  pas(dt: number): void;
  /** écrit l'état courant dans `sortie` (tableaux réutilisés d'une lecture à l'autre) */
  modele(sortie: ModeleApercu): void;
  /** lignes du journal depuis la dernière lecture (vidé à la lecture) */
  evenements(): string[];
  /** numéro du cycle en cours (la simulation repart sur une nouvelle graine à chaque cycle) */
  readonly cycle: number;
}

/** Accumulateur de temps : appelle `f` par pas fixe. */
export class Metronome {
  private reste = 0;
  avancer(dt: number, f: () => void): void {
    this.reste += Math.min(Math.max(dt, 0), DT_MAX_SIM);
    while (this.reste >= PAS_SIM - 1e-9) {
      f();
      this.reste -= PAS_SIM;
    }
    if (this.reste < 0) this.reste = 0;
  }
}

/** Graine du cycle `cycle` d'une simulation semée par `graine` : une suite différente à chaque cycle. */
export const graineDeCycle = (graine: number, cycle: number): number => (graine + Math.imul(cycle + 1, 0x9e3779b1)) >>> 0;

/** Entier tiré dans [min, max] (bornes comprises). */
export const entierEntre = (alea: () => number, min: number, max: number): number => min + Math.floor(alea() * (max - min + 1));
/** Réel tiré dans [min, max). */
export const reelEntre = (alea: () => number, min: number, max: number): number => min + alea() * (max - min);

/** Journal à débit limité : au plus une ligne toutes les `espaceS` secondes de simulation (les surplus sont perdus, sauf `force`). */
export class Journal {
  private lignes: string[] = [];
  private derniere = -Infinity;
  ajouter(t: number, texte: string, espaceS = 0, force = false): void {
    if (!force && t - this.derniere < espaceS) return;
    this.derniere = t;
    this.lignes.push(texte);
    if (this.lignes.length > 20) this.lignes.shift();
  }
  vider(): string[] {
    const l = this.lignes;
    this.lignes = [];
    return l;
  }
}
