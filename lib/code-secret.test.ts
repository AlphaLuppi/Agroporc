import { describe, it, expect } from "vitest";
import { ecouterCode, feedCode, type CibleClavier } from "./code-secret";

/** Fausse fenêtre : garde l'écouteur, frappe des touches. */
function fausseCible() {
  let fn: ((e: KeyboardEvent) => void) | null = null;
  const cible: CibleClavier = {
    addEventListener: (_t, f) => { fn = f; },
    removeEventListener: (_t, f) => { if (fn === f) fn = null; },
  };
  const taper = (texte: string, extra: Partial<KeyboardEvent> = {}) => {
    for (const key of texte) fn?.({ key, target: { tagName: "BODY" }, ...extra } as unknown as KeyboardEvent);
  };
  return { cible, taper, actif: () => fn !== null };
}

describe("ecouterCode", () => {
  it("appelle le rappel à chaque saisie complète du code, sans gêner un autre code", () => {
    const f = fausseCible();
    let macron = 0;
    const fin = ecouterCode("macron", () => macron++, f.cible);
    f.taper("myrtille ma macron macronMACRON");
    expect(macron).toBe(3);
    fin();
    expect(f.actif()).toBe(false);
  });

  it("ignore les raccourcis (Ctrl, Cmd, Alt), les touches spéciales et les champs de saisie", () => {
    const f = fausseCible();
    let n = 0;
    ecouterCode("macron", () => n++, f.cible);
    f.taper("macron", { metaKey: true });
    f.taper("macron", { target: { tagName: "INPUT" } as unknown as EventTarget });
    f.taper("macron", { target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget });
    expect(n).toBe(0);
  });

  it("ne plante pas sur une touche sans `key` (remplissage automatique) ni pendant une composition (IME)", () => {
    const f = fausseCible();
    let n = 0;
    ecouterCode("macron", () => n++, f.cible);
    expect(() => f.taper("x", { key: undefined })).not.toThrow();
    f.taper("macron", { isComposing: true });
    expect(n).toBe(0);
    f.taper("macron");
    expect(n).toBe(1);
  });

  it("feedCode est commun : même tampon glissant pour tous les codes", () => {
    let b = "";
    let vu = false;
    for (const c of "xxmacron") { const r = feedCode(b, c, "macron"); b = r.buffer; vu ||= r.matched; }
    expect(vu).toBe(true);
    expect(b).toBe("");
  });
});
