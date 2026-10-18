import { classerPlat, type Criteres } from "./quiz-engine";
import type { PoolPlat } from "./quiz-plats";

/**
 * Compteurs de l'arbre « Aide-moi à choisir ». Le moteur (`meilleursCandidats`) classe par
 * nombre de critères satisfaits ; l'arbre affiche en plus, sur chaque branche, combien de
 * plats cochent TOUS les critères choisis : une branche à 0 mène au « plus proche ».
 */
export function platsCompatibles(pool: PoolPlat[], criteres: Criteres): PoolPlat[] {
  return pool.filter((p) => {
    const tags = classerPlat(p);
    return (Object.keys(criteres) as (keyof Criteres)[]).every(
      (cle) => criteres[cle] === undefined || tags[cle] === criteres[cle],
    );
  });
}

/** Nombre de plats compatibles si l'on choisit `valeur` pour `cle` (undefined = « peu importe »). */
export function compterBranche<K extends keyof Criteres>(
  pool: PoolPlat[],
  criteres: Criteres,
  cle: K,
  valeur: Criteres[K] | undefined,
): number {
  return platsCompatibles(pool, { ...criteres, [cle]: valeur }).length;
}
