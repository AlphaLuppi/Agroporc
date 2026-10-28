import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Arene from "../../app/components/arene/Arene";
import LobbyBR from "../../app/components/arene/LobbyBR";
import ChoixEquipement from "../../app/components/arene/ChoixEquipement";
import {
  BONUS_COUTEAU_POURCENT, BONUS_EPEE_POURCENT, CARTES_MAX_DETAILLEES, REGLES_TIR, TEXTE_ARMES_SPECIALES, TEXTE_COUTEAU, commandesLobby, groupePrincipale,
  groupeSecondaire, groupeMelee, choixApresChangement, largeurBarre, noteSur10, toucheDe, armeSuivanteDuGroupe, aideChoixEquipement,
  REGLES_BR, TEXTE_CONFLIT_NOMS, TEXTE_DEPART_ANNULE, TEXTE_NOM_A_CHOISIR, commandesLobbyBR, compteurBR, compteurMode, etiquetteEtatBR, pseudoCompteBr,
  situationLobbyBR,
} from "../../app/components/arene/lobby-modele";
import { STATS } from "./armes";
import { libelleCause } from "../../app/components/arene/armesInfo";
import { ARMES, ARMES_MELEE, ARMES_PRINCIPALES, ARMES_SECONDAIRES, ARMES_SPECIALES, JEU, type EtatPartieBr, type InfoMatch, type JoueurBr, type JoueurPublic } from "./protocole";
import { REGLAGES_HUD_DEFAUT } from "./reglages-hud";
import { touchesParDefaut } from "./touches";

describe("modèle du lobby", () => {
  it("deux groupes : les principales et les secondaires, jamais les armes spéciales", () => {
    expect(groupePrincipale().armes.map((a) => a.id)).toEqual([...ARMES_PRINCIPALES]);
    expect(groupeSecondaire().armes.map((a) => a.id)).toEqual([...ARMES_SECONDAIRES]);
    const toutes = [...groupePrincipale().armes, ...groupeSecondaire().armes].map((a) => a.id as string);
    for (const s of ARMES_SPECIALES) expect(toutes).not.toContain(s);
  });

  it("groupe arme blanche : couteau puis épée, barres propres, jamais compact", () => {
    const g = groupeMelee();
    expect(g.cle).toBe("melee");
    expect(g.titre).toBe("Arme blanche");
    expect(g.armes.map((a) => a.id)).toEqual([...ARMES_MELEE]);
    expect(g.compacte).toBe(false);
    expect(g.barres.map((b) => b.nom)).toEqual(["Dégâts", "Cadence", "Portée", "Course"]);
    const [couteau, epee] = g.armes;
    // l'épée frappe plus fort et plus loin, le couteau frappe plus vite et court plus vite
    expect(epee.barres.degats).toBeGreaterThan(couteau.barres.degats);
    expect(epee.barres.portee).toBeGreaterThan(couteau.barres.portee);
    expect(couteau.barres.cadence).toBeGreaterThan(epee.barres.cadence);
    expect(couteau.barres.controle).toBeGreaterThan(epee.barres.controle);
    for (const a of g.armes) for (const v of Object.values(a.barres)) expect(v).toBeGreaterThan(0);
  });

  it("libellés d'élimination : épée et tigre de zombies", () => {
    expect(libelleCause("epee", "arme", "Lea")).toBe("Épée");
    expect(libelleCause("couteau", "arme", "Lea")).toBe("Couteau");
    expect(libelleCause("epee", "tigre_zombie", "")).toBe("Griffé par un tigre");
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
    expect(TEXTE_COUTEAU).toContain("toujours équipée");
    expect(BONUS_EPEE_POURCENT).toBe(20);
    expect(TEXTE_COUTEAU).toContain("140°");
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
  const rendu = (variante: "lobby" | "compact", principale: string, secondaire: string, melee?: string) =>
    renderToStaticMarkup(createElement(ChoixEquipement, {
      principale: principale as never, secondaire: secondaire as never, melee: melee as never, surChanger: () => {}, variante, idGroupe: "test",
    }));
  const NB_ARMES = ARMES_PRINCIPALES.length + ARMES_SECONDAIRES.length + ARMES_MELEE.length;

  it("lobby : trois fieldset, une radio par arme choisissable, une seule cochée par groupe", () => {
    const html = rendu("lobby", "pompe", "revolver");
    expect(html.match(/<fieldset/g)).toHaveLength(3);
    expect(html).toContain("Arme principale");
    expect(html).toContain("Arme secondaire");
    expect(html).toContain("Arme blanche");
    expect(html.match(/type="radio"/g)).toHaveLength(NB_ARMES);
    expect(html.match(/checked=""/g)).toHaveLength(3);
    expect(cochee(html, "pompe")).toBe(true);
    // arme blanche absente = couteau
    expect(cochee(html, "couteau")).toBe(true);
    expect(cochee(html, "epee")).toBe(false);
    expect(cochee(html, "revolver")).toBe(true);
    expect(cochee(html, "mitraillette")).toBe(false);
    // aucune carte pour les armes d'Elsa
    for (const s of ARMES_SPECIALES) expect(html).not.toContain(`value="${s}"`);
  });

  it("lobby : quatre barres role=img « X sur 10 » par carte, nom et description reliés à la radio", () => {
    const html = rendu("lobby", "mitraillette", "pistolet");
    const nb = NB_ARMES;
    expect(html.match(/role="img"/g)).toHaveLength(nb * 4);
    expect(html.match(/aria-label="(Dégâts|Cadence|Portée|Contrôle|Course) (10|[1-9]) sur 10"/g)).toHaveLength(nb * 4);
    expect(html.match(/aria-labelledby=/g)).toHaveLength(nb);
    expect(html.match(/aria-describedby=/g)).toHaveLength(nb);
    expect(html).not.toContain("Précision");
  });

  it("compact : des boutons aria-pressed, un seul pressé par groupe, 40 px et plus au CSS", () => {
    const html = rendu("compact", "sniper", "mini_uzi");
    expect(html).not.toContain("<fieldset");
    expect(html.match(/role="group"/g)).toHaveLength(3);
    expect(html.match(/<button/g)).toHaveLength(NB_ARMES);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(NB_ARMES - 3);
    expect(html).toContain(">Sniper<");
    expect(html).toContain(">Mini Uzi<");
  });

  it("lobby : l'épée choisie est cochée, les barres de l'arme blanche ont « Course » au lieu de « Contrôle »", () => {
    const html = rendu("lobby", "pompe", "revolver", "epee");
    expect(cochee(html, "epee")).toBe(true);
    expect(cochee(html, "couteau")).toBe(false);
    expect(html.match(/aria-label="Course (10|[1-9]) sur 10"/g)).toHaveLength(ARMES_MELEE.length);
    expect(html).toContain(">Épée<");
    expect(html).toContain(">Couteau<");
  });

  it("changer un groupe garde les deux autres (principale, secondaire, arme blanche)", () => {
    const eq = { principale: "pompe", secondaire: "revolver", melee: "epee" } as const;
    expect(choixApresChangement(eq, "principale", "sniper")).toEqual(["sniper", "revolver", "epee"]);
    expect(choixApresChangement(eq, "secondaire", "mini_uzi")).toEqual(["pompe", "mini_uzi", "epee"]);
    expect(choixApresChangement(eq, "melee", "couteau")).toEqual(["pompe", "revolver", "couteau"]);
    // arme blanche absente = couteau, toujours transmise explicitement
    expect(choixApresChangement({ principale: "pompe", secondaire: "revolver" }, "principale", "sniper")).toEqual(["sniper", "revolver", "couteau"]);
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
    expect(html).toContain("Arme blanche : toujours équipée");
    expect(html).toContain("Épée : course 20 %");
    expect(html).toContain("jusqu&#x27;à 3 joueurs");
    expect(html).toContain("<legend>Arme blanche</legend>");
    expect(cochee(html, "couteau")).toBe(true);
    expect(cochee(html, "epee")).toBe(false);
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


// ---------- Battle Royale (v8) : lobby ----------

const joueurBr = (id: string, pseudo: string, plus: Partial<JoueurBr> = {}): JoueurBr => ({
  id, pseudo, couleur: "#aabbcc", admis: false, vivant: false, aBord: false, kills: 0, place: null, ...plus,
});
const partieBr = (plus: Partial<EtatPartieBr> = {}): EtatPartieBr => ({
  phase: "lobby", hote: "j1", capacite: 50, minJoueurs: 2, debutT: 0, finT: 0, avion: null, zone: null, vivants: 0, total: 0,
  joueurs: [joueurBr("j1", "Lea"), joueurBr("j2", "Marc")], ...plus,
});
const zoneBr = (palier: number) => ({
  palier, nbPaliers: 6, phase: "attente" as const, t0: 0, t1: 60_000, t2: 90_000, c0: [0, 0] as [number, number], r0: 250, c1: [10, 10] as [number, number], r1: 150, degats: 2,
});

describe("lobby du Battle Royale : compteurs de la carte de mode", () => {
  it("tiret sans `br`, lobby, salle pleine, bilan, partie en cours avec les vivants", () => {
    const base = { arene: { joueurs: 1, enJeu: 0 }, zombies: { phase: "lobby" as const, joueurs: 0, manche: 0 } };
    expect(compteurMode("br", null)).toBe("—");
    expect(compteurMode("br", base)).toBe("—");
    expect(compteurBR(undefined)).toBe("—");
    expect(compteurMode("br", { ...base, br: { phase: "lobby", joueurs: 7, vivants: 0 } })).toBe("Lobby · 7/50");
    expect(compteurMode("br", { ...base, br: { phase: "lobby", joueurs: 50, vivants: 0 } })).toBe("Salle pleine · 50/50");
    expect(compteurMode("br", { ...base, br: { phase: "fin", joueurs: 9, vivants: 1 } })).toBe("Bilan · 9/50");
    expect(compteurMode("br", { ...base, br: { phase: "jeu", joueurs: 30, vivants: 12, palier: 3 } })).toBe("Partie en cours · 12 en vie");
    expect(compteurMode("br", { ...base, br: { phase: "vol", joueurs: 30, vivants: 30 } })).toBe("Partie en cours · 30 en vie");
    // les modes existants ne changent pas
    expect(compteurMode("arene", base)).toBe("1 en ligne · 0 en jeu");
    expect(compteurMode("zombies", base)).toBe("Lobby · 0/8");
  });
});

describe("situationLobbyBR", () => {
  it("avant le premier état ou hors ligne : connexion, rien à lancer", () => {
    expect(situationLobbyBR(null, null, true)).toMatchObject({ message: "Connexion à la salle…", peutLancer: false, hote: false, joueurs: 0, capacite: 50 });
    expect(situationLobbyBR(partieBr(), "j1", false)).toMatchObject({ peutLancer: false, message: "Connexion à la salle…" });
  });

  it("hôte avec assez de joueurs : peut lancer ; sinon en attendant l'hôte", () => {
    expect(situationLobbyBR(partieBr(), "j1", true)).toMatchObject({ hote: true, peutLancer: true, enCours: false, joueurs: 2, message: "Vous êtes l'hôte : lancez la partie quand tout le monde est là." });
    const autre = situationLobbyBR(partieBr(), "j2", true);
    expect(autre).toMatchObject({ hote: false, peutLancer: false, message: "En attendant l'hôte…" });
  });

  it("minimum de joueurs : l'hôte seul ne peut pas lancer et le message le dit", () => {
    const seul = partieBr({ joueurs: [joueurBr("j1", "Lea")] });
    expect(situationLobbyBR(seul, "j1", true)).toMatchObject({ peutLancer: false, message: "Il faut au moins 2 joueurs." });
  });

  it("conflit de noms : lancement bloqué, tout le monde est prévenu", () => {
    const conflit = partieBr({ conflitNoms: true });
    expect(situationLobbyBR(conflit, "j1", true)).toMatchObject({ peutLancer: false, message: TEXTE_CONFLIT_NOMS });
    expect(situationLobbyBR(conflit, "j2", true).message).toBe(TEXTE_CONFLIT_NOMS);
    expect(TEXTE_CONFLIT_NOMS).toBe("Deux joueurs portent le même nom : renommez-vous.");
  });

  it("nom à choisir pour compter les TOP 1 (« Agent » et ses doublons), départ annulé", () => {
    const agent = partieBr({ joueurs: [joueurBr("j1", "Lea"), joueurBr("j2", "Agent2")], annule: true });
    const sit = situationLobbyBR(agent, "j2", true);
    expect(sit.avis).toEqual([TEXTE_DEPART_ANNULE, TEXTE_NOM_A_CHOISIR]);
    expect(TEXTE_NOM_A_CHOISIR).toBe("Choisissez un nom pour compter vos TOP 1.");
    expect(TEXTE_DEPART_ANNULE).toBe("Départ annulé : pas assez de joueurs.");
    // un autre joueur ne reçoit pas l'avis sur MON nom
    expect(situationLobbyBR(agent, "j1", true).avis).toEqual([TEXTE_DEPART_ANNULE]);
    expect(pseudoCompteBr("Agent")).toBe(false);
    expect(pseudoCompteBr("agent12")).toBe(false);
    expect(pseudoCompteBr("Agentix")).toBe(true);
    expect(pseudoCompteBr("Lea")).toBe(true);
  });

  it("arrivant en cours de partie : N en vie, zone palier k/6, rejoignez à la suivante", () => {
    const enCours = partieBr({ phase: "jeu", joueurs: undefined, vivants: 12, total: 30, zone: zoneBr(3) });
    const sit = situationLobbyBR(enCours, "j9", true);
    expect(sit).toMatchObject({ enCours: true, peutLancer: false, hote: false });
    expect(sit.message).toBe("Partie en cours : 12 en vie · zone palier 3/6 — rejoignez à la suivante.");
    // avant que la zone existe : seulement les vivants ; repli sur salons.br pour le palier
    expect(situationLobbyBR(partieBr({ phase: "vol", joueurs: undefined, vivants: 30, total: 30 }), "j9", true).message).toBe("Partie en cours : 30 en vie — rejoignez à la suivante.");
    expect(situationLobbyBR(partieBr({ phase: "jeu", joueurs: undefined, vivants: 0 }), "j9", true, { phase: "jeu", joueurs: 20, vivants: 8, palier: 2 }).message)
      .toBe("Partie en cours : 8 en vie · zone palier 2/6 — rejoignez à la suivante.");
    expect(situationLobbyBR(partieBr({ phase: "decompte" }), "j9", true).enCours).toBe(true);
    expect(situationLobbyBR(partieBr({ phase: "fin" }), "j9", true).message).toContain("retour au lobby");
  });

  it("étiquettes d'état de la liste : vide au lobby, à bord au décompte, place à la fin", () => {
    expect(etiquetteEtatBR({ admis: false, aBord: false, place: null }, "lobby")).toBe("");
    expect(etiquetteEtatBR({ admis: true, aBord: true, place: null }, "decompte")).toBe("à bord");
    expect(etiquetteEtatBR({ admis: true, aBord: false, place: null }, "decompte")).toBe("admis");
    expect(etiquetteEtatBR({ admis: false, aBord: false, place: null }, "decompte")).toBe("attente");
    expect(etiquetteEtatBR({ admis: true, aBord: false, place: 1 }, "fin")).toBe("TOP 1");
    expect(etiquetteEtatBR({ admis: true, aBord: false, place: 4 }, "fin")).toBe("#4");
  });

  it("règles et commandes : chiffres tirés des constantes, touches réelles, pas de chat vocal", () => {
    const regles = REGLES_BR.join(" ");
    expect(regles).toContain("90 m");
    expect(regles).toContain("34 dégâts (3 coups)");
    expect(regles).toContain("+20 PV");
    expect(regles).toContain("vous rend 50 PV");
    expect(regles).toContain("6 paliers");
    const c = commandesLobbyBR(touchesParDefaut());
    expect(c.find((x) => x.libelle === "Ramasser un objet au sol")?.touches).toBe("E");
    expect(c.find((x) => x.libelle === "Bandage")?.touches).toBe("H");
    expect(c.find((x) => x.libelle === "Potion de bouclier")?.touches).toBe("J");
    expect(c.find((x) => x.libelle === "Lâcher l'arme en main")?.touches).toBe("U");
    expect(c.some((x) => /voiture/i.test(x.libelle))).toBe(false);
    expect(c.some((x) => /vocal|parler/i.test(x.libelle))).toBe(false);
  });
});

describe("LobbyBR", () => {
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(LobbyBR, {
    etat: "ouvert", monId: "j1", partie: partieBr(), pseudo: "Lea", surPseudo: () => {}, touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {},
    surLancer: () => {}, surFermer: () => {}, erreur: null, tactile: false, ...plus,
  } as never));
  const boutonLancer = (html: string) => /<button[^>]*>Lancer la partie<\/button>/.exec(html)?.[0] ?? "";

  it("aside Battle Royale : titre, effectif X/50, liste des joueurs avec hôte et « vous »", () => {
    const html = rendre();
    expect(html).toContain('aria-label="Battle Royale"');
    expect(html).toContain("<h2");
    expect(html).toContain("Chacun pour soi");
    expect(html).toMatch(/<b>2<\/b>\/50 joueurs/);
    expect(html).toContain("Lea<em> (vous)</em>");
    expect(html).toContain("Marc");
    expect(html).toContain(">hôte<");
  });

  it("hôte : bouton « Lancer la partie » actif ; autre joueur ou conflit de noms : désactivé", () => {
    expect(boutonLancer(rendre())).not.toContain("disabled");
    expect(boutonLancer(rendre({ monId: "j2" }))).toContain("disabled");
    expect(boutonLancer(rendre({ partie: partieBr({ conflitNoms: true }) }))).toContain("disabled");
    expect(rendre({ partie: partieBr({ conflitNoms: true }) })).toContain("renommez-vous");
    expect(boutonLancer(rendre({ partie: partieBr({ joueurs: [joueurBr("j1", "Lea")] }) }))).toContain("disabled");
    expect(boutonLancer(rendre({ pseudo: "L" }))).toContain("disabled");
  });

  it("palmarès TOP 1 repliable : chargement, puis lignes avec la mienne marquée", () => {
    const sans = rendre();
    expect(sans).toContain("<details");
    expect(sans).toContain("Palmarès");
    expect(sans).toContain("en cours de chargement");
    const moi = { cle: "lea", pseudo: "Lea", top1: 3, parties: 8, kills: 21, meilleurePlace: 1, derniereT: 1 };
    const html = rendre({ statsBr: { lignes: [{ cle: "zoe", pseudo: "Zoé", top1: 5, parties: 9, kills: 30, meilleurePlace: 1, derniereT: 1 }, moi], moi } });
    expect(html).toContain("Zoé");
    expect(html).toMatch(/<tr data-moi="oui">/);
    expect(html).toContain("#1");
  });

  it("partie en cours : message d'attente, pas de lancement ; avis du nom à choisir", () => {
    const html = rendre({ monId: "j9", partie: partieBr({ phase: "jeu", joueurs: undefined, vivants: 12, total: 30, zone: zoneBr(3) }) });
    expect(html).toContain("Partie en cours : 12 en vie · zone palier 3/6 — rejoignez à la suivante.");
    expect(boutonLancer(html)).toContain("disabled");
    const agent = rendre({ monId: "j2", partie: partieBr({ joueurs: [joueurBr("j1", "Lea"), joueurBr("j2", "Agent")] }), pseudo: "Agent" });
    expect(agent).toContain(TEXTE_NOM_A_CHOISIR);
  });

  it("jamais de chat vocal ni de choix d'équipement ; commandes avec les touches réelles", () => {
    const html = rendre();
    expect(html).not.toMatch(/vocal de proximité/i);
    expect(html).not.toContain("Équipement");
    expect(html).toContain("<kbd>H</kbd>");
    expect(html).toContain("Le chat vocal est désactivé dans ce mode.");
  });

  it("tactile : clavier et souris requis, aucun bouton de lancement ; connexion perdue : écrite", () => {
    const t = rendre({ tactile: true });
    expect(t).toContain("clavier et à la souris");
    expect(t).not.toContain("Lancer la partie");
    expect(rendre({ etat: "ferme", monId: null })).toContain("Serveur injoignable");
    expect(rendre({ erreur: "La salle Battle Royale est pleine" })).toContain('role="alert"');
  });
});
