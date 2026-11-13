import { describe, expect, it } from "vitest";
import {
  ANTI_SPAM, BULLE_DUREE_S, CATEGORIES, DIRECTIONS_CHAT, FORME_ID_REACTION, MENU_FERME, MENU_REACTIONS, REACTIONS, TEXTE_MAX, appuyerMenu, categorieDeDirection, creerAntiSpam,
  expirerMenu, libelleLigneChat, opaciteBulle, reactionParId, reactionValide, reactionVisible, secondesBlocage,
} from "./reactions";

describe("catalogue", () => {
  it("4 catégories de 4 réactions, une par direction de la croix, dans l'ordre haut, gauche, droite, bas", () => {
    expect(CATEGORIES.map((c) => c.direction)).toEqual(["haut", "gauche", "droite", "bas"]);
    expect(CATEGORIES.map((c) => c.id)).toEqual(["infos", "compliments", "reactions", "excuses"]);
    for (const c of CATEGORIES) expect(c.reactions.map((r) => r.direction)).toEqual([...DIRECTIONS_CHAT]);
    expect(REACTIONS).toHaveLength(16);
  });
  it("identifiants uniques et bien formés, textes uniques, courts (une bulle), en français, sans retour à la ligne", () => {
    expect(new Set(REACTIONS.map((r) => r.id)).size).toBe(16);
    expect(new Set(REACTIONS.map((r) => r.texte)).size).toBe(16);
    for (const r of REACTIONS) {
      expect(r.id, r.id).toMatch(FORME_ID_REACTION);
      expect(r.texte.length, r.texte).toBeGreaterThan(3);
      expect(Array.from(r.texte).length, r.texte).toBeLessThanOrEqual(TEXTE_MAX);
      expect(r.texte).not.toMatch(/[\n\t]/);
      expect(r.texte).toBe(r.texte.trim());
    }
  });
  it("les infos sont réservées à l'équipe, comme dans Rocket League ; les autres catégories sont vues de tous", () => {
    for (const r of REACTIONS) expect(r.equipeSeule, r.id).toBe(r.categorie === "infos");
  });
  it("au thème du site : tigres, trèfle, Truck Muche, Elsa, myrtille, Edenred…", () => {
    const tout = REACTIONS.map((r) => r.texte).join(" | ");
    for (const mot of ["tigre", "trèfle", "Truck", "Elsa", "myrtille", "Edenred", "Goulaf", "plat du jour", "En marche"]) expect(tout, mot).toContain(mot);
  });
  it("recherche par identifiant : inconnu, non texte, objet prototype → undefined, jamais d'exception", () => {
    expect(reactionParId("balle")?.texte).toBe("J'ai la balle !");
    expect(reactionParId("tie-un-tigre")?.categorie).toBe("reactions");
    for (const x of ["", "inconnue", "constructor", "__proto__", 3, null, undefined, {}, ["balle"]]) expect(reactionParId(x), String(x)).toBeUndefined();
    expect(reactionValide("edenred")).toBe(true);
    expect(reactionValide("EDENRED")).toBe(false);
  });
  it("catégorie d'une direction", () => {
    expect(categorieDeDirection("bas").id).toBe("excuses");
    expect(categorieDeDirection("droite").id).toBe("reactions");
  });
});

describe("menu", () => {
  it("un premier appui ouvre la catégorie de la direction, sans rien envoyer", () => {
    const r = appuyerMenu(MENU_FERME, "droite", 1000);
    expect(r).toEqual({ etat: { ouvert: true, categorie: "reactions", depuisMs: 1000 }, envoi: null });
  });
  it("un second appui choisit le message de SA direction et referme", () => {
    const ouvert = appuyerMenu(MENU_FERME, "droite", 1000).etat;
    const r = appuyerMenu(ouvert, "haut", 1500);
    expect(r.envoi).toBe("tie-un-tigre");
    expect(r.etat).toEqual(MENU_FERME);
    expect(appuyerMenu(appuyerMenu(MENU_FERME, "haut", 0).etat, "bas", 10).envoi).toBe("boost");
    expect(appuyerMenu(appuyerMenu(MENU_FERME, "bas", 0).etat, "gauche", 10).envoi).toBe("myrtille");
  });
  it("chacune des 16 réactions est atteignable en deux appuis", () => {
    const atteintes = new Set<string>();
    for (const a of DIRECTIONS_CHAT) for (const b of DIRECTIONS_CHAT) {
      const r = appuyerMenu(appuyerMenu(MENU_FERME, a, 0).etat, b, 100);
      if (r.envoi) atteintes.add(r.envoi);
    }
    expect(atteintes.size).toBe(16);
  });
  it("expire après le délai : il se referme, et l'appui suivant rouvre une catégorie au lieu d'envoyer", () => {
    const ouvert = appuyerMenu(MENU_FERME, "gauche", 0).etat;
    expect(expirerMenu(ouvert, MENU_REACTIONS.expirationMs - 1)).toBe(ouvert);
    expect(expirerMenu(ouvert, MENU_REACTIONS.expirationMs)).toEqual(MENU_FERME);
    const r = appuyerMenu(ouvert, "haut", MENU_REACTIONS.expirationMs + 50);
    expect(r.envoi).toBeNull();
    expect(r.etat).toEqual({ ouvert: true, categorie: "infos", depuisMs: MENU_REACTIONS.expirationMs + 50 });
  });
  it("un menu fermé reste le même objet (rien à réallouer à chaque image)", () => {
    expect(expirerMenu(MENU_FERME, 99999)).toBe(MENU_FERME);
  });
});

describe("anti-spam", () => {
  const regles = ANTI_SPAM;
  it("accepte `messages` envois dans la fenêtre, bloque au suivant, puis se libère", () => {
    const a = creerAntiSpam();
    for (let i = 0; i < regles.messages; i++) expect(a.essayer(i * 100), `envoi ${i}`).toBe(true);
    expect(a.essayer(500)).toBe(false);
    expect(a.bloqueMs(500)).toBe(regles.blocageMs);
    expect(a.bloqueMs(500 + regles.blocageMs - 1)).toBe(1);
    expect(a.essayer(500 + regles.blocageMs - 1)).toBe(false);
    expect(a.essayer(500 + regles.blocageMs)).toBe(true);
    expect(a.bloqueMs(500 + regles.blocageMs + 1)).toBe(0);
  });
  it("des envois espacés ne bloquent jamais", () => {
    const a = creerAntiSpam();
    for (let i = 0; i < 40; i++) expect(a.essayer(i * 2000), `envoi ${i}`).toBe(true);
  });
  it("la fenêtre glisse : le plus ancien sort au bout de `fenetreMs`", () => {
    const a = creerAntiSpam();
    expect(a.essayer(0)).toBe(true);
    expect(a.essayer(1000)).toBe(true);
    expect(a.essayer(2000)).toBe(true);
    expect(a.essayer(3000)).toBe(true);
    // le premier (t = 0) est sorti à 5000 : une place se libère
    expect(a.essayer(regles.fenetreMs)).toBe(true);
    expect(a.essayer(regles.fenetreMs + 1)).toBe(false);
  });
  it("un envoi refusé pendant le blocage ne le prolonge pas ; réinitialiser libère", () => {
    const a = creerAntiSpam();
    for (let i = 0; i < regles.messages; i++) a.essayer(0);
    expect(a.essayer(1)).toBe(false);
    const reste = a.bloqueMs(1);
    expect(a.essayer(2)).toBe(false);
    expect(a.bloqueMs(1)).toBe(reste);
    a.reinitialiser();
    expect(a.essayer(3)).toBe(true);
    expect(a.bloqueMs(3)).toBe(0);
  });
  it("deux limiteurs sont indépendants (un par émetteur)", () => {
    const a = creerAntiSpam(), b = creerAntiSpam();
    for (let i = 0; i < 6; i++) a.essayer(0);
    expect(b.essayer(0)).toBe(true);
  });
  it("règles personnalisées", () => {
    const a = creerAntiSpam({ messages: 1, fenetreMs: 1000, blocageMs: 10 });
    expect(a.essayer(0)).toBe(true);
    expect(a.essayer(1)).toBe(false);
    expect(a.essayer(11)).toBe(true);
  });
  it("secondesBlocage arrondit au-dessus", () => {
    expect(secondesBlocage(0)).toBe(0);
    expect(secondesBlocage(-5)).toBe(0);
    expect(secondesBlocage(1)).toBe(1);
    expect(secondesBlocage(3001)).toBe(4);
  });
});

describe("affichage", () => {
  it("opacité d'une bulle : apparition rapide, plein, fondu final, rien au-delà de la durée", () => {
    expect(opaciteBulle(0)).toBe(0);
    expect(opaciteBulle(0.075)).toBeCloseTo(0.5, 5);
    expect(opaciteBulle(1)).toBe(1);
    expect(opaciteBulle(BULLE_DUREE_S - 0.25)).toBeCloseTo(0.5, 5);
    expect(opaciteBulle(BULLE_DUREE_S)).toBe(0);
    expect(opaciteBulle(-1)).toBe(0);
    expect(opaciteBulle(NaN)).toBe(0);
  });
  it("mouvement réduit : plein ou rien, sans fondu", () => {
    expect(opaciteBulle(0, true)).toBe(1);
    expect(opaciteBulle(BULLE_DUREE_S - 0.1, true)).toBe(1);
    expect(opaciteBulle(BULLE_DUREE_S, true)).toBe(0);
  });
  it("visibilité : ses propres messages et ceux de l'équipe toujours ; les adversaires selon le réglage, jamais leurs infos", () => {
    const info = { equipeSeule: true }, libre = { equipeSeule: false };
    expect(reactionVisible(info, { equipe: "bleue", moi: true }, "bleue", false)).toBe(true);
    expect(reactionVisible(info, { equipe: "bleue", moi: false }, "bleue", false)).toBe(true);
    expect(reactionVisible(libre, { equipe: "bleue", moi: false }, "bleue", false)).toBe(true);
    expect(reactionVisible(libre, { equipe: "orange", moi: false }, "bleue", true)).toBe(true);
    expect(reactionVisible(libre, { equipe: "orange", moi: false }, "bleue", false)).toBe(false);
    expect(reactionVisible(info, { equipe: "orange", moi: false }, "bleue", true)).toBe(false);
  });
  it("ligne du fil : « (équipe) » devant le nom pour une info d'équipe", () => {
    expect(libelleLigneChat({ nom: "Alice", texte: "J'ai la balle !", equipeSeule: true })).toBe("(équipe) Alice : J'ai la balle !");
    expect(libelleLigneChat({ nom: "Bob", texte: "RRRROAAAR !", equipeSeule: false })).toBe("Bob : RRRROAAAR !");
  });
});
