import { describe, expect, it } from "vitest";
import {
  ARGENT_DEV_MAX, BORNES_DEV, CHAMPS_DEV_PAR_MODE, REGLES_DEV_DEFAUT, actionPermise, annonceDev, autoriseDev, differencesDev, differencesEvenements,
  estDefautDev, libelleAction, libelleMult, limiterAuMode, multBudgetVitesse, normaliserActionDev, normaliserReglesDev, ramener, reglesDevEgales, texteRefusDev,
  type ReglesDev,
} from "./regles-dev";
import { JEU } from "./protocole";

describe("ramener : pas et bornes", () => {
  it("une valeur est ramenée au pas puis aux bornes, au centième près", () => {
    expect(ramener(0.3, BORNES_DEV.gravite, 1)).toBe(0.25);
    expect(ramener(0.4, BORNES_DEV.gravite, 1)).toBe(0.5);
    expect(ramener(99, BORNES_DEV.degats, 1)).toBe(5);
    expect(ramener(-3, BORNES_DEV.vitesse, 1)).toBe(0.5);
    expect(ramener(1.1, BORNES_DEV.vitesse, 1)).toBe(1);
    expect(ramener(4321, BORNES_DEV.reapparitionMs, 4000)).toBe(4500);
  });
  it("non numérique, NaN, infini : la valeur de repli", () => {
    for (const x of ["2", null, undefined, NaN, Infinity, {}, []]) expect(ramener(x, BORNES_DEV.degats, 1.5)).toBe(1.5);
  });
});

describe("normaliserReglesDev", () => {
  it("défaut : règles d'une partie normale", () => {
    expect(REGLES_DEV_DEFAUT).toEqual({ degats: 1, vitesse: 1, gravite: 1, munitionsInfinies: false, regeneration: true, reapparitionMs: JEU.delaiReapparitionMs });
    expect(estDefautDev(REGLES_DEV_DEFAUT)).toBe(true);
    expect(Object.isFrozen(REGLES_DEV_DEFAUT)).toBe(true);
  });
  it("un patch ne change que les clés données, bornées", () => {
    const r = normaliserReglesDev({ gravite: 0.5, degats: 100, munitionsInfinies: true });
    expect(r).toEqual({ ...REGLES_DEV_DEFAUT, gravite: 0.5, degats: 5, munitionsInfinies: true });
    expect(estDefautDev(r)).toBe(false);
  });
  it("jamais de jet : non-objet, clés inconnues, types faux", () => {
    for (const brut of [null, undefined, 3, "x", [], [1]]) expect(normaliserReglesDev(brut)).toEqual(REGLES_DEV_DEFAUT);
    expect(normaliserReglesDev({ pirate: 1, gravite: "lourde", munitionsInfinies: "oui", regeneration: 0 })).toEqual(REGLES_DEV_DEFAUT);
  });
  it("part d'une base donnée et ne la modifie pas", () => {
    const base: ReglesDev = { ...REGLES_DEV_DEFAUT, vitesse: 2 };
    const r = normaliserReglesDev({ degats: 2 }, base);
    expect(r).toEqual({ ...base, degats: 2 });
    expect(base.degats).toBe(1);
  });
  it("reglesDevEgales compare tous les champs", () => {
    expect(reglesDevEgales(REGLES_DEV_DEFAUT, { ...REGLES_DEV_DEFAUT })).toBe(true);
    for (const patch of [{ degats: 2 }, { vitesse: 2 }, { gravite: 2 }, { munitionsInfinies: true }, { regeneration: false }, { reapparitionMs: 1000 }]) {
      expect(reglesDevEgales(REGLES_DEV_DEFAUT, { ...REGLES_DEV_DEFAUT, ...patch })).toBe(false);
    }
  });
});

describe("limiterAuMode", () => {
  const voulues: ReglesDev = { degats: 3, vitesse: 2, gravite: 0.5, munitionsInfinies: true, regeneration: false, reapparitionMs: 1000 };
  it("l'arène garde tout", () => {
    expect(limiterAuMode("arene", voulues)).toEqual(voulues);
  });
  it("zombies et BR : ni régénération ni délai de réapparition (ils n'existent pas)", () => {
    for (const mode of ["zombies", "br"] as const) {
      const r = limiterAuMode(mode, voulues);
      expect(r).toEqual({ ...voulues, regeneration: true, reapparitionMs: JEU.delaiReapparitionMs });
    }
  });
  it("chaque mode annonce ses champs", () => {
    expect(CHAMPS_DEV_PAR_MODE.arene).toContain("reapparitionMs");
    expect(CHAMPS_DEV_PAR_MODE.zombies).not.toContain("regeneration");
  });
});

describe("actions", () => {
  it("forcer : événement de la liste fermée seulement", () => {
    expect(normaliserActionDev({ k: "forcer", evenement: "police" })).toEqual({ k: "forcer", evenement: "police" });
    expect(normaliserActionDev({ k: "forcer", evenement: "pirate" })).toBeNull();
    expect(normaliserActionDev({ k: "forcer" })).toBeNull();
  });
  it("argent : entier de 1 au plafond", () => {
    expect(normaliserActionDev({ k: "argent", montant: 2500 })).toEqual({ k: "argent", montant: 2500 });
    for (const montant of [0, -5, 1.5, ARGENT_DEV_MAX + 1, "10", NaN, undefined]) expect(normaliserActionDev({ k: "argent", montant })).toBeNull();
  });
  it("bonus : genre connu ; courant, passerManche, reinitialiser sans paramètre", () => {
    expect(normaliserActionDev({ k: "bonus", genre: "nuke" })).toEqual({ k: "bonus", genre: "nuke" });
    expect(normaliserActionDev({ k: "bonus", genre: "or" })).toBeNull();
    for (const k of ["courant", "passerManche", "reinitialiser"]) expect(normaliserActionDev({ k })).toEqual({ k });
  });
  it("types inconnus, non-objets : null", () => {
    for (const x of [null, undefined, 3, "courant", [], { k: "tuerTout" }, { k: 3 }]) expect(normaliserActionDev(x)).toBeNull();
  });
  it("actionPermise : événements en arène (la police aussi en BR), argent et manches en zombies, réinitialiser partout", () => {
    expect(actionPermise("arene", { k: "forcer", evenement: "truck" })).toBe(true);
    expect(actionPermise("br", { k: "forcer", evenement: "police" })).toBe(true);
    expect(actionPermise("br", { k: "forcer", evenement: "truck" })).toBe(false);
    expect(actionPermise("zombies", { k: "forcer", evenement: "police" })).toBe(false);
    for (const a of [{ k: "argent", montant: 500 }, { k: "courant" }, { k: "bonus", genre: "nuke" }, { k: "passerManche" }] as const) {
      expect(actionPermise("zombies", a)).toBe(true);
      expect(actionPermise("arene", a)).toBe(false);
      expect(actionPermise("br", a)).toBe(false);
    }
    for (const mode of ["arene", "zombies", "br"] as const) expect(actionPermise(mode, { k: "reinitialiser" })).toBe(true);
  });
});

describe("budget, autorisation, libellés", () => {
  it("le budget de distance ne se resserre jamais, s'élargit avec la vitesse", () => {
    expect(multBudgetVitesse({ ...REGLES_DEV_DEFAUT, vitesse: 0.5 })).toBe(1);
    expect(multBudgetVitesse({ ...REGLES_DEV_DEFAUT, vitesse: 1 })).toBe(1);
    expect(multBudgetVitesse({ ...REGLES_DEV_DEFAUT, vitesse: 2 })).toBe(2);
  });
  it("hall partagé : tout joueur en jeu ; partie créée : l'hôte", () => {
    expect(autoriseDev({ hallLibre: true, estHote: false, enJeu: true })).toBe(true);
    expect(autoriseDev({ hallLibre: true, estHote: true, enJeu: false })).toBe("lobby");
    expect(autoriseDev({ hallLibre: false, estHote: true, enJeu: false })).toBe(true);
    expect(autoriseDev({ hallLibre: false, estHote: false, enJeu: true })).toBe("hote");
  });
  it("multiplicateurs à la française", () => {
    expect(libelleMult(0.5)).toBe("×0,5");
    expect(libelleMult(2)).toBe("×2");
  });
  it("differencesDev : seulement ce qui change, dans l'ordre d'affichage", () => {
    expect(differencesDev(REGLES_DEV_DEFAUT, REGLES_DEV_DEFAUT)).toEqual([]);
    expect(differencesDev(REGLES_DEV_DEFAUT, { ...REGLES_DEV_DEFAUT, gravite: 0.5, degats: 2, munitionsInfinies: true, regeneration: false, reapparitionMs: 1500 }))
      .toEqual(["dégâts ×2", "gravité ×0,5", "munitions infinies", "plus de régénération", "réapparition 1,5 s"]);
    expect(differencesDev({ ...REGLES_DEV_DEFAUT, munitionsInfinies: true }, REGLES_DEV_DEFAUT)).toEqual(["munitions normales"]);
  });
  it("differencesEvenements : cases et fréquence", () => {
    const tous = ["elsa", "avion", "bus", "truck", "tigre", "police"] as const;
    expect(differencesEvenements({ evenements: tous, frequence: "normal" }, { evenements: tous, frequence: "normal" })).toEqual([]);
    expect(differencesEvenements({ evenements: tous, frequence: "normal" }, { evenements: ["elsa", "avion", "bus", "truck", "tigre"], frequence: "chaos" }))
      .toEqual(["sans la police", "événements chaos"]);
    expect(differencesEvenements({ evenements: ["elsa"], frequence: "calme" }, { evenements: ["elsa", "truck"], frequence: "calme" })).toEqual(["avec le Truck Muche fou"]);
  });
  it("libellés d'action et d'annonce", () => {
    expect(libelleAction({ k: "forcer", evenement: "police" })).toBe("événement forcé : la police");
    expect(libelleAction({ k: "argent", montant: 500 })).toBe("+500 $ pour tous");
    expect(annonceDev("Alice", ["gravité ×0,5", "munitions infinies"])).toBe("Alice : gravité ×0,5, munitions infinies");
    expect(annonceDev("Alice", [])).toBe("");
  });
  it("texteRefusDev : un texte pour chaque raison, un repli", () => {
    for (const r of ["hote", "lobby", "limite", "mode", "invalide", "inconnu"]) expect(texteRefusDev(r).length).toBeGreaterThan(5);
  });
});
