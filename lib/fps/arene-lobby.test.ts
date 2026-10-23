import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Arene from "../../app/components/arene/Arene";
import ChoixEquipement from "../../app/components/arene/ChoixEquipement";
import {
  BONUS_COUTEAU_POURCENT, CARTES_MAX_DETAILLEES, REGLES_TIR, TEXTE_ARMES_SPECIALES, TEXTE_COUTEAU, commandesLobby, groupePrincipale,
  groupeSecondaire, largeurBarre, noteSur10, toucheDe, armeSuivanteDuGroupe, aideChoixEquipement,
} from "../../app/components/arene/lobby-modele";
import { STATS } from "./armes";
import { ARMES, ARMES_PRINCIPALES, ARMES_SECONDAIRES, ARMES_SPECIALES, JEU, type InfoMatch, type JoueurPublic } from "./protocole";
import { REGLAGES_HUD_DEFAUT } from "./reglages-hud";
import { touchesParDefaut } from "./touches";

describe("modèle du lobby", () => {
  it("deux groupes : les principales et les secondaires, jamais les armes spéciales", () => {
    expect(groupePrincipale().armes.map((a) => a.id)).toEqual([...ARMES_PRINCIPALES]);
    expect(groupeSecondaire().armes.map((a) => a.id)).toEqual([...ARMES_SECONDAIRES]);
    const toutes = [...groupePrincipale().armes, ...groupeSecondaire().armes].map((a) => a.id as string);
    for (const s of ARMES_SPECIALES) expect(toutes).not.toContain(s);
  });

  it("la grille passe en version compacte au-delà de 6 cartes", () => {
    expect(groupePrincipale().compacte).toBe(groupePrincipale().armes.length > CARTES_MAX_DETAILLEES);
    expect(CARTES_MAX_DETAILLEES).toBe(6);
  });

  it("note sur 10 entière de 1 à 10, barre jamais invisible", () => {
    expect(noteSur10(0)).toBe(1);
    expect(noteSur10(0.04)).toBe(1);
    expect(noteSur10(0.55)).toBe(6);
    expect(noteSur10(1)).toBe(10);
    expect(noteSur10(3)).toBe(10);
    expect(largeurBarre(0)).toBe(4);
    expect(largeurBarre(0.5)).toBe(50);
    expect(largeurBarre(2)).toBe(100);
  });

  it("explique le tir instantané : la balle ne chute pas", () => {
    expect(REGLES_TIR.join(" ")).toContain("la balle ne chute pas");
    expect(REGLES_TIR.join(" ")).toContain("sans dispersion");
    expect(REGLES_TIR.join(" ")).toContain(`gerbe fixe de ${STATS.pompe.plombs} plombs`);
  });

  it("couteau et armes spéciales dérivés des données", () => {
    expect(BONUS_COUTEAU_POURCENT).toBe(30);
    expect(TEXTE_COUTEAU).toContain("30 %");
    expect(TEXTE_COUTEAU).toContain("toujours équipé");
    for (const id of ARMES_SPECIALES) expect(TEXTE_ARMES_SPECIALES).toContain(STATS[id].nom);
    expect(TEXTE_ARMES_SPECIALES).toContain("Elsa");
    expect(TEXTE_ARMES_SPECIALES).toContain("Truck Muche");
  });

  it("l'aide des commandes suit les touches du joueur et la disposition du clavier", () => {
    const cfg = touchesParDefaut();
    const qwerty = commandesLobby(cfg);
    expect(qwerty[0]).toEqual({ touches: "W A S D", libelle: "Se déplacer" });
    const azerty = commandesLobby(cfg, new Map([["KeyW", "z"], ["KeyA", "q"], ["KeyS", "s"], ["KeyD", "d"]]));
    expect(azerty[0].touches).toBe("Z Q S D");
    // touches changées : l'aide les reflète
    const perso = { ...cfg, avant: ["ArrowUp", null], accroupi: ["ControlLeft", null] } as typeof cfg;
    expect(commandesLobby(perso)[0].touches).toBe("↑ A S D");
    expect(commandesLobby(perso).find((c) => c.libelle.startsWith("S'accroupir"))?.touches).toBe("Ctrl gauche");
  });

  it("une action sans touche est dite non assignée, la seconde touche prend le relais", () => {
    const cfg = touchesParDefaut();
    expect(toucheDe({ ...cfg, interagir: [null, null] }, "interagir")).toBe("non assignée");
    expect(toucheDe({ ...cfg, interagir: [null, "KeyG"] }, "interagir")).toBe("G");
  });
});

/** La radio de cette arme est-elle cochée ? (l'ordre des attributs rendus par React ne compte pas) */
const cochee = (html: string, arme: string) => {
  const radio = html.match(new RegExp(`<input[^>]*value="${arme}"[^>]*>`));
  return !!radio && radio[0].includes('checked=""');
};

describe("ChoixEquipement", () => {
  const rendu = (variante: "lobby" | "compact", principale: string, secondaire: string) =>
    renderToStaticMarkup(createElement(ChoixEquipement, {
      principale: principale as never, secondaire: secondaire as never, surChanger: () => {}, variante, idGroupe: "test",
    }));

  it("lobby : deux fieldset, une radio par arme choisissable, une seule cochée par groupe", () => {
    const html = rendu("lobby", "pompe", "revolver");
    expect(html.match(/<fieldset/g)).toHaveLength(2);
    expect(html).toContain("Arme principale");
    expect(html).toContain("Arme secondaire");
    expect(html.match(/type="radio"/g)).toHaveLength(ARMES_PRINCIPALES.length + ARMES_SECONDAIRES.length);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(cochee(html, "pompe")).toBe(true);
    expect(cochee(html, "revolver")).toBe(true);
    expect(cochee(html, "mitraillette")).toBe(false);
    // aucune carte pour les armes d'Elsa
    for (const s of ARMES_SPECIALES) expect(html).not.toContain(`value="${s}"`);
  });

  it("lobby : quatre barres role=img « X sur 10 » par carte, nom et description reliés à la radio", () => {
    const html = rendu("lobby", "mitraillette", "pistolet");
    const nb = ARMES_PRINCIPALES.length + ARMES_SECONDAIRES.length;
    expect(html.match(/role="img"/g)).toHaveLength(nb * 4);
    expect(html.match(/aria-label="(Dégâts|Cadence|Portée|Contrôle) (10|[1-9]) sur 10"/g)).toHaveLength(nb * 4);
    expect(html.match(/aria-labelledby=/g)).toHaveLength(nb);
    expect(html.match(/aria-describedby=/g)).toHaveLength(nb);
    expect(html).not.toContain("Précision");
  });

  it("compact : des boutons aria-pressed, un seul pressé par groupe, 40 px et plus au CSS", () => {
    const html = rendu("compact", "sniper", "mini_uzi");
    expect(html).not.toContain("<fieldset");
    expect(html.match(/role="group"/g)).toHaveLength(2);
    expect(html.match(/<button/g)).toHaveLength(ARMES_PRINCIPALES.length + ARMES_SECONDAIRES.length);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(ARMES_PRINCIPALES.length + ARMES_SECONDAIRES.length - 2);
    expect(html).toContain(">Sniper<");
    expect(html).toContain(">Mini Uzi<");
  });

  it("deux instances à l'écran : noms de groupes radio distincts", () => {
    const a = rendu("lobby", "pompe", "pistolet");
    const b = renderToStaticMarkup(createElement(ChoixEquipement, {
      principale: "pompe", secondaire: "pistolet", surChanger: () => {}, variante: "lobby", idGroupe: "mort",
    }));
    expect(a).toContain('name="test-principale"');
    expect(b).toContain('name="mort-principale"');
  });
});

describe("Arene (lobby)", () => {
  const joueurs: JoueurPublic[] = [{ id: "j1", pseudo: "Ne place", couleur: "#9be9ff", enJeu: true, kills: 2, morts: 1, ping: 20 }];
  const match: InfoMatch = { numero: 3, fin: null, objectif: JEU.objectifKills, phase: "jeu", prochain: null };
  const rendu = (tactile = false) => renderToStaticMarkup(createElement(Arene, {
    etat: "ouvert", monId: "j1", joueurs, match, pseudo: "Ne place", surPseudo: () => {},
    equipement: { principale: "fusil_assaut", secondaire: "revolver" }, surEquipement: () => {},
    touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {},
    surEntrer: () => {}, surFermer: () => {}, erreur: null, tactile,
  }));

  it("choix d'équipement, couteau, Elsa et règles de tir", () => {
    const html = rendu();
    expect(html).toContain("Arme principale");
    expect(html).toContain("Arme secondaire");
    expect(html).toContain("Couteau : toujours équipé");
    expect(html).toContain("offertes par Elsa au Truck Muche");
    expect(html).toContain("Comment ça tire");
    expect(html).toContain("la balle ne chute pas");
    expect(cochee(html, "fusil_assaut")).toBe(true);
    expect(cochee(html, "revolver")).toBe(true);
  });

  it("l'aide des commandes vient des touches (aucune liste « Z Q S D » en dur)", () => {
    const html = rendu();
    expect(html).toContain("<kbd>W A S D</kbd>");
    expect(html).not.toContain("Z Q S D");
    expect(html).toContain("glissade");
    expect(html).toContain("Entrer dans l&#x27;arène");
  });

  it("écran tactile : pas de bouton d'entrée", () => {
    const html = rendu(true);
    expect(html).not.toContain("Entrer dans l&#x27;arène");
    expect(html).toContain("clavier et à la souris");
  });

  it("les spectateurs n'empêchent pas d'entrer ; 16 agents EN JEU, si (régression : 16 connectés bloquaient l'arène)", () => {
    const agent = (i: number, enJeu: boolean): JoueurPublic => ({ id: `a${i}`, pseudo: `Agent${i}`, couleur: "#fff", enJeu, kills: 0, morts: 0, ping: 10 });
    const rendreAvec = (liste: JoueurPublic[]) => renderToStaticMarkup(createElement(Arene, {
      etat: "ouvert", monId: "a0", joueurs: liste, match, pseudo: "Ne place", surPseudo: () => {},
      equipement: { principale: "fusil_assaut", secondaire: "revolver" }, surEquipement: () => {},
      touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {},
      surEntrer: () => {}, surFermer: () => {}, erreur: null, tactile: false,
    }));
    // le bouton d'entrée est le <button> qui porte le texte « Entrer dans l'arène »
    const desactive = (html: string) => {
      const bouton = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((_, i, tous) => html.indexOf(tous[i]) > -1 && html.slice(html.indexOf(tous[i])).match(/^<button[^>]*>[^<]*Entrer dans l&#x27;arène/));
      expect(bouton).toBeDefined();
      return /\bdisabled/.test(bouton!);
    };
    // 40 spectateurs : on peut entrer
    expect(desactive(rendreAvec(Array.from({ length: 40 }, (_, i) => agent(i, false))))).toBe(false);
    // 16 agents en jeu (moi, spectateur, en plus) : arène pleine
    const pleine = Array.from({ length: 17 }, (_, i) => agent(i, i > 0));
    expect(desactive(rendreAvec(pleine))).toBe(true);
    // 15 en jeu : on peut
    expect(desactive(rendreAvec(Array.from({ length: 16 }, (_, i) => agent(i, i > 0))))).toBe(false);
  });

  it("toutes les armes du catalogue ont une description affichable dans le lobby", () => {
    for (const id of ARMES) expect(STATS[id].description.length).toBeGreaterThan(10);
  });
});

describe("choix d'équipement au clavier (écran de mort, entracte)", () => {
  it("arme suivante circulaire dans chaque catégorie ; une arme inconnue repart de la première", () => {
    const g = groupePrincipale();
    const ids = g.armes.map((a) => a.id);
    expect(armeSuivanteDuGroupe(g, ids[0])).toBe(ids[1]);
    expect(armeSuivanteDuGroupe(g, ids[ids.length - 1])).toBe(ids[0]);
    expect(armeSuivanteDuGroupe(g, "inconnue")).toBe(ids[0]);
    const h = groupeSecondaire();
    const sec = h.armes.map((a) => a.id);
    let a = sec[0];
    const vus = new Set<string>();
    for (let i = 0; i < sec.length; i++) { vus.add(a); a = armeSuivanteDuGroupe(h, a); }
    expect(vus.size).toBe(sec.length);
    expect(a).toBe(sec[0]);
  });
  it("aide : les touches réelles du joueur, rien sans touche", () => {
    expect(aideChoixEquipement("1", "2")).toBe("1 : arme principale suivante · 2 : arme secondaire suivante");
    expect(aideChoixEquipement("", "2")).toBe("2 : arme secondaire suivante");
    expect(aideChoixEquipement("", "")).toBe("");
  });
});
