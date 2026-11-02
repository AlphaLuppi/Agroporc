/**
 * Garde-fou : chaque action assignable du menu des touches est BRANCHÉE (le jeu ou le HUD la lit), et les touches tactiques font quelque chose.
 * Lot tactique : la touche de frappe aérienne (`frappeAerienne`) figurait dans le menu, avait une touche par défaut et un libellé, mais `jeu.ts` la traitait
 * par un `break;` vide et le HUD l'écoutait sous condition d'une série de 5 kills mal suivie : « quand j'appuie, ça ne marche pas ». Un test sur le texte des
 * sources attrape ce genre de touche morte, qu'aucun test de logique pure ne voit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTIONS, touchesParDefaut } from "./touches";

const jeu = readFileSync("lib/fps/jeu.ts", "utf8");
const huds = ["app/components/arene/HudArene.tsx", "app/components/arene/hud/MenuPause.tsx"].map((f) => readFileSync(f, "utf8")).join("\n");

/** Actions lues autrement que par un `case` de `presser` : maintenues (`actionActive`), molette ou interface. */
const branchee = (a: string): boolean =>
  new RegExp(`case "${a}":`).test(jeu) || new RegExp(`(actionActive|k)\\("${a}"\\)`).test(jeu) || new RegExp(`touches\\.${a}\\b`).test(huds) || new RegExp(`touche[A-Za-z]*="?\\{?t\\("${a}"\\)`).test(huds);

/** Le sélecteur d'actions ponctuelles de jeu.ts (`presser`), seul endroit où un `case` d'action est une vraie réaction à la touche. */
const presser = jeu.slice(jeu.indexOf("const presser = (code: string)"), jeu.indexOf("const relacher = (code: string)"));

describe("chaque action du menu des touches est branchée", () => {
  it.each(ACTIONS.map((a) => [a]))("%s", (a) => {
    expect(branchee(a), `${a} figure dans le menu des touches mais ni jeu.ts ni le HUD ne la lisent`).toBe(true);
  });

  it("aucune action tactique n'est un `break;` vide dans le sélecteur de touches de jeu.ts", () => {
    for (const a of ["grenade", "invoquer", "fumigene", "frappeAerienne"]) {
      const m = new RegExp(`case "${a}":([^\\n]*)`).exec(presser);
      expect(m, `case "${a}" absent de presser() dans jeu.ts`).not.toBeNull();
      const corps = (m![1] ?? "").replace(/\/\/.*$/, "").trim();
      expect(corps, `case "${a}" ne fait rien`).not.toMatch(/^break;?$/);
      expect(corps.length, `case "${a}" est vide`).toBeGreaterThan("break;".length);
    }
  });

  it("la touche de frappe appelle le ciblage et la grenade n'est plus réservée aux zombies", () => {
    expect(presser).toMatch(/case "frappeAerienne": toucheFrappe\(\)/);
    // G lance la grenade quel que soit le mode
    expect(presser).toMatch(/case "grenade": presserGrenade\("frag"\)/);
    // le tir valide le ciblage plutôt que de tirer
    expect(presser).toMatch(/case "tir":\s*\n\s*if \(ciblage\) \{ validerCiblageFrappe\(\)/);
  });

  it("les touches tactiques par défaut sont distinctes", () => {
    const d = touchesParDefaut();
    const codes = ["grenade", "invoquer", "fumigene", "frappeAerienne"].map((a) => d[a as keyof typeof d][0]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain(null);
  });
});
