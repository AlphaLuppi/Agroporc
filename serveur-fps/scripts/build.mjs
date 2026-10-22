// Construit dist/index.js (voir options.mjs).
import { build } from "esbuild";
import { options } from "./options.mjs";

await build(options);
