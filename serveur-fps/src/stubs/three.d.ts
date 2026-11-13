/**
 * Stub de types de `three` pour le typecheck de serveur-fps (spec Rocket en ligne § 8.4). `lib/rocket/contrat.ts` fait `import type * as THREE from
 * "three"` pour un seul type de rendu (`THREE.Group`) ; le serveur n'installe pas `three` (et ne l'importe jamais à l'exécution : esbuild
 * ne suit que les imports de valeurs). Branché par `paths` dans `tsconfig.json`.
 */
export type Group = object;
