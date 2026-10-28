import { describe, expect, it } from "vitest";
import { BR } from "./br-regles";
import { JEU, MODES_SALLE, type ModeSalle } from "./protocole";
import { capaciteSalle, decisionMode, messageSalons, modeDeSalle } from "./salons";
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
