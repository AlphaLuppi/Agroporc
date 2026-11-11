import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("app/layout.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

const compte = (src: string, motif: string) => src.split(motif).length - 1;
const hrefs = (src: string) => [...src.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

// Découpe du <nav> en blocs repérés par leurs balises d'ouverture.
const entre = (debut: string, fin: string) => {
  const a = layout.indexOf(debut);
  const b = layout.indexOf(fin, a + debut.length);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return layout.slice(a, b);
};

const blocLiensBureau = entre('className="nav-links', "</nav>").split('id="nav-plus-btn"')[0];
const panneauPlus = entre('id="nav-plus-menu"', 'id="cart-btn"');
const menuMobile = entre('id="mobile-menu"', "</nav>");

describe("barre de navigation du bureau allégée", () => {
  it("n'affiche que 4 liens directs", () => {
    expect(hrefs(blocLiensBureau)).toEqual(["/", "/aide-moi-a-choisir", "/recettes", "/dilemme"]);
  });

  it("range Idées, IA et Photos dans le menu « Plus »", () => {
    const h = hrefs(panneauPlus.split("</div>")[0]);
    expect(h).toEqual(["/idees", "/ia", "/admin/photos"]);
  });

  it("garde les 7 destinations dans le menu mobile", () => {
    expect(hrefs(menuMobile)).toEqual([
      "/", "/aide-moi-a-choisir", "/recettes", "/dilemme", "/idees", "/ia", "/admin/photos",
    ]);
  });

  it("ne duplique aucun lien (bureau + mobile)", () => {
    for (const h of ["/dilemme", "/idees", "/ia", "/admin/photos"]) {
      expect(compte(layout, `href="${h}"`)).toBe(2);
    }
  });

  it("les déclencheurs sont des disclosures accessibles", () => {
    for (const id of ["nav-plus-btn", "theme-menu-btn"]) {
      const debut = layout.indexOf(`id="${id}"`);
      const balise = layout.slice(debut, layout.indexOf(">", debut));
      expect(balise).toContain('type="button"');
      expect(balise).toContain('aria-expanded="false"');
      expect(balise).toContain("aria-controls=");
      expect(balise).toContain("data-menu-btn");
    }
    // Disclosure pure : pas d'aria-haspopup (il annoncerait un role="menu").
    const t = layout.indexOf('id="theme-menu-btn"');
    expect(layout.slice(t, layout.indexOf(">", t))).not.toContain("aria-haspopup");
  });

  it("garde 6 boutons de thème et une seule pilule (mobile)", () => {
    expect(compte(layout, "theme-btn flex")).toBe(6);
    expect(compte(layout, "theme-selector")).toBe(1);
    expect(menuMobile).toContain("theme-selector");
  });
});

describe("styles du menu déroulant", () => {
  it("chaque thème du layout a son icône de thème courant", () => {
    const themes = [...new Set([...layout.matchAll(/data-theme="([a-z]+)"/g)].map((m) => m[1]))];
    expect(themes.sort()).toEqual(["normal", "terrasse", "tigre"]);
    for (const t of themes) expect(css).toContain(`nav-theme-ico-${t}`);
  });

  it("le panneau ne fixe pas de display (sinon `.hidden` ne le masque plus)", () => {
    const decl = css.match(/\.nav-menu-panel\s*\{([^}]*)\}/);
    expect(decl).not.toBeNull();
    expect(decl![1]).not.toMatch(/display\s*:/);
  });
});
