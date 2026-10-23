import { describe, expect, it } from "vitest";
import { ABANDON_MS, CONDUCTEUR_TIRE, SILENCE_CONDUCTEUR_MS } from "./garage";

// SQUELETTE (lot 0) : le lot E remplace ce fichier par les vrais tests de garage.ts.
describe("garage (squelette)", () => {
  it("constantes de la spec §2.12", () => {
    expect(CONDUCTEUR_TIRE).toBe(false);
    expect(ABANDON_MS).toBe(60_000);
    expect(SILENCE_CONDUCTEUR_MS).toBe(500);
  });
});
