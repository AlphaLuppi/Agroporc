import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NotesRecette from "../app/recettes/NotesRecette";
import styles from "../app/recettes/recettes.module.css";

type Props = Parameters<typeof NotesRecette>[0];
const rendu = (p: Props) => renderToStaticMarkup(createElement(NotesRecette, p));

describe("NotesRecette", () => {
  it("deux pastilles libellées, Sportif d'abord par défaut", () => {
    const html = rendu({ sportif: 7.5, goulaf: 6 });
    expect(html.indexOf("Sportif")).toBeLessThan(html.indexOf("Goulaf"));
    expect(html).toContain("<b>7,5</b>");
    expect(html).toContain("<b>6</b>");
    expect(html.match(/class="sr-only">sur 10</g)).toHaveLength(2);
    expect(html).not.toContain("data-actif");
  });

  it("aucune note : une seule pastille « Non notée », visible, sans « ? » ni /10", () => {
    const html = rendu({ sportif: null, goulaf: null });
    expect(html).toContain(">Non notée<");
    expect(html).not.toContain("?");
    expect(html).not.toContain("/10");
    expect(html).toContain("Notes indisponibles pour le plat du jour");
  });

  it("une note absente : « ? » masqué aux lecteurs d'écran, « note indisponible » à la place", () => {
    const html = rendu({ sportif: 7, goulaf: null });
    expect(html).toContain('<b aria-hidden="true">?</b>');
    expect(html).toContain('class="sr-only">note indisponible<');
    expect(html).toContain('title="Note Goulaf : note indisponible"');
  });

  it("mode en avant : Goulaf en premier et marqué actif", () => {
    const html = rendu({ sportif: 4, goulaf: 9, enAvant: "goulaf" });
    expect(html.indexOf("Goulaf")).toBeLessThan(html.indexOf("Sportif"));
    expect(html.match(/data-actif/g)).toHaveLength(1);
    expect(html).toMatch(/data-actif="true"[^>]*><span[^>]*>Goulaf/);
  });

  it("couleurs des notes : good / ok / none", () => {
    expect(rendu({ sportif: 8, goulaf: null })).toContain(styles.good);
    expect(rendu({ sportif: 8, goulaf: null })).toContain(styles.none);
    expect(rendu({ sportif: null, goulaf: null })).toContain(styles.none);
    expect(rendu({ sportif: 5.5, goulaf: 5.5 })).toContain(styles.ok);
    expect(rendu({ sportif: 2, goulaf: 2 })).toContain(styles.bad);
  });

  it("title : date d'évaluation du plat quand elle est connue", () => {
    expect(rendu({ sportif: 7, goulaf: 8, date: "2026-10-20" })).toContain("Note du plat du jour évalué le mardi 20 octobre");
    expect(rendu({ sportif: 7, goulaf: null })).toContain('title="Note Sportif : 7 sur 10"');
  });
});
