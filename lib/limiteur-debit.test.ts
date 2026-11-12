import { describe, expect, it } from "vitest";
import { creerLimiteur, ipDeRequete } from "./limiteur-debit";

function h(valeurs: Record<string, string>) {
  return { get: (n: string) => valeurs[n.toLowerCase()] ?? null };
}

describe("creerLimiteur", () => {
  it("autorise max appels par fenêtre puis refuse", () => {
    let t = 0;
    const l = creerLimiteur(3, 1000, () => t);
    expect([l.essayer("a"), l.essayer("a"), l.essayer("a"), l.essayer("a"), l.essayer("a")]).toEqual([true, true, true, false, false]);
  });

  it("repart à zéro une fois la fenêtre écoulée (fenêtre fixe)", () => {
    let t = 0;
    const l = creerLimiteur(2, 1000, () => t);
    l.essayer("a");
    t = 900;
    l.essayer("a");
    expect(l.essayer("a")).toBe(false);
    t = 1000;
    expect(l.essayer("a")).toBe(true);
    expect(l.essayer("a")).toBe(true);
    expect(l.essayer("a")).toBe(false);
  });

  it("les clés sont indépendantes", () => {
    const l = creerLimiteur(1, 1000, () => 0);
    expect(l.essayer("a")).toBe(true);
    expect(l.essayer("b")).toBe(true);
    expect(l.essayer("a")).toBe(false);
    expect(l.essayer("b")).toBe(false);
  });

  it("purge les entrées expirées à chaque appel", () => {
    let t = 0;
    const l = creerLimiteur(1, 1000, () => t);
    for (let i = 0; i < 50; i++) l.essayer(`ip-${i}`);
    expect(l.taille()).toBe(50);
    t = 5000;
    l.essayer("autre");
    expect(l.taille()).toBe(1);
  });

  it("un plafond de 0 refuse tout", () => {
    expect(creerLimiteur(0, 1000, () => 0).essayer("a")).toBe(false);
  });

  it("utilise Date.now par défaut", () => {
    const l = creerLimiteur(1, 60_000);
    expect(l.essayer("x")).toBe(true);
    expect(l.essayer("x")).toBe(false);
  });
});

describe("ipDeRequete", () => {
  it("prend la première adresse de x-forwarded-for", () => {
    expect(ipDeRequete(h({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4");
  });
  it("retombe sur x-real-ip puis sur unknown", () => {
    expect(ipDeRequete(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(ipDeRequete(h({ "x-forwarded-for": "", "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(ipDeRequete(h({}))).toBe("unknown");
  });
});
