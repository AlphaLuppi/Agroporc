import { describe, it, expect } from "vitest";
import { classerDessertNom, choisirDessert, type DessertConnu } from "./desserts";
import {
  normalizeDessertKey,
  aggregateObservations,
  mergeDesserts,
  isoMinusDays,
} from "./desserts";

const D = (over: Partial<DessertConnu>): DessertConnu => ({
  nom: "X",
  restaurant: "Le Truck Muche",
  type_saveur: "creme_lacte",
  leger_gourmand: "gourmand",
  proba: 50,
  ...over,
});

describe("classerDessertNom", () => {
  it("classe une salade de fruits en fruité/léger", () => {
    expect(classerDessertNom("Salade de fruits")).toEqual({
      type_saveur: "fruite",
      leger_gourmand: "leger",
    });
  });

  it("classe un mi-cuit chocolat en chocolaté/gourmand", () => {
    expect(classerDessertNom("Mi-cuit au chocolat")).toEqual({
      type_saveur: "chocolate",
      leger_gourmand: "gourmand",
    });
  });

  it("classe une tarte en pâtissier/gourmand", () => {
    expect(classerDessertNom("Tarte abricots amandine")).toEqual({
      type_saveur: "patissier",
      leger_gourmand: "gourmand",
    });
  });
});

describe("choisirDessert", () => {
  it("filtre par saveur et trie par proba décroissante", () => {
    const pool = [
      D({ nom: "A", type_saveur: "fruite", proba: 30 }),
      D({ nom: "B", type_saveur: "fruite", proba: 85 }),
      D({ nom: "C", type_saveur: "chocolate", proba: 99 }),
    ];
    expect(choisirDessert(pool, { saveur: "fruite" })?.nom).toBe("B");
  });

  it("départage par note à proba égale", () => {
    const pool = [
      D({ nom: "A", proba: 80, note: 6 }),
      D({ nom: "B", proba: 80, note: 9 }),
    ];
    expect(choisirDessert(pool, {})?.nom).toBe("B");
  });

  it("ne filtre pas un axe non précisé (peu importe)", () => {
    const pool = [D({ nom: "A", proba: 70 })];
    expect(choisirDessert(pool, {})?.nom).toBe("A");
  });

  it("retourne null si aucun dessert ne matche", () => {
    const pool = [D({ nom: "A", type_saveur: "fruite" })];
    expect(choisirDessert(pool, { saveur: "chocolate" })).toBeNull();
  });
});

describe("normalizeDessertKey", () => {
  it("ignore casse, accents, ponctuation et espaces", () => {
    expect(normalizeDessertKey("Mi-cuit  CHOCOLAT !")).toBe("mi cuit chocolat");
  });

  it("regroupe les variantes proches sur la même clé", () => {
    expect(normalizeDessertKey("Tarte aux pommes")).toBe(
      normalizeDessertKey("tarte aux  pommes")
    );
  });

  it("gère la ligature œ", () => {
    expect(normalizeDessertKey("Flan aux œufs")).toBe("flan aux oeufs");
  });
});

describe("isoMinusDays", () => {
  it("soustrait des jours en restant en ISO", () => {
    expect(isoMinusDays("2026-06-23", 7)).toBe("2026-06-16");
  });

  it("traverse un changement de mois", () => {
    expect(isoMinusDays("2026-06-03", 5)).toBe("2026-05-29");
  });
});

describe("aggregateObservations", () => {
  const obs = [
    { date: "2026-06-22", nom: "Mi-cuit chocolat" },
    { date: "2026-06-22", nom: "Salade de fruits" },
    { date: "2026-06-23", nom: "Mi cuit chocolat" },
    { date: "2026-06-23", nom: "Tiramisu" },
  ];

  it("calcule la proba sur les jours où des desserts ont été postés", () => {
    const res = aggregateObservations(obs, { today: "2026-06-23", windowDays: 60 });
    const micuit = res.find((d) => normalizeDessertKey(d.nom) === "mi cuit chocolat");
    expect(micuit?.proba).toBe(100);
    const tiramisu = res.find((d) => normalizeDessertKey(d.nom) === "tiramisu");
    expect(tiramisu?.proba).toBe(50);
  });

  it("exclut les observations hors fenêtre", () => {
    const vieux = [
      { date: "2020-01-01", nom: "Vieux dessert" },
      { date: "2026-06-23", nom: "Tiramisu" },
    ];
    const res = aggregateObservations(vieux, { today: "2026-06-23", windowDays: 60 });
    expect(res.map((d) => d.nom)).toEqual(["Tiramisu"]);
    expect(res[0].proba).toBe(100);
  });

  it("classe la saveur/lourdeur via classerDessertNom", () => {
    const res = aggregateObservations(
      [{ date: "2026-06-23", nom: "Mi-cuit chocolat" }],
      { today: "2026-06-23" }
    );
    expect(res[0].type_saveur).toBe("chocolate");
    expect(res[0].restaurant).toBe("Le Truck Muche");
  });

  it("retourne [] si aucune observation dans la fenêtre", () => {
    expect(aggregateObservations([], { today: "2026-06-23" })).toEqual([]);
  });

  it("choisit le libellé le plus fréquent pour une clé", () => {
    const res = aggregateObservations(
      [
        { date: "2026-06-21", nom: "Tarte aux pommes" },
        { date: "2026-06-22", nom: "Tarte aux pommes" },
        { date: "2026-06-23", nom: "tarte aux  pommes" },
      ],
      { today: "2026-06-23" }
    );
    expect(res).toHaveLength(1);
    expect(res[0].nom).toBe("Tarte aux pommes");
  });
});

describe("mergeDesserts", () => {
  it("les desserts observés priment sur le seed (même clé)", () => {
    const seed = [
      { nom: "Mi-cuit chocolat", restaurant: "Le Truck Muche", type_saveur: "chocolate", leger_gourmand: "gourmand", proba: 85 } as const,
    ];
    const observed = [
      { nom: "Mi cuit chocolat", restaurant: "Le Truck Muche", type_saveur: "chocolate", leger_gourmand: "gourmand", proba: 40 } as const,
    ];
    const res = mergeDesserts([...observed], [...seed]);
    expect(res).toHaveLength(1);
    expect(res[0].proba).toBe(40);
  });

  it("garde les entrées du seed absentes des observations", () => {
    const seed = [
      { nom: "Banoffee", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 85 } as const,
    ];
    const res = mergeDesserts([], [...seed]);
    expect(res.map((d) => d.nom)).toEqual(["Banoffee"]);
  });
});
