import { describe, expect, it } from "vitest";
import { codesGardesALaSortie, decisionClicLibre, decisionToucheLibre, ecranAvecBarre, inviteReprise, rendreSouris, type ContexteSouris } from "./souris-mort";

const ctx = (c: Partial<ContexteSouris> = {}): ContexteSouris => ({ mode: "arene", apparu: true, vivant: true, entracte: false, forceActif: false, ...c });

describe("souris rendue à la mort (arène)", () => {
  it("la barre des armes n'est proposée qu'à la mort après une apparition ou à l'entracte, en arène, hors crochet de test", () => {
    expect(ecranAvecBarre(ctx({ vivant: false }))).toBe(true);
    expect(ecranAvecBarre(ctx({ entracte: true }))).toBe(true);
    expect(ecranAvecBarre(ctx())).toBe(false);
    // avant la première apparition : « Jouer » prend la souris comme d'habitude
    expect(ecranAvecBarre(ctx({ apparu: false, vivant: false }))).toBe(false);
    expect(ecranAvecBarre(ctx({ vivant: false, mode: "br" }))).toBe(false);
    expect(ecranAvecBarre(ctx({ vivant: false, mode: "zombies" }))).toBe(false);
    expect(ecranAvecBarre(ctx({ vivant: false, forceActif: true }))).toBe(false);
  });

  it("rend la souris seulement si elle est prise", () => {
    expect(rendreSouris({ ...ctx({ vivant: false }), verrouille: true })).toBe(true);
    expect(rendreSouris({ ...ctx({ vivant: false }), verrouille: false })).toBe(false); // menu pause déjà ouvert : il reste
    expect(rendreSouris({ ...ctx({ entracte: true }), verrouille: true })).toBe(true);
    expect(rendreSouris({ ...ctx({ vivant: false, mode: "br" }), verrouille: true })).toBe(false);
  });

  it("clavier sans verrou : les touches marchent à la mort, Échap bascule écran de mort ↔ menu pause, réapparu une touche reprend la souris", () => {
    expect(decisionToucheLibre("Space", true, true)).toBe("traiter");
    expect(decisionToucheLibre("Digit1", true, true)).toBe("traiter");
    expect(decisionToucheLibre("Escape", true, true)).toBe("pause");
    expect(decisionToucheLibre("Escape", false, true)).toBe("ecran");
    expect(decisionToucheLibre("KeyW", true, false)).toBe("reprendre");
    expect(decisionToucheLibre("Escape", true, false)).toBe("pause");
    // menu pause ouvert (Échap) en vie, ou hors de l'arène : comportement historique
    expect(decisionToucheLibre("KeyW", false, false)).toBe("ignorer");
    expect(decisionToucheLibre("Escape", false, false)).toBe("ignorer");
    expect(decisionToucheLibre("Space", false, true)).toBe("ignorer");
  });

  it("menu de développement : ouvert, il garde le clavier ; sa touche (F9) ne reprend jamais la souris", () => {
    expect(decisionToucheLibre("F9", true, false, { toucheMenu: true })).toBe("ignorer");
    expect(decisionToucheLibre("F9", true, true, { toucheMenu: true })).toBe("ignorer");
    expect(decisionToucheLibre("KeyW", true, false, { menuOuvert: true })).toBe("ignorer");
    expect(decisionToucheLibre("Space", true, true, { menuOuvert: true })).toBe("ignorer");
    expect(decisionToucheLibre("Escape", true, true, { menuOuvert: true })).toBe("ignorer");
  });

  it("répétition d'une touche tenue à la réapparition : elle agit sans redemander le verrou", () => {
    expect(decisionToucheLibre("KeyW", true, false, { repetition: true })).toBe("traiter");
    expect(decisionToucheLibre("KeyW", true, false, { repetition: false })).toBe("reprendre");
  });

  it("souris rendue par le jeu : l'appuyer pour parler reste enfoncé, toute autre touche est relâchée", () => {
    const actions = (c: string) => ({ KeyT: ["parler"], KeyW: ["avancer"], Space: ["saut", "passer"] } as Record<string, string[]>)[c];
    expect(codesGardesALaSortie(["KeyT", "KeyW", "Space"], actions, true)).toEqual(["KeyT"]);
    expect(codesGardesALaSortie(["KeyT", "KeyW"], actions, false)).toEqual([]);
    expect(codesGardesALaSortie(["KeyQ"], actions, true)).toEqual([]);
  });

  it("clic ou « Reprendre » : retour à l'écran de mort sans prendre la souris, sinon verrou", () => {
    expect(decisionClicLibre(true)).toBe("ecran");
    expect(decisionClicLibre(false)).toBe("verrou");
  });

  it("invite de reprise : réapparu (ou nouveau match) souris rendue et pas encore reprise", () => {
    expect(inviteReprise({ sourisRendue: true, mort: false, entracte: false, verrouille: false })).toBe(true);
    expect(inviteReprise({ sourisRendue: true, mort: true, entracte: false, verrouille: false })).toBe(false);
    expect(inviteReprise({ sourisRendue: true, mort: false, entracte: true, verrouille: false })).toBe(false);
    expect(inviteReprise({ sourisRendue: true, mort: false, entracte: false, verrouille: true })).toBe(false);
    expect(inviteReprise({ mort: false, entracte: false, verrouille: false })).toBe(false);
  });
});
