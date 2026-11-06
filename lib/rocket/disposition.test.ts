import { describe, expect, it } from "vitest";
import { libelleTouche } from "@/lib/fps/touches";
import { apprendreDisposition } from "./disposition";

describe("disposition apprise au clavier", () => {
  it("une touche inconnue, un chiffre ou une touche spéciale ne change rien", () => {
    expect(apprendreDisposition(null, "Space", " ")).toBeNull();
    expect(apprendreDisposition(null, "Digit1", "&")).toBeNull();
    expect(apprendreDisposition(null, "KeyW", "Dead")).toBeNull();
  });
  it("QWERTY : KeyW produit « w », la disposition apprise reste fidèle", () => {
    const d = apprendreDisposition(null, "KeyW", "w");
    expect(libelleTouche("KeyW", d)).toBe("W");
    expect(d?.has("KeyQ")).toBe(false);
  });
  it("AZERTY : un seul appui de la touche Z (KeyW) fait écrire Z, Q, S… comme sur le clavier", () => {
    const d = apprendreDisposition(null, "KeyW", "z");
    expect(libelleTouche("KeyW", d)).toBe("Z");
    expect(libelleTouche("KeyA", d)).toBe("Q");
    expect(libelleTouche("KeyQ", d)).toBe("A");
    expect(libelleTouche("KeyZ", d)).toBe("W");
    expect(libelleTouche("KeyD", d)).toBe("D");
  });
  it("ne mute jamais la disposition reçue et rend la même quand rien ne change", () => {
    const d = apprendreDisposition(null, "KeyW", "z")!;
    const taille = d.size;
    expect(apprendreDisposition(d, "KeyW", "Z")).toBe(d);
    const e = apprendreDisposition(d, "KeyM", ",") ;
    expect(e).toBe(d); // « , » n'est pas une lettre
    expect(d.size).toBe(taille);
  });
});
