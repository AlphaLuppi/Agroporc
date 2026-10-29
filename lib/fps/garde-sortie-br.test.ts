import { describe, expect, it } from "vitest";
import { gardeSortieBr } from "./garde-sortie-br";

/** Rejoue l'effet de `Agroparc3D` : à chaque changement de phase la garde est recalculée ; le montage n'a lieu que garde baissée en décompte. */
function simuler(suite: { phase: string; mode?: string; sortie?: boolean }[]): { phase: string; monte: boolean }[] {
  let garde = false;
  return suite.map(({ phase, mode = "br", sortie }) => {
    garde = gardeSortieBr(garde, mode, phase);
    const monte = phase === "decompte" && !garde;
    if (sortie) garde = true; // quitterArene() après l'effet
    return { phase, monte };
  });
}

describe("gardeSortieBr", () => {
  it("rejouer : partie, sortie à l'écran de fin, nouveau décompte : le jeu se monte", () => {
    const r = simuler([
      { phase: "lobby" }, { phase: "decompte" }, { phase: "vol" }, { phase: "jeu" }, { phase: "fin", sortie: true },
      { phase: "lobby" }, { phase: "decompte" },
    ]);
    expect(r.filter((x) => x.monte).map((x) => x.phase)).toEqual(["decompte", "decompte"]);
  });

  it("sortie pendant le décompte : le jeu ne se remonte pas dans ce décompte, mais bien dans le suivant", () => {
    const r = simuler([
      { phase: "lobby" }, { phase: "decompte" }, { phase: "decompte", sortie: true }, { phase: "decompte" },
      { phase: "vol" }, { phase: "jeu" }, { phase: "fin" }, { phase: "lobby" }, { phase: "decompte" },
    ]);
    expect(r.map((x) => x.monte)).toEqual([false, true, true, false, false, false, false, false, true]);
  });

  it("sortie en pleine partie (menu pause) : la garde est tombée avant le décompte suivant", () => {
    const r = simuler([{ phase: "decompte" }, { phase: "vol" }, { phase: "jeu", sortie: true }, { phase: "fin" }, { phase: "lobby" }, { phase: "decompte" }]);
    expect(r.at(-1)).toEqual({ phase: "decompte", monte: true });
  });

  it("hors du mode BR ou sans état de partie : la garde tombe", () => {
    expect(gardeSortieBr(true, "arene", "decompte")).toBe(false);
    expect(gardeSortieBr(true, "zombies", "decompte")).toBe(false);
    expect(gardeSortieBr(true, "br", undefined)).toBe(false);
    expect(gardeSortieBr(true, "br", "decompte")).toBe(true);
  });
});
