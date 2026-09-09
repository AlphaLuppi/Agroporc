import { describe, expect, it } from "vitest";
import { cumulativeLengths, pickBusRoutes, stopAbscissas } from "./bus";
import type { Vec2 } from "./types";

describe("cumulativeLengths", () => {
  it("commence à 0 et cumule les longueurs des segments", () => {
    expect(cumulativeLengths([[0, 0], [100, 0]])).toEqual([0, 100]);
    expect(cumulativeLengths([[0, 0], [100, 0], [100, 50]])).toEqual([0, 100, 150]);
  });

  it("retourne [0] pour un point isolé", () => {
    expect(cumulativeLengths([[3, 4]])).toEqual([0]);
  });
});

describe("stopAbscissas", () => {
  const straight: Vec2[] = [[0, 0], [100, 0]];

  it("garde les arrêts proches, écarte les lointains et dédoublonne", () => {
    const stops: Vec2[] = [
      [50, 5], // gardé, s = 50
      [50, 20], // trop loin (20 m > 12)
      [51, 3], // doublon de 50 (< 2 m d'écart en s)
      [120, 0], // au-delà du bout : projection s = 100 à 20 m → écarté
    ];
    expect(stopAbscissas(straight, stops)).toEqual([50]);
  });

  it("trie les abscisses par ordre croissant", () => {
    const stops: Vec2[] = [[80, -4], [20, 4]];
    expect(stopAbscissas(straight, stops)).toEqual([20, 80]);
  });

  it("respecte maxDist", () => {
    expect(stopAbscissas(straight, [[50, 15]], 20)).toEqual([50]);
    expect(stopAbscissas(straight, [[50, 15]], 12)).toEqual([]);
  });

  it("projette sur une polyligne en L à deux segments", () => {
    const L: Vec2[] = [[0, 0], [100, 0], [100, 50]];
    const stops: Vec2[] = [
      [30, 6], // 1er segment, s = 30
      [106, 20], // 2e segment, s = 120
    ];
    const s = stopAbscissas(L, stops);
    expect(s).toHaveLength(2);
    expect(s[0]).toBeCloseTo(30, 5);
    expect(s[1]).toBeCloseTo(120, 5);
  });

  it("retourne [] sans arrêts ou avec une polyligne dégénérée", () => {
    expect(stopAbscissas(straight, [])).toEqual([]);
    expect(stopAbscissas([[0, 0]], [[0, 0]])).toEqual([]);
  });
});

describe("pickBusRoutes", () => {
  const routes = [
    { p: [[0, 0], [1000, 0]] as Vec2[] }, // longue, 0 arrêt
    { p: [[0, 100], [200, 100]] as Vec2[] }, // courte, 2 arrêts
    { p: [[0, 200], [500, 200]] as Vec2[] }, // moyenne, 1 arrêt
  ];
  const stops: Vec2[] = [[50, 104], [150, 96], [250, 203]];

  it("privilégie les routes desservant le plus d'arrêts, puis les plus longues", () => {
    expect(pickBusRoutes(routes, stops, 3)).toEqual([1, 2, 0]);
  });

  it("retourne au plus count indices", () => {
    expect(pickBusRoutes(routes, stops, 2)).toEqual([1, 2]);
    expect(pickBusRoutes(routes, stops, 1)).toEqual([1]);
  });

  it("ne dépasse jamais le nombre de routes", () => {
    expect(pickBusRoutes(routes, stops, 10)).toHaveLength(3);
    expect(pickBusRoutes([], stops, 4)).toEqual([]);
  });

  it("départage par longueur sans arrêts", () => {
    expect(pickBusRoutes(routes, [], 3)).toEqual([0, 2, 1]);
  });
});
