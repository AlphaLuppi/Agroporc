import { describe, expect, it } from "vitest";
import { DEFAUT_CONFIG, LIAISONS_DEFAUT, LIAISONS_MANETTE_DEFAUT, MATCH, type ConfigMatch, type StockageMinimal } from "./contrat";
import {
  CLE_CONFIG_ROCKET, COMMANDES_BREVES, NOM_JOUEUR_MAX, commandesRocket, configInitiale, configPourLancer, ecrireConfig, libelleConfig, libelleDuree,
  lireConfig, nettoyerNomJoueur, nouvelleGraine, normaliserConfig, resumeEffectifs,
} from "./lobby";

/** Faux `localStorage` : un dictionnaire. */
const faux = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m } satisfies StockageMinimal & { m: Map<string, string> };
};
const casse: StockageMinimal = { getItem: () => { throw new Error("interdit"); }, setItem: () => { throw new Error("interdit"); } };

describe("normaliserConfig", () => {
  it("rend la configuration par défaut pour tout ce qui n'est pas un objet", () => {
    for (const brut of [null, undefined, 42, "x", [], true]) expect(normaliserConfig(brut)).toEqual(DEFAUT_CONFIG());
  });

  it("garde les valeurs valides", () => {
    const c: ConfigMatch = { ...DEFAUT_CONFIG(), format: "3v3", equipeJoueur: "orange", niveauAllies: "debutant", niveauAdversaires: "allstar", dureeS: 600, graine: 1234, nomJoueur: "Louise" };
    expect(normaliserConfig(c)).toEqual(c);
  });

  it("ramène chaque valeur hors liste à son défaut, champ par champ", () => {
    const d = DEFAUT_CONFIG();
    const n = normaliserConfig({ format: "5v5", equipeJoueur: "verte", niveauAllies: "dieu", niveauAdversaires: 3, dureeS: 301, graine: "abc", nomJoueur: 12 });
    expect(n).toEqual(d);
    expect(normaliserConfig({ format: "1v1", dureeS: 180 })).toEqual({ ...d, format: "1v1", dureeS: 180 });
  });

  it("impose les noms d'équipes du jeu, jamais ceux du stockage", () => {
    expect(normaliserConfig({ nomsEquipes: { bleue: "X", orange: "Y" } }).nomsEquipes).toEqual({ bleue: "Les Trèfles", orange: "Les Tigres" });
  });

  it("la graine est un entier 32 bits non nul", () => {
    expect(normaliserConfig({ graine: 12.9 }).graine).toBe(12);
    expect(normaliserConfig({ graine: -1 }).graine).toBe(0xffffffff);
    expect(normaliserConfig({ graine: 0 }).graine).toBe(1);
    expect(normaliserConfig({ graine: Number.NaN }).graine).toBe(DEFAUT_CONFIG().graine);
  });

  it("les durées proposées sont exactement celles du contrat", () => {
    for (const d of MATCH.dureesPermisesS) expect(normaliserConfig({ dureeS: d }).dureeS).toBe(d);
  });
});

describe("nettoyerNomJoueur", () => {
  it("supprime les caractères de contrôle, rogne et borne la longueur", () => {
    expect(nettoyerNomJoueur("  Léa\u0000\n ")).toBe("Léa");
    expect(Array.from(nettoyerNomJoueur("x".repeat(60))).length).toBe(NOM_JOUEUR_MAX);
  });
  it("vide, espaces ou autre type : « Agent »", () => {
    for (const v of ["", "   ", "\u0007", null, 3]) expect(nettoyerNomJoueur(v)).toBe("Agent");
  });
  it("ne coupe pas un caractère hors du plan de base en deux", () => {
    expect(nettoyerNomJoueur("🐯".repeat(30))).toBe("🐯".repeat(NOM_JOUEUR_MAX));
  });
});

describe("libelleConfig", () => {
  it("2v2 · Pro · 5 min pour la configuration par défaut", () => {
    expect(libelleConfig(DEFAUT_CONFIG())).toBe("2v2 · Pro · 5 min");
  });
  it("alliés et adversaires de niveaux différents : alliés d'abord", () => {
    expect(libelleConfig({ ...DEFAUT_CONFIG(), format: "3v3", niveauAllies: "pro", niveauAdversaires: "debutant", dureeS: 420 })).toBe("3v3 · Pro / Débutant · 7 min");
  });
  it("en 1v1 seul le niveau de l'adversaire compte", () => {
    expect(libelleConfig({ ...DEFAUT_CONFIG(), format: "1v1", niveauAllies: "debutant", niveauAdversaires: "allstar", dureeS: 180 })).toBe("1v1 · All-Star · 3 min");
  });
  it("libelleDuree", () => {
    expect(libelleDuree(300)).toBe("5 min");
    expect(libelleDuree(90)).toBe("1,5 min");
  });
});

describe("résumé des effectifs", () => {
  it("dit combien de bots jouent avec et contre le joueur", () => {
    expect(resumeEffectifs("1v1")).toBe("Vous contre 1 bot");
    expect(resumeEffectifs("2v2")).toBe("Vous et 1 bot contre 2 bots");
    expect(resumeEffectifs("3v3")).toBe("Vous et 2 bots contre 3 bots");
  });
});

describe("mémoire locale", () => {
  it("aller-retour sans la graine", () => {
    const s = faux();
    const c: ConfigMatch = { ...DEFAUT_CONFIG(), format: "1v1", equipeJoueur: "orange", niveauAdversaires: "debutant", dureeS: 180, nomJoueur: "Zoé", graine: 777 };
    ecrireConfig(c, s);
    const stocke = JSON.parse(s.m.get(CLE_CONFIG_ROCKET)!);
    expect(stocke).not.toHaveProperty("graine");
    expect(lireConfig(s)).toEqual({ ...c, graine: DEFAUT_CONFIG().graine });
  });
  it("stockage absent, JSON illisible ou qui jette : défauts, jamais d'exception", () => {
    expect(lireConfig(null)).toEqual(DEFAUT_CONFIG());
    expect(lireConfig(faux())).toEqual(DEFAUT_CONFIG());
    expect(lireConfig(faux({ [CLE_CONFIG_ROCKET]: "{pas du json" }))).toEqual(DEFAUT_CONFIG());
    expect(lireConfig(casse)).toEqual(DEFAUT_CONFIG());
    expect(() => ecrireConfig(DEFAUT_CONFIG(), casse)).not.toThrow();
    expect(() => ecrireConfig(DEFAUT_CONFIG(), null)).not.toThrow();
  });
  it("jamais confiance : une valeur douteuse du stockage est normalisée", () => {
    const s = faux({ [CLE_CONFIG_ROCKET]: JSON.stringify({ format: "9v9", dureeS: 999, nomJoueur: "  Bob  " }) });
    expect(lireConfig(s)).toEqual({ ...DEFAUT_CONFIG(), nomJoueur: "Bob" });
  });
  it("le pseudo d'arène est proposé seulement quand aucun nom n'a été mémorisé", () => {
    expect(configInitiale(faux(), "Tigrou").nomJoueur).toBe("Tigrou");
    expect(configInitiale(faux(), "Agent").nomJoueur).toBe("Agent");
    expect(configInitiale(faux(), undefined).nomJoueur).toBe("Agent");
    const s = faux();
    ecrireConfig({ ...DEFAUT_CONFIG(), nomJoueur: "Moi" }, s);
    expect(configInitiale(s, "Tigrou").nomJoueur).toBe("Moi");
  });
});

describe("graine et lancement", () => {
  it("nouvelleGraine : entier 32 bits non nul, borné", () => {
    expect(nouvelleGraine(0)).toBe(1);
    expect(nouvelleGraine(0.5)).toBe(2147483648);
    expect(nouvelleGraine(1)).toBeLessThanOrEqual(0xffffffff);
    expect(nouvelleGraine(Number.NaN)).toBe(2147483648);
    expect(nouvelleGraine(0.25)).not.toBe(nouvelleGraine(0.75));
  });
  it("configPourLancer normalise et tire une graine neuve", () => {
    const c = configPourLancer({ ...DEFAUT_CONFIG(), nomJoueur: "   ", format: "1v1" }, 0.25);
    expect(c.nomJoueur).toBe("Agent");
    expect(c.format).toBe("1v1");
    expect(c.graine).toBe(1073741824);
  });
});

describe("commandesRocket", () => {
  it("écrit les touches du joueur et couvre toutes les actions", () => {
    const cmds = commandesRocket(LIAISONS_DEFAUT);
    expect(cmds.map((c) => c.id)).toEqual(["conduire", "saut", "boost", "derapage", "roulis", "balleCam", "arriere", "klaxon", "reactions", "pause", "classement"]);
    expect(cmds.find((c) => c.id === "conduire")!.touches).toBe("W A S D");
    expect(cmds.find((c) => c.id === "saut")!.touches).toBe("Espace");
    expect(cmds.find((c) => c.id === "boost")!.touches).toBe("Maj gauche ou Clic gauche");
    expect(cmds.find((c) => c.id === "balleCam")!.touches).toBe("Y ou Clic droit");
    for (const id of COMMANDES_BREVES) expect(cmds.some((c) => c.id === id)).toBe(true);
  });
  it("suit la disposition du clavier (AZERTY : Z Q S D) et les liaisons modifiées", () => {
    const azerty = new Map([["KeyW", "z"], ["KeyA", "q"], ["KeyS", "s"], ["KeyD", "d"]]);
    expect(commandesRocket(LIAISONS_DEFAUT, azerty).find((c) => c.id === "conduire")!.touches).toBe("Z Q S D");
    const l = { ...LIAISONS_DEFAUT, saut: ["KeyJ"] };
    expect(commandesRocket(l).find((c) => c.id === "saut")!.touches).toBe("J");
  });
  it("sans manette ou avec `null`, aucun libellé de manette", () => {
    expect(commandesRocket(LIAISONS_DEFAUT, null, null)).toEqual(commandesRocket(LIAISONS_DEFAUT));
    expect(commandesRocket(LIAISONS_DEFAUT).every((c) => !c.touches.includes("·"))).toBe(true);
  });
  it("avec une manette branchée, ses boutons réels suivent ceux du clavier", () => {
    const m = { ...LIAISONS_MANETTE_DEFAUT, saut: ["B5"], boost: ["B7", "A2+"], klaxon: [] };
    const cmds = commandesRocket(LIAISONS_DEFAUT, null, m);
    const touches = (id: string) => cmds.find((c) => c.id === id)!.touches;
    expect(touches("saut")).toBe("Espace · RB");
    expect(touches("boost")).toBe("Maj gauche ou Clic gauche · RT ou Stick D →");
    expect(touches("conduire")).toBe("W A S D · RT Stick G ← LT Stick G →");
    expect(touches("roulis")).toBe("Q E · LB RB");
    expect(touches("pause")).toBe("Échap · Start");
    // action sans liaison de manette : le clavier seul
    expect(touches("klaxon")).toBe("H");
    expect(touches("classement")).toBe("Tab");
  });
});
