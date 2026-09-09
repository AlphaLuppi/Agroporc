import { describe, it, expect } from "vitest";
import type { Poi } from "./types";
import { decalages } from "./marqueurs";

const poi = (id: string, b: number, x: number, z: number, type: Poi["type"] = "resto"): Poi =>
  ({ id, name: id, type, lon: 0, lat: 0, addr: "", x, z, b, bh: 10 });

describe("decalages", () => {
  it("deux restos superposés sur le même bâtiment : écartés de ±12 m, le second surélevé", () => {
    const d = decalages([poi("a", 3, 0, 0), poi("b", 3, 4, 2)]);
    expect(d.get("a")).toEqual({ dx: -12, dy: 0 });
    expect(d.get("b")).toEqual({ dx: 12, dy: 24 });
  });

  it("deux restos déjà distants sur le même bâtiment (Basilic n'Go / La Mijote, ~32 m) : x exact, second surélevé", () => {
    const d = decalages([poi("basilic", 68, -27.7, -63.4), poi("mijote", 68, 4, -57)]);
    expect(d.get("basilic")).toEqual({ dx: 0, dy: 0 });
    expect(d.get("mijote")).toEqual({ dx: 0, dy: 24 });
  });

  it("bâtiments différents : aucun décalage", () => {
    const d = decalages([poi("a", 1, 0, 0), poi("b", 2, 1, 1)]);
    expect(d.get("a")).toEqual({ dx: 0, dy: 0 });
    expect(d.get("b")).toEqual({ dx: 0, dy: 0 });
  });

  it("le truck n'entre pas dans le regroupement (il partage le bâtiment de CBA)", () => {
    const d = decalages([poi("cba", 114, 0, 0, "home"), poi("truck", 114, 1, 1, "truck")]);
    expect(d.get("cba")).toEqual({ dx: 0, dy: 0 });
    expect(d.get("truck")).toEqual({ dx: 0, dy: 0 });
  });
});
