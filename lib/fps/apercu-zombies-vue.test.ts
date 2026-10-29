import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { batimentDeFenetre, batimentDesJoueurs, fenetresAttaquees } from "./apercu-zombies-vue";
import { BATIMENTS_CREUX, FENETRES, donneesZombies } from "./zombies-carte";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const data = donneesZombies(scene).data;
const creux = [...BATIMENTS_CREUX];

describe("batimentDesJoueurs", () => {
  it("le bâtiment creux qui contient le plus de survivants", () => {
    const [a, b] = [scene.buildings[creux[0]].c, scene.buildings[creux[1]].c];
    expect(batimentDesJoueurs(data, creux, [[a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], 0, b[1]]])).toBe(creux[1]);
    expect(batimentDesJoueurs(data, creux, [[a[0], 0, a[1]]])).toBe(creux[0]);
  });
  it("null si tous les survivants sont dehors", () => {
    expect(batimentDesJoueurs(data, creux, [[-500, 0, -500]])).toBeNull();
    expect(batimentDesJoueurs(data, creux, [])).toBeNull();
  });
});

describe("fenetresAttaquees", () => {
  const t = (id: number, mode: "chasse" | "sol" | "fenetre" | "saut", f: (typeof FENETRES)[number], d = 0) =>
    ({ id, x: f.dehors[0] + d, z: f.dehors[1], cap: 0, type: 0 as const, mode, pvPct: 100 });
  it("une fenêtre dont un tigre arrache les planches à moins de 7 m", () => {
    expect(fenetresAttaquees([t(1, "fenetre", FENETRES[3])], FENETRES)).toContain(3);
  });
  it("ni les tigres qui marchent, ni ceux qui sont trop loin", () => {
    expect(fenetresAttaquees([t(1, "chasse", FENETRES[3])], FENETRES)).toEqual([]);
    expect(fenetresAttaquees([t(1, "fenetre", FENETRES[3], 50)], FENETRES)).toEqual([]);
  });
  it("sans doublon", () => {
    expect(fenetresAttaquees([t(1, "fenetre", FENETRES[2]), t(2, "fenetre", FENETRES[2])], FENETRES)).toEqual([2]);
  });
});

describe("batimentDeFenetre (vraie carte)", () => {
  it("chaque fenêtre est rattachée à un bâtiment creux ou à une cour (null)", () => {
    const r = batimentDeFenetre(data, creux, FENETRES);
    expect(r).toHaveLength(FENETRES.length);
    r.forEach((i) => { if (i !== null) expect(creux).toContain(i); });
    expect(r.filter((i) => i !== null).length).toBeGreaterThanOrEqual(5);
  });
});
