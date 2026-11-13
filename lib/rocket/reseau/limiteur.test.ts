import { describe, expect, it } from "vitest";
import { admettreRocket, creerLimiteur } from "./limiteur";
import { RESEAU } from "./protocole";

describe("limiteur Rocket (anti-flood)", () => {
  it("les seaux sont pleins à la connexion", () => {
    const e = creerLimiteur(1000);
    expect(e.entrees).toBe(RESEAU.floodEntreesRafale);
    expect(e.ping).toBe(RESEAU.floodPingRafale);
    expect(e.actions).toBe(RESEAU.floodActionsRafale);
    expect(e.fenetreNb).toBe(0);
  });

  it("une rafale d'actions passe puis l'excédent est jeté sans couper", () => {
    const e = creerLimiteur(0);
    for (let i = 0; i < RESEAU.floodActionsRafale; i++) expect(admettreRocket(e, "action", 0)).toBe("ok");
    expect(admettreRocket(e, "action", 0)).toBe("jeter");
    expect(admettreRocket(e, "action", 0)).toBe("jeter");
  });

  it("le seau d'actions se remplit au rythme de floodActionsParS", () => {
    const e = creerLimiteur(0);
    for (let i = 0; i < RESEAU.floodActionsRafale; i++) admettreRocket(e, "action", 0);
    // 1 s plus tard : 10 jetons
    let ok = 0;
    for (let i = 0; i < 15; i++) if (admettreRocket(e, "action", 1000) === "ok") ok++;
    expect(ok).toBe(RESEAU.floodActionsParS);
  });

  it("les trois seaux sont indépendants", () => {
    const e = creerLimiteur(0);
    for (let i = 0; i < RESEAU.floodActionsRafale; i++) admettreRocket(e, "action", 0);
    expect(admettreRocket(e, "action", 0)).toBe("jeter");
    expect(admettreRocket(e, "entrees", 0)).toBe("ok");
    expect(admettreRocket(e, "ping", 0)).toBe("ok");
    for (let i = 0; i < RESEAU.floodPingRafale - 1; i++) admettreRocket(e, "ping", 0);
    expect(admettreRocket(e, "ping", 0)).toBe("jeter");
    expect(admettreRocket(e, "entrees", 0)).toBe("ok");
  });

  it("le débit nominal des entrées (≈ 100 trames/s) ne déclenche jamais de jet", () => {
    const e = creerLimiteur(0);
    for (let k = 0; k < 600; k++) expect(admettreRocket(e, "entrees", k * 10)).toBe("ok");
  });

  it("le seau des entrées plafonne à sa rafale (un long silence ne donne pas plus)", () => {
    const e = creerLimiteur(0);
    admettreRocket(e, "entrees", 3_600_000);
    expect(e.entrees).toBeLessThanOrEqual(RESEAU.floodEntreesRafale);
    expect(e.actions).toBe(RESEAU.floodActionsRafale);
  });

  it("plus de 400 messages bruts dans une seconde coupent la socket", () => {
    const e = creerLimiteur(0);
    let derniere = "ok";
    for (let i = 0; i < RESEAU.floodCoupureParSeconde + 1; i++) derniere = admettreRocket(e, "entrees", 500);
    expect(derniere).toBe("couper");
  });

  it("exactement 400 messages dans la seconde ne coupent pas, et la fenêtre se renouvelle", () => {
    const e = creerLimiteur(0);
    for (let i = 0; i < RESEAU.floodCoupureParSeconde; i++) expect(admettreRocket(e, "entrees", 100)).not.toBe("couper");
    expect(admettreRocket(e, "entrees", 1100)).not.toBe("couper");
    expect(e.fenetreNb).toBe(1);
  });

  it("les messages jetés comptent dans la fenêtre brute", () => {
    const e = creerLimiteur(0);
    let coupe = false;
    for (let i = 0; i < 1000 && !coupe; i++) coupe = admettreRocket(e, "action", 10) === "couper";
    expect(coupe).toBe(true);
  });

  it("une horloge qui recule ne crédite rien et ne casse rien", () => {
    const e = creerLimiteur(5000);
    for (let i = 0; i < RESEAU.floodActionsRafale; i++) admettreRocket(e, "action", 5000);
    expect(admettreRocket(e, "action", 4000)).toBe("jeter");
    expect(Number.isFinite(e.actions)).toBe(true);
  });
});
