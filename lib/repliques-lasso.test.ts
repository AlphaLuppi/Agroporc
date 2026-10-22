import { describe, expect, it } from "vitest";
import { REPLIQUES_MACRON, REPLIQUES_TIGRE, tirerReplique } from "./repliques-lasso";

describe("répliques du lasso", () => {
  it("ne répète jamais la même réplique deux fois d'affilée", () => {
    for (const liste of [REPLIQUES_TIGRE.pris, REPLIQUES_MACRON.pris, REPLIQUES_MACRON.libre]) {
      let prec: string | null = null;
      for (let i = 0; i < 200; i++) {
        const r = tirerReplique(liste, (i * 0.618) % 1, prec);
        expect(liste).toContain(r);
        expect(r).not.toBe(prec);
        prec = r;
      }
    }
  });

  it("couvre toute la liste et reste dans ses bornes (alea en bout de plage)", () => {
    const vues = new Set<string>();
    for (let i = 0; i < 100; i++) vues.add(tirerReplique(REPLIQUES_TIGRE.pris, i / 100));
    expect(vues.size).toBe(REPLIQUES_TIGRE.pris.length);
    expect(tirerReplique(REPLIQUES_TIGRE.libre, 0.99999)).toBe(REPLIQUES_TIGRE.libre.at(-1));
  });

  it("des bulles courtes : elles tiennent sur une ligne au-dessus de la tête", () => {
    for (const r of [...REPLIQUES_TIGRE.pris, ...REPLIQUES_TIGRE.libre, ...REPLIQUES_MACRON.pris, ...REPLIQUES_MACRON.libre]) {
      expect(r.length).toBeLessThanOrEqual(42);
    }
  });
});
