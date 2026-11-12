import { describe, expect, it } from "vitest";
import { LIAISONS_DEFAUT, LIAISONS_MANETTE_DEFAUT } from "./contrat";
import {
  ACTIONS_MANETTE, ACTIONS_TOUCHES, GROUPES_MANETTE, GROUPES_TOUCHES, LIBELLES_ACTIONS_MANETTE, LIBELLES_ACTIONS_TOUCHES,
  actionsSansEntreeManette, actionsSansTouche, assignerManette, assignerTouche, codeAxe, codeBouton, conflitManette, entreeManetteLiee,
  entreeManetteValide, libelleEntreeManette, lireEntreeManette, manetteEstParDefaut, manetteParDefaut, messageRefus, phraseDepossession,
  touchesParDefaut, touchesSontParDefaut, libelleToucheRocket,
} from "./liaisons";

describe("actions et regroupements", () => {
  it("chaque action du contrat figure une seule fois dans un groupe, avec un libellé", () => {
    expect([...ACTIONS_TOUCHES].sort()).toEqual(Object.keys(LIAISONS_DEFAUT).sort());
    expect([...ACTIONS_MANETTE].sort()).toEqual(Object.keys(LIAISONS_MANETTE_DEFAUT).sort());
    expect(new Set(ACTIONS_TOUCHES).size).toBe(ACTIONS_TOUCHES.length);
    expect(new Set(ACTIONS_MANETTE).size).toBe(ACTIONS_MANETTE.length);
    for (const a of ACTIONS_TOUCHES) expect(LIBELLES_ACTIONS_TOUCHES[a].length).toBeGreaterThan(2);
    for (const a of ACTIONS_MANETTE) expect(LIBELLES_ACTIONS_MANETTE[a].length).toBeGreaterThan(2);
    expect(GROUPES_TOUCHES.length).toBeGreaterThan(1);
    expect(GROUPES_MANETTE.length).toBeGreaterThan(1);
  });
  it("les liaisons par défaut sont valides et sans conflit hors couples gaz / tangage", () => {
    for (const a of ACTIONS_MANETTE) for (const c of LIAISONS_MANETTE_DEFAUT[a]) expect(entreeManetteValide(c), `${a} ${c}`).toBe(true);
    for (const a of ACTIONS_MANETTE) for (const b of ACTIONS_MANETTE) {
      if (!conflitManette(a, b)) continue;
      for (const c of LIAISONS_MANETTE_DEFAUT[a]) expect(LIAISONS_MANETTE_DEFAUT[b], `${a}/${b} partagent ${c}`).not.toContain(c);
    }
    for (const a of ACTIONS_TOUCHES) for (const b of ACTIONS_TOUCHES) {
      if (a === b) continue;
      for (const c of LIAISONS_DEFAUT[a]) expect(LIAISONS_DEFAUT[b], `${a}/${b} partagent ${c}`).not.toContain(c);
    }
  });
});

describe("entrées de manette : syntaxe et libellés", () => {
  it("lit boutons et demi-axes, refuse le reste", () => {
    expect(lireEntreeManette("B7")).toEqual({ type: "bouton", index: 7 });
    expect(lireEntreeManette("B16")).toEqual({ type: "bouton", index: 16 });
    expect(lireEntreeManette("A0-")).toEqual({ type: "axe", index: 0, signe: -1 });
    expect(lireEntreeManette("A3+")).toEqual({ type: "axe", index: 3, signe: 1 });
    for (const x of ["", "B", "B32", "B07", "A", "A0", "A16+", "A00+", "a0+", "KeyW", "B1x", null, undefined, 3, {}]) expect(lireEntreeManette(x), String(x)).toBeNull();
    expect(codeBouton(5)).toBe("B5");
    expect(codeAxe(2, -1)).toBe("A2-");
    expect(lireEntreeManette(codeAxe(1, 1))).toEqual({ type: "axe", index: 1, signe: 1 });
  });
  it("libellés au format Xbox", () => {
    expect(libelleEntreeManette("B0")).toBe("A");
    expect(libelleEntreeManette("B7")).toBe("RT");
    expect(libelleEntreeManette("B9")).toBe("Start");
    expect(libelleEntreeManette("B12")).toBe("Croix ↑");
    expect(libelleEntreeManette("B20")).toBe("Bouton 20");
    expect(libelleEntreeManette("A0-")).toBe("Stick gauche ←");
    expect(libelleEntreeManette("A1+")).toBe("Stick gauche ↓");
    expect(libelleEntreeManette("A2+")).toBe("Stick droit →");
    expect(libelleEntreeManette("A3-", true)).toBe("Stick D ↑");
    expect(libelleEntreeManette("A5+")).toContain("Axe 5");
    expect(libelleEntreeManette(null)).toBe("—");
  });
});

describe("assignerTouche", () => {
  it("pose une touche dans le bon emplacement", () => {
    const r = assignerTouche(LIAISONS_DEFAUT, "saut", 1, "KeyJ");
    expect(r.refus).toBeNull();
    expect(r.liaisons.saut).toEqual(["Space", "KeyJ"]);
    expect(r.depossedees).toEqual([]);
    expect(assignerTouche(LIAISONS_DEFAUT, "saut", 0, "KeyJ").liaisons.saut).toEqual(["KeyJ"]);
  });
  it("ne modifie pas l'entrée et garde les autres actions", () => {
    const avant = JSON.stringify(LIAISONS_DEFAUT);
    const r = assignerTouche(LIAISONS_DEFAUT, "klaxon", 0, "KeyJ");
    expect(JSON.stringify(LIAISONS_DEFAUT)).toBe(avant);
    expect(r.liaisons.boost).toEqual(LIAISONS_DEFAUT.boost);
  });
  it("une touche prise par une autre action lui est retirée, et celle-ci est signalée", () => {
    const r = assignerTouche(LIAISONS_DEFAUT, "saut", 0, "KeyQ");
    expect(r.liaisons.saut).toEqual(["KeyQ"]);
    expect(r.liaisons.rouleGauche).toEqual([]);
    expect(r.depossedees).toEqual(["rouleGauche"]);
    // un bouton de souris aussi : clic gauche quitte le boost
    const s = assignerTouche(LIAISONS_DEFAUT, "klaxon", 1, "Souris0");
    expect(s.liaisons.boost).toEqual(["ShiftLeft"]);
    expect(s.depossedees).toEqual(["boost"]);
  });
  it("le regard libre est une action comme les autres", () => {
    const r = assignerTouche(LIAISONS_DEFAUT, "regardLibre", 0, "Souris2");
    expect(r.liaisons.regardLibre).toEqual(["Souris2"]);
    expect(r.liaisons.balleCam).toEqual(["KeyY"]);
    expect(r.depossedees).toEqual(["balleCam"]);
  });
  it("la même touche dans l'autre emplacement de l'action : échange, pas de doublon", () => {
    const l = { ...LIAISONS_DEFAUT, saut: ["Space", "KeyJ"] };
    expect(assignerTouche(l, "saut", 0, "KeyJ").liaisons.saut).toEqual(["KeyJ", "Space"]);
    expect(assignerTouche(l, "saut", 1, "Space").liaisons.saut).toEqual(["KeyJ", "Space"]);
    expect(assignerTouche(LIAISONS_DEFAUT, "saut", 1, "Space").liaisons.saut).toEqual(["Space"]);
    expect(assignerTouche(l, "saut", 0, "Space").depossedees).toEqual([]);
  });
  it("vider un emplacement ; on peut vider une action entière (elle reste vide)", () => {
    expect(assignerTouche(LIAISONS_DEFAUT, "boost", 1, null).liaisons.boost).toEqual(["ShiftLeft"]);
    expect(assignerTouche(LIAISONS_DEFAUT, "boost", 0, null).liaisons.boost).toEqual(["Souris0"]);
    const vide = assignerTouche(assignerTouche(LIAISONS_DEFAUT, "boost", 0, null).liaisons, "boost", 0, null).liaisons;
    expect(vide.boost).toEqual([]);
    expect(actionsSansTouche(vide)).toEqual(["boost"]);
    expect(assignerTouche(vide, "boost", 1, "KeyB").liaisons.boost).toEqual(["KeyB"]);
  });
  it("Échap et Tab sont refusées, rien ne change", () => {
    for (const code of ["Escape", "Tab"]) {
      const r = assignerTouche(LIAISONS_DEFAUT, "saut", 0, code);
      expect(r.refus).toBe("reservee");
      expect(r.liaisons).toBe(LIAISONS_DEFAUT);
    }
    expect(assignerTouche(LIAISONS_DEFAUT, "saut", 0, "<x>").refus).toBe("invalide");
  });
  it("un bouton de souris ne peut pas servir de pause (le jeu ne la lit qu'au clavier), mais sert aux autres actions", () => {
    for (const code of ["Souris0", "Souris1", "Souris2"]) {
      const r = assignerTouche(LIAISONS_DEFAUT, "pause", 1, code);
      expect(r.refus).toBe("sansEffet");
      expect(r.liaisons).toBe(LIAISONS_DEFAUT);
    }
    expect(assignerTouche(LIAISONS_DEFAUT, "saut", 1, "Souris2").refus).toBeNull();
  });
  it("Échap, premier emplacement de la pause, ne bouge pas ; le second est libre", () => {
    expect(assignerTouche(LIAISONS_DEFAUT, "pause", 0, "KeyP").refus).toBe("fixe");
    expect(assignerTouche(LIAISONS_DEFAUT, "pause", 0, null).refus).toBe("fixe");
    const r = assignerTouche(LIAISONS_DEFAUT, "pause", 1, "KeyP");
    expect(r.liaisons.pause).toEqual(["Escape", "KeyP"]);
    expect(assignerTouche(r.liaisons, "pause", 1, null).liaisons.pause).toEqual(["Escape"]);
  });
  it("retour aux défauts", () => {
    const l = assignerTouche(LIAISONS_DEFAUT, "saut", 0, "KeyJ").liaisons;
    expect(touchesSontParDefaut(LIAISONS_DEFAUT)).toBe(true);
    expect(touchesSontParDefaut(l)).toBe(false);
    expect(touchesSontParDefaut(touchesParDefaut())).toBe(true);
  });
});

describe("assignerManette", () => {
  it("met le gaz sur A, le saut sur RB et le boost sur une gâchette ; le volant sur le stick droit", () => {
    let l = LIAISONS_MANETTE_DEFAUT;
    l = assignerManette(l, "accelerer", 0, "B0").liaisons;
    l = assignerManette(l, "saut", 0, "B5").liaisons;
    l = assignerManette(l, "boost", 0, "B7").liaisons;
    l = assignerManette(l, "gauche", 0, "A2-").liaisons;
    l = assignerManette(l, "droite", 0, "A2+").liaisons;
    expect(l.accelerer).toEqual(["B0"]);
    expect(l.saut).toEqual(["B5"]);
    expect(l.boost).toEqual(["B7"]);
    expect([l.gauche, l.droite]).toEqual([["A2-"], ["A2+"]]);
  });
  it("une entrée prise par une autre action lui est retirée, et celle-ci est signalée", () => {
    const r = assignerManette(LIAISONS_MANETTE_DEFAUT, "saut", 0, "B1");
    expect(r.liaisons.saut).toEqual(["B1"]);
    expect(r.liaisons.boost).toEqual([]);
    expect(r.depossedees).toEqual(["boost"]);
    expect(phraseDepossession("B", r.depossedees, LIBELLES_ACTIONS_MANETTE)).toBe("« B » a été retirée de « Boost (maintenu) ».");
    expect(phraseDepossession("B", [], LIBELLES_ACTIONS_MANETTE)).toBeNull();
  });
  it("le gaz partage son entrée avec « nez en bas », la marche arrière avec « nez en haut » (comme W au clavier), sans dépossession", () => {
    expect(conflitManette("accelerer", "tangageBas")).toBe(false);
    expect(conflitManette("tangageHaut", "reculer")).toBe(false);
    expect(conflitManette("accelerer", "tangageHaut")).toBe(true);
    expect(conflitManette("saut", "saut")).toBe(false);
    const r = assignerManette(LIAISONS_MANETTE_DEFAUT, "accelerer", 0, "A1-");
    expect(r.depossedees).toEqual([]);
    expect(r.liaisons.accelerer).toEqual(["A1-"]);
    expect(r.liaisons.tangageBas).toEqual(["A1-"]);
    // mais un autre conflit est bien résolu : A1- retiré aux deux est impossible, la marche arrière reprend l'entrée de « nez en haut »
    const s = assignerManette(r.liaisons, "reculer", 0, "A1+");
    expect(s.depossedees).toEqual([]);
    expect(s.liaisons.tangageHaut).toEqual(["A1+"]);
    expect(assignerManette(r.liaisons, "saut", 0, "A1-").depossedees.sort()).toEqual(["accelerer", "tangageBas"]);
  });
  it("A ne peut pas servir de pause (il relance le match à l'écran de fin), mais sert aux autres actions", () => {
    const r = assignerManette(LIAISONS_MANETTE_DEFAUT, "pause", 1, "B0");
    expect(r.refus).toBe("rejouer");
    expect(r.liaisons).toBe(LIAISONS_MANETTE_DEFAUT);
    expect(assignerManette(LIAISONS_MANETTE_DEFAUT, "klaxon", 1, "B0").refus).toBeNull();
  });
  it("Start est réservé à la pause ; son emplacement est fixe, le second libre", () => {
    const r = assignerManette(LIAISONS_MANETTE_DEFAUT, "klaxon", 0, "B9");
    expect(r.refus).toBe("reservee");
    expect(r.liaisons).toBe(LIAISONS_MANETTE_DEFAUT);
    expect(assignerManette(LIAISONS_MANETTE_DEFAUT, "pause", 0, "B3").refus).toBe("fixe");
    expect(assignerManette(LIAISONS_MANETTE_DEFAUT, "pause", 0, null).refus).toBe("fixe");
    const p = assignerManette(LIAISONS_MANETTE_DEFAUT, "pause", 1, "B8");
    expect(p.liaisons.pause).toEqual(["B9", "B8"]);
    expect(assignerManette(p.liaisons, "pause", 1, null).liaisons.pause).toEqual(["B9"]);
    // l'entrée donnée à la pause quitte l'action qui l'avait (Y : ball cam)
    const q = assignerManette(LIAISONS_MANETTE_DEFAUT, "pause", 1, "B3");
    expect(q.liaisons.balleCam).toEqual([]);
    expect(q.depossedees).toEqual(["balleCam"]);
  });
  it("refuse une entrée absurde, vide un emplacement, échange deux emplacements d'une même action", () => {
    expect(assignerManette(LIAISONS_MANETTE_DEFAUT, "saut", 0, "KeyW").refus).toBe("invalide");
    expect(assignerManette(LIAISONS_MANETTE_DEFAUT, "saut", 0, null).liaisons.saut).toEqual([]);
    const l = assignerManette(LIAISONS_MANETTE_DEFAUT, "saut", 1, "B5").liaisons;
    expect(l.saut).toEqual(["B0", "B5"]);
    expect(assignerManette(l, "saut", 0, "B5").liaisons.saut).toEqual(["B5", "B0"]);
    expect(assignerManette(l, "saut", 1, "B5").liaisons.saut).toEqual(["B0", "B5"]);
    expect(assignerManette(l, "saut", 1, null).liaisons.saut).toEqual(["B0"]);
  });
  it("outils : retour aux défauts, actions sans entrée, Retour libre ou pris", () => {
    const l = assignerManette(LIAISONS_MANETTE_DEFAUT, "klaxon", 0, null).liaisons;
    expect(actionsSansEntreeManette(l)).toEqual(["klaxon"]);
    expect(manetteEstParDefaut(LIAISONS_MANETTE_DEFAUT)).toBe(true);
    expect(manetteEstParDefaut(l)).toBe(false);
    expect(manetteEstParDefaut(manetteParDefaut())).toBe(true);
    expect(entreeManetteLiee(LIAISONS_MANETTE_DEFAUT, "B8")).toBe(false);
    expect(entreeManetteLiee(assignerManette(LIAISONS_MANETTE_DEFAUT, "klaxon", 0, "B8").liaisons, "B8")).toBe(true);
  });
});

describe("messages", () => {
  it("disent pourquoi une entrée est refusée", () => {
    expect(messageRefus("reservee", "clavier", "Tab")).toContain("classement");
    expect(messageRefus("reservee", "clavier", "Échap")).toContain("pause");
    expect(messageRefus("reservee", "manette", "Start")).toContain("pause");
    expect(messageRefus("fixe", "clavier", "Échap")).toContain("pause");
    expect(messageRefus("fixe", "manette", "Start")).toContain("pause");
    expect(messageRefus("sansEffet", "clavier", "Clic gauche")).toContain("clavier");
    expect(messageRefus("rejouer", "manette", "A")).toContain("relance");
    expect(messageRefus("invalide", "clavier", "?")).toContain("reconnue");
    expect(messageRefus("invalide", "manette", "?")).toContain("reconnue");
  });
});

describe("libelleToucheRocket", () => {
  it("écrit Échap en français, le reste comme l'arène (disposition du clavier du joueur)", () => {
    expect(libelleToucheRocket("Escape")).toBe("Échap");
    expect(libelleToucheRocket("Space")).toBe("Espace");
    expect(libelleToucheRocket("Souris1")).toBe("Clic milieu");
    expect(libelleToucheRocket("KeyW", new Map([["KeyW", "z"]]))).toBe("Z");
    expect(libelleToucheRocket(null)).toBe("—");
  });
});
