// Développement : reconstruit à chaque modification (serveur-fps/src ou lib/fps) et relance le serveur.
import { spawn } from "node:child_process";
import { context } from "esbuild";
import { options } from "./options.mjs";

let enfant = null;
function relancer() {
  if (enfant) enfant.kill("SIGTERM");
  enfant = spawn(process.execPath, ["dist/index.js"], { stdio: "inherit", env: process.env });
}

const ctx = await context({
  ...options,
  sourcemap: "inline",
  plugins: [{
    name: "relance",
    setup(build) {
      build.onEnd((r) => { if (!r.errors.length) relancer(); });
    },
  }],
});
await ctx.watch();
const arreter = async () => { enfant?.kill("SIGTERM"); await ctx.dispose(); process.exit(0); };
process.on("SIGINT", arreter);
process.on("SIGTERM", arreter);
