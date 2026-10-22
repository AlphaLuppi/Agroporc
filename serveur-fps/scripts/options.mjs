// Options esbuild communes à `build.mjs` et `dev.mjs`.
// Regroupe src/index.ts + lib/fps/* + ws en un seul dist/index.js (CommonJS, Node 22).
export const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/index.js",
  // dépendances natives optionnelles de ws (repli en JavaScript pur)
  external: ["bufferutil", "utf-8-validate"],
  legalComments: "none",
  logLevel: "info",
};
