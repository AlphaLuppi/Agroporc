import { describe, expect, it } from "vitest";
import { JEU } from "./protocole";
import { capaciteSalle, decisionMode, garderPourReprise, messageSalons } from "./salons";
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
