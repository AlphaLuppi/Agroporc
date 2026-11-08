/**
 * Stub de types du DOM pour le typecheck de serveur-fps (spec Rocket en ligne § 8.4) : `lib/rocket/contrat.ts` mentionne `HTMLCanvasElement`
 * dans la signature de `CreerJeuRocket`, et la bibliothèque du serveur (ES2022 seule) n'a pas de DOM. Déclaration vide, type seulement.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface HTMLCanvasElement {}
}
export {};
