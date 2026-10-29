/**
 * Pseudos et couleurs des faux joueurs de l'aperçu (vue Palantir) : prénoms des personnages du site, sans doublon. PUR.
 * Au-delà de 16 prénoms : prénom + « 2 », « 3 »… Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import { CHARACTERS } from "../characters";
import { couleurJoueur } from "./couleurs";

const PRENOMS: readonly string[] = CHARACTERS.map((c) => c.name.split(" ")[0]);

export interface EquipierFictif { pseudo: string; couleur: string }

/** Tire `n` équipiers : prénoms distincts (mélange de Fisher-Yates avec `alea`), couleurs `couleurJoueur(rangDepart + i)`. */
export function tirerEquipe(alea: () => number, n: number, rangDepart = 0): EquipierFictif[] {
  const ordre = PRENOMS.map((_, i) => i);
  for (let i = ordre.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
  }
  const res: EquipierFictif[] = [];
  for (let i = 0; i < n; i++) {
    const tour = Math.floor(i / ordre.length);
    const prenom = PRENOMS[ordre[i % ordre.length]];
    res.push({ pseudo: tour === 0 ? prenom : `${prenom} ${tour + 1}`, couleur: couleurJoueur(rangDepart + i) });
  }
  return res;
}
