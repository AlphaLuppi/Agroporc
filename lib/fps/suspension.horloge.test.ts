import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Garde de la suspension (v11) : tout le jeu serveur reçoit l'horloge en paramètre (`maintenant`), la suspension n'a donc qu'à la figer à l'entrée de
 * `Salle`. Un futur `Date.now()` dans un service casserait la pause en silence : ce test lit le source de TOUS les `lib/fps/*.ts` non client et refuse
 * toute horloge réelle, tout minuteur et tout hasard global (`Math.random` seulement en valeur par défaut d'un paramètre `alea`, trois fichiers).
 */

const DOSSIER = "lib/fps";
/** Fichiers CLIENT (rendu, son, réseau, jeu, voix) : ils ont le droit à l'horloge réelle et au hasard global. */
const EXCLU = [/^jeu/, /^rendu/, /^sons/, /^reseau/, /^voix-rtc/, /\.test\.ts$/];
/** Les seuls fichiers serveur qui nomment `Math.random`, en valeur par défaut d'un paramètre `alea` que `Salle` remplace toujours. */
const MATH_RANDOM_TOLERE = new Set(["zombies-secret.ts", "bus-c3.ts", "frappe-aerienne.ts"]);
const INTERDITS = ["Date.now(", "performance.now(", "new Date(", "setTimeout(", "setInterval(", "requestAnimationFrame("];

/** Source sans commentaires (un commentaire peut citer `Math.random` ou `Date.now()`). */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const fichiersServeur = readdirSync(DOSSIER).filter((f) => f.endsWith(".ts") && !EXCLU.some((re) => re.test(f)));

describe("horloge du jeu serveur (garde de la suspension)", () => {
  it("la liste des fichiers serveur contient bien le jeu (match, services, modules purs)", () => {
    for (const f of ["match.ts", "match-zombies.ts", "zombies.ts", "zombies-secret.ts", "effets-armes.ts", "grenades.ts", "suspension.ts"]) {
      expect(fichiersServeur, f).toContain(f);
    }
    expect(fichiersServeur.length).toBeGreaterThan(60);
  });

  it.each(fichiersServeur)("%s : aucune horloge réelle ni minuteur", (f) => {
    const src = sansCommentaires(readFileSync(`${DOSSIER}/${f}`, "utf8"));
    for (const mot of INTERDITS) expect(src.includes(mot), `${f} contient ${mot}`).toBe(false);
  });

  it.each(fichiersServeur)("%s : `Math.random` seulement en valeur par défaut d'un `alea` des fichiers tolérés", (f) => {
    const src = sansCommentaires(readFileSync(`${DOSSIER}/${f}`, "utf8"));
    if (!src.includes("Math.random")) return;
    expect(MATH_RANDOM_TOLERE.has(f), `${f} utilise Math.random`).toBe(true);
    // chaque occurrence est la valeur par défaut d'un paramètre ou d'une option nommée `alea`
    for (const ligne of src.split("\n").filter((l) => l.includes("Math.random"))) expect(ligne, f).toMatch(/alea.*=\s*(opts\.alea \?\? )?Math\.random/);
  });

  it("`Salle` injecte son `alea` aux trois endroits où un défaut `Math.random` existerait", () => {
    const match = sansCommentaires(readFileSync(`${DOSSIER}/match.ts`, "utf8"));
    expect(match).toMatch(/creerEtatBusC3\(maintenant, this\.alea/);
    expect(match).toMatch(/avancerBusC3\(bus, maintenant, this\.alea\)/);
    expect(match).toMatch(/creerFrappe\([^)]*this\.alea\)/);
    // le grand secret ne tire jamais le hasard global : son générateur est semé par l'instant du lancement (virtuel) avant tout usage
    const secret = sansCommentaires(readFileSync(`${DOSSIER}/zombies-secret.ts`, "utf8"));
    expect(secret).toMatch(/if \(!opts\.alea\) alea = generateur\(t\)/);
  });
});
