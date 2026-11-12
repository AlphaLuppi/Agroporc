import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultatsCote from "../app/dilemme/ResultatsCote";
import SousNav from "../app/dilemme/SousNav";
import VisuelPlat from "../app/dilemme/VisuelPlat";
import NotesPlat from "../app/dilemme/plats/NotesPlat";
import PartBudgetPrix from "../app/dilemme/plats/PartBudgetPrix";
import { GrilleVotants } from "../app/components/SelecteurVotant";
import { CHARACTERS } from "./characters";

const rendu = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("ResultatsCote", () => {
  it("affiche pourcentage, voix, barre et phrase des votants", () => {
    const html = rendu(createElement(ResultatsCote, { voix: 5, pct: 62, votants: ["Thomas", "Gab", "Jimmy", "Tom", "Nova"] }));
    expect(html).toContain("62 %");
    expect(html).toContain("5 voix");
    expect(html).toContain("width:62%");
    expect(html).toContain("Thomas, Gab et 3 autres");
    // Les noms sont écrits, pas seulement en infobulle.
    expect(html).toContain('title="Nova"');
  });

  it("état à zéro vote", () => {
    const html = rendu(createElement(ResultatsCote, { voix: 0, pct: 0, votants: [] }));
    expect(html).toContain("0 %");
    expect(html).toContain("0 voix");
    expect(html).toContain("width:0%");
    expect(html).toContain("Aucun vote");
  });

  it("un seul votant : son nom seul", () => {
    const html = rendu(createElement(ResultatsCote, { voix: 1, pct: 100, votants: ["Thomas"] }));
    expect(html).toContain("1 voix");
    expect(html).toContain(">Thomas<");
  });
});

describe("SousNav", () => {
  it("marque la page courante avec aria-current", () => {
    const duel = rendu(createElement(SousNav, { actif: "duel" }));
    expect(duel).toMatch(/<a aria-current="page" href="\/dilemme">Le duel/);
    expect(duel.match(/aria-current/g)).toHaveLength(1);
    const plats = rendu(createElement(SousNav, { actif: "plats" }));
    expect(plats).toMatch(/<a aria-current="page" href="\/dilemme\/plats">Tous les plats/);
    expect(plats.match(/aria-current/g)).toHaveLength(1);
    expect(plats).toContain('aria-label="Dilemme"');
  });
});

describe("VisuelPlat", () => {
  it("sans image : fond d'assiette décoratif, aucune balise img", () => {
    const html = rendu(createElement(VisuelPlat, { src: null, nom: "Croziflette" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<img");
  });
  it("avec image : photo décorative (le nom est écrit à côté)", () => {
    const html = rendu(createElement(VisuelPlat, { src: "/api/plat-image/abc?v=1", nom: "Croziflette" }));
    expect(html).toContain('src="/api/plat-image/abc?v=1"');
    expect(html).toContain('alt=""');
  });
});

describe("NotesPlat", () => {
  it("écrit les deux notes en clair", () => {
    const html = rendu(createElement(NotesPlat, { sportif: 7.5, goulaf: 4 }));
    expect(html).toContain("Sportif");
    expect(html).toContain("7,5");
    expect(html).toContain("Goulaf");
    expect(html).toContain("sur 10");
  });
  it("« Non noté » sans aucune note, « note indisponible » pour une seule absente", () => {
    expect(rendu(createElement(NotesPlat, { sportif: null, goulaf: null }))).toContain("Non noté");
    const une = rendu(createElement(NotesPlat, { sportif: 8, goulaf: null }));
    expect(une).toContain("note indisponible");
    expect(une).not.toContain("Non noté");
  });
});

describe("PartBudgetPrix", () => {
  it("prix formaté et part du budget, rien sans prix", () => {
    const html = rendu(createElement(PartBudgetPrix, { prix: "11.9€" }));
    expect(html).toContain("11,90 €");
    expect(html).toContain("6,9");
    expect(rendu(createElement(PartBudgetPrix, { prix: null }))).toBe("");
  });
});

describe("GrilleVotants", () => {
  it("un bouton par personnage, le nom écrit, aucun champ libre", () => {
    const html = rendu(createElement(GrilleVotants, { votant: "Thomas", onChoisir: () => {} }));
    expect(html.match(/<button/g)).toHaveLength(CHARACTERS.length);
    for (const c of CHARACTERS) expect(html).toContain(c.name);
    expect(html).not.toContain("<input");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});

describe("navigation", () => {
  it("app/layout.tsx contient le lien /dilemme dans la barre desktop ET le menu burger", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout.match(/href="\/dilemme"/g)).toHaveLength(2);
  });
  it("aucun autre lien du layout ne préfixe /dilemme", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    const hrefs = [...layout.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.filter((h) => h !== "/dilemme" && h.startsWith("/dilemme"))).toEqual([]);
  });
  it("la cascade du menu mobile couvre les 7 liens", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("#mobile-menu [data-nav-links] a:nth-child(7) { --i: 6; }");
  });
});
