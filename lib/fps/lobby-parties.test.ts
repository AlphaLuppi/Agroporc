import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Arene from "../../app/components/arene/Arene";
import LobbyBR from "../../app/components/arene/LobbyBR";
import LobbyZombies from "../../app/components/arene/LobbyZombies";
import ListeParties from "../../app/components/arene/ListeParties";
import type { Salons } from "../../app/components/arene/contrats";
import {
  PARTIE_HALL, TEXTE_ARENE_PLEINE, TEXTE_BR_LIMITE, TEXTE_BR_PLEIN, TEXTE_LANCER_BOTS, TEXTE_LANCER_LIMITE, TEXTE_PARTIES_LIMITE, compteurMode, compteurParties, creationProposee,
  estEchoMode, libelleCreation, lignesParties, lignesPartiesBR, listesDepuisSalons, partiesVisibles, texteRefus, type PartieListee,
} from "../../app/components/arene/lobby-modele";
import type { EtatPartieBr, EtatPartieZombies, JoueurPublic, ResumePartie } from "./protocole";
import { REGLAGES_HUD_DEFAUT } from "./reglages-hud";
import { touchesParDefaut } from "./touches";

/** Modèle des parties parallèles (lot 5a de `2026-10-29-pause-parties-bots-design.md`) : listes, lignes, compteurs, écho de `mode`, refus, rendu des lobbies. */

const salonsBase = (plus: Partial<Salons> = {}): Salons => ({
  arene: { joueurs: 5, enJeu: 3 }, zombies: { phase: "lobby", joueurs: 2, manche: 0 }, br: { phase: "lobby", joueurs: 4, vivants: 0 }, ...plus,
});
const ar = (id: string, joueurs: number, enJeu: number): ResumePartie => ({ id, mode: "arene", phase: "arene", joueurs, capacite: 16, enJeu });
const z = (id: string, phase: ResumePartie["phase"], joueurs: number, plus: Partial<ResumePartie> = {}): ResumePartie => ({ id, mode: "zombies", phase, joueurs, capacite: 8, manche: 0, ...plus });
const br = (id: string, phase: ResumePartie["phase"], joueurs: number, plus: Partial<ResumePartie> = {}): ResumePartie => ({ id, mode: "br", phase, joueurs, capacite: 50, vivants: 0, ...plus });

describe("listesDepuisSalons", () => {
  it("serveur v11 : les listes telles quelles, parallèle", () => {
    const listes = { arene: [ar("ar1", 5, 3)], zombies: [z("z1", "lobby", 2)], br: [br("br1", "lobby", 4)] };
    const r = listesDepuisSalons(salonsBase({ listes }));
    expect(r.parallele).toBe(true);
    expect(r.listes).toBe(listes);
  });

  it("ancien serveur : une partie par mode (permanentes) et les parties de Battle Royale de `parties`, jamais parallèle", () => {
    const r = listesDepuisSalons(salonsBase({ parties: [{ id: "br1", phase: "lobby", joueurs: 4, vivants: 0, hote: "Lea" }, { id: "br2", phase: "jeu", joueurs: 9, vivants: 5 }] }));
    expect(r.parallele).toBe(false);
    expect(r.listes.arene.map((p) => [p.id, p.joueurs, p.enJeu])).toEqual([["ar1", 5, 3]]);
    expect(r.listes.zombies.map((p) => [p.id, p.phase, p.joueurs])).toEqual([["z1", "lobby", 2]]);
    expect(r.listes.br.map((p) => p.id)).toEqual(["br1", "br2"]);
    expect(listesDepuisSalons(salonsBase()).listes.br.map((p) => p.id)).toEqual(["br1"]);
    expect(listesDepuisSalons(salonsBase({ br: undefined })).listes.br).toEqual([]);
    expect(listesDepuisSalons(null)).toEqual({ listes: { arene: [], zombies: [], br: [] }, parallele: false });
  });
});

describe("compteurs de la carte d'un mode", () => {
  it("plusieurs parties : nombre de parties et de joueurs, pour les trois modes", () => {
    const listes = { arene: [ar("ar1", 4, 0), ar("ar2", 5, 5)], zombies: [z("z1", "lobby", 3), z("z2", "manche", 6, { manche: 7 })], br: [br("br1", "lobby", 1)] };
    const s = salonsBase({ listes });
    expect(compteurMode("arene", s)).toBe("2 parties · 9 joueurs");
    expect(compteurMode("zombies", s)).toBe("2 parties · 9 joueurs");
    // une seule partie dans la liste : le compteur habituel de la permanente
    expect(compteurMode("br", s)).toBe("Lobby · 4/50");
    expect(compteurParties([{ joueurs: 1 }])).toBe("1 partie · 1 joueur");
  });

  it("sans `listes` : comportement d'avant (les champs historiques)", () => {
    expect(compteurMode("arene", salonsBase())).toBe("5 en ligne · 3 en jeu");
    expect(compteurMode("zombies", salonsBase())).toBe("Lobby · 2/8");
  });
});

describe("lignesParties", () => {
  it("zombies : rejoindre un lobby ou une partie en cours (pause en cours de manche), « en pause », partie pleine sans bouton", () => {
    const lignes = lignesParties("zombies", [
      z("z1", "lobby", 2, { hote: "Lea" }),
      z("z2", "manche", 3, { manche: 7, suspendue: true }),
      z("z3", "pause", 8, { manche: 2 }),
      z("z4", "fin", 1),
      z("z5", "lobby", 0),
    ], "z1");
    expect(lignes.map((l) => [l.id, l.titre, l.etat, l.ici, l.action, l.enPause])).toEqual([
      ["z1", "Partie de Lea", "Lobby · 2/8", true, null, false],
      ["z2", "Partie n°2", "En cours : manche 7 · 3/8", false, "rejoindre", true],
      ["z3", "Partie n°3", "Pleine · 8/8", false, null, false],
      ["z4", "Partie n°4", "Bilan", false, "rejoindre", false],
      ["z5", "Partie vide", "Lobby · 0/8", false, "rejoindre", false],
    ]);
    expect(lignes[1].designation).toBe("la partie n°2");
  });

  it("arène : capacité comptée en jeu (le hall plein de spectateurs n'est pas plein), « Arène n »", () => {
    const lignes = lignesParties("arene", [ar("ar1", 30, 2), ar("ar2", 16, 16), ar("ar3", 3, 3)], "ar3");
    expect(lignes.map((l) => [l.id, l.titre, l.etat, l.ici, l.action])).toEqual([
      ["ar1", "Arène 1", "2/16 en jeu · 30 en ligne", false, "rejoindre"],
      ["ar2", "Arène 2", "Pleine · 16/16", false, null],
      ["ar3", "Arène 3", "3/16 en jeu · 3 en ligne", true, null],
    ]);
    expect(lignes[0].designation).toBe("l'arène 1");
    // ma partie pleine : j'y suis, son état dit l'effectif
    expect(lignesParties("arene", [ar("ar2", 16, 16)], "ar2")[0]).toMatchObject({ etat: "16/16 en jeu · 16 en ligne", action: null });
  });

  it("Battle Royale : même résultat qu'avant (`lignesPartiesBR`), regarder une partie en cours", () => {
    const parties: PartieListee[] = [
      { id: "br1", phase: "jeu", joueurs: 30, vivants: 1, hote: "Lea" },
      { id: "br2", phase: "lobby", joueurs: 2, vivants: 0, hote: "Zoé" },
      { id: "br3", phase: "decompte", joueurs: 0, vivants: 0 },
    ];
    expect(lignesParties("br", parties, "br2")).toEqual(lignesPartiesBR(parties, "br2"));
    expect(lignesPartiesBR(parties, "br2").map((l) => [l.etat, l.action])).toEqual([["En cours · 1 survivant", "regarder"], ["Lobby · 2/50", null], ["Départ imminent", "regarder"]]);
    // un résumé de serveur plus ancien (sans mode ni capacité) est accepté
    expect(lignesPartiesBR([{ id: "br1", phase: "lobby", joueurs: 3, vivants: 0 }], null)[0].etat).toBe("Lobby · 3/50");
  });
});

describe("partiesVisibles, creationProposee", () => {
  const e = { connecte: true, tactile: false, nbLignes: 1, enCours: false };
  it("zombies et Battle Royale : la liste ne sert que s'il y a un choix (plusieurs parties, ou la mienne lancée)", () => {
    expect(partiesVisibles("zombies", e)).toBe(false);
    expect(partiesVisibles("zombies", { ...e, nbLignes: 2 })).toBe(true);
    expect(partiesVisibles("br", { ...e, enCours: true })).toBe(true);
    expect(partiesVisibles("zombies", { ...e, nbLignes: 2, tactile: true })).toBe(false);
    expect(partiesVisibles("zombies", { ...e, nbLignes: 2, connecte: false })).toBe(false);
    expect(partiesVisibles("zombies", { ...e, nbLignes: 0, enCours: true })).toBe(false);
    // « Créer ma partie » proposé : la section l'est aussi, même avec une seule partie
    expect(partiesVisibles("zombies", { ...e, creation: true })).toBe(true);
    expect(partiesVisibles("zombies", { ...e, creation: true, tactile: true })).toBe(false);
  });

  it("arène : toujours (« Créer une arène » est le seul moyen d'en ouvrir une de plus)", () => {
    expect(partiesVisibles("arene", e)).toBe(true);
    expect(partiesVisibles("arene", { ...e, tactile: true })).toBe(false);
  });

  it("créer : toujours en arène ; ailleurs pas seul dans un lobby", () => {
    expect(creationProposee("arene", lignesParties("arene", [ar("ar1", 1, 0)], "ar1"))).toBe(true);
    expect(creationProposee("zombies", lignesParties("zombies", [z("z1", "lobby", 1)], "z1"))).toBe(false);
    expect(creationProposee("zombies", lignesParties("zombies", [z("z1", "lobby", 2)], "z1"))).toBe(true);
    expect(creationProposee("zombies", lignesParties("zombies", [z("z1", "manche", 1)], "z1"))).toBe(true);
    expect(creationProposee("br", lignesParties("br", [br("br1", "lobby", 1), br("br2", "lobby", 3)], "br2"))).toBe(true);
    expect(libelleCreation("arene")).toBe("Créer une arène");
    expect(libelleCreation("zombies")).toBe("Créer ma partie");
  });
});

describe("estEchoMode", () => {
  it("mêmes mode et partie : écho ; autre partie : changement", () => {
    expect(estEchoMode({ mode: "zombies", partie: "z1" }, { mode: "zombies", partie: "z1" })).toBe(true);
    expect(estEchoMode({ mode: "zombies", partie: "z1" }, { mode: "zombies", partie: "z2" })).toBe(false);
    expect(estEchoMode({ mode: "br", partie: "br1" }, { mode: "br", partie: "br2" })).toBe(false);
    expect(estEchoMode({ mode: "arene", partie: "ar2" }, { mode: "arene", partie: "ar1" })).toBe(false);
    expect(estEchoMode({ mode: "arene", partie: null }, { mode: "zombies", partie: "z1" })).toBe(false);
  });

  it("arrivée dans le hall : l'écho de ar1 n'est pas un changement, celui de ar2 en est un", () => {
    expect(estEchoMode({ mode: "arene", partie: null }, { mode: "arene", partie: PARTIE_HALL })).toBe(true);
    expect(estEchoMode({ mode: "arene", partie: null }, { mode: "arene", partie: "ar2" })).toBe(false);
  });

  it("ancien serveur (pas de partie dans `mode`) : écho, sauf Battle Royale d'une partie connue", () => {
    expect(estEchoMode({ mode: "zombies", partie: null }, { mode: "zombies" })).toBe(true);
    expect(estEchoMode({ mode: "arene", partie: null }, { mode: "arene" })).toBe(true);
    expect(estEchoMode({ mode: "br", partie: "br2" }, { mode: "br" })).toBe(false);
    expect(estEchoMode({ mode: "br", partie: null }, { mode: "br" })).toBe(true);
  });
});

describe("texteRefus", () => {
  it("limite : texte propre à chaque mode ; le Battle Royale garde le sien", () => {
    expect(texteRefus("mode", "limite", "zombies")).toBe(TEXTE_PARTIES_LIMITE);
    // (2026-10-30) l'arène a son texte : plafond d'arènes ou création trop rapprochée (spec arène-police §7.3)
    expect(texteRefus("mode", "limite", "arene")).toBe("Plus de place pour une arène de plus, ou création trop rapprochée : rejoignez une arène de la liste.");
    expect(texteRefus("mode", "limite", "br")).toBe(TEXTE_BR_LIMITE);
  });

  it("lancer : pas assez de joueurs, quota de bots", () => {
    expect(texteRefus("lancer", "bots", "br")).toBe(TEXTE_LANCER_BOTS);
    expect(texteRefus("lancer", "limite", "br")).toBe(TEXTE_LANCER_LIMITE);
    expect(TEXTE_LANCER_BOTS).not.toBe(TEXTE_LANCER_LIMITE);
  });

  it("refus d'avant inchangés", () => {
    expect(texteRefus("rejoindre", "plein", "arene")).toBe(TEXTE_ARENE_PLEINE);
    expect(texteRefus("mode", "plein", "br")).toBe(TEXTE_BR_PLEIN);
    expect(texteRefus("mode", "plein", "zombies")).toBe("La partie de zombies est pleine.");
    expect(texteRefus("mode", "lobby", "zombies")).toBe("Impossible de changer de mode en pleine partie.");
    expect(texteRefus("monter", "loin")).toBe("Voiture trop loin");
    expect(texteRefus("siege", "plein")).toBe("Place occupée");
    expect(texteRefus("regarder", "lobby")).toContain("plus de partie en cours");
    expect(texteRefus("pause", "limite")).toContain("Pause");
  });
});

const zombiesLobby = (): EtatPartieZombies => ({
  phase: "lobby", manche: 0, capacite: 8, hote: "j1", joueurs: [{ id: "j1", pseudo: "Lea", couleur: "#fff", etat: "attente", admis: false }],
} as unknown as EtatPartieZombies);

describe("rendu des lobbies avec parties parallèles", () => {
  const listeZ: PartieListee[] = [z("z1", "lobby", 2, { hote: "Lea" }), z("z2", "manche", 3, { manche: 7, suspendue: true })];

  it("ListeParties : lignes, boutons nommés, création", () => {
    const html = renderToStaticMarkup(createElement(ListeParties, {
      mode: "zombies", lignes: lignesParties("zombies", listeZ, "z1"), surRejoindre: () => {}, surCreer: () => {}, idTitre: "t",
    }));
    expect(html).toContain(">Parties<");
    expect(html).toContain("Partie de Lea<em> (vous)</em>");
    expect(html).toContain("En cours : manche 7 · 3/8");
    expect(html).toContain(">en pause<");
    expect(html).toMatch(/aria-label="Rejoindre la partie n°2"/);
    expect(html).not.toMatch(/aria-label="Rejoindre la partie de lea"/);
    expect(html).toContain(">Créer ma partie</button>");
    const sans = renderToStaticMarkup(createElement(ListeParties, { mode: "arene", lignes: [], surRejoindre: () => {}, idTitre: "t" }));
    expect(sans).not.toContain("Créer");
  });

  const rendreZ = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(LobbyZombies, {
    etat: "ouvert", monId: "j1", partie: zombiesLobby(), pseudo: "Lea", surPseudo: () => {}, touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {},
    surLancer: () => {}, surFermer: () => {}, erreur: null, tactile: false, ...plus,
  } as never));

  it("LobbyZombies : liste des parties avec « Rejoindre » et « Créer ma partie » dès qu'il y en a plusieurs", () => {
    const html = rendreZ({ parties: listeZ, partieActuelle: "z1", surRejoindrePartie: () => {}, surCreerPartie: () => {} });
    expect(html).toContain(">Parties<");
    expect(html).toContain(">Rejoindre</button>");
    expect(html).toContain(">Créer ma partie</button>");
    // seul dans l'unique partie (au lobby) : ni liste ni bouton ; à plusieurs dans l'unique lobby : « Créer ma partie » permet de s'en séparer
    const soloUnique = rendreZ({ parties: [z("z1", "lobby", 1)], partieActuelle: "z1", surRejoindrePartie: () => {}, surCreerPartie: () => {} });
    expect(soloUnique).not.toContain(">Parties<");
    expect(soloUnique).not.toContain("Créer ma partie");
    const lobbyPartage = rendreZ({ parties: [listeZ[0]], partieActuelle: "z1", surRejoindrePartie: () => {}, surCreerPartie: () => {} });
    expect(lobbyPartage).toContain(">Parties<");
    expect(lobbyPartage).toContain(">Créer ma partie</button>");
    // seul dans mon lobby parmi d'autres parties : la liste, sans « Créer ma partie »
    const seul = rendreZ({ parties: [z("z1", "lobby", 1), listeZ[1]], partieActuelle: "z1", surRejoindrePartie: () => {}, surCreerPartie: () => {} });
    expect(seul).toContain(">Parties<");
    expect(seul).not.toContain("Créer ma partie");
    // ancien serveur : aucune liste
    expect(rendreZ()).not.toContain(">Parties<");
  });

  it("LobbyZombies : pastille « en pause » quand la partie est figée (zpause ou liste)", () => {
    expect(rendreZ({ enPause: true })).toContain(">en pause<");
    expect(rendreZ({ parties: listeZ, partieActuelle: "z2" })).toContain(">en pause<");
    expect(rendreZ()).not.toContain("en pause");
  });

  const joueurs: JoueurPublic[] = [{ id: "j1", pseudo: "Lea", couleur: "#fff", enJeu: false, kills: 0, morts: 0, ping: 0 }];
  const rendreA = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Arene, {
    etat: "ouvert", monId: "j1", joueurs, match: null, pseudo: "Lea", surPseudo: () => {}, equipement: { principale: "mitraillette", secondaire: "pistolet" },
    surEquipement: () => {}, touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {}, surEntrer: () => {}, surFermer: () => {},
    erreur: null, tactile: false, ...plus,
  } as never));

  it("Arène : « Créer une arène » toujours présent sur un serveur à parties parallèles, liste des arènes, pas de liste sur un ancien serveur", () => {
    const parties = [ar("ar1", 3, 0), ar("ar2", 6, 5)];
    const html = rendreA({ parties, partieActuelle: "ar1", surRejoindrePartie: () => {}, surCreerPartie: () => {} });
    expect(html).toContain(">Créer une arène</button>");
    expect(html).toContain("Arène 2");
    expect(html).toMatch(/aria-label="Rejoindre l&#x27;arène 2"/);
    // une seule arène : le bouton de création reste
    expect(rendreA({ parties: [ar("ar1", 3, 0)], partieActuelle: "ar1", surCreerPartie: () => {} })).toContain(">Créer une arène</button>");
    expect(rendreA()).not.toContain(">Parties<");
    expect(rendreA({ tactile: true, parties })).not.toContain(">Parties<");
  });

  it("Arène : hall plein sur un serveur à parties parallèles, « Entrer » reste actif (le serveur déborde par `auto`) ; ancien serveur : bloqué", () => {
    const plein: JoueurPublic[] = Array.from({ length: 16 }, (_, i) => ({ id: `j${i + 2}`, pseudo: `Agent${i}`, couleur: "#fff", enJeu: true, kills: 0, morts: 0, ping: 0 }));
    const entrer = (html: string) => /<button[^>]*class="[^"]*entrer[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
    const parallele = rendreA({ joueurs: [...joueurs, ...plein], parties: [ar("ar1", 17, 16), ar("ar2", 2, 1)], partieActuelle: "ar1" });
    expect(entrer(parallele)).not.toBe("");
    expect(entrer(parallele)).not.toContain("disabled");
    const ancien = rendreA({ joueurs: [...joueurs, ...plein] });
    expect(entrer(ancien)).toContain("disabled");
  });

  it("Arène : arène pleine à l'entrée, « Changer d'arène » vers l'alternative du serveur", () => {
    const html = rendreA({
      parties: [ar("ar1", 20, 16), ar("ar2", 6, 5)], partieActuelle: "ar1", surRejoindrePartie: () => {}, surCreerPartie: () => {},
      erreur: TEXTE_ARENE_PLEINE, alternative: "ar2",
    });
    expect(html).toContain("Changer d&#x27;arène");
    expect(html).toContain("Changer d&#x27;arène : Arène 2");
    expect(rendreA({ erreur: TEXTE_ARENE_PLEINE })).not.toContain("Changer d&#x27;arène");
  });

  const partieBr = (): EtatPartieBr => ({
    phase: "lobby", capacite: 50, minJoueurs: 2, hote: "j1", joueurs: [{ id: "j1", pseudo: "Lea", couleur: "#fff", admis: false, vivant: false, aBord: false, kills: 0, place: null }],
    vivants: 0, total: 1,
  } as unknown as EtatPartieBr);

  it("LobbyBR : plusieurs parties au lobby → liste ET « Créer ma partie » (sauf seul dans mon lobby) ; la mienne lancée → un seul bouton « Créer ma partie »", () => {
    const rendreB = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(LobbyBR, {
      etat: "ouvert", monId: "j1", partie: partieBr(), pseudo: "Lea", surPseudo: () => {}, touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {},
      surLancer: () => {}, surFermer: () => {}, erreur: null, tactile: false, surCreerPartie: () => {}, surRejoindrePartie: () => {}, surRegarder: () => {}, ...plus,
    } as never));
    const deux = [br("br1", "lobby", 3, { hote: "Zoé" }), br("br2", "lobby", 1, { hote: "Lea" })];
    const seulDansMonLobby = rendreB({ parties: deux, partieActuelle: "br2" });
    expect(seulDansMonLobby).toContain(">Parties<");
    expect(seulDansMonLobby).not.toContain("Créer ma partie");
    const dansLobbyDeZoe = rendreB({ parties: deux, partieActuelle: "br1" });
    expect(dansLobbyDeZoe).toContain(">Créer ma partie</button>");
    const enCours = rendreB({ partie: { ...partieBr(), phase: "jeu", joueurs: undefined, vivants: 5, total: 9 }, parties: [br("br1", "jeu", 9, { vivants: 5 })], partieActuelle: "br1" });
    expect(enCours.match(/Créer ma partie/g)?.length).toBe(1);
  });
});
