/**
 * Contrat de vitesse entre les bots du Battle Royale (serveur) et leur rendu de tigre bipède (client) : PUR et sans three, donc importable des
 * deux côtés. Le corps du tigre n'avance que sur son axe (pieds plantés, `lib/tigre3d/corps.ts`) et ne s'écarte jamais de plus de `CAP_MAX_RAD`
 * de la visée : une marche dont la direction s'éloigne davantage de la visée fait glisser les pieds de la composante perpendiculaire à l'axe du
 * corps. `vitesseMaxSelonDirection` donne la vitesse à ne pas dépasser pour que ce glissement reste sous `GLISSEMENT_MAX_M_S`.
 * Mesures du spike (lot 4, `bot-tigre-anim.test.ts`) : en avant et à reculons les pieds restent plantés (≈ 0,002 mm/image en avant à 5 m/s, 0,1 à
 * 0,2 mm à reculons) de 2 à 7 m/s ; la bride de vitesse suffit, aucune allure bipède dédiée.
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.4, §1.5)
 */

/** Vitesse de marche des bots (m/s) : le trot plein du tigre à l'échelle du bot (≈ 2,2 m/s du modèle), sous le sprint du joueur (12,5 m/s). */
export const VITESSE_BOT_RENDU_M_S = 5;
/** Le corps ne s'écarte jamais de plus de 50° de la visée. */
export const CAP_MAX_RAD = (50 * Math.PI) / 180;
/** Glissement des pieds toléré (m/s) pour une marche oblique ou latérale. */
export const GLISSEMENT_MAX_M_S = 0.6;
/** Au-delà, l'animation ne suit plus (m/s) : le corps plafonne son pas, le reste glisserait. */
export const VITESSE_ANIMABLE_MAX_M_S = VITESSE_BOT_RENDU_M_S * 1.25;

/** Écart d'angle signé le plus court (rad). */
function ecart(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Vitesse maximale (m/s) d'un bot qui marche dans une direction faisant l'angle `relatif` (rad, signé) avec sa visée : `VITESSE_BOT_RENDU_M_S`
 * dans le cône de ±50° (avant) et à reculons (le corps garde la visée, les pieds reculent), réduite sur les côtés pour que le glissement
 * `v · sin(excès)` reste sous `GLISSEMENT_MAX_M_S` (≈ 0,93 m/s en latéral pur).
 */
export function vitesseMaxSelonDirection(relatif: number): number {
  let rel = ecart(0, relatif);
  if (Math.abs(rel) > Math.PI / 2) rel -= Math.sign(rel) * Math.PI;
  const exces = Math.max(0, Math.abs(rel) - CAP_MAX_RAD);
  if (exces < 1e-6) return VITESSE_BOT_RENDU_M_S;
  return Math.min(VITESSE_BOT_RENDU_M_S, GLISSEMENT_MAX_M_S / Math.sin(exces));
}
