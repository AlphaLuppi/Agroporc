import { describe, expect, it } from "vitest";
import { BR } from "./br-regles";
import { JEU, MODES_SALLE, PARTIE_AUTO, PARTIE_NOUVELLE, type ModeSalle, type ResumePartie } from "./protocole";
import {
  accueillante, botsRestantsGlobal, capaciteSalle, choisirPartie, choisirPartieBr, decisionMode, decisionPartie, garderPourReprise, messageSalons, modeDeSalle, partieApercu, partieApercuBr, partieRoutageDe, type PartieRoutage,
} from "./salons";
import { ZOMBIES } from "./zombies-vagues";

describe("routage des deux salles (décision de `mode`)", () => {
  const base = { mode: "zombies", salleActuelle: "arene" as const, enJeu: false, joueursCible: 0 };

  it("capacités : 8 pour les zombies (lobby compris), 64 connexions pour l'arène", () => {
    expect(capaciteSalle("zombies")).toBe(ZOMBIES.joueursMax);
    expect(capaciteSalle("arene")).toBe(JEU.connexionsMax);
  });

  it("un spectateur change de salle quand il y a de la place", () => {
    expect(decisionMode(base)).toEqual({ action: "changer", mode: "zombies" });
    expect(decisionMode({ ...base, mode: "arene", salleActuelle: "zombies" })).toEqual({ action: "changer", mode: "arene" });
    expect(decisionMode({ ...base, joueursCible: ZOMBIES.joueursMax - 1 })).toEqual({ action: "changer", mode: "zombies" });
  });

  it("(v11) un client d'avant la v11 n'entre pas dans la salle des zombies (`erreur{version}`, il ne gèle pas son horloge pendant une pause) ; l'arène et le BR lui restent ouverts", () => {
    expect(decisionMode({ ...base, version: 9 })).toEqual({ action: "version" });
    expect(decisionMode({ ...base, version: 8, enJeu: true })).toEqual({ action: "version" });
    expect(decisionMode({ ...base, version: 10 })).toEqual({ action: "version" });
    expect(decisionMode({ ...base, version: 11 })).toEqual({ action: "changer", mode: "zombies" });
    expect(decisionMode({ ...base, mode: "br", version: 9 })).toEqual({ action: "changer", mode: "br" });
    expect(decisionMode({ ...base, mode: "arene", salleActuelle: "zombies", version: 9 })).toEqual({ action: "changer", mode: "arene" });
  });

  it("refus `lobby` quand le client est en jeu : décidé avant tout départ de l'ancienne salle", () => {
    expect(decisionMode({ ...base, enJeu: true })).toEqual({ action: "refus", raison: "lobby" });
    // même si la salle d'arrivée est pleine : l'état en jeu prime
    expect(decisionMode({ ...base, enJeu: true, joueursCible: 99 })).toEqual({ action: "refus", raison: "lobby" });
  });

  it("refus `plein` quand la salle d'arrivée est pleine (8 pour les zombies)", () => {
    expect(decisionMode({ ...base, joueursCible: ZOMBIES.joueursMax })).toEqual({ action: "refus", raison: "plein" });
    expect(decisionMode({ ...base, mode: "arene", salleActuelle: "zombies", joueursCible: JEU.connexionsMax })).toEqual({ action: "refus", raison: "plein" });
  });

  it("déjà dans la salle demandée : simple écho, même en jeu ou salle pleine", () => {
    expect(decisionMode({ ...base, salleActuelle: "zombies", enJeu: true, joueursCible: 8 })).toEqual({ action: "echo", mode: "zombies" });
    expect(decisionMode({ ...base, mode: "arene", salleActuelle: "arene" })).toEqual({ action: "echo", mode: "arene" });
  });

  it("valeur inconnue ou mal typée : ignorée", () => {
    for (const mode of [undefined, null, 3, "", "Zombies", "autre", {}]) expect(decisionMode({ ...base, mode })).toBeNull();
  });

  it("`salons` résume les deux salles", () => {
    expect(messageSalons({ joueurs: 5, enJeu: 3 }, { phase: "manche", joueurs: 4, manche: 7 })).toEqual({
      t: "salons", arene: { joueurs: 5, enJeu: 3 }, zombies: { phase: "manche", joueurs: 4, manche: 7 },
    });
  });
});

describe("routage à trois salles (Battle Royale)", () => {
  const base = { mode: "br", salleActuelle: "arene" as const, enJeu: false, joueursCible: 0 };

  it("capacité du Battle Royale : 50 membres, lobby compris", () => {
    expect(capaciteSalle("br")).toBe(BR.joueursMax);
    expect(BR.joueursMax).toBe(50);
    expect(capaciteSalle("arene")).toBe(JEU.connexionsMax);
  });

  it("le mode `br` est connu, change de salle, refuse en jeu et quand la salle est pleine", () => {
    expect([...MODES_SALLE]).toEqual(["arene", "zombies", "br"]);
    expect(decisionMode(base)).toEqual({ action: "changer", mode: "br" });
    expect(decisionMode({ ...base, salleActuelle: "zombies" })).toEqual({ action: "changer", mode: "br" });
    expect(decisionMode({ ...base, joueursCible: BR.joueursMax - 1 })).toEqual({ action: "changer", mode: "br" });
    expect(decisionMode({ ...base, joueursCible: BR.joueursMax })).toEqual({ action: "refus", raison: "plein" });
    expect(decisionMode({ ...base, enJeu: true, joueursCible: 99 })).toEqual({ action: "refus", raison: "lobby" });
  });

  it("depuis le Battle Royale : retour vers l'arène ou les zombies, écho pour `br`", () => {
    expect(decisionMode({ ...base, mode: "arene", salleActuelle: "br" })).toEqual({ action: "changer", mode: "arene" });
    expect(decisionMode({ ...base, mode: "zombies", salleActuelle: "br" })).toEqual({ action: "changer", mode: "zombies" });
    expect(decisionMode({ ...base, salleActuelle: "br", enJeu: true })).toEqual({ action: "echo", mode: "br" });
    expect(decisionMode({ ...base, mode: "arene", salleActuelle: "br", enJeu: true })).toEqual({ action: "refus", raison: "lobby" });
  });

  it("modeDeSalle : le mode d'un client dans la salle BR n'est jamais pris pour « arène »", () => {
    const salles: Record<ModeSalle, object> = { arene: {}, zombies: {}, br: {} };
    expect(modeDeSalle(salles.arene, salles)).toBe("arene");
    expect(modeDeSalle(salles.zombies, salles)).toBe("zombies");
    expect(modeDeSalle(salles.br, salles)).toBe("br");
    // la demande `mode{arene}` d'un client de la salle BR n'est donc pas un écho
    const salleActuelle = modeDeSalle(salles.br, salles);
    expect(decisionMode({ mode: "arene", salleActuelle, enJeu: false, joueursCible: 0 })).toEqual({ action: "changer", mode: "arene" });
    // salle inconnue : arène (client pas encore placé)
    expect(modeDeSalle({}, salles)).toBe("arene");
  });

  it("`salons` sans `br` reste valide et ne porte pas la clé ; avec `br`, le palier n'est copié que défini", () => {
    const m = messageSalons({ joueurs: 5, enJeu: 3 }, { phase: "manche", joueurs: 4, manche: 7 });
    expect("br" in m).toBe(false);
    expect(messageSalons({ joueurs: 1, enJeu: 0 }, { phase: "lobby", joueurs: 0, manche: 0 }, null)).toEqual({
      t: "salons", arene: { joueurs: 1, enJeu: 0 }, zombies: { phase: "lobby", joueurs: 0, manche: 0 },
    });
    const lobby = messageSalons({ joueurs: 1, enJeu: 0 }, { phase: "lobby", joueurs: 0, manche: 0 }, { phase: "lobby", joueurs: 7, vivants: 0 });
    expect(lobby.br).toEqual({ phase: "lobby", joueurs: 7, vivants: 0 });
    expect("palier" in lobby.br!).toBe(false);
    const jeu = messageSalons({ joueurs: 1, enJeu: 0 }, { phase: "lobby", joueurs: 0, manche: 0 }, { phase: "jeu", joueurs: 20, vivants: 12, palier: 3 });
    expect(jeu.br).toEqual({ phase: "jeu", joueurs: 20, vivants: 12, palier: 3 });
  });
});

describe("(v8) session gardée pour une reprise à la fermeture d'une connexion", () => {
  const base = { estZombies: true, membre: true, code: 1006, phase: "manche" as const };
  it("une coupure réseau (1006) en pleine partie (pause ou manche) est gardée", () => {
    expect(garderPourReprise(base)).toBe(true);
    expect(garderPourReprise({ ...base, phase: "pause" })).toBe(true);
  });
  it("un départ volontaire (vue fermée 1000, onglet fermé ou rechargé 1001, sans code 1005) est déconnecté tout de suite", () => {
    for (const code of [1000, 1001, 1005]) expect(garderPourReprise({ ...base, code })).toBe(false);
  });
  it("au lobby ou au bilan, rien à reprendre (un fantôme resterait hôte) ; ni l'arène ni un non-membre ne sont gardés", () => {
    expect(garderPourReprise({ ...base, phase: "lobby" })).toBe(false);
    expect(garderPourReprise({ ...base, phase: "fin" })).toBe(false);
    expect(garderPourReprise({ ...base, estZombies: false, phase: null })).toBe(false);
    expect(garderPourReprise({ ...base, membre: false })).toBe(false);
  });
});

describe("parties de Battle Royale (plusieurs salles)", () => {
  const p = (id: string, joueurs: number, phase: "lobby" | "decompte" | "vol" | "jeu" | "fin" = "lobby") => ({ id, joueurs, phase });
  const base = { mode: "br", salleActuelle: "arene" as const, enJeu: false, joueursCible: 0, creerPossible: true };

  it("choisirPartieBr : le lobby le plus peuplé, sinon la première partie qui a de la place, sinon personne", () => {
    expect(choisirPartieBr([p("br1", 3, "jeu"), p("br2", 1), p("br3", 4)])?.id).toBe("br3");
    expect(choisirPartieBr([p("br1", 0), p("br2", 0)])?.id).toBe("br1");
    expect(choisirPartieBr([p("br1", 30, "jeu"), p("br2", 2, "fin")])?.id).toBe("br1");
    expect(choisirPartieBr([p("br1", BR.joueursMax, "jeu"), p("br2", 2, "jeu")])?.id).toBe("br2");
    expect(choisirPartieBr([p("br1", BR.joueursMax)])).toBeNull();
  });

  it("sans partie nommée : là où l'on attend ; déjà dans une partie : écho de la sienne", () => {
    expect(decisionMode({ ...base, parties: [p("br1", 9, "jeu"), p("br2", 2)] })).toEqual({ action: "changer", mode: "br", partie: "br2" });
    expect(decisionMode({ ...base, parties: [p("br1", 9, "jeu")] })).toEqual({ action: "changer", mode: "br", partie: "br1" });
    expect(decisionMode({ ...base, salleActuelle: "br", partieActuelle: "br1", parties: [p("br1", 9, "jeu"), p("br2", 2)] }))
      .toEqual({ action: "echo", mode: "br", partie: "br1" });
    expect(decisionMode({ ...base, parties: [p("br1", BR.joueursMax)] })).toEqual({ action: "refus", raison: "plein" });
  });

  it("partie nommée : on y va, sauf en jeu ou si elle est pleine ; la sienne : écho", () => {
    const parties = [p("br1", 9, "jeu"), p("br2", 2), p("br3", BR.joueursMax)];
    const dansBr = { ...base, salleActuelle: "br" as const, partieActuelle: "br1", parties };
    expect(decisionMode({ ...dansBr, partie: "br2" })).toEqual({ action: "changer", mode: "br", partie: "br2" });
    expect(decisionMode({ ...dansBr, partie: "br2", enJeu: true })).toEqual({ action: "refus", raison: "lobby" });
    expect(decisionMode({ ...dansBr, partie: "br3" })).toEqual({ action: "refus", raison: "plein" });
    expect(decisionMode({ ...dansBr, partie: "br1" })).toEqual({ action: "echo", mode: "br", partie: "br1" });
    // une partie disparue : on reste dans la sienne
    expect(decisionMode({ ...dansBr, partie: "br9" })).toEqual({ action: "echo", mode: "br", partie: "br1" });
  });

  it("nouvelle partie : reprend une salle vide au lobby, sinon en crée une, sinon refus « limite » ; jamais en jeu", () => {
    const dansBr = { ...base, salleActuelle: "br" as const, partieActuelle: "br1", partie: PARTIE_NOUVELLE };
    expect(decisionMode({ ...dansBr, parties: [p("br1", 9, "jeu")] })).toEqual({ action: "changer", mode: "br", partie: PARTIE_NOUVELLE });
    expect(decisionMode({ ...dansBr, parties: [p("br1", 9, "jeu"), p("br2", 0)] })).toEqual({ action: "changer", mode: "br", partie: "br2" });
    expect(decisionMode({ ...dansBr, parties: [p("br1", 9, "jeu")], creerPossible: false })).toEqual({ action: "refus", raison: "limite" });
    expect(decisionMode({ ...dansBr, parties: [p("br1", 9, "jeu")], enJeu: true })).toEqual({ action: "refus", raison: "lobby" });
  });

  it("modeDeSalle avec plusieurs salles BR ; salons.parties", () => {
    const a = { n: "a" }, z = { n: "z" }, b1 = { n: "b1" }, b2 = { n: "b2" };
    const salles = { arene: a, zombies: z, br: [b1, b2] };
    expect(modeDeSalle(b2, salles)).toBe("br");
    expect(modeDeSalle(a, salles)).toBe("arene");
    const m = messageSalons({ joueurs: 1, enJeu: 0 }, { phase: "lobby", joueurs: 0, manche: 0 }, { phase: "jeu", joueurs: 5, vivants: 3 }, [
      { id: "br1", phase: "jeu", joueurs: 5, vivants: 3, palier: 2, hote: "Lea" }, { id: "br2", phase: "lobby", joueurs: 0, vivants: 0 },
    ]);
    expect(m.parties).toEqual([{ id: "br1", phase: "jeu", joueurs: 5, vivants: 3, palier: 2, hote: "Lea" }, { id: "br2", phase: "lobby", joueurs: 0, vivants: 0 }]);
  });
});

describe("(v11) parties parallèles : arène", () => {
  const ar = (id: string, enJeu: number, joueurs = enJeu, extra: Partial<PartieRoutage> = {}): PartieRoutage => ({
    id, mode: "arene", joueurs, enJeu, phase: "arene", capacite: JEU.connexionsMax, accueille: accueillante("arene", { phase: "arene", enJeu }), ...extra,
  });
  const base = { mode: "arene" as const, salleActuelle: "zombies" as const, enJeu: false, creerPossible: true };

  it("accueillante : arène = place EN JEU (réservations comprises), jamais le nombre de membres", () => {
    expect(accueillante("arene", { phase: "arene", enJeu: 15 })).toBe(true);
    expect(accueillante("arene", { phase: "arene", enJeu: 16 })).toBe(false);
    expect(accueillante("arene", { phase: "arene", enJeu: 15, reserves: 1 })).toBe(false);
    expect(accueillante("zombies", { phase: "lobby" })).toBe(true);
    expect(accueillante("zombies", { phase: "manche" })).toBe(false);
    expect(accueillante("br", { phase: "jeu" })).toBe(false);
  });

  it("(0) le hall ar1 (3 spectateurs, 0 en jeu) et ar2 (15 en jeu) : ar2 est choisie ; ar1 quand ar2 est pleine", () => {
    expect(choisirPartie("arene", [ar("ar1", 0, 3), ar("ar2", 15)], true)).toMatchObject({ id: "ar2" });
    expect(choisirPartie("arene", [ar("ar1", 0, 3), ar("ar2", 16)], true)).toMatchObject({ id: "ar1" });
  });

  it("toutes pleines en jeu : création d'une arène si possible, sinon la première (spectateur du hall), personne si les 64 connexions sont prises", () => {
    expect(choisirPartie("arene", [ar("ar1", 16), ar("ar2", 16)], true)).toBe("nouvelle");
    expect(choisirPartie("arene", [ar("ar1", 16), ar("ar2", 16)], false)).toMatchObject({ id: "ar1" });
    expect(choisirPartie("arene", [ar("ar1", 16, JEU.connexionsMax)], false)).toBeNull();
  });

  it("`auto` réévalue même quand le client est déjà dans une arène ; un client qui y est déjà reçoit l'écho", () => {
    const parties = [ar("ar1", 3, 5), ar("ar2", 9)];
    const dedans = { ...base, salleActuelle: "arene" as const, partieActuelle: "ar1", parties };
    expect(decisionPartie({ ...dedans, partie: PARTIE_AUTO })).toEqual({ action: "changer", mode: "arene", partie: "ar2" });
    expect(decisionPartie({ ...dedans, parties: [ar("ar1", 9, 12), ar("ar2", 3)], partie: PARTIE_AUTO })).toEqual({ action: "echo", mode: "arene", partie: "ar1" });
    // sans partie : écho de la sienne
    expect(decisionPartie(dedans)).toEqual({ action: "echo", mode: "arene", partie: "ar1" });
  });

  it("arène : `auto` quand toutes sont pleines crée une arène ; un client en jeu n'en change pas (refus lobby)", () => {
    const parties = [ar("ar1", 16), ar("ar2", 16)];
    expect(decisionPartie({ ...base, parties, partie: PARTIE_AUTO })).toEqual({ action: "changer", mode: "arene", partie: PARTIE_NOUVELLE });
    expect(decisionPartie({ ...base, parties, partie: PARTIE_AUTO, enJeu: true })).toEqual({ action: "refus", raison: "lobby" });
    expect(decisionPartie({ ...base, parties, partie: PARTIE_AUTO, creerPossible: false })).toEqual({ action: "changer", mode: "arene", partie: "ar1" });
  });

  it("les réservations comptent dans `accueille` (course à 15/16)", () => {
    const parties = [ar("ar1", 0, 2), ar("ar2", 15, 15, { accueille: accueillante("arene", { phase: "arene", enJeu: 15, reserves: 1 }) })];
    expect(choisirPartie("arene", parties, false)).toMatchObject({ id: "ar1" });
  });

  it("client d'avant la v11 : toujours la partie permanente, jamais ar2", () => {
    const parties = [ar("ar1", 0, 1), ar("ar2", 9)];
    expect(decisionPartie({ ...base, parties, version: 10 })).toEqual({ action: "changer", mode: "arene", partie: "ar1" });
    expect(decisionPartie({ ...base, parties, version: 10, partie: "ar2" })).toEqual({ action: "changer", mode: "arene", partie: "ar1" });
    expect(decisionPartie({ ...base, parties, version: 10, salleActuelle: "arene", partieActuelle: "ar1" })).toEqual({ action: "echo", mode: "arene", partie: "ar1" });
    expect(decisionPartie({ ...base, parties, version: 11 })).toEqual({ action: "changer", mode: "arene", partie: "ar2" });
  });

  it("une partie d'arène pleine en membres (64) est refusée `plein`", () => {
    expect(decisionPartie({ ...base, parties: [ar("ar1", 16, JEU.connexionsMax)], partie: "ar1" })).toEqual({ action: "refus", raison: "plein" });
  });
});

describe("(2026-10-30) `accepteVide` : une arène vide n'est reprise que pour les mêmes réglages", () => {
  const ar = (id: string, joueurs: number): PartieRoutage => ({
    id, mode: "arene", joueurs, enJeu: joueurs, phase: "arene", capacite: JEU.connexionsMax, accueille: accueillante("arene", { phase: "arene", enJeu: joueurs }),
  });
  const base = { mode: "arene" as const, partie: PARTIE_NOUVELLE, salleActuelle: "zombies" as const, enJeu: false, creerPossible: true };

  it("sans prédicat : toute partie vide qui accueille est reprise (comportement d'avant)", () => {
    expect(decisionPartie({ ...base, parties: [ar("ar1", 3), ar("ar2", 0)] })).toEqual({ action: "changer", mode: "arene", partie: "ar2" });
  });

  it("le prédicat écarte les vides dont les réglages diffèrent : on crée une arène à la place", () => {
    const parties = [ar("ar1", 0), ar("ar2", 0)];
    expect(decisionPartie({ ...base, parties, accepteVide: () => false })).toEqual({ action: "changer", mode: "arene", partie: PARTIE_NOUVELLE });
    // la vide qui convient est reprise, pas la première vide
    expect(decisionPartie({ ...base, parties, accepteVide: (p) => p.id === "ar2" })).toEqual({ action: "changer", mode: "arene", partie: "ar2" });
  });

  it("aucune création possible et aucune vide acceptée : `refus{limite}` (le lobby l'explique)", () => {
    expect(decisionPartie({ ...base, creerPossible: false, parties: [ar("ar1", 0)], accepteVide: () => false })).toEqual({ action: "refus", raison: "limite" });
  });

  it("une partie occupée n'est jamais « reprise » : le prédicat ne la voit pas", () => {
    const vus: string[] = [];
    decisionPartie({ ...base, parties: [ar("ar1", 4), ar("ar2", 0)], accepteVide: (p) => { vus.push(p.id); return true; } });
    expect(vus).toEqual(["ar2"]);
  });

  it("`decisionMode` transmet le prédicat", () => {
    expect(decisionMode({ mode: "arene", salleActuelle: "zombies", enJeu: false, joueursCible: 0, partie: PARTIE_NOUVELLE, creerPossible: true, parties: [ar("ar1", 0)], accepteVide: () => false }))
      .toEqual({ action: "changer", mode: "arene", partie: PARTIE_NOUVELLE });
  });
});

describe("(v11) parties parallèles : zombies", () => {
  const z = (id: string, joueurs: number, phase = "lobby", extra: Partial<PartieRoutage> = {}): PartieRoutage => ({ id, mode: "zombies", joueurs, phase, ...extra });
  const base = { mode: "zombies" as const, salleActuelle: "arene" as const, enJeu: false, creerPossible: true };

  it("(a) deux clients sans `partie` : le même lobby (le plus peuplé)", () => {
    expect(decisionPartie({ ...base, parties: [z("z1", 0)] })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
    expect(decisionPartie({ ...base, parties: [z("z1", 1)] })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
    expect(decisionPartie({ ...base, parties: [z("z1", 1), z("z2", 3)] })).toEqual({ action: "changer", mode: "zombies", partie: "z2" });
  });

  it("(b) A a lancé, B arrive sans `partie` : une NOUVELLE partie ; sinon la première avec de la place ; sinon `plein`", () => {
    const enCours = [z("z1", 2, "manche")];
    expect(decisionPartie({ ...base, parties: enCours })).toEqual({ action: "changer", mode: "zombies", partie: PARTIE_NOUVELLE });
    expect(decisionPartie({ ...base, parties: enCours, creerPossible: false })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
    expect(decisionPartie({ ...base, parties: [z("z1", 8, "manche")], creerPossible: false })).toEqual({ action: "refus", raison: "plein" });
  });

  it("(b bis) création impossible (plafond OU limites de création du serveur) : toutes les parties en cours, le routage par défaut se rabat sur la première avec de la place, jamais `limite`", () => {
    const enCours = [z("z1", 2, "manche"), z("z2", 3, "pause")];
    expect(decisionPartie({ ...base, parties: enCours, creerPossible: false })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
    expect(decisionPartie({ ...base, parties: [z("z1", 8, "manche"), z("z2", 3, "pause")], creerPossible: false })).toEqual({ action: "changer", mode: "zombies", partie: "z2" });
    // la demande explicite de création, elle, reste refusée
    expect(decisionPartie({ ...base, parties: enCours, partie: PARTIE_NOUVELLE, creerPossible: false })).toEqual({ action: "refus", raison: "limite" });
    expect(decisionMode({ mode: "zombies", salleActuelle: "arene", enJeu: false, joueursCible: 0, parties: enCours, creerPossible: false })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
  });

  it("(c) `nouvelle` reprend d'abord une partie vide au lobby, puis crée, puis `limite` ; en jeu : `lobby`", () => {
    const n = { ...base, partie: PARTIE_NOUVELLE };
    expect(decisionPartie({ ...n, parties: [z("z1", 2, "manche"), z("z2", 0)] })).toEqual({ action: "changer", mode: "zombies", partie: "z2" });
    expect(decisionPartie({ ...n, parties: [z("z1", 2, "manche")] })).toEqual({ action: "changer", mode: "zombies", partie: PARTIE_NOUVELLE });
    expect(decisionPartie({ ...n, parties: [z("z1", 2, "manche")], creerPossible: false })).toEqual({ action: "refus", raison: "limite" });
    expect(decisionPartie({ ...n, parties: [z("z1", 2, "manche")], enJeu: true })).toEqual({ action: "refus", raison: "lobby" });
    // sa propre partie vide n'est pas « reprise »
    expect(decisionPartie({ ...n, salleActuelle: "zombies", partieActuelle: "z1", parties: [z("z1", 0)] })).toEqual({ action: "changer", mode: "zombies", partie: PARTIE_NOUVELLE });
  });

  it("(e) une partie nommée disparue retombe dans le routage par défaut, sans erreur", () => {
    expect(decisionPartie({ ...base, partie: "z7", parties: [z("z1", 2)] })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
  });

  it("(f) un client déjà dans une partie du mode : écho de la sienne ; partie nommée : on y va", () => {
    const dedans = { ...base, salleActuelle: "zombies" as const, partieActuelle: "z2", parties: [z("z1", 0), z("z2", 3, "manche")] };
    expect(decisionPartie(dedans)).toEqual({ action: "echo", mode: "zombies", partie: "z2" });
    expect(decisionPartie({ ...dedans, partie: "z2" })).toEqual({ action: "echo", mode: "zombies", partie: "z2" });
    expect(decisionPartie({ ...dedans, partie: "z1" })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
    expect(decisionPartie({ ...dedans, partie: "z1", enJeu: true })).toEqual({ action: "refus", raison: "lobby" });
  });

  it("une partie NOMMÉE en cours est rejoignable (arrivée en attente) ; pleine (8) : `plein`", () => {
    expect(decisionPartie({ ...base, partie: "z1", parties: [z("z1", 3, "manche")] })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
    expect(decisionPartie({ ...base, partie: "z1", parties: [z("z1", 8, "manche")] })).toEqual({ action: "refus", raison: "plein" });
  });

  it("client v10 : toujours z1 ; client v9 : `erreur{version}` (décidé par decisionMode)", () => {
    expect(decisionPartie({ ...base, parties: [z("z1", 2, "manche"), z("z2", 1)], version: 10 })).toEqual({ action: "changer", mode: "zombies", partie: "z1" });
    expect(decisionMode({ mode: "zombies", salleActuelle: "arene", enJeu: false, joueursCible: 0, version: 9, parties: [z("z1", 0)] })).toEqual({ action: "version" });
  });
});

describe("(v11) parties parallèles : décision par défaut et salons", () => {
  it("(h) sans `parties`, decisionMode garde l'ancien comportement à une salle par mode", () => {
    expect(decisionMode({ mode: "arene", salleActuelle: "zombies", enJeu: false, joueursCible: 0 })).toEqual({ action: "changer", mode: "arene" });
    expect(decisionMode({ mode: "arene", salleActuelle: "arene", enJeu: false, joueursCible: 0 })).toEqual({ action: "echo", mode: "arene" });
  });

  it("decisionMode avec `parties` route aussi l'arène par partie (écho avec la partie)", () => {
    const parties: PartieRoutage[] = [{ id: "ar1", mode: "arene", joueurs: 2, enJeu: 2, phase: "arene" }];
    expect(decisionMode({ mode: "arene", salleActuelle: "arene", enJeu: false, joueursCible: 0, parties, partieActuelle: "ar1" }))
      .toEqual({ action: "echo", mode: "arene", partie: "ar1" });
  });

  it("(g) garderPourReprise avec `estZombies` : seul un membre d'une partie de zombies en cours est gardé, où qu'elle soit (z1, z2…)", () => {
    expect(garderPourReprise({ estZombies: true, membre: true, code: 1006, phase: "manche" })).toBe(true);
    expect(garderPourReprise({ estZombies: false, membre: true, code: 1006, phase: "manche" })).toBe(false);
  });

  it("(i) `parties` ne contient QUE du BR, `listes` les trois modes, champs historiques = permanentes", () => {
    const r = (id: string, mode: ModeSalle, extra: Partial<ResumePartie> = {}): ResumePartie => ({ id, mode, phase: mode === "arene" ? "arene" : "lobby", joueurs: 1, capacite: 8, ...extra });
    const listes = {
      arene: [r("ar1", "arene", { enJeu: 3 }), r("ar2", "arene")],
      zombies: [r("z1", "zombies"), r("z2", "zombies", { suspendue: true })],
      br: [r("br1", "br", { bots: 11, botsMax: 20, botsRestants: 13 })],
    };
    const m = messageSalons({ joueurs: 4, enJeu: 3 }, { phase: "lobby", joueurs: 1, manche: 0 }, { phase: "lobby", joueurs: 1, vivants: 0 }, [{ id: "br1", phase: "lobby", joueurs: 1, vivants: 0 }], listes);
    expect(m.parties).toEqual([{ id: "br1", phase: "lobby", joueurs: 1, vivants: 0 }]);
    expect(m.listes).toEqual(listes);
    expect(m.arene).toEqual({ joueurs: 4, enJeu: 3 });
    expect(m.zombies).toEqual({ phase: "lobby", joueurs: 1, manche: 0 });
    // sans `listes` (ancien appel) : le champ est omis
    expect("listes" in messageSalons({ joueurs: 1, enJeu: 0 }, { phase: "lobby", joueurs: 0, manche: 0 })).toBe(false);
  });

  it("modeDeSalle retrouve le mode d'un client dans l'une des parties de chaque mode", () => {
    const a1 = {}, a2 = {}, z1 = {}, z2 = {}, b1 = {};
    const salles = { arene: [a1, a2], zombies: [z1, z2], br: [b1] };
    expect(modeDeSalle(a2, salles)).toBe("arene");
    expect(modeDeSalle(z2, salles)).toBe("zombies");
    expect(modeDeSalle(b1, salles)).toBe("br");
  });
});

describe("capacité d'une partie de Battle Royale, bots compris (lot 3a)", () => {
  const brAvec = (membres: number): PartieRoutage => partieRoutageDe("br", { id: "br1", membres, phase: "decompte" });
  const demande = (membres: number) => decisionMode({
    mode: "br", salleActuelle: "arene", enJeu: false, joueursCible: 0, partie: "br1", partieActuelle: null, parties: [brAvec(membres)], creerPossible: false,
  });

  it("la partie compte ses membres humains + bots : un arrivant à 49 est admis, à 50 il reçoit refus{plein} (jamais une fermeture de socket)", () => {
    expect(brAvec(49)).toMatchObject({ joueurs: 49, capacite: BR.joueursMax });
    expect(demande(BR.joueursMax - 1)).toEqual({ action: "changer", mode: "br", partie: "br1" });
    expect(demande(BR.joueursMax)).toEqual({ action: "refus", raison: "plein" });
  });

  it("le routage par défaut n'envoie pas non plus un arrivant dans une partie pleine", () => {
    expect(choisirPartie("br", [brAvec(BR.joueursMax)], false)).toBeNull();
    expect(choisirPartieBr([brAvec(BR.joueursMax), { ...brAvec(2), id: "br2", phase: "lobby" }])?.id).toBe("br2");
  });

  it("arène : enJeu et réservations déterminent l'accueil, les membres la capacité", () => {
    expect(partieRoutageDe("arene", { id: "ar1", membres: 40, phase: "arene", enJeu: JEU.joueursMax - 1, reserves: 1 }).accueille).toBe(false);
    expect(partieRoutageDe("arene", { id: "ar1", membres: 40, phase: "arene", enJeu: JEU.joueursMax - 2, reserves: 1 })).toMatchObject({ accueille: true, enJeu: JEU.joueursMax - 2 });
    expect(partieRoutageDe("zombies", { id: "z1", membres: 1, phase: "manche" }).enJeu).toBeUndefined();
  });

  it("quota de bots : total moins les bots de TOUTES les parties, jamais négatif", () => {
    expect(botsRestantsGlobal(24, [])).toBe(24);
    expect(botsRestantsGlobal(24, [12])).toBe(12);
    expect(botsRestantsGlobal(24, [12, 12])).toBe(0);
    expect(botsRestantsGlobal(24, [12, 12, 5])).toBe(0);
    expect(botsRestantsGlobal(24, [12, 0])).toBe(12);
  });
});

describe("partieApercuBr (aperçu de la vue Palantir)", () => {
  const p = (id: string, phase: "lobby" | "decompte" | "vol" | "jeu" | "fin", vivants: number) => ({ id, phase, vivants });
  it("la sienne si elle est en vol ou en jeu", () => {
    expect(partieApercuBr([p("br1", "jeu", 3), p("br2", "jeu", 20)], "br1")).toBe("br1");
    expect(partieApercuBr([p("br1", "vol", 3), p("br2", "jeu", 20)], "br1")).toBe("br1");
  });
  it("sinon la partie en cours qui compte le plus de survivants", () => {
    expect(partieApercuBr([p("br1", "lobby", 0), p("br2", "jeu", 5), p("br3", "vol", 12), p("br4", "fin", 40)], "br1")).toBe("br3");
  });
  it("égalité : la première de la liste", () => {
    expect(partieApercuBr([p("br1", "lobby", 0), p("br2", "jeu", 5), p("br3", "jeu", 5)], "br1")).toBe("br2");
  });
  it("aucune partie en cours : null (simulation) ; décompte et fin ne comptent pas", () => {
    expect(partieApercuBr([p("br1", "lobby", 0), p("br2", "decompte", 8), p("br3", "fin", 1)], "br1")).toBeNull();
    expect(partieApercuBr([], "br1")).toBeNull();
  });
});

describe("(v11) partieApercu des zombies (parties parallèles)", () => {
  const z = (id: string, phase: "lobby" | "pause" | "manche" | "fin", vivants: number) => ({ id, phase, vivants });
  it("un spectateur dans un lobby vide voit la partie de zombies en cours la plus peuplée ; la sienne si elle est en cours", () => {
    expect(partieApercu("zombies", [z("z1", "manche", 2), z("z2", "lobby", 1), z("z3", "pause", 4)], "z2")).toBe("z3");
    expect(partieApercu("zombies", [z("z1", "manche", 2), z("z2", "pause", 1)], "z2")).toBe("z2");
  });
  it("lobby et fin ne comptent pas : null (simulation)", () => {
    expect(partieApercu("zombies", [z("z1", "lobby", 3), z("z2", "fin", 2)], "z1")).toBeNull();
  });
});
