import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { BIP_CUISSON_MS, GRENADES, preparerLancer, vitesseLancer } from "./grenades";
import { EXPLOSION_MAX_MS, PREDICTION_MAX_MS, creerControleurGrenades } from "./jeu-grenades";
import type { Vec3 } from "./protocole";
import { construireMonde } from "./collision";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMonde({ ...scene, buildings: [{ h: 1, r: [[500, 500], [501, 500], [501, 501], [500, 501]], c: [500.5, 500.5] }], pois: [] });
const O: Vec3 = [0, 1.95, 0];
const D: Vec3 = [0, 0, -1];

describe("cuisson (la main du joueur)", () => {
  it("frag : la goupille part à la pression, un bip par demi-seconde, lancée au relâchement avec le temps de cuisson", () => {
    const c = creerControleurGrenades(monde);
    expect(c.presser("frag", 1_000, 2)).toBeNull();
    expect(c.cuisson(1_000)).toBe(0);
    expect(c.majCuisson(1_000 + BIP_CUISSON_MS - 1).bip).toBe(false);
    expect(c.majCuisson(1_000 + BIP_CUISSON_MS).bip).toBe(true);
    expect(c.majCuisson(1_000 + BIP_CUISSON_MS + 10).bip).toBe(false);
    // une deuxième pression pendant la cuisson ne fait rien
    expect(c.presser("frag", 1_200, 2)).toBeNull();
    expect(c.relacher("remontoir", 1_800)).toBeNull();
    expect(c.relacher("frag", 1_800)).toEqual({ genre: "frag", cuissonMs: 800 });
    expect(c.cuisson(1_900)).toBeNull();
  });

  it("frag tenue jusqu'au bout de la mèche : elle part toute seule, cuisson pleine", () => {
    const c = creerControleurGrenades(monde);
    c.presser("frag", 0, 1);
    expect(c.majCuisson(GRENADES.frag.mecheMs).lancer).toEqual({ genre: "frag", cuissonMs: GRENADES.frag.mecheMs });
    expect(c.relacher("frag", GRENADES.frag.mecheMs + 10)).toBeNull();
  });

  it("remontoir : lancé dès la pression, sans cuisson ; sans stock, rien ; annuler abandonne la cuisson", () => {
    const c = creerControleurGrenades(monde);
    expect(c.presser("remontoir", 0, 1)).toEqual({ genre: "remontoir", cuissonMs: 0 });
    expect(c.presser("remontoir", 0, 0)).toBeNull();
    expect(c.presser("frag", 0, 0)).toBeNull();
    c.presser("frag", 0, 1);
    c.annuler();
    expect(c.relacher("frag", 500)).toBeNull();
  });
});

describe("grenades à dessiner", () => {
  it("ma prédiction est remplacée par la grenade du serveur, qui fait foi ; l'explosion la retire", () => {
    const c = creerControleurGrenades(monde);
    const p = c.predire("frag", O, D, 10_000, 0, "a");
    expect(p.id).toBeLessThan(0);
    expect(c.enAttente("frag")).toBe(1);
    expect(c.affichees(10_100)).toHaveLength(1);
    const v = vitesseLancer("frag", D);
    const g = c.recevoir({ id: 7, par: "a", genre: "frag", o: O, v, t0: 10_040, explosionT: 10_040 + GRENADES.frag.mecheMs }, "a");
    expect(c.enAttente("frag")).toBe(0);
    const aff = c.affichees(10_200);
    expect(aff).toHaveLength(1);
    expect(aff[0].id).toBe(7);
    // même trajectoire que celle du serveur
    expect(g.traj).toEqual(preparerLancer(monde, "frag", O, v, 10_040, 0).traj);
    expect(c.exploser(7)?.id).toBe(7);
    expect(c.affichees(10_300)).toEqual([]);
  });

  it("la grenade d'un autre ne retire pas ma prédiction ; une prédiction jamais confirmée disparaît, une explosion jamais annoncée aussi", () => {
    const c = creerControleurGrenades(monde);
    c.predire("frag", O, D, 0, 0, "a");
    c.recevoir({ id: 1, par: "b", genre: "frag", o: O, v: vitesseLancer("frag", D), t0: 0, explosionT: 1_000 }, "a");
    expect(c.enAttente("frag")).toBe(1);
    expect(c.affichees(PREDICTION_MAX_MS + 1).map((x) => x.id)).toEqual([1]);
    expect(c.affichees(1_000 + EXPLOSION_MAX_MS + 1)).toEqual([]);
  });

  it("le remontoir est « posé » une fois arrêté, et ses rebonds sont datés", () => {
    const c = creerControleurGrenades(monde);
    const l = preparerLancer(monde, "remontoir", O, vitesseLancer("remontoir", D), 0, 0);
    c.recevoir({ id: 3, par: "b", genre: "remontoir", o: O, v: vitesseLancer("remontoir", D), t0: 0, explosionT: l.explosionT }, "a");
    expect(c.affichees(10)[0].posee).toBe(false);
    expect(c.affichees(l.poseT + 1)[0].posee).toBe(true);
    expect(c.affichees(l.poseT + GRENADES.remontoir.mecheMs / 2)[0].mecheEcoulee).toBeCloseTo(0.5, 2);
    const chocs = c.rebonds(0, l.poseT);
    expect(chocs.length).toBe(l.traj.rebonds.length);
    expect(chocs.length).toBeGreaterThan(0);
    expect(c.rebonds(l.poseT, l.explosionT)).toEqual([]);
  });
});
