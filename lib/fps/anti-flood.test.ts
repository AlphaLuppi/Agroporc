import { describe, expect, it } from "vitest";
import { ANTI_FLOOD, admettre, creerEtatFlood, type DecisionFlood } from "./anti-flood";

/** Anti-flood du serveur : l'excédent est jeté, la connexion n'est coupée que pour un débit brut aberrant. */

const T0 = 1_000_000;
const compter = (d: DecisionFlood[]) => ({ ok: d.filter((x) => x === "ok").length, jeter: d.filter((x) => x === "jeter").length, couper: d.filter((x) => x === "couper").length });

describe("anti-flood", () => {
  it("300 `etat` livrés d'un coup (10 s de coupure TCP) : aucune déconnexion, l'excédent est jeté", () => {
    const e = creerEtatFlood(T0);
    const r = compter(Array.from({ length: 300 }, () => admettre(e, "etat", T0 + 10)));
    expect(r.couper).toBe(0);
    expect(r.ok).toBe(ANTI_FLOOD.fluxRafale);
    expect(r.jeter).toBe(300 - ANTI_FLOOD.fluxRafale);
  });

  it("un client nominal (30 `etat`/s, 22 `tir`/s au mini Uzi sous Double Ristretto, un ping) ne perd rien pendant une minute", () => {
    const e = creerEtatFlood(T0);
    const arrivees: [number, string][] = [];
    for (let k = 0; k < 60 * 30; k++) {
      arrivees.push([T0 + Math.round((k * 1000) / 30), "etat"]);
      if (k % 30 === 0) arrivees.push([T0 + Math.round((k * 1000) / 30), "ping"]);
    }
    for (let k = 0; k < 60 * 22; k++) arrivees.push([T0 + Math.round((k * 1000) / 22), "tir"]);
    arrivees.sort((a, b) => a[0] - b[0]);
    const decisions = arrivees.map(([t, type]) => admettre(e, type, t));
    expect(compter(decisions)).toMatchObject({ jeter: 0, couper: 0 });
  });

  it("une coupure de 0,75 s en tirant (≈ 40 messages d'un coup, l'ancienne limite fermait à 90 par seconde) passe entière", () => {
    const e = creerEtatFlood(T0);
    // régime établi pendant 5 s
    for (let k = 0; k < 150; k++) admettre(e, "etat", T0 + k * 33);
    const t = T0 + 5000 + 750;
    const rafale = [...Array.from({ length: 23 }, () => admettre(e, "etat", t)), ...Array.from({ length: 17 }, () => admettre(e, "tir", t))];
    expect(compter(rafale)).toMatchObject({ jeter: 0, couper: 0 });
  });

  it("les flux et les actions ont des seaux séparés : jeter des états ne prive pas des tirs", () => {
    const e = creerEtatFlood(T0);
    for (let k = 0; k < 200; k++) admettre(e, "etat", T0);
    expect(admettre(e, "etat", T0)).toBe("jeter");
    expect(admettre(e, "tir", T0)).toBe("ok");
    expect(admettre(e, "acheter", T0)).toBe("ok");
  });

  it("flood réel : au-delà de 600 messages bruts dans une seconde, la connexion est coupée ; les actions sans jeton sont jetées avant", () => {
    const e = creerEtatFlood(T0);
    const r = compter(Array.from({ length: 700 }, () => admettre(e, "tir", T0 + 1)));
    expect(r.ok).toBe(ANTI_FLOOD.actionsRafale);
    expect(r.couper).toBe(100);
    // la fenêtre suivante repart de zéro
    expect(admettre(e, "tir", T0 + 2000)).toBe("ok");
  });
});
