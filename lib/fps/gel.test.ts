import { describe, expect, it } from "vitest";
import { GelPartie, doitAutoSuspendre, texteRefusPause } from "./gel";

describe("GelPartie", () => {
  it("dégelé : le dt passe, les actions et les états sont autorisés", () => {
    const g = new GelPartie();
    expect(g.gele).toBe(false);
    expect(g.dtEffectif(0.016)).toBe(0.016);
    expect(g.peutEmettreEtat()).toBe(true);
    expect(g.actionsAutorisees()).toBe(true);
    expect(g.peutRegarder()).toBe(true);
    expect(g.hud(1000)).toEqual({ suspendue: false, suspenduePar: "", compteS: 0 });
  });

  it("gelé : dt nul, aucun `etat` émis, aucune action autorisée, la vue ne tourne plus", () => {
    const g = new GelPartie();
    g.appliquer({ actif: true, par: "j2", pseudo: "Bob" }, 5000);
    expect(g.gele).toBe(true);
    expect(g.dtEffectif(0.016)).toBe(0);
    expect(g.dtEffectif(0.1)).toBe(0);
    expect(g.peutEmettreEtat()).toBe(false);
    expect(g.actionsAutorisees()).toBe(false);
    expect(g.peutRegarder()).toBe(false);
    expect(g.hud(5000)).toEqual({ suspendue: true, suspenduePar: "Bob", compteS: 0 });
  });

  it("l'horloge locale du jeu cumulée par dtEffectif est figée : la cuisson d'une grenade n'avance pas (elle ne part pas seule à la levée)", () => {
    const g = new GelPartie();
    let t = 0; // horloge locale du jeu, comme `t += dt` de jeu.ts
    const cuissonDebut = 0.4;
    const avancer = (secondes: number) => { for (let i = 0; i < secondes * 60; i++) t += g.dtEffectif(1 / 60); };
    avancer(1);
    const avant = t;
    g.appliquer({ actif: true, par: "j2", pseudo: "Bob" }, 0);
    avancer(600); // dix minutes d'images pendant la suspension
    expect(t).toBe(avant);
    expect(t - cuissonDebut).toBeCloseTo(avant - cuissonDebut, 12); // cuisson écoulée : inchangée
    g.appliquer({ actif: false }, 0);
    avancer(1);
    expect(t).toBeCloseTo(avant + 1, 6);
  });

  it("compte à rebours : secondes restantes arrondies au-dessus, jeu encore figé, tombe à 0", () => {
    const g = new GelPartie();
    g.appliquer({ actif: true, par: "j1", pseudo: "Alice", compte: 3000 }, 10_000);
    expect(g.enCompte()).toBe(true);
    expect(g.compteRestantS(10_000)).toBe(3);
    expect(g.compteRestantS(11_100)).toBe(2);
    expect(g.compteRestantS(12_900)).toBe(1);
    expect(g.compteRestantS(13_000)).toBe(0);
    expect(g.compteRestantS(99_000)).toBe(0);
    expect(g.gele).toBe(true);
    expect(g.dtEffectif(0.016)).toBe(0);
    // annulation du compte à rebours : un zpause sans `compte`
    g.appliquer({ actif: true, par: "j1", pseudo: "Alice" }, 11_000);
    expect(g.enCompte()).toBe(false);
    expect(g.compteRestantS(11_500)).toBe(0);
  });

  it("`zpause{false}` ou `reinitialiser` (bienvenue, quitter, dispose) dégèle", () => {
    const g = new GelPartie();
    g.appliquer({ actif: true, par: "j1", pseudo: "A", compte: 1000 }, 0);
    g.appliquer({ actif: false }, 5);
    expect(g.gele).toBe(false);
    expect(g.hud(10)).toEqual({ suspendue: false, suspenduePar: "", compteS: 0 });
    g.appliquer({ actif: true, par: "j1", pseudo: "A" }, 0);
    g.reinitialiser();
    expect(g.gele).toBe(false);
    expect(g.dtEffectif(1)).toBe(1);
  });

  it("un zpause antérieur à la création du jeu est appliqué à la création (mémoire du client réseau)", () => {
    const g = new GelPartie();
    g.depuisMemoire({ actif: true, par: "j3", pseudo: "Cora", compteFinLocal: 20_000 });
    expect(g.gele).toBe(true);
    expect(g.par).toBe("j3");
    expect(g.compteRestantS(18_500)).toBe(2);
    g.depuisMemoire(null);
    expect(g.gele).toBe(false);
    g.depuisMemoire({ actif: true, compteFinLocal: null });
    expect(g.gele).toBe(true);
    g.depuisMemoire(undefined);
    expect(g.gele).toBe(false);
  });
});

describe("doitAutoSuspendre (Échap en solo)", () => {
  const base = { zombies: true, phase: "manche", admisCount: 1, dejaVerrouille: true, gele: false, connecte: true, killcam: false };

  it("seul admis, en manche ou entre deux manches, après la première prise de souris : oui", () => {
    expect(doitAutoSuspendre(base)).toBe(true);
    expect(doitAutoSuspendre({ ...base, phase: "pause" })).toBe(true);
    expect(doitAutoSuspendre({ ...base, admisCount: 0 })).toBe(true);
  });

  it("à plusieurs, jamais (un alt-tab gèlerait les autres)", () => {
    expect(doitAutoSuspendre({ ...base, admisCount: 2 })).toBe(false);
    expect(doitAutoSuspendre({ ...base, admisCount: 8 })).toBe(false);
  });

  it("jamais avant la première prise de souris, au lobby, en fin de partie, déjà figé, hors zombies, déconnecté, en killcam", () => {
    expect(doitAutoSuspendre({ ...base, dejaVerrouille: false })).toBe(false);
    expect(doitAutoSuspendre({ ...base, phase: "lobby" })).toBe(false);
    expect(doitAutoSuspendre({ ...base, phase: "fin" })).toBe(false);
    expect(doitAutoSuspendre({ ...base, phase: null })).toBe(false);
    expect(doitAutoSuspendre({ ...base, gele: true })).toBe(false);
    expect(doitAutoSuspendre({ ...base, zombies: false })).toBe(false);
    expect(doitAutoSuspendre({ ...base, connecte: false })).toBe(false);
    expect(doitAutoSuspendre({ ...base, killcam: true })).toBe(false);
  });
});

describe("texteRefusPause", () => {
  it("dit la limite, ne dit rien pour « plusieurs »", () => {
    expect(texteRefusPause("limite")).toBe("Pause indisponible : limite atteinte");
    expect(texteRefusPause("plusieurs")).toBe("");
    expect(texteRefusPause("lobby")).toContain("Pause indisponible");
    expect(texteRefusPause("inconnu")).toContain("Pause indisponible");
  });
});
