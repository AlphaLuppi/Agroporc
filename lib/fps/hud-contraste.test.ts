import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contraste du HUD de l'arène (spec HUD §2.2, §13) : recalcule depuis `Agroparc3D.module.css` les rapports de contraste des jetons de
 * texte sur la plaque `--ag-hud-fond` (0,86) et `--ag-hud-fond-fort` (0,94) dans le pire cas (un pixel blanc derrière), et vérifie
 * qu'aucun module HUD ne définit de couleur en dur ni ne redéfinit un jeton `--ag-*`.
 */

const RACINE = join(__dirname, "..", "..");
const ARENE = join(RACINE, "app", "components", "arene");
const lire = (p: string) => readFileSync(p, "utf8");
const sansCommentaires = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** Retire les blocs `@keyframes` (accolades imbriquées) : une animation d'entrée ou de sortie peut passer par une opacité intermédiaire. */
function sansAnimations(css: string): string {
  let sortie = "";
  let i = 0;
  while (i < css.length) {
    const debut = css.indexOf("@keyframes", i);
    if (debut < 0) { sortie += css.slice(i); break; }
    sortie += css.slice(i, debut);
    let profondeur = 0;
    let j = css.indexOf("{", debut);
    if (j < 0) break;
    for (; j < css.length; j++) {
      if (css[j] === "{") profondeur++;
      else if (css[j] === "}" && --profondeur === 0) { j++; break; }
    }
    i = j;
  }
  return sortie;
}

type Rgba = { r: number; g: number; b: number; a: number };

/** Jetons `--ag-*` déclarés dans le bloc `.root` de la vue 3D (sans commentaires). */
function lireJetons(): Map<string, string> {
  const css = sansCommentaires(lire(join(RACINE, "app", "components", "Agroparc3D.module.css")));
  const bloc = css.slice(css.indexOf(".root"), css.indexOf("}", css.indexOf(".root")));
  const jetons = new Map<string, string>();
  for (const m of bloc.matchAll(/(--ag-[a-z-]+)\s*:\s*([^;]+);/g)) jetons.set(m[1], m[2].trim());
  return jetons;
}

function couleur(valeur: string, jetons: Map<string, string>): Rgba {
  const v = valeur.trim();
  const ref = /^var\((--ag-[a-z-]+)\)$/.exec(v);
  if (ref) {
    const cible = jetons.get(ref[1]);
    if (!cible) throw new Error(`jeton introuvable : ${ref[1]}`);
    return couleur(cible, jetons);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] };
  throw new Error(`couleur illisible : ${valeur}`);
}

/** Compose `dessus` sur `dessous` (alpha). */
const composer = (dessus: Rgba, dessous: Rgba): Rgba => ({
  r: dessus.r * dessus.a + dessous.r * (1 - dessus.a),
  g: dessus.g * dessus.a + dessous.g * (1 - dessus.a),
  b: dessus.b * dessus.a + dessous.b * (1 - dessus.a),
  a: 1,
});
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (c: Rgba) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const rapport = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const BLANC: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const jetons = lireJetons();
const pire = (fond: string) => composer(couleur(`var(${fond})`, jetons), BLANC);

/** Rapports attendus par la spec HUD §2.2 (tolérance 0,15 : la spec arrondit à une décimale). */
const ATTENDU: [string, number, number][] = [
  ["--ag-ink", 12.7, 14.4],
  ["--ag-white", 13.5, 15.3],
  ["--ag-cyan", 10.8, 12.2],
  ["--ag-ok", 10.2, 11.6],
  ["--ag-tete", 10.1, 11.5],
  ["--ag-amber", 8.2, 9.3],
  ["--ag-shield", 6.8, 7.6],
  ["--ag-ink-dim", 6.1, 6.9],
  ["--ag-danger", 5.7, 6.5],
];

describe("contraste des jetons du HUD (spec HUD §2.2)", () => {
  it("la plaque, pire cas (pixel blanc derrière), est rgb(39, 41, 44)", () => {
    const p = pire("--ag-hud-fond");
    expect([Math.round(p.r), Math.round(p.g), Math.round(p.b)]).toEqual([39, 41, 44]);
  });

  it.each(ATTENDU)("%s : au moins 4,5:1 sur les deux plaques et conforme à la spec", (jeton, sur86, sur94) => {
    const texte = couleur(`var(${jeton})`, jetons);
    const r86 = rapport(texte, pire("--ag-hud-fond"));
    const r94 = rapport(texte, pire("--ag-hud-fond-fort"));
    expect(r86).toBeGreaterThanOrEqual(4.5);
    expect(r94).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(r86 - sur86)).toBeLessThan(0.15);
    // la spec donne pour la plaque forte un chiffre prudent (un peu sous le rapport recalculé) : on exige de ne jamais faire pire
    expect(r94).toBeGreaterThanOrEqual(sur94 - 0.15);
  });

  it("--ag-cadre (contours essentiels) : au moins 4,5:1 sur la plaque", () => {
    const cadre = couleur("var(--ag-cadre)", jetons);
    expect(rapport(cadre, pire("--ag-hud-fond"))).toBeGreaterThanOrEqual(4.5);
    expect(rapport(cadre, pire("--ag-hud-fond-fort"))).toBeGreaterThanOrEqual(4.5);
  });

  it("--ag-line-strong reste réservé aux filets : sous 4,5:1 sur la plaque, donc jamais utilisé en texte", () => {
    expect(rapport(couleur("var(--ag-line-strong)", jetons), pire("--ag-hud-fond"))).toBeLessThan(4.5);
  });
});

/** Modules CSS du HUD : l'orchestrateur, les composants `hud/` et la killcam. */
function modulesHud(): string[] {
  const hud = join(ARENE, "hud");
  const fichiers = [join(ARENE, "HudArene.module.css"), join(ARENE, "Killcam.module.css")];
  for (const f of readdirSync(hud)) if (f.endsWith(".module.css")) fichiers.push(join(hud, f));
  return fichiers.filter((f) => { try { lire(f); return true; } catch { return false; } });
}

describe("modules CSS du HUD : aucune couleur en dur", () => {
  const modules = modulesHud();

  it("les modules sont trouvés", () => {
    expect(modules.length).toBeGreaterThanOrEqual(5);
  });

  it.each(modules.map((f) => [f.slice(RACINE.length + 1), f]))("%s : ni hexadécimal, ni rgb()/hsl(), ni jeton --ag-* redéfini", (_nom, chemin) => {
    const css = sansCommentaires(lire(chemin));
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(css.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g) ?? []).toEqual([]);
    expect(css.match(/--ag-[a-z-]+\s*:/g) ?? []).toEqual([]);
  });
});

describe("modules CSS du HUD : jamais d'opacité pour atténuer un texte", () => {
  it.each(modulesHud().map((f) => [f.slice(RACINE.length + 1), f]))("%s : pas de `opacity` fractionnaire", (_nom, chemin) => {
    const css = sansAnimations(sansCommentaires(lire(chemin)));
    // hors animations, une opacité intermédiaire atténuerait du texte (0 et 1 : états cachés / pleins)
    const intermediaires = [...css.matchAll(/(?<![-\w])opacity\s*:\s*([0-9.]+)/g)].map((m) => m[1]).filter((v) => v !== "0" && v !== "1");
    expect(intermediaires).toEqual([]);
  });
});
