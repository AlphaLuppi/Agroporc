import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { ControleurTitan, MondeMonstres } from "./jeu-monstres";
import { TITAN } from "./monstres";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const rect = (x0: number, z0: number, x1: number, z1: number): Building => ({ h: 10, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] });
const vide = construireMonde({ ...scene, buildings: [rect(-2000, -2000, -1999, -1999), rect(1999, 1999, 2000, 2000)], pois: [] } as SceneData);

describe("MondeMonstres", () => {
  it("interpole position et cap (par le plus court chemin) entre deux snaps", () => {
    const m = new MondeMonstres();
    m.alimenter(1000, { tigre: { p: [0, 0, 0], cap: 3, v: 4, pv: 100, pvMax: 200 } });
    m.alimenter(1100, { tigre: { p: [10, 0, 0], cap: -3, v: 6, pv: 90, pvMax: 200 } });
    const t = m.a(1050).tigre!;
    expect(t.p[0]).toBeCloseTo(5, 6);
    expect(Math.abs(Math.cos(t.cap) - Math.cos(Math.PI))).toBeLessThan(0.01); // passe par ±π, pas par 0
    expect(t.pv).toBe(90);
    expect(m.a(5000).tigre!.p[0]).toBe(10);
  });

  it("un monstre qui disparaît du snap disparaît de l'interpolation", () => {
    const m = new MondeMonstres();
    m.alimenter(1000, { truck: { p: [0, 0, 0], cap: 0, v: 10 } });
    m.alimenter(1100, undefined);
    expect(m.a(1090).truck).toBeUndefined();
    expect(m.a(1010).truck).toBeDefined();
  });

  it("suit l'événement (annonce → actif → fin), les lasers et le titan", () => {
    const m = new MondeMonstres();
    m.majEvenement({ t: "evenement", type: "truck", phase: "annonce", debutT: 10, finT: 20 });
    expect(m.evenement()).toMatchObject({ type: "truck", phase: "annonce" });
    m.majEvenement({ t: "evenement", type: "truck", phase: "debut", debutT: 10, finT: 20 });
    expect(m.evenement()?.phase).toBe("actif");
    m.majEvenement({ t: "evenement", type: "truck", phase: "fin", debutT: 10, finT: 20, raison: "temps" });
    expect(m.evenement()).toBeNull();
    m.ajouterLaser({ t: "laser", de: [0, 5, 0], vers: [10, 0, 0], rayon: 3, tirT: 1000 });
    expect(m.lasers(900)).toHaveLength(1);
    expect(m.lasers(1400)).toHaveLength(0);
    m.majTitan({ t: "titan", phase: "debut", pilote: "j1", p: [0, 0, 0], cap: 0, finT: 5000 });
    expect(m.titan()?.pilote).toBe("j1");
    m.majTitan({ t: "titan", phase: "fin", pilote: "j1", p: [0, 0, 0], cap: 0, finT: 5000, raison: "temps" });
    expect(m.titan()).toBeNull();
  });
});

describe("ControleurTitan", () => {
  it("simule le titan et numérote ses messages", () => {
    const c = new ControleurTitan();
    expect(c.message(0, 0)).toBeNull();
    c.entrer([0, 0, 0], 0);
    c.maj(1, { avant: 1, droite: 0, lacet: 0 }, vide); // plafonné à 0,1 s
    expect(c.etat()!.p[2]).toBeCloseTo(-TITAN.vitesse * 0.1, 3);
    const m1 = c.message(0.2, 0.1)!, m2 = c.message(0.2, 0.1)!;
    expect(m2.seq).toBe(m1.seq + 1);
    c.sortir();
    expect(c.actif()).toBe(false);
  });
});
