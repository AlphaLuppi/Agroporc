import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RestoBadge, { type VarianteBadge } from "../app/components/RestoBadge";

const rendu = (nom: string, variante: VarianteBadge, complet = false) =>
  renderToStaticMarkup(createElement(RestoBadge, { nom, variante, complet }));

describe("RestoBadge", () => {
  it("cache au lecteur d'écran les variantes picto seul (le nom est écrit à côté)", () => {
    for (const v of ["icone", "picto"] as const) {
      const html = rendu("Basilic n'Go", v);
      expect(html).toMatch(/^<span[^>]*aria-hidden="true"/);
      expect(html).not.toContain("role=");
      expect(html).not.toContain("aria-label");
      expect(html).not.toContain("Basilic");
    }
  });

  it("affiche le nom court et garde le nom complet pour title et lecteurs d'écran", () => {
    for (const v of ["chip", "ligne"] as const) {
      const html = rendu("La Pause Gourmande", v);
      expect(html).toContain('title="La Pause Gourmande"');
      expect(html).toMatch(/aria-hidden="true">La Pause<\/span>/);
      expect(html).toMatch(/>La Pause Gourmande<\/span>/);
    }
  });

  it("n'ajoute ni title ni doublon quand le nom est affiché en entier", () => {
    const html = rendu("Le Truck Muche", "chip", true);
    expect(html).not.toContain("title=");
    expect(html.match(/Le Truck Muche/g)).toHaveLength(1);
    expect(rendu("Dubble", "ligne").match(/Dubble/g)).toHaveLength(1);
  });

  it("le picto SVG reste toujours décoratif", () => {
    expect(rendu("Le Bistrot Trèfle", "chip")).toMatch(/<svg aria-hidden="true"/);
  });
});
