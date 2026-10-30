import { describe, expect, it } from "vitest";
import { aleaGraine } from "../agroparc3d/cachettes";
import { tirerEquipe } from "./apercu-noms";

describe("tirerEquipe", () => {
  it("prénoms uniques et couleurs distinctes pour 16 joueurs", () => {
    const e = tirerEquipe(aleaGraine(1), 16);
    expect(new Set(e.map((x) => x.pseudo)).size).toBe(16);
    expect(new Set(e.map((x) => x.couleur)).size).toBe(16);
    expect(e.every((x) => /^#[0-9a-f]{6}$/.test(x.couleur))).toBe(true);
  });
  it("au-delà de 16 : prénom + 2, 3, sans doublon, pas de prénom composé trop long", () => {
    const e = tirerEquipe(aleaGraine(2), 40);
    expect(new Set(e.map((x) => x.pseudo)).size).toBe(40);
    expect(e.some((x) => / 2$/.test(x.pseudo))).toBe(true);
    expect(e.every((x) => x.pseudo.length <= 12)).toBe(true);
  });
  it("déterministe : même graine, même équipe ; autre graine, autre ordre", () => {
    expect(tirerEquipe(aleaGraine(3), 8)).toEqual(tirerEquipe(aleaGraine(3), 8));
    expect(tirerEquipe(aleaGraine(3), 8).map((x) => x.pseudo)).not.toEqual(tirerEquipe(aleaGraine(4), 8).map((x) => x.pseudo));
  });
  it("rang de départ : les couleurs suivent couleurJoueur(rang)", () => {
    expect(tirerEquipe(aleaGraine(1), 2, 5)[0].couleur).not.toBe(tirerEquipe(aleaGraine(1), 2, 0)[0].couleur);
  });
});
