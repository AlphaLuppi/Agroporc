import { describe, it, expect } from "vitest";
import { trajetTruck } from "./truck";

const arrondi = (pts: [number, number][]) => pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);

describe("trajetTruck", () => {
  it("remonte la voie de 95 m depuis le point le plus proche, puis file tout droit vers la place", () => {
    const path = trajetTruck([[0, 0], [200, 0]], [100, 30]);
    expect(arrondi(path)).toEqual([[5, 0], [100, 0], [100, 30]]);
  });

  it("prend l'autre sens quand la voie manque de longueur en arrière", () => {
    const path = trajetTruck([[0, 0], [200, 0]], [10, 30]);
    expect(arrondi(path)).toEqual([[105, 0], [10, 0], [10, 30]]);
  });

  it("suit les sommets intermédiaires de la voie (pas de raccourci à travers les bâtiments)", () => {
    const path = trajetTruck([[0, 0], [50, 0], [50, 50]], [60, 45]);
    expect(arrondi(path)).toEqual([[0, 0], [50, 0], [50, 45], [60, 45]]);
  });

  it("élan plus court que demandé si la voie entière est plus courte", () => {
    const path = trajetTruck([[0, 0], [30, 0]], [15, 20]);
    expect(arrondi(path)).toEqual([[0, 0], [15, 0], [15, 20]]);
  });

  it("sans voie exploitable : le truck est déjà sur sa place", () => {
    expect(trajetTruck([], [1, 2])).toEqual([[1, 2]]);
    expect(trajetTruck([[0, 0]], [1, 2])).toEqual([[1, 2]]);
  });
});
