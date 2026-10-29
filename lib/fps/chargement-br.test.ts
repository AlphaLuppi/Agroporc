import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Le but premier du site est d'afficher le plat du jour : aucun code de l'arène FPS, donc aucun code du Battle Royale, ne doit entrer dans le
 * premier chargement de la page du menu. Ce test suit les imports STATIQUES (hors `import type`, effacés à la compilation, et hors `import()`
 * dynamiques, qui font des morceaux à part) depuis `app/layout.tsx`, `app/page.tsx` et `app/menus/*` et vérifie qu'aucun n'atteint `lib/fps/`,
 * l'interface de l'arène ni la vue 3D ; puis que la chaîne de chargements à la demande est intacte : `MyrtilleEasterEgg` charge `Agroparc3D` par
 * `next/dynamic`, qui charge `lib/fps/jeu` (donc le rendu, le moteur et les modules `br-*`) par `import()` au moment d'entrer dans le jeu.
 */
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS = [".ts", ".tsx"];

/** Sources des imports statiques d'un fichier (les `import type` et `export type … from` sont ignorés : ils n'existent pas à l'exécution). */
function importsStatiques(source: string): string[] {
  const sans = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const trouves: string[] = [];
  const re = /\b(?:import|export)\s+(type\s+)?(?:[\w$*{}\s,]+?\s+from\s+|)["']([^"']+)["']/g;
  for (let m = re.exec(sans); m; m = re.exec(sans)) {
    if (m[1]) continue;
    trouves.push(m[2]);
  }
  return trouves;
}

function resoudre(depuis: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(RACINE, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(depuis), spec);
  else return null; // paquet npm
  for (const c of [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => join(base, `index${e}`))]) {
    if (existsSync(c) && statSync(c).isFile() && EXTENSIONS.some((e) => c.endsWith(e))) return c;
  }
  return null;
}

/** Tous les fichiers atteints par imports statiques depuis `entrees` (les entrées comprises). */
function fermeture(entrees: string[]): Set<string> {
  const vus = new Set<string>();
  const pile = [...entrees];
  while (pile.length) {
    const f = pile.pop()!;
    if (vus.has(f)) continue;
    vus.add(f);
    for (const spec of importsStatiques(readFileSync(f, "utf8"))) {
      const r = resoudre(f, spec);
      if (r) pile.push(r);
    }
  }
  return vus;
}

const rel = (f: string) => relative(RACINE, f);

describe("le Battle Royale ne pèse pas sur le premier chargement du site", () => {
  const entrees = [
    join(RACINE, "app/layout.tsx"),
    join(RACINE, "app/page.tsx"),
    ...readdirSync(join(RACINE, "app/menus")).filter((f) => EXTENSIONS.some((e) => f.endsWith(e))).map((f) => join(RACINE, "app/menus", f)),
  ];

  it("l'analyse des imports voit les imports multi-lignes et ignore les imports de types", () => {
    const src = `import type { A } from "./a";\nimport {\n  b,\n  c,\n} from "./b";\nimport d from "@/lib/d";\nexport { e } from "./e";\nexport type { F } from "./f";\nconst x = import("./dyn");`;
    expect(importsStatiques(src)).toEqual(["./b", "@/lib/d", "./e"]);
  });

  it("aucun module de l'arène, de la vue 3D ni du Battle Royale n'est importé statiquement par la page du menu", () => {
    const f = [...fermeture(entrees)].map(rel);
    expect(f.length).toBeGreaterThan(entrees.length);
    const intrus = f.filter((x) => /^lib\/fps\//.test(x) || /^app\/components\/arene\//.test(x) || /Agroparc3D/.test(x) || /(^|\/)(br-|match-br|jeu-br|rendu-br)/.test(x));
    expect(intrus).toEqual([]);
  });

  it("la vue 3D est chargée à la demande : next/dynamic dans MyrtilleEasterEgg, import() du jeu dans Agroparc3D", () => {
    const myrtille = readFileSync(join(RACINE, "app/components/MyrtilleEasterEgg.tsx"), "utf8");
    expect(myrtille).toMatch(/dynamic\(\(\) => import\("\.\/Agroparc3D"\)/);
    const vue = readFileSync(join(RACINE, "app/components/Agroparc3D.tsx"), "utf8");
    expect(vue).toMatch(/import\("@\/lib\/fps\/jeu"\)/);
    // aucun import statique de VALEUR du moteur ni du rendu (les types sont effacés)
    const statiques = importsStatiques(vue);
    expect(statiques.filter((s) => /^@\/lib\/fps\/(jeu|rendu|sons|match|jeu-br)(-|$)/.test(s) && s !== "@/lib/fps/jeu-types")).toEqual([]);
    expect(statiques).not.toContain("@/lib/fps/jeu");
    expect(statiques).not.toContain("three");
  });
});
