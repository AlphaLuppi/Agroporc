import { describe, expect, it } from "vitest";
import type { InstantaneManette } from "./contrat";
import { baseDeCapture, captureEnCours, debuterCapture, detecterEntree, toutRelache } from "./capture";

function pad(opts: { axes?: number[]; boutons?: Record<number, number | boolean> } = {}): InstantaneManette {
  const boutons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const [i, v] of Object.entries(opts.boutons ?? {})) boutons[Number(i)] = typeof v === "boolean" ? { pressed: v, value: v ? 1 : 0 } : { pressed: v > 0.5, value: v };
  return { axes: opts.axes ?? [0, 0, 0, 0], boutons };
}

describe("drapeau de capture", () => {
  it("levé tant qu'une capture est ouverte, baissé à la fermeture (idempotente), compté", () => {
    expect(captureEnCours()).toBe(false);
    const a = debuterCapture();
    const b = debuterCapture();
    expect(captureEnCours()).toBe(true);
    a();
    a();
    expect(captureEnCours()).toBe(true);
    b();
    expect(captureEnCours()).toBe(false);
  });
});

describe("détection d'une entrée de manette", () => {
  it("repos : rien", () => {
    expect(detecterEntree(baseDeCapture(pad()), pad()).code).toBeNull();
  });
  it("un bouton pressé, une gâchette enfoncée", () => {
    const base = baseDeCapture(pad());
    expect(detecterEntree(base, pad({ boutons: { 0: true } })).code).toBe("B0");
    expect(detecterEntree(base, pad({ boutons: { 7: 0.9 } })).code).toBe("B7");
    expect(detecterEntree(base, pad({ boutons: { 7: 0.2 } })).code).toBeNull();
  });
  it("ignore le bouton qui était déjà enfoncé au clic, jusqu'à son relâchement", () => {
    const base = baseDeCapture(pad({ boutons: { 0: true } }));
    const r1 = detecterEntree(base, pad({ boutons: { 0: true } }));
    expect(r1.code).toBeNull();
    const r2 = detecterEntree(r1.base, pad());
    expect(r2.code).toBeNull();
    expect(detecterEntree(r2.base, pad({ boutons: { 0: true } })).code).toBe("B0");
    // un autre bouton est détecté même pendant que le premier est tenu
    expect(detecterEntree(base, pad({ boutons: { 0: true, 2: true } })).code).toBe("B2");
  });
  it("demi-axe d'un stick, dans le bon sens, au-delà du seuil seulement", () => {
    const base = baseDeCapture(pad());
    expect(detecterEntree(base, pad({ axes: [-0.9, 0, 0, 0] })).code).toBe("A0-");
    expect(detecterEntree(base, pad({ axes: [0, 0.8, 0, 0] })).code).toBe("A1+");
    expect(detecterEntree(base, pad({ axes: [0, 0, 0, -1] })).code).toBe("A3-");
    expect(detecterEntree(base, pad({ axes: [0.3, -0.3, 0.2, 0] })).code).toBeNull();
  });
  it("plusieurs axes poussés : le plus fort l'emporte", () => {
    expect(detecterEntree(baseDeCapture(pad()), pad({ axes: [0.7, -0.95, 0, 0] })).code).toBe("A1-");
  });
  it("un stick tenu au départ est ignoré tant qu'il n'est pas revenu au centre, puis redevient détectable", () => {
    const base = baseDeCapture(pad({ axes: [-1, 0, 0, 0] }));
    const r1 = detecterEntree(base, pad({ axes: [-1, 0, 0, 0] }));
    expect(r1.code).toBeNull();
    const r2 = detecterEntree(r1.base, pad({ axes: [0, 0, 0, 0] }));
    expect(r2.code).toBeNull();
    // il a été relâché puis repoussé : même sens, détecté (l'état de repos n'est pas -1)
    expect(detecterEntree(r2.base, pad({ axes: [-1, 0, 0, 0] })).code).toBe("A0-");
  });
  it("repos non nul d'un axe de gâchette (-1) : ignoré ; poussé vers + : détecté", () => {
    const repos = { axes: [0, 0, 0, 0, -1, -1] };
    const base = baseDeCapture(pad(repos));
    expect(detecterEntree(base, pad(repos)).code).toBeNull();
    expect(detecterEntree(base, pad({ axes: [0, 0, 0, 0, 1, -1] })).code).toBe("A4+");
    expect(detecterEntree(base, pad({ axes: [0, 0, 0, 0, -1, 0.6] })).code).toBe("A5+");
  });
  it("les boutons passent avant les axes", () => {
    expect(detecterEntree(baseDeCapture(pad()), pad({ axes: [1, 0, 0, 0], boutons: { 3: true } })).code).toBe("B3");
  });
  it("ne modifie pas la base reçue", () => {
    const base = baseDeCapture(pad({ boutons: { 0: true } }));
    const copie = JSON.stringify(base);
    detecterEntree(base, pad());
    expect(JSON.stringify(base)).toBe(copie);
  });
  it("tout relâché : plus de bouton ni de stick poussé, repos non nul compris", () => {
    const base = baseDeCapture(pad({ axes: [0, 0, 0, 0, -1] }));
    expect(toutRelache(base, pad({ axes: [0, 0, 0, 0, -1] }))).toBe(true);
    expect(toutRelache(base, pad({ boutons: { 9: true }, axes: [0, 0, 0, 0, -1] }))).toBe(false);
    expect(toutRelache(base, pad({ axes: [0.8, 0, 0, 0, -1] }))).toBe(false);
    expect(toutRelache(base, pad({ axes: [0, 0, 0, 0, 1] }))).toBe(false);
  });
});
