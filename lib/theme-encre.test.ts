import { describe, expect, it } from "vitest";
import { blobSvg, COUVERTURE_BLOB, elementSousPointeur, rayonCouvrant, tailleMasque } from "./theme-encre";

describe("tache d'encre du thème", () => {
  it("vise le coin le plus éloigné du bouton", () => {
    expect(rayonCouvrant(0, 0, 300, 400)).toBe(500);
    expect(rayonCouvrant(300, 400, 300, 400)).toBe(500);
    expect(rayonCouvrant(150, 200, 300, 400)).toBe(250);
  });

  it("dimensionne le masque pour que la zone pleine du blob couvre l'écran", () => {
    const taille = tailleMasque(500);
    expect(taille * COUVERTURE_BLOB).toBeGreaterThanOrEqual(500);
  });

  it("produit une url de masque SVG valide, variée par la graine", () => {
    const a = blobSvg(1);
    expect(a.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(a.slice(5, -2)).not.toContain('"');
    expect(decodeURIComponent(a)).toContain("seed='1'");
    expect(blobSvg(2)).not.toBe(a);
  });

  it("retrouve le bouton sous le pointeur en ignorant les boutons masqués", () => {
    const el = (nom: string, left: number, top: number, width: number, height: number) => ({
      nom,
      getBoundingClientRect: () => ({ left, top, width, height }),
    });
    const boutons = [el("masque", 0, 0, 0, 0), el("normal", 10, 10, 30, 20), el("tigre", 50, 10, 30, 20)];
    expect(elementSousPointeur(60, 20, boutons)?.nom).toBe("tigre");
    expect(elementSousPointeur(10, 30, boutons)?.nom).toBe("normal");
    expect(elementSousPointeur(0, 0, boutons)).toBeUndefined();
    expect(elementSousPointeur(45, 20, boutons)).toBeUndefined();
  });
});
