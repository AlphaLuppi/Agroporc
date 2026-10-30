import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LobbyBR from "../../app/components/arene/LobbyBR";
import FinDePartieBR, { TableauPartieBr } from "../../app/components/arene/hud/FinDePartieBR";
import EcranSpectateur from "../../app/components/arene/hud/EcranSpectateur";
import {
  SUFFIXE_BOT, TEXTE_AJOUTER_BOTS, TEXTE_ENTRAINEMENT, TEXTE_LANCER_BOTS, TEXTE_NON_COMPTEE_BOTS, TEXTE_NON_COMPTEE_COURTE, TEXTE_QUOTA_EPUISE, aideBots, botsParDefaut, estBot,
  lignesParties, messageJoueursManquants, nomAffiche, plafondBots, reglageBots, situationLobbyBR, texteNombreBots, texteNonComptee, type PartieListee,
} from "../../app/components/arene/lobby-modele";
import { BR } from "./br-regles";
import { lignesBilanBR, resumeFinBr } from "./classement";
import type { BilanBr, EtatPartieBr, JoueurBr, ResumePartie } from "./protocole";
import { REGLAGES_HUD_DEFAUT } from "./reglages-hud";
import { touchesParDefaut } from "./touches";

/** UI des bots du Battle Royale (lot 5b de `2026-10-29-pause-parties-bots-design.md`) : réglage de l'hôte, étiquette [BOT], bilan, partie non comptée. */

const joueurBr = (id: string, pseudo: string): JoueurBr => ({ id, pseudo, couleur: "#aabbcc", admis: false, vivant: false, aBord: false, kills: 0, place: null });
const lobby = (joueurs: JoueurBr[], plus: Partial<EtatPartieBr> = {}): EtatPartieBr => ({
  phase: "lobby", hote: joueurs[0]?.id ?? "", capacite: 50, minJoueurs: 2, debutT: 0, finT: 0, avion: null, zone: null, vivants: 0, total: 0, joueurs, ...plus,
});
const br = (id: string, phase: ResumePartie["phase"], joueurs: number, plus: Partial<ResumePartie> = {}): ResumePartie => ({ id, mode: "br", phase, joueurs, capacite: 50, vivants: 0, ...plus });

describe("étiquette BOT", () => {
  it("un bot se reconnaît à son drapeau ou à son id décimal b<n>, jamais à « br1 » ; le suffixe n'est ajouté qu'une fois", () => {
    expect(estBot({ id: "b12" })).toBe(true);
    expect(estBot({ id: "j3", bot: true })).toBe(true);
    expect(estBot({ id: "br1" })).toBe(false);
    expect(estBot({ id: "j3" })).toBe(false);
    expect(nomAffiche({ id: "b1", pseudo: "Tigrou" })).toBe(`Tigrou${SUFFIXE_BOT}`);
    expect(nomAffiche({ id: "b1", pseudo: `Tigrou${SUFFIXE_BOT}` })).toBe(`Tigrou${SUFFIXE_BOT}`);
    expect(nomAffiche({ id: "j1", pseudo: "Lea" })).toBe("Lea");
  });
});

describe("réglage des bots du lobby", () => {
  it("plafond : plafond de la partie, place libre (une place gardée à un arrivant), quota global ; bots coupés ou inconnus = 0", () => {
    expect(plafondBots({ botsMax: 20, humains: 1, capacite: 50 })).toBe(20);
    expect(plafondBots({ botsMax: 20, humains: 40, capacite: 50 })).toBe(9);
    expect(plafondBots({ botsMax: 20, humains: 50, capacite: 50 })).toBe(0);
    expect(plafondBots({ botsMax: 20, botsRestants: 7, humains: 1, capacite: 50 })).toBe(7);
    expect(plafondBots({ botsMax: 20, botsRestants: 0, humains: 1, capacite: 50 })).toBe(0);
    expect(plafondBots({ botsMax: 0, humains: 1, capacite: 50 })).toBe(0);
    expect(plafondBots({ humains: 1, capacite: 50 })).toBe(0);
  });

  it("défaut : BR.botsSolo seul dans le lobby (borné au plafond), aucun bot dès qu'un autre joueur est là", () => {
    expect(botsParDefaut(1, 20)).toBe(BR.botsSolo);
    expect(botsParDefaut(1, 5)).toBe(5);
    expect(botsParDefaut(2, 20)).toBe(0);
  });

  it("valeur : choix de l'hôte borné [0, plafond], entier ; null = défaut ; quota épuisé détecté", () => {
    const base = { botsMax: 20, humains: 1, capacite: 50 };
    expect(reglageBots({ ...base, choisi: null })).toMatchObject({ disponible: true, plafond: 20, valeur: BR.botsSolo, entrainement: true, quotaEpuise: false });
    expect(reglageBots({ ...base, choisi: 0 })).toMatchObject({ valeur: 0, entrainement: false });
    expect(reglageBots({ ...base, choisi: 99 }).valeur).toBe(20);
    expect(reglageBots({ ...base, choisi: -3 }).valeur).toBe(0);
    expect(reglageBots({ ...base, choisi: 2.7 }).valeur).toBe(2);
    expect(reglageBots({ ...base, choisi: Number.NaN }).valeur).toBe(0);
    expect(reglageBots({ ...base, botsRestants: 0, choisi: null })).toMatchObject({ disponible: true, plafond: 0, valeur: 0, quotaEpuise: true });
    expect(reglageBots({ botsMax: 0, humains: 1, capacite: 50, choisi: null })).toMatchObject({ disponible: false, quotaEpuise: false, valeur: 0 });
    expect(reglageBots({ humains: 1, capacite: 50, choisi: null }).disponible).toBe(false);
  });

  it("textes : nombre pour les lecteurs d'écran, entraînement et quota restant", () => {
    expect(texteNombreBots(0)).toBe("aucun bot");
    expect(texteNombreBots(1)).toBe("1 bot");
    expect(texteNombreBots(11)).toBe("11 bots");
    const r = reglageBots({ botsMax: 20, humains: 1, capacite: 50, choisi: null });
    expect(aideBots(r, 13)).toEqual([TEXTE_ENTRAINEMENT, "Bots libres sur le serveur : 13."]);
    expect(aideBots(reglageBots({ botsMax: 20, humains: 2, capacite: 50, choisi: null }))).toEqual([]);
  });
});

describe("situationLobbyBR avec des bots", () => {
  const seul = lobby([joueurBr("j1", "Lea")]);

  it("sans réglage (serveur d'avant les bots) : inchangé, il faut un autre joueur", () => {
    expect(situationLobbyBR(seul, "j1", true)).toMatchObject({ peutLancer: false, message: "Il faut au moins 2 joueurs." });
  });

  it("seul avec des bots : peut lancer ; seul sans bot : grisé, avec la raison ; quota épuisé : message du quota ; bots coupés : le minimum de joueurs", () => {
    const avec = reglageBots({ botsMax: 20, humains: 1, capacite: 50, choisi: null });
    expect(situationLobbyBR(seul, "j1", true, null, avec)).toMatchObject({ hote: true, peutLancer: true });
    const sans = reglageBots({ botsMax: 20, humains: 1, capacite: 50, choisi: 0 });
    expect(situationLobbyBR(seul, "j1", true, null, sans)).toMatchObject({ peutLancer: false, message: TEXTE_AJOUTER_BOTS });
    const epuise = reglageBots({ botsMax: 20, botsRestants: 0, humains: 1, capacite: 50, choisi: null });
    expect(situationLobbyBR(seul, "j1", true, null, epuise)).toMatchObject({ peutLancer: false, message: TEXTE_QUOTA_EPUISE });
    const coupes = reglageBots({ botsMax: 0, humains: 1, capacite: 50, choisi: null });
    expect(situationLobbyBR(seul, "j1", true, null, coupes)).toMatchObject({ peutLancer: false, message: "Il faut au moins 2 joueurs." });
    expect(messageJoueursManquants(2, sans)).toBe(TEXTE_AJOUTER_BOTS);
    expect(messageJoueursManquants(2, null)).toBe("Il faut au moins 2 joueurs.");
  });

  it("à plusieurs, les bots sont facultatifs : le réglage ne bloque pas le lancement", () => {
    const deux = lobby([joueurBr("j1", "Lea"), joueurBr("j2", "Marc")]);
    const aucun = reglageBots({ botsMax: 20, humains: 2, capacite: 50, choisi: null });
    expect(situationLobbyBR(deux, "j1", true, null, aucun).peutLancer).toBe(true);
  });

  it("le texte du refus serveur « bots » (message déjà affiché au lobby) reste celui du lot 5a", () => {
    expect(TEXTE_LANCER_BOTS).toContain("bots");
  });
});

describe("liste des parties : bots", () => {
  it("une partie en cours avec des bots le dit ; au lobby ou sans bot, rien de plus", () => {
    const l = (p: PartieListee) => lignesParties("br", [p], null)[0].etat;
    expect(l(br("br1", "jeu", 1, { vivants: 9, bots: 11 }))).toBe("En cours · 9 survivants · 11 bots");
    expect(l(br("br1", "jeu", 1, { vivants: 9 }))).toBe("En cours · 9 survivants");
    expect(l(br("br1", "lobby", 1, { bots: 4 }))).toBe("Lobby · 1/50");
  });
});

describe("bilan : lignes de bots et partie non comptée", () => {
  const bilan = (): BilanBr => ({
    vainqueurs: ["b2"], dureeMs: 300_000,
    lignes: [
      { id: "j1", pseudo: "Lea", couleur: "#aabbcc", place: 2, kills: 1, degats: 120, survieS: 200 },
      { id: "b2", pseudo: "Tigrou", couleur: "#112233", place: 1, kills: 3, degats: 400, survieS: 300, bot: true },
      { id: "b3", pseudo: "Moustache", couleur: "#445566", place: 3, kills: 0, degats: 10, survieS: 100 },
    ],
  });
  const fin = (plus: Partial<EtatPartieBr> = {}): EtatPartieBr => ({
    phase: "fin", hote: "j1", capacite: 50, minJoueurs: 2, debutT: 0, finT: 130_000, avion: null, zone: null, vivants: 1, total: 3, bilan: bilan(), nonComptee: true, ...plus,
  });

  it("lignesBilanBR porte le drapeau (ou l'id b<n> d'un serveur qui ne l'aurait pas posé) ; le vainqueur-bot est nommé avec l'étiquette", () => {
    expect(lignesBilanBR(bilan(), "j1").map((l) => l.bot)).toEqual([true, false, true]);
    expect(resumeFinBr(bilan(), "j1").sousTitre).toBe(`Tigrou${SUFFIXE_BOT} remporte la partie`);
  });

  it("texteNonComptee : entraînement avec des bots, sinon partie trop courte", () => {
    expect(texteNonComptee(true)).toBe(TEXTE_NON_COMPTEE_BOTS);
    expect(texteNonComptee(false)).toBe(TEXTE_NON_COMPTEE_COURTE);
  });

  it("FinDePartieBR : [BOT] dans le classement et « Entraînement : partie non comptée » ; sans bot, « Partie trop courte »", () => {
    const rendre = (partie: EtatPartieBr) => renderToStaticMarkup(createElement(FinDePartieBR, {
      partie, monId: "j1", statsBr: null, maintenantServeur: () => 100_000, surRejouer: () => {}, surQuitter: () => {},
    } as never));
    const html = rendre(fin());
    expect(html).toContain(`Tigrou${SUFFIXE_BOT}`);
    expect(html).toContain(`Moustache${SUFFIXE_BOT}`);
    expect(html).toContain(`Tigrou${SUFFIXE_BOT} remporte la partie`);
    expect(html).toContain(TEXTE_NON_COMPTEE_BOTS);
    expect(html).not.toContain(TEXTE_NON_COMPTEE_COURTE);
    expect(html).not.toContain(`Lea${SUFFIXE_BOT}`);
    const humains: BilanBr = { vainqueurs: ["j1"], dureeMs: 20_000, lignes: [{ id: "j1", pseudo: "Lea", couleur: "#aabbcc", place: 1, kills: 0, degats: 0, survieS: 20 }] };
    const court = rendre(fin({ bilan: humains }));
    expect(court).toContain(TEXTE_NON_COMPTEE_COURTE);
    expect(court).not.toContain(TEXTE_NON_COMPTEE_BOTS);
  });

  it("tableau des scores (Tab) : le bot en jeu porte l'étiquette", () => {
    const joueurs = [
      { id: "j1", pseudo: "Lea", couleur: "#aabbcc", enJeu: true, kills: 1, morts: 0, ping: 10 },
      { id: "b1", pseudo: "Tigrou", couleur: "#112233", enJeu: true, kills: 4, morts: 0, ping: 0, bot: true as const },
    ];
    const html = renderToStaticMarkup(createElement(TableauPartieBr, { joueurs, monId: "j1", vivants: 2, total: 2 }));
    expect(html).toContain(`Tigrou${SUFFIXE_BOT}`);
    expect(html).toContain("Lea</span><em> (vous)</em>");
  });

  it("spectateur : le joueur suivi, s'il est un bot, porte l'étiquette", () => {
    const html = renderToStaticMarkup(createElement(EcranSpectateur, {
      derniereMort: null, place: 3, total: 12, suiviId: "b4", joueurs: [{ id: "b4", pseudo: "Tigrou", couleur: "#112233", bot: true }],
      toucheSuivant: "D", touchePrecedent: "Q",
    } as never));
    expect(html).toContain(`Tigrou${SUFFIXE_BOT}`);
  });
});

describe("LobbyBR : réglage des bots", () => {
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(LobbyBR, {
    etat: "ouvert", monId: "j1", partie: lobby([joueurBr("j1", "Lea")]), pseudo: "Lea", surPseudo: () => {}, touches: touchesParDefaut(),
    reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {}, surLancer: () => {}, surFermer: () => {}, erreur: null, tactile: false,
    surCreerPartie: () => {}, surRejoindrePartie: () => {}, surRegarder: () => {},
    parties: [br("br1", "lobby", 1, { hote: "Lea", botsMax: 20, botsRestants: 24 })], partieActuelle: "br1", ...plus,
  } as never));
  const lancer = (html: string) => /<button[^>]*class="[^"]*entrer[^"]*"[^>]*>/.exec(html)?.[0] ?? "";

  it("hôte seul : curseur de 0 au plafond, 11 bots par défaut, niveau, entraînement, quota ; « Lancer » actif", () => {
    const html = rendre();
    expect(html).toContain("Nombre de bots");
    expect(html).toMatch(/<input[^>]*type="range"[^>]*max="20"[^>]*value="11"/);
    expect(html).toContain('aria-valuetext="11 bots"');
    expect(html).toContain("Niveau des bots");
    expect(html).toContain("Plat du jour");
    expect(html).toContain(TEXTE_ENTRAINEMENT);
    expect(html).toContain("Bots libres sur le serveur : 24.");
    expect(lancer(html)).not.toContain("disabled");
  });

  it("le plafond suit le quota du serveur ; épuisé : curseur grisé, « Lancer » grisé avec la raison", () => {
    expect(rendre({ parties: [br("br1", "lobby", 1, { hote: "Lea", botsMax: 20, botsRestants: 6 })] })).toMatch(/<input[^>]*type="range"[^>]*max="6"[^>]*value="6"/);
    const epuise = rendre({ parties: [br("br1", "lobby", 1, { hote: "Lea", botsMax: 20, botsRestants: 0 })] });
    expect(lancer(epuise)).toContain("disabled");
    expect(epuise.replaceAll("&#x27;", "'")).toContain(TEXTE_QUOTA_EPUISE);
    expect(epuise).toMatch(/<input[^>]*type="range"[^>]*disabled/);
  });

  it("bots coupés (botsMax 0) ou serveur d'avant les bots : aucun réglage, comportement d'avant (il faut un autre joueur)", () => {
    for (const parties of [[br("br1", "lobby", 1, { hote: "Lea", botsMax: 0 })], [br("br1", "lobby", 1, { hote: "Lea" })], null]) {
      const html = rendre({ parties });
      expect(html).not.toContain("Nombre de bots");
      expect(html).toContain("Il faut au moins 2 joueurs.");
      expect(lancer(html)).toContain("disabled");
    }
  });

  it("à plusieurs : le réglage est proposé à l'hôte avec 0 bot, « Lancer » actif ; un autre joueur que l'hôte ne le voit pas", () => {
    const deux = lobby([joueurBr("j1", "Lea"), joueurBr("j2", "Marc")]);
    const hote = rendre({ partie: deux });
    expect(hote).toMatch(/<input[^>]*type="range"[^>]*value="0"/);
    expect(hote).not.toContain(TEXTE_ENTRAINEMENT);
    expect(hote).not.toContain("Niveau des bots");
    expect(lancer(hote)).not.toContain("disabled");
    const invite = rendre({ partie: deux, monId: "j2" });
    expect(invite).not.toContain("Nombre de bots");
  });

  it("les bots présents dans la liste de joueurs portent l'étiquette", () => {
    const html = rendre({ partie: lobby([joueurBr("j1", "Lea"), joueurBr("b1", "Tigrou")]) });
    expect(html).toContain(`Tigrou${SUFFIXE_BOT}`);
  });
});
