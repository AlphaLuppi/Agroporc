/**
 * Disposition du clavier déduite des touches pressées, pour les navigateurs sans `navigator.keyboard.getLayoutMap` (Firefox, Safari).
 * Les liaisons du jeu sont des codes PHYSIQUES (`KeyW`), mais l'aide doit écrire la lettre gravée sur la touche du joueur : un AZERTY
 * produit `key === "z"` pour `code === "KeyW"`. Pure.
 */

/** Positions où AZERTY diffère de QWERTY sur les lettres : code physique → lettre gravée. */
export const COMPLEMENT_AZERTY: ReadonlyMap<string, string> = new Map([["KeyQ", "a"], ["KeyA", "q"], ["KeyW", "z"], ["KeyZ", "w"]]);

/**
 * Apprend une touche pressée. Rend la nouvelle disposition (`courante` n'est jamais modifiée), ou `courante` si rien ne change.
 * Un code `KeyQ / KeyA / KeyW / KeyZ` qui produit la lettre AZERTY fait adopter les quatre lettres d'un coup (le joueur n'a pas encore
 * tapé les autres) ; toute lettre apprise est ensuite gardée telle quelle.
 */
export function apprendreDisposition(
  courante: ReadonlyMap<string, string> | null,
  code: string,
  key: string,
): ReadonlyMap<string, string> | null {
  if (!/^Key[A-Z]$/.test(code) || typeof key !== "string" || key.length !== 1 || !/\p{L}/u.test(key)) return courante;
  const lettre = key.toLowerCase();
  if (courante?.get(code) === lettre) return courante;
  const suivante = new Map(courante ?? []);
  if (COMPLEMENT_AZERTY.get(code) === lettre) for (const [c, l] of COMPLEMENT_AZERTY) if (!suivante.has(c)) suivante.set(c, l);
  suivante.set(code, lettre);
  return suivante;
}
