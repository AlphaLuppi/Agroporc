import { describe, expect, it } from "vitest";
import { BR } from "./br-regles";
import { JEU, MODES_SALLE, PARTIE_NOUVELLE, type ModeSalle } from "./protocole";
import { capaciteSalle, choisirPartieBr, decisionMode, garderPourReprise, messageSalons, modeDeSalle, partieApercuBr } from "./salons";
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

  it("(v10) un client d'avant la v10 n'entre pas dans la salle des zombies (`erreur{version}`) ; l'arène et le BR lui restent ouverts", () => {
    expect(decisionMode({ ...base, version: 9 })).toEqual({ action: "version" });
    expect(decisionMode({ ...base, version: 8, enJeu: true })).toEqual({ action: "version" });
    expect(decisionMode({ ...base, version: 10 })).toEqual({ action: "changer", mode: "zombies" });
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
  const base = { salleZombies: true, membre: true, code: 1006, phase: "manche" as const };
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
    expect(garderPourReprise({ ...base, salleZombies: false, phase: null })).toBe(false);
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
