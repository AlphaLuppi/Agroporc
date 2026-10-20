import { describe, expect, it } from "vitest";
import { dimensionsReduites, erreurFichier, TAILLE_MAX_UPLOAD } from "./image-upload";

describe("dimensionsReduites", () => {
  it("ne touche pas une image déjà assez petite", () => {
    expect(dimensionsReduites(800, 600, 1600)).toEqual({ largeur: 800, hauteur: 600 });
  });

  it("réduit le plus grand côté à max en gardant le ratio (paysage et portrait)", () => {
    expect(dimensionsReduites(4000, 3000, 1600)).toEqual({ largeur: 1600, hauteur: 1200 });
    expect(dimensionsReduites(3024, 4032, 512)).toEqual({ largeur: 384, hauteur: 512 });
  });

  it("ne descend jamais sous 1 px", () => {
    expect(dimensionsReduites(10000, 2, 100)).toEqual({ largeur: 100, hauteur: 1 });
  });
});

describe("erreurFichier", () => {
  it("refuse ce qui n'est pas une image", () => {
    expect(erreurFichier("application/pdf", 10)).toMatch(/pas une image/);
  });

  it("refuse un GIF trop lourd (pas de recompression possible)", () => {
    expect(erreurFichier("image/gif", TAILLE_MAX_UPLOAD + 1)).toMatch(/GIF trop lourd/);
    expect(erreurFichier("image/gif", TAILLE_MAX_UPLOAD)).toBeNull();
  });

  it("accepte une grosse photo (elle sera recompressée)", () => {
    expect(erreurFichier("image/jpeg", 10 * 1024 * 1024)).toBeNull();
    expect(erreurFichier("image/heic", 4 * 1024 * 1024)).toBeNull();
  });
});
