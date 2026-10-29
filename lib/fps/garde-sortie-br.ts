/**
 * Garde de sortie du Battle Royale côté interface (PUR). Après une sortie (« Quitter », « Rejouer », fin de partie), `Agroparc3D` ne doit pas
 * remonter tout de suite le jeu : le serveur peut encore montrer « admis » pendant le décompte (jusqu'à 30 s) d'où l'on vient de partir.
 * La garde ne protège donc que CE décompte : dès que la phase n'est plus le décompte (vol, jeu, fin, lobby) elle retombe, sinon elle survivrait à
 * la partie (la sortie se fait en jeu ou en fin, bien après que `admis` est redevenu faux) et bloquerait le montage du décompte suivant.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (lobby, décompte)
 */
export function gardeSortieBr(garde: boolean, mode: string, phase: string | undefined): boolean {
  return mode === "br" && phase === "decompte" ? garde : false;
}
