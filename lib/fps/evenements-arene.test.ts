import { describe, expect, it } from "vitest";
import { AVION } from "./avion";
import { BUS_C3 } from "./bus-c3";
import { ELSA } from "./elsa";
import { FACTEURS_FREQUENCE, choisirType, echelleIntervalle, optionsDepuisReglages, tempsMort, typesActifs } from "./evenements-arene";
import type { OptionsSalle } from "./match";
import { EVENEMENTS } from "./monstres";
import { POLICE } from "./police";
import type { TypeEvenement } from "./protocole";
import { normaliserReglages } from "./reglages-arene";

const suite = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
const TOUS: TypeEvenement[] = ["truck", "tigre"];

describe("choisirType : variété des événements à tour", () => {
  it("rien d'actif : null, et aucun tirage", () => {
    let appels = 0;
    expect(choisirType([], null, () => { appels++; return 0.1; })).toBeNull();
    expect(appels).toBe(0);
  });

  it("un seul actif : il revient toujours, sans tirage", () => {
    let appels = 0;
    const alea = () => { appels++; return 0.9; };
    expect(choisirType(["tigre"], null, alea)).toBe("tigre");
    expect(choisirType(["tigre"], "tigre", alea)).toBe("tigre");
    expect(appels).toBe(0);
  });

  it("séquence de hasard de la v3 : un tirage pour le premier (alea < 0,5 : Truck), puis alternance SANS tirage", () => {
    let appels = 0;
    const alea = (v: number) => () => { appels++; return v; };
    expect(choisirType(TOUS, null, alea(0.49))).toBe("truck");
    expect(choisirType(TOUS, null, alea(0.5))).toBe("tigre");
    expect(appels).toBe(2);
    appels = 0;
    expect(choisirType(TOUS, "truck", alea(0.1))).toBe("tigre");
    expect(choisirType(TOUS, "tigre", alea(0.9))).toBe("truck");
    expect(appels).toBe(0);
  });

  it("n'enchaîne jamais deux fois le même quand il y a le choix, et un dernier hors liste ne gêne pas", () => {
    expect(choisirType(["truck"], "tigre", () => 0.9)).toBe("truck");
    const alea = suite(0.1, 0.9, 0.3, 0.7);
    let dernier: TypeEvenement | null = null;
    for (let k = 0; k < 30; k++) {
      const t: TypeEvenement = choisirType(TOUS, dernier, alea)!;
      expect(t).not.toBe(dernier);
      dernier = t;
    }
  });
});

describe("temps morts, facteurs, échelle", () => {
  it("tempsMort : alea < probabilité de la fréquence", () => {
    expect(tempsMort("normal", () => 0.29)).toBe(true);
    expect(tempsMort("normal", () => 0.3)).toBe(false);
    expect(tempsMort("chaos", () => 0.05)).toBe(true);
    expect(tempsMort("chaos", () => 0.2)).toBe(false);
    expect(tempsMort("calme", () => 0.49)).toBe(true);
  });

  it("Chaos est la cadence historique de la v3 ; Calme espace plus que Normal", () => {
    expect(FACTEURS_FREQUENCE.chaos.intervalle).toBe(1);
    expect(FACTEURS_FREQUENCE.calme.intervalle).toBeGreaterThan(FACTEURS_FREQUENCE.normal.intervalle);
    expect(FACTEURS_FREQUENCE.normal.intervalle).toBeGreaterThan(FACTEURS_FREQUENCE.chaos.intervalle);
    expect(FACTEURS_FREQUENCE.normal.police).toBe(1);
  });

  it("echelleIntervalle : multiplie les deux bornes (facteur d'intervalle, ou facteur de la police)", () => {
    expect(echelleIntervalle({ minMs: 1000, maxMs: 2000 }, "calme")).toEqual({ minMs: 3000, maxMs: 6000 });
    expect(echelleIntervalle({ minMs: 1000, maxMs: 2000 }, "chaos")).toEqual({ minMs: 1000, maxMs: 2000 });
    expect(echelleIntervalle({ minMs: 1000, maxMs: 2000 }, "calme", "police")).toEqual({ minMs: 2000, maxMs: 4000 });
  });

  it("typesActifs : Truck et tigre dans l'ordre canonique selon les cases", () => {
    expect(typesActifs(normaliserReglages({ evenements: ["tigre", "elsa", "truck"] }))).toEqual(["truck", "tigre"]);
    expect(typesActifs(normaliserReglages({ evenements: ["tigre"] }))).toEqual(["tigre"]);
    expect(typesActifs(normaliserReglages({ evenements: ["elsa", "bus"] }))).toEqual([]);
  });
});

describe("optionsDepuisReglages : traduction des cases en options de salle", () => {
  const base = (): OptionsSalle => ({
    elsa: { x: 1, z: 2 },
    tigres: { cachettes: [] },
    bus: {},
    evenements: { truck: { x: 0, z: 0 }, centre: { x: 0, z: 0 } },
    police: { points: [[0, 0]], chemin: () => null },
  });

  it("tout coché, Chaos : tous les services sont là, à la cadence d'origine (facteur 1)", () => {
    const o = optionsDepuisReglages(normaliserReglages({ frequence: "chaos" }), base());
    expect(o.elsa).toBeTruthy(); expect(o.tigres).toBeTruthy(); expect(o.evenements).toBeTruthy(); expect(o.police).toBeTruthy();
    expect(o.bus).toEqual({ intervalle: { minMs: BUS_C3.intervalleMinMs, maxMs: BUS_C3.intervalleMaxMs } });
    expect(o.elsa!.intervalle).toEqual({ minMs: ELSA.intervalleMinMs, maxMs: ELSA.intervalleMaxMs });
    expect(o.tigres!.intervalle).toEqual({ minMs: AVION.intervalleMinMs, maxMs: AVION.intervalleMaxMs });
    expect(o.evenements!.premier).toEqual({ minMs: EVENEMENTS.premierMinMs, maxMs: EVENEMENTS.premierMaxMs });
    expect(o.evenements!.intervalle).toEqual({ minMs: EVENEMENTS.intervalleMinMs, maxMs: EVENEMENTS.intervalleMaxMs });
    expect(o.evenements!.types).toEqual(["truck", "tigre"]);
    expect(o.evenements!.tempsMortP).toBe(FACTEURS_FREQUENCE.chaos.tempsMort);
    expect(o.reglages).toEqual({ evenements: ["elsa", "avion", "bus", "truck", "tigre", "police"], frequence: "chaos" });
  });

  it("retire les services des cases décochées", () => {
    const o = optionsDepuisReglages(normaliserReglages({ evenements: ["truck"] }), base());
    expect(o.elsa).toBeUndefined();
    expect(o.tigres).toBeUndefined();
    expect(o.bus).toBe(false);
    expect(o.police).toBeUndefined();
    expect(o.evenements!.types).toEqual(["truck"]);
  });

  it("aucun type à tour (ni Truck ni tigre) : le service des événements disparaît ; `forcerType` l'emporte", () => {
    const sans = optionsDepuisReglages(normaliserReglages({ evenements: ["elsa", "police"] }), base());
    expect(sans.evenements).toBeUndefined();
    const force = optionsDepuisReglages(normaliserReglages({ evenements: ["elsa"] }), { ...base(), evenements: { ...base().evenements!, forcerType: "truck" } });
    expect(force.evenements!.forcerType).toBe("truck");
  });

  it("met les intervalles à l'échelle de la fréquence (Normal = 1,6, Calme = 3)", () => {
    const o = optionsDepuisReglages(normaliserReglages({ frequence: "calme" }), base());
    expect(o.elsa!.intervalle).toEqual({ minMs: ELSA.intervalleMinMs * 3, maxMs: ELSA.intervalleMaxMs * 3 });
    expect(o.evenements!.intervalle!.minMs).toBe(EVENEMENTS.intervalleMinMs * 3);
    const n = optionsDepuisReglages(normaliserReglages({}), base());
    expect(n.elsa!.intervalle!.minMs).toBe(Math.round(ELSA.intervalleMinMs * 1.6));
  });

  it("ne met JAMAIS à l'échelle un intervalle imposé par l'environnement", () => {
    const b = base();
    b.elsa = { x: 1, z: 2, intervalle: { minMs: 111, maxMs: 222 } };
    b.tigres = { cachettes: [], intervalle: { minMs: 333, maxMs: 444 } };
    b.bus = { intervalle: { minMs: 555, maxMs: 666 } };
    b.evenements = { ...b.evenements!, premier: { minMs: 1, maxMs: 2 }, intervalle: { minMs: 3, maxMs: 4 } };
    b.police = { ...b.police!, intervalle: { premier: { minMs: 5, maxMs: 6 }, entre: { minMs: 7, maxMs: 8 } } };
    const o = optionsDepuisReglages(normaliserReglages({ frequence: "calme" }), b, { elsa: true, avion: true, bus: true, evenements: true, police: true });
    expect(o.elsa!.intervalle).toEqual({ minMs: 111, maxMs: 222 });
    expect(o.tigres!.intervalle).toEqual({ minMs: 333, maxMs: 444 });
    expect(o.bus).toEqual({ intervalle: { minMs: 555, maxMs: 666 } });
    expect(o.evenements!.premier).toEqual({ minMs: 1, maxMs: 2 });
    expect(o.evenements!.intervalle).toEqual({ minMs: 3, maxMs: 4 });
    expect(o.police!.intervalle).toEqual({ premier: { minMs: 5, maxMs: 6 }, entre: { minMs: 7, maxMs: 8 } });
    // le temps mort double aussi un délai : un intervalle imposé ne le reçoit pas (aucun tirage de plus)
    expect(o.evenements!.tempsMortP).toBeUndefined();
    expect(o.police!.tempsMortP).toBeUndefined();
    // seul l'intervalle imposé d'un service le prive de temps mort
    const mixte = optionsDepuisReglages(normaliserReglages({ frequence: "calme" }), b, { evenements: true });
    expect(mixte.evenements!.tempsMortP).toBeUndefined();
    expect(mixte.police!.tempsMortP).toBe(FACTEURS_FREQUENCE.calme.tempsMort);
  });

  it("la police : relative à Normal (Calme ×2, Chaos ×0,7) avec un plancher", () => {
    const calme = optionsDepuisReglages(normaliserReglages({ frequence: "calme" }), base());
    expect(calme.police!.intervalle!.entre).toEqual({ minMs: POLICE.entre.minMs * 2, maxMs: POLICE.entre.maxMs * 2 });
    const normal = optionsDepuisReglages(normaliserReglages({}), base());
    expect(normal.police!.intervalle!.premier).toEqual({ minMs: POLICE.premier.minMs, maxMs: POLICE.premier.maxMs });
    const chaos = optionsDepuisReglages(normaliserReglages({ frequence: "chaos" }), base());
    expect(chaos.police!.intervalle!.entre!.minMs).toBeGreaterThanOrEqual(POLICE.plancherMs);
    expect(chaos.police!.intervalle!.entre!.minMs).toBe(Math.round(POLICE.entre.minMs * 0.7));
    expect(chaos.police!.tempsMortP).toBe(FACTEURS_FREQUENCE.chaos.tempsMort);
  });

  it("ne modifie pas les options de base", () => {
    const b = base();
    const copie = JSON.stringify(b, (_k, v) => (typeof v === "function" ? "fn" : v));
    optionsDepuisReglages(normaliserReglages({ evenements: [] }), b);
    expect(JSON.stringify(b, (_k, v) => (typeof v === "function" ? "fn" : v))).toBe(copie);
  });
});
