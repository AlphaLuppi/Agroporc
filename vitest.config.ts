import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig garde `jsx: preserve` pour Next : les tests de rendu (renderToStaticMarkup) ont besoin du runtime automatique.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    globals: true,
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Les simulations de salle sont lourdes : 5 s sautaient au hasard quand plusieurs fichiers tournent en parallèle.
    testTimeout: 20_000,
  },
});
