/**
 * Anti-collision des étiquettes de la vue Palantir à l'écran (PUR : rectangles en pixels). Les noms des restaurants sont le sujet de la vue : un
 * nom de joueur (réel ou simulé) qui tomberait dessus, ou sur un nom déjà placé, est masqué plutôt que superposé.
 */
export interface RectEtiquette { x0: number; y0: number; x1: number; y1: number }

/** Rectangle d'une étiquette ancrée en (x, y) par `translate(-50%, -100%)` : centrée en x, posée au-dessus de y. */
export const rectEtiquette = (x: number, y: number, largeur: number, hauteur: number): RectEtiquette => ({
  x0: x - largeur / 2, y0: y - hauteur, x1: x + largeur / 2, y1: y,
});

/** Les deux rectangles se recouvrent-ils, à `marge` px près ? */
export const seChevauchent = (a: RectEtiquette, b: RectEtiquette, marge = 2): boolean =>
  a.x0 < b.x1 + marge && a.x1 > b.x0 - marge && a.y0 < b.y1 + marge && a.y1 > b.y0 - marge;

/**
 * Place `r` si elle ne recouvre aucune étiquette déjà posée : l'ajoute à `occupes` et rend vrai ; sinon rend faux et `occupes` est inchangé.
 * L'appelant passe d'abord les étiquettes prioritaires (restaurants), puis les autres dans un ordre stable (pas de clignotement d'une image à l'autre).
 */
export function placerEtiquette(occupes: RectEtiquette[], r: RectEtiquette): boolean {
  for (const o of occupes) if (seChevauchent(o, r)) return false;
  occupes.push(r);
  return true;
}
